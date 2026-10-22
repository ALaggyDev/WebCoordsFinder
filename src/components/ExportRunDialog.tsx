import { memo, useEffect, useMemo, useRef, useState } from 'react'
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
  createWebSearchRequest,
  formatSearchCount,
  MAX_WEB_SEARCH_RESULTS,
  maximumSearchWorkerCount,
  recommendedSearchWorkerCount,
  searchProgressPercent,
  webSearchRequestKey,
  type WebSearchPhase,
} from '../domain/webSearch'
import { useCoordinateSearch } from '../hooks/useCoordinateSearch'
import './ExportRunDialog.css'

// The search controller persists independently of dialog visibility.
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

function formatRate(rate: number, offsets = false): string {
  if (!Number.isFinite(rate) || rate <= 0) return 'Measuring...'
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: rate < 100 ? 1 : 0,
    notation: rate >= 1_000_000 ? 'compact' : 'standard',
  }).format(rate)}${offsets ? ' steps/sec' : '/sec'}`
}

const SearchResultTable = memo(function SearchResultTable({
  results,
  hasMore,
  yUnconstrained,
}: {
  results: WebSearchResult[]
  hasMore: boolean
  yUnconstrained: boolean
}) {
  return (
    <div className="web-search-results">
      <div className="web-search-results-heading">
        <strong>{yUnconstrained ? 'Candidate X/Z columns' : 'Candidate coordinates'}</strong>
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
              <th>Rotation</th>
              {!yUnconstrained && <th>Texture errors</th>}
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr
                key={`${result.x}:${result.y}:${result.z}:${result.direction}`}
              >
                <td>{result.x}</td>
                <td>{yUnconstrained ? 'Any' : result.y}</td>
                <td>{result.z}</td>
                <td>{result.direction}°</td>
                {!yUnconstrained && <td>{result.badBlocks}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {yUnconstrained && <small>Y is unconstrained. Candidates include separate rotation hypotheses.</small>}
      {hasMore && (
        <small>
          Result display is capped at the first{' '}
          {MAX_WEB_SEARCH_RESULTS.toLocaleString()} matches; the total match
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
  const maximumWorkerCount = maximumSearchWorkerCount(
    globalThis.navigator.hardwareConcurrency,
  )
  const [workerCount, setWorkerCount] = useState(() =>
    recommendedSearchWorkerCount(globalThis.navigator.hardwareConcurrency),
  )
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  )
  const nativeValidation = useMemo(() => validateForExport(document), [document])
  const browserValidation = useMemo(() => validateForExport(document, 'browser'), [document])
  const config = useMemo(() => generateCoordsFinderConfig(document), [document])
  const prepared = useMemo(() => {
    try {
      const request = createWebSearchRequest(document)
      return { request, requestKey: webSearchRequestKey(request) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid search settings.' }
    }
  }, [document])
  const currentSearch = prepared.request ? prepared : undefined
  const search = useCoordinateSearch(prepared.request, prepared.requestKey)
  const webSearch = search.state
  const hasOffsets = Boolean(prepared.request?.offsetBits)
  const resultHasOffsets = Boolean(webSearch.offsetBits)
  const resultHasTextures = !webSearch.yUnconstrained
  const texturesEnabled = document.scanner.textureEnabled !== false
  const activeOffsets = (document.offsets ?? []).filter((entry) => !entry.ignored).length
  // Constraint errors must not hide the offset layout. With no active offsets,
  // retain texture estimates when the browser can still search textures alone.
  const offsetSummary = (document.scanner.offsetsEnabled && activeOffsets > 0) || !texturesEnabled
  const validation = {
    rowCount: texturesEnabled ? browserValidation.rowCount : 0,
    errors: prepared.error ? [prepared.error] : [],
  }
  const yUnconstrained = prepared.request?.yUnconstrained ?? validation.rowCount === 0
  const browserMode = [
    (prepared.request ? hasOffsets : document.scanner.offsetsEnabled) && 'Offsets',
    (prepared.request ? !yUnconstrained : texturesEnabled) && 'Textures',
  ].filter(Boolean).join(' + ') || 'No evidence enabled'
  const { bounds, directions } = document.scanner
  const yLevels = Number.isSafeInteger(bounds.yStart) && Number.isSafeInteger(bounds.yEnd)
    && bounds.yStart <= bounds.yEnd ? bounds.yEnd - bounds.yStart + 1 : undefined
  // This is the bounded area, not the padded traversal domain used for coverage.
  const xzArea = [bounds.xStart, bounds.xEnd, bounds.zStart, bounds.zEnd].every(Number.isSafeInteger)
    && bounds.xStart <= bounds.xEnd && bounds.zStart <= bounds.zEnd
    ? (BigInt(bounds.xEnd) - BigInt(bounds.xStart) + 1n) *
      (BigInt(bounds.zEnd) - BigInt(bounds.zStart) + 1n)
    : undefined
  const searchVolume = estimateSearchVolume(document)
  const estimatedHits = estimateHitCount(document)
  const hitPrecision = estimateHitPrecision(document)
  const minimumBitsFor80Percent = minimumBitsForPrecision(document, 0.8)
  const validationWarnings = texturesEnabled ? [
    ...browserValidation.warnings,
    ...(!offsetSummary && hitPrecision < 0.8 ? [
      `This search may return many false positives. Add more confirmed faces to improve the result (estimated precision: ${formatHitPrecision(hitPrecision)}; recommended: 80% or higher).`,
    ] : []),
  ] : []
  // Texture estimates assume brute-force traversal. Offset pruning has no
  // comparable static runtime or independence estimate.
  const estimates = estimateSearchTimes(document,
    !hasOffsets && !search.stale ? webSearch.checksPerSecond : undefined)

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
  const remainingSeconds = !resultHasOffsets && webSearch.checksPerSecond > 0
    ? Number(webSearch.total - webSearch.processed) / webSearch.checksPerSecond
    : undefined
  const searchRate = webSearch.checksPerSecond > 0
    ? formatRate(webSearch.checksPerSecond, resultHasOffsets)
    : ['loading', 'running'].includes(webSearch.phase) ? 'Measuring...' : '—'
  const workerIsAttached = search.attached
  const searchIsActive = workerIsAttached
  const checkpointIsStale = search.stale
  const canResumeSavedSearch = search.canResume
  const startWebSearch = (resume: boolean) => search.start(workerCount, resume)
  const sendWorkerCommand = search.command
  const clearSavedSearch = search.clear

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
            <h2 id="export-run-title">Export or Run Search</h2>
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
              <strong>
                {validation.errors.length === 0
                  ? 'Ready to search in browser'
                  : 'Configuration needs attention'}
              </strong>
              <small className="export-run-mode">Browser search · {browserMode}</small>
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
              <span>Texture constraints</span>
              <strong>{texturesEnabled ? validation.rowCount : 'Off'}</strong>
              {offsetSummary && <small>{texturesEnabled ? 'Confirmed filter rows' : 'Not used in browser search'}</small>}
              {!offsetSummary && document.scanner.offsetsEnabled && <small>No active block offsets</small>}
            </div>
            {offsetSummary ? <>
              <div>
                <span>Block offsets</span>
                <strong>{document.scanner.offsetsEnabled ? activeOffsets : 'Off'}</strong>
                <small>{document.scanner.offsetsEnabled ? 'Active · exact matches' : 'Not used in browser search'}</small>
              </div>
              <div>
                <span>X/Z search area</span>
                <strong title={xzArea === undefined ? undefined : formatSearchCount(xzArea)}>
                  {xzArea === undefined ? 'Invalid bounds' : xzArea < 1_000_000_000n
                    ? formatSearchCount(xzArea) : formatEstimatedCount(Number(xzArea))}
                </strong>
                <small>Block columns · before filtering</small>
              </div>
              <div>
                <span>Y range</span>
                <strong>{yUnconstrained ? 'Any' : yLevels === undefined ? 'Invalid bounds' : `${bounds.yStart}–${bounds.yEnd}`}</strong>
                <small>{yUnconstrained ? 'Offsets do not determine Y' : yLevels === undefined ? 'Review the Y bounds' : `${yLevels} levels after offset filtering`}</small>
              </div>
              <div>
                <span>Search rotations</span>
                <strong>{directions.length}</strong>
                <small>{directions.map((direction) => `${direction}°`).join(' · ') || 'Select at least one rotation'}</small>
              </div>
            </> : <>
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
            </>}
          </div>

          {offsetSummary ? <p className="export-run-summary-note">
            {document.scanner.offsetsEnabled && activeOffsets > 0 ? <>
              {yUnconstrained
                ? 'Offsets search X/Z only; Y is unknown.'
                : 'Offsets filter X/Z first; texture rotations check the surviving results across Y.'}
              <br />
              Estimated runtime is around 15-60 seconds across the full 60m world (fanda857 & epic10l2's <a href="https://github.com/ALaggyDev/CoordsFinder/blob/main/docs/fast_bit_lifting.rs">fast bit lifting algorithm</a>).
              {!yUnconstrained && ` Texture mismatch tolerance: ${document.scanner.errorTolerance}.`}
            </> : document.scanner.offsetsEnabled
              ? 'No active block offsets participate in this browser search.'
              : 'Enable texture rotations or block offsets to search.'}
          </p> : <section className="export-run-section">
            <div className="export-run-section-heading">
              <div>
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
          </section>}

          {(validation.errors.length > 0 ||
            validationWarnings.length > 0) && (
            <div className="export-run-validation">
              {validation.errors.map((message) => (
                <div className="validation error" role="alert" key={message}>
                  <X size={14} />
                  {message}
                </div>
              ))}
              {validationWarnings.map((message) => (
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
                  <span>{offsetSummary && browserMode !== 'No evidence enabled' ? `Includes ${browserMode.toLowerCase()}` : 'Local web search'}</span>
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
                      {resultHasOffsets && ' · Search coverage'}
                    </span>
                    <strong>{progressPercent.toFixed(2)}%</strong>
                  </div>
                  <progress
                    aria-label="Web search progress"
                    max={100}
                    value={progressPercent}
                  />
                  <div className="web-search-stats">
                    {resultHasOffsets ? <div>
                      <span>{resultHasTextures ? 'Offset candidates (X/Z + rotation)' : 'X/Z candidates (+ rotation)'}</span>
                      <strong>{formatSearchCount(resultHasTextures ? webSearch.offsetMatchCount ?? 0n : webSearch.matchCount)}</strong>
                    </div> : <div>
                      <span>Checked</span>
                      <strong>
                        {formatSearchCount(webSearch.processed)}
                        <small>
                          {' / '}
                          {formatSearchCount(webSearch.total)}
                        </small>
                      </strong>
                    </div>}
                    {resultHasTextures && <div>
                      <span>{resultHasOffsets ? 'Texture matches (X/Y/Z + rotation)' : 'Matches'}</span>
                      <strong>{formatSearchCount(webSearch.matchCount)}</strong>
                    </div>}
                    <div>
                      <span>{resultHasOffsets ? 'Traversal speed' : 'Speed'}</span>
                      <strong>{searchRate}</strong>
                    </div>
                    <div>
                      <span>{resultHasOffsets ? 'Time remaining' : 'Remaining'}</span>
                      <strong>
                        {webSearch.phase === 'stopped'
                          ? 'Stopped'
                          : webSearch.phase === 'paused'
                            ? 'Paused'
                            : webSearch.phase === 'completed'
                              ? 'Done'
                          : webSearch.phase === 'error'
                            ? 'Search failed'
                          : resultHasOffsets
                            ? 'Not estimated'
                          : remainingSeconds === undefined
                            ? 'Measuring...'
                            : formatSearchTime(remainingSeconds)}
                      </strong>
                    </div>
                  </div>

                  {resultHasOffsets && <small className="web-search-checkpoint-note">
                    Coverage includes branches ruled out without checking every position.
                  </small>}
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
                  yUnconstrained={Boolean(webSearch.yUnconstrained)}
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

            <article className={`run-target${offsetSummary ? ' run-target-native' : ''}`}>
              <div className="run-target-heading">
                <Download size={18} />
                <div>
                  <h3>Use CoordsFinder</h3>
                  <span>{document.scanner.offsetsEnabled && activeOffsets > 0 ? 'Native CPU · Block offsets + optional textures' : 'Native CPU or GPU · Texture rotations'}</span>
                </div>
              </div>
              <p>
                Export enabled texture and block offset evidence for your local CoordsFinder
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
              {nativeValidation.errors.map((message) => <div className="validation warning" key={message}>
                <AlertTriangle size={14} />
                {message}
              </div>)}
              <div className="coordsfinder-actions">
                <button
                  className={offsetSummary ? 'secondary-button' : 'primary-button'}
                  disabled={nativeValidation.errors.length > 0}
                  onClick={onDownload}
                  type="button"
                >
                  <Download size={16} /> Download config
                </button>
                <button
                  className="secondary-button"
                  disabled={nativeValidation.errors.length > 0}
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
