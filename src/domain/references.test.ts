/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  blockProfiles,
  referenceTextureForFace,
} from './references'
import type { FaceDirection } from './types'

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('bundled reference textures', () => {
  it('provides a valid PNG for every supported profile face', () => {
    for (const profile of blockProfiles) {
      for (const face of Object.keys(profile.faceStates) as FaceDirection[]) {
        const source = referenceTextureForFace(profile.id, face)
        expect(source, `${profile.id} ${face}`).toBeDefined()

        const filePath = resolve(process.cwd(), `public${source}`)
        expect(existsSync(filePath), source).toBe(true)
        expect(readFileSync(filePath).subarray(0, 8), source).toEqual(pngSignature)
      }
    }
  })

  it('uses the face textures declared by the vanilla block models', () => {
    expect(referenceTextureForFace('deepslate', 'up')).toMatch(/\/deepslate_top\.png$/)
    expect(referenceTextureForFace('deepslate', 'north')).toMatch(/\/deepslate\.png$/)
    expect(referenceTextureForFace('grass_block', 'up')).toMatch(/\/grass_block_top\.png$/)
    expect(referenceTextureForFace('grass_block', 'down')).toMatch(/\/dirt\.png$/)
    expect(referenceTextureForFace('dirt_path', 'down')).toMatch(/\/dirt\.png$/)
    expect(referenceTextureForFace('podzol', 'down')).toMatch(/\/dirt\.png$/)
    expect(referenceTextureForFace('mycelium', 'down')).toMatch(/\/dirt\.png$/)
  })

  it('exposes each concrete powder color as its own profile', () => {
    const profiles = blockProfiles.filter((profile) =>
      profile.id.endsWith('_concrete_powder'),
    )

    expect(profiles).toHaveLength(16)
    expect(blockProfiles.some((profile) => profile.id === 'concrete_powder')).toBe(false)
    expect(new Set(profiles.map((profile) => profile.referenceTextures.up)).size).toBe(16)
  })
})
