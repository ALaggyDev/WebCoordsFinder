import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  modelLatticePoint,
  offsetBasis,
  offsetEvidenceListSchema,
  offsetFromNibbles,
  offsetProfiles,
  offsetReadiness,
  worldPlaneDelta,
  worldToLocal,
} from './blockOffsets'
import {
  mappedVector,
  projectScenePoint,
  sceneLatticeParity,
  validAxisMappingCompletions,
} from './geometry'
import { buildProjectBundle, readProjectBundle } from './projectBundle'
import {
  createEmptyDocument,
  normalizeEditorDocument,
  useEditorStore,
} from '../store/editorStore'
import { createTestDocument } from '../test/createTestDocument'
import type { BlockOffsetEvidence } from './types'
import {
  clipTexturedPolygonAtY,
  offsetModelQuads,
} from './offsetRendering'

function cameraDocument() {
  const document = createTestDocument()
  document.scene.axisMapping = validAxisMappingCompletions(
    { a: 'unknown', b: 'unknown', c: 'unknown' },
    sceneLatticeParity(document.scene),
  )[0]
  document.scanner.compassResolved = true
  return document
}
const observation = (): BlockOffsetEvidence => ({
  id: 'grass-1',
  blockId: 'short_grass',
  modelIndex: 0,
  position: { x: 1, y: 2, z: 3 },
  nibbles: { x: 0, y: 0, z: 15 },
  tint: '#91bd59',
})

describe('Minecraft block offsets', () => {
  it('preserves Java float rounding, XYZ vertical range, and dripstone clamping', () => {
    const grass = offsetProfiles.short_grass
    expect(offsetFromNibbles(grass, { x: 0, y: 15, z: 15 })).toEqual({
      x: -0.25,
      y: 0,
      z: 0.25,
    })
    expect(offsetFromNibbles(grass, { x: 7, y: 0, z: 8 })).toEqual({
      x: -0.01666666567325592,
      y: -0.20000000298023224,
      z: 0.016666680574417114,
    })
    expect(
      offsetFromNibbles(offsetProfiles.small_dripleaf, { x: 0, y: 0, z: 0 }).y,
    ).toBe(-0.10000000149011612)
    expect(
      offsetFromNibbles(offsetProfiles.pointed_dripstone, {
        x: 0,
        y: 0,
        z: 15,
      }),
    ).toEqual({ x: -0.125, y: 0, z: 0.125 })
    expect(
      offsetFromNibbles(offsetProfiles.pointed_dripstone, {
        x: 3,
        y: 0,
        z: 12,
      }),
    ).toEqual({ x: -0.125, y: 0, z: 0.125 })
  })

  it('requires a full camera and a parity-consistent confirmed compass', () => {
    const document = cameraDocument()
    expect(offsetReadiness(document)).toBeUndefined()
    document.scanner.compassResolved = false
    expect(offsetReadiness(document)).toContain('compass')
    expect(offsetReadiness(createEmptyDocument())).toContain('3D')
    document.scanner.compassResolved = true
    document.scene.axisMapping = validAxisMappingCompletions(
      { a: 'unknown', b: 'unknown', c: 'unknown' },
      -sceneLatticeParity(document.scene)! as 1 | -1,
    )[0]
    expect(offsetReadiness(document)).toContain('compass')
  })

  it('does not fit or place offsets using a planar homography', () => {
    useEditorStore.getState().loadDocument(createEmptyDocument())
    useEditorStore.getState().addBaseFaces([
      { x: 100, y: 100 }, { x: 500, y: 100 },
      { x: 500, y: 500 }, { x: 100, y: 500 },
    ])
    const document = useEditorStore.getState().document
    expect(document.scene.projection?.kind).toBe('planar')
    expect(offsetReadiness(document)).toContain('3D')
    expect(worldPlaneDelta(document.scene, { x: 0, y: 0, z: 0 }, { x: 200, y: 200 })).toBeUndefined()
    useEditorStore.getState().addOffset(observation())
    expect(useEditorStore.getState().document.offsets).toEqual([])
  })

  it('centers models correctly in signed and reflected lattice mappings', () => {
    const document = cameraDocument()
    for (const mapping of validAxisMappingCompletions({
      a: 'unknown',
      b: 'unknown',
      c: 'unknown',
    })) {
      document.scene.axisMapping = mapping
      const entry = observation()
      const local = modelLatticePoint(
        document.scene,
        entry,
        { x: 0, y: 1, z: 0 },
        { x: 0.25, y: -0.1, z: -0.25 },
      )
      const world = mappedVector(mapping, {
        x: local.x - entry.position.x - 0.5,
        y: local.y - entry.position.y - 0.5,
        z: local.z - entry.position.z - 0.5,
      })!
      expect(world.x).toBeCloseTo(-0.25)
      expect(world.y).toBeCloseTo(0.4)
      expect(world.z).toBeCloseTo(-0.75)
    }
  })

  it('inverts an XZ drag through the shared projective camera', () => {
    const { scene } = cameraDocument()
    const origin = { x: 1, y: 2, z: 1 }
    const delta = worldToLocal(scene, { x: 2.25, y: 0, z: -0.75 })
    const projected = projectScenePoint(scene, {
      x: origin.x + delta.x,
      y: origin.y + delta.y,
      z: origin.z + delta.z,
    })!
    const result = worldPlaneDelta(scene, origin, projected)!
    expect(result.x).toBeCloseTo(2.25)
    expect(result.y).toBeCloseTo(-0.75)
  })

  it('resolves every bundled model including multipart bamboo and rotated elements', () => {
    const textures = new Set<string>()
    for (const [blockId, profile] of Object.entries(offsetProfiles))
      for (
        let modelIndex = 0;
        modelIndex < profile.variants.length;
        modelIndex++
      ) {
        const quads = offsetModelQuads({
          ...observation(),
          blockId,
          modelIndex,
        })
        quads.forEach((quad) => textures.add(quad.face.texture))
        expect(quads.length).toBeGreaterThan(0)
        expect(
          quads.every(
            (q) =>
              q.points.every((p) => Object.values(p).every(Number.isFinite)) &&
              q.face.texture.startsWith('/minecraft/offsets/'),
          ),
        ).toBe(true)
      }
    const bamboo = offsetProfiles.bamboo.variants.find((v) =>
      v.label.includes('leaves=large'),
    )!
    const bareBamboo = offsetProfiles.bamboo.variants.find((v) =>
      v.label.includes('leaves=none'),
    )!
    expect(bamboo.parts).toHaveLength(1)
    expect(bareBamboo.parts).toHaveLength(1)
    expect(bamboo.parts[0].elements.length).toBeGreaterThan(
      bareBamboo.parts[0].elements.length,
    )
    for (const texture of textures)
      expect(
        existsSync(
          resolve('public', texture.slice(1)),
        ),
        texture,
      ).toBe(true)
    const cross = offsetModelQuads(observation())[0]
    expect(cross.points[0].x).toBeCloseTo(0.95)
    expect(cross.points[0].y).toBe(1)
    expect(cross.points[0].z).toBeCloseTo(0.05)
  })

  it('bundles both halves of tall plants into one model', () => {
    for (const blockId of [
      'tall_seagrass',
      'sunflower',
      'lilac',
      'rose_bush',
      'peony',
      'tall_grass',
      'large_fern',
      'pitcher_plant',
    ]) {
      expect(offsetProfiles[blockId].variants).toHaveLength(1)
      const quads = offsetModelQuads({ ...observation(), blockId })
      expect(Math.max(...quads.flatMap((quad) => quad.points.map((p) => p.y)))).toBeGreaterThan(1)
    }
    expect(offsetProfiles.small_dripleaf.variants).toHaveLength(4)
    expect(
      offsetProfiles.small_dripleaf.variants.every(
        (variant) => variant.parts.length === 1,
      ),
    ).toBe(true)
  })

  it('clips shifted model geometry and texture coordinates at the block floor', () => {
    const clipped = clipTexturedPolygonAtY(
      [
        { point: { x: 0, y: 1, z: 0 }, uv: { x: 0, y: 0 } },
        { point: { x: 1, y: 1, z: 0 }, uv: { x: 16, y: 0 } },
        { point: { x: 1, y: 0, z: 0 }, uv: { x: 16, y: 16 } },
        { point: { x: 0, y: 0, z: 0 }, uv: { x: 0, y: 16 } },
      ],
      0.2,
    )
    expect(clipped).toHaveLength(4)
    expect(clipped.every(({ point }) => point.y >= 0.2)).toBe(true)
    const intersections = clipped.filter(({ point }) => point.y === 0.2)
    expect(intersections).toHaveLength(2)
    intersections.forEach(({ uv }) => expect(uv.y).toBeCloseTo(12.8))
  })
})

describe('offset persistence and editing', () => {
  it('round-trips offsets in schema 1 and keeps old projects loadable', async () => {
    const document = cameraDocument()
    document.offsets = [
      { ...observation(), confirmedBasis: offsetBasis(document) },
    ]
    const imported = await readProjectBundle(await buildProjectBundle(document))
    expect(normalizeEditorDocument(imported.document).offsets).toEqual(
      document.offsets,
    )
    delete document.offsets
    expect(normalizeEditorDocument(document).offsets).toEqual([])
  })

  it('rejects malformed model IDs, seed values, duplicate IDs, and fractional lattice positions', () => {
    for (const patch of [
      { blockId: 'unknown' },
      { blockId: '__proto__' },
      { blockId: 'toString' },
      { modelIndex: 10000 },
      { nibbles: { x: 16, y: 0, z: 0 } },
      { position: { x: 0.5, y: 0, z: 0 } },
    ]) {
      expect(
        offsetEvidenceListSchema.safeParse([{ ...observation(), ...patch }])
          .success,
      ).toBe(false)
    }
    expect(
      offsetEvidenceListSchema.safeParse([observation(), observation()])
        .success,
    ).toBe(false)
  })

  it('supports undo, redo, confirmation invalidation, and image replacement', () => {
    useEditorStore.getState().loadDocument(cameraDocument())
    const store = useEditorStore.getState
    store().addOffset(observation())
    store().confirmOffset('grass-1')
    expect(store().document.offsets![0].confirmedBasis).toBe(
      offsetBasis(store().document),
    )
    store().updateOffset('grass-1', { nibbles: { x: 8, y: 9, z: 10 } })
    expect(store().document.offsets![0].confirmedBasis).toBeUndefined()
    store().undo()
    expect(store().document.offsets![0].nibbles).toEqual(observation().nibbles)
    store().redo()
    expect(store().document.offsets![0].nibbles.x).toBe(8)
    store().confirmOffset('grass-1')
    const changedCamera = structuredClone(store().document)
    if (changedCamera.scene.projection?.kind === 'camera')
      changedCamera.scene.projection.matrix[3] += 1
    expect(changedCamera.offsets![0].confirmedBasis).not.toBe(
      offsetBasis(changedCamera),
    )
    store().replaceImage(createEmptyDocument().image)
    expect(store().document.offsets).toEqual([])
  })

  it('cannot add or adjust measurements before prerequisites are satisfied', () => {
    useEditorStore.getState().loadDocument(createEmptyDocument())
    useEditorStore.getState().addOffset(observation())
    expect(useEditorStore.getState().document.offsets).toEqual([])
  })
})
