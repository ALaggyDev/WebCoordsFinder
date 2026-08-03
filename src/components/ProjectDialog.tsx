import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Download,
  FileImage,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  exampleProjects,
  type ExampleProjectId,
} from '../domain/examples'
import type { EditorDocument, TextureAlgorithm } from '../domain/types'
import type { ProjectSummary } from '../storage/db'

export type ProjectDialogTab = 'projects' | 'examples'

export type ExampleProjectState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready'
      document: EditorDocument
      imageBlob?: Blob
      preview?: string
    }

interface ProjectDialogProps {
  activeProjectId: string | null
  exampleStates: Partial<Record<ExampleProjectId, ExampleProjectState>>
  initialTab: ProjectDialogTab
  open: boolean
  previews: Record<string, string | undefined>
  projects: ProjectSummary[]
  onClose: () => void
  onSelectProject: (id: string) => void
  onNewProject: () => void
  onImportProject: () => void
  onImportExample: (id: ExampleProjectId, includeAnnotations: boolean) => void
  onExportProject: (id: string) => void
  onRenameProject: (id: string, name: string) => void
  onRequestDeleteProject: (id: string) => void
  onRequestClearData: () => void
}

interface ProjectDetails {
  name: string
  imageName: string
  imageWidth: number
  imageHeight: number
  faceCount: number
  evidenceCount: number
  confirmedCount: number
  proposedCount: number
  anchorSet: boolean
  compassResolved: boolean
  textureAlgorithm: TextureAlgorithm
}

function updatedLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function detailsFromDocument(document: EditorDocument): ProjectDetails {
  return {
    name: document.projectName.trim() || 'Untitled project',
    imageName: document.image.name || 'No image',
    imageWidth: document.image.width,
    imageHeight: document.image.height,
    faceCount: document.scene.faces.length,
    evidenceCount: document.evidence.length,
    confirmedCount: document.evidence.filter(
      (entry) => entry.reviewStatus === 'confirmed',
    ).length,
    proposedCount: document.evidence.filter(
      (entry) => entry.reviewStatus === 'proposed',
    ).length,
    anchorSet: Boolean(document.anchorFaceId),
    compassResolved: document.scanner.compassResolved,
    textureAlgorithm: document.scanner.textureAlgorithm,
  }
}

function ProjectPreview({ source, name }: { source?: string; name: string }) {
  return (
    <div className="project-detail-preview">
      {source ? (
        <img src={source} alt={`${name} preview`} />
      ) : (
        <div className="project-detail-preview-empty">
          <FileImage size={28} />
          <span>Preview unavailable</span>
        </div>
      )}
    </div>
  )
}

function ProjectInformation({
  details,
  current,
  description,
  preview,
  renameEditor,
  onBeginRename,
  updatedAt,
}: {
  details: ProjectDetails
  current?: boolean
  description?: string
  preview?: string
  renameEditor?: {
    value: string
    onChange: (value: string) => void
    onCancel: () => void
    onSave: () => void
  }
  onBeginRename?: () => void
  updatedAt?: number
}) {
  const completion = details.evidenceCount
    ? Math.round((details.confirmedCount / details.evidenceCount) * 100)
    : 0

  return (
    <>
      <ProjectPreview source={preview} name={details.name} />
      <div className="project-detail-heading">
        <div>
          {renameEditor ? (
            <form
              className="project-rename-form"
              onSubmit={(event) => {
                event.preventDefault()
                renameEditor.onSave()
              }}
            >
              <input
                autoFocus
                aria-label="Project name"
                maxLength={120}
                value={renameEditor.value}
                onChange={(event) => renameEditor.onChange(event.target.value)}
              />
              <button
                className="icon-button"
                type="submit"
                disabled={!renameEditor.value.trim()}
                aria-label="Save project name"
              >
                <Check size={14} />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Cancel rename"
                onClick={renameEditor.onCancel}
              >
                <X size={14} />
              </button>
            </form>
          ) : (
            <div className="project-detail-name-row">
              <h3>{details.name}</h3>
              {onBeginRename && (
                <button
                  className="icon-button project-rename-button"
                  type="button"
                  aria-label={`Rename ${details.name}`}
                  onClick={onBeginRename}
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
          )}
          <p>
            {details.imageName}
            {details.imageWidth > 0 && details.imageHeight > 0
              ? ` · ${details.imageWidth} × ${details.imageHeight}`
              : ''}
          </p>
        </div>
        {current && (
          <span className="project-current-badge">
            <Check size={11} /> Current
          </span>
        )}
      </div>
      {description && <p className="project-detail-description">{description}</p>}
      {updatedAt && (
        <time
          className="project-detail-updated"
          dateTime={new Date(updatedAt).toISOString()}
        >
          Updated {updatedLabel(updatedAt)}
        </time>
      )}
      <div className="project-detail-stats">
        <span><strong>{details.faceCount}</strong>Faces</span>
        <span><strong>{details.evidenceCount}</strong>Evidence</span>
        <span><strong>{details.confirmedCount}</strong>Confirmed</span>
        <span><strong>{details.proposedCount}</strong>Proposed</span>
      </div>
      <div className="project-review-progress">
        <div>
          <span>Review progress</span>
          <strong>{completion}%</strong>
        </div>
        <span aria-hidden="true">
          <i style={{ width: `${completion}%` }} />
        </span>
      </div>
      <div className="project-detail-status">
        <span className={details.anchorSet ? 'ready' : ''}>
          Anchor {details.anchorSet ? 'set' : 'not set'}
        </span>
        <span className={details.compassResolved ? 'ready' : ''}>
          Compass {details.compassResolved ? 'resolved' : 'unresolved'}
        </span>
        <span>{details.textureAlgorithm}</span>
      </div>
    </>
  )
}

export function ProjectDialog({
  activeProjectId,
  exampleStates,
  initialTab,
  open,
  previews,
  projects,
  onClose,
  onSelectProject,
  onNewProject,
  onImportProject,
  onImportExample,
  onExportProject,
  onRenameProject,
  onRequestDeleteProject,
  onRequestClearData,
}: ProjectDialogProps) {
  const [tab, setTab] = useState<ProjectDialogTab>(initialTab)
  const [query, setQuery] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [selectedExampleId, setSelectedExampleId] =
    useState<ExampleProjectId>(exampleProjects[0].id)
  const [includeExampleAnnotations, setIncludeExampleAnnotations] = useState(true)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true
      setTab(initialTab)
      setQuery('')
      setSelectedProjectId(activeProjectId ?? projects[0]?.id ?? null)
      setRenamingProjectId(null)
      setSelectedExampleId(exampleProjects[0].id)
      setIncludeExampleAnnotations(true)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [activeProjectId, initialTab, onClose, open, projects])

  useEffect(() => {
    if (
      selectedProjectId &&
      !projects.some((project) => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(activeProjectId ?? projects[0]?.id ?? null)
    }
  }, [activeProjectId, projects, selectedProjectId])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) =>
        `${project.name} ${project.imageName}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [normalizedQuery, projects],
  )
  const filteredExamples = useMemo(
    () =>
      exampleProjects.filter((example) =>
        `${example.name} ${example.description}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [normalizedQuery],
  )

  if (!open) return null

  const selectedProject =
    filteredProjects.find((project) => project.id === selectedProjectId) ??
    filteredProjects[0]
  const selectedExample =
    filteredExamples.find((example) => example.id === selectedExampleId) ??
    filteredExamples[0]
  const selectedExampleState = selectedExample
    ? exampleStates[selectedExample.id]
    : undefined

  const runAction = (action: () => void) => {
    onClose()
    action()
  }
  const changeTab = (nextTab: ProjectDialogTab) => {
    setTab(nextTab)
    setQuery('')
  }
  const openProject = (id: string) => {
    if (id !== activeProjectId) runAction(() => onSelectProject(id))
  }
  const beginRename = (project: ProjectSummary) => {
    setRenamingProjectId(project.id)
    setRenameDraft(project.name)
  }
  const cancelRename = () => {
    setRenamingProjectId(null)
    setRenameDraft('')
  }
  const saveRename = (project: ProjectSummary) => {
    const nextName = renameDraft.trim()
    if (!nextName) return
    if (nextName !== project.name) onRenameProject(project.id, nextName)
    cancelRename()
  }

  return (
    <div
      className="project-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
      >
        <header className="project-dialog-header">
          <div className="project-dialog-title">
            <div aria-hidden="true"><FolderOpen size={20} /></div>
            <div>
              <span>Local workspace</span>
              <h2 id="project-dialog-title">Project library</h2>
            </div>
          </div>
          <div className="project-dialog-header-actions">
            <button
              className="primary-button compact"
              type="button"
              onClick={() => runAction(onNewProject)}
            >
              <ImagePlus size={15} /> New from image
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => runAction(onImportProject)}
            >
              <Upload size={15} /> Import .wcf
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Close project menu"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="project-dialog-tabs" role="tablist" aria-label="Project source">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'projects'}
            className={tab === 'projects' ? 'active' : ''}
            onClick={() => changeTab('projects')}
          >
            Projects <small>{projects.length}</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'examples'}
            className={tab === 'examples' ? 'active' : ''}
            onClick={() => changeTab('examples')}
          >
            Examples <small>{exampleProjects.length}</small>
          </button>
        </div>

        <div className="project-dialog-content">
          <aside className="project-list-pane">
            <label className="project-search">
              <Search size={14} />
              <input
                type="search"
                value={query}
                placeholder={`Search ${tab}`}
                aria-label={`Search ${tab}`}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="project-list" aria-label={tab === 'projects' ? 'Saved projects' : 'Example projects'}>
              {tab === 'projects' ? (
                filteredProjects.length ? (
                  filteredProjects.map((project) => (
                    <button
                      key={project.id}
                      className={
                        project.id === selectedProject?.id
                          ? 'project-list-row selected'
                          : 'project-list-row'
                      }
                      type="button"
                      onClick={() => {
                        cancelRename()
                        setSelectedProjectId(project.id)
                      }}
                      onDoubleClick={() => openProject(project.id)}
                    >
                      <span className="project-list-thumbnail">
                        {previews[project.id] ? (
                          <img src={previews[project.id]} alt="" />
                        ) : (
                          <FileImage size={18} />
                        )}
                      </span>
                      <span className="project-list-copy">
                        <strong>{project.name}</strong>
                        <small>{project.imageName}</small>
                        <time dateTime={new Date(project.updatedAt).toISOString()}>
                          Updated {updatedLabel(project.updatedAt)}
                        </time>
                      </span>
                      {project.id === activeProjectId && (
                        <span className="project-list-current" title="Current project" />
                      )}
                    </button>
                  ))
                ) : (
                  <div className="project-list-empty">
                    <FileImage size={22} />
                    <strong>{projects.length ? 'No matching projects' : 'No saved projects yet'}</strong>
                    <span>{projects.length ? 'Try a different search.' : 'Start from an image or import a project.'}</span>
                  </div>
                )
              ) : filteredExamples.length ? (
                filteredExamples.map((example) => {
                  const state = exampleStates[example.id]
                  return (
                    <button
                      key={example.id}
                      className={
                        example.id === selectedExample?.id
                          ? 'project-list-row selected'
                          : 'project-list-row'
                      }
                      type="button"
                      onClick={() => setSelectedExampleId(example.id)}
                    >
                      <span className="project-list-thumbnail">
                        {state?.status === 'ready' && state.preview ? (
                          <img src={state.preview} alt="" />
                        ) : (
                          <Sparkles size={18} />
                        )}
                      </span>
                      <span className="project-list-copy">
                        <strong>{example.name}</strong>
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="project-list-empty">
                  <Search size={22} />
                  <strong>No matching examples</strong>
                  <span>Try a different search.</span>
                </div>
              )}
            </div>
          </aside>

          <section className="project-detail-pane">
            {tab === 'projects' ? (
              selectedProject ? (
                <>
                  <div className="project-detail-scroll">
                    <ProjectInformation
                      details={selectedProject}
                      current={selectedProject.id === activeProjectId}
                      onBeginRename={() => beginRename(selectedProject)}
                      preview={previews[selectedProject.id]}
                      renameEditor={
                        renamingProjectId === selectedProject.id
                          ? {
                              value: renameDraft,
                              onChange: setRenameDraft,
                              onCancel: cancelRename,
                              onSave: () => saveRename(selectedProject),
                            }
                          : undefined
                      }
                      updatedAt={selectedProject.updatedAt}
                    />
                  </div>
                  <div className="project-detail-actions">
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => onRequestDeleteProject(selectedProject.id)}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                    <span />
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => runAction(() => onExportProject(selectedProject.id))}
                    >
                      <Download size={14} /> Export
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={selectedProject.id === activeProjectId}
                      onClick={() => openProject(selectedProject.id)}
                    >
                      <FolderOpen size={14} />
                      {selectedProject.id === activeProjectId ? 'Already open' : 'Open project'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="project-detail-empty">
                  <ImagePlus size={30} />
                  <h3>{projects.length ? 'No project selected' : 'Create your first project'}</h3>
                  <p>{projects.length ? 'Choose a project from the list.' : 'Open a Minecraft screenshot or import a portable project bundle.'}</p>
                  {!projects.length && (
                    <div>
                      <button className="primary-button" type="button" onClick={() => runAction(onNewProject)}>
                        <ImagePlus size={14} /> New from image
                      </button>
                      <button className="secondary-button" type="button" onClick={() => runAction(onImportProject)}>
                        <Upload size={14} /> Import .wcf
                      </button>
                    </div>
                  )}
                </div>
              )
            ) : selectedExample ? (
              selectedExampleState?.status === 'ready' ? (
                <>
                  <div className="project-detail-scroll">
                    <ProjectInformation
                      details={detailsFromDocument(selectedExampleState.document)}
                      description={selectedExample.description}
                      preview={selectedExampleState.preview}
                    />
                  </div>
                  <div className="project-detail-actions example-actions">
                    <label className="check-field example-import-option">
                      <input
                        type="checkbox"
                        checked={includeExampleAnnotations}
                        onChange={(event) =>
                          setIncludeExampleAnnotations(event.target.checked)
                        }
                      />
                      Include analysis
                    </label>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() =>
                        runAction(() =>
                          onImportExample(
                            selectedExample.id,
                            includeExampleAnnotations,
                          ),
                        )
                      }
                    >
                      <Sparkles size={14} /> Use example
                    </button>
                  </div>
                </>
              ) : selectedExampleState?.status === 'error' ? (
                <div className="project-detail-empty">
                  <FileImage size={30} />
                  <h3>Example unavailable</h3>
                  <p>The bundled project could not be read.</p>
                </div>
              ) : (
                <div className="project-detail-empty">
                  <LoaderCircle className="spin" size={28} />
                  <h3>Loading example…</h3>
                  <p>Reading the bundled project and source image.</p>
                </div>
              )
            ) : (
              <div className="project-detail-empty">
                <Search size={30} />
                <h3>No example selected</h3>
                <p>Choose an example from the list.</p>
              </div>
            )}
          </section>
        </div>

        <footer className="project-dialog-footer">
          <span>Projects and source images stay in this browser.</span>
          {tab === 'projects' && (
            <button
              className="danger-button compact"
              type="button"
              disabled={projects.length === 0}
              onClick={() => runAction(onRequestClearData)}
            >
              <Trash2 size={14} /> Clear all data
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
