import Dexie, { type EntityTable } from 'dexie'
import type { EditorDocument } from '../domain/types'

interface ProjectRecord {
  id: 'current'
  updatedAt: number
  document: EditorDocument
}

interface AssetRecord {
  key: string
  blob: Blob
}

class WebCoordsDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, 'id'>
  assets!: EntityTable<AssetRecord, 'key'>

  constructor() {
    super('webcoordsfinder')
    this.version(1).stores({
      projects: 'id, updatedAt',
      assets: 'key',
      references: 'blockId',
    })
    this.version(2).stores({
      projects: 'id, updatedAt',
      assets: 'key',
      references: null,
    })
  }
}

export const db = new WebCoordsDatabase()

export async function persistProject(document: EditorDocument): Promise<void> {
  const safeDocument = structuredClone(document)
  if (safeDocument.image.src.startsWith('blob:')) safeDocument.image.src = ''
  await db.projects.put({
    id: 'current',
    updatedAt: Date.now(),
    document: safeDocument,
  })
}

export async function persistImage(key: string, blob: Blob): Promise<void> {
  await db.assets.put({ key, blob })
}

export async function loadPersistedProject(): Promise<{
  document: EditorDocument
  imageBlob?: Blob
} | null> {
  const record = await db.projects.get('current')
  if (!record) return null
  const asset = await db.assets.get(record.document.image.key)
  return { document: record.document, imageBlob: asset?.blob }
}

export async function clearLocalProject(): Promise<void> {
  await db.transaction('rw', db.projects, db.assets, async () => {
    await db.projects.clear()
    await db.assets.clear()
  })
}
