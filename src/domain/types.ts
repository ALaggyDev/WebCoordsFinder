// Shared persisted and worker-facing contracts live here so geometry, storage,
// analysis, and UI code agree on the same current-format document.
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
export type HorizontalDirection = Exclude<FaceDirection, 'up' | 'down'>
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
export const scanOrders = ['linear', 'spiral'] as const
export type ScanOrder = (typeof scanOrders)[number]
export const searchDirections = [0, 90, 180, 270] as const
export type SearchDirection = (typeof searchDirections)[number]

export type ReviewStatus = 'unlabeled' | 'proposed' | 'confirmed'
export type EditorStep = 'grid' | 'faces' | 'export'
export type EditorTool = 'select' | 'anchor' | 'plane' | 'orient' | 'extrude'

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
  // A homography resolves only the two lattice axes spanned by this plane.
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
  // Row-major 3x4 projective camera matrix with its scale fixed by fitting.
  matrix: Matrix3x4
  rmsError: number
  maxError: number
}

export type SceneProjection = PlanarProjection | CameraProjection

export interface AxisMapping {
  // A/B/C are screenshot-local lattice axes; signed labels map them to world
  // X/Y/Z without silently inferring the user's compass orientation.
  a: WorldAxisLabel
  b: WorldAxisLabel
  c: WorldAxisLabel
}

export type OrientationMode = 'up' | 'horizontal'
export type OrientationSurfaceKind = 'top' | 'bottom' | 'side'

/**
 * Persists what the user identified as world UP. The referenced visible side
 * supplies planar winding parity and is re-evaluated if a later camera solve
 * reconciles the face normal.
 */
export interface WorldUpIntent {
  faceId: string
  surfaceKind: OrientationSurfaceKind
  edge: FaceEdge | null
}

/** Persists the directed lattice arrow that the user mapped to a compass direction. */
export interface HorizontalOrientationIntent {
  localDirection: Point3
  direction: HorizontalDirection
}

export interface SceneGeometry {
  faces: MeshFace[]
  observations: CalibrationObservation[]
  // Empty projects have no projection. A committed base surface has a planar
  // homography until non-coplanar observations promote it to a camera fit.
  projection: SceneProjection | null
  axisMapping: AxisMapping
  // Optional for schema-v1 compatibility with projects saved before the
  // planar-orientation intent was persisted.
  worldUpIntent?: WorldUpIntent | null
  horizontalOrientationIntent?: HorizontalOrientationIntent | null
}

export interface OrientationDraft {
  mode: OrientationMode
  faceId: string | null
  surfaceKind: OrientationSurfaceKind | null
  edge: FaceEdge | null
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
  // Settings belong to the observed block, so separate parts of a screenshot
  // can retain their own visual properties.
  blockSettings?: BlockSettings
}

export interface GrassTintSettings {
  temperature: number
  downfall: number
}

export interface BlockSettings {
  grassTint?: GrassTintSettings
}

export const defaultGrassTintSettings: GrassTintSettings = {
  // Plains matches the previous fixed grass tint.
  temperature: 0.8,
  downfall: 0.4,
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
  // Engine 5 records the absolute scan ordinal so the parallel coordinator can
  // retain the same first 1,000 matches as a monolithic scan.
  scanOrdinal?: string
}

export interface WebSearchShardCheckpoint {
  // Ranges are half-open absolute ordinals in the configured scan order.
  start: string
  end: string
  next: string
  matchCount: string
}

export type PersistedWebSearchPhase =
  | 'running'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error'

export interface WebSearchCheckpoint {
  engineVersion: 2 | 3 | 4 | 5 | 6
  // BigInt counters use decimal strings because projects are JSON-serialized.
  requestKey: string
  phase: PersistedWebSearchPhase
  processed: string
  total: string
  matchCount: string
  checksPerSecond: number
  results: WebSearchResult[]
  // Version 4 persists each independent cursor. Aggregate progress alone is
  // insufficient to resume a pool whose workers advance at different rates.
  shards?: WebSearchShardCheckpoint[]
  error?: string
  updatedAt: number
}

export interface ScannerSettings {
  textureAlgorithm: TextureAlgorithm
  scanOrder: ScanOrder
  directions: SearchDirection[]
  compassResolved: boolean
  bounds: SearchBounds
  cpuTileSize: { x: number; z: number }
  cudaTileSize: { x: number; z: number }
  errorTolerance: number
  verbose: boolean
  confidenceThreshold: number
  // Search progress is document state but intentionally bypasses undo history.
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
  // Profiles opt into their own controls, keeping this extensible for future
  // settings such as the deepslate axis.
  settings?: {
    grassTint?: boolean
  }
}

export interface ValidationResult {
  errors: string[]
  warnings: string[]
  rowCount: number
}
