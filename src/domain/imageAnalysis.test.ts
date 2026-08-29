import { describe, expect, it } from 'vitest'
import {
  grassColorMapCoordinates,
  normalizedGradientScore,
  normalizedGradientVector,
  scoreNormalizedGradientCandidates,
  transformPixels,
} from './imageAnalysis'

describe('grass colormap lookup', () => {
  it('uses Minecraft temperature-scaled downfall coordinates', () => {
    // Plains: temperature .8, downfall .4, humidity .32.
    expect(grassColorMapCoordinates({ temperature: 0.8, downfall: 0.4 }, 256, 256))
      .toEqual([50, 173])
  })

  it('clamps saved values to the closest colormap edge', () => {
    expect(grassColorMapCoordinates({ temperature: -1, downfall: 2 }, 256, 256))
      .toEqual([255, 255])
    expect(grassColorMapCoordinates({ temperature: 2, downfall: 2 }, 256, 256))
      .toEqual([0, 0])
  })
})

describe('worker analysis scoring parity', () => {
  it('assigns one score to each face-specific variant reference', () => {
    const size = 16
    const sample = new Uint8ClampedArray(size * size * 4)
    const reference = new Uint8ClampedArray(size * size * 4)
    for (let index = 0; index < sample.length; index += 4) {
      const pixel = index / 4
      sample[index] = (pixel * 17 + 3) % 256
      sample[index + 1] = (pixel * 11 + 9) % 256
      sample[index + 2] = (pixel * 5 + 21) % 256
      sample[index + 3] = 255
      reference[index] = (pixel * 13 + 7) % 256
      reference[index + 1] = (pixel * 19 + 1) % 256
      reference[index + 2] = (pixel * 3 + 31) % 256
      reference[index + 3] = 255
    }
    const transforms = [
      'identity',
      'rotate90',
      'rotate180',
      'rotate270',
    ] as const
    const legacyScores = transforms.map((transform) =>
      normalizedGradientScore(
        sample,
        transformPixels(reference, size, transform),
        size,
      ),
    )
    const optimizedReferences = transforms.map((transform) =>
      normalizedGradientVector(
        transformPixels(reference, size, transform),
        size,
      ),
    )

    const fourState = scoreNormalizedGradientCandidates(
      normalizedGradientVector(sample, size),
      optimizedReferences,
    )
    expect(fourState.scores).toEqual(
      legacyScores
        .map((score, variant) => ({ score, variant }))
        .sort((left, right) => right.score - left.score),
    )

    const twoState = scoreNormalizedGradientCandidates(
      normalizedGradientVector(sample, size),
      optimizedReferences.slice(0, 2),
    )
    expect(twoState.scores).toHaveLength(2)
    expect(twoState.scores.find((entry) => entry.variant === 0)?.score).toBe(
      legacyScores[0],
    )
    expect(twoState.scores.find((entry) => entry.variant === 1)?.score).toBe(
      legacyScores[1],
    )
  })
})
