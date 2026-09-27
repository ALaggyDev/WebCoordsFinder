import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createOffsetSearchRequest, offsetWorkerRanges } from './offsetSearch'
import { mappedAnchorOffset, sceneLatticeParity, validAxisMappingCompletions } from './geometry'
import { createTestDocument } from '../test/createTestDocument'

interface Solver extends WebAssembly.Exports {
  offset_configure: (start: number, end: number, minX: number, maxX: number, minZ: number, maxZ: number, count: number) => number
  offset_set_constraint: (index: number, dx: number, dz: number, x: number, y: number, z: number, xMask: number, zMask: number, full: number) => number
  offset_scan_batch: (count: number) => number
  offset_get_matches: () => bigint
  offset_get_result_x: (index: number) => number
  offset_get_result_z: (index: number) => number
}

const examples = [
  {
    solution: [12541022, 10457150],
    constraints: [
      [2, -1, 11, 11, 5],
      [1, 0, 3, 2, 15],
      [3, -2, 10, 11, 12],
      [3, -1, 7, 8, 0],
      [-4, 1, 6, 15, 11],
    ],
  },
  {
    solution: [-1392121, -10529167],
    constraints: [
      [2, -1, 13, 6, 2],
      [1, 0, 9, 8, 13],
      [3, -2, 6, 2, 6],
      [3, -1, 6, 5, 12],
      [-4, 1, 15, 12, 13],
    ],
  },
]

describe('offset WASM solver', () => {
  it('uses every active model with anchored world offsets', () => {
    const document = createTestDocument()
    document.scene.axisMapping = validAxisMappingCompletions(
      { a: 'unknown', b: 'unknown', c: 'unknown' },
      sceneLatticeParity(document.scene),
    )[0]
    document.scanner.compassResolved = true
    document.anchorFaceId = document.scene.faces[0].id
    const position = { x: 1, y: 2, z: 3 }
    document.offsets = [{
      id: 'roots', blockId: 'hanging_roots', modelIndex: 0, position,
      nibbles: { x: 4, y: 0, z: 12 }, tint: '#91bd59',
      confirmedBasis: 'outdated-camera-basis',
    }]
    const mapped = mappedAnchorOffset(document.scene, document.anchorFaceId, position)!
    expect(createOffsetSearchRequest(document).constraints).toEqual([{
      dx: mapped.x, dz: mapped.z, x: 4, y: 0, z: 12,
      xMask: 15, zMask: 15, full: false,
    }])
    document.offsets[0].blockId = 'pointed_dripstone'
    document.offsets[0].nibbles = { x: 3, y: 0, z: 12 }
    expect(createOffsetSearchRequest(document).constraints[0]).toMatchObject({
      xMask: 12, zMask: 12,
    })
    document.offsets[0].ignored = true
    expect(() => createOffsetSearchRequest(document)).toThrow(/Add at least one active/)
  })

  it.each(examples)('recovers the supplied solution $solution', async ({ solution, constraints }) => {
    const binary = readFileSync(resolve('src/wasm/offset_search.wasm'))
    const { instance } = await WebAssembly.instantiate(binary)
    const solver = instance.exports as Solver
    const [x, z] = solution
    expect(solver.offset_configure(0, 65536, x, x, z, z, constraints.length)).toBe(0)
    constraints.forEach(([dx, dz, offx, offy, offz], index) => {
      expect(solver.offset_set_constraint(index, dx, dz, offx, offy, offz, 15, 15, 1)).toBe(0)
    })
    for (const shard of offsetWorkerRanges(4)) {
      // The configured bound skips all prefixes except the solution's low 16 bits.
      solver.offset_configure(shard.start, shard.end, x, x, z, z, constraints.length)
      solver.offset_scan_batch(shard.end - shard.start)
      if (solver.offset_get_matches() > 0n) {
        expect(solver.offset_get_matches()).toBe(1n)
        expect([solver.offset_get_result_x(0), solver.offset_get_result_z(0)]).toEqual(solution)
        return
      }
    }
    throw new Error('The known solution was not found.')
  })
})
