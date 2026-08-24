import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSearchKernel } from '../domain/searchKernel'
import type {
  WebSearchRequest,
  WebSearchShardWorkerCommand,
  WebSearchShardWorkerState,
} from '../domain/webSearch'

describe('search shard worker failure recovery', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('preserves a resumed cursor when WASM loading fails', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error('simulated scanner load failure'))
    vi.stubGlobal('fetch', fetchMock)
    const published: WebSearchShardWorkerState[] = []
    vi.spyOn(globalThis, 'postMessage').mockImplementation((message) => {
      published.push(message as WebSearchShardWorkerState)
    })
    await import('./search.worker')

    const command: WebSearchShardWorkerCommand = {
      type: 'start',
      requestId: 'resume-failure',
      shard: { id: 0, start: 0n, end: 10n },
      checkpoint: { next: 7n, matchCount: 2n },
      request: {
        mode: 0,
        scanOrder: 0,
        directions: [0],
        xStart: 0,
        xEnd: 9,
        yStart: 0,
        yEnd: 0,
        zStart: 0,
        zEnd: 0,
        maxBadBlocks: 0,
        constraints: [],
      },
    }
    window.onmessage?.call(window, new MessageEvent('message', { data: command }))

    await vi.waitFor(() => expect(published).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('coords_search_vanilla_1_exact.wasm'),
    )
    expect(published[0]).toMatchObject({
      phase: 'error',
      next: 7n,
      matchCount: 2n,
    })
  })

  it('uses the generic scanner when the search allows errors', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error('simulated scanner load failure'))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis, 'postMessage').mockImplementation(() => undefined)
    await import('./search.worker')

    const command: WebSearchShardWorkerCommand = {
      type: 'start',
      requestId: 'tolerant-load',
      shard: { id: 0, start: 0n, end: 10n },
      request: {
        mode: 2,
        scanOrder: 0,
        directions: [0],
        xStart: 0,
        xEnd: 9,
        yStart: 0,
        yEnd: 0,
        zStart: 0,
        zEnd: 0,
        maxBadBlocks: 1,
        constraints: [],
      },
    }
    window.onmessage?.call(window, new MessageEvent('message', { data: command }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/coords_search\.wasm(?:\?|$)/),
    )
  })
})

describe('search shard worker generated kernel', () => {
  const request: WebSearchRequest = {
    mode: 2,
    scanOrder: 0,
    directions: [0],
    xStart: -2,
    xEnd: 2,
    yStart: 0,
    yEnd: 5,
    zStart: -2,
    zEnd: 2,
    maxBadBlocks: 0,
    constraints: [{ x: 1, y: 0, z: -1, rotation: 2, visibleMask: 3 }],
  }

  function stubModuleFetch() {
    const fetchMock = vi.fn(async (url: string) => {
      const file = url.split('/').pop()!.split('?')[0]
      const bytes = await readFile(`src/wasm/${file}`)
      const body = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      )
      const response = {
        ok: true,
        status: 200,
        clone: () => response,
        arrayBuffer: async () => body,
      }
      return response
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('scans with the generated kernel against the host scanner', async () => {
    const fetchMock = stubModuleFetch()
    const published: WebSearchShardWorkerState[] = []
    vi.spyOn(globalThis, 'postMessage').mockImplementation((message) => {
      published.push(message as WebSearchShardWorkerState)
    })
    await import('./search.worker')

    const kernel = generateSearchKernel(request)!
    const command: WebSearchShardWorkerCommand = {
      type: 'start',
      requestId: 'generated-scan',
      shard: { id: 0, start: 0n, end: 150n },
      kernel: {
        module: new WebAssembly.Module(kernel.bytes),
        signature: kernel.signature,
      },
      request,
    }
    window.onmessage?.call(window, new MessageEvent('message', { data: command }))

    await vi.waitFor(() =>
      expect(published.some((state) => state.phase === 'completed')).toBe(true),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('coords_search_vanilla_3_host.wasm'),
    )
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('coords_search_vanilla_3_exact.wasm'),
    )
    const completed = published.at(-1)!
    expect(completed.next).toBe(150n)
    expect(completed.matchCount).toBeGreaterThan(0n)
  })

  it('falls back to the checked-in module when the kernel signature is wrong', async () => {
    const fetchMock = stubModuleFetch()
    const published: WebSearchShardWorkerState[] = []
    vi.spyOn(globalThis, 'postMessage').mockImplementation((message) => {
      published.push(message as WebSearchShardWorkerState)
    })
    await import('./search.worker')

    const kernel = generateSearchKernel(request)!
    const command: WebSearchShardWorkerCommand = {
      type: 'start',
      requestId: 'signature-mismatch',
      shard: { id: 0, start: 0n, end: 150n },
      kernel: {
        module: new WebAssembly.Module(kernel.bytes),
        signature: kernel.signature ^ 1n,
      },
      request,
    }
    window.onmessage?.call(window, new MessageEvent('message', { data: command }))

    await vi.waitFor(() =>
      expect(published.some((state) => state.phase === 'completed')).toBe(true),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('coords_search_vanilla_3_exact.wasm'),
    )
    expect(published.at(-1)!.next).toBe(150n)
  })

  it('falls back when the transferred kernel module cannot be instantiated', async () => {
    const fetchMock = stubModuleFetch()
    const published: WebSearchShardWorkerState[] = []
    vi.spyOn(globalThis, 'postMessage').mockImplementation((message) => {
      published.push(message as WebSearchShardWorkerState)
    })
    await import('./search.worker')

    const kernel = generateSearchKernel(request)!
    const command: WebSearchShardWorkerCommand = {
      type: 'start',
      requestId: 'instantiate-failure',
      shard: { id: 0, start: 0n, end: 150n },
      kernel: {
        // A module without the expected exports stands in for a corrupted or
        // mismatched transfer.
        module: new WebAssembly.Module(
          Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
        ),
        signature: kernel.signature,
      },
      request,
    }
    window.onmessage?.call(window, new MessageEvent('message', { data: command }))

    await vi.waitFor(() =>
      expect(published.some((state) => state.phase === 'completed')).toBe(true),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('coords_search_vanilla_3_exact.wasm'),
    )
  })
})
