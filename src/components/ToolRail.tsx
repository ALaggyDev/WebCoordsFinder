import {
  Box,
  BoxSelect,
  Hand,
  MousePointer2,
  Redo2,
  Undo2,
} from 'lucide-react'
import type { EditorTool } from '../domain/types'
import { useEditorStore } from '../store/editorStore'

const tools: Array<{ id: EditorTool; label: string; icon: typeof Hand; shortcut: string }> = [
  { id: 'select', label: 'Select faces', icon: MousePointer2, shortcut: 'V' },
  { id: 'plane', label: 'Create plane', icon: Box, shortcut: 'G' },
  { id: 'face', label: 'Standalone face', icon: BoxSelect, shortcut: 'F' },
  { id: 'pan', label: 'Pan canvas', icon: Hand, shortcut: 'H' },
]

export function ToolRail() {
  const tool = useEditorStore((state) => state.tool)
  const setTool = useEditorStore((state) => state.setTool)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const canUndo = useEditorStore((state) => state.past.length > 0)
  const canRedo = useEditorStore((state) => state.future.length > 0)

  return (
    <aside className="tool-rail" aria-label="Canvas tools">
      <div className="tool-group">
        {tools.map(({ id, label, icon: Icon, shortcut }) => (
          <button
            key={id}
            type="button"
            className={tool === id ? 'tool-button active' : 'tool-button'}
            onClick={() => setTool(id)}
            title={`${label} (${shortcut})`}
            aria-label={label}
          >
            <Icon size={19} />
            <span>{shortcut}</span>
          </button>
        ))}
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
