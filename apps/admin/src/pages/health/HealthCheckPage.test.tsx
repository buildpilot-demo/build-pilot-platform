import { render, screen } from '@testing-library/react'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { describe, expect, it } from 'vitest'
import { HealthCheckPage } from './HealthCheckPage'

describe('HealthCheckPage', () => {
  it('renders an OK status and the convex connection state', async () => {
    const client = new ConvexReactClient('https://example-deployment.convex.cloud')

    render(
      <ConvexProvider client={client}>
        <HealthCheckPage />
      </ConvexProvider>,
    )

    expect(screen.getByRole('heading', { name: 'OK' })).toBeInTheDocument()
    expect(await screen.findByTestId('convex-status')).toBeInTheDocument()
  })
})
