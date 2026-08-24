import { generateSearchKernel } from '../domain/searchKernel'
import {
  MAX_WEB_SEARCH_RESULTS,
  aggregateSearchPoolPhase,
  maximumSearchWorkerCount,
  mergeOrdinalSearchResults,
  persistedOrdinalResults,
  recommendedSearchWorkerCount,
  restoreOrdinalResults,
  splitOrdinalRange,
  validateSearchShardProgress,
  validateRetainedResultProgress,
  type WebSearchOrdinalResult,
  type WebSearchShardProgress,
  type WebSearchKernelHandoff,
  type WebSearchShardWorkerCommand,
  type WebSearchShardWorkerState,
  type WebSearchWorkerCommand,
  type WebSearchWorkerState,
} from '../domain/webSearch'

type ShardPhase = WebSearchShardWorkerState['phase']

interface ActiveShard extends WebSearchShardProgress {
  worker: Worker
  phase: ShardPhase
}

const publicationIntervalMilliseconds = 100
// A search reuses one identity; a handful of entries covers switching between
// recent requests without retaining compiled code for the whole session.
const maximumCachedKernels = 4

const compiledKernels = new Map<string, WebSearchKernelHandoff>()

/**
 * Generates and compiles the request-specific scanner kernel once per search.
 * Every failure is silent: shard workers then load the checked-in exact module.
 * `WebAssembly.Module` construction is synchronous inside a worker, so the
 * start command stays free of a compilation race with pause/stop.
 */
function prepareSearchKernel(
  request: Extract<WebSearchWorkerCommand, { type: 'start' }>['request'],
): WebSearchKernelHandoff | undefined {
  try {
    const kernel = generateSearchKernel(request)
    if (!kernel) return undefined
    const cached = compiledKernels.get(kernel.identity)
    if (cached) return cached
    const handoff: WebSearchKernelHandoff = {
      module: new WebAssembly.Module(kernel.bytes),
      signature: kernel.signature,
    }
    if (compiledKernels.size >= maximumCachedKernels) {
      const oldest = compiledKernels.keys().next()
      if (!oldest.done) compiledKernels.delete(oldest.value)
    }
    compiledKernels.set(kernel.identity, handoff)
    return handoff
  } catch {
    return undefined
  }
}

let activeRequestId: string | undefined
let shards: ActiveShard[] = []
let pauseRequested = false
let stopRequested = false
let retainedResults: WebSearchOrdinalResult[] = []
let retainedResultsDirty = true
let publicationTimer: ReturnType<typeof setTimeout> | undefined
let lastPublishedAt = 0
let rateMeasurementStartedAt = 0
let rateMeasurementStartProcessed = 0n

function terminateShards() {
  shards.forEach((shard) => shard.worker.terminate())
}

function aggregatePhase(): WebSearchWorkerState['phase'] {
  return aggregateSearchPoolPhase(
    shards.map((shard) => shard.phase),
    pauseRequested,
    stopRequested,
  )
}

function currentProgress(): WebSearchShardProgress[] {
  return shards.map(({ id, start, end, next, matchCount }) => ({
    id,
    start,
    end,
    next,
    matchCount,
  }))
}

function emitState(error?: string) {
  if (!activeRequestId) return
  if (publicationTimer) {
    clearTimeout(publicationTimer)
    publicationTimer = undefined
  }
  const phase = error ? 'error' : aggregatePhase()
  const progress = currentProgress()
  const processed = progress.reduce(
    (sum, shard) => sum + shard.next - shard.start,
    0n,
  )
  const now = performance.now()
  const measurementElapsed = now - rateMeasurementStartedAt
  const measuredChecksPerSecond =
    rateMeasurementStartedAt > 0 &&
    measurementElapsed > 0 &&
    processed >= rateMeasurementStartProcessed
      ? (Number(processed - rateMeasurementStartProcessed) * 1_000) /
        measurementElapsed
      : 0
  const message: WebSearchWorkerState = {
    type: 'state',
    requestId: activeRequestId,
    phase,
    processed,
    total: progress.reduce(
      (sum, shard) => sum + shard.end - shard.start,
      0n,
    ),
    matchCount: progress.reduce(
      (sum, shard) => sum + shard.matchCount,
      0n,
    ),
    checksPerSecond: measuredChecksPerSecond,
    // When present, this is a complete deterministic snapshot rather than an
    // arrival-order delta. Unchanged sets stay inside the coordinator so a
    // populated result table does not reconcile at progress-update frequency.
    ...(retainedResultsDirty
      ? { results: persistedOrdinalResults(retainedResults) }
      : {}),
    shards: progress,
    error,
  }
  lastPublishedAt = now
  self.postMessage(message)
  retainedResultsDirty = false

  if (phase === 'completed' || phase === 'stopped' || phase === 'error') {
    terminateShards()
    activeRequestId = undefined
  }
}

function schedulePublication(force = false, error?: string) {
  const terminal = error !== undefined || [
    'paused',
    'stopped',
    'completed',
    'error',
  ].includes(aggregatePhase())
  if (force || terminal) {
    emitState(error)
    return
  }
  if (pauseRequested || stopRequested) return
  if (publicationTimer) return
  const delay = Math.max(
    0,
    publicationIntervalMilliseconds - (performance.now() - lastPublishedAt),
  )
  publicationTimer = setTimeout(() => emitState(), delay)
}

function failSearch(message: string) {
  shards.forEach((shard) => {
    if (shard.phase === 'running' || shard.phase === 'paused') {
      shard.phase = 'error'
    }
  })
  schedulePublication(true, message)
}

function validateResumeShards(
  total: bigint,
  checkpoint: NonNullable<
    Extract<WebSearchWorkerCommand, { type: 'start' }>['checkpoint']
  >,
): WebSearchShardProgress[] {
  const saved = checkpoint.shards
  if (!saved || saved.length === 0) {
    if (checkpoint.processed !== 0n || checkpoint.matchCount !== 0n) {
      throw new Error('This search checkpoint predates resumable worker sharding.')
    }
    return splitOrdinalRange(
      total,
      recommendedSearchWorkerCount(self.navigator.hardwareConcurrency),
    ).map((shard) => ({ ...shard, next: shard.start, matchCount: 0n }))
  }

  return validateSearchShardProgress(
    total,
    checkpoint.processed,
    checkpoint.matchCount,
    saved,
  )
}

function startShard(
  requestId: string,
  request: Extract<WebSearchWorkerCommand, { type: 'start' }>['request'],
  progress: WebSearchShardProgress,
  kernel: WebSearchKernelHandoff | undefined,
): ActiveShard {
  const worker = new Worker(new URL('./search.worker.ts', import.meta.url), {
    type: 'module',
    name: `coords-search-${progress.id + 1}`,
  })
  const active: ActiveShard = {
    ...progress,
    worker,
    phase: progress.next === progress.end ? 'completed' : 'running',
  }
  worker.onmessage = (event: MessageEvent<WebSearchShardWorkerState>) => {
    const message = event.data
    if (
      message.type !== 'state' ||
      message.requestId !== activeRequestId ||
      message.shardId !== active.id
    ) {
      return
    }
    active.next = message.next
    active.matchCount = message.matchCount
    active.phase = message.phase
    if (message.results.length > 0) {
      const nextRetainedResults = mergeOrdinalSearchResults(
        retainedResults,
        message.results,
        MAX_WEB_SEARCH_RESULTS,
      )
      const changed =
        nextRetainedResults.length !== retainedResults.length ||
        nextRetainedResults.some(
          (result, index) => result.ordinal !== retainedResults[index]?.ordinal,
        )
      if (changed) {
        retainedResults = nextRetainedResults
        retainedResultsDirty = true
      }
    }
    if (message.phase === 'error') {
      failSearch(message.error ?? `Search worker ${active.id + 1} failed.`)
      return
    }
    schedulePublication()
  }
  worker.onerror = () => {
    active.phase = 'error'
    failSearch(`Search worker ${active.id + 1} stopped unexpectedly.`)
  }

  const command: WebSearchShardWorkerCommand = {
    type: 'start',
    requestId,
    request,
    shard: {
      id: progress.id,
      start: progress.start,
      end: progress.end,
    },
    checkpoint: {
      next: progress.next,
      matchCount: progress.matchCount,
    },
  }
  try {
    worker.postMessage(kernel ? { ...command, kernel } : command)
  } catch {
    // Structured-cloning a compiled module is an optimization, not a
    // requirement. A transfer failure must start the shard on the checked-in
    // scanner rather than failing the whole search.
    worker.postMessage(command)
  }
  return active
}

function startSearch(
  command: Extract<WebSearchWorkerCommand, { type: 'start' }>,
) {
  terminateShards()
  shards = []
  if (publicationTimer) clearTimeout(publicationTimer)
  publicationTimer = undefined
  activeRequestId = command.requestId
  pauseRequested = false
  stopRequested = false
  retainedResults = []
  retainedResultsDirty = true
  lastPublishedAt = 0
  rateMeasurementStartedAt = performance.now()
  rateMeasurementStartProcessed = command.checkpoint?.processed ?? 0n

  try {
    const total = (
      (BigInt(command.request.xEnd) - BigInt(command.request.xStart) + 1n) *
      (BigInt(command.request.yEnd) - BigInt(command.request.yStart) + 1n) *
      (BigInt(command.request.zEnd) - BigInt(command.request.zStart) + 1n) *
      BigInt(command.request.directions.length)
    )
    retainedResults = command.checkpoint
      ? restoreOrdinalResults(command.checkpoint.results, total)
      : []
    const maximumWorkers = maximumSearchWorkerCount(
      self.navigator.hardwareConcurrency,
    )
    const requestedWorkers = command.workerCount ??
      recommendedSearchWorkerCount(self.navigator.hardwareConcurrency)
    if (!Number.isInteger(requestedWorkers) || requestedWorkers < 1) {
      throw new Error('Search worker count must be a positive integer.')
    }
    const workerCount = Math.min(maximumWorkers, requestedWorkers)
    const progress = command.checkpoint
      ? validateResumeShards(total, command.checkpoint)
      : splitOrdinalRange(
          total,
          workerCount,
        ).map((shard) => ({ ...shard, next: shard.start, matchCount: 0n }))
    validateRetainedResultProgress(retainedResults, progress)
    const kernel = prepareSearchKernel(command.request)
    progress.forEach((shard) => {
      shards.push(startShard(
        command.requestId,
        command.request,
        shard,
        kernel,
      ))
    })
  } catch (error) {
    failSearch(
      error instanceof Error ? error.message : 'Unable to start the search pool.',
    )
  }
}

function sendToActiveShards(type: 'pause' | 'resume' | 'stop') {
  if (!activeRequestId) return
  shards.forEach((shard) => {
    if (shard.phase === 'completed' || shard.phase === 'stopped') return
    const command: WebSearchShardWorkerCommand = {
      type,
      requestId: activeRequestId!,
    }
    shard.worker.postMessage(command)
  })
}

self.onmessage = (event: MessageEvent<WebSearchWorkerCommand>) => {
  const command = event.data
  if (command.type === 'start') {
    startSearch(command)
    return
  }
  if (command.requestId !== activeRequestId) return
  if (command.type === 'pause') {
    pauseRequested = true
    sendToActiveShards('pause')
    return
  }
  if (command.type === 'resume') {
    pauseRequested = false
    sendToActiveShards('resume')
    return
  }
  pauseRequested = false
  stopRequested = true
  sendToActiveShards('stop')
}

export {}
