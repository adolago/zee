// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "ZeeKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v15),
    ],
    products: [
        .library(name: "ZeeKit", targets: ["ZeeKit"]),
        .library(name: "ZeeChatUI", targets: ["ZeeChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
    ],
    targets: [
        .target(
            name: "ZeeKit",
            dependencies: [
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "ZeeChatUI",
            dependencies: ["ZeeKit"],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "ZeeKitTests",
            dependencies: ["ZeeKit", "ZeeChatUI"],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
