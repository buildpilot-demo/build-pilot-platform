// @vitest-environment edge-runtime
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { modules } from './test.setup'

function contextDevResponse(results: Array<{ url: string; title: string; description: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ results, query: 'test query' }),
    text: async () => '',
  } as Response
}

describe('searchBusinesses', () => {
  beforeEach(() => {
    vi.stubEnv('CONTEXTDEV_API_KEY', 'test-api-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('throws if CONTEXTDEV_API_KEY is not set', async () => {
    vi.stubEnv('CONTEXTDEV_API_KEY', '')
    const t = convexTest(schema, modules)

    await expect(
      t.action(api.businesses.searchBusinesses, {
        city: 'Dubai',
        category: 'restaurant',
      }),
    ).rejects.toThrow(/CONTEXTDEV_API_KEY/)
  })

  it('clamps maxResults into [10, 100] when calling Context.dev', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        contextDevResponse([
          { url: 'https://example.com', title: 'Example Cafe', description: '123' },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)
    const t = convexTest(schema, modules)

    await t.action(api.businesses.searchBusinesses, {
      city: 'Dubai',
      category: 'restaurant',
      maxResults: 2,
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.numResults).toBe(10)

    await t.action(api.businesses.searchBusinesses, {
      city: 'Dubai',
      category: 'restaurant',
      maxResults: 500,
    })
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(secondBody.numResults).toBe(100)
  })

  it('throws on a non-2xx response instead of falling back to mock data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response),
    )
    const t = convexTest(schema, modules)

    await expect(
      t.action(api.businesses.searchBusinesses, { city: 'Dubai', category: 'restaurant' }),
    ).rejects.toThrow(/401/)
  })

  it('throws when Context.dev returns zero results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(contextDevResponse([])))
    const t = convexTest(schema, modules)

    await expect(
      t.action(api.businesses.searchBusinesses, { city: 'Dubai', category: 'restaurant' }),
    ).rejects.toThrow(/zero results/)
  })

  it('normalizes results and assigns the default call phone to every row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        contextDevResponse([
          {
            url: 'https://example.com/cafe',
            title: 'Example Cafe',
            description: 'A cozy cafe. Call 04 123 4567.',
          },
        ]),
      ),
    )
    const t = convexTest(schema, modules)

    await t.action(api.businesses.searchBusinesses, {
      city: 'Dubai',
      area: 'Marina',
      category: 'cafe',
    })

    const businesses = await t.query(api.businesses.listBusinesses, {})
    expect(businesses).toHaveLength(1)
    expect(businesses[0]).toMatchObject({
      name: 'Example Cafe',
      website: 'https://example.com/cafe',
      address: 'A cozy cafe. Call 04 123 4567.',
      phone: '+971588711809',
      normalizedPhone: '+971588711809',
      contactEligible: true,
      contactBasis: 'default_admin_number',
    })
  })

  it('uses DEFAULT_CALL_PHONE when explicitly configured', async () => {
    vi.stubEnv('DEFAULT_CALL_PHONE', '+15550001111')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          contextDevResponse([
            { url: 'https://example.com/cafe', title: 'Example Cafe', description: '' },
          ]),
        ),
    )
    const t = convexTest(schema, modules)

    await t.action(api.businesses.searchBusinesses, { city: 'Dubai', category: 'cafe' })

    const businesses = await t.query(api.businesses.listBusinesses, {})
    expect(businesses[0].normalizedPhone).toBe('+15550001111')
  })

  it('dedups by (source, externalId) instead of duplicating on re-search', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          contextDevResponse([
            { url: 'https://example.com/cafe', title: 'Example Cafe', description: 'v1' },
          ]),
        ),
    )
    const t = convexTest(schema, modules)

    await t.action(api.businesses.searchBusinesses, { city: 'Dubai', category: 'cafe' })
    await t.action(api.businesses.searchBusinesses, { city: 'Dubai', category: 'cafe' })

    const businesses = await t.query(api.businesses.listBusinesses, {})
    expect(businesses).toHaveLength(1)
  })
})

describe('listBusinesses', () => {
  it('filters by city, category, and contact eligibility', async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()

    await t.run(async (ctx) => {
      await ctx.db.insert('businesses', {
        source: 'contextdev',
        externalId: 'a',
        name: 'Dubai Cafe',
        category: 'cafe',
        city: 'Dubai',
        contactEligible: true,
        contactBasis: 'default_admin_number',
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('businesses', {
        source: 'contextdev',
        externalId: 'b',
        name: 'Dubai Restaurant',
        category: 'restaurant',
        city: 'Dubai',
        contactEligible: true,
        contactBasis: 'default_admin_number',
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('businesses', {
        source: 'contextdev',
        externalId: 'c',
        name: 'Abu Dhabi Cafe',
        category: 'cafe',
        city: 'Abu Dhabi',
        contactEligible: false,
        doNotContact: true,
        contactBasis: 'default_admin_number',
        createdAt: now,
        updatedAt: now,
      })
    })

    const dubaiCafes = await t.query(api.businesses.listBusinesses, {
      city: 'Dubai',
      category: 'cafe',
    })
    expect(dubaiCafes.map((b) => b.name)).toEqual(['Dubai Cafe'])

    const eligibleOnly = await t.query(api.businesses.listBusinesses, {
      contactEligibleOnly: true,
    })
    expect(eligibleOnly.map((b) => b.name).sort()).toEqual(['Dubai Cafe', 'Dubai Restaurant'])
  })
})
