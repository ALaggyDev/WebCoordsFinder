// Builds public/minecraft/textures/direction/block_face_textures.json from the
// vanilla block models (misode/mcmeta, branch 1.21.4-assets).
//
// Usage: node scripts/generate-direction-textures.mjs <path to assets/minecraft/models/block>
//
// A texture is listed for "top"/"bottom" only when it is the up/down face of a
// full 16x16x16 cube model, so plants, doors, panes, slabs, etc. never appear
// and single-texture blocks (ores, metal blocks...) are included.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) throw new Error('Pass the models/block directory')

const cache = new Map()
const load = (name) => {
  if (!cache.has(name)) {
    try {
      cache.set(name, JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')))
    } catch {
      cache.set(name, null)
    }
  }
  return cache.get(name)
}

function resolve(name) {
  const textures = {}
  let elements
  let current = name
  const chain = []
  while (current) {
    const model = load(current)
    if (!model) break
    chain.push(model)
    current = model.parent?.replace(/^minecraft:/, '').replace(/^block\//, '')
    if (current?.startsWith('builtin/')) break
  }
  // Child values override parent values.
  for (const model of [...chain].reverse()) Object.assign(textures, model.textures ?? {})
  for (const model of chain) {
    if (model.elements) {
      elements = model.elements
      break
    }
  }
  return { textures, elements }
}

const lookup = (textures, value) => {
  let current = value
  for (let i = 0; current?.startsWith('#') && i < 10; i += 1) current = textures[current.slice(1)]
  return current?.replace(/^minecraft:/, '').replace(/^block\//, '')
}

const top = new Set()
const bottom = new Set()
// Textures used on the sides of a block whose up/down face differs (log bark,
// furnace fronts...). They never identify direction, so they are removed below.
const sideTextures = new Set()
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.json')) continue
  const name = file.slice(0, -5)
  if (name.endsWith('_horizontal') || name.includes('inventory') || name.includes('template')) continue
  const { textures, elements } = resolve(name)
  if (!elements || elements.length !== 1) continue
  const [element] = elements
  const full =
    element.from?.every((value) => value === 0) && element.to?.every((value) => value === 16)
  if (!full || !element.faces?.up || !element.faces?.down) continue
  const up = lookup(textures, element.faces.up.texture)
  const down = lookup(textures, element.faces.down.texture)
  for (const side of ['north', 'south', 'east', 'west']) {
    const sideTexture = lookup(textures, element.faces[side]?.texture)
    if (sideTexture && sideTexture !== up && sideTexture !== down) {
      sideTextures.add(`${sideTexture}.png`)
    }
  }
  if (up && !up.includes('/') && !up.startsWith('#')) top.add(`${up}.png`)
  if (down && !down.includes('/') && !down.startsWith('#')) bottom.add(`${down}.png`)
}

const sorted = (set) => [...set].filter((name) => !sideTextures.has(name) && !/(^|_)(side\d*|front|front_vertical|back)\.png$/.test(name)).sort((a, b) => a.localeCompare(b))
writeFileSync(
  new URL('../public/minecraft/textures/direction/block_face_textures.json', import.meta.url),
  `${JSON.stringify({ top: sorted(top), bottom: sorted(bottom) })}\n`,
)
console.log(`top: ${sorted(top).length}, bottom: ${sorted(bottom).length}`)
