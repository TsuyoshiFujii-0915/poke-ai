import Foundation

public enum ChampionsNameDetectionPolicy {
    public static func make() throws -> LiveNameDetectionPolicy {
        let consensus = try PokemonNameConsensusPolicy(
            exactMatchMinimumCount: 3,
            correctedMatchMinimumCount: 4
        )
        return try LiveNameDetectionPolicy(
            sampleInterval: 0.125,
            changeDifferenceThreshold: 0.02,
            stableDifferenceThreshold: 0.006,
            changedSampleCount: 3,
            changeWindowSize: 5,
            stableSampleCount: 3,
            heartbeatInterval: 3.0,
            recognitionSampleInterval: 0.15,
            recognitionSampleCount: 5,
            maximumBurstAttempts: 3,
            retryInterval: 0.5,
            consensus: consensus
        )
    }
}
