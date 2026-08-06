import CaptureRecognition
import Foundation
import Network

protocol PokemonDetectionControlling: AnyObject {
    func startDetection() throws -> Void
    func stopDetection() throws -> Void
}

enum DetectionControlServerError: Error, CustomStringConvertible {
    case invalidPort(UInt16)
    case incompleteRequest
    case oversizedRequest
    case invalidRequestEncoding
    case invalidRequestLine(String)
    case forbiddenOrigin(String?)
    case invalidRecognitionEvent(String)
    case invalidSceneEvent(String)
    case eventRelayNotInstalled

    var description: String {
        switch self {
        case let .invalidPort(port):
            return "invalid detection control port: \(port)"
        case .incompleteRequest:
            return "HTTP request ended before its headers were complete"
        case .oversizedRequest:
            return "HTTP request headers exceeded 16 KiB"
        case .invalidRequestEncoding:
            return "HTTP request headers are not valid UTF-8"
        case let .invalidRequestLine(line):
            return "invalid HTTP request line: \(line)"
        case let .forbiddenOrigin(origin):
            return "HTTP origin is not allowed: \(origin ?? "missing")"
        case let .invalidRecognitionEvent(detail):
            return "invalid internal recognition event: \(detail)"
        case let .invalidSceneEvent(detail):
            return "invalid internal scene event: \(detail)"
        case .eventRelayNotInstalled:
            return "recognition event relay was used before installation"
        }
    }
}

final class EventRelay {
    private let lock = NSLock()
    private var handler: ((String) -> Void)?

    func install(handler: @escaping (String) -> Void) throws -> Void {
        lock.lock()
        defer { lock.unlock() }
        guard self.handler == nil else {
            throw DetectionControlServerError.invalidRecognitionEvent(
                "recognition event relay handler was installed more than once"
            )
        }
        self.handler = handler
    }

    func publish(json: String) -> Void {
        lock.lock()
        let installedHandler = handler
        lock.unlock()
        guard let installedHandler else {
            log("エラー: \(DetectionControlServerError.eventRelayNotInstalled)")
            exit(1)
        }
        installedHandler(json)
    }
}

private struct HTTPRequestHead {
    let method: String
    let path: String
    let origin: String?
}

private struct DetectionStateEvent: Encodable {
    let type: String
    let runID: UInt64
    let revision: UInt64
    let status: PokemonDetectionStatus
    let player: DetectedPokemonPresence?
    let opponent: DetectedPokemonPresence?
    let failedSides: [BattleSide]

    private enum CodingKeys: String, CodingKey {
        case type
        case runID
        case revision
        case status
        case player
        case opponent
        case failedSides
    }

    func encode(to encoder: Encoder) throws -> Void {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        try container.encode(runID, forKey: .runID)
        try container.encode(revision, forKey: .revision)
        try container.encode(status, forKey: .status)
        if let player {
            try container.encode(player, forKey: .player)
        } else {
            try container.encodeNil(forKey: .player)
        }
        if let opponent {
            try container.encode(opponent, forKey: .opponent)
        } else {
            try container.encodeNil(forKey: .opponent)
        }
        try container.encode(failedSides, forKey: .failedSides)
    }
}

private struct RecognitionPresenceEvent: Decodable {
    let type: String
    let side: BattleSide
    let pokemon: String
    let displayName: String
    let confidence: Float
}

private struct RecognitionFailureEvent: Decodable {
    let type: String
    let side: BattleSide
}

private struct SceneRelayEvent: Codable {
    let type: String
    let revision: UInt64
    let scene: String
    let candidate: String
    let stability: String
    let playerHUD: String
    let opponentHUD: String
}

private enum RecognitionEventUpdate {
    case ignored
    case presenceAccepted(PokemonDetectionResolution)
    case failureAccepted(PokemonDetectionResolution)
}

final class DetectionControlServer {
    private static let detectionTimeoutSeconds: TimeInterval = 12
    private static let eventHeartbeatSeconds: TimeInterval = 15
    private static let allowedOrigins: Set<String> = [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
    ]

    private let listener: NWListener
    private let detectionController: PokemonDetectionControlling
    private let queue = DispatchQueue(label: "detection.control.server")
    private let encoder = JSONEncoder()
    private var state = PokemonDetectionControlState()
    private var detectionTimeoutWorkItem: DispatchWorkItem?
    private var eventConnections: [NWConnection] = []
    private var sceneEventConnections: [NWConnection] = []
    private var eventHeartbeatTimer: DispatchSourceTimer?
    private var latestSceneEvent: SceneRelayEvent
    private var latestSceneJSON: String

    init(port: UInt16, detectionController: PokemonDetectionControlling) throws {
        guard let networkPort = NWEndpoint.Port(rawValue: port) else {
            throw DetectionControlServerError.invalidPort(port)
        }
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: "127.0.0.1",
            port: networkPort
        )
        self.listener = try NWListener(using: parameters)
        self.detectionController = detectionController
        let initialSceneEvent = SceneRelayEvent(
            type: "scene_state",
            revision: 0,
            scene: "unknown",
            candidate: "unknown",
            stability: "stable",
            playerHUD: "hidden",
            opponentHUD: "hidden"
        )
        self.latestSceneEvent = initialSceneEvent
        self.latestSceneJSON = try Self.encodeSceneEvent(initialSceneEvent)
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
    }

    func start() -> Void {
        listener.start(queue: queue)
        queue.async { [self] in
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(
                deadline: .now() + Self.eventHeartbeatSeconds,
                repeating: Self.eventHeartbeatSeconds
            )
            timer.setEventHandler { [weak self] in
                self?.broadcastEventPacket(Data(": keep-alive\n\n".utf8))
                self?.broadcastSceneEventPacket(Data(": keep-alive\n\n".utf8))
            }
            eventHeartbeatTimer = timer
            timer.activate()
        }
    }

    func publishRecognitionEvent(json: String) -> Void {
        queue.async { [self] in
            do {
                switch try updateState(json: json) {
                case .ignored:
                    return
                case let .presenceAccepted(resolution):
                    try publishAcceptedResolution(resolution)
                case let .failureAccepted(resolution):
                    try publishAcceptedResolution(resolution)
                }
            } catch {
                log("エラー: 認識イベントの配信に失敗: \(error)")
                exit(1)
            }
        }
    }

    func publishSceneEvent(json: String) -> Void {
        queue.async { [self] in
            do {
                let event = try Self.decodeSceneEvent(json)
                guard event.revision > latestSceneEvent.revision else {
                    throw DetectionControlServerError.invalidSceneEvent(
                        "revision \(event.revision) is not newer than \(latestSceneEvent.revision)"
                    )
                }
                latestSceneEvent = event
                latestSceneJSON = try Self.encodeSceneEvent(event)
                broadcastSceneEventPacket(Data("data: \(latestSceneJSON)\n\n".utf8))
            } catch {
                log("エラー: 画面状態イベントの配信に失敗: \(error)")
                exit(1)
            }
        }
    }

    private func accept(_ connection: NWConnection) -> Void {
        connection.start(queue: queue)
        receiveRequestHead(connection: connection, buffer: Data())
    }

    private func receiveRequestHead(connection: NWConnection, buffer: Data) -> Void {
        connection.receive(
            minimumIncompleteLength: 1,
            maximumLength: 4_096
        ) { [weak self] content, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            if let error {
                log("検出制御リクエストの受信に失敗: \(error)")
                connection.cancel()
                return
            }
            var received = buffer
            if let content {
                received.append(content)
            }
            do {
                if received.count > 16_384 {
                    throw DetectionControlServerError.oversizedRequest
                }
                if received.range(of: Data("\r\n\r\n".utf8)) != nil {
                    try handleRequest(connection: connection, data: received)
                    return
                }
                guard !isComplete else {
                    throw DetectionControlServerError.incompleteRequest
                }
                receiveRequestHead(connection: connection, buffer: received)
            } catch {
                sendError(connection: connection, status: "400 Bad Request", detail: String(describing: error))
            }
        }
    }

    private func handleRequest(connection: NWConnection, data: Data) throws -> Void {
        let request = try parseRequestHead(data: data)
        guard let origin = request.origin, Self.allowedOrigins.contains(origin) else {
            throw DetectionControlServerError.forbiddenOrigin(request.origin)
        }

        switch (request.method, request.path) {
        case ("GET", "/state"):
            sendJSON(connection: connection, json: try stateJSON(), origin: origin)
        case ("GET", "/events"):
            openEventStream(connection: connection, origin: origin)
        case ("GET", "/scene-events"):
            openSceneEventStream(connection: connection, origin: origin)
        case ("POST", "/detect"):
            try startDetection()
            sendJSON(connection: connection, json: try stateJSON(), origin: origin)
        default:
            sendError(connection: connection, status: "404 Not Found", detail: "route not found")
        }
    }

    private func parseRequestHead(data: Data) throws -> HTTPRequestHead {
        guard let text = String(data: data, encoding: .utf8) else {
            throw DetectionControlServerError.invalidRequestEncoding
        }
        let lines = text.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            throw DetectionControlServerError.invalidRequestLine("")
        }
        let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count == 3, parts[2].hasPrefix("HTTP/1.") else {
            throw DetectionControlServerError.invalidRequestLine(requestLine)
        }
        let origin = lines.dropFirst().first { line in
            line.lowercased().hasPrefix("origin:")
        }.map { line in
            String(line.dropFirst("origin:".count)).trimmingCharacters(in: .whitespaces)
        }
        return HTTPRequestHead(
            method: String(parts[0]),
            path: String(parts[1]),
            origin: origin
        )
    }

    private func startDetection() throws -> Void {
        try detectionController.startDetection()
        try state.startDetection()
        scheduleDetectionTimeout()
        broadcastEvent(json: try stateJSON())
        log("ポケモン名の手動検出を開始")
    }

    private func scheduleDetectionTimeout() -> Void {
        let workItem = DispatchWorkItem { [weak self] in
            self?.finishTimedOutDetection()
        }
        detectionTimeoutWorkItem = workItem
        queue.asyncAfter(
            deadline: .now() + Self.detectionTimeoutSeconds,
            execute: workItem
        )
    }

    private func finishTimedOutDetection() -> Void {
        guard state.status == .detecting else {
            return
        }
        do {
            try state.timeoutDetection()
            try detectionController.stopDetection()
            detectionTimeoutWorkItem = nil
            broadcastEvent(json: try stateJSON())
            log("ポケモン名の手動検出をタイムアウトで終了")
        } catch {
            log("エラー: ポケモン名検出のタイムアウト処理に失敗: \(error)")
            exit(1)
        }
    }

    private func updateState(json: String) throws -> RecognitionEventUpdate {
        guard state.status == .detecting else {
            return .ignored
        }
        guard let data = json.data(using: .utf8) else {
            throw DetectionControlServerError.invalidRecognitionEvent("event is not UTF-8")
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else {
            throw DetectionControlServerError.invalidRecognitionEvent("event type is missing")
        }
        if type == "pokemon_detection_failed" {
            let event = try JSONDecoder().decode(RecognitionFailureEvent.self, from: data)
            let resolution = try state.recordFailure(side: event.side)
            guard resolution != .alreadyResolved else {
                return .ignored
            }
            return .failureAccepted(resolution)
        }
        guard type == "pokemon_detected" || type == "pokemon_switched_in" else {
            return .ignored
        }
        let event = try JSONDecoder().decode(RecognitionPresenceEvent.self, from: data)
        let resolution = try state.recordPresence(DetectedPokemonPresence(
            side: event.side,
            pokemon: event.pokemon,
            displayName: event.displayName,
            confidence: event.confidence
        ))
        guard resolution != .alreadyResolved else {
            return .ignored
        }
        return .presenceAccepted(resolution)
    }

    private func finishDetectionIfCompleted(
        resolution: PokemonDetectionResolution
    ) throws -> Void {
        guard resolution == .completed else {
            return
        }
        detectionTimeoutWorkItem?.cancel()
        detectionTimeoutWorkItem = nil
        try detectionController.stopDetection()
        broadcastEvent(json: try stateJSON())
        log("ポケモン名の手動検出を終了")
    }

    private func publishAcceptedResolution(
        _ resolution: PokemonDetectionResolution
    ) throws -> Void {
        if resolution == .completed {
            try finishDetectionIfCompleted(resolution: resolution)
        } else {
            broadcastEvent(json: try stateJSON())
        }
    }

    private func stateJSON() throws -> String {
        let event = DetectionStateEvent(
            type: "detection_state",
            runID: state.runID,
            revision: state.revision,
            status: state.status,
            player: state.player,
            opponent: state.opponent,
            failedSides: state.failedSides
        )
        let data = try encoder.encode(event)
        guard let json = String(data: data, encoding: .utf8) else {
            throw DetectionControlServerError.invalidRecognitionEvent(
                "detection state is not UTF-8"
            )
        }
        return json
    }

    private func openEventStream(connection: NWConnection, origin: String) -> Void {
        do {
            let headers = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: text/event-stream\r\n"
                + "Cache-Control: no-cache\r\n"
                + "Connection: keep-alive\r\n"
                + "Access-Control-Allow-Origin: \(origin)\r\n"
                + "Vary: Origin\r\n\r\n"
            let initialEvent = "data: \(try stateJSON())\n\n"
            let response = Data((headers + initialEvent).utf8)
            connection.send(content: response, completion: .contentProcessed { [weak self] error in
                guard let self, error == nil else {
                    connection.cancel()
                    return
                }
                self.queue.async {
                    self.eventConnections.append(connection)
                    self.monitorEventDisconnect(connection)
                }
            })
        } catch {
            sendError(connection: connection, status: "500 Internal Server Error", detail: String(describing: error))
        }
    }

    private func openSceneEventStream(connection: NWConnection, origin: String) -> Void {
        let headers = "HTTP/1.1 200 OK\r\n"
            + "Content-Type: text/event-stream\r\n"
            + "Cache-Control: no-cache\r\n"
            + "Connection: keep-alive\r\n"
            + "Access-Control-Allow-Origin: \(origin)\r\n"
            + "Vary: Origin\r\n\r\n"
        let initialEvent = "data: \(latestSceneJSON)\n\n"
        let response = Data((headers + initialEvent).utf8)
        connection.send(content: response, completion: .contentProcessed { [weak self] error in
            guard let self, error == nil else {
                connection.cancel()
                return
            }
            self.queue.async {
                self.sceneEventConnections.append(connection)
                self.monitorSceneEventDisconnect(connection)
            }
        })
    }

    private func broadcastEvent(json: String) -> Void {
        broadcastEventPacket(Data("data: \(json)\n\n".utf8))
    }

    private func broadcastEventPacket(_ packet: Data) -> Void {
        for connection in eventConnections {
            connection.send(content: packet, completion: .contentProcessed { [weak self] error in
                if error != nil {
                    self?.queue.async {
                        self?.removeEventConnection(connection)
                    }
                }
            })
        }
    }

    private func broadcastSceneEventPacket(_ packet: Data) -> Void {
        for connection in sceneEventConnections {
            connection.send(content: packet, completion: .contentProcessed { [weak self] error in
                if error != nil {
                    self?.queue.async {
                        self?.removeSceneEventConnection(connection)
                    }
                }
            })
        }
    }

    private func monitorEventDisconnect(_ connection: NWConnection) -> Void {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self, weak connection] _, _, isComplete, error in
            guard let self, let connection else { return }
            if isComplete || error != nil {
                self.removeEventConnection(connection)
                return
            }
            self.monitorEventDisconnect(connection)
        }
    }

    private func monitorSceneEventDisconnect(_ connection: NWConnection) -> Void {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self, weak connection] _, _, isComplete, error in
            guard let self, let connection else { return }
            if isComplete || error != nil {
                self.removeSceneEventConnection(connection)
                return
            }
            self.monitorSceneEventDisconnect(connection)
        }
    }

    private func sendJSON(connection: NWConnection, json: String, origin: String) -> Void {
        let body = Data(json.utf8)
        let headers = "HTTP/1.1 200 OK\r\n"
            + "Content-Type: application/json; charset=utf-8\r\n"
            + "Content-Length: \(body.count)\r\n"
            + "Cache-Control: no-store\r\n"
            + "Access-Control-Allow-Origin: \(origin)\r\n"
            + "Vary: Origin\r\n"
            + "Connection: close\r\n\r\n"
        var response = Data(headers.utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func sendError(connection: NWConnection, status: String, detail: String) -> Void {
        let body = Data(detail.utf8)
        let headers = "HTTP/1.1 \(status)\r\n"
            + "Content-Type: text/plain; charset=utf-8\r\n"
            + "Content-Length: \(body.count)\r\n"
            + "Connection: close\r\n\r\n"
        var response = Data(headers.utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func removeEventConnection(_ connection: NWConnection) -> Void {
        eventConnections.removeAll { $0 === connection }
        connection.cancel()
    }

    private func removeSceneEventConnection(_ connection: NWConnection) -> Void {
        sceneEventConnections.removeAll { $0 === connection }
        connection.cancel()
    }

    private static func decodeSceneEvent(_ json: String) throws -> SceneRelayEvent {
        guard let data = json.data(using: .utf8) else {
            throw DetectionControlServerError.invalidSceneEvent("event is not UTF-8")
        }
        let event = try JSONDecoder().decode(SceneRelayEvent.self, from: data)
        guard event.type == "scene_state" else {
            throw DetectionControlServerError.invalidSceneEvent("event type must be scene_state")
        }
        let scenes: Set<String> = [
            "unknown",
            "out_of_battle",
            "battle_result",
            "team_selection",
            "battle_input",
            "party_overview",
            "battle_action",
        ]
        guard scenes.contains(event.scene), scenes.contains(event.candidate) else {
            throw DetectionControlServerError.invalidSceneEvent("event contains an unsupported scene")
        }
        guard event.stability == "stable" || event.stability == "transitioning" else {
            throw DetectionControlServerError.invalidSceneEvent("event contains invalid stability")
        }
        let hudValues: Set<String> = ["visible", "hidden"]
        guard hudValues.contains(event.playerHUD), hudValues.contains(event.opponentHUD) else {
            throw DetectionControlServerError.invalidSceneEvent("event contains invalid HUD visibility")
        }
        return event
    }

    private static func encodeSceneEvent(_ event: SceneRelayEvent) throws -> String {
        let data = try JSONEncoder().encode(event)
        guard let json = String(data: data, encoding: .utf8) else {
            throw DetectionControlServerError.invalidSceneEvent("event is not UTF-8")
        }
        return json
    }
}
