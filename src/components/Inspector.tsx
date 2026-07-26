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
  ScanSearch,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  approximateCandidateCount,
  constraintBits,
  deriveTextureMode,
  generateCoordsFinderConfig,
  validateForExport,
} from '../domain/exportConfig'
import { cellQuad, faceDisplayName } from '../domain/geometry'
import { imageDataUrl, warpQuad } from '../domain/imageAnalysis'
import {
  blockProfiles,
  blockProfileMap,
  referenceTextureForFace,
  statesForFace,
} from '../domain/references'
import type {
  CandidateTransform,
  FaceDirection,
  PerspectivePlane,
} from '../domain/types'
import { downloadBlob } from '../domain/projectBundle'
import { useEditorStore } from '../store/editorStore'

interface InspectorProps {
  busy: boolean
  onOpenImage: () => void
  onAutoFill: () => void
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
            onChange={(event) =>
              updatePlane(plane.id, { face: event.target.value as FaceDirection })
            }
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
        <div className="axis-readout">
          <span><b>U</b> {plane.uAxis.x}, {plane.uAxis.y}, {plane.uAxis.z}</span>
          <span><b>V</b> {plane.vAxis.x}, {plane.vAxis.y}, {plane.vAxis.z}</span>
        </div>
      </div>
      <div className={scanner.compassResolved ? 'compass-card resolved' : 'compass-card'}>
        <Compass size={19} />
        <div>
          <strong>{scanner.compassResolved ? 'World direction resolved' : 'Compass direction required'}</strong>
          <span>Confirm that this project’s X/Z axes match the screenshot.</span>
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
  const setEvidenceStatus = useEditorStore((state) => state.setEvidenceStatus)
  const evidence = document.evidence.find((entry) => entry.id === selectedIds[0])
  const [cropUrl, setCropUrl] = useState('')

  useEffect(() => {
    let active = true
    if (!evidence) {
      setCropUrl('')
      return
    }
    const plane = document.planes.find((entry) => entry.id === evidence.planeId)
    if (!plane) return
    warpQuad(document.image.src, cellQuad(plane, evidence.column, evidence.row), 112)
      .then((crop) => {
        if (active) setCropUrl(imageDataUrl(crop))
      })
      .catch(() => {
        if (active) setCropUrl('')
      })
    return () => {
      active = false
    }
  }, [document.image.src, document.planes, evidence])

  if (!evidence) {
    return (
      <>
        <SectionTitle icon={Eye} eyebrow="Texture evidence" title="Select a block face" />
        <div className="empty-inspector">
          <BoxSelectPlaceholder />
          <h3>Nothing selected</h3>
          <p>Use Select and click a grid cell. Shift-click to build a batch.</p>
        </div>
      </>
    )
  }

  const profile = blockProfileMap.get(evidence.blockId)!
  const referenceUrl = referenceTextureForFace(evidence.blockId, evidence.face)
  const candidates = Array.from({ length: evidence.stateCount }, (_, index) => index)

  return (
    <>
      <SectionTitle
        icon={Eye}
        eyebrow={`${selectedIds.length} face${selectedIds.length === 1 ? '' : 's'} selected`}
        title={`${evidence.coordinate.x}, ${evidence.coordinate.y}, ${evidence.coordinate.z}`}
      />
      <div className="evidence-meta">
        <span>{faceDisplayName(evidence.face)}</span>
        <span>{evidence.stateCount}-state</span>
        <span className={`status-dot ${evidence.reviewStatus}`}>{evidence.reviewStatus}</span>
      </div>
      <div className="face-preview-row">
        <div className="face-preview">
          {cropUrl ? <img src={cropUrl} alt="Perspective-correct selected block face" /> : <LoaderCircle className="spin" />}
          <span>Unwarped face</span>
        </div>
        <div className="face-preview reference">
          {referenceUrl ? (
            <img src={referenceUrl} alt={`Bundled ${profile.label} reference`} />
          ) : (
            <div className="reference-unavailable">Unsupported face</div>
          )}
          <span>Bundled 1.21.11 reference</span>
        </div>
      </div>
      <label className="field">
        <span>Block profile</span>
        <select
          value={evidence.blockId}
          onChange={(event) => setBlockForSelection(event.target.value)}
        >
          {blockProfiles.map((candidate) => (
            <option
              key={candidate.id}
              value={candidate.id}
              disabled={!statesForFace(candidate.id, evidence.face)}
            >
              {candidate.label}{!statesForFace(candidate.id, evidence.face) ? ' — unsupported face' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="profile-note">
        <span style={{ background: profile.accent }} />
        {profile.notes}
      </div>
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
                  <b>{variant}</b>
                </div>
                <span>{score === undefined ? 'Manual' : `${Math.round(score * 100)}% match`}</span>
              </button>
            )
          })}
        </div>
      </div>
      <button
        type="button"
        className="primary-button full"
        onClick={onAutoFill}
        disabled={busy || !referenceUrl}
        title={!referenceUrl ? 'This block profile does not support the selected face' : undefined}
      >
        {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
        Auto-fill selected faces
      </button>
      <div className="inspector-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setEvidenceStatus(selectedIds, 'confirmed')}
          disabled={evidence.selectedVariant === undefined}
        >
          <Check size={15} /> Confirm
        </button>
        <button type="button" className="secondary-button" onClick={() => setEvidenceStatus(selectedIds, 'excluded')}>
          <X size={15} /> Exclude
        </button>
      </div>
    </>
  )
}

function BoxSelectPlaceholder() {
  return <div className="selection-placeholder"><span /><span /><span /><span /></div>
}

function ReviewInspector({ busy, onAutoFill }: Pick<InspectorProps, 'busy' | 'onAutoFill'>) {
  const document = useEditorStore((state) => state.document)
  const selectedIds = useEditorStore((state) => state.selectedEvidenceIds)
  const updateScanner = useEditorStore((state) => state.updateScanner)
  const acceptQualified = useEditorStore((state) => state.acceptQualifiedProposals)
  const setEvidenceStatus = useEditorStore((state) => state.setEvidenceStatus)
  const counts = useMemo(
    () =>
      document.evidence.reduce(
        (result, entry) => {
          result[entry.reviewStatus] += 1
          return result
        },
        { unlabeled: 0, proposed: 0, confirmed: 0, excluded: 0 },
      ),
    [document.evidence],
  )
  const reviewItems = document.evidence.filter((entry) => entry.reviewStatus !== 'excluded')

  return (
    <>
      <SectionTitle icon={ScanSearch} eyebrow="Quality control" title="Review queue" />
      <div className="review-metrics">
        <div><strong>{counts.confirmed}</strong><span>Confirmed</span></div>
        <div><strong>{counts.proposed}</strong><span>Proposed</span></div>
        <div><strong>{counts.unlabeled}</strong><span>Unlabeled</span></div>
      </div>
      <label className="range-field">
        <span>
          Proposal margin
          <b>{document.scanner.confidenceThreshold.toFixed(2)}</b>
        </span>
        <input
          type="range"
          min="0.02"
          max="0.35"
          step="0.01"
          value={document.scanner.confidenceThreshold}
          onChange={(event) => updateScanner({ confidenceThreshold: Number(event.target.value) })}
        />
      </label>
      <div className="review-actions">
        <button className="primary-button" type="button" onClick={acceptQualified}>
          <Check size={15} /> Accept qualified
        </button>
        <button className="secondary-button" type="button" onClick={onAutoFill} disabled={busy || selectedIds.length === 0}>
          <Sparkles size={15} /> Analyze selection
        </button>
      </div>
      <div className="review-list">
        {reviewItems.length === 0 ? (
          <div className="list-empty">Select grid cells to create evidence.</div>
        ) : (
          reviewItems.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`review-item ${entry.reviewStatus}`}
              onClick={() => setEvidenceStatus([entry.id], entry.reviewStatus === 'confirmed' ? 'unlabeled' : 'confirmed')}
            >
              <span className="review-state" />
              <div>
                <strong>{entry.coordinate.x}, {entry.coordinate.y}, {entry.coordinate.z}</strong>
                <span>{blockProfileMap.get(entry.blockId)?.label} · {entry.stateCount}-state</span>
              </div>
              <div className="review-result">
                {entry.selectedVariant === undefined ? '—' : entry.selectedVariant}
                {entry.confidence !== undefined && <small>Δ {entry.confidence.toFixed(2)}</small>}
              </div>
              <ChevronRight size={14} />
            </button>
          ))
        )}
      </div>
    </>
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
  const mode = deriveTextureMode(document)
  const bounds = document.scanner.bounds

  const downloadConfig = () => {
    if (validation.errors.length > 0) return
    downloadBlob(new Blob([config], { type: 'text/plain;charset=utf-8' }), 'coordsfinder.conf')
  }

  return (
    <>
      <SectionTitle icon={Download} eyebrow="CoordsFinder handoff" title="Export configuration" />
      <div className="mode-card">
        <span>Derived texture mode</span>
        <strong>{mode}</strong>
      </div>
      <div className="field-grid two">
        <label className="field">
          <span>Minecraft version</span>
          <input
            value={document.scanner.minecraftVersion}
            onChange={(event) => updateScanner({ minecraftVersion: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Renderer</span>
          <select
            value={document.scanner.renderer}
            onChange={(event) => updateScanner({ renderer: event.target.value as 'vanilla' | 'sodium' })}
          >
            <option value="vanilla">Vanilla</option>
            <option value="sodium">Sodium</option>
          </select>
        </label>
      </div>
      {document.scanner.renderer === 'sodium' && (
        <label className="field">
          <span>Sodium version</span>
          <input value={document.scanner.sodiumVersion} onChange={(event) => updateScanner({ sodiumVersion: event.target.value })} />
        </label>
      )}
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
        <span><b>Roadmap:</b> unknown compass direction is not yet supported because model variants can rotate or mirror.</span>
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
        {step === 'faces' && <FaceInspector busy={props.busy} onAutoFill={props.onAutoFill} />}
        {step === 'review' && <ReviewInspector busy={props.busy} onAutoFill={props.onAutoFill} />}
        {step === 'export' && <ExportInspector />}
      </div>
    </aside>
  )
}
