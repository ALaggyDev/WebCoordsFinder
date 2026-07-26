import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers3 } from 'lucide-react'
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
  cellKey,
  cellQuad,
  distance,
  evidenceId,
  flattenPoints,
  projectedWorldAxes,
} from '../domain/geometry'
import type { PerspectivePlane, Point2 } from '../domain/types'
import { useCanvasImage } from '../hooks/useCanvasImage'
import { useEditorStore } from '../store/editorStore'

const GRID = '#53e6a5'
const SELECTED = '#70a7ff'
const PROPOSED = '#f0b64d'
const CONFIRMED = '#53e6a5'
const EXCLUDED = '#68737c'

interface CanvasSize {
  width: number
  height: number
}

interface VisualizationSettings {
  axisGizmos: boolean
}

const visualizationOptions: Array<{
  key: keyof VisualizationSettings
  label: string
  description: string
}> = [
  {
    key: 'axisGizmos',
    label: 'Plane axes',
    description: 'Show X/Y/Z axes at plane origins.',
  },
]

function statusColor(status?: string): string {
  if (status === 'confirmed') return CONFIRMED
  if (status === 'proposed') return PROPOSED
  if (status === 'excluded') return EXCLUDED
  return GRID
}

function PlaneAxisGizmo({
  plane,
  scale,
  selected,
}: {
  plane: PerspectivePlane
  scale: number
  selected: boolean
}) {
  const origin = plane.corners[0]
  const directions = projectedWorldAxes(plane)
  const length = 28 / scale
  const axes = [
    { key: 'x' as const, label: 'X', color: '#ff626b' },
    { key: 'y' as const, label: 'Y', color: '#53e6a5' },
    { key: 'z' as const, label: 'Z', color: '#70a7ff' },
  ]

  return (
    <Group listening={false} opacity={selected ? 1 : 0.58}>
      <Circle
        x={origin.x}
        y={origin.y}
        radius={3.5 / scale}
        fill="#071014"
        stroke="#dce7ec"
        strokeWidth={1 / scale}
      />
      {axes.map((axis) => {
        const direction = directions[axis.key]
        const end = {
          x: origin.x + direction.x * length,
          y: origin.y + direction.y * length,
        }
        return (
          <Group key={axis.key}>
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
              stroke={axis.color}
              fill={axis.color}
              strokeWidth={2 / scale}
              pointerLength={5 / scale}
              pointerWidth={5 / scale}
            />
            <Text
              x={end.x + direction.x * (3 / scale) - 4 / scale}
              y={end.y + direction.y * (3 / scale) - 5 / scale}
              text={axis.label}
              fontFamily="Inter, Segoe UI, sans-serif"
              fontStyle="bold"
              fontSize={9 / scale}
              fill={axis.color}
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

export function EditorCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const visualizationMenuRef = useRef<HTMLDivElement>(null)
  const visualizationPointerRef = useRef(false)
  const stageRef = useRef<Konva.Stage>(null)
  const document = useEditorStore((state) => state.document)
  const tool = useEditorStore((state) => state.tool)
  const selectedPlaneId = useEditorStore((state) => state.selectedPlaneId)
  const selectedEvidenceIds = useEditorStore((state) => state.selectedEvidenceIds)
  const setSelectedPlane = useEditorStore((state) => state.setSelectedPlane)
  const selectCell = useEditorStore((state) => state.selectCell)
  const addPlane = useEditorStore((state) => state.addPlane)
  const movePlaneCorner = useEditorStore((state) => state.movePlaneCorner)
  const image = useCanvasImage(document.image.src)
  const [size, setSize] = useState<CanvasSize>({ width: 900, height: 640 })
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [draft, setDraft] = useState<Point2[]>([])
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false)
  const [visualizations, setVisualizations] = useState<VisualizationSettings>({
    axisGizmos: true,
  })

  const evidenceMap = useMemo(
    () => new Map(document.evidence.map((entry) => [entry.id, entry])),
    [document.evidence],
  )

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
      if (event.key === 'Escape') setDraft([])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const pointerInImage = (): Point2 | null => {
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer) return null
    return {
      x: (pointer.x - view.x) / view.scale,
      y: (pointer.y - view.y) / view.scale,
    }
  }

  const onStageClick = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'plane' && tool !== 'face') return
    if (event.target !== event.currentTarget && event.target.draggable()) return
    const point = pointerInImage()
    if (!point) return
    const next = [...draft, point]
    if (next.length === 4) {
      addPlane(
        next as [Point2, Point2, Point2, Point2],
        tool === 'face' ? 'up' : 'north',
        tool === 'face',
      )
      setDraft([])
    } else {
      setDraft(next)
    }
  }

  const onWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault()
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
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

  const idleCursor = tool === 'plane' || tool === 'face' ? 'crosshair' : 'grab'

  const onStageDragStart = (event: Konva.KonvaEventObject<DragEvent>) => {
    if (event.target === event.currentTarget) setIsDraggingCanvas(true)
  }

  const onStageDragEnd = (event: Konva.KonvaEventObject<DragEvent>) => {
    if (event.target !== event.currentTarget) return
    setIsDraggingCanvas(false)
    setView((current) => ({
      ...current,
      x: event.currentTarget.x(),
      y: event.currentTarget.y(),
    }))
  }

  return (
    <div className="canvas-shell" ref={containerRef}>
      <div
        ref={visualizationMenuRef}
        className="visualization-menu"
        onPointerDownCapture={() => {
          visualizationPointerRef.current = true
        }}
        onMouseLeave={() => {
          if (!visualizationPointerRef.current) return
          const activeElement = window.document.activeElement
          if (
            activeElement instanceof HTMLElement &&
            visualizationMenuRef.current?.contains(activeElement)
          ) {
            activeElement.blur()
          }
          visualizationPointerRef.current = false
        }}
      >
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
            <label
              className="visualization-option"
              key={option.key}
              aria-describedby={`visualization-tooltip-${option.key}`}
            >
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
              <span>
                <strong>{option.label}</strong>
              </span>
              <small
                className="visualization-tooltip"
                id={`visualization-tooltip-${option.key}`}
                role="tooltip"
              >
                {option.description}
              </small>
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
        onDragStart={onStageDragStart}
        onDragEnd={onStageDragEnd}
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
          {document.planes.map((plane, planeIndex) => (
            <Group key={plane.id}>
              {Array.from({ length: plane.rows }).flatMap((_, row) =>
                Array.from({ length: plane.columns }).map((__, column) => {
                  if (plane.inactiveCells.includes(cellKey(column, row))) return null
                  const id = evidenceId(plane.id, column, row)
                  const evidence = evidenceMap.get(id)
                  const selected = selectedEvidenceIds.includes(id)
                  const quad = cellQuad(plane, column, row)
                  const color = selected ? SELECTED : statusColor(evidence?.reviewStatus)
                  return (
                    <Line
                      key={id}
                      points={flattenPoints(quad)}
                      closed
                      stroke={color}
                      strokeWidth={(selected ? 1.8 : 0.8) / view.scale}
                      dash={evidence?.reviewStatus === 'proposed' ? [4 / view.scale, 3 / view.scale] : undefined}
                      fill={selected ? 'rgba(112,167,255,.18)' : evidence?.reviewStatus === 'confirmed' ? 'rgba(83,230,165,.08)' : 'rgba(0,0,0,.001)'}
                      hitStrokeWidth={8 / view.scale}
                      onClick={(event) => {
                        if (tool !== 'select') return
                        event.cancelBubble = true
                        selectCell(plane.id, column, row, event.evt.shiftKey)
                      }}
                    />
                  )
                }),
              )}
              {visualizations.axisGizmos && (
                <PlaneAxisGizmo
                  plane={plane}
                  scale={view.scale}
                  selected={selectedPlaneId === plane.id}
                />
              )}
              <Text
                x={plane.corners[0].x + 5 / view.scale}
                y={plane.corners[0].y + 5 / view.scale}
                text={`${planeIndex + 1}  ${plane.name}`}
                fontFamily="Inter, Segoe UI, sans-serif"
                fontSize={11 / view.scale}
                fill={selectedPlaneId === plane.id ? '#e7fff5' : '#b7c2c8'}
                padding={3 / view.scale}
                listening={tool !== 'select'}
                onClick={(event) => {
                  event.cancelBubble = true
                  setSelectedPlane(plane.id)
                }}
              />
              {selectedPlaneId === plane.id &&
                <>
                  {plane.corners.map((corner, cornerIndex) => (
                    <Circle
                      key={`${plane.id}-corner-${cornerIndex}`}
                      x={corner.x}
                      y={corner.y}
                      radius={5 / view.scale}
                      fill="#f5fbff"
                      stroke={GRID}
                      strokeWidth={2 / view.scale}
                      draggable
                      onDragMove={(event) =>
                        movePlaneCorner(plane.id, cornerIndex, {
                          x: event.target.x(),
                          y: event.target.y(),
                        })
                      }
                    />
                  ))}
                </>}
            </Group>
          ))}
          {draft.length > 0 && (
            <>
              <Line
                points={flattenPoints(draft)}
                stroke="#f0b64d"
                strokeWidth={1.5 / view.scale}
                dash={[5 / view.scale, 4 / view.scale]}
              />
              {draft.map((point) => (
                <Circle
                  key={`${point.x}-${point.y}`}
                  x={point.x}
                  y={point.y}
                  radius={4 / view.scale}
                  fill="#f0b64d"
                />
              ))}
            </>
          )}
        </Layer>
      </Stage>
      <div className="canvas-status">
        <span>{Math.round(view.scale * 100)}%</span>
        <span>{document.image.width} × {document.image.height}</span>
        <span>Drag to pan</span>
        {(tool === 'plane' || tool === 'face') && (
          <strong>
            {draft.length === 0 ? 'Click four corners clockwise' : `${4 - draft.length} corners remaining`}
          </strong>
        )}
        {draft.length > 1 && <span>{Math.round(distance(draft[0], draft.at(-1)!))} px</span>}
      </div>
    </div>
  )
}
