import type {
  CandidateTransform,
  MeshFace,
  Point2,
  SceneGeometry,
} from './types'
import {
  canonicalCropTransformForFace,
  computeHomography,
  projectPoint,
} from './geometry'

const imageCache = new Map<string, Promise<HTMLImageElement>>()

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

export async function imageToPixels(source: string, size = 96): Promise<ImageData> {
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas image extraction is unavailable.')
  context.imageSmoothingEnabled = false
  context.drawImage(image, 0, 0, size, size)
  return context.getImageData(0, 0, size, size)
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

export function orientCropToWorld(
  crop: ImageData,
  scene: SceneGeometry,
  face: MeshFace,
): ImageData {
  const transform = canonicalCropTransformForFace(scene, face)
  if (transform === 'identity') return crop
  const result = new ImageData(crop.width, crop.height)
  result.data.set(transformPixels(crop.data, crop.width, transform))
  return result
}

export function normalizedGradientScore(
  sample: Uint8ClampedArray,
  reference: Uint8ClampedArray,
  size: number,
): number {
  const border = Math.max(2, Math.round(size * 0.08))
  const sampleValues: number[] = []
  const referenceValues: number[] = []
  const grayscale = (pixels: Uint8ClampedArray, x: number, y: number) => {
    const offset = (y * size + x) * 4
    return (
      pixels[offset] * 0.2126 +
      pixels[offset + 1] * 0.7152 +
      pixels[offset + 2] * 0.0722
    )
  }

  for (let y = border; y < size - border; y += 1) {
    for (let x = border; x < size - border; x += 1) {
      const sgx = grayscale(sample, x + 1, y) - grayscale(sample, x - 1, y)
      const sgy = grayscale(sample, x, y + 1) - grayscale(sample, x, y - 1)
      const rgx = grayscale(reference, x + 1, y) - grayscale(reference, x - 1, y)
      const rgy = grayscale(reference, x, y + 1) - grayscale(reference, x, y - 1)
      sampleValues.push(sgx, sgy)
      referenceValues.push(rgx, rgy)
    }
  }

  const sampleMean =
    sampleValues.reduce((sum, value) => sum + value, 0) / sampleValues.length
  const referenceMean =
    referenceValues.reduce((sum, value) => sum + value, 0) / referenceValues.length
  let numerator = 0
  let sampleEnergy = 0
  let referenceEnergy = 0
  sampleValues.forEach((value, index) => {
    const sampleCentered = value - sampleMean
    const referenceCentered = referenceValues[index] - referenceMean
    numerator += sampleCentered * referenceCentered
    sampleEnergy += sampleCentered ** 2
    referenceEnergy += referenceCentered ** 2
  })
  const denominator = Math.sqrt(sampleEnergy * referenceEnergy)
  if (denominator < 1e-8) return 0
  return Math.max(-1, Math.min(1, numerator / denominator))
}
