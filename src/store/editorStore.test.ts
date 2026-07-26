import { afterEach, describe, expect, it } from 'vitest'
import { axesForFaceRotation } from '../domain/geometry'
import { createInitialDocument, useEditorStore } from './editorStore'

afterEach(() => {
  useEditorStore.setState({
    document: createInitialDocument(),
    past: [],
    future: [],
    selectedEvidenceIds: [],
  })
})

describe('plane world orientation', () => {
  it('recomputes coordinates and invalidates stale evidence after an axis change', () => {
    const document = createInitialDocument()
    const plane = document.planes[0]
    document.scanner.compassResolved = true
    document.evidence.push({
      id: `${plane.id}:1:1`,
      planeId: plane.id,
      column: 1,
      row: 1,
      coordinate: { x: 1, y: 0, z: 1 },
      face: 'up',
      blockId: 'dirt',
      stateCount: 4,
      selectedVariant: 2,
      reviewStatus: 'confirmed',
      scores: [{ variant: 2, score: 0.9 }],
      confidence: 0.2,
    })
    useEditorStore.setState({ document, past: [], future: [] })

    useEditorStore
      .getState()
      .updatePlane(plane.id, axesForFaceRotation('up', 1))

    const state = useEditorStore.getState()
    expect(state.document.scanner.compassResolved).toBe(false)
    expect(state.document.evidence[0]).toMatchObject({
      coordinate: { x: 1, y: 0, z: -1 },
      reviewStatus: 'unlabeled',
      selectedVariant: undefined,
      scores: undefined,
      confidence: undefined,
    })
  })
})
