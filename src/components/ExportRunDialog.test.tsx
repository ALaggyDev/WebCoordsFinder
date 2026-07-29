import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWebSearchCheckpoint,
  createWebSearchRequest,
  webSearchRequestKey,
} from '../domain/webSearch'
import type { FaceEvidence } from '../domain/types'
import { createInitialDocument, useEditorStore } from '../store/editorStore'
import { Inspector } from './Inspector'

beforeEach(() => {
  useEditorStore.setState({
    document: createInitialDocument(),
    step: 'export',
  })
})

afterEach(cleanup)

function documentWithSavedSearch() {
  const document = createInitialDocument()
  const anchor = document.scene.faces[0]
  const evidence: FaceEvidence = {
    id: anchor.id,
    faceId: anchor.id,
    latticeCoordinate: anchor.blockCoordinate,
    localNormal: anchor.normal,
    blockId: 'stone',
    stateCount: 2,
    selectedVariant: 0,
    reviewStatus: 'confirmed',
  }
  document.anchorFaceId = anchor.id
  document.scene.axisMapping = { a: 'x+', b: 'y+', c: 'z+' }
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
      results: [{ x: 3, y: 0, z: 0, badBlocks: 0 }],
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
    expect(screen.getByRole('checkbox', { name: /^0°/ })).toBeDisabled()
    expect(screen.getByText('CoordsFinder settings')).toBeInTheDocument()
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
      screen.getByRole('dialog', { name: 'Export or run search' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Estimated hits')).toBeInTheDocument()
    expect(screen.getByText('Hit precision')).toBeInTheDocument()
    expect(screen.getByText('33 bits needed for 90%')).toBeInTheDocument()
    expect(screen.getAllByText('6.10e9')).toHaveLength(2)
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
    expect(screen.getByRole('row', { name: '3 0 0 0' })).toBeInTheDocument()
    expect(
      screen.getByText(/Progress and the first 1,000 matches are saved/),
    ).toBeInTheDocument()
  })
})
