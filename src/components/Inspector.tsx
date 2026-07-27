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
  axisDisplayLabel,
  faceHasWorldOrientation,
  faceForLocalNormal,
  faceDisplayName,
  faceQuad,
  isAxisMappingComplete,
  mappedVector,
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
  type AbstractAxis,
  type CandidateTransform,
  type TextureAlgorithm,
  type WorldAxisLabel,
} from '../domain/types'
import { downloadBlob } from '../domain/projectBundle'
import { useEditorStore } from '../store/editorStore'

interface InspectorProps {
  busy: boolean
  onOpenImage: () => void
  onAutoFill: (evidenceIds?: string[]) => void
  onClearProject: () => void
}

const axisOptions: Array<{ value: WorldAxisLabel; label: string }> = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'x', label: 'X axis · sign unknown' },
  { value: 'x+', label: '+X' },
  { value: 'x-', label: '−X' },
  { value: 'y', label: 'Y axis · sign unknown' },
  { value: 'y+', label: '+Y' },
  { value: 'y-', label: '−Y' },
  { value: 'z', label: 'Z axis · sign unknown' },
  { value: 'z+', label: '+Z' },
  { value: 'z-', label: '−Z' },
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

function GeometryInspector() {
  const scene = useEditorStore((state) => state.document.scene)
  const selectedEdges = useEditorStore((state) => state.selectedEdges)
  const selectedFaceCount = useEditorStore(
    (state) => state.selectedEvidenceIds.length,
  )
  const deleteSelectedFaces = useEditorStore(
    (state) => state.deleteSelectedFaces,
  )
  const flipSelectedFaces = useEditorStore((state) => state.flipSelectedFaces)
  const updateAxisMapping = useEditorStore((state) => state.updateAxisMapping)
  const setTool = useEditorStore((state) => state.setTool)

  if (scene.faces.length === 0) {
    return (
      <div className="empty-inspector">
        <Grid3X3 size={28} />
        <h3>No geometry</h3>
        <p>Draw four corners to create the initial set of 1×1 faces.</p>
      </div>
    )
  }
  const calibrated = scene.projection.kind === 'camera'
  const cameraProjection =
    scene.projection.kind === 'camera' ? scene.projection : undefined
  const mappingComplete = isAxisMappingComplete(scene.axisMapping)

  return (
    <>
      <SectionTitle icon={Grid3X3} eyebrow="Mesh geometry" title="Global geometry" />
      <div className="geometry-summary" aria-label="Geometry summary">
        <div>
          <strong>{scene.faces.length}</strong>
          <span>Faces</span>
        </div>
        <div>
          <strong>{selectedEdges.length}</strong>
          <span>Selected edges</span>
        </div>
      </div>
      <div className="subsection">
        <h3>Global axis directions</h3>
        <div className="field-stack">
          {(['a', 'b', 'c'] as AbstractAxis[]).map((axis) => (
            <label className="field" key={axis}>
              <span>Abstract {axis.toUpperCase()} · currently {axisDisplayLabel(axis, scene.axisMapping)}</span>
              <select
                value={scene.axisMapping[axis]}
                onChange={(event) =>
                  updateAxisMapping(axis, event.target.value as WorldAxisLabel)
                }
              >
                {axisOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="axis-hint">
          Geometry uses A/B/C even while compass directions are unknown.
          Assigning a world axis colors the global gizmo; export requires all
          three signed directions.
        </p>
      </div>
      <div className={calibrated ? 'compass-card resolved' : 'compass-card'}>
        <Compass size={19} />
        <div>
          <strong>
            {cameraProjection ? 'Global camera fitted' : 'Planar calibration'}
          </strong>
          <span>
            {cameraProjection
              ? `${scene.observations.length} anchors · ${cameraProjection.rmsError.toFixed(1)} px RMS`
              : 'Move near the plane to extend it, or away to establish a new axis.'}
          </span>
        </div>
        {mappingComplete && <Check size={15} />}
      </div>
      <div className="inspector-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={selectedEdges.length === 0}
          onClick={() => setTool('extrude')}
        >
          <Link2 size={15} /> Extrude selected edges (E)
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={selectedFaceCount === 0}
          onClick={flipSelectedFaces}
        >
          Flip visible side
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={selectedFaceCount === 0}
          onClick={deleteSelectedFaces}
        >
          <Trash2 size={15} /> Delete selected {selectedFaceCount === 1 ? 'face' : 'faces'}
        </button>
      </div>
      <div className="hint-card">
        Click individual connected edges to toggle their selection, then press
        E. Move toward the intended axis and distance, then click to extrude.
        Before a 3D camera exists, moving near the plane keeps the extrusion
        planar; moving away creates the third axis.
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
  const meshFace = document.scene.faces.find(
    (entry) => entry.id === evidence?.faceId,
  )
  const evidenceFace = evidence
    ? faceForLocalNormal(document.scene.axisMapping, evidence.localNormal)
    : undefined
  const evidenceCoordinate = evidence
    ? mappedVector(document.scene.axisMapping, evidence.latticeCoordinate)
    : undefined
  const worldOrientationKnown = meshFace
    ? faceHasWorldOrientation(document.scene, meshFace)
    : false
  const [cropUrl, setCropUrl] = useState('')
  const [cropStatus, setCropStatus] = useState<
    'loading' | 'ready' | 'unresolved' | 'error'
  >('loading')

  useEffect(() => {
    let active = true
    if (!evidence || !meshFace || multiple) {
      setCropUrl('')
      return
    }
    if (!evidenceFace || !worldOrientationKnown) {
      setCropUrl('')
      setCropStatus('unresolved')
      return
    }
    const quad = faceQuad(document.scene, meshFace)
    if (!quad) {
      setCropUrl('')
      setCropStatus('error')
      return
    }
    setCropUrl('')
    setCropStatus('loading')
    warpQuad(
      document.image.src,
      quad,
      112,
    )
      .then((crop) => {
        if (active) {
          setCropUrl(
            imageDataUrl(orientCropToWorld(crop, document.scene, meshFace)),
          )
          setCropStatus('ready')
        }
      })
      .catch(() => {
        if (active) {
          setCropUrl('')
          setCropStatus('error')
        }
      })
    return () => {
      active = false
    }
  }, [
    document.image.src,
    document.scene,
    evidence,
    evidenceFace,
    meshFace,
    multiple,
    worldOrientationKnown,
  ])

  if (!evidence) {
    return (
      <>
        <SectionTitle icon={Eye} eyebrow="Texture evidence" title="Select a block face" />
        <div className="empty-inspector">
          <BoxSelectPlaceholder />
          <h3>Nothing selected</h3>
          <p>Use Select and click a face. Shift-click to build a batch.</p>
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
    : evidenceFace && worldOrientationKnown
      ? referenceTextureForFace(evidence.blockId, evidenceFace)
      : undefined
  const candidates = Array.from({ length: evidence.stateCount }, (_, index) => index)
  const selectedTransform =
    evidence.selectedVariant === undefined || !profile
      ? undefined
      : profile.transforms[evidence.selectedVariant]
  const statuses = new Set(selectedEvidence.map((entry) => entry.reviewStatus))
  const selectedFaces = selectedEvidence.map((entry) =>
    faceForLocalNormal(document.scene.axisMapping, entry.localNormal),
  )
  const directions = new Set(selectedFaces)
  const anySelectedHaveVariant = selectedEvidence.some(
    (entry) => entry.selectedVariant !== undefined,
  )
  const autoAnalyzeIds = selectedEvidence
    .filter(
      (entry) =>
        entry.reviewStatus === 'unlabeled' &&
        (() => {
          const face = faceForLocalNormal(
            document.scene.axisMapping,
            entry.localNormal,
          )
          const meshFace = document.scene.faces.find(
            (candidate) => candidate.id === entry.faceId,
          )
          return (
            face &&
            meshFace &&
            faceHasWorldOrientation(document.scene, meshFace) &&
            referenceTextureForFace(entry.blockId, face)
          )
        })(),
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
          : evidenceCoordinate
            ? `${evidenceCoordinate.x}, ${evidenceCoordinate.y}, ${evidenceCoordinate.z}`
            : `A${evidence.latticeCoordinate.x}, B${evidence.latticeCoordinate.y}, C${evidence.latticeCoordinate.z}`}
      />
      <div className="evidence-meta">
        <span>
          {directions.size === 1 && evidenceFace
            ? faceDisplayName(evidenceFace)
            : directions.has(undefined)
              ? 'World direction unresolved'
              : 'Mixed directions'}
        </span>
        <span>{multiple ? 'Batch edit' : `${evidence.stateCount}-state`}</span>
        <span className={statuses.size === 1 ? `status-dot ${evidence.reviewStatus}` : 'status-dot'}>
          {statuses.size === 1 ? evidence.reviewStatus : 'mixed status'}
        </span>
      </div>
      {!multiple && profile && (
        <div className="face-preview-row">
          <div className="face-preview-item">
            <div className="face-preview">
              {cropStatus === 'ready' && cropUrl ? (
                <img src={cropUrl} alt="Perspective-correct selected block face" />
              ) : cropStatus === 'loading' ? (
                <LoaderCircle className="spin" />
              ) : (
                <div className="reference-unavailable" role="status">
                  {cropStatus === 'unresolved'
                    ? 'Resolve global axes to align this face'
                    : 'Unable to unwarp this face'}
                </div>
              )}
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
                <div className="reference-unavailable">
                  {worldOrientationKnown
                    ? 'Unsupported face'
                    : 'Resolve global axes'}
                </div>
              )}
            </div>
            <span className="face-preview-label">
              {evidence.selectedVariant === undefined
                ? 'No variant selected'
                : `Variant ${evidence.selectedVariant}`}
            </span>
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
                (entry) => {
                  const face = faceForLocalNormal(
                    document.scene.axisMapping,
                    entry.localNormal,
                  )
                  return !face || !statesForFace(candidate.id, face)
                },
              )}
            >
              {candidate.label}
              {selectedEvidence.some((entry) => {
                const face = faceForLocalNormal(
                  document.scene.axisMapping,
                  entry.localNormal,
                )
                return !face || !statesForFace(candidate.id, face)
              })
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
          (a, b) => {
            const aCoordinate =
              mappedVector(document.scene.axisMapping, a.latticeCoordinate) ??
              a.latticeCoordinate
            const bCoordinate =
              mappedVector(document.scene.axisMapping, b.latticeCoordinate) ??
              b.latticeCoordinate
            return (
              (b.confidence ?? -1) - (a.confidence ?? -1) ||
              aCoordinate.y - bCoordinate.y ||
              aCoordinate.z - bCoordinate.z ||
              aCoordinate.x - bCoordinate.x
            )
          },
        ),
    [document.evidence, document.scene.axisMapping],
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
          reviewItems.map((entry) => {
            const coordinate =
              mappedVector(
                document.scene.axisMapping,
                entry.latticeCoordinate,
              ) ?? entry.latticeCoordinate
            return (
              <button
                key={entry.id}
                type="button"
                className={`review-item ${entry.reviewStatus}`}
                onClick={() => inspectEvidence(entry.id)}
                title="Inspect this face"
              >
                <span className="review-state" />
                <div>
                <strong>{coordinate.x}, {coordinate.y}, {coordinate.z}</strong>
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
            )
          })
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

  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        {step === 'image' && <ImageInspector onOpenImage={props.onOpenImage} onClearProject={props.onClearProject} />}
        {step === 'grid' && <GeometryInspector />}
        {step === 'faces' && <FacesWorkspace busy={props.busy} onAutoFill={props.onAutoFill} />}
        {step === 'export' && <ExportInspector />}
      </div>
    </aside>
  )
}
