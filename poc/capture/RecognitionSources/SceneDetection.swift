import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

public enum GameScene: String, Codable, Equatable, Sendable {
    case unknown
    case outOfBattle = "out_of_battle"
    case battleResult = "battle_result"
    case teamSelection = "team_selection"
    case battleInput = "battle_input"
    case partyOverview = "party_overview"
    case battleAction = "battle_action"
}

public enum SceneStability: String, Codable, Equatable, Sendable {
    case stable
    case transitioning
}

public enum SceneDetectionError: Error, Equatable {
    case invalidCount(String, Int)
    case invalidScore(String, Float)
    case missingPixelBufferBaseAddress
    case emptyPixelRegion(String)
}

public struct SceneDetectionPolicy: Equatable, Sendable {
    public let stableSampleCount: Int
    public let actionSampleCount: Int

    public init(stableSampleCount: Int, actionSampleCount: Int) throws {
        guard stableSampleCount > 0 else {
            throw SceneDetectionError.invalidCount("stableSampleCount", stableSampleCount)
        }
        guard actionSampleCount > 0 else {
            throw SceneDetectionError.invalidCount("actionSampleCount", actionSampleCount)
        }
        self.stableSampleCount = stableSampleCount
        self.actionSampleCount = actionSampleCount
    }

    public static func ipadBattleHUDV1() throws -> SceneDetectionPolicy {
        try SceneDetectionPolicy(stableSampleCount: 3, actionSampleCount: 4)
    }
}

public struct SceneVisualObservation: Equatable, Sendable {
    public let playerHUD: HUDVisibility
    public let opponentHUD: HUDVisibility
    public let outOfBattleEvidence: Bool
    public let battleResultEvidence: Bool
    public let teamSelectionEvidence: Bool
    public let partyOverviewEvidence: Bool

    public init(
        playerHUD: HUDVisibility,
        opponentHUD: HUDVisibility,
        outOfBattleEvidence: Bool,
        battleResultEvidence: Bool,
        teamSelectionEvidence: Bool,
        partyOverviewEvidence: Bool
    ) {
        self.playerHUD = playerHUD
        self.opponentHUD = opponentHUD
        self.outOfBattleEvidence = outOfBattleEvidence
        self.battleResultEvidence = battleResultEvidence
        self.teamSelectionEvidence = teamSelectionEvidence
        self.partyOverviewEvidence = partyOverviewEvidence
    }
}

public struct SceneDetectionSnapshot: Equatable, Sendable {
    public let scene: GameScene
    public let candidate: GameScene
    public let stability: SceneStability
    public let observation: SceneVisualObservation

    public init(
        scene: GameScene,
        candidate: GameScene,
        stability: SceneStability,
        observation: SceneVisualObservation
    ) {
        self.scene = scene
        self.candidate = candidate
        self.stability = stability
        self.observation = observation
    }
}

public struct BattleSceneDetector: Sendable {
    private let policy: SceneDetectionPolicy
    private var currentScene: GameScene = .unknown
    private var candidateScene: GameScene = .unknown
    private var candidateSampleCount = 0

    public init(policy: SceneDetectionPolicy) throws {
        self.policy = policy
    }

    public mutating func consume(_ observation: SceneVisualObservation) -> SceneDetectionSnapshot {
        let classified = classify(observation)
        if classified == currentScene {
            candidateScene = currentScene
            candidateSampleCount = requiredSampleCount(for: currentScene)
            return SceneDetectionSnapshot(
                scene: currentScene,
                candidate: currentScene,
                stability: .stable,
                observation: observation
            )
        }

        if classified == candidateScene {
            candidateSampleCount += 1
        } else {
            candidateScene = classified
            candidateSampleCount = 1
        }

        if candidateSampleCount >= requiredSampleCount(for: candidateScene) {
            currentScene = candidateScene
            return SceneDetectionSnapshot(
                scene: currentScene,
                candidate: candidateScene,
                stability: .stable,
                observation: observation
            )
        }

        return SceneDetectionSnapshot(
            scene: currentScene,
            candidate: candidateScene,
            stability: .transitioning,
            observation: observation
        )
    }

    private func classify(_ observation: SceneVisualObservation) -> GameScene {
        if observation.teamSelectionEvidence {
            return .teamSelection
        }
        if observation.partyOverviewEvidence {
            return .partyOverview
        }
        if observation.playerHUD == .visible, observation.opponentHUD == .visible {
            return .battleInput
        }
        if observation.battleResultEvidence {
            return .battleResult
        }
        if observation.outOfBattleEvidence {
            return .outOfBattle
        }
        if currentScene == .battleInput
            || currentScene == .partyOverview
            || currentScene == .battleAction {
            return .battleAction
        }
        return .unknown
    }

    private func requiredSampleCount(for scene: GameScene) -> Int {
        scene == .battleAction ? policy.actionSampleCount : policy.stableSampleCount
    }
}

public struct SceneVisualObservationExtractor: Sendable {
    private let profile: CaptureLayoutProfile
    private let teamPlayerRowRegions: [NormalizedRegion]
    private let teamOpponentRowRegions: [NormalizedRegion]
    private let homeTileRegions: [NormalizedRegion]
    private let homeNavigationRegion: NormalizedRegion
    private let battleResultPanelRegions: [NormalizedRegion]
    private let battleResultButtonRegions: [NormalizedRegion]
    private let partyPanelRegion: NormalizedRegion
    private let sampleStride: Int
    private let teamPlayerRowMinimumFraction: Float
    private let teamOpponentRowMinimumFraction: Float
    private let teamPlayerMinimumMatchingRows: Int
    private let teamOpponentMinimumMatchingRows: Int
    private let homeTileMinimumFraction: Float
    private let homeMinimumMatchingTiles: Int
    private let homeNavigationMinimumFraction: Float
    private let battleResultPanelMinimumFraction: Float
    private let battleResultButtonMinimumFraction: Float
    private let battleResultMinimumMatchingPanels: Int
    private let battleResultMinimumMatchingButtons: Int
    private let partyPanelMinimumFraction: Float
    private let playerHUDMinimumFraction: Float
    private let opponentHUDMinimumFraction: Float

    public init(
        profile: CaptureLayoutProfile,
        teamPlayerRowRegions: [NormalizedRegion],
        teamOpponentRowRegions: [NormalizedRegion],
        homeTileRegions: [NormalizedRegion],
        homeNavigationRegion: NormalizedRegion,
        battleResultPanelRegions: [NormalizedRegion],
        battleResultButtonRegions: [NormalizedRegion],
        partyPanelRegion: NormalizedRegion,
        sampleStride: Int,
        teamPlayerRowMinimumFraction: Float,
        teamOpponentRowMinimumFraction: Float,
        teamPlayerMinimumMatchingRows: Int,
        teamOpponentMinimumMatchingRows: Int,
        homeTileMinimumFraction: Float,
        homeMinimumMatchingTiles: Int,
        homeNavigationMinimumFraction: Float,
        battleResultPanelMinimumFraction: Float,
        battleResultButtonMinimumFraction: Float,
        battleResultMinimumMatchingPanels: Int,
        battleResultMinimumMatchingButtons: Int,
        partyPanelMinimumFraction: Float,
        playerHUDMinimumFraction: Float,
        opponentHUDMinimumFraction: Float
    ) throws {
        guard sampleStride > 0 else {
            throw SceneDetectionError.invalidCount("sampleStride", sampleStride)
        }
        guard teamPlayerMinimumMatchingRows > 0,
              teamPlayerMinimumMatchingRows <= teamPlayerRowRegions.count else {
            throw SceneDetectionError.invalidCount(
                "teamPlayerMinimumMatchingRows",
                teamPlayerMinimumMatchingRows
            )
        }
        guard teamOpponentMinimumMatchingRows > 0,
              teamOpponentMinimumMatchingRows <= teamOpponentRowRegions.count else {
            throw SceneDetectionError.invalidCount(
                "teamOpponentMinimumMatchingRows",
                teamOpponentMinimumMatchingRows
            )
        }
        guard homeMinimumMatchingTiles > 0,
              homeMinimumMatchingTiles <= homeTileRegions.count else {
            throw SceneDetectionError.invalidCount(
                "homeMinimumMatchingTiles",
                homeMinimumMatchingTiles
            )
        }
        guard battleResultMinimumMatchingPanels > 0,
              battleResultMinimumMatchingPanels <= battleResultPanelRegions.count else {
            throw SceneDetectionError.invalidCount(
                "battleResultMinimumMatchingPanels",
                battleResultMinimumMatchingPanels
            )
        }
        guard battleResultMinimumMatchingButtons > 0,
              battleResultMinimumMatchingButtons <= battleResultButtonRegions.count else {
            throw SceneDetectionError.invalidCount(
                "battleResultMinimumMatchingButtons",
                battleResultMinimumMatchingButtons
            )
        }
        try Self.validateScore(teamPlayerRowMinimumFraction, name: "teamPlayerRowMinimumFraction")
        try Self.validateScore(teamOpponentRowMinimumFraction, name: "teamOpponentRowMinimumFraction")
        try Self.validateScore(homeTileMinimumFraction, name: "homeTileMinimumFraction")
        try Self.validateScore(homeNavigationMinimumFraction, name: "homeNavigationMinimumFraction")
        try Self.validateScore(
            battleResultPanelMinimumFraction,
            name: "battleResultPanelMinimumFraction"
        )
        try Self.validateScore(
            battleResultButtonMinimumFraction,
            name: "battleResultButtonMinimumFraction"
        )
        try Self.validateScore(partyPanelMinimumFraction, name: "partyPanelMinimumFraction")
        try Self.validateScore(playerHUDMinimumFraction, name: "playerHUDMinimumFraction")
        try Self.validateScore(opponentHUDMinimumFraction, name: "opponentHUDMinimumFraction")
        self.profile = profile
        self.teamPlayerRowRegions = teamPlayerRowRegions
        self.teamOpponentRowRegions = teamOpponentRowRegions
        self.homeTileRegions = homeTileRegions
        self.homeNavigationRegion = homeNavigationRegion
        self.battleResultPanelRegions = battleResultPanelRegions
        self.battleResultButtonRegions = battleResultButtonRegions
        self.partyPanelRegion = partyPanelRegion
        self.sampleStride = sampleStride
        self.teamPlayerRowMinimumFraction = teamPlayerRowMinimumFraction
        self.teamOpponentRowMinimumFraction = teamOpponentRowMinimumFraction
        self.teamPlayerMinimumMatchingRows = teamPlayerMinimumMatchingRows
        self.teamOpponentMinimumMatchingRows = teamOpponentMinimumMatchingRows
        self.homeTileMinimumFraction = homeTileMinimumFraction
        self.homeMinimumMatchingTiles = homeMinimumMatchingTiles
        self.homeNavigationMinimumFraction = homeNavigationMinimumFraction
        self.battleResultPanelMinimumFraction = battleResultPanelMinimumFraction
        self.battleResultButtonMinimumFraction = battleResultButtonMinimumFraction
        self.battleResultMinimumMatchingPanels = battleResultMinimumMatchingPanels
        self.battleResultMinimumMatchingButtons = battleResultMinimumMatchingButtons
        self.partyPanelMinimumFraction = partyPanelMinimumFraction
        self.playerHUDMinimumFraction = playerHUDMinimumFraction
        self.opponentHUDMinimumFraction = opponentHUDMinimumFraction
    }

    public static func ipadBattleHUDV1() throws -> SceneVisualObservationExtractor {
        let profile = try CaptureLayoutProfile.ipadBattleHUDV1()
        return try SceneVisualObservationExtractor(
            profile: profile,
            teamPlayerRowRegions: try Self.teamSelectionRowRegions(
                topLeftX: 0.04,
                width: 0.27
            ),
            teamOpponentRowRegions: try Self.teamSelectionRowRegions(
                topLeftX: 0.81,
                width: 0.16
            ),
            homeTileRegions: [
                try NormalizedRegion(
                    topLeftX: 0.78,
                    topLeftY: 0.23,
                    width: 0.18,
                    height: 0.12
                ),
                try NormalizedRegion(
                    topLeftX: 0.78,
                    topLeftY: 0.56,
                    width: 0.18,
                    height: 0.10
                ),
            ],
            homeNavigationRegion: NormalizedRegion(
                topLeftX: 0.20,
                topLeftY: 0.82,
                width: 0.58,
                height: 0.17
            ),
            battleResultPanelRegions: [
                try NormalizedRegion(
                    topLeftX: 0.58,
                    topLeftY: 0.22,
                    width: 0.37,
                    height: 0.25
                ),
                try NormalizedRegion(
                    topLeftX: 0.58,
                    topLeftY: 0.55,
                    width: 0.37,
                    height: 0.08
                ),
                try NormalizedRegion(
                    topLeftX: 0.58,
                    topLeftY: 0.68,
                    width: 0.37,
                    height: 0.12
                ),
            ],
            battleResultButtonRegions: [
                try NormalizedRegion(
                    topLeftX: 0.02,
                    topLeftY: 0.89,
                    width: 0.26,
                    height: 0.06
                ),
                try NormalizedRegion(
                    topLeftX: 0.36,
                    topLeftY: 0.89,
                    width: 0.28,
                    height: 0.06
                ),
                try NormalizedRegion(
                    topLeftX: 0.72,
                    topLeftY: 0.89,
                    width: 0.26,
                    height: 0.06
                ),
            ],
            partyPanelRegion: NormalizedRegion(
                topLeftX: 0.32,
                topLeftY: 0.14,
                width: 0.36,
                height: 0.64
            ),
            sampleStride: 4,
            teamPlayerRowMinimumFraction: 0.42,
            teamOpponentRowMinimumFraction: 0.42,
            teamPlayerMinimumMatchingRows: 5,
            teamOpponentMinimumMatchingRows: 5,
            homeTileMinimumFraction: 0.30,
            homeMinimumMatchingTiles: 2,
            homeNavigationMinimumFraction: 0.08,
            battleResultPanelMinimumFraction: 0.45,
            battleResultButtonMinimumFraction: 0.55,
            battleResultMinimumMatchingPanels: 3,
            battleResultMinimumMatchingButtons: 3,
            partyPanelMinimumFraction: 0.45,
            playerHUDMinimumFraction: 0.20,
            opponentHUDMinimumFraction: 0.20
        )
    }

    public func extract(
        pixelBuffer: CVPixelBuffer,
        orientation: CGImagePropertyOrientation
    ) throws -> SceneVisualObservation {
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        try profile.validate(width: width, height: height, orientation: orientation)

        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
            throw SceneDetectionError.missingPixelBufferBaseAddress
        }
        let bytes = baseAddress.assumingMemoryBound(to: UInt8.self)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let matchingPlayerRows = try matchingRegionCount(
            bytes: bytes,
            bytesPerRow: bytesPerRow,
            frameWidth: width,
            frameHeight: height,
            regions: teamPlayerRowRegions,
            regionName: "teamPlayerRowRegion",
            minimumFraction: teamPlayerRowMinimumFraction,
            matches: Self.matchesPlayerTeamPanel
        )
        let matchingOpponentRows = try matchingRegionCount(
            bytes: bytes,
            bytesPerRow: bytesPerRow,
            frameWidth: width,
            frameHeight: height,
            regions: teamOpponentRowRegions,
            regionName: "teamOpponentRowRegion",
            minimumFraction: teamOpponentRowMinimumFraction,
            matches: Self.matchesRedTeamPanel
        )
        let matchingHomeTiles = try matchingRegionCount(
            bytes: bytes,
            bytesPerRow: bytesPerRow,
            frameWidth: width,
            frameHeight: height,
            regions: homeTileRegions,
            regionName: "homeTileRegion",
            minimumFraction: homeTileMinimumFraction,
            matches: Self.matchesHomeTileSurface
        )
        let homeNavigationFraction = try matchingFraction(
            bytes: bytes,
            bytesPerRow: bytesPerRow,
            frameWidth: width,
            frameHeight: height,
            region: homeNavigationRegion,
            regionName: "homeNavigationRegion",
            matches: Self.matchesHomeNavigationSurface
        )
        let matchingBattleResultPanels = try matchingRegionCount(
            bytes: bytes,
            bytesPerRow: bytesPerRow,
            frameWidth: width,
            frameHeight: height,
            regions: battleResultPanelRegions,
            regionName: "battleResultPanelRegion",
            minimumFraction: battleResultPanelMinimumFraction,
            matches: Self.matchesBattleResultPanel
        )
        let matchingBattleResultButtons = try matchingRegionCount(
            bytes: bytes,
            bytesPerRow: bytesPerRow,
            frameWidth: width,
            frameHeight: height,
            regions: battleResultButtonRegions,
            regionName: "battleResultButtonRegion",
            minimumFraction: battleResultButtonMinimumFraction,
            matches: Self.matchesBattleResultButton
        )
        let partyPanelFraction = try matchingFraction(
            bytes: bytes,
            bytesPerRow: bytesPerRow,
            frameWidth: width,
            frameHeight: height,
            region: partyPanelRegion,
            regionName: "partyPanelRegion",
            matches: Self.matchesPurplePartyPanel
        )
        let playerPlateFraction = try matchingFraction(
            bytes: bytes,
            bytesPerRow: bytesPerRow,
            frameWidth: width,
            frameHeight: height,
            region: profile.nameRegions.region(for: .player),
            regionName: "playerHUDRegion",
            matches: Self.matchesPlayerHUDPlate
        )
        let opponentPlateFraction = try matchingFraction(
            bytes: bytes,
            bytesPerRow: bytesPerRow,
            frameWidth: width,
            frameHeight: height,
            region: profile.nameRegions.region(for: .opponent),
            regionName: "opponentHUDRegion",
            matches: Self.matchesOpponentHUDPlate
        )
        let teamSelectionEvidence = matchingPlayerRows >= teamPlayerMinimumMatchingRows
            && matchingOpponentRows >= teamOpponentMinimumMatchingRows
        let outOfBattleEvidence = matchingHomeTiles >= homeMinimumMatchingTiles
            && homeNavigationFraction >= homeNavigationMinimumFraction
        let battleResultEvidence = matchingBattleResultPanels
            >= battleResultMinimumMatchingPanels
            && matchingBattleResultButtons >= battleResultMinimumMatchingButtons
        let partyOverviewEvidence = partyPanelFraction >= partyPanelMinimumFraction
        let menuIsVisible = outOfBattleEvidence
            || battleResultEvidence
            || teamSelectionEvidence
            || partyOverviewEvidence
        let playerHUD: HUDVisibility = !menuIsVisible
            && playerPlateFraction >= playerHUDMinimumFraction ? .visible : .hidden
        let opponentHUD: HUDVisibility = !menuIsVisible
            && opponentPlateFraction >= opponentHUDMinimumFraction ? .visible : .hidden

        return SceneVisualObservation(
            playerHUD: playerHUD,
            opponentHUD: opponentHUD,
            outOfBattleEvidence: outOfBattleEvidence,
            battleResultEvidence: battleResultEvidence,
            teamSelectionEvidence: teamSelectionEvidence,
            partyOverviewEvidence: partyOverviewEvidence
        )
    }

    private static func teamSelectionRowRegions(
        topLeftX: CGFloat,
        width: CGFloat
    ) throws -> [NormalizedRegion] {
        let rowTopEdges: [CGFloat] = [0.20, 0.29, 0.385, 0.48, 0.575, 0.665]
        return try rowTopEdges.map { topLeftY in
            try NormalizedRegion(
                topLeftX: topLeftX,
                topLeftY: topLeftY,
                width: width,
                height: 0.07
            )
        }
    }

    private func matchingRegionCount(
        bytes: UnsafePointer<UInt8>,
        bytesPerRow: Int,
        frameWidth: Int,
        frameHeight: Int,
        regions: [NormalizedRegion],
        regionName: String,
        minimumFraction: Float,
        matches: (Float, Float, Float) -> Bool
    ) throws -> Int {
        var matchingCount = 0
        for (index, region) in regions.enumerated() {
            let fraction = try matchingFraction(
                bytes: bytes,
                bytesPerRow: bytesPerRow,
                frameWidth: frameWidth,
                frameHeight: frameHeight,
                region: region,
                regionName: "\(regionName)[\(index)]",
                matches: matches
            )
            if fraction >= minimumFraction {
                matchingCount += 1
            }
        }
        return matchingCount
    }

    private func matchingFraction(
        bytes: UnsafePointer<UInt8>,
        bytesPerRow: Int,
        frameWidth: Int,
        frameHeight: Int,
        region: NormalizedRegion,
        regionName: String,
        matches: (Float, Float, Float) -> Bool
    ) throws -> Float {
        let startX = max(0, Int(region.topLeftX * CGFloat(frameWidth)))
        let startY = max(0, Int(region.topLeftY * CGFloat(frameHeight)))
        let endX = min(frameWidth, Int(ceil((region.topLeftX + region.width) * CGFloat(frameWidth))))
        let endY = min(frameHeight, Int(ceil((region.topLeftY + region.height) * CGFloat(frameHeight))))
        guard startX < endX, startY < endY else {
            throw SceneDetectionError.emptyPixelRegion(regionName)
        }
        var sampledCount = 0
        var matchingCount = 0
        for y in stride(from: startY, to: endY, by: sampleStride) {
            for x in stride(from: startX, to: endX, by: sampleStride) {
                let offset = y * bytesPerRow + x * 4
                let blue = Float(bytes[offset]) / 255
                let green = Float(bytes[offset + 1]) / 255
                let red = Float(bytes[offset + 2]) / 255
                sampledCount += 1
                if matches(red, green, blue) {
                    matchingCount += 1
                }
            }
        }
        guard sampledCount > 0 else {
            throw SceneDetectionError.emptyPixelRegion(regionName)
        }
        return Float(matchingCount) / Float(sampledCount)
    }

    private static func matchesBlueTeamPanel(red: Float, green: Float, blue: Float) -> Bool {
        blue >= 0.22 && blue > red + 0.05 && blue > green + 0.02
    }

    private static func matchesPlayerTeamPanel(red: Float, green: Float, blue: Float) -> Bool {
        if matchesBlueTeamPanel(red: red, green: green, blue: blue) {
            return true
        }
        let selectedWhite = red >= 0.55 && green >= 0.55 && blue >= 0.55
        let selectedGreen = green >= 0.45 && green > red + 0.05 && green > blue + 0.05
        return selectedWhite || selectedGreen
    }

    private static func matchesHomeTileSurface(red: Float, green: Float, blue: Float) -> Bool {
        let lightSurface = red >= 0.55 && green >= 0.50 && blue >= 0.62
        let purpleSurface = red >= 0.35 && green >= 0.30 && blue >= 0.52
            && blue > green + 0.08
        return lightSurface || purpleSurface
    }

    private static func matchesHomeNavigationSurface(red: Float, green: Float, blue: Float) -> Bool {
        blue >= 0.30 && red >= 0.18 && blue > green + 0.07
    }

    private static func matchesBattleResultPanel(red: Float, green: Float, blue: Float) -> Bool {
        blue >= 0.28 && red >= 0.12 && blue > green + 0.08
    }

    private static func matchesBattleResultButton(red: Float, green: Float, blue: Float) -> Bool {
        let purpleButton = blue >= 0.28 && red >= 0.12 && blue > green + 0.08
        let selectedButton = red >= 0.55 && green >= 0.62 && blue <= green - 0.08
        return purpleButton || selectedButton
    }

    private static func matchesRedTeamPanel(red: Float, green: Float, blue: Float) -> Bool {
        red >= 0.28 && red > green + 0.08 && blue > green - 0.03
    }

    private static func matchesPurplePartyPanel(red: Float, green: Float, blue: Float) -> Bool {
        blue >= 0.28 && red >= 0.18 && blue > green + 0.07 && red > green - 0.02
    }

    private static func matchesPlayerHUDPlate(red: Float, green: Float, blue: Float) -> Bool {
        green >= 0.28 && green > red + 0.03 && green > blue - 0.04
    }

    private static func matchesOpponentHUDPlate(red: Float, green: Float, blue: Float) -> Bool {
        red >= 0.28 && blue >= 0.18 && red > green + 0.07 && blue > green - 0.05
    }

    private static func validateScore(_ value: Float, name: String) throws -> Void {
        guard value.isFinite, value >= 0, value <= 1 else {
            throw SceneDetectionError.invalidScore(name, value)
        }
    }
}
