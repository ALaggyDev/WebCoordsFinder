import { offsetProfiles, offsetReadiness } from './blockOffsets'
import { mappedAnchorOffset } from './geometry'
import type { EditorDocument, OffsetSearchBounds } from './types'

export interface OffsetConstraint {
  dx: number
  dz: number
  x: number
  y: number
  z: number
  xMask: number
  zMask: number
  full: boolean
}

export interface OffsetSearchRequest {
  bounds: OffsetSearchBounds
  constraints: OffsetConstraint[]
}

/** Every active model contributes an offset constraint. */
export function createOffsetSearchRequest(document: EditorDocument): OffsetSearchRequest {
  const blocked = offsetReadiness(document)
  if (blocked) throw new Error(blocked)
  const constraints = (document.offsets ?? [])
    .filter((entry) => !entry.ignored)
    .map((entry) => {
      const position = mappedAnchorOffset(
        document.scene,
        document.anchorFaceId,
        entry.position,
      )
      if (!position) throw new Error('Select an anchor block in Geometry first.')
      if (!Number.isInteger(position.x) || !Number.isInteger(position.z) ||
          Math.abs(position.x) > 2_147_483_647 || Math.abs(position.z) > 2_147_483_647) {
        throw new Error('An offset position is outside the 32-bit coordinate range.')
      }
      return {
        dx: position.x,
        dz: position.z,
        ...entry.nibbles,
        // Clipped endpoints make four seed nibbles visually identical.
        xMask: profileMask(offsetProfiles[entry.blockId].horizontal, entry.nibbles.x),
        zMask: profileMask(offsetProfiles[entry.blockId].horizontal, entry.nibbles.z),
        full: offsetProfiles[entry.blockId].type === 'XYZ',
      }
    })
  if (constraints.length === 0) throw new Error('Add at least one active block offset first.')
  if (constraints.length > 256) throw new Error('The WASM scanner accepts at most 256 offsets.')

  const bounds = document.scanner.offsetBounds
  for (const axis of ['x', 'z'] as const) {
    const start = bounds[`${axis}Start`]
    const end = bounds[`${axis}End`]
    if (!Number.isInteger(start) || !Number.isInteger(end) ||
        start < -134_217_728 || end > 134_217_727 || start > end) {
      throw new Error('Offset bounds must be ordered integers within the signed 28-bit range.')
    }
  }
  return { bounds, constraints }
}

function profileMask(horizontal: number, nibble: number): number {
  return horizontal === 0.125 && (nibble <= 3 || nibble >= 12) ? 0xc : 0xf
}

/** Split the 16-bit X prefix space among independent WASM workers. */
export function offsetWorkerRanges(count: number): { start: number; end: number }[] {
  return Array.from({ length: count }, (_, index) => ({
    start: Math.floor(index * 65536 / count),
    end: Math.floor((index + 1) * 65536 / count),
  }))
}
