import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// This is the *shared, multi-tenant* Convex project (buildpilot-sites) that
// every generated customer site's own frontend talks to directly — a
// separate Convex project from build-pilot-platform's own control-plane
// deployment (see that repo's root convex/schema.ts). It only needs the two
// tables customer-facing functions actually touch; every control-plane
// table (businesses, projects, workflowRuns, etc.) lives there, not here.
export default defineSchema({
  siteTenants: defineTable({
    // Plain string, not v.id("projects") — that id was minted in the
    // control-plane's own database, a different Convex project with its own
    // id namespace; it's kept here only as an opaque correlation string.
    projectId: v.string(),
    siteId: v.string(),
    firebaseProjectId: v.string(),
    firebaseSiteId: v.string(),
    convexUrl: v.string(),
    backendVersion: v.string(),
    status: v.union(v.literal("provisioning"), v.literal("active"), v.literal("suspended")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_id", ["siteId"])
    .index("by_project_id", ["projectId"])
    .index("by_firebase_site_id", ["firebaseSiteId"]),

  siteSubmissions: defineTable({
    siteTenantId: v.id("siteTenants"),
    siteId: v.string(),
    projectId: v.string(),
    type: v.literal("contact"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    enquiryType: v.optional(v.string()),
    message: v.string(),
    consentAccepted: v.boolean(),
    consentTextVersion: v.optional(v.string()),
    spamScore: v.optional(v.number()),
    status: v.union(v.literal("accepted"), v.literal("rejected"), v.literal("reviewed")),
    retentionUntil: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_site_created_at", ["siteId", "createdAt"])
    .index("by_project_created_at", ["projectId", "createdAt"])
    .index("by_status_created_at", ["status", "createdAt"]),
});
