import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyDocument, useEditorStore } from '../store/editorStore'
import { ExportLiveStats } from './ExportLiveStats'
import { TopBar } from './TopBar'

afterEach(cleanup)

describe('export live stats', () => {
  it('shows the export readiness summary under the top bar for an open project', () => {
    useEditorStore.setState({ document: createEmptyDocument(), step: 'grid' })
    render(<TopBar activeProjectId="project-a" projects={[]} onOpenImage={() => undefined} onOpenProjects={() => undefined} />)
    const summary = screen.getByRole('region', { name: 'Export summary' })
    expect(summary).toBeTruthy()
    expect(summary.textContent).toContain('Constraints')
  })

  it('is hidden when no project is open', () => {
    useEditorStore.setState({ document: createEmptyDocument(), step: 'grid' })
    render(<TopBar activeProjectId={null} projects={[]} onOpenImage={() => undefined} onOpenProjects={() => undefined} />)
    expect(screen.queryByRole('region', { name: 'Export summary' })).toBeNull()
  })

  it('updates when scanner settings change', async () => {
    useEditorStore.setState({ document: createEmptyDocument(), step: 'grid' })
    render(<ExportLiveStats />)
    const before = screen.getByRole('region', { name: 'Export summary' }).textContent
    await act(async () => {
      const doc = useEditorStore.getState().document
      useEditorStore.setState({
        document: { ...doc, scanner: { ...doc.scanner, textureEnabled: false, offsetsEnabled: true } },
      })
    })
    const after = screen.getByRole('region', { name: 'Export summary' }).textContent
    expect(after).not.toEqual(before)
    expect(after).toContain('Offsets')
  })
})
