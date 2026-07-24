import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../store/editorStore'
import type { EditorDocument, FaceEvidence } from './types'
import {
  confirmedUniqueEvidence,
  constraintBits,
  deriveTextureMode,
  generateCoordsFinderConfig,
  validateForExport,
} from './exportConfig'

const evidence = (
  id: string,
  coordinate: FaceEvidence['coordinate'],
  stateCount: 2 | 4,
  selectedVariant: number,
): FaceEvidence => ({
  id,
  planeId: 'test-plane',
  column: 0,
  row: 0,
  coordinate,
  face: stateCount === 2 ? 'north' : 'up',
  blockId: 'stone',
  stateCount,
  selectedVariant,
  reviewStatus: 'confirmed',
})

const documentWith = (entries: FaceEvidence[]): EditorDocument => ({
  ...createInitialDocument(),
  evidence: entries,
  scanner: {
    ...createInitialDocument().scanner,
    compassResolved: true,
  },
})

describe('CoordsFinder export', () => {
  it('derives the documented renderer modes at version boundaries', () => {
    const document = documentWith([])

    document.scanner.minecraftVersion = '1.12.2'
    expect(deriveTextureMode(document)).toBe('Vanilla-1')
    document.scanner.minecraftVersion = '1.13'
    expect(deriveTextureMode(document)).toBe('Vanilla-2')
    document.scanner.minecraftVersion = '1.21.2'
    expect(deriveTextureMode(document)).toBe('Vanilla-3')

    document.scanner.renderer = 'sodium'
    document.scanner.sodiumVersion = '4.1'
    expect(deriveTextureMode(document)).toBe('Sodium-1')
    document.scanner.sodiumVersion = '4.8'
    expect(deriveTextureMode(document)).toBe('Sodium-2')
    document.scanner.sodiumVersion = '4.9'
    expect(deriveTextureMode(document)).toBe('Vanilla-3')
  })

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

