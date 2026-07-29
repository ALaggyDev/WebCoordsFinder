import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInitialDocument, useEditorStore } from '../store/editorStore'
import { ToolRail } from './ToolRail'

beforeEach(() => {
  useEditorStore.setState({
    document: createInitialDocument(),
    step: 'grid',
    faceTab: 'selection',
    tool: 'select',
    past: [],
    future: [],
    selectedEdges: [],
    selectedEvidenceIds: [],
  })
})

afterEach(cleanup)

describe('delete selected faces action', () => {
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
