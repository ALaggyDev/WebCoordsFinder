import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, LoaderCircle, PackageOpen, Settings, TriangleAlert, Upload } from 'lucide-react'
import { importResourcePack } from '../domain/resourcePacks'
import type { ResourcePackSettings } from '../domain/types'
import { useEditorStore } from '../store/editorStore'

const builtInPacks = [
  { id: 'vanilla', name: 'Vanilla', detail: 'Current textures', texture: '/minecraft/textures/block/stone.png' },
  { id: 'programmer-art', name: 'Programmer’s Art', detail: 'Pre-1.14 textures', texture: '/minecraft/programmer-art/textures/block/stone.png' },
] as const

/** A small block mark keeps the control recognizable without a text heading. */
function ResourcePackLogo() {
  return (
    <svg width="24" height="26" viewBox="0 0 24 26" fill="none" aria-hidden="true">
      <path d="m12 1 11 6v12l-11 6L1 19V7z" fill="#78543b" />
      <path d="m12 1 11 6-11 6L1 7z" fill="#91b563" />
      <path d="m1 7 11 6v12L1 19z" fill="#906749" />
      <path d="m1 7 11 6v5l-3-1.6v-2.3l-3-1.6v2.3l-3-1.6v-2.3L1 10z" fill="#6f934c" />
      <path d="m12 13 11-6v4l-3 1.6v2.2l-3 1.6v-2.2L12 17z" fill="#57783f" />
      <path d="m5 6 3-1.6 3 1.6L8 7.6zm8-1 3-1.6L19 5l-3 1.6z" fill="#b1cf80" />
    </svg>
  )
}

/** Project-local pack selection shared by face analysis and decoration previews. */
export function ResourcePackPicker({ busy = false }: { busy?: boolean }) {
  const pack = useEditorStore((state) => state.document.resourcePack)
  const setResourcePack = useEditorStore((state) => state.setResourcePack)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const importRequest = useRef(0)
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const base = pack?.base ?? 'vanilla'
  const baseName = builtInPacks.find((entry) => entry.id === base)!.name
  const activeName = pack?.custom?.name ?? baseName
  const disabled = busy || importing
  useEffect(() => () => { importRequest.current++ }, [])

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  function closeMenu() {
    setOpen(false)
    trigger.current?.focus()
  }

  function selectBuiltIn(nextBase: ResourcePackSettings['base']) {
    if (base !== nextBase || pack?.custom) setResourcePack({ base: nextBase })
    setError('')
    closeMenu()
  }

  function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  async function importFile(file: File) {
    const request = ++importRequest.current
    setImporting(true)
    setError('')
    try {
      const custom = await importResourcePack(file)
      if (request !== importRequest.current) return
      setResourcePack({ base, custom })
      closeMenu()
    } catch (cause) {
      if (request === importRequest.current) {
        setError(cause instanceof Error ? cause.message : 'Unable to import this resource pack.')
        setOpen(true)
      }
    } finally {
      if (request === importRequest.current) setImporting(false)
    }
  }

  return (
    <div className="resource-pack-picker" ref={root} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <button
        ref={trigger}
        type="button"
        className="resource-pack-trigger"
        aria-label={`Resource pack: ${activeName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`Resource packs · ${activeName}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {importing ? <LoaderCircle size={20} className="resource-pack-spinner" aria-hidden="true" />
          : <span className="resource-pack-logo">
              <ResourcePackLogo />
              <Settings size={11} strokeWidth={2.5} className="resource-pack-gear" aria-hidden="true" />
            </span>}
      </button>
      <input ref={input} type="file" accept=".zip,application/zip" aria-label="Import custom resource pack ZIP" hidden onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void importFile(file)
      }} />
      {open && <div ref={menu} id={menuId} className="resource-pack-menu" role="menu" aria-label="Resource packs" onKeyDown={navigateMenu}>
        <div className="resource-pack-menu-label">Resource packs</div>
        {builtInPacks.map((option) => {
          const selected = !pack?.custom && base === option.id
          return (
            <button key={option.id} type="button" role="menuitemradio" aria-checked={selected} className="resource-pack-option" disabled={disabled} onClick={() => selectBuiltIn(option.id)}>
              <img className="resource-pack-thumbnail" src={option.texture} alt="" />
              <span className="resource-pack-option-copy"><strong>{option.name}</strong><small>{option.detail}</small></span>
              {selected && <Check size={15} className="resource-pack-check" aria-hidden="true" />}
            </button>
          )
        })}
        {pack?.custom && <button type="button" role="menuitemradio" aria-checked="true" className="resource-pack-option" disabled={disabled} onClick={closeMenu}>
          <span className="resource-pack-custom-icon"><PackageOpen size={19} aria-hidden="true" /></span>
          <span className="resource-pack-option-copy"><strong>{pack.custom.name}</strong><small>Custom · {baseName} fallback</small></span>
          <Check size={15} className="resource-pack-check" aria-hidden="true" />
        </button>}
        <div className="resource-pack-custom-section">
          <button type="button" role="menuitem" className="resource-pack-import" disabled={disabled} onClick={() => input.current?.click()}>
            {importing ? <LoaderCircle size={15} className="resource-pack-spinner" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
            <span>{importing ? 'Importing…' : pack?.custom ? 'Replace custom pack…' : 'Import custom pack…'}</span>
            <span className="resource-pack-badge">ZIP</span>
          </button>
          <p className="resource-pack-warning"><TriangleAlert size={13} aria-hidden="true" /><span>Custom packs are experimental and won't work on some packs. Blockstates and models are not loaded.</span></p>
        </div>
        {error && <p className="resource-pack-error" role="alert">{error}</p>}
      </div>}
    </div>
  )
}
