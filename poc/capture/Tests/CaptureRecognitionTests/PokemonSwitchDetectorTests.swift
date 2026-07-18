import Foundation
import Testing
@testable import CaptureRecognition

@Suite
struct PokemonSwitchDetectorTests {
    @Test
    func confirmsInitialPokemonFromFiveDistinctStableFrames() throws -> Void {
        var detector = try makeDetector()
        let pokemon = detection(id: "Meowscarada", name: "マスカーニャ", distance: 0, confidence: 0.9)
        let outcomes: [PokemonNameDetectionOutcome] = [
            .detected(pokemon), .detected(pokemon), .noText(.player),
            .detected(pokemon), .noMatch(.player, "", []),
        ]

        let result = try completeInitialBurst(detector: &detector, outcomes: outcomes)

        #expect(result.contains(.pokemonConfirmed(pokemon)))
        #expect(result.contains(.statusChanged(.stable(.player, pokemon))))
    }

    @Test
    func ignoresTwoTransientChangedFramesDuringAttackAnimation() throws -> Void {
        var detector = try makeDetector()
        let current = detection(id: "Meowscarada", name: "マスカーニャ", distance: 0, confidence: 0.9)
        _ = try completeInitialBurst(detector: &detector, outcomes: Array(repeating: .detected(current), count: 5))

        var outputs: [LiveNameDetectionOutput] = []
        outputs += try detector.consume(frame: frame(9, 0.9, previous: 0.3, confirmed: .score(0.4)))
        outputs += try detector.consume(frame: frame(10, 1.0, previous: 0.3, confirmed: .score(0.4)))
        outputs += try detector.consume(frame: frame(11, 1.1, previous: 0.01, confirmed: .score(0.01)))
        outputs += try detector.consume(frame: frame(12, 1.2, previous: 0.01, confirmed: .score(0.01)))
        outputs += try detector.consume(frame: frame(13, 1.3, previous: 0.01, confirmed: .score(0.01)))

        #expect(!outputs.contains { if case .statusChanged(.transitioning) = $0 { return true }; return false })
        #expect(!outputs.contains { if case .pokemonSwitched = $0 { return true }; return false })
    }

    @Test
    func ignoresHiddenHUDDuringAttackAnimation() throws -> Void {
        var detector = try makeDetector()
        let current = detection(id: "Meowscarada", name: "マスカーニャ", distance: 0, confidence: 0.9)
        _ = try completeInitialBurst(detector: &detector, outcomes: Array(repeating: .detected(current), count: 5))

        var outputs: [LiveNameDetectionOutput] = []
        outputs += try detector.consume(frame: hiddenFrame(9, 0.9))
        outputs += try detector.consume(frame: hiddenFrame(10, 1.0))
        outputs += try detector.consume(frame: hiddenFrame(11, 1.1))
        outputs += try detector.consume(frame: hiddenFrame(12, 1.2))
        outputs += try detector.consume(frame: hiddenFrame(13, 1.3))
        outputs += try detector.consume(frame: frame(14, 1.4, previous: 0.01, confirmed: .score(0.01)))
        outputs += try detector.consume(frame: frame(15, 1.5, previous: 0.01, confirmed: .score(0.01)))
        outputs += try detector.consume(frame: frame(16, 1.6, previous: 0.01, confirmed: .score(0.01)))

        #expect(!outputs.contains { if case .statusChanged(.transitioning) = $0 { return true }; return false })
        #expect(!outputs.contains { if case .requestRecognition = $0 { return true }; return false })
    }

    @Test
    func waitsForStableHudThenConfirmsSwitch() throws -> Void {
        var detector = try makeDetector()
        let first = detection(id: "Meowscarada", name: "マスカーニャ", distance: 0, confidence: 0.9)
        let second = detection(id: "Gyarados", name: "ギャラドス", distance: 0, confidence: 0.88)
        _ = try completeInitialBurst(detector: &detector, outcomes: Array(repeating: .detected(first), count: 5))

        var changed: [LiveNameDetectionOutput] = []
        changed += try detector.consume(frame: frame(9, 0.9, previous: 0.4, confirmed: .score(0.4)))
        changed += try detector.consume(frame: frame(10, 1.0, previous: 0.4, confirmed: .score(0.4)))
        changed += try detector.consume(frame: frame(11, 1.1, previous: 0.4, confirmed: .score(0.4)))
        #expect(!changed.contains(.statusChanged(.transitioning(.player, first))))
        changed += try detector.consume(frame: frame(12, 1.2, previous: 0.01, confirmed: .score(0.4)))
        changed += try detector.consume(frame: frame(13, 1.3, previous: 0.01, confirmed: .score(0.4)))
        changed += try detector.consume(frame: frame(14, 1.4, previous: 0.01, confirmed: .score(0.4)))
        #expect(changed.contains(.statusChanged(.transitioning(.player, first))))

        #expect(try detector.consume(frame: hiddenFrame(15, 1.5)).isEmpty)
        #expect(try detector.consume(frame: frame(16, 1.6, previous: 0.3, confirmed: .score(0.5))).isEmpty)
        #expect(try detector.consume(frame: frame(17, 1.7, previous: 0.01, confirmed: .score(0.5))).isEmpty)
        #expect(try detector.consume(frame: frame(18, 1.8, previous: 0.01, confirmed: .score(0.5))).isEmpty)
        var request = try confirmationRequest(from: detector.consume(frame: frame(19, 1.9, previous: 0.01, confirmed: .score(0.5))))

        var outputs: [LiveNameDetectionOutput] = []
        for index in 0..<5 {
            outputs += try detector.consume(recognition: recognition(request: request, outcome: .detected(second)))
            if index < 4 {
                request = try confirmationRequest(from: detector.consume(frame: frame(
                    UInt64(20 + index), 2.0 + Double(index) * 0.1,
                    previous: 0.01, confirmed: .score(0.5)
                )))
            }
        }

        #expect(outputs.contains(.pokemonSwitched(previous: first, current: second)))
    }

    @Test
    func requiresFourVotesAndConfidenceForOneEditCorrection() throws -> Void {
        let consensus = PokemonNameRecognitionConsensus(policy: try makeConsensusPolicy())
        let corrected = detection(id: "Garchomp", name: "ガブリアス", distance: 1, confidence: 0.8)
        let lowConfidence = detection(id: "Garchomp", name: "ガブリアス", distance: 1, confidence: 0.6)

        #expect(consensus.resolve([
            .detected(corrected), .detected(corrected), .detected(corrected),
            .noText(.player), .noText(.player),
        ]) == .unconfirmed)
        #expect(consensus.resolve([
            .detected(lowConfidence), .detected(lowConfidence), .detected(lowConfidence),
            .detected(lowConfidence), .noText(.player),
        ]) == .unconfirmed)

        let accepted = consensus.resolve([
            .detected(corrected), .detected(corrected), .detected(corrected),
            .detected(corrected), .noText(.player),
        ])
        guard case let .confirmed(result) = accepted else {
            Issue.record("Expected corrected consensus to be confirmed")
            return
        }
        #expect(result.candidate.id == "Garchomp")
        #expect(result.editDistance == 1)
    }

    @Test
    func heartbeatProbeCannotSwitchPokemonFromOneResult() throws -> Void {
        var detector = try makeDetector()
        let first = detection(id: "Meowscarada", name: "マスカーニャ", distance: 0, confidence: 0.9)
        let candidate = detection(id: "Gyarados", name: "ギャラドス", distance: 0, confidence: 0.9)
        _ = try completeInitialBurst(detector: &detector, outcomes: Array(repeating: .detected(first), count: 5))

        let request = try probeRequest(from: detector.consume(frame: frame(40, 4.0, previous: 0.01, confirmed: .score(0.01))))
        let result = try detector.consume(recognition: recognition(request: request, outcome: .detected(candidate)))

        #expect(result.contains(.statusChanged(.transitioning(.player, first))))
        #expect(!result.contains { if case .pokemonSwitched = $0 { return true }; return false })
    }

    @Test
    func rejectsLateRecognitionFromInvalidatedGenerationExplicitly() throws -> Void {
        var detector = try makeDetector()
        _ = try detector.consume(frame: frame(1, 0.0, previous: 0.01, confirmed: .unavailable))
        _ = try detector.consume(frame: frame(2, 0.1, previous: 0.01, confirmed: .unavailable))
        let request = try confirmationRequest(from: detector.consume(frame: frame(3, 0.2, previous: 0.01, confirmed: .unavailable)))

        let invalidation = try detector.consume(frame: hiddenFrame(4, 0.3))
        #expect(invalidation.contains(.statusChanged(.waitingForStableHUD(.player, request.generation + 1))))
        let stale = try detector.consume(recognition: recognition(
            request: request,
            outcome: .detected(detection(id: "Gyarados", name: "ギャラドス", distance: 0, confidence: 0.9))
        ))
        #expect(stale == [.staleRecognitionRejected(
            requestID: request.requestID,
            requestedGeneration: request.generation,
            currentGeneration: request.generation + 1
        )])
    }

    @Test
    func rejectsInvalidPolicyAndNonMonotonicFrames() throws -> Void {
        do {
            _ = try LiveNameDetectionPolicy(
                sampleInterval: 0.0,
                changeDifferenceThreshold: 0.2,
                stableDifferenceThreshold: 0.05,
                changedSampleCount: 3,
                changeWindowSize: 5,
                stableSampleCount: 3,
                heartbeatInterval: 3.0,
                recognitionSampleInterval: 0.1,
                recognitionSampleCount: 5,
                maximumBurstAttempts: 3,
                retryInterval: 0.2,
                consensus: try makeConsensusPolicy()
            )
            Issue.record("Expected invalid policy to throw")
        } catch {
            #expect(error as? LiveNameDetectionError == .invalidInterval("sampleInterval", 0.0))
        }

        var detector = try makeDetector()
        _ = try detector.consume(frame: frame(2, 0.2, previous: 0.01, confirmed: .unavailable))
        do {
            _ = try detector.consume(frame: frame(1, 0.3, previous: 0.01, confirmed: .unavailable))
            Issue.record("Expected non-monotonic frame to throw")
        } catch {
            #expect(error as? LiveNameDetectionError == .nonMonotonicFrameID(previous: 2, current: 1))
        }
    }

    private func completeInitialBurst(
        detector: inout PokemonSwitchDetector,
        outcomes: [PokemonNameDetectionOutcome]
    ) throws -> [LiveNameDetectionOutput] {
        _ = try detector.consume(frame: frame(1, 0.0, previous: 0.01, confirmed: .unavailable))
        _ = try detector.consume(frame: frame(2, 0.1, previous: 0.01, confirmed: .unavailable))
        var request = try confirmationRequest(from: detector.consume(frame: frame(3, 0.2, previous: 0.01, confirmed: .unavailable)))
        var result: [LiveNameDetectionOutput] = []
        for (index, outcome) in outcomes.enumerated() {
            result += try detector.consume(recognition: recognition(request: request, outcome: outcome))
            if index < outcomes.count - 1 {
                request = try confirmationRequest(from: detector.consume(frame: frame(
                    UInt64(4 + index), 0.3 + Double(index) * 0.1,
                    previous: 0.01, confirmed: .unavailable
                )))
            }
        }
        return result
    }

    private func makeDetector() throws -> PokemonSwitchDetector {
        try PokemonSwitchDetector(side: .player, policy: makePolicy())
    }

    private func makePolicy() throws -> LiveNameDetectionPolicy {
        try LiveNameDetectionPolicy(
            sampleInterval: 0.1,
            changeDifferenceThreshold: 0.2,
            stableDifferenceThreshold: 0.05,
            changedSampleCount: 3,
            changeWindowSize: 5,
            stableSampleCount: 3,
            heartbeatInterval: 3.0,
            recognitionSampleInterval: 0.1,
            recognitionSampleCount: 5,
            maximumBurstAttempts: 3,
            retryInterval: 0.2,
            consensus: try makeConsensusPolicy()
        )
    }

    private func makeConsensusPolicy() throws -> PokemonNameConsensusPolicy {
        try PokemonNameConsensusPolicy(
            exactMatchMinimumCount: 3,
            exactMatchMinimumMedianConfidence: 0.5,
            correctedMatchMinimumCount: 4,
            correctedMatchMinimumMedianConfidence: 0.7
        )
    }

    private func detection(id: String, name: String, distance: Int, confidence: Float) -> PokemonNameDetection {
        PokemonNameDetection(
            side: .player,
            candidate: PokemonNameCandidate(id: id, displayName: name),
            rawText: name,
            visionConfidence: confidence,
            editDistance: distance
        )
    }

    private func frame(
        _ frameID: UInt64,
        _ timestamp: TimeInterval,
        previous: Float,
        confirmed: ConfirmedRegionDifference
    ) -> NameRegionFrameObservation {
        NameRegionFrameObservation(
            frameID: frameID,
            monotonicTimestamp: timestamp,
            hudVisibility: .visible,
            differenceFromPrevious: previous,
            differenceFromConfirmed: confirmed
        )
    }

    private func hiddenFrame(_ frameID: UInt64, _ timestamp: TimeInterval) -> NameRegionFrameObservation {
        NameRegionFrameObservation(
            frameID: frameID,
            monotonicTimestamp: timestamp,
            hudVisibility: .hidden,
            differenceFromPrevious: 1.0,
            differenceFromConfirmed: .unavailable
        )
    }

    private func confirmationRequest(from outputs: [LiveNameDetectionOutput]) throws -> LiveNameRecognitionRequest {
        for output in outputs {
            if case let .requestRecognition(request) = output,
               case .confirmation = request.kind {
                return request
            }
        }
        throw TestSupportError.missingConfirmationRequest
    }

    private func probeRequest(from outputs: [LiveNameDetectionOutput]) throws -> LiveNameRecognitionRequest {
        for output in outputs {
            if case let .requestRecognition(request) = output, request.kind == .probe {
                return request
            }
        }
        throw TestSupportError.missingProbeRequest
    }

    private func recognition(
        request: LiveNameRecognitionRequest,
        outcome: PokemonNameDetectionOutcome
    ) -> PokemonRecognitionSample {
        PokemonRecognitionSample(
            side: request.side,
            requestID: request.requestID,
            generation: request.generation,
            frameID: request.frameID,
            outcome: outcome
        )
    }
}

private enum TestSupportError: Error {
    case missingConfirmationRequest
    case missingProbeRequest
}
