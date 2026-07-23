import CaptureRecognition
import Foundation
import Network

protocol PokemonDetectionModeControlling: AnyObject {
    func changeMode(to mode: PokemonDetectionMode) throws -> Void
}

enum DetectionControlServerError: Error, CustomStringConvertible {
    case invalidPort(UInt16)
    case incompleteRequest
    case oversizedRequest
    case invalidRequestEncoding
    case invalidRequestLine(String)
    case forbiddenOrigin(String?)
    case invalidRecognitionEvent(String)
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
        case .eventRelayNotInstalled:
            return "recognition event relay was used before installation"
        }
    }
}

final class RecognitionEventRelay {
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
    let mode: PokemonDetectionMode
    let player: DetectedPokemonPresence?
    let opponent: DetectedPokemonPresence?

    private enum CodingKeys: String, CodingKey {
        case type
        case mode
        case player
        case opponent
    }

    func encode(to encoder: Encoder) throws -> Void {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        try container.encode(mode, forKey: .mode)
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
    }
}

private struct RecognitionPresenceEvent: Decodable {
    let type: String
    let side: BattleSide
    let pokemon: String
    let displayName: String
    let confidence: Float
}

final class DetectionControlServer {
    private static let allowedOrigins: Set<String> = [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
    ]

    private let listener: NWListener
    private let modeController: PokemonDetectionModeControlling
    private let queue = DispatchQueue(label: "detection.control.server")
    private let encoder = JSONEncoder()
    private var state = PokemonDetectionControlState(mode: .automatic)
    private var eventConnections: [NWConnection] = []

    init(port: UInt16, modeController: PokemonDetectionModeControlling) throws {
        guard let networkPort = NWEndpoint.Port(rawValue: port) else {
            throw DetectionControlServerError.invalidPort(port)
        }
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: "127.0.0.1",
            port: networkPort
        )
        self.listener = try NWListener(using: parameters)
        self.modeController = modeController
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
    }

    func start() -> Void {
        listener.start(queue: queue)
    }

    func publishRecognitionEvent(json: String) -> Void {
        queue.async { [self] in
            do {
                if try updateStateIfPresenceEvent(json: json) {
                    broadcastEvent(json: json)
                }
            } catch {
                log("エラー: 認識イベントの配信に失敗: \(error)")
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
        case ("POST", "/mode/auto"):
            try changeMode(to: .automatic)
            sendJSON(connection: connection, json: try stateJSON(), origin: origin)
        case ("POST", "/mode/manual"):
            try changeMode(to: .manual)
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

    private func changeMode(to mode: PokemonDetectionMode) throws -> Void {
        guard mode != state.mode else {
            return
        }
        try modeController.changeMode(to: mode)
        _ = state.changeMode(to: mode)
        broadcastEvent(json: try stateJSON())
        log("ポケモン名検出モード: \(mode.rawValue)")
    }

    private func updateStateIfPresenceEvent(json: String) throws -> Bool {
        guard let data = json.data(using: .utf8) else {
            throw DetectionControlServerError.invalidRecognitionEvent("event is not UTF-8")
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else {
            throw DetectionControlServerError.invalidRecognitionEvent("event type is missing")
        }
        guard type == "pokemon_detected" || type == "pokemon_switched_in" else {
            return false
        }
        let event = try JSONDecoder().decode(RecognitionPresenceEvent.self, from: data)
        try state.recordAutomaticPresence(DetectedPokemonPresence(
            side: event.side,
            pokemon: event.pokemon,
            displayName: event.displayName,
            confidence: event.confidence
        ))
        return true
    }

    private func stateJSON() throws -> String {
        let event = DetectionStateEvent(
            type: "detection_state",
            mode: state.mode,
            player: state.player,
            opponent: state.opponent
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
                }
            })
        } catch {
            sendError(connection: connection, status: "500 Internal Server Error", detail: String(describing: error))
        }
    }

    private func broadcastEvent(json: String) -> Void {
        let packet = Data("data: \(json)\n\n".utf8)
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
}
