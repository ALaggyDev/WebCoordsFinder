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
  createInitialDocument,
  useEditorStore,
} from './store/editorStore'

const storageMocks = vi.hoisted(() => ({
  clearAllData: vi.fn(),
  getActiveProjectId: vi.fn(),
  listProjects: vi.fn(),
  loadProject: vi.fn(),
  persistImage: vi.fn(),
  persistProject: vi.fn(),
  setActiveProjectId: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
  storageMocks.clearAllData.mockResolvedValue(undefined)
  storageMocks.getActiveProjectId.mockReturnValue(null)
  storageMocks.listProjects.mockResolvedValue([])
  storageMocks.loadProject.mockResolvedValue(null)
  storageMocks.persistImage.mockResolvedValue(undefined)
  storageMocks.persistProject.mockImplementation(
    async (id, nextDocument) => ({
      id,
      name: nextDocument.projectName,
      imageName: nextDocument.image.name,
      imageKey: nextDocument.image.key,
      updatedAt: Date.now(),
    }),
  )

  useEditorStore.setState({
    document: createInitialDocument(),
    step: 'faces',
    faceTab: 'selection',
    tool: 'select',
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
  it('shows the start menu instead of opening the demo for a fresh visitor', async () => {
    useEditorStore.setState({ document: createEmptyDocument(), step: 'image' })

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

  it('opens examples in the centered project library', async () => {
    render(<App />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open project library' }),
    )

    expect(
      screen.getByRole('dialog', { name: 'Projects' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Example projects')).toBeInTheDocument()
  })

  it('creates and switches to a new project when opening an image', async () => {
    const currentDocument = createInitialDocument()
    currentDocument.projectName = 'Existing project'
    const currentImageKey = currentDocument.image.key
    storageMocks.getActiveProjectId.mockReturnValue('project-existing')
    storageMocks.listProjects.mockResolvedValue([
      {
        id: 'project-existing',
        name: currentDocument.projectName,
        imageName: currentDocument.image.name,
        imageKey: currentImageKey,
        updatedAt: 1,
      },
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

  it('deletes selected faces with X without changing the edit mode', () => {
    const [first, second] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
    useEditorStore.getState().setTool('anchor')
    render(<App />)

    fireEvent.keyDown(window, { key: 'x' })

    const state = useEditorStore.getState()
    expect(state.document.scene.faces.map((face) => face.id)).not.toEqual(
      expect.arrayContaining([first.id, second.id]),
    )
    expect(state.selectedEvidenceIds).toEqual([])
    expect(state.tool).toBe('anchor')
  })
})
