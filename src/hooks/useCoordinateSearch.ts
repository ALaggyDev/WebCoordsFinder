import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import {
  createWebSearchCheckpoint, initialWebSearchState, restoreWebSearchCheckpoint,
  WEB_SEARCH_ENGINE_VERSION, webSearchRequestVolume,
  type WebSearchRequest, type WebSearchViewState, type WebSearchWorkerState,
} from '../domain/webSearch'

/** Own the run independently of dialog visibility; checkpoint exact worker cursors. */
export function useCoordinateSearch(request: WebSearchRequest | undefined, requestKey: string | undefined) {
  const checkpoint = useEditorStore((s) => s.document.scanner.webSearch)
  const save = useEditorStore((s) => s.setWebSearchCheckpoint)
  const [state, setState] = useState<WebSearchViewState>(() =>
    checkpoint?.engineVersion === WEB_SEARCH_ENGINE_VERSION ? restoreWebSearchCheckpoint(checkpoint) : initialWebSearchState)
  const current = useRef(state)
  const worker = useRef<Worker | null>(null)
  const runId = useRef('')
  const runKey = useRef(checkpoint?.requestKey)
  const ownedCheckpoint = useRef(checkpoint)
  const lastSaved = useRef(0)
  const update = (next: WebSearchViewState, force = false) => {
    current.current = next
    setState(next)
    if (runKey.current &&
      useEditorStore.getState().document.scanner.webSearch === ownedCheckpoint.current &&
      (force || Date.now() - lastSaved.current > 1500)) {
      lastSaved.current = Date.now()
      const nextCheckpoint = createWebSearchCheckpoint(runKey.current, next)
      ownedCheckpoint.current = nextCheckpoint
      save(nextCheckpoint)
    }
  }
  useEffect(() => () => {
    worker.current?.terminate()
    worker.current = null
    // A newly loaded project can have the same search key. Object ownership
    // prevents this outgoing controller from writing its progress into it.
    if (ownedCheckpoint.current === useEditorStore.getState().document.scanner.webSearch &&
      runKey.current && ['running', 'loading', 'pausing', 'stopping'].includes(current.current.phase)) {
      save(createWebSearchCheckpoint(runKey.current, { ...current.current, phase: 'paused' }))
    }
  }, [save])

  const start = (workerCount: number, resume = false) => {
    if (!request || !requestKey) return
    worker.current?.terminate()
    const nextWorker = new Worker(new URL('../workers/search.pool.worker.ts', import.meta.url), { type: 'module' })
    const id = crypto.randomUUID()
    const previous = current.current
    worker.current = nextWorker
    runId.current = id
    runKey.current = requestKey
    update(resume ? { ...previous, phase: 'loading', error: undefined } : {
      ...initialWebSearchState, phase: 'loading', total: webSearchRequestVolume(request), offsetMatchCount: 0n, yUnconstrained: request.yUnconstrained, offsetBits: request.offsetBits,
    }, true)
    nextWorker.onmessage = (event: MessageEvent<WebSearchWorkerState>) => {
      const message = event.data
      if (runId.current !== id || message.requestId !== id) return
      const terminal = ['completed', 'stopped', 'error'].includes(message.phase)
      update({ ...message, yUnconstrained: request.yUnconstrained, offsetBits: request.offsetBits, results: message.results ?? current.current.results }, terminal || message.phase === 'paused')
      if (terminal) { nextWorker.terminate(); worker.current = null }
    }
    nextWorker.onerror = () => {
      if (runId.current !== id) return
      nextWorker.terminate()
      worker.current = null
      update({ ...current.current, phase: 'error', error: 'The search worker stopped unexpectedly.' }, true)
    }
    nextWorker.postMessage({ type: 'start', requestId: id, request, workerCount,
      checkpoint: resume ? { processed: previous.processed, matchCount: previous.matchCount,
        offsetMatchCount: previous.offsetMatchCount, results: previous.results, shards: previous.shards } : undefined })
  }
  const command = (type: 'pause' | 'resume' | 'stop') => {
    if (!worker.current) return
    worker.current.postMessage({ type, requestId: runId.current })
    update({ ...current.current, phase: type === 'pause' ? 'pausing' : type === 'stop' ? 'stopping' : 'running' })
  }
  const stale = Boolean(runKey.current && runKey.current !== requestKey)
  const attached = worker.current !== null
  const canResume = !stale && state.processed < state.total && Boolean(state.shards?.length) &&
    ['paused', 'stopped', 'error'].includes(state.phase)
  const clear = () => {
    worker.current?.terminate()
    worker.current = null
    runId.current = ''
    runKey.current = undefined
    ownedCheckpoint.current = null
    save(null)
    update(initialWebSearchState)
  }
  return { state, start, command, clear, attached, stale, canResume }
}
