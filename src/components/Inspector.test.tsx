import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialDocument, useEditorStore } from '../store/editorStore'
import { Inspector } from './Inspector'

afterEach(() => {
  cleanup()
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

describe('face inspector batch selection', () => {
  it('shows Mixed, hides per-face imagery, and updates every selected profile', () => {
    const plane = useEditorStore.getState().document.planes[0]
    useEditorStore.getState().selectCell(plane.id, 0, 0, false)
    useEditorStore.getState().selectCell(plane.id, 1, 0, true)

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
})

describe('Auto Analyze queue', () => {
  it('shows only analyzed faces in descending confidence order and can be cleared', () => {
    const plane = useEditorStore.getState().document.planes[0]
    useEditorStore.getState().selectCell(plane.id, 0, 0, false)
    useEditorStore.getState().selectCell(plane.id, 1, 0, true)
    useEditorStore.getState().selectCell(plane.id, 2, 0, true)
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

    const queueRows = screen.getAllByTitle('Inspect this face')
    expect(within(queueRows[0]).getByText('2, 0, 0')).toBeInTheDocument()
    expect(within(queueRows[1]).getByText('0, 0, 0')).toBeInTheDocument()
    expect(within(queueRows[1]).getByText('—')).toBeInTheDocument()

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
