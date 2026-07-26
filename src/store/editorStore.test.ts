import { afterEach, describe, expect, it } from 'vitest'
import { axesForFaceRotation } from '../domain/geometry'
import { createInitialDocument, useEditorStore } from './editorStore'

afterEach(() => {
  useEditorStore.setState({
    document: createInitialDocument(),
    step: 'grid',
    faceTab: 'selection',
    tool: 'select',
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

describe('plane corner history', () => {
  it('undoes and redoes a committed corner drag in one step', () => {
    const plane = useEditorStore.getState().document.planes[0]
    const original = { ...plane.corners[0] }
    const moved = { x: original.x + 75, y: original.y - 40 }

    useEditorStore.getState().movePlaneCorner(plane.id, 0, moved)

    expect(useEditorStore.getState().past).toHaveLength(1)
    expect(useEditorStore.getState().document.planes[0].corners[0]).toEqual(moved)

    useEditorStore.getState().undo()

    expect(useEditorStore.getState().document.planes[0].corners[0]).toEqual(original)

    useEditorStore.getState().redo()

    expect(useEditorStore.getState().document.planes[0].corners[0]).toEqual(moved)
  })
})

describe('face evidence editing', () => {
  it('applies a block profile to every selected face', () => {
    const plane = useEditorStore.getState().document.planes[0]

    useEditorStore.getState().selectCell(plane.id, 0, 0, false)
    useEditorStore.getState().selectCell(plane.id, 1, 0, true)
    useEditorStore.getState().setBlockForSelection('dirt')

    expect(useEditorStore.getState().document.evidence).toHaveLength(2)
    expect(
      useEditorStore.getState().document.evidence.every((entry) => entry.blockId === 'dirt'),
    ).toBe(true)
  })

  it('deselects a variant when the active variant is chosen again', () => {
    const plane = useEditorStore.getState().document.planes[0]
    useEditorStore.getState().selectCell(plane.id, 0, 0, false)
    const evidenceId = useEditorStore.getState().selectedEvidenceIds[0]

    useEditorStore.getState().setVariant(evidenceId, 2)
    expect(useEditorStore.getState().document.evidence[0]).toMatchObject({
      selectedVariant: 2,
      reviewStatus: 'confirmed',
    })

    useEditorStore.getState().setVariant(evidenceId, 2)
    expect(useEditorStore.getState().document.evidence[0]).toMatchObject({
      selectedVariant: undefined,
      reviewStatus: 'unlabeled',
    })
  })

  it('accepts every proposal and opens queue items for inspection', () => {
    const plane = useEditorStore.getState().document.planes[0]
    useEditorStore.getState().selectCell(plane.id, 0, 0, false)
    useEditorStore.getState().selectCell(plane.id, 1, 0, true)
    const [firstId, secondId] = useEditorStore.getState().selectedEvidenceIds

    useEditorStore.getState().applyAnalysisResults([
      {
        evidenceId: firstId,
        scores: [{ variant: 0, score: 0.9 }, { variant: 1, score: 0.7 }],
        confidence: 0.2,
      },
      {
        evidenceId: secondId,
        scores: [{ variant: 1, score: 0.92 }, { variant: 0, score: 0.72 }],
        confidence: 0.2,
      },
    ])
    useEditorStore.setState({
      selectedEvidenceIds: [firstId],
      faceTab: 'review',
    })

    useEditorStore.getState().acceptProposed()
    expect(
      useEditorStore.getState().document.evidence.every(
        (entry) => entry.reviewStatus === 'confirmed',
      ),
    ).toBe(true)

    useEditorStore.getState().inspectEvidence(secondId)
    expect(useEditorStore.getState()).toMatchObject({
      step: 'faces',
      faceTab: 'selection',
      selectedEvidenceIds: [secondId],
    })
  })

  it('only proposes analyzed variants that meet the current threshold', () => {
    const plane = useEditorStore.getState().document.planes[0]
    useEditorStore.getState().selectCell(plane.id, 0, 0, false)
    const evidenceId = useEditorStore.getState().selectedEvidenceIds[0]

    useEditorStore.getState().applyAnalysisResults([
      {
        evidenceId,
        scores: [{ variant: 2, score: 0.8 }, { variant: 1, score: 0.75 }],
        confidence: 0.05,
      },
    ])
    expect(useEditorStore.getState().document.evidence[0]).toMatchObject({
      selectedVariant: undefined,
      reviewStatus: 'unlabeled',
    })

    useEditorStore.getState().updateScanner({ confidenceThreshold: 0.04 })
    expect(useEditorStore.getState().document.evidence[0]).toMatchObject({
      selectedVariant: 2,
      reviewStatus: 'proposed',
    })

    useEditorStore.getState().updateScanner({ confidenceThreshold: 0.1 })
    expect(useEditorStore.getState().document.evidence[0]).toMatchObject({
      selectedVariant: undefined,
      reviewStatus: 'unlabeled',
    })
  })

  it('clears analysis results without erasing confirmed evidence', () => {
    const plane = useEditorStore.getState().document.planes[0]
    useEditorStore.getState().selectCell(plane.id, 0, 0, false)
    useEditorStore.getState().selectCell(plane.id, 1, 0, true)
    const [confirmedId, proposedId] = useEditorStore.getState().selectedEvidenceIds

    useEditorStore.getState().applyAnalysisResults([
      {
        evidenceId: confirmedId,
        scores: [{ variant: 2, score: 0.95 }, { variant: 1, score: 0.7 }],
        confidence: 0.25,
      },
      {
        evidenceId: proposedId,
        scores: [{ variant: 1, score: 0.8 }, { variant: 0, score: 0.75 }],
        confidence: 0.05,
      },
    ])
    useEditorStore.getState().setEvidenceStatus([confirmedId], 'confirmed')

    useEditorStore.getState().clearReviewQueue()

    const [confirmed, proposed] = useEditorStore.getState().document.evidence
    expect(confirmed).toMatchObject({
      selectedVariant: 2,
      reviewStatus: 'confirmed',
      scores: undefined,
      confidence: undefined,
    })
    expect(proposed).toMatchObject({
      selectedVariant: undefined,
      reviewStatus: 'unlabeled',
      scores: undefined,
      confidence: undefined,
    })
  })
})
