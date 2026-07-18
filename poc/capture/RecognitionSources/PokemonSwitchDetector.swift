import Foundation

public struct PokemonSwitchDetector: Sendable {
    private enum Phase: Sendable {
        case waitingForStable(
            previous: PokemonNameDetection?,
            stableCount: Int,
            attempt: Int,
            earliestRecognitionAt: TimeInterval
        )
        case confirming(
            previous: PokemonNameDetection?,
            outcomes: [PokemonNameDetectionOutcome],
            attempt: Int,
            nextRecognitionAt: TimeInterval
        )
        case stable(
            PokemonNameDetection,
            changeWindow: [Bool],
            lastProbeAt: TimeInterval,
            stableChangedCount: Int
        )
        case probing(
            PokemonNameDetection,
            changeWindow: [Bool],
            requestedAt: TimeInterval,
            stableChangedCount: Int
        )
    }

    private let side: BattleSide
    private let policy: LiveNameDetectionPolicy
    private let consensus: PokemonNameRecognitionConsensus
    private var phase: Phase
    private var generation: UInt64 = 1
    private var nextRequestID: UInt64 = 1
    private var pendingRequest: LiveNameRecognitionRequest?
    private var previousFrameID: UInt64?
    private var previousTimestamp: TimeInterval?
    private var lastProcessedTimestamp: TimeInterval?

    public init(side: BattleSide, policy: LiveNameDetectionPolicy) throws {
        self.side = side
        self.policy = policy
        self.consensus = PokemonNameRecognitionConsensus(policy: policy.consensus)
        self.phase = .waitingForStable(
            previous: nil,
            stableCount: 0,
            attempt: 1,
            earliestRecognitionAt: 0
        )
    }

    public mutating func consume(
        frame: NameRegionFrameObservation
    ) throws -> [LiveNameDetectionOutput] {
        try validate(frame: frame)
        previousFrameID = frame.frameID
        previousTimestamp = frame.monotonicTimestamp

        if let lastProcessedTimestamp,
           frame.monotonicTimestamp - lastProcessedTimestamp + 0.000_000_001 < policy.sampleInterval {
            return []
        }
        self.lastProcessedTimestamp = frame.monotonicTimestamp

        switch phase {
        case let .waitingForStable(previous, stableCount, attempt, earliestRecognitionAt):
            return try consumeWaitingFrame(
                frame,
                previous: previous,
                stableCount: stableCount,
                attempt: attempt,
                earliestRecognitionAt: earliestRecognitionAt
            )
        case let .confirming(previous, outcomes, attempt, nextRecognitionAt):
            return consumeConfirmingFrame(
                frame,
                previous: previous,
                outcomes: outcomes,
                attempt: attempt,
                nextRecognitionAt: nextRecognitionAt
            )
        case let .stable(current, changeWindow, lastProbeAt, stableChangedCount):
            return try consumeStableFrame(
                frame,
                current: current,
                changeWindow: changeWindow,
                lastProbeAt: lastProbeAt,
                stableChangedCount: stableChangedCount
            )
        case let .probing(current, changeWindow, requestedAt, stableChangedCount):
            return try consumeProbingFrame(
                frame,
                current: current,
                changeWindow: changeWindow,
                requestedAt: requestedAt,
                stableChangedCount: stableChangedCount
            )
        }
    }

    public mutating func consume(
        recognition: PokemonRecognitionSample
    ) throws -> [LiveNameDetectionOutput] {
        if recognition.generation < generation {
            return [.staleRecognitionRejected(
                requestID: recognition.requestID,
                requestedGeneration: recognition.generation,
                currentGeneration: generation
            )]
        }
        guard recognition.generation == generation else {
            throw LiveNameDetectionError.futureRecognitionGeneration(
                requested: recognition.generation,
                current: generation
            )
        }
        guard recognition.side == side else {
            throw LiveNameDetectionError.recognitionSideMismatch(expected: side, actual: recognition.side)
        }
        guard let request = pendingRequest, request.requestID == recognition.requestID else {
            throw LiveNameDetectionError.unexpectedRecognitionResult(recognition.requestID)
        }
        guard request.frameID == recognition.frameID else {
            throw LiveNameDetectionError.recognitionFrameMismatch(
                expected: request.frameID,
                actual: recognition.frameID
            )
        }
        if case let .detected(detection) = recognition.outcome,
           detection.side != side {
            throw LiveNameDetectionError.recognitionSideMismatch(expected: side, actual: detection.side)
        }
        pendingRequest = nil

        switch request.kind {
        case .probe:
            return consumeProbeResult(recognition.outcome)
        case .confirmation:
            return try consumeConfirmationResult(recognition.outcome)
        }
    }

    private mutating func consumeWaitingFrame(
        _ frame: NameRegionFrameObservation,
        previous: PokemonNameDetection?,
        stableCount: Int,
        attempt: Int,
        earliestRecognitionAt: TimeInterval
    ) throws -> [LiveNameDetectionOutput] {
        guard frame.hudVisibility == .visible else {
            phase = .waitingForStable(
                previous: previous,
                stableCount: 0,
                attempt: attempt,
                earliestRecognitionAt: earliestRecognitionAt
            )
            return []
        }
        let nextStableCount = frame.differenceFromPrevious <= policy.stableDifferenceThreshold
            ? stableCount + 1
            : 0
        guard nextStableCount >= policy.stableSampleCount,
              frame.monotonicTimestamp >= earliestRecognitionAt else {
            phase = .waitingForStable(
                previous: previous,
                stableCount: nextStableCount,
                attempt: attempt,
                earliestRecognitionAt: earliestRecognitionAt
            )
            return []
        }

        phase = .confirming(
            previous: previous,
            outcomes: [],
            attempt: attempt,
            nextRecognitionAt: frame.monotonicTimestamp
        )
        let request = makeRequest(
            frameID: frame.frameID,
            kind: .confirmation(attempt: attempt, sampleIndex: 0)
        )
        return [
            .statusChanged(.recognizing(side, generation, attempt)),
            .requestRecognition(request),
        ]
    }

    private mutating func consumeConfirmingFrame(
        _ frame: NameRegionFrameObservation,
        previous: PokemonNameDetection?,
        outcomes: [PokemonNameDetectionOutcome],
        attempt: Int,
        nextRecognitionAt: TimeInterval
    ) -> [LiveNameDetectionOutput] {
        guard frame.hudVisibility == .visible,
              frame.differenceFromPrevious <= policy.changeDifferenceThreshold else {
            generation += 1
            pendingRequest = nil
            phase = .waitingForStable(
                previous: previous,
                stableCount: 0,
                attempt: 1,
                earliestRecognitionAt: frame.monotonicTimestamp
            )
            return [.statusChanged(.waitingForStableHUD(side, generation))]
        }
        guard pendingRequest == nil,
              frame.monotonicTimestamp + 0.000_000_001 >= nextRecognitionAt else {
            return []
        }
        let request = makeRequest(
            frameID: frame.frameID,
            kind: .confirmation(attempt: attempt, sampleIndex: outcomes.count)
        )
        return [.requestRecognition(request)]
    }

    private mutating func consumeStableFrame(
        _ frame: NameRegionFrameObservation,
        current: PokemonNameDetection,
        changeWindow: [Bool],
        lastProbeAt: TimeInterval,
        stableChangedCount: Int
    ) throws -> [LiveNameDetectionOutput] {
        let changed = try isChanged(frame)
        let nextWindow = append(changed, to: changeWindow)
        let nextStableChangedCount = stableChangedCountAfter(
            frame: frame,
            changed: changed,
            currentCount: stableChangedCount
        )
        if nextWindow.filter({ $0 }).count >= policy.changedSampleCount,
           nextStableChangedCount >= policy.stableSampleCount {
            generation += 1
            phase = .waitingForStable(
                previous: current,
                stableCount: 0,
                attempt: 1,
                earliestRecognitionAt: frame.monotonicTimestamp
            )
            return [.statusChanged(.transitioning(side, current))]
        }
        if frame.monotonicTimestamp - lastProbeAt >= policy.heartbeatInterval {
            let request = makeRequest(frameID: frame.frameID, kind: .probe)
            phase = .probing(
                current,
                changeWindow: nextWindow,
                requestedAt: frame.monotonicTimestamp,
                stableChangedCount: nextStableChangedCount
            )
            return [.requestRecognition(request)]
        }
        phase = .stable(
            current,
            changeWindow: nextWindow,
            lastProbeAt: lastProbeAt,
            stableChangedCount: nextStableChangedCount
        )
        return []
    }

    private mutating func consumeProbingFrame(
        _ frame: NameRegionFrameObservation,
        current: PokemonNameDetection,
        changeWindow: [Bool],
        requestedAt: TimeInterval,
        stableChangedCount: Int
    ) throws -> [LiveNameDetectionOutput] {
        let changed = try isChanged(frame)
        let nextWindow = append(changed, to: changeWindow)
        let nextStableChangedCount = stableChangedCountAfter(
            frame: frame,
            changed: changed,
            currentCount: stableChangedCount
        )
        guard nextWindow.filter({ $0 }).count < policy.changedSampleCount
                || nextStableChangedCount < policy.stableSampleCount else {
            generation += 1
            pendingRequest = nil
            phase = .waitingForStable(
                previous: current,
                stableCount: 0,
                attempt: 1,
                earliestRecognitionAt: frame.monotonicTimestamp
            )
            return [.statusChanged(.transitioning(side, current))]
        }
        phase = .probing(
            current,
            changeWindow: nextWindow,
            requestedAt: requestedAt,
            stableChangedCount: nextStableChangedCount
        )
        return []
    }

    private mutating func consumeProbeResult(
        _ outcome: PokemonNameDetectionOutcome
    ) -> [LiveNameDetectionOutput] {
        guard case let .probing(current, changeWindow, requestedAt, stableChangedCount) = phase else {
            return [.probeRejected(side, generation, outcome)]
        }
        guard case let .detected(detection) = outcome else {
            phase = .stable(
                current,
                changeWindow: changeWindow,
                lastProbeAt: requestedAt,
                stableChangedCount: stableChangedCount
            )
            return [.probeRejected(side, generation, outcome)]
        }
        guard detection.editDistance == 0,
              detection.visionConfidence >= policy.consensus.exactMatchMinimumMedianConfidence else {
            phase = .stable(
                current,
                changeWindow: changeWindow,
                lastProbeAt: requestedAt,
                stableChangedCount: stableChangedCount
            )
            return [.probeRejected(side, generation, outcome)]
        }
        guard detection.candidate.id != current.candidate.id else {
            phase = .stable(
                current,
                changeWindow: [],
                lastProbeAt: requestedAt,
                stableChangedCount: 0
            )
            return []
        }
        generation += 1
        phase = .waitingForStable(
            previous: current,
            stableCount: 0,
            attempt: 1,
            earliestRecognitionAt: requestedAt
        )
        return [.statusChanged(.transitioning(side, current))]
    }

    private mutating func consumeConfirmationResult(
        _ outcome: PokemonNameDetectionOutcome
    ) throws -> [LiveNameDetectionOutput] {
        guard case let .confirming(previous, outcomes, attempt, _) = phase else {
            return [.probeRejected(side, generation, outcome)]
        }
        let nextOutcomes = outcomes + [outcome]
        guard nextOutcomes.count == policy.recognitionSampleCount else {
            guard let baseTimestamp = lastProcessedTimestamp else {
                throw LiveNameDetectionError.missingProcessedFrameTimestamp
            }
            phase = .confirming(
                previous: previous,
                outcomes: nextOutcomes,
                attempt: attempt,
                nextRecognitionAt: baseTimestamp + policy.recognitionSampleInterval
            )
            return []
        }

        switch consensus.resolve(nextOutcomes) {
        case let .confirmed(detection):
            guard let confirmedAt = lastProcessedTimestamp else {
                throw LiveNameDetectionError.missingProcessedFrameTimestamp
            }
            phase = .stable(
                detection,
                changeWindow: [],
                lastProbeAt: confirmedAt,
                stableChangedCount: 0
            )
            var outputs: [LiveNameDetectionOutput] = []
            if let previous {
                if previous.candidate.id != detection.candidate.id {
                    outputs.append(.pokemonSwitched(previous: previous, current: detection))
                }
            } else {
                outputs.append(.pokemonConfirmed(detection))
            }
            outputs.append(.statusChanged(.stable(side, detection)))
            return outputs
        case .unconfirmed:
            guard let failedAt = lastProcessedTimestamp else {
                throw LiveNameDetectionError.missingProcessedFrameTimestamp
            }
            if attempt < policy.maximumBurstAttempts {
                phase = .waitingForStable(
                    previous: previous,
                    stableCount: 0,
                    attempt: attempt + 1,
                    earliestRecognitionAt: failedAt + policy.retryInterval
                )
                return [.statusChanged(.waitingForStableHUD(side, generation))]
            }
            phase = .waitingForStable(
                previous: previous,
                stableCount: 0,
                attempt: 1,
                earliestRecognitionAt: failedAt + policy.heartbeatInterval
            )
            return [
                .detectionFailed(side, generation),
                .statusChanged(.unconfirmed(side, generation)),
            ]
        }
    }

    private mutating func makeRequest(
        frameID: UInt64,
        kind: LiveNameRecognitionKind
    ) -> LiveNameRecognitionRequest {
        let request = LiveNameRecognitionRequest(
            side: side,
            requestID: nextRequestID,
            generation: generation,
            frameID: frameID,
            kind: kind
        )
        nextRequestID += 1
        pendingRequest = request
        return request
    }

    private func append(_ value: Bool, to window: [Bool]) -> [Bool] {
        Array((window + [value]).suffix(policy.changeWindowSize))
    }

    private func isChanged(_ frame: NameRegionFrameObservation) throws -> Bool {
        guard frame.hudVisibility == .visible else { return false }
        guard case let .score(score) = frame.differenceFromConfirmed else {
            throw LiveNameDetectionError.invalidPolicyRelation(
                "differenceFromConfirmed is required while a Pokémon is stable"
            )
        }
        return score >= policy.changeDifferenceThreshold
    }

    private func stableChangedCountAfter(
        frame: NameRegionFrameObservation,
        changed: Bool,
        currentCount: Int
    ) -> Int {
        guard frame.hudVisibility == .visible,
              changed,
              frame.differenceFromPrevious <= policy.stableDifferenceThreshold else {
            return 0
        }
        return currentCount + 1
    }

    private func validate(frame: NameRegionFrameObservation) throws -> Void {
        guard frame.monotonicTimestamp.isFinite, frame.monotonicTimestamp >= 0 else {
            throw LiveNameDetectionError.invalidInterval(
                "monotonicTimestamp",
                frame.monotonicTimestamp
            )
        }
        try validateObservationScore(frame.differenceFromPrevious, name: "differenceFromPrevious")
        if case let .score(score) = frame.differenceFromConfirmed {
            try validateObservationScore(score, name: "differenceFromConfirmed")
        }
        if let previousFrameID, frame.frameID <= previousFrameID {
            throw LiveNameDetectionError.nonMonotonicFrameID(
                previous: previousFrameID,
                current: frame.frameID
            )
        }
        if let previousTimestamp, frame.monotonicTimestamp <= previousTimestamp {
            throw LiveNameDetectionError.nonMonotonicTimestamp(
                previous: previousTimestamp,
                current: frame.monotonicTimestamp
            )
        }
    }

    private func validateObservationScore(_ value: Float, name: String) throws -> Void {
        guard value.isFinite, value >= 0, value <= 1 else {
            throw LiveNameDetectionError.invalidObservationScore(name, value)
        }
    }
}
