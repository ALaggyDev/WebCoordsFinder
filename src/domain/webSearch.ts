import { confirmedUniqueEvidence, validateForExport } from './exportConfig'
import { compileOffsetDirections, offsetTraversalBits, type OffsetConstraint } from './offsetSearch'
import { compileFilterDirections } from './filterConstraints'
import type {
  EditorDocument,
  PersistedWebSearchPhase,
  ScanOrder,
  SearchDirection,
  TextureAlgorithm,
  WebSearchCheckpoint,
  WebSearchResult,
  WebSearchShardCheckpoint,
} from './types'

// The web-search protocol keeps exact counters as BigInt in memory and as
// decimal strings at the persisted document boundary.
export const MAX_WEB_SEARCH_RESULTS = 1_000
export const WEB_SEARCH_ENGINE_VERSION = 7

const textureModeIds: Record<TextureAlgorithm, number> = {
  'Vanilla-1': 0,
  'Vanilla-2': 1,
  'Vanilla-3': 2,
  'Sodium-1': 3,
  'Sodium-2': 4,
}

const scanOrderIds: Record<ScanOrder, number> = {
  linear: 0,
  spiral: 1,
  'reverse-spiral': 2,
}

export interface WebSearchConstraint {
  x: number
  y: number
  z: number
  acceptedIndices: number
}

export interface WebSearchRequest {
  offsetConstraintsByDirection?: OffsetConstraint[][]
  offsetBits?: number
  yUnconstrained?: boolean
  mode: number
  scanOrder: number
  directions: SearchDirection[]
  xStart: number
  xEnd: number
  yStart: number
  yEnd: number
  zStart: number
  zEnd: number
  maxBadBlocks: number
  constraintsByDirection: WebSearchConstraint[][]
  forcedErrorsByDirection: number[]
}

export interface WebSearchOrdinalShard {
  id: number
  start: bigint
  end: bigint
}

export interface WebSearchShardProgress extends WebSearchOrdinalShard {
  next: bigint
  matchCount: bigint
  offsetMatchCount?: bigint
}

export interface WebSearchOrdinalResult extends Omit<WebSearchResult, 'scanOrdinal'> {
  ordinal: bigint
}

export function recommendedSearchWorkerCount(
  hardwareConcurrency: number | undefined,
): number {
  const logicalProcessors = Number.isFinite(hardwareConcurrency)
    ? Math.floor(hardwareConcurrency ?? 2)
    : 2
  return Math.min(8, Math.max(1, logicalProcessors - 1))
}

export function maximumSearchWorkerCount(
  hardwareConcurrency: number | undefined,
): number {
  const logicalProcessors = Number.isFinite(hardwareConcurrency)
    ? Math.floor(hardwareConcurrency ?? 2)
    : 2
  return Math.min(32, Math.max(1, logicalProcessors - 1))
}

export function splitOrdinalRange(
  total: bigint,
  requestedWorkerCount: number,
): WebSearchOrdinalShard[] {
  if (total < 0n) throw new Error('Search volume cannot be negative.')
  if (!Number.isInteger(requestedWorkerCount) || requestedWorkerCount < 1) {
    throw new Error('Search worker count must be a positive integer.')
  }
  if (total === 0n) return []
  const workerCount = Number(
    total < BigInt(requestedWorkerCount)
      ? total
      : BigInt(requestedWorkerCount),
  )
  const quotient = total / BigInt(workerCount)
  const remainder = total % BigInt(workerCount)
  let next = 0n
  return Array.from({ length: workerCount }, (_, id) => {
    const length = quotient + (BigInt(id) < remainder ? 1n : 0n)
    const shard = { id, start: next, end: next + length }
    next = shard.end
    return shard
  })
}

export function validateSearchShardProgress(
  total: bigint,
  processed: bigint,
  matchCount: bigint,
  saved: WebSearchShardProgress[],
): WebSearchShardProgress[] {
  if (saved.length === 0) {
    throw new Error('The saved search checkpoint has no worker shards.')
  }
  let expectedStart = 0n
  let aggregateProcessed = 0n
  let aggregateMatches = 0n
  saved.forEach((shard, index) => {
    if (
      shard.id !== index ||
      shard.start !== expectedStart ||
      shard.end <= shard.start ||
      shard.next < shard.start ||
      shard.next > shard.end ||
      shard.matchCount < 0n ||
      (shard.offsetMatchCount ?? 0n) < 0n ||
      (shard.offsetMatchCount ?? 0n) > shard.next - shard.start ||
      shard.matchCount > shard.next - shard.start
    ) {
      throw new Error('The saved search shard layout is invalid.')
    }
    expectedStart = shard.end
    aggregateProcessed += shard.next - shard.start
    aggregateMatches += shard.matchCount
  })
  if (
    expectedStart !== total ||
    aggregateProcessed !== processed ||
    aggregateMatches !== matchCount
  ) {
    throw new Error('The saved search shard totals are inconsistent.')
  }
  return saved
}

export function mergeOrdinalSearchResults(
  retained: WebSearchOrdinalResult[],
  incoming: WebSearchOrdinalResult[],
  limit = MAX_WEB_SEARCH_RESULTS,
): WebSearchOrdinalResult[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error('Search result limit must be a non-negative integer.')
  }
  const byOrdinal = new Map<bigint, WebSearchOrdinalResult>()
  retained.forEach((result) => byOrdinal.set(result.ordinal, result))
  incoming.forEach((result) => byOrdinal.set(result.ordinal, result))
  return [...byOrdinal.values()]
    .sort((left, right) =>
      left.ordinal < right.ordinal ? -1 : left.ordinal > right.ordinal ? 1 : 0,
    )
    .slice(0, limit)
}

export function persistedOrdinalResults(
  results: WebSearchOrdinalResult[],
): WebSearchResult[] {
  return results.map(({ ordinal, ...result }) => ({
    ...result,
    scanOrdinal: ordinal.toString(),
  }))
}

export function restoreOrdinalResults(
  results: WebSearchResult[],
  total: bigint,
): WebSearchOrdinalResult[] {
  const restored = results.map(({ scanOrdinal, ...result }) => {
    if (scanOrdinal === undefined) {
      throw new Error('The saved search results do not contain scan ordinals.')
    }
    const ordinal = BigInt(scanOrdinal)
    if (ordinal < 0n || ordinal >= total) {
      throw new Error('A saved search result has an invalid scan ordinal.')
    }
    return { ...result, ordinal }
  })
  const merged = mergeOrdinalSearchResults([], restored)
  if (merged.length !== restored.length) {
    throw new Error('The saved search results contain duplicate scan ordinals.')
  }
  return merged
}

export function validateRetainedResultProgress(
  results: WebSearchOrdinalResult[],
  shards: WebSearchShardProgress[],
): void {
  results.forEach((result) => {
    const shard = shards.find(
      (candidate) =>
        result.ordinal >= candidate.start && result.ordinal < candidate.end,
    )
    if (!shard || result.ordinal >= shard.next) {
      throw new Error('A saved search result is ahead of its shard cursor.')
    }
  })
}

export type WebSearchPhase =
  | 'idle'
  | 'loading'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'error'

export type WebSearchWorkerCommand =
  | {
      type: 'start'
      requestId: string
      request: WebSearchRequest
      workerCount?: number
      checkpoint?: {
        processed: bigint
        matchCount: bigint
        offsetMatchCount?: bigint
        results: WebSearchResult[]
        shards?: WebSearchShardProgress[]
      }
    }
  | { type: 'pause'; requestId: string }
  | { type: 'resume'; requestId: string }
  | { type: 'stop'; requestId: string }

export interface WebSearchWorkerState {
  type: 'state'
  requestId: string
  phase: 'running' | 'paused' | 'stopped' | 'completed' | 'error'
  processed: bigint
  total: bigint
  matchCount: bigint
  offsetMatchCount?: bigint
  checksPerSecond: number
  // Omitted when the deterministic retained set has not changed since the
  // previous publication. This keeps high-frequency counter updates small.
  results?: WebSearchResult[]
  shards: WebSearchShardProgress[]
  error?: string
}

export type WebSearchShardWorkerCommand =
  | {
      type: 'start'
      requestId: string
      request: WebSearchRequest
      shard: WebSearchOrdinalShard
      checkpoint?: {
        next: bigint
        matchCount: bigint
        offsetMatchCount?: bigint
      }
    }
  | { type: 'pause'; requestId: string }
  | { type: 'resume'; requestId: string }
  | { type: 'stop'; requestId: string }

export interface WebSearchShardWorkerState {
  type: 'state'
  requestId: string
  shardId: number
  phase: 'running' | 'paused' | 'stopped' | 'completed' | 'error'
  next: bigint
  matchCount: bigint
  offsetMatchCount?: bigint
  checksPerSecond: number
  results: WebSearchOrdinalResult[]
  error?: string
}

export function aggregateSearchPoolPhase(
  phases: WebSearchShardWorkerState['phase'][],
  pauseRequested: boolean,
  stopRequested: boolean,
): WebSearchWorkerState['phase'] {
  if (phases.some((phase) => phase === 'error')) return 'error'
  if (phases.length > 0 && phases.every((phase) => phase === 'completed')) {
    return 'completed'
  }
  if (
    stopRequested &&
    phases.every((phase) => phase === 'stopped' || phase === 'completed')
  ) {
    return 'stopped'
  }
  if (
    pauseRequested &&
    phases.every((phase) => phase === 'paused' || phase === 'completed')
  ) {
    return 'paused'
  }
  return 'running'
}

const int32Minimum = -2_147_483_648
const int32Maximum = 2_147_483_647
const uint64Maximum = (1n << 64n) - 1n

function requireInt32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < int32Minimum || value > int32Maximum) {
    throw new Error(`${label} must be a 32-bit integer for web search.`)
  }
  return value
}

export function createWebSearchRequest(
  document: EditorDocument,
): WebSearchRequest {
  const textures = document.scanner.textureEnabled !== false
  const offsets = document.scanner.offsetsEnabled === true
  if (!textures && !offsets) throw new Error('Enable texture rotations or block offsets to search.')
  const textureRows = textures ? confirmedUniqueEvidence(document) : []
  const offsetConstraints = offsets ? compileOffsetDirections(document) : document.scanner.directions.map(() => [])
  const hasOffsets = offsetConstraints.some((entries) => entries.length > 0)
  if (textures && document.evidence.some((entry) =>
    entry.reviewStatus === 'confirmed' && entry.selectedVariant !== undefined)) {
    const validation = validateForExport(document, 'browser')
    if (validation.errors.length) throw new Error(validation.errors[0])
  } else {
    if (!document.scanner.directions.length || new Set(document.scanner.directions).size !== document.scanner.directions.length ||
      document.scanner.directions.some((n) => ![0, 90, 180, 270].includes(n))) {
      throw new Error('Select at least one unique quarter-turn search direction.')
    }
  }
  if (!textureRows.length && !hasOffsets) throw new Error('Confirm a texture face or add an active block offset to search.')
  const yUnconstrained = textureRows.length === 0

  const { bounds } = document.scanner
  const xStart = requireInt32(bounds.xStart, 'X start')
  const xEnd = requireInt32(bounds.xEnd, 'X end')
  const yStart = yUnconstrained ? 0 : requireInt32(bounds.yStart, 'Y start')
  const yEnd = yUnconstrained ? 0 : requireInt32(bounds.yEnd, 'Y end')
  const zStart = requireInt32(bounds.zStart, 'Z start')
  const zEnd = requireInt32(bounds.zEnd, 'Z end')
  const maxBadBlocks = requireInt32(
    document.scanner.errorTolerance,
    'Error tolerance',
  )

  if (xStart > xEnd || zStart > zEnd || yStart > yEnd) throw new Error('Every search start must be less than or equal to its end.')
  if ([xStart, xEnd, zStart, zEnd].some((n) => Math.abs(n) > 30_000_000)) {
    throw new Error('X/Z bounds must lie within ±30,000,000 blocks.')
  }
  if (maxBadBlocks < 0 || maxBadBlocks > 65535) throw new Error('Texture error tolerance must be between 0 and 65,535.')
  const offsetBits = hasOffsets ? offsetTraversalBits(xStart, xEnd, zStart, zEnd) : 0
  const xzVolume = hasOffsets ? 1n << BigInt(offsetBits * 2) :
    (BigInt(xEnd) - BigInt(xStart) + 1n) * (BigInt(zEnd) - BigInt(zStart) + 1n)
  if (xzVolume * (BigInt(yEnd) - BigInt(yStart) + 1n) * BigInt(document.scanner.directions.length) > uint64Maximum) {
    throw new Error('The search traversal exceeds the WASM counter limit; narrow the Y range.')
  }
  const compiledDirections = textureRows.length ? compileFilterDirections(
    textureRows, document.scanner.textureAlgorithm, document.scanner.directions,
  ) : document.scanner.directions.map((direction) => ({ direction, constraints: [], forcedErrors: 0 }))

  return {
    offsetConstraintsByDirection: offsetConstraints,
    offsetBits,
    yUnconstrained,
    mode: textureModeIds[document.scanner.textureAlgorithm],
    scanOrder: scanOrderIds[document.scanner.scanOrder],
    directions: document.scanner.directions,
    xStart,
    xEnd,
    yStart,
    yEnd,
    zStart,
    zEnd,
    maxBadBlocks,
    constraintsByDirection: compiledDirections.map((entry) => entry.constraints),
    forcedErrorsByDirection: compiledDirections.map((entry) => entry.forcedErrors),
  }
}

export function webSearchRequestKey(request: WebSearchRequest): string {
  // Any input or engine-semantic change invalidates checkpoint resumption.
  return JSON.stringify([WEB_SEARCH_ENGINE_VERSION, request])
}

export function webSearchRequestVolume(request: WebSearchRequest): bigint {
  return (
    (request.offsetBits ? 1n << BigInt(request.offsetBits * 2) :
      (BigInt(request.xEnd) - BigInt(request.xStart) + 1n) *
      (BigInt(request.zEnd) - BigInt(request.zStart) + 1n)) *
    (BigInt(request.yEnd) - BigInt(request.yStart) + 1n) *
    BigInt(request.directions.length)
  )
}

export interface WebSearchViewState {
  offsetBits?: number
  yUnconstrained?: boolean
  phase: WebSearchPhase
  processed: bigint
  total: bigint
  matchCount: bigint
  offsetMatchCount?: bigint
  checksPerSecond: number
  results: WebSearchResult[]
  shards?: WebSearchShardProgress[]
  error?: string
}

export const initialWebSearchState: WebSearchViewState = {
  phase: 'idle',
  processed: 0n,
  total: 0n,
  matchCount: 0n,
  checksPerSecond: 0,
  results: [],
}

export function restoreWebSearchCheckpoint(
  checkpoint: WebSearchCheckpoint | null | undefined,
): WebSearchViewState {
  if (!checkpoint) return initialWebSearchState
  const shards = checkpoint.shards?.map((shard, id) => ({
    id,
    start: BigInt(shard.start),
    end: BigInt(shard.end),
    next: BigInt(shard.next),
    matchCount: BigInt(shard.matchCount),
    offsetMatchCount: BigInt(shard.offsetMatchCount ?? 0),
  }))
  return {
    // A worker cannot survive a reload, so an in-flight persisted search
    // reopens as paused and requires an explicit resume.
    yUnconstrained: checkpoint.yUnconstrained,
    offsetBits: checkpoint.offsetBits,
    phase: checkpoint.phase === 'running' ? 'paused' : checkpoint.phase,
    processed: BigInt(checkpoint.processed),
    total: BigInt(checkpoint.total),
    matchCount: BigInt(checkpoint.matchCount),
    offsetMatchCount: BigInt(checkpoint.offsetMatchCount ?? 0),
    checksPerSecond: checkpoint.checksPerSecond,
    results: checkpoint.results,
    ...(shards ? { shards } : {}),
    error: checkpoint.error,
  }
}

function persistedPhase(phase: WebSearchPhase): PersistedWebSearchPhase {
  if (phase === 'completed' || phase === 'error' || phase === 'paused') {
    return phase
  }
  if (phase === 'stopped' || phase === 'stopping') return 'stopped'
  // Loading and transient pause requests both represent resumable work.
  return 'running'
}

export function createWebSearchCheckpoint(
  requestKey: string,
  state: WebSearchViewState,
  updatedAt = Date.now(),
): WebSearchCheckpoint {
  return {
    engineVersion: WEB_SEARCH_ENGINE_VERSION,
    yUnconstrained: state.yUnconstrained,
    offsetBits: state.offsetBits,
    requestKey,
    phase: persistedPhase(state.phase),
    processed: state.processed.toString(),
    total: state.total.toString(),
    matchCount: state.matchCount.toString(),
    offsetMatchCount: (state.offsetMatchCount ?? 0n).toString(),
    checksPerSecond: Number.isFinite(state.checksPerSecond)
      ? state.checksPerSecond
      : 0,
    results: state.results,
    ...(state.shards
      ? {
          shards: state.shards.map(
            (shard): WebSearchShardCheckpoint => ({
              start: shard.start.toString(),
              end: shard.end.toString(),
              next: shard.next.toString(),
              matchCount: shard.matchCount.toString(),
              offsetMatchCount: (shard.offsetMatchCount ?? 0n).toString(),
            }),
          ),
        }
      : {}),
    error: state.error,
    updatedAt,
  }
}

export function formatSearchCount(value: bigint): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function searchProgressPercent(
  processed: bigint,
  total: bigint,
): number {
  if (total <= 0n) return 0
  if (processed >= total) return 100
  return Number((processed * 10_000n) / total) / 100
}

export type { WebSearchCheckpoint, WebSearchResult } from './types'
