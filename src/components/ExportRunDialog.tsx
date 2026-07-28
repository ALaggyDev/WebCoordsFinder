import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  Gauge,
  Globe2,
  MonitorCog,
  ShieldCheck,
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
import type { EditorDocument } from '../domain/types'
import './ExportRunDialog.css'

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
    detail: 'This browser',
    icon: Globe2,
  },
  cpu: {
    label: 'CoordsFinder CPU',
    detail: 'Native CPU placeholder',
    icon: Cpu,
  },
  cuda: {
    label: 'CoordsFinder CUDA',
    detail: 'Native GPU placeholder',
    icon: MonitorCog,
  },
}

function formatHitPrecision(rate: number): string {
  const percent = rate * 100
  if (percent === 0) return '0%'
  if (percent >= 100) return '~100.0%'
  if (percent < 0.01) return `${percent.toExponential(1)}%`
  return `${percent.toFixed(percent < 1 ? 2 : 1)}%`
}

export function ExportRunDialog({
  document,
  open,
  onClose,
  onDownload,
}: ExportRunDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const validation = useMemo(() => validateForExport(document), [document])
  const config = useMemo(() => generateCoordsFinderConfig(document), [document])
  const estimates = useMemo(() => estimateSearchTimes(document), [document])
  const searchVolume = useMemo(() => estimateSearchVolume(document), [document])
  const estimatedHits = useMemo(() => estimateHitCount(document), [document])
  const hitPrecision = useMemo(() => estimateHitPrecision(document), [document])
  const minimumBitsFor90Percent = useMemo(
    () => minimumBitsForPrecision(document, 0.9),
    [document],
  )

  useEffect(() => {
    if (!open) return
    const previouslyFocused = globalThis.document.activeElement
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.document.addEventListener('keydown', onKeyDown)
    globalThis.document.body.classList.add('export-run-dialog-open')
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
              <small>{minimumBitsFor90Percent} bits needed for 90%</small>
            </div>
            <div>
              <span>Search positions</span>
              <strong>{formatEstimatedCount(searchVolume)}</strong>
            </div>
            <div>
              <span>Estimated hits</span>
              <strong>{formatEstimatedCount(estimatedHits)}</strong>
              <small>Placeholder model</small>
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
              <span className="estimate-disclaimer">
                <Gauge size={13} /> Placeholder formula
              </span>
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
                    <strong>{formatSearchTime(estimate.seconds)}</strong>
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
                The browser runner will use this shared search configuration
                without uploading project data.
              </p>
              <button
                className="secondary-button full"
                disabled
                type="button"
              >
                Web search coming soon
              </button>
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
              <button
                className="primary-button full"
                disabled={validation.errors.length > 0}
                onClick={onDownload}
                type="button"
              >
                <Download size={16} /> Download coordsfinder.conf
              </button>
              <details className="export-run-config-preview">
                <summary>Preview configuration</summary>
                <pre>{config}</pre>
              </details>
            </article>
          </div>

          <div className="export-run-privacy">
            <ShieldCheck size={15} />
            Searches and exports stay on this device.
          </div>
        </div>
      </section>
    </div>,
    globalThis.document.body,
  )
}
