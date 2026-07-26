import type {
  CandidateTransform,
  FaceDirection,
  PerspectivePlane,
  Point2,
  Point3,
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

const add3 = (a: Point3, b: Point3): Point3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
})

const scale3 = (value: Point3, scalar: number): Point3 => ({
  x: value.x * scalar,
  y: value.y * scalar,
  z: value.z * scalar,
})

const dot3 = (a: Point3, b: Point3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z

const negate3 = (value: Point3): Point3 => ({
  x: value.x === 0 ? 0 : -value.x,
  y: value.y === 0 ? 0 : -value.y,
  z: value.z === 0 ? 0 : -value.z,
})

const same3 = (a: Point3, b: Point3): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z

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
    axes = {
      uAxis: negate3(axes.vAxis),
      vAxis: axes.uAxis,
    }
  }
  return axes
}

export function planeAxisRotation(plane: PerspectivePlane): number | undefined {
  for (let quarterTurns = 0; quarterTurns < 4; quarterTurns += 1) {
    const axes = axesForFaceRotation(plane.face, quarterTurns)
    if (same3(plane.uAxis, axes.uAxis) && same3(plane.vAxis, axes.vAxis)) {
      return quarterTurns
    }
  }
  return undefined
}

export function canonicalCropTransform(
  plane: PerspectivePlane,
): CandidateTransform {
  const currentRotation = planeAxisRotation(plane) ?? 0
  const targetRotation = plane.face === 'down' ? 2 : 0
  const requiredRotation = (targetRotation - currentRotation + 4) % 4
  return (
    ['identity', 'rotate90', 'rotate180', 'rotate270'] as const
  )[requiredRotation]
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

function faceNormal(face: FaceDirection): Point3 {
  return {
    up: { x: 0, y: 1, z: 0 },
    down: { x: 0, y: -1, z: 0 },
    north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 },
    east: { x: 1, y: 0, z: 0 },
    west: { x: -1, y: 0, z: 0 },
  }[face]
}

function normalize2(value: Point2): Point2 {
  const length = Math.hypot(value.x, value.y)
  return length > 1e-8 ? { x: value.x / length, y: value.y / length } : { x: 0, y: -1 }
}

export function projectedWorldAxes(
  plane: PerspectivePlane,
): Record<'x' | 'y' | 'z', Point2> {
  const homography = planeHomography(plane)
  const origin = projectPoint(homography, { x: 0, y: 0 })
  const uPoint = projectPoint(homography, { x: 1, y: 0 })
  const vPoint = projectPoint(homography, { x: 0, y: 1 })
  const uDirection = normalize2({ x: uPoint.x - origin.x, y: uPoint.y - origin.y })
  const vDirection = normalize2({ x: vPoint.x - origin.x, y: vPoint.y - origin.y })
  const outwardCandidate = {
    x: -uDirection.x - vDirection.x,
    y: -uDirection.y - vDirection.y,
  }
  let outward: Point2
  if (Math.hypot(outwardCandidate.x, outwardCandidate.y) < 1e-8) {
    outward = normalize2({ x: -uDirection.y, y: uDirection.x })
    if (outward.y > 0) outward = { x: -outward.x, y: -outward.y }
  } else {
    outward = normalize2(outwardCandidate)
  }
  const normal = faceNormal(plane.face)

  const projectAxis = (axis: Point3): Point2 => {
    const alongU = dot3(axis, plane.uAxis)
    if (Math.abs(alongU) > 0.5) {
      return { x: uDirection.x * alongU, y: uDirection.y * alongU }
    }
    const alongV = dot3(axis, plane.vAxis)
    if (Math.abs(alongV) > 0.5) {
      return { x: vDirection.x * alongV, y: vDirection.y * alongV }
    }
    const alongNormal = dot3(axis, normal)
    return { x: outward.x * alongNormal, y: outward.y * alongNormal }
  }

  return {
    x: projectAxis({ x: 1, y: 0, z: 0 }),
    y: projectAxis({ x: 0, y: 1, z: 0 }),
    z: projectAxis({ x: 0, y: 0, z: 1 }),
  }
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

    if (Math.abs(augmented[pivot][column]) < 1e-10) {
      throw new Error('The selected corners do not form a valid perspective plane.')
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

export function planeHomography(plane: PerspectivePlane): Homography {
  return computeHomography(
    [
      { x: 0, y: 0 },
      { x: plane.columns, y: 0 },
      { x: plane.columns, y: plane.rows },
      { x: 0, y: plane.rows },
    ],
    plane.corners,
  )
}

export function cellQuad(
  plane: PerspectivePlane,
  column: number,
  row: number,
): [Point2, Point2, Point2, Point2] {
  const h = planeHomography(plane)
  return [
    projectPoint(h, { x: column, y: row }),
    projectPoint(h, { x: column + 1, y: row }),
    projectPoint(h, { x: column + 1, y: row + 1 }),
    projectPoint(h, { x: column, y: row + 1 }),
  ]
}

export function cellCoordinate(
  plane: PerspectivePlane,
  column: number,
  row: number,
): Point3 {
  return add3(
    add3(plane.origin, scale3(plane.uAxis, column)),
    scale3(plane.vAxis, row),
  )
}

export function cellKey(column: number, row: number): string {
  return `${column}:${row}`
}

export function evidenceId(planeId: string, column: number, row: number): string {
  return `${planeId}:${column}:${row}`
}

export function flattenPoints(points: Point2[]): number[] {
  return points.flatMap((point) => [point.x, point.y])
}

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function createHingedPlane(
  source: PerspectivePlane,
  id: string,
): PerspectivePlane {
  const [topLeft, topRight, bottomRight] = source.corners
  const edgeDx = topRight.x - topLeft.x
  const edgeDy = topRight.y - topLeft.y
  const length = Math.max(48, Math.hypot(edgeDx, edgeDy) * 0.28)
  const normal = Math.hypot(edgeDx, edgeDy) || 1
  const offset = {
    x: (-edgeDy / normal) * length,
    y: (edgeDx / normal) * length,
  }
  const nextFace: FaceDirection =
    source.face === 'up' || source.face === 'down' ? 'north' : 'up'
  const axes = defaultAxesForFace(nextFace)

  return {
    id,
    name: `${source.name} · connected`,
    corners: [
      topRight,
      { x: topRight.x + offset.x, y: topRight.y + offset.y },
      { x: bottomRight.x + offset.x, y: bottomRight.y + offset.y },
      bottomRight,
    ],
    columns: 2,
    rows: source.rows,
    face: nextFace,
    origin: add3(source.origin, scale3(source.uAxis, source.columns)),
    uAxis: axes.uAxis,
    vAxis: axes.vAxis,
    inactiveCells: [],
    connectedTo: { planeId: source.id, edge: 'right' },
  }
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
