import { afterEach, describe, expect, it } from 'vitest'
import { createInitialDocument, useEditorStore } from './editorStore'

afterEach(() => {
  useEditorStore.setState({
    document: createInitialDocument(),
    step: 'grid',
    faceTab: 'selection',
    tool: 'select',
    past: [],
    future: [],
    selectedPatchId: 'floor-demo',
    selectedEdges: [],
    selectedEvidenceIds: [],
  })
})

describe('global scene calibration', () => {
  it('starts with every abstract axis unlabeled', () => {
    expect(useEditorStore.getState().document.scene.axisMapping).toEqual({
      a: 'unknown',
      b: 'unknown',
      c: 'unknown',
    })
  })

  it('toggles connected unit edges without entering extrusion mode', () => {
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().toggleSelectedEdge({
      patchId: patch.id,
      column: 0,
      row: 0,
      edge: 'top',
    })
    useEditorStore.getState().toggleSelectedEdge({
      patchId: patch.id,
      column: 1,
      row: 0,
      edge: 'top',
    })

    expect(useEditorStore.getState()).toMatchObject({
      tool: 'select',
      selectedEdges: [{ column: 0 }, { column: 1 }],
    })

    useEditorStore.getState().toggleSelectedEdge({
      patchId: patch.id,
      column: 5,
      row: 3,
      edge: 'bottom',
    })
    expect(useEditorStore.getState().selectedEdges).toHaveLength(1)
  })

  it('uses two out-of-plane anchors to create a six-point camera', () => {
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().toggleSelectedEdge({
      patchId: patch.id,
      column: 0,
      row: 0,
      edge: 'top',
    })
    useEditorStore
      .getState()
      .extrudeSelectedEdges({ x: 360, y: 360 }, { x: 700, y: 340 })

    const state = useEditorStore.getState()
    expect(state.document.scene.patches).toHaveLength(5)
    expect(state.document.scene.observations).toHaveLength(6)
    expect(state.document.scene.projection).toMatchObject({
      kind: 'camera',
    })
  })

  it('invalidates variants when the global world-axis mapping changes', () => {
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().selectCell(patch.id, 0, 0, false)
    const id = useEditorStore.getState().selectedEvidenceIds[0]
    useEditorStore.getState().setVariant(id, 2)

    useEditorStore.getState().updateAxisMapping('a', 'x+')

    expect(useEditorStore.getState().document.evidence[0]).toMatchObject({
      reviewStatus: 'unlabeled',
      selectedVariant: undefined,
      scores: undefined,
      confidence: undefined,
    })
  })

  it('undoes and redoes a committed calibration drag in one step', () => {
    const observation =
      useEditorStore.getState().document.scene.observations[0]
    const moved = {
      x: observation.image.x + 75,
      y: observation.image.y - 40,
    }

    useEditorStore.getState().moveObservation(observation.id, moved)
    expect(useEditorStore.getState().past).toHaveLength(1)
    expect(
      useEditorStore.getState().document.scene.observations[0].image,
    ).toEqual(moved)

    useEditorStore.getState().undo()
    expect(
      useEditorStore.getState().document.scene.observations[0].image,
    ).toEqual(observation.image)

    useEditorStore.getState().redo()
    expect(
      useEditorStore.getState().document.scene.observations[0].image,
    ).toEqual(moved)
  })
})

describe('face evidence editing', () => {
  it('applies a block profile to every selected face', () => {
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().updateAxisMapping('c', 'y+')
    useEditorStore.getState().selectCell(patch.id, 0, 0, false)
    useEditorStore.getState().selectCell(patch.id, 1, 0, true)
    useEditorStore.getState().setBlockForSelection('dirt')

    expect(useEditorStore.getState().document.evidence).toHaveLength(2)
    expect(
      useEditorStore
        .getState()
        .document.evidence.every((entry) => entry.blockId === 'dirt'),
    ).toBe(true)
  })

  it('deselects a variant when the active variant is chosen again', () => {
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().selectCell(patch.id, 0, 0, false)
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
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().selectCell(patch.id, 0, 0, false)
    useEditorStore.getState().selectCell(patch.id, 1, 0, true)
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
      useEditorStore
        .getState()
        .document.evidence.every((entry) => entry.reviewStatus === 'confirmed'),
    ).toBe(true)

    useEditorStore.getState().inspectEvidence(secondId)
    expect(useEditorStore.getState()).toMatchObject({
      step: 'faces',
      faceTab: 'selection',
      selectedEvidenceIds: [secondId],
    })
  })

  it('only proposes analyzed variants that meet the current threshold', () => {
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().selectCell(patch.id, 0, 0, false)
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
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().selectCell(patch.id, 0, 0, false)
    useEditorStore.getState().selectCell(patch.id, 1, 0, true)
    const [confirmedId, proposedId] =
      useEditorStore.getState().selectedEvidenceIds

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
