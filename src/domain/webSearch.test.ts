// These tests protect the TypeScript/WASM ABI and exact scanner parity,
// including resumable uint64 counters and native CoordsFinder reference cases.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createTestDocument } from '../test/createTestDocument'
import { blockCoordinateForFace } from './geometry'
import type { EditorDocument, FaceEvidence } from './types'
import {
  createWebSearchCheckpoint,
  createWebSearchRequest,
  formatSearchCount,
  restoreWebSearchCheckpoint,
  searchProgressPercent,
  webSearchRequestKey,
  webSearchRequestVolume,
} from './webSearch'

function searchableDocument(): EditorDocument {
  const document = createTestDocument()
  const anchor = document.scene.faces[0]
  const evidence: FaceEvidence = {
    id: 'side',
    faceId: anchor.id,
    latticeCoordinate: blockCoordinateForFace(anchor),
    localNormal: anchor.normal,
    blockId: 'stone',
    stateCount: 2,
    selectedVariant: 1,
    reviewStatus: 'confirmed',
  }
  document.anchorFaceId = anchor.id
  document.scene.axisMapping = { a: 'x+', b: 'y-', c: 'z-' }
  document.scanner.compassResolved = true
  document.scanner.textureAlgorithm = 'Sodium-2'
  document.evidence = [evidence]
  return document
}

interface TestSearchExports extends WebAssembly.Exports {
  search_configure: (...values: number[]) => number
  search_set_direction: (index: number, quarterTurns: number) => number
  search_set_filter: (...values: number[]) => number
  search_restore: (processed: bigint, matchCount: bigint) => number
  search_scan_batch: (maxPositions: number, captureLimit: number) => number
  search_is_finished: () => number
  search_get_processed: () => bigint
  search_get_total: () => bigint
  search_get_match_count: () => bigint
  search_get_result_count: () => number
  search_get_result_x: (index: number) => number
  search_get_result_y: (index: number) => number
  search_get_result_z: (index: number) => number
  search_get_result_direction: (index: number) => number
}

describe('web search configuration', () => {
  it('maps confirmed evidence and texture modes to the WASM scanner format', () => {
    const request = createWebSearchRequest(searchableDocument())

    expect(request.mode).toBe(4)
    expect(request.scanOrder).toBe(1)
    expect(request.directions).toEqual([0])
    expect(request.constraints).toEqual([
      {
        x: 0,
        y: 0,
        z: 0,
        rotation: 1,
        visibleMask: 1,
      },
    ])
  })

  it('counts every selected direction as a separate search pass', () => {
    const document = searchableDocument()
    document.scanner.bounds = {
      xStart: 0,
      xEnd: 2,
      yStart: 0,
      yEnd: 1,
      zStart: 0,
      zEnd: 4,
    }
    document.scanner.directions = [0, 90, 180]
    const request = createWebSearchRequest(document)

    expect(request.directions).toEqual([0, 90, 180])
    expect(webSearchRequestVolume(request)).toBe(90n)
  })

  it('rejects bounds that cannot be represented by the WASM scanner', () => {
    const document = searchableDocument()
    document.scanner.bounds.xStart = 0.5

    expect(() => createWebSearchRequest(document)).toThrow(
      'X start must be a 32-bit integer',
    )
  })

  it('formats exact bigint counts and progress without precision loss', () => {
    expect(formatSearchCount(9_007_199_254_740_993n)).toBe(
      '9,007,199,254,740,993',
    )
    expect(searchProgressPercent(1n, 3n)).toBe(33.33)
    expect(searchProgressPercent(3n, 3n)).toBe(100)
  })

  it('round-trips lossless counters, results, and interrupted state through a project checkpoint', () => {
    const request = createWebSearchRequest(searchableDocument())
    const state = {
      phase: 'running' as const,
      processed: 9_007_199_254_740_993n,
      total: 9_007_199_254_741_999n,
      matchCount: 123_456_789_012_345n,
      checksPerSecond: 4_200_000,
      results: [{ x: 12, y: -4, z: 99, badBlocks: 1, direction: 90 as const }],
    }
    const checkpoint = createWebSearchCheckpoint(
      webSearchRequestKey(request),
      state,
      1234,
    )

    expect(checkpoint).toMatchObject({
      phase: 'running',
      processed: '9007199254740993',
      matchCount: '123456789012345',
      updatedAt: 1234,
    })
    expect(restoreWebSearchCheckpoint(checkpoint)).toEqual({
      ...state,
      phase: 'paused',
    })
  })
})

describe('checked-in web search WASM', () => {
  it('scans in resumable batches and keeps an exact match count after result capture fills', async () => {
    const binary = await readFile('src/wasm/coords_search.wasm')
    const { instance } = await WebAssembly.instantiate(binary)
    const module = instance.exports as TestSearchExports

    expect(module.search_configure(2, 0, 0, 9, 0, 0, 0, 0, 1, 1, 1)).toBe(0)
    expect(module.search_set_direction(0, 0)).toBe(0)
    expect(module.search_set_filter(0, 0, 0, 0, 0, 3)).toBe(0)

    expect(module.search_scan_batch(3, 2)).toBe(3)
    expect(module.search_get_processed()).toBe(3n)
    expect(module.search_get_match_count()).toBe(3n)
    expect(module.search_get_result_count()).toBe(2)
    expect(module.search_is_finished()).toBe(0)

    expect(module.search_configure(2, 0, 0, 9, 0, 0, 0, 0, 1, 1, 1)).toBe(0)
    expect(module.search_set_direction(0, 0)).toBe(0)
    expect(module.search_set_filter(0, 0, 0, 0, 0, 3)).toBe(0)
    expect(module.search_restore(3n, 3n)).toBe(0)
    expect(module.search_scan_batch(7, 0)).toBe(7)
    expect(module.search_get_processed()).toBe(10n)
    expect(module.search_get_match_count()).toBe(10n)
    expect(module.search_get_result_count()).toBe(0)
    expect(module.search_is_finished()).toBe(1)
  })

  it('scans and resumes with direction as the innermost linear dimension', async () => {
    const binary = await readFile('src/wasm/coords_search.wasm')
    const { instance } = await WebAssembly.instantiate(binary)
    const module = instance.exports as TestSearchExports

    expect(module.search_configure(2, 0, 0, 2, 0, 0, 0, 0, 1, 1, 2)).toBe(0)
    expect(module.search_set_direction(0, 0)).toBe(0)
    expect(module.search_set_direction(1, 1)).toBe(0)
    expect(module.search_set_filter(0, 0, 0, 0, 0, 3)).toBe(0)
    expect(module.search_get_total()).toBe(6n)
    expect(module.search_scan_batch(4, 4)).toBe(4)
    expect(
      Array.from(
        { length: module.search_get_result_count() },
        (_, index) => module.search_get_result_direction(index),
      ),
    ).toEqual([0, 90, 0, 90])

    expect(module.search_configure(2, 0, 0, 2, 0, 0, 0, 0, 1, 1, 2)).toBe(0)
    expect(module.search_set_direction(0, 0)).toBe(0)
    expect(module.search_set_direction(1, 1)).toBe(0)
    expect(module.search_set_filter(0, 0, 0, 0, 0, 3)).toBe(0)
    expect(module.search_restore(4n, 4n)).toBe(0)
    expect(module.search_scan_batch(2, 2)).toBe(2)
    expect(module.search_get_processed()).toBe(6n)
    expect(module.search_get_match_count()).toBe(6n)
    expect(
      Array.from(
        { length: module.search_get_result_count() },
        (_, index) => module.search_get_result_direction(index),
      ),
    ).toEqual([0, 90])
  })

  it('uses CoordsFinder X, Z, Y linear order', async () => {
    const binary = await readFile('src/wasm/coords_search.wasm')
    const { instance } = await WebAssembly.instantiate(binary)
    const module = instance.exports as TestSearchExports

    expect(module.search_configure(2, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1)).toBe(0)
    expect(module.search_set_direction(0, 0)).toBe(0)
    expect(module.search_set_filter(0, 0, 0, 0, 0, 3)).toBe(0)
    expect(module.search_scan_batch(8, 8)).toBe(8)

    expect(
      Array.from({ length: module.search_get_result_count() }, (_, index) => [
        module.search_get_result_x(index),
        module.search_get_result_y(index),
        module.search_get_result_z(index),
      ]),
    ).toEqual([
      [0, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1],
      [1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 1],
    ])
  })

  it('spirals outward from the X/Z center and resumes exactly', async () => {
    const binary = await readFile('src/wasm/coords_search.wasm')
    const { instance } = await WebAssembly.instantiate(binary)
    const module = instance.exports as TestSearchExports

    expect(module.search_configure(2, 1, -1, 1, 0, 0, -1, 1, 1, 1, 2)).toBe(0)
    expect(module.search_set_direction(0, 0)).toBe(0)
    expect(module.search_set_direction(1, 1)).toBe(0)
    expect(module.search_set_filter(0, 0, 0, 0, 0, 3)).toBe(0)
    expect(module.search_scan_batch(5, 5)).toBe(5)
    expect(
      Array.from({ length: module.search_get_result_count() }, (_, index) => [
        module.search_get_result_x(index),
        module.search_get_result_z(index),
        module.search_get_result_direction(index),
      ]),
    ).toEqual([
      [0, 0, 0], [0, 0, 90], [1, 0, 0], [1, 0, 90], [1, 1, 0],
    ])

    expect(module.search_configure(2, 1, -1, 1, 0, 0, -1, 1, 1, 1, 2)).toBe(0)
    expect(module.search_set_direction(0, 0)).toBe(0)
    expect(module.search_set_direction(1, 1)).toBe(0)
    expect(module.search_set_filter(0, 0, 0, 0, 0, 3)).toBe(0)
    expect(module.search_restore(5n, 5n)).toBe(0)
    expect(module.search_scan_batch(13, 13)).toBe(13)
    expect(module.search_get_processed()).toBe(18n)
    expect(module.search_is_finished()).toBe(1)
    const visited = new Set(
      Array.from({ length: module.search_get_result_count() }, (_, index) =>
        [
          module.search_get_result_x(index),
          module.search_get_result_z(index),
          module.search_get_result_direction(index),
        ].join(','),
      ),
    )
    expect(visited.size).toBe(13)
  })

  it('spiral traversal covers clipped rectangular bounds without repeats', async () => {
    const binary = await readFile('src/wasm/coords_search.wasm')
    const { instance } = await WebAssembly.instantiate(binary)
    const module = instance.exports as TestSearchExports

    for (const [xStart, xEnd, zStart, zEnd] of [
      [-3, 3, 5, 5],
      [7, 7, -4, 4],
      [-2, 4, -1, 2],
      [3, 4, 8, 10],
    ]) {
      expect(module.search_configure(2, 1, xStart, xEnd, 0, 0, zStart, zEnd, 1, 1, 1)).toBe(0)
      expect(module.search_set_direction(0, 0)).toBe(0)
      expect(module.search_set_filter(0, 0, 0, 0, 0, 3)).toBe(0)
      const total = (xEnd - xStart + 1) * (zEnd - zStart + 1)
      expect(module.search_scan_batch(total, total)).toBe(total)
      expect(module.search_get_result_count()).toBe(total)
      const visited = new Set(
        Array.from({ length: total }, (_, index) =>
          [module.search_get_result_x(index), module.search_get_result_z(index)].join(','),
        ),
      )
      expect(visited.size).toBe(total)
      expect(module.search_get_result_x(0)).toBe(xStart + Math.floor((xEnd - xStart) / 2))
      expect(module.search_get_result_z(0)).toBe(zStart + Math.floor((zEnd - zStart) / 2))
    }
  })

  it('rotates X/Z offsets, shifts four-state variants, and preserves side variants', async () => {
    const binary = await readFile('src/wasm/coords_search.wasm')
    const { instance } = await WebAssembly.instantiate(binary)
    const module = instance.exports as TestSearchExports

    const scan = (
      quarterTurns: number,
      x: number,
      z: number,
      rotation: number,
      visibleMask: 1 | 3,
    ) => {
      expect(
        module.search_configure(2, 0, -4, 4, 0, 0, -4, 4, 0, 1, 1),
      ).toBe(0)
      expect(module.search_set_direction(0, quarterTurns)).toBe(0)
      expect(
        module.search_set_filter(0, x, 0, z, rotation, visibleMask),
      ).toBe(0)
      expect(module.search_scan_batch(81, 81)).toBe(81)
      return Array.from(
        { length: module.search_get_result_count() },
        (_, index) =>
          [
            module.search_get_result_x(index),
            module.search_get_result_y(index),
            module.search_get_result_z(index),
          ].join(','),
      )
    }

    const transformed = [
      { quarterTurns: 1, x: 2, z: 1 },
      { quarterTurns: 2, x: -1, z: 2 },
      { quarterTurns: 3, x: -2, z: -1 },
    ]
    transformed.forEach(({ quarterTurns, x, z }) => {
      expect(scan(quarterTurns, 1, -2, 0, 3)).toEqual(
        scan(0, x, z, quarterTurns, 3),
      )
      expect(scan(quarterTurns, 1, -2, 1, 1)).toEqual(
        scan(0, x, z, 1, 1),
      )
    })

    expect(
      module.search_configure(2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1),
    ).toBe(0)
    expect(module.search_set_direction(0, 1)).toBe(0)
    expect(module.search_set_filter(0, 0, 0, -128, 0, 3)).toBe(2)
  })

  it('matches native CoordsFinder reference vectors for every texture mode', async () => {
    const binary = await readFile('src/wasm/coords_search.wasm')
    const { instance } = await WebAssembly.instantiate(binary)
    const module = instance.exports as TestSearchExports
    const expected = [
      ['-2,1,-1', '0,1,0', '1,0,1', '2,1,0', '2,0,1', '2,1,1'],
      ['1,1,-1', '2,0,0', '2,0,1'],
      [
        '-2,1,-1',
        '-2,1,0',
        '-1,0,-1',
        '-1,1,0',
        '-1,0,1',
        '-1,1,1',
        '0,1,1',
        '2,1,-1',
        '2,0,1',
        '2,1,1',
      ],
      [
        '-2,1,0',
        '-1,0,-1',
        '-1,1,-1',
        '0,0,-1',
        '0,1,1',
        '2,1,0',
        '2,0,1',
      ],
      ['-1,0,-1', '-1,0,1', '-1,1,1', '0,0,0', '0,1,0', '1,0,1'],
    ]

    expected.forEach((expectedMatches, mode) => {
      expect(module.search_configure(mode, 0, -2, 2, 0, 1, -1, 1, 0, 1, 1)).toBe(
        0,
      )
      expect(module.search_set_direction(0, 0)).toBe(0)
      expect(module.search_set_filter(0, 1, 0, -1, 2, 3)).toBe(0)
      expect(module.search_scan_batch(30, 30)).toBe(30)
      const matches = Array.from(
        { length: module.search_get_result_count() },
        (_, index) =>
          [
            module.search_get_result_x(index),
            module.search_get_result_y(index),
            module.search_get_result_z(index),
          ].join(','),
      )
      expect(matches).toEqual(expectedMatches)
    })
  })
})
