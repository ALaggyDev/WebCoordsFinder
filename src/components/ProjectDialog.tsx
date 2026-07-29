import { useEffect } from 'react'
import {
  Check,
  Download,
  FileImage,
  FolderOpen,
  ImagePlus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  exampleProjects,
  type ExampleProjectId,
} from '../domain/examples'
import type { ProjectSummary } from '../storage/db'

// The dialog presents saved and example projects without owning persistence;
// App performs each action and supplies refreshed summaries and preview URLs.
interface ProjectDialogProps {
  activeProjectId: string | null
  open: boolean
  previews: Record<string, string | undefined>
  projects: ProjectSummary[]
  onClose: () => void
  onSelectProject: (id: string) => void
  onNewProject: () => void
  onImportProject: () => void
  onImportExample: (id: ExampleProjectId) => void
  onExportProject: () => void
  onRequestClearData: () => void
}

function updatedLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

export function ProjectDialog({
  activeProjectId,
  open,
  previews,
  projects,
  onClose,
  onSelectProject,
  onNewProject,
  onImportProject,
  onImportExample,
  onExportProject,
  onRequestClearData,
}: ProjectDialogProps) {
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

  if (!open) return null

  const runAction = (action: () => void) => {
    // Close first so file pickers and project switches never leave a stale
    // modal over the newly active workspace.
    onClose()
    action()
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
              <h2 id="project-dialog-title">Projects</h2>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close project menu"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="project-dialog-toolbar">
          <button
            className="primary-button"
            type="button"
            onClick={() => runAction(onNewProject)}
          >
            <ImagePlus size={15} />
            New from image
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => runAction(onImportProject)}
          >
            <Upload size={15} />
            Load project
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!activeProjectId}
            onClick={() => runAction(onExportProject)}
          >
            <Download size={15} />
            Export current
          </button>
        </div>

        <div className="project-dialog-content">
          <section className="project-library-section">
            <div className="project-library-heading">
              <div>
                <span>Your workspace</span>
                <h3>Saved projects</h3>
              </div>
              <small>{projects.length}</small>
            </div>
            {projects.length === 0 ? (
              <div className="project-library-empty">
                <FileImage size={22} />
                <strong>No saved projects yet</strong>
                <span>Start from an image or import an example below.</span>
              </div>
            ) : (
              <div className="project-card-grid">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    className={
                      project.id === activeProjectId
                        ? 'project-card active'
                        : 'project-card'
                    }
                    type="button"
                    onClick={() =>
                      runAction(() => onSelectProject(project.id))
                    }
                  >
                    <div className="project-card-preview">
                      {previews[project.id] ? (
                        <img src={previews[project.id]} alt="" />
                      ) : (
                        <FileImage size={24} />
                      )}
                      {project.id === activeProjectId && (
                        <span className="project-card-current">
                          <Check size={11} />
                          Current
                        </span>
                      )}
                    </div>
                    <span className="project-card-copy">
                      <strong>{project.name}</strong>
                      <small>{project.imageName}</small>
                      <time dateTime={new Date(project.updatedAt).toISOString()}>
                        Updated {updatedLabel(project.updatedAt)}
                      </time>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="project-library-section examples">
            <div className="project-library-heading">
              <div>
                <span>Learn by exploring</span>
                <h3>Example projects</h3>
              </div>
              <small>{exampleProjects.length}</small>
            </div>
            <div className="example-project-grid">
              {exampleProjects.map((example) => (
                <button
                  key={example.id}
                  className="example-project-card"
                  type="button"
                  onClick={() =>
                    runAction(() => onImportExample(example.id))
                  }
                >
                  <img src={example.imageSrc} alt="" />
                  <span>
                    <strong>{example.name}</strong>
                    <small>{example.description}</small>
                    <b><Sparkles size={12} /> Import example</b>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="project-dialog-footer">
          <span>Projects and source images stay in this browser.</span>
          <button
            className="danger-button"
            type="button"
            disabled={projects.length === 0}
            onClick={() => runAction(onRequestClearData)}
          >
            <Trash2 size={14} />
            Clear all data
          </button>
        </footer>
      </section>
    </div>
  )
}
