import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

// Fixed evidence and ordinal ranges make before/after WASM timings comparable.
// By default wide searches sample one shard; --full measures the whole world.
const wasmPath = workerData?.wasmPath ?? process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'src/wasm/coords_search.wasm'
const positions = [[0, 0], [1, 0], [0, 1], [3, -2], [-4, 1], [2, 5], [7, 3]]
function masks(dx, dz, clipped, xyz) {
  const x = BigInt(12541022 + dx), z = BigInt(10457150 + dz)
  const input = BigInt.asIntN(32, x * 3129871n) ^ (z * 116129781n)
  const seed = input * input * 42317861n + input * 11n
  const horizontal = (n) => clipped && n < 4 ? 15 : clipped && n > 11 ? 0xf000 : 1 << n
  return [horizontal(Number((seed >> 16n) & 15n)), xyz ? 1 << Number((seed >> 20n) & 15n) : 65535,
    horizontal(Number((seed >> 24n) & 15n))]
}

async function scan({ bound, bits, clipped, xyz, start = 0n, end }) {
  const module = (await WebAssembly.instantiate(readFileSync(wasmPath))).instance.exports
  module.search_configure(2, 0, -bound, bound, 0, 0, -bound, bound, 0, 0, 1)
  module.search_set_direction(0, 0, 0, 0)
  module.search_configure_offsets(bits)
  positions.forEach(([dx, dz], index) => module.search_set_offset(0, index, dx, dz, ...masks(dx, dz, clipped, xyz)))
  end ??= bits === 26 ? module.search_get_total() / 16384n : module.search_get_total()
  module.search_restore(start, 0n)
  module.search_set_range_end(end)
  let operations = 0
  const startedAt = performance.now()
  while (!module.search_is_finished()) operations += module.search_scan_batch(100000, 0)
  return { milliseconds: Math.round(performance.now() - startedAt), operations,
    covered: (module.search_get_processed() - start).toString(), matches: module.search_get_match_count().toString() }
}

if (!isMainThread) {
  parentPort.postMessage(await scan(workerData))
} else if (process.argv.includes('--full')) {
  const workerCount = Number(process.argv.find((arg) => arg.startsWith('--workers='))?.split('=')[1] ?? 8)
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 32) throw new Error('Workers must be 1..32')
  const total = 1n << 52n
  const startedAt = performance.now()
  const results = await Promise.all(Array.from({ length: workerCount }, (_, index) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: {
      wasmPath, bound: 30000000, bits: 26, start: total * BigInt(index) / BigInt(workerCount),
      end: total * BigInt(index + 1) / BigInt(workerCount),
    } })
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', (code) => { if (code) reject(new Error(`Worker exited ${code}`)) })
  })))
  console.log(JSON.stringify({ label: 'full world, 7 XZ offsets, one direction', workerCount,
    milliseconds: Math.round(performance.now() - startedAt),
    operations: results.reduce((sum, result) => sum + result.operations, 0),
    covered: results.reduce((sum, result) => sum + BigInt(result.covered), 0n).toString(),
    matches: results.reduce((sum, result) => sum + BigInt(result.matches), 0n).toString() }))
} else {
  for (const config of [
    { label: 'default bounds, 7 XZ offsets', bound: 2000, bits: 12 },
    { label: 'world bounds sample, 7 XZ offsets', bound: 30000000, bits: 26 },
    { label: 'world bounds sample, 7 XYZ offsets', bound: 30000000, bits: 26, xyz: true },
    { label: 'world bounds sample, 7 clipped XZ offsets', bound: 30000000, bits: 26, clipped: true },
  ]) console.log(JSON.stringify({ label: config.label, ...await scan(config) }))
}
