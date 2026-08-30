import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * BuildPilot control-plane schema (shared contract #1, docs/task-plan.md
 * Section 3). Every table from docs/project-requirements.md Section 4.2 is
 * represented here; field sets are a first pass and are expected to grow as
 * later stages need more detail. See docs/project-requirements.md Section 10
 * for the uniqueness/index rules encoded below.
 */
export default defineSchema({
  // --- Business discovery ------------------------------------------------
  businesses: defineTable({
    source: v.string(), // e.g. "contextdev"
    externalId: v.string(), // provider's opaque id for this result
    name: v.string(),
    category: v.optional(v.string()),
    city: v.optional(v.string()),
    area: v.optional(v.string()),
    website: v.optional(v.string()),
    address: v.optional(v.string()),
    // `phone`/`normalizedPhone` are the number BuildPilot will actually call.
    // For the hackathon MVP this is not scraped from provider data (see
    // contactBasis) but admins may override it per-selection later (T2.3).
    phone: v.optional(v.string()),
    normalizedPhone: v.optional(v.string()), // E.164
    contactEligible: v.boolean(),
    contactBasis: v.string(), // e.g. "default_admin_number"
    doNotContact: v.optional(v.boolean()),
    raw: v.optional(v.any()), // sanitized raw provider payload, for debugging
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_source_externalId', ['source', 'externalId'])
    .index('by_city', ['city']),

  // --- Lead / project lifecycle -------------------------------------------
  leads: defineTable({
    businessId: v.id('businesses'),
    status: v.string(),
    createdAt: v.number(),
  }).index('by_business', ['businessId']),

  projects: defineTable({
    leadId: v.id('leads'),
    businessId: v.id('businesses'),
    state: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_lead', ['leadId'])
    .index('by_state', ['state']),

  workflowRuns: defineTable({
    projectId: v.optional(v.id('projects')),
    revisionRequestId: v.optional(v.id('revisionRequests')),
    type: v.union(v.literal('initial'), v.literal('revision')),
    status: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_project_type', ['projectId', 'type'])
    .index('by_revisionRequest', ['revisionRequestId']),

  // --- Durable orchestration / idempotency (shared contracts #3, #4) -----
  stageAttempts: defineTable({
    stage: v.string(),
    projectId: v.optional(v.id('projects')),
    workflowRunId: v.optional(v.id('workflowRuns')),
    idempotencyKey: v.string(),
    status: v.union(v.literal('in_progress'), v.literal('succeeded'), v.literal('failed')),
    attempt: v.number(),
    provider: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    result: v.optional(v.any()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_idempotencyKey', ['idempotencyKey'])
    .index('by_stage_project', ['stage', 'projectId']),

  integrationEvents: defineTable({
    stage: v.string(),
    cacheKey: v.string(),
    provider: v.string(),
    projectId: v.optional(v.id('projects')),
    outcome: v.union(v.literal('success'), v.literal('failure')),
    payload: v.any(), // secrets/auth headers redacted before storing
    createdAt: v.number(),
  }).index('by_stage_cacheKey_outcome', ['stage', 'cacheKey', 'outcome']),

  webhookEvents: defineTable({
    provider: v.string(),
    providerEventId: v.string(),
    payload: v.any(),
    processed: v.boolean(),
    receivedAt: v.number(),
  }).index('by_provider_providerEventId', ['provider', 'providerEventId']),

  // --- Voice discovery call ------------------------------------------------
  voiceSessions: defineTable({
    projectId: v.id('projects'),
    elevenLabsConversationId: v.optional(v.string()),
    twilioCallSid: v.optional(v.string()),
    status: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index('by_project', ['projectId'])
    .index('by_elevenLabsConversationId', ['elevenLabsConversationId']),

  callAttempts: defineTable({
    projectId: v.id('projects'),
    voiceSessionId: v.optional(v.id('voiceSessions')),
    elevenLabsConversationId: v.optional(v.string()),
    twilioCallSid: v.optional(v.string()),
    status: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index('by_elevenLabsConversationId', ['elevenLabsConversationId'])
    .index('by_twilioCallSid', ['twilioCallSid']),

  transcripts: defineTable({
    projectId: v.id('projects'),
    voiceSessionId: v.id('voiceSessions'),
    content: v.string(),
    createdAt: v.number(),
  }).index('by_project', ['projectId']),

  // --- Requirements ---------------------------------------------------------
  requirements: defineTable({
    projectId: v.id('projects'),
    status: v.string(),
    data: v.any(),
    createdAt: v.number(),
  }).index('by_project', ['projectId']),

  requirementVersions: defineTable({
    projectId: v.id('projects'),
    requirementId: v.id('requirements'),
    modelVersion: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    schemaVersion: v.optional(v.string()),
    data: v.any(),
    createdAt: v.number(),
  }).index('by_requirement', ['requirementId']),

  generatedDocuments: defineTable({
    projectId: v.id('projects'),
    kind: v.union(
      v.literal('README'),
      v.literal('BUILD_SPEC'),
      v.literal('REQUIREMENTS'),
      v.literal('UI_GUIDELINES'),
    ),
    content: v.string(),
    createdAt: v.number(),
  }).index('by_project_kind', ['projectId', 'kind']),

  // --- Assets ---------------------------------------------------------------
  assets: defineTable({
    projectId: v.id('projects'),
    storageId: v.id('_storage'),
    mimeType: v.string(),
    sizeBytes: v.number(),
    provenance: v.string(),
    sanitizedFilename: v.string(),
    createdAt: v.number(),
  }).index('by_project', ['projectId']),

  // --- Repository / build / deployment -------------------------------------
  templateVersions: defineTable({
    version: v.string(),
    commitSha: v.string(),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index('by_isActive', ['isActive']),

  repositories: defineTable({
    projectId: v.id('projects'),
    githubRepoId: v.string(),
    owner: v.string(),
    name: v.string(),
    branch: v.string(),
    initialCommitSha: v.string(),
    templateVersion: v.string(),
    createdAt: v.number(),
  }).index('by_githubRepoId', ['githubRepoId']),

  buildJobs: defineTable({
    projectId: v.id('projects'),
    workflowRunId: v.optional(v.id('workflowRuns')),
    provider: v.literal('devin'),
    sessionId: v.optional(v.string()),
    status: v.string(),
    targetBranch: v.string(),
    baseCommit: v.string(),
    resultCommit: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index('by_project', ['projectId']),

  siteTenants: defineTable({
    siteId: v.string(),
    projectId: v.id('projects'),
    convexUrl: v.string(),
    backendVersion: v.string(),
    createdAt: v.number(),
  })
    .index('by_siteId', ['siteId'])
    .index('by_project', ['projectId']),

  deployments: defineTable({
    projectId: v.id('projects'),
    firebaseProjectId: v.string(),
    siteId: v.string(),
    deploymentId: v.string(),
    commitSha: v.string(),
    liveUrl: v.optional(v.string()),
    artifactChecksum: v.optional(v.string()),
    status: v.string(),
    createdAt: v.number(),
  }).index('by_siteId_deploymentId', ['siteId', 'deploymentId']),

  siteSubmissions: defineTable({
    siteId: v.string(),
    payload: v.any(),
    consent: v.optional(v.boolean()),
    retentionStatus: v.optional(v.string()),
    receivedAt: v.number(),
  }).index('by_siteId', ['siteId']),

  // --- Notifications / delivery ---------------------------------------------
  notifications: defineTable({
    projectId: v.id('projects'),
    channel: v.literal('whatsapp'),
    status: v.string(),
    twilioMessageSid: v.optional(v.string()),
    sentAt: v.optional(v.number()),
  }).index('by_project', ['projectId']),

  whatsappMessages: defineTable({
    projectId: v.optional(v.id('projects')),
    direction: v.union(v.literal('inbound'), v.literal('outbound')),
    fromNumber: v.string(),
    toNumber: v.string(),
    twilioMessageSid: v.string(),
    status: v.string(),
    body: v.optional(v.string()),
    mediaUrls: v.optional(v.array(v.string())),
    createdAt: v.number(),
  }).index('by_twilioMessageSid', ['twilioMessageSid']),

  // --- Revisions --------------------------------------------------------
  revisionRequests: defineTable({
    projectId: v.id('projects'),
    leadId: v.id('leads'),
    status: v.string(),
    description: v.optional(v.string()),
    scope: v.optional(v.string()),
    devinSubtaskId: v.optional(v.string()),
    baseCommit: v.optional(v.string()),
    workingBranch: v.optional(v.string()),
    resultCommit: v.optional(v.string()),
    buildJobId: v.optional(v.id('buildJobs')),
    deploymentId: v.optional(v.id('deployments')),
    notificationId: v.optional(v.id('notifications')),
    receivedAt: v.number(),
  }).index('by_project_receivedAt', ['projectId', 'receivedAt']),

  revisionAssets: defineTable({
    revisionRequestId: v.id('revisionRequests'),
    storageId: v.id('_storage'),
    mimeType: v.string(),
    sizeBytes: v.number(),
    provenance: v.string(),
    createdAt: v.number(),
  }).index('by_revisionRequest', ['revisionRequestId']),

  // --- Audit / activity ------------------------------------------------------
  activityEvents: defineTable({
    projectId: v.optional(v.id('projects')),
    type: v.string(),
    message: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  }).index('by_project', ['projectId']),
})
