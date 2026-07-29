// Export tests pin the scanner text contract and every validation invariant at
// the boundary between reviewed editor evidence and CoordsFinder.
import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../store/editorStore'
import { blockCoordinateForFace } from './geometry'
import type { EditorDocument, FaceEvidence, MeshFace } from './types'
import type { Point3 } from './types'
import {
  confirmedUniqueEvidence,
  constraintBits,
  generateCoordsFinderConfig,
  validateForExport,
} from './exportConfig'

const evidence = (
  id: string,
  coordinate: Point3,
  stateCount: 2 | 4,
  selectedVariant: number,
): FaceEvidence => ({
  id,
  latticeCoordinate: coordinate,
  localNormal:
    stateCount === 2
      ? { x: 0, y: 0, z: -1 }
      : { x: 0, y: 1, z: 0 },
  blockId: 'stone',
  stateCount,
  selectedVariant,
  reviewStatus: 'confirmed',
  faceId: id,
})

const documentWith = (entries: FaceEvidence[]): EditorDocument => {
  const document = createInitialDocument()
  document.scene.faces.forEach((face) => {
    face.normal = { x: 0, y: 0, z: -1 }
  })
  return {
    ...document,
    anchorFaceId: document.scene.faces[0].id,
    evidence: entries,
    scene: {
      ...document.scene,
      axisMapping: { a: 'x+', b: 'y-', c: 'z+' },
    },
    scanner: {
      ...document.scanner,
      compassResolved: true,
    },
  }
}

describe('CoordsFinder export', () => {
  it('deduplicates coordinates and keeps the stronger four-state constraint', () => {
    const entries = [
      evidence('side', { x: 0, y: 0, z: 0 }, 2, 1),
      evidence('top', { x: 0, y: 0, z: 0 }, 4, 3),
      evidence('other', { x: -1, y: 0, z: 1 }, 2, 0),
    ]
    const document = documentWith(entries)

    expect(confirmedUniqueEvidence(document).map((entry) => entry.id)).toEqual([
      'top',
      'other',
    ])
    expect(constraintBits(document)).toBe(3)
  })

  it('deduplicates perpendicular faces that belong to the same block', () => {
    const blockCoordinate = { x: 4, y: 2, z: -3 }
    const sideFace: MeshFace = {
      id: 'side',
      blockCoordinate: { ...blockCoordinate, x: blockCoordinate.x + 1 },
      normal: { x: 1, y: 0, z: 0 },
    }
    const topFace: MeshFace = {
      id: 'top',
      blockCoordinate: { ...blockCoordinate, z: blockCoordinate.z + 1 },
      normal: { x: 0, y: 0, z: 1 },
    }
    const document = documentWith([
      evidence('side', blockCoordinateForFace(sideFace), 2, 1),
      evidence('top', blockCoordinateForFace(topFace), 4, 3),
    ])

    expect(confirmedUniqueEvidence(document).map((entry) => entry.id)).toEqual([
      'top',
    ])
  })

  it('emits the scanner syntax, including folded side evidence', () => {
    const document = documentWith([
      evidence('top', { x: -1, y: 0, z: 0 }, 4, 3),
      evidence('side', { x: 0, y: 0, z: 0 }, 2, 1),
    ])
    const config = generateCoordsFinderConfig(document)

    expect(config).toContain('mode = Vanilla-3')
    expect(config).toContain('directions = [0]')
    expect(config).toContain('[filter]\n# x y z | variant [side]')
    expect(config).not.toContain('# Anchor block:')
    expect(config).toContain('-1 0 0 | 3')
    expect(config).toContain('0 0 0 | 1 side')
    expect(validateForExport(document)).toMatchObject({
      errors: [],
      rowCount: 2,
    })
  })

  it('rebases evidence coordinates around the selected anchor block', () => {
    const document = documentWith([
      evidence('offset', { x: 3, y: 1, z: 0 }, 4, 2),
    ])
    document.anchorFaceId = document.scene.faces.find(
      (face) =>
        face.blockCoordinate.x === 2 &&
        face.blockCoordinate.y === 1 &&
        face.blockCoordinate.z === 0,
    )!.id

    expect(confirmedUniqueEvidence(document)[0].coordinate).toEqual({
      x: 1,
      y: 0,
      z: 0,
    })
    expect(generateCoordsFinderConfig(document)).toContain('1 0 0 | 2')
  })

  it('blocks export until an anchor block is selected', () => {
    const document = documentWith([
      evidence('top', { x: 0, y: 0, z: 0 }, 4, 0),
    ])
    document.anchorFaceId = null

    expect(validateForExport(document).errors).toContain(
      'Select an anchor block before export.',
    )
  })

  it('writes the user-selected texture algorithm to the scanner mode setting', () => {
    const document = documentWith([])
    document.scanner.textureAlgorithm = 'Sodium-2'

    expect(generateCoordsFinderConfig(document)).toContain('mode = Sodium-2')
  })

  it('writes every selected compass rotation to the scanner settings', () => {
    const document = documentWith([])
    document.scanner.directions = [0, 180]

    expect(generateCoordsFinderConfig(document)).toContain(
      'directions = [0, 180]',
    )
  })

  it('rejects offsets that overflow after a selected X/Z rotation', () => {
    const document = documentWith([
      evidence('edge', { x: 0, y: 0, z: -128 }, 4, 0),
    ])
    document.scanner.directions = [0, 90]

    expect(validateForExport(document).errors).toContain(
      'Direction 90° rotates offset (0, 0, -128) outside the signed-byte range.',
    )
  })

  it('blocks export while compass orientation is unresolved', () => {
    const document = documentWith([
      evidence('top', { x: 0, y: 0, z: 0 }, 4, 0),
    ])
    document.scanner.compassResolved = false

    expect(validateForExport(document).errors).toContain(
      'Choose a valid global axis reference before export.',
    )
  })
})
