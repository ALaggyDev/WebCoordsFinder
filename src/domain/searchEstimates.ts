import type { EditorDocument } from './types'
import { confirmedUniqueEvidence } from './exportConfig'

// These estimates communicate relative scale in the UI; only the browser
// worker reports measured throughput, while native rates remain placeholders.
export type SearchRuntime = 'web' | 'cpu' | 'cuda'

export interface SearchTimeEstimate {
  runtime: SearchRuntime
  seconds: number
}

const PLACEHOLDER_CHECKS_PER_SECOND: Record<SearchRuntime, number> = {
  web: 150_000_000,
  cpu: 1_000_000_000,
  cuda: 70_000_000_000,
}

const LOG_FOUR_STATE_MATCH = Math.log(1 / 4)
const LOG_FOUR_STATE_MISMATCH = Math.log(3 / 4)

function logAdd(left: number, right: number): number {
  const largest = Math.max(left, right)
  return largest + Math.log(Math.exp(left - largest) + Math.exp(right - largest))
}

function logFourStatePassProbability(
  constraints: number,
  tolerance: number,
): number {
  if (tolerance >= constraints) return 0

  // Start with zero mismatches, then build each following binomial term from
  // the previous one. Keeping the calculation in log space avoids underflow
  // for the small probabilities that make a filter useful.
  let logTerm = constraints * LOG_FOUR_STATE_MATCH
  let logProbability = logTerm
  for (let mismatches = 1; mismatches <= tolerance; mismatches += 1) {
    logTerm +=
      Math.log(constraints - mismatches + 1) -
      Math.log(mismatches) +
      LOG_FOUR_STATE_MISMATCH -
      LOG_FOUR_STATE_MATCH
    logProbability = logAdd(logProbability, logTerm)
  }
  return logProbability
}

export function estimateSearchVolume(document: EditorDocument): number {
  const { bounds, directions } = document.scanner
  const width = Math.max(0, bounds.xEnd - bounds.xStart + 1)
  const height = Math.max(0, bounds.yEnd - bounds.yStart + 1)
  const depth = Math.max(0, bounds.zEnd - bounds.zStart + 1)
  return width * height * depth * directions.length
}

export function estimateSearchTimes(
  document: EditorDocument,
): SearchTimeEstimate[] {
  const volume = estimateSearchVolume(document)
  const toleranceFactor = 1 + document.scanner.errorTolerance
  const work = volume * toleranceFactor

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
    Math.max(0, document.scanner.errorTolerance),
  )
  let mismatchProbabilities: number[] = Array.from(
    { length: tolerance + 1 },
    (_, index) => (index === 0 ? 1 : 0),
  )

  // Dynamic programming accumulates the probability of exactly N mismatches
  // without enumerating all combinations of accepted bad blocks.
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
  return 1 / (1 + estimateHitCount(document))
}

export function minimumBitsForPrecision(
  document: EditorDocument,
  targetPrecision: number,
): number | undefined {
  const volume = estimateSearchVolume(document)
  const estimatedCount = (1 - targetPrecision) / targetPrecision
  if (volume <= 1 || estimatedCount === 0) return 0
  if (!Number.isFinite(volume) || estimatedCount <= 0) return undefined

  const tolerance = Math.max(0, document.scanner.errorTolerance)
  if (tolerance === 0) {
    // Preserve the strict-match estimate: each independent bit halves the
    // candidate count.
    return Math.max(0, Math.ceil(Math.log2(volume / estimatedCount)))
  }

  const logMaximumPassProbability = Math.log(estimatedCount / volume)
  // A candidate cannot pass until it has more observations than the allowed
  // mismatch count. Starting there avoids re-evaluating certainty cases.
  for (let constraints = tolerance + 1; constraints <= Number.MAX_SAFE_INTEGER; constraints += 1) {
    if (
      logFourStatePassProbability(constraints, tolerance) <=
      logMaximumPassProbability
    ) {
      return constraints * 2
    }
  }

  // This protects the UI if inputs exceed the range JavaScript can count
  // exactly; export validation remains responsible for scanner row limits.
  return undefined
}

export function formatEstimatedCount(value: number): string {
  if (!Number.isFinite(value)) return 'Over 1e308'
  if (value < 1) return '<1'
  if (value >= 1e6) return value.toExponential(2)
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value)
}

export function formatSearchTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'Over 1,000 years'
  if (seconds < 1) return '<1 sec'
  if (seconds < 60) return `~${Math.round(seconds)} sec`
  if (seconds < 3_600) return `~${Math.round(seconds / 60)} min`
  if (seconds < 86_400) return `~${Math.round(seconds / 3_600)} hr`

  const days = seconds / 86_400
  if (days < 365) return `~${Math.round(days)} days`

  const years = days / 365
  if (years > 1_000) return 'Over 1,000 years'
  return `~${Math.round(years)} years`
}
