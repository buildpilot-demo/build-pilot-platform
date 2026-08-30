import { render, screen } from '@testing-library/react'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { describe, expect, it } from 'vitest'
import { HealthCheck } from './HealthCheck'

describe('HealthCheck', () => {
  it('renders an OK status and the convex connection state', async () => {
    const client = new ConvexReactClient('https://example-deployment.convex.cloud')

    render(
      <ConvexProvider client={client}>
        <HealthCheck />
      </ConvexProvider>,
    )

    expect(screen.getByRole('heading', { name: 'OK' })).toBeInTheDocument()
    expect(await screen.findByTestId('convex-status')).toBeInTheDocument()
  })
})
