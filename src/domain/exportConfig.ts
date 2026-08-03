import type {
  EditorDocument,
  FaceEvidence,
  Point3,
  SearchDirection,
  ValidationResult,
} from './types'
import { searchDirections } from './types'
import { isAxisMappingComplete, mappedAnchorOffset } from './geometry'

// Export rows are derived values: they are anchor-relative and mapped from the
// screenshot-local lattice into the user-confirmed world basis.
type ExportEvidence = FaceEvidence & { coordinate: Point3 }

function coordinateKey(evidence: ExportEvidence): string {
  const { x, y, z } = evidence.coordinate
  return `${x}:${y}:${z}`
}

function rotateXzOffset(
  x: number,
  z: number,
  direction: SearchDirection,
): { x: number; z: number } {
  switch (direction) {
    case 90:
      return { x: -z, z: x }
    case 180:
      return { x: -x, z: -z }
    case 270:
      return { x: z, z: -x }
    case 0:
      return { x, z }
  }
}

export function confirmedUniqueEvidence(document: EditorDocument): ExportEvidence[] {
  const unique = new Map<string, ExportEvidence>()
  document.evidence
    .filter(
      (entry) =>
        entry.reviewStatus === 'confirmed' &&
        entry.selectedVariant !== undefined,
    )
    .forEach((entry) => {
      const coordinate = mappedAnchorOffset(
        document.scene,
        document.anchorFaceId,
        entry.latticeCoordinate,
      )
      if (!coordinate) return
      const mapped = { ...entry, coordinate }
      const key = coordinateKey(mapped)
      const existing = unique.get(key)
      // Perpendicular observations can refer to one block. Four-state evidence
      // carries more information and therefore wins a coordinate collision.
      if (!existing || entry.stateCount > existing.stateCount) {
        unique.set(key, mapped)
      }
    })
  return [...unique.values()].sort((a, b) => {
    if (a.coordinate.y !== b.coordinate.y) return a.coordinate.y - b.coordinate.y
    if (a.coordinate.z !== b.coordinate.z) return a.coordinate.z - b.coordinate.z
    return a.coordinate.x - b.coordinate.x
  })
}

export function validateForExport(document: EditorDocument): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const { bounds } = document.scanner
  const rows = confirmedUniqueEvidence(document)

  if (document.scene.projection?.kind !== 'camera') {
    errors.push('Solve the full 3D perspective before export.')
  }
  if (
    !document.anchorFaceId ||
    !document.scene.faces.some((face) => face.id === document.anchorFaceId)
  ) {
    errors.push('Select an anchor block before export.')
  }
  if (
    !document.scanner.compassResolved ||
    !isAxisMappingComplete(document.scene.axisMapping)
  ) {
    errors.push('Set a valid world orientation before export.')
  }
  if (
    document.scanner.directions.length === 0 ||
    new Set(document.scanner.directions).size !==
      document.scanner.directions.length ||
    document.scanner.directions.some(
      (direction) =>
        !searchDirections.includes(direction as SearchDirection),
    )
  ) {
    errors.push('Select at least one unique quarter-turn search direction.')
  }
  if (rows.length === 0) errors.push('Confirm at least one block face before export.')
  if (rows.length > 256) errors.push('CoordsFinder supports at most 256 filter rows.')
  if (
    bounds.xStart > bounds.xEnd ||
    bounds.yStart > bounds.yEnd ||
    bounds.zStart > bounds.zEnd
  ) {
    errors.push('Every search start bound must be less than or equal to its end bound.')
  }
  if (document.scanner.chunkBlocksX <= 0 || document.scanner.chunkBlocksZ <= 0) {
    errors.push('Chunk dimensions must be positive.')
  }
  if (document.scanner.maxBadBlocks < 0) {
    errors.push('Error tolerance cannot be negative.')
  }

  rows.forEach((entry) => {
    const { x, y, z } = entry.coordinate
    if ([x, y, z].some((value) => value < -128 || value > 127)) {
      errors.push(`Offset (${x}, ${y}, ${z}) is outside the signed-byte range.`)
    }
    document.scanner.directions.forEach((direction) => {
      if (
        direction === 0 ||
        !searchDirections.includes(direction as SearchDirection)
      ) {
        return
      }
      const rotated = rotateXzOffset(x, z, direction as SearchDirection)
      // CoordsFinder stores filter offsets as signed bytes after applying each
      // requested compass rotation, so all rotated forms must fit.
      if (
        rotated.x < -128 ||
        rotated.x > 127 ||
        rotated.z < -128 ||
        rotated.z > 127
      ) {
        errors.push(
          `Direction ${direction}° rotates offset (${x}, ${y}, ${z}) outside the signed-byte range.`,
        )
      }
    })
    if (
      entry.selectedVariant === undefined ||
      entry.selectedVariant < 0 ||
      entry.selectedVariant >= entry.stateCount
    ) {
      errors.push(`Block at (${x}, ${y}, ${z}) has an invalid variant.`)
    }
  })

  const proposals = document.evidence.filter((entry) => entry.reviewStatus === 'proposed').length
  if (proposals > 0) {
    warnings.push(`${proposals} automatic proposal${proposals === 1 ? ' is' : 's are'} omitted until reviewed.`)
  }

  return { errors: [...new Set(errors)], warnings, rowCount: rows.length }
}

export function generateCoordsFinderConfig(document: EditorDocument): string {
  const { scanner } = document
  const rows = confirmedUniqueEvidence(document)
  const lines = [
    '# Generated locally by WebCoordsFinder.',
    '',
    `mode = ${scanner.textureAlgorithm}`,
    `directions = [${scanner.directions.join(', ')}]`,
    '',
    `xStart = ${scanner.bounds.xStart}`,
    `xEnd = ${scanner.bounds.xEnd}`,
    `yStart = ${scanner.bounds.yStart}`,
    `yEnd = ${scanner.bounds.yEnd}`,
    `zStart = ${scanner.bounds.zStart}`,
    `zEnd = ${scanner.bounds.zEnd}`,
    '',
    `chunkBlocksX = ${scanner.chunkBlocksX}`,
    `chunkBlocksZ = ${scanner.chunkBlocksZ}`,
    `maxBadBlocks = ${scanner.maxBadBlocks}`,
    `printChunks = ${scanner.printChunks ? 'true' : 'false'}`,
    '',
    '[filter]',
    '# x y z | variant [side]',
    ...rows.map((entry) => {
      const { x, y, z } = entry.coordinate
      return `${x} ${y} ${z} | ${entry.selectedVariant}${entry.stateCount === 2 ? ' side' : ''}`
    }),
    '',
  ]
  return lines.join('\n')
}

export function constraintBits(document: EditorDocument): number {
  return confirmedUniqueEvidence(document).reduce(
    (sum, evidence) => sum + (evidence.stateCount === 4 ? 2 : 1),
    0,
  )
}

export function approximateCandidateCount(document: EditorDocument): string {
  const { bounds } = document.scanner
  const sizes = [
    BigInt(Math.max(0, bounds.xEnd - bounds.xStart + 1)),
    BigInt(Math.max(0, bounds.yEnd - bounds.yStart + 1)),
    BigInt(Math.max(0, bounds.zEnd - bounds.zStart + 1)),
  ]
  let volume = sizes[0] * sizes[1] * sizes[2]
  const rows = confirmedUniqueEvidence(document)
  // This is an independence estimate for display, not a promise about actual
  // collisions in Minecraft's coordinate hash.
  rows.forEach((entry) => {
    volume /= BigInt(entry.stateCount)
  })
  if (volume < 1n && rows.length > 0) return '<1'
  return new Intl.NumberFormat('en-US').format(volume)
}
