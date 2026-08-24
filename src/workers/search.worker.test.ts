import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
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
