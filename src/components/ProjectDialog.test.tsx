import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDocument } from '../test/createTestDocument'
import type { ProjectSummary } from '../storage/db'
import { ProjectDialog } from './ProjectDialog'

const projects: ProjectSummary[] = [
  {
    id: 'project-a',
    createdAt: 2,
    name: 'Nether ceiling',
    imageName: 'nether.png',
    imageKey: 'image-a',
    imageWidth: 1920,
    imageHeight: 1080,
    faceCount: 32,
    evidenceCount: 28,
    confirmedCount: 20,
    proposedCount: 8,
    anchorSet: true,
    compassResolved: true,
    textureAlgorithm: 'Vanilla-3',
    updatedAt: 2,
  },
  {
    id: 'project-b',
    createdAt: 1,
    name: 'End island',
    imageName: 'end.png',
    imageKey: 'image-b',
    imageWidth: 1280,
    imageHeight: 720,
    faceCount: 12,
    evidenceCount: 7,
    confirmedCount: 2,
    proposedCount: 5,
    anchorSet: false,
    compassResolved: false,
    textureAlgorithm: 'Sodium-2',
    updatedAt: 1,
  },
]

const exampleDocument = createTestDocument()
exampleDocument.projectName = 'demo'
exampleDocument.image.name = 'demo.png'
exampleDocument.image.width = 2560
exampleDocument.image.height = 1494

const baseProps = {
  activeProjectId: 'project-a',
  exampleStates: {
    'dark-cave': {
      status: 'ready' as const,
      document: exampleDocument,
      preview: 'blob:demo-preview',
    },
  },
  initialTab: 'projects' as const,
  open: true,
  previews: {
    'project-a': 'blob:nether-preview',
    'project-b': 'blob:end-preview',
  },
  projects,
  onClose: vi.fn(),
  onSelectProject: vi.fn(),
  onNewProject: vi.fn(),
  onImportProject: vi.fn(),
  onImportExample: vi.fn(),
  onExportProject: vi.fn(),
  onRenameProject: vi.fn(),
  onRequestDeleteProject: vi.fn(),
  onRequestClearData: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('project dialog', () => {
  it('selects a row for details without opening it, then opens explicitly', () => {
    render(<ProjectDialog {...baseProps} />)

    expect(
      screen.getByRole('dialog', { name: 'Project Library' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Already open/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /End island.*end.png/i }))

    expect(baseProps.onClose).not.toHaveBeenCalled()
    expect(baseProps.onSelectProject).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'End island' })).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Compass unresolved')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open project' }))

    expect(baseProps.onClose).toHaveBeenCalledOnce()
    expect(baseProps.onSelectProject).toHaveBeenCalledWith('project-b')
  })

  it('opens a non-current project when its row is double-clicked', () => {
    render(<ProjectDialog {...baseProps} />)

    fireEvent.doubleClick(
      screen.getByRole('button', { name: /End island.*end.png/i }),
    )

    expect(baseProps.onSelectProject).toHaveBeenCalledWith('project-b')
  })

  it('requests deletion for the selected project without closing the menu', () => {
    render(<ProjectDialog {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /End island.*end.png/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(baseProps.onRequestDeleteProject).toHaveBeenCalledWith('project-b')
    expect(baseProps.onClose).not.toHaveBeenCalled()
  })

  it('renames the selected project from the details pane', () => {
    render(<ProjectDialog {...baseProps} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Rename Nether ceiling' }),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), {
      target: { value: 'Nether roof' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save project name' }))

    expect(baseProps.onRenameProject).toHaveBeenCalledWith(
      'project-a',
      'Nether roof',
    )
    expect(baseProps.onClose).not.toHaveBeenCalled()
  })

  it('filters the current vertical list', () => {
    render(<ProjectDialog {...baseProps} />)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), {
      target: { value: 'end' },
    })

    expect(screen.queryByRole('button', { name: /Nether ceiling/i })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /End island.*end.png/i }),
    ).toBeInTheDocument()
  })
})
