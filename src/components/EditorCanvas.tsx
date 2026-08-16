import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Check, Layers3 } from 'lucide-react'
import type Konva from 'konva'
import {
  Arrow,
  Circle,
  Group,
  Image,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from 'react-konva'
import {
  abstractAxisVector,
  add3,
  automaticAxisMappingForUp,
  cameraFacingNormal,
  chooseEdgeExtrusion,
  createEdgeExtrusionFaces,
  distance,
  dot3,
  faceCornersLattice,
  faceEdgeGeometry,
  faceNormalIndicator,
  faceQuad,
  fitHomography,
  flattenPoints,
  initialCameraForPlanarExtrusion,
  localUpForWorldUpIntent,
  localVectorForWorld,
  meshEdgeKey,
  orientationEdgeGeometry,
  projectionInfo,
  projectPoint,
  projectScenePoint,
  refitProjection,
  scale3,
  selectedEdgeGeometry,
  same3,
} from '../domain/geometry'
import type {
  AbstractAxis,
  FaceEdge,
  FaceDirection,
  MeshFace,
  OrientationSurfaceKind,
  Point2,
  SceneGeometry,
  SelectedEdge,
} from '../domain/types'
import { useCanvasImage } from '../hooks/useCanvasImage'
import { useEditorStore } from '../store/editorStore'

/*
 * Konva renders image-space geometry while the domain layer remains in the
 * A/B/C lattice. Drafts, hover previews, and active drags stay transient here;
 * completed gestures commit once through the editor store.
 */
const GRID = '#98a3aa'
const SELECTED = '#70a7ff'
const PROPOSED = '#f0b64d'
const ANCHOR = '#ff626b'
const CONFIRMED = '#53e6a5'
const EDGE = '#d6e0e5'
const HOVERED = '#d8c66b'

interface CanvasSize {
  width: number
  height: number
}

interface VisualizationSettings {
  axisGizmo: boolean
  faceNormals: boolean
  anchorMarker: boolean
  calibrationPoints: boolean
  calibrationResiduals: boolean
}

interface DraggedObservation {
  id?: string
  lattice: { x: number; y: number; z: number }
  point: Point2
}

interface RenderedMeshEdge {
  key: string
  selection: SelectedEdge
}

interface BoxSelectionDrag {
  start: Point2
  current: Point2
  additive: boolean
}

interface DraftGridSize {
  columns: number
  rows: number
}

interface DraftControlDrag {
  pointerId: number
  startPointer: Point2
  startOffset: Point2
}

function crossProduct(origin: Point2, first: Point2, second: Point2) {
  return (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
}

function pointOnSegment(point: Point2, start: Point2, end: Point2) {
  return Math.abs(crossProduct(start, end, point)) < 1e-9 &&
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
}

function segmentsIntersect(
  firstStart: Point2,
  firstEnd: Point2,
  secondStart: Point2,
  secondEnd: Point2,
) {
  const firstStartSide = crossProduct(firstStart, firstEnd, secondStart)
  const firstEndSide = crossProduct(firstStart, firstEnd, secondEnd)
  const secondStartSide = crossProduct(secondStart, secondEnd, firstStart)
  const secondEndSide = crossProduct(secondStart, secondEnd, firstEnd)
  return (
    (firstStartSide === 0 && pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (firstEndSide === 0 && pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (secondStartSide === 0 && pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (secondEndSide === 0 && pointOnSegment(firstEnd, secondStart, secondEnd)) ||
    ((firstStartSide > 0) !== (firstEndSide > 0) &&
      (secondStartSide > 0) !== (secondEndSide > 0))
  )
}

function pointInConvexQuad(point: Point2, quad: Point2[]) {
  const sides = quad.map((corner, index) =>
    crossProduct(corner, quad[(index + 1) % quad.length], point),
  )
  return sides.every((side) => side >= 0) || sides.every((side) => side <= 0)
}

function quadTouchesBox(
  quad: Point2[],
  left: number,
  right: number,
  top: number,
  bottom: number,
) {
  const box = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
  if (quad.some((point) =>
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom,
  )) return true
  if (box.some((point) => pointInConvexQuad(point, quad))) return true
  return quad.some((corner, index) =>
    box.some((boxCorner, boxIndex) =>
      segmentsIntersect(
        corner,
        quad[(index + 1) % quad.length],
        boxCorner,
        box[(boxIndex + 1) % box.length],
      ),
    ),
  )
}

const DEFAULT_GRID_SIZE = 4
const MIN_GRID_SIZE = 1
const MAX_GRID_SIZE = 128
const DRAFT_CONTROL_HALF_WIDTH = 132
const DRAFT_CONTROL_HALF_HEIGHT = 66
const ORIENTATION_POPUP_HALF_WIDTH = 136
const ORIENTATION_POPUP_MIN_TOP = 12
const ORIENTATION_POPUP_BOTTOM_MARGIN = 150

const visualizationOptions: Array<{
  key: keyof VisualizationSettings
  label: string
  description: string
}> = [
  {
    key: 'axisGizmo',
    label: 'Anchor axes',
    description: 'Show the three solved lattice directions at the anchor block.',
  },
  {
    key: 'anchorMarker',
    label: 'Anchor block',
    description: 'Show the anchor reticle.',
  },
  {
    key: 'calibrationPoints',
    label: 'Calibration anchors',
    description: 'Show image points used to fit the global perspective.',
  },
  {
    key: 'calibrationResiduals',
    label: 'Calibration residuals',
    description: 'Show the error between each anchor and its predicted position.',
  },
  {
    key: 'faceNormals',
    label: 'Face normals',
    description: 'Show visible-side normals from the solved 3D camera.',
  },
]

const faceEdges: FaceEdge[] = ['top', 'right', 'bottom', 'left']
const horizontalDirections: Array<{ direction: FaceDirection; label: string }> = [
  { direction: 'north', label: 'North −Z' },
  { direction: 'east', label: 'East +X' },
  { direction: 'south', label: 'South +Z' },
  { direction: 'west', label: 'West −X' },
]

function statusColor(status?: string): string {
  if (status === 'confirmed') return CONFIRMED
  if (status === 'proposed') return PROPOSED
  return GRID
}

function faceCenterLattice(face: MeshFace) {
  return faceCornersLattice(face).reduce(
    (sum, point) => add3(sum, { x: point.x / 4, y: point.y / 4, z: point.z / 4 }),
    { x: 0, y: 0, z: 0 },
  )
}

function makeExtrusionPreview(
  scene: SceneGeometry,
  selections: SelectedEdge[],
  pointer: Point2,
): { scene: SceneGeometry; blocks: number; createsAxis: boolean } | undefined {
  const extrusion = chooseEdgeExtrusion(scene, selections, pointer)
  if (!extrusion) return undefined
  const planarCamera = extrusion.createsAxis
    ? initialCameraForPlanarExtrusion(
        scene,
        selections,
        extrusion.axis,
        extrusion.blocks,
        pointer,
      )
    : undefined
  if (extrusion.createsAxis && !planarCamera) return undefined
  const extrusionScene = planarCamera
    ? { ...scene, projection: planarCamera.projection }
    : scene
  let previewId = 0
  const faces = createEdgeExtrusionFaces(
    extrusionScene,
    selections,
    extrusion.axis,
    extrusion.blocks,
    () => `__preview_${previewId++}__`,
  )
  const previewScene: SceneGeometry = {
    ...extrusionScene,
    faces: [
      ...scene.faces.map((face) => ({
        ...face,
        normal: planarCamera
          ? cameraFacingNormal(extrusionScene, face)
          : face.normal,
      })),
      ...faces,
    ],
    observations: [...scene.observations],
  }
  if (planarCamera) {
    const anchors = planarCamera.endpoints.map((endpoint, index) => ({
      id: `__preview_anchor_${index}__`,
      lattice: endpoint,
      image: planarCamera.images[index],
      weight: 1,
    }))
    previewScene.observations = [
      ...previewScene.observations.filter(
        (observation) =>
          !anchors.some((anchor) => same3(observation.lattice, anchor.lattice)),
      ),
      ...anchors,
    ]
    previewScene.projection = planarCamera.projection
    const localUp = localUpForWorldUpIntent(previewScene)
    const referenceFace = previewScene.worldUpIntent
      ? previewScene.faces.find(
          (face) => face.id === previewScene.worldUpIntent?.faceId,
        )
      : undefined
    if (localUp && referenceFace) {
      previewScene.axisMapping =
        automaticAxisMappingForUp(previewScene, referenceFace, localUp) ??
        previewScene.axisMapping
    }
  }
  return {
    scene: previewScene,
    blocks: extrusion.blocks,
    createsAxis: extrusion.createsAxis,
  }
}

function GlobalAxisGizmo({
  scene,
  face,
  scale,
}: {
  scene: SceneGeometry
  face: MeshFace
  scale: number
}) {
  const latticeOrigin = faceCenterLattice(face)
  const origin = projectScenePoint(scene, latticeOrigin)
  if (!origin) return null
  const axes = (['a', 'b', 'c'] as AbstractAxis[]).flatMap((axis) => {
    const mappedAxis = scene.axisMapping[axis]
    const known = mappedAxis !== 'unknown'
    const worldAxis = known ? mappedAxis[0] : undefined
    const local = scale3(
      abstractAxisVector(axis),
      known && mappedAxis[1] === '-' ? -1 : 1,
    )
    const endpoint = projectScenePoint(
      scene,
      add3(latticeOrigin, scale3(local, 0.25)),
    )
    if (!endpoint) return []
    const delta = { x: endpoint.x - origin.x, y: endpoint.y - origin.y }
    const projectedLength = Math.hypot(delta.x, delta.y)
    if (projectedLength < 1e-8) return []
    return [{
      label: known ? `+${worldAxis!.toUpperCase()}` : axis.toUpperCase(),
      color:
        worldAxis === 'x'
          ? '#ff626b'
          : worldAxis === 'y'
            ? '#53e6a5'
            : worldAxis === 'z'
              ? '#70a7ff'
              : '#a8b3b9',
      end: endpoint,
      direction: {
        x: delta.x / projectedLength,
        y: delta.y / projectedLength,
      },
    }]
  })
  return (
    <Group listening={false}>
      <Circle
        x={origin.x}
        y={origin.y}
        radius={4 / scale}
        fill="#071014"
        stroke="#dce7ec"
        strokeWidth={1 / scale}
      />
      {axes.map(({ label, color, end, direction }) => {
        return (
          <Group key={label}>
            <Arrow
              points={[origin.x, origin.y, end.x, end.y]}
              stroke="#061014"
              fill="#061014"
              strokeWidth={4 / scale}
              pointerLength={6 / scale}
              pointerWidth={6 / scale}
            />
            <Arrow
              points={[origin.x, origin.y, end.x, end.y]}
              stroke={color}
              fill={color}
              strokeWidth={2 / scale}
              pointerLength={5 / scale}
              pointerWidth={5 / scale}
            />
            <Text
              x={end.x + direction.x * (7 / scale) - 7 / scale}
              y={end.y + direction.y * (7 / scale) - 5 / scale}
              text={label}
              fontFamily="Inter, Segoe UI, sans-serif"
              fontStyle="bold"
              fontSize={9 / scale}
              fill={color}
              stroke="#061014"
              strokeWidth={2.5 / scale}
              fillAfterStrokeEnabled
            />
          </Group>
        )
      })}
    </Group>
  )
}

function AnchorGizmo({
  scene,
  face,
  scale,
}: {
  scene: SceneGeometry
  face: MeshFace
  scale: number
}) {
  const origin = projectScenePoint(scene, faceCenterLattice(face))
  if (!origin) return null
  // Below 100% zoom the marker shrinks with the scene; above 100% it stops
  // growing so it does not obscure the selected face.
  const reticleScale = Math.min(1, 1 / scale)
  return (
    <Group listening={false}>
      <Group
        x={origin.x}
        y={origin.y}
        scaleX={reticleScale}
        scaleY={reticleScale}
      >
        <Circle
          radius={11.2}
          stroke="#071014"
          strokeWidth={3.2}
        />
        <Line
          points={[-16, 0, 16, 0]}
          stroke="#071014"
          strokeWidth={3.2}
        />
        <Line
          points={[0, -16, 0, 16]}
          stroke="#071014"
          strokeWidth={3.2}
        />
        <Line
          points={[-16, 0, 16, 0]}
          stroke="#edf3f5"
          strokeWidth={1.2}
        />
        <Line
          points={[0, -16, 0, 16]}
          stroke="#edf3f5"
          strokeWidth={1.2}
        />
        <Circle
          radius={11.2}
          stroke={ANCHOR}
          strokeWidth={2.6}
          dash={[5.2, 5.2]}
        />
        <Circle
          radius={11.2}
          stroke="#edf3f5"
          strokeWidth={2.6}
          dash={[5.2, 5.2]}
          dashOffset={5.2}
        />
        <Circle
          radius={2.4}
          fill={ANCHOR}
          stroke="#071014"
          strokeWidth={1.2}
        />
      </Group>
    </Group>
  )
}

function FaceNormalGizmo({
  scene,
  face,
  scale,
}: {
  scene: SceneGeometry
  face: MeshFace
  scale: number
}) {
  const indicator = faceNormalIndicator(scene, face)
  if (!indicator) return null

  const end = {
    x: indicator.origin.x + indicator.direction.x * (18 / scale),
    y: indicator.origin.y + indicator.direction.y * (18 / scale),
  }
  const points = [indicator.origin.x, indicator.origin.y, end.x, end.y]
  return (
    <Group listening={false}>
      <Arrow
        points={points}
        stroke="#071014"
        fill="#071014"
        strokeWidth={4 / scale}
        pointerLength={6 / scale}
        pointerWidth={6 / scale}
      />
      <Arrow
        points={points}
        stroke="#f5fbff"
        fill="#f5fbff"
        strokeWidth={1.6 / scale}
        pointerLength={5 / scale}
        pointerWidth={5 / scale}
      />
    </Group>
  )
}

export function EditorCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const visualizationMenuRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const draftControlDragRef = useRef<DraftControlDrag>(undefined)
  const orientationPopupDragRef = useRef<DraftControlDrag>(undefined)
  const boxSelectionRef = useRef<BoxSelectionDrag | undefined>(undefined)
  const suppressBoxClickRef = useRef(false)
  const draftWidthInputRef = useRef<HTMLInputElement>(null)
  const draftHeightInputRef = useRef<HTMLInputElement>(null)
  const document = useEditorStore((state) => state.document)
  const tool = useEditorStore((state) => state.tool)
  const orientationDraft = useEditorStore((state) => state.orientationDraft)
  const selectedEdges = useEditorStore((state) => state.selectedEdges)
  const selectedEvidenceIds = useEditorStore((state) => state.selectedEvidenceIds)
  const hoveredEvidenceId = useEditorStore((state) => state.hoveredEvidenceId)
  const setTool = useEditorStore((state) => state.setTool)
  const selectEdge = useEditorStore((state) => state.selectEdge)
  const clearSelectedEdges = useEditorStore((state) => state.clearSelectedEdges)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const selectFace = useEditorStore((state) => state.selectFace)
  const selectFaces = useEditorStore((state) => state.selectFaces)
  const setAnchorFace = useEditorStore((state) => state.setAnchorFace)
  const addBaseFaces = useEditorStore((state) => state.addBaseFaces)
  const setOrientationFace = useEditorStore((state) => state.setOrientationFace)
  const setOrientationSurfaceKind = useEditorStore(
    (state) => state.setOrientationSurfaceKind,
  )
  const setOrientationEdge = useEditorStore((state) => state.setOrientationEdge)
  const setOrientationHorizontalDirection = useEditorStore(
    (state) => state.setOrientationHorizontalDirection,
  )
  const cancelOrientation = useEditorStore((state) => state.cancelOrientation)
  const moveObservation = useEditorStore((state) => state.moveObservation)
  const deleteObservation = useEditorStore((state) => state.deleteObservation)
  const upsertObservation = useEditorStore((state) => state.upsertObservation)
  const extrudeSelectedEdges = useEditorStore((state) => state.extrudeSelectedEdges)
  const image = useCanvasImage(document.image.src)
  const [size, setSize] = useState<CanvasSize>({ width: 900, height: 640 })
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [draft, setDraft] = useState<Point2[]>([])
  const [draftGridSize, setDraftGridSize] = useState<DraftGridSize>()
  const [draftControlOffset, setDraftControlOffset] = useState<Point2>({
    x: 0,
    y: 0,
  })
  const [orientationPopupOffset, setOrientationPopupOffset] = useState<Point2>({
    x: 0,
    y: 0,
  })
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false)
  const [hoverCursor, setHoverCursor] = useState<string>()
  const [draggedObservation, setDraggedObservation] = useState<DraggedObservation>()
  const [pointerPoint, setPointerPoint] = useState<Point2>()
  const [boxSelection, setBoxSelection] = useState<BoxSelectionDrag>()
  const [hoveredOrientationEdge, setHoveredOrientationEdge] = useState<FaceEdge>()
  const [visualizations, setVisualizations] = useState<VisualizationSettings>({
    axisGizmo: true,
    anchorMarker: true,
    calibrationPoints: true,
    calibrationResiduals: true,
    faceNormals: false,
  })

  const renderedScene = useMemo(() => {
    if (!draggedObservation) return document.scene
    // Calibration handles render against a cloned, continuously refitted scene.
    // The store receives only the final pointer position on drag end.
    const scene = structuredClone(document.scene)
    const observation = draggedObservation.id
      ? scene.observations.find((entry) => entry.id === draggedObservation.id)
      : undefined
    if (observation) observation.image = draggedObservation.point
    else {
      scene.observations.push({
        id: '__dragged_anchor__',
        lattice: draggedObservation.lattice,
        image: draggedObservation.point,
        weight: 1,
      })
    }
    try {
      scene.projection = refitProjection(scene)
    } catch {
      // Keep the last stable projection while a drag crosses a degenerate pose.
    }
    return scene
  }, [document.scene, draggedObservation])
  const renderedProjectionInfo = useMemo(
    () => projectionInfo(renderedScene),
    [renderedScene],
  )

  const preview = useMemo(() => {
    if (tool !== 'extrude' || selectedEdges.length === 0 || !pointerPoint) {
      return undefined
    }
    return makeExtrusionPreview(
      renderedScene,
      selectedEdges,
      pointerPoint,
    )
  }, [
    pointerPoint,
    renderedScene,
    selectedEdges,
    tool,
  ])

  const sceneForRendering = preview?.scene ?? renderedScene
  const sceneProjectionInfo = useMemo(
    () => projectionInfo(sceneForRendering),
    [sceneForRendering],
  )
  const fullCameraSolved = sceneForRendering.projection?.kind === 'camera'
  const anchorFace = sceneForRendering.projection && document.anchorFaceId
    ? sceneForRendering.faces.find((face) => face.id === document.anchorFaceId)
    : undefined
  const orientationFace = sceneForRendering.projection && orientationDraft?.faceId
    ? sceneForRendering.faces.find((face) => face.id === orientationDraft.faceId)
    : undefined
  const orientationArrowEdges = useMemo(() => {
    if (!orientationFace || !orientationDraft) return []
    if (orientationDraft.mode === 'up') {
      return orientationDraft.surfaceKind === 'side' ? faceEdges : []
    }
    const localUp = localVectorForWorld(
      sceneForRendering.axisMapping,
      { x: 0, y: 1, z: 0 },
    )
    if (!localUp) return []
    return faceEdges.filter((edge) => {
      const arrow = orientationEdgeGeometry(orientationFace, edge)
      return Math.abs(dot3(localUp, arrow.direction)) <= 1e-8
    })
  }, [orientationDraft, orientationFace, sceneForRendering.axisMapping])
  const orientationPopupAnchor = useMemo(() => {
    if (!orientationFace || !orientationDraft) return undefined
    const quad = faceQuad(sceneForRendering, orientationFace)
    if (!quad) return undefined
    const centerX = quad.reduce((sum, point) => sum + point.x, 0) / quad.length
    const bottom = Math.max(...quad.map((point) => point.y))
    return {
      left: view.x + centerX * view.scale,
      top: view.y + bottom * view.scale + 12,
    }
  }, [orientationDraft, orientationFace, sceneForRendering, view])
  const orientationPopupPosition = useMemo(() => {
    if (!orientationPopupAnchor) return undefined
    return {
      left: Math.max(
        ORIENTATION_POPUP_HALF_WIDTH,
        Math.min(
          size.width - ORIENTATION_POPUP_HALF_WIDTH,
          orientationPopupAnchor.left + orientationPopupOffset.x,
        ),
      ),
      top: Math.max(
        ORIENTATION_POPUP_MIN_TOP,
        Math.min(
          size.height - ORIENTATION_POPUP_BOTTOM_MARGIN,
          orientationPopupAnchor.top + orientationPopupOffset.y,
        ),
      ),
    }
  }, [orientationPopupAnchor, orientationPopupOffset, size.height, size.width])
  const meshEdges = useMemo(() => {
    const edges = new Map<string, RenderedMeshEdge>()
    renderedScene.faces.forEach((face) => {
      if (face.id.startsWith('__preview_')) return
      faceEdges.forEach((edge) => {
        const geometry = faceEdgeGeometry(face, edge)
        const key = meshEdgeKey(geometry.start, geometry.end)
        // Adjacent faces share one selectable mesh edge, regardless of which
        // face contributed it first.
        if (!edges.has(key)) {
          edges.set(key, { key, selection: { faceId: face.id, edge } })
        }
      })
    })
    return [...edges.values()]
  }, [renderedScene])
  const selectedEdgeKeys = useMemo(
    () =>
      new Set(
        selectedEdges.flatMap((selection) => {
          const geometry = selectedEdgeGeometry(renderedScene, selection)
          return geometry ? [meshEdgeKey(geometry.start, geometry.end)] : []
        }),
      ),
    [renderedScene, selectedEdges],
  )
  const calibrationCandidates = useMemo(() => {
    const unique = new Map<string, { x: number; y: number; z: number }>()
    document.scene.faces.forEach((face) => {
      faceCornersLattice(face).forEach((lattice) => {
        unique.set(`${lattice.x}:${lattice.y}:${lattice.z}`, lattice)
      })
    })
    return [...unique.values()].filter(
      (lattice) =>
        !document.scene.observations.some((observation) =>
          same3(observation.lattice, lattice),
        ),
    )
  }, [document.scene])
  const evidenceMap = useMemo(
    () => new Map(document.evidence.map((entry) => [entry.id, entry])),
    [document.evidence],
  )
  const draftGridLines = useMemo(() => {
    if (draft.length !== 4 || !draftGridSize) return []
    try {
      // The same projective mapping used for committed faces previews every
      // requested row and column inside the four drafted corners.
      const homography = fitHomography(
        [
          { x: 0, y: 0 },
          { x: draftGridSize.columns, y: 0 },
          { x: draftGridSize.columns, y: draftGridSize.rows },
          { x: 0, y: draftGridSize.rows },
        ],
        draft,
      )
      return [
        ...Array.from({ length: draftGridSize.columns + 1 }, (_, column) => [
          projectPoint(homography, { x: column, y: 0 }),
          projectPoint(homography, { x: column, y: draftGridSize.rows }),
        ]),
        ...Array.from({ length: draftGridSize.rows + 1 }, (_, row) => [
          projectPoint(homography, { x: 0, y: row }),
          projectPoint(homography, { x: draftGridSize.columns, y: row }),
        ]),
      ]
    } catch {
      return []
    }
  }, [draft, draftGridSize])
  const draftControlAnchor = useMemo(() => {
    if (draft.length !== 4 || !draftGridSize) return undefined
    // Place the initial control below the grid rather than over its center.
    // Draft points are ordered top-left, top-right, bottom-right, bottom-left.
    const bottomCenter = {
      x: (draft[2].x + draft[3].x) / 2,
      y: (draft[2].y + draft[3].y) / 2,
    }
    return {
      left: view.x + bottomCenter.x * view.scale,
      top:
        view.y +
        bottomCenter.y * view.scale +
        DRAFT_CONTROL_HALF_HEIGHT +
        12,
    }
  }, [draft, draftGridSize, view])
  const draftControlPosition = useMemo(() => {
    if (!draftControlAnchor) return undefined
    return {
      left: Math.max(
        DRAFT_CONTROL_HALF_WIDTH,
        Math.min(
          size.width - DRAFT_CONTROL_HALF_WIDTH,
          draftControlAnchor.left + draftControlOffset.x,
        ),
      ),
      top: Math.max(
        DRAFT_CONTROL_HALF_HEIGHT,
        Math.min(
          size.height - DRAFT_CONTROL_HALF_HEIGHT,
          draftControlAnchor.top + draftControlOffset.y,
        ),
      ),
    }
  }, [draftControlAnchor, draftControlOffset, size.height, size.width])

  useEffect(() => {
    if (!containerRef.current) return
    // ResizeObserver keeps the canvas aligned with the CSS grid without relying
    // on window size as a proxy for the actual workspace.
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(320, entry.contentRect.width),
        height: Math.max(320, entry.contentRect.height),
      })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!image || !size.width || !size.height) return
    // Opening or switching projects recenters the full screenshot with an
    // initial margin while preserving a useful cap for small images.
    const scale = Math.min(
      (size.width - 80) / image.naturalWidth,
      (size.height - 80) / image.naturalHeight,
      2.4,
    )
    setView({
      scale,
      x: (size.width - image.naturalWidth * scale) / 2,
      y: (size.height - image.naturalHeight * scale) / 2,
    })
  }, [document.image.key, image, size.height, size.width])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDraft([])
        setDraftGridSize(undefined)
        setDraftControlOffset({ x: 0, y: 0 })
        if (tool === 'extrude' || tool === 'anchor' || tool === 'orient' || tool === 'plane') {
          if (tool === 'orient') cancelOrientation()
          setTool('select')
        } else if (tool === 'select') clearSelectedEdges()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelOrientation, clearSelectedEdges, setTool, tool])

  useEffect(() => {
    setOrientationPopupOffset({ x: 0, y: 0 })
  }, [orientationDraft?.faceId, orientationDraft?.mode])

  useEffect(() => {
    if (!draftGridSize) return
    const attachWheelHandler = (
      input: HTMLInputElement | null,
      dimension: keyof DraftGridSize,
    ) => {
      if (!input) return () => {}
      const onInputWheel = (event: WheelEvent) => {
        // A non-passive native listener is required to keep number-field
        // scrolling from zooming the Konva stage underneath the popup.
        event.preventDefault()
        event.stopPropagation()
        const delta = event.deltaY < 0 ? -1 : 1
        setDraftGridSize((current) => {
          if (!current) return current
          return {
            ...current,
            [dimension]: Math.max(
              MIN_GRID_SIZE,
              Math.min(MAX_GRID_SIZE, current[dimension] + delta),
            ),
          }
        })
      }
      input.addEventListener('wheel', onInputWheel, { passive: false })
      return () => input.removeEventListener('wheel', onInputWheel)
    }
    const detachWidth = attachWheelHandler(
      draftWidthInputRef.current,
      'columns',
    )
    const detachHeight = attachWheelHandler(
      draftHeightInputRef.current,
      'rows',
    )
    return () => {
      detachWidth()
      detachHeight()
    }
  }, [draftGridSize])

  const pointerInImage = (): Point2 | null => {
    const pointer = stageRef.current?.getPointerPosition()
    if (!pointer) return null
    // Stage pointer coordinates are viewport pixels; undo pan and zoom before
    // passing observations to lattice projection code.
    return {
      x: (pointer.x - view.x) / view.scale,
      y: (pointer.y - view.y) / view.scale,
    }
  }

  const imagePointFromClientPosition = useCallback((
    clientX: number,
    clientY: number,
  ): Point2 | null => {
    const bounds = stageRef.current?.container().getBoundingClientRect()
    if (!bounds) return null
    return {
      x: (clientX - bounds.left - view.x) / view.scale,
      y: (clientY - bounds.top - view.y) / view.scale,
    }
  }, [view])

  const confirmDraftGrid = () => {
    if (draft.length !== 4 || !draftGridSize) return
    addBaseFaces(
      draft as [Point2, Point2, Point2, Point2],
      draftGridSize.columns,
      draftGridSize.rows,
    )
    setDraft([])
    setDraftGridSize(undefined)
    setDraftControlOffset({ x: 0, y: 0 })
    setTool('select')
  }

  const updateDraftGridSize = (
    dimension: keyof DraftGridSize,
    value: number,
  ) => {
    if (!Number.isFinite(value)) return
    const normalized = Math.max(
      MIN_GRID_SIZE,
      Math.min(MAX_GRID_SIZE, Math.round(value)),
    )
    setDraftGridSize((current) =>
      current ? { ...current, [dimension]: normalized } : current,
    )
  }

  const startDraftControlDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    draftControlDragRef.current = {
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startOffset: draftControlOffset,
    }
  }

  const moveDraftControl = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = draftControlDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !draftControlAnchor) return
    const desiredLeft =
      draftControlAnchor.left +
      drag.startOffset.x +
      event.clientX -
      drag.startPointer.x
    const desiredTop =
      draftControlAnchor.top +
      drag.startOffset.y +
      event.clientY -
      drag.startPointer.y
    setDraftControlOffset({
      x:
        Math.max(
          DRAFT_CONTROL_HALF_WIDTH,
          Math.min(size.width - DRAFT_CONTROL_HALF_WIDTH, desiredLeft),
        ) - draftControlAnchor.left,
      y:
        Math.max(
          DRAFT_CONTROL_HALF_HEIGHT,
          Math.min(size.height - DRAFT_CONTROL_HALF_HEIGHT, desiredTop),
        ) - draftControlAnchor.top,
    })
  }

  const stopDraftControlDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (draftControlDragRef.current?.pointerId !== event.pointerId) return
    draftControlDragRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const startOrientationPopupDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    orientationPopupDragRef.current = {
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startOffset: orientationPopupOffset,
    }
  }

  const moveOrientationPopup = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = orientationPopupDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !orientationPopupAnchor) return
    const desiredLeft = orientationPopupAnchor.left + drag.startOffset.x +
      event.clientX - drag.startPointer.x
    const desiredTop = orientationPopupAnchor.top + drag.startOffset.y +
      event.clientY - drag.startPointer.y
    setOrientationPopupOffset({
      x: Math.max(
        ORIENTATION_POPUP_HALF_WIDTH,
        Math.min(size.width - ORIENTATION_POPUP_HALF_WIDTH, desiredLeft),
      ) - orientationPopupAnchor.left,
      y: Math.max(
        ORIENTATION_POPUP_MIN_TOP,
        Math.min(size.height - ORIENTATION_POPUP_BOTTOM_MARGIN, desiredTop),
      ) - orientationPopupAnchor.top,
    })
  }

  const stopOrientationPopupDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (orientationPopupDragRef.current?.pointerId !== event.pointerId) return
    orientationPopupDragRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onStageClick = (event: Konva.KonvaEventObject<MouseEvent>) => {
    // A completed marquee also produces a click on the stage when its release
    // point is not over a face. Do not let that synthetic click clear the
    // selection we just made.
    if (suppressBoxClickRef.current) return
    if (event.target !== event.currentTarget && event.target.draggable()) return
    // After the fourth corner, the next unobstructed canvas click confirms the
    // visible grid-size dialog as a deliberate second step.
    if (draft.length === 4 && draftGridSize) {
      confirmDraftGrid()
      return
    }
    const point = pointerInImage()
    if (!point) return
    if (tool === 'extrude' && selectedEdges.length > 0) {
      extrudeSelectedEdges(point)
      return
    }
    if (tool === 'select') {
      clearSelectedEdges()
      clearSelection()
      return
    }
    if (tool !== 'plane') return
    const next = [...draft, point]
    if (next.length === 4) {
      setDraft(next)
      setDraftGridSize({
        columns: DEFAULT_GRID_SIZE,
        rows: DEFAULT_GRID_SIZE,
      })
      setDraftControlOffset({ x: 0, y: 0 })
    } else {
      setDraft(next)
    }
  }

  const onStageMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'select' || !event.evt.ctrlKey || event.evt.button !== 0) return
    const point = pointerInImage()
    if (!point) return
    event.evt.preventDefault()
    setBoxSelection({
      start: point,
      current: point,
      additive: event.evt.shiftKey,
    })
    boxSelectionRef.current = {
      start: point,
      current: point,
      additive: event.evt.shiftKey,
    }
    suppressBoxClickRef.current = false
    stageRef.current?.draggable(false)
  }

  const finishBoxSelection = useCallback((end: Point2) => {
    const selection = boxSelectionRef.current
    if (tool !== 'select' || !selection) return
    const moved = Math.hypot(
      (end.x - selection.start.x) * view.scale,
      (end.y - selection.start.y) * view.scale,
    ) > 4
    if (!moved) {
      boxSelectionRef.current = undefined
      setBoxSelection(undefined)
      stageRef.current?.draggable(true)
      return
    }
    suppressBoxClickRef.current = true
    const left = Math.min(selection.start.x, end.x)
    const right = Math.max(selection.start.x, end.x)
    const top = Math.min(selection.start.y, end.y)
    const bottom = Math.max(selection.start.y, end.y)
    const selectedIds = sceneForRendering.faces
      .filter((face) => !face.id.startsWith('__preview_'))
      .filter((face) => {
        const quad = faceQuad(sceneForRendering, face)
        if (!quad) return false
        return quadTouchesBox(quad, left, right, top, bottom)
      })
      .map((face) => face.id)
    selectFaces(selectedIds, selection.additive)
    boxSelectionRef.current = undefined
    setBoxSelection(undefined)
    stageRef.current?.draggable(true)
    window.setTimeout(() => {
      suppressBoxClickRef.current = false
    }, 0)
  }, [sceneForRendering, selectFaces, tool, view.scale])

  const onStageMouseUp = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (event.evt.button !== 0) return
    const end = pointerInImage() ?? boxSelectionRef.current?.current
    if (end) finishBoxSelection(end)
  }

  useEffect(() => {
    if (!boxSelection) return
    // Konva only emits stage mouse events while the pointer is over the
    // canvas. Complete a marquee that ends in empty space outside it too.
    const onWindowMouseMove = (event: MouseEvent) => {
      const point = imagePointFromClientPosition(event.clientX, event.clientY)
      if (!point || !boxSelectionRef.current) return
      boxSelectionRef.current.current = point
      setBoxSelection((current) => current ? { ...current, current: point } : current)
    }
    const onWindowMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return
      const point = imagePointFromClientPosition(event.clientX, event.clientY)
      const end = point ?? boxSelectionRef.current?.current
      if (end) finishBoxSelection(end)
    }
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
    }
  }, [boxSelection, finishBoxSelection, imagePointFromClientPosition])

  const onStageMouseMove = () => {
    setPointerPoint(pointerInImage() ?? undefined)
    if (!boxSelection) return
    const point = pointerInImage()
    if (!point) return
    const current = boxSelectionRef.current
    if (current) {
      current.current = point
      if (
        Math.hypot(
          (point.x - current.start.x) * view.scale,
          (point.y - current.start.y) * view.scale,
        ) > 4
      ) {
        suppressBoxClickRef.current = true
      }
    }
    setBoxSelection((current) => current ? { ...current, current: point } : current)
  }

  const onWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault()
    const pointer = stageRef.current?.getPointerPosition()
    if (!pointer) return
    const oldScale = view.scale
    const direction = event.evt.deltaY > 0 ? -1 : 1
    const factor = event.evt.ctrlKey ? 1.04 : 1.12
    const nextScale = Math.max(
      0.08,
      Math.min(16, direction > 0 ? oldScale * factor : oldScale / factor),
    )
    const anchor = {
      x: (pointer.x - view.x) / oldScale,
      y: (pointer.y - view.y) / oldScale,
    }
    // Recompute translation so the image point beneath the cursor stays fixed.
    setView({
      scale: nextScale,
      x: pointer.x - anchor.x * nextScale,
      y: pointer.y - anchor.y * nextScale,
    })
  }

  const idleCursor =
    tool === 'plane' || tool === 'anchor' || tool === 'orient'
      ? 'crosshair'
      : tool === 'extrude'
        ? 'copy'
        : 'grab'

  return (
    <div className="canvas-shell" ref={containerRef}>
      <div ref={visualizationMenuRef} className="visualization-menu">
        <button
          type="button"
          className="visualization-trigger"
          aria-label="Visualization options"
          onMouseDown={(event) => event.preventDefault()}
        >
          <Layers3 size={14} />
        </button>
        <div className="visualization-options">
          {visualizationOptions.map((option) => (
            <label className="visualization-option" key={option.key}>
              <input
                type="checkbox"
                checked={visualizations[option.key]}
                onChange={(event) =>
                  setVisualizations((current) => ({
                    ...current,
                    [option.key]: event.target.checked,
                  }))
                }
              />
              <span><strong>{option.label}</strong></span>
              <small className="visualization-tooltip">{option.description}</small>
            </label>
          ))}
        </div>
      </div>
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable
        onDragStart={(event) => {
          if (event.target === event.currentTarget) setIsDraggingCanvas(true)
        }}
        onDragEnd={(event) => {
          if (event.target !== event.currentTarget) return
          setIsDraggingCanvas(false)
          setView((current) => ({
            ...current,
            x: event.currentTarget.x(),
            y: event.currentTarget.y(),
          }))
        }}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onMouseLeave={() => setPointerPoint(undefined)}
        onWheel={onWheel}
        onClick={onStageClick}
        style={{
          cursor: isDraggingCanvas ? 'grabbing' : hoverCursor ?? idleCursor,
        }}
      >
        <Layer>
          <Rect
            x={0}
            y={0}
            width={document.image.width}
            height={document.image.height}
            fill="#080c0f"
            shadowColor="#000"
            shadowBlur={30 / view.scale}
            shadowOpacity={0.55}
            listening={false}
          />
          {image && (
            <Image
              image={image}
              x={0}
              y={0}
              width={document.image.width}
              height={document.image.height}
              listening={false}
            />
          )}
        </Layer>
        <Layer>
          {sceneForRendering.faces.map((face) => {
            const isPreview = face.id.startsWith('__preview_')
            const evidence = evidenceMap.get(face.id)
            const selected = selectedEvidenceIds.includes(face.id)
            const hovered = hoveredEvidenceId === face.id
            const orientationSelected = orientationDraft?.faceId === face.id
            const quad = faceQuad(sceneForRendering, face)
            if (!quad) return null
            const color = isPreview
              ? PROPOSED
              : hovered
                ? HOVERED
                : selected || orientationSelected
                ? SELECTED
                : statusColor(evidence?.reviewStatus)
            return (
              <Line
                key={face.id}
                points={flattenPoints(quad)}
                closed
                stroke={color}
                opacity={isPreview ? 0.72 : 1}
                strokeWidth={
                  (hovered || selected || orientationSelected ? 2.4 : 0.8) / view.scale
                }
                dash={isPreview ? [4 / view.scale, 3 / view.scale] : undefined}
                fill={
                  hovered
                    ? 'rgba(216,198,107,.14)'
                    : isPreview || evidence?.reviewStatus === 'proposed'
                      ? 'rgba(240,182,77,.12)'
                    : evidence?.reviewStatus === 'confirmed'
                      ? 'rgba(83,230,165,.08)'
                      : 'rgba(0,0,0,.001)'
                }
                hitStrokeWidth={8 / view.scale}
                listening={
                  !isPreview &&
                  (tool === 'select' || tool === 'anchor' || tool === 'orient')
                }
                onClick={(event) => {
                  event.cancelBubble = true
                  if (tool === 'anchor') setAnchorFace(face.id)
                  else if (tool === 'orient') setOrientationFace(face.id)
                  else if (
                    tool === 'select' &&
                    !suppressBoxClickRef.current
                  ) {
                    selectFace(face.id, event.evt.shiftKey)
                  }
                }}
              />
            )
          })}
          {meshEdges.map(({ key, selection }) => {
            const geometry = selectedEdgeGeometry(renderedScene, selection)
            if (!geometry) return null
            const start = projectScenePoint(renderedScene, geometry.start)
            const end = projectScenePoint(renderedScene, geometry.end)
            if (!start || !end) return null
            const active = selectedEdgeKeys.has(key)
            return (
              <Line
                key={key}
                points={flattenPoints([start, end])}
                stroke={active ? PROPOSED : EDGE}
                opacity={active ? 1 : tool === 'select' ? 0.42 : 0.2}
                strokeWidth={(active ? 3 : 1.05) / view.scale}
                hitStrokeWidth={12 / view.scale}
                listening={tool === 'select'}
                onMouseEnter={() => setHoverCursor('pointer')}
                onMouseLeave={() => setHoverCursor(undefined)}
                onClick={(event) => {
                  event.cancelBubble = true
                  if (!suppressBoxClickRef.current) {
                    selectEdge(selection, event.evt.shiftKey)
                  }
                }}
              />
            )
          })}
          {tool === 'orient' &&
            orientationFace &&
            orientationArrowEdges.map((edge) => {
              const geometry = orientationEdgeGeometry(orientationFace, edge)
              const start = projectScenePoint(renderedScene, geometry.start)
              const end = projectScenePoint(renderedScene, geometry.end)
              if (!start || !end) return null
              const active = orientationDraft?.edge === edge
              const hovered = hoveredOrientationEdge === edge
              const color = active ? PROPOSED : hovered ? CONFIRMED : '#a8b3b9'
              return (
                <Arrow
                  key={`orientation-edge-${edge}`}
                  points={flattenPoints([start, end])}
                  stroke={color}
                  fill={color}
                  opacity={active ? 1 : 0.86}
                  strokeWidth={(active ? 4 : 3) / view.scale}
                  pointerLength={13 / view.scale}
                  pointerWidth={13 / view.scale}
                  hitStrokeWidth={20 / view.scale}
                  onMouseEnter={() => setHoveredOrientationEdge(edge)}
                  onMouseLeave={() => setHoveredOrientationEdge(undefined)}
                  onClick={(event) => {
                    event.cancelBubble = true
                    setOrientationEdge(edge)
                  }}
                />
              )
            })}
          {fullCameraSolved &&
            visualizations.faceNormals &&
            sceneForRendering.faces.map((face) => (
              <FaceNormalGizmo
                key={`normal-${face.id}`}
                scene={sceneForRendering}
                face={face}
                scale={view.scale}
              />
            ))}
          {visualizations.anchorMarker && anchorFace && (
            <AnchorGizmo
              scene={sceneForRendering}
              face={anchorFace}
              scale={view.scale}
            />
          )}
          {visualizations.axisGizmo && anchorFace && (
            <GlobalAxisGizmo
              scene={sceneForRendering}
              face={anchorFace}
              scale={view.scale}
            />
          )}
          {visualizations.calibrationResiduals &&
            document.scene.observations.map((observation) => {
              const actual =
                draggedObservation?.id === observation.id
                  ? draggedObservation.point
                  : observation.image
              const predicted = projectScenePoint(
                renderedScene,
                observation.lattice,
              )
              if (!predicted || distance(actual, predicted) < 0.1) return null
              return (
                <Line
                  key={`residual-${observation.id}`}
                  points={flattenPoints([actual, predicted])}
                  stroke="#98a3aa"
                  opacity={0.8}
                  strokeWidth={1.2 / view.scale}
                  dash={[3 / view.scale, 3 / view.scale]}
                  listening={false}
                />
              )
            })}
          {visualizations.calibrationPoints &&
            document.scene.observations.map((observation) => (
              <Circle
                key={observation.id}
                x={
                  draggedObservation?.id === observation.id
                    ? draggedObservation.point.x
                    : observation.image.x
                }
                y={
                  draggedObservation?.id === observation.id
                    ? draggedObservation.point.y
                    : observation.image.y
                }
                radius={4.5 / view.scale}
                fill="#f5fbff"
                stroke={
                  renderedProjectionInfo.resolvedAxes === 3 ? SELECTED : GRID
                }
                strokeWidth={1.8 / view.scale}
                draggable
                onDragStart={(event) =>
                  setDraggedObservation({
                    id: observation.id,
                    lattice: observation.lattice,
                    point: { x: event.target.x(), y: event.target.y() },
                  })
                }
                onDragMove={(event) =>
                  setDraggedObservation({
                    id: observation.id,
                    lattice: observation.lattice,
                    point: { x: event.target.x(), y: event.target.y() },
                  })
                }
                onDragEnd={(event) => {
                  const point = { x: event.target.x(), y: event.target.y() }
                  // Commit once at gesture end; onDragMove updated only the
                  // transient renderedScene above.
                  if (distance(observation.image, point) > 0.01) {
                    moveObservation(observation.id, point)
                  }
                  setDraggedObservation(undefined)
                }}
                onContextMenu={(event) => {
                  event.evt.preventDefault()
                  event.cancelBubble = true
                  deleteObservation(observation.id)
                }}
              />
            ))}
          {visualizations.calibrationPoints &&
            calibrationCandidates.map((lattice) => {
              const projected = projectScenePoint(renderedScene, lattice)
              if (!projected) return null
              const key = `${lattice.x}:${lattice.y}:${lattice.z}`
              const active =
                !draggedObservation?.id &&
                draggedObservation?.lattice.x === lattice.x &&
                draggedObservation.lattice.y === lattice.y &&
                draggedObservation.lattice.z === lattice.z
              return (
                <Circle
                  key={`candidate-${key}`}
                  x={active ? draggedObservation.point.x : projected.x}
                  y={active ? draggedObservation.point.y : projected.y}
                  radius={3.4 / view.scale}
                  fill="rgba(7,16,20,.78)"
                  stroke="#b7c2c8"
                  opacity={0.72}
                  strokeWidth={1.2 / view.scale}
                  draggable
                  onDragStart={(event) =>
                    setDraggedObservation({
                      lattice,
                      point: { x: event.target.x(), y: event.target.y() },
                    })
                  }
                  onDragMove={(event) =>
                    setDraggedObservation({
                      lattice,
                      point: { x: event.target.x(), y: event.target.y() },
                    })
                  }
                  onDragEnd={(event) => {
                    const point = { x: event.target.x(), y: event.target.y() }
                    upsertObservation(lattice, point)
                    setDraggedObservation(undefined)
                  }}
                />
              )
            })}
          {draft.length > 0 && (
            <>
              {draftGridLines.map((line, index) => (
                <Line
                  key={`draft-grid-${index}`}
                  points={flattenPoints(line)}
                  stroke={PROPOSED}
                  opacity={0.82}
                  strokeWidth={1 / view.scale}
                  listening={false}
                />
              ))}
              <Line
                points={flattenPoints(draft)}
                stroke={PROPOSED}
                strokeWidth={1.5 / view.scale}
                dash={[5 / view.scale, 4 / view.scale]}
              />
              {draft.length < 4 && pointerPoint && (
                <>
                  <Line
                    points={[
                      draft[draft.length - 1].x,
                      draft[draft.length - 1].y,
                      pointerPoint.x,
                      pointerPoint.y,
                    ]}
                    stroke={PROPOSED}
                    opacity={0.82}
                    strokeWidth={1.5 / view.scale}
                    dash={[5 / view.scale, 4 / view.scale]}
                    listening={false}
                  />
                  {draft.length === 3 && (
                    <Line
                      points={[
                        pointerPoint.x,
                        pointerPoint.y,
                        draft[0].x,
                        draft[0].y,
                      ]}
                      stroke={PROPOSED}
                      opacity={0.82}
                      strokeWidth={1.5 / view.scale}
                      dash={[5 / view.scale, 4 / view.scale]}
                      listening={false}
                    />
                  )}
                </>
              )}
              {draft.map((point, index) => (
                <Circle
                  key={`draft-corner-${index}`}
                  x={point.x}
                  y={point.y}
                  radius={6 / view.scale}
                  fill={PROPOSED}
                  stroke="#071014"
                  strokeWidth={1.5 / view.scale}
                  draggable={draft.length === 4}
                  onMouseEnter={() => {
                    if (draft.length === 4) setHoverCursor('move')
                  }}
                  onMouseLeave={() => setHoverCursor(undefined)}
                  onDragStart={() => setHoverCursor('grabbing')}
                  onClick={(event) => {
                    event.cancelBubble = true
                  }}
                  onDragMove={(event) => {
                    const nextPoint = {
                      x: event.target.x(),
                      y: event.target.y(),
                    }
                    setDraft((current) =>
                      current.map((entry, entryIndex) =>
                        entryIndex === index ? nextPoint : entry,
                      ),
                    )
                  }}
                  onDragEnd={(event) => {
                    setHoverCursor('move')
                    const nextPoint = {
                      x: event.target.x(),
                      y: event.target.y(),
                    }
                    setDraft((current) =>
                      current.map((entry, entryIndex) =>
                        entryIndex === index ? nextPoint : entry,
                      ),
                    )
                  }}
                />
              ))}
            </>
          )}
        </Layer>
          {boxSelection && (
          <Layer listening={false}>
            <Rect
              x={Math.min(boxSelection.start.x, boxSelection.current.x)}
              y={Math.min(boxSelection.start.y, boxSelection.current.y)}
              width={Math.abs(boxSelection.current.x - boxSelection.start.x)}
              height={Math.abs(boxSelection.current.y - boxSelection.start.y)}
              fill="rgba(112,167,255,.14)"
              stroke={SELECTED}
              dash={[6 / view.scale, 4 / view.scale]}
              strokeWidth={1.2 / view.scale}
            />
          </Layer>
        )}
      </Stage>
      {orientationDraft && orientationFace && orientationPopupPosition && (
        <div
          className="orientation-face-popup"
          role="dialog"
          aria-label={
            orientationDraft.mode === 'up'
              ? 'Determine world up'
              : 'Confirm horizontal orientation'
          }
          style={orientationPopupPosition}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {orientationDraft.mode === 'up' && !orientationDraft.surfaceKind && (
            <>
              <div
                className="orientation-face-popup-heading"
                title="Drag to move"
                onPointerDown={startOrientationPopupDrag}
                onPointerMove={moveOrientationPopup}
                onPointerUp={stopOrientationPopupDrag}
                onPointerCancel={stopOrientationPopupDrag}
              >
                <strong>What kind of face is this?</strong>
                <span>This establishes vertical UP.</span>
              </div>
              <div className="orientation-choice-grid three">
                {(['top', 'bottom', 'side'] as OrientationSurfaceKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setOrientationSurfaceKind(kind)}
                  >
                    {kind === 'top' ? 'Top' : kind === 'bottom' ? 'Bottom' : 'Side'}
                  </button>
                ))}
              </div>
            </>
          )}
          {orientationDraft.mode === 'up' && orientationDraft.surfaceKind === 'side' && (
            <div
              className="orientation-face-popup-heading"
              title="Drag to move"
              onPointerDown={startOrientationPopupDrag}
              onPointerMove={moveOrientationPopup}
              onPointerUp={stopOrientationPopupDrag}
              onPointerCancel={stopOrientationPopupDrag}
            >
              <strong>Which arrow points UP?</strong>
              <span>Click one of the four gray arrows on the face.</span>
            </div>
          )}
          {orientationDraft.mode === 'horizontal' && !orientationDraft.edge && (
            <div
              className="orientation-face-popup-heading"
              title="Drag to move"
              onPointerDown={startOrientationPopupDrag}
              onPointerMove={moveOrientationPopup}
              onPointerUp={stopOrientationPopupDrag}
              onPointerCancel={stopOrientationPopupDrag}
            >
              <strong>Please pick a horizontal arrow.</strong>
              <span>This arrow will be used in the next step.</span>
            </div>
          )}
          {orientationDraft.mode === 'horizontal' && orientationDraft.edge && (
            <>
              <div
                className="orientation-face-popup-heading"
                title="Drag to move"
                onPointerDown={startOrientationPopupDrag}
                onPointerMove={moveOrientationPopup}
                onPointerUp={stopOrientationPopupDrag}
                onPointerCancel={stopOrientationPopupDrag}
              >
                <strong>Which way does this arrow point?</strong>
                <span>This establishes the horizontal orientation.</span>
              </div>
              <div className="orientation-choice-grid horizontal">
                {horizontalDirections.map(({ direction, label }) => (
                  <button
                    key={direction}
                    type="button"
                    onClick={() => setOrientationHorizontalDirection(direction)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            className="orientation-popup-cancel"
            onClick={cancelOrientation}
          >
            Cancel
          </button>
        </div>
      )}
      {draftGridSize && draftControlPosition && (
        <div
          className="plane-size-control"
          role="dialog"
          aria-label="Grid dimensions"
          style={draftControlPosition}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div
            className="plane-size-heading"
            title="Drag to move"
            onPointerDown={startDraftControlDrag}
            onPointerMove={moveDraftControl}
            onPointerUp={stopDraftControlDrag}
            onPointerCancel={stopDraftControlDrag}
          >
            <strong>Grid size</strong>
            <span>Drag corners if needed</span>
          </div>
          <div className="plane-size-fields">
            <label>
              <span>Width</span>
              <input
                ref={draftWidthInputRef}
                type="number"
                aria-label="Grid width"
                min={MIN_GRID_SIZE}
                max={MAX_GRID_SIZE}
                value={draftGridSize.columns}
                autoFocus
                onChange={(event) =>
                  updateDraftGridSize('columns', event.currentTarget.valueAsNumber)
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') confirmDraftGrid()
                }}
              />
            </label>
            <span className="plane-size-times">×</span>
            <label>
              <span>Height</span>
              <input
                ref={draftHeightInputRef}
                type="number"
                aria-label="Grid height"
                min={MIN_GRID_SIZE}
                max={MAX_GRID_SIZE}
                value={draftGridSize.rows}
                onChange={(event) =>
                  updateDraftGridSize('rows', event.currentTarget.valueAsNumber)
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') confirmDraftGrid()
                }}
              />
            </label>
            <button
              type="button"
              className="plane-size-confirm"
              aria-label="Create grid"
              title="Create grid"
              onClick={confirmDraftGrid}
            >
              <Check size={15} />
            </button>
          </div>
        </div>
      )}
      <div className="canvas-status">
        <span>{Math.round(view.scale * 100)}%</span>
        <span>{document.image.width} × {document.image.height}</span>
        <strong>
          {sceneProjectionInfo.resolvedAxes === 3
            ? `3D camera · ${sceneProjectionInfo.rmsError.toFixed(1)} px RMS`
            : sceneProjectionInfo.resolvedAxes === 2
              ? `2D perspective · ${sceneProjectionInfo.rmsError.toFixed(1)} px RMS`
              : 'Perspective unsolved'}
        </strong>
        {tool === 'plane' && (
          <strong>
            {draft.length === 0
              ? 'Click top-left, top-right, bottom-right, then bottom-left'
              : draftGridSize
                ? 'Drag corners to adjust, set the grid size, then confirm'
                : `${4 - draft.length} corners remaining`}
          </strong>
        )}
        {tool === 'anchor' && (
          <strong>Click a block face to set it as the 0, 0, 0 anchor</strong>
        )}
        {tool === 'select' && selectedEdges.length > 0 && (
          <strong>
            {selectedEdges.length} edge{selectedEdges.length === 1 ? '' : 's'} selected · press E to extrude
          </strong>
        )}
        {tool === 'extrude' && selectedEdges.length > 0 && (
          <strong>
            {preview?.createsAxis
              ? 'Click to add the perpendicular face and solve the 3D camera'
              : `Snapped to ${preview?.blocks ?? 1} block${(preview?.blocks ?? 1) === 1 ? '' : 's'} · click to extrude`}
          </strong>
        )}
        {tool === 'orient' && (
          <strong>
            {!orientationDraft?.faceId
              ? 'Click a reference face'
              : orientationDraft.mode === 'up'
                ? orientationDraft.surfaceKind === 'side'
                  ? 'Click the arrow that points world UP'
                  : 'Choose Top, Bottom, or Side in the face popup'
                : !orientationDraft.edge
                  ? 'Click a horizontal arrow on the reference face'
                  : 'Name the arrow direction in the face popup'}
          </strong>
        )}
      </div>
    </div>
  )
}
