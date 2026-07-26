import Foundation

public enum PokemonDetectionStatus: String, Codable, Equatable, Sendable {
    case idle
    case detecting
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
    case detectionAlreadyRunning
    case detectionNotRunning
}

public enum PokemonDetectionResolution: Equatable, Sendable {
    case accepted
    case completed
    case alreadyResolved
}

public struct PokemonDetectionControlState: Equatable, Sendable {
    public private(set) var status: PokemonDetectionStatus
    public private(set) var player: DetectedPokemonPresence?
    public private(set) var opponent: DetectedPokemonPresence?
    public private(set) var failedSides: [BattleSide]
    private var resolvedSides: Set<BattleSide>

    public init() {
        self.status = .idle
        self.player = nil
        self.opponent = nil
        self.failedSides = []
        self.resolvedSides = []
    }

    public mutating func startDetection() throws -> Void {
        guard status == .idle else {
            throw PokemonDetectionControlError.detectionAlreadyRunning
        }
        status = .detecting
        player = nil
        opponent = nil
        failedSides = []
        resolvedSides = []
    }

    public mutating func recordPresence(
        _ presence: DetectedPokemonPresence
    ) throws -> PokemonDetectionResolution {
        try requireActiveDetection()
        guard !resolvedSides.contains(presence.side) else {
            return .alreadyResolved
        }
        switch presence.side {
        case .player:
            player = presence
        case .opponent:
            opponent = presence
        }
        resolvedSides.insert(presence.side)
        return finishIfResolved()
    }

    public mutating func recordFailure(
        side: BattleSide
    ) throws -> PokemonDetectionResolution {
        try requireActiveDetection()
        guard !resolvedSides.contains(side) else {
            return .alreadyResolved
        }
        resolvedSides.insert(side)
        failedSides.append(side)
        failedSides.sort { $0.rawValue < $1.rawValue }
        return finishIfResolved()
    }

    public mutating func timeoutDetection() throws -> Void {
        guard status == .detecting else {
            throw PokemonDetectionControlError.detectionNotRunning
        }
        for side in BattleSide.allCases where !resolvedSides.contains(side) {
            resolvedSides.insert(side)
            failedSides.append(side)
        }
        failedSides = BattleSide.allCases.filter(failedSides.contains)
        status = .idle
    }

    private func requireActiveDetection() throws -> Void {
        guard status == .detecting else {
            throw PokemonDetectionControlError.detectionNotRunning
        }
    }

    private mutating func finishIfResolved() -> PokemonDetectionResolution {
        guard resolvedSides.count == BattleSide.allCases.count else {
            return .accepted
        }
        status = .idle
        return .completed
    }
}
