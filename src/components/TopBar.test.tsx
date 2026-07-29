// Top-bar tests protect the distinction between opening a new image and opening
// the local project library.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../store/editorStore'
import { TopBar } from './TopBar'

const projects = [
  {
    id: 'project-a',
    name: 'Nether ceiling',
    imageName: 'nether.png',
    imageKey: 'image-a',
    updatedAt: 2,
  },
]

beforeEach(() => {
  useEditorStore.setState({ step: 'grid' })
})

afterEach(cleanup)

describe('top bar project actions', () => {
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
})
