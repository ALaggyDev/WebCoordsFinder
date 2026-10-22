import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { GrassTintSettings } from '../domain/types'

type Props = {
  value: GrassTintSettings
  onChange: (value: GrassTintSettings) => void
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))

// The colormap's Y coordinate uses temperature-scaled downfall (humidity).
function grassTintFromMapPoint(x: number, y: number): GrassTintSettings {
  const mapX = clamp(x)
  const mapY = Math.max(mapX, clamp(y))
  const temperature = 1 - mapX
  return {
    temperature,
    downfall: temperature === 0 ? 1 : clamp((1 - mapY) / temperature),
  }
}

export function GrassTintPicker({ value, onChange }: Props) {
  const [draft, setDraft] = useState<GrassTintSettings | null>(null)
  const draggingPointer = useRef<number | null>(null)
  const lastCommit = useRef(0)
  const displayed = draft ?? value
  const x = clamp(1 - displayed.temperature)
  const y = clamp(1 - displayed.temperature * displayed.downfall)

  function tintAtPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return grassTintFromMapPoint(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    )
  }

  function previewAtPointer(event: PointerEvent<HTMLDivElement>, forceCommit = false) {
    const chosen = tintAtPointer(event)
    if (!chosen) return
    setDraft(chosen)
    const now = Date.now()
    // The marker follows every move; costly scene and texture updates run at most 12 times per second.
    if (forceCommit || now - lastCommit.current >= 80) {
      lastCommit.current = now
      onChange(chosen)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 / 255 : 1 / 255
    let nextX = x
    let nextY = y
    if (event.key === 'ArrowLeft') nextX -= step
    else if (event.key === 'ArrowRight') nextX += step
    else if (event.key === 'ArrowUp') nextY -= step
    else if (event.key === 'ArrowDown') nextY += step
    else return
    event.preventDefault()
    onChange(grassTintFromMapPoint(nextX, nextY))
  }

  return (
    <div className="grass-tint-picker">
      <div
        className="grass-tint-map"
        role="img"
        aria-label="Grass tint color map"
        aria-description="Click or drag to choose a grass color. Use arrow keys for fine adjustment; hold Shift for larger steps."
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          draggingPointer.current = event.pointerId
          event.currentTarget.setPointerCapture?.(event.pointerId)
          previewAtPointer(event, true)
        }}
        onPointerMove={(event) => {
          if (draggingPointer.current === event.pointerId) {
            previewAtPointer(event)
          }
        }}
        onPointerUp={(event) => {
          if (draggingPointer.current !== event.pointerId) return
          draggingPointer.current = null
          const chosen = tintAtPointer(event)
          setDraft(null)
          if (chosen) onChange(chosen)
        }}
        onPointerCancel={(event) => {
          if (draggingPointer.current !== event.pointerId) return
          draggingPointer.current = null
          setDraft(null)
        }}
        onKeyDown={handleKeyDown}
      >
        <span
          className="grass-tint-marker"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        />
      </div>
      <span className="grass-tint-picker-hint">Click or drag to pick a color</span>
    </div>
  )
}
