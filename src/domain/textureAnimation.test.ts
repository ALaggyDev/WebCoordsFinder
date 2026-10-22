import { describe, expect, it } from 'vitest'
import {
  animationCycleTicks,
  textureAnimationFrame,
} from './textureAnimation'

describe('bundled texture animation metadata', () => {
  it('uses the 1.21.11 sculk interpolation timing', () => {
    expect(textureAnimationFrame('/minecraft/textures/block/sculk.png', 1))
      .toEqual({ current: 0, next: 1, blend: 0 })
    expect(textureAnimationFrame('/minecraft/textures/block/sculk.png', 20))
      .toEqual({ current: 0, next: 1, blend: 0.95 })
    expect(textureAnimationFrame('/minecraft/textures/block/sculk.png', 21))
      .toEqual({ current: 1, next: 2, blend: 0 })
    expect(textureAnimationFrame('/minecraft/textures/block/sculk.png', 80))
      .toEqual({ current: 3, next: 0, blend: 0.95 })
  })

  it('keeps both tall seagrass textures on one 38-tick cycle', () => {
    const sources = [
      '/minecraft/offsets/block/tall_seagrass_bottom.png',
      '/minecraft/offsets/block/tall_seagrass_top.png',
    ]
    expect(animationCycleTicks(sources)).toBe(38)
    expect(textureAnimationFrame(sources[0], 3))
      .toEqual({ current: 1, next: 2, blend: 0 })
    expect(textureAnimationFrame(sources[1], 38))
      .toEqual({ current: 18, next: 0, blend: 0 })
  })

  it('does not expose a slider for static textures', () => {
    expect(animationCycleTicks(['/minecraft/offsets/block/tall_grass_top.png']))
      .toBeUndefined()
  })
})
