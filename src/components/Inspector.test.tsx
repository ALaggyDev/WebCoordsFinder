// Inspector tests cover selection batches, unresolved world orientation, and
// the boundary between automatic proposals and user-confirmed evidence.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyDocument,
  createInitialDocument,
  useEditorStore,
} from '../store/editorStore'
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
    orientationDraft: null,
    past: [],
    future: [],
    selectedEdges: [],
    selectedEvidenceIds: [],
  })
})

afterEach(cleanup)

describe('partial perspective inspector', () => {
  it('shows the resumable partial state without exposing 3D-only controls', () => {
    useEditorStore.setState({ document: createEmptyDocument(), step: 'grid' })
    useEditorStore.getState().addBaseFaces(
      [
        { x: 40, y: 100 },
        { x: 360, y: 100 },
        { x: 300, y: 300 },
        { x: 100, y: 300 },
      ],
      4,
      4,
    )

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    expect(screen.getByText('Partial 2D perspective')).toBeInTheDocument()
    expect(screen.getByText(/Saved and resumable/)).toBeInTheDocument()
    expect(screen.getByText('Partial 2D perspective').closest('.compass-card'))
      .toHaveClass('partial')
    expect(screen.queryByText('World orientation')).not.toBeInTheDocument()
    expect(screen.queryByText('Anchor selected')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Extrude selected/ })).toBeDisabled()
  })
})

describe('face inspector batch selection', () => {
  it('selects a face while world orientation is unresolved', () => {
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

    expect(screen.queryByText('Select a block face')).not.toBeInTheDocument()
    expect(useEditorStore.getState().selectedEvidenceIds).toEqual([face.id])
    expect(useEditorStore.getState().document.evidence).toHaveLength(1)
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
    const expectedZ = -first.normal.z
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
      useEditorStore
        .getState()
        .document.scene.faces.filter((face) => face.normal.z !== 0)
        .every((face) => face.normal.z === expectedZ),
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
  it('derives world orientation from a labeled face and directed edge', () => {
    const document = createInitialDocument()
    document.scene.axisMapping = { a: 'unknown', b: 'unknown', c: 'unknown' }
    document.scanner.compassResolved = false
    document.scene.faces[0].normal = { x: 0, y: 0, z: 1 }
    document.anchorFaceId = document.scene.faces[0].id
    useEditorStore.setState({ document, step: 'grid' })

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Set world orientation' }))
    act(() => {
      useEditorStore
        .getState()
        .setOrientationFace(document.scene.faces[0].id)
    })

    fireEvent.change(screen.getByLabelText('Reference face world direction'), {
      target: { value: 'up' },
    })
    act(() => {
      useEditorStore.getState().setOrientationEdge('top')
    })
    fireEvent.change(screen.getByLabelText('Reference edge world direction'), {
      target: { value: 'east' },
    })

    expect(screen.getByText('Derived right-handed orientation')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm orientation' }),
    )

    expect(useEditorStore.getState().document.scene.axisMapping).toEqual({
      a: 'x+',
      b: 'z+',
      c: 'y+',
    })
    expect(useEditorStore.getState().document.scanner.compassResolved).toBe(true)
    expect(screen.getByRole('button', { name: 'Change orientation' })).toBeInTheDocument()
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
