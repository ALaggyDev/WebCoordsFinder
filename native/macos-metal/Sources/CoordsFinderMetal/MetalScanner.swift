import Foundation
import Metal

final class MetalScanner {
    static let candidatesPerThread: UInt64 = 128
    static let defaultBatchWorkItems = 1_048_576
    static let defaultResultCapacity = 65_536
    static let maximumBatchWorkItems = Int(UInt32.max) / Int(candidatesPerThread)

    let deviceName: String
    let threadsPerThreadgroup: Int
    let optimizationDescription: String

    private let config: ScanConfig
    private let device: any MTLDevice
    private let commandQueue: any MTLCommandQueue
    private let pipeline: any MTLComputePipelineState
    private let latticePipeline: (any MTLComputePipelineState)?
    private let latticeGatePlan: LatticeGatePlan?
    private let filterBuffer: any MTLBuffer
    private let directionBuffer: any MTLBuffer
    private let latticeGateOffsetBuffer: (any MTLBuffer)?
    private let resultCountBuffer: any MTLBuffer
    private let resultOverflowBuffer: any MTLBuffer
    private let resultOrdinalBuffer: any MTLBuffer
    private let resultCoordinateBuffer: any MTLBuffer
    private let resultDirectionBuffer: any MTLBuffer
    private let resultCapacity: Int

    init(
        config: ScanConfig,
        device requestedDevice: (any MTLDevice)? = nil,
        resultCapacity: Int = MetalScanner.defaultResultCapacity,
        enableLatticeGate: Bool = true
    ) throws {
        #if !arch(arm64)
        throw ScannerError.unsupportedSystem(
            "coordsfinder-metal is intended for Apple-silicon Macs (arm64)"
        )
        #else
        guard resultCapacity >= Int(Self.candidatesPerThread),
              resultCapacity <= Int(UInt32.max)
        else {
            throw ScannerError.invalidArguments(
                "result capacity must be \(Self.candidatesPerThread)...\(UInt32.max)"
            )
        }
        guard let selectedDevice = requestedDevice ?? MTLCreateSystemDefaultDevice() else {
            throw ScannerError.unsupportedSystem("no Metal device is available")
        }
        guard selectedDevice.hasUnifiedMemory else {
            throw ScannerError.unsupportedSystem(
                "the selected GPU does not expose Apple-silicon unified memory"
            )
        }
        guard let queue = selectedDevice.makeCommandQueue() else {
            throw ScannerError.metal("unable to create a command queue")
        }

        let compileOptions = MTLCompileOptions()
        compileOptions.fastMathEnabled = false
        let library: any MTLLibrary
        do {
            library = try selectedDevice.makeLibrary(
                source: coordsFinderMetalKernel,
                options: compileOptions
            )
        } catch {
            throw ScannerError.metal("unable to compile the compute kernel: \(error)")
        }

        var textureMode = config.algorithm.rawValue
        var exactSearch = config.errorTolerance == 0
        let constants = MTLFunctionConstantValues()
        constants.setConstantValue(&textureMode, type: .uint, index: 0)
        constants.setConstantValue(&exactSearch, type: .bool, index: 1)
        let function: any MTLFunction
        do {
            function = try library.makeFunction(
                name: "search_coordinates",
                constantValues: constants
            )
        } catch {
            throw ScannerError.metal(
                "unable to specialize \(config.algorithm.configValue): \(error)"
            )
        }

        let computePipeline: any MTLComputePipelineState
        do {
            computePipeline = try selectedDevice.makeComputePipelineState(function: function)
        } catch {
            throw ScannerError.metal("unable to create the compute pipeline: \(error)")
        }

        let directionalFilters = makeDirectionalFilters(config)
        let gatePlan = enableLatticeGate
            ? makeLatticeGatePlan(
                config: config,
                directionalFilters: directionalFilters
            )
            : nil
        let gatePipeline: (any MTLComputePipelineState)?
        let gateOffsetBuffer: (any MTLBuffer)?
        if let gatePlan {
            let gateFunction: any MTLFunction
            do {
                gateFunction = try library.makeFunction(
                    name: "search_coordinates_lattice",
                    constantValues: constants
                )
            } catch {
                throw ScannerError.metal(
                    "unable to specialize lattice gate for "
                        + "\(config.algorithm.configValue): \(error)"
                )
            }
            do {
                gatePipeline = try selectedDevice.makeComputePipelineState(
                    function: gateFunction
                )
            } catch {
                throw ScannerError.metal(
                    "unable to create the lattice-gate pipeline: \(error)"
                )
            }
            guard MemoryLayout<GPULatticeGateOffset>.stride == 16 else {
                throw ScannerError.metal("unexpected host lattice-gate layout")
            }
            gateOffsetBuffer = try Self.makeBuffer(
                device: selectedDevice,
                values: gatePlan.offsets,
                label: "lattice gate offsets"
            )
        } else {
            gatePipeline = nil
            gateOffsetBuffer = nil
        }
        guard MemoryLayout<GPUFilter>.stride == 20 else {
            throw ScannerError.metal("unexpected host filter layout")
        }
        let filters = try Self.makeBuffer(
            device: selectedDevice,
            values: directionalFilters,
            label: "directional filters"
        )
        let directions = try Self.makeBuffer(
            device: selectedDevice,
            values: config.directions,
            label: "directions"
        )

        self.config = config
        device = selectedDevice
        deviceName = selectedDevice.name
        commandQueue = queue
        pipeline = computePipeline
        latticePipeline = gatePipeline
        latticeGatePlan = gatePlan
        filterBuffer = filters
        directionBuffer = directions
        latticeGateOffsetBuffer = gateOffsetBuffer
        self.resultCapacity = resultCapacity
        optimizationDescription = gatePlan == nil
            ? "baseline"
            : "2x2 four-state lattice gate"

        resultCountBuffer = try Self.makeBuffer(
            device: selectedDevice,
            length: MemoryLayout<UInt32>.stride,
            label: "result counter"
        )
        resultOverflowBuffer = try Self.makeBuffer(
            device: selectedDevice,
            length: MemoryLayout<UInt32>.stride,
            label: "result overflow flag"
        )
        resultOrdinalBuffer = try Self.makeBuffer(
            device: selectedDevice,
            length: resultCapacity * MemoryLayout<UInt64>.stride,
            label: "result ordinals"
        )
        resultCoordinateBuffer = try Self.makeBuffer(
            device: selectedDevice,
            length: resultCapacity * MemoryLayout<SIMD4<Int32>>.stride,
            label: "result coordinates"
        )
        resultDirectionBuffer = try Self.makeBuffer(
            device: selectedDevice,
            length: resultCapacity * MemoryLayout<UInt32>.stride,
            label: "result directions"
        )

        let activePipeline = gatePipeline ?? computePipeline
        let executionWidth = activePipeline.threadExecutionWidth
        let preferredWidth = min(256, activePipeline.maxTotalThreadsPerThreadgroup)
        threadsPerThreadgroup = max(
            executionWidth,
            preferredWidth - preferredWidth % executionWidth
        )
        #endif
    }

    func run(
        batchWorkItems requestedBatchWorkItems: Int = MetalScanner.defaultBatchWorkItems,
        onMatch: (ScanMatch) -> Void,
        onProgress: (ScanProgress) -> Void = { _ in }
    ) throws -> ScanSummary {
        guard requestedBatchWorkItems > 0,
              requestedBatchWorkItems <= Self.maximumBatchWorkItems
        else {
            throw ScannerError.invalidArguments(
                "batch work items must be 1...\(Self.maximumBatchWorkItems)"
            )
        }

        if let gatePlan = latticeGatePlan,
           let gatePipeline = latticePipeline,
           let gateOffsetBuffer = latticeGateOffsetBuffer
        {
            return try runLatticeGate(
                plan: gatePlan,
                pipeline: gatePipeline,
                gateOffsetBuffer: gateOffsetBuffer,
                requestedBatchWorkItems: requestedBatchWorkItems,
                onMatch: onMatch,
                onProgress: onProgress
            )
        }

        let total = try config.totalCandidates()
        let totalWorkItems = try config.totalWorkItems(
            candidatesPerThread: Self.candidatesPerThread
        )
        let yBlockCount = (
            config.yRange.count + Self.candidatesPerThread - 1
        ) / Self.candidatesPerThread
        let startTime = ContinuousClock.now
        var workOffset: UInt64 = 0
        var processed: UInt64 = 0
        var matchCount: UInt64 = 0
        var adaptiveBatchSize = requestedBatchWorkItems

        while workOffset < totalWorkItems {
            let remaining = totalWorkItems - workOffset
            let batchCount = min(UInt64(adaptiveBatchSize), remaining)
            resetResultState()

            try dispatch(
                workOffset: workOffset,
                workItemCount: Int(batchCount),
                yBlockCount: yBlockCount
            )

            let gpuResultCount = resultCountBuffer.contents()
                .assumingMemoryBound(to: UInt32.self).pointee
            let overflowed = resultOverflowBuffer.contents()
                .assumingMemoryBound(to: UInt32.self).pointee != 0

            if overflowed || gpuResultCount > UInt32(resultCapacity) {
                guard batchCount > 1 else {
                    throw ScannerError.metal(
                        "one Metal work item exceeded the result buffer capacity"
                    )
                }
                adaptiveBatchSize = max(1, Int(batchCount / 2))
                continue
            }

            let matches = readMatches(count: Int(gpuResultCount))
                .sorted { $0.ordinal < $1.ordinal }
            matches.forEach(onMatch)
            matchCount += UInt64(gpuResultCount)

            let nextWorkOffset = workOffset + batchCount
            let nextProcessed = candidatePrefix(
                workItems: nextWorkOffset,
                yBlockCount: yBlockCount
            )
            processed = nextProcessed
            workOffset = nextWorkOffset

            let elapsed = startTime.duration(to: .now).seconds
            onProgress(
                ScanProgress(
                    processed: processed,
                    total: total,
                    matchCount: matchCount,
                    checksPerSecond: elapsed > 0 ? Double(processed) / elapsed : 0,
                    elapsed: elapsed
                )
            )
        }

        let elapsed = startTime.duration(to: .now).seconds
        return ScanSummary(
            processed: processed,
            matchCount: matchCount,
            elapsed: elapsed,
            deviceName: deviceName
        )
    }

    private func runLatticeGate(
        plan: LatticeGatePlan,
        pipeline: any MTLComputePipelineState,
        gateOffsetBuffer: any MTLBuffer,
        requestedBatchWorkItems: Int,
        onMatch: (ScanMatch) -> Void,
        onProgress: (ScanProgress) -> Void
    ) throws -> ScanSummary {
        let total = try config.totalCandidates()
        let yBlockCount = (
            config.yRange.count + Self.candidatesPerThread - 1
        ) / Self.candidatesPerThread
        let totalWorkItems = try checkedMultiply(
            plan.workItemCount,
            yBlockCount,
            label: "Metal lattice-gate work area"
        )
        let startTime = ContinuousClock.now
        var workOffset: UInt64 = 0
        var processed: UInt64 = 0
        var matchCount: UInt64 = 0
        var adaptiveBatchSize = requestedBatchWorkItems

        while workOffset < totalWorkItems {
            let remaining = totalWorkItems - workOffset
            let batchCount = min(UInt64(adaptiveBatchSize), remaining)
            resetResultState()

            try dispatchLatticeGate(
                pipeline: pipeline,
                gateOffsetBuffer: gateOffsetBuffer,
                plan: plan,
                workOffset: workOffset,
                workItemCount: Int(batchCount),
                yBlockCount: yBlockCount
            )

            let gpuResultCount = resultCountBuffer.contents()
                .assumingMemoryBound(to: UInt32.self).pointee
            let overflowed = resultOverflowBuffer.contents()
                .assumingMemoryBound(to: UInt32.self).pointee != 0
            if overflowed || gpuResultCount > UInt32(resultCapacity) {
                guard batchCount > 1 else {
                    throw ScannerError.metal(
                        "one lattice-gate work item exceeded the result buffer capacity"
                    )
                }
                adaptiveBatchSize = max(1, Int(batchCount / 2))
                continue
            }

            let matches = readMatches(count: Int(gpuResultCount))
                .sorted { $0.ordinal < $1.ordinal }
            matches.forEach(onMatch)
            matchCount += UInt64(gpuResultCount)

            workOffset += batchCount
            if workOffset == totalWorkItems {
                processed = total
            } else {
                processed = min(
                    total,
                    UInt64(Double(total) * Double(workOffset) / Double(totalWorkItems))
                )
            }

            let elapsed = startTime.duration(to: .now).seconds
            onProgress(
                ScanProgress(
                    processed: processed,
                    total: total,
                    matchCount: matchCount,
                    checksPerSecond: elapsed > 0 ? Double(processed) / elapsed : 0,
                    elapsed: elapsed
                )
            )
        }

        let elapsed = startTime.duration(to: .now).seconds
        return ScanSummary(
            processed: total,
            matchCount: matchCount,
            elapsed: elapsed,
            deviceName: deviceName
        )
    }

    private func dispatch(
        workOffset: UInt64,
        workItemCount: Int,
        yBlockCount: UInt64
    ) throws {
        guard let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeComputeCommandEncoder()
        else {
            throw ScannerError.metal("unable to create a compute command")
        }
        commandBuffer.label = "CoordsFinder batch at \(workOffset)"
        encoder.label = "CoordsFinder search"
        encoder.setComputePipelineState(pipeline)

        let parameters = makeParameters(
            workOffset: workOffset,
            yBlockCount: yBlockCount
        )
        parameters.withUnsafeBytes { bytes in
            encoder.setBytes(
                bytes.baseAddress!,
                length: bytes.count,
                index: 0
            )
        }
        encoder.setBuffer(filterBuffer, offset: 0, index: 1)
        encoder.setBuffer(directionBuffer, offset: 0, index: 2)
        encoder.setBuffer(resultCountBuffer, offset: 0, index: 3)
        encoder.setBuffer(resultOverflowBuffer, offset: 0, index: 4)
        encoder.setBuffer(resultOrdinalBuffer, offset: 0, index: 5)
        encoder.setBuffer(resultCoordinateBuffer, offset: 0, index: 6)
        encoder.setBuffer(resultDirectionBuffer, offset: 0, index: 7)
        encoder.dispatchThreads(
            MTLSize(width: workItemCount, height: 1, depth: 1),
            threadsPerThreadgroup: MTLSize(
                width: min(threadsPerThreadgroup, workItemCount),
                height: 1,
                depth: 1
            )
        )
        encoder.endEncoding()
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()

        guard commandBuffer.status == .completed else {
            throw ScannerError.metal(
                commandBuffer.error?.localizedDescription
                    ?? "the GPU command did not complete"
            )
        }
    }

    private func dispatchLatticeGate(
        pipeline: any MTLComputePipelineState,
        gateOffsetBuffer: any MTLBuffer,
        plan: LatticeGatePlan,
        workOffset: UInt64,
        workItemCount: Int,
        yBlockCount: UInt64
    ) throws {
        guard let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeComputeCommandEncoder()
        else {
            throw ScannerError.metal("unable to create a lattice-gate compute command")
        }
        commandBuffer.label = "CoordsFinder lattice batch at \(workOffset)"
        encoder.label = "CoordsFinder 2x2 lattice search"
        encoder.setComputePipelineState(pipeline)

        let parameters = makeLatticeGateParameters(
            plan: plan,
            workOffset: workOffset,
            yBlockCount: yBlockCount
        )
        parameters.withUnsafeBytes { bytes in
            encoder.setBytes(
                bytes.baseAddress!,
                length: bytes.count,
                index: 0
            )
        }
        encoder.setBuffer(filterBuffer, offset: 0, index: 1)
        encoder.setBuffer(gateOffsetBuffer, offset: 0, index: 2)
        encoder.setBuffer(resultCountBuffer, offset: 0, index: 3)
        encoder.setBuffer(resultOverflowBuffer, offset: 0, index: 4)
        encoder.setBuffer(resultOrdinalBuffer, offset: 0, index: 5)
        encoder.setBuffer(resultCoordinateBuffer, offset: 0, index: 6)
        encoder.setBuffer(resultDirectionBuffer, offset: 0, index: 7)
        encoder.dispatchThreads(
            MTLSize(width: workItemCount, height: 1, depth: 1),
            threadsPerThreadgroup: MTLSize(
                width: min(threadsPerThreadgroup, workItemCount),
                height: 1,
                depth: 1
            )
        )
        encoder.endEncoding()
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()

        guard commandBuffer.status == .completed else {
            throw ScannerError.metal(
                commandBuffer.error?.localizedDescription
                    ?? "the lattice-gate GPU command did not complete"
            )
        }
    }

    private func makeParameters(
        workOffset: UInt64,
        yBlockCount: UInt64
    ) -> [UInt32] {
        let ySize = config.yRange.count
        let zSize = config.zRange.count
        let xSize = config.xRange.count
        return [
            UInt32(truncatingIfNeeded: workOffset),
            UInt32(truncatingIfNeeded: workOffset >> 32),
            UInt32(bitPattern: config.xRange.start),
            UInt32(bitPattern: config.yRange.start),
            UInt32(bitPattern: config.zRange.start),
            UInt32(truncatingIfNeeded: ySize),
            UInt32(truncatingIfNeeded: ySize >> 32),
            UInt32(truncatingIfNeeded: zSize),
            UInt32(truncatingIfNeeded: zSize >> 32),
            UInt32(truncatingIfNeeded: yBlockCount),
            UInt32(truncatingIfNeeded: yBlockCount >> 32),
            UInt32(config.directions.count),
            UInt32(config.filters.count),
            config.errorTolerance,
            UInt32(resultCapacity),
            config.scanOrder.rawValue,
            UInt32(truncatingIfNeeded: xSize),
            UInt32(truncatingIfNeeded: xSize >> 32),
        ]
    }

    private func makeLatticeGateParameters(
        plan: LatticeGatePlan,
        workOffset: UInt64,
        yBlockCount: UInt64
    ) -> [UInt32] {
        let ySize = config.yRange.count
        let zSize = config.zRange.count
        return [
            UInt32(truncatingIfNeeded: workOffset),
            UInt32(truncatingIfNeeded: workOffset >> 32),
            UInt32(bitPattern: config.xRange.start),
            UInt32(bitPattern: config.yRange.start),
            UInt32(bitPattern: config.zRange.start),
            UInt32(bitPattern: config.xRange.end),
            UInt32(bitPattern: config.zRange.end),
            UInt32(truncatingIfNeeded: ySize),
            UInt32(truncatingIfNeeded: ySize >> 32),
            UInt32(truncatingIfNeeded: zSize),
            UInt32(truncatingIfNeeded: zSize >> 32),
            UInt32(truncatingIfNeeded: yBlockCount),
            UInt32(truncatingIfNeeded: yBlockCount >> 32),
            UInt32(config.filters.count),
            UInt32(resultCapacity),
            UInt32(bitPattern: plan.sampleXStart),
            UInt32(bitPattern: plan.sampleZStart),
            UInt32(truncatingIfNeeded: plan.sampleZCount),
            UInt32(truncatingIfNeeded: plan.sampleZCount >> 32),
            UInt32(bitPattern: plan.yOffset),
            plan.rotation,
            config.directions[0] * 90,
        ]
    }

    private func resetResultState() {
        resultCountBuffer.contents().assumingMemoryBound(to: UInt32.self).pointee = 0
        resultOverflowBuffer.contents().assumingMemoryBound(to: UInt32.self).pointee = 0
    }

    private func readMatches(count: Int) -> [ScanMatch] {
        let ordinals = resultOrdinalBuffer.contents().assumingMemoryBound(to: UInt64.self)
        let coordinates = resultCoordinateBuffer.contents()
            .assumingMemoryBound(to: SIMD4<Int32>.self)
        let directions = resultDirectionBuffer.contents().assumingMemoryBound(to: UInt32.self)
        return (0 ..< count).map { index in
            let coordinate = coordinates[index]
            return ScanMatch(
                ordinal: ordinals[index],
                x: coordinate.x,
                y: coordinate.y,
                z: coordinate.z,
                badBlocks: UInt32(bitPattern: coordinate.w),
                direction: directions[index]
            )
        }
    }

    private func candidatePrefix(workItems: UInt64, yBlockCount: UInt64) -> UInt64 {
        let completeColumns = workItems / yBlockCount
        let partialBlocks = workItems % yBlockCount
        return completeColumns * config.yRange.count
            + min(
                partialBlocks * Self.candidatesPerThread,
                config.yRange.count
            )
    }

    private static func makeBuffer<Value>(
        device: any MTLDevice,
        values: [Value],
        label: String
    ) throws -> any MTLBuffer {
        guard !values.isEmpty else {
            throw ScannerError.metal("cannot allocate an empty \(label) buffer")
        }
        return try values.withUnsafeBytes { bytes in
            guard let buffer = device.makeBuffer(
                bytes: bytes.baseAddress!,
                length: bytes.count,
                options: .storageModeShared
            ) else {
                throw ScannerError.metal("unable to allocate \(label) buffer")
            }
            buffer.label = label
            return buffer
        }
    }

    private static func makeBuffer(
        device: any MTLDevice,
        length: Int,
        label: String
    ) throws -> any MTLBuffer {
        guard let buffer = device.makeBuffer(
            length: length,
            options: .storageModeShared
        ) else {
            throw ScannerError.metal("unable to allocate \(label) buffer")
        }
        buffer.label = label
        return buffer
    }
}

private extension Duration {
    var seconds: TimeInterval {
        let components = self.components
        return TimeInterval(components.seconds)
            + TimeInterval(components.attoseconds) / 1_000_000_000_000_000_000
    }
}
