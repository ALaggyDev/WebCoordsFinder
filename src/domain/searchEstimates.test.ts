// Estimate tests pin the intentionally approximate UI model and its compact
// formatting separately from measured worker throughput.
import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../store/editorStore'
import type { FaceEvidence } from './types'
import {
  estimateHitCount,
  estimateHitPrecision,
  estimateSearchTimes,
  formatEstimatedCount,
  formatSearchTime,
} from './searchEstimates'

describe('placeholder search estimates', () => {
  it('orders web, CPU, and CUDA estimates by placeholder throughput', () => {
    const estimates = estimateSearchTimes(createInitialDocument())

    expect(estimates.map((estimate) => estimate.runtime)).toEqual([
      'web',
      'cpu',
      'cuda',
    ])
    expect(estimates[0].seconds).toBeGreaterThan(estimates[1].seconds)
    expect(estimates[1].seconds).toBeGreaterThan(estimates[2].seconds)
  })

  it('formats durations into compact readable units', () => {
    expect(formatSearchTime(0.5)).toBe('<1 sec')
    expect(formatSearchTime(61)).toBe('~2 min')
    expect(formatSearchTime(3_601)).toBe('~2 hr')
  })

  it('uses scientific notation for large search and hit counts', () => {
    expect(formatEstimatedCount(999_999)).toBe('999,999')
    expect(formatEstimatedCount(1_000_000)).toBe('1.00e6')
    expect(formatEstimatedCount(6_101_220_061)).toBe('6.10e9')
  })

  it('increases hits and lowers precision as error tolerance rises', () => {
    const document = createInitialDocument()
    document.anchorFaceId = document.scene.faces[0].id
    document.scene.axisMapping = { a: 'x+', b: 'y-', c: 'z+' }
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
    document.scanner.maxBadBlocks = 1

    expect(estimateHitCount(document)).toBeGreaterThan(strictHits)
    expect(estimateHitPrecision(document)).toBeLessThan(strictPrecision)
  })
})
