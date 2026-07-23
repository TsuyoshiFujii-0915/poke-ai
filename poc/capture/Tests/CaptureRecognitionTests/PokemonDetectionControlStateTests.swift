import Testing
@testable import CaptureRecognition

@Suite
struct PokemonDetectionControlStateTests {
    @Test
    func rejectsAutomaticPresenceWhileManualModeIsActive() throws -> Void {
        var state = PokemonDetectionControlState(mode: .manual)

        #expect(throws: PokemonDetectionControlError.automaticDetectionWhileManual) {
            try state.recordAutomaticPresence(
                DetectedPokemonPresence(
                    side: .player,
                    pokemon: "Meowscarada",
                    displayName: "マスカーニャ",
                    confidence: 0.91
                )
            )
        }
    }

    @Test
    func enteringManualModeKeepsTheLastAutomaticPresences() throws -> Void {
        var state = PokemonDetectionControlState(mode: .automatic)
        try state.recordAutomaticPresence(DetectedPokemonPresence(
            side: .player,
            pokemon: "Meowscarada",
            displayName: "マスカーニャ",
            confidence: 0.91
        ))

        let changed = state.changeMode(to: .manual)

        #expect(changed)
        #expect(state.mode == .manual)
        #expect(state.player?.pokemon == "Meowscarada")
    }

    @Test
    func returningToAutomaticModeClearsStalePresences() throws -> Void {
        var state = PokemonDetectionControlState(mode: .automatic)
        try state.recordAutomaticPresence(DetectedPokemonPresence(
            side: .opponent,
            pokemon: "Garchomp",
            displayName: "ガブリアス",
            confidence: 0.88
        ))
        _ = state.changeMode(to: .manual)

        let changed = state.changeMode(to: .automatic)

        #expect(changed)
        #expect(state.mode == .automatic)
        #expect(state.player == nil)
        #expect(state.opponent == nil)
    }

    @Test
    func repeatingTheCurrentModeDoesNotClearPresences() throws -> Void {
        var state = PokemonDetectionControlState(mode: .automatic)
        try state.recordAutomaticPresence(DetectedPokemonPresence(
            side: .player,
            pokemon: "Lucario",
            displayName: "ルカリオ",
            confidence: 0.93
        ))

        let changed = state.changeMode(to: .automatic)

        #expect(!changed)
        #expect(state.player?.pokemon == "Lucario")
    }
}
