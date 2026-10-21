import type { ReactNode } from 'react'
import type Konva from 'konva'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { OffsetOverlay } from './OffsetOverlay'
import { loadOffsetTextures, prepareOffsetModels, rasterizeOffsetModels, rasterizeOffsetModelPatch } from '../domain/offsetRendering'
import { sceneLatticeParity, validAxisMappingCompletions } from '../domain/geometry'
import { useEditorStore } from '../store/editorStore'
import { createTestDocument } from '../test/createTestDocument'
import { offsetHandlePoint } from '../domain/blockOffsets'

type DragHandler = (event: Konva.KonvaEventObject<DragEvent>) => void
const dragHandlers = vi.hoisted(() => new Map<string, DragHandler>())

// Exercise cache lifetime without depending on a native canvas in jsdom.
vi.mock('react-konva', () => ({
  Layer: ({ children }: { children: ReactNode }) => <>{children}</>,
  Group: ({ children, draggable, ...props }: {
    children: ReactNode
    draggable?: boolean
    onDragStart?: DragHandler
    onDragMove?: DragHandler
    onDragEnd?: DragHandler
  }) => {
    if (draggable)
      for (const name of ['onDragStart', 'onDragMove', 'onDragEnd'] as const)
        if (props[name]) dragHandlers.set(name, props[name])
    return <>{children}</>
  },
  Circle: () => null,
  Image: () => null,
  Line: () => null,
  Text: () => null,
}))
vi.mock('../domain/offsetRendering', () => ({
  loadOffsetTextures: vi.fn(async () => new Map()),
  prepareOffsetModels: vi.fn(() => []),
  rasterizeOffsetModels: vi.fn(() => undefined),
  rasterizeOffsetModelPatch: vi.fn(() => undefined),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  dragHandlers.clear()
})

it('keeps stationary models cached during dragging and commits one undo step', async () => {
  const document = createTestDocument()
  document.scene.axisMapping = validAxisMappingCompletions(
    { a: 'unknown', b: 'unknown', c: 'unknown' },
    sceneLatticeParity(document.scene),
  )[0]
  document.scanner.compassResolved = true
  document.offsets = ['stationary', 'moving'].map((id) => ({
    id, blockId: 'short_grass', modelIndex: 0,
    position: { x: 0, y: 0, z: 0 },
    nibbles: { x: 0, y: 0, z: 0 }, tint: '#91bd59',
  }))
  useEditorStore.setState({ document, step: 'offsets', past: [], future: [] })
  render(<OffsetOverlay scale={1} showModels />)
  await act(async () => {})
  let position = offsetHandlePoint(document.scene, document.offsets[1])!
  const event = {
    target: { position: (next?: typeof position) => {
      if (next) position = next
      return position
    } },
    evt: { ctrlKey: true, shiftKey: false },
  } as unknown as Konva.KonvaEventObject<DragEvent>
  act(() => dragHandlers.get('onDragStart')!(event))
  vi.mocked(prepareOffsetModels).mockClear()
  vi.mocked(rasterizeOffsetModels).mockClear()
  vi.mocked(rasterizeOffsetModelPatch).mockClear()

  // Whole-block dragging must prepare only the moving entry on each change.
  for (const x of [1, 2]) {
    position = offsetHandlePoint(document.scene, {
      ...document.offsets[1], position: { x, y: 0, z: 0 },
    })!
    act(() => dragHandlers.get('onDragMove')!(event))
  }
  expect(prepareOffsetModels).toHaveBeenCalledTimes(2)
  for (const call of vi.mocked(prepareOffsetModels).mock.calls)
    expect(call[1].map((entry) => entry.id)).toEqual(['moving'])
  expect(rasterizeOffsetModels).not.toHaveBeenCalled()
  expect(rasterizeOffsetModelPatch).toHaveBeenCalledTimes(2)
  expect(useEditorStore.getState().past).toHaveLength(0)

  // Repeated pointer events on the same snapped block need no texture work.
  act(() => dragHandlers.get('onDragMove')!(event))
  expect(prepareOffsetModels).toHaveBeenCalledTimes(2)
  act(() => dragHandlers.get('onDragEnd')!(event))
  expect(useEditorStore.getState().document.offsets?.[1].position).toEqual({ x: 2, y: 0, z: 0 })
  expect(useEditorStore.getState().past).toHaveLength(1)
  expect(vi.mocked(prepareOffsetModels).mock.lastCall?.[1]).toHaveLength(2)
})

it('reuses model rendering across pan, selection, opacity, and zoom gestures', async () => {
  vi.useFakeTimers()
  const document = createTestDocument()
  document.scene.axisMapping = validAxisMappingCompletions(
    { a: 'unknown', b: 'unknown', c: 'unknown' },
    sceneLatticeParity(document.scene),
  )[0]
  document.scanner.compassResolved = true
  document.offsets = [{
    id: 'grass', blockId: 'short_grass', modelIndex: 0,
    position: { x: 0, y: 0, z: 0 },
    nibbles: { x: 0, y: 0, z: 0 }, tint: '#91bd59',
  }]
  useEditorStore.setState({ document, step: 'offsets', selectedOffsetId: null })
  const view = render(<OffsetOverlay scale={1} showModels />)
  await act(async () => {}) // Finish the initial texture load.
  vi.mocked(prepareOffsetModels).mockClear()
  vi.mocked(rasterizeOffsetModels).mockClear()

  // Parent rerenders during panning must not rerun texture rendering.
  view.rerender(<OffsetOverlay scale={1} showModels />)
  act(() => useEditorStore.setState({ selectedOffsetId: 'grass', offsetOpacity: 0.4 }))
  view.rerender(<OffsetOverlay scale={2} showModels />)
  act(() => vi.advanceTimersByTime(80))
  view.rerender(<OffsetOverlay scale={3} showModels />)
  act(() => vi.advanceTimersByTime(80))
  expect(prepareOffsetModels).not.toHaveBeenCalled()
  expect(rasterizeOffsetModels).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(40))
  expect(rasterizeOffsetModels).toHaveBeenCalledTimes(1)
  expect(prepareOffsetModels).not.toHaveBeenCalled()

  act(() => useEditorStore.getState().updateOffset('grass', {
    position: { x: 1, y: 0, z: 0 },
  }))
  expect(prepareOffsetModels).toHaveBeenCalledTimes(1)
  expect(rasterizeOffsetModels).toHaveBeenCalledTimes(2)
  expect(loadOffsetTextures).toHaveBeenCalledTimes(1)

  view.rerender(<OffsetOverlay scale={3} showModels={false} />)
  expect(vi.mocked(rasterizeOffsetModels).mock.lastCall?.[0]).toEqual([])
})
