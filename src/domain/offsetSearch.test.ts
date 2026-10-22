import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { acceptedOffsetNibbles, compileOffsetDirections, offsetTraversalBits, type OffsetConstraint } from './offsetSearch'
import { mappedAnchorOffset, sceneLatticeParity, validAxisMappingCompletions } from './geometry'
import { createTestDocument } from '../test/createTestDocument'
import { createWebSearchRequest, webSearchRequestVolume } from './webSearch'
import { generateCoordsFinderConfig } from './exportConfig'
import { normalizeEditorDocument } from '../store/editorStore'

interface Solver extends WebAssembly.Exports {
  search_configure: (...args: number[]) => number
  search_set_direction: (...args: number[]) => number
  search_set_filter: (...args: number[]) => number
  search_configure_offsets: (bits: number) => number
  search_set_offset: (...args: number[]) => number
  search_restore: (next: bigint, matches: bigint) => number
  search_set_range_end: (end: bigint) => number
  search_restore_offset_matches: (count: bigint) => void
  search_scan_batch: (budget: number, capture: number) => number
  search_get_processed: () => bigint
  search_get_total: () => bigint
  search_get_match_count: () => bigint
  search_get_offset_matches: () => bigint
  search_get_result_count: () => number
  search_get_result_x: (i: number) => number
  search_get_result_y: (i: number) => number
  search_get_result_z: (i: number) => number
  search_get_result_ordinal: (i: number) => bigint
  search_get_result_bad_blocks: (i: number) => number
  search_get_result_direction: (i: number) => number
  search_is_finished: () => number
}

async function solver() {
  return (await WebAssembly.instantiate(readFileSync('src/wasm/coords_search.wasm'))).instance.exports as Solver
}

/** Independent BigInt calculation, including Java's wrapped X multiplication. */
function nibbles(x: number, z: number) {
  const input = BigInt.asIntN(32, BigInt(x) * 3129871n) ^ (BigInt(z) * 116129781n)
  const seed = input * input * 42317861n + input * 11n
  return { x: Number((seed >> 16n) & 15n), y: Number((seed >> 20n) & 15n), z: Number((seed >> 24n) & 15n) }
}
function accepts(c: OffsetConstraint, x: number, z: number) {
  const n = nibbles(x + c.dx, z + c.dz)
  return Boolean((c.acceptedX & (1 << n.x)) && (c.acceptedY & (1 << n.y)) && (c.acceptedZ & (1 << n.z)))
}
function documentWithOffsets() {
  const document = createTestDocument()
  document.scene.axisMapping = validAxisMappingCompletions({ a: 'unknown', b: 'unknown', c: 'unknown' }, sceneLatticeParity(document.scene))[0]
  document.scanner.compassResolved = true
  document.scanner.textureEnabled = false
  document.scanner.offsetsEnabled = true
  document.anchorFaceId = document.scene.faces[0].id
  document.offsets = [{ id: 'roots', blockId: 'hanging_roots', modelIndex: 0,
    position: { x: 1, y: 2, z: 3 }, nibbles: { x: 4, y: 0, z: 12 }, tint: '#91bd59', confirmedBasis: 'stale' }]
  return document
}
function configure(m: Solver, constraints: OffsetConstraint[], bounds = [-9, 10, -7, 8], yEnd = 2, mode = 2, texture = true, tolerance = 0) {
  const [xs, xe, zs, ze] = bounds
  expect(m.search_configure(mode, 0, xs, xe, 0, yEnd, zs, ze, tolerance, texture ? 1 : 0, 1)).toBe(0)
  expect(m.search_set_direction(0, 0, texture ? 1 : 0, 0)).toBe(0)
  if (texture) expect(m.search_set_filter(0, 0, 1, 1, -1, 0x1111)).toBe(0)
  expect(m.search_configure_offsets(offsetTraversalBits(xs, xe, zs, ze))).toBe(0)
  constraints.forEach((c, i) => expect(m.search_set_offset(0, i, c.dx, c.dz, c.acceptedX, c.acceptedY, c.acceptedZ)).toBe(0))
}
function scan(m: Solver, capture = 1000) {
  const rows: { x: number; y: number; z: number; ordinal: bigint; bad: number }[] = []
  let batches = 0
  while (!m.search_is_finished()) {
    expect(m.search_scan_batch(31, Math.max(0, capture - rows.length))).toBeLessThanOrEqual(31)
    for (let i = 0; i < m.search_get_result_count(); i++) rows.push({ x: m.search_get_result_x(i), y: m.search_get_result_y(i), z: m.search_get_result_z(i), ordinal: m.search_get_result_ordinal(i), bad: m.search_get_result_bad_blocks(i) })
    if (++batches > 100000) throw new Error('Traversal failed to terminate')
  }
  return rows
}

describe('unified offset constraints', () => {
  it('uses active models regardless of confirmation, and excludes ignored models', () => {
    const document = documentWithOffsets()
    const position = mappedAnchorOffset(document.scene, document.anchorFaceId, document.offsets![0].position)!
    expect(compileOffsetDirections(document)[0]).toEqual([{ dx: position.x, dz: position.z, acceptedX: 1 << 4, acceptedY: 65535, acceptedZ: 1 << 12 }])
    document.offsets![0].ignored = true
    expect(() => createWebSearchRequest(document)).toThrow(/active block offset/)
  })
  it('keeps every clipped endpoint seed, with distinct interior displacements', () => {
    for (const axis of ['x', 'z'] as const) {
      for (let n = 0; n < 4; n++) expect(acceptedOffsetNibbles('pointed_dripstone', axis, n)).toBe(0x000f)
      for (let n = 12; n < 16; n++) expect(acceptedOffsetNibbles('pointed_dripstone', axis, n)).toBe(0xf000)
      for (let n = 4; n < 12; n++) expect(acceptedOffsetNibbles('pointed_dripstone', axis, n)).toBe(1 << n)
    }
  })
  it('searches and exports guessed compass rotations with positions and displacements rotated together', () => {
    const document = documentWithOffsets()
    document.scanner.compassResolved = false
    document.scanner.directions = [0, 90, 180, 270]
    document.offsets![0].blockId = 'pointed_dripstone'
    document.offsets![0].nibbles = { x: 3, y: 0, z: 8 }
    const [a, b, c, d] = compileOffsetDirections(document).map((rows) => rows[0])
    expect(b).toEqual({ dx: -a.dz, dz: a.dx, acceptedX: 1 << 7, acceptedY: 65535, acceptedZ: 15 })
    expect(c).toEqual({ dx: -a.dx, dz: -a.dz, acceptedX: 0xf000, acceptedY: 65535, acceptedZ: 1 << 7 })
    expect(d).toEqual({ dx: a.dz, dz: -a.dx, acceptedX: 1 << 8, acceptedY: 65535, acceptedZ: 0xf000 })
    const request = createWebSearchRequest(document)
    expect(request.directions).toEqual([0, 90, 180, 270])
    expect(request.offsetConstraintsByDirection).toEqual([[a], [b], [c], [d]])
    expect(generateCoordsFinderConfig(document)).toContain('directions = [0, 90, 180, 270]')
    expect(generateCoordsFinderConfig(document)).toContain('[offsets]')
  })
  it('rejects contradictory active observations, but allows equivalent clipped values', () => {
    const document = documentWithOffsets()
    document.offsets!.push({ ...document.offsets![0], id: 'duplicate', nibbles: { x: 5, y: 0, z: 12 } })
    expect(() => createWebSearchRequest(document)).toThrow(/contradict/)
    document.offsets![0].blockId = document.offsets![1].blockId = 'pointed_dripstone'
    document.offsets![0].nibbles.x = 0
    document.offsets![1].nibbles.x = 3
    expect(compileOffsetDirections(document)[0]).toHaveLength(1)
  })
  it('treats offset-only Y as unconstrained and enforces the world border', () => {
    const document = documentWithOffsets()
    document.scanner.bounds = { xStart: -30_000_000, xEnd: 30_000_000, zStart: -30_000_000, zEnd: 30_000_000, yStart: -64, yEnd: 120 }
    const request = createWebSearchRequest(document)
    expect(request).toMatchObject({ yStart: 0, yEnd: 0, yUnconstrained: true, offsetBits: 26 })
    expect(webSearchRequestVolume(request)).toBe(1n << 52n)
    document.scanner.bounds.xEnd++
    expect(() => createWebSearchRequest(document)).toThrow(/30,000,000/)
    document.scanner.offsetsEnabled = false
    expect(() => createWebSearchRequest(document)).toThrow(/Enable/)
  })
  it('migrates legacy offset bounds and exports native offset evidence', () => {
    const document = documentWithOffsets()
    const legacy = structuredClone(document) as unknown as { scanner: Record<string, unknown> }
    delete legacy.scanner.textureEnabled
    delete legacy.scanner.offsetsEnabled
    legacy.scanner.crackMode = 'block-offsets'
    legacy.scanner.offsetBounds = { xStart: -12, xEnd: 15, zStart: -6, zEnd: 7 }
    const migrated = normalizeEditorDocument(legacy)
    expect(migrated.scanner).toMatchObject({ textureEnabled: false, offsetsEnabled: true, bounds: { xStart: -12, xEnd: 15, zStart: -6, zEnd: 7 } })
    expect(generateCoordsFinderConfig(migrated)).toContain('[offsets]')
    expect(generateCoordsFinderConfig(migrated)).not.toContain('[filter]')
  })
})

describe('unified WASM traversal', () => {
  it('keeps intermediate matches when no Y value passes textures', async () => {
    const n = nibbles(5, -3)
    const m = await solver()
    configure(m, [{ dx: 0, dz: 0, acceptedX: 1 << n.x, acceptedY: 1 << n.y, acceptedZ: 1 << n.z }], [5, 5, -3, -3], 2)
    // Each direction carries an impossible texture intersection.
    expect(m.search_set_direction(0, 0, 1, 1)).toBe(0)
    expect(scan(m)).toEqual([])
    expect(m.search_get_offset_matches()).toBe(1n)
    expect(m.search_get_match_count()).toBe(0n)
  })
  it('uses distinct offset sets for all compass rotations', async () => {
    const m = await solver()
    expect(m.search_configure(2, 0, -4, 4, 0, 0, -3, 3, 0, 0, 4)).toBe(0)
    const constraints = [
      { dx: 1, dz: -2, acceptedX: 15, acceptedY: 65535, acceptedZ: 0xf000 },
      { dx: 2, dz: 1, acceptedX: 15, acceptedY: 65535, acceptedZ: 15 },
      { dx: -1, dz: 2, acceptedX: 0xf000, acceptedY: 65535, acceptedZ: 15 },
      { dx: -2, dz: -1, acceptedX: 0xf000, acceptedY: 65535, acceptedZ: 0xf000 },
    ]
    expect(m.search_configure_offsets(4)).toBe(0)
    constraints.forEach((c, direction) => {
      expect(m.search_set_direction(direction, direction, 0, 0)).toBe(0)
      expect(m.search_set_offset(direction, 0, c.dx, c.dz, c.acceptedX, c.acceptedY, c.acceptedZ)).toBe(0)
    })
    const actual: string[] = []
    while (!m.search_is_finished()) {
      m.search_scan_batch(31, 1000)
      for (let i = 0; i < m.search_get_result_count(); i++) {
        actual.push(`${m.search_get_result_x(i)},${m.search_get_result_z(i)},${m.search_get_result_direction(i)}`)
      }
    }
    const expected: string[] = []
    constraints.forEach((c, direction) => {
      for (let x = -4; x <= 4; x++) for (let z = -3; z <= 3; z++) {
        if (accepts(c, x, z)) expected.push(`${x},${z},${direction * 90}`)
      }
    })
    expect(actual.sort()).toEqual(expected.sort())
    expect(m.search_get_offset_matches()).toBe(BigInt(expected.length))
  })
  it.each([0, 1, 2, 3, 4])('mixed results intersect exact offset matches with texture matches, mode %i', async (mode) => {
    const c = { dx: 2, dz: -1, acceptedX: 0x000f, acceptedY: 0xffff, acceptedZ: 0xf000 }
    const reference = await solver()
    reference.search_configure(mode, 0, -9, 10, 0, 2, -7, 8, 0, 1, 1)
    reference.search_set_direction(0, 0, 1, 0)
    reference.search_set_filter(0, 0, 1, 1, -1, 0x1111)
    const expected = scan(reference).filter((r) => accepts(c, r.x, r.z)).map((r) => `${r.x},${r.y},${r.z}`).sort()
    const m = await solver()
    configure(m, [c], undefined, 2, mode)
    expect(scan(m).map((r) => `${r.x},${r.y},${r.z}`).sort()).toEqual(expected)
    let intermediate = 0
    for (let x = -9; x <= 10; x++) for (let z = -7; z <= 8; z++) if (accepts(c, x, z)) intermediate++
    expect(m.search_get_offset_matches()).toBe(BigInt(intermediate))
  })
  it('texture tolerance never relaxes offset constraints', async () => {
    const c = { dx: 0, dz: 0, acceptedX: 15, acceptedY: 65535, acceptedZ: 0xf000 }
    const m = await solver(); configure(m, [c], undefined, 2, 2, true, 1)
    const rows = scan(m)
    expect(rows.length).toBe(Number(m.search_get_offset_matches()) * 3)
    expect(rows.every((r) => accepts(c, r.x, r.z))).toBe(true)
    expect(rows.some((r) => r.bad === 1)).toBe(true)
  })
  it.each([[12541022, 10457150], [-1392121, -10529167], [-30000000, 30000000], [30000000, -30000000]])('recovers exact XYZ seed evidence at (%i, %i)', async (x, z) => {
    const n = nibbles(x + 2, z - 1)
    const m = await solver()
    configure(m, [{ dx: 2, dz: -1, acceptedX: 1 << n.x, acceptedY: 1 << n.y, acceptedZ: 1 << n.z }], [x, x, z, z], 0, 2, false)
    expect(scan(m)).toMatchObject([{ x, y: 0, z }])
    expect(m.search_get_offset_matches()).toBe(1n)
  })
  it('checks the final high seed bits, rather than accepting partial nibble matches', async () => {
    const x = 30_000_000, z = -30_000_000, n = nibbles(x, z)
    const m = await solver()
    configure(m, [{ dx: 0, dz: 0, acceptedX: 1 << n.x, acceptedY: 65535, acceptedZ: 1 << (n.z ^ 8) }], [x, x, z, z], 0, 2, false)
    expect(scan(m)).toEqual([])
  })
  it.each([[100003, -99997], [-100003, 99997]])('prunes lifted branches without losing ambiguous nibble matches near (%i, %i)', async (x, z) => {
    // These windows reach the partial-bit pruning levels. Small origin windows
    // exercise only the final exact check, so cannot protect lifting lookahead.
    const constraints = [[0, 0], [1, -2], [-3, 4]].map(([dx, dz]) => {
      const n = nibbles(x + dx, z + dz)
      return { dx, dz, acceptedX: (1 << n.x) | (1 << (n.x ^ (dx === -3 ? 3 : 2))),
        acceptedY: 65535, acceptedZ: (1 << n.z) | (1 << (n.z ^ 5)) }
    })
    const expected: string[] = []
    for (let cx = x - 16; cx <= x + 16; cx++) for (let cz = z - 16; cz <= z + 16; cz++) {
      if (constraints.every((c) => accepts(c, cx, cz))) expected.push(`${cx},${cz}`)
    }
    const m = await solver()
    configure(m, constraints, [x - 16, x + 16, z - 16, z + 16], 0, 2, false)
    const rows = scan(m)
    expect(rows.map((r) => `${r.x},${r.z}`).sort()).toEqual(expected.sort())
    expect(rows.some((r) => r.x === x && r.z === z)).toBe(true)
    expect(m.search_get_offset_matches()).toBe(BigInt(expected.length))
  })
  it('restores lifted prefixes across shard boundaries and partially scanned Y loops', async () => {
    const x = 100003, z = -99997, n = nibbles(x, z)
    const c = { dx: 0, dz: 0, acceptedX: 1 << n.x, acceptedY: 65535, acceptedZ: 1 << n.z }
    const bounds = [x - 2, x + 2, z - 2, z + 2]
    const whole = await solver(); configure(whole, [c], bounds, 4, 2, false)
    const expected = scan(whole)
    const cut = expected.find((r) => r.x === x && r.z === z && r.y === 2)!.ordinal
    let matches = 0n, intermediate = 0n
    const actual: ReturnType<typeof scan> = []
    for (const [start, end] of [[0n, cut], [cut, whole.search_get_total()]]) {
      const m = await solver(); configure(m, [c], bounds, 4, 2, false)
      m.search_restore(start, 0n); m.search_set_range_end(end)
      m.search_scan_batch(17, 1000)
      for (let i = 0; i < m.search_get_result_count(); i++) actual.push({
        x: m.search_get_result_x(i), y: m.search_get_result_y(i), z: m.search_get_result_z(i),
        ordinal: m.search_get_result_ordinal(i), bad: m.search_get_result_bad_blocks(i),
      })
      const resumed = await solver(); configure(resumed, [c], bounds, 4, 2, false)
      resumed.search_restore(m.search_get_processed(), m.search_get_match_count())
      resumed.search_set_range_end(end); resumed.search_restore_offset_matches(m.search_get_offset_matches())
      actual.push(...scan(resumed))
      matches += resumed.search_get_match_count(); intermediate += resumed.search_get_offset_matches()
    }
    expect(actual).toEqual(expected)
    expect(matches).toBe(whole.search_get_match_count())
    expect(intermediate).toBe(whole.search_get_offset_matches())
  })
  it('counts beyond the retained result cap and resumes arbitrary shard boundaries exactly', async () => {
    const c = { dx: 0, dz: 0, acceptedX: 65535, acceptedY: 65535, acceptedZ: 65535 }
    const whole = await solver(); configure(whole, [c], [-20, 19, -20, 19], 2, 2, false)
    const expected = scan(whole)
    expect(expected).toHaveLength(1000)
    expect(whole.search_get_match_count()).toBe(4800n)
    expect(whole.search_get_offset_matches()).toBe(1600n)
    const total = whole.search_get_total(), cut = total / 3n + 1n
    let matches = 0n, intermediate = 0n
    const retained: ReturnType<typeof scan> = []
    for (const [start, end] of [[0n, cut], [cut, total]]) {
      const m = await solver(); configure(m, [c], [-20, 19, -20, 19], 2, 2, false)
      m.search_restore(start, 0n); m.search_set_range_end(end)
      m.search_scan_batch(13, 1000)
      const beforePause = Array.from({ length: m.search_get_result_count() }, (_, i) => ({
        x: m.search_get_result_x(i), y: m.search_get_result_y(i), z: m.search_get_result_z(i),
        ordinal: m.search_get_result_ordinal(i), bad: m.search_get_result_bad_blocks(i),
      }))
      const cursor = m.search_get_processed(), count = m.search_get_match_count(), offsetCount = m.search_get_offset_matches()
      // A reloaded instance needs only its ordinal and exact counters.
      const resumed = await solver(); configure(resumed, [c], [-20, 19, -20, 19], 2, 2, false)
      resumed.search_restore(cursor, count); resumed.search_set_range_end(end); resumed.search_restore_offset_matches(offsetCount)
      retained.push(...beforePause, ...scan(resumed, 1000 - beforePause.length))
      matches += resumed.search_get_match_count(); intermediate += resumed.search_get_offset_matches()
      expect(resumed.search_get_processed()).toBe(end)
    }
    expect(matches).toBe(4800n)
    expect(intermediate).toBe(1600n)
    expect(new Set(retained.map((r) => r.ordinal)).size).toBe(retained.length)
    expect(retained.sort((a, b) => a.ordinal < b.ordinal ? -1 : 1).slice(0, 1000)).toEqual(expected)
  })
})
