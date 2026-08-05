import {
  BoxSelect,
  Crosshair,
  Download,
  FileImage,
  FolderOpen,
  Grid3X3,
  ImagePlus,
} from 'lucide-react'
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
  const step = useEditorStore((state) => state.step)
  const setStep = useEditorStore((state) => state.setStep)
  const activeProject = projects.find((project) => project.id === activeProjectId)

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <Crosshair size={19} />
        </div>
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
