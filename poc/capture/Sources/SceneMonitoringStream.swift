import CaptureRecognition
import CoreMedia
import CoreVideo
import Foundation

private struct SceneStateEvent: Encodable {
    let type: String
    let revision: UInt64
    let scene: String
    let candidate: String
    let stability: String
    let playerHUD: String
    let opponentHUD: String
}

enum SceneMonitoringStreamError: Error, CustomStringConvertible {
    case invalidSampleInterval(TimeInterval)
    case invalidPresentationTimestamp(CMTime)
    case nonMonotonicPresentationTimestamp(previous: TimeInterval, current: TimeInterval)
    case eventEncodingFailed

    var description: String {
        switch self {
        case let .invalidSampleInterval(interval):
            return "invalid scene-monitor sample interval: \(interval)"
        case let .invalidPresentationTimestamp(timestamp):
            return "invalid scene-monitor presentation timestamp: \(timestamp)"
        case let .nonMonotonicPresentationTimestamp(previous, current):
            return "scene-monitor timestamp moved backward from \(previous) to \(current)"
        case .eventEncodingFailed:
            return "scene-monitor event is not valid UTF-8"
        }
    }
}

final class SceneMonitoringFrameObserver: CapturedFrameObserver {
    private let captureQueue: DispatchQueue
    private let eventPublisher: (String) -> Void
    private let extractor: SceneVisualObservationExtractor
    private let policy: SceneDetectionPolicy
    private let sampleInterval: TimeInterval
    private let encoder = JSONEncoder()
    private var detector: BattleSceneDetector
    private var lastSampleTimestamp: TimeInterval?
    private var lastPublishedSnapshot: SceneDetectionSnapshot?
    private var revision: UInt64 = 0

    init(
        captureQueue: DispatchQueue,
        eventPublisher: @escaping (String) -> Void,
        sampleInterval: TimeInterval,
        policy: SceneDetectionPolicy
    ) throws {
        guard sampleInterval.isFinite, sampleInterval > 0 else {
            throw SceneMonitoringStreamError.invalidSampleInterval(sampleInterval)
        }
        self.captureQueue = captureQueue
        self.eventPublisher = eventPublisher
        self.extractor = try SceneVisualObservationExtractor.ipadBattleHUDV1()
        self.policy = policy
        self.sampleInterval = sampleInterval
        self.detector = try BattleSceneDetector(policy: policy)
    }

    func receive(pixelBuffer: CVPixelBuffer, sampleBuffer: CMSampleBuffer) -> Void {
        do {
            let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            let timestamp = CMTimeGetSeconds(presentationTime)
            guard timestamp.isFinite, timestamp >= 0 else {
                throw SceneMonitoringStreamError.invalidPresentationTimestamp(presentationTime)
            }
            if let lastSampleTimestamp {
                guard timestamp > lastSampleTimestamp else {
                    throw SceneMonitoringStreamError.nonMonotonicPresentationTimestamp(
                        previous: lastSampleTimestamp,
                        current: timestamp
                    )
                }
                if timestamp - lastSampleTimestamp + 0.000_000_001 < sampleInterval {
                    return
                }
            }
            lastSampleTimestamp = timestamp
            let observation = try extractor.extract(pixelBuffer: pixelBuffer, orientation: .up)
            let snapshot = detector.consume(observation)
            guard snapshot != lastPublishedSnapshot else {
                return
            }
            lastPublishedSnapshot = snapshot
            revision += 1
            eventPublisher(try encode(snapshot: snapshot))
        } catch {
            log("エラー: 画面状態の監視に失敗: \(error)")
            exit(1)
        }
    }

    func captureDidRestart() throws -> Void {
        try captureQueue.sync {
            detector = try BattleSceneDetector(policy: policy)
            lastSampleTimestamp = nil
            lastPublishedSnapshot = nil
        }
    }

    private func encode(snapshot: SceneDetectionSnapshot) throws -> String {
        let event = SceneStateEvent(
            type: "scene_state",
            revision: revision,
            scene: snapshot.scene.rawValue,
            candidate: snapshot.candidate.rawValue,
            stability: snapshot.stability.rawValue,
            playerHUD: describe(snapshot.observation.playerHUD),
            opponentHUD: describe(snapshot.observation.opponentHUD)
        )
        let data = try encoder.encode(event)
        guard let json = String(data: data, encoding: .utf8) else {
            throw SceneMonitoringStreamError.eventEncodingFailed
        }
        return json
    }

    private func describe(_ visibility: HUDVisibility) -> String {
        switch visibility {
        case .visible:
            return "visible"
        case .hidden:
            return "hidden"
        }
    }
}

final class NameAndSceneFrameObserver: CapturedFrameObserver {
    private let nameObserver: CapturedFrameObserver
    private let sceneObserver: CapturedFrameObserver

    init(
        nameObserver: CapturedFrameObserver,
        sceneObserver: CapturedFrameObserver
    ) {
        self.nameObserver = nameObserver
        self.sceneObserver = sceneObserver
    }

    func receive(pixelBuffer: CVPixelBuffer, sampleBuffer: CMSampleBuffer) -> Void {
        nameObserver.receive(pixelBuffer: pixelBuffer, sampleBuffer: sampleBuffer)
        sceneObserver.receive(pixelBuffer: pixelBuffer, sampleBuffer: sampleBuffer)
    }

    func captureDidRestart() throws -> Void {
        try nameObserver.captureDidRestart()
        try sceneObserver.captureDidRestart()
    }
}
