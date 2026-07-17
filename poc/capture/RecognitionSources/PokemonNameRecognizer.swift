import CoreGraphics
import CoreVideo
import ImageIO
import Vision

public final class PokemonNameRecognizer {
    private let regions: BattleNameRegions
    private let recognitionLanguage: String
    private let maximumCandidateCount: Int
    private let minimumTextHeight: Float
    private let maximumEditDistance: Int
    private let matcher = PokemonNameMatcher()

    public init(
        regions: BattleNameRegions,
        recognitionLanguage: String,
        maximumCandidateCount: Int,
        minimumTextHeight: Float,
        maximumEditDistance: Int
    ) throws {
        guard maximumCandidateCount > 0 else {
            throw NameRecognitionError.invalidMaximumCandidateCount(maximumCandidateCount)
        }
        guard minimumTextHeight.isFinite,
              minimumTextHeight > 0,
              minimumTextHeight <= 1 else {
            throw NameRecognitionError.invalidMinimumTextHeight(minimumTextHeight)
        }
        guard maximumEditDistance >= 0 else {
            throw NameRecognitionError.invalidMaximumEditDistance(maximumEditDistance)
        }

        let languageProbe = VNRecognizeTextRequest()
        languageProbe.recognitionLevel = .accurate
        let supportedLanguages: [String]
        do {
            supportedLanguages = try languageProbe.supportedRecognitionLanguages()
        } catch {
            throw NameRecognitionError.visionConfigurationFailed(String(describing: error))
        }
        guard supportedLanguages.contains(recognitionLanguage) else {
            throw NameRecognitionError.unsupportedRecognitionLanguage(recognitionLanguage)
        }

        self.regions = regions
        self.recognitionLanguage = recognitionLanguage
        self.maximumCandidateCount = maximumCandidateCount
        self.minimumTextHeight = minimumTextHeight
        self.maximumEditDistance = maximumEditDistance
    }

    public func recognize(
        cgImage: CGImage,
        orientation: CGImagePropertyOrientation,
        side: BattleSide,
        candidates: [PokemonNameCandidate]
    ) throws -> PokemonNameDetectionOutcome {
        let handler = VNImageRequestHandler(
            cgImage: cgImage,
            orientation: orientation,
            options: [:]
        )
        return try recognize(handler: handler, side: side, candidates: candidates)
    }

    public func recognize(
        pixelBuffer: CVPixelBuffer,
        orientation: CGImagePropertyOrientation,
        side: BattleSide,
        candidates: [PokemonNameCandidate]
    ) throws -> PokemonNameDetectionOutcome {
        let handler = VNImageRequestHandler(
            cvPixelBuffer: pixelBuffer,
            orientation: orientation,
            options: [:]
        )
        return try recognize(handler: handler, side: side, candidates: candidates)
    }

    private func recognize(
        handler: VNImageRequestHandler,
        side: BattleSide,
        candidates: [PokemonNameCandidate]
    ) throws -> PokemonNameDetectionOutcome {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = [recognitionLanguage]
        request.usesLanguageCorrection = true
        request.customWords = candidates.map(\.displayName)
        request.minimumTextHeight = minimumTextHeight
        request.regionOfInterest = regions.region(for: side).visionRegionOfInterest

        do {
            try handler.perform([request])
        } catch {
            throw NameRecognitionError.visionRequestFailed(String(describing: error))
        }
        guard let observations = request.results else {
            throw NameRecognitionError.missingVisionResults
        }
        let recognizedTexts = try observations.flatMap { observation -> [RecognizedText] in
            let topCandidates = observation.topCandidates(maximumCandidateCount)
            guard !topCandidates.isEmpty else {
                throw NameRecognitionError.missingRecognizedTextCandidate
            }
            return topCandidates.map {
                RecognizedText(text: $0.string, confidence: $0.confidence)
            }
        }
        return try matcher.match(
            recognizedTexts: recognizedTexts,
            side: side,
            candidates: candidates,
            maximumEditDistance: maximumEditDistance
        )
    }
}
