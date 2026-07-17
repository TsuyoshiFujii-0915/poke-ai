import Foundation

public struct PokemonNameMatcher: Sendable {
    public init() {}

    public func match(
        recognizedTexts: [RecognizedText],
        side: BattleSide,
        candidates: [PokemonNameCandidate],
        maximumEditDistance: Int
    ) throws -> PokemonNameDetectionOutcome {
        try validate(candidates: candidates, maximumEditDistance: maximumEditDistance)
        guard !recognizedTexts.isEmpty else {
            return .noText(side)
        }

        let comparisons = recognizedTexts.flatMap { recognized in
            candidates.map { candidate in
                MatchComparison(
                    recognized: recognized,
                    candidate: candidate,
                    editDistance: levenshteinDistance(
                        normalize(recognized.text),
                        normalize(candidate.displayName)
                    )
                )
            }
        }
        guard let minimumDistance = comparisons.map(\.editDistance).min() else {
            throw NameRecognitionError.emptyCandidateCatalog
        }
        guard minimumDistance <= maximumEditDistance else {
            return .noMatch(side, recognizedTexts[0].text, recognizedTexts)
        }

        let closest = comparisons.filter { $0.editDistance == minimumDistance }
        let closestCandidates = uniqueCandidates(closest.map(\.candidate))
        guard closestCandidates.count == 1 else {
            return .ambiguous(side, closest[0].recognized.text, closestCandidates)
        }

        let candidate = closestCandidates[0]
        guard let bestRecognition = closest
            .filter({ $0.candidate.id == candidate.id })
            .max(by: { $0.recognized.confidence < $1.recognized.confidence }) else {
            throw NameRecognitionError.missingRecognizedTextCandidate
        }
        return .detected(
            PokemonNameDetection(
                side: side,
                candidate: candidate,
                rawText: bestRecognition.recognized.text,
                visionConfidence: bestRecognition.recognized.confidence,
                editDistance: bestRecognition.editDistance
            )
        )
    }

    private func validate(
        candidates: [PokemonNameCandidate],
        maximumEditDistance: Int
    ) throws -> Void {
        guard maximumEditDistance >= 0 else {
            throw NameRecognitionError.invalidMaximumEditDistance(maximumEditDistance)
        }
        guard !candidates.isEmpty else {
            throw NameRecognitionError.emptyCandidateCatalog
        }
        var ids = Set<String>()
        for candidate in candidates {
            guard !candidate.id.isEmpty, !normalize(candidate.displayName).isEmpty else {
                throw NameRecognitionError.invalidCandidate(candidate)
            }
            guard ids.insert(candidate.id).inserted else {
                throw NameRecognitionError.duplicateCandidateID(candidate.id)
            }
        }
    }

    private func uniqueCandidates(
        _ candidates: [PokemonNameCandidate]
    ) -> [PokemonNameCandidate] {
        var ids = Set<String>()
        return candidates.filter { ids.insert($0.id).inserted }
    }

    private func normalize(_ value: String) -> String {
        value
            .precomposedStringWithCompatibilityMapping
            .unicodeScalars
            .filter { CharacterSet.alphanumerics.contains($0) }
            .map(String.init)
            .joined()
            .lowercased()
    }

    private func levenshteinDistance(_ lhs: String, _ rhs: String) -> Int {
        let left = Array(lhs)
        let right = Array(rhs)
        var previous = Array(0...right.count)

        for (leftIndex, leftCharacter) in left.enumerated() {
            var current = [leftIndex + 1]
            for (rightIndex, rightCharacter) in right.enumerated() {
                let insertion = current[rightIndex] + 1
                let deletion = previous[rightIndex + 1] + 1
                let substitution = previous[rightIndex] + (leftCharacter == rightCharacter ? 0 : 1)
                current.append(min(insertion, deletion, substitution))
            }
            previous = current
        }
        return previous[right.count]
    }
}

private struct MatchComparison {
    let recognized: RecognizedText
    let candidate: PokemonNameCandidate
    let editDistance: Int
}
