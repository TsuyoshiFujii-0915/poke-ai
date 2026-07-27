import Testing
@testable import CaptureRecognition

@Suite
struct ChampionsNameDetectionPolicyTests {
    @Test
    func acceptsFourConsistentOneEditReadingsAtObservedVisionConfidence() throws -> Void {
        let policy = try ChampionsNameDetectionPolicy.make()
        let consensus = PokemonNameRecognitionConsensus(policy: policy.consensus)
        let corrected = PokemonNameDetection(
            side: .opponent,
            candidate: PokemonNameCandidate(id: "Kingambit", displayName: "ドドゲザン"),
            rawText: "ドドゲサン",
            visionConfidence: 0.5,
            editDistance: 1
        )

        let result = consensus.resolve([
            .detected(corrected),
            .detected(corrected),
            .detected(corrected),
            .detected(corrected),
            .noText(.opponent),
        ])

        guard case let .confirmed(detection) = result else {
            Issue.record("Expected the stable one-edit reading to be confirmed")
            return
        }
        #expect(detection.candidate.id == "Kingambit")
        #expect(detection.visionConfidence == 0.5)
        #expect(detection.editDistance == 1)
    }
}
