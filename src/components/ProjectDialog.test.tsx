// Dialog tests treat saved projects and bundled examples as separate catalogs
// that dispatch actions back to the persistence-owning App component.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDialog } from './ProjectDialog'

const projects = [
  {
    id: 'project-a',
    name: 'Nether ceiling',
    imageName: 'nether.png',
    imageKey: 'image-a',
    updatedAt: 2,
  },
  {
    id: 'project-b',
    name: 'End island',
    imageName: 'end.png',
    imageKey: 'image-b',
    updatedAt: 1,
  },
]

afterEach(cleanup)

describe('project dialog', () => {
  it('shows saved-project image previews and selects a project', () => {
    const onClose = vi.fn()
    const onSelectProject = vi.fn()
    const { container } = render(
      <ProjectDialog
        activeProjectId="project-a"
        open
        previews={{
          'project-a': 'blob:nether-preview',
          'project-b': 'blob:end-preview',
        }}
        projects={projects}
        onClose={onClose}
        onSelectProject={onSelectProject}
        onNewProject={vi.fn()}
        onImportProject={vi.fn()}
        onImportExample={vi.fn()}
        onExportProject={vi.fn()}
        onRequestClearData={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('dialog', { name: 'Projects' }),
    ).toBeInTheDocument()
    expect(
      container.querySelector('img[src="blob:nether-preview"]'),
    ).toBeInTheDocument()
    expect(
      container.querySelector('img[src="blob:end-preview"]'),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /End island.*end.png/i }),
    )

    expect(onClose).toHaveBeenCalledOnce()
    expect(onSelectProject).toHaveBeenCalledWith('project-b')
  })

  it('renders the example catalog and imports the chosen example', () => {
    const onImportExample = vi.fn()
    render(
      <ProjectDialog
        activeProjectId={null}
        open
        previews={{}}
        projects={[]}
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
        onNewProject={vi.fn()}
        onImportProject={vi.fn()}
        onImportExample={onImportExample}
        onExportProject={vi.fn()}
        onRequestClearData={vi.fn()}
      />,
    )

    expect(screen.getByText('Example projects')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /Example cavern/i }),
    )

    expect(onImportExample).toHaveBeenCalledWith('cavern')
  })
})
