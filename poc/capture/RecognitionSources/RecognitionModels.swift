import CoreGraphics
import Foundation

public enum BattleSide: String, Equatable, Hashable, Sendable {
    case player
    case opponent
}

public enum TextRecognitionMode: Equatable, Sendable {
    case fast
    case accurate
}

public enum NameRecognitionError: Error, Equatable {
    case invalidRegion
    case invalidMaximumCandidateCount(Int)
    case invalidMinimumTextHeight(Float)
    case invalidMaximumEditDistance(Int)
    case emptyCandidateCatalog
    case invalidCandidate(PokemonNameCandidate)
    case duplicateCandidateID(String)
    case unsupportedRecognitionLanguage(String)
    case visionConfigurationFailed(String)
    case visionRequestFailed(String)
    case missingVisionResults
    case missingRecognizedTextCandidate
}

public struct NormalizedRegion: Equatable, Sendable {
    public let topLeftX: CGFloat
    public let topLeftY: CGFloat
    public let width: CGFloat
    public let height: CGFloat

    public init(
        topLeftX: CGFloat,
        topLeftY: CGFloat,
        width: CGFloat,
        height: CGFloat
    ) throws {
        let values = [topLeftX, topLeftY, width, height]
        guard values.allSatisfy(\.isFinite),
              topLeftX >= 0,
              topLeftY >= 0,
              width > 0,
              height > 0,
              topLeftX + width <= 1,
              topLeftY + height <= 1 else {
            throw NameRecognitionError.invalidRegion
        }
        self.topLeftX = topLeftX
        self.topLeftY = topLeftY
        self.width = width
        self.height = height
    }

    var visionRegionOfInterest: CGRect {
        CGRect(
            x: topLeftX,
            y: 1 - topLeftY - height,
            width: width,
            height: height
        )
    }
}

public struct BattleNameRegions: Equatable, Sendable {
    public let player: NormalizedRegion
    public let opponent: NormalizedRegion

    public init(player: NormalizedRegion, opponent: NormalizedRegion) {
        self.player = player
        self.opponent = opponent
    }

    func region(for side: BattleSide) -> NormalizedRegion {
        switch side {
        case .player:
            return player
        case .opponent:
            return opponent
        }
    }
}

public struct PokemonNameCandidate: Equatable, Sendable {
    public let id: String
    public let displayName: String

    public init(id: String, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

public struct RecognizedText: Equatable, Sendable {
    public let text: String
    public let confidence: Float

    public init(text: String, confidence: Float) {
        self.text = text
        self.confidence = confidence
    }
}

public struct PokemonNameDetection: Equatable, Sendable {
    public let side: BattleSide
    public let candidate: PokemonNameCandidate
    public let rawText: String
    public let visionConfidence: Float
    public let editDistance: Int

    public init(
        side: BattleSide,
        candidate: PokemonNameCandidate,
        rawText: String,
        visionConfidence: Float,
        editDistance: Int
    ) {
        self.side = side
        self.candidate = candidate
        self.rawText = rawText
        self.visionConfidence = visionConfidence
        self.editDistance = editDistance
    }
}

public enum PokemonNameDetectionOutcome: Equatable, Sendable {
    case detected(PokemonNameDetection)
    case noText(BattleSide)
    case noMatch(BattleSide, String, [RecognizedText])
    case ambiguous(BattleSide, String, [PokemonNameCandidate])
}
