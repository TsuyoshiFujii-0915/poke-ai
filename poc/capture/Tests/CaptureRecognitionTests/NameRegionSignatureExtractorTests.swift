import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import Testing
@testable import CaptureRecognition

@Suite
struct NameRegionSignatureExtractorTests {
    @Test
    func acceptsProportionalIPadFramesAndRejectsSwitchLayout() throws -> Void {
        let profile = try CaptureLayoutProfile.ipadBattleHUDV1()

        try profile.validate(width: 806, height: 560, orientation: .up)
        do {
            try profile.validate(width: 1920, height: 1080, orientation: .up)
            Issue.record("Expected a 16:9 frame to be rejected")
        } catch {
            #expect(error as? NameRegionAnalysisError == .incompatibleLayout(
                profileID: "ipad-battle-hud-v1",
                width: 1920,
                height: 1080
            ))
        }
    }

    @Test
    func extractsVisibleHudAndDetectsChangedPlayerName() throws -> Void {
        let profile = try CaptureLayoutProfile.ipadBattleHUDV1()
        let extractor = try NameRegionSignatureExtractor(
            profile: profile,
            columnCount: 32,
            rowCount: 12,
            brightLuminanceThreshold: 0.65,
            minimumBrightPixelFraction: 0.01,
            minimumLuminanceRange: 0.15
        )
        let meowscarada = try loadPixelBuffer(named: "meowscarada-vs-archaludon")
        let gyarados = try loadPixelBuffer(named: "gyarados-vs-archaludon")

        let first = try extractor.extract(pixelBuffer: meowscarada, orientation: .up, side: .player)
        let second = try extractor.extract(pixelBuffer: gyarados, orientation: .up, side: .player)

        #expect(first.hudVisibility == .visible)
        #expect(second.hudVisibility == .visible)
        #expect(try first.difference(from: first) == 0)
        #expect(try second.difference(from: first) > 0.02)
    }

    @Test
    func analyzerReportsConfirmedDifferenceOnlyAfterExplicitConfirmation() throws -> Void {
        let profile = try CaptureLayoutProfile.ipadBattleHUDV1()
        let extractor = try NameRegionSignatureExtractor(
            profile: profile,
            columnCount: 32,
            rowCount: 12,
            brightLuminanceThreshold: 0.65,
            minimumBrightPixelFraction: 0.01,
            minimumLuminanceRange: 0.15
        )
        var analyzer = LiveNameRegionAnalyzer(extractor: extractor)
        let firstBuffer = try loadPixelBuffer(named: "meowscarada-vs-archaludon")
        let secondBuffer = try loadPixelBuffer(named: "gyarados-vs-archaludon")

        let first = try analyzer.analyze(
            pixelBuffer: firstBuffer,
            orientation: .up,
            side: .player,
            frameID: 1,
            monotonicTimestamp: 0
        )
        #expect(first.observation.differenceFromConfirmed == .unavailable)
        analyzer.confirm(signature: first.signature, side: .player)

        let second = try analyzer.analyze(
            pixelBuffer: secondBuffer,
            orientation: .up,
            side: .player,
            frameID: 2,
            monotonicTimestamp: 0.125
        )
        guard case let .score(score) = second.observation.differenceFromConfirmed else {
            Issue.record("Expected an explicit confirmed-frame difference")
            return
        }
        #expect(score > 0.02)
    }

    private func loadPixelBuffer(named name: String) throws -> CVPixelBuffer {
        guard let url = Bundle.module.url(forResource: name, withExtension: "png"),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw SignatureFixtureError.unreadableImage(name)
        }
        var pixelBuffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault,
            image.width,
            image.height,
            kCVPixelFormatType_32BGRA,
            nil,
            &pixelBuffer
        )
        guard status == kCVReturnSuccess, let pixelBuffer else {
            throw SignatureFixtureError.pixelBufferCreationFailed(status)
        }
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer),
              let context = CGContext(
                  data: baseAddress,
                  width: image.width,
                  height: image.height,
                  bitsPerComponent: 8,
                  bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
                  space: CGColorSpaceCreateDeviceRGB(),
                  bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue
                      | CGImageAlphaInfo.premultipliedFirst.rawValue
              ) else {
            throw SignatureFixtureError.contextCreationFailed
        }
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return pixelBuffer
    }
}

private enum SignatureFixtureError: Error {
    case unreadableImage(String)
    case pixelBufferCreationFailed(CVReturn)
    case contextCreationFailed
}
