import type { WebSearchConstraint, WebSearchRequest } from './webSearch'

/*
 * Local, offline, CSP-safe generation of a request-specific WebAssembly kernel
 * for Vanilla-3 zero-tolerance searches.
 *
 * The generated module contains one hot function. It evaluates a contiguous run
 * of at most KERNEL_Y_CHUNK Y positions at a fixed X/Z/direction and returns a
 * match bitmask. The confirmed filter set, its direction-adjusted offsets, its
 * expected rotations, and its visible masks are emitted as constants inside an
 * unrolled early-rejection chain, so the hot path contains no filter-table
 * loads, no filter counter, no texture-mode switch and no tolerance counter.
 *
 * `coords_search_vanilla_3_host.wasm` imports that function and keeps the
 * compiled traversal, cursor, ordinal, capture, and checkpoint bookkeeping, so
 * the exported scanner ABI is unchanged. Every failure path falls back to the
 * checked-in `coords_search_vanilla_3_exact.wasm` module.
 *
 * No source text is ever interpreted: only validated integers reach the byte
 * encoders below.
 */

/** Bumped whenever emitted code or its semantics change. */
export const SEARCH_KERNEL_FORMAT_VERSION = 1
/** Must match GENERATED_RUN_CHUNK in src/wasm/coords_search.c. */
export const KERNEL_Y_CHUNK = 64
export const MAX_KERNEL_FILTERS = 64
export const MAX_KERNEL_FILTER_SLOTS = 256
export const MAX_KERNEL_MODULE_BYTES = 65_536

const VANILLA_3_MODE = 2
const COORDINATE_X_MULTIPLIER = 3_129_871
const COORDINATE_Z_MULTIPLIER = 116_129_781n
const JAVA_MULTIPLIER = 0x5deece66dn
const INT32_MINIMUM = -2_147_483_648
const INT32_MAXIMUM = 2_147_483_647

export interface KernelFilter {
  x: number
  y: number
  z: number
  rotation: number
  visibleMask: 1 | 3
}

export interface SearchKernelPlan {
  identity: string
  signature: bigint
  /** Direction-adjusted filters, outer index matching request.directions. */
  directionalFilters: KernelFilter[][]
  /** True when every adjusted Z stays inside int32 across the search bounds. */
  sharedBasis: boolean
  filterCount: number
}

export interface GeneratedSearchKernel extends SearchKernelPlan {
  bytes: Uint8Array<ArrayBuffer>
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isSignedByte(value: number): boolean {
  return value >= -128 && value <= 127
}

/** Mirrors search_set_filter's per-direction rotation in coords_search.c. */
function adjustFilter(
  constraint: WebSearchConstraint,
  quarterTurns: number,
): KernelFilter | undefined {
  let x: number
  let z: number
  switch (quarterTurns) {
    case 1:
      x = -constraint.z
      z = constraint.x
      break
    case 2:
      x = -constraint.x
      z = -constraint.z
      break
    case 3:
      x = constraint.z
      z = -constraint.x
      break
    default:
      x = constraint.x
      z = constraint.z
      break
  }
  if (!isSignedByte(x) || !isSignedByte(z)) return undefined
  return {
    x,
    y: constraint.y,
    z,
    rotation:
      constraint.visibleMask === 3
        ? (constraint.rotation + quarterTurns) % 4
        : constraint.rotation,
    visibleMask: constraint.visibleMask,
  }
}

function fnv1a64(text: string): bigint {
  const bytes = new TextEncoder().encode(text)
  let hash = 0xcbf29ce484222325n
  for (const byte of bytes) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  }
  return hash
}

/**
 * Decides whether a request is eligible for a generated kernel and derives the
 * deterministic identity of the code that would be emitted. Pure and cheap: it
 * carries no byte encoding, so search setup and checkpoint keys can call it.
 */
export function searchKernelPlan(
  request: WebSearchRequest,
): SearchKernelPlan | undefined {
  if (request.mode !== VANILLA_3_MODE) return undefined
  if (request.maxBadBlocks !== 0) return undefined

  const directions = request.directions
  if (!Array.isArray(directions) || directions.length < 1) return undefined
  if (directions.length > 4) return undefined
  const quarterTurns: number[] = []
  for (const direction of directions) {
    if (!isInt(direction) || direction % 90 !== 0) return undefined
    const turns = direction / 90
    if (turns < 0 || turns > 3) return undefined
    if (quarterTurns.includes(turns)) return undefined
    quarterTurns.push(turns)
  }

  const constraints = request.constraints
  if (!Array.isArray(constraints) || constraints.length < 1) return undefined
  if (constraints.length > MAX_KERNEL_FILTERS) return undefined
  if (constraints.length * directions.length > MAX_KERNEL_FILTER_SLOTS) {
    return undefined
  }

  for (const bound of [
    request.xStart,
    request.xEnd,
    request.yStart,
    request.yEnd,
    request.zStart,
    request.zEnd,
  ]) {
    if (!isInt(bound) || bound < INT32_MINIMUM || bound > INT32_MAXIMUM) {
      return undefined
    }
  }
  if (
    request.xStart > request.xEnd ||
    request.yStart > request.yEnd ||
    request.zStart > request.zEnd
  ) {
    return undefined
  }

  for (const constraint of constraints) {
    if (
      !isInt(constraint.x) ||
      !isInt(constraint.y) ||
      !isInt(constraint.z) ||
      !isSignedByte(constraint.x) ||
      !isSignedByte(constraint.y) ||
      !isSignedByte(constraint.z)
    ) {
      return undefined
    }
    if (constraint.visibleMask !== 1 && constraint.visibleMask !== 3) {
      return undefined
    }
    if (
      !isInt(constraint.rotation) ||
      constraint.rotation < 0 ||
      constraint.rotation > constraint.visibleMask
    ) {
      return undefined
    }
  }

  const directionalFilters: KernelFilter[][] = []
  for (const turns of quarterTurns) {
    const adjusted: KernelFilter[] = []
    for (const constraint of constraints) {
      const filter = adjustFilter(constraint, turns)
      if (!filter) return undefined
      adjusted.push(filter)
    }
    directionalFilters.push(adjusted)
  }

  /*
   * Shared-basis Z decomposition replaces sext64(wrap32(z + dz)) * C with
   * baseZ + dz * C. That is exact only while z + dz cannot leave int32, so
   * preflight every search bound against every direction-adjusted offset.
   * X needs no preflight: the product is distributive modulo 2^32.
   */
  const sharedBasis = directionalFilters.every((filters) =>
    filters.every(
      (filter) =>
        request.zStart + filter.z >= INT32_MINIMUM &&
        request.zEnd + filter.z <= INT32_MAXIMUM,
    ),
  )

  const identity = JSON.stringify({
    format: SEARCH_KERNEL_FORMAT_VERSION,
    algorithm: 'Vanilla-3',
    tolerance: 0,
    traversal: 'contiguous-y-run',
    chunk: KERNEL_Y_CHUNK,
    strategy: sharedBasis ? 'shared-basis' : 'exact-z',
    directions: quarterTurns,
    filters: directionalFilters.map((filters) =>
      filters.map((filter) => [
        filter.x,
        filter.y,
        filter.z,
        filter.rotation,
        filter.visibleMask,
      ]),
    ),
  })

  return {
    identity,
    signature: fnv1a64(identity),
    directionalFilters,
    sharedBasis,
    filterCount: constraints.length,
  }
}

/* ---------------------------------------------------------------------- */
/* Bounded WebAssembly byte encoders                                       */
/* ---------------------------------------------------------------------- */

function unsignedLeb(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('Kernel encoder received an out-of-range unsigned integer.')
  }
  const bytes: number[] = []
  let remaining = value
  do {
    let byte = remaining & 0x7f
    remaining = Math.floor(remaining / 128)
    if (remaining !== 0) byte |= 0x80
    bytes.push(byte)
  } while (remaining !== 0)
  return bytes
}

function signedLeb(value: bigint, bits: 32 | 64): number[] {
  const limit = 1n << BigInt(bits - 1)
  if (value < -limit || value >= limit) {
    throw new Error('Kernel encoder received an out-of-range signed integer.')
  }
  const bytes: number[] = []
  let remaining = value
  for (;;) {
    const byte = Number(remaining & 0x7fn)
    remaining >>= 7n
    const signBit = (byte & 0x40) !== 0
    if ((remaining === 0n && !signBit) || (remaining === -1n && signBit)) {
      bytes.push(byte)
      return bytes
    }
    bytes.push(byte | 0x80)
  }
}

const i32Const = (value: number) => [0x41, ...signedLeb(BigInt(value), 32)]
const i64Const = (value: bigint) => [0x42, ...signedLeb(value, 64)]
const localGet = (index: number) => [0x20, ...unsignedLeb(index)]
const localSet = (index: number) => [0x21, ...unsignedLeb(index)]

const I32_ADD = 0x6a
const I32_MUL = 0x6c
const I32_AND = 0x71
const I32_NE = 0x47
const I32_EQ = 0x46
const I32_GT_S = 0x4a
const I32_SUB = 0x6b
const I32_LT_S = 0x48
const I64_ADD = 0x7c
const I64_MUL = 0x7e
const I64_OR = 0x84
const I64_XOR = 0x85
const I64_SHL = 0x86
const I64_SHR_S = 0x87
const I64_SHR_U = 0x88
const I32_WRAP_I64 = 0xa7
const I64_EXTEND_I32_S = 0xac
const I64_EXTEND_I32_U = 0xad
const BLOCK = 0x02
const LOOP = 0x03
const IF = 0x04
const ELSE = 0x05
const END = 0x0b
const BR_IF = 0x0d
const RETURN = 0x0f
const VOID_BLOCK = 0x40

// Locals: parameters 0..4 are x, z, y0, count, direction.
const LOCAL_X = 0
const LOCAL_Z = 1
const LOCAL_Y_START = 2
const LOCAL_COUNT = 3
const LOCAL_DIRECTION = 4
const LOCAL_BASE_X = 5
const LOCAL_Y = 6
const LOCAL_REMAINING = 7
const LOCAL_BASE_Z = 8
const LOCAL_MASK = 9
const LOCAL_FIRST_XZ = 10
const LOCAL_SEED = 11

function section(id: number, payload: number[]): number[] {
  return [id, ...unsignedLeb(payload.length), ...payload]
}

function vector(entries: number[][]): number[] {
  return [...unsignedLeb(entries.length), ...entries.flat()]
}

function name(text: string): number[] {
  const bytes = [...new TextEncoder().encode(text)]
  return [...unsignedLeb(bytes.length), ...bytes]
}

/* ---------------------------------------------------------------------- */
/* Hot-loop emission                                                       */
/* ---------------------------------------------------------------------- */

/** sext64(wrap32(x + dx) * 3129871) using the shared wrapped X basis. */
function emitFilterX(filter: KernelFilter): number[] {
  const offsetProduct = (filter.x * COORDINATE_X_MULTIPLIER) | 0
  return [
    ...localGet(LOCAL_BASE_X),
    ...(offsetProduct === 0 ? [] : [...i32Const(offsetProduct), I32_ADD]),
    I64_EXTEND_I32_S,
  ]
}

/** sext64(wrap32(z + dz)) * 116129781, decomposed only when proven exact. */
function emitFilterZ(filter: KernelFilter, sharedBasis: boolean): number[] {
  if (filter.z === 0) return localGet(LOCAL_BASE_Z)
  if (sharedBasis) {
    return [
      ...localGet(LOCAL_BASE_Z),
      ...i64Const(BigInt(filter.z) * COORDINATE_Z_MULTIPLIER),
      I64_ADD,
    ]
  }
  return [
    ...localGet(LOCAL_Z),
    ...i32Const(filter.z),
    I32_ADD,
    I64_EXTEND_I32_S,
    ...i64Const(COORDINATE_Z_MULTIPLIER),
    I64_MUL,
  ]
}

function emitFilterXZ(filter: KernelFilter, sharedBasis: boolean): number[] {
  return [...emitFilterX(filter), ...emitFilterZ(filter, sharedBasis), I64_XOR]
}

/** sext64(wrap_add_i32(y, dy)). Y keeps exact wrapping semantics. */
function emitFilterY(filter: KernelFilter, yLocal: number): number[] {
  return [
    ...localGet(yLocal),
    ...(filter.y === 0 ? [] : [...i32Const(filter.y), I32_ADD]),
    I64_EXTEND_I32_S,
  ]
}

/**
 * Vanilla-3 variant of the seed held in `seedLocal`, masked and compared with
 * the expected rotation. Leaves 1 on the stack when the filter rejects.
 *
 * Both 48-bit masks of the Java generator are dropped: only bits 46 and 47 of
 * the final value are read, and those are unchanged by the omitted masking.
 */
function emitRejectTest(filter: KernelFilter, seedLocal: number): number[] {
  return [
    ...localGet(seedLocal),
    ...localGet(seedLocal),
    I64_MUL,
    ...i64Const(42_317_861n),
    I64_MUL,
    ...localGet(seedLocal),
    ...i64Const(11n),
    I64_MUL,
    I64_ADD,
    ...i64Const(16n),
    I64_SHR_S,
    ...i64Const(JAVA_MULTIPLIER),
    I64_XOR,
    ...i64Const(JAVA_MULTIPLIER),
    I64_MUL,
    ...i64Const(11n),
    I64_ADD,
    ...i64Const(46n),
    I64_SHR_U,
    I32_WRAP_I64,
    ...i32Const(filter.visibleMask),
    I32_AND,
    ...i32Const(filter.rotation),
    I32_NE,
  ]
}

function emitDirectionChain(
  filters: KernelFilter[],
  sharedBasis: boolean,
): number[] {
  const first = filters[0]
  const body: number[] = [
    // The first filter's X/Z term is constant for the whole run.
    ...emitFilterXZ(first, sharedBasis),
    ...localSet(LOCAL_FIRST_XZ),
    ...localGet(LOCAL_Y_START),
    ...localSet(LOCAL_Y),
    ...localGet(LOCAL_COUNT),
    ...localSet(LOCAL_REMAINING),
    LOOP,
    VOID_BLOCK,
    BLOCK,
    VOID_BLOCK,
  ]

  filters.forEach((filter, index) => {
    body.push(
      ...(index === 0
        ? localGet(LOCAL_FIRST_XZ)
        : emitFilterXZ(filter, sharedBasis)),
      ...emitFilterY(filter, LOCAL_Y),
      I64_XOR,
      ...localSet(LOCAL_SEED),
      ...emitRejectTest(filter, LOCAL_SEED),
      BR_IF,
      0x00,
    )
  })

  body.push(
    // Matches are rare, so the bit index is derived here rather than tracked.
    ...localGet(LOCAL_MASK),
    ...i64Const(1n),
    ...localGet(LOCAL_Y),
    ...localGet(LOCAL_Y_START),
    I32_SUB,
    I64_EXTEND_I32_U,
    I64_SHL,
    I64_OR,
    ...localSet(LOCAL_MASK),
    END,
    ...localGet(LOCAL_Y),
    ...i32Const(1),
    I32_ADD,
    ...localSet(LOCAL_Y),
    // A remaining counter rather than a bound comparison, so a run ending at
    // INT32_MAX cannot wrap the loop condition.
    ...localGet(LOCAL_REMAINING),
    ...i32Const(-1),
    I32_ADD,
    ...localSet(LOCAL_REMAINING),
    ...localGet(LOCAL_REMAINING),
    BR_IF,
    0x00,
    END,
  )
  return body
}

function emitDirectionDispatch(
  directionalFilters: KernelFilter[][],
  sharedBasis: boolean,
  index = 0,
): number[] {
  if (index === directionalFilters.length - 1) {
    return emitDirectionChain(directionalFilters[index], sharedBasis)
  }
  return [
    ...localGet(LOCAL_DIRECTION),
    ...i32Const(index),
    I32_EQ,
    IF,
    VOID_BLOCK,
    ...emitDirectionChain(directionalFilters[index], sharedBasis),
    ELSE,
    ...emitDirectionDispatch(directionalFilters, sharedBasis, index + 1),
    END,
  ]
}

function emitKernelBody(plan: SearchKernelPlan): number[] {
  const code: number[] = [
    // Defensive clamp: a host asking for more than one chunk would otherwise
    // shift past bit 63. Clamping under-reports rather than inventing matches.
    ...localGet(LOCAL_COUNT),
    ...i32Const(KERNEL_Y_CHUNK),
    I32_GT_S,
    IF,
    VOID_BLOCK,
    ...i32Const(KERNEL_Y_CHUNK),
    ...localSet(LOCAL_COUNT),
    END,
    // An empty run has no bits to report and must not enter the loop body.
    ...localGet(LOCAL_COUNT),
    ...i32Const(1),
    I32_LT_S,
    IF,
    VOID_BLOCK,
    ...i64Const(0n),
    RETURN,
    END,
    ...localGet(LOCAL_X),
    ...i32Const(COORDINATE_X_MULTIPLIER),
    I32_MUL,
    ...localSet(LOCAL_BASE_X),
    ...localGet(LOCAL_Z),
    I64_EXTEND_I32_S,
    ...i64Const(COORDINATE_Z_MULTIPLIER),
    I64_MUL,
    ...localSet(LOCAL_BASE_Z),
    ...i64Const(0n),
    ...localSet(LOCAL_MASK),
    ...emitDirectionDispatch(plan.directionalFilters, plan.sharedBasis),
    ...localGet(LOCAL_MASK),
    END,
  ]
  // Three i32 and four i64 locals follow the five i32 parameters.
  const locals = [...unsignedLeb(2), ...unsignedLeb(3), 0x7f, ...unsignedLeb(4), 0x7e]
  const body = [...locals, ...code]
  return [...unsignedLeb(body.length), ...body]
}

function emitSignatureBody(signature: bigint): number[] {
  const body = [
    ...unsignedLeb(0),
    ...i64Const(BigInt.asIntN(64, signature)),
    END,
  ]
  return [...unsignedLeb(body.length), ...body]
}

/**
 * Emits the complete generated module. Returns undefined when the request is
 * unsupported or the module would exceed the safe size limit; callers then use
 * the checked-in exact scanner.
 */
export function generateSearchKernel(
  request: WebSearchRequest,
): GeneratedSearchKernel | undefined {
  const plan = searchKernelPlan(request)
  if (!plan) return undefined

  let bytes: Uint8Array<ArrayBuffer>
  try {
    const types = section(
      1,
      vector([
        [0x60, ...unsignedLeb(5), 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, ...unsignedLeb(1), 0x7e],
        [0x60, ...unsignedLeb(0), ...unsignedLeb(1), 0x7e],
      ]),
    )
    const functions = section(3, vector([[0x00], [0x01]]))
    const exports = section(
      7,
      vector([
        [...name('scan_run'), 0x00, ...unsignedLeb(0)],
        [...name('wcf_signature'), 0x00, ...unsignedLeb(1)],
      ]),
    )
    const code = section(
      10,
      vector([emitKernelBody(plan), emitSignatureBody(plan.signature)]),
    )
    bytes = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ...types,
      ...functions,
      ...exports,
      ...code,
    ])
  } catch {
    return undefined
  }

  if (bytes.length > MAX_KERNEL_MODULE_BYTES) return undefined
  return { ...plan, bytes }
}

/** Identity fragment mixed into the search setup and checkpoint key. */
export function searchKernelIdentity(request: WebSearchRequest): string {
  return searchKernelPlan(request)?.identity ?? 'none'
}
