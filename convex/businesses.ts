// convex/businesses.ts
//
// Stage 3 (Person A), T2.2/T2.4. Implements PHASE 1 (Business Discovery,
// docs/project-requirements.md Section 4.3 / Section 6):
//
//   Admin (React)     -> enters city + category
//   React             -> calls Convex mutation: searchBusinesses()
//   Convex Action     -> calls Context.dev API
//   Context.dev       -> returns business list
//   Convex            -> normalizes, deduplicates, enforces eligibility, stores in `businesses`
//   React             -> subscribes to reactive query, renders results live
//
// `searchBusinesses` runs before any Lead/Project exists, so — unlike every
// other external-call action in this codebase — it deliberately does NOT
// go through convex/lib/externalCall.ts's `callExternal`/`stageAttempt`
// machinery: both require a `projectId` (Shared Contracts #3/#4), and none
// exists yet at this point in the pipeline (see the "BUSINESS_SEARCH is
// intentionally absent" comment in convex/lib/externalCall.ts). On failure
// this throws directly — there is no project yet to move to
// `BUSINESS_SEARCH_FAILED` (that state in convex/stateMachine.ts is for a
// later re-search against an existing project, not this one) — and the
// Admin UI surfaces the thrown error.

import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const CONTEXTDEV_DEFAULT_BASE_URL = "https://api.context.dev/v1";
const DEFAULT_CALL_PHONE_FALLBACK = "+971588711809";
const MIN_NUM_RESULTS = 10;
const MAX_NUM_RESULTS = 100;

interface ContextDevSearchResult {
  url: string;
  title: string;
  description: string;
  relevance?: "high" | "medium" | "low";
}

interface ContextDevSearchResponse {
  results: ContextDevSearchResult[];
  query: string;
}

function clampNumResults(requested: number | undefined): number {
  const value = requested ?? MIN_NUM_RESULTS;
  return Math.min(MAX_NUM_RESULTS, Math.max(MIN_NUM_RESULTS, Math.round(value)));
}

export const searchBusinesses = action({
  args: {
    city: v.string(),
    area: v.optional(v.string()),
    category: v.string(),
    // Context.dev's web search has no geographic radius parameter; accepted
    // here for interface completeness and folded into the query text below
    // rather than sent as a structured field.
    radius: v.optional(v.number()),
    maxResults: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ businessIds: Id<"businesses">[]; query: string; numResults: number }> => {
    const apiKey = process.env.CONTEXTDEV_API_KEY;
    if (!apiKey) {
      throw new Error(
        "CONTEXTDEV_API_KEY is not set. Configure it with `npx convex env set CONTEXTDEV_API_KEY <key>`.",
      );
    }
    const baseUrl = process.env.CONTEXTDEV_BASE_URL ?? CONTEXTDEV_DEFAULT_BASE_URL;

    const areaPhrase = args.area ?? args.city;
    const numResults = clampNumResults(args.maxResults);
    const query = args.radius
      ? `${args.category} near ${areaPhrase} in ${args.city} within ${args.radius}km contact phone number`
      : `${args.category} near ${areaPhrase} in ${args.city} contact phone number`;

    const response = await fetch(`${baseUrl}/web/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, numResults }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Context.dev search failed with HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
      );
    }

    const data = (await response.json()) as ContextDevSearchResponse;
    if (!data.results || data.results.length === 0) {
      throw new Error(`Context.dev search returned zero results for query "${query}".`);
    }

    const defaultPhone = process.env.DEFAULT_CALL_PHONE ?? DEFAULT_CALL_PHONE_FALLBACK;

    const businessIds: Id<"businesses">[] = [];
    for (const result of data.results) {
      const businessId: Id<"businesses"> = await ctx.runMutation(
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
          rawResponse: result,
        },
      );
      businessIds.push(businessId);
    }

    return { businessIds, query, numResults };
  },
});

export const upsertFromSearchResult = internalMutation({
  args: {
    externalId: v.string(),
    name: v.string(),
    website: v.optional(v.string()),
    address: v.optional(v.string()),
    category: v.string(),
    city: v.string(),
    area: v.optional(v.string()),
    defaultPhone: v.string(),
    rawResponse: v.any(),
  },
  handler: async (ctx, args) => {
    const source = "CONTEXTDEV" as const;
    const dedupeKey = `${source}:${args.externalId}`;
    const now = Date.now();

    const existing = await ctx.db
      .query("businesses")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        website: args.website,
        address: args.address,
        category: args.category,
        city: args.city,
        area: args.area ?? existing.area,
        rawResponse: args.rawResponse,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("businesses", {
      source,
      externalId: args.externalId,
      dedupeKey,
      name: args.name,
      category: args.category,
      city: args.city,
      area: args.area,
      website: args.website,
      address: args.address,
      // Context.dev cannot verify a phone number belongs to the business
      // (PHASE 1 / Section 4.3), so every row is assigned the default
      // admin-operated number. Admins may override this per-selection
      // (T2.3); nothing here blocks a row from being called.
      phoneRaw: args.defaultPhone,
      phoneE164: args.defaultPhone,
      contactEligible: true,
      doNotContact: false,
      contactBasis: "DEFAULT_ADMIN_NUMBER",
      rawResponse: args.rawResponse,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Reactive query backing the Admin UI search-results screen (T2.4). */
export const listBusinesses = query({
  args: {
    city: v.optional(v.string()),
    category: v.optional(v.string()),
    contactEligibleOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const city = args.city;
    const category = args.category;

    const businesses = city
      ? await ctx.db
          .query("businesses")
          .withIndex("by_city_category", (q) =>
            category ? q.eq("city", city).eq("category", category) : q.eq("city", city),
          )
          .collect()
      : await ctx.db.query("businesses").collect();

    return businesses
      .filter((business) => (category ? business.category === category : true))
      .filter((business) =>
        args.contactEligibleOnly ? business.contactEligible && !business.doNotContact : true,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
