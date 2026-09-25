/** Minecraft animation metadata for animated textures bundled by this app. */
interface TextureAnimation {
  frameCount: number
  frameTime: number
  interpolate: boolean
}

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

export function textureAnimation(source: string): TextureAnimation | undefined {
  const path = new URL(source, 'https://webcoordsfinder.invalid').pathname
  return animations[path]
}

/** Return the shared animation cycle for all animated textures in a block model. */
export function animationCycleTicks(sources: Iterable<string>): number | undefined {
  const durations = [...new Set(
    [...sources]
      .map(textureAnimation)
      .filter((entry): entry is TextureAnimation => Boolean(entry))
      .map((entry) => entry.frameCount * entry.frameTime),
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
): TextureAnimationFrame | undefined {
  const animation = textureAnimation(source)
  if (!animation) return undefined
  const duration = animation.frameCount * animation.frameTime
  const normalizedTick = (((Math.floor(tick) - 1) % duration) + duration) % duration
  const current = Math.floor(normalizedTick / animation.frameTime)
  return {
    current,
    next: (current + 1) % animation.frameCount,
    blend: animation.interpolate
      ? (normalizedTick % animation.frameTime) / animation.frameTime
      : 0,
  }
}
