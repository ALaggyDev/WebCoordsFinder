// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "CoordsFinderMetal",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(
            name: "coordsfinder-metal",
            targets: ["CoordsFinderMetal"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "CoordsFinderMetal"
        ),
        .testTarget(
            name: "CoordsFinderMetalTests",
            dependencies: ["CoordsFinderMetal"]
        ),
    ]
)
