import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ProjectDetailPage } from './ProjectDetailPage'
import { useProjectDetail } from '../../hooks/useProjectDetail'
import { useRetryExtraction } from '../../hooks/useRetryExtraction'

vi.mock('../../hooks/useProjectDetail', () => ({
  useProjectDetail: vi.fn(),
}))
vi.mock('../../hooks/useRetryExtraction', () => ({
  useRetryExtraction: vi.fn(),
}))

const mockedUseProjectDetail = vi.mocked(useProjectDetail)
const mockedUseRetryExtraction = vi.mocked(useRetryExtraction)

function renderProjectDetail() {
  return render(
    <MemoryRouter initialEntries={['/projects/proj123']}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const baseProject = {
  _id: 'proj123',
  businessId: 'biz1',
  leadId: 'lead1',
  correlationId: 'corr-1',
  createdAt: 0,
  updatedAt: 0,
}

function mockRetryMutation(impl: () => Promise<void> = () => Promise.resolve()) {
  return vi.fn(impl) as unknown as ReturnType<typeof useRetryExtraction>
}

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    mockedUseRetryExtraction.mockReturnValue(mockRetryMutation())
  })

  it('shows a loading state while the query resolves', () => {
    mockedUseProjectDetail.mockReturnValue(undefined)
    renderProjectDetail()
    expect(screen.getByText('Loading project…')).toBeInTheDocument()
  })

  it('shows a not-found state when the project does not exist', () => {
    mockedUseProjectDetail.mockReturnValue(null)
    renderProjectDetail()
    expect(screen.getByRole('heading', { name: 'Project not found' })).toBeInTheDocument()
  })

  it('reactively shows voiceSession status (requirement 1)', () => {
    mockedUseProjectDetail.mockReturnValue({
      project: { ...baseProject, state: 'CALLING' },
      businessName: 'Acme Cafe',
      voiceSession: {
        _id: 'vs1',
        status: 'CALLING',
        targetPhoneE164: '+15551234567',
        startedAt: 1700000000000,
      },
      transcript: null,
      requirements: null,
    } as never)

    renderProjectDetail()

    expect(screen.getByText('Acme Cafe')).toBeInTheDocument()
    expect(screen.getByText('CALLING')).toBeInTheDocument()
    expect(screen.getByText('+15551234567')).toBeInTheDocument()
  })

  it('renders the stored transcript once TRANSCRIPT_RECEIVED (requirement 2)', () => {
    mockedUseProjectDetail.mockReturnValue({
      project: { ...baseProject, state: 'TRANSCRIPT_RECEIVED' },
      businessName: 'Acme Cafe',
      voiceSession: null,
      transcript: {
        _id: 't1',
        rawTranscript: 'raw fallback text',
        turns: [
          { speaker: 'agent', text: 'Hi, how can I help?' },
          { speaker: 'customer', text: 'I need a website.' },
        ],
      },
      requirements: null,
    } as never)

    renderProjectDetail()

    expect(screen.getByText('Hi, how can I help?')).toBeInTheDocument()
    expect(screen.getByText('I need a website.')).toBeInTheDocument()
  })

  it('renders validated requirements field-by-field, not as raw JSON (requirement 3)', () => {
    mockedUseProjectDetail.mockReturnValue({
      project: { ...baseProject, state: 'REQUIREMENTS_VALIDATED' },
      businessName: 'Acme Cafe',
      voiceSession: null,
      transcript: null,
      requirements: {
        _id: 'req1',
        status: 'VALIDATED',
        data: {
          businessName: 'Acme Cafe',
          purpose: 'Sell coffee',
          pages: [{ name: 'Home', description: 'Landing page' }],
          cta: { label: 'Order Now', type: 'contact' },
          branding: { primaryColor: '#ff0000' },
          contactDetails: { phone: '+15551234567', email: 'hi@acme.test' },
        },
      },
    } as never)

    renderProjectDetail()

    expect(screen.getByRole('heading', { name: 'Requirements' })).toBeInTheDocument()
    expect(screen.getByText('Sell coffee')).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Order Now')).toBeInTheDocument()
    expect(screen.getByText('#ff0000')).toBeInTheDocument()
    expect(screen.getByText('hi@acme.test')).toBeInTheDocument()
    // Not a raw JSON dump.
    expect(screen.queryByText(/"businessName"/)).not.toBeInTheDocument()
  })

  it('shows the error code and a working Retry Extraction button on failure (requirement 4)', async () => {
    const retryExtraction = mockRetryMutation()
    mockedUseRetryExtraction.mockReturnValue(retryExtraction)
    mockedUseProjectDetail.mockReturnValue({
      project: {
        ...baseProject,
        state: 'MANUAL_INTERVENTION_REQUIRED',
        failedStage: 'REQUIREMENTS_EXTRACTION',
        errorCode: 'REQUIREMENTS_INSUFFICIENT',
        retryable: false,
      },
      businessName: 'Acme Cafe',
      voiceSession: null,
      transcript: null,
      requirements: null,
    } as never)

    renderProjectDetail()

    expect(screen.getByText('REQUIREMENTS_INSUFFICIENT')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Retry Extraction' })

    fireEvent.click(button)
    await screen.findByRole('button', { name: 'Retry Extraction' })

    expect(retryExtraction).toHaveBeenCalledWith({ projectId: 'proj123' })
  })
})
