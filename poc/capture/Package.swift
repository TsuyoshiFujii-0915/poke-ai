// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "poke-capture-poc",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(
            name: "CaptureRecognition",
            targets: ["CaptureRecognition"]
        )
    ],
    dependencies: [
        .package(
            url: "https://github.com/swiftlang/swift-testing.git",
            revision: "d6b70f9ef9eb207729fb50e0ff32edc6f72ea474"
        )
    ],
    targets: [
        .target(
            name: "CaptureRecognition",
            path: "RecognitionSources"
        ),
        .executableTarget(
            name: "poke-capture-poc",
            dependencies: ["CaptureRecognition"],
            path: "Sources"
        ),
        .testTarget(
            name: "CaptureRecognitionTests",
            dependencies: [
                "CaptureRecognition",
                .product(name: "Testing", package: "swift-testing")
            ],
            path: "Tests/CaptureRecognitionTests",
            resources: [
                .process("Fixtures")
            ]
        )
    ]
)
