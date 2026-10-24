import { strFromU8, unzipSync } from 'fflate'
import { z } from 'zod'
import { blockProfiles } from './references'
import offsetModels from './offsetModels.json'
import programmerArt from './programmerArt.json'
import type { ResourcePackSettings, TextureAnimation } from './types'

export const grassColorMapSource = '/minecraft/textures/colormap/grass.png'
const programmerArtAssets = new Set(programmerArt)
const maxTextureBytes = 8 * 1024 * 1024
const maxPackBytes = 32 * 1024 * 1024

/** Both bundled texture directories refer to the same Minecraft asset namespace. */
export function textureAssetPath(source: string): string {
  return source.replace(/^\/minecraft\/offsets\//, 'textures/')
    .replace(/^\/minecraft\//, '')
}

const supportedAssets = new Set([
  ...blockProfiles.flatMap((profile) => Object.values(profile.referenceTextures).map(textureAssetPath)),
  ...Object.values(offsetModels).flatMap((profile) => profile.variants.flatMap((variant) =>
    variant.parts.flatMap((part) => part.elements.flatMap((element) =>
      Object.values(element.faces).map((face) => textureAssetPath(face.texture)),
    )),
  )),
  textureAssetPath(grassColorMapSource),
])

const animationSchema = z.object({
  frameCount: z.number().int().min(1).max(65536),
  frameTime: z.number().int().min(1).max(1000000),
  interpolate: z.boolean(),
  frames: z.array(z.object({
    index: z.number().int().nonnegative().max(65535),
    time: z.number().int().min(1).max(1000000),
  })).min(1).max(65536).optional(),
  frameWidth: z.number().int().min(1).max(4096).optional(),
  frameHeight: z.number().int().min(1).max(4096).optional(),
  columns: z.number().int().min(1).max(4096).optional(),
}).refine((animation) => animation.frames?.every((frame) => frame.index < animation.frameCount) ?? true)

const assetKeySchema = z.string().refine((key) => supportedAssets.has(key), 'Unsupported texture asset.')
export const resourcePackSchema = z.object({
  base: z.enum(['vanilla', 'programmer-art']),
  custom: z.object({
    name: z.string().min(1).max(256),
    textures: z.record(assetKeySchema, z.string().max(Math.ceil(maxTextureBytes * 4 / 3) + 32)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)),
    animations: z.record(assetKeySchema, animationSchema),
  }).refine((pack) => Object.values(pack.textures).reduce((sum, source) => sum + source.length, 0)
    <= Math.ceil(maxPackBytes * 4 / 3) + 4096, 'Resource pack textures exceed 32 MiB.')
    .refine((pack) => Object.keys(pack.animations).every((key) => key in pack.textures),
      'Animation metadata requires a matching texture.').optional(),
})

export function resolveTextureSource(source: string, pack?: ResourcePackSettings): string {
  const asset = textureAssetPath(source)
  return pack?.custom?.textures[asset] ?? (
    pack?.base === 'programmer-art' && programmerArtAssets.has(asset)
      ? `/minecraft/programmer-art/${asset}` : source
  )
}

// Pre-flattening (1.12 and earlier) names for the supported texture set.
const legacyNames: Record<string, string> = {
  grass_top: 'grass_block_top', grass_path_top: 'dirt_path_top', waterlily: 'lily_pad',
  grass: 'short_grass', tallgrass: 'short_grass', fern: 'fern',
  flower_dandelion: 'dandelion', flower_rose: 'poppy', flower_blue_orchid: 'blue_orchid',
  flower_allium: 'allium', flower_houstonia: 'azure_bluet', flower_oxeye_daisy: 'oxeye_daisy',
  flower_tulip_red: 'red_tulip', flower_tulip_orange: 'orange_tulip',
  flower_tulip_white: 'white_tulip', flower_tulip_pink: 'pink_tulip',
  double_plant_grass_bottom: 'tall_grass_bottom', double_plant_grass_top: 'tall_grass_top',
  double_plant_fern_bottom: 'large_fern_bottom', double_plant_fern_top: 'large_fern_top',
  double_plant_sunflower_bottom: 'sunflower_bottom', double_plant_sunflower_top: 'sunflower_top',
  double_plant_sunflower_front: 'sunflower_front', double_plant_sunflower_back: 'sunflower_back',
  double_plant_syringa_bottom: 'lilac_bottom', double_plant_syringa_top: 'lilac_top',
  double_plant_rose_bottom: 'rose_bush_bottom', double_plant_rose_top: 'rose_bush_top',
  double_plant_paeonia_bottom: 'peony_bottom', double_plant_paeonia_top: 'peony_top',
}

function canonicalAsset(path: string): string {
  const normalized = path.replace(/^textures\/blocks\//, 'textures/block/')
  if (!normalized.startsWith('textures/block/')) return normalized
  const name = normalized.slice('textures/block/'.length).replace(/\.png$/, '')
  const powder = /^concrete_powder_(.+)$/.exec(name)
  const renamed = powder ? `${powder[1] === 'silver' ? 'light_gray' : powder[1]}_concrete_powder`
    : legacyNames[name] ?? name
  return `textures/block/${renamed}.png`
}

/** Read dimensions without decoding pixels or allocating an unbounded image. */
function pngDimensions(bytes: Uint8Array): [number, number] {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte) ||
    strFromU8(bytes.subarray(12, 16)) !== 'IHDR') throw new Error('Invalid PNG texture.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16), height = view.getUint32(20)
  if (!width || !height || width > 4096 || height > 4096) {
    throw new Error('Resource pack textures must be at most 4096 × 4096 pixels.')
  }
  return [width, height]
}

function readAnimation(bytes: Uint8Array, width: number, height: number): TextureAnimation | undefined {
  const metadata = JSON.parse(strFromU8(bytes)).animation
  if (!metadata) return undefined
  const frameWidth = metadata.width ?? (metadata.height ? width : Math.min(width, height))
  const frameHeight = metadata.height ?? (metadata.width ? height : Math.min(width, height))
  if (!Number.isInteger(frameWidth) || frameWidth < 1 || !Number.isInteger(frameHeight) ||
    frameHeight < 1 || width % frameWidth || height % frameHeight) {
    throw new Error('Invalid animation frame dimensions.')
  }
  const frameTime = metadata.frametime ?? 1
  return animationSchema.parse({
    frameCount: (width / frameWidth) * (height / frameHeight),
    frameTime, interpolate: metadata.interpolate ?? false,
    frameWidth, frameHeight, columns: width / frameWidth,
    frames: metadata.frames?.map((frame: number | { index: number; time?: number }) =>
      typeof frame === 'number' ? { index: frame, time: frameTime }
        : { index: frame.index, time: frame.time ?? frameTime }),
  })
}

/** Import only supported PNGs and their animation metadata; nothing leaves the device. */
export async function importResourcePack(file: File): Promise<NonNullable<ResourcePackSettings['custom']>> {
  if (file.size > 128 * 1024 * 1024) throw new Error('Resource pack ZIPs must be at most 128 MiB.')
  let total = 0
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
    const match = /^(?:[^/]+\/)?assets\/minecraft\/(textures\/(?:blocks?\/|colormap\/).+\.png)(\.mcmeta)?$/.exec(entry.name)
    if (!match || !supportedAssets.has(canonicalAsset(match[1]))) return false
    if (entry.originalSize > (match[2] ? 256 * 1024 : maxTextureBytes) ||
      (total += entry.originalSize) > maxPackBytes) throw new Error('Supported resource pack assets exceed the 32 MiB limit.')
    return true
  } })
  const textures: Record<string, string> = {}
  const animations: Record<string, TextureAnimation> = {}
  // Modern names win when a ZIP also contains their legacy aliases.
  const paths = Object.keys(files).filter((path) => path.endsWith('.png')).sort((a, b) =>
    Number(a.includes('/textures/block/')) - Number(b.includes('/textures/block/')),
  )
  for (const path of paths) {
    const rawAsset = path.slice(path.indexOf('assets/minecraft/') + 'assets/minecraft/'.length)
    const asset = canonicalAsset(rawAsset)
    try {
      const bytes = files[path]
      const [width, height] = pngDimensions(bytes)
      // Chunking avoids argument limits for HD textures.
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      }
      textures[asset] = `data:image/png;base64,${btoa(binary)}`
      delete animations[asset]
      const metadata = files[`${path}.mcmeta`]
      const animation = metadata ? readAnimation(metadata, width, height) : undefined
      if (animation) animations[asset] = animation
    } catch {
      throw new Error(`Unable to import ${rawAsset}: invalid PNG or animation metadata.`)
    }
  }
  if (Object.keys(textures).length === 0) throw new Error('No supported Minecraft block textures found in this ZIP.')
  return resourcePackSchema.parse({ base: 'vanilla', custom: {
    name: file.name.replace(/\.zip$/i, '').slice(0, 256) || 'Custom pack', textures, animations,
  } }).custom!
}
