import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WebSearchShardWorkerCommand,
  WebSearchShardWorkerState,
  WebSearchWorkerCommand,
  WebSearchWorkerState,
} from '../domain/webSearch'

class MockShardWorker {
  static instances: MockShardWorker[] = []

  onmessage: ((event: MessageEvent<WebSearchShardWorkerState>) => void) | null =
    null
  onerror: (() => void) | null = null
  commands: WebSearchShardWorkerCommand[] = []
  terminate = vi.fn()

  constructor() {
    MockShardWorker.instances.push(this)
  }

  postMessage(command: WebSearchShardWorkerCommand) {
    this.commands.push(command)
  }

  emit(message: WebSearchShardWorkerState) {
    this.onmessage?.({ data: message } as MessageEvent<WebSearchShardWorkerState>)
  }
}

const vanilla3Request = {
  mode: 2,
  scanOrder: 0,
  directions: [0, 90] as const,
  xStart: -2,
  xEnd: 2,
  yStart: 0,
  yEnd: 5,
  zStart: -2,
  zEnd: 2,
  maxBadBlocks: 0,
  constraints: [
    { x: 1, y: 0, z: -1, rotation: 2, visibleMask: 3 as const },
    { x: -2, y: 1, z: 1, rotation: 0, visibleMask: 1 as const },
  ],
}

describe('search pool generated kernel handoff', () => {
  beforeEach(() => {
    MockShardWorker.instances = []
    vi.resetModules()
    vi.stubGlobal('Worker', MockShardWorker)
    Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', {
      configurable: true,
      value: 4,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('delivers one compiled kernel to every shard worker', async () => {
    vi.spyOn(globalThis, 'postMessage').mockImplementation(() => undefined)
    await import('./search.pool.worker')

    const start: WebSearchWorkerCommand = {
      type: 'start',
      requestId: 'generated',
      workerCount: 3,
      request: { ...vanilla3Request, directions: [...vanilla3Request.directions] },
    }
    window.onmessage?.call(window, new MessageEvent('message', { data: start }))

    expect(MockShardWorker.instances).toHaveLength(3)
    const kernels = MockShardWorker.instances.map((worker) => {
      const command = worker.commands[0]
      if (command.type !== 'start') throw new Error('expected a start command')
      return command.kernel
    })
    kernels.forEach((kernel) => {
      expect(kernel?.module).toBeInstanceOf(WebAssembly.Module)
      expect(typeof kernel?.signature).toBe('bigint')
    })
    // One compilation is shared by the whole pool.
    expect(new Set(kernels.map((kernel) => kernel?.module)).size).toBe(1)
    expect(new Set(kernels.map((kernel) => kernel?.signature)).size).toBe(1)
  })

  it('starts without a kernel for unsupported requests', async () => {
    vi.spyOn(globalThis, 'postMessage').mockImplementation(() => undefined)
    await import('./search.pool.worker')

    for (const [index, request] of [
      { ...vanilla3Request, mode: 0, directions: [0] },
      { ...vanilla3Request, maxBadBlocks: 2, directions: [0] },
      { ...vanilla3Request, constraints: [], directions: [0] },
    ].entries()) {
      MockShardWorker.instances = []
      const start: WebSearchWorkerCommand = {
        type: 'start',
        requestId: `unsupported-${index}`,
        workerCount: 1,
        request: request as WebSearchWorkerCommand extends { request: infer R }
          ? R
          : never,
      }
      window.onmessage?.call(window, new MessageEvent('message', { data: start }))
      const command = MockShardWorker.instances[0].commands[0]
      expect(command.type).toBe('start')
      if (command.type !== 'start') return
      expect(command.kernel).toBeUndefined()
    }
  })

  it('falls back to the checked-in scanner when compilation fails', async () => {
    vi.spyOn(globalThis, 'postMessage').mockImplementation(() => undefined)
    vi.spyOn(WebAssembly, 'Module').mockImplementation(() => {
      throw new Error('simulated kernel compilation failure')
    })
    await import('./search.pool.worker')

    const start: WebSearchWorkerCommand = {
      type: 'start',
      requestId: 'compile-failure',
      workerCount: 2,
      request: { ...vanilla3Request, directions: [...vanilla3Request.directions] },
    }
    window.onmessage?.call(window, new MessageEvent('message', { data: start }))

    expect(MockShardWorker.instances).toHaveLength(2)
    MockShardWorker.instances.forEach((worker) => {
      const command = worker.commands[0]
      expect(command.type).toBe('start')
      if (command.type !== 'start') return
      expect(command.kernel).toBeUndefined()
    })
  })
})

describe('search pool worker coordinator', () => {
  beforeEach(() => {
    MockShardWorker.instances = []
    vi.resetModules()
    vi.stubGlobal('Worker', MockShardWorker)
    Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', {
      configurable: true,
      value: 4,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('omits unchanged retained snapshots from high-frequency progress', async () => {
    vi.useFakeTimers()
    const published: WebSearchWorkerState[] = []
    vi.spyOn(globalThis, 'postMessage').mockImplementation((message) => {
      published.push(message as WebSearchWorkerState)
    })
    await import('./search.pool.worker')

    const requestId = 'counter-only-progress'
    const start: WebSearchWorkerCommand = {
      type: 'start',
      requestId,
      workerCount: 1,
      request: {
        mode: 0,
        scanOrder: 0,
        directions: [0],
        xStart: 0,
        xEnd: 1_999,
        yStart: 0,
        yEnd: 0,
        zStart: 0,
        zEnd: 0,
        maxBadBlocks: 0,
        constraints: [],
      },
    }
    window.onmessage?.call(window, new MessageEvent('message', { data: start }))
    const worker = MockShardWorker.instances[0]
    const shardStart = worker.commands[0]
    expect(shardStart.type).toBe('start')
    if (shardStart.type !== 'start') return

    worker.emit({
      type: 'state',
      requestId,
      shardId: 0,
      phase: 'running',
      next: 1n,
      matchCount: 1n,
      checksPerSecond: 1,
      results: [{
        ordinal: 0n,
        x: 0,
        y: 0,
        z: 0,
        badBlocks: 0,
        direction: 0,
      }],
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(published.at(-1)?.results?.[0].scanOrdinal).toBe('0')

    worker.emit({
      type: 'state',
      requestId,
      shardId: 0,
      phase: 'running',
      next: 2n,
      matchCount: 1n,
      checksPerSecond: 1,
      results: [],
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(published.at(-1)?.processed).toBe(2n)
    expect(published.at(-1)?.results).toBeUndefined()
  })

  it('merges out-of-order child completion into the deterministic first 1,000 matches', async () => {
    const published: WebSearchWorkerState[] = []
    const postMessage = vi
      .spyOn(globalThis, 'postMessage')
      .mockImplementation((message) => {
        published.push(message as WebSearchWorkerState)
      })
    await import('./search.pool.worker')

    const requestId = 'pool-test'
    const start: WebSearchWorkerCommand = {
      type: 'start',
      requestId,
      workerCount: 2,
      request: {
        mode: 0,
        scanOrder: 0,
        directions: [0],
        xStart: 0,
        xEnd: 1_999,
        yStart: 0,
        yEnd: 0,
        zStart: 0,
        zEnd: 0,
        maxBadBlocks: 0,
        constraints: [],
      },
    }
    window.onmessage?.call(window, new MessageEvent('message', { data: start }))

    expect(MockShardWorker.instances).toHaveLength(2)
    const [earlierWorker, laterWorker] = MockShardWorker.instances
    const earlierStart = earlierWorker.commands[0]
    const laterStart = laterWorker.commands[0]
    expect(earlierStart.type).toBe('start')
    expect(laterStart.type).toBe('start')
    if (earlierStart.type !== 'start' || laterStart.type !== 'start') return

    const resultsFor = (startOrdinal: bigint) =>
      Array.from({ length: 1_000 }, (_, index) => ({
        ordinal: startOrdinal + BigInt(index),
        x: Number(startOrdinal) + index,
        y: 0,
        z: 0,
        badBlocks: 0,
        direction: 0 as const,
      }))

    // The later shard wins the scheduling race, then the earlier shard must
    // displace every row in the retained snapshot when it completes.
    laterWorker.emit({
      type: 'state',
      requestId,
      shardId: laterStart.shard.id,
      phase: 'completed',
      next: laterStart.shard.end,
      matchCount: 1_000n,
      checksPerSecond: 1,
      results: resultsFor(laterStart.shard.start),
    })
    earlierWorker.emit({
      type: 'state',
      requestId,
      shardId: earlierStart.shard.id,
      phase: 'completed',
      next: earlierStart.shard.end,
      matchCount: 1_000n,
      checksPerSecond: 1,
      results: resultsFor(earlierStart.shard.start),
    })

    const finalState = published.at(-1)
    expect(postMessage).toHaveBeenCalled()
    expect(finalState?.phase).toBe('completed')
    expect(finalState?.matchCount).toBe(2_000n)
    expect(finalState?.results).toHaveLength(1_000)
    expect(finalState?.results?.[0].scanOrdinal).toBe('0')
    expect(finalState?.results?.[999].scanOrdinal).toBe('999')
    expect(earlierWorker.terminate).toHaveBeenCalledOnce()
    expect(laterWorker.terminate).toHaveBeenCalledOnce()

    const stopRequestId = 'stop-after-pause'
    window.onmessage?.call(window, new MessageEvent('message', {
      data: { ...start, requestId: stopRequestId },
    }))
    const stopWorkers = MockShardWorker.instances.slice(2)
    const publicationStart = published.length
    window.onmessage?.call(window, new MessageEvent('message', {
      data: { type: 'pause', requestId: stopRequestId },
    }))
    window.onmessage?.call(window, new MessageEvent('message', {
      data: { type: 'stop', requestId: stopRequestId },
    }))
    stopWorkers.forEach((worker, shardId) => {
      const shardStart = worker.commands[0]
      if (shardStart.type !== 'start') return
      // These paused acknowledgements were already queued when stop won.
      worker.emit({
        type: 'state',
        requestId: stopRequestId,
        shardId,
        phase: 'paused',
        next: shardStart.shard.start,
        matchCount: 0n,
        checksPerSecond: 0,
        results: [],
      })
    })
    expect(
      published.slice(publicationStart).some((state) => state.phase === 'paused'),
    ).toBe(false)
    stopWorkers.forEach((worker, shardId) => {
      const shardStart = worker.commands[0]
      if (shardStart.type !== 'start') return
      worker.emit({
        type: 'state',
        requestId: stopRequestId,
        shardId,
        phase: 'stopped',
        next: shardStart.shard.start,
        matchCount: 0n,
        checksPerSecond: 0,
        results: [],
      })
    })
    expect(published.at(-1)?.phase).toBe('stopped')
  })
})
