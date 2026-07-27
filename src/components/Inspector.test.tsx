import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialDocument, useEditorStore } from '../store/editorStore'
import { Inspector } from './Inspector'

beforeEach(() => {
  const document = createInitialDocument()
  document.scene.axisMapping = { a: 'x+', b: 'z+', c: 'y+' }
  document.scanner.compassResolved = true
  useEditorStore.setState({
    document,
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

afterEach(cleanup)

describe('face inspector batch selection', () => {
  it('shows Mixed, hides per-face imagery, and updates every selected profile', () => {
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().selectCell(patch.id, 0, 0, false)
    useEditorStore.getState().selectCell(patch.id, 1, 0, true)

    const document = structuredClone(useEditorStore.getState().document)
    document.evidence[1].blockId = 'dirt'
    document.evidence.forEach((entry, variant) => {
      entry.selectedVariant = variant
      entry.reviewStatus = 'confirmed'
    })
    useEditorStore.setState({ document, step: 'faces', faceTab: 'selection' })

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
        onClearProject={vi.fn()}
      />,
    )

    const profileSelect = screen.getByLabelText('Block profile')
    expect(profileSelect).toHaveDisplayValue('Mixed')
    expect(screen.queryByText('Visible variant')).not.toBeInTheDocument()
    expect(
      screen.queryByAltText('Perspective-correct selected block face'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Auto analyze selected faces' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByLabelText('Face selection actions'))
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([
      'Exclude',
      'Clear variants',
      'Auto analyze selected faces',
      'Confirm',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Clear variants' }))
    expect(
      useEditorStore.getState().document.evidence.every(
        (entry) =>
          entry.selectedVariant === undefined &&
          entry.reviewStatus === 'unlabeled',
      ),
    ).toBe(true)

    fireEvent.change(profileSelect, { target: { value: 'deepslate' } })

    expect(
      useEditorStore.getState().document.evidence.every(
        (entry) => entry.blockId === 'deepslate',
      ),
    ).toBe(true)
  })

  it('only auto analyzes unlabeled faces and only confirms proposed faces', () => {
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().selectCell(patch.id, 0, 0, false)
    useEditorStore.getState().selectCell(patch.id, 1, 0, true)
    const [unlabeledId, proposedId] = useEditorStore.getState().selectedEvidenceIds
    const document = structuredClone(useEditorStore.getState().document)
    const proposed = document.evidence.find((entry) => entry.id === proposedId)!
    proposed.selectedVariant = 1
    proposed.reviewStatus = 'proposed'
    proposed.scores = [{ variant: 1, score: 0.9 }]
    proposed.confidence = 0.2
    useEditorStore.setState({ document, step: 'faces', faceTab: 'selection' })
    const onAutoFill = vi.fn()

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={onAutoFill}
        onClearProject={vi.fn()}
      />,
    )

    const autoAnalyze = screen.getByRole('button', {
      name: 'Auto analyze selected faces',
    })
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    expect(autoAnalyze).toBeEnabled()
    expect(confirm).toBeEnabled()

    fireEvent.click(autoAnalyze)
    expect(onAutoFill).toHaveBeenCalledWith([unlabeledId])

    fireEvent.click(confirm)
    expect(
      useEditorStore.getState().document.evidence.find(
        (entry) => entry.id === unlabeledId,
      )?.reviewStatus,
    ).toBe('unlabeled')
    expect(
      useEditorStore.getState().document.evidence.find(
        (entry) => entry.id === proposedId,
      )?.reviewStatus,
    ).toBe('confirmed')
    expect(confirm).toBeDisabled()
  })

  it('turns Exclude into Include for excluded faces', () => {
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().selectCell(patch.id, 0, 0, false)
    useEditorStore.getState().selectCell(patch.id, 1, 0, true)
    useEditorStore.setState({ step: 'faces', faceTab: 'selection' })

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
        onClearProject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Exclude' }))
    expect(
      useEditorStore.getState().document.evidence.every(
        (entry) => entry.reviewStatus === 'excluded',
      ),
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Include' }))
    expect(
      useEditorStore.getState().document.evidence.every(
        (entry) =>
          entry.reviewStatus === 'unlabeled' &&
          entry.selectedVariant === undefined,
      ),
    ).toBe(true)
    expect(screen.getByRole('button', { name: 'Exclude' })).toBeInTheDocument()
  })
})

describe('Auto Analyze queue', () => {
  it('shows only analyzed faces in descending confidence order and can be cleared', () => {
    const patch = useEditorStore.getState().document.scene.patches[0]
    useEditorStore.getState().selectCell(patch.id, 0, 0, false)
    useEditorStore.getState().selectCell(patch.id, 1, 0, true)
    useEditorStore.getState().selectCell(patch.id, 2, 0, true)
    const [lowConfidenceId, unanalyzedId, highConfidenceId] =
      useEditorStore.getState().selectedEvidenceIds

    useEditorStore.getState().applyAnalysisResults([
      {
        evidenceId: lowConfidenceId,
        scores: [{ variant: 0, score: 0.8 }, { variant: 1, score: 0.75 }],
        confidence: 0.05,
      },
      {
        evidenceId: highConfidenceId,
        scores: [{ variant: 2, score: 0.95 }, { variant: 1, score: 0.7 }],
        confidence: 0.25,
      },
    ])
    useEditorStore.setState({ step: 'faces', faceTab: 'review' })

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
        onClearProject={vi.fn()}
      />,
    )

    expect(screen.getByRole('tab', { name: 'Auto Analyze 2' })).toBeInTheDocument()
    expect(screen.getByLabelText('Proposal threshold')).toBeInTheDocument()
    expect(screen.queryByText('1, 0, 0')).not.toBeInTheDocument()
    expect(screen.queryByText('Quality control')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Accept proposed (1)' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByLabelText('Auto Analyze actions'))
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([
      'Re-analyze selection',
      'Clear queue',
      'Accept proposed (1)',
    ])

    const queueRows = screen.getAllByTitle('Inspect this face')
    expect(within(queueRows[0]).getByText('2, 0, 0')).toBeInTheDocument()
    expect(within(queueRows[1]).getByText('0, 0, 0')).toBeInTheDocument()
    expect(within(queueRows[0]).getByText('Δ 0.25')).toBeInTheDocument()
    expect(within(queueRows[1]).getByText('Variant —')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }))

    expect(
      screen.getByText(
        'No analyzed faces yet. Select faces and use Auto analyze selected faces.',
      ),
    ).toBeInTheDocument()
    expect(
      useEditorStore.getState().document.evidence.find(
        (entry) => entry.id === unanalyzedId,
      )?.scores,
    ).toBeUndefined()
  })
})
