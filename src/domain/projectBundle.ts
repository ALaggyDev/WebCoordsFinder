import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { z } from 'zod'
import { textureAlgorithms, type EditorDocument } from './types'

const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectName: z.string(),
    image: z.object({
      key: z.string(),
      name: z.string(),
      src: z.string(),
      width: z.number(),
      height: z.number(),
      mime: z.string(),
    }),
    planes: z.array(z.unknown()),
    evidence: z.array(z.unknown()),
    scanner: z
      .object({
        textureAlgorithm: z.enum(textureAlgorithms),
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
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
