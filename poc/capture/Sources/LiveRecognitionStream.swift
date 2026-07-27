import CaptureRecognition
import CoreMedia
import CoreVideo
import Foundation
import ImageIO

protocol CapturedFrameObserver: AnyObject {
    func receive(pixelBuffer: CVPixelBuffer, sampleBuffer: CMSampleBuffer) -> Void
    func captureDidRestart() throws -> Void
}

final class IgnoringCapturedFrameObserver: CapturedFrameObserver {
    func receive(pixelBuffer: CVPixelBuffer, sampleBuffer: CMSampleBuffer) -> Void {}
    func captureDidRestart() throws -> Void {}
}

private struct DetectionStatusEvent: Encodable {
    let type: String
    let timestamp: String
    let side: String
    let status: String
}

private struct PokemonDetectedEvent: Encodable {
    let type: String
    let timestamp: String
    let side: String
    let pokemon: String
    let displayName: String
    let confidence: Float
    let source: String
}

private struct PokemonSwitchedEvent: Encodable {
    let type: String
    let timestamp: String
    let side: String
    let previousPokemon: String
    let pokemon: String
    let displayName: String
    let confidence: Float
    let source: String
}

private struct DetectionDiagnosticEvent: Encodable {
    let type: String
    let timestamp: String
    let side: String
    let generation: UInt64
    let detail: String
}

private struct RecognitionSampleDiagnosticEvent: Encodable {
    let type: String
    let timestamp: String
    let side: String
    let generation: UInt64
    let requestID: UInt64
    let detail: String
}

private struct RecognitionPipelineFailureEvent: Encodable {
    let type: String
    let timestamp: String
    let detail: String
}

private final class LiveRecognitionEventSink {
    private let encoder = JSONEncoder()
    private let formatter = ISO8601DateFormatter()
    private let eventPublisher: (String) -> Void

    init(eventPublisher: @escaping (String) -> Void) {
        self.eventPublisher = eventPublisher
    }

    func emit(output: LiveNameDetectionOutput) -> Void {
        switch output {
        case .requestRecognition:
            return
        case .confirmedSignatureRefreshRequested:
            return
        case let .statusChanged(status):
            emitStatus(status)
        case let .pokemonConfirmed(detection):
            emit(PokemonDetectedEvent(
                type: "pokemon_detected",
                timestamp: formatter.string(from: Date()),
                side: detection.side.rawValue,
                pokemon: detection.candidate.id,
                displayName: detection.candidate.displayName,
                confidence: detection.visionConfidence,
                source: "ocr"
            ))
        case let .pokemonSwitched(previous, current):
            emit(PokemonSwitchedEvent(
                type: "pokemon_switched_in",
                timestamp: formatter.string(from: Date()),
                side: current.side.rawValue,
                previousPokemon: previous.candidate.id,
                pokemon: current.candidate.id,
                displayName: current.candidate.displayName,
                confidence: current.visionConfidence,
                source: "ocr"
            ))
        case let .detectionFailed(side, generation):
            emit(DetectionDiagnosticEvent(
                type: "pokemon_detection_failed",
                timestamp: formatter.string(from: Date()),
                side: side.rawValue,
                generation: generation,
                detail: "three confirmation bursts were inconclusive"
            ))
        case let .probeRejected(side, generation, outcome):
            emit(DetectionDiagnosticEvent(
                type: "pokemon_probe_rejected",
                timestamp: formatter.string(from: Date()),
                side: side.rawValue,
                generation: generation,
                detail: describe(outcome)
            ))
        case let .staleRecognitionRejected(requestID, requestedGeneration, currentGeneration):
            emit(DetectionDiagnosticEvent(
                type: "stale_recognition_rejected",
                timestamp: formatter.string(from: Date()),
                side: "pipeline",
                generation: currentGeneration,
                detail: "request \(requestID) belongs to generation \(requestedGeneration)"
            ))
        }
    }

    func emitFailure(_ error: Error) -> Never {
        emit(RecognitionPipelineFailureEvent(
            type: "recognition_pipeline_failed",
            timestamp: formatter.string(from: Date()),
            detail: String(describing: error)
        ))
        exit(1)
    }

    func emitRecognitionSample(
        request: LiveNameRecognitionRequest,
        outcome: PokemonNameDetectionOutcome
    ) -> Void {
        emit(RecognitionSampleDiagnosticEvent(
            type: "pokemon_recognition_sample",
            timestamp: formatter.string(from: Date()),
            side: request.side.rawValue,
            generation: request.generation,
            requestID: request.requestID,
            detail: "\(describe(request.kind)): \(describe(outcome))"
        ))
    }

    private func emitStatus(_ status: LiveNameDetectionStatus) -> Void {
        let side: BattleSide
        let name: String
        switch status {
        case let .waitingForStableHUD(value, _):
            side = value
            name = "waiting_for_stable_hud"
        case let .transitioning(value, _):
            side = value
            name = "transitioning"
        case let .recognizing(value, _, _):
            side = value
            name = "recognizing"
        case let .stable(value, _):
            side = value
            name = "stable"
        case let .unconfirmed(value, _):
            side = value
            name = "unconfirmed"
        }
        emit(DetectionStatusEvent(
            type: "pokemon_detection_status",
            timestamp: formatter.string(from: Date()),
            side: side.rawValue,
            status: name
        ))
    }

    private func describe(_ outcome: PokemonNameDetectionOutcome) -> String {
        switch outcome {
        case let .detected(detection):
            return "candidate=\(detection.candidate.id) raw='\(detection.rawText)' confidence=\(detection.visionConfidence) editDistance=\(detection.editDistance)"
        case .noText:
            return "no text"
        case let .noMatch(_, rawText, recognizedTexts):
            let observations = recognizedTexts.map {
                "'\($0.text)'(\($0.confidence))"
            }.joined(separator: ", ")
            return "no catalog match for '\(rawText)'; observations=[\(observations)]"
        case let .ambiguous(_, rawText, candidates):
            return "ambiguous text '\(rawText)' for \(candidates.map(\.id))"
        }
    }

    private func describe(_ kind: LiveNameRecognitionKind) -> String {
        switch kind {
        case .probe:
            return "probe"
        case let .confirmation(attempt, sampleIndex):
            return "confirmation attempt=\(attempt) sample=\(sampleIndex + 1)"
        }
    }

    private func emit<Event: Encodable>(_ event: Event) -> Void {
        do {
            let data = try encoder.encode(event)
            guard let json = String(data: data, encoding: .utf8) else {
                throw RecognitionStreamError.eventEncodingFailed
            }
            print("EVENT_JSON \(json)")
            eventPublisher(json)
        } catch {
            log("構造化認識イベントのエンコードに失敗: \(error)")
            exit(1)
        }
    }
}

enum RecognitionStreamError: Error, CustomStringConvertible {
    case invalidPresentationTimestamp(CMTime)
    case nonMonotonicPresentationTimestamp(previous: TimeInterval, current: TimeInterval)
    case missingDetector(BattleSide)
    case missingRequestSignature(UInt64)
    case missingConfirmedSignature(side: BattleSide, generation: UInt64, candidateID: String)
    case eventEncodingFailed

    var description: String {
        switch self {
        case let .invalidPresentationTimestamp(timestamp):
            return "invalid capture presentation timestamp: \(timestamp)"
        case let .nonMonotonicPresentationTimestamp(previous, current):
            return "capture presentation timestamp moved backward from \(previous) to \(current)"
        case let .missingDetector(side):
            return "live detector is missing for side '\(side.rawValue)'"
        case let .missingRequestSignature(requestID):
            return "signature is missing for recognition request \(requestID)"
        case let .missingConfirmedSignature(side, generation, candidateID):
            return "confirmed signature is missing for \(side.rawValue) generation \(generation) candidate '\(candidateID)'"
        case .eventEncodingFailed:
            return "structured recognition event is not valid UTF-8"
        }
    }
}

final class LivePokemonNameDetector {
    private struct PendingRecognitionKey: Hashable {
        let side: BattleSide
        let requestID: UInt64
    }

    private struct ConfirmedSignatureKey: Hashable {
        let side: BattleSide
        let generation: UInt64
        let candidateID: String
    }

    private struct DetectedSignature {
        let signature: NameRegionSignature
        let confidence: Float
    }

    private let candidates: [PokemonNameCandidate]
    private let accurateRecognizer: PokemonNameRecognizer
    private let probeRecognizer: PokemonNameRecognizer
    private let sampleInterval: TimeInterval
    private let stateQueue: DispatchQueue
    private let recognitionQueue = DispatchQueue(label: "recognition.vision")
    private let eventSink: LiveRecognitionEventSink
    private var analyzer: LiveNameRegionAnalyzer
    private var detectors: [BattleSide: PokemonSwitchDetector]
    private var pendingSignatures: [PendingRecognitionKey: NameRegionSignature] = [:]
    private var detectedSignatures: [ConfirmedSignatureKey: DetectedSignature] = [:]
    private var lastAnalyzedTimestamp: TimeInterval?
    private var nextFrameID: UInt64 = 1
    private var isActive = true

    init(
        candidates: [PokemonNameCandidate],
        stateQueue: DispatchQueue,
        eventPublisher: @escaping (String) -> Void
    ) throws {
        let profile = try CaptureLayoutProfile.ipadBattleHUDV1()
        let policy = try ChampionsNameDetectionPolicy.make()
        let extractor = try NameRegionSignatureExtractor(
            profile: profile,
            columnCount: 32,
            rowCount: 12,
            brightLuminanceThreshold: 0.65,
            minimumBrightPixelFraction: 0.01,
            minimumLuminanceRange: 0.15
        )
        self.candidates = candidates
        self.stateQueue = stateQueue
        self.eventSink = LiveRecognitionEventSink(eventPublisher: eventPublisher)
        self.sampleInterval = policy.sampleInterval
        self.analyzer = LiveNameRegionAnalyzer(extractor: extractor)
        self.detectors = [
            .player: try PokemonSwitchDetector(side: .player, policy: policy),
            .opponent: try PokemonSwitchDetector(side: .opponent, policy: policy),
        ]
        self.accurateRecognizer = try PokemonNameRecognizer(
            regions: profile.nameRegions,
            recognitionLanguage: "ja-JP",
            maximumCandidateCount: 3,
            minimumTextHeight: 0.01,
            maximumEditDistance: 1,
            recognitionMode: .accurate
        )
        self.probeRecognizer = try PokemonNameRecognizer(
            regions: profile.nameRegions,
            recognitionLanguage: "ja-JP",
            maximumCandidateCount: 1,
            minimumTextHeight: 0.01,
            maximumEditDistance: 1,
            recognitionMode: .accurate
        )
    }

    func receive(pixelBuffer: CVPixelBuffer, sampleBuffer: CMSampleBuffer) -> Void {
        guard isActive else {
            return
        }
        do {
            let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            let timestamp = CMTimeGetSeconds(presentationTime)
            guard timestamp.isFinite, timestamp >= 0 else {
                throw RecognitionStreamError.invalidPresentationTimestamp(presentationTime)
            }
            if let lastAnalyzedTimestamp {
                guard timestamp > lastAnalyzedTimestamp else {
                    throw RecognitionStreamError.nonMonotonicPresentationTimestamp(
                        previous: lastAnalyzedTimestamp,
                        current: timestamp
                    )
                }
                if timestamp - lastAnalyzedTimestamp + 0.000_000_001 < sampleInterval {
                    return
                }
            }
            lastAnalyzedTimestamp = timestamp
            let frameID = nextFrameID
            nextFrameID += 1

            for side in [BattleSide.player, BattleSide.opponent] {
                let analysis = try analyzer.analyze(
                    pixelBuffer: pixelBuffer,
                    orientation: .up,
                    side: side,
                    frameID: frameID,
                    monotonicTimestamp: timestamp
                )
                guard var detector = detectors[side] else {
                    throw RecognitionStreamError.missingDetector(side)
                }
                let outputs = try detector.consume(frame: analysis.observation)
                detectors[side] = detector
                handleFrameOutputs(
                    outputs,
                    signature: analysis.signature,
                    pixelBuffer: pixelBuffer
                )
            }
        } catch {
            eventSink.emitFailure(error)
        }
    }

    func deactivate() -> Void {
        isActive = false
        pendingSignatures.removeAll()
        detectedSignatures.removeAll()
    }

    private func handleFrameOutputs(
        _ outputs: [LiveNameDetectionOutput],
        signature: NameRegionSignature,
        pixelBuffer: CVPixelBuffer
    ) -> Void {
        for output in outputs {
            if case let .requestRecognition(request) = output {
                pendingSignatures[PendingRecognitionKey(
                    side: request.side,
                    requestID: request.requestID
                )] = signature
                scheduleRecognition(request: request, pixelBuffer: pixelBuffer)
            } else {
                if case let .statusChanged(.waitingForStableHUD(side, nextGeneration)) = output {
                    clearDetectedSignatures(side: side, through: nextGeneration - 1)
                }
                eventSink.emit(output: output)
            }
        }
    }

    private func scheduleRecognition(
        request: LiveNameRecognitionRequest,
        pixelBuffer: CVPixelBuffer
    ) -> Void {
        let retainedPixelBuffer = pixelBuffer
        recognitionQueue.async { [self] in
            do {
                let recognizer: PokemonNameRecognizer
                switch request.kind {
                case .probe:
                    recognizer = probeRecognizer
                case .confirmation:
                    recognizer = accurateRecognizer
                }
                let outcome = try recognizer.recognize(
                    pixelBuffer: retainedPixelBuffer,
                    orientation: .up,
                    side: request.side,
                    candidates: candidates
                )
                stateQueue.async { [self] in
                    receiveRecognition(request: request, outcome: outcome)
                }
            } catch {
                stateQueue.async { [self] in
                    eventSink.emitFailure(error)
                }
            }
        }
    }

    private func receiveRecognition(
        request: LiveNameRecognitionRequest,
        outcome: PokemonNameDetectionOutcome
    ) -> Void {
        guard isActive else {
            return
        }
        do {
            let key = PendingRecognitionKey(side: request.side, requestID: request.requestID)
            guard let signature = pendingSignatures.removeValue(forKey: key) else {
                throw RecognitionStreamError.missingRequestSignature(request.requestID)
            }
            guard var detector = detectors[request.side] else {
                throw RecognitionStreamError.missingDetector(request.side)
            }
            eventSink.emitRecognitionSample(request: request, outcome: outcome)
            let outputs = try detector.consume(recognition: PokemonRecognitionSample(
                side: request.side,
                requestID: request.requestID,
                generation: request.generation,
                frameID: request.frameID,
                outcome: outcome
            ))
            detectors[request.side] = detector
            let staleResult = outputs.contains { output in
                if case .staleRecognitionRejected = output { return true }
                return false
            }
            if !staleResult, case let .detected(detection) = outcome {
                recordDetectedSignature(
                    signature,
                    detection: detection,
                    generation: request.generation
                )
            }
            for output in outputs {
                if case let .confirmedSignatureRefreshRequested(detection) = output {
                    analyzer.confirm(signature: signature, side: detection.side)
                    clearDetectedSignatures(side: detection.side, through: request.generation)
                } else if case let .statusChanged(.stable(side, detection)) = output {
                    let confirmedSignature = try signatureForConfirmedDetection(
                        detection,
                        generation: request.generation
                    )
                    analyzer.confirm(signature: confirmedSignature, side: side)
                    clearDetectedSignatures(side: side, through: request.generation)
                } else if case let .statusChanged(.transitioning(side, _)) = output {
                    clearDetectedSignatures(side: side, through: request.generation)
                } else if case let .statusChanged(.waitingForStableHUD(side, _)) = output {
                    clearDetectedSignatures(side: side, through: request.generation)
                }
                eventSink.emit(output: output)
            }
        } catch {
            eventSink.emitFailure(error)
        }
    }

    private func recordDetectedSignature(
        _ signature: NameRegionSignature,
        detection: PokemonNameDetection,
        generation: UInt64
    ) -> Void {
        let key = ConfirmedSignatureKey(
            side: detection.side,
            generation: generation,
            candidateID: detection.candidate.id
        )
        if let existing = detectedSignatures[key],
           existing.confidence >= detection.visionConfidence {
            return
        }
        detectedSignatures[key] = DetectedSignature(
            signature: signature,
            confidence: detection.visionConfidence
        )
    }

    private func signatureForConfirmedDetection(
        _ detection: PokemonNameDetection,
        generation: UInt64
    ) throws -> NameRegionSignature {
        let key = ConfirmedSignatureKey(
            side: detection.side,
            generation: generation,
            candidateID: detection.candidate.id
        )
        guard let detectedSignature = detectedSignatures[key] else {
            throw RecognitionStreamError.missingConfirmedSignature(
                side: detection.side,
                generation: generation,
                candidateID: detection.candidate.id
            )
        }
        return detectedSignature.signature
    }

    private func clearDetectedSignatures(side: BattleSide, through generation: UInt64) -> Void {
        detectedSignatures = detectedSignatures.filter { key, _ in
            key.side != side || key.generation > generation
        }
    }
}

final class UserTriggeredPokemonNameObserver: CapturedFrameObserver, PokemonDetectionControlling {
    private let candidates: [PokemonNameCandidate]
    private let captureQueue: DispatchQueue
    private let eventPublisher: (String) -> Void
    private var detector: LivePokemonNameDetector?

    init(
        candidates: [PokemonNameCandidate],
        captureQueue: DispatchQueue,
        eventPublisher: @escaping (String) -> Void
    ) {
        self.candidates = candidates
        self.captureQueue = captureQueue
        self.eventPublisher = eventPublisher
        self.detector = nil
    }

    func receive(pixelBuffer: CVPixelBuffer, sampleBuffer: CMSampleBuffer) -> Void {
        detector?.receive(pixelBuffer: pixelBuffer, sampleBuffer: sampleBuffer)
    }

    func captureDidRestart() throws -> Void {
        try captureQueue.sync {
            guard detector != nil else {
                return
            }
            detector?.deactivate()
            detector = try LivePokemonNameDetector(
                candidates: candidates,
                stateQueue: captureQueue,
                eventPublisher: eventPublisher
            )
        }
    }

    func startDetection() throws -> Void {
        try captureQueue.sync {
            guard detector == nil else {
                throw PokemonDetectionControlError.detectionAlreadyRunning
            }
            detector = try LivePokemonNameDetector(
                candidates: candidates,
                stateQueue: captureQueue,
                eventPublisher: eventPublisher
            )
        }
    }

    func stopDetection() throws -> Void {
        captureQueue.sync {
            detector?.deactivate()
            detector = nil
        }
    }
}
