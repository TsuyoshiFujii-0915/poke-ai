import Foundation

public struct PokemonNameRecognitionConsensus: Sendable {
    private let policy: PokemonNameConsensusPolicy

    public init(policy: PokemonNameConsensusPolicy) {
        self.policy = policy
    }

    public func resolve(_ outcomes: [PokemonNameDetectionOutcome]) -> PokemonNameConsensusResult {
        let detections = outcomes.compactMap { outcome -> PokemonNameDetection? in
            guard case let .detected(detection) = outcome else { return nil }
            return detection
        }
        let grouped = Dictionary(grouping: detections, by: { $0.candidate.id })
        guard let maximumCount = grouped.values.map(\.count).max() else {
            return .unconfirmed
        }
        let winners = grouped.filter { $0.value.count == maximumCount }
        guard winners.count == 1, let winner = winners.first?.value else {
            return .unconfirmed
        }

        let exactCount = winner.filter { $0.editDistance == 0 }.count
        let acceptedExact = exactCount >= policy.exactMatchMinimumCount
        let acceptedCorrection = winner.count >= policy.correctedMatchMinimumCount
        guard acceptedExact || acceptedCorrection,
              let representative = winner.max(by: { $0.visionConfidence < $1.visionConfidence }) else {
            return .unconfirmed
        }

        let medianConfidence = median(winner.map(\.visionConfidence))
        guard let minimumEditDistance = winner.map(\.editDistance).min() else {
            return .unconfirmed
        }
        return .confirmed(PokemonNameDetection(
            side: representative.side,
            candidate: representative.candidate,
            rawText: representative.rawText,
            visionConfidence: medianConfidence,
            editDistance: minimumEditDistance
        ))
    }

    private func median(_ values: [Float]) -> Float {
        let sorted = values.sorted()
        let middle = sorted.count / 2
        if sorted.count.isMultiple(of: 2) {
            return (sorted[middle - 1] + sorted[middle]) / 2
        }
        return sorted[middle]
    }
}
