export type Point2 = { x: number; y: number }
export type Point3 = { x: number; y: number; z: number }
export type Matrix3x4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

export type FaceDirection = 'up' | 'down' | 'north' | 'south' | 'east' | 'west'
export type AbstractAxis = 'a' | 'b' | 'c'
export const worldAxisLabels = [
  'unknown',
  'x+',
  'x-',
  'y+',
  'y-',
  'z+',
  'z-',
] as const
export type WorldAxisLabel = (typeof worldAxisLabels)[number]
export const textureAlgorithms = [
  'Vanilla-1',
  'Vanilla-2',
  'Vanilla-3',
  'Sodium-1',
  'Sodium-2',
] as const
export type TextureAlgorithm = (typeof textureAlgorithms)[number]
export const searchDirections = [0, 90, 180, 270] as const
export type SearchDirection = (typeof searchDirections)[number]

export type ReviewStatus = 'unlabeled' | 'proposed' | 'confirmed'
export type EditorStep = 'image' | 'grid' | 'faces' | 'export'
export type EditorTool = 'select' | 'anchor' | 'plane' | 'extrude'

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

export interface MeshFace {
  id: string
  /** Canonical minimum lattice corner of the face square, not its owning block. */
  blockCoordinate: Point3
  normal: Point3
}

export type FaceEdge = 'top' | 'right' | 'bottom' | 'left'

export interface SelectedEdge {
  faceId: string
  edge: FaceEdge
}

export interface CalibrationObservation {
  id: string
  lattice: Point3
  image: Point2
  weight: number
}

export interface PlanarProjection {
  kind: 'planar'
  origin: Point3
  uAxis: Point3
  vAxis: Point3
  cornerLattice: [Point3, Point3, Point3, Point3]
  homography: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
}

export interface CameraProjection {
  kind: 'camera'
  matrix: Matrix3x4
  rmsError: number
  maxError: number
}

export type SceneProjection = PlanarProjection | CameraProjection

export interface AxisMapping {
  a: WorldAxisLabel
  b: WorldAxisLabel
  c: WorldAxisLabel
}

export interface SceneGeometry {
  faces: MeshFace[]
  observations: CalibrationObservation[]
  projection: SceneProjection
  axisMapping: AxisMapping
}

export interface CandidateScore {
  variant: number
  score: number
}

export interface FaceEvidence {
  id: string
  faceId: string
  /** Coordinate of the block that owns the visible face. */
  latticeCoordinate: Point3
  localNormal: Point3
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

export interface WebSearchResult {
  x: number
  y: number
  z: number
  badBlocks: number
  direction: SearchDirection
}

export type PersistedWebSearchPhase =
  | 'running'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error'

export interface WebSearchCheckpoint {
  engineVersion: 2
  requestKey: string
  phase: PersistedWebSearchPhase
  processed: string
  total: string
  matchCount: string
  checksPerSecond: number
  results: WebSearchResult[]
  error?: string
  updatedAt: number
}

export interface ScannerSettings {
  textureAlgorithm: TextureAlgorithm
  directions: SearchDirection[]
  compassResolved: boolean
  bounds: SearchBounds
  chunkBlocksX: number
  chunkBlocksZ: number
  maxBadBlocks: number
  printChunks: boolean
  confidenceThreshold: number
  webSearch: WebSearchCheckpoint | null
}

export interface EditorDocument {
  schemaVersion: 1
  projectName: string
  anchorFaceId: string | null
  image: ImageAsset
  scene: SceneGeometry
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
  referenceTextures: Partial<Record<FaceDirection, string>>
  transforms: CandidateTransform[]
  notes: string
}

export interface ValidationResult {
  errors: string[]
  warnings: string[]
  rowCount: number
}
