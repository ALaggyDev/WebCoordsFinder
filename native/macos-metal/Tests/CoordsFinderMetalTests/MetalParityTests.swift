import Metal
import XCTest
@testable import CoordsFinderMetal

final class MetalParityTests: XCTestCase {
    func testLatticeGateMatchesBaselineAcrossTextureModesAndBoundaries() throws {
        #if !arch(arm64)
        throw XCTSkip("Metal scanner parity requires Apple silicon")
        #else
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw XCTSkip("No Metal device is available")
        }
        let filters = try [
            FilterConstraint(x: -2, y: -1, z: -4, rotation: 3, visibleMask: 3),
            FilterConstraint(x: -1, y: -1, z: -4, rotation: 3, visibleMask: 3),
            FilterConstraint(x: -3, y: -1, z: -3, rotation: 3, visibleMask: 3),
            FilterConstraint(x: -2, y: -1, z: -3, rotation: 3, visibleMask: 3),
        ]

        for mode in TextureAlgorithm.allCases {
            let config = try ScanConfig(
                algorithm: mode,
                scanOrder: .linear,
                directions: [1],
                xRange: CoordinateRange(start: -8, end: 8),
                yRange: CoordinateRange(start: -2, end: 2),
                zRange: CoordinateRange(start: -8, end: 8),
                errorTolerance: 0,
                filters: filters
            )
            let baseline = try MetalScanner(
                config: config,
                device: device,
                resultCapacity: 1_024,
                enableLatticeGate: false
            )
            let optimized = try MetalScanner(
                config: config,
                device: device,
                resultCapacity: 1_024
            )
            XCTAssertEqual(optimized.optimizationDescription, "2x2 four-state lattice gate")

            var baselineMatches: [ScanMatch] = []
            let baselineSummary = try baseline.run(
                batchWorkItems: 7,
                onMatch: { baselineMatches.append($0) }
            )
            var optimizedMatches: [ScanMatch] = []
            let optimizedSummary = try optimized.run(
                batchWorkItems: 7,
                onMatch: { optimizedMatches.append($0) }
            )

            XCTAssertEqual(
                optimizedMatches.sorted { $0.ordinal < $1.ordinal },
                baselineMatches.sorted { $0.ordinal < $1.ordinal },
                mode.configValue
            )
            XCTAssertEqual(optimizedSummary.processed, baselineSummary.processed)
            XCTAssertEqual(optimizedSummary.matchCount, baselineSummary.matchCount)
        }
        #endif
    }

    func testLatticeGateRetriesOverflowedBatchesWithoutLosingMatches() throws {
        #if !arch(arm64)
        throw XCTSkip("Metal scanner parity requires Apple silicon")
        #else
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw XCTSkip("No Metal device is available")
        }
        let filters = try [
            FilterConstraint(x: -2, y: -1, z: -4, rotation: 3, visibleMask: 3),
            FilterConstraint(x: -1, y: -1, z: -4, rotation: 3, visibleMask: 3),
            FilterConstraint(x: -3, y: -1, z: -3, rotation: 3, visibleMask: 3),
            FilterConstraint(x: -2, y: -1, z: -3, rotation: 3, visibleMask: 3),
        ]
        let config = try ScanConfig(
            algorithm: .vanilla3,
            scanOrder: .linear,
            directions: [0],
            xRange: CoordinateRange(start: 0, end: 255),
            yRange: CoordinateRange(start: 0, end: 0),
            zRange: CoordinateRange(start: 0, end: 255),
            errorTolerance: 0,
            filters: filters
        )
        let baseline = try MetalScanner(
            config: config,
            device: device,
            resultCapacity: 128,
            enableLatticeGate: false
        )
        let optimized = try MetalScanner(
            config: config,
            device: device,
            resultCapacity: 128
        )
        var baselineMatches: [ScanMatch] = []
        _ = try baseline.run(
            batchWorkItems: 65_536,
            onMatch: { baselineMatches.append($0) }
        )
        var optimizedMatches: [ScanMatch] = []
        _ = try optimized.run(
            batchWorkItems: 65_536,
            onMatch: { optimizedMatches.append($0) }
        )

        XCTAssertGreaterThan(baselineMatches.count, 128)
        XCTAssertEqual(
            optimizedMatches.sorted { $0.ordinal < $1.ordinal },
            baselineMatches.sorted { $0.ordinal < $1.ordinal }
        )
        #endif
    }

    func testEveryTextureModeMatchesNativeCoordsFinderReferenceVectors() throws {
        #if !arch(arm64)
        throw XCTSkip("Metal scanner parity requires Apple silicon")
        #else
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw XCTSkip("No Metal device is available")
        }
        let expected = [
            ["-2,1,-1", "0,1,0", "1,0,1", "2,1,0", "2,0,1", "2,1,1"],
            ["1,1,-1", "2,0,0", "2,0,1"],
            [
                "-2,1,-1", "-2,1,0", "-1,0,-1", "-1,1,0", "-1,0,1",
                "-1,1,1", "0,1,1", "2,1,-1", "2,0,1", "2,1,1",
            ],
            [
                "-2,1,0", "-1,0,-1", "-1,1,-1", "0,0,-1", "0,1,1",
                "2,1,0", "2,0,1",
            ],
            ["-1,0,-1", "-1,0,1", "-1,1,1", "0,0,0", "0,1,0", "1,0,1"],
        ]

        for (modeIndex, mode) in TextureAlgorithm.allCases.enumerated() {
            let filter = try FilterConstraint(
                x: 1,
                y: 0,
                z: -1,
                rotation: 2,
                visibleMask: 3
            )
            let config = try ScanConfig(
                algorithm: mode,
                scanOrder: .linear,
                directions: [0],
                xRange: CoordinateRange(start: -2, end: 2),
                yRange: CoordinateRange(start: 0, end: 1),
                zRange: CoordinateRange(start: -1, end: 1),
                errorTolerance: 0,
                filters: [filter]
            )
            let scanner = try MetalScanner(
                config: config,
                device: device,
                resultCapacity: 128
            )
            var matches: [String] = []
            let summary = try scanner.run(
                batchWorkItems: 30,
                onMatch: { match in
                    matches.append("\(match.x),\(match.y),\(match.z)")
                }
            )

            XCTAssertEqual(matches, expected[modeIndex], mode.configValue)
            XCTAssertEqual(summary.processed, 30)
            XCTAssertEqual(summary.matchCount, UInt64(expected[modeIndex].count))
        }
        #endif
    }

    func testSpiralTraversalAndDirectionOrderMatchWebScanner() throws {
        #if !arch(arm64)
        throw XCTSkip("Metal scanner parity requires Apple silicon")
        #else
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw XCTSkip("No Metal device is available")
        }
        let filter = try FilterConstraint(
            x: 0,
            y: 0,
            z: 0,
            rotation: 0,
            visibleMask: 3
        )
        let config = try ScanConfig(
            algorithm: .vanilla3,
            scanOrder: .spiral,
            directions: [0, 1],
            xRange: CoordinateRange(start: -1, end: 1),
            yRange: CoordinateRange(start: 0, end: 0),
            zRange: CoordinateRange(start: -1, end: 1),
            errorTolerance: 1,
            filters: [filter]
        )
            let scanner = try MetalScanner(
                config: config,
                device: device,
                resultCapacity: 128
        )
        var matches: [ScanMatch] = []
        _ = try scanner.run(batchWorkItems: 5, onMatch: { matches.append($0) })

        XCTAssertEqual(
            matches.prefix(5).map { [$0.x, $0.z, Int32($0.direction)] },
            [
                [0, 0, 0], [0, 0, 90], [1, 0, 0], [1, 0, 90], [1, 1, 0],
            ]
        )
        XCTAssertEqual(Set(matches.map(\.ordinal)).count, 18)
        #endif
    }

    func testOverflowedResultBatchesAreRetriedWithoutLosingMatches() throws {
        #if !arch(arm64)
        throw XCTSkip("Metal scanner parity requires Apple silicon")
        #else
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw XCTSkip("No Metal device is available")
        }
        let filter = try FilterConstraint(
            x: 0,
            y: 0,
            z: 0,
            rotation: 0,
            visibleMask: 3
        )
        let config = try ScanConfig(
            algorithm: .vanilla3,
            scanOrder: .linear,
            directions: [0],
            xRange: CoordinateRange(start: 0, end: 255),
            yRange: CoordinateRange(start: 0, end: 0),
            zRange: CoordinateRange(start: 0, end: 0),
            errorTolerance: 1,
            filters: [filter]
        )
        let scanner = try MetalScanner(
            config: config,
            device: device,
            resultCapacity: 128
        )
        var ordinals: [UInt64] = []
        let summary = try scanner.run(
            batchWorkItems: 256,
            onMatch: { ordinals.append($0.ordinal) }
        )

        XCTAssertEqual(ordinals, Array(0 ..< 256))
        XCTAssertEqual(summary.processed, 256)
        XCTAssertEqual(summary.matchCount, 256)
        #endif
    }
}
