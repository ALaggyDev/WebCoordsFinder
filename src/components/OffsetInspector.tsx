import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Check, Copy, Crosshair, Plus, Trash2 } from 'lucide-react'
import {
  offsetBasis,
  offsetFromNibbles,
  offsetProfiles,
  offsetReadiness,
  worldToLocal,
} from '../domain/blockOffsets'
import { blockCoordinateForFace, mappedAnchorOffset } from '../domain/geometry'
import { useEditorStore } from '../store/editorStore'

export function OffsetInspector() {
  const state = useEditorStore()
  const { document, selectedOffsetId, selectedEvidenceIds } = state
  const [blockId, setBlockId] = useState('short_grass')
  const [query, setQuery] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(
    () => !document.offsets?.length,
  )
  const entries = document.offsets ?? []
  const selected = entries.find((entry) => entry.id === selectedOffsetId)
  const profile = selected ? offsetProfiles[selected.blockId] : undefined
  const blocked = offsetReadiness(document)
  const basis = offsetBasis(document)
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
      <p className="field-help">
        Place a decoration, align its model with the screenshot, then confirm
        its offset.
      </p>
      <div className="offset-notice">
        Measurements are saved in your project. Browser search and native
        CoordsFinder export currently use texture evidence only.
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
      <details
        className="offset-add"
        open={catalogOpen}
        onToggle={(event) => setCatalogOpen(event.currentTarget.open)}
      >
        <summary>
          <Plus size={15} />
          Add decoration
        </summary>
        <fieldset disabled={Boolean(blocked)} className="offset-controls">
          <svg className="offset-catalog-filter" aria-hidden="true">
            <filter id="offset-catalog-grass-tint" colorInterpolationFilters="sRGB">
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
                      Object.values(p.variants[0].parts[0].elements[0].faces)[0]
                        .texture
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
      </details>
      {entries.length > 0 && (
        <>
          <h3>Observations</h3>
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
                  {!blocked && entry.confirmedBasis === basis
                    ? 'Confirmed'
                    : entry.confirmedBasis
                      ? 'Review again'
                      : 'Draft'}
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
            <h3>{profile.label}</h3>
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
            {profile.type === 'XYZ' && (
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
            )}
            {profile.type === 'XYZ' && (
              <p className="field-help">
                Y occlusion hides the part shifted below the owning block, as
                the supporting block would in the screenshot.
              </p>
            )}
            <div className="offset-mode" aria-label="Drag behavior">
              <button
                type="button"
                className={state.offsetDragMode === 'block' ? 'selected' : ''}
                aria-pressed={state.offsetDragMode === 'block'}
                onClick={() => state.setOffsetDragMode('block')}
              >
                Move block
              </button>
              <button
                type="button"
                className={state.offsetDragMode === 'offset' ? 'selected' : ''}
                aria-pressed={state.offsetDragMode === 'offset'}
                onClick={() => state.setOffsetDragMode('offset')}
              >
                Fit offset
              </button>
            </div>
            <p className="field-help">
              {state.offsetDragMode === 'block'
                ? 'Drag the circular base handle to move by whole blocks in X/Z. Use Y below for height.'
                : 'Drag the base handle to fit X/Z, snapping to possible game offsets. Adjust Y below for XYZ blocks.'}
            </p>
            <h4>Block position</h4>
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
            <p className="field-help">
              {anchorOffset
                ? `From anchor: X ${anchorOffset.x}, Y ${anchorOffset.y}, Z ${anchorOffset.z}`
                : 'Set an anchor in Geometry to see relative world coordinates.'}
            </p>
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
                const progress = clamped
                  ? 25 + ((value - min) / (max - min)) * 50
                  : ((value - min) / (max - min)) * 100
                return (
                  <label className="offset-slider" key={axis}>
                    <span>
                      {axis.toUpperCase()}{' '}
                      <small>seed {value} / 15</small>
                    </span>
                    <output>{offset[axis].toFixed(4)} blocks</output>
                    <div
                      className={`offset-slider-track${clamped ? ' clamped' : ''}`}
                      style={
                        {
                          '--offset-progress': `${progress}%`,
                        } as CSSProperties
                      }
                    >
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
                    </div>
                  </label>
                )
              })}
            {profile.horizontal === 0.125 && (
              <p className="field-help">
                Dripstone clamps at ±0.125 blocks. The muted ends show clipped
                seed values; the slider stops at the equivalent endpoints.
              </p>
            )}
            {profile.variants[selected.modelIndex].parts.some((part) =>
              part.elements.some((element) =>
                Object.values(element.faces).some(
                  (face) => face.tintindex !== undefined,
                ),
              ),
            ) && (
              <label className="offset-tint">
                Foliage tint
                <input
                  type="color"
                  value={selected.tint}
                  onChange={(e) =>
                    state.updateOffset(selected.id, { tint: e.target.value })
                  }
                />
              </label>
            )}
            <button
              type="button"
              className="primary-button full"
              disabled={selected.confirmedBasis === basis}
              onClick={() => state.confirmOffset(selected.id)}
            >
              <Check size={15} />
              {selected.confirmedBasis === basis
                ? 'Offset confirmed'
                : 'Confirm alignment'}
            </button>
            <button
              type="button"
              className="secondary-button full"
              onClick={() =>
                state.addOffset({
                  ...selected,
                  id: crypto.randomUUID(),
                  confirmedBasis: undefined,
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
            Delete observation
          </button>
        </>
      )}
      <details className="advanced-settings">
        <summary>About these models</summary>
        <p className="field-help">
          Bundled from the supplied Minecraft 1.21.11 resources. Golden
          dandelion is unavailable in that asset set. Models are alignment
          overlays; lighting, water, and general scene occlusion are not
          simulated. Y occlusion can approximate the supporting block for XYZ
          offsets. Offset matching is manual.
        </p>
      </details>
    </div>
  )
}
