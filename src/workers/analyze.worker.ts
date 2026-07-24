import {
  normalizedGradientScore,
  transformPixels,
} from '../domain/imageAnalysis'
import type { CandidateTransform } from '../domain/types'

interface AnalyzeRequest {
  requestId: string
  sample: Uint8ClampedArray
  reference: Uint8ClampedArray
  size: number
  transforms: CandidateTransform[]
  stateCount: 2 | 4
}

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const { requestId, sample, reference, size, transforms, stateCount } = event.data
  const rawScores = transforms.map((transform, variant) => ({
    variant: stateCount === 2 ? variant % 2 : variant,
    score: normalizedGradientScore(
      sample,
      transformPixels(reference, size, transform),
      size,
    ),
  }))
  const uniqueScores = new Map<number, number>()
  rawScores.forEach(({ variant, score }) => {
    uniqueScores.set(variant, Math.max(score, uniqueScores.get(variant) ?? -1))
  })
  const scores = [...uniqueScores.entries()]
    .map(([variant, score]) => ({ variant, score }))
    .sort((a, b) => b.score - a.score)
  const confidence = scores.length > 1 ? scores[0].score - scores[1].score : 0
  self.postMessage({ requestId, scores, confidence })
}

export {}
