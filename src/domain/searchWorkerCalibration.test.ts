import { describe, expect, it, vi } from 'vitest'
import { WEB_SEARCH_ENGINE_VERSION, type WebSearchRequest } from './webSearch'
import {
  SEARCH_WORKER_CALIBRATION_CACHE_VERSION,
  SEARCH_WORKER_CALIBRATION_STORAGE_KEY,
  createSearchWorkerCalibrationRequest,
  readSearchWorkerCalibration,
  searchWorkerCalibrationCandidates,
  selectSearchWorkerCalibrationTrial,
  writeSearchWorkerCalibration,
  type SearchWorkerCalibration,
} from './searchWorkerCalibration'

const request: WebSearchRequest = {
  mode: 2,
  scanOrder: 1,
  directions: [0, 90],
  xStart: -10,
  xEnd: 10,
  yStart: -2,
  yEnd: 2,
  zStart: -20,
  zEnd: 20,
  maxBadBlocks: 0,
  constraints: [
    { x: 1, y: 0, z: -1, rotation: 2, visibleMask: 3 },
  ],
}

function calibration(
  overrides: Partial<SearchWorkerCalibration> = {},
): SearchWorkerCalibration {
  return {
    cacheVersion: SEARCH_WORKER_CALIBRATION_CACHE_VERSION,
    engineVersion: WEB_SEARCH_ENGINE_VERSION,
    maximumWorkerCount: 15,
    workerCount: 12,
    calibratedAt: 1_000_000,
    trials: [
      {
        workerCount: 12,
        checksPerSecond: 750_000_000,
        maximumMainThreadLagMilliseconds: 18,
      },
    ],
    ...overrides,
  }
}

describe('search worker calibration', () => {
  it('builds a bounded candidate set that includes the device maximum', () => {
    expect(searchWorkerCalibrationCandidates(3)).toEqual([3])
    expect(searchWorkerCalibrationCandidates(8)).toEqual([4, 8])
    expect(searchWorkerCalibrationCandidates(15)).toEqual([4, 8, 12, 15])
    expect(searchWorkerCalibrationCandidates(32)).toEqual([4, 8, 12, 32])
  })

  it('uses a long-running representative request without mutating the input', () => {
    const benchmark = createSearchWorkerCalibrationRequest(request)

    expect(benchmark).toMatchObject({
      mode: request.mode,
      scanOrder: request.scanOrder,
      directions: [0],
      xStart: -225_000,
      xEnd: 225_000,
      yStart: -60,
      yEnd: 0,
      zStart: -225_000,
      zEnd: 225_000,
      constraints: request.constraints,
    })
    expect(request.directions).toEqual([0, 90])
  })

  it('selects the fastest responsive trial', () => {
    expect(
      selectSearchWorkerCalibrationTrial([
        {
          workerCount: 4,
          checksPerSecond: 400,
          maximumMainThreadLagMilliseconds: 10,
        },
        {
          workerCount: 8,
          checksPerSecond: 700,
          maximumMainThreadLagMilliseconds: 30,
        },
        {
          workerCount: 12,
          checksPerSecond: 900,
          maximumMainThreadLagMilliseconds: 220,
        },
      ]),
    ).toMatchObject({ workerCount: 8 })
  })

  it('falls back to the most responsive trial when every count misses the lag target', () => {
    expect(
      selectSearchWorkerCalibrationTrial([
        {
          workerCount: 4,
          checksPerSecond: 300,
          maximumMainThreadLagMilliseconds: 180,
        },
        {
          workerCount: 8,
          checksPerSecond: 800,
          maximumMainThreadLagMilliseconds: 240,
        },
      ]),
    ).toMatchObject({ workerCount: 4 })
  })

  it('round-trips a current device calibration through local storage', () => {
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
    }
    const saved = calibration()

    writeSearchWorkerCalibration(storage, saved)
    expect(storage.setItem).toHaveBeenCalledWith(
      SEARCH_WORKER_CALIBRATION_STORAGE_KEY,
      JSON.stringify(saved),
    )
    storage.getItem.mockReturnValue(JSON.stringify(saved))
    expect(readSearchWorkerCalibration(storage, 16, 1_500_000)).toEqual(saved)
  })

  it('rejects stale, malformed, and hardware-mismatched cache entries', () => {
    const storage = { getItem: vi.fn() }
    storage.getItem.mockReturnValue(JSON.stringify(calibration()))
    expect(readSearchWorkerCalibration(storage, 8, 1_500_000)).toBeNull()

    storage.getItem.mockReturnValue(JSON.stringify(calibration({
      calibratedAt: 0,
    })))
    expect(
      readSearchWorkerCalibration(storage, 16, 31 * 24 * 60 * 60 * 1_000),
    ).toBeNull()

    storage.getItem.mockReturnValue('{not json')
    expect(readSearchWorkerCalibration(storage, 16, 1_500_000)).toBeNull()
  })
})
