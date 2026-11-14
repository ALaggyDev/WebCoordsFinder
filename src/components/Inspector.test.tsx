// Inspector tests cover selection batches, unresolved world orientation, and
// the boundary between automatic proposals and user-confirmed evidence.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyDocument,
  useEditorStore,
} from '../store/editorStore'
import { createTestDocument } from '../test/createTestDocument'
import { Inspector } from './Inspector'

beforeEach(() => {
  const document = createTestDocument()
  document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
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
  it('shows a planar solve as ready without forcing 3D extrusion', () => {
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

    expect(screen.getByText('Planar perspective solved')).toBeInTheDocument()
    expect(screen.getByText('Planar perspective solved').closest('.geometry-status'))
      .toHaveClass('resolved')
    expect(screen.getByText('World Orientation')).toBeInTheDocument()
    expect(screen.getByText('World UP')).toBeInTheDocument()
    expect(screen.getByText('Horizontal Orientation')).toBeInTheDocument()
    expect(screen.getByText('Anchor selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Determine world UP' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Extrude edges (E)' })).toBeDisabled()
    expect(screen.getByText('Camera info')).toBeInTheDocument()
    expect(screen.getAllByText('-----')).toHaveLength(6)
  })
})

describe('camera info', () => {
  it('copies the standing feet position and rotation for an anchor scan result', async () => {
    const { document } = useEditorStore.getState()
    useEditorStore.setState({
      document: {
        ...document,
        image: { ...document.image, width: 1600, height: 900 },
        scene: {
          ...document.scene,
          faces: [{
            id: document.anchorFaceId!,
            blockCoordinate: { x: 2, y: 1, z: 4 },
            normal: { x: 0, y: 0, z: -1 },
          }],
          axisMapping: { a: 'x-', b: 'y+', c: 'z-' },
          projection: {
            kind: 'camera',
            matrix: [800, 0, 800, -800, 0, 900, 350, -712.5, 0, 0, 1, -0.75],
            rmsError: 0,
            maxError: 0,
          },
          observations: [{ id: 'forward', lattice: { x: 0.25, y: 0.5, z: 10 }, image: { x: 800, y: 350 }, weight: 1 }],
        },
      },
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    const clipboard = vi.spyOn(window, 'navigator', 'get').mockReturnValue({ clipboard: { writeText } } as unknown as Navigator)

    try {
      render(<Inspector busy={false} onAutoFill={vi.fn()} />)
      const details = screen.getByText('Camera info').closest('details')!
      details.open = true
      const teleport = within(details)
      const copy = teleport.getByRole('button', { name: 'Copy command' })
      const direction = teleport.getByLabelText('Scan result direction')
      expect(direction).toHaveValue('0')
      expect(teleport.getByText('-180.00°, -6.34°')).toBeInTheDocument()
      expect(teleport.getByText('2.7500, -2.1200, 4.2500')).toBeInTheDocument()
      expect(copy).toBeDisabled()

      fireEvent.change(teleport.getByLabelText('X'), { target: { value: '-42' } })
      fireEvent.change(teleport.getByLabelText('Z'), { target: { value: '9' } })
      fireEvent.change(teleport.getByLabelText('Y'), { target: { value: '64.25' } })
      expect(copy).toBeDisabled()
      fireEvent.change(teleport.getByLabelText('Y'), { target: { value: '64' } })

      const commands = [
        '/tp @s -39.2500 61.8800 13.2500 -180.00 -6.34',
        '/tp @s -45.2500 61.8800 11.7500 -90.00 -6.34',
        '/tp @s -43.7500 61.8800 5.7500 0.00 -6.34',
        '/tp @s -37.7500 61.8800 7.2500 90.00 -6.34',
      ]
      for (const [turns, command] of commands.entries()) {
        fireEvent.change(direction, { target: { value: String(turns) } })
        expect(teleport.getByText(command)).toBeInTheDocument()
      }

      fireEvent.click(copy)
      await waitFor(() => expect(teleport.getByRole('status')).toHaveTextContent('Copied to clipboard.'))
      expect(writeText).toHaveBeenCalledWith(commands[3])

      fireEvent.change(direction, { target: { value: '1' } })
      expect(teleport.getByRole('status')).toBeEmptyDOMElement()
    } finally {
      clipboard.mockRestore()
    }
  })

  it('shows derived camera data after a 3D solve', () => {
    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    expect(screen.getByText('Camera info')).toBeInTheDocument()
    expect(screen.getByText('Vertical FOV')).toBeInTheDocument()
    expect(screen.getByText('Feet position (Standing)')).toBeInTheDocument()
    expect(screen.getByText('Yaw and pitch')).toBeInTheDocument()
    expect(screen.getByText('Camera info').closest('details')).not.toHaveAttribute('open')
  })

  it('uses dashed placeholders when world orientation is unavailable', () => {
    const document = createTestDocument()
    document.scene.axisMapping = { a: 'unknown', b: 'unknown', c: 'unknown' }
    document.scanner.compassResolved = false
    useEditorStore.setState({ document, step: 'grid' })

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    expect(screen.getAllByText('-----')).toHaveLength(3)
    const details = screen.getByText('Camera info').closest('details')!
    details.open = true
    const teleport = within(details)
    for (const coordinate of ['X', 'Y', 'Z']) {
      fireEvent.change(teleport.getByLabelText(coordinate), { target: { value: '42' } })
    }
    expect(teleport.getByText('Solve and orient the 3D camera and select an anchor block.')).toBeInTheDocument()
    expect(teleport.getByRole('button', { name: 'Copy command' })).toBeDisabled()
  })

  it('uses the guessed horizontal orientation when a complete mapping exists', () => {
    const document = createTestDocument()
    document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
    document.scanner.compassResolved = false
    useEditorStore.setState({ document, step: 'grid' })

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    expect(screen.queryByText('-----')).not.toBeInTheDocument()
  })
})

describe('face inspector batch selection', () => {
  it('reveals grass tint controls for a grass block', () => {
    const face = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().selectFace(face.id, false)
    useEditorStore.getState().setBlockForSelection('grass_block')
    useEditorStore.setState({ step: 'faces', faceTab: 'selection' })

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Grass tint settings' }))
    expect(screen.getByLabelText('Grass tint controls')).toBeInTheDocument()
    const map = screen.getByRole('img', { name: 'Grass tint color map' })
    expect(map.querySelector('.grass-tint-marker')).toBeInTheDocument()
    vi.spyOn(map, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 100, height: 100,
    } as DOMRect)
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    fireEvent.pointerDown(map, { clientX: 25, clientY: 65, pointerId: 1 })
    expect(useEditorStore.getState().document.evidence[0].blockSettings?.grassTint?.temperature)
      .toBeCloseTo(0.75)
    fireEvent.pointerMove(map, { clientX: 35, clientY: 65, pointerId: 1 })
    expect(map.querySelector('.grass-tint-marker')).toHaveStyle({ left: '35%' })
    expect(useEditorStore.getState().document.evidence[0].blockSettings?.grassTint?.temperature)
      .toBeCloseTo(0.75)
    now += 80
    fireEvent.pointerMove(map, { clientX: 35, clientY: 65, pointerId: 1 })
    expect(useEditorStore.getState().document.evidence[0].blockSettings?.grassTint?.temperature)
      .toBeCloseTo(0.65)
    fireEvent.pointerUp(map, { clientX: 35, clientY: 65, pointerId: 1 })
    vi.restoreAllMocks()
    const tint = useEditorStore.getState().document.evidence[0].blockSettings?.grassTint
    expect(tint?.temperature).toBeCloseTo(0.65)
    expect(tint?.downfall).toBeCloseTo(0.35 / 0.65)

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(useEditorStore.getState().document.evidence[0].blockSettings).toEqual({
      grassTint: { temperature: 0.8, downfall: 0.4 },
    })

    fireEvent.pointerDown(document.body)
    expect(screen.queryByLabelText('Grass tint controls')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Grass tint settings' }))
    fireEvent.pointerDown(screen.getByLabelText('Block profile'))
    expect(screen.queryByLabelText('Grass tint controls')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Grass tint settings' }))
    fireEvent.pointerDown(screen.getByText('Block profile'))
    expect(screen.queryByLabelText('Grass tint controls')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Grass tint settings' }))
    fireEvent.click(screen.getByRole('tab', { name: /Auto Analyze/ }))
    expect(screen.queryByLabelText('Grass tint controls')).not.toBeInTheDocument()
  })

  it('selects a face while world orientation is unresolved', () => {
    const document = createTestDocument()
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
      screen.getByRole('button', { name: 'Auto analyze' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByLabelText('Face selection actions'))
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([
      'Flip visible side',
      'Clear variants',
      'Auto analyze',
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

  it('shows and persists the global sculk animation time', () => {
    const first = useEditorStore.getState().document.scene.faces[0]
    useEditorStore.getState().selectFace(first.id, false)
    useEditorStore.getState().setBlockForSelection('sculk')
    useEditorStore.setState({ step: 'faces', faceTab: 'selection' })

    render(
      <Inspector
        busy={false}
        onOpenImage={vi.fn()}
        onAutoFill={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Animation settings' }))
    const slider = screen.getByRole('slider', { name: 'Animation time' })
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '80')
    expect(slider).toHaveValue('1')
    fireEvent.change(slider, { target: { value: '35' } })
    expect(useEditorStore.getState().document.animationTicks?.sculk).toBe(35)
    fireEvent.change(slider, { target: { value: '80' } })
    expect(useEditorStore.getState().document.animationTicks?.sculk).toBe(80)
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
      name: 'Auto analyze',
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
  it('determines UP first and exposes optional horizontal confirmation', () => {
    const document = createTestDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Determine world UP' }))
    act(() => {
      useEditorStore
        .getState()
        .setOrientationFace(document.scene.faces[0].id)
    })

    act(() => {
      useEditorStore.getState().setOrientationSurfaceKind('top')
    })

    expect(useEditorStore.getState().document.scene.axisMapping.c).toBe('y+')
    expect(useEditorStore.getState().document.scanner.compassResolved).toBe(false)
    expect(useEditorStore.getState().document.scanner.directions).toEqual([
      0, 90, 180, 270,
    ])
    expect(screen.getByLabelText('World UP established')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Select horizontal arrow' }),
    ).toBeInTheDocument()
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
      screen.getByRole('button', { name: 'Delete faces (X)' }),
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
    expect(within(queueRows[1]).getByText('Variant 0')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Confirm face 0, 0, 0' }),
    ).toBeEnabled()

    fireEvent.mouseEnter(queueRows[0])
    expect(useEditorStore.getState().hoveredEvidenceId).toBe(highConfidenceId)
    expect(screen.getByLabelText('Hovered face preview')).toBeInTheDocument()
    expect(screen.getByText('Unwarped face')).toBeInTheDocument()
    expect(screen.getAllByText('Variant 2')).toHaveLength(2)
    fireEvent.mouseEnter(queueRows[1])
    expect(useEditorStore.getState().hoveredEvidenceId).toBe(lowConfidenceId)
    expect(screen.getByLabelText('Hovered face preview')).toBeInTheDocument()
    expect(screen.getAllByText('Variant 0')).toHaveLength(2)
    fireEvent.mouseLeave(queueRows[0].closest('.review-list')!)
    expect(useEditorStore.getState().hoveredEvidenceId).toBeNull()
    expect(screen.queryByLabelText('Hovered face preview')).not.toBeInTheDocument()

    const confirmToggle = screen.getByRole('button', {
      name: 'Confirm face 2, 0, 0',
    })
    fireEvent.click(confirmToggle)
    expect(
      useEditorStore.getState().document.evidence.find(
        (entry) => entry.id === highConfidenceId,
      )?.reviewStatus,
    ).toBe('confirmed')
    fireEvent.click(screen.getByRole('button', { name: 'Unconfirm face 2, 0, 0' }))
    const unconfirmed = useEditorStore.getState().document.evidence.find(
      (entry) => entry.id === highConfidenceId,
    )
    expect(unconfirmed?.reviewStatus).toBe('proposed')
    expect(unconfirmed?.selectedVariant).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm face 0, 0, 0' }))
    const acceptedBestMatch = useEditorStore.getState().document.evidence.find(
      (entry) => entry.id === lowConfidenceId,
    )
    expect(acceptedBestMatch?.reviewStatus).toBe('confirmed')
    expect(acceptedBestMatch?.selectedVariant).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Unconfirm face 0, 0, 0' }))
    expect(
      useEditorStore.getState().document.evidence.find(
        (entry) => entry.id === lowConfidenceId,
      )?.reviewStatus,
    ).toBe('unlabeled')

    fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }))

    expect(
      screen.getByText(
        'No analyzed faces yet. Select faces and use Auto analyze.',
      ),
    ).toBeInTheDocument()
    expect(
      useEditorStore.getState().document.evidence.find(
        (entry) => entry.id === unanalyzedId,
      )?.scores,
    ).toBeUndefined()
  })
})
