import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const wasmDirectory = fileURLToPath(new URL('../src/wasm/', import.meta.url))
const zig = process.env.WCF_ZIG ?? 'zig'
const expectedZigVersion = '0.15.1'
const version = spawnSync(zig, ['version'], { encoding: 'utf8' })
if (version.status !== 0) {
  throw new Error(
    `Unable to run Zig via ${JSON.stringify(zig)}. Set WCF_ZIG to the Zig ${expectedZigVersion} executable.`,
  )
}
if (version.stdout.trim() !== expectedZigVersion) {
  throw new Error(
    `Expected Zig ${expectedZigVersion}, received ${version.stdout.trim() || 'an unknown version'}.`,
  )
}

const commonArguments = [
  'cc',
  '-target',
  'wasm32-freestanding',
  '-O3',
  '-nostdlib',
  '-Wl,--no-entry',
  '-Wl,--strip-all',
]
const builds = [
  { output: 'coords_search.wasm' },
  { output: 'coords_search_vanilla_1_exact.wasm', mode: 0 },
  { output: 'coords_search_vanilla_2_exact.wasm', mode: 1 },
  { output: 'coords_search_vanilla_3_exact.wasm', mode: 2 },
  { output: 'coords_search_sodium_1_exact.wasm', mode: 3 },
  { output: 'coords_search_sodium_2_exact.wasm', mode: 4 },
]

for (const build of builds) {
  const definitions = build.mode === undefined
    ? []
    : [
        `-DSEARCH_FIXED_MODE=${build.mode}`,
        '-DSEARCH_FIXED_MAX_BAD_BLOCKS=0',
      ]
  const result = spawnSync(
    zig,
    [
      ...commonArguments,
      ...definitions,
      '-o',
      build.output,
      'coords_search.c',
    ],
    { cwd: wasmDirectory, stdio: 'inherit' },
  )
  if (result.status !== 0) {
    throw new Error(`Failed to build ${build.output}.`)
  }
}

console.log(`Built ${builds.length} scanner modules with Zig ${expectedZigVersion}.`)
