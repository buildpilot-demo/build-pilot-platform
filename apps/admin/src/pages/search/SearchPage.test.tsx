import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from './SearchPage'

const mockNavigate = vi.fn()
const mockSearchBusinesses = vi
  .fn()
  .mockResolvedValue({ businessIds: [], query: '', numResults: 10 })
const mockSelectBusiness = vi.fn().mockResolvedValue({})
let mockBusinesses: unknown[] | undefined = []

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../hooks/useBusinessSearch', () => ({
  useSearchBusinesses: () => mockSearchBusinesses,
  useSelectBusiness: () => mockSelectBusiness,
  useListBusinesses: () => mockBusinesses,
}))

vi.mock('../../hooks/useCallPhoneOverride', () => ({
  useCallPhoneOverride: () => ['+15550001111', vi.fn()],
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>,
  )
}

function submitSearch() {
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Dubai' } })
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cafe' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
}

describe('SearchPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockSearchBusinesses.mockClear()
    mockSelectBusiness.mockClear()
    mockBusinesses = []
  })

  it('submits the form by calling searchBusinesses, never Context.dev directly', async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Dubai' } })
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: 'Marina' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cafe' } })
    fireEvent.change(screen.getByLabelText('Radius (km)'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Max results'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() =>
      expect(mockSearchBusinesses).toHaveBeenCalledWith({
        city: 'Dubai',
        area: 'Marina',
        category: 'cafe',
        radius: 5,
        maxResults: 20,
      }),
    )
  })

  it('renders results from the reactive listBusinesses query', async () => {
    mockBusinesses = [
      {
        _id: 'biz1',
        name: 'No Project Cafe',
        category: 'cafe',
        city: 'Dubai',
        area: null,
        leadStatus: null,
        projectId: null,
      },
      {
        _id: 'biz2',
        name: 'In Progress Cafe',
        category: 'cafe',
        city: 'Dubai',
        area: null,
        leadStatus: 'NEW',
        projectId: 'proj1',
      },
    ]
    renderPage()
    submitSearch()

    expect(await screen.findByText('No Project Cafe')).toBeInTheDocument()
    expect(screen.getByText('In Progress Cafe')).toBeInTheDocument()
    // Only the row with a project gets a "View project" button.
    expect(screen.getAllByRole('button', { name: 'View project' })).toHaveLength(1)
    // "Call" always renders for every row, project or not.
    expect(screen.getAllByRole('button', { name: 'Call' })).toHaveLength(2)
  })

  it('calling a business calls selectBusiness with the override phone and does not navigate', async () => {
    mockBusinesses = [
      {
        _id: 'biz1',
        name: 'No Project Cafe',
        category: 'cafe',
        city: 'Dubai',
        area: null,
        leadStatus: null,
        projectId: null,
      },
    ]
    renderPage()
    submitSearch()
    await screen.findByText('No Project Cafe')

    fireEvent.click(screen.getByRole('button', { name: 'Call' }))

    await waitFor(() =>
      expect(mockSelectBusiness).toHaveBeenCalledWith({
        businessId: 'biz1',
        overridePhone: '+15550001111',
      }),
    )
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('clicking a row with a project, or its "View project" button, navigates to the project detail page', async () => {
    mockBusinesses = [
      {
        _id: 'biz2',
        name: 'In Progress Cafe',
        category: 'cafe',
        city: 'Dubai',
        area: null,
        leadStatus: 'NEW',
        projectId: 'proj1',
      },
    ]
    renderPage()
    submitSearch()
    await screen.findByText('In Progress Cafe')

    fireEvent.click(screen.getByRole('button', { name: 'View project' }))

    expect(mockNavigate).toHaveBeenCalledWith('/projects/proj1')
  })
})
