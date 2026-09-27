import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  it('opens decoration settings in anchored popups', () => {
    render(<OffsetInspector />)

    expect(screen.queryByRole('dialog', { name: 'Add decoration' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add decoration' }))
    expect(screen.getByRole('dialog', { name: 'Add decoration' })).toBeInTheDocument()

    expect(screen.queryByLabelText('Decoration settings controls')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Decoration settings' }))
    expect(screen.getByLabelText('Decoration settings controls')).toBeInTheDocument()
    expect(screen.getByText('Model / block state')).toBeInTheDocument()
  })

  it('removes obsolete offset notices and model details', () => {
    render(<OffsetInspector />)

    expect(screen.queryByText(/Measurements are saved in your project/i)).not.toBeInTheDocument()
    expect(screen.queryByText('About these models')).not.toBeInTheDocument()
  })

  it('explains the handle and model clipping', () => {
    render(<OffsetInspector />)

    expect(screen.getByText('Handle')).toBeInTheDocument()
    expect(screen.getByText('Move vertically')).toBeInTheDocument()
    expect(screen.getByText('Move across blocks')).toBeInTheDocument()
    expect(screen.getByText('XZ Clipped:')).toBeInTheDocument()
    expect(screen.getByText('±0.125')).toBeInTheDocument()
    expect(screen.getByText('Y Scaled:')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('uses the clipped seed range and displays its usable endpoint seeds', () => {
    render(<OffsetInspector />)

    for (const axis of ['X', 'Z']) {
      const slider = screen.getByRole('slider', {
        name: `${axis} offset seed`,
      })
      expect(slider).toHaveAttribute('min', '3')
      expect(slider).toHaveAttribute('max', '12')
      expect(slider.parentElement).toHaveClass('offset-slider')
    }

    expect(screen.getByText('seed 3 / 15')).toBeInTheDocument()
    expect(screen.getByText('seed 12 / 15')).toBeInTheDocument()
    expect(screen.queryByText(/muted ends show clipped seed values/i))
      .not.toBeInTheDocument()
  })

  it('persists ignore state without hiding the decoration from the list', () => {
    render(<OffsetInspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Ignore model' }))
    expect(useEditorStore.getState().document.offsets?.[0].ignored).toBe(true)
    expect(screen.getByText('Ignored')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use model' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Use model' }))
    expect(useEditorStore.getState().document.offsets?.[0].ignored).toBe(false)
  })
})

describe('grass offset settings', () => {
  it('uses the grass colormap picker for decoration tint', () => {
    const document = createTestDocument()
    document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
    document.scanner.compassResolved = true
    document.offsets = [{
      id: 'grass',
      blockId: 'short_grass',
      modelIndex: 0,
      position: { x: 0, y: 0, z: 0 },
      nibbles: { x: 7, y: 0, z: 7 },
      tint: '#91bd59',
    }]
    useEditorStore.setState({ document, selectedOffsetId: 'grass' })
    render(<OffsetInspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Decoration settings' }))
    expect(screen.getByText('Grass tint')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Y occlusion' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Grass tint color map' })).toBeInTheDocument()
    expect(screen.queryByText('Hides the part shifted below the supporting block.')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Foliage tint')).not.toBeInTheDocument()
  })
})

describe('animated offset settings', () => {
  it('shares tall seagrass animation time by block type', () => {
    const document = createTestDocument()
    document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
    document.scanner.compassResolved = true
    document.offsets = [
      {
        id: 'first-seagrass',
        blockId: 'tall_seagrass',
        modelIndex: 0,
        position: { x: 0, y: 0, z: 0 },
        nibbles: { x: 7, y: 0, z: 7 },
        tint: '#ffffff',
      },
      {
        id: 'second-seagrass',
        blockId: 'tall_seagrass',
        modelIndex: 0,
        position: { x: 1, y: 0, z: 0 },
        nibbles: { x: 7, y: 0, z: 7 },
        tint: '#ffffff',
      },
    ]
    useEditorStore.setState({ document, selectedOffsetId: 'first-seagrass' })
    render(<OffsetInspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Decoration settings' }))
    const slider = screen.getByRole('slider', { name: 'Animation time' })
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '38')
    expect(slider).toHaveValue('1')
    fireEvent.change(slider, { target: { value: '17' } })

    expect(useEditorStore.getState().document.animationTicks?.tall_seagrass)
      .toBe(17)
    fireEvent.change(slider, { target: { value: '38' } })
    expect(useEditorStore.getState().document.animationTicks?.tall_seagrass)
      .toBe(38)
  })

  it('treats a new model as active without confirmation', () => {
    render(<OffsetInspector />)

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Confirm for search/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('slider', { name: 'X offset seed' }), {
      target: { value: '4' },
    })
    expect(screen.getByText('Active')).toBeInTheDocument()
  })
})
