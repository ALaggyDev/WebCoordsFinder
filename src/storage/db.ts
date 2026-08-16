import Dexie, { type EntityTable } from 'dexie'
import type { EditorDocument, TextureAlgorithm } from '../domain/types'

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
  createdAt: number
  name: string
  imageName: string
  imageKey: string
  imageWidth: number
  imageHeight: number
  faceCount: number
  evidenceCount: number
  confirmedCount: number
  proposedCount: number
  anchorSet: boolean
  compassResolved: boolean
  textureAlgorithm: TextureAlgorithm
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
  const evidence = Array.isArray(document.evidence) ? document.evidence : []
  return {
    id: record.id,
    // Projects written before creation timestamps were introduced retain their
    // original ordering by treating their last-known update as creation time.
    createdAt: record.createdAt ?? record.updatedAt,
    name: document.projectName?.trim() || 'Untitled project',
    imageName: document.image?.name || 'No image',
    imageKey: document.image?.key || '',
    imageWidth: document.image?.width || 0,
    imageHeight: document.image?.height || 0,
    faceCount: document.scene?.faces?.length || 0,
    evidenceCount: evidence.length,
    confirmedCount: evidence.filter(
      (entry) => entry.reviewStatus === 'confirmed',
    ).length,
    proposedCount: evidence.filter(
      (entry) => entry.reviewStatus === 'proposed',
    ).length,
    anchorSet: Boolean(document.anchorFaceId),
    compassResolved: Boolean(document.scanner?.compassResolved),
    textureAlgorithm: document.scanner?.textureAlgorithm || 'Vanilla-3',
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
    .sort(
      (left, right) =>
        (right.createdAt ?? right.updatedAt) -
        (left.createdAt ?? left.updatedAt),
    )
    .map(projectSummary)
}

export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', db.projects, db.assets, async () => {
    const record = await db.projects.get(id)
    if (!record) return
    const document = record.document as Partial<EditorDocument>
    const imageKey = document.image?.key
    await db.projects.delete(id)
    if (!imageKey) return

    const remaining = await db.projects.toArray()
    const imageStillUsed = remaining.some((candidate) => {
      const candidateDocument = candidate.document as Partial<EditorDocument>
      return candidateDocument.image?.key === imageKey
    })
    if (!imageStillUsed) await db.assets.delete(imageKey)
  })
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
