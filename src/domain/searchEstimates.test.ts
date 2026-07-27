import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../store/editorStore'
import type { FaceEvidence } from './types'
import {
  estimateHitCount,
  estimateHitPrecision,
  estimateSearchTimes,
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

  it('increases hits and lowers precision as error tolerance rises', () => {
    const document = createInitialDocument()
    document.scene.axisMapping = { a: 'x+', b: 'y+', c: 'z+' }
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
