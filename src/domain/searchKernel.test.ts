// These tests protect the locally generated Vanilla-3 kernel: deterministic
// bytes and identity, safe fallback for unsupported or oversized requests, and
// exact per-batch parity with the checked-in exact scanner.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import {
  KERNEL_Y_CHUNK,
  MAX_KERNEL_FILTERS,
  MAX_KERNEL_FILTER_SLOTS,
  MAX_KERNEL_MODULE_BYTES,
  generateSearchKernel,
  searchKernelIdentity,
  searchKernelPlan,
} from './searchKernel'
import type { WebSearchConstraint, WebSearchRequest } from './webSearch'

interface Scanner extends WebAssembly.Exports {
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
  search_get_result_ordinal: (index: number) => bigint
  search_get_result_x: (index: number) => number
  search_get_result_y: (index: number) => number
  search_get_result_z: (index: number) => number
  search_get_result_bad_blocks: (index: number) => number
  search_get_result_direction: (index: number) => number
}

const hostBinary = await readFile('src/wasm/coords_search_vanilla_3_host.wasm')
const exactBinary = await readFile('src/wasm/coords_search_vanilla_3_exact.wasm')

function baseRequest(
  overrides: Partial<WebSearchRequest> = {},
): WebSearchRequest {
  return {
    mode: 2,
    scanOrder: 0,
    directions: [0],
    xStart: -3,
    xEnd: 3,
    yStart: 0,
    yEnd: 6,
    zStart: -2,
    zEnd: 2,
    maxBadBlocks: 0,
    constraints: [{ x: 1, y: 0, z: -1, rotation: 2, visibleMask: 3 }],
    ...overrides,
  }
}

/** Deterministic constraint sets that exercise both visible masks. */
function makeConstraints(
  count: number,
  seed: number,
  firstMask: 1 | 3,
): WebSearchConstraint[] {
  let state = seed >>> 0
  const next = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state
  }
  return Array.from({ length: count }, (_, index) => {
    // Offsets stay inside -127..127 so every quarter-turn rotation still fits
    // a signed byte, matching search_set_filter's validation.
    const x = (next() % 255) - 127
    const y = (next() % 255) - 127
    const z = (next() % 255) - 127
    const visibleMask: 1 | 3 = index === 0 ? firstMask : next() % 2 === 0 ? 1 : 3
    return {
      x,
      y,
      z,
      rotation: next() % (visibleMask + 1),
      visibleMask,
    }
  })
}

async function instantiateExact(): Promise<Scanner> {
  const { instance } = await WebAssembly.instantiate(new Uint8Array(exactBinary))
  return instance.exports as Scanner
}

async function instantiateGenerated(request: WebSearchRequest): Promise<Scanner> {
  const kernel = generateSearchKernel(request)
  if (!kernel) throw new Error('The request was expected to be generatable.')
  const kernelInstance = (await WebAssembly.instantiate(kernel.bytes)).instance
  const signature = (kernelInstance.exports.wcf_signature as () => bigint)()
  expect(BigInt.asUintN(64, signature)).toBe(kernel.signature)
  const { instance } = await WebAssembly.instantiate(new Uint8Array(hostBinary), {
    wcf: { scan_run: kernelInstance.exports.scan_run as WebAssembly.ExportValue },
  })
  return instance.exports as Scanner
}

function configure(scanner: Scanner, request: WebSearchRequest) {
  expect(
    scanner.search_configure(
      request.mode,
      request.scanOrder,
      request.xStart,
      request.xEnd,
      request.yStart,
      request.yEnd,
      request.zStart,
      request.zEnd,
      request.maxBadBlocks,
      request.constraints.length,
      request.directions.length,
    ),
  ).toBe(0)
  request.directions.forEach((direction, index) => {
    expect(scanner.search_set_direction(index, direction / 90)).toBe(0)
  })
  request.constraints.forEach((constraint, index) => {
    expect(
      scanner.search_set_filter(
        index,
        constraint.x,
        constraint.y,
        constraint.z,
        constraint.rotation,
        constraint.visibleMask,
      ),
    ).toBe(0)
  })
}

function snapshot(scanner: Scanner) {
  return {
    processed: scanner.search_get_processed(),
    matches: scanner.search_get_match_count(),
    finished: scanner.search_is_finished(),
    results: Array.from(
      { length: scanner.search_get_result_count() },
      (_, index) =>
        [
          scanner.search_get_result_ordinal(index),
          scanner.search_get_result_x(index),
          scanner.search_get_result_y(index),
          scanner.search_get_result_z(index),
          scanner.search_get_result_bad_blocks(index),
          scanner.search_get_result_direction(index),
        ].join(','),
    ),
  }
}

interface DifferentialOptions {
  restore?: { processed: bigint; matchCount: bigint }
  batchSizes: number[]
  captureLimit?: number
  batches?: number
}

async function expectDifferentialParity(
  request: WebSearchRequest,
  options: DifferentialOptions,
): Promise<{ matches: bigint; comparisons: number }> {
  const generated = await instantiateGenerated(request)
  const exact = await instantiateExact()
  configure(generated, request)
  configure(exact, request)
  expect(generated.search_get_total()).toBe(exact.search_get_total())

  if (options.restore) {
    const { processed, matchCount } = options.restore
    expect(generated.search_restore(processed, matchCount)).toBe(0)
    expect(exact.search_restore(processed, matchCount)).toBe(0)
    expect(snapshot(generated)).toEqual(snapshot(exact))
  }

  const captureLimit = options.captureLimit ?? 1_024
  const batches = options.batches ?? options.batchSizes.length
  let comparisons = 0
  for (let index = 0; index < batches; index += 1) {
    const size = options.batchSizes[index % options.batchSizes.length]
    const generatedScanned = generated.search_scan_batch(size, captureLimit)
    const exactScanned = exact.search_scan_batch(size, captureLimit)
    expect(generatedScanned).toBe(exactScanned)
    expect(snapshot(generated)).toEqual(snapshot(exact))
    comparisons += 1
    if (exact.search_is_finished()) break
  }
  return { matches: exact.search_get_match_count(), comparisons }
}

describe('generated search kernel', () => {
  it('produces byte-identical modules and identities for the same request', () => {
    const request = baseRequest({ constraints: makeConstraints(6, 11, 3) })
    const first = generateSearchKernel(request)
    const second = generateSearchKernel(structuredClone(request))
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect([...second!.bytes]).toEqual([...first!.bytes])
    expect(second!.identity).toBe(first!.identity)
    expect(second!.signature).toBe(first!.signature)
    expect(searchKernelIdentity(request)).toBe(first!.identity)
    expect(first!.bytes.length).toBeLessThanOrEqual(MAX_KERNEL_MODULE_BYTES)
  })

  it('changes identity for different filters, directions, or bounds strategy', () => {
    const constraints = makeConstraints(4, 7, 3)
    const identity = searchKernelIdentity(baseRequest({ constraints }))

    expect(
      searchKernelIdentity(
        baseRequest({
          constraints: [
            { ...constraints[0], rotation: (constraints[0].rotation + 1) % 4 },
            ...constraints.slice(1),
          ],
        }),
      ),
    ).not.toBe(identity)
    expect(
      searchKernelIdentity(baseRequest({ constraints, directions: [90] })),
    ).not.toBe(identity)
    expect(
      searchKernelIdentity(
        baseRequest({ constraints, directions: [0, 90] }),
      ),
    ).not.toBe(identity)
    // Reordering the same constraints is a different unrolled chain.
    expect(
      searchKernelIdentity(
        baseRequest({ constraints: [...constraints].reverse() }),
      ),
    ).not.toBe(identity)
    // Bounds that make shared-basis decomposition unsafe change the strategy.
    const eligible = searchKernelPlan(
      baseRequest({ constraints: [{ x: 0, y: 0, z: -1, rotation: 0, visibleMask: 3 }] }),
    )
    const ineligible = searchKernelPlan(
      baseRequest({
        constraints: [{ x: 0, y: 0, z: -1, rotation: 0, visibleMask: 3 }],
        zStart: -2_147_483_648,
        zEnd: -2_147_483_640,
      }),
    )
    expect(eligible?.sharedBasis).toBe(true)
    expect(ineligible?.sharedBasis).toBe(false)
    expect(ineligible?.identity).not.toBe(eligible?.identity)
  })

  it('validates and instantiates as a standalone WebAssembly module', async () => {
    const kernel = generateSearchKernel(
      baseRequest({ constraints: makeConstraints(40, 3, 3), directions: [0, 90] }),
    )
    expect(kernel).toBeDefined()
    expect(WebAssembly.validate(kernel!.bytes)).toBe(true)
    const { instance } = await WebAssembly.instantiate(kernel!.bytes)
    expect(typeof instance.exports.scan_run).toBe('function')
    expect(
      BigInt.asUintN(64, (instance.exports.wcf_signature as () => bigint)()),
    ).toBe(kernel!.signature)
    // A run of zero positions can never report a match.
    expect((instance.exports.scan_run as (...v: number[]) => bigint)(0, 0, 0, 0, 0)).toBe(0n)
  })

  it('falls back for unsupported modes, tolerance, and oversized requests', () => {
    expect(generateSearchKernel(baseRequest({ mode: 0 }))).toBeUndefined()
    expect(generateSearchKernel(baseRequest({ mode: 1 }))).toBeUndefined()
    expect(generateSearchKernel(baseRequest({ mode: 3 }))).toBeUndefined()
    expect(generateSearchKernel(baseRequest({ mode: 4 }))).toBeUndefined()
    expect(generateSearchKernel(baseRequest({ maxBadBlocks: 1 }))).toBeUndefined()
    expect(generateSearchKernel(baseRequest({ constraints: [] }))).toBeUndefined()
    expect(
      generateSearchKernel(baseRequest({ directions: [] })),
    ).toBeUndefined()
    expect(
      generateSearchKernel(baseRequest({ directions: [0, 0] })),
    ).toBeUndefined()
    expect(
      generateSearchKernel(baseRequest({ directions: [45] as never })),
    ).toBeUndefined()
    expect(
      generateSearchKernel(
        baseRequest({ constraints: makeConstraints(MAX_KERNEL_FILTERS + 1, 5, 3) }),
      ),
    ).toBeUndefined()
    // Four directions cap the filter count through the emitted slot limit.
    expect(
      generateSearchKernel(
        baseRequest({
          constraints: makeConstraints(MAX_KERNEL_FILTER_SLOTS / 4 + 1, 5, 3),
          directions: [0, 90, 180, 270],
        }),
      ),
    ).toBeUndefined()
    expect(
      generateSearchKernel(
        baseRequest({
          constraints: [{ x: 128, y: 0, z: 0, rotation: 0, visibleMask: 3 }],
        }),
      ),
    ).toBeUndefined()
    expect(
      generateSearchKernel(
        baseRequest({
          constraints: [{ x: 0, y: 0, z: 0, rotation: 2, visibleMask: 1 }],
        }),
      ),
    ).toBeUndefined()
    expect(
      generateSearchKernel(
        baseRequest({
          constraints: [{ x: 0, y: 0, z: 0, rotation: 0, visibleMask: 2 as never }],
        }),
      ),
    ).toBeUndefined()
    expect(
      generateSearchKernel(baseRequest({ xStart: 5, xEnd: 4 })),
    ).toBeUndefined()
    expect(
      generateSearchKernel(baseRequest({ yStart: 0.5 })),
    ).toBeUndefined()
    // A -128 offset cannot be negated into a signed byte for a quarter turn.
    expect(
      generateSearchKernel(
        baseRequest({
          constraints: [{ x: -128, y: 0, z: 0, rotation: 0, visibleMask: 3 }],
          directions: [180],
        }),
      ),
    ).toBeUndefined()
    expect(searchKernelIdentity(baseRequest({ mode: 0 }))).toBe('none')
  })

  it('stays inside the safe module size at the supported maximum', () => {
    const widest = generateSearchKernel(
      baseRequest({
        constraints: makeConstraints(MAX_KERNEL_FILTER_SLOTS / 4, 9, 3),
        directions: [0, 90, 180, 270],
      }),
    )
    expect(widest).toBeDefined()
    expect(widest!.bytes.length).toBeLessThanOrEqual(MAX_KERNEL_MODULE_BYTES)
    expect(WebAssembly.validate(widest!.bytes)).toBe(true)
  })
})

describe('generated kernel versus checked-in exact scanner', () => {
  it('matches across filter counts, masks, directions, and scan orders', async () => {
    let observedMatches = 0n
    for (const scanOrder of [0, 1]) {
      for (const directions of [
        [0],
        [90],
        [180],
        [270],
        [0, 90],
        [90, 270],
        [0, 90, 180, 270],
      ] as WebSearchRequest['directions'][]) {
        for (const filterCount of [1, 2, 40, MAX_KERNEL_FILTER_SLOTS / 4]) {
          for (const firstMask of [1, 3] as const) {
            if (filterCount * directions.length > MAX_KERNEL_FILTER_SLOTS) {
              continue
            }
            const request = baseRequest({
              scanOrder,
              directions,
              constraints: makeConstraints(filterCount, filterCount * 31 + scanOrder, firstMask),
              xStart: -4,
              xEnd: 4,
              yStart: -3,
              yEnd: 3,
              zStart: -4,
              zEnd: 4,
            })
            const { matches } = await expectDifferentialParity(request, {
              batchSizes: [1, 2, 7, 60, 61, 62, 127, 257, 1_024],
              batches: 40,
              captureLimit: 1_024,
            })
            observedMatches += matches
          }
        }
      }
    }
    // The single-filter cases must actually produce matches for this to mean
    // anything; four-state filters accept roughly a quarter of positions.
    expect(observedMatches).toBeGreaterThan(0n)
  })

  it('matches at int32 bounds with and without shared-basis Z decomposition', async () => {
    const constraints: WebSearchConstraint[] = [
      { x: -5, y: 3, z: -7, rotation: 1, visibleMask: 3 },
      { x: 9, y: -2, z: 11, rotation: 0, visibleMask: 1 },
    ]
    const cases: { request: WebSearchRequest; sharedBasis: boolean }[] = [
      {
        request: baseRequest({
          constraints,
          zStart: -2_147_483_648,
          zEnd: -2_147_483_640,
          xStart: -2_147_483_648,
          xEnd: -2_147_483_644,
          yStart: -2_147_483_648,
          yEnd: -2_147_483_643,
        }),
        sharedBasis: false,
      },
      {
        request: baseRequest({
          constraints,
          zStart: 2_147_483_640,
          zEnd: 2_147_483_647,
          xStart: 2_147_483_643,
          xEnd: 2_147_483_647,
          yStart: 2_147_483_642,
          yEnd: 2_147_483_647,
        }),
        sharedBasis: false,
      },
      {
        request: baseRequest({
          constraints,
          zStart: -2_147_483_600,
          zEnd: -2_147_483_592,
          xStart: -2_147_483_648,
          xEnd: -2_147_483_644,
          yStart: 2_147_483_642,
          yEnd: 2_147_483_647,
        }),
        sharedBasis: true,
      },
      {
        request: baseRequest({
          constraints,
          scanOrder: 1,
          zStart: 2_147_483_400,
          zEnd: 2_147_483_408,
          xStart: 2_147_483_643,
          xEnd: 2_147_483_647,
          yStart: -2_147_483_648,
          yEnd: -2_147_483_643,
        }),
        sharedBasis: true,
      },
    ]

    for (const { request, sharedBasis } of cases) {
      expect(searchKernelPlan(request)?.sharedBasis).toBe(sharedBasis)
      const { matches } = await expectDifferentialParity(request, {
        batchSizes: [1, 2, 7, 60, 61, 62, 127, 257, 1_024],
        batches: 30,
      })
      // Keep these cases from silently degrading into reject-only coverage.
      expect(matches).toBeGreaterThan(0n)
    }
  })

  it('matches after arbitrary restores with a persisted match count', async () => {
    const request = baseRequest({
      scanOrder: 1,
      directions: [0, 90, 180],
      constraints: makeConstraints(2, 77, 3),
      xStart: -6,
      xEnd: 6,
      yStart: -30,
      yEnd: 30,
      zStart: -6,
      zEnd: 6,
    })
    const total =
      13n * 61n * 13n * 3n
    for (const fraction of [0n, 37n, 91n, 99n]) {
      const restoreOrdinal = (total * fraction) / 100n
      await expectDifferentialParity(request, {
        restore: { processed: restoreOrdinal, matchCount: restoreOrdinal / 7n },
        batchSizes: [1, 2, 7, 60, 61, 62, 127, 257, 1_024],
        batches: 25,
      })
    }
  })

  it('matches mid-Y starts, Y boundaries, and capture limits', async () => {
    const request = baseRequest({
      directions: [0, 270],
      constraints: makeConstraints(1, 5, 3),
      xStart: -2,
      xEnd: 2,
      yStart: 10,
      yEnd: 16,
      zStart: -2,
      zEnd: 2,
    })
    // A seven-position Y span with these batch sizes forces single-position
    // batches, exact run boundaries, and crossings into the next X/Z pass.
    for (const captureLimit of [0, 1, 3, 1_024]) {
      const { matches } = await expectDifferentialParity(request, {
        batchSizes: [1, 6, 7, 8, 29, 64],
        batches: 60,
        captureLimit,
      })
      expect(matches).toBeGreaterThan(0n)
    }
  })

  it('matches when Y runs are longer than one generated chunk', async () => {
    const request = baseRequest({
      constraints: makeConstraints(1, 19, 3),
      directions: [0, 90],
      xStart: 0,
      xEnd: 1,
      yStart: -100,
      yEnd: 100,
      zStart: 0,
      zEnd: 1,
    })
    expect(request.yEnd - request.yStart + 1).toBeGreaterThan(KERNEL_Y_CHUNK)
    const { matches } = await expectDifferentialParity(request, {
      batchSizes: [KERNEL_Y_CHUNK, KERNEL_Y_CHUNK + 1, 1, 201, 1_024],
      batches: 40,
    })
    expect(matches).toBeGreaterThan(0n)
  })
})

/** Test-only Vanilla-3 variant, used to construct guaranteed matches. */
function vanilla3Variant(x: number, y: number, z: number): number {
  const mask48 = (1n << 48n) - 1n
  const xProduct = BigInt.asIntN(32, BigInt(x) * 3_129_871n)
  let seed = BigInt.asUintN(64, xProduct)
  seed ^= BigInt.asUintN(64, BigInt(z) * 116_129_781n)
  seed ^= BigInt.asUintN(64, BigInt(y))
  const raw = BigInt.asUintN(64, seed * seed * 42_317_861n + seed * 11n)
  const shifted = BigInt.asUintN(64, BigInt.asIntN(64, raw) >> 16n)
  let state = (shifted ^ 0x5deece66dn) & mask48
  state = (state * 0x5deece66dn + 11n) & mask48
  return Number(state >> 46n)
}

const wrapInt32 = (value: number) => (value | 0) + 0

describe('generated kernel accept path', () => {
  /*
   * The randomised differential matrix above rejects at the first filter for
   * long chains, so a generator bug that made a 40- or 64-filter chain always
   * reject would pass it. These cases plant a guaranteed match by deriving each
   * constraint's rotation from the true variant at a chosen position.
   */
  it('finds planted matches through long unrolled chains in every direction', async () => {
    const positions = [
      { x: 12_345, y: -37, z: -98_765 },
      { x: 2_147_483_600, y: 2_147_483_600, z: 2_147_483_600 },
      { x: -2_147_483_600, y: -2_147_483_600, z: -2_147_483_600 },
    ]
    let planted = 0
    for (const position of positions) {
      for (const direction of [0, 90, 180, 270] as const) {
        for (const filterCount of [40, MAX_KERNEL_FILTER_SLOTS / 4]) {
          const quarterTurns = direction / 90
          const constraints = makeConstraints(
            filterCount,
            filterCount * 7 + quarterTurns,
            3,
          ).map((constraint) => {
            // Mirror search_set_filter's per-direction X/Z rotation.
            const rotated =
              quarterTurns === 1
                ? { x: -constraint.z, z: constraint.x }
                : quarterTurns === 2
                  ? { x: -constraint.x, z: -constraint.z }
                  : quarterTurns === 3
                    ? { x: constraint.z, z: -constraint.x }
                    : { x: constraint.x, z: constraint.z }
            const variant =
              vanilla3Variant(
                wrapInt32(position.x + rotated.x),
                wrapInt32(position.y + constraint.y),
                wrapInt32(position.z + rotated.z),
              ) & constraint.visibleMask
            return {
              ...constraint,
              // Undo the four-state advance so the effective rotation matches.
              rotation:
                constraint.visibleMask === 3
                  ? (variant - quarterTurns + 4) % 4
                  : variant,
            }
          })

          const request = baseRequest({
            directions: [direction],
            constraints,
            xStart: position.x,
            xEnd: position.x,
            yStart: position.y,
            yEnd: position.y,
            zStart: position.z,
            zEnd: position.z,
          })
          const { matches } = await expectDifferentialParity(request, {
            batchSizes: [1],
            batches: 1,
          })
          expect(matches).toBe(1n)
          planted += 1
        }
      }
    }
    expect(planted).toBe(24)
  })

  it('drives the host module with exactly the generated chunk size', async () => {
    // The kernel clamps to KERNEL_Y_CHUNK and the host is compiled with
    // GENERATED_RUN_CHUNK. They are coupled only by construction, so pin it:
    // a smaller kernel chunk would silently drop each run's tail.
    const requestedCounts: number[] = []
    const { instance } = await WebAssembly.instantiate(
      new Uint8Array(hostBinary),
      {
        wcf: {
          scan_run: (
            _x: number,
            _z: number,
            _y: number,
            count: number,
          ): bigint => {
            requestedCounts.push(count)
            return 0n
          },
        },
      },
    )
    const scanner = instance.exports as Scanner
    configure(
      scanner,
      baseRequest({ yStart: -200, yEnd: 200, xStart: 0, xEnd: 0, zStart: 0, zEnd: 0 }),
    )
    expect(scanner.search_scan_batch(401, 0)).toBe(401)
    expect(Math.max(...requestedCounts)).toBe(KERNEL_Y_CHUNK)
    expect(requestedCounts.reduce((sum, count) => sum + count, 0)).toBe(401)
  })
})

describe('generated kernel on the fixed Doughnut SMP request', () => {
  async function fixedRequest(): Promise<WebSearchRequest> {
    const archive = unzipSync(
      new Uint8Array(await readFile('public/examples/doughnut-smp-hard-.wcf')),
    )
    const document = JSON.parse(
      new TextDecoder().decode(archive['project.json']),
    )
    const anchor = document.scene.faces.find(
      (face: { id: string }) => face.id === document.anchorFaceId,
    )?.blockCoordinate
    if (!anchor) throw new Error('The example project has no anchor face.')
    const mapping = document.scene.axisMapping as Record<string, string>
    const toWorld = (offset: Record<string, number>) => {
      const world: Record<string, number> = { x: 0, y: 0, z: 0 }
      for (const [localAxis, value] of Object.entries(offset)) {
        const assignment = mapping[localAxis]
        world[assignment[0]] = value * (assignment[1] === '+' ? 1 : -1)
      }
      return world
    }
    const constraints = document.evidence
      .filter(
        (entry: { reviewStatus: string; selectedVariant: number }) =>
          entry.reviewStatus === 'confirmed' &&
          Number.isInteger(entry.selectedVariant),
      )
      .map((entry: Record<string, never>) => {
        const lattice = entry.latticeCoordinate as unknown as {
          x: number
          y: number
          z: number
        }
        return {
          ...toWorld({
            a: lattice.x - anchor.x,
            b: lattice.y - anchor.y,
            c: lattice.z - anchor.z,
          }),
          rotation: entry.selectedVariant as unknown as number,
          visibleMask: (entry.stateCount as unknown as number) === 2 ? 1 : 3,
        }
      })
      .sort(
        (left: WebSearchConstraint, right: WebSearchConstraint) =>
          right.visibleMask - left.visibleMask,
      ) as WebSearchConstraint[]
    expect(constraints).toHaveLength(40)
    return baseRequest({
      scanOrder: 1,
      directions: [0],
      xStart: -225_000,
      xEnd: 225_000,
      yStart: -60,
      yEnd: 0,
      zStart: -225_000,
      zEnd: 225_000,
      constraints,
    })
  }

  it('generates a shared-basis kernel and reproduces the known solution', async () => {
    const request = await fixedRequest()
    const kernel = generateSearchKernel(request)
    expect(kernel).toBeDefined()
    expect(kernel!.sharedBasis).toBe(true)
    expect(kernel!.filterCount).toBe(40)

    const generated = await instantiateGenerated(request)
    const exact = await instantiateExact()
    configure(generated, request)
    configure(exact, request)
    expect(generated.search_get_total()).toBe(12_352_554_900_061n)

    const solutionOrdinal = 11_703_711_737_372n
    for (const scanner of [generated, exact]) {
      expect(scanner.search_restore(solutionOrdinal, 0n)).toBe(0)
      expect(scanner.search_scan_batch(1, 1)).toBe(1)
      expect(scanner.search_get_match_count()).toBe(1n)
      expect(scanner.search_get_result_count()).toBe(1)
      expect(scanner.search_get_result_x(0)).toBe(197_325)
      expect(scanner.search_get_result_y(0)).toBe(-50)
      expect(scanner.search_get_result_z(0)).toBe(-219_011)
      expect(scanner.search_get_result_ordinal(0)).toBe(solutionOrdinal)
    }
  })

  it('matches the checked-in scanner over bounded windows of the fixed request', async () => {
    const request = await fixedRequest()
    for (const ordinal of [0n, 999_999_999n, 11_703_711_737_000n]) {
      await expectDifferentialParity(request, {
        restore: { processed: ordinal, matchCount: ordinal === 0n ? 0n : 17n },
        batchSizes: [1, 61, 1_000, 400_000],
        batches: 8,
      })
    }
  })
})
