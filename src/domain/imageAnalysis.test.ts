import { describe, expect, it } from 'vitest'
import { grassColorMapCoordinates } from './imageAnalysis'

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
