import { performance } from 'node:perf_hooks'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { unzipSync } from 'fflate'

const binaryPath = process.argv[2] ?? 'src/wasm/coords_search.wasm'
const sampleMilliseconds = Number(process.argv[3] ?? 5_000)
const repeatCount = Number(process.argv[4] ?? 3)
const warmupMilliseconds = 1_500
const batchSize = 1_000_000

if (!Number.isFinite(sampleMilliseconds) || sampleMilliseconds <= 0) {
  throw new Error('Sample duration must be a positive number of milliseconds.')
}
if (!Number.isInteger(repeatCount) || repeatCount <= 0) {
  throw new Error('Repeat count must be a positive integer.')
}

const exampleArchive = unzipSync(
  new Uint8Array(await readFile('public/examples/doughnut-smp-hard-.wcf')),
)
const document = JSON.parse(new TextDecoder().decode(exampleArchive['project.json']))
const anchor = document.scene.faces.find(
  (face) => face.id === document.anchorFaceId,
)?.blockCoordinate
if (!anchor) throw new Error('The benchmark project has no anchor face.')

function mapLocalOffsetToWorld(offset, axisMapping) {
  const world = { x: 0, y: 0, z: 0 }
  for (const [localAxis, value] of Object.entries(offset)) {
    const assignment = axisMapping[localAxis]
    const worldAxis = assignment[0]
    const sign = assignment[1] === '+' ? 1 : -1
    world[worldAxis] = value * sign
  }
  return world
}

const filters = document.evidence
  .filter(
    (entry) =>
      entry.reviewStatus === 'confirmed' &&
      Number.isInteger(entry.selectedVariant),
  )
  .map((entry) => ({
    ...mapLocalOffsetToWorld(
      {
        a: entry.latticeCoordinate.x - anchor.x,
        b: entry.latticeCoordinate.y - anchor.y,
        c: entry.latticeCoordinate.z - anchor.z,
      },
      document.scene.axisMapping,
    ),
    rotation: entry.selectedVariant,
    visibleMask: entry.stateCount === 2 ? 1 : 3,
  }))
  .sort((left, right) => right.visibleMask - left.visibleMask)

if (filters.length !== 40) {
  throw new Error(`Expected 40 benchmark filters, received ${filters.length}.`)
}

const binary = binaryPath.startsWith('git:')
  ? execFileSync('git', [
      'show',
      `${binaryPath.slice('git:'.length)}:src/wasm/coords_search.wasm`,
    ])
  : await readFile(binaryPath)

async function configureScanner() {
  const { instance } = await WebAssembly.instantiate(binary)
  const scanner = instance.exports
  const configured = scanner.search_configure(
    2,
    1,
    -225_000,
    225_000,
    -60,
    0,
    -225_000,
    225_000,
    0,
    filters.length,
    1,
  )
  if (configured !== 0 || scanner.search_set_direction(0, 0) !== 0) {
    throw new Error('Could not configure the benchmark scanner.')
  }
  filters.forEach((filter, index) => {
    if (
      scanner.search_set_filter(
        index,
        filter.x,
        filter.y,
        filter.z,
        filter.rotation,
        filter.visibleMask,
      ) !== 0
    ) {
      throw new Error(`Could not configure benchmark filter ${index}.`)
    }
  })
  return scanner
}

async function runSample() {
  const scanner = await configureScanner()
  const warmupStartedAt = performance.now()
  while (performance.now() - warmupStartedAt < warmupMilliseconds) {
    scanner.search_scan_batch(batchSize, 0)
  }

  const baseline = scanner.search_get_processed()
  const startedAt = performance.now()
  while (performance.now() - startedAt < sampleMilliseconds) {
    scanner.search_scan_batch(batchSize, 0)
  }
  const elapsedMilliseconds = performance.now() - startedAt
  const processed = scanner.search_get_processed() - baseline
  return (Number(processed) * 1_000) / elapsedMilliseconds
}

const samples = []
for (let index = 0; index < repeatCount; index += 1) {
  const checksPerSecond = await runSample()
  samples.push(checksPerSecond)
  console.log(`sample ${index + 1}: ${(checksPerSecond / 1_000_000).toFixed(2)}M positions/sec`)
}

const ordered = [...samples].sort((left, right) => left - right)
const median = ordered[Math.floor(ordered.length / 2)]
console.log(`median: ${(median / 1_000_000).toFixed(2)}M positions/sec`)
