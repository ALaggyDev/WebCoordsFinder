import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import './App.css'
import { EditorCanvas } from './components/EditorCanvas'
import { Inspector } from './components/Inspector'
import { ToolRail } from './components/ToolRail'
import { TopBar } from './components/TopBar'
import {
  faceHasWorldOrientation,
  faceForLocalNormal,
  faceQuad,
} from './domain/geometry'
import {
  imageToPixels,
  orientCropToWorld,
  warpQuad,
} from './domain/imageAnalysis'
import {
  buildProjectBundle,
  downloadBlob,
  readProjectBundle,
} from './domain/projectBundle'
import { blockProfileMap, referenceTextureForFace } from './domain/references'
import type { CandidateScore } from './domain/types'
import {
  clearLocalProject,
  loadPersistedProject,
  persistImage,
  persistProject,
} from './storage/db'
import { normalizeEditorDocument, useEditorStore } from './store/editorStore'

type ToastKind = 'success' | 'warning' | 'info'

interface ToastState {
  message: string
  kind: ToastKind
}

interface WorkerResponse {
  requestId: string
  scores: CandidateScore[]
  confidence: number
}

function App() {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [toast, setToast] = useState<ToastState>()
  const document = useEditorStore((state) => state.document)
  const selectedEvidenceIds = useEditorStore((state) => state.selectedEvidenceIds)
  const replaceImage = useEditorStore((state) => state.replaceImage)
  const loadDocument = useEditorStore((state) => state.loadDocument)
  const applyAnalysisResults = useEditorStore((state) => state.applyAnalysisResults)
  const setFaceTab = useEditorStore((state) => state.setFaceTab)
  const setTool = useEditorStore((state) => state.setTool)
  const selectAllFaces = useEditorStore((state) => state.selectAllFaces)
  const setVariant = useEditorStore((state) => state.setVariant)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const resetDemo = useEditorStore((state) => state.resetDemo)

  const notify = (message: string, kind: ToastKind = 'info') => {
    setToast({ message, kind })
  }

  useEffect(() => {
    let active = true
    loadPersistedProject()
      .then((saved) => {
        if (!active) return
        if (saved) {
          const restored = normalizeEditorDocument(saved.document)
          if (saved.imageBlob) {
            restored.image.src = URL.createObjectURL(saved.imageBlob)
          } else if (!restored.image.src) {
            restored.image.src = '/demo/demo.png'
          }
          loadDocument(restored)
        }
      })
      .catch(() => {
        notify('Local autosave could not be restored. The editor still works normally.', 'warning')
      })
      .finally(() => {
        if (active) setHydrated(true)
      })
    return () => {
      active = false
    }
  }, [loadDocument])

  useEffect(() => {
    if (!hydrated) return
    const timeout = window.setTimeout(() => {
      persistProject(document).catch(() =>
        notify('Autosave is temporarily unavailable.', 'warning'),
      )
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [document, hydrated])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectAllFaces()
        return
      }
      const toolShortcut = {
        v: 'select',
        g: 'plane',
        e: 'extrude',
        x: 'delete',
      } as const
      const shortcut = toolShortcut[event.key.toLowerCase() as keyof typeof toolShortcut]
      if (shortcut) setTool(shortcut)
      if (/^[0-3]$/.test(event.key) && selectedEvidenceIds[0]) {
        const evidence = useEditorStore
          .getState()
          .document.evidence.find((entry) => entry.id === selectedEvidenceIds[0])
        const variant = Number(event.key)
        if (evidence && variant < evidence.stateCount) setVariant(evidence.id, variant)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [redo, selectAllFaces, selectedEvidenceIds, setTool, setVariant, undo])

  const importImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      notify('Choose a PNG, JPEG, or WebP image.', 'warning')
      return
    }
    const source = URL.createObjectURL(file)
    const image = new Image()
    image.src = source
    try {
      await image.decode()
      const key = crypto.randomUUID()
      await persistImage(key, file)
      replaceImage({
        key,
        name: file.name,
        src: source,
        width: image.naturalWidth,
        height: image.naturalHeight,
        mime: file.type,
      })
      notify('Image loaded. Click four corners to create the base faces.', 'success')
    } catch {
      URL.revokeObjectURL(source)
      notify('The selected image could not be decoded.', 'warning')
    }
  }

  const exportProject = async () => {
    try {
      const imageBlob = await fetch(document.image.src).then((response) => response.blob())
      const bundle = await buildProjectBundle(document, imageBlob)
      downloadBlob(bundle, `${document.projectName.replace(/[^\w-]+/g, '-').toLowerCase() || 'webcoordsfinder'}.wcf`)
      notify('Project bundle saved.', 'success')
    } catch {
      notify('The project bundle could not be created.', 'warning')
    }
  }

  const importProject = async (file: File) => {
    try {
      const imported = await readProjectBundle(file)
      const restored = normalizeEditorDocument(imported.document)
      if (imported.imageBlob) {
        const key = crypto.randomUUID()
        await persistImage(key, imported.imageBlob)
        restored.image.key = key
        restored.image.src = URL.createObjectURL(imported.imageBlob)
        restored.image.mime = imported.imageBlob.type
      } else if (!restored.image.src) {
        throw new Error('The project does not contain its source image.')
      }
      loadDocument(restored)
      notify('Project opened.', 'success')
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'The project bundle is invalid.',
        'warning',
      )
    }
  }

  const autoFill = async (requestedEvidenceIds?: string[]) => {
    const state = useEditorStore.getState()
    const targetIds = requestedEvidenceIds ?? state.selectedEvidenceIds
    const targets = state.document.evidence.filter((entry) =>
      targetIds.includes(entry.id),
    )
    if (targets.length === 0) {
      notify('Select one or more faces first.', 'warning')
      return
    }
    const analyzable = targets.filter((entry) =>
      {
        const meshFace = state.document.scene.faces.find(
          (candidate) => candidate.id === entry.faceId,
        )
        const face = faceForLocalNormal(
          state.document.scene.axisMapping,
          entry.localNormal,
        )
        return (
          meshFace &&
          faceHasWorldOrientation(state.document.scene, meshFace) &&
          face &&
          referenceTextureForFace(entry.blockId, face)
        )
      },
    )
    if (analyzable.length === 0) {
      notify(
        'Resolve the selected surface axes and choose a supported block profile first.',
        'warning',
      )
      return
    }

    setBusy(true)
    try {
      const worker = new Worker(new URL('./workers/analyze.worker.ts', import.meta.url), {
        type: 'module',
      })
      const pending = new Map<
        string,
        (response: WorkerResponse) => void
      >()
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        pending.get(event.data.requestId)?.(event.data)
        pending.delete(event.data.requestId)
      }

      const jobs = analyzable.map(async (entry) => {
        const meshFace = state.document.scene.faces.find(
          (item) => item.id === entry.faceId,
        )
        const face = faceForLocalNormal(
          state.document.scene.axisMapping,
          entry.localNormal,
        )
        const profile = blockProfileMap.get(entry.blockId)
        const referenceUrl = face
          ? referenceTextureForFace(entry.blockId, face)
          : undefined
        const quad = meshFace
          ? faceQuad(state.document.scene, meshFace)
          : undefined
        if (!meshFace || !profile || !referenceUrl || !quad) return null
        const [rawSample, reference] = await Promise.all([
          warpQuad(state.document.image.src, quad, 96),
          imageToPixels(referenceUrl, 96),
        ])
        const sample = orientCropToWorld(
          rawSample,
          state.document.scene,
          meshFace,
        )
        const requestId = crypto.randomUUID()
        const result = new Promise<WorkerResponse>((resolve) => {
          pending.set(requestId, resolve)
        })
        worker.postMessage({
          requestId,
          sample: sample.data,
          reference: reference.data,
          size: 96,
          transforms: profile.transforms,
          stateCount: entry.stateCount,
        })
        const response = await result
        return {
          evidenceId: entry.id,
          scores: response.scores,
          confidence: response.confidence,
        }
      })
      const results = (await Promise.all(jobs)).filter(
        (result): result is NonNullable<typeof result> => result !== null,
      )
      worker.terminate()
      applyAnalysisResults(results)
      setFaceTab('review')
      notify(
        `${results.length} face${results.length === 1 ? '' : 's'} added to Auto Analyze.`,
        'success',
      )
      if (analyzable.length < targets.length) {
        notify(
          `${targets.length - analyzable.length} selected face${targets.length - analyzable.length === 1 ? '' : 's'} used an unsupported block profile.`,
          'warning',
        )
      }
    } catch {
      notify('Automatic analysis failed; manual variant selection is still available.', 'warning')
    } finally {
      setBusy(false)
    }
  }

  const clearProject = async () => {
    await clearLocalProject()
    resetDemo()
    notify('Local project data cleared. The example has been restored.', 'info')
  }

  return (
    <div className="app">
      <TopBar
        onOpenImage={() => imageInputRef.current?.click()}
        onImportProject={() => projectInputRef.current?.click()}
        onExportProject={exportProject}
      />
      <main className="workspace">
        <ToolRail />
        <EditorCanvas />
        <Inspector
          busy={busy}
          onOpenImage={() => imageInputRef.current?.click()}
          onAutoFill={autoFill}
          onClearProject={clearProject}
        />
      </main>
      <input
        ref={imageInputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importImage(file)
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={projectInputRef}
        className="visually-hidden"
        type="file"
        accept=".wcf,application/x-webcoordsfinder,application/zip"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importProject(file)
          event.currentTarget.value = ''
        }}
      />
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.kind === 'success' ? <CheckCircle2 size={17} /> : toast.kind === 'warning' ? <AlertTriangle size={17} /> : <Info size={17} />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(undefined)} aria-label="Dismiss notification"><X size={14} /></button>
        </div>
      )}
    </div>
  )
}

export default App
