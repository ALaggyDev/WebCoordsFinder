import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlipHorizontal2, LoaderCircle, RotateCcw } from 'lucide-react'
import {
  DIRECTION_ROTATIONS,
  FACE_TEXTURE_INDEX_URL,
  MC_ASSETS_VERSION,
  faceKindForDirection,
  filterBlockTextures,
  remoteBlockTextureUrl,
  searchDirectionLabel,
  textureDisplayName,
  texturesForFaceKind,
  type DirectionTextureRotation,
  type FaceTextureIndex,
} from '../domain/directionBlocks'
import {
  directionMatchFaceQuad,
  faceForLocalNormal,
  isWorldUpResolved,
} from '../domain/geometry'
import { imageDataUrl, warpQuad } from '../domain/imageAnalysis'
import { useEditorStore } from '../store/editorStore'

const DEFAULT_TEXTURE = 'crafting_table_top.png'

/**
 * Manual N/E/S/W lock from a fixed top/bottom block texture.
 * Lives under Geometry → World Orientation (step 3).
 * Credit: PedroJuan_1610
 */
export function TextureDirectionPanel() {
  const document = useEditorStore((s) => s.document)
  const selectedIds = useEditorStore((s) => s.selectedEvidenceIds)
  const lockTextureDirection = useEditorStore((s) => s.lockTextureDirection)
  const clearTextureDirection = useEditorStore((s) => s.clearTextureDirection)
  const flipSelectedFaces = useEditorStore((s) => s.flipSelectedFaces)
  const compassSource = useEditorStore((s) => s.document.scanner.compassSource)
  const textureDirection = useEditorStore((s) => s.document.scanner.textureDirection)

  const [texture, setTexture] = useState(DEFAULT_TEXTURE)
  const [query, setQuery] = useState('')
  const [textureIndex, setTextureIndex] = useState<FaceTextureIndex | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cropUrl, setCropUrl] = useState('')
  const [cropStatus, setCropStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unresolved' | 'error'
  >('idle')

  const lockedRotation: DirectionTextureRotation | null =
    compassSource === 'texture' && textureDirection !== null && textureDirection !== undefined
      ? (textureDirection as DirectionTextureRotation)
      : null

  const selectedEvidence = useMemo(
    () => document.evidence.filter((entry) => selectedIds.includes(entry.id)),
    [document.evidence, selectedIds],
  )
  const evidence = selectedEvidence.length === 1 ? selectedEvidence[0] : undefined
  const meshFace = evidence
    ? document.scene.faces.find((face) => face.id === evidence.faceId)
    : undefined
  const worldReady = Boolean(meshFace) && isWorldUpResolved(document.scene.axisMapping)

  const faceKind = useMemo(() => {
    if (!evidence) return undefined
    return faceKindForDirection(
      faceForLocalNormal(document.scene.axisMapping, evidence.localNormal),
    )
  }, [document.scene.axisMapping, evidence])

  const lockDirection = useCallback(
    (rotation: DirectionTextureRotation) => {
      lockTextureDirection(rotation, faceKind === 'bottom' ? 'bottom' : 'top')
    },
    [faceKind, lockTextureDirection],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(FACE_TEXTURE_INDEX_URL)
        if (!response.ok) throw new Error(`Could not load texture index (${response.status})`)
        const data = (await response.json()) as FaceTextureIndex
        if (!cancelled) {
          setTextureIndex(data)
          setLoadError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load texture list')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let active = true
    if (!evidence || !meshFace) {
      setCropUrl('')
      setCropStatus('idle')
      return
    }
    if (!worldReady) {
      setCropUrl('')
      setCropStatus('unresolved')
      return
    }
    const quad = directionMatchFaceQuad(document.scene, meshFace)
    if (!quad) {
      setCropUrl('')
      setCropStatus('error')
      return
    }
    setCropUrl('')
    setCropStatus('loading')
    warpQuad(document.image.src, quad, 112)
      .then((crop) => {
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
  }, [document.image.src, document.scene, evidence, meshFace, worldReady])

  const pool = useMemo(
    () => (textureIndex ? texturesForFaceKind(textureIndex, faceKind) : []),
    [faceKind, textureIndex],
  )
  const results = useMemo(
    () =>
      query.trim()
        ? filterBlockTextures(pool, query, pool.length)
        : [...pool].sort((a, b) => a.localeCompare(b)),
    [pool, query],
  )

  useEffect(() => {
    if (pool.length === 0 || pool.includes(texture)) return
    const [first] = [...pool].sort((a, b) => a.localeCompare(b))
    if (first) setTexture(first)
  }, [pool, texture])

  const textureUrl = remoteBlockTextureUrl(texture)
  const sideOnly = faceKind === 'side'
  const canMatch = Boolean(evidence) && !sideOnly && selectedEvidence.length === 1

  return (
    <div className="texture-direction-panel">
      {!evidence && (
        <div className="orientation-empty">
          <p>
            Select a top or bottom face with a fixed texture. The top edge of the
            texture image is North.
          </p>
        </div>
      )}
      {selectedEvidence.length > 1 && (
        <div className="orientation-empty">
          <p>Select a single face to match texture direction.</p>
        </div>
      )}
      {evidence && sideOnly && (
        <div className="orientation-empty">
          <p>Use a top or bottom face, or flip the visible side.</p>
          <button type="button" className="secondary-button full" onClick={flipSelectedFaces}>
            <FlipHorizontal2 size={15} /> Flip visible side
          </button>
        </div>
      )}
      {canMatch && (
        <>
          <div className="evidence-meta">
            <span>{faceKind === 'top' ? 'Top (+Y)' : faceKind === 'bottom' ? 'Bottom (−Y)' : 'Face'}</span>
            <span>4-state</span>
            <span className={`status-dot ${lockedRotation === null ? 'unlabeled' : 'confirmed'}`}>
              {lockedRotation === null ? 'unlabeled' : 'confirmed'}
            </span>
          </div>
          <div className="face-preview-row">
            <div className="face-preview-item">
              <div className="face-preview">
                {cropStatus === 'ready' && cropUrl ? (
                  <img src={cropUrl} alt="Unwarped face" />
                ) : cropStatus === 'loading' ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <div className="reference-unavailable" role="status">
                    {cropStatus === 'unresolved' ? 'Determine world UP first' : 'Unable to unwarp'}
                  </div>
                )}
              </div>
              <span className="face-preview-label">Unwarped · world-aligned</span>
            </div>
            <div className="face-preview-item">
              <div className="face-preview reference">
                <img
                  src={textureUrl}
                  alt={textureDisplayName(texture)}
                  style={
                    lockedRotation === null
                      ? undefined
                      : { transform: `rotate(${lockedRotation}deg)` }
                  }
                />
              </div>
              <span className="face-preview-label">
                {lockedRotation === null
                  ? 'No variant selected'
                  : `Variant ${lockedRotation / 90} · ${searchDirectionLabel(lockedRotation)}`}
              </span>
            </div>
          </div>
          <div className="field block-profile-field">
            <div className="block-profile-heading">
              <label htmlFor="geometry-direction-texture">
                Block texture{faceKind ? ` · ${faceKind}` : ''}
              </label>
              <a
                className="texture-direction-link"
                href={`https://mcasset.cloud/${MC_ASSETS_VERSION}/assets/minecraft/textures/block/${texture}`}
                target="_blank"
                rel="noreferrer"
              >
                mcasset.cloud
              </a>
            </div>
            <select
              id="geometry-direction-texture"
              value={texture}
              onChange={(event) => setTexture(event.target.value)}
            >
              {!results.includes(texture) && (
                <option value={texture}>{textureDisplayName(texture)}</option>
              )}
              {results.map((file) => (
                <option key={file} value={file}>
                  {textureDisplayName(file)}
                </option>
              ))}
            </select>
            <input
              type="search"
              aria-label="Filter block textures"
              placeholder="Filter textures…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {loadError && <p className="calibration-error">{loadError}</p>}
          </div>
          <div className="candidate-section">
            <h3>Visible direction</h3>
            <div className="candidate-grid">
              {DIRECTION_ROTATIONS.map((deg) => (
                <button
                  type="button"
                  key={deg}
                  aria-pressed={lockedRotation === deg}
                  className={lockedRotation === deg ? 'candidate active' : 'candidate'}
                  title={searchDirectionLabel(deg)}
                  onClick={() => lockDirection(deg)}
                >
                  <div className="candidate-image">
                    <img
                      src={textureUrl}
                      alt=""
                      style={{ transform: `rotate(${deg}deg)` }}
                      draggable={false}
                    />
                  </div>
                  <span>
                    Variant {deg / 90} · Manual ·{' '}
                    {deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : 'W'}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="face-selection-actions">
            <div className="face-selection-action-row">
              <button type="button" className="secondary-button" onClick={flipSelectedFaces}>
                <FlipHorizontal2 size={15} /> Flip visible side
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={clearTextureDirection}
                disabled={lockedRotation === null}
              >
                <RotateCcw size={15} /> Clear direction
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
