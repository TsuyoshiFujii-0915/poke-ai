import Testing
@testable import CaptureRecognition

@Suite
struct BattleSceneDetectorTests {
    @Test
    func confirmsAStableBattleInputAndActionTransition() throws -> Void {
        var detector = try BattleSceneDetector(policy: SceneDetectionPolicy(
            stableSampleCount: 3,
            actionSampleCount: 2
        ))
        let input = SceneVisualObservation(
            playerHUD: .visible,
            opponentHUD: .visible,
            outOfBattleEvidence: false,
            battleResultEvidence: false,
            teamSelectionEvidence: false,
            partyOverviewEvidence: false
        )
        let action = SceneVisualObservation(
            playerHUD: .hidden,
            opponentHUD: .hidden,
            outOfBattleEvidence: false,
            battleResultEvidence: false,
            teamSelectionEvidence: false,
            partyOverviewEvidence: false
        )

        _ = detector.consume(input)
        _ = detector.consume(input)
        let confirmedInput = detector.consume(input)
        #expect(confirmedInput.scene == .battleInput)
        #expect(confirmedInput.stability == .stable)

        let actionCandidate = detector.consume(action)
        #expect(actionCandidate.scene == .battleInput)
        #expect(actionCandidate.candidate == .battleAction)
        #expect(actionCandidate.stability == .transitioning)

        let confirmedAction = detector.consume(action)
        #expect(confirmedAction.scene == .battleAction)
        #expect(confirmedAction.stability == .stable)

        _ = detector.consume(input)
        _ = detector.consume(input)
        let returnedInput = detector.consume(input)
        #expect(returnedInput.scene == .battleInput)
        #expect(returnedInput.stability == .stable)
    }

    @Test
    func keepsOneSidedHudFramesInTheCurrentBattleAction() throws -> Void {
        var detector = try BattleSceneDetector(policy: SceneDetectionPolicy(
            stableSampleCount: 3,
            actionSampleCount: 2
        ))
        let input = observation(player: .visible, opponent: .visible)
        let hidden = observation(player: .hidden, opponent: .hidden)
        let opponentReturned = observation(player: .hidden, opponent: .visible)

        _ = detector.consume(input)
        _ = detector.consume(input)
        _ = detector.consume(input)
        _ = detector.consume(hidden)
        _ = detector.consume(hidden)

        let partialReturn = detector.consume(opponentReturned)

        #expect(partialReturn.scene == .battleAction)
        #expect(partialReturn.candidate == .battleAction)
        #expect(partialReturn.stability == .stable)
    }

    @Test
    func prioritizesLayoutSpecificMenusOverHiddenHudRegions() throws -> Void {
        var detector = try BattleSceneDetector(policy: SceneDetectionPolicy(
            stableSampleCount: 3,
            actionSampleCount: 2
        ))
        let teamSelection = SceneVisualObservation(
            playerHUD: .hidden,
            opponentHUD: .hidden,
            outOfBattleEvidence: false,
            battleResultEvidence: false,
            teamSelectionEvidence: true,
            partyOverviewEvidence: false
        )
        let partyOverview = SceneVisualObservation(
            playerHUD: .hidden,
            opponentHUD: .hidden,
            outOfBattleEvidence: false,
            battleResultEvidence: false,
            teamSelectionEvidence: false,
            partyOverviewEvidence: true
        )

        _ = detector.consume(teamSelection)
        _ = detector.consume(teamSelection)
        let selected = detector.consume(teamSelection)
        #expect(selected.scene == .teamSelection)

        _ = detector.consume(partyOverview)
        _ = detector.consume(partyOverview)
        let party = detector.consume(partyOverview)
        #expect(party.scene == .partyOverview)
    }

    @Test
    func doesNotForceAnUnrelatedScreenIntoABattleScene() throws -> Void {
        var detector = try BattleSceneDetector(policy: SceneDetectionPolicy(
            stableSampleCount: 3,
            actionSampleCount: 2
        ))
        let unrelated = observation(player: .hidden, opponent: .hidden)

        let snapshot = detector.consume(unrelated)

        #expect(snapshot.scene == .unknown)
        #expect(snapshot.candidate == .unknown)
        #expect(snapshot.stability == .stable)
    }

    @Test
    func confirmsARecognizedOutOfBattleScreenWithoutReplacingUnknownFallback() throws -> Void {
        var detector = try BattleSceneDetector(policy: SceneDetectionPolicy(
            stableSampleCount: 3,
            actionSampleCount: 2
        ))
        let outOfBattle = SceneVisualObservation(
            playerHUD: .hidden,
            opponentHUD: .hidden,
            outOfBattleEvidence: true,
            battleResultEvidence: false,
            teamSelectionEvidence: false,
            partyOverviewEvidence: false
        )

        _ = detector.consume(outOfBattle)
        _ = detector.consume(outOfBattle)
        let confirmed = detector.consume(outOfBattle)

        #expect(confirmed.scene == .outOfBattle)
        #expect(confirmed.candidate == .outOfBattle)
        #expect(confirmed.stability == .stable)
    }

    @Test
    func ignoresBriefHudDisappearanceWhileOpeningTheCommandUI() throws -> Void {
        var detector = try BattleSceneDetector(policy: SceneDetectionPolicy.ipadBattleHUDV1())
        let input = observation(player: .visible, opponent: .visible)
        let hidden = observation(player: .hidden, opponent: .hidden)

        _ = detector.consume(input)
        _ = detector.consume(input)
        _ = detector.consume(input)
        _ = detector.consume(hidden)
        let secondHiddenFrame = detector.consume(hidden)
        let returnedInput = detector.consume(input)

        #expect(secondHiddenFrame.scene == .battleInput)
        #expect(secondHiddenFrame.candidate == .battleAction)
        #expect(secondHiddenFrame.stability == .transitioning)
        #expect(returnedInput.scene == .battleInput)
        #expect(returnedInput.stability == .stable)

        _ = detector.consume(hidden)
        _ = detector.consume(hidden)
        _ = detector.consume(hidden)
        let sustainedAction = detector.consume(hidden)
        #expect(sustainedAction.scene == .battleAction)
        #expect(sustainedAction.stability == .stable)
    }

    @Test
    func confirmsACompletedBattleResultAfterStableLayoutEvidence() throws -> Void {
        var detector = try BattleSceneDetector(policy: SceneDetectionPolicy.ipadBattleHUDV1())
        let result = SceneVisualObservation(
            playerHUD: .hidden,
            opponentHUD: .hidden,
            outOfBattleEvidence: false,
            battleResultEvidence: true,
            teamSelectionEvidence: false,
            partyOverviewEvidence: false
        )

        let first = detector.consume(result)
        let second = detector.consume(result)
        let confirmed = detector.consume(result)
        let unchanged = detector.consume(result)

        #expect(first.scene == .unknown)
        #expect(first.candidate == .battleResult)
        #expect(first.stability == .transitioning)
        #expect(second.scene == .unknown)
        #expect(second.candidate == .battleResult)
        #expect(second.stability == .transitioning)
        #expect(confirmed.scene == .battleResult)
        #expect(confirmed.candidate == .battleResult)
        #expect(confirmed.stability == .stable)
        #expect(unchanged == confirmed)
    }

    private func observation(
        player: HUDVisibility,
        opponent: HUDVisibility
    ) -> SceneVisualObservation {
        SceneVisualObservation(
            playerHUD: player,
            opponentHUD: opponent,
            outOfBattleEvidence: false,
            battleResultEvidence: false,
            teamSelectionEvidence: false,
            partyOverviewEvidence: false
        )
    }
}
