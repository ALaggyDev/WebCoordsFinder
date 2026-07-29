import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Compass,
  Crosshair,
  Download,
  Eye,
  FileImage,
  FlipHorizontal2,
  Grid3X3,
  Link2,
  LoaderCircle,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  generateCoordsFinderConfig,
  validateForExport,
} from '../domain/exportConfig'
import {
  faceHasWorldOrientation,
  faceForLocalNormal,
  faceDisplayName,
  isAxisMappingComplete,
  mappedAnchorOffset,
  possibleFacesForLocalNormal,
  projectionInfo,
  worldAlignedFaceQuad,
} from '../domain/geometry'
import { imageDataUrl, warpQuad } from '../domain/imageAnalysis'
import {
  blockProfiles,
  blockProfileMap,
  referenceTextureForFace,
  sharedReferenceTextureForFaces,
  sharedStatesForFaces,
} from '../domain/references'
import {
  searchDirections,
  textureAlgorithms,
  type CandidateTransform,
  type SearchDirection,
  type TextureAlgorithm,
} from '../domain/types'
import { downloadBlob } from '../domain/projectBundle'
import { useEditorStore } from '../store/editorStore'
import { AxisMappingGizmo } from './AxisMappingGizmo'
import { ExportRunDialog } from './ExportRunDialog'

// The right-hand inspector mirrors the four workflow stages. It derives UI
// state from the document while delegating all persisted mutations to Zustand.
interface InspectorProps {
  busy: boolean
  onOpenImage: () => void
  onAutoFill: (evidenceIds?: string[]) => void
}

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
  const image = useEditorStore((state) => state.document.image)
  const selectedEdges = useEditorStore((state) => state.selectedEdges)
  const selectedFaceCount = useEditorStore(
    (state) => state.selectedEvidenceIds.length,
  )
  const deleteSelectedFaces = useEditorStore(
    (state) => state.deleteSelectedFaces,
  )
  const setAxisMapping = useEditorStore((state) => state.setAxisMapping)
  const setTool = useEditorStore((state) => state.setTool)
  const tool = useEditorStore((state) => state.tool)
  const anchorFaceId = useEditorStore((state) => state.document.anchorFaceId)
  const anchorFace = scene.faces.find(
    (face) => face.id === anchorFaceId,
  )

  if (scene.faces.length === 0) {
    return (
      <div className="empty-inspector">
        <Grid3X3 size={28} />
        <h3>No geometry</h3>
        <p>Draw four corners to create the initial set of 1×1 faces.</p>
      </div>
    )
  }
  const calibration = projectionInfo(scene)
  const calibrated = calibration.resolvedAxes === 3
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
      <div className={anchorFace ? 'compass-card resolved' : 'compass-card'}>
        <Crosshair size={19} />
        <div>
          <strong>{anchorFace ? 'Anchor selected' : 'Select an anchor block'}</strong>
          <span>
            {anchorFace
              ? 'This block is the coordinate origin at 0, 0, 0.'
              : 'Choose the Anchor tool, then click any block face.'}
          </span>
        </div>
        {anchorFace ? (
          <Check size={15} />
        ) : (
          <button
            type="button"
            className="small-button"
            onClick={() => setTool('anchor')}
          >
            {tool === 'anchor' ? 'Click a face' : 'Select'}
          </button>
        )}
      </div>
      <div className="subsection">
        <h3>Global axis directions</h3>
        <AxisMappingGizmo
          directionReference={{ x: image.width / 2, y: image.height / 2 }}
          mapping={scene.axisMapping}
          onChange={setAxisMapping}
          scene={scene}
        />
        <p className="axis-hint">
          Choose any two signed directions. Pin one arrow to keep it fixed;
          changing either other arrow recalculates the remaining direction.
        </p>
      </div>
      <div className={calibrated ? 'compass-card resolved' : 'compass-card'}>
        <Compass size={19} />
        <div>
          <strong>
            {calibrated ? 'Global camera fitted' : 'Planar calibration'}
          </strong>
          <span>
            {scene.observations.length} anchors ·{' '}
            {calibration.rmsError.toFixed(1)} px RMS ·{' '}
            {calibration.resolvedAxes} axes
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
  const possibleEvidenceFaces = evidence
    ? possibleFacesForLocalNormal(
        document.scene.axisMapping,
        evidence.localNormal,
      )
    : []
  const evidenceCoordinate = evidence
    ? mappedAnchorOffset(
        document.scene,
        document.anchorFaceId,
        evidence.latticeCoordinate,
      )
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
      // Do not guess a rotation or reflection while the local-to-world mapping
      // still admits more than one canonical crop orientation.
      setCropUrl('')
      setCropStatus('unresolved')
      return
    }
    const quad = worldAlignedFaceQuad(document.scene, meshFace)
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
        // Selection may change while canvas extraction is in flight.
        if (active) {
          setCropUrl(imageDataUrl(crop))
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
    : sharedReferenceTextureForFaces(
        evidence.blockId,
        possibleEvidenceFaces,
      )
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
        // Confirmed and already proposed evidence is never overwritten by a
        // bulk analysis request from the selection workspace.
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
            : possibleEvidenceFaces.length > 0 &&
                possibleEvidenceFaces.every((face) =>
                  ['north', 'south', 'east', 'west'].includes(face),
                )
              ? 'Side face · compass unresolved'
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
                  {possibleEvidenceFaces.length > 0
                    ? 'Unsupported face'
                    : 'Resolve vertical axis'}
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
                  // Batch choices must be valid for every possible world face
                  // represented by the current partial axis mapping.
                  const faces = possibleFacesForLocalNormal(
                    document.scene.axisMapping,
                    entry.localNormal,
                  )
                  return !sharedStatesForFaces(candidate.id, faces)
                },
              )}
            >
              {candidate.label}
              {selectedEvidence.some((entry) => {
                const faces = possibleFacesForLocalNormal(
                  document.scene.axisMapping,
                  entry.localNormal,
                )
                return !sharedStatesForFaces(candidate.id, faces)
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
  anySelectedHaveVariant,
  onAutoFill,
}: {
  busy: boolean
  selectedIds: string[]
  multiple: boolean
  autoAnalyzeIds: string[]
  proposedIds: string[]
  anySelectedHaveVariant: boolean
  onAutoFill: (evidenceIds?: string[]) => void
}) {
  const setEvidenceStatus = useEditorStore((state) => state.setEvidenceStatus)
  const flipSelectedFaces = useEditorStore((state) => state.flipSelectedFaces)
  const hasSelection = selectedIds.length > 0

  return (
    <div className="face-selection-actions" aria-label="Face selection actions">
      <div className="face-selection-action-row">
        <button
          type="button"
          className="secondary-button"
          onClick={flipSelectedFaces}
          disabled={!hasSelection}
        >
          <FlipHorizontal2 size={15} /> Flip visible side
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
            entry.scores !== undefined &&
            entry.scores.length > 0,
        )
        .sort(
          (a, b) => {
            const aCoordinate =
              mappedAnchorOffset(
                document.scene,
                document.anchorFaceId,
                a.latticeCoordinate,
              ) ??
              a.latticeCoordinate
            const bCoordinate =
              mappedAnchorOffset(
                document.scene,
                document.anchorFaceId,
                b.latticeCoordinate,
              ) ??
              b.latticeCoordinate
            return (
              // Put the clearest proposals first, then use stable spatial
              // ordering so equal-confidence rows do not jump around.
              (b.confidence ?? -1) - (a.confidence ?? -1) ||
              aCoordinate.y - bCoordinate.y ||
              aCoordinate.z - bCoordinate.z ||
              aCoordinate.x - bCoordinate.x
            )
          },
        ),
    [document.anchorFaceId, document.evidence, document.scene],
  )
  const counts = useMemo(
    () =>
      reviewItems.reduce(
        (result, entry) => {
          result[entry.reviewStatus] += 1
          return result
        },
        { unlabeled: 0, proposed: 0, confirmed: 0 },
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
              mappedAnchorOffset(
                document.scene,
                document.anchorFaceId,
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
}: Pick<InspectorProps, 'onOpenImage'>) {
  const document = useEditorStore((state) => state.document)

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
      <button className="primary-button full" type="button" onClick={onOpenImage}>
        <Upload size={16} /> Open image in new project
      </button>
      <div className="privacy-panel">
        <div><Check size={15} /><span>Processed in this browser</span></div>
        <div><Check size={15} /><span>Autosaved on this device</span></div>
        <div><Check size={15} /><span>No network upload</span></div>
      </div>
    </>
  )
}

function ExportInspector() {
  const document = useEditorStore((state) => state.document)
  const updateScanner = useEditorStore((state) => state.updateScanner)
  const updateBounds = useEditorStore((state) => state.updateBounds)
  const [dialogOpen, setDialogOpen] = useState(false)
  const validation = validateForExport(document)
  const config = generateCoordsFinderConfig(document)
  const bounds = document.scanner.bounds

  const downloadConfig = () => {
    if (validation.errors.length > 0) return
    downloadBlob(new Blob([config], { type: 'text/plain;charset=utf-8' }), 'coordsfinder.conf')
  }

  return (
    <div className="export-inspector">
      <SectionTitle icon={Download} eyebrow="Search setup" title="Export configuration" />
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
        <h3>Directions to search</h3>
        <div className="field-grid two" aria-label="Directions to search">
          {searchDirections.map((direction) => {
            const checked = document.scanner.directions.includes(direction)
            return (
              <label className="check-field" key={direction}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={direction === 0}
                  onChange={(event) => {
                    // Zero degrees represents the selected mapping and remains
                    // mandatory; extra quarter-turns cover compass ambiguity.
                    const directions = searchDirections.filter(
                      (candidate) =>
                        candidate === 0 ||
                        (candidate === direction
                          ? event.target.checked
                          : document.scanner.directions.includes(candidate)),
                    ) as SearchDirection[]
                    updateScanner({ directions })
                  }}
                />
                {direction}°
                {direction === 0 ? ' · selected axes' : ''}
              </label>
            )
          })}
        </div>
        <p className="field-help">
          Add horizontal rotations when the screenshot's compass direction
          cannot be distinguished. The selected axes are always searched as 0°.
        </p>
      </div>
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
      <div className="subsection">
        <NumberField
          label="Error tolerance"
          value={document.scanner.maxBadBlocks}
          min={0}
          onChange={(maxBadBlocks) => updateScanner({ maxBadBlocks })}
        />
        <p className="field-help">
          Maximum number of confirmed observations that may disagree. Zero
          requires an exact match.
        </p>
      </div>
      <details className="advanced-settings">
        <summary>CoordsFinder settings</summary>
        <p className="field-help">
          These options affect only the downloaded CoordsFinder configuration.
        </p>
        <div className="field-grid two">
          <NumberField label="Chunk blocks X" value={document.scanner.chunkBlocksX} min={1} onChange={(chunkBlocksX) => updateScanner({ chunkBlocksX })} />
          <NumberField label="Chunk blocks Z" value={document.scanner.chunkBlocksZ} min={1} onChange={(chunkBlocksZ) => updateScanner({ chunkBlocksZ })} />
          <label className="check-field">
            <input type="checkbox" checked={document.scanner.printChunks} onChange={(event) => updateScanner({ printChunks: event.target.checked })} />
            Print chunks
          </label>
        </div>
      </details>
      <div className="todo-card">
        <AlertTriangle size={15} />
        <span><b>Note:</b> world directions are user-confirmed; the app does not infer a compass bearing from the screenshot. Extra rotations are written to the exported configuration.</span>
      </div>
      <div className="export-inspector-footer">
        <button
          className="primary-button full"
          onClick={() => setDialogOpen(true)}
          type="button"
        >
          <ScanSearch size={16} /> Export / Run
        </button>
      </div>
      <ExportRunDialog
        document={document}
        onClose={() => setDialogOpen(false)}
        onDownload={downloadConfig}
        open={dialogOpen}
      />
    </div>
  )
}

export function Inspector(props: InspectorProps) {
  const step = useEditorStore((state) => state.step)

  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        {step === 'image' && <ImageInspector onOpenImage={props.onOpenImage} />}
        {step === 'grid' && <GeometryInspector />}
        {step === 'faces' && <FacesWorkspace busy={props.busy} onAutoFill={props.onAutoFill} />}
        {step === 'export' && <ExportInspector />}
      </div>
    </aside>
  )
}
