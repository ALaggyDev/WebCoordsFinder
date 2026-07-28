import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEmptyDocument } from '../store/editorStore'
import {
  clearAllData,
  getActiveProjectId,
  listProjects,
  loadProject,
  persistImage,
  persistProject,
  setActiveProjectId,
} from './db'

beforeEach(async () => {
  await clearAllData()
})

afterEach(async () => {
  await clearAllData()
})

describe('project storage', () => {
  it('stores and loads multiple projects with their own image assets', async () => {
    const first = createEmptyDocument()
    first.projectName = 'Nether ceiling'
    first.image = {
      key: 'image-first',
      name: 'nether.png',
      src: 'blob:first',
      width: 1920,
      height: 1080,
      mime: 'image/png',
    }
    const second = createEmptyDocument()
    second.projectName = 'End island'
    second.image = {
      key: 'image-second',
      name: 'end.webp',
      src: 'blob:second',
      width: 1280,
      height: 720,
      mime: 'image/webp',
    }

    await persistImage(first.image.key, new Blob(['first'], { type: 'image/png' }))
    await persistImage(second.image.key, new Blob(['second'], { type: 'image/webp' }))
    await persistProject('project-first', first)
    await persistProject('project-second', second)

    expect(await listProjects()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'project-first',
          name: 'Nether ceiling',
          imageName: 'nether.png',
        }),
        expect.objectContaining({
          id: 'project-second',
          name: 'End island',
          imageName: 'end.webp',
        }),
      ]),
    )
    const restored = await loadProject('project-second')
    expect(restored?.document).toMatchObject({
      projectName: 'End island',
      image: { src: '' },
    })
    expect(restored?.imageBlob).toBeDefined()
  })

  it('remembers the active project and clears every project and image', async () => {
    const document = createEmptyDocument()
    document.image.key = 'only-image'
    await persistImage(document.image.key, new Blob(['image']))
    await persistProject('only-project', document)
    setActiveProjectId('only-project')

    expect(getActiveProjectId()).toBe('only-project')

    await clearAllData()

    expect(getActiveProjectId()).toBeNull()
    expect(await listProjects()).toEqual([])
    expect(await loadProject('only-project')).toBeNull()
  })
})
