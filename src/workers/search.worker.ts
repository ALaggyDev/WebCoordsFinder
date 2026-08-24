import genericWasmUrl from '../wasm/coords_search.wasm?url&no-inline'
import sodium1ExactWasmUrl from '../wasm/coords_search_sodium_1_exact.wasm?url&no-inline'
import sodium2ExactWasmUrl from '../wasm/coords_search_sodium_2_exact.wasm?url&no-inline'
import vanilla1ExactWasmUrl from '../wasm/coords_search_vanilla_1_exact.wasm?url&no-inline'
import vanilla2ExactWasmUrl from '../wasm/coords_search_vanilla_2_exact.wasm?url&no-inline'
import vanilla3ExactWasmUrl from '../wasm/coords_search_vanilla_3_exact.wasm?url&no-inline'
import {
  MAX_WEB_SEARCH_RESULTS,
  type WebSearchOrdinalResult,
  type WebSearchShardWorkerCommand,
  type WebSearchShardWorkerState,
} from '../domain/webSearch'
import type { SearchDirection } from '../domain/types'

// This worker owns one mutable WASM scanner instance. Request IDs prevent late
// messages from a replaced search from mutating the dialog's current state.
interface SearchExports extends WebAssembly.Exports {
  search_configure: (
    mode: number,
    scanOrder: number,
    xStart: number,
    xEnd: number,
    yStart: number,
    yEnd: number,
    zStart: number,
    zEnd: number,
    maxBadBlocks: number,
    filterCount: number,
    directionCount: number,
  ) => number
  search_set_direction: (index: number, quarterTurns: number) => number
  search_set_filter: (
    index: number,
    x: number,
    y: number,
    z: number,
    rotation: number,
    visibleMask: number,
  ) => number
  search_restore: (processed: bigint, matchCount: bigint) => number
  search_scan_batch: (maxPositions: number, captureLimit: number) => number
  search_is_finished: () => number
  search_get_processed: () => bigint
  search_get_total: () => bigint
  search_get_match_count: () => bigint
  search_get_result_count: () => number
  search_get_result_ordinal: (index: number) => bigint
  search_get_result_x: (index: number) => number
  search_get_result_y: (index: number) => number
  search_get_result_z: (index: number) => number
  search_get_result_bad_blocks: (index: number) => number
  search_get_result_direction: (index: number) => number
}

const minimumBatchSize = 2_048
const maximumBatchSize = 2_000_000
const targetBatchMilliseconds = 25
const progressIntervalMilliseconds = 100

const exactWasmUrls = [
  vanilla1ExactWasmUrl,
  vanilla2ExactWasmUrl,
  vanilla3ExactWasmUrl,
  sodium1ExactWasmUrl,
  sodium2ExactWasmUrl,
]
const exportsPromises = new Map<string, Promise<SearchExports>>()
let activeRequestId: string | undefined
let searchExports: SearchExports | undefined
let pauseRequested = false
let stopRequested = false
let capturedResults = 0
let batchSize = 16_384
let checksPerSecond = 0
let lastProgressAt = 0
let shardId = 0
let shardStart = 0n
let shardEnd = 0n

// MessageChannel queues a task without the 4 ms clamp applied to deeply nested
// setTimeout calls, while still yielding between synchronous WASM batches.
const batchChannel = new MessageChannel()
batchChannel.port1.onmessage = () => runBatch()

function scannerUrl(mode: number, maxBadBlocks: number): string {
  return maxBadBlocks === 0
    ? exactWasmUrls[mode] ?? genericWasmUrl
    : genericWasmUrl
}

async function loadSearchExports(wasmUrl: string): Promise<SearchExports> {
  let exportsPromise = exportsPromises.get(wasmUrl)
  if (!exportsPromise) {
    exportsPromise = (async () => {
      const response = await fetch(wasmUrl)
      if (!response.ok) {
        throw new Error(`Unable to load web scanner (${response.status}).`)
      }

      let instance: WebAssembly.Instance
      try {
        // Some development servers return the correct WASM MIME type, while
        // static hosts may require the ArrayBuffer fallback.
        const result = await WebAssembly.instantiateStreaming(response.clone())
        instance = result.instance
      } catch {
        const result = await WebAssembly.instantiate(await response.arrayBuffer())
        instance = result.instance
      }
      return instance.exports as SearchExports
    })()
    exportsPromises.set(wasmUrl, exportsPromise)
  }
  return exportsPromise
}

function collectResults(module: SearchExports): WebSearchOrdinalResult[] {
  const count = module.search_get_result_count()
  const results = Array.from({ length: count }, (_, index) => ({
    ordinal: module.search_get_result_ordinal(index),
    x: module.search_get_result_x(index),
    y: module.search_get_result_y(index),
    z: module.search_get_result_z(index),
    badBlocks: module.search_get_result_bad_blocks(index),
    direction: module.search_get_result_direction(index) as SearchDirection,
  }))
  capturedResults += results.length
  return results
}

function postState(
  phase: WebSearchShardWorkerState['phase'],
  results: WebSearchOrdinalResult[] = [],
  error?: string,
) {
  if (!activeRequestId || !searchExports) return
  const message: WebSearchShardWorkerState = {
    type: 'state',
    requestId: activeRequestId,
    shardId,
    phase,
    next: searchExports.search_get_processed(),
    matchCount: searchExports.search_get_match_count(),
    checksPerSecond,
    results,
    error,
  }
  self.postMessage(message)
}

function finishSearch(phase: 'stopped' | 'completed') {
  postState(phase)
  activeRequestId = undefined
}

function scheduleBatch() {
  batchChannel.port2.postMessage(undefined)
}

function runBatch() {
  const module = searchExports
  if (!activeRequestId || !module) return
  if (stopRequested) {
    finishSearch('stopped')
    return
  }
  if (pauseRequested) return

  const captureLimit = Math.min(
    1_024,
    Math.max(0, MAX_WEB_SEARCH_RESULTS - capturedResults),
  )
  const startedAt = performance.now()
  const remaining = shardEnd - module.search_get_processed()
  const boundedBatchSize = Number(
    remaining < BigInt(batchSize) ? remaining : BigInt(batchSize),
  )
  const scanned = module.search_scan_batch(boundedBatchSize, captureLimit)
  const elapsed = Math.max(0.01, performance.now() - startedAt)
  const instantaneousRate = (scanned * 1_000) / elapsed
  // Smooth the displayed rate and adapt work chunks toward short tasks so
  // pause/stop commands remain responsive.
  checksPerSecond =
    checksPerSecond === 0
      ? instantaneousRate
      : checksPerSecond * 0.7 + instantaneousRate * 0.3
  batchSize = Math.min(
    maximumBatchSize,
    Math.max(
      minimumBatchSize,
      Math.round(batchSize * (targetBatchMilliseconds / elapsed)),
    ),
  )

  const results = collectResults(module)
  const now = performance.now()
  if (
    // Result-bearing messages are immediate; empty progress updates are
    // throttled to avoid flooding React with worker events.
    results.length > 0 ||
    now - lastProgressAt >= progressIntervalMilliseconds ||
    module.search_is_finished() ||
    module.search_get_processed() >= shardEnd
  ) {
    postState('running', results)
    lastProgressAt = now
  }

  if (module.search_is_finished() || module.search_get_processed() >= shardEnd) {
    finishSearch('completed')
    return
  }
  scheduleBatch()
}

async function startSearch(
  command: Extract<WebSearchShardWorkerCommand, { type: 'start' }>,
) {
  activeRequestId = command.requestId
  pauseRequested = false
  stopRequested = false
  // Every shard retains at most its first 1,000 matches in this run. That is
  // sufficient for the coordinator to derive the global first 1,000; after a
  // resume, previously retained lower ordinals are seeded by the checkpoint.
  capturedResults = 0
  batchSize = 16_384
  checksPerSecond = 0
  lastProgressAt = 0
  shardId = command.shard.id
  shardStart = command.shard.start
  shardEnd = command.shard.end

  try {
    const request = command.request
    const module = await loadSearchExports(
      scannerUrl(request.mode, request.maxBadBlocks),
    )
    if (activeRequestId !== command.requestId) return
    searchExports = module
    const configureError = module.search_configure(
      request.mode,
      request.scanOrder,
      request.xStart,
      request.xEnd,
      request.yStart,
      request.yEnd,
      request.zStart,
      request.zEnd,
      request.maxBadBlocks,
      request.constraints.length,
      request.directions.length,
    )
    if (configureError !== 0) {
      throw new Error(`WASM scanner rejected the configuration (${configureError}).`)
    }

    request.directions.forEach((direction, index) => {
      const directionError = module.search_set_direction(
        index,
        direction / 90,
      )
      if (directionError !== 0) {
        throw new Error(`WASM scanner rejected direction ${direction}°.`)
      }
    })

    request.constraints.forEach((constraint, index) => {
      const filterError = module.search_set_filter(
        index,
        constraint.x,
        constraint.y,
        constraint.z,
        constraint.rotation,
        constraint.visibleMask,
      )
      if (filterError !== 0) {
        throw new Error(`WASM scanner rejected constraint ${index + 1}.`)
      }
    })

    const next = command.checkpoint?.next ?? shardStart
    const matchCount = command.checkpoint?.matchCount ?? 0n
    if (next < shardStart || next > shardEnd) {
      throw new Error('The saved shard cursor is outside its ordinal range.')
    }
    // The C scanner maps the absolute ordinal back to the exact linear or
    // spiral cursor. Each instance keeps only its shard-local match counter.
    const restoreError = module.search_restore(next, matchCount)
    if (restoreError !== 0) {
      throw new Error(`WASM scanner rejected the saved checkpoint (${restoreError}).`)
    }

    if (module.search_is_finished() || module.search_get_processed() >= shardEnd) {
      postState('completed')
      activeRequestId = undefined
      return
    }
    postState('running')
    scheduleBatch()
  } catch (error) {
    if (!searchExports) {
      /*
       * Loading failed before an instance existed, so construct an error
       * message directly rather than asking postState for scanner counters.
       */
      const message: WebSearchShardWorkerState = {
        type: 'state',
        requestId: command.requestId,
        shardId,
        phase: 'error',
        next: command.checkpoint?.next ?? shardStart,
        matchCount: command.checkpoint?.matchCount ?? 0n,
        checksPerSecond: 0,
        results: [],
        error: error instanceof Error ? error.message : 'Web search failed.',
      }
      self.postMessage(message)
    } else {
      postState(
        'error',
        [],
        error instanceof Error ? error.message : 'Web search failed.',
      )
    }
    activeRequestId = undefined
  }
}

self.onmessage = (event: MessageEvent<WebSearchShardWorkerCommand>) => {
  const command = event.data
  if (command.type === 'start') {
    void startSearch(command)
    return
  }
  if (command.requestId !== activeRequestId) return

  if (command.type === 'pause') {
    pauseRequested = true
    postState('paused')
    return
  }
  if (command.type === 'resume') {
    if (!pauseRequested || stopRequested) return
    pauseRequested = false
    postState('running')
    scheduleBatch()
    return
  }

  stopRequested = true
  scheduleBatch()
}

export {}
