import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createInitialDocument, useEditorStore } from './store/editorStore'

vi.mock('./components/EditorCanvas', () => ({ EditorCanvas: () => null }))
vi.mock('./components/Inspector', () => ({ Inspector: () => null }))
vi.mock('./components/ToolRail', () => ({ ToolRail: () => null }))
vi.mock('./components/TopBar', () => ({ TopBar: () => null }))
vi.mock('./storage/db', () => ({
  clearLocalProject: vi.fn().mockResolvedValue(undefined),
  loadPersistedProject: vi.fn().mockResolvedValue(undefined),
  persistImage: vi.fn().mockResolvedValue(undefined),
  persistProject: vi.fn().mockResolvedValue(undefined),
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
