import { create } from 'zustand'
import {
  automaticAxisMappingForUp,
  axisMappingFromUpAndHorizontal,
  blockCoordinateForFace,
  cameraFacingNormal,
  chooseEdgeExtrusion,
  createEdgeExtrusionFaces,
  dot3,
  flatConnectedFaceIds,
  inferInitialFaceNormal,
  initialCameraForPlanarExtrusion,
  isAxisMappingComplete,
  isWorldUpResolved,
  localUpForSurfaceKind,
  localUpForWorldUpIntent,
  localVectorForWorld,
  mappedAnchorOffset,
  meshEdgeKey,
  negate3,
  outerEdgeForExtrusion,
  orientationEdgeGeometry,
  planarProjectionForCoplanarFaces,
  planarProjectionForPlane,
  possibleFacesForLocalNormal,
  projectionInfo,
  refitProjection,
  sceneLatticeParity,
  selectedEdgeGeometry,
  same3,
  validAxisMappingCompletions,
} from '../domain/geometry'
import { sharedStatesForFaces } from '../domain/references'
import {
  defaultGrassTintSettings,
  searchDirections,
  worldAxisLabels,
} from '../domain/types'
import type {
  AxisMapping,
  BlockSettings,
  CandidateScore,
  EditorDocument,
  EditorStep,
  EditorTool,
  FaceDirection,
  FaceEdge,
  FaceEvidence,
  MeshFace,
  OrientationDraft,
  OrientationSurfaceKind,
  Point2,
  Point3,
  ScannerSettings,
  SearchDirection,
  SelectedEdge,
  WebSearchCheckpoint,
  WorldAxisLabel,
} from '../domain/types'

/*
 * The Zustand store owns persisted editor mutations and their undo history.
 * Canvas-only previews stay in component state and commit here once at the end
 * of a gesture, keeping each user action to one undoable document snapshot.
 */
function createFaceGrid(
  columns: number,
  rows: number,
  prefix: string,
  normal: Point3,
): MeshFace[] {
  return Array.from({ length: rows }).flatMap((_, row) =>
    Array.from({ length: columns }).map((__, column) => ({
      id: `${prefix}-${column}-${row}`,
      blockCoordinate: { x: column, y: row, z: 0 },
      normal,
    })),
  )
}

function createPlanarScene(
  columns: number,
  rows: number,
  corners: [Point2, Point2, Point2, Point2],
  prefix: string,
): EditorDocument['scene'] {
  const cornerLattice: [Point3, Point3, Point3, Point3] = [
    { x: 0, y: 0, z: 0 },
    { x: columns, y: 0, z: 0 },
    { x: columns, y: rows, z: 0 },
    { x: 0, y: rows, z: 0 },
  ]
  const observations = cornerLattice.map((lattice, index) => ({
    id: crypto.randomUUID(),
    lattice,
    image: corners[index],
    weight: 1,
  }))
  return {
    faces: createFaceGrid(
      columns,
      rows,
      prefix,
      inferInitialFaceNormal(corners),
    ),
    observations,
    projection: planarProjectionForPlane(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      cornerLattice,
      observations,
    ),
    axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    worldUpIntent: null,
    horizontalOrientationIntent: null,
  }
}

function createDefaultScanner(): ScannerSettings {
  // Defaults target current CoordsFinder behavior while leaving compass
  // orientation unresolved until the user supplies a valid world mapping.
  return {
    textureAlgorithm: 'Vanilla-3',
    scanOrder: 'linear',
    directions: [0],
    compassResolved: false,
    bounds: {
      xStart: -2000,
      xEnd: 2000,
      yStart: -60,
      yEnd: 0,
      zStart: -2000,
      zEnd: 2000,
    },
    cpuTileSize: { x: 1024, z: 1024 },
    cudaTileSize: { x: 16384, z: 16384 },
    errorTolerance: 0,
    verbose: false,
    confidenceThreshold: 0.08,
    webSearch: null,
  }
}

export const createEmptyDocument = (): EditorDocument => ({
  schemaVersion: 1,
  projectName: 'Untitled project',
  anchorFaceId: null,
  image: {
    key: '',
    name: '',
    src: '',
    width: 0,
    height: 0,
    mime: '',
  },
  scene: {
    faces: [],
    observations: [],
    projection: null,
    axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    worldUpIntent: null,
    horizontalOrientationIntent: null,
  },
  evidence: [],
  scanner: createDefaultScanner(),
})

function isValidAxisMapping(input: unknown): input is AxisMapping {
  if (!input || typeof input !== 'object') return false
  const mapping = input as Record<string, unknown>
  if (
    !(['a', 'b', 'c'] as const).every(
      (axis) =>
        typeof mapping[axis] === 'string' &&
        worldAxisLabels.includes(mapping[axis] as WorldAxisLabel),
    )
  ) {
    return false
  }
  return validAxisMappingCompletions(mapping as unknown as AxisMapping).length > 0
}

function isValidWorldUpIntent(input: unknown): boolean {
  if (input === undefined || input === null) return true
  if (typeof input !== 'object') return false
  const intent = input as Record<string, unknown>
  const surfaceKind = String(intent.surfaceKind)
  const edgeIsValid = ['top', 'right', 'bottom', 'left'].includes(
    String(intent.edge),
  )
  return (
    typeof intent.faceId === 'string' &&
    ['top', 'bottom', 'side'].includes(surfaceKind) &&
    (surfaceKind === 'side' ? edgeIsValid : intent.edge === null)
  )
}

function isValidHorizontalOrientationIntent(input: unknown): boolean {
  if (input === undefined || input === null) return true
  if (typeof input !== 'object') return false
  const intent = input as Record<string, unknown>
  return (
    isSignedUnitAxis(intent.localDirection) &&
    ['north', 'south', 'east', 'west'].includes(String(intent.direction))
  )
}

function worldUpOnlyMapping(mapping: AxisMapping): AxisMapping {
  const partial: AxisMapping = {
    a: 'unknown',
    b: 'unknown',
    c: 'unknown',
  }
  for (const axis of ['a', 'b', 'c'] as const) {
    if (mapping[axis].startsWith('y')) partial[axis] = mapping[axis]
  }
  return partial
}

function isPoint3(input: unknown): input is Point3 {
  if (!input || typeof input !== 'object') return false
  const point = input as Record<string, unknown>
  return ['x', 'y', 'z'].every(
    (axis) => typeof point[axis] === 'number' && Number.isFinite(point[axis]),
  )
}

function isSignedUnitAxis(input: unknown): input is Point3 {
  if (!isPoint3(input)) return false
  const components = [input.x, input.y, input.z]
  return (
    components.filter((value) => Math.abs(value) === 1).length === 1 &&
    components.filter((value) => value === 0).length === 2
  )
}

function mappingFromHorizontalOrientationIntent(
  scene: EditorDocument['scene'],
): AxisMapping | undefined {
  const localUp = localUpForWorldUpIntent(scene)
  const intent = scene.horizontalOrientationIntent
  return localUp && intent
    ? axisMappingFromUpAndHorizontal(
        scene,
        localUp,
        intent.localDirection,
        intent.direction,
      )
    : undefined
}

function isValidCommittedProjection(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const projection = input as Record<string, unknown>
  if (projection.kind === 'planar') {
    return (
      isPoint3(projection.origin) &&
      isPoint3(projection.uAxis) &&
      isPoint3(projection.vAxis) &&
      Array.isArray(projection.cornerLattice) &&
      projection.cornerLattice.length === 4 &&
      projection.cornerLattice.every(isPoint3) &&
      Array.isArray(projection.homography) &&
      projection.homography.length === 9 &&
      projection.homography.every(
        (value) => typeof value === 'number' && Number.isFinite(value),
      )
    )
  }
  return (
    projection.kind === 'camera' &&
    Array.isArray(projection.matrix) &&
    projection.matrix.length === 12 &&
    projection.matrix.every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    ) &&
    typeof projection.rmsError === 'number' &&
    Number.isFinite(projection.rmsError) &&
    typeof projection.maxError === 'number' &&
    Number.isFinite(projection.maxError)
  )
}

export function normalizeEditorDocument(input: unknown): EditorDocument {
  const candidate = input as Record<string, unknown>
  const scanner = candidate.scanner as Record<string, unknown> | undefined
  const scene = candidate.scene as Record<string, unknown> | undefined
  const directions = scanner?.directions
  if (
    // The application intentionally supports the current schema in place; this
    // guard rejects stale axis labels and malformed direction sets rather than
    // silently migrating them.
    candidate.schemaVersion !== 1 ||
    typeof candidate.projectName !== 'string' ||
    !scene ||
    !isValidAxisMapping(scene.axisMapping) ||
    !isValidWorldUpIntent(scene.worldUpIntent) ||
    !isValidHorizontalOrientationIntent(scene.horizontalOrientationIntent) ||
    !Array.isArray(scene.faces) ||
    !Array.isArray(scene.observations) ||
    (scene.faces.length === 0
      ? scene.projection !== null
      : !isValidCommittedProjection(scene.projection)) ||
    !Array.isArray(directions) ||
    new Set(directions).size !== directions.length ||
    directions.some(
      (direction) =>
        typeof direction !== 'number' ||
        !searchDirections.includes(direction as SearchDirection),
    ) ||
    (candidate.anchorFaceId !== null &&
      typeof candidate.anchorFaceId !== 'string')
  ) {
    throw new Error('This project uses an unsupported document schema.')
  }
  const normalized = structuredClone(input as EditorDocument)
  normalized.scene.worldUpIntent ??= null
  normalized.scene.horizontalOrientationIntent ??= null
  const defaults = createDefaultScanner()
  // Current-format fields default independently so existing project bundles
  // remain usable without interpreting superseded scanner settings.
  normalized.scanner = {
    ...defaults,
    ...normalized.scanner,
    bounds: { ...defaults.bounds, ...normalized.scanner.bounds },
    cpuTileSize: { ...defaults.cpuTileSize, ...normalized.scanner.cpuTileSize },
    cudaTileSize: { ...defaults.cudaTileSize, ...normalized.scanner.cudaTileSize },
  }
  const parity = sceneLatticeParity(normalized.scene)
  const mappingWasComplete = (['a', 'b', 'c'] as const).every(
    (axis) => normalized.scene.axisMapping[axis] !== 'unknown',
  )
  const intent = normalized.scene.worldUpIntent
  const referenceFace = intent
    ? normalized.scene.faces.find((face) => face.id === intent.faceId)
    : undefined
  const localUp = localUpForWorldUpIntent(normalized.scene, intent)
  const horizontalMapping = mappingFromHorizontalOrientationIntent(
    normalized.scene,
  )
  const automaticMapping =
    referenceFace && localUp
      ? automaticAxisMappingForUp(normalized.scene, referenceFace, localUp)
      : undefined
  const mappingIsInvalid =
    mappingWasComplete &&
    !isAxisMappingComplete(normalized.scene.axisMapping, parity)
  const replacementMapping =
    horizontalMapping ??
    (mappingIsInvalid
      ? automaticMapping ?? worldUpOnlyMapping(normalized.scene.axisMapping)
      : !mappingWasComplete && automaticMapping
        ? automaticMapping
        : undefined)
  if (
    replacementMapping &&
    (['a', 'b', 'c'] as const).some(
      (axis) => normalized.scene.axisMapping[axis] !== replacementMapping[axis],
    )
  ) {
    // Rebuild camera-inconsistent legacy mappings and upgrade planar projects
    // that stored only UP before homography parity was supported.
    normalized.scene.axisMapping = replacementMapping
    normalized.scanner.compassResolved = horizontalMapping !== undefined
    normalized.scanner.directions = horizontalMapping
      ? [0]
      : [...searchDirections]
    normalized.evidence.forEach((entry) => {
      entry.stateCount = evidenceStateCount(normalized, entry) ?? 4
      entry.selectedVariant = undefined
      entry.reviewStatus = 'unlabeled'
      entry.scores = undefined
      entry.confidence = undefined
    })
  }
  normalized.scanner.compassResolved =
    horizontalMapping !== undefined ||
    (Boolean(normalized.scanner.compassResolved) &&
      isAxisMappingComplete(
        normalized.scene.axisMapping,
        sceneLatticeParity(normalized.scene),
      ))
  if (normalized.scanner.compassResolved) {
    normalized.scanner.directions = [0]
  }
  normalized.evidence.forEach((entry) => {
    if (['grass_block', 'lily_pad'].includes(entry.blockId) && !entry.blockSettings?.grassTint) {
      entry.blockSettings = {
        ...entry.blockSettings,
        grassTint: { ...defaultGrassTintSettings },
      }
    }
  })
  return normalized
}

interface AnalysisResult {
  evidenceId: string
  scores: CandidateScore[]
  confidence: number
}

function syncProposalToThreshold(entry: FaceEvidence, threshold: number): void {
  if (!entry.scores?.length) return
  const qualifies = (entry.confidence ?? 0) >= threshold
  // Automatic analysis remains a proposal until explicit confirmation.
  entry.selectedVariant = qualifies ? entry.scores[0].variant : undefined
  entry.reviewStatus = qualifies ? 'proposed' : 'unlabeled'
}

function syncUnconfirmedProposals(document: EditorDocument): void {
  document.evidence
    .filter((entry) => entry.reviewStatus !== 'confirmed')
    .forEach((entry) =>
      syncProposalToThreshold(entry, document.scanner.confidenceThreshold),
    )
}

function evidenceFaces(
  document: EditorDocument,
  evidence: FaceEvidence,
): FaceDirection[] {
  return possibleFacesForLocalNormal(
    document.scene.axisMapping,
    evidence.localNormal,
    sceneLatticeParity(document.scene),
  )
}

function evidenceStateCount(
  document: EditorDocument,
  evidence: FaceEvidence,
): 2 | 4 | undefined {
  // A partial axis mapping may represent several world faces; evidence remains
  // editable only when those possibilities agree on two- versus four-state.
  return sharedStatesForFaces(evidence.blockId, evidenceFaces(document, evidence))
}

function createDefaultEvidence(document: EditorDocument, face: MeshFace): FaceEvidence {
  const faces = possibleFacesForLocalNormal(
    document.scene.axisMapping,
    face.normal,
    sceneLatticeParity(document.scene),
  )
  return {
    id: face.id,
    faceId: face.id,
    latticeCoordinate: blockCoordinateForFace(face),
    localNormal: face.normal,
    blockId: 'deepslate',
    stateCount: sharedStatesForFaces('deepslate', faces) ?? 4,
    reviewStatus: 'unlabeled',
    blockSettings: {},
  }
}

function createInheritedEvidence(
  document: EditorDocument,
  face: MeshFace,
  source?: FaceEvidence,
): FaceEvidence {
  const evidence = createDefaultEvidence(document, face)
  if (!source) return evidence

  // An extrusion reveals a new face, so its profile follows the source block
  // while its variant and any derived analysis remain unreviewed.
  evidence.blockId = source.blockId
  evidence.blockSettings = structuredClone(source.blockSettings ?? {})
  evidence.stateCount =
    sharedStatesForFaces(source.blockId, evidenceFaces(document, evidence)) ??
    evidence.stateCount
  return evidence
}

export function evidenceWorldCoordinate(
  document: EditorDocument,
  evidence: FaceEvidence,
): Point3 | undefined {
  return mappedAnchorOffset(
    document.scene,
    document.anchorFaceId,
    evidence.latticeCoordinate,
  )
}

function pruneGeometry(document: EditorDocument): void {
  const faceIds = new Set(document.scene.faces.map((face) => face.id))
  document.evidence = document.evidence.filter((entry) => faceIds.has(entry.faceId))
  if (document.anchorFaceId && !faceIds.has(document.anchorFaceId)) {
    // An anchor cannot outlive the face that identifies its owning block.
    document.anchorFaceId = null
  }
  if (document.scene.faces.length === 0) {
    document.scene.observations = []
    document.scene.projection = null
    document.scene.axisMapping = { a: 'unknown', b: 'unknown', c: 'unknown' }
    document.scene.worldUpIntent = null
    document.scene.horizontalOrientationIntent = null
    document.scanner.compassResolved = false
  } else if (
    document.scene.worldUpIntent &&
    !faceIds.has(document.scene.worldUpIntent.faceId)
  ) {
    document.scene.worldUpIntent = null
    document.scene.horizontalOrientationIntent = null
  }
}

type FaceTab = 'selection' | 'review'

interface EditorState {
  document: EditorDocument
  step: EditorStep
  faceTab: FaceTab
  tool: EditorTool
  orientationDraft: OrientationDraft | null
  selectedEdges: SelectedEdge[]
  selectedEvidenceIds: string[]
  hoveredEvidenceId: string | null
  past: EditorDocument[]
  future: EditorDocument[]
  setStep: (step: EditorStep) => void
  setFaceTab: (tab: FaceTab) => void
  setTool: (tool: EditorTool) => void
  selectEdge: (edge: SelectedEdge, additive: boolean) => void
  clearSelectedEdges: () => void
  inspectEvidence: (evidenceId: string) => void
  loadDocument: (document: unknown) => void
  replaceImage: (image: EditorDocument['image']) => void
  addBaseFaces: (
    corners: [Point2, Point2, Point2, Point2],
    columns?: number,
    rows?: number,
  ) => void
  moveObservation: (id: string, point: Point2) => void
  deleteObservation: (id: string) => void
  upsertObservation: (lattice: Point3, point: Point2) => void
  extrudeSelectedEdges: (point: Point2, secondPoint?: Point2) => void
  deleteFace: (faceId: string) => void
  deleteSelectedFaces: () => void
  flipSelectedFaces: () => void
  startUpOrientation: () => void
  startHorizontalOrientation: () => void
  setOrientationFace: (faceId: string) => void
  setOrientationSurfaceKind: (kind: OrientationSurfaceKind) => void
  setOrientationEdge: (edge: FaceEdge) => void
  setOrientationHorizontalDirection: (direction: FaceDirection) => void
  cancelOrientation: () => void
  setAnchorFace: (faceId: string) => void
  selectFace: (faceId: string, additive: boolean) => void
  selectFaces: (faceIds: string[], additive: boolean) => void
  setHoveredEvidence: (evidenceId: string | null) => void
  selectAllFaces: () => void
  clearSelection: () => void
  setBlockForSelection: (blockId: string) => void
  updateBlockSettingsForSelection: (patch: Partial<BlockSettings>) => void
  setVariant: (evidenceId: string, variant: number) => void
  setEvidenceStatus: (
    evidenceIds: string[],
    status: 'confirmed' | 'unlabeled',
  ) => void
  applyAnalysisResults: (results: AnalysisResult[]) => void
  acceptProposed: () => void
  clearReviewQueue: () => void
  updateScanner: (patch: Partial<ScannerSettings>) => void
  updateBounds: (patch: Partial<ScannerSettings['bounds']>) => void
  setWebSearchCheckpoint: (checkpoint: WebSearchCheckpoint | null) => void
  setProjectName: (name: string) => void
  undo: () => void
  redo: () => void
  resetProject: () => void
}

function mutateDocument(
  state: EditorState,
  mutator: (document: EditorDocument) => void,
): Pick<EditorState, 'document' | 'past' | 'future'> {
  const next = structuredClone(state.document)
  mutator(next)
  return {
    document: next,
    // Bound memory use while retaining a useful editing history.
    past: [...state.past.slice(-59), state.document],
    future: [],
  }
}

function removeFaces(document: EditorDocument, ids: Set<string>): void {
  document.scene.faces = document.scene.faces.filter((face) => !ids.has(face.id))
  pruneGeometry(document)
  if (document.scene.projection?.kind !== 'camera') return

  // A face edit can reduce a calibrated mesh to a different single plane.
  // Keep all dots and world orientation intact, but use dots on that surviving
  // plane to replace the no-longer-needed camera solve.
  const planar = planarProjectionForCoplanarFaces(
    document.scene.faces,
    document.scene.observations,
  )
  if (planar) {
    document.scene.observations = planar.observations
    document.scene.projection = planar.projection
    reconcilePersistedOrientation(document)
  }
}

function applyAxisMapping(
  document: EditorDocument,
  mapping: AxisMapping,
  compassResolved: boolean,
): void {
  const mappingChanged = (['a', 'b', 'c'] as const).some(
    (axis) => document.scene.axisMapping[axis] !== mapping[axis],
  )
  document.scene.axisMapping = mapping
  document.scanner.compassResolved =
    compassResolved &&
    isAxisMappingComplete(mapping, sceneLatticeParity(document.scene))
  document.scanner.directions = compassResolved
    ? [0]
    : [...searchDirections]
  if (!mappingChanged) return
  // World direction determines face support, crop orientation, and variant
  // meaning. Any mapping change invalidates all derived analysis together.
  document.evidence.forEach((entry) => {
    entry.stateCount = evidenceStateCount(document, entry) ?? 4
    entry.selectedVariant = undefined
    entry.reviewStatus = 'unlabeled'
    entry.scores = undefined
    entry.confidence = undefined
  })
}

function reconcilePersistedOrientation(document: EditorDocument): void {
  const parity = sceneLatticeParity(document.scene)
  const keepConfirmedMapping =
    document.scanner.compassResolved &&
    isAxisMappingComplete(document.scene.axisMapping, parity)
  const horizontalMapping = mappingFromHorizontalOrientationIntent(document.scene)
  const intent = document.scene.worldUpIntent
  const localUp = localUpForWorldUpIntent(document.scene, intent)
  const referenceFace = intent
    ? document.scene.faces.find((face) => face.id === intent.faceId)
    : undefined
  const automaticMapping =
    localUp && referenceFace
      ? automaticAxisMappingForUp(document.scene, referenceFace, localUp)
      : undefined
  const mapping =
    horizontalMapping ??
    (keepConfirmedMapping
      ? document.scene.axisMapping
      : automaticMapping ?? worldUpOnlyMapping(document.scene.axisMapping))

  applyAxisMapping(
    document,
    mapping,
    horizontalMapping !== undefined || keepConfirmedMapping,
  )
}

function reconcileCameraFacingGeometry(document: EditorDocument): void {
  if (document.scene.projection?.kind !== 'camera') return
  const changedFaceIds = new Set<string>()
  document.scene.faces.forEach((face) => {
    const normal = cameraFacingNormal(document.scene, face)
    if (same3(normal, face.normal)) return
    face.normal = normal
    changedFaceIds.add(face.id)
  })

  document.evidence
    .filter((entry) => changedFaceIds.has(entry.faceId))
    .forEach((entry) => {
      const face = document.scene.faces.find(
        (candidate) => candidate.id === entry.faceId,
      )
      if (!face) return
      entry.latticeCoordinate = blockCoordinateForFace(face)
      entry.localNormal = face.normal
      entry.selectedVariant = undefined
      entry.reviewStatus = 'unlabeled'
      entry.scores = undefined
      entry.confidence = undefined
    })

  reconcilePersistedOrientation(document)

  if (changedFaceIds.size > 0) {
    document.evidence.forEach((entry) => {
      entry.stateCount = evidenceStateCount(document, entry) ?? 4
    })
  }
}

export const useEditorStore = create<EditorState>((set) => ({
  document: createEmptyDocument(),
  step: 'grid',
  faceTab: 'selection',
  tool: 'select',
  orientationDraft: null,
  selectedEdges: [],
  selectedEvidenceIds: [],
  hoveredEvidenceId: null,
  past: [],
  future: [],
  setStep: (step) => set({ step }),
  setFaceTab: (faceTab) => set({ faceTab }),
  setTool: (tool) =>
    set((state) => {
      const hasProjection = state.document.scene.projection !== null
      if ((tool === 'anchor' || tool === 'orient') && !hasProjection) return state
      return {
        tool:
          tool === 'extrude' && state.selectedEdges.length === 0
            ? 'select'
            : tool,
      }
    }),
  selectEdge: (edge, additive) =>
    set((state) => {
      const geometry = selectedEdgeGeometry(state.document.scene, edge)
      if (!geometry) return state
      if (!additive) return { selectedEdges: [edge] }

      const key = meshEdgeKey(geometry.start, geometry.end)
      const selectedIndex = state.selectedEdges.findIndex((selection) => {
        const selected = selectedEdgeGeometry(state.document.scene, selection)
        return selected && meshEdgeKey(selected.start, selected.end) === key
      })
      if (selectedIndex >= 0) {
        return {
          selectedEdges: state.selectedEdges.filter((_, index) => index !== selectedIndex),
        }
      }
      const connected =
        state.selectedEdges.length === 0 ||
        state.selectedEdges.some((selection) => {
          const selected = selectedEdgeGeometry(state.document.scene, selection)
          return (
            selected &&
            [selected.start, selected.end].some((left) =>
              [geometry.start, geometry.end].some((right) => same3(left, right)),
            )
          )
        })
      // Extrusion selections form one connected chain. Starting on a separate
      // component replaces the chain instead of creating ambiguous endpoints.
      return {
        selectedEdges: connected ? [...state.selectedEdges, edge] : [edge],
      }
    }),
  clearSelectedEdges: () => set({ selectedEdges: [] }),
  inspectEvidence: (evidenceId) =>
    set((state) => {
      if (!state.document.evidence.some((entry) => entry.id === evidenceId)) return state
      return {
        selectedEvidenceIds: [evidenceId],
        selectedEdges: [],
        step: 'faces' as EditorStep,
        faceTab: 'selection' as FaceTab,
      }
    }),
  loadDocument: (input) => {
    const document = normalizeEditorDocument(input)
    syncUnconfirmedProposals(document)
    set({
      document,
      past: [],
      future: [],
      faceTab: 'selection',
      selectedEvidenceIds: [],
      selectedEdges: [],
      orientationDraft: null,
      step: 'grid',
      tool: document.scene.faces.length > 0 ? 'select' : 'plane',
    })
  },
  replaceImage: (image) =>
    set((state) => ({
      ...mutateDocument(state, (document) => {
        document.image = image
        // Geometry and evidence are image-space observations and cannot be
        // carried onto a different screenshot.
        document.scene.faces = []
        document.scene.observations = []
        document.scene.projection = null
        document.scene.axisMapping = {
          a: 'unknown',
          b: 'unknown',
          c: 'unknown',
        }
        document.scene.worldUpIntent = null
        document.scene.horizontalOrientationIntent = null
        document.evidence = []
        document.anchorFaceId = null
        document.scanner.compassResolved = false
      }),
      selectedEdges: [],
      selectedEvidenceIds: [],
      orientationDraft: null,
      step: 'grid',
      faceTab: 'selection',
      tool: 'plane',
    })),
  addBaseFaces: (corners, columns = 4, rows = 4) =>
    set((state) => {
      if (state.document.scene.faces.length > 0 || state.document.scene.projection) {
        return state
      }
      return {
        ...mutateDocument(state, (document) => {
          document.scene = createPlanarScene(
            columns,
            rows,
            corners,
            crypto.randomUUID(),
          )
          document.evidence = []
          document.anchorFaceId = document.scene.faces[0]?.id ?? null
          document.scanner.compassResolved = false
        }),
        selectedEdges: [],
        selectedEvidenceIds: [],
        orientationDraft: null,
        tool: 'select' as EditorTool,
      }
    }),
  moveObservation: (id, point) =>
    set((state) =>
      mutateDocument(state, (document) => {
        // The canvas renders transient drag positions; this call occurs once
        // on drag end and records the final calibration as one history entry.
        const observation = document.scene.observations.find((entry) => entry.id === id)
        if (!observation) return
        observation.image = point
        document.scene.projection = refitProjection(document.scene)
      }),
    ),
  deleteObservation: (id) =>
    set((state) => {
      const observations = state.document.scene.observations
      // A planar solve needs four paired anchors and a 3D camera needs six.
      // Never leave a solved camera with fewer observations than its fit
      // requires.
      const minimumObservations =
        state.document.scene.projection?.kind === 'camera' ? 6 : 4
      if (
        observations.length <= minimumObservations ||
        !observations.some((observation) => observation.id === id)
      ) {
        return state
      }
      return mutateDocument(state, (document) => {
        document.scene.observations = document.scene.observations.filter(
          (observation) => observation.id !== id,
        )
        document.scene.projection = refitProjection(document.scene)
      })
    }),
  upsertObservation: (lattice, point) =>
    set((state) =>
      mutateDocument(state, (document) => {
        const existing = document.scene.observations.find((entry) =>
          same3(entry.lattice, lattice),
        )
        if (existing) existing.image = point
        else {
          document.scene.observations.push({
            id: crypto.randomUUID(),
            lattice,
            image: point,
            weight: 1,
          })
        }
        document.scene.projection = refitProjection(document.scene)
      }),
    ),
  extrudeSelectedEdges: (point) =>
    set((state) => {
      if (state.selectedEdges.length === 0) return state
      const extrusion = chooseEdgeExtrusion(
        state.document.scene,
        state.selectedEdges,
        point,
      )
      const projection = projectionInfo(state.document.scene)
      const planarCamera =
        projection.resolvedAxes === 3 || !extrusion?.createsAxis
          ? undefined
          : initialCameraForPlanarExtrusion(
              state.document.scene,
              state.selectedEdges,
              extrusion.axis,
              extrusion.blocks,
              point,
            )
      if (!extrusion) return state
      const extrusionScene = planarCamera
        ? { ...state.document.scene, projection: planarCamera.projection }
        : state.document.scene
      const faces = createEdgeExtrusionFaces(
        extrusionScene,
        state.selectedEdges,
        extrusion.axis,
        extrusion.blocks,
        () => crypto.randomUUID(),
      )
      if (faces.length === 0) return state
      // Edge selection is ordered. Use the first selected source with evidence
      // for a predictable result when an extrusion spans differently labeled
      // blocks; untouched source faces retain the default profile.
      const sourceEvidence = state.selectedEdges
        .map((selection) =>
          state.document.evidence.find(
            (evidence) => evidence.faceId === selection.faceId,
          ),
        )
        .find((evidence) => evidence !== undefined)
      const outerEdges = faces
        .filter((_, index) => index % extrusion.blocks === extrusion.blocks - 1)
        .flatMap((face) => {
          const edge = outerEdgeForExtrusion(face, extrusion.axis)
          return edge ? [{ faceId: face.id, edge }] : []
        })
      return {
        ...mutateDocument(state, (document) => {
          document.scene.faces.push(...faces)
          document.evidence.push(
            ...faces.map((face) =>
              createInheritedEvidence(document, face, sourceEvidence),
            ),
          )
          if (
            projectionInfo(document.scene).resolvedAxes < 3 &&
            planarCamera
          ) {
            planarCamera.endpoints.forEach((endpoint, index) => {
              document.scene.observations.push({
                id: crypto.randomUUID(),
                lattice: endpoint,
                image: planarCamera.images[index],
                weight: 1,
              })
            })
            document.scene.projection = planarCamera.projection
            reconcileCameraFacingGeometry(document)
            document.anchorFaceId ??= document.scene.faces[0]?.id ?? null
          }
        }),
        selectedEdges: outerEdges,
        tool: 'select' as EditorTool,
      }
    }),
  deleteFace: (faceId) =>
    set((state) => ({
      ...mutateDocument(state, (document) => removeFaces(document, new Set([faceId]))),
      selectedEdges: state.selectedEdges.filter((edge) => edge.faceId !== faceId),
      selectedEvidenceIds: state.selectedEvidenceIds.filter((id) => id !== faceId),
    })),
  deleteSelectedFaces: () =>
    set((state) => {
      if (state.selectedEvidenceIds.length === 0) return state
      const ids = new Set(state.selectedEvidenceIds)
      return {
        ...mutateDocument(state, (document) => removeFaces(document, ids)),
        selectedEdges: state.selectedEdges.filter((edge) => !ids.has(edge.faceId)),
        selectedEvidenceIds: [],
      }
    }),
  flipSelectedFaces: () =>
    set((state) => {
      if (state.selectedEvidenceIds.length === 0) return state
      return mutateDocument(state, (document) => {
        const flippedIds = new Set<string>()
        state.selectedEvidenceIds.forEach((selectedId) => {
          if (flippedIds.has(selectedId)) return
          const selectedFace = document.scene.faces.find(
            (face) => face.id === selectedId,
          )
          if (!selectedFace) return
          const targetNormal = negate3(selectedFace.normal)
          const connectedIds = flatConnectedFaceIds(
            document.scene.faces,
            selectedId,
          )
          document.scene.faces
            // Flip the entire coplanar component so adjacent unit faces retain
            // a consistent visible side.
            .filter((face) => connectedIds.has(face.id))
            .forEach((face) => {
              face.normal = targetNormal
              flippedIds.add(face.id)
            })
        })
        document.evidence
          .filter((entry) => flippedIds.has(entry.faceId))
          .forEach((entry) => {
            const face = document.scene.faces.find(
              (candidate) => candidate.id === entry.faceId,
            )
            if (!face) return
            entry.latticeCoordinate = blockCoordinateForFace(face)
            entry.localNormal = face.normal
            entry.selectedVariant = undefined
            entry.reviewStatus = 'unlabeled'
            entry.scores = undefined
            entry.confidence = undefined
          })
        reconcilePersistedOrientation(document)
      })
    }),
  startUpOrientation: () =>
    set((state) => {
      if (!state.document.scene.projection || state.document.scene.faces.length === 0) {
        return state
      }
      const selectedFaceIds = state.selectedEvidenceIds.filter((id) =>
        state.document.scene.faces.some((face) => face.id === id),
      )
      return {
        orientationDraft: {
          mode: 'up',
          faceId: selectedFaceIds.length === 1 ? selectedFaceIds[0] : null,
          surfaceKind: null,
          edge: null,
        },
        selectedEdges: [],
        selectedEvidenceIds: [],
        tool: 'orient' as EditorTool,
      }
    }),
  startHorizontalOrientation: () =>
    set((state) => {
      if (
        !state.document.scene.projection ||
        !isWorldUpResolved(state.document.scene.axisMapping) ||
        sceneLatticeParity(state.document.scene) === undefined
      ) {
        return state
      }
      const selectedFaceIds = state.selectedEvidenceIds.filter((id) =>
        state.document.scene.faces.some((face) => face.id === id),
      )
      return {
        orientationDraft: {
          mode: 'horizontal',
          faceId: selectedFaceIds.length === 1 ? selectedFaceIds[0] : null,
          surfaceKind: null,
          edge: null,
        },
        selectedEdges: [],
        selectedEvidenceIds: [],
        tool: 'orient' as EditorTool,
      }
    }),
  setOrientationFace: (faceId) =>
    set((state) =>
      state.orientationDraft &&
      state.document.scene.faces.some((face) => face.id === faceId)
        ? {
            orientationDraft: {
              mode: state.orientationDraft.mode,
              faceId,
              surfaceKind: null,
              edge: null,
            },
          }
        : state,
    ),
  setOrientationSurfaceKind: (surfaceKind) =>
    set((state) => {
      const draft = state.orientationDraft
      if (draft?.mode !== 'up' || !draft.faceId) return state
      const face = state.document.scene.faces.find(
        (candidate) => candidate.id === draft.faceId,
      )
      if (!face) return state
      if (surfaceKind === 'side') {
        return {
          orientationDraft: { ...draft, surfaceKind, edge: null },
        }
      }
      const localUp = localUpForSurfaceKind(face, surfaceKind)
      const mapping = localUp
        ? automaticAxisMappingForUp(state.document.scene, face, localUp)
        : undefined
      if (!mapping) return state
      return {
        ...mutateDocument(state, (document) => {
          document.scene.worldUpIntent = {
            faceId: face.id,
            surfaceKind,
            edge: null,
          }
          document.scene.horizontalOrientationIntent = null
          applyAxisMapping(document, mapping, false)
        }),
        orientationDraft: null,
        tool: 'select' as EditorTool,
      }
    }),
  setOrientationEdge: (edge) =>
    set((state) => {
      const draft = state.orientationDraft
      if (!draft?.faceId) return state
      const face = state.document.scene.faces.find(
        (candidate) => candidate.id === draft.faceId,
      )
      if (!face) return state
      const arrow = orientationEdgeGeometry(face, edge)
      if (draft.mode === 'horizontal') {
        const localUp = localVectorForWorld(
          state.document.scene.axisMapping,
          { x: 0, y: 1, z: 0 },
        )
        if (!localUp || Math.abs(dot3(localUp, arrow.direction)) > 1e-8) {
          return state
        }
        return { orientationDraft: { ...draft, edge } }
      }
      if (draft.surfaceKind !== 'side') return state
      const mapping = automaticAxisMappingForUp(
        state.document.scene,
        face,
        arrow.direction,
      )
      if (!mapping) return state
      return {
        ...mutateDocument(state, (document) => {
          document.scene.worldUpIntent = {
            faceId: face.id,
            surfaceKind: 'side',
            edge,
          }
          document.scene.horizontalOrientationIntent = null
          applyAxisMapping(document, mapping, false)
        }),
        orientationDraft: null,
        tool: 'select' as EditorTool,
      }
    }),
  setOrientationHorizontalDirection: (horizontalDirection) =>
    set((state) => {
      if (horizontalDirection === 'up' || horizontalDirection === 'down') {
        return state
      }
      const draft = state.orientationDraft
      if (draft?.mode !== 'horizontal' || !draft.faceId || !draft.edge) {
        return state
      }
      const face = state.document.scene.faces.find(
        (candidate) => candidate.id === draft.faceId,
      )
      const localUp = localVectorForWorld(
        state.document.scene.axisMapping,
        { x: 0, y: 1, z: 0 },
      )
      if (!face || !localUp) return state
      const arrow = orientationEdgeGeometry(face, draft.edge)
      const mapping = axisMappingFromUpAndHorizontal(
        state.document.scene,
        localUp,
        arrow.direction,
        horizontalDirection,
      )
      if (!mapping) return state
      return {
        ...mutateDocument(state, (document) => {
          document.scene.horizontalOrientationIntent = {
            localDirection: arrow.direction,
            direction: horizontalDirection,
          }
          applyAxisMapping(document, mapping, true)
        }),
        orientationDraft: null,
        tool: 'select' as EditorTool,
      }
    }),
  cancelOrientation: () =>
    set({ orientationDraft: null, tool: 'select' as EditorTool }),
  setAnchorFace: (faceId) =>
    set((state) => {
      if (!state.document.scene.projection) return state
      if (!state.document.scene.faces.some((face) => face.id === faceId)) {
        return state
      }
      if (state.document.anchorFaceId === faceId) {
        return { selectedEdges: [], tool: 'select' as EditorTool }
      }
      return {
        ...mutateDocument(state, (document) => {
          document.anchorFaceId = faceId
        }),
        selectedEdges: [],
        tool: 'select' as EditorTool,
      }
    }),
  selectFace: (faceId, additive) =>
    set((state) => {
      const face = state.document.scene.faces.find((entry) => entry.id === faceId)
      if (!face) return state
      const exists = state.document.evidence.some((entry) => entry.id === faceId)
      // Geometry selection lazily creates evidence; merely drawing faces does
      // not populate the export filter.
      const documentPatch = exists
        ? {}
        : mutateDocument(state, (document) => {
            document.evidence.push(createDefaultEvidence(document, face))
          })
      const selectedEvidenceIds = additive
        ? state.selectedEvidenceIds.includes(faceId)
          ? state.selectedEvidenceIds.filter((id) => id !== faceId)
          : [...state.selectedEvidenceIds, faceId]
        : [faceId]
      return {
        ...documentPatch,
        selectedEdges: [],
        selectedEvidenceIds,
        faceTab: 'selection' as FaceTab,
      }
    }),
  selectFaces: (faceIds, additive) =>
    set((state) => {
      const validIds = state.document.scene.faces
        .map((face) => face.id)
        .filter((id) => faceIds.includes(id))
      const selectedEvidenceIds = additive
        ? [...new Set([...state.selectedEvidenceIds, ...validIds])]
        : validIds
      const missingFaces = state.document.scene.faces.filter(
        (face) => validIds.includes(face.id) &&
          !state.document.evidence.some((entry) => entry.id === face.id),
      )
      const unchanged =
        missingFaces.length === 0 &&
        selectedEvidenceIds.length === state.selectedEvidenceIds.length &&
        selectedEvidenceIds.every((id, index) => id === state.selectedEvidenceIds[index])
      const documentPatch =
        missingFaces.length === 0
          ? {}
          : mutateDocument(state, (document) => {
              document.evidence.push(
                ...missingFaces.map((face) => createDefaultEvidence(document, face)),
              )
            })
      if (unchanged) return { selectedEdges: [] }
      return {
        ...documentPatch,
        selectedEdges: [],
        selectedEvidenceIds,
        faceTab: 'selection' as FaceTab,
      }
    }),
  setHoveredEvidence: (evidenceId) => set({ hoveredEvidenceId: evidenceId }),
  selectAllFaces: () =>
    set((state) => {
      const faceIds = state.document.scene.faces.map((face) => face.id)
      const evidenceIds = new Set(state.document.evidence.map((entry) => entry.id))
      const missingFaces = state.document.scene.faces.filter(
        (face) => !evidenceIds.has(face.id),
      )
      const documentPatch =
        missingFaces.length === 0
          ? {}
          : mutateDocument(state, (document) => {
              document.evidence.push(
                ...missingFaces.map((face) => createDefaultEvidence(document, face)),
              )
            })
      return {
        ...documentPatch,
        selectedEdges: [],
        selectedEvidenceIds: faceIds,
        faceTab: 'selection' as FaceTab,
      }
    }),
  clearSelection: () => set({ selectedEvidenceIds: [] }),
  setBlockForSelection: (blockId) =>
    set((state) =>
      mutateDocument(state, (document) => {
        const selected = document.evidence.filter((entry) =>
          state.selectedEvidenceIds.includes(entry.id),
        )
        const states = selected.map((entry) =>
          sharedStatesForFaces(blockId, evidenceFaces(document, entry)),
        )
        selected.forEach((entry, index) => {
          if (states[index] === undefined) return
          const blockChanged = entry.blockId !== blockId
          entry.blockId = blockId
          if (blockChanged) {
            entry.blockSettings = ['grass_block', 'lily_pad'].includes(blockId)
              ? { grassTint: { ...defaultGrassTintSettings } }
              : {}
          }
          entry.stateCount = states[index]!
          entry.selectedVariant = undefined
          entry.reviewStatus = 'unlabeled'
          entry.scores = undefined
          entry.confidence = undefined
        })
      }),
    ),
  updateBlockSettingsForSelection: (patch) =>
    set((state) =>
      mutateDocument(state, (document) => {
        const selectedCoordinates = new Set(
          document.evidence
            .filter((entry) => state.selectedEvidenceIds.includes(entry.id))
            .map((entry) =>
              [
                entry.latticeCoordinate.x,
                entry.latticeCoordinate.y,
                entry.latticeCoordinate.z,
              ].join(','),
            ),
        )
        document.evidence
          .filter((entry) =>
            selectedCoordinates.has(
              [
                entry.latticeCoordinate.x,
                entry.latticeCoordinate.y,
                entry.latticeCoordinate.z,
              ].join(','),
            ),
          )
          .forEach((entry) => {
            if (
              patch.grassTint &&
              !['grass_block', 'lily_pad'].includes(entry.blockId)
            ) return
            entry.blockSettings = { ...entry.blockSettings, ...patch }
            // Proposals contain scores for the previous reference pixels.
            // Confirmed evidence has already been explicitly reviewed.
            if (entry.reviewStatus === 'proposed') {
              entry.selectedVariant = undefined
              entry.reviewStatus = 'unlabeled'
            }
            entry.scores = undefined
            entry.confidence = undefined
          })
      }),
    ),
  setVariant: (id, variant) =>
    set((state) =>
      mutateDocument(state, (document) => {
        const entry = document.evidence.find((item) => item.id === id)
        if (!entry) return
        if (entry.selectedVariant === variant) {
          entry.selectedVariant = undefined
          entry.reviewStatus = 'unlabeled'
        } else {
          entry.selectedVariant = variant
          entry.reviewStatus = 'confirmed'
        }
      }),
    ),
  setEvidenceStatus: (ids, reviewStatus) =>
    set((state) =>
      mutateDocument(state, (document) => {
        document.evidence
          .filter((entry) => ids.includes(entry.id))
          .forEach((entry) => {
            if (reviewStatus === 'confirmed' && entry.selectedVariant === undefined) return
            entry.reviewStatus = reviewStatus
            if (reviewStatus === 'unlabeled') entry.selectedVariant = undefined
          })
      }),
    ),
  applyAnalysisResults: (results) =>
    set((state) =>
      mutateDocument(state, (document) => {
        results.forEach((result) => {
          const entry = document.evidence.find((item) => item.id === result.evidenceId)
          if (!entry || result.scores.length === 0) return
          entry.scores = result.scores
          entry.confidence = result.confidence
          entry.selectedVariant = undefined
          entry.reviewStatus = 'unlabeled'
          syncProposalToThreshold(entry, document.scanner.confidenceThreshold)
        })
      }),
    ),
  acceptProposed: () =>
    set((state) =>
      mutateDocument(state, (document) => {
        document.evidence
          .filter((entry) => entry.reviewStatus === 'proposed')
          .forEach((entry) => {
            entry.reviewStatus = 'confirmed'
          })
      }),
    ),
  clearReviewQueue: () =>
    set((state) =>
      mutateDocument(state, (document) => {
        document.evidence.forEach((entry) => {
          if (entry.scores === undefined && entry.confidence === undefined) return
          entry.scores = undefined
          entry.confidence = undefined
          if (entry.reviewStatus === 'proposed') {
            entry.selectedVariant = undefined
            entry.reviewStatus = 'unlabeled'
          }
        })
      }),
    ),
  updateScanner: (patch) =>
    set((state) =>
      mutateDocument(state, (document) => {
        document.scanner = { ...document.scanner, ...patch }
        if (patch.confidenceThreshold !== undefined) syncUnconfirmedProposals(document)
      }),
    ),
  updateBounds: (patch) =>
    set((state) =>
      mutateDocument(state, (document) => {
        document.scanner.bounds = { ...document.scanner.bounds, ...patch }
      }),
    ),
  setWebSearchCheckpoint: (webSearch) =>
    set((state) => ({
      // Progress updates are frequent runtime state, not user edits. Keep them
      // out of the document undo stack.
      document: {
        ...state.document,
        scanner: {
          ...state.document.scanner,
          webSearch,
        },
      },
    })),
  setProjectName: (projectName) =>
    set((state) =>
      mutateDocument(state, (document) => {
        document.projectName = projectName
      }),
    ),
  undo: () =>
    set((state) => {
      const previous = state.past.at(-1)
      if (!previous) return state
      const document = structuredClone(previous)
      // Undoing geometry or settings must not rewind a long-running search.
      document.scanner.webSearch = state.document.scanner.webSearch
      return {
        document,
        past: state.past.slice(0, -1),
        future: [state.document, ...state.future].slice(0, 60),
        orientationDraft: null,
        selectedEdges: [],
        selectedEvidenceIds: [],
        tool: document.scene.faces.length > 0 ? 'select' : 'plane',
      }
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0]
      if (!next) return state
      const document = structuredClone(next)
      // Search checkpoints follow runtime progress across both history paths.
      document.scanner.webSearch = state.document.scanner.webSearch
      return {
        document,
        past: [...state.past, state.document].slice(-60),
        future: state.future.slice(1),
        orientationDraft: null,
        selectedEdges: [],
        selectedEvidenceIds: [],
        tool: document.scene.faces.length > 0 ? 'select' : 'plane',
      }
    }),
  resetProject: () =>
    set({
      document: createEmptyDocument(),
      past: [],
      future: [],
      faceTab: 'selection',
      orientationDraft: null,
      selectedEdges: [],
      selectedEvidenceIds: [],
      step: 'grid',
      tool: 'select',
    }),
}))
