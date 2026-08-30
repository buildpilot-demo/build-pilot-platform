export type Business = {
  _id: string;
  name: string;
  // Short, clean identifier extracted/filtered by the LLM lead-extraction
  // step (see convex/businesses.ts), meant to seed a GitHub repository slug.
  shortName?: string;
  category: string;
  phone?: string;
  normalizedPhone?: string;
  email?: string;
  address?: string;
  city?: string;
  area?: string;
  website?: string;
  // Whether the LLM extraction step judged this business to already have
  // its own site — shown as a hint, not used to hide the business from
  // results (see businesses:searchBusinesses).
  hasOwnWebsite?: boolean;
  // The context.dev listing/directory page this lead was found on (not
  // necessarily the business's own site).
  sourceUrl?: string;
  contactEligible: boolean;
  doNotContact: boolean;
  // When this business was first discovered — preserved across re-discovery
  // (see businesses:upsertSearchResults), so it reflects the original find,
  // not the most recent search that happened to surface it again.
  discoveredAt: number;
  // Populated once a call has been placed for this business (see
  // businesses:listBusinesses) so the Admin UI can route a row click to the
  // existing project instead of starting a new call.
  projectId?: string;
  leadStatus?: "selected" | "active" | "completed" | "cancelled";
};

export type Project = {
  _id: string;
  name?: string;
  state: string;
  liveUrl?: string;
  failedStage?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  retryCount?: number;
  maxRetries?: number;
  provider?: string;
  correlationId?: string;
  createdAt: number;
  updatedAt: number;
  // updatedAt - createdAt as of the last primary-state transition (see
  // stateMachine.ts) — total elapsed time so far, shown at the top of the
  // Activity Timeline.
  totalDurationMs?: number;
};

export type ActivityEvent = {
  _id: string;
  eventType?: string;
  stage: string;
  fromState?: string;
  toState?: string;
  timestamp: number;
  // Time since the previous activityEvents row for this project — see
  // stateMachine.ts::elapsedSincePreviousEvent. Omitted for the first event.
  elapsedMs?: number;
  correlationId?: string;
  message?: string;
  reason?: string;
  provider?: string;
  providerRequestId?: string;
  errorCode?: string;
};

export type DashboardData = {
  totals?: {
    projects?: number;
    active?: number;
    delivered?: number;
    needsAttention?: number;
  };
  projects?: Project[];
  recentActivity?: ActivityEvent[];
};

export type ProjectDetails = {
  project: Project;
  activity?: ActivityEvent[];
  workflowRun?: { _id: string; status: string; state: string; startedAt: number; updatedAt: number };
  business?: { _id: string; name: string; category: string; city?: string; phone?: string; website?: string };
  repository?: { url: string; owner: string; name: string; targetBranch: string; status: string };
  deployment?: { status: string; liveUrl?: string; previewUrl?: string; commitSha?: string; updatedAt: number };
  voiceSession?: { status: string; conversationId?: string; twilioCallSid?: string; startedAt?: number; completedAt?: number };
  transcript?: { text: string; language?: string; receivedAt: number };
  requirement?: { status: string };
  requirementVersion?: { structuredData: unknown; validationStatus: string; validationErrors?: string[]; createdAt: number };
  revisionRequest?: { _id: string; status: string; errorCode?: string; errorMessage?: string; retryable?: boolean; provider?: string };
  buildJob?: BuildJob;
};

// Mirrors convex/schema.ts::buildJobs' progress-tracking fields — see
// devin.ts::recordDevinProgress for how these get populated.
export type BuildJob = {
  _id: string;
  status: string;
  provider: string;
  sessionId?: string;
  targetBranch: string;
  resultCommitSha?: string;
  statusEnum?: string;
  pullRequestUrl?: string;
  lastPolledAt?: number;
  resumedFromBuildJobId?: string;
  resumedAt?: number;
  mergedAt?: number;
  mergeCommitSha?: string;
  mergeError?: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: number;
  updatedAt: number;
};

export type BuildProgressEvent = {
  _id: string;
  source: "devin_message" | "devin_status" | "github_commit";
  type?: string;
  message: string;
  occurredAt: number;
};

export type CachedResponse = { stage: string; cacheKey: string; lastSucceededAt: number };

// One business -> many leads/projects (see convex/businesses.ts::getBusinessDetails):
// every "Call" click on a business starts an independent project/workflow run,
// so the business detail view needs the full history, not just the latest.
export type BusinessDetails = {
  business: Business;
  projects: Project[];
  latestProjectId?: string;
};

export type HealthData = {
  status?: string;
  checkedAt?: number;
  services?: Array<{ name: string; status: string; latencyMs?: number; message?: string }>;
};
