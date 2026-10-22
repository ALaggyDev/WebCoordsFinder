// Export/Run tests pin modal workflow, search readiness, and checkpoint
// restoration without starting the real background scanner.
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
import { generateCoordsFinderConfig } from '../domain/exportConfig'
import {
  createWebSearchCheckpoint,
  createWebSearchRequest,
  webSearchRequestKey,
} from '../domain/webSearch'
import { blockCoordinateForFace } from '../domain/geometry'
import type { FaceEvidence } from '../domain/types'
import { useEditorStore } from '../store/editorStore'
import { createTestDocument } from '../test/createTestDocument'
import { Inspector } from './Inspector'

beforeEach(() => {
  useEditorStore.setState({
    document: createTestDocument(),
    step: 'export',
  })
})

afterEach(cleanup)

class MockSearchWorker {
  onerror: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
}

function documentWithSavedSearch() {
  const document = createTestDocument()
  const anchor = document.scene.faces[0]
  const evidence: FaceEvidence = {
    id: anchor.id,
    faceId: anchor.id,
    latticeCoordinate: blockCoordinateForFace(anchor),
    localNormal: anchor.normal,
    blockId: 'stone',
    stateCount: 2,
    selectedVariant: 0,
    reviewStatus: 'confirmed',
  }
  document.anchorFaceId = anchor.id
  document.scene.axisMapping = { a: 'x+', b: 'y-', c: 'z-' }
  document.scanner.compassResolved = true
  document.scanner.bounds = {
    xStart: 0,
    xEnd: 9,
    yStart: 0,
    yEnd: 0,
    zStart: 0,
    zEnd: 0,
  }
  document.evidence = [evidence]
  const request = createWebSearchRequest(document)
  document.scanner.webSearch = createWebSearchCheckpoint(
    webSearchRequestKey(request),
    {
      phase: 'stopped',
      processed: 4n,
      total: 10n,
      matchCount: 2n,
      checksPerSecond: 100,
      results: [
        {
          x: 3,
          y: 0,
          z: 0,
          badBlocks: 0,
          direction: 0,
          scanOrdinal: '3',
        },
      ],
      shards: [
        { id: 0, start: 0n, end: 10n, next: 4n, matchCount: 2n },
      ],
    },
    1234,
  )
  return document
}

function documentWithActiveOffsets() {
  const document = documentWithSavedSearch()
  document.scanner.webSearch = null
  document.scanner.offsetsEnabled = true
  document.scanner.bounds = {
    xStart: -1000, xEnd: 1000, yStart: 64, yEnd: 127, zStart: -1000, zEnd: 1000,
  }
  document.scanner.directions = [0, 90, 180, 270]
  document.offsets = [{
    id: 'roots', blockId: 'hanging_roots', modelIndex: 0,
    position: { x: 1, y: 2, z: 3 }, nibbles: { x: 4, y: 0, z: 12 }, tint: '#91bd59',
  }]
  return document
}

describe('Export / Run workspace', () => {
  it('describes the effective offset search without counting unused Y or ignored observations', () => {
    const document = documentWithActiveOffsets()
    document.evidence = []
    // The texture switch remains on, but no usable texture rows constrain Y.
    document.offsets!.push({ ...document.offsets![0], id: 'ignored', ignored: true })
    useEditorStore.setState({ document, step: 'export' })
    render(<Inspector busy={false} onAutoFill={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(createWebSearchRequest(document).yUnconstrained).toBe(true)
    expect(dialog.getByText('Browser search · Offsets')).toBeInTheDocument()
    expect(dialog.getByText('Block offsets').parentElement).toHaveTextContent('1')
    expect(dialog.getByText('X/Z search area').parentElement).toHaveTextContent('4,004,001')
    expect(dialog.getByText('Y range').parentElement).toHaveTextContent('Any')
    expect(dialog.queryByText('Runtime comparison')).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Run web search' })).toBeEnabled()
    expect(dialog.getByRole('button', { name: 'Download config' })).toBeEnabled()
  })

  it('exports only enabled evidence when textures are disabled', () => {
    const document = documentWithActiveOffsets()
    document.scanner.textureEnabled = false
    useEditorStore.setState({ document, step: 'export' })
    render(<Inspector busy={false} onAutoFill={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Texture constraints').parentElement).toHaveTextContent('Off')
    expect(dialog.getByRole('button', { name: 'Download config' })).toBeEnabled()
    expect(generateCoordsFinderConfig(document)).toContain('[offsets]')
    expect(generateCoordsFinderConfig(document)).not.toContain('[filter]')
  })

  it('keeps proposal warnings and separates intermediate from final combined matches', () => {
    const worker = new MockSearchWorker()
    vi.stubGlobal('Worker', function MockWorkerConstructor() { return worker })
    const document = documentWithActiveOffsets()
    document.evidence.push({ ...document.evidence[0], id: 'proposal', reviewStatus: 'proposed' })
    const request = createWebSearchRequest(document)
    document.scanner.webSearch = createWebSearchCheckpoint(webSearchRequestKey(request), {
      phase: 'running', offsetBits: request.offsetBits, yUnconstrained: false,
      processed: 64n, total: 1024n, offsetMatchCount: 12n, matchCount: 2n,
      checksPerSecond: 100, results: [],
    })
    useEditorStore.setState({ document, step: 'export' })
    render(<Inspector busy={false} onAutoFill={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/1 automatic proposal is omitted until reviewed/)).toBeInTheDocument()
    expect(dialog.getByText('Y range').parentElement).toHaveTextContent('64–127')
    expect(dialog.getByText('Offset candidates (X/Z + rotation)').parentElement).toHaveTextContent('12')
    expect(dialog.getByText('Texture matches (X/Y/Z + rotation)').parentElement).toHaveTextContent('2')
    expect(dialog.getByText('Time remaining').parentElement).toHaveTextContent('Paused')
    fireEvent.click(dialog.getByRole('button', { name: 'Run again' }))
    const command = worker.postMessage.mock.calls[0][0]
    act(() => worker.onmessage!(new MessageEvent('message', { data: {
      type: 'state', requestId: command.requestId, phase: 'running',
      processed: 64n, total: 1024n, offsetMatchCount: 12n, matchCount: 2n,
      checksPerSecond: 100, results: [],
    } })))
    expect(dialog.getByText('Time remaining').parentElement).toHaveTextContent('Not estimated')
    vi.unstubAllGlobals()
  })

  it('keeps offset context visible when active observations contradict each other', () => {
    const document = documentWithActiveOffsets()
    document.offsets!.push({ ...document.offsets![0], id: 'conflict', nibbles: { x: 5, y: 0, z: 12 } })
    useEditorStore.setState({ document, step: 'export' })
    render(<Inspector busy={false} onAutoFill={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('alert')).toHaveTextContent('contradict each other')
    expect(dialog.getByText('Block offsets').parentElement).toHaveTextContent('2')
    expect(dialog.queryByText('Runtime comparison')).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Run web search' })).toBeDisabled()
    expect(dialog.getByRole('button', { name: 'Download config' })).toBeDisabled()
  })

  it('does not save an outgoing run into a different project with the same search setup', () => {
    const worker = new MockSearchWorker()
    vi.stubGlobal('Worker', function MockWorkerConstructor() { return worker })
    const original = documentWithSavedSearch()
    original.scanner.webSearch = null
    useEditorStore.setState({ document: original, step: 'export' })
    const view = render(<Inspector busy={false} onAutoFill={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run web search' }))
    const other = documentWithSavedSearch()
    other.projectName = 'Another project'
    const checkpoint = other.scanner.webSearch
    act(() => useEditorStore.setState({ document: other }))
    view.unmount()
    expect(worker.terminate).toHaveBeenCalled()
    expect(useEditorStore.getState().document.scanner.webSearch).toBe(checkpoint)
    vi.unstubAllGlobals()
  })
  it('keeps shared and CoordsFinder-only settings separated in the sidebar', () => {
    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Error tolerance')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^0°/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^0°/ })).toBeEnabled()
    expect(
      screen.getByText('CoordsFinder settings (advanced)'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Export / Run' }),
    ).toBeInTheDocument()
  })

  it('keeps the shared bounds when independently enabling or disabling evidence', () => {
    const document = documentWithSavedSearch()
    useEditorStore.setState({ document, step: 'export' })
    render(<Inspector busy={false} onAutoFill={vi.fn()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Texture rotations' }))
    expect(useEditorStore.getState().document.scanner).toMatchObject({ textureEnabled: false, offsetsEnabled: true })
    fireEvent.change(screen.getAllByLabelText('Start')[0], { target: { value: '-1000' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Texture rotations' }))
    expect(useEditorStore.getState().document.scanner.bounds.xStart).toBe(-1000)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Block offsets' }))
    expect(useEditorStore.getState().document.scanner).toMatchObject({ textureEnabled: true, offsetsEnabled: false })
  })

  it('preserves disabled texture settings and Y bounds until textures are enabled again', () => {
    const document = documentWithSavedSearch()
    useEditorStore.setState({ document, step: 'export' })
    render(<Inspector busy={false} onAutoFill={vi.fn()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Texture rotations' }))
    expect(screen.getAllByLabelText('Start')[1]).toBeDisabled()
    expect(screen.getAllByLabelText('End')[1]).toBeDisabled()
    expect(screen.getByLabelText('Texture algorithm')).toBeDisabled()
    expect(screen.getByLabelText('Error tolerance')).toBeDisabled()
    expect(screen.getByLabelText('CPU tile size X')).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'verbose logging' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Fast bit lifting (block offsets)' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Search area presets' }))
    expect(screen.getByRole('button', { name: /Overworld/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /World Border/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Texture rotations' }))
    expect(screen.getAllByLabelText('Start')[1]).toBeEnabled()
    expect(screen.getByLabelText('Error tolerance')).toBeEnabled()
    expect(useEditorStore.getState().document.scanner.bounds).toEqual(document.scanner.bounds)
  })

  it('adds optional compass rotations to the scanner settings', () => {
    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '180°' }))

    expect(useEditorStore.getState().document.scanner.directions).toEqual([
      0,
      180,
    ])
  })

  it('deselects the zero-degree X/Z rotation', () => {
    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /^0°/ }))

    expect(useEditorStore.getState().document.scanner.directions).toEqual([])
  })

  it('blocks a search with no usable evidence and explains the missing setup', () => {
    render(<Inspector busy={false} onAutoFill={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    expect(screen.getByRole('dialog', { name: 'Export or Run Search' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run web search' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/Confirm a texture face or add an active block offset/)
  })

  it('closes from the dialog close button', () => {
    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Close Export / Run' }),
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps an active web search running after the dialog closes', () => {
    const worker = new MockSearchWorker()
    vi.stubGlobal('Worker', function MockWorkerConstructor() {
      return worker
    })
    const document = documentWithSavedSearch()
    document.scanner.webSearch = null
    useEditorStore.setState({ document, step: 'export' })

    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run web search' }))
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    fireEvent.click(
      screen.getByRole('button', { name: 'Close Export / Run' }),
    )

    expect(worker.terminate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))

    expect(screen.getByText('Loading scanner')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('copies the generated CoordsFinder configuration', async () => {
    const document = documentWithSavedSearch()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    useEditorStore.setState({
      document,
      step: 'export',
    })
    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(
      generateCoordsFinderConfig(document),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Copied' }),
      ).toBeInTheDocument(),
    )
  })

  it('downloads the configuration using the project name', () => {
    const document = documentWithSavedSearch()
    document.projectName = 'Nether ceiling'
    useEditorStore.setState({ document, step: 'export' })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:config'),
      revokeObjectURL: vi.fn(),
    })

    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Download config' }),
    )

    expect(click).toHaveBeenCalledOnce()
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
      'Nether ceiling.conf',
    )
  })

  it('restores intermediate counts and represents unconstrained Y correctly', () => {
    const document = documentWithSavedSearch()
    Object.assign(document.scanner.webSearch!, {
      offsetBits: 3, offsetMatchCount: '4', yUnconstrained: true,
    })
    useEditorStore.setState({ document, step: 'export' })
    render(<Inspector busy={false} onAutoFill={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    // Saved offset-only results keep their own meaning despite the current
    // texture setup: final candidates leave Y unconstrained and have no errors.
    expect(screen.getByText('X/Z candidates (+ rotation)').parentElement).toHaveTextContent('2')
    expect(screen.getByRole('row', { name: '3 Any 0 0°' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Texture errors' })).not.toBeInTheDocument()
  })

  it('clears the saved search without changing search settings', () => {
    const document = documentWithSavedSearch()
    useEditorStore.setState({ document, step: 'export' })
    render(<Inspector busy={false} onAutoFill={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved search' }))
    const scanner = useEditorStore.getState().document.scanner
    expect(scanner.webSearch).toBeNull()
    expect(scanner.bounds).toEqual(document.scanner.bounds)
    expect(screen.queryByRole('row', { name: '3 0 0 0° 0' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run web search' })).toBeEnabled()
  })

  it('restores saved progress and candidates as a resumable search', () => {
    useEditorStore.setState({
      document: documentWithSavedSearch(),
      step: 'export',
    })
    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))

    expect(
      screen.getByRole('button', { name: 'Resume saved search' }),
    ).toBeEnabled()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '40')
    expect(screen.getByRole('row', { name: '3 0 0 0° 0' })).toBeInTheDocument()
    expect(
      screen.getByText(/Result display is capped at the first/),
    ).toBeInTheDocument()
  })
})
