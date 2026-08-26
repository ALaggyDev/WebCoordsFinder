import XCTest
@testable import CoordsFinderMetal

final class ConfigParserTests: XCTestCase {
    func testParsesWebCoordsFinderConfigWithInclusiveBounds() throws {
        let config = try ConfigParser.parse(
            """
            # Generated locally by WebCoordsFinder.

            algorithm = Vanilla-3
            scanOrder = spiral
            directions = [0, 90, 270]

            xRange = (-2, 2)
            yRange = (-1, 1)
            zRange = (10, 11)
            errorTolerance = 2

            cpuTileSize = (1024, 1024)
            cudaTileSize = (16384, 16384)
            verbose = false

            [filter]
            1 0 -2 | 3
            -4 1 5 | 1 side
            """
        )

        XCTAssertEqual(config.algorithm, .vanilla3)
        XCTAssertEqual(config.scanOrder, .spiral)
        XCTAssertEqual(config.directions, [0, 1, 3])
        XCTAssertEqual(config.xRange, try CoordinateRange(start: -2, end: 2))
        XCTAssertEqual(config.errorTolerance, 2)
        XCTAssertEqual(config.filters.count, 2)
        XCTAssertEqual(try config.totalCandidates(), 90)
    }

    func testTransformsOffsetsAndOnlyRotatesFourStateVariants() throws {
        let normal = try FilterConstraint(
            x: 1,
            y: 0,
            z: -2,
            rotation: 3,
            visibleMask: 3
        )
        let side = try FilterConstraint(
            x: 1,
            y: 0,
            z: -2,
            rotation: 1,
            visibleMask: 1
        )
        let config = try ScanConfig(
            algorithm: .vanilla3,
            scanOrder: .linear,
            directions: [1],
            xRange: CoordinateRange(start: 0, end: 0),
            yRange: CoordinateRange(start: 0, end: 0),
            zRange: CoordinateRange(start: 0, end: 0),
            errorTolerance: 0,
            filters: [normal, side]
        )

        XCTAssertEqual(
            makeDirectionalFilters(config),
            [
                GPUFilter(x: 2, y: 0, z: 1, rotation: 0, visibleMask: 3),
                GPUFilter(x: 2, y: 0, z: 1, rotation: 1, visibleMask: 1),
            ]
        )
    }

    func testLatticeGateFindsFourStateResidueCover() throws {
        let filters = try [
            FilterConstraint(x: -2, y: -1, z: -4, rotation: 3, visibleMask: 3),
            FilterConstraint(x: -1, y: -1, z: -4, rotation: 3, visibleMask: 3),
            FilterConstraint(x: -3, y: -1, z: -3, rotation: 3, visibleMask: 3),
            FilterConstraint(x: -2, y: -1, z: -3, rotation: 3, visibleMask: 3),
            FilterConstraint(x: 0, y: 0, z: 0, rotation: 0, visibleMask: 1),
        ]
        let config = try ScanConfig(
            algorithm: .vanilla3,
            scanOrder: .linear,
            directions: [0],
            xRange: CoordinateRange(start: -10, end: 10),
            yRange: CoordinateRange(start: -4, end: 4),
            zRange: CoordinateRange(start: -10, end: 10),
            errorTolerance: 0,
            filters: filters
        )

        let plan = try XCTUnwrap(
            makeLatticeGatePlan(
                config: config,
                directionalFilters: makeDirectionalFilters(config)
            )
        )

        XCTAssertEqual(plan.rotation, 3)
        XCTAssertEqual(plan.yOffset, -1)
        XCTAssertEqual(plan.offsets.count, 4)
        XCTAssertEqual(
            Set(plan.offsets.map { "\($0.x & 1),\($0.z & 1)" }),
            Set(["0,0", "0,1", "1,0", "1,1"])
        )
        XCTAssertEqual(plan.sampleXStart & 1, 0)
        XCTAssertEqual(plan.sampleZStart & 1, 0)
    }

    func testLatticeGateFallsBackForUnsupportedSearchModes() throws {
        let filters = try [
            FilterConstraint(x: 0, y: 0, z: 0, rotation: 2, visibleMask: 3),
            FilterConstraint(x: 1, y: 0, z: 0, rotation: 2, visibleMask: 3),
            FilterConstraint(x: 0, y: 0, z: 1, rotation: 2, visibleMask: 3),
            FilterConstraint(x: 1, y: 0, z: 1, rotation: 2, visibleMask: 3),
        ]

        for (scanOrder, directions, tolerance) in [
            (ScanOrder.spiral, [UInt32(0)], UInt32(0)),
            (.linear, [UInt32(0), UInt32(1)], UInt32(0)),
            (.linear, [UInt32(0)], UInt32(1)),
        ] {
            let config = try ScanConfig(
                algorithm: .vanilla3,
                scanOrder: scanOrder,
                directions: directions,
                xRange: CoordinateRange(start: -2, end: 2),
                yRange: CoordinateRange(start: 0, end: 0),
                zRange: CoordinateRange(start: -2, end: 2),
                errorTolerance: tolerance,
                filters: filters
            )
            XCTAssertNil(
                makeLatticeGatePlan(
                    config: config,
                    directionalFilters: makeDirectionalFilters(config)
                )
            )
        }
    }

    func testRejectsUnreviewableOrOutOfContractInput() throws {
        XCTAssertThrowsError(
            try ConfigParser.parse(
                """
                algorithm = Vanilla-3
                scanOrder = linear
                directions = []
                xRange = (0, 0)
                yRange = (0, 0)
                zRange = (0, 0)
                errorTolerance = 0
                [filter]
                0 0 0 | 0
                """
            )
        )
        XCTAssertThrowsError(
            try ConfigParser.parse(
                """
                algorithm = Vanilla-3
                scanOrder = linear
                directions = [0]
                xRange = (0, 0)
                yRange = (0, 0)
                zRange = (0, 0)
                errorTolerance = 0
                [filter]
                128 0 0 | 0
                """
            )
        )
        XCTAssertThrowsError(
            try ConfigParser.parse(
                """
                algorithm = Vanilla-3
                scanOrder = linear
                directions = [180]
                xRange = (0, 0)
                yRange = (0, 0)
                zRange = (0, 0)
                errorTolerance = 0
                [filter]
                -128 0 0 | 0
                """
            )
        )
    }
}
