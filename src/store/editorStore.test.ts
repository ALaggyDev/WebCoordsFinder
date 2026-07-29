import { beforeEach, describe, expect, it } from 'vitest'
import {
  projectScenePoint,
  projectionInfo,
  selectedEdgeGeometry,
} from '../domain/geometry'
import type { WebSearchCheckpoint } from '../domain/types'
import {
  createEmptyDocument,
  createInitialDocument,
  evidenceWorldCoordinate,
  normalizeEditorDocument,
  useEditorStore,
} from './editorStore'

beforeEach(() => {
  useEditorStore.setState({
    document: createInitialDocument(),
    step: 'grid',
    faceTab: 'selection',
    tool: 'select',
    past: [],
    future: [],
    selectedEdges: [],
    selectedEvidenceIds: [],
  })
})

describe('unit-face geometry', () => {
  it('stores the initial 6x4 base as 24 independent faces', () => {
    const scene = useEditorStore.getState().document.scene
    expect(scene.faces).toHaveLength(24)
    expect(scene.faces.every((face) => !('columns' in face))).toBe(true)
    expect(scene.faces.every((face) => !('uAxis' in face) && !('vAxis' in face))).toBe(
      true,
    )
    expect(scene.faces[0].blockCoordinate).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('uses trapezoid perspective for the initial visible-side normal', () => {
    useEditorStore.setState({ document: createEmptyDocument() })
    useEditorStore.getState().addBaseFaces([
      { x: 40, y: 100 },
      { x: 360, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ])

    const faces = useEditorStore.getState().document.scene.faces
    expect(faces).toHaveLength(16)
    expect(faces.every((entry) => entry.normal.z === -1)).toBe(true)
  })

  it('creates the initial base with the requested grid dimensions', () => {
    useEditorStore.setState({ document: createEmptyDocument() })
    useEditorStore.getState().addBaseFaces(
      [
        { x: 40, y: 100 },
        { x: 360, y: 100 },
        { x: 300, y: 300 },
        { x: 100, y: 300 },
      ],
      7,
      3,
    )

    const scene = useEditorStore.getState().document.scene
    expect(scene.faces).toHaveLength(21)
    expect(scene.faces.at(-1)?.blockCoordinate).toEqual({ x: 6, y: 2, z: 0 })
    expect(scene.observations.map((entry) => entry.lattice)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 7, y: 0, z: 0 },
      { x: 7, y: 3, z: 0 },
      { x: 0, y: 3, z: 0 },
    ])
  })

  it('toggles connected unit edges without entering extrusion mode', () => {
    const [first, second, far] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().toggleSelectedEdge({
      faceId: first.id,
      edge: 'top',
    })
    useEditorStore.getState().toggleSelectedEdge({
      faceId: second.id,
      edge: 'top',
    })
    expect(useEditorStore.getState()).toMatchObject({
      tool: 'select',
      selectedEdges: [{ faceId: first.id }, { faceId: second.id }],
    })

    useEditorStore.getState().toggleSelectedEdge({
      faceId: far.id,
      edge: 'bottom',
    })
    expect(useEditorStore.getState().selectedEdges).toHaveLength(1)
  })

  it('physically removes every selected face in one transaction', () => {
    const [first, second] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
    const historyBeforeDelete = useEditorStore.getState().past.length

    useEditorStore.getState().deleteSelectedFaces()

    const state = useEditorStore.getState()
    expect(state.document.scene.faces).toHaveLength(22)
    expect(state.document.scene.faces.map((face) => face.id)).not.toContain(first.id)
    expect(state.document.scene.faces.map((face) => face.id)).not.toContain(second.id)
    expect(state.document.evidence).toHaveLength(0)
    expect(state.selectedEvidenceIds).toEqual([])
    expect(state.past).toHaveLength(historyBeforeDelete + 1)
  })

  it('flips and aligns every flat-connected face in one transaction', () => {
    const document = structuredClone(useEditorStore.getState().document)
    const planeIds = document.scene.faces.map((face) => face.id)
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
        .every((face) => face.normal.z === -1),
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
      latticeCoordinate: { x: 0, y: 0, z: 0 },
      localNormal: { x: 0, y: 0, z: -1 },
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
    document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
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
  })

  it('uses two rigidly translated anchors to create the six-point camera', () => {
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().toggleSelectedEdge({
      faceId: face.id,
      edge: 'top',
    })
    useEditorStore.getState().extrudeSelectedEdges({ x: 360, y: 360 })

    const scene = useEditorStore.getState().document.scene
    expect(scene.faces).toHaveLength(25)
    expect(scene.observations).toHaveLength(6)
    expect(scene.projection.kind).toBe('camera')
    expect(scene.faces.at(-1)?.normal).toEqual({ x: 0, y: 1, z: 0 })
  })

  it('extends within the plane without creating a camera or new anchors', () => {
    const scene = useEditorStore.getState().document.scene
    const face = scene.faces[0]
    const pointer = projectScenePoint(scene, { x: 0.5, y: -3, z: 0 })!
    useEditorStore.getState().toggleSelectedEdge({
      faceId: face.id,
      edge: 'top',
    })

    useEditorStore.getState().extrudeSelectedEdges(pointer)

    const updated = useEditorStore.getState().document.scene
    expect(updated.faces).toHaveLength(27)
    expect(updated.observations).toHaveLength(4)
    expect(updated.projection.kind).toBe('planar')
    expect(
      updated.faces.slice(-3).every((entry) => entry.normal.z === face.normal.z),
    ).toBe(true)
    const [outerSelection] = useEditorStore.getState().selectedEdges
    const outerEdge = selectedEdgeGeometry(updated, outerSelection)
    expect(outerEdge?.start.y).toBe(-3)
    expect(outerEdge?.end.y).toBe(-3)
  })

  it('adds planar calibration anchors without promoting to a camera', () => {
    const scene = useEditorStore.getState().document.scene
    const latticePoints = [
      { x: 1, y: 1, z: 0 },
      { x: 5, y: 3, z: 0 },
    ]
    latticePoints.forEach((lattice) => {
      useEditorStore
        .getState()
        .upsertObservation(lattice, projectScenePoint(scene, lattice)!)
    })

    const updated = useEditorStore.getState().document.scene
    expect(updated.observations).toHaveLength(6)
    expect(updated.projection.kind).toBe('planar')
    expect(projectionInfo(updated).resolvedAxes).toBe(2)
    expect(projectionInfo(updated).rmsError).toBeLessThan(0.01)
  })

  it('extrudes through an existing camera without recalibrating it', () => {
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().toggleSelectedEdge({
      faceId: face.id,
      edge: 'top',
    })
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
    expect(selected.document.evidence.every((entry) => entry.blockId === 'stone')).toBe(true)
    expect(selected.faceTab).toBe('selection')
    expect(selected.past).toHaveLength(1)

    selected.selectAllFaces()
    expect(useEditorStore.getState().past).toHaveLength(1)
  })

  it('applies profiles and invalidates variants when axis mapping changes', () => {
    const [first, second] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().updateAxisMapping('c', 'y+')
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
    useEditorStore.getState().setBlockForSelection('dirt')
    const selectedId = useEditorStore.getState().selectedEvidenceIds[0]
    useEditorStore.getState().setVariant(selectedId, 2)

    useEditorStore.getState().updateAxisMapping('a', 'x+')

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
  })

  it('rejects a reflected axis mapping without adding history', () => {
    useEditorStore.getState().updateAxisMapping('a', 'x+')
    useEditorStore.getState().updateAxisMapping('c', 'y+')
    const historyBefore = useEditorStore.getState().past.length

    useEditorStore.getState().updateAxisMapping('b', 'z+')

    expect(useEditorStore.getState().document.scene.axisMapping).toEqual({
      a: 'x+',
      b: 'unknown',
      c: 'y+',
    })
    expect(useEditorStore.getState().past).toHaveLength(historyBefore)

    useEditorStore.getState().updateAxisMapping('b', 'z-')
    expect(useEditorStore.getState().document.scene.axisMapping).toEqual({
      a: 'x+',
      b: 'z-',
      c: 'y+',
    })
    expect(useEditorStore.getState().document.scanner.compassResolved).toBe(true)
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

  it('persists search checkpoints without adding history and preserves them through undo', () => {
    const checkpoint: WebSearchCheckpoint = {
      engineVersion: 1,
      requestKey: 'request',
      phase: 'paused',
      processed: '125000',
      total: '1000000',
      matchCount: '17',
      checksPerSecond: 5_000_000,
      results: [{ x: 1, y: 2, z: 3, badBlocks: 0 }],
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
