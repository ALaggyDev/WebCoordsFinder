import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, LoaderCircle, RotateCcw, ScanSearch, Search } from 'lucide-react'
import type { AutoAnalyzeRequest, AutoAnalyzeResponse } from '../domain/analysisProtocol'
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
 * N/E/S/W matching as an alternative to horizontal arrows.
 * High-confidence matches apply directly; unclear matches leave the choice manual.
 * Credit: PedroJuan_1610
 */
export function TextureDirectionPanel() {
  const document = useEditorStore((s) => s.document)
  const selectedIds = useEditorStore((s) => s.selectedEvidenceIds)
  const lockTextureDirection = useEditorStore((s) => s.lockTextureDirection)
  const clearTextureDirection = useEditorStore((s) => s.clearTextureDirection)
  const compassSource = useEditorStore((s) => s.document.scanner.compassSource)
  const textureDirection = useEditorStore((s) => s.document.scanner.textureDirection)

  const [texture, setTexture] = useState(DEFAULT_TEXTURE)
  const [query, setQuery] = useState('')
  const picker = useRef<HTMLDetailsElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [noMatch, setNoMatch] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
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

  function closePicker(restoreFocus = false) {
    if (!picker.current) return
    picker.current.open = false
    setPickerOpen(false)
    setQuery('')
    if (restoreFocus) picker.current.querySelector('summary')?.focus()
  }

  useEffect(() => {
    if (!pickerOpen) return
    searchInput.current?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) closePicker()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closePicker(true)
      }
    }
    window.document.addEventListener('pointerdown', dismiss)
    window.document.addEventListener('keydown', escape)
    return () => {
      window.document.removeEventListener('pointerdown', dismiss)
      window.document.removeEventListener('keydown', escape)
    }
  }, [pickerOpen])

  useEffect(() => {
    // A new face, calibration, or texture invalidates pending work and analysis.
    setNoMatch(false)
    setAnalysisError(null)
    setAnalyzing(false)
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [document.image.src, document.scene, evidence, texture])

  function autoAnalyze() {
    const quad = meshFace ? directionMatchFaceQuad(document.scene, meshFace) : undefined
    if (!evidence || !quad) return
    setNoMatch(false)
    setAnalysisError(null)
    setAnalyzing(true)
    try {
      const worker = new Worker(new URL('../workers/analyze.worker.ts', import.meta.url), {
        type: 'module',
      })
      workerRef.current = worker
      const request: AutoAnalyzeRequest = {
        type: 'analyze',
        requestId: crypto.randomUUID(),
        sourceUrl: new URL(document.image.src, globalThis.location.href).href,
        size: 96,
        jobs: [{
          evidenceId: evidence.id,
          quad,
          referenceUrl: remoteBlockTextureUrl(texture),
          transforms: ['identity', 'rotate90', 'rotate180', 'rotate270'],
        }],
      }
      const finish = () => {
        worker.terminate()
        workerRef.current = null
        setAnalyzing(false)
      }
      worker.onmessage = (event: MessageEvent<AutoAnalyzeResponse>) => {
        if (workerRef.current !== worker || event.data.requestId !== request.requestId) return
        if (event.data.type === 'error') {
          setAnalysisError(event.data.error ?? 'Unable to analyze this texture.')
          finish()
          return
        }
        const result = event.data.results[0]
        const rotation = result ? DIRECTION_ROTATIONS[result.scores[0]?.variant] : undefined
        finish()
        if (result && rotation !== undefined && result.confidence > 0 &&
          result.confidence >= document.scanner.confidenceThreshold) {
          lockDirection(rotation)
        } else {
          setNoMatch(true)
        }
      }
      worker.onerror = () => {
        if (workerRef.current !== worker) return
        setAnalysisError('Unable to analyze this texture. Try again or choose a direction manually.')
        finish()
      }
      worker.postMessage(request)
    } catch {
      workerRef.current?.terminate()
      workerRef.current = null
      setAnalyzing(false)
      setAnalysisError('Unable to start Auto Analyze. Choose a direction manually.')
    }
  }

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
      {selectedEvidence.length === 0 && (
        <div className="orientation-empty">
          <p>
            Select one top or bottom face on the canvas.
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
          <p>Select a top or bottom face. Side textures cannot establish compass direction here.</p>
        </div>
      )}
      {canMatch && (
        <>
          <div className="field block-profile-field">
            <div className="block-profile-heading">
              <span className="field-label">Block texture · {faceKind}</span>
              <a
                className="texture-direction-link"
                href={`https://mcasset.cloud/${MC_ASSETS_VERSION}/assets/minecraft/textures/block/${texture}`}
                target="_blank"
                rel="noreferrer"
              >
                View source ↗
              </a>
            </div>
            <details
              className="direction-texture-picker"
              ref={picker}
              onToggle={(event) => setPickerOpen(event.currentTarget.open)}
            >
              <summary aria-label={`Block texture: ${textureDisplayName(texture)}`}>
                <img src={textureUrl} alt="" />
                <span>{textureDisplayName(texture)}</span>
                <ChevronDown size={14} />
              </summary>
              {pickerOpen && (
                <div className="direction-texture-popup">
                  <div className="direction-texture-search">
                    <Search size={14} aria-hidden="true" />
                    <input
                      ref={searchInput}
                      type="search"
                      aria-label="Filter block textures"
                      placeholder="Filter textures…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div className="direction-texture-options" role="group" aria-label="Block textures">
                    {results.map((file) => (
                      <button
                        key={file}
                        type="button"
                        aria-pressed={texture === file}
                        onClick={() => {
                          setTexture(file)
                          closePicker(true)
                        }}
                      >
                        {textureDisplayName(file)}
                      </button>
                    ))}
                    {results.length === 0 && (
                      <p role="status">{textureIndex ? 'No matching textures.' : loadError ?? 'Loading textures…'}</p>
                    )}
                  </div>
                </div>
              )}
            </details>
            {loadError && <p className="calibration-error">{loadError}</p>}
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
              <span className="face-preview-label">Selected face</span>
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
                  ? 'Reference · North ↑'
                  : `Confirmed · ${searchDirectionLabel(lockedRotation)}`}
              </span>
            </div>
          </div>
          <div className="texture-direction-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={autoAnalyze}
              disabled={analyzing || cropStatus !== 'ready'}
            >
              {analyzing ? <LoaderCircle size={14} className="spin" /> : <ScanSearch size={14} />}
              {analyzing ? 'Analyzing…' : 'Auto Analyze'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={clearTextureDirection}
              disabled={lockedRotation === null}
            >
              <RotateCcw size={14} /> Clear
            </button>
          </div>
          <p className="orientation-help" role="status">
            {noMatch
              ? 'No clear match found. Compare the textures manually.'
              : lockedRotation !== null
                ? `Selected: ${searchDirectionLabel(lockedRotation)}. Choose another tile to change it.`
                : 'Choose the matching direction below, or use Auto Analyze to select a confident match.'}
          </p>
          {analysisError && <p className="calibration-error" role="alert">{analysisError}</p>}
          <div className="candidate-section">
            <h5>Choose matching direction</h5>
            <div className="candidate-grid">
              {DIRECTION_ROTATIONS.map((deg) => (
                <button
                  type="button"
                  key={deg}
                  aria-pressed={lockedRotation === deg}
                  className={lockedRotation === deg ? 'candidate active' : 'candidate'}
                  aria-label={searchDirectionLabel(deg)}
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
                    {searchDirectionLabel(deg)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
