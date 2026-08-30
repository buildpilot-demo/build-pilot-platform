import { v } from 'convex/values'
import { action, internalMutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { callExternal } from './lib/externalCall'

const CONTEXTDEV_DEFAULT_BASE_URL = 'https://api.context.dev/v1'
const DEFAULT_CALL_PHONE_FALLBACK = '+971588711809'
const MIN_NUM_RESULTS = 10
const MAX_NUM_RESULTS = 100

interface ContextDevSearchResult {
  url: string
  title: string
  description: string
  relevance?: 'high' | 'medium' | 'low'
}

interface ContextDevSearchResponse {
  results: ContextDevSearchResult[]
  query: string
}

function clampNumResults(requested: number | undefined): number {
  const value = requested ?? MIN_NUM_RESULTS
  return Math.min(MAX_NUM_RESULTS, Math.max(MIN_NUM_RESULTS, Math.round(value)))
}

/**
 * Business discovery search (docs/project-requirements.md Section 4.3,
 * PHASE 1). Calls Context.dev's `POST /web/search` and normalizes each
 * result into the `businesses` table shape. Runs before any project exists,
 * so on failure this throws directly rather than transitioning a
 * (non-existent) project to a failure state -- the Admin UI surfaces the
 * thrown error.
 */
export const searchBusinesses = action({
  args: {
    city: v.string(),
    area: v.optional(v.string()),
    category: v.string(),
    // Context.dev's web search has no geographic radius parameter; it's
    // accepted here for interface completeness and folded into the query
    // text below rather than sent as a structured field.
    radius: v.optional(v.number()),
    maxResults: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.CONTEXTDEV_API_KEY
    if (!apiKey) {
      throw new Error(
        'CONTEXTDEV_API_KEY is not set. Configure it with `npx convex env set CONTEXTDEV_API_KEY <key>`.',
      )
    }
    const baseUrl = process.env.CONTEXTDEV_BASE_URL ?? CONTEXTDEV_DEFAULT_BASE_URL

    const areaPhrase = args.area ?? args.city
    const numResults = clampNumResults(args.maxResults)
    const query = args.radius
      ? `${args.category} near ${areaPhrase} in ${args.city} within ${args.radius}km contact phone number`
      : `${args.category} near ${areaPhrase} in ${args.city} contact phone number`

    const response = await callExternal<ContextDevSearchResponse>(ctx, {
      stage: 'BUSINESS_SEARCH',
      cacheKey: JSON.stringify({ query, numResults }),
      live: true,
      provider: 'contextdev',
      fn: async () => {
        const res = await fetch(`${baseUrl}/web/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ query, numResults }),
        })

        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(
            `Context.dev search failed with HTTP ${res.status}${body ? `: ${body.slice(0, 500)}` : ''}`,
          )
        }

        const data = (await res.json()) as ContextDevSearchResponse
        if (!data.results || data.results.length === 0) {
          throw new Error(`Context.dev search returned zero results for query "${query}".`)
        }
        return data
      },
    })

    const defaultPhone = process.env.DEFAULT_CALL_PHONE ?? DEFAULT_CALL_PHONE_FALLBACK

    const businessIds: Id<'businesses'>[] = []
    for (const result of response.results) {
      const businessId: Id<'businesses'> = await ctx.runMutation(
        internal.businesses.upsertFromSearchResult,
        {
          // Context.dev doesn't return a stable per-result id; the
          // canonical result URL is the closest thing to one for dedup.
          externalId: result.url,
          name: result.title,
          website: result.url,
          address: result.description,
          category: args.category,
          city: args.city,
          area: args.area,
          defaultPhone,
          raw: result,
        },
      )
      businessIds.push(businessId)
    }

    return { businessIds, query, numResults }
  },
})

export const upsertFromSearchResult = internalMutation({
  args: {
    externalId: v.string(),
    name: v.string(),
    website: v.optional(v.string()),
    address: v.optional(v.string()),
    category: v.optional(v.string()),
    city: v.optional(v.string()),
    area: v.optional(v.string()),
    defaultPhone: v.string(),
    raw: v.any(),
  },
  handler: async (ctx, args) => {
    const source = 'contextdev'
    const now = Date.now()

    const existing = await ctx.db
      .query('businesses')
      .withIndex('by_source_externalId', (q) =>
        q.eq('source', source).eq('externalId', args.externalId),
      )
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        website: args.website,
        address: args.address,
        category: args.category ?? existing.category,
        city: args.city ?? existing.city,
        area: args.area ?? existing.area,
        raw: args.raw,
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert('businesses', {
      source,
      externalId: args.externalId,
      name: args.name,
      category: args.category,
      city: args.city,
      area: args.area,
      website: args.website,
      address: args.address,
      // Context.dev cannot verify a phone number belongs to the business
      // (see PHASE 1/Section 4.3), so every row is assigned the default
      // admin-operated number. Admins may override this per-selection
      // (T2.3); nothing here blocks a row from being called.
      phone: args.defaultPhone,
      normalizedPhone: args.defaultPhone,
      contactEligible: true,
      contactBasis: 'default_admin_number',
      raw: args.raw,
      createdAt: now,
      updatedAt: now,
    })
  },
})

/** Reactive query backing the Admin UI search-results screen (T2.4). */
export const listBusinesses = query({
  args: {
    city: v.optional(v.string()),
    category: v.optional(v.string()),
    contactEligibleOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const businesses = args.city
      ? await ctx.db
          .query('businesses')
          .withIndex('by_city', (q) => q.eq('city', args.city))
          .collect()
      : await ctx.db.query('businesses').collect()

    return businesses
      .filter((business) => (args.category ? business.category === args.category : true))
      .filter((business) =>
        args.contactEligibleOnly ? business.contactEligible && !business.doNotContact : true,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },
})
