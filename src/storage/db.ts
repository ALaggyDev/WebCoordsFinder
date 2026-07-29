import Dexie, { type EntityTable } from 'dexie'
import type { EditorDocument } from '../domain/types'

// Project JSON and image bytes have separate lifecycles: documents reference
// arbitrary asset keys while blobs remain in the shared IndexedDB asset table.
interface ProjectRecord {
  id: string
  createdAt?: number
  updatedAt: number
  document: unknown
}

interface AssetRecord {
  key: string
  blob: Blob
}

export interface ProjectSummary {
  id: string
  name: string
  imageName: string
  imageKey: string
  updatedAt: number
}

export interface StoredProject {
  id: string
  document: unknown
  imageBlob?: Blob
}

const ACTIVE_PROJECT_STORAGE_KEY = 'webcoordsfinder.active-project'

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
      // Version 2 removed the obsolete user-supplied reference texture table.
      references: null,
    })
  }
}

export const db = new WebCoordsDatabase()

function projectSummary(record: ProjectRecord): ProjectSummary {
  const document = record.document as Partial<EditorDocument>
  return {
    id: record.id,
    name: document.projectName?.trim() || 'Untitled project',
    imageName: document.image?.name || 'No image',
    imageKey: document.image?.key || '',
    updatedAt: record.updatedAt,
  }
}

export async function persistProject(
  id: string,
  document: EditorDocument,
): Promise<ProjectSummary> {
  const existing = await db.projects.get(id)
  const now = Date.now()
  const safeDocument = structuredClone(document)
  // Blob URLs are valid only in the current page; loadProject reconstructs one
  // from the persisted asset when the project is opened again.
  if (safeDocument.image.src.startsWith('blob:')) safeDocument.image.src = ''
  const record: ProjectRecord = {
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    document: safeDocument,
  }
  await db.projects.put(record)
  return projectSummary(record)
}

export async function persistImage(key: string, blob: Blob): Promise<void> {
  await db.assets.put({ key, blob })
}

export async function loadProject(id: string): Promise<StoredProject | null> {
  const record = await db.projects.get(id)
  if (!record) return null
  const document = record.document as EditorDocument
  const asset = document.image?.key
    ? await db.assets.get(document.image.key)
    : undefined
  return { id: record.id, document: record.document, imageBlob: asset?.blob }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const records = await db.projects.toArray()
  return records
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(projectSummary)
}

export function getActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setActiveProjectId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, id)
    else localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
  } catch {
    // Projects still work when browser storage settings block localStorage.
  }
}

export async function clearAllData(): Promise<void> {
  // Clear both tables atomically so no project can survive without its image,
  // and no orphan image remains after a successful reset.
  await db.transaction('rw', db.projects, db.assets, async () => {
    await db.projects.clear()
    await db.assets.clear()
  })
  setActiveProjectId(null)
}
