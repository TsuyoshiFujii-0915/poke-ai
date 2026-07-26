import Testing
@testable import CaptureRecognition

@Suite
struct PokemonDetectionControlStateTests {
    @Test
    func rejectsRecognitionWhileIdle() throws -> Void {
        var state = PokemonDetectionControlState()

        #expect(throws: PokemonDetectionControlError.detectionNotRunning) {
            try state.recordPresence(playerPresence())
        }
    }

    @Test
    func aRunCompletesAfterBothSidesResolve() throws -> Void {
        var state = PokemonDetectionControlState()
        try state.startDetection()

        let first = try state.recordPresence(playerPresence())
        let second = try state.recordPresence(opponentPresence())

        #expect(first == .accepted)
        #expect(second == .completed)
        #expect(state.status == .idle)
        #expect(state.player?.pokemon == "Raichu")
        #expect(state.opponent?.pokemon == "Garchomp")
        #expect(state.failedSides.isEmpty)
    }

    @Test
    func aFailedSideDoesNotDiscardItsExistingUiSelection() throws -> Void {
        var state = PokemonDetectionControlState()
        try state.startDetection()

        let first = try state.recordFailure(side: .opponent)
        let second = try state.recordPresence(playerPresence())

        #expect(first == .accepted)
        #expect(second == .completed)
        #expect(state.status == .idle)
        #expect(state.player?.pokemon == "Raichu")
        #expect(state.opponent == nil)
        #expect(state.failedSides == [.opponent])
    }

    @Test
    func theFirstResolutionForEachSideWinsWithinOneRun() throws -> Void {
        var state = PokemonDetectionControlState()
        try state.startDetection()

        _ = try state.recordPresence(playerPresence())
        let repeated = try state.recordPresence(DetectedPokemonPresence(
            side: .player,
            pokemon: "Raichu-Mega-X",
            displayName: "メガライチュウX",
            confidence: 0.95
        ))

        #expect(repeated == .alreadyResolved)
        #expect(state.player?.pokemon == "Raichu")
        #expect(state.status == .detecting)
    }

    @Test
    func startingTheNextRunClearsOnlyServerDetectionResults() throws -> Void {
        var state = PokemonDetectionControlState()
        try state.startDetection()
        _ = try state.recordPresence(playerPresence())
        _ = try state.recordPresence(opponentPresence())

        try state.startDetection()

        #expect(state.status == .detecting)
        #expect(state.player == nil)
        #expect(state.opponent == nil)
        #expect(state.failedSides.isEmpty)
    }

    @Test
    func timeoutFinishesTheRunAndFailsOnlyUnresolvedSides() throws -> Void {
        var state = PokemonDetectionControlState()
        try state.startDetection()
        _ = try state.recordPresence(playerPresence())

        try state.timeoutDetection()

        #expect(state.status == .idle)
        #expect(state.player?.pokemon == "Raichu")
        #expect(state.opponent == nil)
        #expect(state.failedSides == [.opponent])
    }

    private func playerPresence() -> DetectedPokemonPresence {
        DetectedPokemonPresence(
            side: .player,
            pokemon: "Raichu",
            displayName: "ライチュウ",
            confidence: 0.91
        )
    }

    private func opponentPresence() -> DetectedPokemonPresence {
        DetectedPokemonPresence(
            side: .opponent,
            pokemon: "Garchomp",
            displayName: "ガブリアス",
            confidence: 0.88
        )
    }
}
