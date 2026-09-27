import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ScanSearch, X } from 'lucide-react'
import {
  createOffsetSearchRequest,
  offsetWorkerRanges,
} from '../domain/offsetSearch'
import { recommendedSearchWorkerCount } from '../domain/webSearch'
import type { EditorDocument } from '../domain/types'

interface WorkerProgress {
  next: number
  end: number
  matches: bigint
  phase: 'running' | 'completed' | 'stopped'
}

interface WorkerMessage extends WorkerProgress {
  start: number
  results: { x: number; z: number }[]
  error?: string
}

export function BlockOffsetsRunDialog({ document, open, onClose }: {
  document: EditorDocument
  open: boolean
  onClose: () => void
}) {
  const workers = useRef<Worker[]>([])
  const runId = useRef(0)
  const closeRef = useRef(onClose)
  const progressRef = useRef<Record<number, WorkerProgress>>({})
  const [workerCount, setWorkerCount] = useState(() =>
    recommendedSearchWorkerCount(globalThis.navigator.hardwareConcurrency))
  const [progress, setProgress] = useState<Record<number, WorkerProgress>>({})
  const [results, setResults] = useState<{ x: number; z: number }[]>([])
  const [phase, setPhase] = useState<'idle' | 'running' | 'completed' | 'stopped' | 'error'>('idle')
  const [error, setError] = useState<string>()
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  function terminate() {
    runId.current++
    workers.current.forEach((worker) => worker.terminate())
    workers.current = []
  }

  useEffect(() => {
    if (!open) {
      terminate()
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    globalThis.document.addEventListener('keydown', onKeyDown)
    globalThis.document.body.classList.add('export-run-dialog-open')
    return () => {
      terminate()
      globalThis.document.removeEventListener('keydown', onKeyDown)
      globalThis.document.body.classList.remove('export-run-dialog-open')
    }
  }, [open])

  useEffect(() => {
    if (phase !== 'running') return
    const timer = setInterval(() => setElapsed(performance.now() - startedAt), 500)
    return () => clearInterval(timer)
  }, [phase, startedAt])

  let requestError: string | undefined
  try {
    createOffsetSearchRequest(document)
  } catch (caught) {
    requestError = caught instanceof Error ? caught.message : String(caught)
  }
  const included = (document.offsets ?? []).filter((offset) => !offset.ignored).length
  const { xStart, xEnd, zStart, zEnd } = document.scanner.offsetBounds
  const shards = Object.values(progress)
  const processed = Object.entries(progress).reduce(
    (sum, [start, shard]) => sum + shard.next - Number(start), 0)
  const matches = shards.reduce((sum, shard) => sum + shard.matches, 0n)

  function start() {
    let request
    try {
      request = createOffsetSearchRequest(document)
    } catch (caught) {
      setError(String(caught))
      setPhase('error')
      return
    }
    terminate()
    const id = runId.current
    const ranges = offsetWorkerRanges(workerCount)
    const nextProgress: Record<number, WorkerProgress> = {}
    ranges.forEach((range) => {
      nextProgress[range.start] = { next: range.start, end: range.end, matches: 0n, phase: 'running' }
    })
    progressRef.current = nextProgress
    setProgress(nextProgress)
    setResults([])
    setError(undefined)
    setStartedAt(performance.now())
    setElapsed(0)
    setPhase('running')

    ranges.forEach((range) => {
      const worker = new Worker(new URL('../workers/offsetSearch.worker.ts', import.meta.url),
        { type: 'module' })
      workers.current.push(worker)
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (id !== runId.current) return
        const message = event.data
        if (message.error) {
          terminate()
          setError(message.error)
          setPhase('error')
          return
        }
        const updated = {
          ...progressRef.current,
          [message.start]: {
            next: message.next,
            end: message.end,
            matches: message.matches,
            phase: message.phase,
          },
        }
        progressRef.current = updated
        setProgress(updated)
        if (Object.values(updated).every((shard) => shard.phase === 'completed')) {
          setPhase('completed')
        }
        if (message.results.length) {
          setResults((current) => [...current, ...message.results]
            .sort((a, b) => a.x - b.x || a.z - b.z).slice(0, 1000))
        }
      }
      worker.onerror = (event) => {
        if (id !== runId.current) return
        terminate()
        setError(event.message || 'The offset worker stopped unexpectedly.')
        setPhase('error')
      }
      worker.postMessage({ type: 'start', request, ...range })
    })
  }

  function stop() {
    terminate()
    setPhase('stopped')
  }

  function close() {
    if (phase === 'running') stop()
    onClose()
  }
  closeRef.current = close

  if (!open) return null
  return createPortal(
    <div className="export-run-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close()
    }}>
      <section aria-labelledby="offset-run-title" aria-modal="true"
        className="export-run-dialog" role="dialog">
        <header className="export-run-header">
          <h2 id="offset-run-title">Block Offsets Search</h2>
          <button aria-label="Close Export / Run" className="icon-button"
            onClick={close} type="button"><X size={18} /></button>
        </header>
        <div className="export-run-content">
          <div className="export-run-readiness">
            <strong>Block Offsets</strong>
            <span className={`export-run-status ${requestError ? 'blocked' : 'ready'}`}>
              {requestError ? 'Needs evidence' : 'Ready to scan'}
            </span>
          </div>
          <div className="export-run-metrics">
            <div><span>Included offsets</span><strong>{included}</strong></div>
            <div><span>Search bounds</span>
              <strong>X: {xStart.toLocaleString()} to {xEnd.toLocaleString()}</strong>
              <small>Z: {zStart.toLocaleString()} to {zEnd.toLocaleString()}</small>
            </div>
          </div>
          <div className="export-run-actions">
            <article className="run-target">
              <div className="run-target-heading"><ScanSearch size={18} /><h3>Run in this browser</h3></div>
              <p>Search the selected X/Z bounds with fanda857’s bit lifting algorithm. Independent WASM workers scan disjoint X prefixes.</p>
              {requestError && <p role="alert">{requestError}</p>}
              <label className="field web-search-worker-count">Workers
                <select aria-label="Offset search workers" value={workerCount}
                  disabled={phase === 'running'}
                  onChange={(event) => setWorkerCount(Number(event.target.value))}>
                  {Array.from({ length: Math.min(16, Math.max(1, (globalThis.navigator.hardwareConcurrency || 2) - 1)) }, (_, index) =>
                    <option value={index + 1} key={index}>{index + 1}</option>)}
                </select>
              </label>
              {phase === 'running'
                ? <button className="secondary-button full" onClick={stop} type="button">Stop search</button>
                : <button className="primary-button full" disabled={Boolean(requestError)}
                    onClick={start} type="button">Run block offsets search</button>}
            </article>
          </div>
          {phase !== 'idle' && <div className="web-search-progress">
            <strong>{phase === 'completed' ? 'Search complete' : phase === 'running' ? 'Searching' : phase === 'stopped' ? 'Search stopped' : 'Search failed'}</strong>
            <progress max={65536} value={processed} />
            <span>{processed.toLocaleString()} / 65,536 X prefixes · {matches.toLocaleString()} matches · {(elapsed / 1000).toFixed(1)} s</span>
            {error && <p role="alert">{error}</p>}
          </div>}
          {results.length > 0 && <div className="web-search-results-scroll">
            <table className="web-search-results"><thead><tr><th>X</th><th>Z</th></tr></thead>
              <tbody>{results.map((result) => <tr key={`${result.x},${result.z}`}>
                <td>{result.x.toLocaleString()}</td><td>{result.z.toLocaleString()}</td>
              </tr>)}</tbody>
            </table>
            {matches > BigInt(results.length) && <p>Showing up to 1,000 matches.</p>}
          </div>}
        </div>
      </section>
    </div>, globalThis.document.body)
}
