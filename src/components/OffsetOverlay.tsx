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
  worldVerticalDelta,
} from '../domain/blockOffsets'
import { drawOffsetModels, loadOffsetTextures } from '../domain/offsetRendering'
import { projectScenePoint } from '../domain/geometry'
import type { BlockOffsetEvidence } from '../domain/types'
import { useEditorStore } from '../store/editorStore'

type OffsetDragKind =
  | 'within-horizontal'
  | 'within-vertical'
  | 'block-horizontal'
  | 'block-vertical'

function dragKind(shiftKey: boolean, ctrlKey: boolean): OffsetDragKind {
  if (shiftKey) return ctrlKey ? 'block-vertical' : 'within-vertical'
  return ctrlKey ? 'block-horizontal' : 'within-horizontal'
}

export function OffsetOverlay({
  scale,
  showModels,
}: {
  scale: number
  showModels: boolean
}) {
  const {
    document,
    step,
    selectedOffsetId,
    offsetOpacity,
    offsetYOcclusion,
    selectOffset,
    updateOffset,
  } = useEditorStore()
  const [textures, setTextures] = useState(new Map<string, HTMLCanvasElement>())
  const [textureError, setTextureError] = useState(false)
  const [preview, setPreview] = useState<BlockOffsetEvidence>()
  const [activeDragKind, setActiveDragKind] = useState<OffsetDragKind>()
  const [dragHandle, setDragHandle] = useState<{
    id: string
    position: { x: number; y: number }
  }>()
  const activeDragKindRef = useRef<OffsetDragKind | undefined>(undefined)
  const gestureStart = useRef<BlockOffsetEvidence | undefined>(undefined)
  const dragStart = useRef<BlockOffsetEvidence | undefined>(undefined)
  const dragPosition = useRef<{ x: number; y: number } | undefined>(undefined)
  const dragReferencePosition = useRef<
    { x: number; y: number } | undefined
  >(undefined)
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
    if (!showModels) return
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
  }, [showModels, textureKey])
  const rendered = entries.map((entry) =>
    preview?.id === entry.id ? preview : entry,
  )
  const interactive = step === 'offsets'
  const scene = document.scene
  const selected = rendered.find((entry) => entry.id === selectedOffsetId)

  function updateDrag(
    position: { x: number; y: number },
    kind: OffsetDragKind,
  ) {
    const start = dragStart.current
    const reference = dragReferencePosition.current
    if (!start || !reference) return
    const origin = modelLatticePoint(scene, start, { x: 0.5, y: 0, z: 0.5 })
    const projectedOrigin = projectScenePoint(scene, origin)
    if (!projectedOrigin) return
    // Every modifier transition begins a new sub-drag at the current snapped
    // model position. Apply only subsequent pointer movement to that baseline.
    const effectivePosition = {
      x: projectedOrigin.x + position.x - reference.x,
      y: projectedOrigin.y + position.y - reference.y,
    }
    activeDragKindRef.current = kind
    setActiveDragKind(kind)
    let next: BlockOffsetEvidence
    if (kind === 'block-vertical' || kind === 'within-vertical') {
      const delta = worldVerticalDelta(scene, origin, effectivePosition)
      if (delta === undefined || Math.abs(delta) > 10000) return
      if (kind === 'block-vertical') {
        const local = worldToLocal(scene, {
          x: 0,
          y: Math.round(delta),
          z: 0,
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
        if (profile.type !== 'XYZ') next = start
        else {
          const offset = offsetFromNibbles(profile, start.nibbles)
          next = {
            ...start,
            nibbles: {
              ...start.nibbles,
              y: nearestOffsetNibble(profile, 'y', offset.y + delta),
            },
          }
        }
      }
    } else {
      const delta = worldPlaneDelta(scene, origin, effectivePosition)
      if (!delta || Math.abs(delta.x) > 10000 || Math.abs(delta.y) > 10000)
        return
      if (kind === 'block-horizontal') {
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
    }
    previewRef.current = next
    setPreview(next)
  }

  function switchDragKind(
    kind: OffsetDragKind,
    position: { x: number; y: number },
    reinterpretDisplacement: boolean,
  ) {
    if (!dragStart.current || kind === activeDragKindRef.current) return
    // Pressing a modifier applies the new mode to displacement already made
    // in this segment. Releasing preserves the current preview instead.
    if (reinterpretDisplacement) {
      dragStart.current = previewRef.current ?? dragStart.current
      updateDrag(position, kind)
    }
    dragStart.current = previewRef.current ?? dragStart.current
    dragReferencePosition.current = { ...position }
    updateDrag(position, kind)
  }

  function drag(event: Konva.KonvaEventObject<DragEvent>) {
    event.cancelBubble = true
    const position = event.target.position()
    if (dragStart.current)
      setDragHandle({ id: dragStart.current.id, position: { ...position } })
    const kind = dragKind(event.evt.shiftKey, event.evt.ctrlKey)
    // Key events normally switch the mode first. This fallback preserves the
    // previous pointer position if a browser reports the transition only on
    // the next pointer event.
    const previousKind = activeDragKindRef.current
    const addsModifier =
      previousKind !== undefined &&
      ((!previousKind.endsWith('vertical') && kind.endsWith('vertical')) ||
        (!previousKind.startsWith('block') && kind.startsWith('block')))
    switchDragKind(
      kind,
      addsModifier ? position : dragPosition.current ?? position,
      addsModifier,
    )
    dragPosition.current = { ...position }
    updateDrag(position, kind)
  }

  useEffect(() => {
    function updateModifiers(event: KeyboardEvent) {
      if (
        !dragStart.current ||
        !dragPosition.current ||
        (event.key !== 'Shift' && event.key !== 'Control')
      )
        return
      switchDragKind(
        dragKind(event.shiftKey, event.ctrlKey),
        dragPosition.current,
        event.type === 'keydown',
      )
    }
    window.addEventListener('keydown', updateModifiers)
    window.addEventListener('keyup', updateModifiers)
    return () => {
      window.removeEventListener('keydown', updateModifiers)
      window.removeEventListener('keyup', updateModifiers)
    }
  })

  if ((!showModels && !interactive) || offsetReadiness(document)) return null

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
  const verticalGuide = (() => {
    if (!selected || !activeDragKind?.endsWith('vertical')) return undefined
    const origin = modelLatticePoint(scene, selected, { x: 0.5, y: 0, z: 0.5 })
    const worldY = worldToLocal(scene, { x: 0, y: 1, z: 0 })
    const center = projectScenePoint(scene, origin)
    const unit = projectScenePoint(scene, {
      x: origin.x + worldY.x,
      y: origin.y + worldY.y,
      z: origin.z + worldY.z,
    })
    if (!center || !unit) return undefined
    const dx = unit.x - center.x
    const dy = unit.y - center.y
    const length = Math.hypot(dx, dy)
    if (length < 1e-5) return undefined
    const extent = 2000 / length
    return [
      center.x - dx * extent,
      center.y - dy * extent,
      center.x + dx * extent,
      center.y + dy * extent,
    ]
  })()
  return (
    <Layer>
      {showModels && (
        <Shape
          listening={false}
          // Konva buffers translucent shapes with both fill and stroke before
          // applying opacity. These inert paints make the custom texture
          // renderer use that path, so crossed model planes are flattened once
          // instead of blending every tessellated triangle independently.
          fill="transparent"
          stroke="transparent"
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
      )}
      {interactive && footprint.length > 0 && footprint.every((p) => p) && (
        <Line
          listening={false}
          points={footprint.flatMap((p) => [p!.x, p!.y])}
          closed
          stroke="#e6c56e"
          strokeWidth={1 / scale}
          dash={[4 / scale, 3 / scale]}
        />
      )}
      {interactive && verticalGuide && (
        <Line
          listening={false}
          points={verticalGuide}
          stroke="#e6c56e"
          strokeWidth={1 / scale}
          dash={[6 / scale, 5 / scale]}
        />
      )}
      {interactive && rendered.map((entry, index) => {
        const center = offsetHandlePoint(scene, entry)
        if (!center) return null
        const active = entry.id === selectedOffsetId
        const controlPosition =
          dragHandle?.id === entry.id ? dragHandle.position : center
        const color =
          entry.confirmedBasis === offsetBasis(document) &&
          preview?.id !== entry.id
            ? '#53e6a5'
            : '#e6c56e'
        return (
          <Group
            key={entry.id}
            x={controlPosition.x}
            y={controlPosition.y}
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
              const start = entries.find((item) => item.id === entry.id)
              const position = event.target.position()
              gestureStart.current = start
              dragStart.current = start
              dragPosition.current = { ...position }
              dragReferencePosition.current = { ...position }
              previewRef.current = undefined
              setDragHandle({ id: entry.id, position: { ...position } })
              const kind = dragKind(event.evt.shiftKey, event.evt.ctrlKey)
              activeDragKindRef.current = kind
              setActiveDragKind(kind)
              selectOffset(entry.id)
            }}
            onDragMove={drag}
            onDragEnd={(event) => {
              drag(event)
              const next = previewRef.current
              const start = gestureStart.current
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
              activeDragKindRef.current = undefined
              gestureStart.current = undefined
              dragStart.current = undefined
              dragPosition.current = undefined
              dragReferencePosition.current = undefined
              previewRef.current = undefined
              setPreview(undefined)
              setActiveDragKind(undefined)
              setDragHandle(undefined)
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
      {showModels && interactive && textureError && selected && (
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
