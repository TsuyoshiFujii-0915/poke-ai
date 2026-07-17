import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

public enum NameRegionAnalysisError: Error, Equatable {
    case incompatibleLayout(profileID: String, width: Int, height: Int)
    case incompatibleOrientation(profileID: String, orientation: CGImagePropertyOrientation)
    case unsupportedPixelFormat(OSType)
    case missingPixelBufferBaseAddress
    case invalidExtractorCount(String, Int)
    case invalidExtractorScore(String, Float)
    case signatureSizeMismatch(expected: Int, actual: Int)
    case emptySignature
    case emptyPixelRegion(BattleSide)
}

public struct CaptureLayoutProfile: Equatable, Sendable {
    public let id: String
    public let aspectRatio: CGFloat
    public let aspectRatioTolerance: CGFloat
    public let orientation: CGImagePropertyOrientation
    public let nameRegions: BattleNameRegions

    public init(
        id: String,
        aspectRatio: CGFloat,
        aspectRatioTolerance: CGFloat,
        orientation: CGImagePropertyOrientation,
        nameRegions: BattleNameRegions
    ) throws {
        guard aspectRatio.isFinite, aspectRatio > 0 else {
            throw NameRegionAnalysisError.incompatibleLayout(profileID: id, width: 0, height: 0)
        }
        guard aspectRatioTolerance.isFinite, aspectRatioTolerance >= 0 else {
            throw NameRegionAnalysisError.incompatibleLayout(profileID: id, width: 0, height: 0)
        }
        self.id = id
        self.aspectRatio = aspectRatio
        self.aspectRatioTolerance = aspectRatioTolerance
        self.orientation = orientation
        self.nameRegions = nameRegions
    }

    public static func ipadBattleHUDV1() throws -> CaptureLayoutProfile {
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
        return try CaptureLayoutProfile(
            id: "ipad-battle-hud-v1",
            aspectRatio: 2360.0 / 1640.0,
            aspectRatioTolerance: 0.002,
            orientation: .up,
            nameRegions: regions
        )
    }

    public func validate(
        width: Int,
        height: Int,
        orientation: CGImagePropertyOrientation
    ) throws -> Void {
        guard orientation == self.orientation else {
            throw NameRegionAnalysisError.incompatibleOrientation(
                profileID: id,
                orientation: orientation
            )
        }
        guard width > 0, height > 0 else {
            throw NameRegionAnalysisError.incompatibleLayout(
                profileID: id,
                width: width,
                height: height
            )
        }
        let actualAspectRatio = CGFloat(width) / CGFloat(height)
        guard abs(actualAspectRatio - aspectRatio) <= aspectRatioTolerance else {
            throw NameRegionAnalysisError.incompatibleLayout(
                profileID: id,
                width: width,
                height: height
            )
        }
    }
}

public struct NameRegionSignature: Equatable, Sendable {
    public let hudVisibility: HUDVisibility
    let values: [Float]

    public init(values: [Float], hudVisibility: HUDVisibility) {
        self.values = values
        self.hudVisibility = hudVisibility
    }

    public func difference(from baseline: NameRegionSignature) throws -> Float {
        guard values.count == baseline.values.count else {
            throw NameRegionAnalysisError.signatureSizeMismatch(
                expected: baseline.values.count,
                actual: values.count
            )
        }
        guard !values.isEmpty else {
            throw NameRegionAnalysisError.emptySignature
        }
        let total = zip(values, baseline.values).reduce(Float.zero) { partial, pair in
            partial + abs(pair.0 - pair.1)
        }
        return total / Float(values.count)
    }
}

public struct NameRegionSignatureExtractor: Sendable {
    private let profile: CaptureLayoutProfile
    private let columnCount: Int
    private let rowCount: Int
    private let brightLuminanceThreshold: Float
    private let minimumBrightPixelFraction: Float
    private let minimumLuminanceRange: Float

    public init(
        profile: CaptureLayoutProfile,
        columnCount: Int,
        rowCount: Int,
        brightLuminanceThreshold: Float,
        minimumBrightPixelFraction: Float,
        minimumLuminanceRange: Float
    ) throws {
        guard columnCount > 0 else {
            throw NameRegionAnalysisError.invalidExtractorCount("columnCount", columnCount)
        }
        guard rowCount > 0 else {
            throw NameRegionAnalysisError.invalidExtractorCount("rowCount", rowCount)
        }
        try Self.validateScore(brightLuminanceThreshold, name: "brightLuminanceThreshold")
        try Self.validateScore(minimumBrightPixelFraction, name: "minimumBrightPixelFraction")
        try Self.validateScore(minimumLuminanceRange, name: "minimumLuminanceRange")
        self.profile = profile
        self.columnCount = columnCount
        self.rowCount = rowCount
        self.brightLuminanceThreshold = brightLuminanceThreshold
        self.minimumBrightPixelFraction = minimumBrightPixelFraction
        self.minimumLuminanceRange = minimumLuminanceRange
    }

    public func extract(
        pixelBuffer: CVPixelBuffer,
        orientation: CGImagePropertyOrientation,
        side: BattleSide
    ) throws -> NameRegionSignature {
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        try profile.validate(width: width, height: height, orientation: orientation)
        let pixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer)
        guard pixelFormat == kCVPixelFormatType_32BGRA else {
            throw NameRegionAnalysisError.unsupportedPixelFormat(pixelFormat)
        }

        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
            throw NameRegionAnalysisError.missingPixelBufferBaseAddress
        }
        let bytes = baseAddress.assumingMemoryBound(to: UInt8.self)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let region = profile.nameRegions.region(for: side)
        let startX = max(0, Int(region.topLeftX * CGFloat(width)))
        let startY = max(0, Int(region.topLeftY * CGFloat(height)))
        let endX = min(width, Int(ceil((region.topLeftX + region.width) * CGFloat(width))))
        let endY = min(height, Int(ceil((region.topLeftY + region.height) * CGFloat(height))))
        let cropWidth = endX - startX
        let cropHeight = endY - startY
        guard cropWidth > 0, cropHeight > 0 else {
            throw NameRegionAnalysisError.emptyPixelRegion(side)
        }

        var values: [Float] = []
        values.reserveCapacity(columnCount * rowCount)
        var brightPixelCount = 0
        var sourceMinimum = Float.greatestFiniteMagnitude
        var sourceMaximum = -Float.greatestFiniteMagnitude

        for row in 0..<rowCount {
            let cellStartY = startY + row * cropHeight / rowCount
            let cellEndY = startY + (row + 1) * cropHeight / rowCount
            for column in 0..<columnCount {
                let cellStartX = startX + column * cropWidth / columnCount
                let cellEndX = startX + (column + 1) * cropWidth / columnCount
                var total = Float.zero
                var count = 0
                for y in cellStartY..<max(cellStartY + 1, cellEndY) {
                    for x in cellStartX..<max(cellStartX + 1, cellEndX) {
                        let offset = y * bytesPerRow + x * 4
                        let blue = Float(bytes[offset]) / 255
                        let green = Float(bytes[offset + 1]) / 255
                        let red = Float(bytes[offset + 2]) / 255
                        let luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
                        total += luminance
                        count += 1
                        if luminance >= brightLuminanceThreshold { brightPixelCount += 1 }
                        sourceMinimum = min(sourceMinimum, luminance)
                        sourceMaximum = max(sourceMaximum, luminance)
                    }
                }
                values.append(total / Float(count))
            }
        }

        let sampledPixelCount = cropWidth * cropHeight
        let brightFraction = Float(brightPixelCount) / Float(sampledPixelCount)
        let luminanceRange = sourceMaximum - sourceMinimum
        let visibility: HUDVisibility = brightFraction >= minimumBrightPixelFraction
            && luminanceRange >= minimumLuminanceRange
            ? .visible
            : .hidden
        return NameRegionSignature(values: values, hudVisibility: visibility)
    }

    private static func validateScore(_ value: Float, name: String) throws -> Void {
        guard value.isFinite, value >= 0, value <= 1 else {
            throw NameRegionAnalysisError.invalidExtractorScore(name, value)
        }
    }
}

public struct NameRegionAnalysis: Equatable, Sendable {
    public let observation: NameRegionFrameObservation
    public let signature: NameRegionSignature

    public init(observation: NameRegionFrameObservation, signature: NameRegionSignature) {
        self.observation = observation
        self.signature = signature
    }
}

public struct LiveNameRegionAnalyzer: Sendable {
    private let extractor: NameRegionSignatureExtractor
    private var previousSignatures: [BattleSide: NameRegionSignature] = [:]
    private var confirmedSignatures: [BattleSide: NameRegionSignature] = [:]

    public init(extractor: NameRegionSignatureExtractor) {
        self.extractor = extractor
    }

    public mutating func analyze(
        pixelBuffer: CVPixelBuffer,
        orientation: CGImagePropertyOrientation,
        side: BattleSide,
        frameID: UInt64,
        monotonicTimestamp: TimeInterval
    ) throws -> NameRegionAnalysis {
        let signature = try extractor.extract(
            pixelBuffer: pixelBuffer,
            orientation: orientation,
            side: side
        )
        let previousDifference: Float
        if let previous = previousSignatures[side] {
            previousDifference = try signature.difference(from: previous)
        } else {
            previousDifference = 0
        }
        let confirmedDifference: ConfirmedRegionDifference
        if let confirmed = confirmedSignatures[side] {
            confirmedDifference = .score(try signature.difference(from: confirmed))
        } else {
            confirmedDifference = .unavailable
        }
        previousSignatures[side] = signature
        return NameRegionAnalysis(
            observation: NameRegionFrameObservation(
                frameID: frameID,
                monotonicTimestamp: monotonicTimestamp,
                hudVisibility: signature.hudVisibility,
                differenceFromPrevious: previousDifference,
                differenceFromConfirmed: confirmedDifference
            ),
            signature: signature
        )
    }

    public mutating func confirm(signature: NameRegionSignature, side: BattleSide) -> Void {
        confirmedSignatures[side] = signature
    }
}
