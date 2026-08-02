// Store tests assert both document results and transaction semantics: geometry,
// evidence, history, and runtime checkpoints must evolve together correctly.
import { beforeEach, describe, expect, it } from 'vitest'
import { projectScenePoint } from '../domain/geometry'
import type { WebSearchCheckpoint } from '../domain/types'
import {
  createEmptyDocument,
  createInitialDocument,
  evidenceWorldCoordinate,
  normalizeEditorDocument,
  useEditorStore,
} from './editorStore'

beforeEach(() => {
  const document = createInitialDocument()
  document.scene.axisMapping = { a: 'x+', b: 'z+', c: 'y+' }
  document.scanner.compassResolved = true
  useEditorStore.setState({
    document,
    step: 'grid',
    faceTab: 'selection',
    tool: 'select',
    orientationDraft: null,
    past: [],
    future: [],
    selectedEdges: [],
    selectedEvidenceIds: [],
  })
})

describe('unit-face geometry', () => {
  // Base construction and mesh selection establish the canonical unit-face
  // representation used by every later action.
  it('stores a 6x4 base and its perpendicular depth reference as unit faces', () => {
    const scene = useEditorStore.getState().document.scene
    expect(scene.faces).toHaveLength(36)
    expect(scene.faces.every((face) => !('columns' in face))).toBe(true)
    expect(scene.faces.every((face) => !('uAxis' in face) && !('vAxis' in face))).toBe(
      true,
    )
    expect(scene.faces[0].blockCoordinate).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('commits the base as a persistent partial homography', () => {
    useEditorStore.setState({ document: createEmptyDocument() })
    useEditorStore.getState().addBaseFaces(
      [
        { x: 0, y: 644 },
        { x: 1058, y: 574 },
        { x: 1450, y: 1000 },
        { x: 0, y: 1102 },
      ],
      6,
      4,
    )

    const state = useEditorStore.getState()
    expect(state.document.scene.projection?.kind).toBe('planar')
    expect(state.document.scene.observations).toHaveLength(4)
    expect(state.document.scene.faces).toHaveLength(24)
    expect(state.document.anchorFaceId).toBeNull()
    expect(state.tool).toBe('select')
    expect(state.past).toHaveLength(1)
    expect(normalizeEditorDocument(state.document).scene.projection?.kind).toBe(
      'planar',
    )
  })

  it('promotes the partial solve through the original outward extrusion gesture', () => {
    useEditorStore.setState({ document: createEmptyDocument() })
    useEditorStore.getState().addBaseFaces(
      [
        { x: 0, y: 644 },
        { x: 1058, y: 574 },
        { x: 1450, y: 1000 },
        { x: 0, y: 1102 },
      ],
      6,
      4,
    )
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore
      .getState()
      .selectEdge({ faceId: face.id, edge: 'top' }, false)
    useEditorStore.getState().extrudeSelectedEdges({ x: 360, y: 360 })

    const state = useEditorStore.getState()
    expect(state.document.scene.projection?.kind).toBe('camera')
    expect(state.document.scene.observations).toHaveLength(6)
    expect(state.document.scene.faces).toHaveLength(25)
    expect(state.document.anchorFaceId).toBe(state.document.scene.faces[0].id)
  })

  it('keeps in-plane extrusion inside the partial solve', () => {
    useEditorStore.setState({ document: createEmptyDocument() })
    useEditorStore.getState().addBaseFaces(
      [
        { x: 0, y: 644 },
        { x: 1058, y: 574 },
        { x: 1450, y: 1000 },
        { x: 0, y: 1102 },
      ],
      6,
      4,
    )
    const scene = useEditorStore.getState().document.scene
    const face = scene.faces[0]
    const pointer = projectScenePoint(scene, { x: 0.5, y: -3, z: 0 })!
    useEditorStore
      .getState()
      .selectEdge({ faceId: face.id, edge: 'top' }, false)
    useEditorStore.getState().extrudeSelectedEdges(pointer)

    const updated = useEditorStore.getState().document.scene
    expect(updated.projection?.kind).toBe('planar')
    expect(updated.observations).toHaveLength(4)
    expect(updated.faces).toHaveLength(27)
  })

  it('selects one edge by default and toggles connected edges additively', () => {
    const [first, second, far] = useEditorStore.getState().document.scene.faces
    useEditorStore
      .getState()
      .selectEdge({ faceId: first.id, edge: 'top' }, false)
    useEditorStore
      .getState()
      .selectEdge({ faceId: second.id, edge: 'top' }, false)
    expect(useEditorStore.getState().selectedEdges).toEqual([
      { faceId: second.id, edge: 'top' },
    ])

    useEditorStore
      .getState()
      .selectEdge({ faceId: first.id, edge: 'top' }, true)
    expect(useEditorStore.getState()).toMatchObject({
      tool: 'select',
      selectedEdges: [{ faceId: second.id }, { faceId: first.id }],
    })

    useEditorStore
      .getState()
      .selectEdge({ faceId: first.id, edge: 'top' }, true)
    expect(useEditorStore.getState().selectedEdges).toEqual([
      { faceId: second.id, edge: 'top' },
    ])

    useEditorStore
      .getState()
      .selectEdge({ faceId: far.id, edge: 'bottom' }, true)
    expect(useEditorStore.getState().selectedEdges).toHaveLength(1)
  })

  it('physically removes every selected face in one transaction', () => {
    const [first, second] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
    const historyBeforeDelete = useEditorStore.getState().past.length

    useEditorStore.getState().deleteSelectedFaces()

    const state = useEditorStore.getState()
    expect(state.document.scene.faces).toHaveLength(34)
    expect(state.document.scene.faces.map((face) => face.id)).not.toContain(first.id)
    expect(state.document.scene.faces.map((face) => face.id)).not.toContain(second.id)
    expect(state.document.evidence).toHaveLength(0)
    expect(state.selectedEvidenceIds).toEqual([])
    expect(state.past).toHaveLength(historyBeforeDelete + 1)
  })

  it('flips and aligns every flat-connected face in one transaction', () => {
    const document = structuredClone(useEditorStore.getState().document)
    const expectedZ = -document.scene.faces[0].normal.z
    const planeIds = document.scene.faces
      .filter((face) => face.normal.z !== 0)
      .map((face) => face.id)
    document.scene.faces[1].normal = { x: 0, y: 0, z: -1 }
    document.scene.faces.push(
      {
        id: 'disconnected',
        blockCoordinate: { x: 20, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
      },
      {
        id: 'perpendicular',
        blockCoordinate: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
      },
    )
    useEditorStore.setState({ document })
    const selectedId = planeIds[0]
    useEditorStore.getState().selectFace(selectedId, false)
    useEditorStore.getState().setVariant(selectedId, 2)
    const historyBeforeFlip = useEditorStore.getState().past.length

    useEditorStore.getState().flipSelectedFaces()

    const state = useEditorStore.getState()
    expect(
      state.document.scene.faces
        .filter((face) => planeIds.includes(face.id))
        .every((face) => face.normal.z === expectedZ),
    ).toBe(true)
    expect(
      state.document.scene.faces.find((face) => face.id === 'disconnected')
        ?.normal,
    ).toEqual({ x: 0, y: 0, z: 1 })
    expect(
      state.document.scene.faces.find((face) => face.id === 'perpendicular')
        ?.normal,
    ).toEqual({ x: 0, y: 1, z: 0 })
    expect(state.document.evidence[0]).toMatchObject({
      latticeCoordinate: { x: 0, y: 0, z: expectedZ > 0 ? -1 : 0 },
      localNormal: { x: 0, y: 0, z: expectedZ },
      reviewStatus: 'unlabeled',
      selectedVariant: undefined,
    })
    expect(state.past).toHaveLength(historyBeforeFlip + 1)
  })

  it('uses one owning-block coordinate for perpendicular faces of the same block', () => {
    const document = structuredClone(useEditorStore.getState().document)
    document.scene.faces = [
      {
        id: 'side',
        blockCoordinate: { x: 1, y: 0, z: 0 },
        normal: { x: 1, y: 0, z: 0 },
      },
      {
        id: 'top',
        blockCoordinate: { x: 0, y: 0, z: 1 },
        normal: { x: 0, y: 0, z: 1 },
      },
    ]
    document.scene.axisMapping = { a: 'x+', b: 'z+', c: 'y+' }
    useEditorStore.setState({ document })

    useEditorStore.getState().selectFace('side', false)
    useEditorStore.getState().selectFace('top', true)
    useEditorStore.getState().setAnchorFace('side')

    const updated = useEditorStore.getState().document
    expect(updated.evidence.map((entry) => entry.latticeCoordinate)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ])
    expect(
      updated.evidence.map((entry) => evidenceWorldCoordinate(updated, entry)),
    ).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ])
  })

  it('removes all calibration anchors after the final face is deleted', () => {
    const ids = useEditorStore
      .getState()
      .document.scene.faces.map((face) => face.id)
    ids.forEach((id) => useEditorStore.getState().deleteFace(id))

    const scene = useEditorStore.getState().document.scene
    expect(scene.faces).toHaveLength(0)
    expect(scene.observations).toHaveLength(0)
    expect(scene.projection).toBeNull()
    expect(scene.axisMapping).toEqual({
      a: 'unknown',
      b: 'unknown',
      c: 'unknown',
    })
  })

  it('extrudes through an existing camera without recalibrating it', () => {
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore
      .getState()
      .selectEdge({ faceId: face.id, edge: 'top' }, false)
    useEditorStore.getState().extrudeSelectedEdges({ x: 360, y: 360 })
    const calibrated = useEditorStore.getState().document.scene
    const projection = structuredClone(calibrated.projection)
    const observations = structuredClone(calibrated.observations)

    useEditorStore.getState().extrudeSelectedEdges({ x: 500, y: 260 })

    expect(useEditorStore.getState().document.scene.projection).toEqual(projection)
    expect(useEditorStore.getState().document.scene.observations).toEqual(observations)
  })

  it('keeps the workflow step when a face is selected', () => {
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.setState({ step: 'grid' })
    useEditorStore.getState().selectFace(face.id, false)
    expect(useEditorStore.getState().step).toBe('grid')
  })

  // Evidence actions deliberately create or invalidate derived state as
  // selection, world orientation, and block profiles change.
  it('sets a clicked face as the anchor without creating evidence', () => {
    const face = useEditorStore.getState().document.scene.faces[5]
    useEditorStore.getState().setTool('anchor')

    useEditorStore.getState().setAnchorFace(face.id)

    const anchored = useEditorStore.getState()
    expect(anchored.document.anchorFaceId).toBe(face.id)
    expect(anchored.document.evidence).toEqual([])
    expect(anchored.tool).toBe('select')
    expect(anchored.past).toHaveLength(1)

    anchored.deleteFace(face.id)
    expect(useEditorStore.getState().document.anchorFaceId).toBeNull()
  })

  it('selects every face and initializes missing evidence in one transaction', () => {
    const state = useEditorStore.getState()
    const faceIds = state.document.scene.faces.map((face) => face.id)

    state.selectAllFaces()

    const selected = useEditorStore.getState()
    expect(selected.selectedEvidenceIds).toEqual(faceIds)
    expect(selected.document.evidence.map((entry) => entry.id)).toEqual(faceIds)
    expect(selected.document.evidence.every((entry) => entry.blockId === 'deepslate')).toBe(true)
    expect(selected.faceTab).toBe('selection')
    expect(selected.past).toHaveLength(1)

    selected.selectAllFaces()
    expect(useEditorStore.getState().past).toHaveLength(1)
  })

  it('derives orientation from a face and edge and invalidates variants once', () => {
    const document = structuredClone(useEditorStore.getState().document)
    document.scene.faces[0].normal = { x: 0, y: 0, z: 1 }
    useEditorStore.setState({ document })
    const [first, second] = document.scene.faces
    useEditorStore.getState().setAnchorFace(first.id)
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
    useEditorStore.getState().setBlockForSelection('dirt')
    const selectedId = useEditorStore.getState().selectedEvidenceIds[0]
    useEditorStore.getState().setVariant(selectedId, 2)
    const historyBeforeOrientation = useEditorStore.getState().past.length

    useEditorStore.getState().startOrientation()
    useEditorStore.getState().setOrientationFace(first.id)
    useEditorStore.getState().setOrientationFaceDirection('up')
    useEditorStore.getState().setOrientationEdge('top')
    useEditorStore.getState().setOrientationEdgeDirection('west')
    useEditorStore.getState().confirmOrientation()

    expect(useEditorStore.getState().document.scene.axisMapping).toEqual({
      a: 'x-',
      b: 'z-',
      c: 'y+',
    })
    expect(
      useEditorStore
        .getState()
        .document.evidence.every(
          (entry) =>
            entry.blockId === 'dirt' &&
            entry.reviewStatus === 'unlabeled' &&
            entry.selectedVariant === undefined,
        ),
    ).toBe(true)
    expect(useEditorStore.getState().past).toHaveLength(
      historyBeforeOrientation + 1,
    )
    expect(useEditorStore.getState().orientationDraft).toBeNull()
    expect(useEditorStore.getState().tool).toBe('select')
  })

  it('rejects an edge direction parallel to the reference face normal', () => {
    const document = structuredClone(useEditorStore.getState().document)
    document.scene.faces[0].normal = { x: 0, y: 0, z: 1 }
    useEditorStore.setState({ document })
    const face = document.scene.faces[0]
    useEditorStore.getState().setAnchorFace(face.id)
    useEditorStore.getState().startOrientation()
    useEditorStore.getState().setOrientationFace(face.id)
    useEditorStore.getState().setOrientationFaceDirection('up')
    useEditorStore.getState().setOrientationEdge('top')
    useEditorStore.getState().setOrientationEdgeDirection('down')
    const historyBefore = useEditorStore.getState().past.length

    useEditorStore.getState().confirmOrientation()

    expect(useEditorStore.getState().document.scene.axisMapping).toEqual({
      a: 'x+',
      b: 'z+',
      c: 'y+',
    })
    expect(useEditorStore.getState().past).toHaveLength(historyBefore)
    expect(useEditorStore.getState().orientationDraft).not.toBeNull()
  })

  it('rejects unsigned legacy axis labels', () => {
    const legacy = structuredClone(createInitialDocument()) as unknown as {
      scene: { axisMapping: Record<string, string> }
    }
    legacy.scene.axisMapping.a = 'x'

    expect(() => normalizeEditorDocument(legacy)).toThrow(
      'This project uses an unsupported document schema.',
    )
  })

  it('rejects malformed planar projections without their lattice basis', () => {
    const legacy = structuredClone(createInitialDocument()) as unknown as {
      scene: { projection: unknown }
    }
    legacy.scene.projection = {
      kind: 'planar',
      homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    }

    expect(() => normalizeEditorDocument(legacy)).toThrow(
      'This project uses an unsupported document schema.',
    )
  })

  it('accepts projects without the 0° X/Z rotation', () => {
    const document = createInitialDocument()
    document.scanner.directions = [180]

    expect(normalizeEditorDocument(document).scanner.directions).toEqual([180])

    document.scanner.directions = []
    expect(normalizeEditorDocument(document).scanner.directions).toEqual([])
  })

  it('defaults newly added CoordsFinder settings without reading superseded ones', () => {
    const legacy = structuredClone(createInitialDocument()) as unknown as {
      scanner: Record<string, unknown>
    }
    delete legacy.scanner.scanOrder
    delete legacy.scanner.cpuTileSize
    delete legacy.scanner.cudaTileSize
    delete legacy.scanner.errorTolerance
    delete legacy.scanner.verbose
    legacy.scanner.chunkBlocksX = 7
    legacy.scanner.chunkBlocksZ = 9
    legacy.scanner.maxBadBlocks = 3
    legacy.scanner.printChunks = true

    expect(normalizeEditorDocument(legacy).scanner).toMatchObject({
      scanOrder: 'spiral',
      cpuTileSize: { x: 1024, z: 1024 },
      cudaTileSize: { x: 16384, z: 16384 },
      errorTolerance: 0,
      verbose: false,
    })
  })

  it('undoes and redoes a committed calibration drag in one step', () => {
    const observation = useEditorStore.getState().document.scene.observations[0]
    const moved = {
      x: observation.image.x + 75,
      y: observation.image.y - 40,
    }
    useEditorStore.getState().moveObservation(observation.id, moved)
    expect(useEditorStore.getState().past).toHaveLength(1)

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().document.scene.observations[0].image).toEqual(
      observation.image,
    )
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().document.scene.observations[0].image).toEqual(
      moved,
    )
  })

  // Search progress belongs to the project but remains outside edit history.
  it('persists search checkpoints without adding history and preserves them through undo', () => {
    const checkpoint: WebSearchCheckpoint = {
      engineVersion: 2,
      requestKey: 'request',
      phase: 'paused',
      processed: '125000',
      total: '1000000',
      matchCount: '17',
      checksPerSecond: 5_000_000,
      results: [{ x: 1, y: 2, z: 3, badBlocks: 0, direction: 270 }],
      updatedAt: 1234,
    }
    useEditorStore.getState().setWebSearchCheckpoint(checkpoint)
    expect(useEditorStore.getState().past).toHaveLength(0)

    const observation = useEditorStore.getState().document.scene.observations[0]
    useEditorStore.getState().moveObservation(observation.id, {
      x: observation.image.x + 10,
      y: observation.image.y + 10,
    })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().document.scanner.webSearch).toEqual(
      checkpoint,
    )
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().document.scanner.webSearch).toEqual(
      checkpoint,
    )
  })
})
