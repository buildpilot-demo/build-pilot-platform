import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v, type GenericId, type Value } from "convex/values";

import { callExternal, type ExternalCallContext } from "./lib/externalCall.js";
import { transitionProject, type StateMachineContext } from "./stateMachine.js";

declare const process: { env: Record<string, string | undefined> };

type ProjectId = GenericId<"projects">;
type BuildJobId = GenericId<"buildJobs">;
type RevisionRequestId = GenericId<"revisionRequests">;

type PriorAttempt = { buildJobId: BuildJobId; sessionId: string };

type BuildContext = {
  projectId: ProjectId;
  workflowRunId: GenericId<"workflowRuns">;
  revisionRequestId?: RevisionRequestId;
  correlationId: string;
  repositoryId: GenericId<"repositories">;
  repositoryUrl: string;
  owner: string;
  repositoryName: string;
  defaultBranch: string;
  baseCommitSha: string;
  targetBranch: string;
  type: "initial" | "revision";
  requestText?: string;
  // Most recent *failed* build attempt for this project/revision that still
  // has a Devin sessionId — used by dispatchDevinBuild to detect "Devin
  // actually kept working after we gave up on it" and resume instead of
  // rebuilding from scratch. Only ever a "failed" row (see loadBuildContext)
  // so this never interferes with a genuinely in-flight build.
  priorAttempt?: PriorAttempt;
};

type ActiveBuild = BuildContext & {
  buildJobId: BuildJobId;
  sessionId: string;
  status: string;
  resultCommitSha?: string;
  statusEnum?: string;
  lastKnownCommitSha?: string;
};

type ProviderResponse = { status: number; requestId: string; body: Value };

type ProgressEventInput = {
  eventKey: string;
  source: "devin_message" | "devin_status" | "github_commit";
  type?: string;
  message: string;
  occurredAt: number;
};

const buildContextRef = makeFunctionReference<"query">("devin:loadBuildContext");
const activeBuildRef = makeFunctionReference<"query">("devin:loadActiveBuild");
const queueRef = makeFunctionReference<"mutation">("devin:queueBuild");
const startedRef = makeFunctionReference<"mutation">("devin:markBuildStarted");
const resumeRef = makeFunctionReference<"mutation">("devin:resumeBuildAttempt");
const markContinuedRef = makeFunctionReference<"mutation">("devin:markBuildContinued");
const validatingRef = makeFunctionReference<"mutation">("devin:markBuildValidating");
const completedRef = makeFunctionReference<"mutation">("devin:completeBuildValidation");
const mergedRef = makeFunctionReference<"mutation">("devin:markBuildMerged");
const mergeFailedRef = makeFunctionReference<"mutation">("devin:markBuildMergeFailed");
const failedRef = makeFunctionReference<"mutation">("devin:failBuild");
const failTimeoutRef = makeFunctionReference<"mutation">("devin:failBuildTimeout");
const timeoutRef = makeFunctionReference<"action">("devin:checkBuildTimeout");
const reconcileDevinStatusRef = makeFunctionReference<"action">("devin:reconcileDevinStatus");
const reconcileCandidateValidationRef = makeFunctionReference<"action">("devin:reconcileCandidateValidation");
const candidateTimeoutRef = makeFunctionReference<"action">("devin:checkCandidateValidationTimeout");
const loadProjectStateRef = makeFunctionReference<"query">("devin:loadProjectState");
// Self-reference used only by checkBuildDispatchTimeout's watchdog — kept
// distinct from dispatchDevinBuild's own definition below since a Convex
// action can't call itself directly, only via a function reference.
const dispatchDevinBuildSelfRef = makeFunctionReference<"action">("devin:dispatchDevinBuild");
const recordProgressRef = makeFunctionReference<"mutation">("devin:recordDevinProgress");
const deployRef = makeFunctionReference<"action">("deployments:deployToFirebase");

// Devin's GET /v1/sessions/{id} status_enum values that mean the session is
// gone for good and can't be resumed with a follow-up message.
const UNRESUMABLE_STATUS_ENUMS = new Set(["expired"]);
const FINISHED_STATUS_ENUMS = new Set(["finished"]);
// Devin stopped actively working and is waiting on a human reply ("Devin is
// awaiting instructions" in the web app) — most commonly seen after a resume
// message, where Devin re-verifies the existing work, decides nothing needs
// to change, and goes idle instead of formally ending the session. Since
// this pipeline never sends a follow-up reply, a session sitting here forever
// isn't "still building" — reconcileDevinStatus treats it as finished
// whenever there's already a commit on the branch to validate.
const IDLE_STATUS_ENUMS = new Set(["blocked", "suspend_requested", "suspend_requested_frontend"]);

// Poll frequently (demo target: every 5s) so a "FINAL:" commit on
// context.targetBranch — the authoritative signal that Devin has finished
// (see FINAL_COMMIT_PREFIX) — is picked up quickly and the project advances
// out of DEVIN_BUILDING with minimal lag.
const DEVIN_STATUS_POLL_INTERVAL_MS = Number(process.env.DEVIN_STATUS_POLL_INTERVAL_MS ?? 5_000);
const CANDIDATE_VALIDATION_POLL_INTERVAL_MS = Number(process.env.CANDIDATE_VALIDATION_POLL_INTERVAL_MS ?? 15_000);
const CANDIDATE_VALIDATION_TIMEOUT_MS = Number(process.env.CANDIDATE_VALIDATION_TIMEOUT_MS ?? 1_800_000);
// Bounds the gap between REPOSITORY_READY and BUILD_QUEUED: normally
// github.ts::completeRepositoryValidation schedules dispatchDevinBuild
// directly once repository validation succeeds, but if that action never
// gets to run its own cleanup (an uncaught error or a platform-level
// timeout killing it mid-flight), the project would otherwise sit at
// REPOSITORY_READY forever with no automatic path forward.
// checkBuildDispatchTimeout is scheduled once, alongside dispatchDevinBuild,
// to self-heal that case the same way an operator's "Resume" click does.
const BUILD_DISPATCH_WATCHDOG_MS = Number(process.env.BUILD_DISPATCH_WATCHDOG_MS ?? 600_000);
// Devin's own session status_enum can lag or land on a non-terminal/ambiguous
// value (see IDLE_STATUS_ENUMS above) even after it has genuinely finished
// and pushed. dispatchDevinBuild's prompts instruct Devin to make its last
// commit's message start with this prefix once the site is complete, so
// reconcileDevinStatus can treat that commit — GitHub ground truth — as an
// authoritative "done" signal independent of whatever the session API
// reports.
const FINAL_COMMIT_PREFIX = "FINAL:";

// Build instructions, generalized from docs/DEVIN_3D_WEBSITE_SPEC.md's
// DEVIN_PROMPT for any business (not just the spec's restaurant example) —
// folded directly into the Devin prompt instead of a separate
// SITE_BRIEF.md file, since src/site.config.ts (see documents.ts's
// buildSiteConfig3dContent) is now the only generated document and already
// carries every business-specific value referenced below.
//
// siteConfig.variant selects which of two shapes this project got:
// "cinematic" when its business category matched a real image/frame asset
// collection, or "plain" when it didn't (see resolveAssetCollection in
// lib/siteConfig3d.ts) — a mismatched category (e.g. an ecommerce business
// getting restaurant photography) must never happen, so a "plain" site
// deliberately has no assets.* / hero frames / product images to reach for
// at all. Devin is told to read siteConfig.variant itself and build
// accordingly, rather than this prompt guessing which one applies.
const SITE_BUILD_INSTRUCTIONS = `Read src/site.config.ts as the single source of truth for content, assets, timing, and styling — this template has no separate brief file. Read siteConfig.variant first: it is either "cinematic" or "plain", and determines everything below.

If siteConfig.variant is "cinematic": read siteConfig.assets.collection once and use only public/assets/{that collection}; never inspect, scan, or fall back to a sibling asset collection under public/assets. Build (or complete) exactly three sections in this order: (1) a pinned cinematic hero whose scroll progress scrubs the frame sequence at siteConfig.hero.framesDirectory, drawn with cover-style canvas 2D and the configured focal point, with siteConfig.hero.chapters crossfaded above it as accessible HTML at their configured progress ranges; (2) a pinned horizontal products/services rail driven by siteConfig.productsSection.items, translated by measured rail width (rail.scrollWidth - viewport width), never a hardcoded pixel value; (3) a normal-flow enquiry section built from siteConfig.enquirySection (its fields, enquiryTypes, and consentLabel) that reuses the existing form component if present, wiring its onSubmit to call the shared Convex backend's "siteSubmissions:submitInquiry" mutation (via makeFunctionReference<"mutation">("siteSubmissions:submitInquiry") from "convex/server" — see convex/README.md — with siteId from VITE_SITE_ID and the form's fields) using the already-configured convexUrl/siteId from src/lib/convex.ts; if VITE_CONVEX_URL/VITE_SITE_ID are unset or the mutation call fails, fall back to honest client-side validation and siteConfig.enquirySection.disconnectedMessage — never invent a submission success or a different API endpoint. Use requestAnimationFrame for canvas and rail updates, cap the decoded hero-frame cache at siteConfig.hero.maxCachedFrames with loadConcurrency siteConfig.hero.loadConcurrency, and never intercept wheel/touch input or implement custom smooth scrolling. Resolve every product image strictly as siteConfig.assets.productsDirectory + the item's filename; reject any filename containing a path separator or "..". Do not use Three.js, React Three Fiber, WebGL shaders, GSAP, Lenis, locomotive-scroll, or carousel libraries, and do not add new dependencies. Under prefers-reduced-motion, show the static poster frame with all hero copy visible, render products as a vertical list, and keep the form in normal flow.

If siteConfig.variant is "plain": there is no image or frame asset collection for this business — do not reference, search for, or substitute any image from public/assets, and do not add stock photography, placeholder images, or any animated/scroll-driven hero. Build a normal, well-designed static site with exactly three sections in this order: (1) a plain hero built from siteConfig.hero (eyebrow, heading, body, primaryCta, secondaryCta) using typography, color, and layout only; (2) a highlights section built from siteConfig.highlightsSection.items (name + description text only, e.g. as cards or a list — no image placeholders); (3) the same enquiry section rules as above, built from siteConfig.enquirySection. Polish this with clean spacing, typography, and the configured palette — it should look intentional and complete, not like a placeholder missing its images.

In both cases: keep the page keyboard-accessible with WCAG AA contrast and semantic headings. Do not use Playwright or any other browser-automation tool to screenshot or visually inspect the built sections — this template is entirely config-driven from src/site.config.ts against an already-validated layout, so there is no meaningful visual regression risk; a successful npm run build is sufficient verification, so spend no build time on screenshot-based QA.`;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function object(value: Value): Record<string, Value> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, Value>;
  throw new Error("Provider returned an unexpected response");
}

function sessionId(body: Value): string {
  const value = object(body);
  const id = value.session_id ?? value.id;
  if (typeof id !== "string" || !id) throw new Error("Devin response did not include a session ID");
  return id;
}

type SessionDetails = {
  statusEnum?: string;
  rawStatus: string;
  pullRequestUrl?: string;
  messages: Array<{ eventId: string; type: string; message: string; occurredAt: number }>;
};

// Parses GET /v1/sessions/{id}'s status_enum, messages (session-level
// progress events), and pull_request out of the raw response body — this is
// the "intermediate event update" the Devin API exposes, so we don't have to
// rely solely on polling GitHub commits to know what Devin is doing.
function sessionDetails(body: Value): SessionDetails {
  const value = object(body);
  const statusEnum = typeof value.status_enum === "string" ? value.status_enum : undefined;
  const rawStatus = String(value.status ?? "unknown").toLowerCase();
  const pullRequest = value.pull_request;
  const pullRequestUrl =
    pullRequest !== null && typeof pullRequest === "object" && !Array.isArray(pullRequest) && typeof (pullRequest as Record<string, Value>).url === "string"
      ? String((pullRequest as Record<string, Value>).url)
      : undefined;
  const rawMessages = Array.isArray(value.messages) ? value.messages : [];
  const messages = rawMessages.flatMap((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, Value>;
    const eventId = typeof record.event_id === "string" ? record.event_id : undefined;
    const message = typeof record.message === "string" ? record.message : undefined;
    if (!eventId || !message) return [];
    const parsedTimestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
    return [{
      eventId,
      type: typeof record.type === "string" ? record.type : "message",
      message,
      occurredAt: Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now(),
    }];
  });
  return { statusEnum, rawStatus, pullRequestUrl, messages };
}

// Lightweight, uncached probe of the target branch's HEAD commit — used to
// decide whether a retry should resume prior work instead of starting over.
// Deliberately bypasses callExternal/providerCall: this is a pure read used
// only to inform a decision, not a stage outcome that needs replay/audit
// support, and a 404 (branch doesn't exist yet) is an expected, non-error
// outcome here rather than something to throw on.
async function fetchBranchHead(owner: string, repositoryName: string, branch: string): Promise<{ sha: string; message: string } | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repositoryName}/branches/${encodeURIComponent(branch)}`, { headers: githubHeaders() });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    const commit = body.commit as Record<string, unknown> | undefined;
    const sha = typeof commit?.sha === "string" ? commit.sha : null;
    if (!sha) return null;
    const innerCommit = commit?.commit as Record<string, unknown> | undefined;
    const message = typeof innerCommit?.message === "string" ? innerCommit.message : "";
    return { sha, message };
  } catch {
    return null;
  }
}

async function fetchBranchHeadSha(owner: string, repositoryName: string, branch: string): Promise<string | null> {
  const head = await fetchBranchHead(owner, repositoryName, branch);
  return head?.sha ?? null;
}

// Devin is instructed (see dispatchDevinBuild's prompts) to prefix its last
// commit message with "FINAL:" once the site is complete — treated as
// authoritative regardless of casing/leading whitespace.
function isFinalCommit(message: string): boolean {
  return message.trim().toUpperCase().startsWith(FINAL_COMMIT_PREFIX);
}

async function providerCall(
  ctx: ExternalCallContext,
  config: {
    projectId: ProjectId;
    correlationId: string;
    stage: string;
    cacheKey: string;
    provider: "devin" | "github";
    url: string;
    method?: string;
    headers: Record<string, string>;
    body?: Value;
    replayHandler: string;
    replayArgs?: Record<string, Value>;
  },
): Promise<ProviderResponse> {
  return await callExternal<ProviderResponse>(ctx, {
    projectId: config.projectId,
    stage: config.stage,
    version: config.cacheKey,
    cacheKey: config.cacheKey,
    provider: config.provider,
    correlationId: config.correlationId,
    replayHandler: { functionName: config.replayHandler, args: config.replayArgs },
    providerRequestId: (response) => response.requestId,
    live: async (attempt) => {
      const response = await fetch(config.url, {
        method: config.method ?? "GET",
        headers: config.headers,
        body: config.body === undefined ? undefined : JSON.stringify(config.body),
      });
      const raw = await response.text();
      const requestId = response.headers.get("x-request-id") ?? response.headers.get("x-github-request-id") ?? `${config.provider}:${response.status}:${config.cacheKey}`;
      await attempt.recordProviderRequest(requestId);
      let body: Value = null;
      if (raw) {
        try { body = JSON.parse(raw) as Value; } catch { body = raw; }
      }
      if (!response.ok) throw new Error(`${config.provider} request failed (${response.status}): ${raw.slice(0, 500)}`);
      return { status: response.status, requestId, body };
    },
  });
}

function githubHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${required("GITHUB_TOKEN")}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function devinHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${required("DEVIN_API_KEY")}`, "Content-Type": "application/json" };
}

function devinBaseUrl(): string {
  return (
    process.env.DEVIN_API_BASE_URL?.trim() ||
    process.env.DEVIN_API_URL?.trim() ||
    "https://api.devin.ai/v1"
  )
    .replace(/\/$/, "")
    .replace(/\/sessions$/, "");
}

export const loadBuildContext = internalQueryGeneric({
  args: { projectId: v.id("projects"), revisionRequestId: v.optional(v.id("revisionRequests")), targetBranch: v.optional(v.string()) },
  handler: async (ctx, args): Promise<BuildContext> => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project?.repositoryId) throw new Error(`Project ${args.projectId} has no repository`);
    const repository = await ctx.db.get("repositories", project.repositoryId);
    if (!repository?.initialCommitSha) throw new Error("Repository is not initialized");
    let workflowRunId = project.workflowRunId;
    let requestText: string | undefined;
    if (args.revisionRequestId) {
      const revision = await ctx.db.get("revisionRequests", args.revisionRequestId);
      if (!revision || revision.projectId !== args.projectId) throw new Error("Revision request does not belong to project");
      workflowRunId = revision.workflowRunId;
      requestText = revision.requestText;
    }
    if (!workflowRunId) throw new Error("Project has no workflow run");
    const latestBuild = await ctx.db
      .query("buildJobs")
      .withIndex("by_project_id", (query) => query.eq("projectId", args.projectId))
      .order("desc")
      .first();
    const baseCommitSha = args.revisionRequestId
      ? latestBuild?.resultCommitSha ?? repository.initialCommitSha
      : repository.initialCommitSha;
    // Only ever a *failed* attempt: an in-flight (queued/building/validating)
    // or already-completed row must never be treated as "abandoned work to
    // resume" — that path is exclusively for retries after a failure/timeout
    // (see dispatchDevinBuild).
    const priorFailedBuild = (
      await ctx.db.query("buildJobs").withIndex("by_project_id", (query) => query.eq("projectId", args.projectId)).order("desc").take(20)
    ).find((row) => row.status === "failed" && Boolean(row.sessionId) && (args.revisionRequestId ? row.revisionRequestId === args.revisionRequestId : !row.revisionRequestId));
    return {
      projectId: args.projectId,
      workflowRunId,
      revisionRequestId: args.revisionRequestId,
      correlationId: project.correlationId,
      repositoryId: repository._id,
      repositoryUrl: repository.url,
      owner: repository.owner,
      repositoryName: repository.name,
      defaultBranch: repository.defaultBranch,
      baseCommitSha,
      targetBranch: args.targetBranch ?? (args.revisionRequestId ? `buildpilot/revision-${String(args.revisionRequestId).slice(-8)}` : repository.targetBranch),
      type: args.revisionRequestId ? "revision" : "initial",
      requestText,
      priorAttempt: priorFailedBuild ? { buildJobId: priorFailedBuild._id, sessionId: priorFailedBuild.sessionId! } : undefined,
    };
  },
});

export const loadActiveBuild = internalQueryGeneric({
  args: { projectId: v.id("projects"), buildJobId: v.optional(v.id("buildJobs")) },
  handler: async (ctx, args): Promise<ActiveBuild> => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project?.repositoryId) throw new Error("Project repository is unavailable");
    const repository = await ctx.db.get("repositories", project.repositoryId);
    if (!repository) throw new Error("Repository not found");
    const build = args.buildJobId
      ? await ctx.db.get("buildJobs", args.buildJobId)
      : await ctx.db.query("buildJobs").withIndex("by_project_id", (query) => query.eq("projectId", args.projectId)).order("desc").first();
    if (!build || build.projectId !== args.projectId || !build.sessionId) throw new Error("No active Devin build was found");
    return {
      projectId: args.projectId,
      workflowRunId: build.workflowRunId,
      revisionRequestId: build.revisionRequestId,
      correlationId: project.correlationId,
      repositoryId: repository._id,
      repositoryUrl: repository.url,
      owner: repository.owner,
      repositoryName: repository.name,
      defaultBranch: repository.defaultBranch,
      baseCommitSha: build.baseCommitSha,
      targetBranch: build.targetBranch,
      type: build.type,
      buildJobId: build._id,
      sessionId: build.sessionId,
      status: build.status,
      resultCommitSha: build.resultCommitSha,
      statusEnum: build.statusEnum,
      lastKnownCommitSha: build.lastKnownCommitSha,
    };
  },
});

export const queueBuild = internalMutationGeneric({
  args: {
    projectId: v.id("projects"), workflowRunId: v.id("workflowRuns"), revisionRequestId: v.optional(v.id("revisionRequests")),
    correlationId: v.string(), repositoryId: v.id("repositories"), baseCommitSha: v.string(), targetBranch: v.string(), type: v.union(v.literal("initial"), v.literal("revision")),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) throw new Error("Project not found");
    // Handles both the initial dispatch (REPOSITORY_READY -> BUILD_QUEUED)
    // and admin retries of a failed/timed-out build (BUILD_VALIDATION_FAILED
    // or MANUAL_INTERVENTION_REQUIRED -> BUILD_QUEUED, both valid edges in
    // stateMachine.ts's TRANSITIONS graph). Only fire the transition from
    // these known predecessor states — unlike voiceCalls.ts's queueCall,
    // Devin builds can be mid-flight (DEVIN_BUILDING/DEVIN_REVISING) when
    // this mutation replays, and those states have no edge to
    // BUILD_QUEUED/REVISION_QUEUED, so a blanket "state !== target" check
    // would throw on replay instead of falling through to the existing-job
    // idempotency check below.
    if (args.type === "initial" && ["REPOSITORY_READY", "BUILD_VALIDATION_FAILED", "MANUAL_INTERVENTION_REQUIRED"].includes(project.state)) {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "BUILD_QUEUED", { workflowRunId: args.workflowRunId, correlationId: args.correlationId, stage: "DEVIN_BUILD" });
    } else if (args.type === "revision" && args.revisionRequestId) {
      const revision = await ctx.db.get("revisionRequests", args.revisionRequestId);
      if (revision && ["REVISION_ASSETS_RECEIVED", "REVISION_BUILD_FAILED"].includes(revision.status)) {
        await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "REVISION_QUEUED", { workflowRunId: args.workflowRunId, revisionRequestId: args.revisionRequestId, correlationId: args.correlationId, stage: "DEVIN_BUILD" });
      }
    }
    const existing = await ctx.db.query("buildJobs")
      .filter((query) => query.and(query.eq(query.field("projectId"), args.projectId), query.eq(query.field("targetBranch"), args.targetBranch), query.eq(query.field("baseCommitSha"), args.baseCommitSha)))
      .order("desc").first();
    if (existing && ["queued", "building", "validating", "completed"].includes(existing.status)) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("buildJobs", {
      projectId: args.projectId,
      workflowRunId: args.workflowRunId,
      revisionRequestId: args.revisionRequestId,
      type: args.type,
      provider: "devin",
      status: "queued",
      repositoryId: args.repositoryId,
      baseCommitSha: args.baseCommitSha,
      targetBranch: args.targetBranch,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markBuildStarted = internalMutationGeneric({
  args: { projectId: v.id("projects"), buildJobId: v.id("buildJobs"), workflowRunId: v.id("workflowRuns"), revisionRequestId: v.optional(v.id("revisionRequests")), correlationId: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch("buildJobs", args.buildJobId, { sessionId: args.sessionId, status: "building", startedAt: now, updatedAt: now, providerRequestId: args.sessionId });
    const project = await ctx.db.get("projects", args.projectId);
    if (args.revisionRequestId) {
      const revision = await ctx.db.get("revisionRequests", args.revisionRequestId);
      if (revision?.status === "REVISION_QUEUED") await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "DEVIN_REVISING", { workflowRunId: args.workflowRunId, revisionRequestId: args.revisionRequestId, correlationId: args.correlationId, stage: "DEVIN_BUILD" });
    } else if (project?.state === "BUILD_QUEUED") {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "DEVIN_BUILDING", { workflowRunId: args.workflowRunId, correlationId: args.correlationId, stage: "DEVIN_BUILD" });
    }
    return null;
  },
});

// Re-activates a *failed* build attempt whose Devin session turned out to
// still be resumable (dispatchDevinBuild sent it a follow-up message rather
// than starting a brand-new session). Mirrors markBuildStarted's state
// transitions, but keeps the existing buildJobId/sessionId instead of
// inserting a new row.
export const resumeBuildAttempt = internalMutationGeneric({
  args: { projectId: v.id("projects"), buildJobId: v.id("buildJobs"), workflowRunId: v.id("workflowRuns"), revisionRequestId: v.optional(v.id("revisionRequests")), correlationId: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch("buildJobs", args.buildJobId, {
      sessionId: args.sessionId,
      status: "building",
      resumedAt: now,
      updatedAt: now,
      errorCode: undefined,
      errorMessage: undefined,
      retryable: undefined,
    });
    const project = await ctx.db.get("projects", args.projectId);
    if (args.revisionRequestId) {
      const revision = await ctx.db.get("revisionRequests", args.revisionRequestId);
      if (revision?.status === "REVISION_BUILD_FAILED") {
        await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "REVISION_QUEUED", { workflowRunId: args.workflowRunId, revisionRequestId: args.revisionRequestId, correlationId: args.correlationId, stage: "DEVIN_BUILD" });
        await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "DEVIN_REVISING", { workflowRunId: args.workflowRunId, revisionRequestId: args.revisionRequestId, correlationId: args.correlationId, stage: "DEVIN_BUILD" });
      }
    } else if (project && ["BUILD_VALIDATION_FAILED", "MANUAL_INTERVENTION_REQUIRED"].includes(project.state)) {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "BUILD_QUEUED", { workflowRunId: args.workflowRunId, correlationId: args.correlationId, stage: "DEVIN_BUILD" });
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "DEVIN_BUILDING", { workflowRunId: args.workflowRunId, correlationId: args.correlationId, stage: "DEVIN_BUILD" });
    }
    return null;
  },
});

// Marks a brand-new build job as a continuation of an unresumable prior
// attempt (Devin's old session had already expired) — purely informational
// for the Admin UI; the new session was still told to build on top of the
// existing branch instead of starting over (see dispatchDevinBuild).
export const markBuildContinued = internalMutationGeneric({
  args: { buildJobId: v.id("buildJobs"), resumedFromBuildJobId: v.id("buildJobs") },
  handler: async (ctx, args) => {
    await ctx.db.patch("buildJobs", args.buildJobId, { resumedFromBuildJobId: args.resumedFromBuildJobId, resumedAt: Date.now() });
    return null;
  },
});

export const markBuildValidating = internalMutationGeneric({
  args: { projectId: v.id("projects"), buildJobId: v.id("buildJobs"), workflowRunId: v.id("workflowRuns"), revisionRequestId: v.optional(v.id("revisionRequests")), correlationId: v.string(), commitSha: v.string(), githubRunId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("buildJobs", args.buildJobId, { status: "validating", resultCommitSha: args.commitSha, githubRunId: args.githubRunId, updatedAt: Date.now() });
    if (args.revisionRequestId) {
      const revision = await ctx.db.get("revisionRequests", args.revisionRequestId);
      if (revision?.status === "DEVIN_REVISING") await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "REVISION_TESTING", { workflowRunId: args.workflowRunId, revisionRequestId: args.revisionRequestId, correlationId: args.correlationId, stage: "BUILD_VALIDATION" });
    } else {
      const project = await ctx.db.get("projects", args.projectId);
      if (project?.state === "DEVIN_BUILDING") await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "BUILD_VALIDATING", { workflowRunId: args.workflowRunId, correlationId: args.correlationId, stage: "BUILD_VALIDATION" });
    }
    return null;
  },
});

export const completeBuildValidation = internalMutationGeneric({
  args: { projectId: v.id("projects"), buildJobId: v.id("buildJobs"), workflowRunId: v.id("workflowRuns"), revisionRequestId: v.optional(v.id("revisionRequests")), correlationId: v.string(), artifactChecksum: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch("buildJobs", args.buildJobId, { status: "completed", artifactChecksum: args.artifactChecksum, completedAt: now, updatedAt: now });
    if (!args.revisionRequestId) {
      const project = await ctx.db.get("projects", args.projectId);
      if (project?.state === "BUILD_VALIDATING") await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "BUILD_COMPLETED", { workflowRunId: args.workflowRunId, correlationId: args.correlationId, stage: "BUILD_VALIDATION" });
    }
    return null;
  },
});

// Records that the validated branch was merged into the repository's
// default branch (best-effort — see reconcileCandidateValidation; a merge
// failure here never blocks deployment, which already runs off the
// validated commit/artifact regardless of main's state).
export const markBuildMerged = internalMutationGeneric({
  args: { buildJobId: v.id("buildJobs"), mergeCommitSha: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("buildJobs", args.buildJobId, { mergedAt: Date.now(), mergeCommitSha: args.mergeCommitSha, mergeError: undefined });
    return null;
  },
});

export const markBuildMergeFailed = internalMutationGeneric({
  args: { buildJobId: v.id("buildJobs"), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("buildJobs", args.buildJobId, { mergeError: args.message });
    return null;
  },
});

// Upserts Devin's live session progress (status_enum + session messages) and
// any newly-observed commit on the target branch so the Admin UI can show
// incremental progress instead of only the coarse buildJobs.status. Events
// are deduped per buildJobId+eventKey so repeated polls of the same session
// never insert the same message twice.
export const recordDevinProgress = internalMutationGeneric({
  args: {
    projectId: v.id("projects"),
    buildJobId: v.id("buildJobs"),
    statusEnum: v.optional(v.string()),
    pullRequestUrl: v.optional(v.string()),
    lastKnownCommitSha: v.optional(v.string()),
    events: v.array(v.object({
      eventKey: v.string(),
      source: v.union(v.literal("devin_message"), v.literal("devin_status"), v.literal("github_commit")),
      type: v.optional(v.string()),
      message: v.string(),
      occurredAt: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("buildJobs", args.buildJobId, {
      lastPolledAt: Date.now(),
      ...(args.statusEnum ? { statusEnum: args.statusEnum } : {}),
      ...(args.pullRequestUrl ? { pullRequestUrl: args.pullRequestUrl } : {}),
      ...(args.lastKnownCommitSha ? { lastKnownCommitSha: args.lastKnownCommitSha } : {}),
    });
    for (const event of args.events) {
      const existing = await ctx.db
        .query("buildProgressEvents")
        .withIndex("by_build_job_event_key", (query) => query.eq("buildJobId", args.buildJobId))
        .filter((query) => query.eq(query.field("eventKey"), event.eventKey))
        .first();
      if (existing) continue;
      await ctx.db.insert("buildProgressEvents", {
        buildJobId: args.buildJobId,
        projectId: args.projectId,
        source: event.source,
        eventKey: event.eventKey,
        type: event.type,
        message: event.message,
        occurredAt: event.occurredAt,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

export const failBuild = internalMutationGeneric({
  args: { projectId: v.id("projects"), buildJobId: v.id("buildJobs"), workflowRunId: v.id("workflowRuns"), revisionRequestId: v.optional(v.id("revisionRequests")), correlationId: v.string(), code: v.string(), message: v.string(), providerRequestId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("buildJobs", args.buildJobId, { status: "failed", errorCode: args.code, errorMessage: args.message, retryable: true, retryCount: 1, maxRetries: 3, providerRequestId: args.providerRequestId, failedStage: "DEVIN_BUILD", updatedAt: Date.now() });
    const target = args.revisionRequestId ? "REVISION_BUILD_FAILED" as const : "BUILD_VALIDATION_FAILED" as const;
    const project = await ctx.db.get("projects", args.projectId);
    const revision = args.revisionRequestId ? await ctx.db.get("revisionRequests", args.revisionRequestId) : null;
    if ((!args.revisionRequestId && ["BUILD_QUEUED", "DEVIN_BUILDING", "BUILD_VALIDATING"].includes(project?.state ?? "")) || (args.revisionRequestId && ["REVISION_QUEUED", "DEVIN_REVISING", "REVISION_TESTING"].includes(revision?.status ?? ""))) {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, target, {
        workflowRunId: args.workflowRunId,
        revisionRequestId: args.revisionRequestId,
        correlationId: args.correlationId,
        stage: "DEVIN_BUILD",
        failedStage: "DEVIN_BUILD",
        errorCode: args.code,
        errorMessage: args.message,
        retryable: true,
        retryCount: 1,
        maxRetries: 3,
        provider: "devin",
        providerRequestId: args.providerRequestId,
      });
    }
    return null;
  },
});

export const failBuildTimeout = internalMutationGeneric({
  args: {
    projectId: v.id("projects"),
    buildJobId: v.id("buildJobs"),
    workflowRunId: v.id("workflowRuns"),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    correlationId: v.string(),
    providerRequestId: v.string(),
  },
  handler: async (ctx, args) => {
    const message = "Devin session exceeded the configured timeout";
    await ctx.db.patch("buildJobs", args.buildJobId, {
      status: "failed",
      errorCode: "DEVIN_SESSION_TIMEOUT",
      errorMessage: message,
      retryable: false,
      retryCount: 1,
      maxRetries: 1,
      providerRequestId: args.providerRequestId,
      failedStage: "DEVIN_BUILD",
      updatedAt: Date.now(),
    });
    const project = await ctx.db.get("projects", args.projectId);
    const revision = args.revisionRequestId ? await ctx.db.get("revisionRequests", args.revisionRequestId) : null;
    const currentState = args.revisionRequestId ? revision?.status : project?.state;
    // A hung Devin session should not sit in a retryable failure state
    // indefinitely (Section 4.7 "Demo resilience") — go straight to
    // MANUAL_INTERVENTION_REQUIRED so an operator decides whether to
    // resume (back to BUILD_QUEUED/REVISION_QUEUED) or cancel.
    if (currentState && ["BUILD_QUEUED", "DEVIN_BUILDING", "REVISION_QUEUED", "DEVIN_REVISING"].includes(currentState)) {
      if (args.revisionRequestId) {
        // Revision transitions leave the stable project.state untouched
        // (stateMachine.ts) — MANUAL_INTERVENTION_REQUIRED below only moves
        // project.state, so without this the revision itself would stay
        // stuck at REVISION_QUEUED/DEVIN_REVISING with no valid edge back to
        // REVISION_QUEUED for a future retry/resume (see queueBuild).
        await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "REVISION_BUILD_FAILED", {
          workflowRunId: args.workflowRunId,
          revisionRequestId: args.revisionRequestId,
          correlationId: args.correlationId,
          stage: "DEVIN_BUILD",
          failedStage: "DEVIN_BUILD",
          errorCode: "DEVIN_SESSION_TIMEOUT",
          errorMessage: message,
          retryable: false,
          retryCount: 1,
          maxRetries: 1,
          provider: "devin",
          providerRequestId: args.providerRequestId,
        });
      }
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "MANUAL_INTERVENTION_REQUIRED", {
        workflowRunId: args.workflowRunId,
        revisionRequestId: args.revisionRequestId,
        correlationId: args.correlationId,
        stage: "DEVIN_BUILD",
        failedStage: "DEVIN_BUILD",
        errorCode: "DEVIN_SESSION_TIMEOUT",
        errorMessage: message,
        retryable: false,
        retryCount: 1,
        maxRetries: 1,
        provider: "devin",
        providerRequestId: args.providerRequestId,
      });
    }
    return null;
  },
});

// Internal: reachable only from server-side code (ctx.scheduler, the new
// admin-gated retryBuild wrapper in retryActions.ts) — never directly by a
// client/raw API call (T7.4, Section 12).
export const dispatchDevinBuild = internalActionGeneric({
  args: { projectId: v.id("projects"), revisionRequestId: v.optional(v.id("revisionRequests")), targetBranch: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(buildContextRef, args) as BuildContext;
    let baseCommitSha = context.baseCommitSha;
    // Set once a brand-new session is going to continue on top of a prior
    // (unresumable) attempt's work, instead of starting from context's
    // "from scratch" baseCommitSha.
    let continuedFromCommit: string | null = null;

    // Resume-aware retry: a "Retry Build" click after a failure/timeout
    // shouldn't blindly redo work Devin already pushed to the target branch
    // (e.g. our own checkBuildTimeout gave up on a session Devin was still
    // actually finishing). Only even considered when loadBuildContext found
    // a *failed* prior attempt with a sessionId — see there for why that's
    // safe against interfering with a genuinely in-flight build.
    if (context.priorAttempt) {
      const branchHead = (await fetchBranchHead(context.owner, context.repositoryName, context.targetBranch))?.sha ?? null;
      if (branchHead && branchHead !== context.baseCommitSha) {
        const resumed = await tryResumePriorSession(ctx as unknown as ExternalCallContext, context, context.priorAttempt, branchHead);
        if (resumed) {
          await ctx.scheduler.runAfter(DEVIN_STATUS_POLL_INTERVAL_MS, reconcileDevinStatusRef, {
            projectId: args.projectId, buildJobId: resumed.buildJobId, pollToken: Date.now().toString(36),
          });
          const timeout = Number(process.env.DEVIN_SESSION_TIMEOUT_MS ?? 1_800_000);
          await ctx.scheduler.runAfter(Number.isFinite(timeout) && timeout > 0 ? timeout : 1_800_000, timeoutRef, { projectId: args.projectId, buildJobId: resumed.buildJobId });
          return { buildJobId: resumed.buildJobId, sessionId: resumed.sessionId, resumed: true as const };
        }
        // The prior session can't be resumed (expired) — still don't restart
        // from scratch: point the new session at the work already pushed.
        baseCommitSha = branchHead;
        continuedFromCommit = branchHead;
      }
    }

    const buildJobId = await ctx.runMutation(queueRef, {
      projectId: args.projectId, workflowRunId: context.workflowRunId, revisionRequestId: context.revisionRequestId,
      correlationId: context.correlationId, repositoryId: context.repositoryId, baseCommitSha, targetBranch: context.targetBranch, type: context.type,
    }) as BuildJobId;
    if (continuedFromCommit && context.priorAttempt) {
      await ctx.runMutation(markContinuedRef, { buildJobId, resumedFromBuildJobId: context.priorAttempt.buildJobId });
    }
    // Every prompt ends with the same instruction: once the site is truly
    // complete, make the *last* commit's message start with "FINAL:" before
    // pushing. reconcileDevinStatus treats that commit as authoritative
    // proof of completion (GitHub ground truth), independent of whatever
    // Devin's own session status_enum reports — see FINAL_COMMIT_PREFIX.
    const finalCommitInstruction = `When the site is fully complete and pushed, make sure the last commit's message starts with "${FINAL_COMMIT_PREFIX}" (e.g. "${FINAL_COMMIT_PREFIX} <summary>") — do not use this prefix on any earlier, in-progress commit.`;
    // Demo target: a single shared branch (the repository's default branch,
    // context.targetBranch) is used for both pulling and pushing — Devin
    // must not create or push to any other branch (e.g. no "buildpilot/
    // candidate"-style candidate branch).
    const branchInstruction = `Work directly on the "${context.targetBranch}" branch — pull the latest changes from it and push your commits back to that same branch. Do not create a new branch.`;
    const prompt = continuedFromCommit
      ? `Branch ${context.targetBranch} of ${context.repositoryUrl} already has previous work pushed up to commit ${continuedFromCommit} towards this build. Review the existing code and src/site.config.ts, then continue and complete any remaining work instead of starting over. ${SITE_BUILD_INSTRUCTIONS} ${branchInstruction} Run npm ci and npm run build, then push and return the commit SHA. ${finalCommitInstruction}`
      : context.type === "revision"
        ? `Update ${context.repositoryUrl} from commit ${context.baseCommitSha} on branch ${context.targetBranch}. Follow src/site.config.ts and implement this revision request: ${context.requestText ?? "Apply the approved revision"}. ${SITE_BUILD_INSTRUCTIONS} ${branchInstruction} Push the completed changes and return the commit SHA. ${finalCommitInstruction}`
        : `Build the single-page customer website in ${context.repositoryUrl}. Start from commit ${context.baseCommitSha}. ${SITE_BUILD_INSTRUCTIONS} Do not create extra pages or routes. ${branchInstruction} Run npm ci and npm run build, then push and return the commit SHA. ${finalCommitInstruction}`;
    try {
      // Scoped to buildJobId, not baseCommitSha:targetBranch — those stay
      // identical across a retry of the same commit/branch, and callExternal's
      // idempotency layer (lib/stageAttempt.ts) permanently caches a
      // "completed" stage attempt by this key. Reusing the old key on retry
      // would replay the original (now-dead/timed-out) session-creation
      // response instead of dispatching a real new Devin session — silently,
      // with no live HTTP call and no new Convex logs. queueBuild (above)
      // already gives every real retry its own buildJobId, so it's a safe,
      // stable key: idempotent across a re-executed Convex action for the
      // *same* attempt, but distinct across genuinely separate attempts.
      const attemptCacheKey = String(buildJobId);
      const response = await providerCall(ctx as unknown as ExternalCallContext, {
        projectId: args.projectId,
        correlationId: context.correlationId,
        stage: "DEVIN_BUILD",
        cacheKey: attemptCacheKey,
        provider: "devin",
        url: `${devinBaseUrl()}/sessions`,
        method: "POST",
        headers: devinHeaders(),
        body: { prompt, idempotency_key: `${args.projectId}:${attemptCacheKey}`, metadata: { project_id: String(args.projectId), correlation_id: context.correlationId, repository_url: context.repositoryUrl, base_commit_sha: baseCommitSha, target_branch: context.targetBranch, site_config_path: "src/site.config.ts" } },
        replayHandler: "devin:dispatchDevinBuild",
        replayArgs: context.revisionRequestId ? { revisionRequestId: context.revisionRequestId, targetBranch: context.targetBranch } : { targetBranch: context.targetBranch },
      });
      const id = sessionId(response.body);
      await ctx.runMutation(startedRef, { projectId: args.projectId, buildJobId, workflowRunId: context.workflowRunId, revisionRequestId: context.revisionRequestId, correlationId: context.correlationId, sessionId: id });
      // Kick off the reconciliation poll loop (self-reschedules every
      // DEVIN_STATUS_POLL_INTERVAL_MS until the session/branch reports
      // done — see reconcileDevinStatus) — without this, nothing ever
      // checks the branch for Devin's "FINAL:" commit until checkBuildTimeout
      // fires its own one-off reconciliation after the full session timeout.
      await ctx.scheduler.runAfter(DEVIN_STATUS_POLL_INTERVAL_MS, reconcileDevinStatusRef, {
        projectId: args.projectId, buildJobId, pollToken: Date.now().toString(36),
      });
      const timeout = Number(process.env.DEVIN_SESSION_TIMEOUT_MS ?? 1_800_000);
      await ctx.scheduler.runAfter(Number.isFinite(timeout) && timeout > 0 ? timeout : 1_800_000, timeoutRef, { projectId: args.projectId, buildJobId });
      return { buildJobId, sessionId: id };
    } catch (error) {
      await ctx.runMutation(failedRef, { projectId: args.projectId, buildJobId, workflowRunId: context.workflowRunId, revisionRequestId: context.revisionRequestId, correlationId: context.correlationId, code: "DEVIN_DISPATCH_FAILED", message: error instanceof Error ? error.message : "Devin dispatch failed", providerRequestId: context.correlationId });
      throw error;
    }
  },
});

// Attempts to resume a prior (failed/abandoned) Devin session with a
// follow-up message instead of dispatching a brand-new one. Returns null if
// the session can't be resumed (expired, or the message call itself fails),
// in which case the caller falls back to a fresh session that continues
// from the branch instead of starting over.
async function tryResumePriorSession(
  ctx: ExternalCallContext,
  context: BuildContext,
  priorAttempt: PriorAttempt,
  branchHead: string,
): Promise<{ buildJobId: BuildJobId; sessionId: string } | null> {
  const statusResponse = await providerCall(ctx, {
    projectId: context.projectId, correlationId: context.correlationId, stage: "DEVIN_STATUS",
    cacheKey: `resume-check-${priorAttempt.buildJobId}`,
    provider: "devin", url: `${devinBaseUrl()}/sessions/${encodeURIComponent(priorAttempt.sessionId)}`,
    headers: devinHeaders(), replayHandler: "devin:reconcileDevinStatus", replayArgs: { buildJobId: priorAttempt.buildJobId },
  }).catch(() => null);
  if (!statusResponse) return null;
  const details = sessionDetails(statusResponse.body);
  if (details.statusEnum && UNRESUMABLE_STATUS_ENUMS.has(details.statusEnum)) return null;

  const messageResponse = await providerCall(ctx, {
    projectId: context.projectId, correlationId: context.correlationId, stage: "DEVIN_BUILD",
    cacheKey: `resume-message-${priorAttempt.buildJobId}`,
    provider: "devin", method: "POST", url: `${devinBaseUrl()}/sessions/${encodeURIComponent(priorAttempt.sessionId)}/message`,
    headers: devinHeaders(),
    body: {
      message: `An operator retried this build. Branch ${context.targetBranch} currently has commit ${branchHead}. Please verify the site build is complete per src/site.config.ts. ${SITE_BUILD_INSTRUCTIONS} Run npm ci and npm run build, fix anything outstanding, and push the final changes with the resulting commit SHA. Continue working directly on the "${context.targetBranch}" branch — do not create a new branch. When fully complete, make sure the last commit's message starts with "${FINAL_COMMIT_PREFIX}" (e.g. "${FINAL_COMMIT_PREFIX} <summary>").`,
    },
    replayHandler: "devin:dispatchDevinBuild",
    replayArgs: context.revisionRequestId ? { revisionRequestId: context.revisionRequestId, targetBranch: context.targetBranch } : { targetBranch: context.targetBranch },
  }).catch(() => null);
  if (!messageResponse) return null;

  await ctx.runMutation(resumeRef, {
    projectId: context.projectId, buildJobId: priorAttempt.buildJobId, workflowRunId: context.workflowRunId,
    revisionRequestId: context.revisionRequestId, correlationId: context.correlationId, sessionId: priorAttempt.sessionId,
  });
  return { buildJobId: priorAttempt.buildJobId, sessionId: priorAttempt.sessionId };
}

// Internal: self-scheduled reconciliation poll, never called by a client.
export const reconcileDevinStatus = internalActionGeneric({
  args: { projectId: v.id("projects"), buildJobId: v.optional(v.id("buildJobs")), pollToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const build = await ctx.runQuery(activeBuildRef, { projectId: args.projectId, buildJobId: args.buildJobId }) as ActiveBuild;
    // Already resolved (e.g. checkBuildTimeout fired, or a previous poll
    // already advanced this build) — stop polling rather than double-process.
    if (!["queued", "building"].includes(build.status)) return { status: build.status };
    const pollToken = args.pollToken ?? Date.now().toString(36);
    const statusResponse = await providerCall(ctx as unknown as ExternalCallContext, {
      projectId: args.projectId, correlationId: build.correlationId, stage: "DEVIN_STATUS", cacheKey: `${build.sessionId}:${pollToken}`,
      provider: "devin", url: `${devinBaseUrl()}/sessions/${encodeURIComponent(build.sessionId)}`, headers: devinHeaders(), replayHandler: "devin:reconcileDevinStatus", replayArgs: { buildJobId: build.buildJobId, pollToken },
    });
    const statusBody = object(statusResponse.body);
    const details = sessionDetails(statusResponse.body);

    // Record Devin's own progress (the "intermediate event update" the
    // session API exposes) plus a lightweight GitHub commit check as a
    // secondary signal, so the Admin UI shows what's happening without
    // waiting for the session to reach a terminal state.
    const progressEvents: ProgressEventInput[] = details.messages.map((message) => ({
      eventKey: message.eventId,
      source: "devin_message",
      type: message.type,
      message: message.message,
      occurredAt: message.occurredAt,
    }));
    if (details.statusEnum && details.statusEnum !== build.statusEnum) {
      progressEvents.push({
        eventKey: `status:${details.statusEnum}:${Date.now()}`,
        source: "devin_status",
        type: "status",
        message: `Devin session status changed to "${details.statusEnum}"`,
        occurredAt: Date.now(),
      });
    }
    const branchHead = await fetchBranchHead(build.owner, build.repositoryName, build.targetBranch);
    const branchHeadNow = branchHead?.sha;
    const finalCommitDetected = Boolean(branchHead && isFinalCommit(branchHead.message));
    if (branchHeadNow && branchHeadNow !== build.lastKnownCommitSha) {
      progressEvents.push({
        eventKey: `commit:${branchHeadNow}`,
        source: "github_commit",
        type: "commit",
        message: finalCommitDetected
          ? `Devin pushed its final commit to ${build.targetBranch}: ${branchHeadNow.slice(0, 10)}`
          : `New commit pushed to ${build.targetBranch}: ${branchHeadNow.slice(0, 10)}`,
        occurredAt: Date.now(),
      });
    }
    await ctx.runMutation(recordProgressRef, {
      projectId: args.projectId,
      buildJobId: build.buildJobId,
      statusEnum: details.statusEnum,
      pullRequestUrl: details.pullRequestUrl,
      lastKnownCommitSha: branchHeadNow ?? undefined,
      events: progressEvents,
    });

    // A genuine "FINAL:" commit means the work is actually done, even if the
    // session itself subsequently reports as expired/cancelled/etc. — never
    // treat that as a failure.
    const isFailed = !finalCommitDetected && (
      (details.statusEnum ? UNRESUMABLE_STATUS_ENUMS.has(details.statusEnum) : false)
      || ["failed", "error", "cancelled", "expired"].includes(details.rawStatus)
    );
    // Idle-with-a-commit-already-on-the-branch counts as finished too — see
    // IDLE_STATUS_ENUMS above. Without a commit yet, an idle session is still
    // treated as "building": nobody will send it a reply, so
    // checkBuildTimeout's bound still applies rather than prematurely
    // finalizing a session that got stuck before pushing anything.
    // A "FINAL:" commit on the branch is authoritative and short-circuits
    // everything else: GitHub ground truth beats Devin's own self-reported
    // session status, which can lag or land on an ambiguous non-terminal
    // value even after the work is genuinely done (see FINAL_COMMIT_PREFIX).
    const isFinished = finalCommitDetected
      || (details.statusEnum ? FINISHED_STATUS_ENUMS.has(details.statusEnum) : false)
      || (details.statusEnum ? IDLE_STATUS_ENUMS.has(details.statusEnum) && Boolean(branchHeadNow) : false)
      || ["completed", "finished", "succeeded"].includes(details.rawStatus);
    if (isFailed) {
      await ctx.runMutation(failedRef, { projectId: args.projectId, buildJobId: build.buildJobId, workflowRunId: build.workflowRunId, revisionRequestId: build.revisionRequestId, correlationId: build.correlationId, code: "DEVIN_BUILD_FAILED", message: String(statusBody.error ?? statusBody.message ?? details.statusEnum ?? details.rawStatus), providerRequestId: build.sessionId });
      return { status: "failed" as const };
    }
    if (!isFinished) {
      // Detects Devin's completed push by polling until the session
      // reports done — checkBuildTimeout (T4.7) already bounds this loop.
      await ctx.scheduler.runAfter(DEVIN_STATUS_POLL_INTERVAL_MS, reconcileDevinStatusRef, {
        projectId: args.projectId, buildJobId: build.buildJobId, pollToken: Date.now().toString(36),
      });
      return { status: "building" as const };
    }
    // Devin's plain-text prompts here never request a structured_output JSON
    // schema (see dispatchDevinBuild), so commit_sha/structured_output are
    // rarely populated in practice — fall back to the branch HEAD we already
    // fetched above for progress tracking, which is exactly what Devin
    // itself reports back in chat ("Final commit SHA on <branch>: ...").
    const commitShaValue = statusBody.commit_sha ?? statusBody.result_commit_sha ?? object(statusBody.structured_output ?? {}).commit_sha ?? branchHeadNow ?? undefined;
    if (typeof commitShaValue !== "string" || !commitShaValue) throw new Error("Completed Devin session did not report a commit SHA");
    // Everything from here on hits GitHub for verification and can fail for
    // reasons that are really just "this candidate isn't valid" (missing
    // commit, an unexpected repo layout, etc.) rather than a transient/infra
    // problem. Route any of that into failedRef -> BUILD_VALIDATION_FAILED
    // instead of letting it throw uncaught: an uncaught error here stops
    // this action without ever writing a new buildJobs/project status, which
    // leaves the Admin UI's reactive queries showing "Devin Building"
    // forever — not because they failed to update, but because nothing ever
    // told them the build was done.
    try {
      const commit = await providerCall(ctx as unknown as ExternalCallContext, {
        projectId: args.projectId, correlationId: build.correlationId, stage: "DEVIN_BUILD", cacheKey: `verify-${commitShaValue}`,
        provider: "github", url: `https://api.github.com/repos/${build.owner}/${build.repositoryName}/commits/${commitShaValue}`, headers: githubHeaders(), replayHandler: "devin:reconcileDevinStatus", replayArgs: { buildJobId: build.buildJobId },
      });
      if (object(commit.body).sha !== commitShaValue) throw new Error("Devin commit does not exist in the repository");
      const branch = await providerCall(ctx as unknown as ExternalCallContext, {
        projectId: args.projectId, correlationId: build.correlationId, stage: "DEVIN_BUILD", cacheKey: `branch-${build.targetBranch}-${commitShaValue}`,
        provider: "github", url: `https://api.github.com/repos/${build.owner}/${build.repositoryName}/branches/${encodeURIComponent(build.targetBranch)}`, headers: githubHeaders(), replayHandler: "devin:reconcileDevinStatus", replayArgs: { buildJobId: build.buildJobId },
      });
      if (object(object(branch.body).commit).sha !== commitShaValue) throw new Error("Devin commit is not the head of the target branch");
      // Sanity-check the commit has real file content, without assuming any
      // specific path exists. Devin has full control of the working tree and
      // may legitimately restructure or drop root-level files it doesn't
      // consider part of the shippable site (no top-level src/, or even our
      // own generated src/site.config.ts — files were observed missing
      // on a real branch despite a perfectly valid build) — asserting exact
      // filenames here was throwing an uncaught 404 that silently stalled
      // the whole build instead of just letting validate-candidate.yml (the
      // real build/test authority) judge whether the commit is good.
      const rootContents = await providerCall(ctx as unknown as ExternalCallContext, {
        projectId: args.projectId, correlationId: build.correlationId, stage: "DEVIN_BUILD", cacheKey: `output-${commitShaValue}-root`,
        provider: "github", url: `https://api.github.com/repos/${build.owner}/${build.repositoryName}/contents?ref=${commitShaValue}`, headers: githubHeaders(), replayHandler: "devin:reconcileDevinStatus", replayArgs: { buildJobId: build.buildJobId },
      });
      if (!Array.isArray(rootContents.body) || rootContents.body.length === 0) throw new Error("Devin's commit does not contain any files");
      const dispatch = await providerCall(ctx as unknown as ExternalCallContext, {
        projectId: args.projectId, correlationId: build.correlationId, stage: "CANDIDATE_VALIDATION", cacheKey: commitShaValue,
        provider: "github", url: `https://api.github.com/repos/${build.owner}/${build.repositoryName}/actions/workflows/validate-candidate.yml/dispatches`, method: "POST", headers: githubHeaders(),
        body: { ref: build.targetBranch, inputs: { commit_sha: commitShaValue, correlation_id: build.correlationId } }, replayHandler: "devin:reconcileDevinStatus", replayArgs: { buildJobId: build.buildJobId },
      });
      await ctx.runMutation(validatingRef, { projectId: args.projectId, buildJobId: build.buildJobId, workflowRunId: build.workflowRunId, revisionRequestId: build.revisionRequestId, correlationId: build.correlationId, commitSha: commitShaValue, githubRunId: dispatch.requestId });
      await ctx.scheduler.runAfter(CANDIDATE_VALIDATION_POLL_INTERVAL_MS, reconcileCandidateValidationRef, { projectId: args.projectId, buildJobId: build.buildJobId });
      await ctx.scheduler.runAfter(CANDIDATE_VALIDATION_TIMEOUT_MS, candidateTimeoutRef, { projectId: args.projectId, buildJobId: build.buildJobId });
      return { status: "validating" as const, commitSha: commitShaValue };
    } catch (error) {
      await ctx.runMutation(failedRef, {
        projectId: args.projectId, buildJobId: build.buildJobId, workflowRunId: build.workflowRunId, revisionRequestId: build.revisionRequestId, correlationId: build.correlationId,
        code: "DEVIN_COMMIT_VERIFICATION_FAILED",
        message: error instanceof Error ? error.message : "Failed to verify Devin's commit against the repository",
        providerRequestId: commitShaValue,
      });
      return { status: "failed" as const };
    }
  },
});

// Internal: self-scheduled reconciliation poll, never called by a client.
export const reconcileCandidateValidation = internalActionGeneric({
  args: { projectId: v.id("projects"), buildJobId: v.optional(v.id("buildJobs")), pollToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const build = await ctx.runQuery(activeBuildRef, { projectId: args.projectId, buildJobId: args.buildJobId }) as ActiveBuild;
    // Already resolved (e.g. checkCandidateValidationTimeout fired, or a
    // previous poll already advanced this build) — stop polling.
    if (build.status !== "validating") return { status: build.status };
    const pollToken = args.pollToken ?? Date.now().toString(36);
    // Everything below hits GitHub Actions and can throw for reasons that
    // just mean "this candidate isn't valid" (missing run, no artifact,
    // unexpected API response) rather than something worth retrying forever.
    // An uncaught throw here stops the action without ever writing a new
    // buildJobs/project status — the build would be stuck showing
    // "validating" indefinitely with no further scheduled polls, which looks
    // like a stale Admin UI but is actually a silently-dead backend.
    try {
      if (!build.resultCommitSha) throw new Error("Build has no candidate commit");
      const runsResponse = await providerCall(ctx as unknown as ExternalCallContext, {
        projectId: args.projectId, correlationId: build.correlationId, stage: "CANDIDATE_VALIDATION", cacheKey: `status-${build.resultCommitSha}-${pollToken}`,
        provider: "github", url: `https://api.github.com/repos/${build.owner}/${build.repositoryName}/actions/workflows/validate-candidate.yml/runs?head_sha=${build.resultCommitSha}&event=workflow_dispatch&per_page=10`, headers: githubHeaders(), replayHandler: "devin:reconcileCandidateValidation", replayArgs: { buildJobId: build.buildJobId, pollToken },
      });
      const runs = object(runsResponse.body).workflow_runs;
      const run = Array.isArray(runs) ? runs.find((item) => item !== null && typeof item === "object" && !Array.isArray(item) && (item as Record<string, Value>).head_sha === build.resultCommitSha) as Record<string, Value> | undefined : undefined;
      if (!run || run.status !== "completed") {
        // Detects validate-candidate's result by polling GitHub Actions
        // until the dispatched run completes — bounded by
        // checkCandidateValidationTimeout, scheduled alongside this poll.
        await ctx.scheduler.runAfter(CANDIDATE_VALIDATION_POLL_INTERVAL_MS, reconcileCandidateValidationRef, {
          projectId: args.projectId, buildJobId: build.buildJobId, pollToken: Date.now().toString(36),
        });
        return { status: "pending" as const };
      }
      if (run.conclusion !== "success") {
        await ctx.runMutation(failedRef, { projectId: args.projectId, buildJobId: build.buildJobId, workflowRunId: build.workflowRunId, revisionRequestId: build.revisionRequestId, correlationId: build.correlationId, code: "CANDIDATE_VALIDATION_FAILED", message: `Candidate validation concluded ${String(run.conclusion)}`, providerRequestId: String(run.id) });
        return { status: "failed" as const };
      }
      const artifactsResponse = await providerCall(ctx as unknown as ExternalCallContext, {
        projectId: args.projectId, correlationId: build.correlationId, stage: "CANDIDATE_VALIDATION", cacheKey: `artifacts-${String(run.id)}`,
        provider: "github", url: `https://api.github.com/repos/${build.owner}/${build.repositoryName}/actions/runs/${String(run.id)}/artifacts`, headers: githubHeaders(), replayHandler: "devin:reconcileCandidateValidation", replayArgs: { buildJobId: build.buildJobId },
      });
      const artifacts = object(artifactsResponse.body).artifacts;
      const artifact = Array.isArray(artifacts) ? artifacts.find((item) => item !== null && typeof item === "object" && !Array.isArray(item) && (item as Record<string, Value>).expired !== true) as Record<string, Value> | undefined : undefined;
      const checksum = artifact && typeof artifact.digest === "string" ? artifact.digest.replace(/^sha256:/, "") : artifact ? String(artifact.id) : "";
      if (!checksum) throw new Error("Successful validation did not produce an artifact checksum");
      await ctx.runMutation(completedRef, { projectId: args.projectId, buildJobId: build.buildJobId, workflowRunId: build.workflowRunId, revisionRequestId: build.revisionRequestId, correlationId: build.correlationId, artifactChecksum: checksum });
      // Now that CI has verified the branch, merge it into the repository's
      // default branch. Best-effort: a merge conflict/failure here is
      // recorded for the operator but never blocks completion — deployment
      // (below) already deploys from the validated commit/artifact directly
      // and doesn't depend on main having been updated.
      await mergeToDefaultBranch(ctx as unknown as ExternalCallContext, build).catch(async (error) => {
        await ctx.runMutation(mergeFailedRef, { buildJobId: build.buildJobId, message: error instanceof Error ? error.message : "Merge to default branch failed" });
      });
      if (!build.revisionRequestId) await ctx.scheduler.runAfter(0, deployRef, { projectId: args.projectId });
      return { status: "completed" as const, artifactChecksum: checksum };
    } catch (error) {
      await ctx.runMutation(failedRef, {
        projectId: args.projectId, buildJobId: build.buildJobId, workflowRunId: build.workflowRunId, revisionRequestId: build.revisionRequestId, correlationId: build.correlationId,
        code: "CANDIDATE_VALIDATION_ERROR",
        message: error instanceof Error ? error.message : "Candidate validation reconciliation failed",
        providerRequestId: build.resultCommitSha ?? build.sessionId,
      });
      return { status: "failed" as const };
    }
  },
});

// Merges an already-validated build's branch into the repository's default
// branch (Section: "complete and merge the code to main branch"). Uses
// GitHub's Merges API directly (a merge commit, no PR/review step) since
// this only runs after our own CI (validate-candidate.yml) has already
// confirmed the branch builds and passes checks.
async function mergeToDefaultBranch(ctx: ExternalCallContext, build: ActiveBuild): Promise<void> {
  if (!build.resultCommitSha) return;
  const response = await providerCall(ctx, {
    projectId: build.projectId, correlationId: build.correlationId, stage: "DEVIN_BUILD",
    cacheKey: `merge-${build.buildJobId}`,
    provider: "github", method: "POST", url: `https://api.github.com/repos/${build.owner}/${build.repositoryName}/merges`,
    headers: githubHeaders(),
    body: { base: build.defaultBranch, head: build.resultCommitSha, commit_message: `Merge validated build (${build.targetBranch}) into ${build.defaultBranch}` },
    replayHandler: "devin:reconcileCandidateValidation", replayArgs: { buildJobId: build.buildJobId },
  });
  // A 204 ("base already contains head", nothing to merge) has a null body —
  // treat that as a successful no-op merge rather than an unexpected response.
  const mergeSha = response.body !== null && typeof object(response.body).sha === "string"
    ? String(object(response.body).sha)
    : build.resultCommitSha;
  await ctx.runMutation(mergedRef, { buildJobId: build.buildJobId, mergeCommitSha: mergeSha });
}

// Internal: self-scheduled timeout check, never called by a client.
export const checkBuildTimeout = internalActionGeneric({
  args: { projectId: v.id("projects"), buildJobId: v.id("buildJobs") },
  handler: async (ctx, args) => {
    const build = await ctx.runQuery(activeBuildRef, args).catch(() => null) as ActiveBuild | null;
    if (!build || !["queued", "building"].includes(build.status)) return { timedOut: false };
    // Last chance before giving up: this timeout firing doesn't necessarily
    // mean Devin's session actually stalled — it may have finished (or kept
    // making progress) after our last poll. Run one more live reconciliation
    // first, so a build that completed just past the timeout window isn't
    // thrown away and rebuilt from scratch on retry.
    await ctx.runAction(reconcileDevinStatusRef, { projectId: args.projectId, buildJobId: build.buildJobId, pollToken: `timeout-${Date.now().toString(36)}` }).catch(() => null);
    const recheck = await ctx.runQuery(activeBuildRef, args).catch(() => null) as ActiveBuild | null;
    if (!recheck || !["queued", "building"].includes(recheck.status)) return { timedOut: false };
    await ctx.runMutation(failTimeoutRef, { projectId: args.projectId, buildJobId: recheck.buildJobId, workflowRunId: recheck.workflowRunId, revisionRequestId: recheck.revisionRequestId, correlationId: recheck.correlationId, providerRequestId: recheck.sessionId });
    return { timedOut: true };
  },
});

// Bounds reconcileCandidateValidation's self-rescheduled polling loop.
// Unlike a hung Devin session (checkBuildTimeout -> MANUAL_INTERVENTION_REQUIRED),
// a stuck/never-completing validate-candidate.yml run is treated as an
// ordinary retryable build failure (Section 11: Retry Build -> resume
// from BUILD_QUEUED), matching every other candidate-validation failure.
// Internal: self-scheduled timeout check, never called by a client.
export const checkCandidateValidationTimeout = internalActionGeneric({
  args: { projectId: v.id("projects"), buildJobId: v.id("buildJobs") },
  handler: async (ctx, args) => {
    const build = await ctx.runQuery(activeBuildRef, args).catch(() => null) as ActiveBuild | null;
    if (!build || build.status !== "validating") return { timedOut: false };
    await ctx.runMutation(failedRef, {
      projectId: args.projectId,
      buildJobId: build.buildJobId,
      workflowRunId: build.workflowRunId,
      revisionRequestId: build.revisionRequestId,
      correlationId: build.correlationId,
      code: "CANDIDATE_VALIDATION_TIMEOUT",
      message: "validate-candidate.yml did not complete within the configured timeout",
      providerRequestId: build.resultCommitSha ?? build.sessionId,
    });
    return { timedOut: true };
  },
});

export const loadProjectState = internalQueryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<{ state: string } | null> => {
    const project = await ctx.db.get("projects", args.projectId);
    return project ? { state: project.state } : null;
  },
});

// Internal: self-scheduled watchdog, never called by a client. See
// BUILD_DISPATCH_WATCHDOG_MS above for why this exists: it's the automatic
// equivalent of an operator clicking "Resume"/"Retry Build" on a project
// stuck at REPOSITORY_READY because the initial dispatchDevinBuild call
// never got to run its own cleanup.
export const checkBuildDispatchTimeout = internalActionGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.runQuery(loadProjectStateRef, args).catch(() => null) as { state: string } | null;
    if (!project || project.state !== "REPOSITORY_READY") return { dispatched: false };
    await ctx.runAction(dispatchDevinBuildSelfRef, { projectId: args.projectId }).catch(() => null);
    return { dispatched: true };
  },
});
