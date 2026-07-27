import { create } from 'zustand'
import {
  add3,
  chooseEdgeExtrusionAxis,
  computeHomography,
  createEdgeExtrusionPatches,
  evidenceId,
  faceForLocalNormal,
  isAxisMappingComplete,
  mappedVector,
  meshEdgeKey,
  patchCornersLattice,
  patchVertex,
  refitProjection,
  selectedEdgeEndpoints,
  selectedEdgeGeometry,
  same3,
  scale3,
} from '../domain/geometry'
import { statesForFace } from '../domain/references'
import type {
  AbstractAxis,
  AxisMapping,
  CalibrationObservation,
  CandidateScore,
  EditorDocument,
  EditorStep,
  EditorTool,
  FaceDirection,
  FaceEvidence,
  Point2,
  Point3,
  ScannerSettings,
  SelectedEdge,
  SurfacePatch,
  WorldAxisLabel,
} from '../domain/types'

const demoCorners: [Point2, Point2, Point2, Point2] = [
  { x: 0, y: 644 },
  { x: 1058, y: 574 },
  { x: 1450, y: 1000 },
  { x: 0, y: 1102 },
]

const demoPatch: SurfacePatch = {
  id: 'floor-demo',
  name: 'Cavern floor',
  origin: { x: 0, y: 0, z: 0 },
  uAxis: { x: 1, y: 0, z: 0 },
  vAxis: { x: 0, y: 1, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  columns: 6,
  rows: 4,
  inactiveCells: [],
}

function cornerObservations(
  patch: SurfacePatch,
  corners: [Point2, Point2, Point2, Point2],
): CalibrationObservation[] {
  return patchCornersLattice(patch).map((lattice, index) => ({
    id: crypto.randomUUID(),
    lattice,
    image: corners[index],
    weight: 1,
  }))
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
  scene: {
    patches: [structuredClone(demoPatch)],
    observations: cornerObservations(demoPatch, demoCorners),
    projection: {
      kind: 'planar',
      patchId: demoPatch.id,
      homography: computeHomography(
        [
          { x: 0, y: 0 },
          { x: demoPatch.columns, y: 0 },
          { x: demoPatch.columns, y: demoPatch.rows },
          { x: 0, y: demoPatch.rows },
        ],
        demoCorners,
      ),
    },
    axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
  },
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
    .filter(
      (entry) =>
        entry.reviewStatus !== 'confirmed' &&
        entry.reviewStatus !== 'excluded',
    )
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

export function evidenceWorldCoordinate(
  document: EditorDocument,
  evidence: FaceEvidence,
): Point3 | undefined {
  return mappedVector(document.scene.axisMapping, evidence.latticeCoordinate)
}

type FaceTab = 'selection' | 'review'

interface EditorState {
  document: EditorDocument
  step: EditorStep
  faceTab: FaceTab
  tool: EditorTool
  selectedPatchId?: string
  selectedEdges: SelectedEdge[]
  selectedEvidenceIds: string[]
  extrusionBlocks: number
  past: EditorDocument[]
  future: EditorDocument[]
  setStep: (step: EditorStep) => void
  setFaceTab: (tab: FaceTab) => void
  setTool: (tool: EditorTool) => void
  setSelectedPatch: (patchId?: string) => void
  toggleSelectedEdge: (edge: SelectedEdge) => void
  clearSelectedEdges: () => void
  setExtrusionBlocks: (blocks: number) => void
  inspectEvidence: (evidenceId: string) => void
  loadDocument: (document: unknown) => void
  replaceImage: (image: EditorDocument['image']) => void
  addBasePatch: (corners: [Point2, Point2, Point2, Point2]) => void
  updatePatch: (id: string, patch: Partial<Pick<SurfacePatch, 'name' | 'normal'>>) => void
  moveObservation: (id: string, point: Point2) => void
  upsertObservation: (lattice: Point3, point: Point2) => void
  extrudeSelectedEdges: (point: Point2, secondPoint?: Point2) => void
  removePatch: (id: string) => void
  deleteCell: (patchId: string, column: number, row: number) => void
  updateAxisMapping: (axis: AbstractAxis, label: WorldAxisLabel) => void
  selectCell: (patchId: string, column: number, row: number, additive: boolean) => void
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

function basePatchFromCorners(
  corners: [Point2, Point2, Point2, Point2],
): { patch: SurfacePatch; observations: CalibrationObservation[] } {
  const patch: SurfacePatch = {
    id: crypto.randomUUID(),
    name: 'Base surface',
    origin: { x: 0, y: 0, z: 0 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    columns: 4,
    rows: 4,
    inactiveCells: [],
  }
  return { patch, observations: cornerObservations(patch, corners) }
}

export const useEditorStore = create<EditorState>((set) => ({
  document: createInitialDocument(),
  step: 'grid',
  faceTab: 'selection',
  tool: 'select',
  selectedPatchId: 'floor-demo',
  selectedEdges: [],
  selectedEvidenceIds: [],
  extrusionBlocks: 4,
  past: [],
  future: [],
  setStep: (step) => set({ step }),
  setFaceTab: (faceTab) => set({ faceTab }),
  setTool: (tool) =>
    set((state) => ({
      tool: tool === 'extrude' && state.selectedEdges.length === 0 ? 'select' : tool,
    })),
  setSelectedPatch: (selectedPatchId) =>
    set({ selectedPatchId, selectedEdges: [] }),
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
          if (!selected) return false
          return [selected.start, selected.end].some((left) =>
            [geometry.start, geometry.end].some((right) => same3(left, right)),
          )
        })
      return {
        selectedEdges: connected ? [...state.selectedEdges, edge] : [edge],
        selectedPatchId: edge.patchId,
      }
    }),
  clearSelectedEdges: () => set({ selectedEdges: [] }),
  setExtrusionBlocks: (extrusionBlocks) =>
    set({ extrusionBlocks: Math.max(1, Math.min(64, Math.round(extrusionBlocks))) }),
  inspectEvidence: (evidenceId) =>
    set((state) => {
      const evidence = state.document.evidence.find((entry) => entry.id === evidenceId)
      if (!evidence) return state
      return {
        selectedEvidenceIds: [evidenceId],
        selectedPatchId: evidence.patchId,
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
      selectedPatchId: document.scene.patches[0]?.id,
      selectedEdges: [],
    })
  },
  replaceImage: (image) =>
    set((state) => ({
      ...mutateDocument(state, (document) => {
        document.image = image
        document.scene.patches = []
        document.scene.observations = []
        document.evidence = []
      }),
      selectedPatchId: undefined,
      selectedEdges: [],
      selectedEvidenceIds: [],
      step: 'grid',
      faceTab: 'selection',
      tool: 'plane',
    })),
  addBasePatch: (corners) =>
    set((state) => {
      if (state.document.scene.patches.length > 0) return state
      const { patch, observations } = basePatchFromCorners(corners)
      const homography = computeHomography(
        [
          { x: 0, y: 0 },
          { x: patch.columns, y: 0 },
          { x: patch.columns, y: patch.rows },
          { x: 0, y: patch.rows },
        ],
        corners,
      )
      return {
        ...mutateDocument(state, (document) => {
          document.scene = {
            patches: [patch],
            observations,
            projection: { kind: 'planar', patchId: patch.id, homography },
            axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
          }
          document.evidence = []
          document.scanner.compassResolved = false
        }),
        selectedPatchId: patch.id,
        selectedEdges: [],
        tool: 'select' as EditorTool,
      }
    }),
  updatePatch: (id, patch) =>
    set((state) =>
      mutateDocument(state, (document) => {
        const entry = document.scene.patches.find((item) => item.id === id)
        if (entry) Object.assign(entry, patch)
      }),
    ),
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
  extrudeSelectedEdges: (point, secondPoint) =>
    set((state) => {
      if (state.selectedEdges.length === 0) return state
      if (state.document.scene.projection.kind !== 'camera' && !secondPoint) {
        return state
      }
      const extrusionAxis = chooseEdgeExtrusionAxis(
        state.document.scene,
        state.selectedEdges,
        state.extrusionBlocks,
        point,
      )
      const endpoints = selectedEdgeEndpoints(
        state.document.scene,
        state.selectedEdges,
      )
      if (!extrusionAxis || !endpoints) return state
      const patches = createEdgeExtrusionPatches(
        state.document.scene,
        state.selectedEdges,
        extrusionAxis,
        state.extrusionBlocks,
        () => crypto.randomUUID(),
      )
      if (patches.length === 0) return state
      const newAnchor = add3(endpoints[0], scale3(extrusionAxis, state.extrusionBlocks))
      const secondAnchor = add3(
        endpoints[1],
        scale3(extrusionAxis, state.extrusionBlocks),
      )
      const outerEdges = patches
        .filter((_, index) => index % state.extrusionBlocks === state.extrusionBlocks - 1)
        .map((patch) => ({
          patchId: patch.id,
          column: 0,
          row: 0,
          edge: 'bottom' as const,
        }))
      return {
        ...mutateDocument(state, (document) => {
          document.scene.patches.push(...patches)
          const existing = document.scene.observations.find((entry) =>
            same3(entry.lattice, newAnchor),
          )
          if (existing) existing.image = point
          else {
            document.scene.observations.push({
              id: crypto.randomUUID(),
              lattice: newAnchor,
              image: point,
              weight: 1,
            })
          }
          if (secondPoint) {
            const existingSecond = document.scene.observations.find((entry) =>
              same3(entry.lattice, secondAnchor),
            )
            if (existingSecond) existingSecond.image = secondPoint
            else {
              document.scene.observations.push({
                id: crypto.randomUUID(),
                lattice: secondAnchor,
                image: secondPoint,
                weight: 1,
              })
            }
          }
          document.scene.projection = refitProjection(document.scene)
        }),
        selectedPatchId: patches[0].id,
        selectedEdges: outerEdges,
        tool: 'select' as EditorTool,
      }
    }),
  removePatch: (id) =>
    set((state) => ({
      ...mutateDocument(state, (document) => {
        document.scene.patches = document.scene.patches.filter((patch) => patch.id !== id)
        document.evidence = document.evidence.filter((entry) => entry.patchId !== id)
      }),
      selectedPatchId: undefined,
      selectedEdges: [],
      selectedEvidenceIds: [],
    })),
  deleteCell: (patchId, column, row) =>
    set((state) => ({
      ...mutateDocument(state, (document) => {
        const patch = document.scene.patches.find((entry) => entry.id === patchId)
        if (!patch) return
        const key = `${column}:${row}`
        if (!patch.inactiveCells.includes(key)) patch.inactiveCells.push(key)
        const id = evidenceId(patchId, column, row)
        document.evidence = document.evidence.filter((entry) => entry.id !== id)
        if (patch.inactiveCells.length >= patch.columns * patch.rows) {
          document.scene.patches = document.scene.patches.filter(
            (entry) => entry.id !== patchId,
          )
        }
      }),
      selectedPatchId:
        state.selectedPatchId === patchId ? undefined : state.selectedPatchId,
      selectedEdges: [],
    })),
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
  selectCell: (patchId, column, row, additive) =>
    set((state) => {
      const id = evidenceId(patchId, column, row)
      const patch = state.document.scene.patches.find((entry) => entry.id === patchId)
      if (!patch) return state
      const existing = state.document.evidence.find((entry) => entry.id === id)
      let documentPatch: Pick<EditorState, 'document' | 'past' | 'future'> | undefined
      if (!existing) {
        documentPatch = mutateDocument(state, (document) => {
          const face = faceForLocalNormal(document.scene.axisMapping, patch.normal)
          document.evidence.push({
            id,
            patchId,
            column,
            row,
            latticeCoordinate: patchVertex(patch, column, row),
            localNormal: patch.normal,
            blockId: 'stone',
            stateCount: face ? statesForFace('stone', face) ?? 4 : 4,
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
        selectedPatchId: patchId,
        selectedEdges: [],
        selectedEvidenceIds,
        step: 'faces' as EditorStep,
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
          return
        }
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
      selectedPatchId: 'floor-demo',
      selectedEdges: [],
      selectedEvidenceIds: [],
      step: 'grid',
      tool: 'select',
    }),
}))
