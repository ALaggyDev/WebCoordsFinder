import { Pin } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  axisColor,
  isAxisMappingComplete,
  projectedAbstractAxesAtImagePoint,
  updatedAxisMapping,
  validAxisMappingCompletions,
} from '../domain/geometry'
import type {
  AbstractAxis,
  AxisMapping,
  Point2,
  SceneGeometry,
  WorldAxisLabel,
} from '../domain/types'

/*
 * The gizmo edits a right-handed mapping between projected A/B/C directions
 * and signed Minecraft axes. Two signed choices uniquely derive the third.
 */
const axes: AbstractAxis[] = ['a', 'b', 'c']

const axisOptions: Array<{ value: WorldAxisLabel; label: string }> = [
  { value: 'unknown', label: '?' },
  { value: 'x+', label: '+X' },
  { value: 'x-', label: '−X' },
  { value: 'y+', label: '+Y' },
  { value: 'y-', label: '−Y' },
  { value: 'z+', label: '+Z' },
  { value: 'z-', label: '−Z' },
]

const fallbackDirections: Record<AbstractAxis, Point2> = {
  a: { x: 0.91, y: 0.42 },
  b: { x: -0.86, y: 0.51 },
  c: { x: 0, y: -1 },
}

const origin = { x: 140, y: 95 }
const nodeRadius = 76
const nodeHalfWidth = 55
const nodeHalfHeight = 19

function isSigned(label: WorldAxisLabel): boolean {
  return label !== 'unknown'
}

function signedAxes(mapping: AxisMapping): AbstractAxis[] {
  return axes.filter((axis) => isSigned(mapping[axis]))
}

function normalizeDirection(direction: Point2): Point2 | undefined {
  const length = Math.hypot(direction.x, direction.y)
  if (length < 1e-8) return undefined
  return { x: direction.x / length, y: direction.y / length }
}

function displayDirections(
  scene: SceneGeometry,
  directionReference: Point2,
): Record<AbstractAxis, Point2> {
  const projected = projectedAbstractAxesAtImagePoint(scene, directionReference)
  const result: Partial<Record<AbstractAxis, Point2>> = { ...projected }
  const known = axes.filter((axis) => result[axis])

  if (known.length === 2) {
    // A planar calibration cannot project its normal. Synthesize a stable
    // display-only direction until the camera fit resolves all three axes.
    const missing = axes.find((axis) => !result[axis])!
    const first = result[known[0]]!
    const second = result[known[1]]!
    result[missing] =
      normalizeDirection({
        x: -(first.x + second.x),
        y: -(first.y + second.y),
      }) ??
      normalizeDirection({ x: -first.y, y: first.x }) ??
      fallbackDirections[missing]
  }

  return Object.fromEntries(
    axes.map((axis) => [axis, result[axis] ?? fallbackDirections[axis]]),
  ) as Record<AbstractAxis, Point2>
}

function axisLayout(direction: Point2): {
  arrowPath: string
  nodeStyle: CSSProperties
} {
  const center = {
    x: origin.x + direction.x * nodeRadius,
    y: origin.y + direction.y * nodeRadius,
  }
  const edgeDistance = Math.min(
    direction.x === 0
      ? Number.POSITIVE_INFINITY
      : nodeHalfWidth / Math.abs(direction.x),
    direction.y === 0
      ? Number.POSITIVE_INFINITY
      : nodeHalfHeight / Math.abs(direction.y),
  )
  const end = {
    x: center.x - direction.x * edgeDistance,
    y: center.y - direction.y * edgeDistance,
  }
  return {
    arrowPath: `M ${origin.x.toFixed(2)} ${origin.y.toFixed(2)} L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
    nodeStyle: {
      left: `${(center.x / 280) * 100}%`,
      top: `${(center.y / 190) * 100}%`,
    },
  }
}

interface AxisMappingGizmoProps {
  mapping: AxisMapping
  scene: SceneGeometry
  directionReference: Point2
  onChange: (mapping: AxisMapping) => void
}

export function AxisMappingGizmo({
  mapping,
  scene,
  directionReference,
  onChange,
}: AxisMappingGizmoProps) {
  const [anchoredAxis, setAnchoredAxis] = useState<AbstractAxis | null>(null)
  const [lastEditedAxis, setLastEditedAxis] = useState<AbstractAxis | null>(null)
  const directions = useMemo(
    () => displayDirections(scene, directionReference),
    [directionReference, scene],
  )
  const layouts = useMemo(
    () =>
      Object.fromEntries(
        axes.map((axis) => [axis, axisLayout(directions[axis])]),
      ) as Record<AbstractAxis, ReturnType<typeof axisLayout>>,
    [directions],
  )

  useEffect(() => {
    if (isAxisMappingComplete(mapping)) return
    const selected = signedAxes(mapping)
    const completions = validAxisMappingCompletions(mapping)
    if (selected.length !== 2 || completions.length !== 1) return
    // Complete the mapping as soon as handedness leaves one valid choice.
    setAnchoredAxis((current) => current ?? selected[0])
    onChange(completions[0])
  }, [mapping, onChange])

  const selectAxis = (axis: AbstractAxis, label: WorldAxisLabel) => {
    let nextAnchor = anchoredAxis
    if (!nextAnchor && isSigned(label)) {
      nextAnchor = axis
      setAnchoredAxis(axis)
    }

    // Prefer the explicitly pinned axis, then the last edit, so changing a
    // second axis deterministically recalculates the remaining one.
    const protectedAxis =
      nextAnchor && nextAnchor !== axis && isSigned(mapping[nextAnchor])
        ? nextAnchor
        : lastEditedAxis &&
            lastEditedAxis !== axis &&
            isSigned(mapping[lastEditedAxis])
          ? lastEditedAxis
          : axes.find(
              (candidate) =>
                candidate !== axis && isSigned(mapping[candidate]),
            )
    const derivedAxis = protectedAxis
      ? axes.find(
          (candidate) =>
            candidate !== axis && candidate !== protectedAxis,
        )
      : undefined
    const base: AxisMapping = { ...mapping }
    if (derivedAxis) base[derivedAxis] = 'unknown'

    const next = updatedAxisMapping(base, axis, label)
    const selected = signedAxes(next)
    const completions = validAxisMappingCompletions(next)
    setLastEditedAxis(isSigned(label) ? axis : null)

    onChange(
      selected.length === 2 && completions.length === 1
        ? completions[0]
        : next,
    )
  }

  return (
    <div
      className="axis-mapping-gizmo"
      aria-label="Global axis direction gizmo"
    >
      <svg
        aria-hidden="true"
        className="axis-mapping-lines"
        viewBox="0 0 280 190"
      >
        <defs>
          {axes.map((axis) => (
            <marker
              id={`axis-mapping-arrow-${axis}`}
              key={axis}
              markerHeight="8"
              markerUnits="userSpaceOnUse"
              markerWidth="8"
              orient="auto"
              refX="7"
              refY="4"
              viewBox="0 0 8 8"
            >
              <path
                d="M 0 0 L 8 4 L 0 8 Z"
                fill={axisColor(axis, mapping)}
                stroke="#061014"
                strokeWidth="1.2"
              />
            </marker>
          ))}
        </defs>
        {axes.map((axis) => (
          <g key={axis}>
            <path
              d={layouts[axis].arrowPath}
              fill="none"
              stroke="#061014"
              strokeLinecap="round"
              strokeWidth="7"
            />
            <path
              d={layouts[axis].arrowPath}
              data-axis-arrow={axis}
              fill="none"
              markerEnd={`url(#axis-mapping-arrow-${axis})`}
              stroke={axisColor(axis, mapping)}
              strokeLinecap="round"
              strokeWidth="3"
            />
          </g>
        ))}
        <circle
          cx={origin.x}
          cy={origin.y}
          fill="#071014"
          r="6"
          stroke="#dce7ec"
          strokeWidth="1.5"
        />
        <circle cx={origin.x} cy={origin.y} fill="#dce7ec" r="1.5" />
      </svg>

      {axes.map((axis) => {
        const anchored = anchoredAxis === axis
        const color = axisColor(axis, mapping)
        return (
          <div
            className={`axis-mapping-node${anchored ? ' anchored' : ''}`}
            key={axis}
            style={{
              ...layouts[axis].nodeStyle,
              '--axis-color': color,
            } as CSSProperties}
          >
            <span className="axis-mapping-name">{axis.toUpperCase()}</span>
            <select
              aria-label={`Abstract ${axis.toUpperCase()} direction`}
              onChange={(event) =>
                selectAxis(axis, event.target.value as WorldAxisLabel)
              }
              value={mapping[axis]}
            >
              {axisOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              aria-label={`${anchored ? 'Unanchor' : 'Anchor'} abstract ${axis.toUpperCase()} axis`}
              aria-pressed={anchored}
              className="axis-mapping-pin"
              onClick={() =>
                setAnchoredAxis((current) =>
                  current === axis ? null : axis,
                )
              }
              title={anchored ? 'Axis anchored' : 'Keep this axis fixed'}
              type="button"
            >
              <Pin size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
