import Darwin
import Foundation

private let version = "0.1.0"

private struct CLIOptions {
    var configPath: String?
    var batchWorkItems = MetalScanner.defaultBatchWorkItems
    var validateOnly = false
    var quietProgress = false
    var disableLatticeGate = false
    var showHelp = false
    var showVersion = false

    static func parse(_ arguments: [String]) throws -> CLIOptions {
        var options = CLIOptions()
        var index = 0
        while index < arguments.count {
            let argument = arguments[index]
            switch argument {
            case "-h", "--help":
                options.showHelp = true
            case "-v", "--version":
                options.showVersion = true
            case "-e", "--validate":
                options.validateOnly = true
            case "--quiet-progress":
                options.quietProgress = true
            case "--no-lattice-gate":
                options.disableLatticeGate = true
            case "--batch-work-items":
                index += 1
                guard index < arguments.count,
                      let value = Int(arguments[index])
                else {
                    throw ScannerError.invalidArguments(
                        "--batch-work-items requires an integer"
                    )
                }
                options.batchWorkItems = value
            default:
                if argument.hasPrefix("--batch-work-items=") {
                    let valueText = String(argument.dropFirst("--batch-work-items=".count))
                    guard let value = Int(valueText) else {
                        throw ScannerError.invalidArguments(
                            "--batch-work-items requires an integer"
                        )
                    }
                    options.batchWorkItems = value
                } else if argument.hasPrefix("-") {
                    throw ScannerError.invalidArguments("unknown option \(argument)")
                } else if options.configPath == nil {
                    options.configPath = argument
                } else {
                    throw ScannerError.invalidArguments("provide exactly one config file")
                }
            }
            index += 1
        }
        return options
    }
}

private let usage = """
CoordsFinder Metal \(version)

Usage:
  coordsfinder-metal <coordsfinder.conf> [options]

Options:
  -e, --validate              Validate and summarize without scanning
      --batch-work-items N    Initial GPU batch size (default: \(MetalScanner.defaultBatchWorkItems))
      --quiet-progress        Suppress periodic progress on stderr
      --no-lattice-gate       Disable the exact 2x2 Metal prefilter
  -v, --version               Print the version
  -h, --help                  Show this help

The scanner uses inclusive ranges, matching configs exported by WebCoordsFinder.
It requires an Apple-silicon Mac with Metal support.
"""

private func writeError(_ text: String, terminator: String = "\n") {
    FileHandle.standardError.write(Data((text + terminator).utf8))
}

private func grouped(_ value: UInt64) -> String {
    value.formatted(.number.grouping(.automatic))
}

private func formattedRate(_ value: Double) -> String {
    if value >= 1_000_000_000 {
        return String(format: "%.2f Gpos/s", value / 1_000_000_000)
    }
    if value >= 1_000_000 {
        return String(format: "%.2f Mpos/s", value / 1_000_000)
    }
    if value >= 1_000 {
        return String(format: "%.2f Kpos/s", value / 1_000)
    }
    return String(format: "%.0f pos/s", value)
}

do {
    let options = try CLIOptions.parse(Array(CommandLine.arguments.dropFirst()))
    if options.showHelp {
        print(usage)
        exit(EXIT_SUCCESS)
    }
    if options.showVersion {
        print("coordsfinder-metal \(version)")
        exit(EXIT_SUCCESS)
    }
    guard let configPath = options.configPath else {
        throw ScannerError.invalidArguments("a coordsfinder.conf path is required")
    }

    let config = try ConfigParser.parse(
        fileURL: URL(fileURLWithPath: configPath)
    )
    let total = try config.totalCandidates()
    print("CoordsFinder Metal \(version)")
    print("Algorithm: \(config.algorithm.configValue)")
    print("Scan order: \(config.scanOrder == .linear ? "linear" : "spiral")")
    print("Directions: \(config.directions.map { String($0 * 90) }.joined(separator: ", "))")
    print("Filters: \(config.filters.count)")
    print("Candidates: \(grouped(total)) (inclusive bounds)")

    if options.validateOnly {
        print("Configuration is valid.")
        exit(EXIT_SUCCESS)
    }

    let scanner = try MetalScanner(
        config: config,
        enableLatticeGate: !options.disableLatticeGate
    )
    print("GPU: \(scanner.deviceName)")
    print("Metal threadgroup: \(scanner.threadsPerThreadgroup) threads")
    print("Metal search path: \(scanner.optimizationDescription)")
    print("Scanning…")

    var lastProgressPrint = -Double.infinity
    let summary = try scanner.run(
        batchWorkItems: options.batchWorkItems,
        onMatch: { match in
            print(
                "MATCH \(match.x) \(match.y) \(match.z)"
                    + " | errors \(match.badBlocks)"
                    + " | direction \(match.direction)"
            )
        },
        onProgress: { progress in
            guard !options.quietProgress,
                  progress.elapsed - lastProgressPrint >= 1
                    || progress.processed == progress.total
            else { return }
            lastProgressPrint = progress.elapsed
            let percent = progress.total > 0
                ? Double(progress.processed) * 100 / Double(progress.total)
                : 100
            writeError(
                String(
                    format: "Progress: %.2f%% — %@ — %@ — %@ matches",
                    percent,
                    grouped(progress.processed),
                    formattedRate(progress.checksPerSecond),
                    grouped(progress.matchCount)
                )
            )
        }
    )

    print(
        "Completed \(grouped(summary.processed)) candidates in "
            + String(format: "%.3f s", summary.elapsed)
            + " at \(formattedRate(summary.averageChecksPerSecond))."
    )
    print("Matches: \(grouped(summary.matchCount))")
} catch {
    writeError(error.localizedDescription)
    writeError("Run with --help for usage.")
    exit(EXIT_FAILURE)
}
