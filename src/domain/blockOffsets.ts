import { z } from 'zod'
import bundledModels from './offsetModels.json'
import {
  isAxisMappingComplete,
  localVectorForWorld,
  projectScenePoint,
  sceneLatticeParity,
} from './geometry'
import type {
  BlockOffsetEvidence,
  EditorDocument,
  Point2,
  Point3,
  SceneGeometry,
} from './types'

export interface ModelFace {
  texture: string
  uv?: number[]
  rotation?: number
  tintindex?: number
}
export interface ModelElement {
  from: number[]
  to: number[]
  rotation?: {
    origin: number[]
    axis: 'x' | 'y' | 'z'
    angle: number
    rescale?: boolean
  }
  faces: Record<string, ModelFace>
}
export interface OffsetProfile {
  label: string
  type: 'XZ' | 'XYZ'
  horizontal: number
  vertical: number
  variants: {
    label: string
    parts: { x: number; y: number; elements: ModelElement[] }[]
  }[]
}
export const offsetProfiles = bundledModels as unknown as Record<
  string,
  OffsetProfile
>
const integerPoint = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
})
const nibble = z.number().int().min(0).max(15)
export const offsetEvidenceSchema = z
  .object({
    id: z.string().min(1),
    blockId: z.string(),
    modelIndex: z.number().int().nonnegative(),
    position: integerPoint,
    nibbles: z.object({ x: nibble, y: nibble, z: nibble }),
    tint: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    grassTint: z
      .object({
        temperature: z.number().min(0).max(1),
        downfall: z.number().min(0).max(1),
      })
      .optional(),
    ignored: z.boolean().optional(),
    confirmedBasis: z.string().optional(),
  })
  .refine((entry) => {
    if (!Object.hasOwn(offsetProfiles, entry.blockId)) return false
    const profile = offsetProfiles[entry.blockId]
    return (
      profile &&
      entry.modelIndex < profile.variants.length &&
      (profile.type === 'XYZ' || entry.nibbles.y === 0)
    )
  }, 'Unknown offset model or invalid vertical offset.')
export const offsetEvidenceListSchema = z
  .array(offsetEvidenceSchema)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.id)).size === entries.length,
    'Offset observation IDs must be unique.',
  )

export function offsetReadiness(document: EditorDocument): string | undefined {
  if (document.scene.projection?.kind !== 'camera')
    return 'Build and calibrate a 3D mesh in Geometry first. A planar solve cannot align decoration models.'
  if (
    !document.scanner.compassResolved ||
    !isAxisMappingComplete(
      document.scene.axisMapping,
      sceneLatticeParity(document.scene),
    )
  )
    return 'Confirm UP and a horizontal compass direction in Geometry first.'
  return undefined
}

export function offsetBasis(document: EditorDocument): string {
  return JSON.stringify([document.scene.projection, document.scene.axisMapping])
}

/** Matches Java float division before double subtraction and multiplication. */
export function offsetFromNibbles(
  profile: OffsetProfile,
  nibbles: Point3,
): Point3 {
  const horizontal = (n: number) =>
    Math.max(
      -profile.horizontal,
      Math.min(profile.horizontal, (Math.fround(n / 15) - 0.5) * 0.5),
    )
  return {
    x: horizontal(nibbles.x),
    y:
      profile.type === 'XYZ'
        ? (Math.fround(nibbles.y / 15) - 1) * Math.fround(profile.vertical)
        : 0,
    z: horizontal(nibbles.z),
  }
}

export function nearestOffsetNibble(
  profile: OffsetProfile,
  axis: 'x' | 'y' | 'z',
  value: number,
): number {
  // Dripstone's outer horizontal seeds all produce the same clipped endpoint.
  // Dragging should select the first and last usable slider seeds instead.
  const clipped = axis !== 'y' && profile.horizontal === 0.125
  const min = clipped ? 3 : 0
  const max = clipped ? 12 : 15
  const valueFor = (n: number) =>
    offsetFromNibbles(profile, {
      x: axis === 'x' ? n : 0,
      y: axis === 'y' ? n : 0,
      z: axis === 'z' ? n : 0,
    })[axis]
  let best = min
  for (let n = min + 1; n <= max; n++) {
    if (Math.abs(valueFor(n) - value) < Math.abs(valueFor(best) - value))
      best = n
  }
  return best
}

/** Invert a canvas drag constrained to the projected world-Y line. */
export function worldVerticalDelta(
  scene: SceneGeometry,
  origin: Point3,
  image: Point2,
): number | undefined {
  if (scene.projection?.kind !== 'camera') return undefined
  const m = scene.projection.matrix
  const worldY = worldToLocal(scene, { x: 0, y: 1, z: 0 })
  const projectedOrigin = projectScenePoint(scene, origin)
  const projectedUnit = projectScenePoint(scene, {
    x: origin.x + worldY.x,
    y: origin.y + worldY.y,
    z: origin.z + worldY.z,
  })
  if (!projectedOrigin || !projectedUnit) return undefined

  // Ignore pointer drift perpendicular to the projected vertical axis.
  const line = {
    x: projectedUnit.x - projectedOrigin.x,
    y: projectedUnit.y - projectedOrigin.y,
  }
  const lengthSquared = line.x * line.x + line.y * line.y
  if (lengthSquared < 1e-10) return undefined
  const along =
    ((image.x - projectedOrigin.x) * line.x +
      (image.y - projectedOrigin.y) * line.y) /
    lengthSquared
  const constrained = {
    x: projectedOrigin.x + along * line.x,
    y: projectedOrigin.y + along * line.y,
  }

  const row = (i: number, p: Point3) =>
    m[i] * p.x + m[i + 1] * p.y + m[i + 2] * p.z
  const depth = row(8, origin) + m[11]
  const depthDelta = row(8, worldY)
  let numerator = 0
  let denominator = 0
  for (const [rowIndex, coordinate] of [
    [0, constrained.x],
    [4, constrained.y],
  ] as const) {
    const coefficient = row(rowIndex, worldY) - coordinate * depthDelta
    const result = coordinate * depth - row(rowIndex, origin) - m[rowIndex + 3]
    numerator += coefficient * result
    denominator += coefficient * coefficient
  }
  if (denominator < 1e-10) return undefined
  const delta = numerator / denominator
  return Number.isFinite(delta) ? delta : undefined
}

/** Convert a displacement, not an absolute block coordinate, into local axes. */
export function worldToLocal(scene: SceneGeometry, world: Point3): Point3 {
  const result = { x: 0, y: 0, z: 0 }
  for (const axis of ['x', 'y', 'z'] as const) {
    const vector = localVectorForWorld(scene.axisMapping, {
      x: +(axis === 'x'),
      y: +(axis === 'y'),
      z: +(axis === 'z'),
    })
    if (!vector) throw new Error('A complete world mapping is required.')
    for (const local of ['x', 'y', 'z'] as const)
      result[local] += vector[local] * world[axis]
  }
  return result
}

/** Models use world axes around the owning block center, including reflected lattices. */
export function modelLatticePoint(
  scene: SceneGeometry,
  entry: BlockOffsetEvidence,
  model: Point3,
  offset = offsetFromNibbles(offsetProfiles[entry.blockId], entry.nibbles),
): Point3 {
  const delta = worldToLocal(scene, {
    x: model.x - 0.5 + offset.x,
    y: model.y - 0.5 + offset.y,
    z: model.z - 0.5 + offset.z,
  })
  return {
    x: entry.position.x + 0.5 + delta.x,
    y: entry.position.y + 0.5 + delta.y,
    z: entry.position.z + 0.5 + delta.z,
  }
}

/** Invert the projective XZ plane at a fixed world height for canvas dragging. */
export function worldPlaneDelta(
  scene: SceneGeometry,
  origin: Point3,
  image: Point2,
): Point2 | undefined {
  if (scene.projection?.kind !== 'camera') return undefined
  const m = scene.projection.matrix
  const x = worldToLocal(scene, { x: 1, y: 0, z: 0 })
  const z = worldToLocal(scene, { x: 0, y: 0, z: 1 })
  const row = (i: number, p: Point3) =>
    m[i] * p.x + m[i + 1] * p.y + m[i + 2] * p.z
  const a = row(0, x) - image.x * row(8, x)
  const b = row(0, z) - image.x * row(8, z)
  const c = row(4, x) - image.y * row(8, x)
  const d = row(4, z) - image.y * row(8, z)
  const e = image.x * (row(8, origin) + m[11]) - row(0, origin) - m[3]
  const f = image.y * (row(8, origin) + m[11]) - row(4, origin) - m[7]
  const det = a * d - b * c
  if (Math.abs(det) < 1e-10) return undefined
  const result = { x: (e * d - b * f) / det, y: (a * f - e * c) / det }
  return Number.isFinite(result.x) && Number.isFinite(result.y)
    ? result
    : undefined
}

export function offsetHandlePoint(
  scene: SceneGeometry,
  entry: BlockOffsetEvidence,
): Point2 | undefined {
  return projectScenePoint(
    scene,
    modelLatticePoint(scene, entry, { x: 0.5, y: 0, z: 0.5 }),
  )
}
