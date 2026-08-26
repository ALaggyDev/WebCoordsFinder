// Estimate tests pin the intentionally approximate UI model and its compact
// formatting separately from measured worker throughput.
import { describe, expect, it } from 'vitest'
import { createTestDocument } from '../test/createTestDocument'
import type { FaceEvidence } from './types'
import {
  estimateHitCount,
  estimateHitPrecision,
  estimateSearchTimes,
  formatEstimatedCount,
  formatSearchTime,
  minimumBitsForPrecision,
} from './searchEstimates'

describe('search estimates', () => {
  it('waits for measured browser throughput and keeps native placeholders', () => {
    const estimates = estimateSearchTimes(createTestDocument())

    expect(estimates.map((estimate) => estimate.runtime)).toEqual([
      'web',
      'cpu',
      'metal',
      'cuda',
    ])
    expect(estimates[0].seconds).toBeUndefined()
    expect(estimates[1].seconds).toBeGreaterThan(estimates[2].seconds!)
    expect(estimates[2].seconds).toBeGreaterThan(estimates[3].seconds!)

    const measured = estimateSearchTimes(createTestDocument(), 500_000_000)
    expect(measured[0].seconds).toBeDefined()
  })

  it('formats durations into compact readable units', () => {
    expect(formatSearchTime(0.5)).toBe('<1 sec')
    expect(formatSearchTime(61)).toBe('~1 min')
    expect(formatSearchTime(3_601)).toBe('~1 hr')
  })

  it('uses scientific notation for large search and hit counts', () => {
    expect(formatEstimatedCount(999_999)).toBe('999,999')
    expect(formatEstimatedCount(1_000_000)).toBe('1.00e+6')
    expect(formatEstimatedCount(6_101_220_061)).toBe('6.10e+9')
  })

  it('increases hits and lowers precision as error tolerance rises', () => {
    const document = createTestDocument()
    document.anchorFaceId = document.scene.faces[0].id
    document.scene.axisMapping = { a: 'x+', b: 'y-', c: 'z-' }
    document.scanner.compassResolved = true
    document.evidence = [
      {
        id: 'first',
        faceId: 'first-face',
        latticeCoordinate: { x: 0, y: 0, z: 0 },
        localNormal: { x: 0, y: 1, z: 0 },
        blockId: 'stone',
        stateCount: 4,
        selectedVariant: 0,
        reviewStatus: 'confirmed',
      },
      {
        id: 'second',
        faceId: 'second-face',
        latticeCoordinate: { x: 1, y: 0, z: 0 },
        localNormal: { x: 0, y: 1, z: 0 },
        blockId: 'stone',
        stateCount: 4,
        selectedVariant: 1,
        reviewStatus: 'confirmed',
      },
    ] satisfies FaceEvidence[]

    const strictHits = estimateHitCount(document)
    const strictPrecision = estimateHitPrecision(document)
    document.scanner.errorTolerance = 1

    expect(estimateHitCount(document)).toBeGreaterThan(strictHits)
    expect(estimateHitPrecision(document)).toBeLessThan(strictPrecision)
  })

  it('keeps the strict information target when error tolerance is zero', () => {
    const document = createTestDocument()
    document.scanner.bounds = {
      xStart: 0,
      xEnd: 15,
      yStart: 0,
      yEnd: 0,
      zStart: 0,
      zEnd: 0,
    }

    expect(minimumBitsForPrecision(document, 0.8)).toBe(6)
  })

  it('requires more four-state information when mismatches are tolerated', () => {
    const document = createTestDocument()
    document.scanner.bounds = {
      xStart: 0,
      xEnd: 15,
      yStart: 0,
      yEnd: 0,
      zStart: 0,
      zEnd: 0,
    }
    const strictBits = minimumBitsForPrecision(document, 0.8)
    document.scanner.errorTolerance = 1

    expect(minimumBitsForPrecision(document, 0.8)).toBe(10)
    expect(minimumBitsForPrecision(document, 0.8)).toBeGreaterThan(strictBits!)
  })

  it('never lowers the target as error tolerance rises', () => {
    const document = createTestDocument()
    document.scanner.bounds = {
      xStart: 0,
      xEnd: 63,
      yStart: 0,
      yEnd: 0,
      zStart: 0,
      zEnd: 0,
    }
    const strictBits = minimumBitsForPrecision(document, 0.8)!
    document.scanner.errorTolerance = 1
    const oneMismatchBits = minimumBitsForPrecision(document, 0.8)!
    document.scanner.errorTolerance = 2

    expect(oneMismatchBits).toBeGreaterThanOrEqual(strictBits)
    expect(minimumBitsForPrecision(document, 0.8)).toBeGreaterThanOrEqual(
      oneMismatchBits,
    )
  })
})
