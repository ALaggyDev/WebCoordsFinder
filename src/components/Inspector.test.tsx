import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialDocument, useEditorStore } from '../store/editorStore'
import { Inspector } from './Inspector'

beforeEach(() => {
  const document = createInitialDocument()
  document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
  document.scanner.compassResolved = true
  useEditorStore.setState({
    document,
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

describe('face inspector batch selection', () => {
  it('warns instead of loading forever when world orientation is unresolved', async () => {
    const document = createInitialDocument()
    useEditorStore.setState({ document, step: 'faces', faceTab: 'selection' })
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().selectFace(face.id, false)

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('Resolve global axes to align this face'),
    ).toBeInTheDocument()
  })

  it('keeps common references and variants visible while compass yaw is unknown', async () => {
    const document = createInitialDocument()
    document.scene.axisMapping = {
      a: 'unknown',
      b: 'unknown',
      c: 'y+',
    }
    useEditorStore.setState({
      document,
      step: 'faces',
      faceTab: 'selection',
    })
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().selectFace(face.id, false)

    const { container } = render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('Resolve global axes to align this face'),
    ).toBeInTheDocument()
    expect(screen.getByAltText('Stone reference')).toBeInTheDocument()
    expect(container.querySelectorAll('.candidate-image img')).toHaveLength(4)
  })

  it('keeps two-state side variants visible without a compass direction', async () => {
    const document = createInitialDocument()
    document.scene.axisMapping = {
      a: 'unknown',
      b: 'unknown',
      c: 'y+',
    }
    document.scene.faces[0].normal = { x: 1, y: 0, z: 0 }
    useEditorStore.setState({
      document,
      step: 'faces',
      faceTab: 'selection',
    })
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().selectFace(face.id, false)

    const { container } = render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('Side face · compass unresolved'),
    ).toBeInTheDocument()
    expect(screen.getByText('2-state')).toBeInTheDocument()
    expect(screen.getByAltText('Stone reference')).toBeInTheDocument()
    expect(container.querySelectorAll('.candidate-image img')).toHaveLength(2)
  })

  it('shows Mixed, hides per-face imagery, and updates every selected profile', () => {
    const [first, second] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)

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
      'Flip visible side',
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
    const [first, second] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
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

  it('flips the selected flat-connected faces from the Faces workspace', () => {
    const [first, second] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
    useEditorStore.setState({ step: 'faces', faceTab: 'selection' })

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Flip visible side' }))
    expect(
      useEditorStore.getState().document.scene.faces.every(
        (face) => face.normal.z === -1,
      ),
    ).toBe(true)
    expect(
      useEditorStore.getState().document.evidence.every(
        (entry) =>
          entry.reviewStatus === 'unlabeled' &&
          entry.selectedVariant === undefined,
      ),
    ).toBe(true)
  })
})

describe('geometry deletion', () => {
  it('projects the gizmo and recomputes around a movable anchored axis', async () => {
    const document = createInitialDocument()
    document.scene.axisMapping = { a: 'unknown', b: 'unknown', c: 'unknown' }
    document.scanner.compassResolved = false
    useEditorStore.setState({ document, step: 'grid' })

    const { container } = render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    const initialArrow = container
      .querySelector('[data-axis-arrow="a"]')
      ?.getAttribute('d')
    const rotated = structuredClone(useEditorStore.getState().document)
    if (rotated.scene.projection.kind !== 'planar') {
      throw new Error('Expected the example project to start planar.')
    }
    rotated.scene.projection.homography = [
      0, -100, 500,
      100, 0, 500,
      0, 0, 1,
    ]
    useEditorStore.setState({ document: rotated })
    await waitFor(() => {
      expect(
        container
          .querySelector('[data-axis-arrow="a"]')
          ?.getAttribute('d'),
      ).not.toBe(initialArrow)
    })

    fireEvent.change(screen.getByLabelText('Abstract A direction'), {
      target: { value: 'x+' },
    })
    fireEvent.change(screen.getByLabelText('Abstract C direction'), {
      target: { value: 'y+' },
    })

    await waitFor(() => {
      expect(useEditorStore.getState().document.scene.axisMapping).toEqual({
        a: 'x+',
        b: 'z-',
        c: 'y+',
      })
    })
    expect(screen.getByLabelText('Abstract A direction')).toBeEnabled()
    expect(screen.getByLabelText('Abstract B direction')).toBeEnabled()
    expect(screen.getByLabelText('Abstract C direction')).toBeEnabled()
    expect(screen.queryByRole('option', { name: 'X?' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Y?' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Z?' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Abstract B direction')).toHaveValue('z-')
    expect(
      screen.getByRole('button', { name: 'Unanchor abstract A axis' }),
    ).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(screen.getByLabelText('Abstract C direction'), {
      target: { value: 'y-' },
    })

    await waitFor(() => {
      expect(useEditorStore.getState().document.scene.axisMapping).toEqual({
        a: 'x+',
        b: 'z+',
        c: 'y-',
      })
    })
    expect(screen.getByLabelText('Abstract B direction')).toHaveValue('z+')

    fireEvent.click(
      screen.getByRole('button', { name: 'Anchor abstract C axis' }),
    )
    fireEvent.change(screen.getByLabelText('Abstract B direction'), {
      target: { value: 'z-' },
    })

    await waitFor(() => {
      expect(useEditorStore.getState().document.scene.axisMapping).toEqual({
        a: 'x-',
        b: 'z-',
        c: 'y-',
      })
    })
    expect(
      screen.getByRole('button', { name: 'Unanchor abstract C axis' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('deletes all selected faces from the geometry inspector', () => {
    const [first, second] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
    useEditorStore.setState({ step: 'grid' })

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Flip visible side' }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete selected faces' }),
    )

    expect(
      useEditorStore.getState().document.scene.faces.map((face) => face.id),
    ).not.toEqual(expect.arrayContaining([first.id, second.id]))
  })
})

describe('Auto Analyze queue', () => {
  it('shows only analyzed faces in descending confidence order and can be cleared', () => {
    const [first, second, third] = useEditorStore.getState().document.scene.faces
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().selectFace(second.id, true)
    useEditorStore.getState().selectFace(third.id, true)
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
    expect(within(queueRows[0]).getByText('2, 0, -1')).toBeInTheDocument()
    expect(within(queueRows[1]).getByText('0, 0, -1')).toBeInTheDocument()
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
