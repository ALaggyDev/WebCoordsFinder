import { create } from 'zustand'
import {
  add3,
  axisMappingFromReferences,
  blockCoordinateForFace,
  cameraFitDiagnostics,
  cameraFacingNormal,
  chooseEdgeExtrusion,
  cross3,
  createEdgeExtrusionFaces,
  fitCameraProjection,
  flatConnectedFaceIds,
  inferInitialFaceNormal,
  isAxisMappingComplete,
  mappedAnchorOffset,
  meshEdgeKey,
  negate3,
  outerEdgeForExtrusion,
  orientationEdgeGeometry,
  planarProjectionForPlane,
  possibleFacesForLocalNormal,
  projectionInfo,
  refitProjection,
  scale3,
  selectedEdgeGeometry,
  selectedEdgeEndpoints,
  same3,
  subtract3,
  translatedExtrusionAnchors,
  validAxisMappingCompletions,
} from '../domain/geometry'
import { sharedStatesForFaces } from '../domain/references'
import type { ExampleProjectId } from '../domain/examples'
import { searchDirections, worldAxisLabels } from '../domain/types'
import type {
  AxisMapping,
  CandidateScore,
  EditorDocument,
  EditorStep,
  EditorTool,
  FaceDirection,
  FaceEdge,
  FaceEvidence,
  MeshFace,
  OrientationDraft,
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
const demoCorners: [Point2, Point2, Point2, Point2] = [
  { x: 0, y: 644 },
  { x: 1058, y: 574 },
  { x: 1450, y: 1000 },
  { x: 0, y: 1102 },
]
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

interface CameraSetup {
  baseCorners: [Point2, Point2, Point2, Point2]
  columns: number
  rows: number
  edge: { start: Point3; end: Point3 }
  depth: number
  outerCorners: [Point2, Point2]
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
  }
}

function createCalibrationDepthFaces(
  draft: CameraSetup,
  prefix: string,
): MeshFace[] {
  if (!draft.edge) return []
  const direction = subtract3(draft.edge.end, draft.edge.start)
  const span = Math.abs(direction.x) + Math.abs(direction.y)
  const step = scale3(direction, 1 / span)
  return Array.from({ length: draft.depth }).flatMap((_, depthIndex) =>
    Array.from({ length: span }, (__, index) => {
      const start = add3(draft.edge!.start, scale3(step, index))
      const end = add3(start, step)
      return {
        id: `${prefix}-depth-${depthIndex}-${index}`,
        blockCoordinate: {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          z: depthIndex,
        },
        normal: cross3(step, { x: 0, y: 0, z: 1 }),
      }
    }),
  )
}

function createCalibratedScene(
  draft: CameraSetup,
  prefix: string,
): EditorDocument['scene'] {
  if (!draft.edge || draft.outerCorners.length !== 2) {
    throw new Error('Choose a grid edge and extrude the depth reference.')
  }
  const baseLattice: [Point3, Point3, Point3, Point3] = [
    { x: 0, y: 0, z: 0 },
    { x: draft.columns, y: 0, z: 0 },
    { x: draft.columns, y: draft.rows, z: 0 },
    { x: 0, y: draft.rows, z: 0 },
  ]
  const { start: edgeStart, end: edgeEnd } = draft.edge
  const outerLattice: [Point3, Point3] = [edgeStart, edgeEnd].map(
    (point) => ({ ...point, z: draft.depth }),
  ) as [Point3, Point3]
  const observations = [
    ...baseLattice.map((lattice, index) => ({
      id: crypto.randomUUID(),
      lattice,
      image: draft.baseCorners[index],
      weight: 1,
    })),
    ...outerLattice.map((lattice, index) => ({
      id: crypto.randomUUID(),
      lattice,
      image: draft.outerCorners[index],
      weight: 1,
    })),
  ]
  const projection = fitCameraProjection(observations)
  const diagnostics = cameraFitDiagnostics(projection, {
    x: draft.columns / 2,
    y: draft.rows / 2,
    z: 0,
  })
  if (!diagnostics.finite || diagnostics.minAxisLength < 0.25) {
    throw new Error('The depth reference produces an unstable camera fit.')
  }
  if (diagnostics.minAxisSeparationDegrees < 1) {
    throw new Error(
      'The depth face is too flat in the image. Choose a clearer perpendicular face.',
    )
  }

  const scene: EditorDocument['scene'] = {
    faces: [
      ...createFaceGrid(
        draft.columns,
        draft.rows,
        `${prefix}-base`,
        { x: 0, y: 0, z: 1 },
      ),
      ...createCalibrationDepthFaces(draft, prefix),
    ],
    observations,
    projection,
    axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
  }
  scene.faces.forEach((face) => {
    face.normal = cameraFacingNormal(scene, face)
  })
  return scene
}

function createDefaultScanner(): ScannerSettings {
  // Defaults target current CoordsFinder behavior while leaving compass
  // orientation unresolved until the user supplies a valid world mapping.
  return {
    textureAlgorithm: 'Vanilla-3',
    directions: [0],
    compassResolved: false,
    bounds: {
      xStart: -5000,
      xEnd: 5000,
      yStart: -60,
      yEnd: 0,
      zStart: -5000,
      zEnd: 5000,
    },
    chunkBlocksX: 16384,
    chunkBlocksZ: 64,
    maxBadBlocks: 0,
    printChunks: true,
    confidenceThreshold: 0.08,
    webSearch: null,
  }
}

export const createExampleDocument = (
  exampleId: ExampleProjectId = 'cavern',
): EditorDocument => {
  if (exampleId !== 'cavern') {
    throw new Error(`Unknown example project: ${exampleId}`)
  }
  const scene = createCalibratedScene(
    {
      baseCorners: demoCorners,
      columns: 6,
      rows: 4,
      edge: {
        start: { x: 0, y: 0, z: 0 },
        end: { x: 6, y: 0, z: 0 },
      },
      depth: 2,
      outerCorners: [
        { x: 210, y: 310 },
        { x: 970, y: 300 },
      ],
    },
    'cavern-demo',
  )
  return {
    schemaVersion: 1,
    projectName: 'Example cavern',
    anchorFaceId: scene.faces[0]?.id ?? null,
    image: {
      key: 'demo',
      name: 'Example cavern screenshot',
      src: '/demo/demo.png',
      width: 2560,
      height: 1494,
      mime: 'image/png',
    },
    scene,
    evidence: [],
    scanner: createDefaultScanner(),
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
  },
  evidence: [],
  scanner: createDefaultScanner(),
})

// Retained as the fixture factory used by domain and component tests.
export const createInitialDocument = createExampleDocument

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

function isPoint3(input: unknown): input is Point3 {
  if (!input || typeof input !== 'object') return false
  const point = input as Record<string, unknown>
  return ['x', 'y', 'z'].every(
    (axis) => typeof point[axis] === 'number' && Number.isFinite(point[axis]),
  )
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
  normalized.scanner.compassResolved = isAxisMappingComplete(
    normalized.scene.axisMapping,
  )
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
  )
  return {
    id: face.id,
    faceId: face.id,
    latticeCoordinate: blockCoordinateForFace(face),
    localNormal: face.normal,
    blockId: 'deepslate',
    stateCount: sharedStatesForFaces('deepslate', faces) ?? 4,
    reviewStatus: 'unlabeled',
  }
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
    document.scanner.compassResolved = false
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
  upsertObservation: (lattice: Point3, point: Point2) => void
  extrudeSelectedEdges: (point: Point2, secondPoint?: Point2) => void
  deleteFace: (faceId: string) => void
  deleteSelectedFaces: () => void
  flipSelectedFaces: () => void
  startOrientation: () => void
  setOrientationFace: (faceId: string) => void
  setOrientationFaceDirection: (direction: FaceDirection) => void
  setOrientationEdge: (edge: FaceEdge) => void
  setOrientationEdgeDirection: (direction: FaceDirection) => void
  confirmOrientation: () => void
  cancelOrientation: () => void
  setAnchorFace: (faceId: string) => void
  selectFace: (faceId: string, additive: boolean) => void
  selectAllFaces: () => void
  clearSelection: () => void
  setBlockForSelection: (blockId: string) => void
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
}

function applyAxisMapping(
  document: EditorDocument,
  mapping: AxisMapping,
): void {
  document.scene.axisMapping = mapping
  document.scanner.compassResolved = isAxisMappingComplete(mapping)
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

export const useEditorStore = create<EditorState>((set) => ({
  document: createEmptyDocument(),
  step: 'image',
  faceTab: 'selection',
  tool: 'select',
  orientationDraft: null,
  selectedEdges: [],
  selectedEvidenceIds: [],
  past: [],
  future: [],
  setStep: (step) =>
    set((state) => {
      const fullCamera = state.document.scene.projection?.kind === 'camera'
      const ready =
        fullCamera &&
        state.document.anchorFaceId !== null &&
        isAxisMappingComplete(state.document.scene.axisMapping)
      return (step === 'faces' || step === 'export') && !ready
        ? state
        : { step }
    }),
  setFaceTab: (faceTab) => set({ faceTab }),
  setTool: (tool) =>
    set((state) => {
      const fullCamera = state.document.scene.projection?.kind === 'camera'
      if ((tool === 'anchor' || tool === 'orient') && !fullCamera) return state
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
      // Restored projects reopen at the earliest meaningful workflow stage.
      step: document.scene.faces.length > 0 ? 'grid' : 'image',
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
          document.anchorFaceId = null
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
      const endpoints = selectedEdgeEndpoints(
        state.document.scene,
        state.selectedEdges,
      )
      const projection = projectionInfo(state.document.scene)
      const planarAnchors =
        projection.resolvedAxes === 3 || !extrusion?.createsAxis
          ? undefined
          : translatedExtrusionAnchors(
              state.document.scene,
              state.selectedEdges,
              point,
            )
      if (!extrusion || !endpoints) return state
      const faces = createEdgeExtrusionFaces(
        state.document.scene,
        state.selectedEdges,
        extrusion.axis,
        extrusion.blocks,
        () => crypto.randomUUID(),
      )
      if (faces.length === 0) return state
      const outerEdges = faces
        .filter((_, index) => index % extrusion.blocks === extrusion.blocks - 1)
        .flatMap((face) => {
          const edge = outerEdgeForExtrusion(face, extrusion.axis)
          return edge ? [{ faceId: face.id, edge }] : []
        })
      return {
        ...mutateDocument(state, (document) => {
          document.scene.faces.push(...faces)
          if (
            projectionInfo(document.scene).resolvedAxes < 3 &&
            planarAnchors
          ) {
            planarAnchors.endpoints.forEach((endpoint, index) => {
              document.scene.observations.push({
                id: crypto.randomUUID(),
                lattice: add3(
                  endpoint,
                  scale3(extrusion.axis, extrusion.blocks),
                ),
                image: planarAnchors.images[index],
                weight: 1,
              })
            })
            document.scene.projection = refitProjection(document.scene)
            if (document.scene.projection?.kind === 'camera') {
              document.scene.faces.forEach((face) => {
                face.normal = cameraFacingNormal(document.scene, face)
              })
              document.evidence.forEach((entry) => {
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
              document.anchorFaceId ??= document.scene.faces[0]?.id ?? null
            }
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
      })
    }),
  startOrientation: () =>
    set((state) => {
      if (
        state.document.scene.projection?.kind !== 'camera' ||
        !state.document.anchorFaceId
      ) {
        return state
      }
      return {
        orientationDraft: {
          faceId: null,
          faceDirection: null,
          edge: null,
          edgeDirection: null,
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
              faceId,
              faceDirection: null,
              edge: null,
              edgeDirection: null,
            },
          }
        : state,
    ),
  setOrientationFaceDirection: (faceDirection) =>
    set((state) =>
      state.orientationDraft?.faceId
        ? {
            orientationDraft: {
              ...state.orientationDraft,
              faceDirection,
              edgeDirection: null,
            },
          }
        : state,
    ),
  setOrientationEdge: (edge) =>
    set((state) =>
      state.orientationDraft?.faceId
        ? {
            orientationDraft: {
              ...state.orientationDraft,
              edge,
              edgeDirection: null,
            },
          }
        : state,
    ),
  setOrientationEdgeDirection: (edgeDirection) =>
    set((state) =>
      state.orientationDraft?.faceId && state.orientationDraft.edge
        ? {
            orientationDraft: {
              ...state.orientationDraft,
              edgeDirection,
            },
          }
        : state,
    ),
  confirmOrientation: () =>
    set((state) => {
      const draft = state.orientationDraft
      if (
        !draft?.faceId ||
        !draft.faceDirection ||
        !draft.edge ||
        !draft.edgeDirection
      ) {
        return state
      }
      const face = state.document.scene.faces.find(
        (candidate) => candidate.id === draft.faceId,
      )
      if (!face) return state
      const edge = orientationEdgeGeometry(face, draft.edge)
      const mapping = axisMappingFromReferences(
        face.normal,
        draft.faceDirection,
        edge.direction,
        draft.edgeDirection,
      )
      if (!mapping) return state
      return {
        ...mutateDocument(state, (document) => {
          applyAxisMapping(document, mapping)
        }),
        orientationDraft: null,
        tool: 'select' as EditorTool,
      }
    }),
  cancelOrientation: () =>
    set({ orientationDraft: null, tool: 'select' as EditorTool }),
  setAnchorFace: (faceId) =>
    set((state) => {
      if (state.document.scene.projection?.kind !== 'camera') return state
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
        if (states.some((state) => state === undefined)) return
        selected.forEach((entry, index) => {
          entry.blockId = blockId
          entry.stateCount = states[index]!
          entry.selectedVariant = undefined
          entry.reviewStatus = 'unlabeled'
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
      step: 'image',
      tool: 'select',
    }),
}))
