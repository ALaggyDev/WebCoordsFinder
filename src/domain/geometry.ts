import type {
  AbstractAxis,
  AxisMapping,
  CalibrationObservation,
  CameraProjection,
  FaceEdge,
  FaceDirection,
  Matrix3x4,
  MeshFace,
  PlanarProjection,
  Point2,
  Point3,
  SceneGeometry,
  SceneProjection,
  SelectedEdge,
  WorldAxisLabel,
} from './types'

export type Homography = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

const EPSILON = 1e-8

export const add3 = (a: Point3, b: Point3): Point3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
})

export const subtract3 = (a: Point3, b: Point3): Point3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})

export const scale3 = (value: Point3, scalar: number): Point3 => ({
  x: value.x * scalar,
  y: value.y * scalar,
  z: value.z * scalar,
})

export const dot3 = (a: Point3, b: Point3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z

export const cross3 = (a: Point3, b: Point3): Point3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

export const negate3 = (value: Point3): Point3 => ({
  x: value.x === 0 ? 0 : -value.x,
  y: value.y === 0 ? 0 : -value.y,
  z: value.z === 0 ? 0 : -value.z,
})

export const same3 = (a: Point3, b: Point3): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z

export const abstractAxisVector = (axis: AbstractAxis): Point3 => ({
  x: axis === 'a' ? 1 : 0,
  y: axis === 'b' ? 1 : 0,
  z: axis === 'c' ? 1 : 0,
})

const completeAxisMappings: AxisMapping[] = (() => {
  const labels = ['x+', 'x-', 'y+', 'y-', 'z+', 'z-'] as const
  const mappings: AxisMapping[] = []
  for (const a of labels) {
    for (const b of labels) {
      for (const c of labels) {
        const mapping = { a, b, c }
        if (new Set([a[0], b[0], c[0]]).size !== 3) continue
        const mappedA = mappedVector(mapping, { x: 1, y: 0, z: 0 })
        const mappedB = mappedVector(mapping, { x: 0, y: 1, z: 0 })
        const mappedC = mappedVector(mapping, { x: 0, y: 0, z: 1 })
        if (
          mappedA &&
          mappedB &&
          mappedC &&
          same3(cross3(mappedA, mappedB), mappedC)
        ) {
          mappings.push(mapping)
        }
      }
    }
  }
  return mappings
})()

function coordinateForAxis(point: Point3, axis: AbstractAxis): number {
  return axis === 'a' ? point.x : axis === 'b' ? point.y : point.z
}

function worldAxisPart(label: WorldAxisLabel): 'x' | 'y' | 'z' | undefined {
  if (label === 'unknown') return undefined
  return label[0] as 'x' | 'y' | 'z'
}

function worldAxisSign(label: WorldAxisLabel): number | undefined {
  if (label.endsWith('+')) return 1
  if (label.endsWith('-')) return -1
  return undefined
}

export function isAxisMappingComplete(mapping: AxisMapping): boolean {
  const labels = [mapping.a, mapping.b, mapping.c]
  return (
    labels.every((label) => worldAxisSign(label) !== undefined) &&
    validAxisMappingCompletions(mapping).length === 1
  )
}

function mappingMatchesPartial(
  complete: AxisMapping,
  partial: AxisMapping,
): boolean {
  return (['a', 'b', 'c'] as const).every((axis) => {
    const expected = partial[axis]
    return expected === 'unknown' || complete[axis] === expected
  })
}

export function validAxisMappingCompletions(
  mapping: AxisMapping,
): AxisMapping[] {
  return completeAxisMappings.filter((candidate) =>
    mappingMatchesPartial(candidate, mapping),
  )
}

export function updatedAxisMapping(
  mapping: AxisMapping,
  axis: AbstractAxis,
  label: WorldAxisLabel,
): AxisMapping {
  const next: AxisMapping = { ...mapping, [axis]: label }
  const worldAxis = worldAxisPart(label)
  if (worldAxis) {
    for (const other of ['a', 'b', 'c'] as const) {
      if (
        other !== axis &&
        worldAxisPart(next[other]) === worldAxis
      ) {
        next[other] = 'unknown'
      }
    }
  }
  return validAxisMappingCompletions(next).length > 0 ? next : mapping
}

export function mappedVector(
  mapping: AxisMapping,
  local: Point3,
): Point3 | undefined {
  const result = { x: 0, y: 0, z: 0 }
  for (const axis of ['a', 'b', 'c'] as const) {
    const label = mapping[axis]
    const worldAxis = worldAxisPart(label)
    const sign = worldAxisSign(label)
    const amount = coordinateForAxis(local, axis)
    if (amount === 0) continue
    if (!worldAxis || sign === undefined) return undefined
    result[worldAxis] += amount * sign
  }
  return result
}

export function blockCoordinateForFace(face: MeshFace): Point3 {
  // A positive-facing square lies on the owning block's maximum boundary.
  return {
    x: face.blockCoordinate.x - Math.max(0, face.normal.x),
    y: face.blockCoordinate.y - Math.max(0, face.normal.y),
    z: face.blockCoordinate.z - Math.max(0, face.normal.z),
  }
}

export function mappedAnchorOffset(
  scene: SceneGeometry,
  anchorFaceId: string | null,
  local: Point3,
): Point3 | undefined {
  if (!anchorFaceId) return undefined
  const anchor = scene.faces.find((face) => face.id === anchorFaceId)
  if (!anchor) return undefined
  return mappedVector(
    scene.axisMapping,
    subtract3(local, blockCoordinateForFace(anchor)),
  )
}

export function faceForLocalNormal(
  mapping: AxisMapping,
  normal: Point3,
): FaceDirection | undefined {
  const world = mappedVector(mapping, normal)
  if (!world) return undefined
  if (world.y === 1) return 'up'
  if (world.y === -1) return 'down'
  if (world.z === -1) return 'north'
  if (world.z === 1) return 'south'
  if (world.x === 1) return 'east'
  if (world.x === -1) return 'west'
  return undefined
}

export function possibleFacesForLocalNormal(
  mapping: AxisMapping,
  normal: Point3,
): FaceDirection[] {
  return [
    ...new Set(
      validAxisMappingCompletions(mapping)
        .map((candidate) => faceForLocalNormal(candidate, normal))
        .filter((face): face is FaceDirection => face !== undefined),
    ),
  ]
}

export function axisDisplayLabel(
  axis: AbstractAxis,
  mapping: AxisMapping,
): string {
  const value = mapping[axis]
  if (value === 'unknown') return axis.toUpperCase()
  return `${value[1] === '+' ? '+' : '−'}${value[0].toUpperCase()}`
}

export function axisColor(
  axis: AbstractAxis,
  mapping: AxisMapping,
): string {
  const world = worldAxisPart(mapping[axis])
  if (world === 'x') return '#ff626b'
  if (world === 'y') return '#53e6a5'
  if (world === 'z') return '#70a7ff'
  return '#a8b3b9'
}

export function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const n = values.length
  const augmented = matrix.map((row, index) => [...row, values[index]])

  for (let column = 0; column < n; column += 1) {
    let pivot = column
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row
      }
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) {
      throw new Error('The selected calibration points are degenerate.')
    }
    ;[augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]]
    const divisor = augmented[column][column]
    for (let entry = column; entry <= n; entry += 1) {
      augmented[column][entry] /= divisor
    }
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue
      const factor = augmented[row][column]
      for (let entry = column; entry <= n; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry]
      }
    }
  }
  return augmented.map((row) => row[n])
}

export function computeHomography(
  source: [Point2, Point2, Point2, Point2],
  destination: [Point2, Point2, Point2, Point2],
): Homography {
  const matrix: number[][] = []
  const values: number[] = []
  source.forEach((point, index) => {
    const target = destination[index]
    matrix.push([
      point.x,
      point.y,
      1,
      0,
      0,
      0,
      -target.x * point.x,
      -target.x * point.y,
    ])
    values.push(target.x)
    matrix.push([
      0,
      0,
      0,
      point.x,
      point.y,
      1,
      -target.y * point.x,
      -target.y * point.y,
    ])
    values.push(target.y)
  })
  const result = solveLinearSystem(matrix, values)
  return [...result, 1] as Homography
}

interface PointNormalization {
  points: Point2[]
  matrix: Homography
  inverse: Homography
}

function normalizationForPoints(
  points: Point2[],
  weights: number[],
): PointNormalization {
  const safeWeights = weights.map((weight) => Math.max(0.05, weight))
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0)
  const center = points.reduce(
    (sum, point, index) => ({
      x: sum.x + point.x * safeWeights[index],
      y: sum.y + point.y * safeWeights[index],
    }),
    { x: 0, y: 0 },
  )
  center.x /= totalWeight
  center.y /= totalWeight
  const meanDistance =
    points.reduce(
      (sum, point, index) =>
        sum +
        Math.hypot(point.x - center.x, point.y - center.y) *
          safeWeights[index],
      0,
    ) / totalWeight
  if (meanDistance < EPSILON) {
    throw new Error('The selected calibration points are degenerate.')
  }
  const scale = Math.SQRT2 / meanDistance
  return {
    points: points.map((point) => ({
      x: (point.x - center.x) * scale,
      y: (point.y - center.y) * scale,
    })),
    matrix: [
      scale,
      0,
      -scale * center.x,
      0,
      scale,
      -scale * center.y,
      0,
      0,
      1,
    ],
    inverse: [
      1 / scale,
      0,
      center.x,
      0,
      1 / scale,
      center.y,
      0,
      0,
      1,
    ],
  }
}

function multiplyHomographies(a: Homography, b: Homography): Homography {
  const result = Array(9).fill(0)
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        result[row * 3 + column] +=
          a[row * 3 + inner] * b[inner * 3 + column]
      }
    }
  }
  return result as Homography
}

export function fitHomography(
  source: Point2[],
  destination: Point2[],
  weights = source.map(() => 1),
): Homography {
  if (
    source.length < 4 ||
    destination.length !== source.length ||
    weights.length !== source.length
  ) {
    throw new Error('At least four paired calibration observations are required.')
  }
  const normalizedSource = normalizationForPoints(source, weights)
  const normalizedDestination = normalizationForPoints(destination, weights)
  const rows: number[][] = []
  const values: number[] = []
  normalizedSource.points.forEach((point, index) => {
    const target = normalizedDestination.points[index]
    const weight = Math.sqrt(Math.max(0.05, weights[index]))
    rows.push([
      point.x * weight,
      point.y * weight,
      weight,
      0,
      0,
      0,
      -target.x * point.x * weight,
      -target.x * point.y * weight,
    ])
    values.push(target.x * weight)
    rows.push([
      0,
      0,
      0,
      point.x * weight,
      point.y * weight,
      weight,
      -target.y * point.x * weight,
      -target.y * point.y * weight,
    ])
    values.push(target.y * weight)
  })
  const normalized = [...solveLeastSquares(rows, values), 1] as Homography
  const denormalized = multiplyHomographies(
    normalizedDestination.inverse,
    multiplyHomographies(normalized, normalizedSource.matrix),
  )
  const scale = denormalized[8]
  if (Math.abs(scale) < EPSILON) {
    throw new Error('The selected calibration points are degenerate.')
  }
  return denormalized.map((value) => value / scale) as Homography
}

export function projectPoint(h: Homography, point: Point2): Point2 {
  const denominator = h[6] * point.x + h[7] * point.y + h[8]
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / denominator,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / denominator,
  }
}

export function projectCamera(matrix: Matrix3x4, point: Point3): Point2 {
  const vector = [point.x, point.y, point.z, 1]
  const x = matrix.slice(0, 4).reduce((sum, value, index) => sum + value * vector[index], 0)
  const y = matrix.slice(4, 8).reduce((sum, value, index) => sum + value * vector[index], 0)
  const w = matrix.slice(8, 12).reduce((sum, value, index) => sum + value * vector[index], 0)
  return Math.abs(w) < EPSILON
    ? { x: Number.NaN, y: Number.NaN }
    : { x: x / w, y: y / w }
}

export function faceVertex(
  face: MeshFace,
  u: number,
  v: number,
): Point3 {
  const axes = localAxesForFace(face)
  return add3(
    add3(face.blockCoordinate, scale3(axes.uAxis, u)),
    scale3(axes.vAxis, v),
  )
}

export function localAxesForFace(face: MeshFace): {
  uAxis: Point3
  vAxis: Point3
} {
  if (face.normal.x !== 0) {
    return {
      uAxis: { x: 0, y: 1, z: 0 },
      vAxis: { x: 0, y: 0, z: 1 },
    }
  }
  if (face.normal.y !== 0) {
    return {
      uAxis: { x: 1, y: 0, z: 0 },
      vAxis: { x: 0, y: 0, z: 1 },
    }
  }
  return {
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 1, z: 0 },
  }
}

export function faceCornersLattice(
  face: MeshFace,
): [Point3, Point3, Point3, Point3] {
  return [
    faceVertex(face, 0, 0),
    faceVertex(face, 1, 0),
    faceVertex(face, 1, 1),
    faceVertex(face, 0, 1),
  ]
}

export function planarProjectionForPlane(
  origin: Point3,
  uAxis: Point3,
  vAxis: Point3,
  cornerLattice: [Point3, Point3, Point3, Point3],
  observations: CalibrationObservation[],
): PlanarProjection {
  const planarObservations = observations.flatMap((observation) => {
    const local = localCoordinatesOnPlane(
      origin,
      uAxis,
      vAxis,
      observation.lattice,
    )
    return local ? [{ observation, local }] : []
  })
  if (planarObservations.length < 4) {
    throw new Error('The base surface needs four coplanar observations.')
  }
  return {
    kind: 'planar',
    origin,
    uAxis,
    vAxis,
    cornerLattice,
    homography: fitHomography(
      planarObservations.map(({ local }) => local),
      planarObservations.map(({ observation }) => observation.image),
      planarObservations.map(({ observation }) => observation.weight),
    ),
  }
}

function localCoordinatesOnPlane(
  origin: Point3,
  uAxis: Point3,
  vAxis: Point3,
  point: Point3,
): Point2 | undefined {
  const delta = subtract3(point, origin)
  const u = dot3(delta, uAxis) / dot3(uAxis, uAxis)
  const v = dot3(delta, vAxis) / dot3(vAxis, vAxis)
  const reconstructed = add3(
    add3(origin, scale3(uAxis, u)),
    scale3(vAxis, v),
  )
  return same3(reconstructed, point) ? { x: u, y: v } : undefined
}

export function projectScenePoint(
  scene: SceneGeometry,
  point: Point3,
): Point2 | undefined {
  const projection = scene.projection
  if (projection.kind === 'camera') {
    const projected = projectCamera(projection.matrix, point)
    return Number.isFinite(projected.x) && Number.isFinite(projected.y)
      ? projected
      : undefined
  }
  const local = localCoordinatesOnPlane(
    projection.origin,
    projection.uAxis,
    projection.vAxis,
    point,
  )
  return local ? projectPoint(projection.homography, local) : undefined
}

export interface ProjectionInfo {
  resolvedAxes: 2 | 3
  rmsError: number
  maxError: number
}

export function projectionInfo(scene: SceneGeometry): ProjectionInfo {
  if (scene.projection.kind === 'camera') {
    return {
      resolvedAxes: 3,
      rmsError: scene.projection.rmsError,
      maxError: scene.projection.maxError,
    }
  }
  const errors = scene.observations.flatMap((observation) => {
    const predicted = projectScenePoint(scene, observation.lattice)
    return predicted ? [distance(predicted, observation.image)] : []
  })
  return {
    resolvedAxes: 2,
    rmsError:
      errors.length === 0
        ? 0
        : Math.sqrt(
            errors.reduce((sum, error) => sum + error * error, 0) /
              errors.length,
          ),
    maxError: errors.length === 0 ? 0 : Math.max(...errors),
  }
}

function solveLeastSquares(rows: number[][], values: number[]): number[] {
  const size = rows[0]?.length ?? 0
  const normal = Array.from({ length: size }, () => Array(size).fill(0))
  const rhs = Array(size).fill(0)
  rows.forEach((row, rowIndex) => {
    for (let i = 0; i < size; i += 1) {
      rhs[i] += row[i] * values[rowIndex]
      for (let j = 0; j < size; j += 1) normal[i][j] += row[i] * row[j]
    }
  })
  const diagonalScale =
    normal.reduce((sum, row, index) => sum + Math.abs(row[index]), 0) /
    Math.max(1, size)
  const ridge = Math.max(1e-10, diagonalScale * 1e-10)
  for (let index = 0; index < size; index += 1) normal[index][index] += ridge
  return solveLinearSystem(normal, rhs)
}

export function fitCameraProjection(
  observations: CalibrationObservation[],
): CameraProjection {
  if (observations.length < 6) {
    throw new Error('At least six calibration observations are required.')
  }
  const rows: number[][] = []
  const values: number[] = []
  observations.forEach((observation) => {
    const { x: a, y: b, z: c } = observation.lattice
    const { x: u, y: v } = observation.image
    const weight = Math.sqrt(Math.max(0.05, observation.weight))
    const xRow = Array(11).fill(0)
    ;[a, b, c, 1].forEach((value, index) => {
      xRow[index] = value * weight
    })
    xRow[8] = -u * a * weight
    xRow[9] = -u * b * weight
    xRow[10] = -u * c * weight
    rows.push(xRow)
    values.push(u * weight)

    const yRow = Array(11).fill(0)
    ;[a, b, c, 1].forEach((value, index) => {
      yRow[4 + index] = value * weight
    })
    yRow[8] = -v * a * weight
    yRow[9] = -v * b * weight
    yRow[10] = -v * c * weight
    rows.push(yRow)
    values.push(v * weight)
  })

  const solved = solveLeastSquares(rows, values)
  const matrix = [...solved, 1] as Matrix3x4
  const errors = observations.map((observation) => {
    const predicted = projectCamera(matrix, observation.lattice)
    return distance(predicted, observation.image)
  })
  const rmsError = Math.sqrt(
    errors.reduce((sum, error) => sum + error * error, 0) /
      Math.max(1, errors.length),
  )
  return {
    kind: 'camera',
    matrix,
    rmsError,
    maxError: Math.max(...errors),
  }
}

export function refitProjection(
  scene: SceneGeometry,
): SceneProjection {
  if (scene.projection.kind === 'camera') {
    if (scene.observations.length < 6) return scene.projection
    try {
      return fitCameraProjection(scene.observations)
    } catch {
      return scene.projection
    }
  }
  const { origin, uAxis, vAxis, cornerLattice } = scene.projection
  const outOfPlaneObservations = scene.observations.filter(
    (observation) =>
      !localCoordinatesOnPlane(origin, uAxis, vAxis, observation.lattice),
  )
  if (
    scene.observations.length >= 6 &&
    outOfPlaneObservations.length >= 2
  ) {
    try {
      return fitCameraProjection(scene.observations)
    } catch {
      // Keep the planar model until the non-coplanar observations are
      // sufficiently well-conditioned.
    }
  }
  return planarProjectionForPlane(
    origin,
    uAxis,
    vAxis,
    cornerLattice,
    scene.observations,
  )
}

export function faceQuad(
  scene: SceneGeometry,
  face: MeshFace,
): [Point2, Point2, Point2, Point2] | undefined {
  const projected = faceCornersLattice(face).map((point) =>
    projectScenePoint(scene, point),
  )
  return projected.every((point): point is Point2 => point !== undefined)
    ? (projected as [Point2, Point2, Point2, Point2])
    : undefined
}

export function flattenPoints(points: Point2[]): number[] {
  return points.flatMap((point) => [point.x, point.y])
}

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export interface FaceEdgeGeometry {
  start: Point3
  end: Point3
  direction: Point3
  length: number
}

export function faceEdgeGeometry(
  face: MeshFace,
  edge: FaceEdge,
): FaceEdgeGeometry {
  const axes = localAxesForFace(face)
  if (edge === 'top') {
    return {
      start: faceVertex(face, 0, 0),
      end: faceVertex(face, 1, 0),
      direction: axes.uAxis,
      length: 1,
    }
  }
  if (edge === 'bottom') {
    return {
      start: faceVertex(face, 0, 1),
      end: faceVertex(face, 1, 1),
      direction: axes.uAxis,
      length: 1,
    }
  }
  if (edge === 'left') {
    return {
      start: faceVertex(face, 0, 0),
      end: faceVertex(face, 0, 1),
      direction: axes.vAxis,
      length: 1,
    }
  }
  return {
    start: faceVertex(face, 1, 0),
    end: faceVertex(face, 1, 1),
    direction: axes.vAxis,
    length: 1,
  }
}

const point3Key = (point: Point3): string => `${point.x},${point.y},${point.z}`

export function meshEdgeKey(start: Point3, end: Point3): string {
  const a = point3Key(start)
  const b = point3Key(end)
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function flatConnectedFaceIds(
  faces: MeshFace[],
  seedFaceId: string,
): Set<string> {
  const seed = faces.find((face) => face.id === seedFaceId)
  if (!seed) return new Set()

  const facesByEdge = new Map<string, MeshFace[]>()
  faces.forEach((face) => {
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const geometry = faceEdgeGeometry(face, edge)
      const key = meshEdgeKey(geometry.start, geometry.end)
      facesByEdge.set(key, [...(facesByEdge.get(key) ?? []), face])
    }
  })

  const connected = new Set<string>()
  const pending = [seed]
  while (pending.length > 0) {
    const face = pending.pop()!
    if (connected.has(face.id)) continue
    connected.add(face.id)

    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const geometry = faceEdgeGeometry(face, edge)
      const neighbors =
        facesByEdge.get(meshEdgeKey(geometry.start, geometry.end)) ?? []
      neighbors.forEach((neighbor) => {
        if (
          !connected.has(neighbor.id) &&
          Math.abs(dot3(face.normal, neighbor.normal)) > 1 - EPSILON
        ) {
          pending.push(neighbor)
        }
      })
    }
  }

  return connected
}

export function selectedEdgeGeometry(
  scene: SceneGeometry,
  selection: SelectedEdge,
): FaceEdgeGeometry | undefined {
  const face = scene.faces.find((entry) => entry.id === selection.faceId)
  return face ? faceEdgeGeometry(face, selection.edge) : undefined
}

export function selectedEdgeEndpoints(
  scene: SceneGeometry,
  selections: SelectedEdge[],
): [Point3, Point3] | undefined {
  const geometries = selections
    .map((selection) => selectedEdgeGeometry(scene, selection))
    .filter((entry): entry is FaceEdgeGeometry => entry !== undefined)
  if (geometries.length === 0) return undefined
  const counts = new Map<string, { point: Point3; count: number }>()
  geometries.forEach(({ start, end }) => {
    for (const point of [start, end]) {
      const key = point3Key(point)
      const current = counts.get(key)
      counts.set(key, { point, count: (current?.count ?? 0) + 1 })
    }
  })
  const endpoints = [...counts.values()]
    .filter((entry) => entry.count === 1)
    .map((entry) => entry.point)
  return endpoints.length >= 2
    ? [endpoints[0], endpoints[endpoints.length - 1]]
    : [geometries[0].start, geometries[0].end]
}

const extrusionDirections: Point3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
]

export interface EdgeExtrusion {
  axis: Point3
  blocks: number
  createsAxis: boolean
}

function distanceToSegment(point: Point2, start: Point2, end: Point2): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < EPSILON) return distance(point, start)
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        lengthSquared,
    ),
  )
  return distance(point, {
    x: start.x + dx * amount,
    y: start.y + dy * amount,
  })
}

export function chooseEdgeExtrusion(
  scene: SceneGeometry,
  selections: SelectedEdge[],
  pointer: Point2,
  maxBlocks = 64,
): EdgeExtrusion | undefined {
  const geometries = selections
    .map((selection) => selectedEdgeGeometry(scene, selection))
    .filter((entry): entry is FaceEdgeGeometry => entry !== undefined)
  if (geometries.length === 0) return undefined
  const referenceGeometry = geometries[geometries.length - 1]
  if (scene.projection.kind !== 'camera') {
    const referenceSelection = selections[selections.length - 1]
    const face = scene.faces.find(
      (entry) => entry.id === referenceSelection.faceId,
    )
    if (!face) return undefined
    const midpoint = scale3(
      add3(referenceGeometry.start, referenceGeometry.end),
      0.5,
    )
    const faceAxes = localAxesForFace(face)
    const inPlaneAxes = [
      faceAxes.uAxis,
      negate3(faceAxes.uAxis),
      faceAxes.vAxis,
      negate3(faceAxes.vAxis),
    ].filter((axis, index, axes) =>
      axes.findIndex((candidate) => same3(candidate, axis)) === index &&
      geometries.every((geometry) => Math.abs(dot3(axis, geometry.direction)) < EPSILON),
    )
    let bestInPlane:
      | (EdgeExtrusion & { pointerDistance: number; pathDistance: number; unitLength: number })
      | undefined
    for (const axis of inPlaneAxes) {
      let previous = projectScenePoint(scene, midpoint)
      if (!previous) continue
      const first = projectScenePoint(scene, add3(midpoint, axis))
      if (!first) continue
      const unitLength = distance(previous, first)
      let pathDistance = Number.POSITIVE_INFINITY
      let pointerDistance = Number.POSITIVE_INFINITY
      let bestBlocks = 1
      for (let blocks = 1; blocks <= maxBlocks; blocks += 1) {
        const projected = projectScenePoint(
          scene,
          add3(midpoint, scale3(axis, blocks)),
        )
        if (!projected) break
        pathDistance = Math.min(
          pathDistance,
          distanceToSegment(pointer, previous, projected),
        )
        const snappedDistance = distance(pointer, projected)
        if (snappedDistance < pointerDistance) {
          pointerDistance = snappedDistance
          bestBlocks = blocks
        }
        previous = projected
      }
      const candidate = {
        axis,
        blocks: bestBlocks,
        createsAxis: false,
        pointerDistance,
        pathDistance,
        unitLength,
      }
      if (
        !bestInPlane ||
        candidate.pathDistance < bestInPlane.pathDistance ||
        (candidate.pathDistance === bestInPlane.pathDistance &&
          candidate.pointerDistance < bestInPlane.pointerDistance)
      ) {
        bestInPlane = candidate
      }
    }
    if (bestInPlane) {
      const planeSnapDistance = Math.max(
        12,
        Math.min(48, bestInPlane.unitLength * 0.4),
      )
      if (bestInPlane.pathDistance <= planeSnapDistance) {
        return {
          axis: bestInPlane.axis,
          blocks: bestInPlane.blocks,
          createsAxis: false,
        }
      }
    }
    return { axis: face.normal, blocks: 1, createsAxis: true }
  }
  const candidates = extrusionDirections.filter((axis) =>
    geometries.every((geometry) => dot3(axis, geometry.direction) === 0),
  )
  let best: (EdgeExtrusion & { distance: number }) | undefined
  for (const axis of candidates) {
    const midpoint = scale3(
      add3(referenceGeometry.start, referenceGeometry.end),
      0.5,
    )
    for (let blocks = 1; blocks <= maxBlocks; blocks += 1) {
      const projected = projectScenePoint(
        scene,
        add3(midpoint, scale3(axis, blocks)),
      )
      if (!projected) continue
      const candidate = {
        axis,
        blocks,
        createsAxis: false,
        distance: distance(pointer, projected),
      }
      if (!best || candidate.distance < best.distance) best = candidate
    }
  }
  return best
    ? { axis: best.axis, blocks: best.blocks, createsAxis: false }
    : undefined
}

export function translatedExtrusionAnchors(
  scene: SceneGeometry,
  selections: SelectedEdge[],
  pointer: Point2,
): { endpoints: [Point3, Point3]; images: [Point2, Point2] } | undefined {
  const endpoints = selectedEdgeEndpoints(scene, selections)
  if (!endpoints) return undefined
  const projected = endpoints.map((point) => projectScenePoint(scene, point))
  if (!projected[0] || !projected[1]) return undefined
  if (distance(pointer, projected[1]) < distance(pointer, projected[0])) {
    endpoints.reverse()
    projected.reverse()
  }
  const offset = {
    x: pointer.x - projected[0]!.x,
    y: pointer.y - projected[0]!.y,
  }
  return {
    endpoints,
    images: [
      pointer,
      {
        x: projected[1]!.x + offset.x,
        y: projected[1]!.y + offset.y,
      },
    ],
  }
}

export function createEdgeExtrusionFaces(
  scene: SceneGeometry,
  selections: SelectedEdge[],
  extrusionAxis: Point3,
  blocks: number,
  makeId: () => string,
): MeshFace[] {
  const seen = new Set<string>()
  const result: MeshFace[] = []
  for (const selection of selections) {
    const geometry = selectedEdgeGeometry(scene, selection)
    if (!geometry) continue
    const key = meshEdgeKey(geometry.start, geometry.end)
    if (seen.has(key)) continue
    seen.add(key)
    for (let depth = 0; depth < blocks; depth += 1) {
      const start = add3(geometry.start, scale3(extrusionAxis, depth))
      const end = add3(geometry.end, scale3(extrusionAxis, depth))
      const corners = [
        start,
        end,
        add3(end, extrusionAxis),
        add3(start, extrusionAxis),
      ]
      result.push({
        id: makeId(),
        blockCoordinate: {
          x: Math.min(...corners.map((corner) => corner.x)),
          y: Math.min(...corners.map((corner) => corner.y)),
          z: Math.min(...corners.map((corner) => corner.z)),
        },
        normal: cross3(geometry.direction, extrusionAxis),
      })
    }
  }
  return result
}

export function outerEdgeForExtrusion(
  face: MeshFace,
  extrusionAxis: Point3,
): FaceEdge | undefined {
  let result: { edge: FaceEdge; distance: number } | undefined
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const geometry = faceEdgeGeometry(face, edge)
    if (Math.abs(dot3(geometry.direction, extrusionAxis)) > EPSILON) continue
    const midpoint = scale3(add3(geometry.start, geometry.end), 0.5)
    const candidate = { edge, distance: dot3(midpoint, extrusionAxis) }
    if (!result || candidate.distance > result.distance) result = candidate
  }
  return result?.edge
}

export function projectedAbstractAxes(
  scene: SceneGeometry,
  anchor: Point3,
): Partial<Record<AbstractAxis, Point2>> {
  const origin = projectScenePoint(scene, anchor)
  if (!origin) return {}
  const result: Partial<Record<AbstractAxis, Point2>> = {}
  for (const axis of ['a', 'b', 'c'] as const) {
    const endpoint = projectScenePoint(scene, add3(anchor, abstractAxisVector(axis)))
    if (!endpoint) continue
    const delta = { x: endpoint.x - origin.x, y: endpoint.y - origin.y }
    const length = Math.hypot(delta.x, delta.y)
    if (length > EPSILON) {
      result[axis] = { x: delta.x / length, y: delta.y / length }
    }
  }
  return result
}

export interface FaceNormalIndicator {
  origin: Point2
  direction: Point2
  planarFallback: boolean
}

export function faceNormalIndicator(
  scene: SceneGeometry,
  face: MeshFace,
): FaceNormalIndicator | undefined {
  const center = scale3(
    faceCornersLattice(face).reduce(
      (sum, point) => add3(sum, point),
      { x: 0, y: 0, z: 0 },
    ),
    0.25,
  )
  const origin = projectScenePoint(scene, center)
  if (!origin) return undefined

  if (scene.projection.kind === 'planar') {
    const planeNormal = cross3(
      scene.projection.uAxis,
      scene.projection.vAxis,
    )
    const side = dot3(face.normal, planeNormal)
    if (Math.abs(side) <= EPSILON) return undefined
    const sign = Math.sign(side)
    return {
      origin,
      direction: {
        x: Math.SQRT1_2 * sign,
        y: -Math.SQRT1_2 * sign,
      },
      planarFallback: true,
    }
  }

  const endpoint = projectScenePoint(scene, add3(center, face.normal))
  if (!endpoint) return undefined
  const delta = {
    x: endpoint.x - origin.x,
    y: endpoint.y - origin.y,
  }
  const length = Math.hypot(delta.x, delta.y)
  if (length <= EPSILON) return undefined
  return {
    origin,
    direction: {
      x: delta.x / length,
      y: delta.y / length,
    },
    planarFallback: false,
  }
}

function localVectorForWorld(
  mapping: AxisMapping,
  world: Point3,
): Point3 | undefined {
  for (const axis of extrusionDirections) {
    const mapped = mappedVector(mapping, axis)
    if (mapped && same3(mapped, world)) return axis
  }
  return undefined
}

function orientedFaceCorners(
  face: MeshFace,
  uAxis: Point3,
  vAxis: Point3,
): [Point3, Point3, Point3, Point3] | undefined {
  if (
    dot3(face.normal, uAxis) !== 0 ||
    dot3(face.normal, vAxis) !== 0 ||
    dot3(uAxis, vAxis) !== 0
  ) {
    return undefined
  }
  let origin = face.blockCoordinate
  for (const axis of [uAxis, vAxis]) {
    if (axis.x < 0 || axis.y < 0 || axis.z < 0) {
      origin = subtract3(origin, axis)
    }
  }
  return [
    origin,
    add3(origin, uAxis),
    add3(add3(origin, uAxis), vAxis),
    add3(origin, vAxis),
  ]
}

export function worldAlignedFaceCorners(
  scene: SceneGeometry,
  meshFace: MeshFace,
): [Point3, Point3, Point3, Point3] | undefined {
  const face = faceForLocalNormal(scene.axisMapping, meshFace.normal)
  if (!face) return undefined
  const target =
    face === 'down'
      ? axesForFaceRotation(face, 2)
      : defaultAxesForFace(face)
  const uAxis = localVectorForWorld(scene.axisMapping, target.uAxis)
  const vAxis = localVectorForWorld(scene.axisMapping, target.vAxis)
  return uAxis && vAxis
    ? orientedFaceCorners(meshFace, uAxis, vAxis)
    : undefined
}

export function worldAlignedFaceQuad(
  scene: SceneGeometry,
  meshFace: MeshFace,
): [Point2, Point2, Point2, Point2] | undefined {
  const corners = worldAlignedFaceCorners(scene, meshFace)
  if (!corners) return undefined
  const projected = corners.map((point) => projectScenePoint(scene, point))
  return projected.every((point): point is Point2 => point !== undefined)
    ? (projected as [Point2, Point2, Point2, Point2])
    : undefined
}

export function faceHasWorldOrientation(
  scene: SceneGeometry,
  face: MeshFace,
): boolean {
  return worldAlignedFaceCorners(scene, face) !== undefined
}

export function defaultAxesForFace(face: FaceDirection): {
  uAxis: Point3
  vAxis: Point3
} {
  switch (face) {
    case 'up':
      return { uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: 0, z: 1 } }
    case 'down':
      return { uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: 0, z: -1 } }
    case 'north':
      return { uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: -1, z: 0 } }
    case 'south':
      return { uAxis: { x: -1, y: 0, z: 0 }, vAxis: { x: 0, y: -1, z: 0 } }
    case 'east':
      return { uAxis: { x: 0, y: 0, z: -1 }, vAxis: { x: 0, y: -1, z: 0 } }
    case 'west':
      return { uAxis: { x: 0, y: 0, z: 1 }, vAxis: { x: 0, y: -1, z: 0 } }
  }
}

export function axesForFaceRotation(
  face: FaceDirection,
  quarterTurns: number,
): { uAxis: Point3; vAxis: Point3 } {
  let axes = defaultAxesForFace(face)
  const turns = ((quarterTurns % 4) + 4) % 4
  for (let turn = 0; turn < turns; turn += 1) {
    axes = { uAxis: negate3(axes.vAxis), vAxis: axes.uAxis }
  }
  return axes
}

export function axisVectorLabel(axis: Point3): string {
  if (axis.x === 1) return '+X'
  if (axis.x === -1) return '−X'
  if (axis.y === 1) return '+Y'
  if (axis.y === -1) return '−Y'
  if (axis.z === 1) return '+Z'
  if (axis.z === -1) return '−Z'
  return `${axis.x}, ${axis.y}, ${axis.z}`
}

export function faceDisplayName(face: FaceDirection): string {
  return {
    up: 'Top (+Y)',
    down: 'Bottom (−Y)',
    north: 'North (−Z)',
    south: 'South (+Z)',
    east: 'East (+X)',
    west: 'West (−X)',
  }[face]
}
