import type {
  AutoAnalyzeJob,
  AutoAnalyzeRequest,
  AutoAnalyzeResponse,
} from '../domain/analysisProtocol'
import {
  applyGrassTint,
  grassColorMapCoordinates,
  isGrassTexture,
  normalizedGradientVector,
  scoreNormalizedGradientCandidates,
  transformPixels,
  warpQuadPixels,
  type NormalizedGradientVector,
  type RgbColor,
} from '../domain/imageAnalysis'
import { defaultGrassTintSettings } from '../domain/types'

const grassColorMapSource = '/minecraft/textures/colormap/grass.png'
const referencePixelsCache = new Map<string, Promise<ImageData>>()
const referenceGradientCache = new Map<
  string,
  Promise<NormalizedGradientVector>
>()
let grassColorMapPromise: Promise<ImageData> | undefined

async function decodedPixels(source: string, size?: number): Promise<ImageData> {
  const response = await fetch(source)
  if (!response.ok) {
    throw new Error(`Unable to load analysis image (${response.status}).`)
  }
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const width = size ?? bitmap.width
    const height = size ?? bitmap.height
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Off-thread image extraction is unavailable.')
    context.imageSmoothingEnabled = size === undefined
    context.drawImage(bitmap, 0, 0, width, height)
    return context.getImageData(0, 0, width, height)
  } finally {
    bitmap.close()
  }
}

async function grassTintColor(
  settings = defaultGrassTintSettings,
): Promise<RgbColor> {
  grassColorMapPromise ??= decodedPixels(grassColorMapSource)
  const colorMap = await grassColorMapPromise
  const [x, y] = grassColorMapCoordinates(
    settings,
    colorMap.width,
    colorMap.height,
  )
  const offset = (y * colorMap.width + x) * 4
  return {
    red: colorMap.data[offset],
    green: colorMap.data[offset + 1],
    blue: colorMap.data[offset + 2],
  }
}

function referenceCacheKey(job: AutoAnalyzeJob, size: number): string {
  const tint = job.grassTint ?? defaultGrassTintSettings
  return `${job.referenceUrl}:${size}:${tint.temperature}:${tint.downfall}`
}

function referencePixels(job: AutoAnalyzeJob, size: number): Promise<ImageData> {
  const key = referenceCacheKey(job, size)
  const cached = referencePixelsCache.get(key)
  if (cached) return cached
  const promise = decodedPixels(job.referenceUrl, size).then(async (pixels) => {
    if (!isGrassTexture(job.referenceUrl)) return pixels
    const copy = new ImageData(
      new Uint8ClampedArray(pixels.data),
      pixels.width,
      pixels.height,
    )
    return applyGrassTint(copy, await grassTintColor(job.grassTint))
  })
  referencePixelsCache.set(key, promise)
  return promise
}

function referenceGradient(
  job: AutoAnalyzeJob,
  size: number,
  transformIndex: number,
): Promise<NormalizedGradientVector> {
  const transform = job.transforms[transformIndex]
  const key = `${referenceCacheKey(job, size)}:${transform}`
  const cached = referenceGradientCache.get(key)
  if (cached) return cached
  const promise = referencePixels(job, size).then((pixels) =>
    normalizedGradientVector(
      transformPixels(pixels.data, size, transform),
      size,
    ),
  )
  referenceGradientCache.set(key, promise)
  return promise
}

async function analyzeJob(
  sourcePixels: ImageData,
  job: AutoAnalyzeJob,
  size: number,
) {
  const sample = normalizedGradientVector(
    warpQuadPixels(sourcePixels, job.quad, size).data,
    size,
  )
  const references = await Promise.all(
    job.transforms.map((_, index) => referenceGradient(job, size, index)),
  )
  const { scores, confidence } = scoreNormalizedGradientCandidates(
    sample,
    references,
  )
  return {
    evidenceId: job.evidenceId,
    scores,
    confidence,
  }
}

self.onmessage = async (event: MessageEvent<AutoAnalyzeRequest>) => {
  const request = event.data
  if (request.type !== 'analyze') return
  try {
    // The full screenshot is decoded, drawn, and read exactly once per batch.
    const sourcePixels = await decodedPixels(request.sourceUrl)
    const results = []
    for (const job of request.jobs) {
      results.push(await analyzeJob(sourcePixels, job, request.size))
    }
    const response: AutoAnalyzeResponse = {
      type: 'result',
      requestId: request.requestId,
      results,
    }
    self.postMessage(response)
  } catch (error) {
    const response: AutoAnalyzeResponse = {
      type: 'error',
      requestId: request.requestId,
      results: [],
      error:
        error instanceof Error ? error.message : 'Automatic analysis failed.',
    }
    self.postMessage(response)
  }
}

export {}
