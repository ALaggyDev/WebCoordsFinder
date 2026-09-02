// Export/Run tests pin modal workflow, search readiness, and checkpoint
// restoration without starting the real background scanner.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

describe('Export / Run workspace', () => {
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

  it('opens the runtime comparison and blocks web search until setup is valid', () => {
    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))

    expect(
      screen.getByRole('dialog', { name: 'Export or Run Search' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Estimated hits')).toBeInTheDocument()
    expect(screen.getByText('Hit precision')).toBeInTheDocument()
    expect(screen.getByText('CoordsFinder CPU')).toBeInTheDocument()
    expect(screen.getByText('CoordsFinder CUDA')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Run web search' }),
    ).toBeDisabled()
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
      screen.getByText(/Progress and the first 1,000 matches are saved/),
    ).toBeInTheDocument()
  })
})
