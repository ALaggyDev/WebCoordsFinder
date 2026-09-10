// Rebuild with: node scripts/bundle-offset-models.mjs <extracted assets directory>
// Resolves vanilla model inheritance and retains every blockstate/weighted model.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) throw new Error('Pass the extracted Minecraft assets directory.')
const ids =
  `mangrove_propagule short_grass fern short_dry_grass tall_dry_grass tall_seagrass dandelion golden_dandelion torchflower poppy blue_orchid allium azure_bluet red_tulip orange_tulip white_tulip pink_tulip oxeye_daisy cornflower wither_rose lily_of_the_valley sunflower lilac rose_bush peony tall_grass large_fern pitcher_plant bamboo_sapling bamboo warped_roots nether_sprouts crimson_roots pointed_dripstone small_dripleaf hanging_roots open_eyeblossom closed_eyeblossom`.split(
    ' ',
  )
const xyz = new Set(
  'short_grass fern short_dry_grass tall_dry_grass small_dripleaf'.split(' '),
)
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const strip = (path) => path.replace(/^minecraft:/, '')
function model(path) {
  const own = read(`models/${strip(path)}.json`)
  const parent = own.parent ? model(own.parent) : {}
  return {
    ...parent,
    ...own,
    textures: { ...parent.textures, ...own.textures },
  }
}
const output = {}
const textures = new Set()
for (const id of ids) {
  if (!existsSync(join(root, `blockstates/${id}.json`))) {
    console.warn(
      `Missing assets for ${id}; omitted rather than substituting another model.`,
    )
    continue
  }
  const state = read(`blockstates/${id}.json`)
  const choices = []
  if (state.variants) {
    const variants = Object.entries(state.variants)
    const parsed = variants.map(([label, value]) => ({
      label,
      properties: Object.fromEntries(
        label
          .split(',')
          .filter(Boolean)
          .map((property) => property.split('=')),
      ),
      entries: Array.isArray(value) ? value : [value],
    }))
    const hasTwoBlockHalves =
      parsed.some(({ properties }) => properties.half === 'lower') &&
      parsed.some(({ properties }) => properties.half === 'upper')

    if (hasTwoBlockHalves) {
      // A double plant is one visual observation. Pair block-state halves and
      // retain the upper model one block above the owning (lower) position.
      for (const lower of parsed.filter(
        ({ properties }) => properties.half === 'lower',
      )) {
        const shared = Object.fromEntries(
          Object.entries(lower.properties).filter(([key]) => key !== 'half'),
        )
        const upper = parsed.find(
          ({ properties }) =>
            properties.half === 'upper' &&
            JSON.stringify(
              Object.fromEntries(
                Object.entries(properties).filter(([key]) => key !== 'half'),
              ),
            ) === JSON.stringify(shared),
        )
        if (!upper) throw new Error(`Missing upper half for ${id}: ${lower.label}`)
        for (const [lowerIndex, lowerEntry] of lower.entries.entries())
          for (const [upperIndex, upperEntry] of upper.entries.entries()) {
            const weighted = lower.entries.length * upper.entries.length > 1
            choices.push({
              label: `${Object.entries(shared)
                .map(([key, value]) => `${key}=${value}`)
                .join(',') || 'default'}${weighted ? ` · models ${lowerIndex + 1}/${upperIndex + 1}` : ''}`,
              parts: [
                { ...lowerEntry, blockY: 0 },
                { ...upperEntry, blockY: 1 },
              ],
            })
          }
      }
    } else {
      for (const { label, entries } of parsed)
        for (const [index, entry] of entries.entries())
          choices.push({
            label: `${label || 'default'}${entries.length > 1 ? ` · model ${index + 1}` : ''}`,
            parts: [{ ...entry, blockY: 0 }],
          })
    }
  } else {
    // Enumerate multipart states, then their weighted alternatives, including
    // leaves and stems together (not separate incomplete bamboo models).
    const properties = {}
    function collect(when) {
      for (const [key, value] of Object.entries(when ?? {})) {
        if (key === 'OR' || key === 'AND') value.forEach(collect)
        else
          properties[key] = [
            ...new Set([
              ...(properties[key] ?? []),
              ...String(value).split('|'),
            ]),
          ]
      }
    }
    state.multipart.forEach((part) => collect(part.when))
    // No multipart condition mentions leaves=none: it is the stem-only state.
    if (id === 'bamboo') properties.leaves.unshift('none')
    let states = [{}]
    for (const [key, values] of Object.entries(properties))
      states = states.flatMap((s) => values.map((v) => ({ ...s, [key]: v })))
    function matches(when, s) {
      return Object.entries(when ?? {}).every(([key, value]) =>
        key === 'OR'
          ? value.some((w) => matches(w, s))
          : key === 'AND'
            ? value.every((w) => matches(w, s))
            : String(value).split('|').includes(s[key]),
      )
    }
    for (const s of states) {
      let combinations = [[]]
      for (const part of state.multipart.filter((p) => matches(p.when, s)))
        combinations = combinations.flatMap((c) =>
          (Array.isArray(part.apply) ? part.apply : [part.apply]).map((p) => [
            ...c,
            p,
          ]),
        )
      combinations.forEach((parts, i) =>
        choices.push({
          label: `${Object.entries(s)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')} · model ${i + 1}`,
          parts,
        }),
      )
    }
  }
  output[id] = {
    label: id
      .split('_')
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(' '),
    type: xyz.has(id) ? 'XYZ' : 'XZ',
    horizontal: id === 'pointed_dripstone' ? 0.125 : 0.25,
    vertical: xyz.has(id) ? (id === 'small_dripleaf' ? 0.1 : 0.2) : 0,
    variants: choices.map(({ label, parts }) => {
      const resolvedParts = parts.map((part) => {
        const resolved = model(part.model)
        const yShift = (part.blockY ?? 0) * 16
        const elements = resolved.elements.map((element) => ({
          ...element,
          from: [element.from[0], element.from[1] + yShift, element.from[2]],
          to: [element.to[0], element.to[1] + yShift, element.to[2]],
          ...(element.rotation && {
            rotation: {
              ...element.rotation,
              origin: [
                element.rotation.origin[0],
                element.rotation.origin[1] + yShift,
                element.rotation.origin[2],
              ],
            },
          }),
          faces: Object.fromEntries(
            Object.entries(element.faces).map(([side, face]) => {
              let texture = face.texture
              while (texture.startsWith('#'))
                texture = resolved.textures[texture.slice(1)]
              texture = strip(texture)
              textures.add(texture)
              return [
                side,
                { ...face, texture: `/minecraft/offsets/${texture}.png` },
              ]
            }),
          ),
        }))
        return {
          x: part.x ?? 0,
          y: part.y ?? 0,
          elements,
        }
      })
      // Lower and upper blockstates normally use the same block rotation. Once
      // their element coordinates share one space, collapse them into one part.
      const merged = new Map()
      for (const part of resolvedParts) {
        const key = `${part.x}:${part.y}`
        const existing = merged.get(key)
        if (existing) existing.elements.push(...part.elements)
        else merged.set(key, part)
      }
      return { label, parts: [...merged.values()] }
    }),
  }
}
for (const texture of textures) {
  const target = `public/minecraft/offsets/${texture}.png`
  mkdirSync(join(target, '..'), { recursive: true })
  copyFileSync(join(root, `textures/${texture}.png`), target)
}
writeFileSync('src/domain/offsetModels.json', JSON.stringify(output))
console.log(
  `Bundled ${Object.keys(output).length} blocks and ${textures.size} textures.`,
)
