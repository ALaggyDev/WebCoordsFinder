import { offsetFromNibbles, offsetProfiles, offsetReadiness } from './blockOffsets'
import { mappedAnchorOffset } from './geometry'
import type { EditorDocument, SearchDirection } from './types'

export interface OffsetConstraint {
  dx: number
  dz: number
  acceptedX: number
  acceptedY: number
  acceptedZ: number
}

/** All seeds producing the same visible displacement remain valid evidence. */
export function acceptedOffsetNibbles(blockId: string, axis: 'x' | 'y' | 'z', selected: number): number {
  const profile = offsetProfiles[blockId]
  if (axis === 'y' && profile.type === 'XZ') return 0xffff
  const value = (n: number) => offsetFromNibbles(profile, { x: n, y: n, z: n })[axis]
  let accepted = 0
  for (let n = 0; n < 16; n++) {
    if (value(n) === value(selected)) accepted |= 1 << n
  }
  return accepted
}

function reverseNibbles(mask: number): number {
  let reversed = 0
  for (let n = 0; n < 16; n++) if (mask & (1 << n)) reversed |= 1 << (15 - n)
  return reversed
}

/** Rotate measured displacement with its owning block, around the shared anchor. */
export function compileOffsetDirections(document: EditorDocument): OffsetConstraint[][] {
  const active = (document.offsets ?? []).filter((entry) => !entry.ignored)
  if (!active.length) return document.scanner.directions.map(() => [])
  const blocked = offsetReadiness(document)
  if (blocked) throw new Error(blocked)
  if (active.length > 256) throw new Error('The browser scanner accepts at most 256 active offset observations.')
  const constraints = active.map((entry): OffsetConstraint => {
    const position = mappedAnchorOffset(document.scene, document.anchorFaceId, entry.position)
    if (!position) throw new Error('Select an anchor block in Geometry first.')
    if (![position.x, position.z].every((n) => Number.isInteger(n) && Math.abs(n) <= 2_147_483_647)) {
      throw new Error('An offset observation is outside the 32-bit coordinate range.')
    }
    return {
      dx: position.x, dz: position.z,
      acceptedX: acceptedOffsetNibbles(entry.blockId, 'x', entry.nibbles.x),
      acceptedY: acceptedOffsetNibbles(entry.blockId, 'y', entry.nibbles.y),
      acceptedZ: acceptedOffsetNibbles(entry.blockId, 'z', entry.nibbles.z),
    }
  })
  return document.scanner.directions.map((direction: SearchDirection) => {
    const grouped = new Map<string, OffsetConstraint>()
    for (const original of constraints) {
      let c = { ...original }
      if (direction === 90) c = { ...c, dx: -original.dz, dz: original.dx, acceptedX: reverseNibbles(original.acceptedZ), acceptedZ: original.acceptedX }
      if (direction === 180) c = { ...c, dx: -original.dx, dz: -original.dz, acceptedX: reverseNibbles(original.acceptedX), acceptedZ: reverseNibbles(original.acceptedZ) }
      if (direction === 270) c = { ...c, dx: original.dz, dz: -original.dx, acceptedX: original.acceptedZ, acceptedZ: reverseNibbles(original.acceptedX) }
      const key = `${c.dx}:${c.dz}`
      const previous = grouped.get(key)
      if (previous) {
        c.acceptedX &= previous.acceptedX
        c.acceptedY &= previous.acceptedY
        c.acceptedZ &= previous.acceptedZ
      }
      if (!(c.acceptedX && c.acceptedY && c.acceptedZ)) {
        throw new Error(`Offset observations at (${c.dx}, ${c.dz}) contradict each other for ${direction}°.`)
      }
      grouped.set(key, c)
    }
    return [...grouped.values()]
  })
}

/** Smallest signed lattice covering the bounds; at most 26 bits at ±30 million. */
export function offsetTraversalBits(xStart: number, xEnd: number, zStart: number, zEnd: number): number {
  for (let bits = 1; bits <= 26; bits++) {
    const half = 2 ** (bits - 1)
    if (Math.min(xStart, zStart) >= -half && Math.max(xEnd, zEnd) < half) return bits
  }
  throw new Error('X/Z bounds must lie within ±30,000,000 blocks.')
}
