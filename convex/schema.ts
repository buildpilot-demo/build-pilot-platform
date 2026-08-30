// convex/schema.ts
//
// Shared Contract #1 (docs/task-plan.md Section 3) — the full table list
// from docs/project-requirements.md Section 4.2. This file has no
// dependencies on any other convex/*.ts module (schema.ts must stay
// dependency-free so nothing can form an import cycle with it); other
// modules (convex/stateMachine.ts, convex/lib/stageAttempt.ts, ...) import
// FROM here (via `Doc`/`Id` from "./_generated/dataModel"), never the
// reverse.
//
// This schema is written to be consistent, field-for-field, with what
// convex/stateMachine.ts's `transitionProject` and convex/lib/stageAttempt.ts's
// `beginStageAttempt` / `completeStageAttempt` / `failStageAttempt` /
// `escalateToManualIntervention` already read and write on `projects`,
// `workflowRuns`, `revisionRequests`, `activityEvents`, and `stageAttempts`
// — see the comment above each of those tables below for exactly which
// fields are load-bearing for those two modules vs. free to extend.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ============================================================================
// Shared enums / validators
//
// Section 8 of docs/project-requirements.md defines the workflow state
// machine. `workflowStateValidator` is the single source of truth for every
// value that can ever appear in `projects.state`, `workflowRuns.state`, and
// `revisionRequests.status`. It includes the Primary states, the Revision
// states, and the Failure states, plus MANUAL_INTERVENTION_REQUIRED (the
// state every exhausted/non-retryable failure resolves to per Section 10/11)
// — this exact list is mirrored 1:1 by `ALL_STATES` in convex/stateMachine.ts.
// ============================================================================

/** Primary Project states (Section 8, "Primary Project States"). */
const PRIMARY_STATES = [
  "PROJECT_CREATED",
  "CALL_QUEUED",
  "CALLING",
  "CALL_COMPLETED",
  "TRANSCRIPT_RECEIVED",
  "REQUIREMENTS_PROCESSING",
  "REQUIREMENTS_READY",
  "REQUIREMENTS_VALIDATING",
  "REQUIREMENTS_VALIDATED",
  "DOCUMENTS_GENERATING",
  "DOCUMENTS_READY",
  "REPOSITORY_PREPARING",
  "REPOSITORY_READY",
  "BUILD_QUEUED",
  "DEVIN_BUILDING",
  "BUILD_VALIDATING",
  "BUILD_COMPLETED",
  "DEPLOYMENT_QUEUED",
  "DEPLOYING",
  "LIVE",
  "NOTIFICATION_PENDING",
  "DELIVERED",
] as const;

/** Revision states, per RevisionRequest (Section 8, "Revision States"). */
const REVISION_STATES = [
  "REVISION_REQUESTED",
  "REVISION_ASSETS_RECEIVED",
  "REVISION_QUEUED",
  "DEVIN_REVISING",
  "REVISION_TESTING",
  "REVISION_DEPLOYING",
  "REVISION_LIVE",
  "REVISION_NOTIFICATION_PENDING",
  "REVISION_COMPLETED",
] as const;

/** Failure states (Section 8, "Failure States"). */
const FAILURE_STATES = [
  "BUSINESS_SEARCH_FAILED",
  "CALL_FAILED",
  "TRANSCRIPT_FAILED",
  "REQUIREMENTS_FAILED",
  "DOCUMENT_GENERATION_FAILED",
  "GITHUB_FAILED",
  "BUILD_VALIDATION_FAILED",
  "DEPLOYMENT_FAILED",
  "NOTIFICATION_FAILED",
  "REVISION_BUILD_FAILED",
  "REVISION_DEPLOYMENT_FAILED",
  "REVISION_NOTIFICATION_FAILED",
] as const;

/**
 * Terminal state for exhausted/non-retryable failures (Section 10 "Retry
 * only retryable errors ... Exhausted/non-retryable -> MANUAL_INTERVENTION_REQUIRED").
 */
const MANUAL_INTERVENTION_STATE = "MANUAL_INTERVENTION_REQUIRED" as const;

export const ALL_WORKFLOW_STATES = [
  ...PRIMARY_STATES,
  ...REVISION_STATES,
  ...FAILURE_STATES,
  MANUAL_INTERVENTION_STATE,
] as const;

/**
 * Full workflow state enum (primary + revision + failure + manual
 * intervention). Used by `projects.state`, `workflowRuns.state`, and
 * `revisionRequests.status` so none of the three can drift on what a
 * "state" is allowed to be. Optional on all three: a freshly-inserted row
 * may exist before it's been bootstrapped into the state machine via
 * `transitionProject` (see convex/stateMachine.ts `INITIAL_STATES`).
 */
const workflowStateValidator = v.union(
  ...ALL_WORKFLOW_STATES.map((state) => v.literal(state)),
);

/**
 * External integration identifiers (mirrors `ProviderName` in
 * convex/lib/stageAttempt.ts). Used wherever a record needs to say *which*
 * third-party provider it concerns.
 */
export const providerName = v.union(
  v.literal("CONTEXTDEV"),
  v.literal("ELEVENLABS"),
  v.literal("OPENAI"),
  v.literal("DEVIN"),
  v.literal("GITHUB"),
  v.literal("FIREBASE"),
  v.literal("TWILIO"),
);

/**
 * Failure metadata shared by every table that can land in a failure /
 * MANUAL_INTERVENTION_REQUIRED state (Section 8: "Each failure stores:
 * failedStage, errorCode, retryable, retryCount, maxRetries, correlationId,
 * provider, providerRequestId"). `correlationId` is deliberately NOT part of
 * this shared object — every table below that spreads it already has its
 * own top-level, always-present `correlationId` column. `provider` here is
 * a plain optional string (not the `providerName` union) because
 * convex/stateMachine.ts's `transitionProject` / convex/lib/stageAttempt.ts's
 * `escalateToManualIntervention` both write it from a free-form
 * `metadata.provider?: string`.
 *
 * `provider` is NOT included here (unlike the other six fields) because
 * some tables that spread this object already declare their own fixed
 * `provider: v.literal(...)` field (`callAttempts`, `repositories`,
 * `buildJobs`, `deployments`); the remaining spreaders (`projects`,
 * `workflowRuns`, `revisionRequests`, `notifications`) declare
 * `provider: v.optional(v.string())` explicitly alongside this spread.
 */
const failureFields = {
  failedStage: v.optional(v.string()),
  errorCode: v.optional(v.string()),
  retryable: v.optional(v.boolean()),
  retryCount: v.optional(v.number()),
  maxRetries: v.optional(v.number()),
  providerRequestId: v.optional(v.string()),
};

/** A single page/section referenced inside requirements JSON. */
const requirementsPageValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),
});

/**
 * Structured requirements JSON shape (Section 4.6 / Section 5 "Requirements
 * validated"). OpenAI must not invent facts, so every field besides
 * `businessName`, `pages`, and `cta` is optional (unknown stays unknown).
 */
const requirementsDataValidator = v.object({
  businessName: v.string(),
  purpose: v.optional(v.string()),
  services: v.optional(v.array(v.string())),
  targetUsers: v.optional(v.array(v.string())),
  pages: v.array(requirementsPageValidator),
  branding: v.optional(
    v.object({
      primaryColor: v.optional(v.string()),
      secondaryColor: v.optional(v.string()),
      logoAssetId: v.optional(v.id("assets")),
      fonts: v.optional(v.array(v.string())),
    }),
  ),
  cta: v.object({
    label: v.string(),
    type: v.optional(v.string()),
    target: v.optional(v.string()),
  }),
  contactDetails: v.optional(
    v.object({
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      address: v.optional(v.string()),
    }),
  ),
});

export default defineSchema({
  // ==========================================================================
  // PHASE 1 — Business Discovery
  // ==========================================================================
  businesses: defineTable({
    source: v.union(v.literal("CONTEXTDEV"), v.literal("SEEDED")),
    externalId: v.string(),
    dedupeKey: v.string(), // `${source}:${externalId}` — enforces dedup by source + externalId (Section 4.3)
    name: v.string(),
    category: v.string(),
    phoneRaw: v.optional(v.string()),
    phoneE164: v.optional(v.string()),
    address: v.optional(v.string()),
    website: v.optional(v.string()),
    city: v.string(),
    area: v.optional(v.string()),
    location: v.optional(v.object({ lat: v.number(), lng: v.number() })),
    contactEligible: v.boolean(),
    doNotContact: v.boolean(),
    // Additive (convex/businesses.ts, T2.2): why `phoneRaw`/`phoneE164` is
    // trusted for outbound contact, since Context.dev can't verify a phone
    // number actually belongs to the business it returned it for. Admins
    // may override the number per-selection (T2.3) without changing this.
    contactBasis: v.optional(v.string()),
    rawResponse: v.optional(v.any()), // original Context.dev payload, for audit/replay
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_phoneE164", ["phoneE164"])
    .index("by_city_category", ["city", "category"]),

  // ==========================================================================
  // PHASE 2 — Lead & Project Creation
  // ==========================================================================
  leads: defineTable({
    businessId: v.id("businesses"),
    status: v.union(
      v.literal("NEW"),
      v.literal("CONTACTED"),
      v.literal("CONVERTED"),
      v.literal("DISQUALIFIED"),
    ),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_businessId", ["businessId"]),

  // `state` uses the shared `workflowStateValidator` (full Section 8 enum).
  // LOAD-BEARING for convex/stateMachine.ts `transitionProject`, which reads
  // `state`/`correlationId` and patches `state`, `updatedAt`, and every
  // field in the failure-metadata block below — do not rename those without
  // updating that module. Everything else here is free to extend.
  projects: defineTable({
    leadId: v.id("leads"),
    businessId: v.id("businesses"),
    state: v.optional(workflowStateValidator),
    correlationId: v.string(), // stable ID threaded through every external call for this project; transitionProject falls back to this when no override is given
    activeRevisionRequestId: v.optional(v.id("revisionRequests")),
    repositoryId: v.optional(v.id("repositories")),
    liveDeploymentId: v.optional(v.id("deployments")),
    liveUrl: v.optional(v.string()),
    // --- Failure metadata (Section 8) — patched by transitionProject/escalateToManualIntervention ---
    provider: v.optional(v.string()),
    ...failureFields,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_leadId", ["leadId"])
    .index("by_businessId", ["businessId"])
    .index("by_correlationId", ["correlationId"]),

  // ==========================================================================
  // PHASE 3/4 — Voice Discovery Call, Completion & Transcript
  // ==========================================================================
  callAttempts: defineTable({
    projectId: v.id("projects"),
    leadId: v.id("leads"),
    attemptNumber: v.number(),
    targetPhoneE164: v.string(),
    callingWindowOk: v.boolean(),
    provider: v.literal("ELEVENLABS"),
    status: v.union(
      v.literal("QUEUED"),
      v.literal("IN_PROGRESS"),
      v.literal("COMPLETED"),
      v.literal("NO_ANSWER"),
      v.literal("BUSY"),
      v.literal("FAILED"),
    ),
    voiceSessionId: v.optional(v.id("voiceSessions")),
    stageAttemptId: v.optional(v.id("stageAttempts")),
    correlationId: v.string(),
    ...failureFields,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_leadId", ["leadId"]),

  voiceSessions: defineTable({
    projectId: v.id("projects"),
    callAttemptId: v.id("callAttempts"),
    provider: v.literal("ELEVENLABS"),
    elevenLabsConversationId: v.string(), // dedup key for the completion webhook (Section 4.4)
    twilioCallSid: v.optional(v.string()),
    targetPhoneE164: v.string(),
    status: v.union(
      v.literal("QUEUED"),
      v.literal("CALLING"),
      v.literal("COMPLETED"),
      v.literal("FAILED"),
    ),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_elevenLabsConversationId", ["elevenLabsConversationId"]),

  transcripts: defineTable({
    projectId: v.id("projects"),
    voiceSessionId: v.id("voiceSessions"),
    elevenLabsConversationId: v.string(), // same dedup key as voiceSessions, denormalized for direct lookup
    rawTranscript: v.string(),
    turns: v.optional(
      v.array(
        v.object({
          speaker: v.union(v.literal("agent"), v.literal("customer")),
          text: v.string(),
          startedAtMs: v.optional(v.number()),
        }),
      ),
    ),
    source: v.literal("ELEVENLABS_WEBHOOK"),
    receivedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_voiceSessionId", ["voiceSessionId"])
    .index("by_elevenLabsConversationId", ["elevenLabsConversationId"]),

  // ==========================================================================
  // PHASE 5 — Requirement Extraction & Validation
  // ==========================================================================

  // Current/authoritative requirements snapshot for a project (one row per
  // project). Historical/candidate extractions live in `requirementVersions`.
  requirements: defineTable({
    projectId: v.id("projects"),
    status: v.union(
      v.literal("PENDING"),
      v.literal("PROCESSING"),
      v.literal("READY"),
      v.literal("VALIDATING"),
      v.literal("VALIDATED"),
      v.literal("INSUFFICIENT"), // Section 4.6: on insufficient data -> REQUIREMENTS_INSUFFICIENT -> manual intervention
    ),
    currentVersionId: v.optional(v.id("requirementVersions")),
    validatedVersionId: v.optional(v.id("requirementVersions")),
    data: v.optional(requirementsDataValidator), // denormalized copy of validatedVersionId's data, for fast reads
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId", ["projectId"]),

  requirementVersions: defineTable({
    projectId: v.id("projects"),
    requirementsId: v.id("requirements"),
    version: v.number(), // monotonically increasing per project; also feeds stageAttempts idempotency keys for this stage
    transcriptId: v.optional(v.id("transcripts")),
    data: requirementsDataValidator,
    status: v.union(
      v.literal("CANDIDATE"),
      v.literal("VALIDATED"),
      v.literal("REJECTED"),
      v.literal("INSUFFICIENT"),
    ),
    validationErrors: v.optional(v.array(v.string())),
    source: v.literal("OPENAI_EXTRACTION"),
    model: v.string(),
    promptVersion: v.string(),
    schemaVersion: v.string(),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_requirementsId", ["requirementsId"])
    .index("by_projectId_and_version", ["projectId", "version"]),

  // ==========================================================================
  // PHASE 6 — Document Generation
  // ==========================================================================
  generatedDocuments: defineTable({
    projectId: v.id("projects"),
    type: v.union(
      v.literal("README"),
      v.literal("BUILD_SPEC"),
      v.literal("REQUIREMENTS"),
      v.literal("UI_GUIDELINES"),
    ),
    path: v.string(), // path the doc is pushed to in the customer repo, e.g. "BUILD_SPEC.md"
    content: v.string(),
    requirementVersionId: v.optional(v.id("requirementVersions")),
    generatorVersion: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_type", ["projectId", "type"]),

  // ==========================================================================
  // PHASE 7 — Asset Collection (also used by Phase 12 revision media)
  // ==========================================================================
  assets: defineTable({
    projectId: v.id("projects"),
    source: v.union(
      v.literal("CONTEXTDEV"),
      v.literal("WHATSAPP_MEDIA"),
      v.literal("ADMIN_UPLOAD"),
      v.literal("GENERATED"),
    ),
    storageId: v.id("_storage"),
    filename: v.string(), // sanitized filename
    mimeType: v.string(), // verified from bytes, not from client-provided header
    sizeBytes: v.number(),
    checksum: v.optional(v.string()),
    provenance: v.string(),
    status: v.union(
      v.literal("PENDING_VALIDATION"),
      v.literal("VALID"),
      v.literal("REJECTED"),
    ),
    rejectionReason: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_projectId", ["projectId"]),

  // ==========================================================================
  // PHASE 8 — GitHub Repository Preparation
  // ==========================================================================
  templateVersions: defineTable({
    name: v.string(), // e.g. "react-vite-convex-firebase-starter"
    version: v.string(),
    sourceRepoFullName: v.string(),
    commitSha: v.string(),
    active: v.boolean(),
    description: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_name_and_version", ["name", "version"])
    .index("by_active", ["active"]),

  repositories: defineTable({
    projectId: v.id("projects"),
    provider: v.literal("GITHUB"),
    owner: v.string(),
    name: v.string(),
    fullName: v.string(), // `${owner}/${name}`
    defaultBranch: v.string(),
    targetBranch: v.string(), // branch Devin pushes the build to
    initialCommitSha: v.string(),
    templateVersionId: v.id("templateVersions"),
    validateRepositoryRunId: v.optional(v.string()), // GitHub Actions run ID for `validate-repository`
    status: v.union(
      v.literal("CREATING"),
      v.literal("PUSHING_TEMPLATE"),
      v.literal("VALIDATING"),
      v.literal("READY"),
      v.literal("FAILED"),
    ),
    correlationId: v.string(),
    ...failureFields,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_fullName", ["fullName"]),

  // ==========================================================================
  // PHASE 9 — Build Validation & Completion (Devin + GitHub Actions)
  // Also used by Phase 12 for revision builds (revisionRequestId set).
  // ==========================================================================
  buildJobs: defineTable({
    projectId: v.id("projects"),
    repositoryId: v.id("repositories"),
    revisionRequestId: v.optional(v.id("revisionRequests")), // set when this build is a scoped revision (Phase 12)
    provider: v.literal("DEVIN"),
    devinSessionId: v.optional(v.string()),
    baseCommitSha: v.string(),
    targetBranch: v.string(),
    buildSpecPath: v.string(),
    resultCommitSha: v.optional(v.string()),
    validateCandidateRunId: v.optional(v.string()), // GitHub Actions run ID for `validate-candidate`
    artifactChecksum: v.optional(v.string()),
    status: v.union(
      v.literal("QUEUED"),
      v.literal("DEVIN_BUILDING"),
      v.literal("PUSHED"),
      v.literal("VALIDATING"),
      v.literal("VALIDATED"),
      v.literal("FAILED"),
    ),
    stageAttemptId: v.optional(v.id("stageAttempts")),
    correlationId: v.string(),
    ...failureFields,
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_revisionRequestId", ["revisionRequestId"])
    .index("by_devinSessionId", ["devinSessionId"])
    .index("by_repositoryId", ["repositoryId"]),

  // ==========================================================================
  // PHASE 10 — Firebase Deployment (also used by Phase 12 revision deploys)
  // ==========================================================================
  siteTenants: defineTable({
    projectId: v.id("projects"),
    siteId: v.string(), // public tenant ID enforced server-side by the shared generated-site backend (Section 4.10)
    firebaseSiteTarget: v.string(), // unique Firebase Hosting site/target for this customer
    firebaseProjectId: v.string(),
    generatedSiteConvexUrl: v.string(), // URL of the shared generated-site Convex deployment
    status: v.union(
      v.literal("PROVISIONING"),
      v.literal("ACTIVE"),
      v.literal("SUSPENDED"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_siteId", ["siteId"]),

  deployments: defineTable({
    projectId: v.id("projects"),
    repositoryId: v.id("repositories"),
    buildJobId: v.id("buildJobs"),
    revisionRequestId: v.optional(v.id("revisionRequests")), // set for revision deployments (Phase 12)
    environment: v.union(v.literal("PREVIEW"), v.literal("LIVE")),
    provider: v.literal("FIREBASE"),
    firebaseProjectId: v.string(),
    siteId: v.string(),
    commitSha: v.string(),
    artifactChecksum: v.string(),
    previewUrl: v.optional(v.string()),
    liveUrl: v.optional(v.string()),
    status: v.union(
      v.literal("QUEUED"),
      v.literal("DEPLOYING"),
      v.literal("SMOKE_TESTING"),
      v.literal("PROMOTED"),
      v.literal("LIVE"),
      v.literal("FAILED"),
      v.literal("ROLLED_BACK"),
    ),
    // Rollback support (Section 4.9 / Section 11: "Failed revision -> previous
    // live deployment stays untouched"): points at the deployment this one
    // supersedes, so a failed promotion can be traced back to the still-live one.
    previousLiveDeploymentId: v.optional(v.id("deployments")),
    correlationId: v.string(),
    ...failureFields,
    deployedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_revisionRequestId", ["revisionRequestId"])
    .index("by_siteId", ["siteId"])
    .index("by_status", ["status"]),

  // ==========================================================================
  // PHASE 11 — Customer Delivery (WhatsApp), also Phase 12 revision-complete
  // ==========================================================================
  whatsappMessages: defineTable({
    projectId: v.optional(v.id("projects")),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    twilioMessageSid: v.string(), // dedup key (Section 4.5: "stores all message events idempotently by Twilio message SID")
    fromPhoneE164: v.string(),
    toPhoneE164: v.string(),
    body: v.optional(v.string()),
    mediaUrls: v.optional(v.array(v.string())),
    status: v.union(
      v.literal("QUEUED"),
      v.literal("SENT"),
      v.literal("DELIVERED"),
      v.literal("READ"),
      v.literal("RECEIVED"),
      v.literal("FAILED"),
      v.literal("UNDELIVERED"),
    ),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_twilioMessageSid", ["twilioMessageSid"])
    .index("by_projectId", ["projectId"])
    .index("by_revisionRequestId", ["revisionRequestId"]),

  notifications: defineTable({
    projectId: v.id("projects"),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    channel: v.literal("WHATSAPP"),
    type: v.union(
      v.literal("DELIVERY_URL"),
      v.literal("REVISION_COMPLETE"),
      v.literal("MANUAL_INTERVENTION_ALERT"),
    ),
    recipientPhoneE164: v.string(),
    status: v.union(
      v.literal("PENDING"),
      v.literal("SENT"),
      v.literal("DELIVERED"),
      v.literal("FAILED"),
      v.literal("UNDELIVERED"),
    ),
    whatsappMessageId: v.optional(v.id("whatsappMessages")),
    correlationId: v.string(),
    provider: v.optional(v.string()),
    ...failureFields,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_status", ["status"]),

  // ==========================================================================
  // PHASE 12 — Customer Revision Loop
  //
  // `status` mirrors `projects.state` (full workflowStateValidator, optional)
  // because convex/stateMachine.ts's `transitionProject` patches
  // `revisionRequests.status = toState` directly using the same generic
  // `ProjectState` union it uses for projects/workflowRuns. LOAD-BEARING
  // fields for that module: `projectId`, `status`, `updatedAt`, and the
  // failure-metadata block below.
  // ==========================================================================
  revisionRequests: defineTable({
    projectId: v.id("projects"),
    leadId: v.id("leads"),
    status: v.optional(workflowStateValidator),
    requestedVia: v.literal("WHATSAPP"),
    inboundMessageId: v.optional(v.id("whatsappMessages")),
    scope: v.union(v.literal("SUPPORTED"), v.literal("MANUAL_INTERVENTION")),
    classification: v.optional(
      v.union(
        v.literal("COLOR_CHANGE"),
        v.literal("LOGO_REPLACE"),
        v.literal("TEXT_UPDATE"),
        v.literal("UNSUPPORTED"),
      ),
    ),
    description: v.string(), // human-readable summary of the requested change
    baseDeploymentId: v.id("deployments"), // live deployment this revision is scoped against; stays untouched on failure
    buildJobId: v.optional(v.id("buildJobs")),
    deploymentId: v.optional(v.id("deployments")),
    correlationId: v.string(),
    provider: v.optional(v.string()),
    ...failureFields,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_leadId", ["leadId"])
    .index("by_status", ["status"]),

  revisionAssets: defineTable({
    revisionRequestId: v.id("revisionRequests"),
    assetId: v.id("assets"),
    role: v.union(
      v.literal("LOGO"),
      v.literal("REFERENCE_IMAGE"),
      v.literal("OTHER"),
    ),
    createdAt: v.number(),
  }).index("by_revisionRequestId", ["revisionRequestId"]),

  // ==========================================================================
  // Orchestration primitives (Section 8 state machine, Section 10 idempotency
  // & durability rules)
  // ==========================================================================

  // One `workflowRuns` row per project's primary pipeline, plus one more per
  // revision loop (`revisionRequestId` set). LOAD-BEARING for
  // convex/stateMachine.ts's `transitionProject`, which looks a run up via
  // `.withIndex("by_project", ...)` (primary: the row among that project's
  // runs with no `revisionRequestId`) or `.withIndex("by_revisionRequest",
  // ...)` (revision runs), then patches `state`/`updatedAt`/the
  // failure-metadata block — those two index names and those fields must not
  // be renamed without updating that module.
  workflowRuns: defineTable({
    projectId: v.id("projects"),
    revisionRequestId: v.optional(v.id("revisionRequests")), // set for a revision loop's run; absent for the primary run
    runType: v.union(v.literal("PRIMARY"), v.literal("REVISION")),
    state: v.optional(workflowStateValidator),
    correlationId: v.string(),
    provider: v.optional(v.string()),
    ...failureFields,
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_revisionRequest", ["revisionRequestId"])
    .index("by_state", ["state"])
    .index("by_correlationId", ["correlationId"]),

  // Every external call creates a stageAttempt first, keyed by the
  // deterministic idempotency key `${projectId}:${stage}:${version}`
  // (Section 10). `leaseExpiresAt` enforces "no concurrent execution of same
  // stage" (an unexpired `IN_PROGRESS` row blocks a new attempt) and lets
  // `reconcileStaleAttempt` recover timed-out provider requests before a new
  // resource is created. LOAD-BEARING for convex/lib/stageAttempt.ts: field
  // names/types here (`idempotencyKey`, `status`, `attemptCount`,
  // `leaseExpiresAt`, `result`, `error`, `provider`, `providerRequestId`,
  // `startedAt`, `completedAt`) and the `by_idempotencyKey` index are read
  // and written by that module directly — do not rename without updating it.
  stageAttempts: defineTable({
    projectId: v.id("projects"),
    stage: v.string(), // e.g. "VOICE_CALL", "REQUIREMENTS_EXTRACTION", "REPOSITORY_PREPARATION", "DEVIN_BUILD", "BUILD_VALIDATION", "FIREBASE_DEPLOY", "WHATSAPP_DELIVERY", "REVISION_BUILD", ... (see PipelineStage in convex/stateMachine.ts)
    version: v.number(), // bumps on each admin/auto retry of this stage for this project — part of the idempotency key
    idempotencyKey: v.string(), // `${projectId}:${stage}:${version}` — application-enforced unique via by_idempotencyKey + .unique()
    status: v.union(
      v.literal("PENDING"),
      v.literal("IN_PROGRESS"),
      v.literal("COMPLETED"),
      v.literal("FAILED"),
    ),
    leaseExpiresAt: v.optional(v.number()),
    attemptCount: v.number(), // 1-based; incremented on each re-acquire of the lease
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    result: v.optional(v.any()), // last successful response; also what the replay-fallback interface serves back (Section 9)
    error: v.optional(
      v.object({
        message: v.string(),
        retryable: v.boolean(),
        code: v.optional(v.string()),
      }),
    ),
    provider: v.optional(providerName),
    providerRequestId: v.optional(v.string()),
    // --- Optional extensions beyond the stageAttempt.ts contract, safe to ---
    // --- populate from other stages without touching that module. ---
    workflowRunId: v.optional(v.id("workflowRuns")),
    correlationId: v.optional(v.string()),
    requestPayload: v.optional(v.any()),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_stage", ["projectId", "stage"])
    .index("by_leaseExpiresAt", ["leaseExpiresAt"]),

  // Every inbound webhook is stored here by provider + provider event ID
  // before any processing happens, so duplicate deliveries are dropped
  // deterministically (Section 10: "Every inbound webhook -> store in
  // webhookEvents by provider event ID before processing").
  webhookEvents: defineTable({
    provider: providerName,
    providerEventId: v.string(), // e.g. ElevenLabs conversation ID, Twilio message/status SID, GitHub Actions run ID
    dedupeKey: v.string(), // `${provider}:${providerEventId}` — application-enforced unique via by_dedupeKey + .unique()
    eventType: v.string(),
    signatureValid: v.boolean(),
    payload: v.any(),
    headers: v.optional(v.any()),
    projectId: v.optional(v.id("projects")), // resolved link, once known
    processed: v.boolean(),
    processingError: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_provider", ["provider"])
    .index("by_processed", ["processed"]),

  // Append-only audit trail. `transitionProject` (convex/stateMachine.ts)
  // inserts one row per state change here with exactly the fields below
  // (`projectId`, `revisionRequestId`, `eventType`, `fromState`, `toState`,
  // `stage`, `correlationId`, `metadata`, `createdAt`) — do not rename those
  // without updating that module. Other stages may also insert rows here
  // (e.g. `eventType: "WEBHOOK_RECEIVED"` / `"EXTERNAL_CALL"` /
  // `"ADMIN_ACTION"`) using only the fields relevant to that event; `eventType`
  // is a free-form string, not a closed union, for exactly that reason.
  activityEvents: defineTable({
    projectId: v.id("projects"),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    leadId: v.optional(v.id("leads")),
    eventType: v.string(),
    fromState: v.optional(workflowStateValidator),
    toState: v.optional(workflowStateValidator),
    stage: v.optional(v.string()),
    correlationId: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_createdAt", ["projectId", "createdAt"])
    .index("by_revisionRequestId", ["revisionRequestId"]),

  // Raw request/response audit log for every third-party call, separate
  // from `stageAttempts` (the idempotency/lease record) — this is what
  // powers the "Replay Last Response" admin control's history view (Section 9).
  integrationEvents: defineTable({
    projectId: v.optional(v.id("projects")),
    stageAttemptId: v.optional(v.id("stageAttempts")),
    provider: providerName,
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    eventType: v.string(),
    requestPayload: v.optional(v.any()),
    responsePayload: v.optional(v.any()),
    statusCode: v.optional(v.number()),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
    providerRequestId: v.optional(v.string()),
    isReplay: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_provider", ["provider"])
    .index("by_stageAttemptId", ["stageAttemptId"]),

  // ==========================================================================
  // Shared generated-site backend registry (Section 4.10) — admin-side
  // mirror/registry only; the shared generated-site Convex deployment
  // (`buildpilot-sites`, a separate deployment) is the source of truth for
  // live tenant data and enforces siteId isolation itself.
  // ==========================================================================
  siteSubmissions: defineTable({
    siteId: v.string(), // tenant isolation key, mirrors the shared generated-site deployment's siteId
    projectId: v.optional(v.id("projects")),
    type: v.union(v.literal("CONTACT_FORM"), v.literal("OTHER")),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    message: v.optional(v.string()),
    rawPayload: v.any(),
    status: v.union(
      v.literal("RECEIVED"),
      v.literal("SPAM_FLAGGED"),
      v.literal("FORWARDED"),
    ),
    ipAddress: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_siteId", ["siteId"])
    .index("by_projectId", ["projectId"]),

  // ==========================================================================
  // Added by convex/lib/externalCall.ts (Stage 1 / T1.4 — docs/task-plan.md
  // Section 3, contract #4 / PRD Section 9 "Demo Resilience — Replay
  // Fallback"). Added additively; nothing above this point is touched by
  // that module. `stageAttempts.result` (above) already IS the "last
  // successful response" cache per (projectId, stage) — this table only
  // holds the project-level on/off replay flag itself.
  // ==========================================================================
  externalCallReplayFlags: defineTable({
    projectId: v.id("projects"),
    enabled: v.boolean(),
    updatedAt: v.number(),
  }).index("by_projectId", ["projectId"]),
});
