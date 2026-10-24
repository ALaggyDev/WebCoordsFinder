/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import programmerArt from './programmerArt.json'
import { importResourcePack, resolveTextureSource, resourcePackSchema } from './resourcePacks'
import { animationCycleTicks, textureAnimationFrame, textureFrameRect } from './textureAnimation'
import { buildProjectBundle, readProjectBundle } from './projectBundle'
import { createEmptyDocument, normalizeEditorDocument, useEditorStore } from '../store/editorStore'
import { clearAllData, loadProject, persistProject } from '../storage/db'

const stone = new Uint8Array(readFileSync(resolve('public/minecraft/textures/block/stone.png')))
const pngSource = `data:image/png;base64,${Buffer.from(stone).toString('base64')}`
const zip = (files: Record<string, Uint8Array>) => new File([zipSync(files) as BlobPart], 'My pack.zip')

describe('resource packs', () => {
  it('bundles real Programmer’s Art overrides and inherits newer or unchanged vanilla textures', () => {
    for (const asset of programmerArt) {
      expect(readFileSync(resolve(`public/minecraft/programmer-art/${asset}`)).subarray(0, 8))
        .toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    }
    expect(readFileSync(resolve('public/minecraft/programmer-art/textures/block/stone.png')))
      .not.toEqual(Buffer.from(stone))
    const pack = { base: 'programmer-art' as const }
    expect(resolveTextureSource('/minecraft/textures/block/stone.png', pack))
      .toBe('/minecraft/programmer-art/textures/block/stone.png')
    expect(resolveTextureSource('/minecraft/offsets/block/dandelion.png', pack))
      .toBe('/minecraft/programmer-art/textures/block/dandelion.png')
    expect(resolveTextureSource('/minecraft/textures/block/sculk.png', pack))
      .toBe('/minecraft/textures/block/sculk.png')
  })

  it('imports a wrapped Java ZIP locally, sharing overrides across faces and offsets', async () => {
    const custom = await importResourcePack(zip({
      'Pack/assets/minecraft/textures/block/stone.png': stone,
      'Pack/assets/minecraft/textures/block/dandelion.png': stone,
      'Pack/assets/minecraft/textures/colormap/grass.png': stone,
      'Pack/assets/minecraft/models/block/stone.json': strToU8('{"parent":"remote"}'),
      'Pack/assets/minecraft/textures/block/unused.png': stone,
    }))
    expect(custom.name).toBe('My pack')
    expect(Object.keys(custom.textures)).toHaveLength(3)
    const pack = { base: 'programmer-art' as const, custom }
    expect(resolveTextureSource('/minecraft/textures/block/stone.png', pack)).toBe(pngSource)
    expect(resolveTextureSource('/minecraft/offsets/block/dandelion.png', pack)).toBe(pngSource)
    expect(resolveTextureSource('/minecraft/textures/colormap/grass.png', pack)).toBe(pngSource)
    expect(resolveTextureSource('/minecraft/textures/block/sand.png', pack))
      .toBe('/minecraft/programmer-art/textures/block/sand.png')
  })

  it('maps legacy block names and lets modern names override aliases', async () => {
    const custom = await importResourcePack(zip({
      'assets/minecraft/textures/blocks/grass_top.png': stone,
      'assets/minecraft/textures/blocks/grass_path_top.png': stone,
      'assets/minecraft/textures/blocks/concrete_powder_silver.png': stone,
      'assets/minecraft/textures/blocks/flower_rose.png': stone,
      'assets/minecraft/textures/blocks/double_plant_grass_top.png': stone,
      'assets/minecraft/textures/blocks/stone.png': stone,
      'assets/minecraft/textures/block/stone.png': new Uint8Array(readFileSync(resolve('public/minecraft/programmer-art/textures/block/stone.png'))),
    }))
    expect(Object.keys(custom.textures).sort()).toEqual([
      'textures/block/grass_block_top.png', 'textures/block/dirt_path_top.png',
      'textures/block/light_gray_concrete_powder.png', 'textures/block/poppy.png',
      'textures/block/tall_grass_top.png', 'textures/block/stone.png',
    ].sort())
    expect(custom.textures['textures/block/stone.png']).not.toBe(pngSource)
  })

  it('uses custom animation order, frame durations, interpolation and grid coordinates', async () => {
    const custom = await importResourcePack(zip({
      'assets/minecraft/textures/block/sculk.png': stone,
      'assets/minecraft/textures/block/sculk.png.mcmeta': strToU8(JSON.stringify({ animation: {
        width: 8, height: 8, frametime: 4, interpolate: true,
        frames: [3, { index: 0, time: 2 }, 1],
      } })),
    }))
    const pack = { base: 'vanilla' as const, custom }
    const source = '/minecraft/textures/block/sculk.png'
    expect(animationCycleTicks([source], pack)).toBe(10)
    expect(textureAnimationFrame(source, 4, pack)).toEqual({ current: 3, next: 0, blend: 0.75 })
    expect(textureAnimationFrame(source, 5, pack)).toEqual({ current: 0, next: 1, blend: 0 })
    expect(textureFrameRect(source, 16, 3, pack)).toEqual([8, 8, 8, 8])
    delete custom.animations['textures/block/sculk.png']
    expect(animationCycleTicks([source], pack)).toBeUndefined()
    expect(textureAnimationFrame(source, 21, pack)).toBeUndefined()
  })

  it('rejects unsupported archives, invalid PNGs, oversized images, and invalid frame indices', async () => {
    await expect(importResourcePack(zip({ 'pack.mcmeta': strToU8('{}') }))).rejects.toThrow('No supported')
    await expect(importResourcePack(zip({ 'assets/minecraft/textures/block/stone.png': strToU8('bad') })))
      .rejects.toThrow('invalid PNG')
    const oversized = stone.slice()
    new DataView(oversized.buffer).setUint32(16, 8192)
    await expect(importResourcePack(zip({ 'assets/minecraft/textures/block/stone.png': oversized })))
      .rejects.toThrow('invalid PNG')
    await expect(importResourcePack(zip({
      'assets/minecraft/textures/block/stone.png': stone,
      'assets/minecraft/textures/block/stone.png.mcmeta': strToU8('{"animation":{"frames":[4]}}'),
    }))).rejects.toThrow('animation metadata')
    expect(() => resourcePackSchema.parse({ base: 'vanilla', custom: {
      name: 'remote', textures: { 'textures/block/stone.png': 'https://example.com/stone.png' }, animations: {},
    } })).toThrow()
  })

  it('keeps schema-1 projects self-contained through reload and portable export', async () => {
    const document = createEmptyDocument()
    document.resourcePack = { base: 'programmer-art', custom: await importResourcePack(zip({
      'assets/minecraft/textures/block/stone.png': stone,
    })) }
    try {
      await persistProject('pack-project', document)
      const saved = await loadProject('pack-project')
      expect(normalizeEditorDocument(saved!.document).resourcePack).toEqual(document.resourcePack)
      const imported = await readProjectBundle(await buildProjectBundle(document))
      expect(imported.document.resourcePack).toEqual(document.resourcePack)
      expect(imported.document.schemaVersion).toBe(1)
      expect(normalizeEditorDocument(createEmptyDocument()).resourcePack).toBeUndefined()
    } finally {
      await clearAllData()
    }
  })

  it('preserves variants, review state, and search progress across pack changes and undo', () => {
    const document = createEmptyDocument()
    document.evidence = [{
      id: 'face', faceId: 'face', blockId: 'stone', localNormal: { x: 0, y: 0, z: 1 },
      latticeCoordinate: { x: 0, y: 0, z: 0 }, selectedVariant: 2, reviewStatus: 'confirmed',
      stateCount: 4, confidence: 0.9, scores: [{ variant: 2, score: 0.9 }],
    }, {
      id: 'proposal', faceId: 'proposal', blockId: 'stone', localNormal: { x: 0, y: 0, z: 1 },
      latticeCoordinate: { x: 1, y: 0, z: 0 }, selectedVariant: 1, reviewStatus: 'proposed',
      stateCount: 4, confidence: 0.8, scores: [{ variant: 1, score: 0.8 }],
    }]
    document.scanner.webSearch = {
      engineVersion: 7, requestKey: 'preserved-search', phase: 'paused',
      processed: '1', total: '2', matchCount: '0', checksPerSecond: 0,
      results: [], updatedAt: 1,
    }
    useEditorStore.setState({ document, past: [], future: [] })
    useEditorStore.getState().setResourcePack({ base: 'programmer-art' })
    const changed = useEditorStore.getState().document
    expect(changed.resourcePack?.base).toBe('programmer-art')
    expect(changed.evidence).toEqual(document.evidence)
    expect(changed.scanner.webSearch).toEqual(document.scanner.webSearch)
    useEditorStore.getState().setProjectName('Renamed')
    expect(useEditorStore.getState().document.resourcePack).toBe(changed.resourcePack)
    useEditorStore.getState().undo()
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().document.evidence).toEqual(document.evidence)
    expect(useEditorStore.getState().document.scanner.webSearch).toEqual(document.scanner.webSearch)
    expect(useEditorStore.getState().document.resourcePack).toBeUndefined()
  })
})
