import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialDocument, useEditorStore } from '../store/editorStore'
import { Inspector } from './Inspector'

beforeEach(() => {
  useEditorStore.setState({
    document: createInitialDocument(),
    step: 'export',
  })
})

afterEach(cleanup)

describe('Export / Run workspace', () => {
  it('keeps shared and CoordsFinder-only settings separated in the sidebar', () => {
    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onClearProject={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Error tolerance')).toBeInTheDocument()
    expect(screen.getByText('CoordsFinder settings')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Export / Run' }),
    ).toBeInTheDocument()
  })

  it('opens the runtime comparison and leaves web search disabled', () => {
    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onClearProject={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))

    expect(
      screen.getByRole('dialog', { name: 'Export or run search' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Estimated hits')).toBeInTheDocument()
    expect(screen.getByText('Hit precision')).toBeInTheDocument()
    expect(screen.getByText('CoordsFinder CPU')).toBeInTheDocument()
    expect(screen.getByText('CoordsFinder CUDA')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Web search coming soon' }),
    ).toBeDisabled()
  })

  it('closes from the dialog close button', () => {
    render(
      <Inspector
        busy={false}
        onAutoFill={vi.fn()}
        onClearProject={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export / Run' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Close Export / Run' }),
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
