import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../store/editorStore'
import type { EditorDocument, FaceEvidence } from './types'
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
  patchId: 'floor-demo',
  column: 0,
  row: 0,
  latticeCoordinate: coordinate,
  localNormal:
    stateCount === 2
      ? { x: 0, y: 0, z: -1 }
      : { x: 0, y: 1, z: 0 },
  blockId: 'stone',
  stateCount,
  selectedVariant,
  reviewStatus: 'confirmed',
})

const documentWith = (entries: FaceEvidence[]): EditorDocument => ({
  ...createInitialDocument(),
  evidence: entries,
  scene: {
    ...createInitialDocument().scene,
    axisMapping: { a: 'x+', b: 'y+', c: 'z+' },
  },
  scanner: {
    ...createInitialDocument().scanner,
    compassResolved: true,
  },
})

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

  it('emits the scanner syntax, including folded side evidence', () => {
    const document = documentWith([
      evidence('top', { x: -1, y: 0, z: 0 }, 4, 3),
      evidence('side', { x: 0, y: 0, z: 0 }, 2, 1),
    ])
    const config = generateCoordsFinderConfig(document)

    expect(config).toContain('mode = Vanilla-3')
    expect(config).toContain('[filter]\n# x y z | variant [side]')
    expect(config).toContain('-1 0 0 | 3')
    expect(config).toContain('0 0 0 | 1 side')
    expect(validateForExport(document)).toMatchObject({
      errors: [],
      rowCount: 2,
    })
  })

  it('writes the user-selected texture algorithm to the scanner mode setting', () => {
    const document = documentWith([])
    document.scanner.textureAlgorithm = 'Sodium-2'

    expect(generateCoordsFinderConfig(document)).toContain('mode = Sodium-2')
  })

  it('blocks export while compass orientation is unresolved', () => {
    const document = documentWith([
      evidence('top', { x: 0, y: 0, z: 0 }, 4, 0),
    ])
    document.scanner.compassResolved = false

    expect(validateForExport(document).errors).toContain(
      'Resolve the screenshot compass direction before export.',
    )
  })
})
