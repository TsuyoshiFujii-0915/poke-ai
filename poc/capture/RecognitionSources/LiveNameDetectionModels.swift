import Foundation

public enum LiveNameDetectionError: Error, Equatable {
    case invalidInterval(String, TimeInterval)
    case invalidScore(String, Float)
    case invalidCount(String, Int)
    case invalidPolicyRelation(String)
    case invalidObservationScore(String, Float)
    case nonMonotonicFrameID(previous: UInt64, current: UInt64)
    case nonMonotonicTimestamp(previous: TimeInterval, current: TimeInterval)
    case recognitionSideMismatch(expected: BattleSide, actual: BattleSide)
    case unexpectedRecognitionResult(UInt64)
    case recognitionFrameMismatch(expected: UInt64, actual: UInt64)
    case futureRecognitionGeneration(requested: UInt64, current: UInt64)
    case missingProcessedFrameTimestamp
}

public struct PokemonNameConsensusPolicy: Equatable, Sendable {
    public let exactMatchMinimumCount: Int
    public let exactMatchMinimumMedianConfidence: Float
    public let correctedMatchMinimumCount: Int
    public let correctedMatchMinimumMedianConfidence: Float

    public init(
        exactMatchMinimumCount: Int,
        exactMatchMinimumMedianConfidence: Float,
        correctedMatchMinimumCount: Int,
        correctedMatchMinimumMedianConfidence: Float
    ) throws {
        guard exactMatchMinimumCount > 0 else {
            throw LiveNameDetectionError.invalidCount("exactMatchMinimumCount", exactMatchMinimumCount)
        }
        guard correctedMatchMinimumCount > 0 else {
            throw LiveNameDetectionError.invalidCount("correctedMatchMinimumCount", correctedMatchMinimumCount)
        }
        try Self.validateScore(exactMatchMinimumMedianConfidence, name: "exactMatchMinimumMedianConfidence")
        try Self.validateScore(correctedMatchMinimumMedianConfidence, name: "correctedMatchMinimumMedianConfidence")
        self.exactMatchMinimumCount = exactMatchMinimumCount
        self.exactMatchMinimumMedianConfidence = exactMatchMinimumMedianConfidence
        self.correctedMatchMinimumCount = correctedMatchMinimumCount
        self.correctedMatchMinimumMedianConfidence = correctedMatchMinimumMedianConfidence
    }

    private static func validateScore(_ value: Float, name: String) throws -> Void {
        guard value.isFinite, value >= 0, value <= 1 else {
            throw LiveNameDetectionError.invalidScore(name, value)
        }
    }
}

public struct LiveNameDetectionPolicy: Equatable, Sendable {
    public let sampleInterval: TimeInterval
    public let changeDifferenceThreshold: Float
    public let stableDifferenceThreshold: Float
    public let changedSampleCount: Int
    public let changeWindowSize: Int
    public let stableSampleCount: Int
    public let heartbeatInterval: TimeInterval
    public let recognitionSampleInterval: TimeInterval
    public let recognitionSampleCount: Int
    public let maximumBurstAttempts: Int
    public let retryInterval: TimeInterval
    public let consensus: PokemonNameConsensusPolicy

    public init(
        sampleInterval: TimeInterval,
        changeDifferenceThreshold: Float,
        stableDifferenceThreshold: Float,
        changedSampleCount: Int,
        changeWindowSize: Int,
        stableSampleCount: Int,
        heartbeatInterval: TimeInterval,
        recognitionSampleInterval: TimeInterval,
        recognitionSampleCount: Int,
        maximumBurstAttempts: Int,
        retryInterval: TimeInterval,
        consensus: PokemonNameConsensusPolicy
    ) throws {
        try Self.validateInterval(sampleInterval, name: "sampleInterval")
        try Self.validateInterval(heartbeatInterval, name: "heartbeatInterval")
        try Self.validateInterval(recognitionSampleInterval, name: "recognitionSampleInterval")
        try Self.validateInterval(retryInterval, name: "retryInterval")
        try Self.validateScore(changeDifferenceThreshold, name: "changeDifferenceThreshold")
        try Self.validateScore(stableDifferenceThreshold, name: "stableDifferenceThreshold")
        guard stableDifferenceThreshold < changeDifferenceThreshold else {
            throw LiveNameDetectionError.invalidPolicyRelation("stableDifferenceThreshold must be lower than changeDifferenceThreshold")
        }
        try Self.validateCount(changedSampleCount, name: "changedSampleCount")
        try Self.validateCount(changeWindowSize, name: "changeWindowSize")
        try Self.validateCount(stableSampleCount, name: "stableSampleCount")
        try Self.validateCount(recognitionSampleCount, name: "recognitionSampleCount")
        try Self.validateCount(maximumBurstAttempts, name: "maximumBurstAttempts")
        guard changedSampleCount <= changeWindowSize else {
            throw LiveNameDetectionError.invalidPolicyRelation("changedSampleCount must not exceed changeWindowSize")
        }
        guard consensus.exactMatchMinimumCount <= recognitionSampleCount,
              consensus.correctedMatchMinimumCount <= recognitionSampleCount else {
            throw LiveNameDetectionError.invalidPolicyRelation("consensus counts must not exceed recognitionSampleCount")
        }
        self.sampleInterval = sampleInterval
        self.changeDifferenceThreshold = changeDifferenceThreshold
        self.stableDifferenceThreshold = stableDifferenceThreshold
        self.changedSampleCount = changedSampleCount
        self.changeWindowSize = changeWindowSize
        self.stableSampleCount = stableSampleCount
        self.heartbeatInterval = heartbeatInterval
        self.recognitionSampleInterval = recognitionSampleInterval
        self.recognitionSampleCount = recognitionSampleCount
        self.maximumBurstAttempts = maximumBurstAttempts
        self.retryInterval = retryInterval
        self.consensus = consensus
    }

    private static func validateInterval(_ value: TimeInterval, name: String) throws -> Void {
        guard value.isFinite, value > 0 else {
            throw LiveNameDetectionError.invalidInterval(name, value)
        }
    }

    private static func validateScore(_ value: Float, name: String) throws -> Void {
        guard value.isFinite, value >= 0, value <= 1 else {
            throw LiveNameDetectionError.invalidScore(name, value)
        }
    }

    private static func validateCount(_ value: Int, name: String) throws -> Void {
        guard value > 0 else {
            throw LiveNameDetectionError.invalidCount(name, value)
        }
    }
}

public enum HUDVisibility: Equatable, Sendable {
    case visible
    case hidden
}

public enum ConfirmedRegionDifference: Equatable, Sendable {
    case unavailable
    case score(Float)
}

public struct NameRegionFrameObservation: Equatable, Sendable {
    public let frameID: UInt64
    public let monotonicTimestamp: TimeInterval
    public let hudVisibility: HUDVisibility
    public let differenceFromPrevious: Float
    public let differenceFromConfirmed: ConfirmedRegionDifference

    public init(
        frameID: UInt64,
        monotonicTimestamp: TimeInterval,
        hudVisibility: HUDVisibility,
        differenceFromPrevious: Float,
        differenceFromConfirmed: ConfirmedRegionDifference
    ) {
        self.frameID = frameID
        self.monotonicTimestamp = monotonicTimestamp
        self.hudVisibility = hudVisibility
        self.differenceFromPrevious = differenceFromPrevious
        self.differenceFromConfirmed = differenceFromConfirmed
    }
}

public enum LiveNameRecognitionKind: Equatable, Sendable {
    case probe
    case confirmation(attempt: Int, sampleIndex: Int)
}

public struct LiveNameRecognitionRequest: Equatable, Sendable {
    public let side: BattleSide
    public let requestID: UInt64
    public let generation: UInt64
    public let frameID: UInt64
    public let kind: LiveNameRecognitionKind

    public init(
        side: BattleSide,
        requestID: UInt64,
        generation: UInt64,
        frameID: UInt64,
        kind: LiveNameRecognitionKind
    ) {
        self.side = side
        self.requestID = requestID
        self.generation = generation
        self.frameID = frameID
        self.kind = kind
    }
}

public struct PokemonRecognitionSample: Equatable, Sendable {
    public let side: BattleSide
    public let requestID: UInt64
    public let generation: UInt64
    public let frameID: UInt64
    public let outcome: PokemonNameDetectionOutcome

    public init(
        side: BattleSide,
        requestID: UInt64,
        generation: UInt64,
        frameID: UInt64,
        outcome: PokemonNameDetectionOutcome
    ) {
        self.side = side
        self.requestID = requestID
        self.generation = generation
        self.frameID = frameID
        self.outcome = outcome
    }
}

public enum LiveNameDetectionStatus: Equatable, Sendable {
    case waitingForStableHUD(BattleSide, UInt64)
    case transitioning(BattleSide, PokemonNameDetection)
    case recognizing(BattleSide, UInt64, Int)
    case stable(BattleSide, PokemonNameDetection)
    case unconfirmed(BattleSide, UInt64)
}

public enum LiveNameDetectionOutput: Equatable, Sendable {
    case requestRecognition(LiveNameRecognitionRequest)
    case statusChanged(LiveNameDetectionStatus)
    case pokemonConfirmed(PokemonNameDetection)
    case pokemonSwitched(previous: PokemonNameDetection, current: PokemonNameDetection)
    case detectionFailed(BattleSide, UInt64)
    case probeRejected(BattleSide, UInt64, PokemonNameDetectionOutcome)
    case staleRecognitionRejected(requestID: UInt64, requestedGeneration: UInt64, currentGeneration: UInt64)
}

public enum PokemonNameConsensusResult: Equatable, Sendable {
    case confirmed(PokemonNameDetection)
    case unconfirmed
}
