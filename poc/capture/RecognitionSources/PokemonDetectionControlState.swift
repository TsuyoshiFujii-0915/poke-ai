import Foundation

public enum PokemonDetectionMode: String, Codable, Equatable, Sendable {
    case automatic = "auto"
    case manual
}

public struct DetectedPokemonPresence: Codable, Equatable, Sendable {
    public let side: BattleSide
    public let pokemon: String
    public let displayName: String
    public let confidence: Float

    public init(
        side: BattleSide,
        pokemon: String,
        displayName: String,
        confidence: Float
    ) {
        self.side = side
        self.pokemon = pokemon
        self.displayName = displayName
        self.confidence = confidence
    }
}

public enum PokemonDetectionControlError: Error, Equatable {
    case automaticDetectionWhileManual
}

public struct PokemonDetectionControlState: Equatable, Sendable {
    public private(set) var mode: PokemonDetectionMode
    public private(set) var player: DetectedPokemonPresence?
    public private(set) var opponent: DetectedPokemonPresence?

    public init(mode: PokemonDetectionMode) {
        self.mode = mode
        self.player = nil
        self.opponent = nil
    }

    @discardableResult
    public mutating func changeMode(to nextMode: PokemonDetectionMode) -> Bool {
        guard nextMode != mode else {
            return false
        }
        mode = nextMode
        if nextMode == .automatic {
            player = nil
            opponent = nil
        }
        return true
    }

    public mutating func recordAutomaticPresence(
        _ presence: DetectedPokemonPresence
    ) throws -> Void {
        guard mode == .automatic else {
            throw PokemonDetectionControlError.automaticDetectionWhileManual
        }
        switch presence.side {
        case .player:
            player = presence
        case .opponent:
            opponent = presence
        }
    }
}
