import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Copy,
  Crosshair,
  Info,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import {
  offsetFromNibbles,
  offsetProfiles,
  offsetReadiness,
  worldToLocal,
} from '../domain/blockOffsets'
import { blockCoordinateForFace, mappedAnchorOffset } from '../domain/geometry'
import { grassTintColor } from '../domain/imageAnalysis'
import { defaultGrassTintSettings } from '../domain/types'
import { animationCycleTicks } from '../domain/textureAnimation'
import { useEditorStore } from '../store/editorStore'
import { GrassTintPicker } from './GrassTintPicker'

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="info-tip" tabIndex={0} aria-label={label}>
      <Info size={14} aria-hidden="true" />
      <div className="info-tip-content" role="tooltip">{children}</div>
    </div>
  )
}

function supportsGrassTint(profile: (typeof offsetProfiles)[string]) {
  return profile.variants.some((variant) =>
    variant.parts.some((part) =>
      part.elements.some((element) =>
        Object.values(element.faces).some(
          (face) => face.tintindex !== undefined,
        ),
      ),
    ),
  )
}

function profileTextureSources(profile: (typeof offsetProfiles)[string]) {
  return profile.variants.flatMap((variant) =>
    variant.parts.flatMap((part) =>
      part.elements.flatMap((element) =>
        Object.values(element.faces).map((face) => face.texture),
      ),
    ),
  )
}

function rgbToHex(color: { red: number; green: number; blue: number }) {
  return `#${[color.red, color.green, color.blue]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

export function OffsetInspector() {
  const state = useEditorStore()
  const { document, selectedOffsetId, selectedEvidenceIds } = state
  const [blockId, setBlockId] = useState('short_grass')
  const [query, setQuery] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const tintRequestRef = useRef(0)
  const entries = document.offsets ?? []
  const selected = entries.find((entry) => entry.id === selectedOffsetId)
  const profile = selected ? offsetProfiles[selected.blockId] : undefined
  const animationCycle = profile
    ? animationCycleTicks(profileTextureSources(profile))
    : undefined
  const storedAnimationTick = selected
    ? document.animationTicks?.[selected.blockId] ?? 1
    : 1
  const animationTick = animationCycle
    ? ((storedAnimationTick - 1) % animationCycle) + 1
    : storedAnimationTick
  const blocked = offsetReadiness(document)
  const face = document.scene.faces.find(
    (face) => face.id === selectedEvidenceIds[0],
  )
  const offset =
    selected && profile
      ? offsetFromNibbles(profile, selected.nibbles)
      : undefined
  const anchorOffset = selected
    ? mappedAnchorOffset(
        document.scene,
        document.anchorFaceId,
        selected.position,
      )
    : undefined
  const grassTint = selected?.grassTint ?? defaultGrassTintSettings
  const grassTintIsDefault =
    grassTint.temperature === defaultGrassTintSettings.temperature &&
    grassTint.downfall === defaultGrassTintSettings.downfall

  useEffect(() => {
    if (!catalogOpen && !settingsOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        addButtonRef.current?.contains(target) ||
        addMenuRef.current?.contains(target) ||
        settingsButtonRef.current?.contains(target) ||
        settingsMenuRef.current?.contains(target)
      ) return
      setCatalogOpen(false)
      setSettingsOpen(false)
    }
    globalThis.document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () =>
      globalThis.document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [catalogOpen, settingsOpen])

  useEffect(() => setSettingsOpen(false), [selectedOffsetId])

  async function updateGrassTint(temperature: number, downfall: number) {
    if (!selected) return
    const request = ++tintRequestRef.current
    const settings = { temperature, downfall }
    const color = await grassTintColor(settings)
    if (request !== tintRequestRef.current) return
    state.updateOffset(selected.id, {
      grassTint: settings,
      tint: rgbToHex(color),
    })
  }

  function add() {
    if (!face || blocked) return
    const owner = blockCoordinateForFace(face)
    // Place in the adjacent block on the visible side. Works for ground,
    // ceilings, and side faces without guessing a world-up direction.
    state.addOffset({
      id: crypto.randomUUID(),
      blockId,
      modelIndex: 0,
      position: {
        x: owner.x + face.normal.x,
        y: owner.y + face.normal.y,
        z: owner.z + face.normal.z,
      },
      nibbles: {
        x: 7,
        y: offsetProfiles[blockId].type === 'XYZ' ? 15 : 0,
        z: 7,
      },
      tint: '#91bd59',
      grassTint: { ...defaultGrassTintSettings },
    })
    setCatalogOpen(false)
  }
  function move(axis: 'x' | 'y' | 'z', amount: number) {
    if (!selected) return
    const delta = worldToLocal(document.scene, {
      x: axis === 'x' ? amount : 0,
      y: axis === 'y' ? amount : 0,
      z: axis === 'z' ? amount : 0,
    })
    state.updateOffset(selected.id, {
      position: {
        x: selected.position.x + delta.x,
        y: selected.position.y + delta.y,
        z: selected.position.z + delta.z,
      },
    })
  }

  return (
    <div className="offset-inspector">
      <div className="section-title">
        <Crosshair size={18} />
        <h2>Block offsets</h2>
        <span className="offset-badge">{entries.length}</span>
      </div>
      <div className="offset-intro">
        <p className="field-help">
          Place a decoration and align its model with the screenshot.
        </p>
        <InfoTip label="What are block offsets?">
          <strong>What are block offsets?</strong>
          <p>
            Block offsets (a.k.a. grass offsets) are the random placement offsets
            of decorations such as grass, flowers and dripstones. Similar to
            texture rotations, block offsets can also be used to crack coordinates.
          </p>
          <p>
            For workflows only related to texture rotations, you may simply skip
            this tab.
          </p>
        </InfoTip>
      </div>
      {blocked && (
        <div className="offset-prerequisites">
          <p>{blocked}</p>
          <button
            className="secondary-button"
            onClick={() => state.setStep('grid')}
          >
            Open Geometry
          </button>
        </div>
      )}
      <div className="offset-observations-heading">
        <h3>Decorations</h3>
        <button
          ref={addButtonRef}
          type="button"
          className={
            catalogOpen
              ? 'offset-popup-button active'
              : 'offset-popup-button'
          }
          aria-expanded={catalogOpen}
          aria-haspopup="dialog"
          onClick={() => {
            setSettingsOpen(false)
            setCatalogOpen((open) => !open)
          }}
        >
          <Plus size={14} /> Add decoration
        </button>
        {catalogOpen && (
          <div
            ref={addMenuRef}
            className="offset-popup offset-add-popup"
            role="dialog"
            aria-label="Add decoration"
          >
            <fieldset disabled={Boolean(blocked)} className="offset-controls">
              <svg className="offset-catalog-filter" aria-hidden="true">
                <filter
                  id="offset-catalog-grass-tint"
                  colorInterpolationFilters="sRGB"
                >
                  <feComponentTransfer>
                    <feFuncR type="linear" slope="0.568627" />
                    <feFuncG type="linear" slope="0.741176" />
                    <feFuncB type="linear" slope="0.349020" />
                  </feComponentTransfer>
                </filter>
              </svg>
              <label>
                Find a block
                <input
                  type="search"
                  value={query}
                  placeholder="Grass, flowers, dripstone…"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="offset-catalog" aria-label="Decoration blocks">
                {Object.entries(offsetProfiles)
                  .filter(([, p]) =>
                    p.label.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map(([id, p]) => (
                    <button
                      key={id}
                      type="button"
                      className={id === blockId ? 'selected' : ''}
                      aria-pressed={id === blockId}
                      onClick={() => setBlockId(id)}
                    >
                      <img
                        alt=""
                        className={
                          Object.values(
                            p.variants[0].parts[0].elements[0].faces,
                          )[0].tintindex === undefined
                            ? undefined
                            : 'grass-tinted'
                        }
                        src={
                          Object.values(
                            p.variants[0].parts[0].elements[0].faces,
                          )[0].texture
                        }
                      />
                      <span>{p.label}</span>
                      <small>{p.type}</small>
                    </button>
                  ))}
                {!Object.values(offsetProfiles).some((p) =>
                  p.label.toLowerCase().includes(query.toLowerCase()),
                ) && <p className="field-help">No matching bundled blocks.</p>}
              </div>
              <button
                type="button"
                className="primary-button full"
                disabled={!face}
                onClick={add}
              >
                <Plus size={15} />
                Add {offsetProfiles[blockId].label}
              </button>
              <p className="field-help">
                {face
                  ? 'Adds beside the selected face. Drag the base handle to reposition.'
                  : 'Select a supporting mesh face in the screenshot to place a block.'}
              </p>
            </fieldset>
          </div>
        )}
      </div>
      {entries.length > 0 && (
        <>
          <div className="offset-observations">
            {entries.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === selectedOffsetId ? 'selected' : ''}
                onClick={() => {
                  state.selectOffset(entry.id)
                  setCatalogOpen(false)
                }}
              >
                <span>
                  {index + 1}. {offsetProfiles[entry.blockId].label}
                </span>
                <small>
                  {entry.ignored ? 'Ignored' : 'Active'}
                </small>
              </button>
            ))}
          </div>
          <label className="offset-opacity">
            Model opacity{' '}
            <output>{Math.round(state.offsetOpacity * 100)}%</output>
            <input
              aria-label="Model opacity"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={state.offsetOpacity}
              onChange={(e) => state.setOffsetOpacity(Number(e.target.value))}
            />
          </label>
        </>
      )}
      {selected && profile && offset && (
        <>
          <fieldset
            disabled={Boolean(blocked)}
            className="offset-controls offset-selection"
          >
            <div className="offset-selection-heading">
              <h3>{profile.label}</h3>
              <InfoTip label="Drag handle information">
                <div className="offset-tip-section">
                  <strong>Handle</strong>
                  <p>Drag the base handle to move the block model.</p>
                  <div className="offset-tip-shortcut">
                    <kbd>Shift</kbd>
                    <span>Move vertically</span>
                  </div>
                  <div className="offset-tip-shortcut">
                    <kbd>Ctrl</kbd>
                    <span>Move across blocks</span>
                  </div>
                </div>
                <div className="offset-tip-section">
                  <strong>{profile.label}</strong>
                  <dl className="offset-tip-properties">
                    <div><dt>Type:</dt><dd>{profile.type}</dd></div>
                    <div>
                      <dt>XZ Clipped:</dt>
                      <dd>{profile.horizontal < 0.25 ? `±${profile.horizontal}` : 'No'}</dd>
                    </div>
                    <div>
                      <dt>Y Scaled:</dt>
                      <dd>{profile.vertical > 0 ? profile.vertical : 'No'}</dd>
                    </div>
                  </dl>
                </div>
              </InfoTip>
              <button
                ref={settingsButtonRef}
                type="button"
                className={
                  settingsOpen
                    ? 'profile-settings-button active'
                    : 'profile-settings-button'
                }
                aria-label="Decoration settings"
                aria-expanded={settingsOpen}
                onClick={() => {
                  setCatalogOpen(false)
                  setSettingsOpen((open) => !open)
                }}
              >
                <SlidersHorizontal size={15} />
              </button>
              {settingsOpen && (
                <div
                  ref={settingsMenuRef}
                  className="offset-popup offset-settings-popup"
                  role="dialog"
                  aria-label="Decoration settings controls"
                >
                  <label>
                    Model / block state
                    <select
                      value={selected.modelIndex}
                      onChange={(e) =>
                        state.updateOffset(selected.id, {
                          modelIndex: Number(e.target.value),
                        })
                      }
                    >
                      {profile.variants.map((variant, index) => (
                        <option value={index} key={index}>
                          {variant.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {animationCycle !== undefined && (
                    <label className="range-field">
                      <span>
                        Animation time{' '}
                        <output>{animationTick} / {animationCycle} ticks</output>
                      </span>
                      <input
                        type="range"
                        aria-label="Animation time"
                        min="1"
                        max={animationCycle}
                        step="1"
                        value={animationTick}
                        onChange={(event) =>
                          state.setAnimationTick(
                            selected.blockId,
                            Number(event.target.value),
                          )
                        }
                      />
                    </label>
                  )}
                  {profile.type === 'XYZ' && (
                    <>
                      <button
                        type="button"
                        className={`secondary-button full${state.offsetYOcclusion ? ' selected' : ''}`}
                        aria-pressed={state.offsetYOcclusion}
                        onClick={() =>
                          state.setOffsetYOcclusion(!state.offsetYOcclusion)
                        }
                      >
                        Y occlusion
                      </button>
                    </>
                  )}
                  {supportsGrassTint(profile) && (
                    <>
                      <div className="block-settings-menu-header">
                        <div className="block-settings-title">Grass tint</div>
                        <button
                          type="button"
                          className="reset-tint-button"
                          disabled={grassTintIsDefault}
                          onClick={() =>
                            updateGrassTint(
                              defaultGrassTintSettings.temperature,
                              defaultGrassTintSettings.downfall,
                            )
                          }
                        >
                          <RotateCcw size={12} /> Reset
                        </button>
                      </div>
                      <GrassTintPicker
                        value={grassTint}
                        onChange={(value) => updateGrassTint(value.temperature, value.downfall)}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="offset-position-heading">
              <h4>
                Block position{anchorOffset && (
                  <span> ({anchorOffset.x}, {anchorOffset.y}, {anchorOffset.z})</span>
                )}
              </h4>
            </div>
            <div className="offset-nudges">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <div key={axis}>
                  <span>{axis.toUpperCase()}</span>
                  <button
                    type="button"
                    aria-label={`Move ${axis.toUpperCase()} minus one block`}
                    onClick={() => move(axis, -1)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${axis.toUpperCase()} plus one block`}
                    onClick={() => move(axis, 1)}
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
            <h4>Offset within block</h4>
            {(['x', 'y', 'z'] as const)
              .filter((axis) => axis !== 'y' || profile.type === 'XYZ')
              .map((axis) => {
                const clamped = axis !== 'y' && profile.horizontal === 0.125
                // Seeds 3 and 12 are the first discrete values that reach the
                // clipped endpoints. The remaining outer seeds are duplicates.
                const min = clamped ? 3 : 0
                const max = clamped ? 12 : 15
                const value = Math.max(
                  min,
                  Math.min(max, selected.nibbles[axis]),
                )
                return (
                  <label className="offset-slider" key={axis}>
                    <span>
                      {axis.toUpperCase()}{' '}
                      <small>seed {value} / 15</small>
                    </span>
                    <output>{offset[axis].toFixed(4)} blocks</output>
                    <input
                      aria-label={`${axis.toUpperCase()} offset seed`}
                      type="range"
                      min={min}
                      max={max}
                      step="1"
                      value={value}
                      onChange={(e) =>
                        state.updateOffset(selected.id, {
                          nibbles: {
                            ...selected.nibbles,
                            [axis]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                )
              })}
            <button
              type="button"
              className="secondary-button full"
              aria-pressed={Boolean(selected.ignored)}
              onClick={() => state.updateOffset(selected.id, { ignored: !selected.ignored })}
            >
              {selected.ignored ? 'Use model' : 'Ignore model'}
            </button>
            <button
              type="button"
              className="secondary-button full"
              onClick={() =>
                state.addOffset({
                  ...selected,
                  id: crypto.randomUUID(),
                  confirmedBasis: undefined,
                  ignored: false,
                })
              }
            >
              <Copy size={14} />
              Duplicate for another block
            </button>
          </fieldset>
          <button
            type="button"
            className="secondary-button full"
            onClick={() => state.deleteOffset(selected.id)}
          >
            <Trash2 size={14} />
            Delete decoration
          </button>
        </>
      )}
    </div>
  )
}
