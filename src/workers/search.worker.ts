import wasmUrl from '../wasm/coords_search.wasm?url'
import {
  MAX_WEB_SEARCH_RESULTS,
  type WebSearchResult,
  type WebSearchWorkerCommand,
  type WebSearchWorkerState,
} from '../domain/webSearch'
import type { SearchDirection } from '../domain/types'

interface SearchExports extends WebAssembly.Exports {
  search_configure: (
    mode: number,
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

let exportsPromise: Promise<SearchExports> | undefined
let activeRequestId: string | undefined
let searchExports: SearchExports | undefined
let pauseRequested = false
let stopRequested = false
let capturedResults = 0
let batchSize = 16_384
let checksPerSecond = 0
let lastProgressAt = 0

async function loadSearchExports(): Promise<SearchExports> {
  if (!exportsPromise) {
    exportsPromise = (async () => {
      const response = await fetch(wasmUrl)
      if (!response.ok) {
        throw new Error(`Unable to load web scanner (${response.status}).`)
      }

      let instance: WebAssembly.Instance
      try {
        const result = await WebAssembly.instantiateStreaming(response.clone())
        instance = result.instance
      } catch {
        const result = await WebAssembly.instantiate(await response.arrayBuffer())
        instance = result.instance
      }
      return instance.exports as SearchExports
    })()
  }
  return exportsPromise
}

function collectResults(module: SearchExports): WebSearchResult[] {
  const count = module.search_get_result_count()
  const results = Array.from({ length: count }, (_, index) => ({
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
  phase: WebSearchWorkerState['phase'],
  results: WebSearchResult[] = [],
  error?: string,
) {
  if (!activeRequestId || !searchExports) return
  const message: WebSearchWorkerState = {
    type: 'state',
    requestId: activeRequestId,
    phase,
    processed: searchExports.search_get_processed(),
    total: searchExports.search_get_total(),
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
  setTimeout(runBatch, 0)
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
  const scanned = module.search_scan_batch(batchSize, captureLimit)
  const elapsed = Math.max(0.01, performance.now() - startedAt)
  const instantaneousRate = (scanned * 1_000) / elapsed
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
    results.length > 0 ||
    now - lastProgressAt >= progressIntervalMilliseconds ||
    module.search_is_finished()
  ) {
    postState('running', results)
    lastProgressAt = now
  }

  if (module.search_is_finished()) {
    finishSearch('completed')
    return
  }
  scheduleBatch()
}

async function startSearch(
  command: Extract<WebSearchWorkerCommand, { type: 'start' }>,
) {
  activeRequestId = command.requestId
  pauseRequested = false
  stopRequested = false
  capturedResults = command.checkpoint?.capturedResults ?? 0
  batchSize = 16_384
  checksPerSecond = 0
  lastProgressAt = 0

  try {
    const module = await loadSearchExports()
    if (activeRequestId !== command.requestId) return
    searchExports = module
    const request = command.request
    const configureError = module.search_configure(
      request.mode,
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

    if (command.checkpoint) {
      const restoreError = module.search_restore(
        command.checkpoint.processed,
        command.checkpoint.matchCount,
      )
      if (restoreError !== 0) {
        throw new Error(`WASM scanner rejected the saved checkpoint (${restoreError}).`)
      }
    }

    if (module.search_is_finished()) {
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
      const message: WebSearchWorkerState = {
        type: 'state',
        requestId: command.requestId,
        phase: 'error',
        processed: 0n,
        total: 0n,
        matchCount: 0n,
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

self.onmessage = (event: MessageEvent<WebSearchWorkerCommand>) => {
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
