import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appPathFromLocation } from '../domain/appRoutes'
import { InfoPage } from './InfoPages'

afterEach(cleanup)

describe('information pages', () => {
  it('normalizes known information paths and returns the editor for unknown paths', () => {
    expect(appPathFromLocation('/info/how-to-use/')).toBe('/info/how-to-use')
    expect(appPathFromLocation('/not-a-page')).toBe('/')
  })

  it('renders concise workflow steps', () => {
    render(<InfoPage path="/info/how-to-use" onNavigate={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'How to use it' })).toBeInTheDocument()
    expect(screen.getByText('Confirm face variants')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to editor' })).toBeInTheDocument()
  })
})
