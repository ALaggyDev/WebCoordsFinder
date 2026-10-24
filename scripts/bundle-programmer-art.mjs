// Copy only textures used by the workbench from Mojang's local asset ZIP.
// Usage: node scripts/bundle-programmer-art.mjs <programmer_art.zip or asset object>
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { unzipSync } from 'fflate'

const files = unzipSync(readFileSync(process.argv[2]))
const assets = new Set([
  ...readdirSync('public/minecraft/textures/block').map((name) => `textures/block/${name}`),
  ...readdirSync('public/minecraft/offsets/block').map((name) => `textures/block/${name}`),
  'textures/colormap/grass.png',
])
const bundled = []
for (const asset of [...assets].sort()) {
  const bytes = files[`assets/minecraft/${asset}`]
  if (!bytes) continue // Programmer's Art inherits newer blocks from vanilla.
  const target = `public/minecraft/programmer-art/${asset}`
  mkdirSync(target.slice(0, target.lastIndexOf('/')), { recursive: true })
  writeFileSync(target, bytes)
  bundled.push(asset)
}
writeFileSync('src/domain/programmerArt.json', `${JSON.stringify(bundled, null, 2)}\n`)
console.log(`Bundled ${bundled.length} Programmer's Art textures.`)
