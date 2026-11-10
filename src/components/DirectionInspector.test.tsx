import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoAnalyzeRequest, AutoAnalyzeResponse } from '../domain/analysisProtocol'
import { createTestDocument } from '../test/createTestDocument'
import { useEditorStore } from '../store/editorStore'
import { TextureDirectionPanel } from './DirectionInspector'

vi.mock('../domain/imageAnalysis', async (importOriginal) => ({
  ...await importOriginal<typeof import('../domain/imageAnalysis')>(),
  warpQuad: vi.fn().mockResolvedValue({}),
  imageDataUrl: vi.fn().mockReturnValue('data:image/png;base64,crop'),
}))

const workers: AnalysisWorker[] = []
class AnalysisWorker {
  onmessage: ((event: MessageEvent<AutoAnalyzeResponse>) => void) | null = null
  onerror: (() => void) | null = null
  postMessage = vi.fn<(request: AutoAnalyzeRequest) => void>()
  terminate = vi.fn()
  constructor() { workers.push(this) }

  respond(confidence = 0.7) {
    const request = this.postMessage.mock.calls[0][0]
    this.onmessage?.({ data: {
      type: 'result',
      requestId: request.requestId,
      results: [{ evidenceId: request.jobs[0].evidenceId, confidence, scores: [
        { variant: 1, score: 0.9 }, { variant: 0, score: 0.2 },
        { variant: 2, score: 0.1 }, { variant: 3, score: 0.05 },
      ] }],
    } } as MessageEvent<AutoAnalyzeResponse>)
  }
}

beforeEach(() => {
  workers.length = 0
  vi.stubGlobal('Worker', AnalysisWorker)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      top: ['crafting_table_top.png', 'furnace_top.png'],
      bottom: ['crafting_table_top.png', 'furnace_top.png'],
    }),
  }))
  const document = createTestDocument()
  document.scene.axisMapping = { a: 'x+', b: 'z-', c: 'y+' }
  document.scanner.compassResolved = false
  useEditorStore.setState({ document, selectedEvidenceIds: [], past: [], future: [] })
  useEditorStore.getState().selectFace(document.scene.faces[0].id, false)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function analyze() {
  const button = screen.getByRole('button', { name: 'Auto Analyze' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  return workers[workers.length - 1]
}

describe('texture compass matching', () => {
  it('filters inside the picker and closes it after selection without changing the compass', async () => {
    render(<TextureDirectionPanel />)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('crafting table top', { selector: 'summary span' }))
    const search = await screen.findByRole('searchbox')
    expect(search).toHaveFocus()
    fireEvent.change(search, { target: { value: 'furnace' } })
    fireEvent.click(await screen.findByRole('button', { name: 'furnace top' }))
    await waitFor(() => expect(screen.queryByRole('searchbox')).not.toBeInTheDocument())
    expect(screen.getByText('furnace top', { selector: 'summary span' }).closest('summary')).toHaveFocus()
    expect(useEditorStore.getState().document.scanner.compassResolved).toBe(false)
  })

  it.each([0.1, 0.7])('selects a match directly when confidence is %s', async (confidence) => {
    render(<TextureDirectionPanel />)
    const worker = await analyze()
    const request = worker.postMessage.mock.calls[0][0]
    expect(request.jobs[0].transforms).toEqual(['identity', 'rotate90', 'rotate180', 'rotate270'])
    act(() => worker.respond(confidence))
    expect(useEditorStore.getState().document.scanner).toMatchObject({
      compassResolved: true, compassSource: 'texture', textureDirection: 90,
    })
    expect(screen.getByRole('button', { name: 'East (90°)' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Selected: East (90°)'))
    expect(worker.terminate).toHaveBeenCalled()
  })

  it.each([0, 0.09])('leaves matches below the threshold manual when confidence is %s', async (confidence) => {
    render(<TextureDirectionPanel />)
    const ambiguous = await analyze()
    act(() => ambiguous.respond(confidence))
    expect(screen.getByRole('status')).toHaveTextContent('No clear match')
    expect(useEditorStore.getState().document.scanner.compassResolved).toBe(false)
  })

  it('ignores results for a previous face', async () => {
    render(<TextureDirectionPanel />)
    const stale = await analyze()
    act(() => useEditorStore.getState().selectFace(
      useEditorStore.getState().document.scene.faces[1].id, false,
    ))
    expect(stale.terminate).toHaveBeenCalled()
    act(() => stale.respond())
    expect(useEditorStore.getState().document.scanner.compassResolved).toBe(false)
  })
})
