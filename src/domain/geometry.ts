import type {
  AbstractAxis,
  AxisMapping,
  CalibrationObservation,
  CameraProjection,
  CandidateTransform,
  FaceDirection,
  Matrix3x4,
  PatchEdge,
  PlanarProjection,
  Point2,
  Point3,
  SceneGeometry,
  SceneProjection,
  SelectedEdge,
  SurfacePatch,
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
  const axes = labels.map(worldAxisPart)
  return (
    labels.every((label) => worldAxisSign(label) !== undefined) &&
    new Set(axes).size === 3
  )
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

export function axisDisplayLabel(
  axis: AbstractAxis,
  mapping: AxisMapping,
): string {
  const value = mapping[axis]
  if (value === 'unknown') return axis.toUpperCase()
  if (value.length === 1) return `${value.toUpperCase()}?`
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

export function patchVertex(
  patch: SurfacePatch,
  column: number,
  row: number,
): Point3 {
  return add3(
    add3(patch.origin, scale3(patch.uAxis, column)),
    scale3(patch.vAxis, row),
  )
}

export function patchCornersLattice(
  patch: SurfacePatch,
): [Point3, Point3, Point3, Point3] {
  return [
    patchVertex(patch, 0, 0),
    patchVertex(patch, patch.columns, 0),
    patchVertex(patch, patch.columns, patch.rows),
    patchVertex(patch, 0, patch.rows),
  ]
}

export function planarProjectionForPatch(
  patch: SurfacePatch,
  observations: CalibrationObservation[],
): PlanarProjection {
  const corners = patchCornersLattice(patch)
  const destination = corners.map((corner) => {
    const observation = observations.find((entry) => same3(entry.lattice, corner))
    if (!observation) throw new Error('The base surface needs four corner observations.')
    return observation.image
  }) as [Point2, Point2, Point2, Point2]
  return {
    kind: 'planar',
    patchId: patch.id,
    homography: computeHomography(
      [
        { x: 0, y: 0 },
        { x: patch.columns, y: 0 },
        { x: patch.columns, y: patch.rows },
        { x: 0, y: patch.rows },
      ],
      destination,
    ),
  }
}

function localCoordinatesOnPatch(
  patch: SurfacePatch,
  point: Point3,
): Point2 | undefined {
  const delta = subtract3(point, patch.origin)
  const u = dot3(delta, patch.uAxis)
  const v = dot3(delta, patch.vAxis)
  const reconstructed = add3(
    add3(patch.origin, scale3(patch.uAxis, u)),
    scale3(patch.vAxis, v),
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
  const patch = scene.patches.find((entry) => entry.id === projection.patchId)
  if (!patch) return undefined
  const local = localCoordinatesOnPatch(patch, point)
  return local ? projectPoint(projection.homography, local) : undefined
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
  if (scene.observations.length >= 6) {
    try {
      return fitCameraProjection(scene.observations)
    } catch {
      // Keep the exact planar model until the non-coplanar observations are
      // sufficiently well-conditioned.
    }
  }
  const planarPatchId =
    scene.projection.kind === 'planar' ? scene.projection.patchId : undefined
  const basePatch =
    scene.patches.find((entry) => entry.id === planarPatchId) ?? scene.patches[0]
  if (!basePatch) throw new Error('The scene does not contain a surface.')
  return planarProjectionForPatch(basePatch, scene.observations)
}

export function patchCellQuad(
  scene: SceneGeometry,
  patch: SurfacePatch,
  column: number,
  row: number,
): [Point2, Point2, Point2, Point2] | undefined {
  const projected = [
    projectScenePoint(scene, patchVertex(patch, column, row)),
    projectScenePoint(scene, patchVertex(patch, column + 1, row)),
    projectScenePoint(scene, patchVertex(patch, column + 1, row + 1)),
    projectScenePoint(scene, patchVertex(patch, column, row + 1)),
  ]
  return projected.every((point): point is Point2 => point !== undefined)
    ? (projected as [Point2, Point2, Point2, Point2])
    : undefined
}

export function cellKey(column: number, row: number): string {
  return `${column}:${row}`
}

export function evidenceId(patchId: string, column: number, row: number): string {
  return `${patchId}:${column}:${row}`
}

export function flattenPoints(points: Point2[]): number[] {
  return points.flatMap((point) => [point.x, point.y])
}

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export interface PatchEdgeGeometry {
  start: Point3
  end: Point3
  direction: Point3
  length: number
}

export function patchEdgeGeometry(
  patch: SurfacePatch,
  edge: PatchEdge,
): PatchEdgeGeometry {
  if (edge === 'top') {
    return {
      start: patchVertex(patch, 0, 0),
      end: patchVertex(patch, patch.columns, 0),
      direction: patch.uAxis,
      length: patch.columns,
    }
  }
  if (edge === 'bottom') {
    return {
      start: patchVertex(patch, 0, patch.rows),
      end: patchVertex(patch, patch.columns, patch.rows),
      direction: patch.uAxis,
      length: patch.columns,
    }
  }
  if (edge === 'left') {
    return {
      start: patchVertex(patch, 0, 0),
      end: patchVertex(patch, 0, patch.rows),
      direction: patch.vAxis,
      length: patch.rows,
    }
  }
  return {
    start: patchVertex(patch, patch.columns, 0),
    end: patchVertex(patch, patch.columns, patch.rows),
    direction: patch.vAxis,
    length: patch.rows,
  }
}

export function cellEdgeGeometry(
  patch: SurfacePatch,
  column: number,
  row: number,
  edge: PatchEdge,
): PatchEdgeGeometry {
  if (edge === 'top') {
    return {
      start: patchVertex(patch, column, row),
      end: patchVertex(patch, column + 1, row),
      direction: patch.uAxis,
      length: 1,
    }
  }
  if (edge === 'bottom') {
    return {
      start: patchVertex(patch, column, row + 1),
      end: patchVertex(patch, column + 1, row + 1),
      direction: patch.uAxis,
      length: 1,
    }
  }
  if (edge === 'left') {
    return {
      start: patchVertex(patch, column, row),
      end: patchVertex(patch, column, row + 1),
      direction: patch.vAxis,
      length: 1,
    }
  }
  return {
    start: patchVertex(patch, column + 1, row),
    end: patchVertex(patch, column + 1, row + 1),
    direction: patch.vAxis,
    length: 1,
  }
}

const point3Key = (point: Point3): string => `${point.x},${point.y},${point.z}`

export function meshEdgeKey(start: Point3, end: Point3): string {
  const a = point3Key(start)
  const b = point3Key(end)
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function selectedEdgeGeometry(
  scene: SceneGeometry,
  selection: SelectedEdge,
): PatchEdgeGeometry | undefined {
  const patch = scene.patches.find((entry) => entry.id === selection.patchId)
  return patch
    ? cellEdgeGeometry(patch, selection.column, selection.row, selection.edge)
    : undefined
}

export function selectedEdgeEndpoints(
  scene: SceneGeometry,
  selections: SelectedEdge[],
): [Point3, Point3] | undefined {
  const geometries = selections
    .map((selection) => selectedEdgeGeometry(scene, selection))
    .filter((entry): entry is PatchEdgeGeometry => entry !== undefined)
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

export function chooseEdgeExtrusionAxis(
  scene: SceneGeometry,
  selections: SelectedEdge[],
  blocks: number,
  pointer: Point2,
): Point3 | undefined {
  const geometries = selections
    .map((selection) => selectedEdgeGeometry(scene, selection))
    .filter((entry): entry is PatchEdgeGeometry => entry !== undefined)
  if (geometries.length === 0) return undefined
  if (scene.projection.kind !== 'camera') {
    const patch = scene.patches.find((entry) => entry.id === selections[0].patchId)
    return patch?.normal
  }
  const candidates = extrusionDirections.filter((axis) =>
    geometries.every((geometry) => dot3(axis, geometry.direction) === 0),
  )
  let best: { axis: Point3; distance: number } | undefined
  for (const axis of candidates) {
    const geometry = geometries[0]
    const midpoint = scale3(add3(geometry.start, geometry.end), 0.5)
    const projected = projectScenePoint(
      scene,
      add3(midpoint, scale3(axis, blocks)),
    )
    if (!projected) continue
    const candidate = { axis, distance: distance(pointer, projected) }
    if (!best || candidate.distance < best.distance) best = candidate
  }
  return best?.axis
}

export function createEdgeExtrusionPatches(
  scene: SceneGeometry,
  selections: SelectedEdge[],
  extrusionAxis: Point3,
  blocks: number,
  makeId: () => string,
): SurfacePatch[] {
  const seen = new Set<string>()
  const result: SurfacePatch[] = []
  for (const selection of selections) {
    const geometry = selectedEdgeGeometry(scene, selection)
    if (!geometry) continue
    const key = meshEdgeKey(geometry.start, geometry.end)
    if (seen.has(key)) continue
    seen.add(key)
    for (let depth = 0; depth < blocks; depth += 1) {
      result.push({
        id: makeId(),
        name: 'Extruded face',
        origin: add3(geometry.start, scale3(extrusionAxis, depth)),
        uAxis: geometry.direction,
        vAxis: extrusionAxis,
        normal: cross3(geometry.direction, extrusionAxis),
        columns: 1,
        rows: 1,
        inactiveCells: [],
      })
    }
  }
  return result
}

export function createExtrudedPatch(
  source: SurfacePatch,
  edge: PatchEdge,
  sign: 1 | -1,
  distanceBlocks: number,
  id: string,
): SurfacePatch {
  const selected = patchEdgeGeometry(source, edge)
  const extrusionAxis = scale3(source.normal, sign)
  return {
    id,
    name: `${source.name} · extrusion`,
    origin: selected.start,
    uAxis: selected.direction,
    vAxis: extrusionAxis,
    normal: cross3(selected.direction, extrusionAxis),
    columns: selected.length,
    rows: Math.max(1, Math.round(distanceBlocks)),
    inactiveCells: [],
  }
}

export function patchBoundary(
  scene: SceneGeometry,
  patch: SurfacePatch,
  edge: PatchEdge,
): [Point2, Point2] | undefined {
  const geometry = patchEdgeGeometry(patch, edge)
  const start = projectScenePoint(scene, geometry.start)
  const end = projectScenePoint(scene, geometry.end)
  return start && end ? [start, end] : undefined
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

export function canonicalCropTransformForPatch(
  scene: SceneGeometry,
  patch: SurfacePatch,
): CandidateTransform {
  const face = faceForLocalNormal(scene.axisMapping, patch.normal)
  const u = mappedVector(scene.axisMapping, patch.uAxis)
  const v = mappedVector(scene.axisMapping, patch.vAxis)
  if (!face || !u || !v) return 'identity'
  const target = defaultAxesForFace(face)
  for (let turns = 0; turns < 4; turns += 1) {
    const axes = axesForFaceRotation(face, turns)
    if (same3(u, axes.uAxis) && same3(v, axes.vAxis)) {
      const targetRotation = face === 'down' ? 2 : 0
      const required = (targetRotation - turns + 4) % 4
      return (
        ['identity', 'rotate90', 'rotate180', 'rotate270'] as const
      )[required]
    }
  }
  return same3(u, target.uAxis) && same3(v, target.vAxis)
    ? 'identity'
    : 'identity'
}

export function patchHasWorldOrientation(
  scene: SceneGeometry,
  patch: SurfacePatch,
): boolean {
  return (
    mappedVector(scene.axisMapping, patch.uAxis) !== undefined &&
    mappedVector(scene.axisMapping, patch.vAxis) !== undefined &&
    faceForLocalNormal(scene.axisMapping, patch.normal) !== undefined
  )
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
