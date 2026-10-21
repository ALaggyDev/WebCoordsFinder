import {
  modelLatticePoint,
  offsetFromNibbles,
  offsetProfiles,
  worldToLocal,
  type ModelElement,
  type ModelFace,
} from './blockOffsets'
import { projectScenePoint } from './geometry'
import { textureAnimationFrame } from './textureAnimation'
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
          return {
            x: rotated.x / 16,
            y: rotated.y / 16,
            z: rotated.z / 16,
          }
        }),
      })),
  )
}

interface TexturedPoint {
  point: Point3
  uv: Point2
}

interface TexturedPolygon {
  points: Point2[]
  uv: Point2[]
  texture: CanvasImageSource
  depth: number
}

/** Clip a textured polygon against the model's lower Y plane. */
export function clipTexturedPolygonAtY(
  vertices: TexturedPoint[],
  minimumY: number,
): TexturedPoint[] {
  const result: TexturedPoint[] = []
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index]
    const previous = vertices[(index + vertices.length - 1) % vertices.length]
    const currentInside = current.point.y >= minimumY
    const previousInside = previous.point.y >= minimumY
    if (currentInside !== previousInside) {
      const amount =
        (minimumY - previous.point.y) / (current.point.y - previous.point.y)
      const interpolate = <T extends Point2>(from: T, to: T): T =>
        Object.fromEntries(
          Object.keys(from).map((key) => {
            const k = key as keyof T
            return [
              key,
              Number(from[k]) + (Number(to[k]) - Number(from[k])) * amount,
            ]
          }),
        ) as T
      const intersection = interpolate(previous.point, current.point) as Point3
      intersection.y = minimumY
      result.push({
        point: intersection,
        uv: interpolate(previous.uv, current.uv),
      })
    }
    if (currentInside) result.push(current)
  }
  return result
}

/** Keep the visible portion of a textured polygon in front of the camera. */
export function clipTexturedPolygonAtDepth(
  vertices: TexturedPoint[],
  depth: (point: Point3) => number,
  minimumDepth: number,
): TexturedPoint[] {
  const result: TexturedPoint[] = []
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index]
    const previous = vertices[(index + vertices.length - 1) % vertices.length]
    const currentDepth = depth(current.point)
    const previousDepth = depth(previous.point)
    const currentInside = currentDepth >= minimumDepth
    const previousInside = previousDepth >= minimumDepth
    if (currentInside !== previousInside) {
      const amount = (minimumDepth - previousDepth) / (currentDepth - previousDepth)
      result.push({
        point: {
          x: previous.point.x + (current.point.x - previous.point.x) * amount,
          y: previous.point.y + (current.point.y - previous.point.y) * amount,
          z: previous.point.z + (current.point.z - previous.point.z) * amount,
        },
        uv: {
          x: previous.uv.x + (current.uv.x - previous.uv.x) * amount,
          y: previous.uv.y + (current.uv.y - previous.uv.y) * amount,
        },
      })
    }
    if (currentInside) result.push(current)
  }
  return result
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

/** Project and depth-sort once per model edit, independently of viewport movement. */
export function prepareOffsetModels(
  scene: SceneGeometry,
  entries: BlockOffsetEvidence[],
  textures: Map<string, HTMLCanvasElement>,
  yOcclusion = false,
): TexturedPolygon[] {
  if (scene.projection?.kind !== 'camera' || !entries.length) return []
  const m = scene.projection.matrix
  const depth = (p: Point3) => m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11]
  const reference = scene.observations[0]?.lattice
  if (!reference) return []
  const sign = Math.sign(depth(reference))
  if (!sign) return []
  const minimumDepth = Math.max(1e-8, Math.abs(depth(reference)) * 1e-6)
  // This mapping is affine. Resolve its basis once, rather than repeatedly
  // resolving the world axes for every vertex of every tessellation patch.
  const basisX = worldToLocal(scene, { x: 1, y: 0, z: 0 })
  const basisY = worldToLocal(scene, { x: 0, y: 1, z: 0 })
  const basisZ = worldToLocal(scene, { x: 0, y: 0, z: 1 })
  const quads = entries
    .flatMap((entry) => {
      const origin = modelLatticePoint(scene, entry, { x: 0, y: 0, z: 0 })
      const latticePoint = (p: Point3): Point3 => ({
        x: origin.x + basisX.x * p.x + basisY.x * p.y + basisZ.x * p.z,
        y: origin.y + basisX.y * p.x + basisY.y * p.y + basisZ.y * p.z,
        z: origin.z + basisX.z * p.x + basisY.z * p.y + basisZ.z * p.z,
      })
      return offsetModelQuads(entry).map((quad) => ({
        ...quad,
        entry,
        modelPoints: quad.points,
        latticePoint,
      }))
    })
  const polygons: TexturedPolygon[] = []
  for (const quad of quads) {
    const visible = clipTexturedPolygonAtDepth(
      quad.modelPoints.map((point, index) => ({ point, uv: quad.uv[index] })),
      (point) => depth(quad.latticePoint(point)) * sign,
      minimumDepth,
    )
    if (visible.length < 3) continue
    const projected = visible.map(({ point }) =>
      projectScenePoint(scene, quad.latticePoint(point))!,
    )
    const area = projected.reduce((sum, point, index) => {
      const next = projected[(index + 1) % projected.length]
      return sum + point.x * next.y - point.y * next.x
    }, 0)
    if (area <= 0) continue
    const textureSuffix = `${quad.face.texture}:${
      quad.face.tintindex === undefined ? '' : quad.entry.tint
    }`
    const texture =
      textures.get(`${quad.entry.blockId}:${textureSuffix}`) ??
      textures.get(textureSuffix) ??
      // Keep the previous tint visible while its replacement texture loads.
      (quad.face.tintindex === undefined ? undefined : [...textures].find(([key]) =>
        key.startsWith(`${quad.entry.blockId}:${quad.face.texture}:`) ||
        key.startsWith(`${quad.face.texture}:`),
      )?.[1])
    if (!texture) continue
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
        let vertices = samples.map(([u, v]) => ({
          point: interpolate(quad.modelPoints, u, v),
          uv: interpolate(quad.uv, u, v),
        }))
        if (yOcclusion && offsetProfiles[quad.entry.blockId].type === 'XYZ')
          vertices = clipTexturedPolygonAtY(
            vertices,
            -offsetFromNibbles(
              offsetProfiles[quad.entry.blockId],
              quad.entry.nibbles,
            ).y,
          )
        vertices = clipTexturedPolygonAtDepth(
          vertices,
          (point) => depth(quad.latticePoint(point)) * sign,
          minimumDepth,
        )
        if (vertices.length < 3) continue
        const scenePoints = vertices.map(({ point }) =>
          quad.latticePoint(point),
        )
        polygons.push({
          points: scenePoints.map((point) => projectScenePoint(scene, point)!),
          uv: vertices.map((vertex) => vertex.uv),
          texture,
          depth:
            scenePoints.reduce((sum, point) => sum + depth(point) * sign, 0) /
            scenePoints.length,
        })
      }
  }

  // Crossed plant planes intersect, so a whole-quad painter order is wrong on
  // one side of the crossing. Sort the existing tessellation patches instead;
  // their boundary at u=0.5 follows the intersection in vanilla cross models.
  polygons.sort((a, b) => b.depth - a.depth)
  return polygons
}

function drawOffsetPolygons(
  ctx: CanvasRenderingContext2D,
  polygons: TexturedPolygon[],
) {
  ctx.imageSmoothingEnabled = false
  for (const polygon of polygons)
    for (let index = 1; index + 1 < polygon.points.length; index++)
      triangle(
        ctx,
        polygon.texture,
        [
          polygon.points[0],
          polygon.points[index],
          polygon.points[index + 1],
        ],
        [polygon.uv[0], polygon.uv[index], polygon.uv[index + 1]],
      )
}

export function drawOffsetModels(
  ctx: CanvasRenderingContext2D,
  scene: SceneGeometry,
  entries: BlockOffsetEvidence[],
  textures: Map<string, HTMLCanvasElement>,
  yOcclusion = false,
) {
  drawOffsetPolygons(ctx, prepareOffsetModels(scene, entries, textures, yOcclusion))
}

interface RasterBounds {
  x: number
  y: number
  width: number
  height: number
}

function polygonBounds(polygons: TexturedPolygon[]): RasterBounds | undefined {
  if (!polygons.length) return undefined
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const polygon of polygons)
    for (const point of polygon.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined
      left = Math.min(left, point.x)
      top = Math.min(top, point.y)
      right = Math.max(right, point.x)
      bottom = Math.max(bottom, point.y)
    }
  // Include edge pixels, including models outside the screenshot bounds.
  const x = Math.floor(left) - 1, y = Math.floor(top) - 1
  const width = Math.ceil(right) - x + 1, height = Math.ceil(bottom) - y + 1
  return { x, y, width, height }
}

/** Flatten the sorted models once; pan frames then need just one image draw. */
export function rasterizeOffsetModels(
  polygons: TexturedPolygon[],
  scale: number,
  bounds = polygonBounds(polygons),
) {
  if (!bounds) return undefined
  const { x, y, width, height } = bounds
  // Bound memory even for very large projects or geometry near the camera plane.
  const ratio = Math.min(
    scale,
    4096 / width,
    4096 / height,
    Math.sqrt(4_194_304 / (width * height)),
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width * ratio))
  canvas.height = Math.max(1, Math.floor(height * ratio))
  const ctx = canvas.getContext('2d')!
  const sx = canvas.width / width, sy = canvas.height / height
  ctx.setTransform(sx, 0, 0, sy, -x * sx, -y * sy)
  drawOffsetPolygons(ctx, polygons)
  return { canvas, x, y, width, height }
}

/** Redraw only the moving model's rectangle, preserving inter-model depth order. */
export function rasterizeOffsetModelPatch(
  stationary: TexturedPolygon[],
  moving: TexturedPolygon[],
  scale: number,
) {
  const bounds = polygonBounds(moving)
  if (!bounds) return undefined
  const { x, y, width, height } = bounds
  const overlapping = stationary.filter((polygon) => {
    // A bounding-box check is conservative: never omit a patch that may overlap.
    const box = polygonBounds([polygon])
    return box && box.x <= x + width && box.x + box.width >= x &&
      box.y <= y + height && box.y + box.height >= y
  })
  const polygons = [...overlapping, ...moving].sort((a, b) => b.depth - a.depth)
  return rasterizeOffsetModels(polygons, scale, bounds)
}

/** Tint only marked faces, preserving the original alpha and nearest-neighbor pixels. */
export async function loadOffsetTextures(
  entries: BlockOffsetEvidence[],
  animationTicks: Record<string, number> = {},
): Promise<Map<string, HTMLCanvasElement>> {
  const requests = new Map<string, { url: string; tint?: string; tick: number }>()
  for (const entry of entries)
    for (const quad of offsetModelQuads(entry)) {
      const tint = quad.face.tintindex === undefined ? undefined : entry.tint
      requests.set(`${entry.blockId}:${quad.face.texture}:${tint ?? ''}`, {
        url: quad.face.texture,
        tint,
        tick: animationTicks[entry.blockId] ?? 1,
      })
    }
  return new Map(
    await Promise.all(
      [...requests].map(async ([key, { url, tint, tick }]) => {
        const image = new Image()
        image.src = url
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 16
        const ctx = canvas.getContext('2d')!
        ctx.imageSmoothingEnabled = false
        const frame = textureAnimationFrame(url, tick)
        if (frame) {
          ctx.drawImage(
            image,
            0,
            frame.current * image.width,
            image.width,
            image.width,
            0,
            0,
            16,
            16,
          )
          if (frame.blend > 0) {
            ctx.globalAlpha = frame.blend
            ctx.drawImage(
              image,
              0,
              frame.next * image.width,
              image.width,
              image.width,
              0,
              0,
              16,
              16,
            )
            ctx.globalAlpha = 1
          }
        } else {
          ctx.drawImage(image, 0, 0, image.width, image.width, 0, 0, 16, 16)
        }
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
