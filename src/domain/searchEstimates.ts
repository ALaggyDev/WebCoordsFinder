import type { EditorDocument } from './types'
import { confirmedUniqueEvidence } from './exportConfig'

export type SearchRuntime = 'web' | 'cpu' | 'cuda'

export interface SearchTimeEstimate {
  runtime: SearchRuntime
  seconds: number
}

const PLACEHOLDER_CHECKS_PER_SECOND: Record<SearchRuntime, number> = {
  web: 2_000_000,
  cpu: 25_000_000,
  cuda: 2_000_000_000,
}

export function estimateSearchVolume(document: EditorDocument): number {
  const { bounds } = document.scanner
  const width = Math.max(0, bounds.xEnd - bounds.xStart + 1)
  const height = Math.max(0, bounds.yEnd - bounds.yStart + 1)
  const depth = Math.max(0, bounds.zEnd - bounds.zStart + 1)
  return width * height * depth
}

export function estimateSearchTimes(
  document: EditorDocument,
): SearchTimeEstimate[] {
  const volume = estimateSearchVolume(document)
  const constraintCount = confirmedUniqueEvidence(document).length
  const toleranceFactor = 1 + document.scanner.maxBadBlocks * 0.12
  const constraintFactor = 1 + Math.min(constraintCount, 256) / 128
  const work = volume * toleranceFactor * constraintFactor

  return (['web', 'cpu', 'cuda'] as const).map((runtime) => ({
    runtime,
    seconds: work / PLACEHOLDER_CHECKS_PER_SECOND[runtime],
  }))
}

export function estimateHitCount(document: EditorDocument): number {
  const constraints = confirmedUniqueEvidence(document)
  if (constraints.length === 0) return estimateSearchVolume(document)

  const tolerance = Math.min(
    constraints.length,
    Math.max(0, Math.floor(document.scanner.maxBadBlocks)),
  )
  let mismatchProbabilities: number[] = Array.from(
    { length: tolerance + 1 },
    (_, index) => (index === 0 ? 1 : 0),
  )

  constraints.forEach((constraint, constraintIndex) => {
    const matchProbability = 1 / constraint.stateCount
    const next = Array.from({ length: tolerance + 1 }, () => 0)
    const highestMismatch = Math.min(tolerance, constraintIndex + 1)

    for (let mismatches = 0; mismatches <= highestMismatch; mismatches += 1) {
      next[mismatches] +=
        mismatchProbabilities[mismatches] * matchProbability
      if (mismatches > 0) {
        next[mismatches] +=
          mismatchProbabilities[mismatches - 1] * (1 - matchProbability)
      }
    }
    mismatchProbabilities = next
  })

  const passProbability = mismatchProbabilities.reduce(
    (sum, probability) => sum + probability,
    0,
  )
  return estimateSearchVolume(document) * passProbability
}

export function estimateHitPrecision(document: EditorDocument): number {
  const expectedHits = estimateHitCount(document)
  if (expectedHits <= 0) return 0
  return Math.min(1, 1 / expectedHits)
}

export function minimumBitsForPrecision(
  document: EditorDocument,
  targetPrecision: number,
): number {
  const volume = estimateSearchVolume(document)
  const precision = Math.min(1, Math.max(0, targetPrecision))
  if (volume <= 1 || precision === 0) return 0
  return Math.max(0, Math.ceil(Math.log2(volume * precision)))
}

export function formatEstimatedCount(value: number): string {
  if (!Number.isFinite(value)) return 'Over 1e308'
  if (value < 1) return '<1'
  if (value >= 1e6) return value.toExponential(2).replace('e+', 'e')
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value)
}

export function formatSearchTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'Over 1,000 years'
  if (seconds < 1) return '<1 sec'
  if (seconds < 60) return `~${Math.ceil(seconds)} sec`
  if (seconds < 3_600) return `~${Math.ceil(seconds / 60)} min`
  if (seconds < 86_400) return `~${Math.ceil(seconds / 3_600)} hr`

  const days = seconds / 86_400
  if (days < 365) return `~${Math.ceil(days)} days`

  const years = days / 365
  if (years > 1_000) return 'Over 1,000 years'
  return `~${Math.ceil(years)} years`
}
