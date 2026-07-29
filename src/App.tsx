import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  ImagePlus,
  Info,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import './App.css'
import { EditorCanvas } from './components/EditorCanvas'
import { Inspector } from './components/Inspector'
import { ProjectDialog } from './components/ProjectDialog'
import { ToolRail } from './components/ToolRail'
import { TopBar } from './components/TopBar'
import {
  exampleProjects,
  type ExampleProjectId,
} from './domain/examples'
import {
  faceHasWorldOrientation,
  faceForLocalNormal,
  worldAlignedFaceQuad,
} from './domain/geometry'
import {
  imageToPixels,
  warpQuad,
} from './domain/imageAnalysis'
import {
  buildProjectBundle,
  downloadBlob,
  readProjectBundle,
} from './domain/projectBundle'
import { blockProfileMap, referenceTextureForFace } from './domain/references'
import type { CandidateScore, EditorDocument } from './domain/types'
import {
  clearAllData,
  getActiveProjectId,
  listProjects,
  loadProject,
  persistImage,
  persistProject,
  setActiveProjectId as rememberActiveProject,
  type ProjectSummary,
  type StoredProject,
} from './storage/db'
import {
  createEmptyDocument,
  createExampleDocument,
  normalizeEditorDocument,
  useEditorStore,
} from './store/editorStore'

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

function restoreStoredDocument(saved: StoredProject) {
  const restored = normalizeEditorDocument(saved.document)
  if (saved.imageBlob) {
    restored.image.src = URL.createObjectURL(saved.imageBlob)
    restored.image.mime = saved.imageBlob.type || restored.image.mime
  } else if (!restored.image.src) {
    throw new Error('This project is missing its source image.')
  }
  return restored
}

function revokeObjectUrl(source: string): void {
  if (source.startsWith('blob:')) URL.revokeObjectURL(source)
}

function projectNameFromFile(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').trim() || 'Untitled project'
}

function uniqueProjectName(base: string, projects: ProjectSummary[]): string {
  const names = new Set(projects.map((project) => project.name.toLowerCase()))
  if (!names.has(base.toLowerCase())) return base
  let suffix = 2
  while (names.has(`${base} ${suffix}`.toLowerCase())) suffix += 1
  return `${base} ${suffix}`
}

function App() {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectPreviews, setProjectPreviews] = useState<
    Record<string, string | undefined>
  >({})
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [toast, setToast] = useState<ToastState>()
  const document = useEditorStore((state) => state.document)
  const selectedEvidenceIds = useEditorStore((state) => state.selectedEvidenceIds)
  const loadDocument = useEditorStore((state) => state.loadDocument)
  const applyAnalysisResults = useEditorStore((state) => state.applyAnalysisResults)
  const setFaceTab = useEditorStore((state) => state.setFaceTab)
  const setTool = useEditorStore((state) => state.setTool)
  const selectAllFaces = useEditorStore((state) => state.selectAllFaces)
  const deleteSelectedFaces = useEditorStore(
    (state) => state.deleteSelectedFaces,
  )
  const setVariant = useEditorStore((state) => state.setVariant)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const resetProject = useEditorStore((state) => state.resetProject)

  const notify = (message: string, kind: ToastKind = 'info') => {
    setToast({ message, kind })
  }

  const projectPreviewSignature = JSON.stringify(
    projects
      .map((project) => [project.id, project.imageKey] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  )

  useEffect(() => {
    let active = true
    const hydrate = async () => {
      try {
        const savedProjects = await listProjects()
        if (!active) return
        setProjects(savedProjects)
        const rememberedId = getActiveProjectId()
        const projectToOpen =
          savedProjects.find((project) => project.id === rememberedId) ??
          savedProjects[0]
        if (projectToOpen) {
          const saved = await loadProject(projectToOpen.id)
          if (!active || !saved) return
          const restored = restoreStoredDocument(saved)
          loadDocument(restored)
          setActiveProjectId(projectToOpen.id)
          rememberActiveProject(projectToOpen.id)
        }
      } catch {
        notify('Local autosave could not be restored. The editor still works normally.', 'warning')
      } finally {
        if (active) setHydrated(true)
      }
    }
    void hydrate()
    return () => {
      active = false
    }
  }, [loadDocument])

  useEffect(() => {
    if (!hydrated || !activeProjectId) return
    const timeout = window.setTimeout(() => {
      persistProject(activeProjectId, document)
        .then((summary) =>
          setProjects((current) =>
            [summary, ...current.filter((project) => project.id !== summary.id)]
              .sort((left, right) => right.updatedAt - left.updatedAt),
          ),
        )
        .catch(() => notify('Autosave is temporarily unavailable.', 'warning'))
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [activeProjectId, document, hydrated])

  useEffect(() => {
    let active = true
    const generatedUrls: string[] = []
    const loadPreviews = async () => {
      const previewProjects = JSON.parse(projectPreviewSignature) as Array<
        readonly [string, string]
      >
      const entries = await Promise.all(
        previewProjects.map(async ([projectId]) => {
          try {
            const saved = await loadProject(projectId)
            if (!saved) return [projectId, undefined] as const
            if (saved.imageBlob) {
              const source = URL.createObjectURL(saved.imageBlob)
              generatedUrls.push(source)
              return [projectId, source] as const
            }
            const storedDocument = saved.document as Partial<EditorDocument>
            return [projectId, storedDocument.image?.src || undefined] as const
          } catch {
            return [projectId, undefined] as const
          }
        }),
      )
      if (!active) {
        generatedUrls.forEach((source) => URL.revokeObjectURL(source))
        return
      }
      setProjectPreviews(Object.fromEntries(entries))
    }
    void loadPreviews()
    return () => {
      active = false
      generatedUrls.forEach((source) => URL.revokeObjectURL(source))
    }
  }, [projectPreviewSignature])

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
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'x'
      ) {
        event.preventDefault()
        deleteSelectedFaces()
        return
      }
      const toolShortcut = {
        v: 'select',
        a: 'anchor',
        g: 'plane',
        e: 'extrude',
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
  }, [
    deleteSelectedFaces,
    redo,
    selectAllFaces,
    selectedEvidenceIds,
    setTool,
    setVariant,
    undo,
  ])

  const openImagePicker = () => {
    imageInputRef.current?.click()
  }

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
      const currentSummary = activeProjectId
        ? await persistProject(activeProjectId, document)
        : undefined
      const key = crypto.randomUUID()
      await persistImage(key, file)
      const importedImage = {
        key,
        name: file.name,
        src: source,
        width: image.naturalWidth,
        height: image.naturalHeight,
        mime: file.type,
      }
      const projectId = crypto.randomUUID()
      const nextDocument = createEmptyDocument()
      nextDocument.projectName = projectNameFromFile(file)
      nextDocument.image = importedImage
      const summary = await persistProject(projectId, nextDocument)
      revokeObjectUrl(document.image.src)
      loadDocument(nextDocument)
      setActiveProjectId(projectId)
      rememberActiveProject(projectId)
      setProjects((current) => [
        summary,
        ...(currentSummary ? [currentSummary] : []),
        ...current.filter(
          (project) =>
            project.id !== projectId && project.id !== activeProjectId,
        ),
      ])
      notify('Project created. Click four corners to create the base faces.', 'success')
    } catch {
      URL.revokeObjectURL(source)
      notify('The selected image could not be decoded.', 'warning')
    }
  }

  const exportProject = async () => {
    if (!activeProjectId) return
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
      const projectId = crypto.randomUUID()
      const summary = await persistProject(projectId, restored)
      revokeObjectUrl(document.image.src)
      loadDocument(restored)
      setActiveProjectId(projectId)
      rememberActiveProject(projectId)
      setProjects((current) => [
        summary,
        ...current.filter((project) => project.id !== projectId),
      ])
      notify('Project loaded and saved on this device.', 'success')
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'The project bundle is invalid.',
        'warning',
      )
    }
  }

  const importExampleProject = async (exampleId: ExampleProjectId) => {
    try {
      const example = exampleProjects.find((candidate) => candidate.id === exampleId)
      if (!example) throw new Error('Example project unavailable.')
      const response = await fetch(example.imageSrc)
      if (!response.ok) throw new Error('Example image unavailable.')
      const imageBlob = await response.blob()
      const key = crypto.randomUUID()
      const projectId = crypto.randomUUID()
      const source = URL.createObjectURL(imageBlob)
      const restored = createExampleDocument(exampleId)
      restored.projectName = uniqueProjectName(example.name, projects)
      restored.image.key = key
      restored.image.name = example.imageName
      restored.image.src = source
      restored.image.mime = imageBlob.type || example.imageMime
      await persistImage(key, imageBlob)
      const summary = await persistProject(projectId, restored)
      revokeObjectUrl(document.image.src)
      loadDocument(restored)
      setActiveProjectId(projectId)
      rememberActiveProject(projectId)
      setProjects((current) => [
        summary,
        ...current.filter((project) => project.id !== projectId),
      ])
      notify('Example imported and saved as a project.', 'success')
    } catch {
      notify('The example project could not be imported.', 'warning')
    }
  }

  const selectProject = async (projectId: string) => {
    if (projectId === activeProjectId) return
    try {
      if (activeProjectId) {
        const currentSummary = await persistProject(activeProjectId, document)
        setProjects((current) => [
          currentSummary,
          ...current.filter((project) => project.id !== activeProjectId),
        ])
      }
      const saved = await loadProject(projectId)
      if (!saved) throw new Error('This project is no longer available.')
      const restored = restoreStoredDocument(saved)
      const selectedSummary = await persistProject(projectId, restored)
      revokeObjectUrl(document.image.src)
      loadDocument(restored)
      setActiveProjectId(projectId)
      rememberActiveProject(projectId)
      setProjects((current) =>
        [
          selectedSummary,
          ...current.filter((project) => project.id !== projectId),
        ].sort((left, right) => right.updatedAt - left.updatedAt),
      )
      notify(`Opened ${restored.projectName}.`, 'success')
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'The project could not be opened.',
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
          ? worldAlignedFaceQuad(state.document.scene, meshFace)
          : undefined
        if (!meshFace || !profile || !referenceUrl || !quad) return null
        const [sample, reference] = await Promise.all([
          warpQuad(state.document.image.src, quad, 96),
          imageToPixels(referenceUrl, 96),
        ])
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

  const confirmClearAllData = async () => {
    try {
      await clearAllData()
      revokeObjectUrl(document.image.src)
      resetProject()
      setActiveProjectId(null)
      setProjects([])
      setClearDialogOpen(false)
      notify('All local projects and images were cleared.', 'info')
    } catch {
      notify('Local data could not be cleared.', 'warning')
    }
  }

  return (
    <div className="app">
      <TopBar
        activeProjectId={activeProjectId}
        projects={projects}
        onOpenImage={openImagePicker}
        onOpenProjects={() => setProjectDialogOpen(true)}
      />
      <main className={activeProjectId ? 'workspace' : 'workspace no-project'}>
        {hydrated && activeProjectId ? (
          <>
            <ToolRail />
            <EditorCanvas />
            <Inspector
              busy={busy}
              onOpenImage={openImagePicker}
              onAutoFill={autoFill}
            />
          </>
        ) : (
          <>
            <div className="project-empty-rail" aria-hidden="true" />
            <section className="canvas-shell empty-project-canvas">
              <div className="project-start-card">
                {hydrated ? (
                  <>
                    <div className="project-start-mark" aria-hidden="true">
                      <Crosshair size={23} />
                    </div>
                    <span className="project-start-eyebrow">Local workspace</span>
                    <h1>Start a project</h1>
                    <p>
                      Open a Minecraft screenshot, or explore the editor with
                      the bundled example.
                    </p>
                    <button
                      className="primary-button project-start-action"
                      type="button"
                      onClick={openImagePicker}
                    >
                      <ImagePlus size={17} />
                      Upload an image
                    </button>
                    <button
                      className="secondary-button project-start-action"
                      type="button"
                      onClick={() => setProjectDialogOpen(true)}
                    >
                      <Sparkles size={17} />
                      Browse examples
                    </button>
                    <small>
                      <ShieldCheck size={13} />
                      Images and projects stay on this device.
                    </small>
                  </>
                ) : (
                  <div className="project-start-loading">
                    <LoaderCircle className="spin" size={22} />
                    <span>Loading local projects…</span>
                  </div>
                )}
              </div>
            </section>
            <aside className="inspector empty-project-inspector">
              <div className="empty-inspector">
                <Crosshair size={28} />
                <h3>No project open</h3>
                <p>
                  Create a project from the canvas, or open a saved project
                  from the Project menu.
                </p>
              </div>
            </aside>
          </>
        )}
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
      <ProjectDialog
        activeProjectId={activeProjectId}
        open={projectDialogOpen}
        previews={projectPreviews}
        projects={projects}
        onClose={() => setProjectDialogOpen(false)}
        onSelectProject={(projectId) => void selectProject(projectId)}
        onNewProject={openImagePicker}
        onImportProject={() => projectInputRef.current?.click()}
        onImportExample={(exampleId) => void importExampleProject(exampleId)}
        onExportProject={() => void exportProject()}
        onRequestClearData={() => setClearDialogOpen(true)}
      />
      {clearDialogOpen && (
        <div className="modal-backdrop">
          <section
            className="warning-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-data-title"
          >
            <div className="warning-dialog-icon" aria-hidden="true">
              <AlertTriangle size={22} />
            </div>
            <div>
              <span className="warning-dialog-eyebrow">Permanent action</span>
              <h2 id="clear-data-title">Clear all local data?</h2>
            </div>
            <p>
              This permanently removes every saved project and source image
              from this browser. Export anything you want to keep first.
            </p>
            <div className="warning-dialog-actions">
              <button
                className="secondary-button"
                type="button"
                autoFocus
                onClick={() => setClearDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => void confirmClearAllData()}
              >
                Clear all data
              </button>
            </div>
          </section>
        </div>
      )}
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
