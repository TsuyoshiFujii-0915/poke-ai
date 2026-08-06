import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import Testing
@testable import CaptureRecognition

@Suite
struct SceneVisualObservationExtractorTests {
    @Test(arguments: [
        ("scene-out-of-battle", true, false, false, false, HUDVisibility.hidden, HUDVisibility.hidden),
        ("scene-team-selection", false, false, true, false, HUDVisibility.hidden, HUDVisibility.hidden),
        ("scene-team-selection-confirmed", false, false, true, false, HUDVisibility.hidden, HUDVisibility.hidden),
        ("scene-battle-input", false, false, false, false, HUDVisibility.visible, HUDVisibility.visible),
        ("scene-party-overview", false, false, false, true, HUDVisibility.hidden, HUDVisibility.hidden),
        ("scene-action", false, false, false, false, HUDVisibility.hidden, HUDVisibility.hidden),
        ("scene-player-switch", false, false, false, false, HUDVisibility.hidden, HUDVisibility.hidden),
        ("scene-opponent-switch", false, false, false, false, HUDVisibility.hidden, HUDVisibility.hidden),
    ])
    func extractsSceneEvidenceFromCapturedFrames(
        fixture: String,
        expectsOutOfBattle: Bool,
        expectsBattleResult: Bool,
        expectsTeamSelection: Bool,
        expectsPartyOverview: Bool,
        expectedPlayerHUD: HUDVisibility,
        expectedOpponentHUD: HUDVisibility
    ) throws -> Void {
        let extractor = try SceneVisualObservationExtractor.ipadBattleHUDV1()
        let pixelBuffer = try loadGameFramePixelBuffer(named: fixture)

        let observation = try extractor.extract(
            pixelBuffer: pixelBuffer,
            orientation: .up
        )

        #expect(observation.outOfBattleEvidence == expectsOutOfBattle)
        #expect(observation.battleResultEvidence == expectsBattleResult)
        #expect(observation.teamSelectionEvidence == expectsTeamSelection)
        #expect(observation.partyOverviewEvidence == expectsPartyOverview)
        #expect(observation.playerHUD == expectedPlayerHUD)
        #expect(observation.opponentHUD == expectedOpponentHUD)
    }

    @Test
    func extractsCompletedBattleResultEvidenceFromReferenceFrame() throws -> Void {
        let extractor = try SceneVisualObservationExtractor.ipadBattleHUDV1()
        let pixelBuffer = try loadDirectGameFramePixelBuffer(
            named: "scene-battle-result-reference"
        )

        let observation = try extractor.extract(
            pixelBuffer: pixelBuffer,
            orientation: .up
        )

        #expect(observation.battleResultEvidence)
        #expect(!observation.outOfBattleEvidence)
        #expect(!observation.teamSelectionEvidence)
        #expect(!observation.partyOverviewEvidence)
        #expect(observation.playerHUD == .hidden)
        #expect(observation.opponentHUD == .hidden)
    }

    private func loadGameFramePixelBuffer(named name: String) throws -> CVPixelBuffer {
        guard let url = Bundle.module.url(forResource: name, withExtension: "png"),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let screenshot = CGImageSourceCreateImageAtIndex(source, 0, nil),
              let gameFrame = screenshot.cropping(to: CGRect(
                  x: 130,
                  y: 13,
                  width: 637,
                  height: 443
              )) else {
            throw SceneFixtureError.unreadableImage(name)
        }
        return try makePixelBuffer(from: gameFrame)
    }

    private func loadDirectGameFramePixelBuffer(named name: String) throws -> CVPixelBuffer {
        guard let url = Bundle.module.url(forResource: name, withExtension: "png"),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let gameFrame = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw SceneFixtureError.unreadableImage(name)
        }
        return try makePixelBuffer(from: gameFrame)
    }

    private func makePixelBuffer(from gameFrame: CGImage) throws -> CVPixelBuffer {
        var pixelBuffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault,
            gameFrame.width,
            gameFrame.height,
            kCVPixelFormatType_32BGRA,
            nil,
            &pixelBuffer
        )
        guard status == kCVReturnSuccess, let pixelBuffer else {
            throw SceneFixtureError.pixelBufferCreationFailed(status)
        }
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer),
              let context = CGContext(
                  data: baseAddress,
                  width: gameFrame.width,
                  height: gameFrame.height,
                  bitsPerComponent: 8,
                  bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
                  space: CGColorSpaceCreateDeviceRGB(),
                  bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue
                      | CGImageAlphaInfo.premultipliedFirst.rawValue
              ) else {
            throw SceneFixtureError.contextCreationFailed
        }
        context.draw(
            gameFrame,
            in: CGRect(x: 0, y: 0, width: gameFrame.width, height: gameFrame.height)
        )
        return pixelBuffer
    }
}

private enum SceneFixtureError: Error {
    case unreadableImage(String)
    case pixelBufferCreationFailed(CVReturn)
    case contextCreationFailed
}
