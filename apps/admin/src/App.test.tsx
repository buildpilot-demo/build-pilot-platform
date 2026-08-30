import { render, screen } from '@testing-library/react'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'

function renderAt(path: string) {
  const client = new ConvexReactClient('https://example-deployment.convex.cloud')

  return render(
    <ConvexProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ConvexProvider>,
  )
}

describe('App routing', () => {
  it('redirects / to the dashboard', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Pipeline dashboard' })).toBeInTheDocument()
  })

  it('renders the search screen', () => {
    renderAt('/search')
    expect(screen.getByRole('heading', { name: 'Business search' })).toBeInTheDocument()
  })

  it('renders a loading state for the project detail panel while its query resolves', () => {
    renderAt('/projects/abc123')
    expect(screen.getByText('Loading project…')).toBeInTheDocument()
  })

  it('renders shared nav in the layout', () => {
    renderAt('/dashboard')
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Search' })).toBeInTheDocument()
  })

  it('renders a not-found page for unknown routes', () => {
    renderAt('/nonexistent')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
