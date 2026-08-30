import { defineSchema, defineTable } from "convex/server";
import { v, type Validator } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

import {
  FAILURE_STATES,
  PRIMARY_PROJECT_STATES,
  PROJECT_STATES,
  REVISION_STATES,
  type FailureState,
  type PrimaryProjectState,
  type ProjectState,
  type RevisionState,
} from "./stateMachine.js";

function literalUnion<T extends string>(values: readonly [T, ...T[]]): Validator<T> {
  return v.union(...values.map((value) => v.literal(value))) as Validator<T>;
}

export const projectStateValidator = literalUnion(
  PROJECT_STATES as unknown as readonly [ProjectState, ...ProjectState[]],
);
export const primaryProjectStateValidator = literalUnion(
  PRIMARY_PROJECT_STATES as unknown as readonly [PrimaryProjectState, ...PrimaryProjectState[]],
);
export const failureStateValidator = literalUnion(
  FAILURE_STATES as unknown as readonly [FailureState, ...FailureState[]],
);
export const revisionStateValidator = literalUnion(
  [...REVISION_STATES, "REVISION_BUILD_FAILED", "REVISION_DEPLOYMENT_FAILED", "REVISION_NOTIFICATION_FAILED"] as const,
);

const optionalFailureCoreFields = {
  failedStage: v.optional(v.string()),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  retryable: v.optional(v.boolean()),
  retryCount: v.optional(v.number()),
  maxRetries: v.optional(v.number()),
  lastAttemptAt: v.optional(v.number()),
};
const optionalFailureFields = {
  ...optionalFailureCoreFields,
  correlationId: v.optional(v.string()),
  provider: v.optional(v.string()),
  providerRequestId: v.optional(v.string()),
};
const optionalFailureFieldsWithProvider = {
  ...optionalFailureCoreFields,
  correlationId: v.optional(v.string()),
  providerRequestId: v.optional(v.string()),
};
const optionalFailureFieldsWithCorrelation = {
  ...optionalFailureCoreFields,
  provider: v.optional(v.string()),
  providerRequestId: v.optional(v.string()),
};

const workflowTypeValidator = v.union(v.literal("initial"), v.literal("revision"));
const attemptStatusValidator = v.union(
  v.literal("in_progress"),
  v.literal("reconciling"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("reconciled_not_found"),
);

export default defineSchema({
  // Convex Auth's own tables (users, authAccounts, authSessions, etc.) — T7.4.
  ...authTables,

  businesses: defineTable({
    source: v.string(),
    externalId: v.string(),
    name: v.string(),
    // Short, clean identifier derived by the LLM extraction/filtering step
    // (see convex/businesses.ts) from `name`, meant to seed a GitHub
    // repository slug at project-creation time (further slugified there).
    shortName: v.optional(v.string()),
    category: v.string(),
    phone: v.optional(v.string()),
    normalizedPhone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    area: v.optional(v.string()),
    country: v.optional(v.string()),
    // Left undefined for LLM-discovered leads: the LLM only reports whether
    // a business already has its own site (see hasOwnWebsite below), not
    // its URL. Only populated for manually-seeded/legacy rows that do have
    // one on file.
    website: v.optional(v.string()),
    // Whether the LLM extraction step judged this business to already have
    // its own dedicated website — surfaced so an operator can prioritize
    // leads without one, without those businesses being hidden from results
    // entirely (see convex/businesses.ts::extractAndFilterLeads).
    hasOwnWebsite: v.optional(v.boolean()),
    // The context.dev web-search result page this lead was extracted from
    // (a directory/listing/social page, not necessarily the business's own
    // site) — kept for audit/traceability, not shown as "the" website.
    sourceUrl: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    contactEligible: v.boolean(),
    doNotContact: v.boolean(),
    doNotContactReason: v.optional(v.string()),
    contactBasis: v.optional(v.string()),
    timezone: v.optional(v.string()),
    rawData: v.optional(v.any()),
    discoveredAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_source_external_id", ["source", "externalId"])
    .index("by_normalized_phone", ["normalizedPhone"])
    .index("by_city_category", ["city", "category"])
    .index("by_contact_eligibility", ["contactEligible", "doNotContact"]),

  leads: defineTable({
    businessId: v.id("businesses"),
    projectId: v.optional(v.id("projects")),
    status: v.union(v.literal("selected"), v.literal("active"), v.literal("completed"), v.literal("cancelled")),
    selectedBy: v.optional(v.string()),
    selectedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_business_id", ["businessId"])
    .index("by_project_id", ["projectId"])
    .index("by_status", ["status"]),

  projects: defineTable({
    leadId: v.id("leads"),
    businessId: v.id("businesses"),
    workflowRunId: v.optional(v.id("workflowRuns")),
    state: projectStateValidator,
    name: v.optional(v.string()),
    repositoryId: v.optional(v.id("repositories")),
    liveDeploymentId: v.optional(v.id("deployments")),
    activeRevisionRequestId: v.optional(v.id("revisionRequests")),
    liveUrl: v.optional(v.string()),
    externalCallMode: v.optional(v.union(v.literal("live"), v.literal("replay"))),
    externalCallReplayStages: v.optional(v.array(v.string())),
    correlationId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Recomputed as updatedAt - createdAt on every primary-state transition
    // (see stateMachine.ts) — total elapsed time so far, shown at the top of
    // the Admin app's Activity Timeline.
    totalDurationMs: v.optional(v.number()),
    ...optionalFailureFieldsWithCorrelation,
  })
    .index("by_lead_id", ["leadId"])
    .index("by_business_id", ["businessId"])
    .index("by_workflow_run_id", ["workflowRunId"])
    .index("by_state", ["state"])
    .index("by_workflow_run_state", ["workflowRunId", "state"])
    .index("by_correlation_id", ["correlationId"]),

  voiceSessions: defineTable({
    projectId: v.id("projects"),
    workflowRunId: v.id("workflowRuns"),
    provider: v.string(),
    conversationId: v.optional(v.string()),
    twilioCallSid: v.optional(v.string()),
    status: v.string(),
    targetPhone: v.string(),
    recordingUrl: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    ...optionalFailureFieldsWithProvider,
  })
    .index("by_project_id", ["projectId"])
    .index("by_workflow_run_id", ["workflowRunId"])
    .index("by_conversation_id", ["conversationId"])
    .index("by_twilio_call_sid", ["twilioCallSid"]),

  transcripts: defineTable({
    projectId: v.id("projects"),
    workflowRunId: v.id("workflowRuns"),
    voiceSessionId: v.id("voiceSessions"),
    provider: v.string(),
    providerTranscriptId: v.optional(v.string()),
    text: v.string(),
    language: v.optional(v.string()),
    speakerTurns: v.optional(v.any()),
    rawPayload: v.optional(v.any()),
    receivedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_project_id", ["projectId"])
    .index("by_voice_session_id", ["voiceSessionId"])
    .index("by_provider_transcript_id", ["provider", "providerTranscriptId"]),

  requirements: defineTable({
    projectId: v.id("projects"),
    workflowRunId: v.id("workflowRuns"),
    transcriptId: v.id("transcripts"),
    currentVersionId: v.optional(v.id("requirementVersions")),
    status: v.union(v.literal("processing"), v.literal("ready"), v.literal("valid"), v.literal("invalid")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project_id", ["projectId"])
    .index("by_transcript_id", ["transcriptId"])
    .index("by_status", ["status"]),

  requirementVersions: defineTable({
    requirementId: v.id("requirements"),
    projectId: v.id("projects"),
    version: v.number(),
    structuredData: v.any(),
    model: v.string(),
    promptVersion: v.string(),
    schemaVersion: v.string(),
    validationStatus: v.union(v.literal("pending"), v.literal("valid"), v.literal("invalid")),
    validationErrors: v.optional(v.array(v.string())),
    createdAt: v.number(),
  })
    .index("by_requirement_version", ["requirementId", "version"])
    .index("by_project_id", ["projectId"])
    .index("by_validation_status", ["validationStatus"]),

  buildJobs: defineTable({
    projectId: v.id("projects"),
    workflowRunId: v.id("workflowRuns"),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    type: workflowTypeValidator,
    provider: v.string(),
    status: v.string(),
    sessionId: v.optional(v.string()),
    repositoryId: v.id("repositories"),
    baseCommitSha: v.string(),
    targetBranch: v.string(),
    resultCommitSha: v.optional(v.string()),
    githubRunId: v.optional(v.string()),
    artifactChecksum: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Devin session progress mirror (T-progress): populated by
    // devin.ts::reconcileDevinStatus on every poll so the Admin UI can show
    // what Devin is doing without waiting for the session to finish.
    statusEnum: v.optional(v.string()),
    pullRequestUrl: v.optional(v.string()),
    lastPolledAt: v.optional(v.number()),
    lastKnownCommitSha: v.optional(v.string()),
    // Set when this build job continues a previous, still-resumable Devin
    // session (Retry Build after a timeout) instead of starting a fresh one.
    resumedFromBuildJobId: v.optional(v.id("buildJobs")),
    resumedAt: v.optional(v.number()),
    // Populated once the validated branch is auto-merged into the
    // repository's default branch after candidate validation succeeds.
    mergedAt: v.optional(v.number()),
    mergeCommitSha: v.optional(v.string()),
    mergeError: v.optional(v.string()),
    ...optionalFailureFieldsWithProvider,
  })
    .index("by_project_id", ["projectId"])
    .index("by_workflow_run_id", ["workflowRunId"])
    .index("by_revision_request_id", ["revisionRequestId"])
    .index("by_session_id", ["provider", "sessionId"])
    .index("by_status", ["status"]),

  // Fine-grained progress trail for a Devin build session (T-progress):
  // Devin's own session messages (GET /v1/sessions/{id}), status_enum
  // transitions, and new-commit-on-branch signals from GitHub, so the Admin
  // UI can show incremental progress while a build is still running instead
  // of only the coarse buildJobs.status.
  buildProgressEvents: defineTable({
    buildJobId: v.id("buildJobs"),
    projectId: v.id("projects"),
    source: v.union(v.literal("devin_message"), v.literal("devin_status"), v.literal("github_commit")),
    // Dedup key: Devin's message event_id, a "status:<enum>" marker, or a
    // commit SHA — combined with buildJobId, this must never be inserted
    // twice for the same build job.
    eventKey: v.string(),
    type: v.optional(v.string()),
    message: v.string(),
    occurredAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_build_job_timestamp", ["buildJobId", "occurredAt"])
    .index("by_build_job_event_key", ["buildJobId", "eventKey"])
    .index("by_project_id", ["projectId"]),

  deployments: defineTable({
    projectId: v.id("projects"),
    workflowRunId: v.id("workflowRuns"),
    buildJobId: v.id("buildJobs"),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    firebaseProjectId: v.string(),
    firebaseSiteId: v.string(),
    deploymentId: v.optional(v.string()),
    githubRunId: v.optional(v.string()),
    commitSha: v.string(),
    // The actual branch-HEAD commit deploy-firebase.yml runs against —
    // deployToFirebase pushes a `.env.production` config commit on top of
    // commitSha before dispatching the workflow (by ref, not by exact SHA),
    // so this is one commit ahead of commitSha and is what
    // reconcileFirebaseDeployment must filter GitHub Actions runs by.
    deployedCommitSha: v.optional(v.string()),
    artifactChecksum: v.string(),
    status: v.string(),
    previewUrl: v.optional(v.string()),
    liveUrl: v.optional(v.string()),
    validatedAt: v.optional(v.number()),
    promotedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    ...optionalFailureFields,
  })
    .index("by_project_id", ["projectId"])
    .index("by_workflow_run_id", ["workflowRunId"])
    .index("by_revision_request_id", ["revisionRequestId"])
    .index("by_firebase_deployment", ["firebaseSiteId", "deploymentId"])
    .index("by_status", ["status"]),

  notifications: defineTable({
    projectId: v.id("projects"),
    workflowRunId: v.id("workflowRuns"),
    deploymentId: v.id("deployments"),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    provider: v.string(),
    channel: v.literal("whatsapp"),
    recipient: v.string(),
    messageSid: v.optional(v.string()),
    status: v.string(),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    ...optionalFailureFieldsWithProvider,
  })
    .index("by_project_id", ["projectId"])
    .index("by_workflow_run_id", ["workflowRunId"])
    .index("by_revision_request_id", ["revisionRequestId"])
    .index("by_message_sid", ["provider", "messageSid"])
    .index("by_status", ["status"]),

  activityEvents: defineTable({
    projectId: v.id("projects"),
    workflowRunId: v.optional(v.id("workflowRuns")),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    eventType: v.optional(v.string()),
    stage: v.string(),
    fromState: v.optional(projectStateValidator),
    toState: v.optional(projectStateValidator),
    timestamp: v.number(),
    // Time since the previous activityEvents row for this project (any
    // stage/type — see stateMachine.ts's latestActivityTimestamp), i.e. how
    // long this step took after the one before it. Omitted for a project's
    // first event, which has no predecessor to measure from.
    elapsedMs: v.optional(v.number()),
    correlationId: v.string(),
    provider: v.optional(v.string()),
    providerRequestId: v.optional(v.string()),
    reason: v.optional(v.string()),
    message: v.optional(v.string()),
    metadata: v.optional(v.any()),
    ...optionalFailureCoreFields,
  })
    .index("by_project_timestamp", ["projectId", "timestamp"])
    .index("by_workflow_run_timestamp", ["workflowRunId", "timestamp"])
    .index("by_revision_timestamp", ["revisionRequestId", "timestamp"])
    .index("by_correlation_id", ["correlationId"])
    .index("by_stage_timestamp", ["stage", "timestamp"]),

  integrationEvents: defineTable({
    projectId: v.optional(v.id("projects")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    stageAttemptId: v.optional(v.id("stageAttempts")),
    provider: v.string(),
    providerRequestId: v.optional(v.string()),
    stage: v.string(),
    operation: v.string(),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    mode: v.optional(v.union(v.literal("live"), v.literal("replay"))),
    outcome: v.union(v.literal("started"), v.literal("succeeded"), v.literal("failed")),
    correlationId: v.string(),
    request: v.optional(v.any()),
    response: v.optional(v.any()),
    sanitizedError: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    timestamp: v.number(),
  })
    .index("by_project_stage_timestamp", ["projectId", "stage", "timestamp"])
    .index("by_provider_request_id", ["provider", "providerRequestId"])
    .index("by_correlation_id", ["correlationId"])
    .index("by_stage_attempt_id", ["stageAttemptId"]),

  assets: defineTable({
    projectId: v.id("projects"),
    businessId: v.optional(v.id("businesses")),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    storageId: v.id("_storage"),
    originalFilename: v.string(),
    sanitizedFilename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    checksum: v.optional(v.string()),
    provenance: v.string(),
    status: v.union(v.literal("pending"), v.literal("validated"), v.literal("rejected")),
    rejectionReason: v.optional(v.string()),
    // Populated for licensed imagery sourced outside the customer's own
    // uploads; left undefined for customer-provided assets, which carry no
    // license.
    licenseType: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    attributionText: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_project_id", ["projectId"])
    .index("by_revision_request_id", ["revisionRequestId"])
    .index("by_storage_id", ["storageId"]),

  revisionRequests: defineTable({
    projectId: v.id("projects"),
    leadId: v.id("leads"),
    workflowRunId: v.id("workflowRuns"),
    status: revisionStateValidator,
    requestText: v.optional(v.string()),
    scope: v.union(v.literal("supported"), v.literal("manual_intervention")),
    baseCommitSha: v.optional(v.string()),
    workingBranch: v.optional(v.string()),
    resultCommitSha: v.optional(v.string()),
    receivedAt: v.number(),
    queuedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
    ...optionalFailureFields,
  })
    .index("by_project_received_at", ["projectId", "receivedAt"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_workflow_run_id", ["workflowRunId"])
    .index("by_status_received_at", ["status", "receivedAt"]),

  revisionAssets: defineTable({
    revisionRequestId: v.id("revisionRequests"),
    projectId: v.id("projects"),
    assetId: v.id("assets"),
    role: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_revision_request_id", ["revisionRequestId"])
    .index("by_project_id", ["projectId"])
    .index("by_asset_id", ["assetId"]),

  whatsappMessages: defineTable({
    projectId: v.optional(v.id("projects")),
    leadId: v.optional(v.id("leads")),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    provider: v.literal("twilio"),
    messageSid: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    from: v.string(),
    to: v.string(),
    body: v.optional(v.string()),
    mediaCount: v.number(),
    status: v.string(),
    optOutDetected: v.optional(v.boolean()),
    receivedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_message_sid", ["provider", "messageSid"])
    .index("by_project_id", ["projectId"])
    .index("by_revision_request_id", ["revisionRequestId"])
    .index("by_sender_received_at", ["from", "receivedAt"]),

  workflowRuns: defineTable({
    projectId: v.id("projects"),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    type: workflowTypeValidator,
    state: projectStateValidator,
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
    version: v.number(),
    correlationId: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
    ...optionalFailureFieldsWithCorrelation,
  })
    .index("by_project_id", ["projectId"])
    .index("by_project_type", ["projectId", "type"])
    .index("by_revision_request_id", ["revisionRequestId"])
    .index("by_state", ["state"])
    .index("by_status_state", ["status", "state"])
    .index("by_correlation_id", ["correlationId"]),

  stageAttempts: defineTable({
    projectId: v.optional(v.id("projects")),
    scopeKey: v.optional(v.string()),
    workflowRunId: v.optional(v.id("workflowRuns")),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    stage: v.string(),
    version: v.union(v.string(), v.number()),
    attemptNumber: v.number(),
    idempotencyKey: v.string(),
    correlationId: v.optional(v.string()),
    status: attemptStatusValidator,
    leaseOwner: v.optional(v.string()),
    leaseAcquiredAt: v.optional(v.number()),
    leaseExpiresAt: v.number(),
    provider: v.optional(v.string()),
    providerRequestId: v.optional(v.string()),
    result: v.optional(v.any()),
    error: v.optional(v.any()),
    reconciliationToken: v.optional(v.string()),
    reconciliationStartedAt: v.optional(v.number()),
    reconciledAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    nextRetryAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.number(),
    ...optionalFailureCoreFields,
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_project_stage", ["projectId", "stage"])
    .index("by_scope_stage", ["scopeKey", "stage"])
    .index("by_workflow_run_stage_attempt", ["workflowRunId", "stage", "attemptNumber"])
    .index("by_status_lease_expiry", ["status", "leaseExpiresAt"])
    .index("by_next_retry_at", ["nextRetryAt"])
    .index("by_correlation_id", ["correlationId"]),

  webhookEvents: defineTable({
    provider: v.string(),
    providerEventId: v.string(),
    eventType: v.string(),
    status: v.union(
      v.literal("received"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("failed"),
      v.literal("ignored"),
    ),
    signatureValidated: v.boolean(),
    projectId: v.optional(v.id("projects")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    correlationId: v.optional(v.string()),
    payload: v.any(),
    error: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_provider_event_id", ["provider", "providerEventId"])
    .index("by_status_received_at", ["status", "receivedAt"])
    .index("by_project_received_at", ["projectId", "receivedAt"]),

  callAttempts: defineTable({
    projectId: v.id("projects"),
    workflowRunId: v.id("workflowRuns"),
    voiceSessionId: v.optional(v.id("voiceSessions")),
    attemptNumber: v.number(),
    idempotencyKey: v.string(),
    provider: v.string(),
    conversationId: v.optional(v.string()),
    twilioCallSid: v.optional(v.string()),
    targetPhone: v.string(),
    status: v.string(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    ...optionalFailureFieldsWithProvider,
  })
    .index("by_project_attempt", ["projectId", "attemptNumber"])
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_conversation_id", ["provider", "conversationId"])
    .index("by_twilio_call_sid", ["twilioCallSid"]),

  repositories: defineTable({
    projectId: v.id("projects"),
    provider: v.literal("github"),
    githubRepositoryId: v.string(),
    owner: v.string(),
    name: v.string(),
    url: v.string(),
    isPrivate: v.boolean(),
    defaultBranch: v.string(),
    targetBranch: v.string(),
    initialCommitSha: v.optional(v.string()),
    templateVersionId: v.optional(v.id("templateVersions")),
    githubRunId: v.optional(v.string()),
    status: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    ...optionalFailureFieldsWithProvider,
  })
    .index("by_project_id", ["projectId"])
    .index("by_github_repository_id", ["githubRepositoryId"])
    .index("by_owner_name", ["owner", "name"]),

  generatedDocuments: defineTable({
    projectId: v.id("projects"),
    workflowRunId: v.id("workflowRuns"),
    requirementVersionId: v.id("requirementVersions"),
    type: v.literal("site_config"),
    path: v.string(),
    content: v.string(),
    checksum: v.string(),
    version: v.number(),
    createdAt: v.number(),
  })
    .index("by_project_type", ["projectId", "type"])
    .index("by_project_path", ["projectId", "path"])
    .index("by_requirement_version_id", ["requirementVersionId"]),

  templateVersions: defineTable({
    name: v.string(),
    version: v.string(),
    repositoryUrl: v.string(),
    commitSha: v.string(),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("retired")),
    validationRunId: v.optional(v.string()),
    validatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name_version", ["name", "version"])
    .index("by_status", ["status"])
    .index("by_commit_sha", ["commitSha"]),

  // Control-plane bookkeeping copy only — one row per project, written by
  // deployments.ts::startDeployment so the admin app can show a project's
  // site/tenant info. The *authoritative* siteTenants + siteSubmissions
  // tables that customer-facing forms actually read/write live on the
  // separate, shared buildpilot-sites Convex project (see
  // sites-backend/convex/schema.ts in this repo) — deployToFirebase
  // provisions a row there too, cross-deployment, via ConvexHttpClient.
  siteTenants: defineTable({
    projectId: v.id("projects"),
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

  externalCallResponses: defineTable({
    projectId: v.optional(v.id("projects")),
    scopeKey: v.string(),
    stage: v.string(),
    cacheKey: v.string(),
    response: v.any(),
    replayHandler: v.optional(
      v.object({
        functionName: v.string(),
        args: v.optional(v.any()),
      }),
    ),
    lastSucceededAt: v.number(),
  })
    .index("by_project_stage_cache_key", ["projectId", "stage", "cacheKey"])
    .index("by_scope_stage_cache_key", ["scopeKey", "stage", "cacheKey"]),

  externalReplayRequests: defineTable({
    projectId: v.optional(v.id("projects")),
    scopeKey: v.string(),
    stage: v.string(),
    cacheKey: v.string(),
    status: v.union(v.literal("pending"), v.literal("claimed")),
    requestedAt: v.number(),
    claimedAt: v.optional(v.number()),
  })
    .index("by_project_stage_cache_status", ["projectId", "stage", "cacheKey", "status"])
    .index("by_scope_stage_cache_status", ["scopeKey", "stage", "cacheKey", "status"])
    .index("by_status_requested_at", ["status", "requestedAt"]),

  externalCallSettings: defineTable({
    scope: v.string(),
    mode: v.union(v.literal("live"), v.literal("replay")),
    updatedAt: v.number(),
  }).index("by_scope", ["scope"]),
});
