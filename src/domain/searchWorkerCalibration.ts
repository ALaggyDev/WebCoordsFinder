import {
  WEB_SEARCH_ENGINE_VERSION,
  maximumSearchWorkerCount,
  type WebSearchRequest,
  type WebSearchWorkerCommand,
  type WebSearchWorkerState,
} from './webSearch'

export const SEARCH_WORKER_CALIBRATION_CACHE_VERSION = 3
const calibrationCacheLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1_000
// Fresh WASM instances initially run through Chrome's baseline compiler. Give
// every candidate enough work to tier up before comparing sustained rates.
const calibrationWarmupMilliseconds = 1_500
const calibrationSampleMilliseconds = 1_500
const calibrationStartupTimeoutMilliseconds = 10_000
const calibrationStopTimeoutMilliseconds = 2_000
const responsivenessIntervalMilliseconds = 50
const acceptableMainThreadLagMilliseconds = 150

export const SEARCH_WORKER_CALIBRATION_STORAGE_KEY =
  'webcoordsfinder.search-worker-calibration'

export interface SearchWorkerCalibrationTrial {
  workerCount: number
  checksPerSecond: number
  maximumMainThreadLagMilliseconds: number
}

export interface SearchWorkerCalibration {
  cacheVersion: number
  engineVersion: number
  maximumWorkerCount: number
  workerCount: number
  calibratedAt: number
  trials: SearchWorkerCalibrationTrial[]
}

interface CalibrationOptions {
  signal?: AbortSignal
  onTrialStart?: (workerCount: number, index: number, total: number) => void
}

export function searchWorkerCalibrationCandidates(
  maximumWorkerCount: number,
): number[] {
  if (!Number.isInteger(maximumWorkerCount) || maximumWorkerCount < 1) {
    return [1]
  }
  return [...new Set([4, 8, 12, maximumWorkerCount])]
    .filter((count) => count <= maximumWorkerCount)
    .sort((left, right) => left - right)
}

export function createSearchWorkerCalibrationRequest(
  request: WebSearchRequest,
): WebSearchRequest {
  // Reuse the audited hard-search dimensions so spiral X/Z traversal is
  // amortized across a realistic Y column. A single Y layer substantially
  // overweights ordinal-to-coordinate mapping and underreports scanner speed.
  // Search evidence, scan order, and texture mode remain request-specific.
  return {
    ...request,
    directions: [request.directions[0] ?? 0],
    xStart: -225_000,
    xEnd: 225_000,
    yStart: -60,
    yEnd: 0,
    zStart: -225_000,
    zEnd: 225_000,
  }
}

export function selectSearchWorkerCalibrationTrial(
  trials: SearchWorkerCalibrationTrial[],
): SearchWorkerCalibrationTrial {
  if (trials.length === 0) {
    throw new Error('Worker calibration did not produce any measurements.')
  }
  const responsive = trials.filter(
    (trial) =>
      trial.maximumMainThreadLagMilliseconds <=
      acceptableMainThreadLagMilliseconds,
  )
  const eligible = responsive.length > 0
    ? responsive
    : [...trials].sort(
        (left, right) =>
          left.maximumMainThreadLagMilliseconds -
          right.maximumMainThreadLagMilliseconds,
      ).slice(0, 1)
  return eligible.reduce((fastest, trial) =>
    trial.checksPerSecond > fastest.checksPerSecond ? trial : fastest,
  )
}

function isCalibrationTrial(value: unknown): value is SearchWorkerCalibrationTrial {
  if (!value || typeof value !== 'object') return false
  const trial = value as Partial<SearchWorkerCalibrationTrial>
  return (
    Number.isInteger(trial.workerCount) &&
    (trial.workerCount ?? 0) > 0 &&
    Number.isFinite(trial.checksPerSecond) &&
    (trial.checksPerSecond ?? -1) >= 0 &&
    Number.isFinite(trial.maximumMainThreadLagMilliseconds) &&
    (trial.maximumMainThreadLagMilliseconds ?? -1) >= 0
  )
}

export function readSearchWorkerCalibration(
  storage: Pick<Storage, 'getItem'> | undefined,
  hardwareConcurrency: number | undefined,
  now = Date.now(),
): SearchWorkerCalibration | null {
  if (!storage) return null
  try {
    const serialized = storage.getItem(SEARCH_WORKER_CALIBRATION_STORAGE_KEY)
    if (!serialized) return null
    const value = JSON.parse(serialized) as Partial<SearchWorkerCalibration>
    const maximumWorkerCount = maximumSearchWorkerCount(hardwareConcurrency)
    if (
      value.cacheVersion !== SEARCH_WORKER_CALIBRATION_CACHE_VERSION ||
      value.engineVersion !== WEB_SEARCH_ENGINE_VERSION ||
      value.maximumWorkerCount !== maximumWorkerCount ||
      !Number.isInteger(value.workerCount) ||
      (value.workerCount ?? 0) < 1 ||
      (value.workerCount ?? 0) > maximumWorkerCount ||
      !Number.isFinite(value.calibratedAt) ||
      (value.calibratedAt ?? 0) > now ||
      now - (value.calibratedAt ?? 0) > calibrationCacheLifetimeMilliseconds ||
      !Array.isArray(value.trials) ||
      !value.trials.every(
        (trial) =>
          isCalibrationTrial(trial) && trial.workerCount <= maximumWorkerCount,
      )
    ) {
      return null
    }
    return value as SearchWorkerCalibration
  } catch {
    return null
  }
}

export function writeSearchWorkerCalibration(
  storage: Pick<Storage, 'setItem'> | undefined,
  calibration: SearchWorkerCalibration,
): void {
  if (!storage) return
  try {
    storage.setItem(
      SEARCH_WORKER_CALIBRATION_STORAGE_KEY,
      JSON.stringify(calibration),
    )
  } catch {
    // Storage can be unavailable in private or policy-restricted contexts.
    // The in-memory calibrated selection remains usable for this session.
  }
}

function abortError(): DOMException {
  return new DOMException('Worker calibration was cancelled.', 'AbortError')
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function runSearchWorkerCalibrationTrial(
  request: WebSearchRequest,
  workerCount: number,
  signal?: AbortSignal,
): Promise<SearchWorkerCalibrationTrial> {
  const worker = new Worker(
    new URL('../workers/search.pool.worker.ts', import.meta.url),
    { type: 'module' },
  )
  const requestId = globalThis.crypto.randomUUID()
  let latestProcessed = 0n
  let terminal = false
  let trialError: Error | undefined
  let resolveStarted: (() => void) | undefined
  let rejectStarted: ((reason: Error) => void) | undefined
  let resolveStopped: (() => void) | undefined
  const started = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve
    rejectStarted = reject
  })
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve
  })

  worker.onmessage = (event: MessageEvent<WebSearchWorkerState>) => {
    const message = event.data
    if (message.type !== 'state' || message.requestId !== requestId) return
    latestProcessed = message.processed
    if (message.phase === 'error') {
      terminal = true
      trialError = new Error(message.error ?? 'Worker calibration failed.')
      rejectStarted?.(trialError)
      resolveStopped?.()
      return
    }
    if (message.phase === 'running' && message.processed > 0n) resolveStarted?.()
    if (message.phase === 'stopped' || message.phase === 'completed') {
      terminal = true
      resolveStopped?.()
    }
  }
  worker.onerror = () => {
    terminal = true
    trialError = new Error('A worker calibration pool stopped unexpectedly.')
    rejectStarted?.(trialError)
    resolveStopped?.()
  }

  const command: WebSearchWorkerCommand = {
    type: 'start',
    requestId,
    request,
    workerCount,
  }
  worker.postMessage(command)

  let responsivenessTimer: ReturnType<typeof setInterval> | undefined
  try {
    await Promise.race([
      started,
      delay(calibrationStartupTimeoutMilliseconds, signal).then(() => {
        throw new Error('Worker calibration timed out while loading the scanner.')
      }),
    ])
    await delay(calibrationWarmupMilliseconds, signal)
    if (trialError) throw trialError

    const baselineProcessed = latestProcessed
    const sampleStartedAt = performance.now()
    let expectedResponsivenessAt =
      sampleStartedAt + responsivenessIntervalMilliseconds
    let maximumMainThreadLagMilliseconds = 0
    responsivenessTimer = setInterval(() => {
      const now = performance.now()
      maximumMainThreadLagMilliseconds = Math.max(
        maximumMainThreadLagMilliseconds,
        now - expectedResponsivenessAt,
      )
      expectedResponsivenessAt = now + responsivenessIntervalMilliseconds
    }, responsivenessIntervalMilliseconds)

    await delay(calibrationSampleMilliseconds, signal)
    const sampleElapsedMilliseconds = performance.now() - sampleStartedAt
    if (trialError) throw trialError
    const processed = latestProcessed - baselineProcessed
    return {
      workerCount,
      checksPerSecond:
        sampleElapsedMilliseconds > 0
          ? (Number(processed) * 1_000) / sampleElapsedMilliseconds
          : 0,
      maximumMainThreadLagMilliseconds: Math.max(
        0,
        maximumMainThreadLagMilliseconds,
        sampleElapsedMilliseconds - calibrationSampleMilliseconds,
      ),
    }
  } finally {
    if (responsivenessTimer) clearInterval(responsivenessTimer)
    if (!terminal) {
      const stopCommand: WebSearchWorkerCommand = { type: 'stop', requestId }
      worker.postMessage(stopCommand)
      await Promise.race([
        stopped,
        delay(calibrationStopTimeoutMilliseconds),
      ])
    }
    worker.terminate()
  }
}

export async function calibrateSearchWorkerCount(
  request: WebSearchRequest,
  hardwareConcurrency: number | undefined,
  options: CalibrationOptions = {},
): Promise<SearchWorkerCalibration> {
  const maximumWorkerCount = maximumSearchWorkerCount(hardwareConcurrency)
  const candidates = searchWorkerCalibrationCandidates(maximumWorkerCount)
  const calibrationRequest = createSearchWorkerCalibrationRequest(request)
  const trials: SearchWorkerCalibrationTrial[] = []

  for (const [index, workerCount] of candidates.entries()) {
    if (options.signal?.aborted) throw abortError()
    options.onTrialStart?.(workerCount, index, candidates.length)
    trials.push(
      await runSearchWorkerCalibrationTrial(
        calibrationRequest,
        workerCount,
        options.signal,
      ),
    )
  }

  const selected = selectSearchWorkerCalibrationTrial(trials)
  return {
    cacheVersion: SEARCH_WORKER_CALIBRATION_CACHE_VERSION,
    engineVersion: WEB_SEARCH_ENGINE_VERSION,
    maximumWorkerCount,
    workerCount: selected.workerCount,
    calibratedAt: Date.now(),
    trials,
  }
}
