import type { BlockProfile, FaceDirection } from './types'

const textureRoot = '/textures/minecraft/1.21.11/block'

function texture(name: string): string {
  return `${textureRoot}/${name}.png`
}

const rotationalFaces: Partial<Record<FaceDirection, 4>> = { up: 4, down: 4 }
const mirroredCubeFaces: Partial<Record<FaceDirection, 2 | 4>> = {
  up: 4,
  down: 4,
  north: 2,
  south: 2,
  east: 2,
  west: 2,
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
    faceStates: mirroredCubeFaces,
    referenceTextures: cubeTexture('stone'),
    transforms: ['identity', 'mirrorX', 'rotate180', 'mirrorXRotate180'],
    notes: 'Mirrored model variants; side faces fold to two visible states.',
  },
  {
    id: 'deepslate',
    label: 'Deepslate',
    family: 'Cave',
    accent: '#687176',
    compatibleSince: '1.19.3',
    faceStates: mirroredCubeFaces,
    referenceTextures: {
      ...topAndBottomTextures('deepslate_top'),
      north: texture('deepslate'),
      south: texture('deepslate'),
      east: texture('deepslate'),
      west: texture('deepslate'),
    },
    transforms: ['identity', 'mirrorX', 'rotate180', 'mirrorXRotate180'],
    notes: 'Axis-aware mirrored model variants.',
  },
  {
    id: 'bedrock',
    label: 'Bedrock',
    family: 'Cave',
    accent: '#5a6265',
    compatibleSince: '1.19.3',
    faceStates: mirroredCubeFaces,
    referenceTextures: cubeTexture('bedrock'),
    transforms: ['identity', 'mirrorX', 'rotate180', 'mirrorXRotate180'],
    notes: 'Mirrored model variants; side faces fold to two states.',
  },
  {
    id: 'dirt',
    label: 'Dirt',
    family: 'Terrain',
    accent: '#896449',
    compatibleSince: '1.19.3',
    faceStates: rotationalFaces,
    referenceTextures: topAndBottomTextures('dirt'),
    transforms: ['identity', 'rotate90', 'rotate180', 'rotate270'],
    notes: 'Four top/bottom model rotations.',
  },
  {
    id: 'grass_block',
    label: 'Grass block',
    family: 'Terrain',
    accent: '#6da95b',
    compatibleSince: '1.19.3',
    faceStates: rotationalFaces,
    referenceTextures: topAndBottomTextures('grass_block_top', 'dirt'),
    transforms: ['identity', 'rotate90', 'rotate180', 'rotate270'],
    notes: 'Non-snowy top and bottom faces only.',
  },
  {
    id: 'dirt_path',
    label: 'Dirt path',
    family: 'Terrain',
    accent: '#987653',
    compatibleSince: '1.19.3',
    faceStates: rotationalFaces,
    referenceTextures: topAndBottomTextures('dirt_path_top', 'dirt'),
    transforms: ['identity', 'rotate90', 'rotate180', 'rotate270'],
    notes: 'Top and bottom faces only.',
  },
  {
    id: 'podzol',
    label: 'Podzol',
    family: 'Terrain',
    accent: '#76604a',
    compatibleSince: '1.19.3',
    faceStates: rotationalFaces,
    referenceTextures: topAndBottomTextures('podzol_top', 'dirt'),
    transforms: ['identity', 'rotate90', 'rotate180', 'rotate270'],
    notes: 'Top and bottom faces only.',
  },
  {
    id: 'mycelium',
    label: 'Mycelium',
    family: 'Terrain',
    accent: '#8e788d',
    compatibleSince: '1.19.3',
    faceStates: rotationalFaces,
    referenceTextures: topAndBottomTextures('mycelium_top', 'dirt'),
    transforms: ['identity', 'rotate90', 'rotate180', 'rotate270'],
    notes: 'Top and bottom faces only.',
  },
  {
    id: 'sand',
    label: 'Sand',
    family: 'Sediment',
    accent: '#d8cc91',
    compatibleSince: '1.19.3',
    faceStates: rotationalFaces,
    referenceTextures: topAndBottomTextures('sand'),
    transforms: ['identity', 'rotate90', 'rotate180', 'rotate270'],
    notes: 'Top and bottom faces only.',
  },
  {
    id: 'red_sand',
    label: 'Red sand',
    family: 'Sediment',
    accent: '#b96f43',
    compatibleSince: '1.19.3',
    faceStates: rotationalFaces,
    referenceTextures: topAndBottomTextures('red_sand'),
    transforms: ['identity', 'rotate90', 'rotate180', 'rotate270'],
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
    faceStates: rotationalFaces,
    referenceTextures: topAndBottomTextures(blockId),
    transforms: ['identity', 'rotate90', 'rotate180', 'rotate270'],
    notes: 'Four top/bottom model rotations.',
  }
})

export const blockProfiles: BlockProfile[] = [
  ...baseProfiles,
  ...concretePowderProfiles,
]

export const blockProfileMap = new Map(blockProfiles.map((profile) => [profile.id, profile]))

export function statesForFace(blockId: string, face: FaceDirection): 2 | 4 | undefined {
  return blockProfileMap.get(blockId)?.faceStates[face]
}

export function referenceTextureForFace(
  blockId: string,
  face: FaceDirection,
): string | undefined {
  return blockProfileMap.get(blockId)?.referenceTextures[face]
}
