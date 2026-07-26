import { create } from 'zustand'
import {
  cellCoordinate,
  createHingedPlane,
  defaultAxesForFace,
  evidenceId,
} from '../domain/geometry'
import { statesForFace } from '../domain/references'
import type {
  CandidateScore,
  EditorDocument,
  EditorStep,
  EditorTool,
  FaceDirection,
  PerspectivePlane,
  Point2,
  ScannerSettings,
} from '../domain/types'

const demoPlanes: PerspectivePlane[] = [
  {
    id: 'floor-demo',
    name: 'Cavern floor',
    corners: [
      { x: 0, y: 644 },
      { x: 1058, y: 574 },
      { x: 1450, y: 1000 },
      { x: 0, y: 1102 },
    ],
    columns: 6,
    rows: 4,
    face: 'up',
    origin: { x: 0, y: 0, z: 0 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 0, z: 1 },
    inactiveCells: [],
  },
]

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
  planes: structuredClone(demoPlanes),
  evidence: [],
  scanner: {
    minecraftVersion: '1.21.11',
    renderer: 'vanilla',
    sodiumVersion: '4.9',
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

interface AnalysisResult {
  evidenceId: string
  scores: CandidateScore[]
  confidence: number
}

interface EditorState {
  document: EditorDocument
  step: EditorStep
  tool: EditorTool
  selectedPlaneId?: string
  selectedEvidenceIds: string[]
  past: EditorDocument[]
  future: EditorDocument[]
  setStep: (step: EditorStep) => void
  setTool: (tool: EditorTool) => void
  setSelectedPlane: (planeId?: string) => void
  loadDocument: (document: EditorDocument) => void
  replaceImage: (image: EditorDocument['image']) => void
  addPlane: (
    corners: [Point2, Point2, Point2, Point2],
    face?: FaceDirection,
    singleFace?: boolean,
  ) => void
  addHingedPlane: () => void
  updatePlane: (id: string, patch: Partial<PerspectivePlane>) => void
  movePlaneCorner: (id: string, corner: number, point: Point2) => void
  removePlane: (id: string) => void
  selectCell: (planeId: string, column: number, row: number, additive: boolean) => void
  clearSelection: () => void
  setBlockForSelection: (blockId: string) => void
  setVariant: (evidenceId: string, variant: number) => void
  setEvidenceStatus: (
    evidenceIds: string[],
    status: 'confirmed' | 'excluded' | 'unlabeled',
  ) => void
  applyAnalysisResults: (results: AnalysisResult[]) => void
  acceptQualifiedProposals: () => void
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

export const useEditorStore = create<EditorState>((set) => ({
  document: createInitialDocument(),
  step: 'grid',
  tool: 'select',
  selectedPlaneId: 'wall-demo',
  selectedEvidenceIds: [],
  past: [],
  future: [],
  setStep: (step) => set({ step }),
  setTool: (tool) => set({ tool }),
  setSelectedPlane: (selectedPlaneId) => set({ selectedPlaneId }),
  loadDocument: (document) =>
    set({
      document,
      past: [],
      future: [],
      selectedEvidenceIds: [],
      selectedPlaneId: document.planes[0]?.id,
    }),
  replaceImage: (image) =>
    set((state) => ({
      ...mutateDocument(state, (document) => {
        document.image = image
        document.planes = []
        document.evidence = []
      }),
      selectedPlaneId: undefined,
      selectedEvidenceIds: [],
      step: 'grid',
      tool: 'plane',
    })),
  addPlane: (corners, face = 'north', singleFace = false) =>
    set((state) => {
      const id = crypto.randomUUID()
      const axes = defaultAxesForFace(face)
      return {
        ...mutateDocument(state, (document) => {
          document.planes.push({
            id,
            name: `Plane ${document.planes.length + 1}`,
            corners,
            columns: singleFace ? 1 : 4,
            rows: singleFace ? 1 : 4,
            face,
            origin: { x: 0, y: 0, z: 0 },
            uAxis: axes.uAxis,
            vAxis: axes.vAxis,
            inactiveCells: [],
          })
        }),
        selectedPlaneId: id,
        tool: 'select' as EditorTool,
      }
    }),
  addHingedPlane: () =>
    set((state) => {
      const source = state.document.planes.find(
        (plane) => plane.id === state.selectedPlaneId,
      )
      if (!source) return state
      const id = crypto.randomUUID()
      return {
        ...mutateDocument(state, (document) => {
          document.planes.push(createHingedPlane(source, id))
        }),
        selectedPlaneId: id,
      }
    }),
  updatePlane: (id, patch) =>
    set((state) =>
      mutateDocument(state, (document) => {
        const plane = document.planes.find((entry) => entry.id === id)
        if (!plane) return
        Object.assign(plane, patch)
        document.evidence
          .filter((entry) => entry.planeId === id)
          .forEach((entry) => {
            entry.coordinate = cellCoordinate(plane, entry.column, entry.row)
            entry.face = plane.face
            const stateCount = statesForFace(entry.blockId, plane.face)
            if (stateCount) entry.stateCount = stateCount
          })
      }),
    ),
  movePlaneCorner: (id, corner, point) =>
    set((state) =>
      mutateDocument(state, (document) => {
        const plane = document.planes.find((entry) => entry.id === id)
        if (plane) plane.corners[corner] = point
      }),
    ),
  removePlane: (id) =>
    set((state) => ({
      ...mutateDocument(state, (document) => {
        document.planes = document.planes.filter((plane) => plane.id !== id)
        document.evidence = document.evidence.filter((entry) => entry.planeId !== id)
      }),
      selectedPlaneId: undefined,
      selectedEvidenceIds: [],
    })),
  selectCell: (planeId, column, row, additive) =>
    set((state) => {
      const id = evidenceId(planeId, column, row)
      const plane = state.document.planes.find((entry) => entry.id === planeId)
      if (!plane) return state
      const existing = state.document.evidence.find((entry) => entry.id === id)
      let documentPatch: Pick<EditorState, 'document' | 'past' | 'future'> | undefined
      if (!existing) {
        documentPatch = mutateDocument(state, (document) => {
          document.evidence.push({
            id,
            planeId,
            column,
            row,
            coordinate: cellCoordinate(plane, column, row),
            face: plane.face,
            blockId: 'stone',
            stateCount: statesForFace('stone', plane.face) ?? 4,
            reviewStatus: 'unlabeled',
          })
        })
      }
      const previous = state.selectedEvidenceIds
      const selectedEvidenceIds = additive
        ? previous.includes(id)
          ? previous.filter((entry) => entry !== id)
          : [...previous, id]
        : [id]
      return {
        ...(documentPatch ?? {}),
        selectedPlaneId: planeId,
        selectedEvidenceIds,
        step: 'faces' as EditorStep,
      }
    }),
  clearSelection: () => set({ selectedEvidenceIds: [] }),
  setBlockForSelection: (blockId) =>
    set((state) =>
      mutateDocument(state, (document) => {
        document.evidence
          .filter((entry) => state.selectedEvidenceIds.includes(entry.id))
          .forEach((entry) => {
            const stateCount = statesForFace(blockId, entry.face)
            if (!stateCount) return
            entry.blockId = blockId
            entry.stateCount = stateCount
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
        entry.selectedVariant = variant
        entry.reviewStatus = 'confirmed'
      }),
    ),
  setEvidenceStatus: (ids, reviewStatus) =>
    set((state) =>
      mutateDocument(state, (document) => {
        document.evidence
          .filter((entry) => ids.includes(entry.id))
          .forEach((entry) => {
            entry.reviewStatus = reviewStatus
            if (reviewStatus === 'unlabeled') entry.selectedVariant = undefined
          })
      }),
    ),
  applyAnalysisResults: (results) =>
    set((state) =>
      mutateDocument(state, (document) => {
        results.forEach((result) => {
          const entry = document.evidence.find(
            (item) => item.id === result.evidenceId,
          )
          if (!entry || result.scores.length === 0) return
          entry.scores = result.scores
          entry.confidence = result.confidence
          entry.selectedVariant = result.scores[0].variant
          entry.reviewStatus = 'proposed'
        })
      }),
    ),
  acceptQualifiedProposals: () =>
    set((state) =>
      mutateDocument(state, (document) => {
        document.evidence
          .filter(
            (entry) =>
              entry.reviewStatus === 'proposed' &&
              (entry.confidence ?? 0) >= document.scanner.confidenceThreshold &&
              (state.selectedEvidenceIds.length === 0 ||
                state.selectedEvidenceIds.includes(entry.id)),
          )
          .forEach((entry) => {
            entry.reviewStatus = 'confirmed'
          })
      }),
    ),
  updateScanner: (patch) =>
    set((state) =>
      mutateDocument(state, (document) => {
        document.scanner = { ...document.scanner, ...patch }
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
      selectedPlaneId: 'wall-demo',
      selectedEvidenceIds: [],
      step: 'grid',
      tool: 'select',
    }),
}))
