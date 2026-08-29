import type {
  BlockProfile,
  CandidateTransform,
  FaceDirection,
} from './types'

// Reference paths mirror the checked-in Minecraft asset tree. Profiles name
// concrete face textures explicitly so analysis never guesses model lookups.
const textureRoot = '/minecraft/textures/block'

function texture(name: string): string {
  return `${textureRoot}/${name}.png`
}

const quarterTurnTransforms: CandidateTransform[] = [
  'identity',
  'rotate90',
  'rotate180',
  'rotate270',
]
const mirroredTransforms: CandidateTransform[] = [
  'identity',
  'mirrorX',
  'rotate180',
  'mirrorXRotate180',
]
const mirroredSideTransforms: CandidateTransform[] = ['identity', 'mirrorX']

const ordinaryQuarterTurnVariants: BlockProfile['variantTransforms'] = {
  up: quarterTurnTransforms,
  down: ['identity', 'rotate270', 'rotate180', 'rotate90'],
}
const mirroredCubeVariants: BlockProfile['variantTransforms'] = {
  up: mirroredTransforms,
  down: mirroredTransforms,
  north: mirroredSideTransforms,
  south: mirroredSideTransforms,
  east: mirroredSideTransforms,
  west: mirroredSideTransforms,
}
const netherrackVariants: BlockProfile['variantTransforms'] = {
  up: quarterTurnTransforms,
  down: quarterTurnTransforms,
  north: quarterTurnTransforms,
  south: quarterTurnTransforms,
  east: quarterTurnTransforms,
  west: quarterTurnTransforms,
}

function cubeTexture(name: string): Record<FaceDirection, string> {
  const source = texture(name)
  return {
    up: source,
    down: source,
    north: source,
    south: source,
    east: source,
    west: source,
  }
}

function topAndBottomTextures(
  top: string,
  bottom = top,
): Partial<Record<FaceDirection, string>> {
  return {
    up: texture(top),
    down: texture(bottom),
  }
}

const baseProfiles: BlockProfile[] = [
  {
    id: 'stone',
    label: 'Stone',
    family: 'Cave',
    accent: '#9aa3a7',
    compatibleSince: '1.19.3',
    referenceTextures: cubeTexture('stone'),
    variantTransforms: mirroredCubeVariants,
    notes: 'Mirrored model variants; side faces fold to two visible states.',
  },
  {
    id: 'deepslate',
    label: 'Deepslate',
    family: 'Cave',
    accent: '#687176',
    compatibleSince: '1.19.3',
    referenceTextures: {
      ...topAndBottomTextures('deepslate_top'),
      north: texture('deepslate'),
      south: texture('deepslate'),
      east: texture('deepslate'),
      west: texture('deepslate'),
    },
    variantTransforms: mirroredCubeVariants,
    notes: 'Axis-aware mirrored model variants.',
  },
  {
    id: 'bedrock',
    label: 'Bedrock',
    family: 'Cave',
    accent: '#5a6265',
    compatibleSince: '1.19.3',
    referenceTextures: cubeTexture('bedrock'),
    variantTransforms: mirroredCubeVariants,
    notes: 'Mirrored model variants; side faces fold to two states.',
  },
  {
    id: 'sculk',
    label: 'Sculk',
    family: 'Deep dark',
    accent: '#0d5660',
    compatibleSince: '1.19.3',
    referenceTextures: cubeTexture('sculk'),
    variantTransforms: mirroredCubeVariants,
    notes: 'Mirrored model variants; side faces fold to two visible states.',
  },
  {
    id: 'netherrack',
    label: 'Netherrack',
    family: 'Nether',
    accent: '#703a35',
    compatibleSince: '1.19.3',
    referenceTextures: cubeTexture('netherrack'),
    variantTransforms: netherrackVariants,
    notes: 'Correlated 16-model rotations across all six faces. Requires config v2.',
  },
  {
    id: 'dirt',
    label: 'Dirt',
    family: 'Terrain',
    accent: '#896449',
    compatibleSince: '1.19.3',
    referenceTextures: topAndBottomTextures('dirt'),
    variantTransforms: ordinaryQuarterTurnVariants,
    notes: 'Four top/bottom model rotations.',
  },
  {
    id: 'rooted_dirt',
    label: 'Rooted dirt',
    family: 'Terrain',
    accent: '#896449',
    compatibleSince: '1.19.3',
    referenceTextures: topAndBottomTextures('rooted_dirt'),
    variantTransforms: ordinaryQuarterTurnVariants,
    notes: 'Four top/bottom model rotations.',
  },
  {
    id: 'lily_pad',
    label: 'Lily pad',
    family: 'Plants',
    accent: '#4f8b43',
    compatibleSince: '1.19.3',
    referenceTextures: topAndBottomTextures('lily_pad'),
    variantTransforms: ordinaryQuarterTurnVariants,
    notes: 'Four rotations of the flat top/bottom model.',
    settings: { grassTint: true },
  },
  {
    id: 'grass_block',
    label: 'Grass block',
    family: 'Terrain',
    accent: '#6da95b',
    compatibleSince: '1.19.3',
    referenceTextures: topAndBottomTextures('grass_block_top', 'dirt'),
    variantTransforms: ordinaryQuarterTurnVariants,
    notes: 'Non-snowy top and bottom faces only.',
    settings: { grassTint: true },
  },
  {
    id: 'dirt_path',
    label: 'Dirt path',
    family: 'Terrain',
    accent: '#987653',
    compatibleSince: '1.19.3',
    referenceTextures: topAndBottomTextures('dirt_path_top', 'dirt'),
    variantTransforms: ordinaryQuarterTurnVariants,
    notes: 'Top and bottom faces only.',
  },
  {
    id: 'podzol',
    label: 'Podzol',
    family: 'Terrain',
    accent: '#76604a',
    compatibleSince: '1.19.3',
    referenceTextures: topAndBottomTextures('podzol_top', 'dirt'),
    variantTransforms: ordinaryQuarterTurnVariants,
    notes: 'Top and bottom faces only.',
  },
  {
    id: 'mycelium',
    label: 'Mycelium',
    family: 'Terrain',
    accent: '#8e788d',
    compatibleSince: '1.19.3',
    referenceTextures: topAndBottomTextures('mycelium_top', 'dirt'),
    variantTransforms: ordinaryQuarterTurnVariants,
    notes: 'Top and bottom faces only.',
  },
  {
    id: 'sand',
    label: 'Sand',
    family: 'Sediment',
    accent: '#d8cc91',
    compatibleSince: '1.19.3',
    referenceTextures: topAndBottomTextures('sand'),
    variantTransforms: ordinaryQuarterTurnVariants,
    notes: 'Top and bottom faces only.',
  },
  {
    id: 'red_sand',
    label: 'Red sand',
    family: 'Sediment',
    accent: '#b96f43',
    compatibleSince: '1.19.3',
    referenceTextures: topAndBottomTextures('red_sand'),
    variantTransforms: ordinaryQuarterTurnVariants,
    notes: 'Top and bottom faces only.',
  },
]

const concretePowderColors = [
  { id: 'white', label: 'White', accent: '#dedfd9' },
  { id: 'orange', label: 'Orange', accent: '#e38329' },
  { id: 'magenta', label: 'Magenta', accent: '#c354cd' },
  { id: 'light_blue', label: 'Light blue', accent: '#74b6d5' },
  { id: 'yellow', label: 'Yellow', accent: '#e8c736' },
  { id: 'lime', label: 'Lime', accent: '#76b852' },
  { id: 'pink', label: 'Pink', accent: '#d98ca1' },
  { id: 'gray', label: 'Gray', accent: '#4d5254' },
  { id: 'light_gray', label: 'Light gray', accent: '#9b9b91' },
  { id: 'cyan', label: 'Cyan', accent: '#168991' },
  { id: 'purple', label: 'Purple', accent: '#6e3a9b' },
  { id: 'blue', label: 'Blue', accent: '#3c47a5' },
  { id: 'brown', label: 'Brown', accent: '#7b4a2f' },
  { id: 'green', label: 'Green', accent: '#4f641f' },
  { id: 'red', label: 'Red', accent: '#a83632' },
  { id: 'black', label: 'Black', accent: '#1c1e20' },
] as const

const concretePowderProfiles: BlockProfile[] = concretePowderColors.map((color) => {
  const blockId = `${color.id}_concrete_powder`
  return {
    id: blockId,
    label: `${color.label} concrete powder`,
    family: 'Built',
    accent: color.accent,
    compatibleSince: '1.19.3',
    referenceTextures: topAndBottomTextures(blockId),
    variantTransforms: ordinaryQuarterTurnVariants,
    notes: 'Four top/bottom model rotations.',
  }
})

export const blockProfiles: BlockProfile[] = [
  ...baseProfiles,
  ...concretePowderProfiles,
]

export const blockProfileMap = new Map(blockProfiles.map((profile) => [profile.id, profile]))

export function statesForFace(blockId: string, face: FaceDirection): 2 | 4 | undefined {
  const count = variantTransformsForFace(blockId, face).length
  return count === 2 || count === 4 ? count : undefined
}

export function sharedStatesForFaces(
  blockId: string,
  faces: FaceDirection[],
): 2 | 4 | undefined {
  // Partial compass mappings may leave several world faces possible. Batch
  // editing is safe only when every completion has the same state cardinality.
  const states = faces.map((face) => statesForFace(blockId, face))
  if (
    states.length === 0 ||
    states.some((state) => state === undefined) ||
    new Set(states).size !== 1
  ) {
    return undefined
  }
  return states[0]
}

export function referenceTextureForFace(
  blockId: string,
  face: FaceDirection,
): string | undefined {
  return blockProfileMap.get(blockId)?.referenceTextures[face]
}

export function variantTransformsForFace(
  blockId: string,
  face: FaceDirection | undefined,
): CandidateTransform[] {
  if (!face) return []
  return blockProfileMap.get(blockId)?.variantTransforms[face] ?? []
}

export function sharedVariantTransformsForFaces(
  blockId: string,
  faces: FaceDirection[],
): CandidateTransform[] | undefined {
  const variants = faces.map((face) => variantTransformsForFace(blockId, face))
  if (variants.length === 0 || variants.some((entry) => entry.length === 0)) {
    return undefined
  }
  const serialized = variants.map((entry) => entry.join(':'))
  return new Set(serialized).size === 1 ? variants[0] : undefined
}

export function sharedReferenceTextureForFaces(
  blockId: string,
  faces: FaceDirection[],
): string | undefined {
  // An unresolved direction can still be analyzed when every possible face
  // resolves to the exact same bundled texture.
  const references = faces.map((face) =>
    referenceTextureForFace(blockId, face),
  )
  if (
    references.length === 0 ||
    references.some((reference) => reference === undefined) ||
    new Set(references).size !== 1
  ) {
    return undefined
  }
  return references[0]
}
