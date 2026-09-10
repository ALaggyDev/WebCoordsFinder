import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDocument } from '../test/createTestDocument'
import { useEditorStore } from '../store/editorStore'
import { OffsetInspector } from './OffsetInspector'

beforeEach(() => {
  const document = createTestDocument()
  document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
  document.scanner.compassResolved = true
  document.offsets = [
    {
      id: 'dripstone',
      blockId: 'pointed_dripstone',
      modelIndex: 0,
      position: { x: 0, y: 0, z: 0 },
      nibbles: { x: 0, y: 0, z: 15 },
      tint: '#91bd59',
    },
  ]
  useEditorStore.setState({
    document,
    step: 'offsets',
    selectedOffsetId: 'dripstone',
    selectedEvidenceIds: [],
    past: [],
    future: [],
  })
})

afterEach(cleanup)

describe('dripstone offset controls', () => {
  it('documents the unified modifier-based drag handle', () => {
    render(<OffsetInspector />)

    expect(screen.getByText(/hold shift for within-block y/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move block' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fit offset' })).not.toBeInTheDocument()
  })

  it('shows the full track but caps X/Z at the equivalent clipped seeds', () => {
    render(<OffsetInspector />)

    for (const axis of ['X', 'Z']) {
      const slider = screen.getByRole('slider', {
        name: `${axis} offset seed`,
      })
      expect(slider).toHaveAttribute('min', '3')
      expect(slider).toHaveAttribute('max', '12')
      expect(slider.parentElement).toHaveClass('clamped')
    }

    expect(screen.getByText(/muted ends show clipped seed values/i))
      .toBeInTheDocument()
  })
})
