import { useEffect, useMemo, useRef, useState } from 'react'
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
  add3,
  axisColor,
  axisDisplayLabel,
  cameraFacingNormal,
  chooseEdgeExtrusion,
  createEdgeExtrusionFaces,
  distance,
  faceCornersLattice,
  faceEdgeGeometry,
  faceNormalIndicator,
  faceQuad,
  fitHomography,
  flattenPoints,
  meshEdgeKey,
  projectionInfo,
  projectPoint,
  projectScenePoint,
  projectedAbstractAxesAtImagePoint,
  refitProjection,
  selectedEdgeGeometry,
  same3,
  scale3,
  translatedExtrusionAnchors,
} from '../domain/geometry'
import type {
  AbstractAxis,
  CalibrationObservation,
  FaceEdge,
  MeshFace,
  Point2,
  SceneGeometry,
  SelectedEdge,
} from '../domain/types'
import { useCanvasImage } from '../hooks/useCanvasImage'
import { useEditorStore } from '../store/editorStore'

const GRID = '#53e6a5'
const SELECTED = '#70a7ff'
const PROPOSED = '#f0b64d'
const ANCHOR = '#ff626b'
const CONFIRMED = '#53e6a5'
const EDGE = '#d6e0e5'

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

interface DraftGridSize {
  columns: number
  rows: number
}

interface DraftControlDrag {
  pointerId: number
  startPointer: Point2
  startOffset: Point2
}

const DEFAULT_GRID_SIZE = 4
const MIN_GRID_SIZE = 1
const MAX_GRID_SIZE = 128
const DRAFT_CONTROL_HALF_WIDTH = 132
const DRAFT_CONTROL_HALF_HEIGHT = 66

const visualizationOptions: Array<{
  key: keyof VisualizationSettings
  label: string
  description: string
}> = [
  {
    key: 'axisGizmo',
    label: 'Global axes',
    description: 'Show the known global lattice directions.',
  },
  {
    key: 'faceNormals',
    label: 'Face normals',
    description:
      'Show visible-side normals. Planar calibration uses a screen-space side indicator.',
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
]

const faceEdges: FaceEdge[] = ['top', 'right', 'bottom', 'left']

function statusColor(status?: string): string {
  if (status === 'confirmed') return CONFIRMED
  if (status === 'proposed') return PROPOSED
  return GRID
}

function makeExtrusionPreview(
  scene: SceneGeometry,
  selections: SelectedEdge[],
  pointer: Point2,
): { scene: SceneGeometry; blocks: number; createsAxis: boolean } | undefined {
  const extrusion = chooseEdgeExtrusion(scene, selections, pointer)
  if (!extrusion) return undefined
  let previewId = 0
  const faces = createEdgeExtrusionFaces(
    scene,
    selections,
    extrusion.axis,
    extrusion.blocks,
    () => `__preview_${previewId++}__`,
  )
  const previewScene: SceneGeometry = {
    ...scene,
    faces: [...scene.faces, ...faces],
  }
  if (
    projectionInfo(scene).resolvedAxes === 3 ||
    !extrusion.createsAxis
  ) {
    return {
      scene: previewScene,
      blocks: extrusion.blocks,
      createsAxis: extrusion.createsAxis,
    }
  }

  const translated = translatedExtrusionAnchors(scene, selections, pointer)
  if (!translated) return undefined
  const anchors: CalibrationObservation[] = [{
    id: '__preview_anchor__',
    lattice: add3(
      translated.endpoints[0],
      scale3(extrusion.axis, extrusion.blocks),
    ),
    image: translated.images[0],
    weight: 1,
  }, {
    id: '__preview_anchor_2__',
    lattice: add3(
      translated.endpoints[1],
      scale3(extrusion.axis, extrusion.blocks),
    ),
    image: translated.images[1],
    weight: 1,
  }]
  previewScene.observations = [
    ...scene.observations.filter(
      (observation) =>
        !anchors.some((anchor) => same3(observation.lattice, anchor.lattice)),
    ),
    ...anchors,
  ]
  try {
    previewScene.projection = refitProjection(previewScene)
    faces.forEach((face) => {
      face.normal = cameraFacingNormal(previewScene, face)
    })
    return {
      scene: previewScene,
      blocks: extrusion.blocks,
      createsAxis: extrusion.createsAxis,
    }
  } catch {
    return undefined
  }
}

function GlobalAxisGizmo({
  scene,
  origin,
  directionReference,
  scale,
}: {
  scene: SceneGeometry
  origin: Point2
  directionReference: Point2
  scale: number
}) {
  const directions = projectedAbstractAxesAtImagePoint(
    scene,
    directionReference,
  )
  const axes = (['a', 'b', 'c'] as AbstractAxis[]).filter(
    (axis) => directions[axis],
  )
  const length = 30 / scale
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
      {axes.map((axis) => {
        const direction = directions[axis]!
        const color = axisColor(axis, scene.axisMapping)
        const end = {
          x: origin.x + direction.x * length,
          y: origin.y + direction.y * length,
        }
        return (
          <Group key={axis}>
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
              x={end.x + direction.x * (4 / scale) - 7 / scale}
              y={end.y + direction.y * (4 / scale) - 5 / scale}
              text={axisDisplayLabel(axis, scene.axisMapping)}
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
  const quad = faceQuad(scene, face)
  if (!quad) return null
  const origin = {
    x: quad.reduce((sum, point) => sum + point.x, 0) / quad.length,
    y: quad.reduce((sum, point) => sum + point.y, 0) / quad.length,
  }
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
        dash={indicator.planarFallback ? [3 / scale, 2 / scale] : undefined}
      />
    </Group>
  )
}

export function EditorCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const visualizationMenuRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const draftControlDragRef = useRef<DraftControlDrag>(undefined)
  const draftWidthInputRef = useRef<HTMLInputElement>(null)
  const draftHeightInputRef = useRef<HTMLInputElement>(null)
  const document = useEditorStore((state) => state.document)
  const tool = useEditorStore((state) => state.tool)
  const selectedEdges = useEditorStore((state) => state.selectedEdges)
  const selectedEvidenceIds = useEditorStore((state) => state.selectedEvidenceIds)
  const setTool = useEditorStore((state) => state.setTool)
  const toggleSelectedEdge = useEditorStore((state) => state.toggleSelectedEdge)
  const clearSelectedEdges = useEditorStore((state) => state.clearSelectedEdges)
  const selectFace = useEditorStore((state) => state.selectFace)
  const setAnchorFace = useEditorStore((state) => state.setAnchorFace)
  const addBaseFaces = useEditorStore((state) => state.addBaseFaces)
  const moveObservation = useEditorStore((state) => state.moveObservation)
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
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false)
  const [draggedObservation, setDraggedObservation] = useState<DraggedObservation>()
  const [pointerPoint, setPointerPoint] = useState<Point2>()
  const [visualizations, setVisualizations] = useState<VisualizationSettings>({
    axisGizmo: true,
    faceNormals: false,
    anchorMarker: true,
    calibrationPoints: true,
    calibrationResiduals: true,
  })

  const renderedScene = useMemo(() => {
    if (!draggedObservation) return document.scene
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
  const documentProjectionInfo = useMemo(
    () => projectionInfo(document.scene),
    [document.scene],
  )
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
  const anchorFace = document.anchorFaceId
    ? sceneForRendering.faces.find((face) => face.id === document.anchorFaceId)
    : undefined
  const meshEdges = useMemo(() => {
    const edges = new Map<string, RenderedMeshEdge>()
    renderedScene.faces.forEach((face) => {
      if (face.id.startsWith('__preview_')) return
      faceEdges.forEach((edge) => {
        const geometry = faceEdgeGeometry(face, edge)
        const key = meshEdgeKey(geometry.start, geometry.end)
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
    const center = draft.reduce(
      (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
      { x: 0, y: 0 },
    )
    return {
      left: view.x + center.x * view.scale,
      top: view.y + center.y * view.scale,
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
        if (tool === 'extrude' || tool === 'anchor') setTool('select')
        else if (tool === 'select') clearSelectedEdges()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearSelectedEdges, setTool, tool])

  useEffect(() => {
    if (!draftGridSize) return
    const attachWheelHandler = (
      input: HTMLInputElement | null,
      dimension: keyof DraftGridSize,
    ) => {
      if (!input) return () => {}
      const onInputWheel = (event: WheelEvent) => {
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
    return {
      x: (pointer.x - view.x) / view.scale,
      y: (pointer.y - view.y) / view.scale,
    }
  }

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

  const onStageClick = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (draft.length === 4 && draftGridSize) {
      confirmDraftGrid()
      return
    }
    if (event.target !== event.currentTarget && event.target.draggable()) return
    const point = pointerInImage()
    if (!point) return
    if (tool === 'extrude' && selectedEdges.length > 0) {
      extrudeSelectedEdges(point)
      return
    }
    if (tool === 'select') {
      clearSelectedEdges()
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
    setView({
      scale: nextScale,
      x: pointer.x - anchor.x * nextScale,
      y: pointer.y - anchor.y * nextScale,
    })
  }

  const idleCursor =
    tool === 'plane' || tool === 'anchor'
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
        draggable={tool !== 'extrude' && tool !== 'plane' && tool !== 'anchor'}
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
        onMouseMove={() => setPointerPoint(pointerInImage() ?? undefined)}
        onMouseLeave={() => setPointerPoint(undefined)}
        onWheel={onWheel}
        onClick={onStageClick}
        style={{ cursor: isDraggingCanvas ? 'grabbing' : idleCursor }}
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
            const quad = faceQuad(sceneForRendering, face)
            if (!quad) return null
            const color = isPreview
              ? PROPOSED
              : selected
                ? SELECTED
                : statusColor(evidence?.reviewStatus)
            return (
              <Line
                key={face.id}
                points={flattenPoints(quad)}
                closed
                stroke={color}
                opacity={isPreview ? 0.72 : 1}
                strokeWidth={(selected ? 1.8 : 0.8) / view.scale}
                dash={
                  isPreview || evidence?.reviewStatus === 'proposed'
                    ? [4 / view.scale, 3 / view.scale]
                    : undefined
                }
                fill={
                  selected
                    ? 'rgba(112,167,255,.18)'
                    : evidence?.reviewStatus === 'confirmed'
                      ? 'rgba(83,230,165,.08)'
                      : 'rgba(0,0,0,.001)'
                }
                hitStrokeWidth={8 / view.scale}
                listening={
                  !isPreview &&
                  (tool === 'select' || tool === 'anchor')
                }
                onClick={(event) => {
                  event.cancelBubble = true
                  if (tool === 'anchor') setAnchorFace(face.id)
                  else if (tool === 'select') selectFace(face.id, event.evt.shiftKey)
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
                onClick={(event) => {
                  event.cancelBubble = true
                  toggleSelectedEdge(selection)
                }}
              />
            )
          })}
          {visualizations.faceNormals &&
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
                  if (distance(observation.image, point) > 0.01) {
                    moveObservation(observation.id, point)
                  }
                  setDraggedObservation(undefined)
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
              {draft.map((point) => (
                <Circle
                  key={`${point.x}-${point.y}`}
                  x={point.x}
                  y={point.y}
                  radius={4 / view.scale}
                  fill={PROPOSED}
                />
              ))}
            </>
          )}
        </Layer>
      </Stage>
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
            <span>Click canvas to apply</span>
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
      {visualizations.axisGizmo && sceneForRendering.faces.length > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          listening={false}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          <Layer listening={false}>
            <GlobalAxisGizmo
              scene={sceneForRendering}
              origin={{ x: size.width - 74, y: size.height - 72 }}
              directionReference={{
                x: document.image.width / 2,
                y: document.image.height / 2,
              }}
              scale={1}
            />
          </Layer>
        </Stage>
      )}
      <div className="canvas-status">
        <span>{Math.round(view.scale * 100)}%</span>
        <span>{document.image.width} × {document.image.height}</span>
        <strong>
          {sceneProjectionInfo.resolvedAxes === 3
            ? `3D camera · ${sceneProjectionInfo.rmsError.toFixed(1)} px RMS`
            : `Planar calibration · ${sceneForRendering.observations.length} anchors · ${sceneProjectionInfo.rmsError.toFixed(1)} px RMS`}
        </strong>
        {tool === 'plane' && (
          <strong>
            {draft.length === 0
              ? 'Click top-left, top-right, bottom-right, then bottom-left'
              : draftGridSize
                ? 'Set the grid size, then click the canvas to create it'
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
            {documentProjectionInfo.resolvedAxes === 3
              ? `Snapped to ${preview?.blocks ?? 1} block${(preview?.blocks ?? 1) === 1 ? '' : 's'} · click to extrude`
              : preview && !preview.createsAxis
                ? `Along plane · ${preview.blocks} block${preview.blocks === 1 ? '' : 's'} · click to extrude`
                : 'New axis · move both endpoints together and click'}
          </strong>
        )}
      </div>
    </div>
  )
}
