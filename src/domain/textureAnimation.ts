import { textureAssetPath } from './resourcePacks'
import type { ResourcePackSettings, TextureAnimation } from './types'

const animations: Record<string, TextureAnimation> = {
  '/minecraft/textures/block/sculk.png': {
    frameCount: 4,
    frameTime: 20,
    interpolate: true,
  },
  '/minecraft/offsets/block/tall_seagrass_bottom.png': {
    frameCount: 19,
    frameTime: 2,
    interpolate: false,
  },
  '/minecraft/offsets/block/tall_seagrass_top.png': {
    frameCount: 19,
    frameTime: 2,
    interpolate: false,
  },
}

export interface TextureAnimationFrame {
  current: number
  next: number
  blend: number
}

export function textureAnimation(source: string, pack?: ResourcePackSettings): TextureAnimation | undefined {
  const asset = textureAssetPath(source)
  // A replacement PNG without .mcmeta is static, even when vanilla animates it.
  if (pack?.custom?.textures[asset]) return pack.custom.animations[asset]
  const path = new URL(source, 'https://webcoordsfinder.invalid').pathname
  return animations[path]
}

function animationDuration(animation: TextureAnimation): number {
  return animation.frames?.reduce((sum, frame) => sum + frame.time, 0)
    ?? animation.frameCount * animation.frameTime
}

/** Pixel rectangle for an animation frame, including custom grid spritesheets. */
export function textureFrameRect(source: string, imageWidth: number, frame: number, pack?: ResourcePackSettings): [number, number, number, number] {
  const animation = textureAnimation(source, pack)
  const width = animation?.frameWidth ?? imageWidth
  const height = animation?.frameHeight ?? imageWidth
  const columns = animation?.columns ?? 1
  return [(frame % columns) * width, Math.floor(frame / columns) * height, width, height]
}

/** Return the shared animation cycle for all animated textures in a block model. */
export function animationCycleTicks(sources: Iterable<string>, pack?: ResourcePackSettings): number | undefined {
  const durations = [...new Set(
    [...sources]
      .map((source) => textureAnimation(source, pack))
      .filter((entry): entry is TextureAnimation => Boolean(entry))
      .map(animationDuration),
  )]
  if (durations.length === 0) return undefined
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  return durations.reduce((cycle, duration) =>
    (cycle * duration) / gcd(cycle, duration),
  )
}

/** Resolve a one-based animation tick to the frame pair Minecraft displays. */
export function textureAnimationFrame(
  source: string,
  tick: number,
  pack?: ResourcePackSettings,
): TextureAnimationFrame | undefined {
  const animation = textureAnimation(source, pack)
  if (!animation) return undefined
  const duration = animationDuration(animation)
  const normalizedTick = (((Math.floor(tick) - 1) % duration) + duration) % duration
  if (animation.frames) {
    let remaining = normalizedTick
    for (const [index, frame] of animation.frames.entries()) {
      if (remaining < frame.time) return {
        current: frame.index,
        next: animation.frames[(index + 1) % animation.frames.length].index,
        blend: animation.interpolate ? remaining / frame.time : 0,
      }
      remaining -= frame.time
    }
  }
  const current = Math.floor(normalizedTick / animation.frameTime)
  return {
    current,
    next: (current + 1) % animation.frameCount,
    blend: animation.interpolate
      ? (normalizedTick % animation.frameTime) / animation.frameTime
      : 0,
  }
}
