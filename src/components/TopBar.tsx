import {
  BoxSelect,
  Crosshair,
  Download,
  FileImage,
  FolderOpen,
  Grid3X3,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react'
import type { EditorStep } from '../domain/types'
import { useEditorStore } from '../store/editorStore'

const steps: Array<{
  id: EditorStep
  label: string
  icon: typeof FileImage
}> = [
  { id: 'image', label: 'Image', icon: FileImage },
  { id: 'grid', label: 'Grid', icon: Grid3X3 },
  { id: 'faces', label: 'Faces', icon: BoxSelect },
  { id: 'review', label: 'Review', icon: ScanSearch },
  { id: 'export', label: 'Export', icon: Download },
]

interface TopBarProps {
  onOpenImage: () => void
  onImportProject: () => void
  onExportProject: () => void
}

export function TopBar({
  onOpenImage,
  onImportProject,
  onExportProject,
}: TopBarProps) {
  const step = useEditorStore((state) => state.step)
  const setStep = useEditorStore((state) => state.setStep)

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <Crosshair size={19} />
        </div>
        <div>
          <strong>WebCoordsFinder</strong>
          <span>Texture evidence workbench</span>
        </div>
      </div>
      <nav className="workflow" aria-label="Project workflow">
        {steps.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            className={step === id ? 'workflow-step active' : 'workflow-step'}
            onClick={() => setStep(id)}
            type="button"
          >
            <span className="step-index">{index + 1}</span>
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        <div className="privacy-badge" title="Screenshots never leave this device">
          <ShieldCheck size={14} />
          Local only
        </div>
        <button className="icon-button" type="button" onClick={onImportProject} title="Open .wcf project">
          <FolderOpen size={17} />
        </button>
        <button className="secondary-button compact" type="button" onClick={onExportProject}>
          Save project
        </button>
        <button className="primary-button compact" type="button" onClick={onOpenImage}>
          Open image
        </button>
      </div>
    </header>
  )
}
