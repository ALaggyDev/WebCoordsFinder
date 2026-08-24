import type {
  CandidateScore,
  CandidateTransform,
  GrassTintSettings,
  Point2,
} from './types'
import { defaultGrassTintSettings } from './types'
import {
  computeHomography,
  projectPoint,
} from './geometry'

// Decoding is shared across crops and candidates; caching the promise also
// coalesces concurrent requests for the same bundled reference image.
const imageCache = new Map<string, Promise<HTMLImageElement>>()
const colorizedReferenceCache = new Map<string, Promise<string>>()
const grassColorMapSource = '/minecraft/textures/colormap/grass.png'

export type RgbColor = { red: number; green: number; blue: number }

export function isGrassTexture(source: string): boolean {
  return ['/grass.png', '/grass_block_top.png', '/grass_side.png', '/lily_pad.png'].some((name) =>
    source.endsWith(name),
  )
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// Minecraft scales downfall by temperature before indexing the colormap from
// its bottom-right origin. The clamp keeps any persisted out-of-range values
// on the nearest edge, matching the game's lookup behavior.
export function grassColorMapCoordinates(
  settings: GrassTintSettings,
  width: number,
  height: number,
): [number, number] {
  const temperature = clampUnit(settings.temperature)
  const downfall = clampUnit(settings.downfall)
  const humidity = clampUnit(temperature * downfall)
  return [
    Math.floor((1 - temperature) * (width - 1)),
    Math.floor((1 - humidity) * (height - 1)),
  ]
}

async function grassTintColor(
  settings = defaultGrassTintSettings,
): Promise<RgbColor> {
  const colorMap = await loadImage(grassColorMapSource)
  const canvas = document.createElement('canvas')
  canvas.width = colorMap.naturalWidth
  canvas.height = colorMap.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Grass colormap extraction is unavailable.')
  context.drawImage(colorMap, 0, 0)
  const [x, y] = grassColorMapCoordinates(
    settings,
    canvas.width,
    canvas.height,
  )
  const pixel = context.getImageData(x, y, 1, 1).data
  return { red: pixel[0], green: pixel[1], blue: pixel[2] }
}

export function applyGrassTint(imageData: ImageData, tint: RgbColor): ImageData {
  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const shade = imageData.data[offset]
    imageData.data[offset] = Math.round((shade * tint.red) / 255)
    imageData.data[offset + 1] = Math.round(
      (shade * tint.green) / 255,
    )
    imageData.data[offset + 2] = Math.round(
      (shade * tint.blue) / 255,
    )
  }
  return imageData
}

export function loadImage(source: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(source)
  if (cached) return cached
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The image could not be decoded.'))
    image.src = source
  })
  imageCache.set(source, promise)
  return promise
}

export function colorizedReferenceTexture(
  source: string,
  grassTint = defaultGrassTintSettings,
): Promise<string> {
  if (!isGrassTexture(source)) return Promise.resolve(source)
  const cacheKey = `${source}:${grassTint.temperature}:${grassTint.downfall}`
  const cached = colorizedReferenceCache.get(cacheKey)
  if (cached) return cached
  const promise = Promise.all([loadImage(source), grassTintColor(grassTint)]).then(([image, tint]) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas image extraction is unavailable.')
    context.drawImage(image, 0, 0)
    const imageData = applyGrassTint(
      context.getImageData(0, 0, canvas.width, canvas.height),
      tint,
    )
    context.putImageData(imageData, 0, 0)
    return canvas.toDataURL('image/png')
  })
  colorizedReferenceCache.set(cacheKey, promise)
  return promise
}

function sampleBilinear(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const safeX = Math.max(0, Math.min(width - 1, x))
  const safeY = Math.max(0, Math.min(height - 1, y))
  const x0 = Math.floor(safeX)
  const y0 = Math.floor(safeY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const dx = safeX - x0
  const dy = safeY - y0
  const result: number[] = []

  for (let channel = 0; channel < 4; channel += 1) {
    const top =
      pixels[(y0 * width + x0) * 4 + channel] * (1 - dx) +
      pixels[(y0 * width + x1) * 4 + channel] * dx
    const bottom =
      pixels[(y1 * width + x0) * 4 + channel] * (1 - dx) +
      pixels[(y1 * width + x1) * 4 + channel] * dx
    result[channel] = top * (1 - dy) + bottom * dy
  }
  return result as [number, number, number, number]
}

export async function warpQuad(
  source: string,
  quad: [Point2, Point2, Point2, Point2],
  size = 96,
): Promise<ImageData> {
  const image = await loadImage(source)
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.naturalWidth
  sourceCanvas.height = image.naturalHeight
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
  if (!sourceContext) throw new Error('Canvas image extraction is unavailable.')
  sourceContext.drawImage(image, 0, 0)
  const sourcePixels = sourceContext.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  )
  return warpQuadPixels(sourcePixels, quad, size)
}

export function warpQuadPixels(
  sourcePixels: ImageData,
  quad: [Point2, Point2, Point2, Point2],
  size = 96,
): ImageData {
  const transform = computeHomography(
    [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size },
    ],
    quad,
  )
  const result = new ImageData(size, size)

  // Sample pixel centers through the inverse mapping to avoid gaps that a
  // forward rasterization of the perspective quad would leave behind.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourcePoint = projectPoint(transform, { x: x + 0.5, y: y + 0.5 })
      const color = sampleBilinear(
        sourcePixels.data,
        sourcePixels.width,
        sourcePixels.height,
        sourcePoint.x,
        sourcePoint.y,
      )
      const offset = (y * size + x) * 4
      result.data[offset] = color[0]
      result.data[offset + 1] = color[1]
      result.data[offset + 2] = color[2]
      result.data[offset + 3] = color[3]
    }
  }
  return result
}

export async function imageToPixels(
  source: string,
  size = 96,
  grassTint = defaultGrassTintSettings,
): Promise<ImageData> {
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas image extraction is unavailable.')
  context.imageSmoothingEnabled = false
  context.drawImage(image, 0, 0, size, size)
  const imageData = context.getImageData(0, 0, size, size)
  return isGrassTexture(source)
    ? applyGrassTint(imageData, await grassTintColor(grassTint))
    : imageData
}

export function imageDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export function transformPixels(
  source: Uint8ClampedArray,
  size: number,
  transform: CandidateTransform,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(source.length)
  // The switch maps each output pixel back to its source, keeping every
  // transform exact and avoiding interpolation of the reference texture.
  const copy = (targetX: number, targetY: number, sourceX: number, sourceY: number) => {
    const sourceOffset = (sourceY * size + sourceX) * 4
    const targetOffset = (targetY * size + targetX) * 4
    output.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset)
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sx = x
      let sy = y
      switch (transform) {
        case 'rotate90':
          sx = y
          sy = size - 1 - x
          break
        case 'rotate180':
          sx = size - 1 - x
          sy = size - 1 - y
          break
        case 'rotate270':
          sx = size - 1 - y
          sy = x
          break
        case 'mirrorX':
          sx = size - 1 - x
          break
        case 'mirrorXRotate180':
          sy = size - 1 - y
          break
        case 'identity':
          break
      }
      copy(x, y, sx, sy)
    }
  }
  return output
}

export function normalizedGradientScore(
  sample: Uint8ClampedArray,
  reference: Uint8ClampedArray,
  size: number,
): number {
  return normalizedGradientVectorScore(
    normalizedGradientVector(sample, size),
    normalizedGradientVector(reference, size),
  )
}

export interface NormalizedGradientVector {
  values: Float64Array
  mean: number
  centeredEnergy: number
}

export function normalizedGradientVector(
  pixels: Uint8ClampedArray,
  size: number,
): NormalizedGradientVector {
  // Ignore crop borders where homography and screenshot background artifacts
  // dominate, then compare gradients so lighting shifts matter less.
  const border = Math.max(2, Math.round(size * 0.08))
  const innerSize = Math.max(0, size - border * 2)
  const values = new Float64Array(innerSize * innerSize * 2)
  const grayscale = (pixels: Uint8ClampedArray, x: number, y: number) => {
    const offset = (y * size + x) * 4
    return (
      pixels[offset] * 0.2126 +
      pixels[offset + 1] * 0.7152 +
      pixels[offset + 2] * 0.0722
    )
  }

  let index = 0
  for (let y = border; y < size - border; y += 1) {
    for (let x = border; x < size - border; x += 1) {
      values[index] =
        grayscale(pixels, x + 1, y) - grayscale(pixels, x - 1, y)
      values[index + 1] =
        grayscale(pixels, x, y + 1) - grayscale(pixels, x, y - 1)
      index += 2
    }
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  let centeredEnergy = 0
  values.forEach((value) => {
    centeredEnergy += (value - mean) ** 2
  })
  return { values, mean, centeredEnergy }
}

export function normalizedGradientVectorScore(
  sample: NormalizedGradientVector,
  reference: NormalizedGradientVector,
): number {
  if (sample.values.length !== reference.values.length) return 0
  let numerator = 0
  sample.values.forEach((value, index) => {
    numerator +=
      (value - sample.mean) * (reference.values[index] - reference.mean)
  })
  const denominator = Math.sqrt(
    sample.centeredEnergy * reference.centeredEnergy,
  )
  // Constant images have no directional information and cannot be matched.
  if (denominator < 1e-8) return 0
  return Math.max(-1, Math.min(1, numerator / denominator))
}

export function scoreNormalizedGradientCandidates(
  sample: NormalizedGradientVector,
  references: NormalizedGradientVector[],
  stateCount: 2 | 4,
): { scores: CandidateScore[]; confidence: number } {
  const uniqueScores = new Map<number, number>()
  references.forEach((reference, index) => {
    const variant = stateCount === 2 ? index % 2 : index
    const score = normalizedGradientVectorScore(sample, reference)
    uniqueScores.set(variant, Math.max(score, uniqueScores.get(variant) ?? -1))
  })
  const scores = [...uniqueScores.entries()]
    .map(([variant, score]) => ({ variant, score }))
    .sort((left, right) => right.score - left.score)
  return {
    scores,
    confidence: scores.length > 1 ? scores[0].score - scores[1].score : 0,
  }
}
