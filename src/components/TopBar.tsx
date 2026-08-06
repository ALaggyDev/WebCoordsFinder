import {
  BoxSelect,
  Download,
  FileImage,
  FolderOpen,
  Grid3X3,
  ImagePlus,
  Keyboard,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EditorStep } from '../domain/types'
import type { ProjectSummary } from '../storage/db'
import { useEditorStore } from '../store/editorStore'

// Navigation stays available so each workspace can explain its own missing
// prerequisites instead of hiding the next stage of the workflow.
const steps: Array<{
  id: EditorStep
  label: string
  icon: typeof FileImage
}> = [
  { id: 'image', label: 'Image', icon: FileImage },
  { id: 'grid', label: 'Geometry', icon: Grid3X3 },
  { id: 'faces', label: 'Faces', icon: BoxSelect },
  { id: 'export', label: 'Export', icon: Download },
]

interface TopBarProps {
  activeProjectId: string | null
  projects: ProjectSummary[]
  onOpenImage: () => void
  onOpenProjects: () => void
}

export function TopBar({
  activeProjectId,
  projects,
  onOpenImage,
  onOpenProjects,
}: TopBarProps) {
  const [keybindingsOpen, setKeybindingsOpen] = useState(false)
  const step = useEditorStore((state) => state.step)
  const setStep = useEditorStore((state) => state.setStep)
  const activeProject = projects.find((project) => project.id === activeProjectId)

  useEffect(() => {
    if (!keybindingsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setKeybindingsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [keybindingsOpen])

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
        <div>
          <strong>WebCoordsFinder</strong>
          <span>Coordinates Cracking Studio</span>
        </div>
      </div>
      <nav className="workflow" aria-label="Project workflow">
        {steps.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={step === id ? 'workflow-step active' : 'workflow-step'}
            onClick={() => setStep(id)}
            type="button"
            disabled={!activeProjectId}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="keybindings-menu topbar-keybindings-slot">
          <button
            className="icon-button topbar-keybindings"
            type="button"
            aria-label="Keybindings"
            aria-haspopup="dialog"
            aria-expanded={keybindingsOpen}
            onClick={() => setKeybindingsOpen((open) => !open)}
          >
            <Keyboard size={16} />
          </button>
          {keybindingsOpen && (
            <section
              className="keybindings-popup"
              role="dialog"
              aria-label="Keybindings"
            >
              <div className="keybindings-header">
                <div>
                  <h2>Keybindings</h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Close keybindings"
                  onClick={() => setKeybindingsOpen(false)}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="keybindings-list">
                <div><kbd>Left click</kbd><b>+</b><kbd>Drag</kbd><span>Pan</span></div>
                <div><kbd>Left click</kbd><span>Select</span></div>
                <div><kbd>Shift</kbd><b>+</b><kbd>Left click</kbd><span>Select multiple</span></div>
                <div><kbd>Ctrl</kbd><b>+</b><kbd>Left click</kbd><span>Box select</span></div>
                <div><kbd>Right click</kbd><span>Delete white calibration point</span></div>
                <div><kbd>A</kbd><span>Select anchor block</span></div>
                <div><kbd>G</kbd><span>Draw initial grid</span></div>
                <div><kbd>E</kbd><span>Extrude selected edges</span></div>
                <div><kbd>D</kbd><span>Set World Orientation</span></div>
                <div><kbd>X</kbd> / <kbd>Backspace</kbd> / <kbd>Del</kbd><span>Delete selected faces</span></div>
                <div><kbd>Ctrl</kbd><b>+</b><kbd>A</kbd><span>Select all faces</span></div>
                <div><kbd>Ctrl</kbd><b>+</b><kbd>Z</kbd><span>Undo</span></div>
                <div><kbd>Ctrl</kbd><b>+</b><kbd>Shift</kbd><b>+</b><kbd>Z</kbd><span>Redo</span></div>
                <div><kbd>Ctrl</kbd><b>+</b><kbd>Y</kbd><span>Redo</span></div>
                <div><kbd>0</kbd>–<kbd>3</kbd><span>Set visible texture variant</span></div>
                <div><kbd>Esc</kbd><span>Close an open popup or dialog</span></div>
              </div>
            </section>
          )}
      </div>
      <div className="topbar-actions">
        <button
          className="primary-button compact topbar-open-image"
          type="button"
          onClick={onOpenImage}
        >
          <ImagePlus size={15} />
          Open image
        </button>
        <button
          className="project-menu-trigger"
          type="button"
          aria-haspopup="dialog"
          onClick={onOpenProjects}
        >
          <FolderOpen size={16} />
          <span>
            <small>Project</small>
            <strong>{activeProject?.name ?? 'No project open'}</strong>
          </span>
        </button>
      </div>
    </header>
  )
}
