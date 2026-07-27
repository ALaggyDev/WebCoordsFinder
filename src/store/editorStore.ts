import { create } from 'zustand'
import {
  add3,
  chooseEdgeExtrusion,
  computeHomography,
  createEdgeExtrusionFaces,
  faceForLocalNormal,
  isAxisMappingComplete,
  mappedVector,
  meshEdgeKey,
  refitProjection,
  scale3,
  selectedEdgeEndpoints,
  selectedEdgeGeometry,
  same3,
  translatedExtrusionAnchors,
} from '../domain/geometry'
import { statesForFace } from '../domain/references'
import type {
  AbstractAxis,
  AxisMapping,
  CandidateScore,
  EditorDocument,
  EditorStep,
  EditorTool,
  FaceDirection,
  FaceEvidence,
  MeshFace,
  Point2,
  Point3,
  ScannerSettings,
  SelectedEdge,
  WorldAxisLabel,
} from '../domain/types'

const demoCorners: [Point2, Point2, Point2, Point2] = [
  { x: 0, y: 644 },
  { x: 1058, y: 574 },
  { x: 1450, y: 1000 },
  { x: 0, y: 1102 },
]
const planeOrigin = { x: 0, y: 0, z: 0 }
const planeU = { x: 1, y: 0, z: 0 }
const planeV = { x: 0, y: 1, z: 0 }
const planeNormal = { x: 0, y: 0, z: 1 }

function createFaceGrid(columns: number, rows: number, prefix: string): MeshFace[] {
  return Array.from({ length: rows }).flatMap((_, row) =>
    Array.from({ length: columns }).map((__, column) => ({
      id: `${prefix}-${column}-${row}`,
      origin: { x: column, y: row, z: 0 },
      uAxis: planeU,
      vAxis: planeV,
      normal: planeNormal,
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
    planeOrigin,
    { x: columns, y: 0, z: 0 },
    { x: columns, y: rows, z: 0 },
    { x: 0, y: rows, z: 0 },
  ]
  return {
    faces: createFaceGrid(columns, rows, prefix),
    observations: cornerLattice.map((lattice, index) => ({
      id: crypto.randomUUID(),
      lattice,
      image: corners[index],
      weight: 1,
    })),
    projection: {
      kind: 'planar',
      origin: planeOrigin,
      uAxis: planeU,
      vAxis: planeV,
      cornerLattice,
      homography: computeHomography(
        [
          { x: 0, y: 0 },
          { x: columns, y: 0 },
          { x: columns, y: rows },
          { x: 0, y: rows },
        ],
        corners,
      ),
    },
    axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
  }
}

export const createInitialDocument = (): EditorDocument => ({
  schemaVersion: 1,
  projectName: 'Anchor block',
  image: {
    key: 'demo',
    name: 'Example cavern screenshot',
    src: '/demo/demo.png',
    width: 2560,
    height: 1494,
    mime: 'image/png',
  },
  scene: createPlanarScene(6, 4, demoCorners, 'floor-demo'),
  evidence: [],
  scanner: {
    textureAlgorithm: 'Vanilla-3',
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
  },
})

export function normalizeEditorDocument(input: unknown): EditorDocument {
  const candidate = input as Record<string, unknown>
  if (candidate.schemaVersion !== 1 || !candidate.scene) {
    throw new Error('This project uses an unsupported document schema.')
  }
  return structuredClone(input as EditorDocument)
}

interface AnalysisResult {
  evidenceId: string
  scores: CandidateScore[]
  confidence: number
}

function syncProposalToThreshold(entry: FaceEvidence, threshold: number): void {
  if (!entry.scores?.length) return
  const qualifies = (entry.confidence ?? 0) >= threshold
  entry.selectedVariant = qualifies ? entry.scores[0].variant : undefined
  entry.reviewStatus = qualifies ? 'proposed' : 'unlabeled'
}

function syncUnconfirmedProposals(document: EditorDocument): void {
  document.evidence
    .filter((entry) => !['confirmed', 'excluded'].includes(entry.reviewStatus))
    .forEach((entry) =>
      syncProposalToThreshold(entry, document.scanner.confidenceThreshold),
    )
}

function evidenceFace(
  document: EditorDocument,
  evidence: FaceEvidence,
): FaceDirection | undefined {
  return faceForLocalNormal(document.scene.axisMapping, evidence.localNormal)
}

function createDefaultEvidence(document: EditorDocument, face: MeshFace): FaceEvidence {
  const direction = faceForLocalNormal(document.scene.axisMapping, face.normal)
  return {
    id: face.id,
    faceId: face.id,
    latticeCoordinate: face.origin,
    localNormal: face.normal,
    blockId: 'stone',
    stateCount: direction ? statesForFace('stone', direction) ?? 4 : 4,
    reviewStatus: 'unlabeled',
  }
}

export function evidenceWorldCoordinate(
  document: EditorDocument,
  evidence: FaceEvidence,
): Point3 | undefined {
  return mappedVector(document.scene.axisMapping, evidence.latticeCoordinate)
}

function pruneGeometry(document: EditorDocument): void {
  const faceIds = new Set(document.scene.faces.map((face) => face.id))
  document.evidence = document.evidence.filter((entry) => faceIds.has(entry.faceId))
  if (document.scene.faces.length === 0) document.scene.observations = []
}

type FaceTab = 'selection' | 'review'

interface EditorState {
  document: EditorDocument
  step: EditorStep
  faceTab: FaceTab
  tool: EditorTool
  selectedEdges: SelectedEdge[]
  selectedEvidenceIds: string[]
  past: EditorDocument[]
  future: EditorDocument[]
  setStep: (step: EditorStep) => void
  setFaceTab: (tab: FaceTab) => void
  setTool: (tool: EditorTool) => void
  toggleSelectedEdge: (edge: SelectedEdge) => void
  clearSelectedEdges: () => void
  inspectEvidence: (evidenceId: string) => void
  loadDocument: (document: unknown) => void
  replaceImage: (image: EditorDocument['image']) => void
  addBaseFaces: (corners: [Point2, Point2, Point2, Point2]) => void
  moveObservation: (id: string, point: Point2) => void
  upsertObservation: (lattice: Point3, point: Point2) => void
  extrudeSelectedEdges: (point: Point2, secondPoint?: Point2) => void
  deleteFace: (faceId: string) => void
  deleteSelectedFaces: () => void
  flipSelectedFaces: () => void
  updateAxisMapping: (axis: AbstractAxis, label: WorldAxisLabel) => void
  selectFace: (faceId: string, additive: boolean) => void
  selectAllFaces: () => void
  clearSelection: () => void
  setBlockForSelection: (blockId: string) => void
  setVariant: (evidenceId: string, variant: number) => void
  setEvidenceStatus: (
    evidenceIds: string[],
    status: 'confirmed' | 'excluded' | 'unlabeled',
  ) => void
  applyAnalysisResults: (results: AnalysisResult[]) => void
  acceptProposed: () => void
  clearReviewQueue: () => void
  updateScanner: (patch: Partial<ScannerSettings>) => void
  updateBounds: (patch: Partial<ScannerSettings['bounds']>) => void
  setProjectName: (name: string) => void
  undo: () => void
  redo: () => void
  resetDemo: () => void
}

function mutateDocument(
  state: EditorState,
  mutator: (document: EditorDocument) => void,
): Pick<EditorState, 'document' | 'past' | 'future'> {
  const next = structuredClone(state.document)
  mutator(next)
  return {
    document: next,
    past: [...state.past.slice(-59), state.document],
    future: [],
  }
}

function removeFaces(document: EditorDocument, ids: Set<string>): void {
  document.scene.faces = document.scene.faces.filter((face) => !ids.has(face.id))
  pruneGeometry(document)
}

export const useEditorStore = create<EditorState>((set) => ({
  document: createInitialDocument(),
  step: 'grid',
  faceTab: 'selection',
  tool: 'select',
  selectedEdges: [],
  selectedEvidenceIds: [],
  past: [],
  future: [],
  setStep: (step) => set({ step }),
  setFaceTab: (faceTab) => set({ faceTab }),
  setTool: (tool) =>
    set((state) => ({
      tool: tool === 'extrude' && state.selectedEdges.length === 0 ? 'select' : tool,
    })),
  toggleSelectedEdge: (edge) =>
    set((state) => {
      const geometry = selectedEdgeGeometry(state.document.scene, edge)
      if (!geometry) return state
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
    })
  },
  replaceImage: (image) =>
    set((state) => ({
      ...mutateDocument(state, (document) => {
        document.image = image
        document.scene.faces = []
        document.scene.observations = []
        document.evidence = []
      }),
      selectedEdges: [],
      selectedEvidenceIds: [],
      step: 'grid',
      faceTab: 'selection',
      tool: 'plane',
    })),
  addBaseFaces: (corners) =>
    set((state) => {
      if (state.document.scene.faces.length > 0) return state
      return {
        ...mutateDocument(state, (document) => {
          document.scene = createPlanarScene(4, 4, corners, crypto.randomUUID())
          document.evidence = []
          document.scanner.compassResolved = false
        }),
        selectedEdges: [],
        tool: 'select' as EditorTool,
      }
    }),
  moveObservation: (id, point) =>
    set((state) =>
      mutateDocument(state, (document) => {
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
      const planarAnchors =
        state.document.scene.projection.kind === 'camera' ||
        !extrusion?.createsAxis
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
        .map((face) => ({ faceId: face.id, edge: 'bottom' as const }))
      return {
        ...mutateDocument(state, (document) => {
          document.scene.faces.push(...faces)
          if (document.scene.projection.kind !== 'camera' && planarAnchors) {
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
      const ids = new Set(state.selectedEvidenceIds)
      return mutateDocument(state, (document) => {
        document.scene.faces
          .filter((face) => ids.has(face.id))
          .forEach((face) => {
            face.normal = {
              x: -face.normal.x,
              y: -face.normal.y,
              z: -face.normal.z,
            }
          })
        document.evidence
          .filter((entry) => ids.has(entry.faceId))
          .forEach((entry) => {
            const face = document.scene.faces.find(
              (candidate) => candidate.id === entry.faceId,
            )
            if (!face) return
            entry.localNormal = face.normal
            entry.selectedVariant = undefined
            entry.reviewStatus = 'unlabeled'
            entry.scores = undefined
            entry.confidence = undefined
          })
      })
    }),
  updateAxisMapping: (axis, label) =>
    set((state) =>
      mutateDocument(state, (document) => {
        const next: AxisMapping = { ...document.scene.axisMapping, [axis]: label }
        const worldAxis = label === 'unknown' ? undefined : label[0]
        if (worldAxis) {
          for (const other of ['a', 'b', 'c'] as const) {
            if (other !== axis && next[other][0] === worldAxis) next[other] = 'unknown'
          }
        }
        document.scene.axisMapping = next
        document.scanner.compassResolved = isAxisMappingComplete(next)
        document.evidence.forEach((entry) => {
          const face = evidenceFace(document, entry)
          entry.stateCount = face ? statesForFace(entry.blockId, face) ?? 4 : 4
          entry.selectedVariant = undefined
          entry.reviewStatus = 'unlabeled'
          entry.scores = undefined
          entry.confidence = undefined
        })
      }),
    ),
  selectFace: (faceId, additive) =>
    set((state) => {
      const face = state.document.scene.faces.find((entry) => entry.id === faceId)
      if (!face) return state
      const exists = state.document.evidence.some((entry) => entry.id === faceId)
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
        const faces = selected.map((entry) => evidenceFace(document, entry))
        if (faces.some((face) => !face || !statesForFace(blockId, face))) return
        selected.forEach((entry, index) => {
          entry.blockId = blockId
          entry.stateCount = statesForFace(blockId, faces[index]!)!
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
      return {
        document: previous,
        past: state.past.slice(0, -1),
        future: [state.document, ...state.future].slice(0, 60),
      }
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0]
      if (!next) return state
      return {
        document: next,
        past: [...state.past, state.document].slice(-60),
        future: state.future.slice(1),
      }
    }),
  resetDemo: () =>
    set({
      document: createInitialDocument(),
      past: [],
      future: [],
      faceTab: 'selection',
      selectedEdges: [],
      selectedEvidenceIds: [],
      step: 'grid',
      tool: 'select',
    }),
}))
