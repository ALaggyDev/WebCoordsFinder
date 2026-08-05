import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronRight,
  Compass,
  Crosshair,
  Download,
  Eye,
  FileImage,
  FlipHorizontal2,
  Grid3X3,
  Info,
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
  isWorldUpResolved,
  mappedAnchorOffset,
  possibleFacesForLocalNormal,
  projectionInfo,
  worldAlignedFaceQuad,
} from '../domain/geometry'
import {
  colorizedReferenceTexture,
  imageDataUrl,
  warpQuad,
} from '../domain/imageAnalysis'
import {
  blockProfiles,
  blockProfileMap,
  referenceTextureForFace,
  sharedReferenceTextureForFaces,
  sharedStatesForFaces,
} from '../domain/references'
import {
  scanOrders,
  searchDirections,
  textureAlgorithms,
  type CandidateTransform,
  type SearchDirection,
  type ScanOrder,
  type TextureAlgorithm,
} from '../domain/types'
import { downloadBlob } from '../domain/projectBundle'
import { useEditorStore } from '../store/editorStore'
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
  const [draft, setDraft] = useState(() => String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commitIfCompleteInteger = (nextValue: string) => {
    if (/^-?\d+$/.test(nextValue)) onChange(Number(nextValue))
  }

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        onChange={(event) => {
          const nextValue = event.target.value
          setDraft(nextValue)
          commitIfCompleteInteger(nextValue)
        }}
        onBlur={() => {
          if (!/^-?\d+$/.test(draft)) setDraft(String(value))
        }}
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

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="info-tip" tabIndex={0} aria-label={label}>
      <Info size={14} aria-hidden="true" />
      <div className="info-tip-content" role="tooltip">{children}</div>
    </div>
  )
}

function GeometryInspector() {
  const scene = useEditorStore((state) => state.document.scene)
  const orientationDraft = useEditorStore((state) => state.orientationDraft)
  const selectedEdges = useEditorStore((state) => state.selectedEdges)
  const selectedFaceCount = useEditorStore(
    (state) => state.selectedEvidenceIds.length,
  )
  const deleteSelectedFaces = useEditorStore(
    (state) => state.deleteSelectedFaces,
  )
  const setTool = useEditorStore((state) => state.setTool)
  const startUpOrientation = useEditorStore((state) => state.startUpOrientation)
  const startHorizontalOrientation = useEditorStore(
    (state) => state.startHorizontalOrientation,
  )
  const cancelOrientation = useEditorStore(
    (state) => state.cancelOrientation,
  )
  const tool = useEditorStore((state) => state.tool)
  const anchorFaceId = useEditorStore((state) => state.document.anchorFaceId)
  const anchorFace = scene.faces.find(
    (face) => face.id === anchorFaceId,
  )
  const calibration = projectionInfo(scene)
  const compassResolved = useEditorStore(
    (state) => state.document.scanner.compassResolved,
  )
  const upResolved = isWorldUpResolved(scene.axisMapping)
  const mappingComplete = isAxisMappingComplete(scene.axisMapping)

  if (!scene.projection) {
    return (
      <>
        <SectionTitle
          icon={Grid3X3}
          eyebrow="Mesh geometry"
          title="Global geometry"
        />
        <section className="geometry-part">
          <div className="empty-inspector calibration-empty">
            <Grid3X3 size={28} />
            <h3>No perspective geometry</h3>
            <p>
              Mark four corners around a block-aligned surface. Confirming its
              grid size saves a resumable 2D perspective solve.
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() => setTool('plane')}
            >
              {tool === 'plane' ? 'Click four corners' : 'Start perspective solve'}
            </button>
          </div>
        </section>
      </>
    )
  }

  const orientationFace = orientationDraft?.faceId
    ? scene.faces.find((face) => face.id === orientationDraft.faceId)
    : undefined
  const planar = scene.projection.kind === 'planar'

  return (
    <>
      <SectionTitle icon={Grid3X3} eyebrow="Mesh geometry" title="Global geometry" />
      <section className="geometry-part">
        <h3>Perspective geometry</h3>
        <div className="geometry-status-list">
          <div className="geometry-status resolved">
            <Grid3X3 size={17} />
            <div>
              <strong>{planar ? 'Planar perspective solved' : '3D perspective solved'}</strong>
              <span>
                {scene.observations.length} calibration points · {calibration.rmsError.toFixed(1)} px RMS
                {!planar && ` · ${calibration.maxError.toFixed(1)} px maximum`}
              </span>
            </div>
            <Check size={15} />
          </div>
          <div className={anchorFace ? 'geometry-status resolved' : 'geometry-status'}>
            <Crosshair size={17} />
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
        </div>
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
      </section>
      <section className="geometry-part world-orientation">
        <h3>World Orientation</h3>
        <div className="orientation-step-section">
          <h4>
            <span>1</span>
            <span className="orientation-step-label">World UP</span>
            {upResolved && orientationDraft?.mode !== 'up' && (
              <Check
                className="orientation-step-status confirmed"
                size={18}
                aria-label="World UP established"
              />
            )}
          </h4>
        {upResolved && orientationDraft?.mode !== 'up' ? (
          <div className="orientation-status">
            <p>World UP (+Y) is established.</p>
            <button
              className="secondary-button"
              type="button"
              onClick={startUpOrientation}
            >
              Change up direction
            </button>
          </div>
        ) : orientationDraft?.mode === 'up' ? (
          <div className="orientation-workflow">
            <div className={orientationFace ? 'setup-step complete' : 'setup-step active'}>
              <span>1</span>
              <div>
                <strong>Reference face</strong>
                <small>{orientationFace ? 'Face selected' : 'Click a face on the canvas'}</small>
              </div>
              {orientationFace && <Check size={15} />}
            </div>
            <div className={orientationDraft.surfaceKind ? 'setup-step complete' : 'setup-step active'}>
              <span>2</span>
              <div>
                <strong>Identify world UP</strong>
                <small>
                  {!orientationFace
                    ? 'Select a face first'
                    : orientationDraft.surfaceKind === 'side'
                      ? 'Click the arrow that points upward'
                      : 'Choose Top, Bottom, or Side in the face popup'}
                </small>
              </div>
              {orientationDraft.surfaceKind && <Check size={15} />}
            </div>
            <div className="inspector-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={cancelOrientation}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="orientation-empty">
            <p>
              Select one face and tell the app which way is vertically up (+Y).
            </p>
            <button
              className="primary-button full"
              type="button"
              onClick={startUpOrientation}
            >
              <Compass size={15} /> Determine world UP
            </button>
          </div>
        )}
        </div>
        <div className="orientation-step-section">
          <h4>
            <span>2</span>
            <span className="orientation-step-label">Horizontal Orientation</span>
            {upResolved && mappingComplete && orientationDraft?.mode !== 'horizontal' && (
              compassResolved ? (
                <Check
                  className="orientation-step-status confirmed"
                  size={18}
                  aria-label="Horizontal orientation confirmed"
                />
              ) : (
                <Sparkles
                  className="orientation-step-status guessed"
                  size={18}
                  aria-label="Horizontal orientation guessed"
                />
              )
            )}
          </h4>
          {orientationDraft?.mode === 'horizontal' ? (
            <div className="orientation-workflow">
              <div className={orientationFace ? 'setup-step complete' : 'setup-step active'}>
                <span>1</span>
                <div>
                  <strong>Reference face</strong>
                  <small>{orientationFace ? 'Face selected' : 'Click any face on the canvas'}</small>
                </div>
                {orientationFace && <Check size={15} />}
              </div>
              <div className={orientationDraft.edge ? 'setup-step complete' : 'setup-step active'}>
                <span>2</span>
                <div>
                  <strong>Horizontal arrow</strong>
                  <small>{orientationDraft.edge ? 'Choose its horizontal direction in the popup' : 'Click a gray arrow on the face'}</small>
                </div>
                {orientationDraft.edge && <Check size={15} />}
              </div>
              <button className="secondary-button" type="button" onClick={cancelOrientation}>
                Cancel
              </button>
            </div>
          ) : upResolved && mappingComplete ? (
            <div className="orientation-status">
              <p>
                {compassResolved
                  ? 'Horizontal orientation is user-confirmed.'
                  : 'A default horizontal orientation is pre-selected by the app. It can be changed if it is incorrect.'}
              </p>
              <button className="secondary-button" type="button" onClick={startHorizontalOrientation}>
                Change horizontal orientation
              </button>
            </div>
          ) : (
            <div className="orientation-empty">
              <p>A default horizontal orientation will be pre-selected by the app. Select a face and click the horizontal arrow to change it.</p>
              <button className="secondary-button full" type="button" disabled>
                Select horizontal orientation
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="geometry-part geometry-actions">
        <h3>Actions</h3>
      <div className="inspector-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setTool('anchor')}
        >
          <Crosshair size={15} /> {tool === 'anchor' ? 'Click a face' : 'Select anchor block (A)'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={selectedEdges.length === 0}
          onClick={() => setTool('extrude')}
        >
          <Link2 size={15} /> Extrude edges (E)
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={selectedFaceCount === 0}
          onClick={deleteSelectedFaces}
        >
          <Trash2 size={15} /> Delete faces (X)
        </button>
      </div>
      </section>
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

  const referenceUrl = evidence
    ? multiple
      ? undefined
      : sharedReferenceTextureForFaces(
          evidence.blockId,
          possibleEvidenceFaces,
        )
    : undefined
  const [displayReferenceUrl, setDisplayReferenceUrl] = useState('')

  useEffect(() => {
    let active = true
    setDisplayReferenceUrl('')
    if (!referenceUrl) return
    colorizedReferenceTexture(referenceUrl)
      .then((url) => {
        if (active) setDisplayReferenceUrl(url)
      })
      .catch(() => {
        if (active) setDisplayReferenceUrl(referenceUrl)
      })
    return () => {
      active = false
    }
  }, [referenceUrl])

  if (!document.scene.projection) {
    return (
      <>
        <SectionTitle icon={Eye} eyebrow="Texture evidence" title="Create geometry first" />
        <div className="empty-inspector">
          <BoxSelectPlaceholder />
          <h3>No projectable faces</h3>
          <p>Open Geometry and mark a block-aligned surface before labeling evidence.</p>
        </div>
      </>
    )
  }

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
  const renderedReferenceUrl = displayReferenceUrl || referenceUrl
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
              ? 'Side face · world orientation unresolved'
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
                    ? 'Determine world UP to align this face'
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
                  src={renderedReferenceUrl}
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
                : `Variant ${evidence.selectedVariant}${
                    evidence.confidence === undefined
                      ? ''
                      : ` · Δ ${evidence.confidence.toFixed(2)}`
                  }`}
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
              disabled={selectedEvidence.every(
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
                ? ' — No side face variants'
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
          <div className="candidate-grid">
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
                        src={renderedReferenceUrl}
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
  const setHoveredEvidence = useEditorStore((state) => state.setHoveredEvidence)
  useEffect(() => () => setHoveredEvidence(null), [setHoveredEvidence])
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
        <div><strong>{counts.unlabeled}</strong><span>Unlabeled</span></div>
        <div><strong>{counts.proposed}</strong><span>Proposed</span></div>
        <div><strong>{counts.confirmed}</strong><span>Confirmed</span></div>
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
                onMouseEnter={() => setHoveredEvidence(entry.id)}
                onMouseLeave={() => setHoveredEvidence(null)}
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
      <div className="field">
        <div className="field-label">
          <span>Texture algorithm</span>
          <InfoTip label="Algorithm version reference">
            <div className="algorithm-reference-content">
              <table>
                <thead>
                  <tr>
                    <th>MC Version</th>
                    <th>Algorithm</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>&lt;=1.12.2</td><td>Vanilla-1</td></tr>
                  <tr><td>1.13-1.21.1</td><td>Vanilla-2</td></tr>
                  <tr><td>1.21.2+</td><td>Vanilla-3</td></tr>
                </tbody>
              </table>
              <table>
                <thead>
                  <tr>
                    <th>MC Version</th>
                    <th>Sodium Version</th>
                    <th>Algorithm</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>1.16-1.18.2</td><td>1.0-4.1</td><td>Sodium-1</td></tr>
                  <tr><td>1.19-1.19.3</td><td>4.2-4.8</td><td>Sodium-2</td></tr>
                </tbody>
              </table>
            </div>
          </InfoTip>
        </div>
        <select
          aria-label="Texture algorithm"
          value={document.scanner.textureAlgorithm}
          onChange={(event) =>
            updateScanner({ textureAlgorithm: event.target.value as TextureAlgorithm })
          }
        >
          {textureAlgorithms.map((algorithm) => (
            <option key={algorithm} value={algorithm}>{algorithm}</option>
          ))}
        </select>
      </div>
      <label className="field">
        <span>Scan order</span>
        <select
          value={document.scanner.scanOrder}
          onChange={(event) =>
            updateScanner({ scanOrder: event.target.value as ScanOrder })
          }
        >
          {scanOrders.map((scanOrder) => (
            <option key={scanOrder} value={scanOrder}>{scanOrder}</option>
          ))}
        </select>
      </label>
      <div className="subsection directions-subsection">
        <h3>XZ rotations to search</h3>
        <div className="direction-list" aria-label="Directions to search">
          {searchDirections.map((direction) => {
            const checked = document.scanner.directions.includes(direction)
            return (
              <label className="check-field" key={direction}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const directions = searchDirections.filter(
                      (candidate) =>
                        candidate === direction
                          ? event.target.checked
                          : document.scanner.directions.includes(candidate),
                    ) as SearchDirection[]
                    updateScanner({ directions })
                  }}
                />
                {direction}°
              </label>
            )
          })}
        </div>
        <p className="field-help">
          Automatic horizontal orientation selects all four rotations. Confirming
          the horizontal orientation resets this list to 0°; extra rotations remain optional.
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
          value={document.scanner.errorTolerance}
          min={0}
          onChange={(errorTolerance) => updateScanner({ errorTolerance })}
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
          <NumberField label="CPU tile size X" value={document.scanner.cpuTileSize.x} min={1} onChange={(x) => updateScanner({ cpuTileSize: { ...document.scanner.cpuTileSize, x } })} />
          <NumberField label="CPU tile size Z" value={document.scanner.cpuTileSize.z} min={1} onChange={(z) => updateScanner({ cpuTileSize: { ...document.scanner.cpuTileSize, z } })} />
          <NumberField label="CUDA tile size X" value={document.scanner.cudaTileSize.x} min={1} onChange={(x) => updateScanner({ cudaTileSize: { ...document.scanner.cudaTileSize, x } })} />
          <NumberField label="CUDA tile size Z" value={document.scanner.cudaTileSize.z} min={1} onChange={(z) => updateScanner({ cudaTileSize: { ...document.scanner.cudaTileSize, z } })} />
          <label className="check-field">
            <input type="checkbox" checked={document.scanner.verbose} onChange={(event) => updateScanner({ verbose: event.target.checked })} />
            verbose logging
          </label>
        </div>
      </details>
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
