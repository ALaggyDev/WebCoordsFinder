import {
  modelLatticePoint,
  offsetProfiles,
  type ModelElement,
  type ModelFace,
} from './blockOffsets'
import { projectScenePoint } from './geometry'
import type {
  BlockOffsetEvidence,
  Point2,
  Point3,
  SceneGeometry,
} from './types'

interface Quad {
  points: Point3[]
  uv: Point2[]
  face: ModelFace
}
const point = (v: number[]): Point3 => ({ x: v[0], y: v[1], z: v[2] })

function rotate(
  p: Point3,
  axis: 'x' | 'y' | 'z',
  degrees: number,
  origin: Point3,
  rescale = false,
): Point3 {
  const axes =
    axis === 'x'
      ? (['y', 'z'] as const)
      : axis === 'y'
        ? (['z', 'x'] as const)
        : (['x', 'y'] as const)
  const [a, b] = axes
  const angle = (degrees * Math.PI) / 180
  const c = Math.cos(angle),
    s = Math.sin(angle)
  const scale = rescale ? 1 / Math.cos(angle) : 1
  const u = p[a] - origin[a],
    v = p[b] - origin[b]
  return {
    ...p,
    [a]: origin[a] + (u * c - v * s) * scale,
    [b]: origin[b] + (u * s + v * c) * scale,
  }
}

function elementQuads(element: ModelElement): Quad[] {
  const [x, y, z] = element.from,
    [X, Y, Z] = element.to
  // Clockwise as seen from outside; UV origin is the face's upper left.
  const vertices: Record<string, number[][]> = {
    north: [
      [X, Y, z],
      [x, Y, z],
      [x, y, z],
      [X, y, z],
    ],
    south: [
      [x, Y, Z],
      [X, Y, Z],
      [X, y, Z],
      [x, y, Z],
    ],
    west: [
      [x, Y, z],
      [x, Y, Z],
      [x, y, Z],
      [x, y, z],
    ],
    east: [
      [X, Y, Z],
      [X, Y, z],
      [X, y, z],
      [X, y, Z],
    ],
    up: [
      [x, Y, z],
      [X, Y, z],
      [X, Y, Z],
      [x, Y, Z],
    ],
    down: [
      [x, y, Z],
      [X, y, Z],
      [X, y, z],
      [x, y, z],
    ],
  }
  const defaults: Record<string, number[]> = {
    north: [16 - X, 16 - Y, 16 - x, 16 - y],
    south: [x, 16 - Y, X, 16 - y],
    west: [z, 16 - Y, Z, 16 - y],
    east: [16 - Z, 16 - Y, 16 - z, 16 - y],
    up: [x, z, X, Z],
    down: [x, 16 - Z, X, 16 - z],
  }
  return Object.entries(element.faces).map(([side, face]) => {
    const [u, v, U, V] = face.uv ?? defaults[side]
    const uv = [
      { x: u, y: v },
      { x: U, y: v },
      { x: U, y: V },
      { x: u, y: V },
    ]
    const shift = (face.rotation ?? 0) / 90
    return {
      face,
      uv: uv.map((_, i) => uv[(i + shift) % 4]),
      points: vertices[side].map((v) => {
        const p = point(v),
          r = element.rotation
        return r ? rotate(p, r.axis, r.angle, point(r.origin), r.rescale) : p
      }),
    }
  })
}

export function offsetModelQuads(entry: BlockOffsetEvidence): Quad[] {
  return offsetProfiles[entry.blockId].variants[entry.modelIndex].parts.flatMap(
    (part) =>
      part.elements.flatMap(elementQuads).map((quad) => ({
        ...quad,
        points: quad.points.map((p) => {
          const center = { x: 8, y: 8, z: 8 }
          const rotated = rotate(
            rotate(p, 'x', -part.x, center),
            'y',
            -part.y,
            center,
          )
          return { x: rotated.x / 16, y: rotated.y / 16, z: rotated.z / 16 }
        }),
      })),
  )
}

/** Affine texture mapping of one small triangle; tessellation approximates perspective. */
function triangle(
  ctx: CanvasRenderingContext2D,
  texture: CanvasImageSource,
  p: Point2[],
  uv: Point2[],
) {
  const [a, b, c] = uv,
    [A, B, C] = p
  const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
  if (Math.abs(det) < 1e-10) return
  const xx = ((B.x - A.x) * (c.y - a.y) - (C.x - A.x) * (b.y - a.y)) / det
  const xy = ((C.x - A.x) * (b.x - a.x) - (B.x - A.x) * (c.x - a.x)) / det
  const yx = ((B.y - A.y) * (c.y - a.y) - (C.y - A.y) * (b.y - a.y)) / det
  const yy = ((C.y - A.y) * (b.x - a.x) - (B.y - A.y) * (c.x - a.x)) / det
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(A.x, A.y)
  ctx.lineTo(B.x, B.y)
  ctx.lineTo(C.x, C.y)
  ctx.closePath()
  ctx.clip()
  ctx.transform(
    xx,
    yx,
    xy,
    yy,
    A.x - xx * a.x - xy * a.y,
    A.y - yx * a.x - yy * a.y,
  )
  ctx.drawImage(texture, 0, 0, 16, 16)
  ctx.restore()
}

export function drawOffsetModels(
  ctx: CanvasRenderingContext2D,
  scene: SceneGeometry,
  entries: BlockOffsetEvidence[],
  textures: Map<string, HTMLCanvasElement>,
) {
  if (scene.projection?.kind !== 'camera') return
  const m = scene.projection.matrix
  const depth = (p: Point3) => m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11]
  const reference = scene.observations[0]?.lattice
  if (!reference) return
  const sign = Math.sign(depth(reference))
  const quads = entries
    .flatMap((entry) =>
      offsetModelQuads(entry).map((quad) => ({
        ...quad,
        entry,
        points: quad.points.map((p) => modelLatticePoint(scene, entry, p)),
      })),
    )
    .filter((q) => q.points.every((p) => depth(p) * sign > 1e-8))
  quads.sort(
    (a, b) =>
      b.points.reduce((s, p) => s + depth(p) * sign, 0) -
      a.points.reduce((s, p) => s + depth(p) * sign, 0),
  )
  ctx.imageSmoothingEnabled = false
  for (const quad of quads) {
    const texture = textures.get(
      `${quad.face.texture}:${quad.face.tintindex === undefined ? '' : quad.entry.tint}`,
    )
    if (!texture) continue
    const projected = quad.points.map((p) => projectScenePoint(scene, p)!)
    const [a, b, c] = projected
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) <= 0) continue
    const interpolate = <T extends Point2>(
      values: T[],
      u: number,
      v: number,
    ): T =>
      Object.fromEntries(
        Object.keys(values[0]).map((key) => {
          const k = key as keyof T
          return [
            key,
            Number(values[0][k]) * (1 - u) * (1 - v) +
              Number(values[1][k]) * u * (1 - v) +
              Number(values[2][k]) * u * v +
              Number(values[3][k]) * (1 - u) * v,
          ]
        }),
      ) as T
    const n = 8
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const samples = [
          [x / n, y / n],
          [(x + 1) / n, y / n],
          [(x + 1) / n, (y + 1) / n],
          [x / n, (y + 1) / n],
        ]
        const points = samples.map(([u, v]) =>
          projectScenePoint(scene, interpolate(quad.points, u, v))!,
        )
        const uv = samples.map(([u, v]) => interpolate(quad.uv, u, v))
        for (const indices of [
          [0, 1, 2],
          [0, 2, 3],
        ])
          triangle(
            ctx,
            texture,
            indices.map((i) => points[i]),
            indices.map((i) => uv[i]),
          )
      }
  }
}

/** Tint only marked faces, preserving the original alpha and nearest-neighbor pixels. */
export async function loadOffsetTextures(
  entries: BlockOffsetEvidence[],
): Promise<Map<string, HTMLCanvasElement>> {
  const requests = new Map<string, { url: string; tint?: string }>()
  for (const entry of entries)
    for (const quad of offsetModelQuads(entry)) {
      const tint = quad.face.tintindex === undefined ? undefined : entry.tint
      requests.set(`${quad.face.texture}:${tint ?? ''}`, {
        url: quad.face.texture,
        tint,
      })
    }
  return new Map(
    await Promise.all(
      [...requests].map(async ([key, { url, tint }]) => {
        const image = new Image()
        image.src = url
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 16
        const ctx = canvas.getContext('2d')!
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(image, 0, 0, image.width, image.width, 0, 0, 16, 16)
        if (tint) {
          const pixels = ctx.getImageData(0, 0, 16, 16)
          const rgb = [1, 3, 5].map(
            (start) => parseInt(tint.slice(start, start + 2), 16) / 255,
          )
          for (let i = 0; i < pixels.data.length; i += 4)
            for (let j = 0; j < 3; j++) pixels.data[i + j] *= rgb[j]
          ctx.putImageData(pixels, 0, 0)
        }
        return [key, canvas] as const
      }),
    ),
  )
}
