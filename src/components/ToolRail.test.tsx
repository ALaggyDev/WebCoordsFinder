// Tool-rail coverage focuses on enablement and mode preservation; shortcut
// dispatch itself is exercised at the App boundary.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createEmptyDocument,
  useEditorStore,
} from '../store/editorStore'
import { createTestDocument } from '../test/createTestDocument'
import { ToolRail } from './ToolRail'

beforeEach(() => {
  const document = createTestDocument()
  document.scene.axisMapping = { a: 'x+', b: 'z+', c: 'y+' }
  document.scanner.compassResolved = true
  useEditorStore.setState({
    document,
    step: 'grid',
    faceTab: 'selection',
    tool: 'select',
    orientationDraft: null,
    past: [],
    future: [],
    selectedEdges: [],
    selectedEvidenceIds: [],
  })
})

afterEach(cleanup)

describe('delete selected faces action', () => {
  it('allows planar editing and planar anchor selection', () => {
    useEditorStore.setState({ document: createEmptyDocument() })
    useEditorStore.getState().addBaseFaces([
      { x: 40, y: 100 },
      { x: 360, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ])

    render(<ToolRail />)

    expect(screen.getByRole('button', { name: 'Select anchor block' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Draw initial grid' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Select faces or edges' })).not.toBeInTheDocument()
  })

  it('shows and activates world orientation when geometry exists', () => {
    render(<ToolRail />)

    const orientationButton = screen.getByRole('button', {
      name: 'Set World Orientation',
    })
    expect(orientationButton).toBeEnabled()

    fireEvent.click(orientationButton)

    expect(useEditorStore.getState().tool).toBe('orient')
    expect(useEditorStore.getState().orientationDraft?.mode).toBe('horizontal')
    expect(orientationButton).toHaveClass('active')
  })

  it('is enabled by a face selection and preserves the edit mode when clicked', () => {
    render(<ToolRail />)
    const deleteButton = screen.getByRole('button', {
      name: 'Delete selected faces',
    })
    expect(deleteButton).toBeDisabled()

    const face = useEditorStore.getState().document.scene.faces[0]
    act(() => {
      useEditorStore.getState().selectFace(face.id, false)
      useEditorStore.getState().setTool('anchor')
    })

    expect(deleteButton).toBeEnabled()
    fireEvent.click(deleteButton)

    const state = useEditorStore.getState()
    expect(state.document.scene.faces.map((entry) => entry.id)).not.toContain(
      face.id,
    )
    expect(state.selectedEvidenceIds).toEqual([])
    expect(state.tool).toBe('anchor')
  })
})
