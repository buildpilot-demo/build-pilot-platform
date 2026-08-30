import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'

let mockProjects: unknown[] | undefined

vi.mock('../../hooks/useDashboardProjects', () => ({
  useDashboardProjects: () => mockProjects,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

describe('DashboardPage', () => {
  it('shows a loading state while the query has not resolved', () => {
    mockProjects = undefined
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an empty state with a link to search when there are no projects', () => {
    mockProjects = []
    renderPage()
    expect(screen.getByRole('link', { name: 'Search for a business' })).toBeInTheDocument()
  })

  it('renders a healthy project with its current stage badge and no failure flag', () => {
    mockProjects = [
      {
        projectId: 'proj1',
        businessName: 'Example Cafe',
        correlationId: 'corr-1',
        state: 'DEVIN_BUILDING',
        failedStage: null,
        stateEnteredAt: Date.now() - 65_000,
        createdAt: Date.now() - 120_000,
      },
    ]
    renderPage()

    expect(screen.getByRole('link', { name: 'Example Cafe' })).toHaveAttribute(
      'href',
      '/projects/proj1',
    )
    expect(screen.getByText('Devin building')).toBeInTheDocument()
    expect(screen.getByText('1m 05s in this stage')).toBeInTheDocument()
  })

  it('visually flags a project in MANUAL_INTERVENTION_REQUIRED', () => {
    mockProjects = [
      {
        projectId: 'proj2',
        businessName: 'Stuck Business',
        correlationId: 'corr-2',
        state: 'MANUAL_INTERVENTION_REQUIRED',
        failedStage: 'VOICE_CALL',
        stateEnteredAt: Date.now() - 5_000,
        createdAt: Date.now() - 10_000,
      },
    ]
    renderPage()

    const badge = screen.getByText('Manual Intervention Required')
    expect(badge.className).toContain('bg-red-600')
  })

  it('visually flags a project in a *_FAILED state', () => {
    mockProjects = [
      {
        projectId: 'proj3',
        businessName: 'Failed Call Business',
        correlationId: 'corr-3',
        state: 'CALL_FAILED',
        failedStage: 'VOICE_CALL',
        stateEnteredAt: Date.now() - 1_000,
        createdAt: Date.now() - 1_000,
      },
    ]
    renderPage()

    const badge = screen.getByText('Call Failed')
    expect(badge.className).toContain('bg-red-600')
  })
})
