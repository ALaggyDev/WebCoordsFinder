import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Compass,
  Download,
  Eye,
  FileImage,
  Grid3X3,
  Link2,
  LoaderCircle,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  approximateCandidateCount,
  constraintBits,
  generateCoordsFinderConfig,
  validateForExport,
} from '../domain/exportConfig'
import {
  axesForFaceRotation,
  axisVectorLabel,
  cellQuad,
  defaultAxesForFace,
  faceDisplayName,
  planeAxisRotation,
} from '../domain/geometry'
import { imageDataUrl, orientCropToWorld, warpQuad } from '../domain/imageAnalysis'
import {
  blockProfiles,
  blockProfileMap,
  referenceTextureForFace,
  statesForFace,
} from '../domain/references'
import {
  textureAlgorithms,
  type CandidateTransform,
  type FaceDirection,
  type PerspectivePlane,
  type TextureAlgorithm,
} from '../domain/types'
import { downloadBlob } from '../domain/projectBundle'
import { useEditorStore } from '../store/editorStore'

interface InspectorProps {
  busy: boolean
  onOpenImage: () => void
  onAutoFill: (evidenceIds?: string[]) => void
  onClearProject: () => void
}

const faceOptions: Array<{ value: FaceDirection; label: string }> = [
  { value: 'up', label: 'Top (+Y)' },
  { value: 'down', label: 'Bottom (−Y)' },
  { value: 'north', label: 'North wall (−Z)' },
  { value: 'south', label: 'South wall (+Z)' },
  { value: 'east', label: 'East wall (+X)' },
  { value: 'west', label: 'West wall (−X)' },
]

function transformStyle(transform: CandidateTransform): string {
  return {
    identity: 'none',
    rotate90: 'rotate(90deg)',
    rotate180: 'rotate(180deg)',
    rotate270: 'rotate(270deg)',
    mirrorX: 'scaleX(-1)',
    mirrorXRotate180: 'scaleY(-1)',
  }[transform]
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  eyebrow,
}: {
  icon: typeof FileImage
  title: string
  eyebrow: string
}) {
  return (
    <div className="inspector-heading">
      <div className="heading-icon"><Icon size={17} /></div>
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
    </div>
  )
}

function PlaneInspector({ plane }: { plane?: PerspectivePlane }) {
  const updatePlane = useEditorStore((state) => state.updatePlane)
  const addHingedPlane = useEditorStore((state) => state.addHingedPlane)
  const removePlane = useEditorStore((state) => state.removePlane)
  const scanner = useEditorStore((state) => state.document.scanner)
  const updateScanner = useEditorStore((state) => state.updateScanner)

  if (!plane) {
    return (
      <div className="empty-inspector">
        <Grid3X3 size={28} />
        <h3>No plane selected</h3>
        <p>Choose a grid or use the Plane tool to click four corners clockwise.</p>
      </div>
    )
  }

  const selectedAxisRotation = planeAxisRotation(plane) ?? 0

  return (
    <>
      <SectionTitle icon={Grid3X3} eyebrow="Perspective geometry" title={plane.name} />
      <div className="field-stack">
        <label className="field">
          <span>Plane name</span>
          <input
            value={plane.name}
            onChange={(event) => updatePlane(plane.id, { name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Visible face</span>
          <select
            value={plane.face}
            onChange={(event) => {
              const face = event.target.value as FaceDirection
              updatePlane(plane.id, { face, ...defaultAxesForFace(face) })
            }}
          >
            {faceOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="field-grid two">
          <NumberField
            label="Columns"
            value={plane.columns}
            min={1}
            max={64}
            onChange={(columns) => updatePlane(plane.id, { columns: Math.max(1, Math.min(64, columns)) })}
          />
          <NumberField
            label="Rows"
            value={plane.rows}
            min={1}
            max={64}
            onChange={(rows) => updatePlane(plane.id, { rows: Math.max(1, Math.min(64, rows)) })}
          />
        </div>
      </div>
      <div className="subsection">
        <h3>Image-to-world direction</h3>
        <label className="field">
          <span>Image right (U) and image down (V)</span>
          <select
            value={selectedAxisRotation}
            onChange={(event) =>
              updatePlane(
                plane.id,
                axesForFaceRotation(plane.face, Number(event.target.value)),
              )
            }
          >
            {Array.from({ length: 4 }, (_, quarterTurns) => {
              const axes = axesForFaceRotation(plane.face, quarterTurns)
              return (
                <option key={quarterTurns} value={quarterTurns}>
                  Right {axisVectorLabel(axes.uAxis)} · Down {axisVectorLabel(axes.vAxis)}
                </option>
              )
            })}
          </select>
        </label>
        <p className="axis-hint">
          Match these directions to the screenshot. Changing them rotates the
          world-coordinate lattice without moving the drawn grid.
        </p>
      </div>
      <div className="subsection">
        <h3>Relative coordinate at top-left cell</h3>
        <div className="coordinate-fields">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <NumberField
              key={axis}
              label={axis.toUpperCase()}
              value={plane.origin[axis]}
              min={-128}
              max={127}
              onChange={(value) =>
                updatePlane(plane.id, { origin: { ...plane.origin, [axis]: value } })
              }
            />
          ))}
        </div>
      </div>
      <div className={scanner.compassResolved ? 'compass-card resolved' : 'compass-card'}>
        <Compass size={19} />
        <div>
          <strong>{scanner.compassResolved ? 'World direction resolved' : 'Compass direction required'}</strong>
          <span>Set the image-to-world direction above, then confirm the X/Z axes.</span>
        </div>
        <button
          type="button"
          className={scanner.compassResolved ? 'small-button success' : 'small-button'}
          onClick={() => updateScanner({ compassResolved: !scanner.compassResolved })}
        >
          {scanner.compassResolved ? <Check size={14} /> : 'Confirm'}
        </button>
      </div>
      <div className="inspector-actions">
        <button type="button" className="secondary-button" onClick={addHingedPlane}>
          <Link2 size={15} /> Hinge connected plane
        </button>
        <button type="button" className="danger-button" onClick={() => removePlane(plane.id)}>
          <Trash2 size={15} /> Delete
        </button>
      </div>
      <div className="hint-card">
        Drag any white corner handle on the image to refine perspective. Increase rows or
        columns to extend the lattice beyond the initial patch.
      </div>
    </>
  )
}

function FaceInspector({
  busy,
  onAutoFill,
}: Pick<InspectorProps, 'busy' | 'onAutoFill'>) {
  const document = useEditorStore((state) => state.document)
  const selectedIds = useEditorStore((state) => state.selectedEvidenceIds)
  const setBlockForSelection = useEditorStore((state) => state.setBlockForSelection)
  const setVariant = useEditorStore((state) => state.setVariant)
  const selectedEvidence = document.evidence.filter((entry) =>
    selectedIds.includes(entry.id),
  )
  const evidence = selectedEvidence[0]
  const multiple = selectedEvidence.length > 1
  const evidencePlane = document.planes.find((entry) => entry.id === evidence?.planeId)
  const [cropUrl, setCropUrl] = useState('')

  useEffect(() => {
    let active = true
    if (!evidence || !evidencePlane || multiple) {
      setCropUrl('')
      return
    }
    warpQuad(
      document.image.src,
      cellQuad(evidencePlane, evidence.column, evidence.row),
      112,
    )
      .then((crop) => {
        if (active) setCropUrl(imageDataUrl(orientCropToWorld(crop, evidencePlane)))
      })
      .catch(() => {
        if (active) setCropUrl('')
      })
    return () => {
      active = false
    }
  }, [document.image.src, evidence, evidencePlane, multiple])

  if (!evidence) {
    return (
      <>
        <SectionTitle icon={Eye} eyebrow="Texture evidence" title="Select a block face" />
        <div className="empty-inspector">
          <BoxSelectPlaceholder />
          <h3>Nothing selected</h3>
          <p>Use Select and click a grid cell. Shift-click to build a batch.</p>
        </div>
        <FaceSelectionActions
          busy={busy}
          selectedIds={selectedIds}
          multiple={false}
          autoAnalyzeIds={[]}
          proposedIds={[]}
          excludedIds={[]}
          anySelectedHaveVariant={false}
          onAutoFill={onAutoFill}
        />
      </>
    )
  }

  const blockIds = new Set(selectedEvidence.map((entry) => entry.blockId))
  const selectedBlockId = blockIds.size === 1 ? evidence.blockId : ''
  const profile = selectedBlockId ? blockProfileMap.get(selectedBlockId) : undefined
  const referenceUrl = multiple
    ? undefined
    : referenceTextureForFace(evidence.blockId, evidence.face)
  const candidates = Array.from({ length: evidence.stateCount }, (_, index) => index)
  const selectedTransform =
    evidence.selectedVariant === undefined || !profile
      ? undefined
      : profile.transforms[evidence.selectedVariant]
  const statuses = new Set(selectedEvidence.map((entry) => entry.reviewStatus))
  const directions = new Set(selectedEvidence.map((entry) => entry.face))
  const anySelectedHaveVariant = selectedEvidence.some(
    (entry) => entry.selectedVariant !== undefined,
  )
  const autoAnalyzeIds = selectedEvidence
    .filter(
      (entry) =>
        entry.reviewStatus === 'unlabeled' &&
        referenceTextureForFace(entry.blockId, entry.face),
    )
    .map((entry) => entry.id)
  const proposedIds = selectedEvidence
    .filter((entry) => entry.reviewStatus === 'proposed')
    .map((entry) => entry.id)
  const excludedIds = selectedEvidence
    .filter((entry) => entry.reviewStatus === 'excluded')
    .map((entry) => entry.id)

  return (
    <>
      <SectionTitle
        icon={Eye}
        eyebrow={`${selectedEvidence.length} face${selectedEvidence.length === 1 ? '' : 's'} selected`}
        title={multiple
          ? 'Batch selection'
          : `${evidence.coordinate.x}, ${evidence.coordinate.y}, ${evidence.coordinate.z}`}
      />
      <div className="evidence-meta">
        <span>{directions.size === 1 ? faceDisplayName(evidence.face) : 'Mixed directions'}</span>
        <span>{multiple ? 'Batch edit' : `${evidence.stateCount}-state`}</span>
        <span className={statuses.size === 1 ? `status-dot ${evidence.reviewStatus}` : 'status-dot'}>
          {statuses.size === 1 ? evidence.reviewStatus : 'mixed status'}
        </span>
      </div>
      {!multiple && profile && (
        <div className="face-preview-row">
          <div className="face-preview-item">
            <div className="face-preview">
              {cropUrl ? <img src={cropUrl} alt="Perspective-correct selected block face" /> : <LoaderCircle className="spin" />}
            </div>
            <span className="face-preview-label">Unwarped · world-aligned</span>
          </div>
          <div className="face-preview-item">
            <div className="face-preview reference">
              {referenceUrl ? (
                <img
                  src={referenceUrl}
                  alt={`${profile.label} reference${evidence.selectedVariant === undefined ? '' : `, variant ${evidence.selectedVariant}`}`}
                  style={selectedTransform ? { transform: transformStyle(selectedTransform) } : undefined}
                />
              ) : (
                <div className="reference-unavailable">Unsupported face</div>
              )}
            </div>
            <span className="face-preview-label">Reference</span>
          </div>
        </div>
      )}
      <label className="field">
        <span>Block profile</span>
        <select
          value={selectedBlockId}
          onChange={(event) => setBlockForSelection(event.target.value)}
        >
          {!selectedBlockId && <option value="" disabled>Mixed</option>}
          {blockProfiles.map((candidate) => (
            <option
              key={candidate.id}
              value={candidate.id}
              disabled={selectedEvidence.some(
                (entry) => !statesForFace(candidate.id, entry.face),
              )}
            >
              {candidate.label}
              {selectedEvidence.some((entry) => !statesForFace(candidate.id, entry.face))
                ? ' — unsupported selection'
                : ''}
            </option>
          ))}
        </select>
      </label>
      {profile ? (
        <div className="profile-note">
          <span style={{ background: profile.accent }} />
          {profile.notes}
        </div>
      ) : (
        <div className="profile-note">
          Choose a profile to apply it to all {selectedEvidence.length} selected faces.
        </div>
      )}
      {!multiple && profile && (
        <div className="candidate-section">
          <h3>Visible variant</h3>
          <div className={`candidate-grid count-${evidence.stateCount}`}>
            {candidates.map((variant) => {
              const transform = profile.transforms[variant]
              const score = evidence.scores?.find((entry) => entry.variant === variant)?.score
              return (
                <button
                  type="button"
                  key={variant}
                  aria-pressed={evidence.selectedVariant === variant}
                  className={evidence.selectedVariant === variant ? 'candidate active' : 'candidate'}
                  onClick={() => setVariant(evidence.id, variant)}
                >
                  <div className="candidate-image">
                    {referenceUrl ? (
                      <img
                        src={referenceUrl}
                        alt=""
                        style={{ transform: transformStyle(transform) }}
                      />
                    ) : (
                      <span className="candidate-unavailable">—</span>
                    )}
                  </div>
                  <span>
                    Variant {variant} · {score === undefined ? 'Manual' : `${Math.round(score * 100)}% match`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <FaceSelectionActions
        busy={busy}
        selectedIds={selectedIds}
        multiple={multiple}
        autoAnalyzeIds={autoAnalyzeIds}
        proposedIds={proposedIds}
        excludedIds={excludedIds}
        anySelectedHaveVariant={anySelectedHaveVariant}
        onAutoFill={onAutoFill}
      />
    </>
  )
}

function FaceSelectionActions({
  busy,
  selectedIds,
  multiple,
  autoAnalyzeIds,
  proposedIds,
  excludedIds,
  anySelectedHaveVariant,
  onAutoFill,
}: {
  busy: boolean
  selectedIds: string[]
  multiple: boolean
  autoAnalyzeIds: string[]
  proposedIds: string[]
  excludedIds: string[]
  anySelectedHaveVariant: boolean
  onAutoFill: (evidenceIds?: string[]) => void
}) {
  const setEvidenceStatus = useEditorStore((state) => state.setEvidenceStatus)
  const hasSelection = selectedIds.length > 0
  const includesExcludedFaces = excludedIds.length > 0

  return (
    <div className="face-selection-actions" aria-label="Face selection actions">
      <div className="face-selection-action-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            setEvidenceStatus(
              includesExcludedFaces ? excludedIds : selectedIds,
              includesExcludedFaces ? 'unlabeled' : 'excluded',
            )}
          disabled={!hasSelection}
        >
          {includesExcludedFaces ? <Eye size={15} /> : <X size={15} />}
          {includesExcludedFaces ? 'Include' : 'Exclude'}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setEvidenceStatus(selectedIds, 'unlabeled')}
          disabled={!anySelectedHaveVariant}
        >
          <RotateCcw size={15} /> Clear {multiple ? 'variants' : 'variant'}
        </button>
      </div>
      <div className="face-selection-action-row primary-row">
        <button
          type="button"
          className="primary-button"
          onClick={() => onAutoFill(autoAnalyzeIds)}
          disabled={busy || autoAnalyzeIds.length === 0}
          title={!hasSelection
            ? 'Select one or more faces first'
            : autoAnalyzeIds.length === 0
              ? 'Select at least one unlabeled face with a supported block profile'
              : undefined}
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
          Auto analyze selected faces
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setEvidenceStatus(proposedIds, 'confirmed')}
          disabled={proposedIds.length === 0}
        >
          <Check size={15} /> Confirm
        </button>
      </div>
    </div>
  )
}

function BoxSelectPlaceholder() {
  return <div className="selection-placeholder"><span /><span /><span /><span /></div>
}

function ReviewInspector({ busy, onAutoFill }: Pick<InspectorProps, 'busy' | 'onAutoFill'>) {
  const document = useEditorStore((state) => state.document)
  const selectedIds = useEditorStore((state) => state.selectedEvidenceIds)
  const updateScanner = useEditorStore((state) => state.updateScanner)
  const acceptProposed = useEditorStore((state) => state.acceptProposed)
  const clearReviewQueue = useEditorStore((state) => state.clearReviewQueue)
  const inspectEvidence = useEditorStore((state) => state.inspectEvidence)
  const reviewItems = useMemo(
    () =>
      document.evidence
        .filter(
          (entry) =>
            entry.reviewStatus !== 'excluded' &&
            entry.scores !== undefined &&
            entry.scores.length > 0,
        )
        .sort(
          (a, b) =>
            (b.confidence ?? -1) - (a.confidence ?? -1) ||
            a.coordinate.y - b.coordinate.y ||
            a.coordinate.z - b.coordinate.z ||
            a.coordinate.x - b.coordinate.x,
        ),
    [document.evidence],
  )
  const counts = useMemo(
    () =>
      reviewItems.reduce(
        (result, entry) => {
          result[entry.reviewStatus] += 1
          return result
        },
        { unlabeled: 0, proposed: 0, confirmed: 0, excluded: 0 },
      ),
    [reviewItems],
  )
  const proposedCount = reviewItems.filter(
    (entry) => entry.reviewStatus === 'proposed',
  ).length

  return (
    <>
      <SectionTitle icon={ScanSearch} eyebrow="Automatic proposals" title="Analyzed faces" />
      <div className="review-metrics">
        <div><strong>{counts.confirmed}</strong><span>Confirmed</span></div>
        <div><strong>{counts.proposed}</strong><span>Proposed</span></div>
        <div><strong>{counts.unlabeled}</strong><span>Unlabeled</span></div>
      </div>
      <label className="range-field">
        <span>
          Proposal threshold
          <b>{document.scanner.confidenceThreshold.toFixed(2)}</b>
        </span>
        <input
          type="range"
          aria-label="Proposal threshold"
          min="0.02"
          max="0.35"
          step="0.01"
          value={document.scanner.confidenceThreshold}
          onChange={(event) => updateScanner({ confidenceThreshold: Number(event.target.value) })}
        />
      </label>
      <p className="review-help">
        Accept proposed variants in bulk, or select a row to inspect and correct that face.
      </p>
      <div className="review-actions" aria-label="Auto Analyze actions">
        <button className="secondary-button" type="button" onClick={() => onAutoFill(selectedIds)} disabled={busy || selectedIds.length === 0}>
          <Sparkles size={15} /> Re-analyze selection
        </button>
        <button className="secondary-button" type="button" onClick={clearReviewQueue} disabled={reviewItems.length === 0}>
          <Trash2 size={15} /> Clear queue
        </button>
        <button className="primary-button" type="button" onClick={acceptProposed} disabled={proposedCount === 0}>
          <Check size={15} /> Accept proposed ({proposedCount})
        </button>
      </div>
      <div className="review-list">
        {reviewItems.length === 0 ? (
          <div className="list-empty">
            No analyzed faces yet. Select faces and use Auto analyze selected faces.
          </div>
        ) : (
          reviewItems.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`review-item ${entry.reviewStatus}`}
              onClick={() => inspectEvidence(entry.id)}
              title="Inspect this face"
            >
              <span className="review-state" />
              <div>
                <strong>{entry.coordinate.x}, {entry.coordinate.y}, {entry.coordinate.z}</strong>
                <span>{blockProfileMap.get(entry.blockId)?.label} · {entry.stateCount}-state</span>
              </div>
              <div className="review-result">
                <strong>
                  {entry.confidence === undefined ? 'Δ —' : `Δ ${entry.confidence.toFixed(2)}`}
                </strong>
                <small>
                  Variant {entry.selectedVariant === undefined ? '—' : entry.selectedVariant}
                </small>
              </div>
              <ChevronRight size={14} />
            </button>
          ))
        )}
      </div>
    </>
  )
}

function FacesWorkspace(props: Pick<InspectorProps, 'busy' | 'onAutoFill'>) {
  const faceTab = useEditorStore((state) => state.faceTab)
  const setFaceTab = useEditorStore((state) => state.setFaceTab)
  const selectedCount = useEditorStore((state) => state.selectedEvidenceIds.length)
  const analyzedCount = useEditorStore(
    (state) =>
      state.document.evidence.filter(
        (entry) =>
          entry.reviewStatus !== 'excluded' &&
          entry.scores !== undefined &&
          entry.scores.length > 0,
      ).length,
  )

  return (
    <div className="faces-workspace">
      <div className="face-tabs" role="tablist" aria-label="Face evidence">
        <button
          type="button"
          role="tab"
          aria-selected={faceTab === 'selection'}
          className={faceTab === 'selection' ? 'active' : ''}
          onClick={() => setFaceTab('selection')}
        >
          Selection <span>{selectedCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={faceTab === 'review'}
          className={faceTab === 'review' ? 'active' : ''}
          onClick={() => setFaceTab('review')}
        >
          Auto Analyze <span>{analyzedCount}</span>
        </button>
      </div>
      {faceTab === 'selection'
        ? <FaceInspector {...props} />
        : <ReviewInspector {...props} />}
    </div>
  )
}

function ImageInspector({
  onOpenImage,
  onClearProject,
}: Pick<InspectorProps, 'onOpenImage' | 'onClearProject'>) {
  const document = useEditorStore((state) => state.document)
  const setProjectName = useEditorStore((state) => state.setProjectName)
  const resetDemo = useEditorStore((state) => state.resetDemo)

  return (
    <>
      <SectionTitle icon={FileImage} eyebrow="Source material" title="Project image" />
      <div className="image-summary">
        <div className="image-thumbnail"><img src={document.image.src} alt="" /></div>
        <div>
          <strong>{document.image.name}</strong>
          <span>{document.image.width} × {document.image.height}</span>
          <span>{document.image.mime}</span>
        </div>
      </div>
      <label className="field">
        <span>Anchor result label</span>
        <input value={document.projectName} onChange={(event) => setProjectName(event.target.value)} />
      </label>
      <button className="primary-button full" type="button" onClick={onOpenImage}>
        <Upload size={16} /> Choose another image
      </button>
      <div className="privacy-panel">
        <div><Check size={15} /><span>Processed in this browser</span></div>
        <div><Check size={15} /><span>Autosaved on this device</span></div>
        <div><Check size={15} /><span>No network upload</span></div>
      </div>
      <div className="subsection">
        <h3>Project maintenance</h3>
        <div className="inspector-actions">
          <button className="secondary-button" type="button" onClick={resetDemo}>Load example</button>
          <button className="danger-button" type="button" onClick={onClearProject}>
            <Trash2 size={14} /> Clear local data
          </button>
        </div>
      </div>
    </>
  )
}

function ExportInspector() {
  const document = useEditorStore((state) => state.document)
  const updateScanner = useEditorStore((state) => state.updateScanner)
  const updateBounds = useEditorStore((state) => state.updateBounds)
  const validation = validateForExport(document)
  const config = generateCoordsFinderConfig(document)
  const bounds = document.scanner.bounds

  const downloadConfig = () => {
    if (validation.errors.length > 0) return
    downloadBlob(new Blob([config], { type: 'text/plain;charset=utf-8' }), 'coordsfinder.conf')
  }

  return (
    <>
      <SectionTitle icon={Download} eyebrow="CoordsFinder handoff" title="Export configuration" />
      <label className="field">
        <span>Texture algorithm</span>
        <select
          value={document.scanner.textureAlgorithm}
          onChange={(event) =>
            updateScanner({ textureAlgorithm: event.target.value as TextureAlgorithm })
          }
        >
          {textureAlgorithms.map((algorithm) => (
            <option key={algorithm} value={algorithm}>{algorithm}</option>
          ))}
        </select>
      </label>
      <details className="algorithm-reference">
        <summary>Algorithm version reference</summary>
        <div className="algorithm-reference-content">
          <table>
            <thead>
              <tr>
                <th>MC Version</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>&lt;=1.12.2</td><td>vanilla-1</td></tr>
              <tr><td>1.13-1.21.1</td><td>vanilla-2</td></tr>
              <tr><td>1.21.2+</td><td>vanilla-3</td></tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>MC Version</th>
                <th>Sodium Version</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>1.16-1.18.2</td><td>1.0-4.1</td><td>sodium-1</td></tr>
              <tr><td>1.19-1.19.3</td><td>4.2-4.8</td><td>sodium-2</td></tr>
            </tbody>
          </table>
        </div>
      </details>
      <div className="subsection">
        <h3>Inclusive search bounds</h3>
        <div className="bounds-grid">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="bounds-row">
              <b>{axis.toUpperCase()}</b>
              <NumberField
                label="Start"
                value={bounds[`${axis}Start`]}
                onChange={(value) =>
                  updateBounds({ [`${axis}Start`]: value } as Partial<typeof bounds>)
                }
              />
              <NumberField
                label="End"
                value={bounds[`${axis}End`]}
                onChange={(value) =>
                  updateBounds({ [`${axis}End`]: value } as Partial<typeof bounds>)
                }
              />
            </div>
          ))}
        </div>
      </div>
      <details className="advanced-settings">
        <summary>Scanner runtime settings</summary>
        <div className="field-grid two">
          <NumberField label="Chunk blocks X" value={document.scanner.chunkBlocksX} min={1} onChange={(chunkBlocksX) => updateScanner({ chunkBlocksX })} />
          <NumberField label="Chunk blocks Z" value={document.scanner.chunkBlocksZ} min={1} onChange={(chunkBlocksZ) => updateScanner({ chunkBlocksZ })} />
          <NumberField label="Allowed bad blocks" value={document.scanner.maxBadBlocks} min={0} onChange={(maxBadBlocks) => updateScanner({ maxBadBlocks })} />
          <label className="check-field">
            <input type="checkbox" checked={document.scanner.printChunks} onChange={(event) => updateScanner({ printChunks: event.target.checked })} />
            Print chunks
          </label>
        </div>
      </details>
      <div className="strength-card">
        <div><span>Confirmed rows</span><strong>{validation.rowCount}</strong></div>
        <div><span>Information</span><strong>{constraintBits(document)} bits</strong></div>
        <div><span>Est. candidates</span><strong>{approximateCandidateCount(document)}</strong></div>
      </div>
      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="validation-list">
          {validation.errors.map((message) => (
            <div key={message} className="validation error"><X size={14} />{message}</div>
          ))}
          {validation.warnings.map((message) => (
            <div key={message} className="validation warning"><AlertTriangle size={14} />{message}</div>
          ))}
        </div>
      )}
      <pre className="config-preview">{config}</pre>
      <button
        type="button"
        className="primary-button full"
        onClick={downloadConfig}
        disabled={validation.errors.length > 0}
      >
        <Download size={16} /> Download coordsfinder.conf
      </button>
      <div className="todo-card">
        <AlertTriangle size={15} />
        <span><b>Note:</b> world directions are user-confirmed; the app does not infer a compass bearing from the screenshot.</span>
      </div>
    </>
  )
}

export function Inspector(props: InspectorProps) {
  const step = useEditorStore((state) => state.step)
  const document = useEditorStore((state) => state.document)
  const selectedPlaneId = useEditorStore((state) => state.selectedPlaneId)
  const selectedPlane = document.planes.find(
    (plane) => plane.id === selectedPlaneId,
  )

  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        {step === 'image' && <ImageInspector onOpenImage={props.onOpenImage} onClearProject={props.onClearProject} />}
        {step === 'grid' && <PlaneInspector plane={selectedPlane} />}
        {step === 'faces' && <FacesWorkspace busy={props.busy} onAutoFill={props.onAutoFill} />}
        {step === 'export' && <ExportInspector />}
      </div>
    </aside>
  )
}
