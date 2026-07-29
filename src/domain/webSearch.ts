import { confirmedUniqueEvidence, validateForExport } from './exportConfig'
import type {
  EditorDocument,
  PersistedWebSearchPhase,
  SearchDirection,
  TextureAlgorithm,
  WebSearchCheckpoint,
  WebSearchResult,
} from './types'

export const MAX_WEB_SEARCH_RESULTS = 1_000
export const WEB_SEARCH_ENGINE_VERSION = 2

const textureModeIds: Record<TextureAlgorithm, number> = {
  'Vanilla-1': 0,
  'Vanilla-2': 1,
  'Vanilla-3': 2,
  'Sodium-1': 3,
  'Sodium-2': 4,
}

export interface WebSearchConstraint {
  x: number
  y: number
  z: number
  rotation: number
  visibleMask: 1 | 3
}

export interface WebSearchRequest {
  mode: number
  directions: SearchDirection[]
  xStart: number
  xEnd: number
  yStart: number
  yEnd: number
  zStart: number
  zEnd: number
  maxBadBlocks: number
  constraints: WebSearchConstraint[]
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
      checkpoint?: {
        processed: bigint
        matchCount: bigint
        capturedResults: number
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
  checksPerSecond: number
  results: WebSearchResult[]
  error?: string
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
  const validation = validateForExport(document)
  if (validation.errors.length > 0) {
    throw new Error(validation.errors[0])
  }

  const { bounds } = document.scanner
  const xStart = requireInt32(bounds.xStart, 'X start')
  const xEnd = requireInt32(bounds.xEnd, 'X end')
  const yStart = requireInt32(bounds.yStart, 'Y start')
  const yEnd = requireInt32(bounds.yEnd, 'Y end')
  const zStart = requireInt32(bounds.zStart, 'Z start')
  const zEnd = requireInt32(bounds.zEnd, 'Z end')
  const maxBadBlocks = requireInt32(
    document.scanner.maxBadBlocks,
    'Error tolerance',
  )

  const volume =
    (BigInt(xEnd) - BigInt(xStart) + 1n) *
    (BigInt(yEnd) - BigInt(yStart) + 1n) *
    (BigInt(zEnd) - BigInt(zStart) + 1n)
  const directionalVolume =
    volume * BigInt(document.scanner.directions.length)
  if (directionalVolume > uint64Maximum) {
    throw new Error('The web search volume exceeds the WASM scanner limit.')
  }

  return {
    mode: textureModeIds[document.scanner.textureAlgorithm],
    directions: document.scanner.directions,
    xStart,
    xEnd,
    yStart,
    yEnd,
    zStart,
    zEnd,
    maxBadBlocks,
    constraints: confirmedUniqueEvidence(document).map((entry) => ({
      x: entry.coordinate.x,
      y: entry.coordinate.y,
      z: entry.coordinate.z,
      rotation: entry.selectedVariant!,
      visibleMask: entry.stateCount === 2 ? 1 : 3,
    })),
  }
}

export function webSearchRequestKey(request: WebSearchRequest): string {
  return JSON.stringify([WEB_SEARCH_ENGINE_VERSION, request])
}

export function webSearchRequestVolume(request: WebSearchRequest): bigint {
  return (
    (BigInt(request.xEnd) - BigInt(request.xStart) + 1n) *
    (BigInt(request.yEnd) - BigInt(request.yStart) + 1n) *
    (BigInt(request.zEnd) - BigInt(request.zStart) + 1n) *
    BigInt(request.directions.length)
  )
}

export interface WebSearchViewState {
  phase: WebSearchPhase
  processed: bigint
  total: bigint
  matchCount: bigint
  checksPerSecond: number
  results: WebSearchResult[]
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
  return {
    phase: checkpoint.phase === 'running' ? 'paused' : checkpoint.phase,
    processed: BigInt(checkpoint.processed),
    total: BigInt(checkpoint.total),
    matchCount: BigInt(checkpoint.matchCount),
    checksPerSecond: checkpoint.checksPerSecond,
    results: checkpoint.results,
    error: checkpoint.error,
  }
}

function persistedPhase(phase: WebSearchPhase): PersistedWebSearchPhase {
  if (phase === 'completed' || phase === 'error' || phase === 'paused') {
    return phase
  }
  if (phase === 'stopped' || phase === 'stopping') return 'stopped'
  return 'running'
}

export function createWebSearchCheckpoint(
  requestKey: string,
  state: WebSearchViewState,
  updatedAt = Date.now(),
): WebSearchCheckpoint {
  return {
    engineVersion: WEB_SEARCH_ENGINE_VERSION,
    requestKey,
    phase: persistedPhase(state.phase),
    processed: state.processed.toString(),
    total: state.total.toString(),
    matchCount: state.matchCount.toString(),
    checksPerSecond: Number.isFinite(state.checksPerSecond)
      ? state.checksPerSecond
      : 0,
    results: state.results,
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
