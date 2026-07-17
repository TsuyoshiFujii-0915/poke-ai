import CoreGraphics
import Foundation
import ImageIO
import Testing
@testable import CaptureRecognition

@Suite
struct PokemonNameRecognizerTests {
    private let candidates: [PokemonNameCandidate] = [
        PokemonNameCandidate(id: "Meowscarada", displayName: "マスカーニャ"),
        PokemonNameCandidate(id: "Archaludon", displayName: "ブリジュラス"),
        PokemonNameCandidate(id: "Gyarados", displayName: "ギャラドス"),
        PokemonNameCandidate(id: "Garchomp", displayName: "ガブリアス"),
    ]

    @Test
    func recognizesBothNamesFromBattleHUD() throws -> Void {
        let recognizer = try makeRecognizer()
        let image = try loadFixture(named: "meowscarada-vs-archaludon")

        let player = try recognizer.recognize(
            cgImage: image,
            orientation: .up,
            side: .player,
            candidates: candidates
        )
        let opponent = try recognizer.recognize(
            cgImage: image,
            orientation: .up,
            side: .opponent,
            candidates: candidates
        )

        try assertDetected(player, expectedID: "Meowscarada", expectedName: "マスカーニャ")
        try assertDetected(opponent, expectedID: "Archaludon", expectedName: "ブリジュラス")
    }

    @Test
    func recognizesPlayerAfterSwitch() throws -> Void {
        let recognizer = try makeRecognizer()
        let image = try loadFixture(named: "gyarados-vs-archaludon")

        let outcome = try recognizer.recognize(
            cgImage: image,
            orientation: .up,
            side: .player,
            candidates: candidates
        )

        try assertDetected(outcome, expectedID: "Gyarados", expectedName: "ギャラドス")
    }

    @Test
    func correctsOneCharacterVisionErrorUsingKnownNames() throws -> Void {
        let recognizer = try makeRecognizer()
        let image = try loadFixture(named: "gyarados-vs-garchomp")

        let outcome = try recognizer.recognize(
            cgImage: image,
            orientation: .up,
            side: .opponent,
            candidates: candidates
        )

        try assertDetected(outcome, expectedID: "Garchomp", expectedName: "ガブリアス")
    }

    @Test
    func rejectsRegionOutsideSourceFrame() throws -> Void {
        do {
            _ = try NormalizedRegion(topLeftX: 0.9, topLeftY: 0.1, width: 0.2, height: 0.1)
            Issue.record("Expected an invalidRegion error")
        } catch {
            #expect(error as? NameRecognitionError == .invalidRegion)
        }
    }

    @Test
    func reportsAmbiguousCandidateInsteadOfChoosingImplicitly() throws -> Void {
        let matcher = PokemonNameMatcher()
        let recognized = [RecognizedText(text: "カビゴ", confidence: 0.8)]
        let tiedCandidates = [
            PokemonNameCandidate(id: "A", displayName: "カビゴン"),
            PokemonNameCandidate(id: "B", displayName: "カビゴヌ"),
        ]

        let outcome = try matcher.match(
            recognizedTexts: recognized,
            side: .player,
            candidates: tiedCandidates,
            maximumEditDistance: 1
        )

        guard case let .ambiguous(side, rawText, matches) = outcome else {
            Issue.record("Expected an explicit ambiguous outcome, got \(outcome)")
            return
        }
        #expect(side == .player)
        #expect(rawText == "カビゴ")
        #expect(matches.map(\.id) == ["A", "B"])
    }

    private func makeRecognizer() throws -> PokemonNameRecognizer {
        let regions = BattleNameRegions(
            player: try NormalizedRegion(
                topLeftX: 0.06452,
                topLeftY: 0.86964,
                width: 0.14144,
                height: 0.06429
            ),
            opponent: try NormalizedRegion(
                topLeftX: 0.81141,
                topLeftY: 0.02500,
                width: 0.13896,
                height: 0.06429
            )
        )
        return try PokemonNameRecognizer(
            regions: regions,
            recognitionLanguage: "ja-JP",
            maximumCandidateCount: 3,
            minimumTextHeight: 0.01,
            maximumEditDistance: 1
        )
    }

    private func loadFixture(named name: String) throws -> CGImage {
        guard let url = Bundle.module.url(forResource: name, withExtension: "png") else {
            throw FixtureError.missingResource(name)
        }
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
            throw FixtureError.unreadableImage(name)
        }
        guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw FixtureError.unreadableImage(name)
        }
        return image
    }

    private func assertDetected(
        _ outcome: PokemonNameDetectionOutcome,
        expectedID: String,
        expectedName: String
    ) throws -> Void {
        guard case let .detected(detection) = outcome else {
            Issue.record("Expected a detection, got \(outcome)")
            return
        }
        #expect(detection.candidate.id == expectedID)
        #expect(detection.candidate.displayName == expectedName)
        #expect(detection.visionConfidence > 0)
        #expect(detection.editDistance <= 1)
    }
}

private enum FixtureError: Error {
    case missingResource(String)
    case unreadableImage(String)
}
