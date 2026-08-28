import type {
  FaceDirection,
  SearchDirection,
  TextureAlgorithm,
} from './types'
import type { ExportEvidence } from './exportConfig'

export interface CompiledFilterConstraint {
  x: number
  y: number
  z: number
  acceptedIndices: number
}

export interface CompiledFilterDirection {
  direction: SearchDirection
  constraints: CompiledFilterConstraint[]
  forcedErrors: number
}

// Netherrack's visible raw-PNG rotations for model indices 0 through 15.
// Face order matches native CoordsFinder: up, down, north, south, east, west.
const netherrackFaceRotations = [
  [0, 0, 0, 0, 0, 0],
  [0, 2, 2, 0, 1, 3],
  [0, 0, 2, 2, 2, 2],
  [2, 0, 2, 0, 3, 1],
  [1, 3, 0, 0, 0, 0],
  [1, 1, 3, 1, 2, 0],
  [1, 3, 2, 2, 2, 2],
  [3, 3, 1, 3, 2, 0],
  [2, 2, 0, 0, 0, 0],
  [2, 0, 0, 2, 3, 1],
  [2, 2, 2, 2, 2, 2],
  [0, 2, 0, 2, 1, 3],
  [3, 1, 0, 0, 0, 0],
  [3, 3, 1, 3, 0, 2],
  [3, 1, 2, 2, 2, 2],
  [1, 1, 3, 1, 0, 2],
] as const

const faceOrder: FaceDirection[] = ['up', 'down', 'north', 'south', 'east', 'west']
const horizontalFaces: FaceDirection[] = ['north', 'east', 'south', 'west']

function rotateXz(x: number, z: number, turns: number): [number, number] {
  if (turns === 1) return [-z, x]
  if (turns === 2) return [-x, -z]
  if (turns === 3) return [z, -x]
  return [x, z]
}

function rotateFace(face: FaceDirection, turns: number): FaceDirection {
  const index = horizontalFaces.indexOf(face)
  return index < 0 ? face : horizontalFaces[(index + turns) % 4]
}

function visibleFourWay(
  algorithm: TextureAlgorithm,
  modelIndex: number,
): number {
  return algorithm === 'Vanilla-3' ? modelIndex >> 2 : modelIndex & 3
}

function observationMask(
  evidence: ExportEvidence,
  algorithm: TextureAlgorithm,
  turns: number,
): number {
  let face = evidence.face
  let rotation = evidence.selectedVariant!
  if (evidence.blockId === 'netherrack') {
    face = rotateFace(face, turns)
    if (face === 'up') rotation = (rotation + turns) % 4
    if (face === 'down') rotation = (rotation + 4 - turns) % 4
  } else if (evidence.stateCount === 4) {
    rotation = (rotation + turns) % 4
  }

  let mask = 0
  for (let modelIndex = 0; modelIndex < 16; modelIndex += 1) {
    const accepted = evidence.blockId === 'netherrack'
      ? netherrackFaceRotations[modelIndex][faceOrder.indexOf(face)] === rotation
      : evidence.stateCount === 2
        ? (visibleFourWay(algorithm, modelIndex) & 1) === rotation
        : visibleFourWay(algorithm, modelIndex) === rotation
    if (accepted) mask |= 1 << modelIndex
  }
  return mask
}

export function acceptedIndexCount(value: number): number {
  let remaining = value & 0xffff
  let count = 0
  while (remaining !== 0) {
    remaining &= remaining - 1
    count += 1
  }
  return count
}

export function compileFilterDirections(
  rows: ExportEvidence[],
  algorithm: TextureAlgorithm,
  directions: SearchDirection[],
): CompiledFilterDirection[] {
  return directions.map((direction) => {
    const turns = direction / 90
    const groups = new Map<string, {
      x: number
      y: number
      z: number
      family: 'ordinary' | 'netherrack'
      acceptedIndices: number
    }>()

    rows.forEach((entry) => {
      const [x, z] = rotateXz(entry.coordinate.x, entry.coordinate.z, turns)
      const key = `${x}:${entry.coordinate.y}:${z}`
      const family = entry.blockId === 'netherrack' ? 'netherrack' : 'ordinary'
      const acceptedIndices = observationMask(entry, algorithm, turns)
      const existing = groups.get(key)
      if (existing && existing.family !== family) {
        throw new Error(`Block offset (${x}, ${entry.coordinate.y}, ${z}) mixes ordinary and netherrack evidence.`)
      }
      if (existing) existing.acceptedIndices &= acceptedIndices
      else groups.set(key, { x, y: entry.coordinate.y, z, family, acceptedIndices })
    })

    let forcedErrors = 0
    const constraints = [...groups.values()]
      .flatMap(({ x, y, z, acceptedIndices }) => {
        if (acceptedIndices === 0) {
          forcedErrors += 1
          return []
        }
        return [{ x, y, z, acceptedIndices }]
      })
      .sort((left, right) => acceptedIndexCount(left.acceptedIndices) - acceptedIndexCount(right.acceptedIndices))

    return { direction, constraints, forcedErrors }
  })
}

export function informationBits(direction: CompiledFilterDirection): number {
  return direction.constraints.reduce(
    (sum, constraint) => sum + Math.log2(16 / acceptedIndexCount(constraint.acceptedIndices)),
    0,
  )
}
