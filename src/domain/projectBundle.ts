import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { z } from 'zod'
import {
  searchDirections,
  textureAlgorithms,
  type EditorDocument,
  type SearchDirection,
} from './types'

// Bundles accept the current schema only. Passthrough fields keep validation
// focused on invariants owned here without becoming a migration mechanism.
const searchDirectionSchema = z.number().refine(
  (value): value is SearchDirection =>
    searchDirections.includes(value as SearchDirection),
  'Invalid search direction.',
)

const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectName: z.string(),
    anchorFaceId: z.string().nullable(),
    image: z.object({
      key: z.string(),
      name: z.string(),
      src: z.string(),
      width: z.number(),
      height: z.number(),
      mime: z.string(),
    }),
    scene: z.unknown(),
    evidence: z.array(z.unknown()),
    scanner: z
      .object({
        textureAlgorithm: z.enum(textureAlgorithms),
        directions: z
          .array(searchDirectionSchema)
          .min(1)
          .refine((directions) => directions.includes(0), {
            message: 'Search directions must include 0 degrees.',
          })
          .refine(
            (directions) => new Set(directions).size === directions.length,
            { message: 'Search directions must be unique.' },
          ),
        webSearch: z
          .object({
            engineVersion: z.literal(2),
            requestKey: z.string(),
            phase: z.enum([
              'running',
              'paused',
              'stopped',
              'completed',
              'error',
            ]),
            processed: z.string().regex(/^\d+$/),
            total: z.string().regex(/^\d+$/),
            matchCount: z.string().regex(/^\d+$/),
            checksPerSecond: z.number(),
            results: z.array(
              z.object({
                x: z.number().int(),
                y: z.number().int(),
                z: z.number().int(),
                badBlocks: z.number().int().nonnegative(),
                direction: searchDirectionSchema,
              }),
            ),
            error: z.string().optional(),
            updatedAt: z.number(),
          })
          .nullable(),
      })
      .passthrough(),
  })
  .passthrough()

function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  return 'png'
}

export async function buildProjectBundle(
  document: EditorDocument,
  imageBlob?: Blob,
): Promise<Blob> {
  const safeDocument = structuredClone(document)
  // Object URLs are browser-session handles; the portable image bytes are
  // stored as a sibling archive entry instead.
  safeDocument.image.src = ''
  const files: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify(safeDocument, null, 2)),
  }
  if (imageBlob) {
    files[`image.${extensionForMime(imageBlob.type)}`] = new Uint8Array(
      await imageBlob.arrayBuffer(),
    )
  }
  return new Blob([zipSync(files, { level: 6 }) as BlobPart], {
    type: 'application/x-webcoordsfinder',
  })
}

export async function readProjectBundle(file: File): Promise<{
  document: EditorDocument
  imageBlob?: Blob
}> {
  // Validate project.json before exposing it to the editor, then recover the
  // optional image using the archive entry's extension as its MIME hint.
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const projectFile = files['project.json']
  if (!projectFile) throw new Error('This bundle does not contain project.json.')
  const parsed = projectSchema.parse(JSON.parse(strFromU8(projectFile)))
  const document = parsed as unknown as EditorDocument
  const imageName = Object.keys(files).find((name) => name.startsWith('image.'))
  let imageBlob: Blob | undefined
  if (imageName) {
    const extension = imageName.split('.').pop()?.toLowerCase()
    const mime =
      extension === 'jpg' || extension === 'jpeg'
        ? 'image/jpeg'
        : extension === 'webp'
          ? 'image/webp'
          : 'image/png'
    imageBlob = new Blob([files[imageName] as BlobPart], { type: mime })
  }
  return { document, imageBlob }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Revocation is deferred until the synthetic click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
