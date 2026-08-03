import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exampleProjects } from './examples'
import { readProjectBundle } from './projectBundle'

describe('bundled examples', () => {
  it('loads the supplied demo project and its embedded source image', async () => {
    const bytes = await readFile(resolve('public/examples/dark-cave.wcf'))
    const start = bytes.byteOffset
    const end = start + bytes.byteLength
    const bundle = {
      arrayBuffer: async () => bytes.buffer.slice(start, end),
    } as Blob

    const imported = await readProjectBundle(bundle)

    expect(exampleProjects[0]).toMatchObject({
      id: 'dark-cave',
      bundleSrc: '/examples/dark-cave.wcf',
    })
    expect(imported.document).toMatchObject({
      projectName: 'Dark Cave',
      image: { name: 'dark cave.png', width: 1908, height: 1080 },
      anchorFaceId: expect.any(String),
      scanner: { compassResolved: true, textureAlgorithm: 'Vanilla-3' },
    })
    expect(imported.document.scene.faces).toHaveLength(33)
    expect(imported.document.evidence).toHaveLength(33)
    expect(imported.imageBlob?.size).toBeGreaterThan(0)
  })
})
