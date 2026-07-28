import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createEmptyDocument,
  createInitialDocument,
  useEditorStore,
} from './store/editorStore'

vi.mock('./components/EditorCanvas', () => ({ EditorCanvas: () => null }))
vi.mock('./components/Inspector', () => ({ Inspector: () => null }))
vi.mock('./components/ToolRail', () => ({ ToolRail: () => null }))
vi.mock('./components/TopBar', () => ({
  TopBar: ({
    onOpenProjects,
  }: {
    onOpenProjects: () => void
  }) => (
    <button type="button" onClick={onOpenProjects}>
      Open project library
    </button>
  ),
}))
vi.mock('./storage/db', () => ({
  clearAllData: vi.fn().mockResolvedValue(undefined),
  getActiveProjectId: vi.fn().mockReturnValue(null),
  listProjects: vi.fn().mockResolvedValue([]),
  loadProject: vi.fn().mockResolvedValue(null),
  persistImage: vi.fn().mockResolvedValue(undefined),
  persistProject: vi.fn().mockResolvedValue(undefined),
  setActiveProjectId: vi.fn(),
}))

beforeEach(() => {
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

afterEach(cleanup)

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
})
