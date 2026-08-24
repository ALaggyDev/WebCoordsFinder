import type {
  CandidateScore,
  CandidateTransform,
  GrassTintSettings,
  Point2,
} from './types'

export interface AutoAnalyzeJob {
  evidenceId: string
  quad: [Point2, Point2, Point2, Point2]
  referenceUrl: string
  grassTint?: GrassTintSettings
  transforms: CandidateTransform[]
  stateCount: 2 | 4
}

export interface AutoAnalyzeRequest {
  type: 'analyze'
  requestId: string
  sourceUrl: string
  size: number
  jobs: AutoAnalyzeJob[]
}

export interface AutoAnalyzeResult {
  evidenceId: string
  scores: CandidateScore[]
  confidence: number
}

export interface AutoAnalyzeResponse {
  type: 'result' | 'error'
  requestId: string
  results: AutoAnalyzeResult[]
  error?: string
}
