export type Point2 = { x: number; y: number }
export type Point3 = { x: number; y: number; z: number }

export type FaceDirection = 'up' | 'down' | 'north' | 'south' | 'east' | 'west'
export type TextureMode =
  | 'Vanilla-1'
  | 'Vanilla-2'
  | 'Vanilla-3'
  | 'Sodium-1'
  | 'Sodium-2'

export type ReviewStatus = 'unlabeled' | 'proposed' | 'confirmed' | 'excluded'
export type EditorStep = 'image' | 'grid' | 'faces' | 'review' | 'export'
export type EditorTool = 'select' | 'plane' | 'face'

export type CandidateTransform =
  | 'identity'
  | 'rotate90'
  | 'rotate180'
  | 'rotate270'
  | 'mirrorX'
  | 'mirrorXRotate180'

export interface ImageAsset {
  key: string
  name: string
  src: string
  width: number
  height: number
  mime: string
}

export interface PerspectivePlane {
  id: string
  name: string
  corners: [Point2, Point2, Point2, Point2]
  columns: number
  rows: number
  face: FaceDirection
  origin: Point3
  uAxis: Point3
  vAxis: Point3
  inactiveCells: string[]
  connectedTo?: {
    planeId: string
    edge: 'top' | 'right' | 'bottom' | 'left'
  }
}

export interface CandidateScore {
  variant: number
  score: number
}

export interface FaceEvidence {
  id: string
  planeId: string
  column: number
  row: number
  coordinate: Point3
  face: FaceDirection
  blockId: string
  stateCount: 2 | 4
  selectedVariant?: number
  reviewStatus: ReviewStatus
  scores?: CandidateScore[]
  confidence?: number
}

export interface SearchBounds {
  xStart: number
  xEnd: number
  yStart: number
  yEnd: number
  zStart: number
  zEnd: number
}

export interface ScannerSettings {
  minecraftVersion: string
  renderer: 'vanilla' | 'sodium'
  sodiumVersion: string
  compassResolved: boolean
  bounds: SearchBounds
  chunkBlocksX: number
  chunkBlocksZ: number
  maxBadBlocks: number
  printChunks: boolean
  confidenceThreshold: number
}

export interface EditorDocument {
  schemaVersion: 1
  projectName: string
  image: ImageAsset
  planes: PerspectivePlane[]
  evidence: FaceEvidence[]
  scanner: ScannerSettings
}

export interface BlockProfile {
  id: string
  label: string
  family: string
  accent: string
  compatibleSince: string
  faceStates: Partial<Record<FaceDirection, 2 | 4>>
  transforms: CandidateTransform[]
  notes: string
}

export interface ValidationResult {
  errors: string[]
  warnings: string[]
  rowCount: number
}
