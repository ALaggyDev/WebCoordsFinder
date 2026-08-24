import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  Gauge,
  Globe2,
  LoaderCircle,
  MonitorCog,
  Pause,
  Play,
  RotateCcw,
  Save,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import {
  constraintBits,
  generateCoordsFinderConfig,
  validateForExport,
} from '../domain/exportConfig'
import {
  estimateHitCount,
  estimateHitPrecision,
  estimateSearchVolume,
  estimateSearchTimes,
  formatEstimatedCount,
  formatSearchTime,
  minimumBitsForPrecision,
  type SearchRuntime,
} from '../domain/searchEstimates'
import type { EditorDocument, WebSearchResult } from '../domain/types'
import {
  createWebSearchCheckpoint,
  createWebSearchRequest,
  formatSearchCount,
  initialWebSearchState,
  MAX_WEB_SEARCH_RESULTS,
  maximumSearchWorkerCount,
  recommendedSearchWorkerCount,
  restoreWebSearchCheckpoint,
  searchProgressPercent,
  webSearchRequestKey,
  webSearchRequestVolume,
  type WebSearchPhase,
  type WebSearchViewState,
  type WebSearchWorkerCommand,
  type WebSearchWorkerState,
} from '../domain/webSearch'
import { useEditorStore } from '../store/editorStore'
import './ExportRunDialog.css'

/*
 * This component owns the browser-search worker lifecycle. React state drives
 * the UI, refs provide exact current values to asynchronous callbacks, and
 * compact checkpoints are persisted through the editor document without undo
 * entries.
 */
interface ExportRunDialogProps {
  document: EditorDocument
  open: boolean
  onClose: () => void
  onDownload: () => void
}

const runtimeDetails: Record<
  SearchRuntime,
  {
    label: string
    detail: string
    icon: typeof Globe2
  }
> = {
  web: {
    label: 'Web',
    detail: 'Parallel WASM worker pool',
    icon: Globe2,
  },
  cpu: {
    label: 'CoordsFinder CPU',
    detail: '~1B positions/sec',
    icon: Cpu,
  },
  cuda: {
    label: 'CoordsFinder CUDA',
    detail: '~70B positions/sec',
    icon: MonitorCog,
  },
}

function formatHitPrecision(rate: number): string {
  const percent = rate * 100
  if (percent < 0.005) return '<0.01%'
  if (percent >= 99.5) return '~100.0%'
  return `${percent.toFixed(percent < 1 ? 2 : 1)}%`
}

const phaseLabels: Record<WebSearchPhase, string> = {
  idle: 'Not started',
  loading: 'Loading scanner',
  running: 'Searching',
  pausing: 'Pausing',
  paused: 'Paused',
  stopping: 'Stopping',
  stopped: 'Stopped',
  completed: 'Complete',
  error: 'Search failed',
}

function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return 'Measuring...'
  const compact = rate >= 1_000_000
  return `${new Intl.NumberFormat('en-US', {
    notation: compact ? 'compact' : 'standard',
    // Compact units otherwise round every billions-per-second rate to a bare
    // "1B", which cannot be told apart from 1.9B. Three significant figures
    // keeps each unit readable: 41.4M, 632M, 1.03B.
    ...(compact
      ? { maximumSignificantDigits: 3 }
      : { maximumFractionDigits: rate < 100 ? 1 : 0 }),
  }).format(rate)}/sec`
}

const checkpointIntervalMilliseconds = 1_500

const SearchResultTable = memo(function SearchResultTable({
  results,
  hasMore,
}: {
  results: WebSearchResult[]
  hasMore: boolean
}) {
  return (
    <div className="web-search-results">
      <div className="web-search-results-heading">
        <strong>Candidate coordinates</strong>
        <span>
          Showing {results.length.toLocaleString()}
          {hasMore && ' earliest'} match{results.length === 1 ? '' : 'es'}
        </span>
      </div>
      <div className="web-search-results-scroll">
        <table>
          <thead>
            <tr>
              <th>X</th>
              <th>Y</th>
              <th>Z</th>
              <th>Direction</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr
                key={`${result.x}:${result.y}:${result.z}:${result.direction}`}
              >
                <td>{result.x}</td>
                <td>{result.y}</td>
                <td>{result.z}</td>
                <td>{result.direction}°</td>
                <td>{result.badBlocks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <small>
          Result display is capped at the first{' '}
          {MAX_WEB_SEARCH_RESULTS.toLocaleString()} coordinates; the total match
          count remains exact.
        </small>
      )}
    </div>
  )
})

export function ExportRunDialog({
  document,
  open,
  onClose,
  onDownload,
}: ExportRunDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const setWebSearchCheckpoint = useEditorStore(
    (state) => state.setWebSearchCheckpoint,
  )
  const savedCheckpoint = document.scanner.webSearch
  const [webSearch, setWebSearch] = useState(() =>
    restoreWebSearchCheckpoint(savedCheckpoint),
  )
  const maximumWorkerCount = maximumSearchWorkerCount(
    globalThis.navigator.hardwareConcurrency,
  )
  const [workerCount, setWorkerCount] = useState(() =>
    recommendedSearchWorkerCount(globalThis.navigator.hardwareConcurrency),
  )
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  )
  // Worker callbacks can outlive the render that installed them; mirror state
  // in a ref to merge progress and result batches without stale closures.
  const webSearchRef = useRef(webSearch)
  const requestKeyRef = useRef(savedCheckpoint?.requestKey ?? null)
  const lastCheckpointUpdateRef = useRef(0)
  const validation = useMemo(() => validateForExport(document), [document])
  const config = useMemo(() => generateCoordsFinderConfig(document), [document])
  const searchVolume = useMemo(() => estimateSearchVolume(document), [document])
  const estimatedHits = useMemo(() => estimateHitCount(document), [document])
  const hitPrecision = useMemo(() => estimateHitPrecision(document), [document])
  const minimumBitsFor80Percent = useMemo(
    () => minimumBitsForPrecision(document, 0.8),
    [document],
  )
  const currentSearch = useMemo(() => {
    try {
      const request = createWebSearchRequest(document)
      return { request, requestKey: webSearchRequestKey(request) }
    } catch {
      // Detailed readiness errors are already rendered from validateForExport.
      return undefined
    }
  }, [document])
  const estimates = useMemo(
    () => estimateSearchTimes(
      document,
      requestKeyRef.current === currentSearch?.requestKey
        ? webSearch.checksPerSecond
        : undefined,
    ),
    [currentSearch?.requestKey, document, webSearch.checksPerSecond],
  )

  useEffect(() => {
    setCopyStatus('idle')
  }, [config, open])

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(config)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }
  const progressPercent = searchProgressPercent(
    webSearch.processed,
    webSearch.total,
  )
  const remainingSeconds =
    webSearch.checksPerSecond > 0
      ? Number(webSearch.total - webSearch.processed) /
        webSearch.checksPerSecond
      : undefined
  const workerIsAttached = workerRef.current !== null
  const searchIsActive =
    workerIsAttached &&
    ['loading', 'running', 'pausing', 'paused', 'stopping'].includes(
      webSearch.phase,
    )
  const checkpointIsStale = Boolean(
    // Preserve stale results for inspection, but never resume them against a
    // configuration with a different deterministic request key.
    savedCheckpoint &&
      (!currentSearch || savedCheckpoint.requestKey !== currentSearch.requestKey),
  )
  const canResumeSavedSearch = Boolean(
    !workerIsAttached &&
      savedCheckpoint &&
      currentSearch &&
      !checkpointIsStale &&
      webSearch.processed < webSearch.total &&
      (webSearch.phase === 'paused' ||
        webSearch.phase === 'stopped' ||
        webSearch.phase === 'error'),
  )

  const terminateWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    requestIdRef.current = null
  }, [])

  const applyWebSearchState = useCallback((next: WebSearchViewState) => {
    webSearchRef.current = next
    setWebSearch(next)
  }, [])

  const persistWebSearchState = useCallback(
    (next: WebSearchViewState, force = false) => {
      const requestKey = requestKeyRef.current
      if (!requestKey) return
      const now = Date.now()
      if (
        !force &&
        now - lastCheckpointUpdateRef.current < checkpointIntervalMilliseconds
      ) {
        return
      }
      // Progress events arrive frequently; periodic snapshots protect IndexedDB
      // while terminal and result milestones can still force an immediate save.
      lastCheckpointUpdateRef.current = now
      setWebSearchCheckpoint(createWebSearchCheckpoint(requestKey, next, now))
    },
    [setWebSearchCheckpoint],
  )

  const startWebSearch = (resume: boolean) => {
    try {
      const search = currentSearch
      if (!search) throw new Error('The search configuration is not ready.')
      const { request, requestKey } = search
      const previous = webSearchRef.current
      terminateWorker()
      const worker = new Worker(
        new URL('../workers/search.pool.worker.ts', import.meta.url),
        { type: 'module' },
      )
      const requestId = globalThis.crypto.randomUUID()
      workerRef.current = worker
      requestIdRef.current = requestId
      requestKeyRef.current = requestKey
      lastCheckpointUpdateRef.current = 0
      const loadingState: WebSearchViewState = resume
        ? { ...previous, phase: 'loading', error: undefined }
        : {
            ...initialWebSearchState,
            phase: 'loading',
            total: webSearchRequestVolume(request),
          }
      applyWebSearchState(loadingState)
      persistWebSearchState(loadingState, true)

      worker.onmessage = (event: MessageEvent<WebSearchWorkerState>) => {
        const message = event.data
        if (
          message.type !== 'state' ||
          message.requestId !== requestIdRef.current
        ) {
          return
        }
        const current = webSearchRef.current
        const next: WebSearchViewState = {
          phase: message.phase,
          processed: message.processed,
          total: message.total,
          matchCount: message.matchCount,
          checksPerSecond: message.checksPerSecond,
          // A supplied snapshot is complete and ordinal-sorted, allowing lower
          // matches to displace faster later shards. Counter-only progress
          // publications retain the same array identity and avoid table work.
          results: message.results ?? current.results,
          shards: message.shards,
          error: message.error,
        }
        const terminal =
          message.phase === 'completed' ||
          message.phase === 'stopped' ||
          message.phase === 'error'
        if (terminal) {
          worker.terminate()
          if (workerRef.current === worker) workerRef.current = null
        }
        applyWebSearchState(next)
        const resultMilestone =
          // Persist the first visible result and the moment the capture cap is
          // reached, even if the normal checkpoint interval has not elapsed.
          (current.results.length === 0 && next.results.length > 0) ||
          (current.results.length < MAX_WEB_SEARCH_RESULTS &&
            next.results.length === MAX_WEB_SEARCH_RESULTS)
        persistWebSearchState(
          next,
          terminal || message.phase === 'paused' || resultMilestone,
        )
      }
      worker.onerror = () => {
        const next: WebSearchViewState = {
          ...webSearchRef.current,
          phase: 'error',
          error: 'The web search worker stopped unexpectedly.',
        }
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
        applyWebSearchState(next)
        persistWebSearchState(next, true)
      }

      const command: WebSearchWorkerCommand = {
        type: 'start',
        requestId,
        request,
        checkpoint: resume
          ? {
              processed: previous.processed,
              matchCount: previous.matchCount,
              results: previous.results,
              shards: previous.shards,
            }
          : undefined,
        workerCount,
      }
      worker.postMessage(command)
    } catch (error) {
      const next: WebSearchViewState = {
        ...webSearchRef.current,
        phase: 'error',
        error:
          error instanceof Error ? error.message : 'Unable to start web search.',
      }
      applyWebSearchState(next)
      persistWebSearchState(next, true)
    }
  }

  const sendWorkerCommand = (
    type: Extract<
      WebSearchWorkerCommand,
      { type: 'pause' | 'resume' | 'stop' }
    >['type'],
  ) => {
    const worker = workerRef.current
    const requestId = requestIdRef.current
    if (!worker || !requestId) return
    const command: WebSearchWorkerCommand = { type, requestId }
    worker.postMessage(command)
    // Transitional phases disable repeated commands until the worker reports
    // the authoritative paused/stopped state.
    let next: WebSearchViewState
    if (type === 'pause') {
      next = { ...webSearchRef.current, phase: 'pausing' }
    } else if (type === 'resume') {
      next = { ...webSearchRef.current, phase: 'running' }
    } else {
      next = { ...webSearchRef.current, phase: 'stopping' }
    }
    applyWebSearchState(next)
    if (type === 'stop') persistWebSearchState(next, true)
  }

  const clearSavedSearch = () => {
    terminateWorker()
    requestKeyRef.current = null
    lastCheckpointUpdateRef.current = 0
    setWebSearchCheckpoint(null)
    applyWebSearchState(initialWebSearchState)
  }

  useEffect(() => {
    if (!open) return
    const previouslyFocused = globalThis.document.activeElement
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.document.addEventListener('keydown', onKeyDown)
    globalThis.document.body.classList.add('export-run-dialog-open')
    // Move focus into the modal and restore it to the invoking control later.
    closeButtonRef.current?.focus()

    return () => {
      globalThis.document.removeEventListener('keydown', onKeyDown)
      globalThis.document.body.classList.remove('export-run-dialog-open')
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [onClose, open])

  useEffect(() => {
    if (savedCheckpoint?.phase === 'running') {
      persistWebSearchState(webSearchRef.current, true)
    }
  }, [persistWebSearchState, savedCheckpoint?.phase])

  useEffect(() => () => terminateWorker(), [terminateWorker])

  if (!open) return null

  return createPortal(
    <div
      className="export-run-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-labelledby="export-run-title"
        aria-modal="true"
        className="export-run-dialog"
        role="dialog"
      >
        <header className="export-run-header">
          <div>
            <span>Search handoff</span>
            <h2 id="export-run-title">Export or run search</h2>
          </div>
          <button
            aria-label="Close Export / Run"
            className="icon-button"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="export-run-content">
          <div className="export-run-readiness">
            <div>
              <span className="export-run-section-label">Search readiness</span>
              <strong>
                {validation.errors.length === 0
                  ? 'Ready to search'
                  : 'Configuration needs attention'}
              </strong>
            </div>
            <span
              className={
                validation.errors.length === 0
                  ? 'export-run-status ready'
                  : 'export-run-status blocked'
              }
            >
              {validation.errors.length === 0 ? (
                <CheckCircle2 size={14} />
              ) : (
                <AlertTriangle size={14} />
              )}
              {validation.errors.length === 0 ? 'Ready' : 'Blocked'}
            </span>
          </div>

          <div className="export-run-metrics">
            <div>
              <span>Confirmed constraints</span>
              <strong>{validation.rowCount}</strong>
            </div>
            <div>
              <span>Information</span>
              <strong>{constraintBits(document)} bits</strong>
              <small>
                {minimumBitsFor80Percent === undefined
                  ? 'Unknown bits needed for 80%'
                  : `${minimumBitsFor80Percent} bits needed for 80%`}
              </small>
            </div>
            <div>
              <span>Search positions</span>
              <strong>{formatEstimatedCount(searchVolume)}</strong>
            </div>
            <div>
              <span>Estimated hits</span>
              <strong>{formatEstimatedCount(estimatedHits)}</strong>
            </div>
            <div>
              <span>Hit precision</span>
              <strong>{formatHitPrecision(hitPrecision)}</strong>
              <small>Chance a hit is correct</small>
            </div>
          </div>

          <section className="export-run-section">
            <div className="export-run-section-heading">
              <div>
                <span className="export-run-section-label">
                  Estimated search time
                </span>
                <h3>Runtime comparison</h3>
              </div>
            </div>
            <div className="runtime-estimates">
              {estimates.map((estimate) => {
                const details = runtimeDetails[estimate.runtime]
                const Icon = details.icon
                return (
                  <article className="runtime-estimate" key={estimate.runtime}>
                    <div className="runtime-estimate-heading">
                      <Icon size={17} />
                      <span>{details.label}</span>
                    </div>
                    <strong>
                      {estimate.seconds === undefined
                        ? 'Measured at runtime'
                        : formatSearchTime(estimate.seconds)}
                    </strong>
                    <small>{details.detail}</small>
                  </article>
                )
              })}
            </div>
          </section>

          {(validation.errors.length > 0 ||
            validation.warnings.length > 0) && (
            <div className="export-run-validation">
              {validation.errors.map((message) => (
                <div className="validation error" key={message}>
                  <X size={14} />
                  {message}
                </div>
              ))}
              {validation.warnings.map((message) => (
                <div className="validation warning" key={message}>
                  <AlertTriangle size={14} />
                  {message}
                </div>
              ))}
            </div>
          )}

          <div className="export-run-actions">
            <article className="run-target">
              <div className="run-target-heading">
                <Globe2 size={18} />
                <div>
                  <h3>Run in this browser</h3>
                  <span>Local web search</span>
                </div>
              </div>
              <p>
                A local WASM worker pool scans without uploading project data.
                Progress and matches autosave with the project; the search
                continues when this dialog is closed.
              </p>

              <label className="field web-search-worker-count">
                <span>Search workers</span>
                <select
                  aria-label="Search workers"
                  disabled={workerIsAttached}
                  value={workerCount}
                  onChange={(event) => setWorkerCount(Number(event.target.value))}
                >
                  {Array.from({ length: maximumWorkerCount }, (_, index) => index + 1)
                    .map((count) => (
                      <option key={count} value={count}>
                        {count}{count === recommendedSearchWorkerCount(globalThis.navigator.hardwareConcurrency) ? ' (recommended)' : ''}
                      </option>
                    ))}
                </select>
                <small>Reserve fewer cores for other work or increase throughput on larger CPUs.</small>
              </label>

              {checkpointIsStale && webSearch.phase !== 'idle' && (
                <div className="validation warning">
                  <AlertTriangle size={14} />
                  The search setup changed. These saved results are preserved,
                  but this checkpoint cannot be resumed.
                </div>
              )}

              {!workerIsAttached && canResumeSavedSearch && (
                <div className="web-search-start-actions">
                  <button
                    className="primary-button"
                    onClick={() => startWebSearch(true)}
                    type="button"
                  >
                    <Play size={16} /> Resume saved search
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => startWebSearch(false)}
                    type="button"
                  >
                    <RotateCcw size={15} /> Start over
                  </button>
                </div>
              )}

              {!workerIsAttached && !canResumeSavedSearch && (
                <button
                  className="primary-button full"
                  disabled={!currentSearch}
                  onClick={() => startWebSearch(false)}
                  type="button"
                >
                  {webSearch.phase === 'idle' ? (
                    <>
                      <Play size={16} /> Run web search
                    </>
                  ) : (
                    <>
                      <RotateCcw size={16} />{' '}
                      {checkpointIsStale ? 'Start new search' : 'Run again'}
                    </>
                  )}
                </button>
              )}

              {webSearch.phase !== 'idle' && (
                <div className="web-search-progress">
                  <div className="web-search-progress-heading">
                    <span
                      className={`web-search-phase ${webSearch.phase}`}
                      role="status"
                    >
                      {webSearch.phase === 'loading' ||
                      webSearch.phase === 'pausing' ||
                      webSearch.phase === 'stopping' ? (
                        <LoaderCircle className="spin" size={13} />
                      ) : webSearch.phase === 'paused' ? (
                        <Pause size={13} />
                      ) : webSearch.phase === 'completed' ? (
                        <CheckCircle2 size={13} />
                      ) : webSearch.phase === 'error' ? (
                        <AlertTriangle size={13} />
                      ) : (
                        <Gauge size={13} />
                      )}
                      {phaseLabels[webSearch.phase]}
                    </span>
                    <strong>{progressPercent.toFixed(2)}%</strong>
                  </div>
                  <progress
                    aria-label="Web search progress"
                    max={100}
                    value={progressPercent}
                  />
                  <div className="web-search-stats">
                    <div>
                      <span>Checked</span>
                      <strong>
                        {formatSearchCount(webSearch.processed)}
                        <small>
                          {' / '}
                          {formatSearchCount(webSearch.total)}
                        </small>
                      </strong>
                    </div>
                    <div>
                      <span>Matches</span>
                      <strong>{formatSearchCount(webSearch.matchCount)}</strong>
                    </div>
                    <div>
                      <span>Speed</span>
                      <strong>{formatRate(webSearch.checksPerSecond)}</strong>
                    </div>
                    <div>
                      <span>Remaining</span>
                      <strong>
                        {webSearch.phase === 'stopped'
                          ? 'Stopped'
                          : webSearch.phase === 'paused'
                            ? 'Paused'
                            : webSearch.phase === 'completed'
                              ? 'Done'
                          : remainingSeconds === undefined
                            ? 'Measuring...'
                            : formatSearchTime(remainingSeconds)}
                      </strong>
                    </div>
                  </div>

                  <div className="web-search-checkpoint-note">
                    <Save size={13} />
                    Progress and the first{' '}
                    {MAX_WEB_SEARCH_RESULTS.toLocaleString()} matches are saved
                    with this project.
                  </div>

                  {webSearch.error && (
                    <div className="validation error">
                      <X size={14} />
                      {webSearch.error}
                    </div>
                  )}

                  {searchIsActive && (
                    <div className="web-search-controls">
                      {webSearch.phase === 'paused' ? (
                        <button
                          className="secondary-button"
                          onClick={() => sendWorkerCommand('resume')}
                          type="button"
                        >
                          <Play size={14} /> Resume
                        </button>
                      ) : (
                        <button
                          className="secondary-button"
                          disabled={webSearch.phase !== 'running'}
                          onClick={() => sendWorkerCommand('pause')}
                          type="button"
                        >
                          <Pause size={14} /> Pause
                        </button>
                      )}
                      <button
                        className="danger-button"
                        disabled={webSearch.phase === 'stopping'}
                        onClick={() => sendWorkerCommand('stop')}
                        type="button"
                      >
                        <Square size={13} /> Stop
                      </button>
                    </div>
                  )}
                </div>
              )}

              {webSearch.results.length > 0 && (
                <SearchResultTable
                  results={webSearch.results}
                  hasMore={
                    webSearch.matchCount > BigInt(webSearch.results.length)
                  }
                />
              )}

              {!workerIsAttached && webSearch.phase !== 'idle' && (
                <button
                  className="web-search-clear"
                  onClick={clearSavedSearch}
                  type="button"
                >
                  <Trash2 size={12} /> Clear saved search
                </button>
              )}
            </article>

            <article className="run-target">
              <div className="run-target-heading">
                <Download size={18} />
                <div>
                  <h3>Use CoordsFinder</h3>
                  <span>Native CPU or CUDA</span>
                </div>
              </div>
              <p>
                Download the exact configuration for your local CoordsFinder
                executable.
              </p>
              <div className="coordsfinder-links">
                <a
                  href="https://github.com/ALaggyDev/CoordsFinder"
                  target="_blank"
                  rel="noreferrer"
                >
                  CoordsFinder
                </a>
                <a
                  href="https://colab.research.google.com/drive/17qih1n6VpQx_77C2spIF-JOJp17y9Jt6?usp=sharing"
                  target="_blank"
                  rel="noreferrer"
                >
                  Colab Notebook
                </a>
              </div>
              <div className="coordsfinder-actions">
                <button
                  className="primary-button"
                  disabled={validation.errors.length > 0}
                  onClick={onDownload}
                  type="button"
                >
                  <Download size={16} /> Download config
                </button>
                <button
                  className="secondary-button"
                  disabled={validation.errors.length > 0}
                  onClick={copyConfig}
                  type="button"
                >
                  {copyStatus === 'copied' ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <Copy size={16} />
                  )}
                  {copyStatus === 'copied'
                    ? 'Copied'
                    : copyStatus === 'failed'
                      ? 'Retry copy'
                      : 'Copy'}
                </button>
              </div>
              <details className="export-run-config-preview">
                <summary>Preview configuration</summary>
                <pre>{config}</pre>
              </details>
            </article>
          </div>
        </div>
      </section>
    </div>,
    globalThis.document.body,
  )
}
