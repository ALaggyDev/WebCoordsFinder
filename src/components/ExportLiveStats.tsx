import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Gauge } from 'lucide-react'
import { constraintBits, validateForExport } from '../domain/exportConfig'
import {
  estimateHitCount,
  estimateHitPrecision,
  estimateSearchVolume,
  formatEstimatedCount,
  minimumBitsForPrecision,
} from '../domain/searchEstimates'
import {
  createWebSearchRequest,
  formatSearchCount,
  restoreWebSearchCheckpoint,
  searchProgressPercent,
  webSearchRequestKey,
} from '../domain/webSearch'
import type { EditorDocument } from '../domain/types'
import { useEditorStore } from '../store/editorStore'

// A live, read-only summary of the numbers shown in the Export / Run dialog.
// It is derived from the same domain functions so both views always agree.

function formatHitPrecision(rate: number): string {
  const percent = rate * 100
  if (percent < 0.005) return '<0.01%'
  if (percent >= 99.5) return '~100.0%'
  return `${percent.toFixed(percent < 1 ? 2 : 1)}%`
}

const phaseLabels = {
  idle: 'Not started',
  loading: 'Loading',
  running: 'Searching',
  pausing: 'Pausing',
  paused: 'Paused',
  stopping: 'Stopping',
  stopped: 'Stopped',
  completed: 'Complete',
  error: 'Failed',
} as const

// A persisted "running" phase is only live while its checkpoint keeps being
// refreshed (about every 1.5 s). After a reload or unmount it goes quiet.
const CHECKPOINT_FRESH_MS = 6_000

interface Stat {
  key: string
  label: string
  value: string
  hint?: string
  // Lower-priority stats are hidden first when the bar gets narrow.
  priority: 1 | 2 | 3
}

function summarize(document: EditorDocument) {
  const texturesEnabled = document.scanner.textureEnabled !== false
  const offsetsEnabled = document.scanner.offsetsEnabled === true
  const browserValidation = validateForExport(document, 'browser')

  let request: ReturnType<typeof createWebSearchRequest> | undefined
  let requestError: string | undefined
  try {
    request = createWebSearchRequest(document)
  } catch (error) {
    requestError = error instanceof Error ? error.message : 'Invalid search settings.'
  }
  const requestKey = request ? webSearchRequestKey(request) : undefined

  const activeOffsets = (document.offsets ?? []).filter((entry) => !entry.ignored).length
  const offsetSummary = (offsetsEnabled && activeOffsets > 0) || !texturesEnabled
  const rowCount = texturesEnabled ? browserValidation.rowCount : 0
  const errors = requestError ? [requestError] : []
  const yUnconstrained = request?.yUnconstrained ?? rowCount === 0
  const { bounds, directions } = document.scanner

  const yLevels = Number.isSafeInteger(bounds.yStart) && Number.isSafeInteger(bounds.yEnd)
    && bounds.yStart <= bounds.yEnd ? bounds.yEnd - bounds.yStart + 1 : undefined
  const xzArea = [bounds.xStart, bounds.xEnd, bounds.zStart, bounds.zEnd].every(Number.isSafeInteger)
    && bounds.xStart <= bounds.xEnd && bounds.zStart <= bounds.zEnd
    ? (BigInt(bounds.xEnd) - BigInt(bounds.xStart) + 1n) *
      (BigInt(bounds.zEnd) - BigInt(bounds.zStart) + 1n)
    : undefined

  const hitPrecision = estimateHitPrecision(document)
  const warnings = texturesEnabled ? [
    ...browserValidation.warnings,
    ...(!offsetSummary && hitPrecision < 0.8 ? [
      `Low estimated precision (${formatHitPrecision(hitPrecision)}; recommended 80% or higher). Add more confirmed faces.`,
    ] : []),
  ] : []

  const mode = [
    (request ? Boolean(request.offsetBits) : offsetsEnabled) && 'Offsets',
    (request ? !request.yUnconstrained : texturesEnabled) && 'Textures',
  ].filter(Boolean).join(' + ') || 'No evidence'

  const stats: Stat[] = [
    {
      key: 'rows',
      label: 'Constraints',
      value: texturesEnabled ? String(rowCount) : 'Off',
      hint: 'Confirmed texture filter rows',
      priority: 1,
    },
  ]

  if (offsetSummary) {
    stats.push(
      {
        key: 'offsets',
        label: 'Offsets',
        value: offsetsEnabled ? String(activeOffsets) : 'Off',
        hint: 'Active block offsets',
        priority: 1,
      },
      {
        key: 'area',
        label: 'X/Z area',
        value: xzArea === undefined ? 'Invalid'
          : xzArea < 1_000_000_000n ? formatSearchCount(xzArea) : formatEstimatedCount(Number(xzArea)),
        hint: 'Block columns before filtering',
        priority: 2,
      },
      {
        key: 'y',
        label: 'Y range',
        value: yUnconstrained ? 'Any' : yLevels === undefined ? 'Invalid' : `${bounds.yStart}–${bounds.yEnd}`,
        priority: 3,
      },
      {
        key: 'rot',
        label: 'Rotations',
        value: String(directions.length),
        hint: directions.map((direction) => `${direction}°`).join(' · '),
        priority: 3,
      },
    )
  } else {
    const bitsNeeded = minimumBitsForPrecision(document, 0.8)
    stats.push(
      {
        key: 'bits',
        label: 'Information',
        value: `${constraintBits(document)} bits`,
        hint: bitsNeeded === undefined ? 'Unknown bits needed for 80%' : `${bitsNeeded} bits needed for 80%`,
        priority: 1,
      },
      {
        key: 'positions',
        label: 'Positions',
        value: formatEstimatedCount(estimateSearchVolume(document)),
        hint: 'Search positions',
        priority: 3,
      },
      {
        key: 'hits',
        label: 'Est. hits',
        value: formatEstimatedCount(estimateHitCount(document)),
        priority: 2,
      },
      {
        key: 'precision',
        label: 'Precision',
        value: formatHitPrecision(hitPrecision),
        hint: 'Chance a hit is correct',
        priority: 1,
      },
    )
  }

  return { stats, errors, warnings, mode, requestKey }
}

export function ExportLiveStats() {
  // Deferring keeps drags and calibration edits responsive; the summary
  // catches up as soon as the main thread is idle.
  const document = useDeferredValue(useEditorStore((state) => state.document))
  const checkpoint = useEditorStore((state) => state.document.scanner.webSearch)
  const summary = useMemo(() => summarize(document), [document])
  const [now, setNow] = useState(() => Date.now())

  const checkpointRunning = checkpoint?.phase === 'running'
  useEffect(() => {
    if (!checkpointRunning) return
    const timer = window.setInterval(() => setNow(Date.now()), 2_000)
    return () => window.clearInterval(timer)
  }, [checkpointRunning])

  const ready = summary.errors.length === 0
  const search = useMemo(() => {
    if (!checkpoint || !summary.requestKey || checkpoint.requestKey !== summary.requestKey) return undefined
    return restoreWebSearchCheckpoint(checkpoint)
  }, [checkpoint, summary.requestKey])

  let searchLabel: string | undefined
  let percent = 0
  let matches = ''
  if (checkpoint && search) {
    const live = checkpoint.phase === 'running' && now - checkpoint.updatedAt < CHECKPOINT_FRESH_MS
    const phase = checkpoint.phase === 'running' && !live ? 'paused' : checkpoint.phase
    percent = searchProgressPercent(search.processed, search.total)
    searchLabel = phaseLabels[phase]
    matches = formatSearchCount(search.matchCount)
  }

  const title = [
    ...summary.errors,
    ...summary.warnings,
  ].join('\n')

  return (
    <section className="topbar-live-stats" aria-label="Export summary" data-ready={ready}>
      <div className="live-stats-status" title={title || 'Ready to search in browser'}>
        {ready ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
        <span>
          <strong>{ready ? 'Ready' : 'Blocked'}</strong>
          <small>{summary.mode}</small>
        </span>
        {summary.warnings.length > 0 && (
          <span className="live-stats-warnings">
            {summary.warnings.length} warning{summary.warnings.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <dl className="live-stats-list">
        {summary.stats.map((stat) => (
          <div
            className="live-stat"
            data-priority={stat.priority}
            key={stat.key}
            title={stat.hint}
          >
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
        {searchLabel && (
          <div className="live-stat live-stat-search" data-priority="1" title="Browser search progress">
            <dt><Gauge size={10} /> {searchLabel}</dt>
            <dd>
              {percent.toFixed(2)}%<small> · {matches} match{matches === '1' ? '' : 'es'}</small>
            </dd>
            <progress aria-label="Web search progress" max={100} value={percent} />
          </div>
        )}
      </dl>
      {!ready && <p className="live-stats-error">{summary.errors[0]}</p>}
    </section>
  )
}
