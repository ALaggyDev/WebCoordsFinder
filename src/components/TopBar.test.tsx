// Top-bar tests protect the distinction between opening a new image and opening
// the local project library.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyDocument, useEditorStore } from '../store/editorStore'
import { TopBar } from './TopBar'

const projects = [
  {
    id: 'project-a',
    name: 'Nether ceiling',
    imageName: 'nether.png',
    imageKey: 'image-a',
    imageWidth: 1920,
    imageHeight: 1080,
    faceCount: 24,
    evidenceCount: 24,
    confirmedCount: 12,
    proposedCount: 12,
    anchorSet: true,
    compassResolved: true,
    textureAlgorithm: 'Vanilla-3' as const,
    updatedAt: 2,
  },
]

beforeEach(() => {
  useEditorStore.setState({ step: 'grid' })
})

afterEach(cleanup)

describe('top bar project actions', () => {
  it('keeps Faces and Export accessible for a planar perspective solve', () => {
    useEditorStore.setState({ document: createEmptyDocument(), step: 'grid' })
    useEditorStore.getState().addBaseFaces([
      { x: 40, y: 100 },
      { x: 360, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ])

    render(
      <TopBar
        activeProjectId="project-a"
        projects={projects}
        onOpenImage={vi.fn()}
        onOpenProjects={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Faces/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Export/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Geometry/ })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /Faces/ }))
    expect(useEditorStore.getState().step).toBe('faces')
  })

  it('opens an image from the former privacy-badge position', () => {
    const onOpenImage = vi.fn()
    render(
      <TopBar
        activeProjectId="project-a"
        projects={projects}
        onOpenImage={onOpenImage}
        onOpenProjects={vi.fn()}
      />,
    )

    const openImageButton = screen.getByRole('button', { name: 'Open image' })
    expect(openImageButton).toHaveClass('primary-button')

    fireEvent.click(openImageButton)

    expect(onOpenImage).toHaveBeenCalledOnce()
  })

  it('opens the separate project dialog from the project control', () => {
    const onOpenProjects = vi.fn()
    render(
      <TopBar
        activeProjectId="project-a"
        projects={projects}
        onOpenImage={vi.fn()}
        onOpenProjects={onOpenProjects}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /Project.*Nether ceiling/i }),
    )

    expect(onOpenProjects).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens a read-only keybindings popup', () => {
    render(
      <TopBar
        activeProjectId="project-a"
        projects={projects}
        onOpenImage={vi.fn()}
        onOpenProjects={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Keybindings' }))

    expect(screen.getByRole('dialog', { name: 'Keybindings' })).toBeInTheDocument()
    expect(screen.getByText('Delete selected faces')).toBeInTheDocument()
    expect(screen.getByText('Delete white calibration point')).toBeInTheDocument()
    expect(screen.getAllByText('Ctrl')).not.toHaveLength(0)
  })
})
