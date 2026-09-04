// Integration coverage for project startup/import behavior and global keyboard
// shortcuts, with browser persistence isolated behind hoisted mocks.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createEmptyDocument,
  useEditorStore,
} from './store/editorStore'
import { createTestDocument } from './test/createTestDocument'

const storageMocks = vi.hoisted(() => ({
  clearAllData: vi.fn(),
  deleteProject: vi.fn(),
  getActiveProjectId: vi.fn(),
  listProjects: vi.fn(),
  loadProject: vi.fn(),
  persistImage: vi.fn(),
  persistProject: vi.fn(),
  setActiveProjectId: vi.fn(),
}))

const exampleMocks = vi.hoisted(() => ({
  loadExampleProject: vi.fn(),
}))

vi.mock('./components/EditorCanvas', () => ({ EditorCanvas: () => null }))
vi.mock('./components/Inspector', () => ({ Inspector: () => null }))
vi.mock('./components/ToolRail', () => ({ ToolRail: () => null }))
vi.mock('./components/TopBar', () => ({
  TopBar: ({
    onOpenImage,
    onOpenProjects,
  }: {
    onOpenImage: () => void
    onOpenProjects: () => void
  }) => (
    <>
      <button type="button" onClick={onOpenImage}>
        Open image
      </button>
      <button type="button" onClick={onOpenProjects}>
        Open project library
      </button>
    </>
  ),
}))
vi.mock('./storage/db', () => storageMocks)
vi.mock('./domain/examples', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./domain/examples')>()),
  loadExampleProject: exampleMocks.loadExampleProject,
}))

function summaryFor(
  id: string,
  nextDocument: ReturnType<typeof createEmptyDocument>,
  updatedAt = Date.now(),
  createdAt = updatedAt,
) {
  return {
    id,
    createdAt,
    name: nextDocument.projectName,
    imageName: nextDocument.image.name,
    imageKey: nextDocument.image.key,
    imageWidth: nextDocument.image.width,
    imageHeight: nextDocument.image.height,
    faceCount: nextDocument.scene.faces.length,
    evidenceCount: nextDocument.evidence.length,
    confirmedCount: nextDocument.evidence.filter(
      (entry) => entry.reviewStatus === 'confirmed',
    ).length,
    proposedCount: nextDocument.evidence.filter(
      (entry) => entry.reviewStatus === 'proposed',
    ).length,
    anchorSet: Boolean(nextDocument.anchorFaceId),
    compassResolved: nextDocument.scanner.compassResolved,
    textureAlgorithm: nextDocument.scanner.textureAlgorithm,
    updatedAt,
  }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  vi.clearAllMocks()
  storageMocks.clearAllData.mockResolvedValue(undefined)
  storageMocks.deleteProject.mockResolvedValue(undefined)
  storageMocks.getActiveProjectId.mockReturnValue(null)
  storageMocks.listProjects.mockResolvedValue([])
  storageMocks.loadProject.mockResolvedValue(null)
  storageMocks.persistImage.mockResolvedValue(undefined)
  storageMocks.persistProject.mockImplementation(
    async (id, nextDocument) => summaryFor(id, nextDocument),
  )
  exampleMocks.loadExampleProject.mockRejectedValue(
    new Error('Example not requested in this test.'),
  )

  const document = createTestDocument()
  document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
  document.scanner.compassResolved = true
  useEditorStore.setState({
    document,
    step: 'faces',
    faceTab: 'selection',
    tool: 'select',
    orientationDraft: null,
    past: [],
    future: [],
    selectedEdges: [],
    selectedEvidenceIds: [],
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('face keyboard shortcuts', () => {
  it('renders the selected information page from its clean URL', () => {
    window.history.replaceState({}, '', '/info/what-is-this')

    render(<App />)

    expect(screen.getByRole('heading', { name: 'What is this?' })).toBeInTheDocument()
    expect(screen.getByText(/Some Minecraft blocks pick a texture rotation/i)).toBeInTheDocument()
  })

  it('shows the start menu instead of opening the demo for a fresh visitor', async () => {
    useEditorStore.setState({ document: createEmptyDocument(), step: 'grid' })

    render(<App />)

    expect(await screen.findByText('Start a project')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Upload an image' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Browse examples' }),
    ).toBeInTheDocument()
    expect(useEditorStore.getState().document.image.src).toBe('')
  })

  it('opens the centered project library on the Projects tab', async () => {
    render(<App />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open project library' }),
    )

    expect(
      screen.getByRole('dialog', { name: 'Project Library' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Projects 0/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('creates and switches to a new project when opening an image', async () => {
    const currentDocument = createTestDocument()
    currentDocument.projectName = 'Existing project'
    const currentImageKey = currentDocument.image.key
    storageMocks.getActiveProjectId.mockReturnValue('project-existing')
    storageMocks.listProjects.mockResolvedValue([
      summaryFor('project-existing', currentDocument, 1),
    ])
    storageMocks.loadProject.mockResolvedValue({
      id: 'project-existing',
      document: currentDocument,
    })
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        naturalWidth = 1920
        naturalHeight = 1080

        decode() {
          return Promise.resolve()
        }
      },
    )
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:new-image'),
      revokeObjectURL: vi.fn(),
    })
    const newImageId = '00000000-0000-4000-8000-000000000001'
    const newProjectId = '00000000-0000-4000-8000-000000000002'
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(newImageId)
      .mockReturnValueOnce(newProjectId)

    const { container } = render(<App />)
    await waitFor(() =>
      expect(useEditorStore.getState().document.projectName).toBe(
        'Existing project',
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))
    const file = new File(['image'], 'second.png', { type: 'image/png' })
    fireEvent.change(
      container.querySelector('input[accept^="image/"]') as HTMLInputElement,
      { target: { files: [file] } },
    )

    await waitFor(() =>
      expect(storageMocks.setActiveProjectId).toHaveBeenCalledWith(
        newProjectId,
      ),
    )
    expect(storageMocks.persistProject).toHaveBeenCalledWith(
      'project-existing',
      expect.objectContaining({
        projectName: 'Existing project',
        image: expect.objectContaining({ key: currentImageKey }),
      }),
    )
    expect(storageMocks.persistImage).toHaveBeenCalledWith(newImageId, file)
    expect(storageMocks.persistProject).toHaveBeenCalledWith(
      newProjectId,
      expect.objectContaining({
        projectName: 'second',
        image: expect.objectContaining({
          key: newImageId,
          name: 'second.png',
          src: 'blob:new-image',
        }),
      }),
    )
    expect(useEditorStore.getState().document).toEqual(
      expect.objectContaining({
        projectName: 'second',
        image: expect.objectContaining({ key: newImageId }),
      }),
    )
  })

  it('opens an image dropped onto the app', async () => {
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        naturalWidth = 1920
        naturalHeight = 1080

        decode() {
          return Promise.resolve()
        }
      },
    )
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:dropped-image'),
      revokeObjectURL: vi.fn(),
    })
    const imageId = '00000000-0000-4000-8000-000000000003'
    const projectId = '00000000-0000-4000-8000-000000000004'
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(imageId)
      .mockReturnValueOnce(projectId)

    const { container } = render(<App />)
    const file = new File(['image'], 'dropped.png', { type: 'image/png' })
    fireEvent.drop(container.querySelector('.app')!, {
      dataTransfer: { files: [file] },
    })

    await waitFor(() =>
      expect(storageMocks.persistImage).toHaveBeenCalledWith(imageId, file),
    )
    expect(storageMocks.setActiveProjectId).toHaveBeenCalledWith(projectId)
    expect(useEditorStore.getState().document).toEqual(
      expect.objectContaining({
        projectName: 'dropped',
        image: expect.objectContaining({ key: imageId }),
      }),
    )
  })

  it('opens an image pasted from the clipboard', async () => {
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        naturalWidth = 1920
        naturalHeight = 1080

        decode() {
          return Promise.resolve()
        }
      },
    )
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:pasted-image'),
      revokeObjectURL: vi.fn(),
    })
    const imageId = '00000000-0000-4000-8000-000000000005'
    const projectId = '00000000-0000-4000-8000-000000000006'
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(imageId)
      .mockReturnValueOnce(projectId)

    render(<App />)
    const file = new File(['image'], 'clipboard.png', { type: 'image/png' })
    fireEvent.paste(window, {
      clipboardData: {
        files: [file],
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    })

    await waitFor(() =>
      expect(storageMocks.persistImage).toHaveBeenCalledWith(imageId, file),
    )
    expect(storageMocks.setActiveProjectId).toHaveBeenCalledWith(projectId)
    expect(useEditorStore.getState().document).toEqual(
      expect.objectContaining({
        projectName: 'clipboard',
        image: expect.objectContaining({ key: imageId }),
      }),
    )
  })

  it('ignores pasted clipboard content without an image', () => {
    render(<App />)

    fireEvent.paste(window, {
      clipboardData: {
        files: [],
        items: [{ kind: 'string', type: 'text/plain' }],
      },
    })

    expect(storageMocks.persistImage).not.toHaveBeenCalled()
  })

  it('preserves native paste behavior in text inputs', () => {
    const { container } = render(<App />)
    const input = document.createElement('input')
    input.type = 'text'
    container.querySelector('.app')!.append(input)
    const file = new File(['image'], 'clipboard.png', { type: 'image/png' })

    fireEvent.paste(input, {
      clipboardData: {
        files: [file],
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    })

    expect(storageMocks.persistImage).not.toHaveBeenCalled()
  })

  it('selects all faces with Ctrl+A', () => {
    useEditorStore.setState({ step: 'grid' })
    render(<App />)

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })

    const state = useEditorStore.getState()
    expect(state.selectedEvidenceIds).toEqual(
      state.document.scene.faces.map((face) => face.id),
    )
  })

  it('preserves native Ctrl+A behavior in editable controls', () => {
    const { container } = render(<App />)
    const input = container.querySelector('input')!

    fireEvent.keyDown(input, { key: 'a', ctrlKey: true })

    expect(useEditorStore.getState().selectedEvidenceIds).toEqual([])
  })

  it('deletes selected faces with X, Backspace, or Delete without changing the edit mode', () => {
    useEditorStore.getState().setTool('anchor')
    render(<App />)

    for (const key of ['x', 'Backspace', 'Delete']) {
      const face = useEditorStore.getState().document.scene.faces[0]
      useEditorStore.getState().selectFace(face.id, false)
      fireEvent.keyDown(window, { key })

      const state = useEditorStore.getState()
      expect(state.document.scene.faces.map((entry) => entry.id)).not.toContain(face.id)
      expect(state.selectedEvidenceIds).toEqual([])
      expect(state.tool).toBe('anchor')
    }
  })

  it('does not activate initial-grid drawing after a grid exists', () => {
    useEditorStore.getState().setTool('anchor')
    render(<App />)

    fireEvent.keyDown(window, { key: 'g' })

    expect(useEditorStore.getState().tool).toBe('anchor')
  })

  it('uses D to start horizontal orientation when world UP is already resolved', () => {
    render(<App />)

    fireEvent.keyDown(window, { key: 'd' })

    expect(useEditorStore.getState().orientationDraft?.mode).toBe('horizontal')
    expect(useEditorStore.getState().tool).toBe('orient')
  })

  it('imports the bundled example document without regenerating it', async () => {
    const bundledDocument = createTestDocument()
    bundledDocument.projectName = 'bundle demo'
    bundledDocument.image = {
      key: 'bundle-image',
      name: 'bundle-demo.png',
      src: '',
      width: 2560,
      height: 1494,
      mime: 'image/png',
    }
    const imageBlob = new Blob(['bundle-image'], { type: 'image/png' })
    exampleMocks.loadExampleProject.mockResolvedValue({
      document: bundledDocument,
      imageBlob,
    })
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:bundle-demo'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000010')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000011')

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Browse examples' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use example' }))

    await waitFor(() =>
      expect(storageMocks.persistProject).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000011',
        expect.objectContaining({
          projectName: 'bundle demo',
          image: expect.objectContaining({
            name: 'bundle-demo.png',
            width: 2560,
            height: 1494,
          }),
          scene: bundledDocument.scene,
        }),
      ),
    )
    expect(storageMocks.persistImage).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000010',
      imageBlob,
    )
  })

  it('imports only the example image when faces and analysis are excluded', async () => {
    const bundledDocument = createTestDocument()
    bundledDocument.projectName = 'bundle demo'
    const imageBlob = new Blob(['bundle-image'], { type: 'image/png' })
    exampleMocks.loadExampleProject.mockResolvedValue({
      document: bundledDocument,
      imageBlob,
    })
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:bundle-demo'),
      revokeObjectURL: vi.fn(),
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Browse examples' }))
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Include analysis' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use example' }))

    await waitFor(() =>
      expect(storageMocks.persistProject).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          projectName: 'bundle demo',
          image: expect.objectContaining({
            name: 'test-image.png',
            width: 2560,
            height: 1494,
          }),
          scene: expect.objectContaining({ faces: [] }),
          evidence: [],
        }),
      ),
    )
  })

  it('confirms deletion by project name and clears an active project', async () => {
    const currentDocument = createTestDocument()
    currentDocument.projectName = 'Existing project'
    storageMocks.getActiveProjectId.mockReturnValue('project-existing')
    storageMocks.listProjects.mockResolvedValue([
      summaryFor('project-existing', currentDocument, 1),
    ])
    storageMocks.loadProject.mockResolvedValue({
      id: 'project-existing',
      document: currentDocument,
    })

    render(<App />)
    await waitFor(() =>
      expect(useEditorStore.getState().document.projectName).toBe(
        'Existing project',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open project library' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      screen.getByRole('dialog', { name: 'Delete Existing project?' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(storageMocks.deleteProject).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))

    await waitFor(() =>
      expect(storageMocks.deleteProject).toHaveBeenCalledWith('project-existing'),
    )
    expect(storageMocks.setActiveProjectId).toHaveBeenCalledWith(null)
    expect(useEditorStore.getState().document.image.src).toBe('')
  })

  it('deletes an inactive project without changing the open document', async () => {
    const currentDocument = createTestDocument()
    currentDocument.projectName = 'Current project'
    const otherDocument = createEmptyDocument()
    otherDocument.projectName = 'Other project'
    otherDocument.image.name = 'other.png'
    storageMocks.getActiveProjectId.mockReturnValue('current')
    storageMocks.listProjects.mockResolvedValue([
      summaryFor('current', currentDocument, 2),
      summaryFor('other', otherDocument, 1),
    ])
    storageMocks.loadProject.mockImplementation(async (id) => ({
      id,
      document: id === 'current' ? currentDocument : otherDocument,
    }))

    render(<App />)
    await waitFor(() =>
      expect(useEditorStore.getState().document.projectName).toBe(
        'Current project',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open project library' }))
    fireEvent.click(screen.getByRole('button', { name: /Other project.*other.png/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))

    await waitFor(() =>
      expect(storageMocks.deleteProject).toHaveBeenCalledWith('other'),
    )
    expect(useEditorStore.getState().document.projectName).toBe('Current project')
    expect(storageMocks.setActiveProjectId).not.toHaveBeenCalledWith(null)
  })
})
