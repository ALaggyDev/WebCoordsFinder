import Foundation

enum ConfigParser {
    static func parse(fileURL: URL) throws -> ScanConfig {
        let contents: String
        do {
            contents = try String(contentsOf: fileURL, encoding: .utf8)
        } catch {
            throw ScannerError.invalidConfig(
                "unable to read \(fileURL.path): \(error.localizedDescription)"
            )
        }
        return try parse(contents)
    }

    static func parse(_ contents: String) throws -> ScanConfig {
        var settings: [String: String] = [:]
        var filters: [FilterConstraint] = []
        var inFilter = false

        for (zeroBasedLine, rawLine) in contents.split(
            separator: "\n",
            omittingEmptySubsequences: false
        ).enumerated() {
            let lineNumber = zeroBasedLine + 1
            let uncommented = rawLine.split(
                separator: "#",
                maxSplits: 1,
                omittingEmptySubsequences: false
            )[0]
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !uncommented.isEmpty else { continue }

            if uncommented.hasPrefix("[") {
                guard uncommented == "[filter]" else {
                    throw lineError(lineNumber, "only the [filter] section is supported")
                }
                inFilter = true
                continue
            }

            if inFilter {
                filters.append(try parseFilter(uncommented, line: lineNumber))
                continue
            }

            let pair = uncommented.split(separator: "=", maxSplits: 1)
            guard pair.count == 2 else {
                throw lineError(lineNumber, "expected key = value")
            }
            let key = pair[0].trimmingCharacters(in: .whitespaces)
            let value = pair[1].trimmingCharacters(in: .whitespaces)
            guard settings[key] == nil else {
                throw lineError(lineNumber, "duplicate setting \(key)")
            }
            settings[key] = value
        }

        let supported = Set([
            "algorithm", "scanOrder", "directions", "xRange", "yRange", "zRange",
            "errorTolerance", "cpuTileSize", "cudaTileSize", "verbose",
        ])
        if let unknown = settings.keys.first(where: { !supported.contains($0) }) {
            throw ScannerError.invalidConfig("unknown setting \(unknown)")
        }

        let algorithm = try TextureAlgorithm(configValue: required("algorithm", in: settings))
        let scanOrder = try ScanOrder(configValue: required("scanOrder", in: settings))
        let directions = try parseDirections(required("directions", in: settings))
        let xRange = try parseRange(required("xRange", in: settings), label: "xRange")
        let yRange = try parseRange(required("yRange", in: settings), label: "yRange")
        let zRange = try parseRange(required("zRange", in: settings), label: "zRange")
        let toleranceText = try required("errorTolerance", in: settings)
        guard let tolerance = UInt32(toleranceText) else {
            throw ScannerError.invalidConfig("errorTolerance must be a non-negative 32-bit integer")
        }

        return try ScanConfig(
            algorithm: algorithm,
            scanOrder: scanOrder,
            directions: directions,
            xRange: xRange,
            yRange: yRange,
            zRange: zRange,
            errorTolerance: tolerance,
            filters: filters
        )
    }

    private static func required(
        _ key: String,
        in settings: [String: String]
    ) throws -> String {
        guard let value = settings[key] else {
            throw ScannerError.invalidConfig("missing required setting \(key)")
        }
        return value
    }

    private static func parseDirections(_ text: String) throws -> [UInt32] {
        let values = try parseList(text, opening: "[", closing: "]", label: "directions")
        guard !values.isEmpty else {
            throw ScannerError.invalidConfig("directions cannot be empty")
        }
        return try values.map { value in
            guard let degrees = UInt32(value), [0, 90, 180, 270].contains(degrees) else {
                throw ScannerError.invalidConfig(
                    "directions must contain only 0, 90, 180, or 270"
                )
            }
            return degrees / 90
        }
    }

    private static func parseRange(_ text: String, label: String) throws -> CoordinateRange {
        let values = try parseList(text, opening: "(", closing: ")", label: label)
        guard values.count == 2,
              let start = Int32(values[0]),
              let end = Int32(values[1])
        else {
            throw ScannerError.invalidConfig(
                "\(label) must contain two signed 32-bit integers"
            )
        }
        return try CoordinateRange(start: start, end: end)
    }

    private static func parseList(
        _ text: String,
        opening: Character,
        closing: Character,
        label: String
    ) throws -> [String] {
        guard text.first == opening, text.last == closing else {
            throw ScannerError.invalidConfig(
                "\(label) must be enclosed by \(opening) and \(closing)"
            )
        }
        let inner = text.dropFirst().dropLast().trimmingCharacters(in: .whitespaces)
        guard !inner.isEmpty else { return [] }
        return inner.split(separator: ",", omittingEmptySubsequences: false).map {
            $0.trimmingCharacters(in: .whitespaces)
        }
    }

    private static func parseFilter(_ text: String, line: Int) throws -> FilterConstraint {
        let halves = text.split(separator: "|", maxSplits: 1)
        guard halves.count == 2 else {
            throw lineError(line, "expected x y z | variant [side]")
        }
        let coordinates = halves[0].split(whereSeparator: { $0.isWhitespace })
        let variantParts = halves[1].split(whereSeparator: { $0.isWhitespace })
        guard coordinates.count == 3,
              let x = Int32(coordinates[0]),
              let y = Int32(coordinates[1]),
              let z = Int32(coordinates[2]),
              (variantParts.count == 1 || variantParts.count == 2),
              let rotation = UInt32(variantParts[0])
        else {
            throw lineError(line, "expected x y z | variant [side]")
        }
        let isSide = variantParts.count == 2
        if isSide, variantParts[1] != "side" {
            throw lineError(line, "the optional filter suffix must be side")
        }
        do {
            return try FilterConstraint(
                x: x,
                y: y,
                z: z,
                rotation: rotation,
                visibleMask: isSide ? 1 : 3
            )
        } catch let error as ScannerError {
            throw lineError(line, error.errorDescription ?? "invalid filter")
        }
    }

    private static func lineError(_ line: Int, _ message: String) -> ScannerError {
        .invalidConfig("line \(line): \(message)")
    }
}
