import type {
  EditorDocument,
  FaceDirection,
  FaceEvidence,
  Point3,
  SearchDirection,
  ValidationResult,
} from './types'
import { searchDirections } from './types'
import {
  isAxisMappingComplete,
  faceForLocalNormal,
  isWorldUpResolved,
  mappedAnchorOffset,
  sceneLatticeParity,
} from './geometry'
import {
  acceptedIndexCount,
  compileFilterDirections,
  informationBits,
} from './filterConstraints'

// Export rows are derived values: they are anchor-relative and mapped from the
// screenshot-local lattice into the user-confirmed world basis.
export type ExportEvidence = FaceEvidence & {
  coordinate: Point3
  face: FaceDirection
}

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
  const grouped = new Map<string, ExportEvidence[]>()
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
      const face = faceForLocalNormal(document.scene.axisMapping, entry.localNormal)
      if (!face) return
      const mapped = { ...entry, coordinate, face }
      const key = coordinateKey(mapped)
      grouped.set(key, [...(grouped.get(key) ?? []), mapped])
    })

  const rows = [...grouped.values()].flatMap((entries) => {
    const hasNetherrack = entries.some((entry) => entry.blockId === 'netherrack')
    if (!hasNetherrack) {
      // Perpendicular ordinary observations can refer to one block. Four-state
      // evidence carries more information and therefore wins that collision.
      return entries.reduce((strongest, entry) =>
        entry.stateCount > strongest.stateCount ? entry : strongest,
      )
    }

    // Netherrack's model choice correlates every visible face. Keep one row
    // per world face so the native and web scanners can intersect them.
    const uniqueFaces = new Map<string, ExportEvidence>()
    entries.forEach((entry) => {
      uniqueFaces.set(`${entry.blockId}:${entry.face}`, entry)
    })
    return [...uniqueFaces.values()]
  })
  const faceOrder: FaceDirection[] = ['up', 'down', 'north', 'south', 'east', 'west']
  return rows.sort((a, b) => {
    if (a.coordinate.y !== b.coordinate.y) return a.coordinate.y - b.coordinate.y
    if (a.coordinate.z !== b.coordinate.z) return a.coordinate.z - b.coordinate.z
    if (a.coordinate.x !== b.coordinate.x) return a.coordinate.x - b.coordinate.x
    return faceOrder.indexOf(a.face) - faceOrder.indexOf(b.face)
  })
}

export function validateForExport(document: EditorDocument): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const { bounds } = document.scanner
  const rows = confirmedUniqueEvidence(document)

  if (!document.scene.projection) {
    errors.push('Create perspective geometry before export.')
  }
  if (
    !document.anchorFaceId ||
    !document.scene.faces.some((face) => face.id === document.anchorFaceId)
  ) {
    errors.push('Select an anchor block before export.')
  }
  if (
    !isWorldUpResolved(document.scene.axisMapping) ||
    !isAxisMappingComplete(
      document.scene.axisMapping,
      sceneLatticeParity(document.scene),
    )
  ) {
    errors.push('Determine world orientation before export.')
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
  if (rows.length === 0) errors.push('No block faces are confirmed.')
  if (rows.length > 256) errors.push('CoordsFinder supports at most 256 filter rows.')
  if (
    bounds.xStart > bounds.xEnd ||
    bounds.yStart > bounds.yEnd ||
    bounds.zStart > bounds.zEnd
  ) {
    errors.push('Every search start bound must be less than or equal to its end bound.')
  }
  if (
    document.scanner.cpuTileSize.x <= 0 ||
    document.scanner.cpuTileSize.z <= 0 ||
    document.scanner.cudaTileSize.x <= 0 ||
    document.scanner.cudaTileSize.z <= 0
  ) {
    errors.push('CPU and CUDA tile dimensions must be positive.')
  }
  if (document.scanner.errorTolerance < 0) {
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

  const familiesByCoordinate = new Map<string, Set<string>>()
  rows.forEach((entry) => {
    const key = coordinateKey(entry)
    const families = familiesByCoordinate.get(key) ?? new Set<string>()
    families.add(entry.blockId === 'netherrack' ? 'netherrack' : 'ordinary')
    familiesByCoordinate.set(key, families)
  })
  familiesByCoordinate.forEach((families, key) => {
    if (families.size > 1) {
      errors.push(`Block offset ${key.replaceAll(':', ', ')} mixes ordinary and netherrack evidence.`)
    }
  })

  const validDirections = document.scanner.directions.filter((direction) =>
    searchDirections.includes(direction as SearchDirection),
  ) as SearchDirection[]
  if (validDirections.length > 0) {
    try {
      const compiled = compileFilterDirections(
        rows,
        document.scanner.textureAlgorithm,
        validDirections,
      )
      if (compiled.some((direction) => direction.constraints.length > 256)) {
        errors.push('CoordsFinder supports at most 256 compiled block constraints.')
      }
      if (compiled.some(
        (direction) =>
          direction.constraints.length === 0 &&
          direction.forcedErrors <= document.scanner.errorTolerance,
      )) {
        errors.push('The filter has no usable block constraints after combining observations.')
      }
      if (compiled.every(
        (direction) => direction.forcedErrors > document.scanner.errorTolerance,
      )) {
        errors.push('Combined face observations exceed the error tolerance in every search direction.')
      }
      const conflicts = compiled.filter((direction) => direction.forcedErrors > 0)
      if (conflicts.length > 0) {
        warnings.push(
          `Combined observations create forced block errors (${conflicts
            .map((direction) => `${direction.direction}°: ${direction.forcedErrors}`)
            .join(', ')}).`,
        )
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unable to compile face constraints.')
    }
  }

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
    `algorithm = ${scanner.textureAlgorithm}`,
    `scanOrder = ${scanner.scanOrder}`,
    `directions = [${scanner.directions.join(', ')}]`,
    '',
    `xRange = (${scanner.bounds.xStart}, ${scanner.bounds.xEnd})`,
    `yRange = (${scanner.bounds.yStart}, ${scanner.bounds.yEnd})`,
    `zRange = (${scanner.bounds.zStart}, ${scanner.bounds.zEnd})`,
    '',
    `errorTolerance = ${scanner.errorTolerance}`,
    '',
    `cpuTileSize = (${scanner.cpuTileSize.x}, ${scanner.cpuTileSize.z})`,
    `cudaTileSize = (${scanner.cudaTileSize.x}, ${scanner.cudaTileSize.z})`,
    `verbose = ${scanner.verbose ? 'true' : 'false'}`,
    '',
    '[filter]',
    '# x y z | variant [side|netherrack-<face>]',
    ...rows.map((entry) => {
      const { x, y, z } = entry.coordinate
      const marker = entry.blockId === 'netherrack'
        ? ` netherrack-${entry.face}`
        : entry.stateCount === 2
          ? ' side'
          : ''
      return `${x} ${y} ${z} | ${entry.selectedVariant}${marker}`
    }),
    '',
  ]
  return lines.join('\n')
}

export function constraintBits(document: EditorDocument): number {
  const direction = document.scanner.directions[0]
  if (direction === undefined) return 0
  const compiled = compileFilterDirections(
    confirmedUniqueEvidence(document),
    document.scanner.textureAlgorithm,
    [direction],
  )[0]
  return Math.round(informationBits(compiled) * 100) / 100
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
  const direction = document.scanner.directions[0]
  const constraints = direction === undefined
    ? []
    : compileFilterDirections(rows, document.scanner.textureAlgorithm, [direction])[0].constraints
  // This is an independence estimate for display, not a promise about actual
  // collisions in Minecraft's coordinate hash.
  constraints.forEach((entry) => {
    volume = volume * BigInt(acceptedIndexCount(entry.acceptedIndices)) / 16n
  })
  if (volume < 1n && rows.length > 0) return '<1'
  return new Intl.NumberFormat('en-US').format(volume)
}
