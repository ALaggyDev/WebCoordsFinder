import type {
  AbstractAxis,
  AxisMapping,
  CalibrationObservation,
  CameraProjection,
  FaceEdge,
  FaceDirection,
  Matrix3x4,
  MeshFace,
  OrientationSurfaceKind,
  PlanarProjection,
  Point2,
  Point3,
  SceneGeometry,
  SceneProjection,
  SelectedEdge,
  WorldUpIntent,
  WorldAxisLabel,
} from './types'

/*
 * Geometry is stored in one screenshot-local A/B/C lattice. Projection code
 * maps that lattice into image space, while AxisMapping is the separate,
 * user-confirmed conversion from A/B/C to Minecraft world X/Y/Z.
 */
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

export type LatticeParity = -1 | 1

// All structurally valid signed permutations are retained here. Whether a
// complete mapping is physically valid depends on the scene's projected
// parity; it is not an intrinsic property of the abstract A/B/C labels.
const completeAxisMappings: AxisMapping[] = (() => {
  const labels = ['x+', 'x-', 'y+', 'y-', 'z+', 'z-'] as const
  const mappings: AxisMapping[] = []
  for (const a of labels) {
    for (const b of labels) {
      for (const c of labels) {
        const mapping = { a, b, c }
        if (new Set([a[0], b[0], c[0]]).size !== 3) continue
        mappings.push(mapping)
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

export function axisMappingParity(
  mapping: AxisMapping,
): LatticeParity | undefined {
  const mappedA = mappedVector(mapping, { x: 1, y: 0, z: 0 })
  const mappedB = mappedVector(mapping, { x: 0, y: 1, z: 0 })
  const mappedC = mappedVector(mapping, { x: 0, y: 0, z: 1 })
  if (!mappedA || !mappedB || !mappedC) return undefined
  const determinant = dot3(cross3(mappedA, mappedB), mappedC)
  return determinant === 1 ? 1 : determinant === -1 ? -1 : undefined
}

export function isAxisMappingComplete(
  mapping: AxisMapping,
  parity: LatticeParity | undefined,
): boolean {
  const labels = [mapping.a, mapping.b, mapping.c]
  return (
    parity !== undefined &&
    labels.every((label) => worldAxisSign(label) !== undefined) &&
    axisMappingParity(mapping) === parity
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
  parity?: LatticeParity,
): AxisMapping[] {
  return completeAxisMappings.filter(
    (candidate) =>
      mappingMatchesPartial(candidate, mapping) &&
      (parity === undefined || axisMappingParity(candidate) === parity),
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
  // Anchoring is defined on the owning block, not the canonical minimum
  // lattice corner used to store the selected face square.
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

export function vectorForFaceDirection(direction: FaceDirection): Point3 {
  return {
    up: { x: 0, y: 1, z: 0 },
    down: { x: 0, y: -1, z: 0 },
    north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 },
    east: { x: 1, y: 0, z: 0 },
    west: { x: -1, y: 0, z: 0 },
  }[direction]
}

export function compatibleEdgeDirections(
  faceDirection: FaceDirection,
): FaceDirection[] {
  const normal = vectorForFaceDirection(faceDirection)
  return (['up', 'down', 'north', 'south', 'east', 'west'] as const).filter(
    (direction) => dot3(normal, vectorForFaceDirection(direction)) === 0,
  )
}

function axisAssignment(
  local: Point3,
  worldDirection: FaceDirection,
): { axis: AbstractAxis; label: WorldAxisLabel } | undefined {
  const localParts: Array<[AbstractAxis, number]> = [
    ['a', local.x],
    ['b', local.y],
    ['c', local.z],
  ]
  const populated = localParts.filter(([, amount]) => Math.abs(amount) > EPSILON)
  if (populated.length !== 1 || Math.abs(populated[0][1]) !== 1) return undefined

  const [axis, localSign] = populated[0]
  const world = scale3(vectorForFaceDirection(worldDirection), localSign)
  const worldParts: Array<['x' | 'y' | 'z', number]> = [
    ['x', world.x],
    ['y', world.y],
    ['z', world.z],
  ]
  const [worldAxis, worldSign] = worldParts.find(([, amount]) => amount !== 0)!
  return {
    axis,
    label: `${worldAxis}${worldSign > 0 ? '+' : '-'}` as WorldAxisLabel,
  }
}

export function axisMappingFromReferences(
  localNormal: Point3,
  faceDirection: FaceDirection,
  localEdgeDirection: Point3,
  edgeDirection: FaceDirection,
  parity?: LatticeParity,
): AxisMapping | undefined {
  const normal = axisAssignment(localNormal, faceDirection)
  const edge = axisAssignment(localEdgeDirection, edgeDirection)
  if (!normal || !edge || normal.axis === edge.axis) return undefined

  const mapping: AxisMapping = { a: 'unknown', b: 'unknown', c: 'unknown' }
  mapping[normal.axis] = normal.label
  mapping[edge.axis] = edge.label
  const completions = validAxisMappingCompletions(mapping, parity)
  return completions.length === 1 ? completions[0] : undefined
}

export function localVectorForWorld(
  mapping: AxisMapping,
  world: Point3,
): Point3 | undefined {
  const directions: Point3[] = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ]
  return directions.find((direction) => {
    const mapped = mappedVector(mapping, direction)
    return mapped !== undefined && same3(mapped, world)
  })
}

export function isWorldUpResolved(mapping: AxisMapping): boolean {
  const completions = validAxisMappingCompletions(mapping)
  if (completions.length === 0) return false
  const localUps = completions.map((completion) =>
    localVectorForWorld(completion, { x: 0, y: 1, z: 0 }),
  )
  return (
    localUps[0] !== undefined &&
    localUps.every((candidate) =>
      candidate !== undefined && same3(candidate, localUps[0]!),
    )
  )
}

export function localUpForSurfaceKind(
  face: MeshFace,
  kind: OrientationSurfaceKind,
): Point3 | undefined {
  if (kind === 'top') return face.normal
  if (kind === 'bottom') return negate3(face.normal)
  return undefined
}

export function localUpForWorldUpIntent(
  scene: SceneGeometry,
  intent: WorldUpIntent | null | undefined = scene.worldUpIntent,
): Point3 | undefined {
  if (!intent) return undefined
  const face = scene.faces.find((candidate) => candidate.id === intent.faceId)
  if (!face) return undefined
  if (intent.surfaceKind === 'top') return face.normal
  if (intent.surfaceKind === 'bottom') return negate3(face.normal)
  return intent.edge
    ? orientationEdgeGeometry(face, intent.edge).direction
    : undefined
}

function mappingWithLocalUp(localUp: Point3): AxisMapping | undefined {
  const up = axisAssignment(localUp, 'up')
  if (!up) return undefined
  const partial: AxisMapping = { a: 'unknown', b: 'unknown', c: 'unknown' }
  partial[up.axis] = up.label
  return partial
}

function mappingSortKey(mapping: AxisMapping): string {
  return `${mapping.a}:${mapping.b}:${mapping.c}`
}

export function automaticAxisMappingForUp(
  scene: SceneGeometry,
  face: MeshFace,
  localUp: Point3,
): AxisMapping | undefined {
  const partial = mappingWithLocalUp(localUp)
  if (!partial) return undefined
  const parity = sceneLatticeParity(scene, face)
  if (parity === undefined) return partial
  const completions = validAxisMappingCompletions(partial, parity)
  if (completions.length === 0) return undefined

  const center = scale3(
    faceCornersLattice(face).reduce(
      (sum, corner) => add3(sum, corner),
      { x: 0, y: 0, z: 0 },
    ),
    0.25,
  )
  const origin = projectScenePoint(scene, center)
  return completions
    .map((mapping) => {
      const north = localVectorForWorld(mapping, { x: 0, y: 0, z: -1 })
      const endpoint = north
        ? projectScenePoint(scene, add3(center, north))
        : undefined
      const dx = origin && endpoint ? endpoint.x - origin.x : 0
      const dy = origin && endpoint ? endpoint.y - origin.y : 0
      const length = Math.hypot(dx, dy)
      // Prefer the completion whose north direction points most toward the top
      // of the screenshot. Unprojectable/degenerate candidates fall back to a
      // stable lexical ordering, so the automatic working frame never drifts.
      return {
        mapping,
        forwardScore: length > EPSILON ? dy / length : Number.POSITIVE_INFINITY,
        lateralScore: length > EPSILON ? Math.abs(dx) / length : 1,
      }
    })
    .sort(
      (left, right) =>
        left.forwardScore - right.forwardScore ||
        left.lateralScore - right.lateralScore ||
        mappingSortKey(left.mapping).localeCompare(mappingSortKey(right.mapping)),
    )[0]?.mapping
}

export function axisMappingFromUpAndHorizontal(
  scene: SceneGeometry,
  localUp: Point3,
  localHorizontal: Point3,
  horizontalDirection: FaceDirection,
): AxisMapping | undefined {
  if (horizontalDirection === 'up' || horizontalDirection === 'down') {
    return undefined
  }
  return axisMappingFromReferences(
    localUp,
    'up',
    localHorizontal,
    horizontalDirection,
    sceneLatticeParity(scene),
  )
}

export function possibleFacesForLocalNormal(
  mapping: AxisMapping,
  normal: Point3,
  parity?: LatticeParity,
): FaceDirection[] {
  return [
    ...new Set(
      validAxisMappingCompletions(mapping, parity)
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
    // Partial pivoting avoids magnifying error when the diagonal entry is
    // small but another row provides a stable pivot.
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
  // Hartley normalization centers points and makes their mean radius sqrt(2),
  // improving the conditioning of the homography least-squares fit.
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
    // Least-squares rows use sqrt(weight) so the squared residual receives the
    // original observation weight.
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

function projectiveMatrixParity(
  matrix: readonly number[],
  depths: number[],
): LatticeParity | undefined {
  const determinant =
    matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) -
    matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) +
    matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6])
  const columnLengths = [0, 1, 2].map((column) =>
    Math.hypot(matrix[column], matrix[3 + column], matrix[6 + column]),
  )
  const determinantScale = columnLengths.reduce(
    (product, length) => product * length,
    1,
  )
  if (
    !Number.isFinite(determinant) ||
    determinantScale <= EPSILON ||
    Math.abs(determinant) / determinantScale <= 1e-8
  ) {
    return undefined
  }
  const depthScale = Math.max(1, ...depths.map(Math.abs))
  if (
    depths.some(
      (depth) =>
        !Number.isFinite(depth) || Math.abs(depth) <= depthScale * 1e-8,
    )
  ) {
    return undefined
  }
  const depthSign = Math.sign(depths[0])
  if (depths.some((depth) => Math.sign(depth) !== depthSign)) return undefined
  return Math.sign(determinant * depths[0]) as LatticeParity
}

/**
 * Returns the parity of the abstract A/B/C lattice relative to an ordinary
 * unmirrored, right-handed camera frame (pixel X right, pixel Y down, depth
 * forward). The determinant alone is projective-scale dependent; multiplying
 * it by a representative homogeneous depth makes the sign scale invariant.
 */
export function cameraLatticeParity(
  scene: SceneGeometry,
): LatticeParity | undefined {
  if (scene.projection?.kind !== 'camera') return undefined
  const matrix = scene.projection.matrix
  const linear = [
    matrix[0], matrix[1], matrix[2],
    matrix[4], matrix[5], matrix[6],
    matrix[8], matrix[9], matrix[10],
  ]
  const observationPoints = scene.observations.map(
    (observation) => observation.lattice,
  )
  const referencePoints =
    observationPoints.length > 0
      ? observationPoints
      : scene.faces.length > 0
        ? scene.faces.map((face) =>
            scale3(
              faceCornersLattice(face).reduce(
                (sum, corner) => add3(sum, corner),
                { x: 0, y: 0, z: 0 },
              ),
              0.25,
            ),
          )
        : [{ x: 0, y: 0, z: 0 }]
  const depths = referencePoints.map(
    (point) =>
      matrix[8] * point.x +
      matrix[9] * point.y +
      matrix[10] * point.z +
      matrix[11],
  )
  return projectiveMatrixParity(linear, depths)
}

/**
 * A planar homography does not recover the missing projection column, but a
 * camera-facing plane normal supplies its required sign. For an unmirrored
 * image, the homography winding and that signed normal determine the same
 * lattice parity that a later full camera fit would report.
 */
export function planarLatticeParity(
  scene: SceneGeometry,
  referenceFace?: MeshFace,
): LatticeParity | undefined {
  const projection = scene.projection
  if (projection?.kind !== 'planar') return undefined
  const face =
    referenceFace ??
    (scene.worldUpIntent
      ? scene.faces.find((candidate) => candidate.id === scene.worldUpIntent?.faceId)
      : undefined)
  if (!face) return undefined

  const planeNormal = cross3(projection.uAxis, projection.vAxis)
  const normalOrientation = dot3(planeNormal, face.normal)
  const orientationScale =
    Math.hypot(planeNormal.x, planeNormal.y, planeNormal.z) *
    Math.hypot(face.normal.x, face.normal.y, face.normal.z)
  if (
    orientationScale <= EPSILON ||
    Math.abs(normalOrientation) / orientationScale < 1 - 1e-8
  ) {
    return undefined
  }

  const localCorners = faceCornersLattice(face).map((corner) =>
    localCoordinatesOnPlane(
      projection.origin,
      projection.uAxis,
      projection.vAxis,
      corner,
    ),
  )
  if (localCorners.some((corner) => corner === undefined)) return undefined
  const depths = localCorners.map(
    (corner) =>
      projection.homography[6] * corner!.x +
      projection.homography[7] * corner!.y +
      projection.homography[8],
  )
  const projectedParity = projectiveMatrixParity(
    projection.homography,
    depths,
  )
  if (projectedParity === undefined) return undefined

  return (-Math.sign(normalOrientation) * projectedParity) as LatticeParity
}

export function sceneLatticeParity(
  scene: SceneGeometry,
  planarReferenceFace?: MeshFace,
): LatticeParity | undefined {
  return scene.projection?.kind === 'camera'
    ? cameraLatticeParity(scene)
    : planarLatticeParity(scene, planarReferenceFace)
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
  // Construction history is deliberately absent from MeshFace. Canonical
  // local axes are derived from the face plane whenever corners are needed.
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

export function cameraCenter(scene: SceneGeometry): Point3 | undefined {
  if (scene.projection?.kind !== 'camera') return undefined
  const matrix = scene.projection.matrix
  try {
    // The camera center is the finite null point of the 3x4 projection matrix.
    const [x, y, z] = solveLinearSystem(
      [
        [matrix[0], matrix[1], matrix[2]],
        [matrix[4], matrix[5], matrix[6]],
        [matrix[8], matrix[9], matrix[10]],
      ],
      [-matrix[3], -matrix[7], -matrix[11]],
    )
    return [x, y, z].every(Number.isFinite) ? { x, y, z } : undefined
  } catch {
    return undefined
  }
}

const MIN_CAMERA_FACING_COSINE = 0.02

function normalFacingPoint(
  face: MeshFace,
  point: Point3,
): Point3 {
  const center = scale3(
    faceCornersLattice(face).reduce(
      (sum, corner) => add3(sum, corner),
      { x: 0, y: 0, z: 0 },
    ),
    0.25,
  )
  const toPoint = subtract3(point, center)
  const distanceToPoint = Math.hypot(toPoint.x, toPoint.y, toPoint.z)
  const normalLength = Math.hypot(face.normal.x, face.normal.y, face.normal.z)
  if (distanceToPoint <= EPSILON || normalLength <= EPSILON) return face.normal

  const facing = dot3(face.normal, toPoint)
  const cosine = facing / (distanceToPoint * normalLength)
  if (!Number.isFinite(cosine) || Math.abs(cosine) < MIN_CAMERA_FACING_COSINE) {
    return face.normal
  }
  return cosine >= 0 ? face.normal : negate3(face.normal)
}

export function cameraFacingNormal(
  scene: SceneGeometry,
  face: MeshFace,
): Point3 {
  const center = cameraCenter(scene)
  return center ? normalFacingPoint(face, center) : face.normal
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

/**
 * Rebuilds a planar solve when every surviving face lies on one lattice plane.
 * Calibration observations deliberately remain independent of face lifetime;
 * only observations on the remaining plane contribute to the replacement fit.
 */
export function planarProjectionForCoplanarFaces(
  faces: MeshFace[],
  observations: CalibrationObservation[],
): { projection: PlanarProjection; observations: CalibrationObservation[] } | undefined {
  const firstFace = faces[0]
  if (!firstFace) return undefined

  const cornerLattice = faceCornersLattice(firstFace)
  const origin = cornerLattice[0]
  const uAxis = subtract3(cornerLattice[1], origin)
  const vAxis = subtract3(cornerLattice[3], origin)
  const normal = cross3(uAxis, vAxis)
  if (dot3(normal, normal) <= EPSILON) return undefined

  const liesOnPlane = (point: Point3) =>
    dot3(normal, subtract3(point, origin)) === 0

  if (faces.some((face) => faceCornersLattice(face).some((corner) => !liesOnPlane(corner)))) {
    return undefined
  }

  const planarObservations = observations.filter((observation) =>
    liesOnPlane(observation.lattice),
  )
  try {
    return {
      projection: planarProjectionForPlane(
        origin,
        uAxis,
        vAxis,
        cornerLattice,
        planarObservations,
      ),
      observations: planarObservations,
    }
  } catch {
    // Fewer than four usable dots, or a degenerate dot arrangement, cannot
    // replace a camera solve with a meaningful homography.
    return undefined
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
  if (!projection) return undefined
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
  resolvedAxes: 0 | 2 | 3
  rmsError: number
  maxError: number
}

export function projectionInfo(scene: SceneGeometry): ProjectionInfo {
  if (scene.projection?.kind === 'camera') {
    return {
      resolvedAxes: 3,
      rmsError: scene.projection.rmsError,
      maxError: scene.projection.maxError,
    }
  }
  if (scene.projection) {
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
  return { resolvedAxes: 0, rmsError: 0, maxError: 0 }
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
  // A tiny scale-relative ridge stabilizes nearly singular calibration poses
  // without materially moving a well-conditioned solution.
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
  // Projective scale is arbitrary; fixing the final coefficient to one leaves
  // eleven unknowns that the paired image equations can fit linearly.
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

export interface CameraFitDiagnostics {
  finite: boolean
  minAxisLength: number
  minAxisSeparationDegrees: number
}

export function cameraFitDiagnostics(
  projection: CameraProjection,
  reference: Point3,
): CameraFitDiagnostics {
  const origin = projectCamera(projection.matrix, reference)
  const vectors = (['a', 'b', 'c'] as const).map((axis) => {
    const endpoint = projectCamera(
      projection.matrix,
      add3(reference, abstractAxisVector(axis)),
    )
    return { x: endpoint.x - origin.x, y: endpoint.y - origin.y }
  })
  const lengths = vectors.map((vector) => Math.hypot(vector.x, vector.y))
  const separations: number[] = []
  for (let left = 0; left < vectors.length; left += 1) {
    for (let right = left + 1; right < vectors.length; right += 1) {
      const denominator = lengths[left] * lengths[right]
      const sine =
        denominator <= EPSILON
          ? 0
          : Math.min(
              1,
              Math.abs(
                vectors[left].x * vectors[right].y -
                  vectors[left].y * vectors[right].x,
              ) / denominator,
            )
      separations.push((Math.asin(sine) * 180) / Math.PI)
    }
  }
  const values = [
    ...projection.matrix,
    origin.x,
    origin.y,
    ...vectors.flatMap((vector) => [vector.x, vector.y]),
  ]
  return {
    finite: values.every(Number.isFinite),
    minAxisLength: Math.min(...lengths),
    minAxisSeparationDegrees: Math.min(...separations),
  }
}

export function refitProjection(
  scene: SceneGeometry,
): SceneProjection | null {
  if (!scene.projection) return null
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
  if (scene.observations.length >= 6 && outOfPlaneObservations.length >= 2) {
    try {
      return fitCameraProjection(scene.observations)
    } catch {
      // Retain the stable planar model until the new anchors are well-conditioned.
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

const MIN_TRAPEZOID_EDGE_RATIO = 1.1

export function inferInitialFaceNormal(
  corners: [Point2, Point2, Point2, Point2],
): Point3 {
  const signedArea = corners.reduce((sum, corner, index) => {
    const next = corners[(index + 1) % corners.length]
    return sum + corner.x * next.y - next.x * corner.y
  }, 0)
  const windingFallback =
    signedArea >= 0 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 0, z: -1 }

  const topMidpointY = (corners[0].y + corners[1].y) * 0.5
  const bottomMidpointY = (corners[2].y + corners[3].y) * 0.5
  if (signedArea <= EPSILON || topMidpointY >= bottomMidpointY) {
    return windingFallback
  }
  const topLength = distance(corners[0], corners[1])
  const bottomLength = distance(corners[3], corners[2])
  if (topLength <= EPSILON || bottomLength <= EPSILON) return windingFallback
  if (bottomLength / topLength >= MIN_TRAPEZOID_EDGE_RATIO) {
    return { x: 0, y: 0, z: 1 }
  }
  if (topLength / bottomLength >= MIN_TRAPEZOID_EDGE_RATIO) {
    return { x: 0, y: 0, z: -1 }
  }
  return windingFallback
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

export function orientationEdgeGeometry(
  face: MeshFace,
  edge: FaceEdge,
): FaceEdgeGeometry {
  const corners = faceCornersLattice(face)
  const center = scale3(
    corners.reduce(
      (sum, corner) => add3(sum, corner),
      { x: 0, y: 0, z: 0 },
    ),
    0.25,
  )
  const boundary = faceEdgeGeometry(face, edge)
  const midpoint = scale3(add3(boundary.start, boundary.end), 0.5)
  return {
    start: center,
    end: midpoint,
    direction: scale3(subtract3(midpoint, center), 2),
    length: 0.5,
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
  // Traverse shared mesh edges but stop at hinges. Parallel and antiparallel
  // normals belong to the same flat surface for a bulk visible-side flip.
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
    // Chained selections expose two odd-degree endpoints; a loop falls back to
    // the most recent edge because it has no unique outer endpoints.
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

function faceSurfaceKey(face: MeshFace): string {
  // A face's visible normal may be flipped, but its square still occupies the
  // same surface.  Collision detection therefore keys the plane axis and the
  // canonical minimum corner, rather than the signed normal.
  const planeAxis = face.normal.x !== 0 ? 'x' : face.normal.y !== 0 ? 'y' : 'z'
  return `${planeAxis}:${point3Key(face.blockCoordinate)}`
}

function extrusionMovesIntoSelectedFace(
  scene: SceneGeometry,
  selections: SelectedEdge[],
  axis: Point3,
): boolean {
  return selections.some((selection) => {
    const face = scene.faces.find((entry) => entry.id === selection.faceId)
    const edge = selectedEdgeGeometry(scene, selection)
    if (!face || !edge) return false
    const center = scale3(
      faceCornersLattice(face).reduce((sum, corner) => add3(sum, corner), {
        x: 0,
        y: 0,
        z: 0,
      }),
      0.25,
    )
    const midpoint = scale3(add3(edge.start, edge.end), 0.5)
    // Moving from the selected boundary toward this center would recreate the
    // source unit square on the first extrusion step.
    return dot3(axis, subtract3(center, midpoint)) > EPSILON
  })
}

/**
 * Returns how many whole extrusion steps can be added before the generated
 * surface reaches an existing face.  A collision caps the extension instead
 * of allowing it to pass through and create duplicate evidence geometry.
 */
export function availableExtrusionBlocks(
  scene: SceneGeometry,
  selections: SelectedEdge[],
  axis: Point3,
  maxBlocks = 64,
): number {
  if (extrusionMovesIntoSelectedFace(scene, selections, axis)) return 0

  const occupied = new Set(scene.faces.map(faceSurfaceKey))
  const layerFaceCount = createEdgeExtrusionFaces(
    scene,
    selections,
    axis,
    1,
    () => '__collision_layer__',
  ).length
  if (layerFaceCount === 0) return 0
  for (let blocks = 1; blocks <= maxBlocks; blocks += 1) {
    const allFaces = createEdgeExtrusionFaces(
      scene,
      selections,
      axis,
      blocks,
      () => `__collision_${blocks}__`,
    )
    const priorKeys = new Set(
      blocks === 1
        ? []
        : createEdgeExtrusionFaces(
            scene,
            selections,
            axis,
            blocks - 1,
            () => `__collision_${blocks - 1}__`,
          ).map(faceSurfaceKey),
    )
    const nextFaces = allFaces.filter(
      (face) => !priorKeys.has(faceSurfaceKey(face)),
    )
    // createEdgeExtrusionFaces de-duplicates repeated selected edges. Compare
    // only the newly-added depth layer, including overlaps within that layer.
    const nextKeys = nextFaces.map(faceSurfaceKey)
    if (
      nextKeys.length === 0 ||
      new Set(nextKeys).size !== nextKeys.length ||
      nextKeys.some((key) => occupied.has(key))
    ) {
      return blocks - 1
    }
    nextKeys.forEach((key) => occupied.add(key))
  }
  return maxBlocks
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
  if (geometries.length === 0 || !scene.projection) return undefined
  const referenceGeometry = geometries[geometries.length - 1]
  if (scene.projection.kind === 'planar') {
    // A homography measures only its plane. Snap near an in-plane ray; moving
    // away requests the first perpendicular face and completes the 3D solve.
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
    ].filter(
      (axis, index, axes) =>
        axes.findIndex((candidate) => same3(candidate, axis)) === index &&
        geometries.every(
          (geometry) => Math.abs(dot3(axis, geometry.direction)) < EPSILON,
        ),
    )
    let bestInPlane:
      | (EdgeExtrusion & {
          pointerDistance: number
          pathDistance: number
          unitLength: number
        })
      | undefined
    for (const axis of inPlaneAxes) {
      const availableBlocks = availableExtrusionBlocks(
        scene,
        selections,
        axis,
        maxBlocks,
      )
      if (availableBlocks === 0) continue
      let previous = projectScenePoint(scene, midpoint)
      if (!previous) continue
      const first = projectScenePoint(scene, add3(midpoint, axis))
      if (!first) continue
      const unitLength = distance(previous, first)
      let pathDistance = Number.POSITIVE_INFINITY
      let pointerDistance = Number.POSITIVE_INFINITY
      let bestBlocks = 1
      for (let blocks = 1; blocks <= availableBlocks; blocks += 1) {
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
    return availableExtrusionBlocks(scene, selections, face.normal, 1) > 0
      ? { axis: face.normal, blocks: 1, createsAxis: true }
      : undefined
  }

  const candidates = extrusionDirections
    .filter((axis) =>
      geometries.every((geometry) => dot3(axis, geometry.direction) === 0),
    )
    .map((axis) => ({
      axis,
      availableBlocks: availableExtrusionBlocks(scene, selections, axis, maxBlocks),
    }))
    .filter((candidate) => candidate.availableBlocks > 0)
  let best: (EdgeExtrusion & { distance: number }) | undefined
  for (const { axis, availableBlocks } of candidates) {
    const midpoint = scale3(
      add3(referenceGeometry.start, referenceGeometry.end),
      0.5,
    )
    for (let blocks = 1; blocks <= availableBlocks; blocks += 1) {
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

/**
 * Promotes a planar solve without moving it.  The depth anchors are first
 * treated as soft targets, then reprojected from a camera whose depth-zero
 * slice is exactly the existing homography.  Once committed this is an
 * ordinary camera projection; later handle edits use the usual global fit.
 */
export function initialCameraForPlanarExtrusion(
  scene: SceneGeometry,
  selections: SelectedEdge[],
  depthAxis: Point3,
  blocks: number,
  pointer: Point2,
): { projection: CameraProjection; endpoints: [Point3, Point3]; images: [Point2, Point2] } | undefined {
  if (scene.projection?.kind !== 'planar') return undefined
  const targets = translatedExtrusionAnchors(scene, selections, pointer)
  if (!targets) return undefined
  const { origin, uAxis, vAxis, homography } = scene.projection
  const depthLength = dot3(depthAxis, depthAxis)
  if (depthLength <= EPSILON) return undefined
  const rows: number[][] = []
  const values: number[] = []
  const endpoints = targets.endpoints.map((endpoint) =>
    add3(endpoint, scale3(depthAxis, blocks)),
  ) as [Point3, Point3]
  endpoints.forEach((point, index) => {
    const delta = subtract3(point, origin)
    const a = dot3(delta, uAxis) / dot3(uAxis, uAxis)
    const b = dot3(delta, vAxis) / dot3(vAxis, vAxis)
    const c = dot3(delta, depthAxis) / depthLength
    const denominator = homography[6] * a + homography[7] * b + homography[8]
    const xNumerator = homography[0] * a + homography[1] * b + homography[2]
    const yNumerator = homography[3] * a + homography[4] * b + homography[5]
    const target = targets.images[index]
    rows.push([c, 0, -target.x * c])
    values.push(target.x * denominator - xNumerator)
    rows.push([0, c, -target.y * c])
    values.push(target.y * denominator - yNumerator)
  })
  const [depthX, depthY, depthW] = solveLeastSquares(rows, values)
  const localCamera: Matrix3x4 = [
    homography[0], homography[1], depthX, homography[2],
    homography[3], homography[4], depthY, homography[5],
    homography[6], homography[7], depthW, homography[8],
  ]
  const axes = [uAxis, vAxis, depthAxis]
  const basisRows = axes.map((axis) => {
    const length = dot3(axis, axis)
    return [
      axis.x / length,
      axis.y / length,
      axis.z / length,
      -dot3(origin, axis) / length,
    ]
  })
  const matrix = ([0, 1, 2] as const).flatMap((row) =>
    [0, 1, 2, 3].map(
      (column) =>
        localCamera[row * 4] * basisRows[0][column] +
        localCamera[row * 4 + 1] * basisRows[1][column] +
        localCamera[row * 4 + 2] * basisRows[2][column] +
        localCamera[row * 4 + 3] * (column === 3 ? 1 : 0),
    ),
  ) as Matrix3x4
  const scale = matrix[11]
  if (!Number.isFinite(scale) || Math.abs(scale) <= EPSILON) return undefined
  const normalized = matrix.map((value) => value / scale) as Matrix3x4
  const images = endpoints.map((endpoint) => projectCamera(normalized, endpoint)) as [Point2, Point2]
  const errors = scene.observations.map((observation) =>
    distance(projectCamera(normalized, observation.lattice), observation.image),
  )
  return {
    projection: {
      kind: 'camera',
      matrix: normalized,
      rmsError: Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / Math.max(1, errors.length)),
      maxError: Math.max(0, ...errors),
    },
    endpoints,
    images,
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
    const sourceFace = scene.faces.find((face) => face.id === selection.faceId)
    const geometry = selectedEdgeGeometry(scene, selection)
    if (!sourceFace || !geometry) continue
    const key = meshEdgeKey(geometry.start, geometry.end)
    if (seen.has(key)) continue
    seen.add(key)
    const coplanar =
      Math.abs(dot3(sourceFace.normal, extrusionAxis)) <= EPSILON
    for (let depth = 0; depth < blocks; depth += 1) {
      const start = add3(geometry.start, scale3(extrusionAxis, depth))
      const end = add3(geometry.end, scale3(extrusionAxis, depth))
      const corners = [
        start,
        end,
        add3(end, extrusionAxis),
        add3(start, extrusionAxis),
      ]
      const face: MeshFace = {
        id: makeId(),
        // Taking component minima normalizes negative extrusions to the
        // adjacent unit cell while keeping MeshFace storage canonical.
        blockCoordinate: {
          x: Math.min(...corners.map((corner) => corner.x)),
          y: Math.min(...corners.map((corner) => corner.y)),
          z: Math.min(...corners.map((corner) => corner.z)),
        },
        normal: coplanar
          ? sourceFace.normal
          : cross3(geometry.direction, extrusionAxis),
      }
      if (!coplanar) face.normal = cameraFacingNormal(scene, face)
      result.push(face)
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

export interface FaceNormalIndicator {
  origin: Point2
  direction: Point2
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
  }
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
  if (
    !isAxisMappingComplete(
      scene.axisMapping,
      sceneLatticeParity(scene),
    )
  ) {
    return undefined
  }
  const face = faceForLocalNormal(scene.axisMapping, meshFace.normal)
  if (!face) return undefined
  const target =
    face === 'down'
      ? axesForFaceRotation(face, 2)
      : defaultAxesForFace(face)
  // Canonical world ordering makes crops independent of the edge and direction
  // from which a face was constructed. Bottom faces need a half-turn so their
  // displayed orientation matches the external view convention.
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
      return { uAxis: { x: -1, y: 0, z: 0 }, vAxis: { x: 0, y: -1, z: 0 } }
    case 'south':
      return { uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: -1, z: 0 } }
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
