import {
  ArrowLeft,
  BoxSelect,
  Check,
  Crosshair,
  Download,
  FolderOpen,
  Grid3X3,
  ImagePlus,
  Keyboard,
  Palette,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EditorStep } from '../domain/types'
import type { AppPath } from '../domain/appRoutes'
import type { ProjectSummary } from '../storage/db'
import { useEditorStore } from '../store/editorStore'

// Navigation stays available so each workspace can explain its own missing
// prerequisites instead of hiding the next stage of the workflow.
const steps: Array<{
  id: EditorStep
  label: string
  icon: typeof Grid3X3
}> = [
  { id: 'grid', label: 'Geometry', icon: Grid3X3 },
  { id: 'faces', label: 'Faces', icon: BoxSelect },
  { id: 'export', label: 'Export', icon: Download },
]

type ColorTheme = 'blue' | 'green' | 'purple' | 'white'

const themeOptions: Array<{ id: ColorTheme; label: string }> = [
  { id: 'blue', label: 'Blue' },
  { id: 'green', label: 'Green' },
  { id: 'purple', label: 'Purple' },
  { id: 'white', label: 'White' },
]

const isColorTheme = (value: string | null): value is ColorTheme =>
  value === 'blue' ||
  value === 'green' ||
  value === 'purple' ||
  value === 'white'

const getInitialTheme = (): ColorTheme => {
  if (typeof window === 'undefined') return 'blue'
  try {
    const savedTheme = window.localStorage.getItem('webcoordsfinder-theme')
    if (savedTheme === 'pink') return 'purple'
    return isColorTheme(savedTheme) ? savedTheme : 'blue'
  } catch {
    return 'blue'
  }
}

interface TopBarProps {
  activeProjectId: string | null
  currentPath?: AppPath
  projects: ProjectSummary[]
  onNavigate?: (path: AppPath) => void
  onOpenImage: () => void
  onOpenProjects: () => void
}

export function TopBar({
  activeProjectId,
  currentPath = '/',
  projects,
  onNavigate = () => undefined,
  onOpenImage,
  onOpenProjects,
}: TopBarProps) {
  const [keybindingsOpen, setKeybindingsOpen] = useState(false)
  const [infoMenuOpen, setInfoMenuOpen] = useState(false)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [theme, setTheme] = useState<ColorTheme>(getInitialTheme)
  const step = useEditorStore((state) => state.step)
  const setStep = useEditorStore((state) => state.setStep)
  const activeProject = projects.find((project) => project.id === activeProjectId)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('webcoordsfinder-theme', theme)
    } catch {
      // The theme still works for this session when browser storage is blocked.
    }
  }, [theme])

  useEffect(() => {
    if (!keybindingsOpen && !themeMenuOpen && !infoMenuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setKeybindingsOpen(false)
      setThemeMenuOpen(false)
      setInfoMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [infoMenuOpen, keybindingsOpen, themeMenuOpen])

  const navigate = (path: AppPath) => {
    setInfoMenuOpen(false)
    onNavigate(path)
  }

  return (
    <header className={currentPath === '/' ? 'topbar' : 'topbar info-topbar'}>
      <div className="topbar-content">
      <div className="topbar-brand-area">
        <button className="brand" type="button" onClick={() => navigate('/')}>
          <span className="brand-mark" aria-hidden="true">
            <Crosshair size={27} />
          </span>
          <strong>WebCoordsFinder</strong>
        </button>
        {currentPath === '/' ? (
          <div className="info-menu">
            <button
              className="topbar-info"
              type="button"
              aria-label="Information pages"
              aria-haspopup="menu"
              aria-expanded={infoMenuOpen}
              onClick={() => {
                setInfoMenuOpen((open) => !open)
                setThemeMenuOpen(false)
                setKeybindingsOpen(false)
              }}
            >
              <span>Info</span>
            </button>
            {infoMenuOpen && (
              <div className="info-menu-popup" role="menu" aria-label="Information pages">
                <button type="button" role="menuitem" onClick={() => navigate('/info/what-is-this')}>What is this?</button>
                <button type="button" role="menuitem" onClick={() => navigate('/info/how-to-use')}>How to use</button>
                <button type="button" role="menuitem" onClick={() => navigate('/info/faq')}>FAQ</button>
              </div>
            )}
          </div>
        ) : (
          <button className="topbar-back-to-editor" type="button" onClick={() => navigate('/')}>
            <ArrowLeft size={15} />
            Back to editor
          </button>
        )}
      </div>
      {currentPath === '/' ? (
        <nav className="workflow" aria-label="Project workflow">
          {steps.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              className={step === id ? 'workflow-step active' : 'workflow-step'}
              data-step-number={String(index + 1).padStart(2, '0')}
              onClick={() => setStep(id)}
              type="button"
              disabled={!activeProjectId}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      ) : (
        <nav className="site-navigation" aria-label="Site navigation">
          {[
            ['/info/what-is-this', 'What is this'],
            ['/info/how-to-use', 'How to use'],
            ['/info/faq', 'FAQ'],
          ].map(([path, label]) => (
            <button
              key={path}
              className={currentPath === path ? 'site-navigation-link active' : 'site-navigation-link'}
              type="button"
              onClick={() => navigate(path as AppPath)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      <div className="topbar-utility-actions">
        <div className="theme-menu">
          <button
            className="icon-button topbar-theme"
            type="button"
            aria-label={`Choose color theme. Current theme: ${theme}`}
            title={`Color theme: ${theme}`}
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
            onClick={() => {
              setThemeMenuOpen((open) => !open)
              setKeybindingsOpen(false)
              setInfoMenuOpen(false)
            }}
          >
            <Palette size={16} />
          </button>
          {themeMenuOpen && (
            <div className="theme-menu-popup" role="menu" aria-label="Color theme">
              <div className="theme-menu-label">Color theme</div>
              {themeOptions.map((option) => (
                <button
                  key={option.id}
                  className={theme === option.id ? 'theme-option active' : 'theme-option'}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === option.id}
                  onClick={() => {
                    setTheme(option.id)
                    setThemeMenuOpen(false)
                  }}
                >
                  <span className={`theme-swatch ${option.id}`} aria-hidden="true" />
                  <span>{option.label}</span>
                  {theme === option.id && <Check size={14} aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>
        {currentPath === '/' && (
          <div className="keybindings-menu topbar-keybindings-slot">
            <button
              className="icon-button topbar-keybindings"
              type="button"
              aria-label="Keybindings"
              aria-haspopup="dialog"
              aria-expanded={keybindingsOpen}
              onClick={() => {
                setKeybindingsOpen((open) => !open)
                setThemeMenuOpen(false)
                setInfoMenuOpen(false)
              }}
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
        )}
      </div>
      {currentPath === '/' && <div className="topbar-actions">
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
      </div>}
      </div>
    </header>
  )
}
