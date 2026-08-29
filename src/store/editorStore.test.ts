// Store tests assert both document results and transaction semantics: geometry,
// evidence, history, and runtime checkpoints must evolve together correctly.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  axisMappingParity,
  cameraCenter,
  cameraLatticeParity,
  dot3,
  faceCornersLattice,
  mappedVector,
  projectScenePoint,
  scale3,
  sceneLatticeParity,
  subtract3,
  worldAlignedFaceQuad,
} from '../domain/geometry'
import type { SceneGeometry, WebSearchCheckpoint } from '../domain/types'
import {
  createEmptyDocument,
  evidenceWorldCoordinate,
  normalizeEditorDocument,
  useEditorStore,
} from './editorStore'
import { createTestDocument } from '../test/createTestDocument'

function expectNormalsFaceCamera(scene: SceneGeometry): void {
  const center = cameraCenter(scene)
  expect(center).toBeDefined()
  scene.faces.forEach((face) => {
    const faceCenter = scale3(
      faceCornersLattice(face).reduce(
        (sum, corner) => ({
          x: sum.x + corner.x,
          y: sum.y + corner.y,
          z: sum.z + corner.z,
        }),
        { x: 0, y: 0, z: 0 },
      ),
      0.25,
    )
    expect(dot3(face.normal, subtract3(center!, faceCenter))).toBeGreaterThan(0)
  })
}

beforeEach(() => {
  const document = createTestDocument()
  document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
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
    expect(state.document.anchorFaceId).toBe(state.document.scene.faces[0].id)
    expect(state.tool).toBe('select')
    expect(state.past).toHaveLength(1)
    expect(normalizeEditorDocument(state.document).scene.projection?.kind).toBe(
      'planar',
    )
  })

  it('anchors a block directly on a planar solve', () => {
    useEditorStore.setState({ document: createEmptyDocument() })
    useEditorStore.getState().addBaseFaces([
      { x: 40, y: 100 },
      { x: 360, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ])
    const face = useEditorStore.getState().document.scene.faces[0]

    useEditorStore.getState().setTool('anchor')
    useEditorStore.getState().setAnchorFace(face.id)

    expect(useEditorStore.getState().document.anchorFaceId).toBe(face.id)
    expect(useEditorStore.getState().tool).toBe('select')
  })

  it('uses exactly one selected face when starting world orientation', () => {
    useEditorStore.setState({ document: createTestDocument() })
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().selectFace(face.id, false)

    useEditorStore.getState().startUpOrientation()

    expect(useEditorStore.getState().orientationDraft).toMatchObject({
      mode: 'up',
      faceId: face.id,
    })
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
    const planarAnchors = structuredClone(
      useEditorStore.getState().document.scene.observations,
    )
    useEditorStore.getState().extrudeSelectedEdges({ x: 360, y: 360 })

    const state = useEditorStore.getState()
    expect(state.document.scene.projection?.kind).toBe('camera')
    expect(state.document.scene.observations).toHaveLength(6)
    expect(state.document.scene.faces).toHaveLength(25)
    expect(state.document.anchorFaceId).toBe(state.document.scene.faces[0].id)
    expectNormalsFaceCamera(state.document.scene)
    planarAnchors.forEach((anchor) => {
      const projected = projectScenePoint(state.document.scene, anchor.lattice)!
      expect(projected.x).toBeCloseTo(anchor.image.x, 6)
      expect(projected.y).toBeCloseTo(anchor.image.y, 6)
    })
    state.document.scene.observations.slice(-2).forEach((anchor) => {
      const projected = projectScenePoint(state.document.scene, anchor.lattice)!
      expect(projected.x).toBeCloseTo(anchor.image.x, 6)
      expect(projected.y).toBeCloseTo(anchor.image.y, 6)
    })
  })

  it('uses opposite camera parities for opposite first-extrusion gestures', () => {
    const results: Array<{ parity: number; upLabel: string }> = []
    for (const pointer of [
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]) {
      useEditorStore.setState({ document: createEmptyDocument() })
      useEditorStore.getState().addBaseFaces(
        [
          { x: 100, y: 200 },
          { x: 500, y: 200 },
          { x: 550, y: 500 },
          { x: 50, y: 500 },
        ],
        4,
        4,
      )
      const base = useEditorStore.getState().document.scene.faces[0]
      useEditorStore.getState().startUpOrientation()
      useEditorStore.getState().setOrientationFace(base.id)
      useEditorStore.getState().setOrientationSurfaceKind('top')
      const planar = useEditorStore.getState().document.scene
      expect(planar.axisMapping.c).toBe('y+')
      expect(axisMappingParity(planar.axisMapping)).toBe(
        sceneLatticeParity(planar),
      )
      useEditorStore
        .getState()
        .selectEdge({ faceId: base.id, edge: 'top' }, false)
      useEditorStore.getState().extrudeSelectedEdges(pointer)
      const promoted = useEditorStore.getState().document.scene
      expect(promoted.projection?.kind).toBe('camera')
      expectNormalsFaceCamera(promoted)
      const parity = cameraLatticeParity(promoted)
      expect(axisMappingParity(promoted.axisMapping)).toBe(parity)
      results.push({
        parity: parity!,
        upLabel: promoted.axisMapping.c,
      })
    }

    expect(new Set(results.map((result) => result.parity))).toEqual(
      new Set([-1, 1]),
    )
    expect(new Set(results.map((result) => result.upLabel))).toEqual(
      new Set(['y+', 'y-']),
    )
  })

  it('preserves confirmed planar north through the first camera extrusion', () => {
    for (const { pointer, normal } of [
      {
        pointer: { x: 300, y: 100 },
        normal: { x: 0, y: 0, z: 1 },
      },
      {
        pointer: { x: 300, y: 300 },
        normal: { x: 0, y: 0, z: -1 },
      },
    ]) {
      useEditorStore.setState({ document: createEmptyDocument() })
      useEditorStore.getState().addBaseFaces(
        [
          { x: 100, y: 200 },
          { x: 500, y: 200 },
          { x: 550, y: 500 },
          { x: 50, y: 500 },
        ],
        4,
        4,
      )
      const base = useEditorStore.getState().document.scene.faces[0]
      useEditorStore.getState().startUpOrientation()
      useEditorStore.getState().setOrientationFace(base.id)
      useEditorStore.getState().setOrientationSurfaceKind('top')
      useEditorStore.getState().startHorizontalOrientation()
      useEditorStore.getState().setOrientationFace(base.id)
      useEditorStore.getState().setOrientationEdge('right')
      useEditorStore.getState().setOrientationHorizontalDirection('north')

      const intent = structuredClone(
        useEditorStore.getState().document.scene.horizontalOrientationIntent,
      )!
      expect(useEditorStore.getState().document.scanner.compassResolved).toBe(true)

      useEditorStore
        .getState()
        .selectEdge({ faceId: base.id, edge: 'top' }, false)
      useEditorStore.getState().extrudeSelectedEdges(pointer)

      const document = useEditorStore.getState().document
      const promotedBase = document.scene.faces.find((face) => face.id === base.id)
      expect(document.scene.projection?.kind).toBe('camera')
      expect(promotedBase?.normal).toEqual(normal)
      expect(document.scene.horizontalOrientationIntent).toEqual(intent)
      expect(document.scanner.compassResolved).toBe(true)
      expect(document.scanner.directions).toEqual([0])
      expect(mappedVector(document.scene.axisMapping, intent.localDirection)).toEqual({
        x: 0,
        y: 0,
        z: -1,
      })
      expect(axisMappingParity(document.scene.axisMapping)).toBe(
        cameraLatticeParity(document.scene),
      )

      const reloaded = normalizeEditorDocument(document)
      expect(reloaded.scene.axisMapping).toEqual(document.scene.axisMapping)
      expect(reloaded.scanner.compassResolved).toBe(true)
      expect(reloaded.scanner.directions).toEqual([0])
    }
  })

  it('removes an extra calibration anchor and refits the camera in one transaction', () => {
    const state = useEditorStore.getState()
    const extra = {
      id: 'extra-anchor',
      lattice: { x: 3, y: 0, z: 1 },
      image: { x: 550, y: 430 },
      weight: 1,
    }
    state.upsertObservation(extra.lattice, extra.image)
    const historyBeforeDelete = useEditorStore.getState().past.length
    const extraId = useEditorStore
      .getState()
      .document.scene.observations.find(
        (observation) => observation.lattice.x === 3 &&
          observation.lattice.y === 0 &&
          observation.lattice.z === 1,
      )!.id

    useEditorStore.getState().deleteObservation(extraId)

    const updated = useEditorStore.getState()
    expect(updated.document.scene.observations).toHaveLength(6)
    expect(updated.document.scene.observations.map((observation) => observation.id))
      .not.toContain(extraId)
    expect(updated.document.scene.projection?.kind).toBe('camera')
    expect(updated.past).toHaveLength(historyBeforeDelete + 1)
  })

  it('keeps the six calibration anchors required by the camera solve', () => {
    const state = useEditorStore.getState()
    const observation = state.document.scene.observations[0]

    state.deleteObservation(observation.id)

    const updated = useEditorStore.getState()
    expect(updated.document.scene.observations).toHaveLength(6)
    expect(updated.document.scene.projection?.kind).toBe('camera')
    expect(updated.past).toHaveLength(0)
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
    expect(scene.projection).toBeNull()
    expect(scene.axisMapping).toEqual({
      a: 'unknown',
      b: 'unknown',
      c: 'unknown',
    })
  })

  it('demotes a camera to the original plane after deleting its perpendicular faces', () => {
    const state = useEditorStore.getState()
    const depthIds = state.document.scene.faces
      .filter((face) => face.id.startsWith('test-depth-'))
      .map((face) => face.id)

    depthIds.forEach((id) => useEditorStore.getState().deleteFace(id))

    const scene = useEditorStore.getState().document.scene
    expect(scene.projection?.kind).toBe('planar')
    expect(scene.observations).toHaveLength(4)
    expect(scene.axisMapping).toEqual({
      a: 'unknown',
      b: 'unknown',
      c: 'y+',
    })
    expect(useEditorStore.getState().document.scanner.compassResolved).toBe(false)
  })

  it('demotes a camera to the surviving perpendicular plane after deleting its base', () => {
    const state = useEditorStore.getState()
    const baseIds = state.document.scene.faces
      .filter((face) => face.id.startsWith('test-base-'))
      .map((face) => face.id)

    baseIds.forEach((id) => useEditorStore.getState().deleteFace(id))

    const scene = useEditorStore.getState().document.scene
    expect(scene.projection?.kind).toBe('planar')
    expect(scene.observations).toHaveLength(4)
    expect(scene.axisMapping).toEqual({
      a: 'unknown',
      b: 'unknown',
      c: 'y+',
    })
    expect(useEditorStore.getState().document.scanner.compassResolved).toBe(false)
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

  it('determines UP from a top face and installs a stable automatic horizontal frame', () => {
    const document = structuredClone(useEditorStore.getState().document)
    document.scene.axisMapping = { a: 'unknown', b: 'unknown', c: 'unknown' }
    document.scanner.compassResolved = false
    document.scene.faces[0].normal = { x: 0, y: 0, z: 1 }
    useEditorStore.setState({ document })
    const [first, second] = document.scene.faces
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
    const selectedId = useEditorStore.getState().selectedEvidenceIds[0]
    useEditorStore.getState().setVariant(selectedId, 2)
    const historyBeforeOrientation = useEditorStore.getState().past.length

    useEditorStore.getState().startUpOrientation()
    useEditorStore.getState().setOrientationFace(first.id)
    useEditorStore.getState().setOrientationSurfaceKind('top')

    const state = useEditorStore.getState()
    expect(state.document.scene.axisMapping.c).toBe('y+')
    expect(axisMappingParity(state.document.scene.axisMapping)).toBe(
      cameraLatticeParity(state.document.scene),
    )
    expect(state.document.scanner.compassResolved).toBe(false)
    expect(state.document.scanner.directions).toEqual([0, 90, 180, 270])
    expect(
      useEditorStore
        .getState()
        .document.evidence.every(
          (entry) =>
            entry.blockId === 'deepslate' &&
            entry.reviewStatus === 'unlabeled' &&
            entry.selectedVariant === undefined,
        ),
    ).toBe(true)
    expect(useEditorStore.getState().past).toHaveLength(
      historyBeforeOrientation + 1,
    )
    expect(state.orientationDraft).toBeNull()
    expect(state.tool).toBe('select')
  })

  it('preselects a usable horizontal frame while the projection remains planar', () => {
    useEditorStore.setState({ document: createEmptyDocument() })
    useEditorStore.getState().addBaseFaces([
      { x: 40, y: 100 },
      { x: 360, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ])
    const face = useEditorStore.getState().document.scene.faces[0]

    useEditorStore.getState().startUpOrientation()
    useEditorStore.getState().setOrientationFace(face.id)
    useEditorStore.getState().setOrientationSurfaceKind('top')

    const scene = useEditorStore.getState().document.scene
    expect(scene.projection?.kind).toBe('planar')
    expect(scene.axisMapping.c).toBe('y-')
    expect(axisMappingParity(scene.axisMapping)).toBe(sceneLatticeParity(scene))
    expect(worldAlignedFaceQuad(scene, face)).toBeDefined()
    expect(scene.worldUpIntent).toEqual({
      faceId: face.id,
      surfaceKind: 'top',
      edge: null,
    })
    expect(useEditorStore.getState().document.scanner.compassResolved).toBe(false)
    expect(useEditorStore.getState().document.scanner.directions).toEqual([
      0, 90, 180, 270,
    ])

    useEditorStore.getState().startHorizontalOrientation()
    expect(useEditorStore.getState().orientationDraft?.mode).toBe('horizontal')
  })

  it('upgrades a saved planar UP intent to a complete working frame', () => {
    useEditorStore.setState({ document: createEmptyDocument() })
    useEditorStore.getState().addBaseFaces([
      { x: 40, y: 100 },
      { x: 360, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ])
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().startUpOrientation()
    useEditorStore.getState().setOrientationFace(face.id)
    useEditorStore.getState().setOrientationSurfaceKind('top')

    const saved = structuredClone(useEditorStore.getState().document)
    const upLabel = saved.scene.axisMapping.c
    saved.scene.axisMapping = {
      a: 'unknown',
      b: 'unknown',
      c: upLabel,
    }
    const normalized = normalizeEditorDocument(saved)

    expect(axisMappingParity(normalized.scene.axisMapping)).toBe(
      sceneLatticeParity(normalized.scene),
    )
    expect(normalized.scene.axisMapping.c).toBe(upLabel)
    expect(normalized.scanner.compassResolved).toBe(false)
    expect(normalized.scanner.directions).toEqual([0, 90, 180, 270])
  })

  it('determines UP from a side-face arrow', () => {
    const document = structuredClone(useEditorStore.getState().document)
    document.scene.axisMapping = { a: 'unknown', b: 'unknown', c: 'unknown' }
    document.scanner.compassResolved = false
    document.scene.faces[0].normal = { x: 0, y: 0, z: 1 }
    useEditorStore.setState({ document })
    const face = document.scene.faces[0]
    useEditorStore.getState().startUpOrientation()
    useEditorStore.getState().setOrientationFace(face.id)
    useEditorStore.getState().setOrientationSurfaceKind('side')
    useEditorStore.getState().setOrientationEdge('top')

    const mapping = useEditorStore.getState().document.scene.axisMapping
    expect(mapping.b).toBe('y-')
    expect(useEditorStore.getState().orientationDraft).toBeNull()
  })

  it('determines UP from a bottom face by reversing its visible normal', () => {
    const document = structuredClone(useEditorStore.getState().document)
    document.scene.axisMapping = { a: 'unknown', b: 'unknown', c: 'unknown' }
    document.scanner.compassResolved = false
    document.scene.faces[0].normal = { x: 0, y: 0, z: 1 }
    useEditorStore.setState({ document })
    const face = document.scene.faces[0]

    useEditorStore.getState().startUpOrientation()
    useEditorStore.getState().setOrientationFace(face.id)
    useEditorStore.getState().setOrientationSurfaceKind('bottom')

    expect(useEditorStore.getState().document.scene.axisMapping.c).toBe('y-')
    expect(useEditorStore.getState().orientationDraft).toBeNull()
  })

  it('confirms a horizontal arrow without invalidating evidence when the mapping is unchanged', () => {
    const state = useEditorStore.getState()
    const face = state.document.scene.faces[0]
    state.selectFace(face.id, false)
    state.setBlockForSelection('dirt')
    state.setVariant(face.id, 2)
    const historyBefore = useEditorStore.getState().past.length

    useEditorStore.getState().startHorizontalOrientation()
    useEditorStore.getState().setOrientationFace(face.id)
    useEditorStore.getState().setOrientationEdge('right')
    useEditorStore.getState().setOrientationHorizontalDirection('east')

    expect(useEditorStore.getState().document.scene.axisMapping).toEqual({
      a: 'x+',
      b: 'z-',
      c: 'y+',
    })
    expect(useEditorStore.getState().document.scanner.compassResolved).toBe(true)
    expect(useEditorStore.getState().document.scanner.directions).toEqual([0])
    expect(useEditorStore.getState().document.evidence[0]).toMatchObject({
      blockId: 'dirt',
      selectedVariant: 2,
      reviewStatus: 'confirmed',
    })
    expect(useEditorStore.getState().past).toHaveLength(historyBefore + 1)
  })

  it('rejects a vertical arrow during side-face horizontal confirmation', () => {
    const side = useEditorStore
      .getState()
      .document.scene.faces.find((face) => face.normal.y !== 0)!
    useEditorStore.getState().startHorizontalOrientation()
    useEditorStore.getState().setOrientationFace(side.id)
    useEditorStore.getState().setOrientationEdge('top')

    expect(useEditorStore.getState().orientationDraft?.edge).toBeNull()
  })

  it('rejects unsigned legacy axis labels', () => {
    const legacy = structuredClone(createTestDocument()) as unknown as {
      scene: { axisMapping: Record<string, string> }
    }
    legacy.scene.axisMapping.a = 'x'

    expect(() => normalizeEditorDocument(legacy)).toThrow(
      'This project uses an unsupported document schema.',
    )
  })

  it('preserves an automatic complete mapping without marking compass confirmed', () => {
    const document = createTestDocument()
    document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
    document.scanner.compassResolved = false

    expect(normalizeEditorDocument(document).scanner.compassResolved).toBe(false)
  })

  it('downgrades a persisted mapping that conflicts with camera parity', () => {
    const document = createTestDocument()
    const face = document.scene.faces[0]
    document.scene.axisMapping = { a: 'x+', b: 'z+', c: 'y+' }
    document.scanner.compassResolved = true
    document.evidence = [{
      id: face.id,
      faceId: face.id,
      latticeCoordinate: { x: 0, y: 0, z: 0 },
      localNormal: face.normal,
      blockId: 'deepslate',
      stateCount: 4,
      selectedVariant: 2,
      reviewStatus: 'confirmed',
      blockSettings: {},
    }]

    const normalized = normalizeEditorDocument(document)

    expect(normalized.scene.axisMapping).toEqual({
      a: 'unknown',
      b: 'unknown',
      c: 'y+',
    })
    expect(normalized.scanner.compassResolved).toBe(false)
    expect(normalized.scanner.directions).toEqual([0, 90, 180, 270])
    expect(normalized.evidence[0]).toMatchObject({
      reviewStatus: 'unlabeled',
      selectedVariant: undefined,
    })
  })

  it('rejects malformed planar projections without their lattice basis', () => {
    const legacy = structuredClone(createTestDocument()) as unknown as {
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
    const document = createTestDocument()
    document.scanner.directions = [180]

    expect(normalizeEditorDocument(document).scanner.directions).toEqual([180])

    document.scanner.directions = []
    expect(normalizeEditorDocument(document).scanner.directions).toEqual([])
  })

  it('defaults newly added CoordsFinder settings without reading superseded ones', () => {
    const legacy = structuredClone(createTestDocument()) as unknown as {
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

    const normalized = normalizeEditorDocument(legacy)
    expect(normalized.scanner).toMatchObject({
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

describe('block-specific evidence settings', () => {
  it('inherits the source edge block profile and settings when extruding', () => {
    const source = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().selectFace(source.id, false)
    useEditorStore.getState().setBlockForSelection('grass_block')
    useEditorStore.getState().updateBlockSettingsForSelection({
      grassTint: { temperature: 0.65, downfall: 0.9 },
    })
    const existingFaceIds = new Set(
      useEditorStore.getState().document.scene.faces.map((face) => face.id),
    )

    useEditorStore
      .getState()
      .selectEdge({ faceId: source.id, edge: 'top' }, false)
    useEditorStore.getState().extrudeSelectedEdges({ x: 360, y: 360 })

    const extrudedEvidence = useEditorStore
      .getState()
      .document.evidence.filter((entry) => !existingFaceIds.has(entry.faceId))
    expect(extrudedEvidence).not.toHaveLength(0)
    expect(extrudedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockId: 'grass_block',
          blockSettings: {
            grassTint: { temperature: 0.65, downfall: 0.9 },
          },
          reviewStatus: 'unlabeled',
        }),
      ]),
    )
    expect(extrudedEvidence.every((entry) => entry.blockId === 'grass_block')).toBe(true)
    expect(extrudedEvidence.every((entry) => entry.selectedVariant === undefined)).toBe(true)
  })

  it('applies grass tint settings to every selected grass block', () => {
    const [first, second] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
    useEditorStore.getState().setBlockForSelection('grass_block')

    useEditorStore.getState().updateBlockSettingsForSelection({
      grassTint: { temperature: 0.65, downfall: 0.9 },
    })

    expect(useEditorStore.getState().document.evidence).toHaveLength(2)
    expect(useEditorStore.getState().document.evidence.every((entry) =>
      entry.blockSettings?.grassTint?.temperature === 0.65 &&
      entry.blockSettings.grassTint.downfall === 0.9,
    )).toBe(true)
  })

  it('applies grass tint settings to lily pads', () => {
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().selectFace(face.id, false)
    useEditorStore.getState().setBlockForSelection('lily_pad')

    useEditorStore.getState().updateBlockSettingsForSelection({
      grassTint: { temperature: 0.35, downfall: 0.7 },
    })

    expect(useEditorStore.getState().document.evidence[0].blockSettings).toEqual({
      grassTint: { temperature: 0.35, downfall: 0.7 },
    })
  })
})
