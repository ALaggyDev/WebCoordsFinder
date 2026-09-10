import { useEffect, useRef, useState } from 'react'
import { Circle, Group, Layer, Line, Shape, Text } from 'react-konva'
import type Konva from 'konva'
import {
  modelLatticePoint,
  nearestOffsetNibble,
  offsetBasis,
  offsetFromNibbles,
  offsetHandlePoint,
  offsetProfiles,
  offsetReadiness,
  worldPlaneDelta,
  worldToLocal,
} from '../domain/blockOffsets'
import { drawOffsetModels, loadOffsetTextures } from '../domain/offsetRendering'
import { projectScenePoint } from '../domain/geometry'
import type { BlockOffsetEvidence } from '../domain/types'
import { useEditorStore } from '../store/editorStore'

export function OffsetOverlay({ scale }: { scale: number }) {
  const {
    document,
    step,
    selectedOffsetId,
    offsetDragMode,
    offsetOpacity,
    offsetYOcclusion,
    selectOffset,
    updateOffset,
  } = useEditorStore()
  const [textures, setTextures] = useState(new Map<string, HTMLCanvasElement>())
  const [textureError, setTextureError] = useState(false)
  const [preview, setPreview] = useState<BlockOffsetEvidence>()
  const dragStart = useRef<BlockOffsetEvidence | undefined>(undefined)
  const previewRef = useRef<BlockOffsetEvidence | undefined>(undefined)
  const entries = document.offsets ?? []
  // Offset/position edits do not reload image assets during a drag.
  const textureKey = JSON.stringify(
    entries.map(({ blockId, modelIndex, tint }) => ({
      blockId,
      modelIndex,
      tint,
    })),
  )
  useEffect(() => {
    let cancelled = false
    const sources = JSON.parse(textureKey) as BlockOffsetEvidence[]
    loadOffsetTextures(sources)
      .then((loaded) => {
        if (!cancelled) {
          setTextures(loaded)
          setTextureError(false)
        }
      })
      .catch(() => {
        if (!cancelled) setTextureError(true)
      })
    return () => {
      cancelled = true
    }
  }, [textureKey])
  const rendered = entries.map((entry) =>
    preview?.id === entry.id ? preview : entry,
  )
  if (step !== 'offsets' || offsetReadiness(document)) return null
  const scene = document.scene
  const selected = rendered.find((entry) => entry.id === selectedOffsetId)

  function drag(event: Konva.KonvaEventObject<DragEvent>) {
    event.cancelBubble = true
    const start = dragStart.current
    if (!start) return
    const origin = modelLatticePoint(scene, start, { x: 0.5, y: 0, z: 0.5 })
    const delta = worldPlaneDelta(scene, origin, event.target.position())
    if (!delta || Math.abs(delta.x) > 10000 || Math.abs(delta.y) > 10000) return
    let next: BlockOffsetEvidence
    if (offsetDragMode === 'block') {
      const local = worldToLocal(scene, {
        x: Math.round(delta.x),
        y: 0,
        z: Math.round(delta.y),
      })
      next = {
        ...start,
        position: {
          x: start.position.x + local.x,
          y: start.position.y + local.y,
          z: start.position.z + local.z,
        },
      }
    } else {
      const profile = offsetProfiles[start.blockId]
      const offset = offsetFromNibbles(profile, start.nibbles)
      next = {
        ...start,
        nibbles: {
          ...start.nibbles,
          x: nearestOffsetNibble(profile, 'x', offset.x + delta.x),
          z: nearestOffsetNibble(profile, 'z', offset.z + delta.y),
        },
      }
    }
    previewRef.current = next
    setPreview(next)
  }

  // An unshifted footprint shows how the observed offset relates to
  // the lattice, even while the model is made transparent for comparison.
  const footprint = selected
    ? [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 },
        { x: 0, y: 0, z: 1 },
      ].map((p) =>
        projectScenePoint(
          scene,
          modelLatticePoint(scene, selected, p, { x: 0, y: 0, z: 0 }),
        ),
      )
    : []
  return (
    <Layer>
      <Shape
        listening={false}
        opacity={offsetOpacity}
        sceneFunc={(context) =>
          drawOffsetModels(
            context._context,
            scene,
            rendered,
            textures,
            offsetYOcclusion,
          )
        }
      />
      {footprint.length > 0 && footprint.every((p) => p) && (
        <Line
          listening={false}
          points={footprint.flatMap((p) => [p!.x, p!.y])}
          closed
          stroke="#e6c56e"
          strokeWidth={1 / scale}
          dash={[4 / scale, 3 / scale]}
        />
      )}
      {rendered.map((entry, index) => {
        const center = offsetHandlePoint(scene, entry)
        if (!center) return null
        const active = entry.id === selectedOffsetId
        const color =
          entry.confirmedBasis === offsetBasis(document) &&
          preview?.id !== entry.id
            ? '#53e6a5'
            : '#e6c56e'
        return (
          <Group
            key={entry.id}
            x={center.x}
            y={center.y}
            draggable
            onMouseDown={(event) => {
              event.cancelBubble = true
              selectOffset(entry.id)
            }}
            onClick={(event) => {
              event.cancelBubble = true
              selectOffset(entry.id)
            }}
            onDragStart={(event) => {
              event.cancelBubble = true
              dragStart.current = entries.find((item) => item.id === entry.id)
              selectOffset(entry.id)
            }}
            onDragMove={drag}
            onDragEnd={(event) => {
              drag(event)
              const next = previewRef.current
              const start = dragStart.current
              if (
                next &&
                start &&
                (JSON.stringify(next.position) !==
                  JSON.stringify(start.position) ||
                  JSON.stringify(next.nibbles) !==
                    JSON.stringify(start.nibbles))
              )
                updateOffset(next.id, {
                  position: next.position,
                  nibbles: next.nibbles,
                })
              const snapped = next ? offsetHandlePoint(scene, next) : center
              if (snapped) event.target.position(snapped)
              dragStart.current = undefined
              previewRef.current = undefined
              setPreview(undefined)
            }}
          >
            <Circle
              radius={(active ? 8 : 6) / scale}
              fill="#0b1014"
              stroke={color}
              strokeWidth={2 / scale}
            />
            <Circle radius={2 / scale} fill={color} listening={false} />
            <Text
              x={12 / scale}
              y={-7 / scale}
              text={`${index + 1}${active ? ` · ${offsetProfiles[entry.blockId].label}` : ''}`}
              fontSize={12 / scale}
              fill={color}
              padding={2 / scale}
              listening={false}
            />
          </Group>
        )
      })}
      {textureError && selected && (
        <Text
          x={offsetHandlePoint(scene, selected)?.x}
          y={(offsetHandlePoint(scene, selected)?.y ?? 0) + 20 / scale}
          text="Model texture unavailable. Reload to retry."
          fill="#ffad89"
          fontSize={12 / scale}
          listening={false}
        />
      )}
    </Layer>
  )
}
