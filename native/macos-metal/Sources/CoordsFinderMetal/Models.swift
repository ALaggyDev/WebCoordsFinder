import Foundation

enum TextureAlgorithm: UInt32, CaseIterable, Sendable {
    case vanilla1 = 0
    case vanilla2 = 1
    case vanilla3 = 2
    case sodium1 = 3
    case sodium2 = 4

    init(configValue: String) throws {
        switch configValue {
        case "Vanilla-1": self = .vanilla1
        case "Vanilla-2": self = .vanilla2
        case "Vanilla-3": self = .vanilla3
        case "Sodium-1": self = .sodium1
        case "Sodium-2": self = .sodium2
        default:
            throw ScannerError.invalidConfig(
                "algorithm must be Vanilla-1, Vanilla-2, Vanilla-3, Sodium-1, or Sodium-2"
            )
        }
    }

    var configValue: String {
        switch self {
        case .vanilla1: "Vanilla-1"
        case .vanilla2: "Vanilla-2"
        case .vanilla3: "Vanilla-3"
        case .sodium1: "Sodium-1"
        case .sodium2: "Sodium-2"
        }
    }
}

enum ScanOrder: UInt32, Sendable {
    case linear = 0
    case spiral = 1

    init(configValue: String) throws {
        switch configValue {
        case "linear": self = .linear
        case "spiral": self = .spiral
        default:
            throw ScannerError.invalidConfig("scanOrder must be linear or spiral")
        }
    }
}

struct CoordinateRange: Equatable, Sendable {
    let start: Int32
    let end: Int32

    init(start: Int32, end: Int32) throws {
        guard start <= end else {
            throw ScannerError.invalidConfig("range start must not exceed its inclusive end")
        }
        self.start = start
        self.end = end
    }

    var count: UInt64 {
        UInt64(Int64(end) - Int64(start) + 1)
    }
}

struct FilterConstraint: Equatable, Sendable {
    let x: Int32
    let y: Int32
    let z: Int32
    let rotation: UInt32
    let visibleMask: UInt32

    init(
        x: Int32,
        y: Int32,
        z: Int32,
        rotation: UInt32,
        visibleMask: UInt32
    ) throws {
        guard (-128 ... 127).contains(x),
              (-128 ... 127).contains(y),
              (-128 ... 127).contains(z)
        else {
            throw ScannerError.invalidConfig(
                "filter offsets must fit the signed-byte range -128...127"
            )
        }
        guard visibleMask == 1 || visibleMask == 3,
              rotation <= visibleMask
        else {
            throw ScannerError.invalidConfig("filter variant is invalid for its face type")
        }
        self.x = x
        self.y = y
        self.z = z
        self.rotation = rotation
        self.visibleMask = visibleMask
    }
}

struct ScanConfig: Equatable, Sendable {
    let algorithm: TextureAlgorithm
    let scanOrder: ScanOrder
    let directions: [UInt32]
    let xRange: CoordinateRange
    let yRange: CoordinateRange
    let zRange: CoordinateRange
    let errorTolerance: UInt32
    let filters: [FilterConstraint]

    init(
        algorithm: TextureAlgorithm,
        scanOrder: ScanOrder,
        directions: [UInt32],
        xRange: CoordinateRange,
        yRange: CoordinateRange,
        zRange: CoordinateRange,
        errorTolerance: UInt32,
        filters: [FilterConstraint]
    ) throws {
        guard !directions.isEmpty, directions.count <= 4 else {
            throw ScannerError.invalidConfig("directions must contain one to four quarter turns")
        }
        guard Set(directions).count == directions.count,
              directions.allSatisfy({ $0 <= 3 })
        else {
            throw ScannerError.invalidConfig(
                "directions must contain unique values from 0, 90, 180, and 270"
            )
        }
        guard !filters.isEmpty, filters.count <= 256 else {
            throw ScannerError.invalidConfig("filter must contain 1...256 rows")
        }
        for direction in directions {
            for filter in filters {
                let rotated: (x: Int32, z: Int32)
                switch direction {
                case 1: rotated = (-filter.z, filter.x)
                case 2: rotated = (-filter.x, -filter.z)
                case 3: rotated = (filter.z, -filter.x)
                default: rotated = (filter.x, filter.z)
                }
                guard (-128 ... 127).contains(rotated.x),
                      (-128 ... 127).contains(rotated.z)
                else {
                    throw ScannerError.invalidConfig(
                        "a requested direction rotates a filter outside the signed-byte range"
                    )
                }
            }
        }

        self.algorithm = algorithm
        self.scanOrder = scanOrder
        self.directions = directions
        self.xRange = xRange
        self.yRange = yRange
        self.zRange = zRange
        self.errorTolerance = errorTolerance
        self.filters = filters

        _ = try totalCandidates()
    }

    func totalCandidates() throws -> UInt64 {
        var total = xRange.count
        total = try checkedMultiply(total, zRange.count, label: "X/Z search area")
        total = try checkedMultiply(total, UInt64(directions.count), label: "directional search area")
        return try checkedMultiply(total, yRange.count, label: "search volume")
    }

    func totalWorkItems(candidatesPerThread: UInt64) throws -> UInt64 {
        let yBlocks = (yRange.count + candidatesPerThread - 1) / candidatesPerThread
        var total = try checkedMultiply(
            xRange.count,
            zRange.count,
            label: "X/Z work area"
        )
        total = try checkedMultiply(total, UInt64(directions.count), label: "direction work area")
        return try checkedMultiply(total, yBlocks, label: "Metal work-item count")
    }
}

struct GPUFilter: Equatable, Sendable {
    let x: Int32
    let y: Int32
    let z: Int32
    let rotation: UInt32
    let visibleMask: UInt32
}

struct GPULatticeGateOffset: Equatable, Sendable {
    let x: Int32
    let y: Int32
    let z: Int32
    let filterIndex: UInt32
}

struct LatticeGatePlan: Equatable, Sendable {
    static let modulus: Int32 = 2

    let rotation: UInt32
    let yOffset: Int32
    let offsets: [GPULatticeGateOffset]
    let sampleXStart: Int32
    let sampleZStart: Int32
    let sampleXCount: UInt64
    let sampleZCount: UInt64

    var workItemCount: UInt64 {
        sampleXCount * sampleZCount
    }
}

func makeLatticeGatePlan(
    config: ScanConfig,
    directionalFilters: [GPUFilter]
) -> LatticeGatePlan? {
    guard config.errorTolerance == 0,
          config.scanOrder == .linear,
          config.directions.count == 1,
          directionalFilters.count == config.filters.count
    else { return nil }

    // The optimized kernel enumerates sample coordinates directly. Keep the
    // wrapping-coordinate edge cases on the baseline kernel so the sample
    // rectangle remains a simple, contiguous Int32 range.
    let minimumXOffset = directionalFilters.map(\.x).min() ?? 0
    let maximumXOffset = directionalFilters.map(\.x).max() ?? 0
    let minimumZOffset = directionalFilters.map(\.z).min() ?? 0
    let maximumZOffset = directionalFilters.map(\.z).max() ?? 0
    guard Int64(config.xRange.start) + Int64(minimumXOffset) >= Int64(Int32.min),
          Int64(config.xRange.end) + Int64(maximumXOffset) <= Int64(Int32.max),
          Int64(config.zRange.start) + Int64(minimumZOffset) >= Int64(Int32.min),
          Int64(config.zRange.end) + Int64(maximumZOffset) <= Int64(Int32.max)
    else { return nil }

    struct GroupKey: Hashable {
        let y: Int32
        let rotation: UInt32
    }

    var groups: [GroupKey: [Int: GPULatticeGateOffset]] = [:]
    for (index, filter) in directionalFilters.enumerated() where filter.visibleMask == 3 {
        let residueX = positiveModulo(filter.x, modulus: LatticeGatePlan.modulus)
        let residueZ = positiveModulo(filter.z, modulus: LatticeGatePlan.modulus)
        let residue = Int(residueX * LatticeGatePlan.modulus + residueZ)
        let key = GroupKey(y: filter.y, rotation: filter.rotation)
        if groups[key]?[residue] == nil {
            groups[key, default: [:]][residue] = GPULatticeGateOffset(
                x: filter.x,
                y: filter.y,
                z: filter.z,
                filterIndex: UInt32(index)
            )
        }
    }

    let requiredResidues = Int(LatticeGatePlan.modulus * LatticeGatePlan.modulus)
    let candidate = groups
        .filter { $0.value.count == requiredResidues }
        .sorted {
            if $0.key.y != $1.key.y { return $0.key.y < $1.key.y }
            return $0.key.rotation < $1.key.rotation
        }
        .first
    guard let candidate else { return nil }

    let offsets = (0 ..< requiredResidues).compactMap { candidate.value[$0] }
    guard offsets.count == requiredResidues,
          let minimumGateX = offsets.map(\.x).min(),
          let maximumGateX = offsets.map(\.x).max(),
          let minimumGateZ = offsets.map(\.z).min(),
          let maximumGateZ = offsets.map(\.z).max()
    else { return nil }

    let sampleXLow = Int64(config.xRange.start) + Int64(minimumGateX)
    let sampleXHigh = Int64(config.xRange.end) + Int64(maximumGateX)
    let sampleZLow = Int64(config.zRange.start) + Int64(minimumGateZ)
    let sampleZHigh = Int64(config.zRange.end) + Int64(maximumGateZ)
    let sampleXStart = firstMultiple(
        atLeast: sampleXLow,
        modulus: Int64(LatticeGatePlan.modulus)
    )
    let sampleZStart = firstMultiple(
        atLeast: sampleZLow,
        modulus: Int64(LatticeGatePlan.modulus)
    )
    guard sampleXStart <= sampleXHigh, sampleZStart <= sampleZHigh else { return nil }

    let sampleXCount = UInt64((sampleXHigh - sampleXStart) / 2 + 1)
    let sampleZCount = UInt64((sampleZHigh - sampleZStart) / 2 + 1)
    let (workItemCount, overflow) = sampleXCount.multipliedReportingOverflow(
        by: sampleZCount
    )
    guard !overflow, workItemCount > 0 else { return nil }

    return LatticeGatePlan(
        rotation: candidate.key.rotation,
        yOffset: candidate.key.y,
        offsets: offsets,
        sampleXStart: Int32(sampleXStart),
        sampleZStart: Int32(sampleZStart),
        sampleXCount: sampleXCount,
        sampleZCount: sampleZCount
    )
}

private func positiveModulo(_ value: Int32, modulus: Int32) -> Int32 {
    let remainder = value % modulus
    return remainder >= 0 ? remainder : remainder + modulus
}

private func firstMultiple(atLeast value: Int64, modulus: Int64) -> Int64 {
    let remainder = value % modulus
    if remainder == 0 { return value }
    return remainder > 0 ? value + modulus - remainder : value - remainder
}

func makeDirectionalFilters(_ config: ScanConfig) -> [GPUFilter] {
    config.directions.flatMap { quarterTurns in
        config.filters.map { filter in
            let transformed: (x: Int32, z: Int32)
            switch quarterTurns {
            case 1: transformed = (-filter.z, filter.x)
            case 2: transformed = (-filter.x, -filter.z)
            case 3: transformed = (filter.z, -filter.x)
            default: transformed = (filter.x, filter.z)
            }
            return GPUFilter(
                x: transformed.x,
                y: filter.y,
                z: transformed.z,
                rotation: filter.visibleMask == 3
                    ? (filter.rotation + quarterTurns) % 4
                    : filter.rotation,
                visibleMask: filter.visibleMask
            )
        }
    }
}

struct ScanMatch: Equatable, Sendable {
    let ordinal: UInt64
    let x: Int32
    let y: Int32
    let z: Int32
    let badBlocks: UInt32
    let direction: UInt32
}

struct ScanProgress: Sendable {
    let processed: UInt64
    let total: UInt64
    let matchCount: UInt64
    let checksPerSecond: Double
    let elapsed: TimeInterval
}

struct ScanSummary: Sendable {
    let processed: UInt64
    let matchCount: UInt64
    let elapsed: TimeInterval
    let deviceName: String

    var averageChecksPerSecond: Double {
        elapsed > 0 ? Double(processed) / elapsed : 0
    }
}

enum ScannerError: Error, LocalizedError, Equatable {
    case invalidArguments(String)
    case invalidConfig(String)
    case unsupportedSystem(String)
    case metal(String)

    var errorDescription: String? {
        switch self {
        case let .invalidArguments(message): "Invalid arguments: \(message)"
        case let .invalidConfig(message): "Invalid configuration: \(message)"
        case let .unsupportedSystem(message): "Unsupported system: \(message)"
        case let .metal(message): "Metal error: \(message)"
        }
    }
}

func checkedMultiply(_ left: UInt64, _ right: UInt64, label: String) throws -> UInt64 {
    let (value, overflow) = left.multipliedReportingOverflow(by: right)
    guard !overflow else {
        throw ScannerError.invalidConfig("\(label) exceeds the unsigned 64-bit scanner limit")
    }
    return value
}
