import type { FaceDirection, PerspectivePlane, Point2, Point3 } from './types'

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
