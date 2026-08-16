import {
  Box,
  Compass,
  Crosshair,
  Eraser,
  Move3d,
  Redo2,
  Undo2,
} from 'lucide-react'
import type { EditorTool } from '../domain/types'
import {
  isWorldUpResolved,
  sceneLatticeParity,
} from '../domain/geometry'
import { useEditorStore } from '../store/editorStore'

// Tool definitions share the visible shortcut labels; global key handling
// lives in App so shortcuts also work when the canvas lacks focus.
const tools: Array<{ id: EditorTool; label: string; icon: typeof Crosshair; shortcut: string }> = [
  { id: 'anchor', label: 'Select anchor block', icon: Crosshair, shortcut: 'A' },
  { id: 'plane', label: 'Draw initial grid', icon: Box, shortcut: 'G' },
  { id: 'extrude', label: 'Extrude selected edges', icon: Move3d, shortcut: 'E' },
]

export function ToolRail() {
  const tool = useEditorStore((state) => state.tool)
  const scene = useEditorStore((state) => state.document.scene)
  const setTool = useEditorStore((state) => state.setTool)
  const startUpOrientation = useEditorStore((state) => state.startUpOrientation)
  const startHorizontalOrientation = useEditorStore(
    (state) => state.startHorizontalOrientation,
  )
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const deleteSelectedFaces = useEditorStore((state) => state.deleteSelectedFaces)
  const canUndo = useEditorStore((state) => state.past.length > 0)
  const canRedo = useEditorStore((state) => state.future.length > 0)
  const hasGeometry = useEditorStore(
    (state) => state.document.scene.projection !== null,
  )
  const hasSelectedEdges = useEditorStore((state) => state.selectedEdges.length > 0)
  const hasSelectedFaces = useEditorStore(
    (state) => state.selectedEvidenceIds.length > 0,
  )

  return (
    <aside className="tool-rail" aria-label="Canvas tools">
      <div className="tool-group">
        {tools.map(({ id, label, icon: Icon, shortcut }) => (
          <button
            key={id}
            type="button"
            className={tool === id ? 'tool-button active' : 'tool-button'}
            onClick={() => setTool(id)}
            disabled={
              // Only one base grid is allowed, and extrusion needs an explicit
              // connected edge selection.
              (id === 'plane' && hasGeometry) ||
              (id === 'anchor' && !hasGeometry) ||
              (id === 'extrude' && !hasSelectedEdges)
            }
            title={`${label} (${shortcut})`}
            aria-label={label}
          >
            <Icon size={19} />
            <span>{shortcut}</span>
          </button>
        ))}
        {scene.projection && (
          <button
            type="button"
            className={tool === 'orient' ? 'tool-button active' : 'tool-button'}
            onClick={() => {
              if (
                isWorldUpResolved(scene.axisMapping) &&
                sceneLatticeParity(scene) !== undefined
              ) {
                startHorizontalOrientation()
              } else {
                startUpOrientation()
              }
            }}
            title="Set World Orientation (D)"
            aria-label="Set World Orientation"
          >
            <Compass size={19} />
            <span>D</span>
          </button>
        )}
        <button
          type="button"
          className="tool-button"
          onClick={deleteSelectedFaces}
          disabled={!hasSelectedFaces}
          title="Delete selected faces (X / Backspace / Delete)"
          aria-label="Delete selected faces"
        >
          <Eraser size={19} />
          <span>X</span>
        </button>
      </div>
      <div className="tool-group bottom">
        <button
          type="button"
          className="tool-button"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Undo2 size={19} />
        </button>
        <button
          type="button"
          className="tool-button"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
        >
          <Redo2 size={19} />
        </button>
      </div>
    </aside>
  )
}
