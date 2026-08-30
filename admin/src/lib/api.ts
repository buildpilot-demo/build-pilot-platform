import { anyApi, makeFunctionReference, type FunctionReference, type PaginationOptions, type PaginationResult } from "convex/server";
import type { ActivityEvent, BuildProgressEvent, Business, BusinessDetails, CachedResponse, DashboardData, HealthData, Project, ProjectDetails } from "./types";

// These references keep this client independent of generated backend types. The
// corresponding public queries remain the backend's responsibility.
export const adminApi = {
  dashboard: anyApi.admin.getDashboard as FunctionReference<"query", "public", Record<string, never>, DashboardData>,
  searchProjects: anyApi.admin.searchProjects as FunctionReference<
    "query",
    "public",
    { query: string; state?: string },
    Project[]
  >,
  projectDetails: anyApi.admin.getProjectDetails as FunctionReference<
    "query",
    "public",
    { projectId: string },
    ProjectDetails | null
  >,
  projectActivity: anyApi.projects.projectActivity as FunctionReference<
    "query",
    "public",
    { projectId: string },
    ActivityEvent[]
  >,
  // Dedicated, independently-reactive feed of a build job's Devin session
  // progress (messages/status changes/new commits) — see
  // convex/admin.ts::getBuildProgress.
  buildProgress: anyApi.admin.getBuildProgress as FunctionReference<
    "query",
    "public",
    { buildJobId: string },
    BuildProgressEvent[]
  >,
  health: anyApi.admin.getHealth as FunctionReference<"query", "public", Record<string, never>, HealthData>,
  // Server-side cursor pagination (10/page in the Admin UI) over every
  // business ever discovered, past sessions included — see
  // convex/businesses.ts::listBusinesses.
  businesses: anyApi.businesses.listBusinesses as FunctionReference<
    "query",
    "public",
    {
      city?: string;
      area?: string;
      category?: string;
      eligibleOnly?: boolean;
      excludeWithProject?: boolean;
      paginationOpts: PaginationOptions;
    },
    PaginationResult<Business>
  >,
  // maxResults is the final, LLM-filtered lead count (Admin UI default 5);
  // context.dev is always queried for a larger raw pool under the hood
  // (rawResultCount in the response) before the LLM extracts + filters it
  // down — see convex/businesses.ts::searchBusinesses.
  searchBusinesses: anyApi.businesses.searchBusinesses as FunctionReference<
    "action",
    "public",
    { city: string; area?: string; category: string; radius?: number; maxResults?: number },
    { inserted: number; updated: number; count: number; rawResultCount: number; mode: "live" }
  >,
  selectBusiness: anyApi.projects.selectBusiness as FunctionReference<
    "mutation",
    "public",
    { businessId: string; selectedBy?: string; overridePhone?: string },
    { projectId: string; alreadySelected: boolean }
  >,
  // One business -> many projects (T7.x business detail view): every project
  // ever started for a business, most recent first.
  businessDetails: anyApi.businesses.getBusinessDetails as FunctionReference<
    "query",
    "public",
    { businessId: string },
    BusinessDetails | null
  >,
  // Failure-recovery entry points (T7.3, Section 11's Failure Recovery table).
  // These call admin-gated public wrappers (T7.4) in convex/retryActions.ts —
  // the actual stage actions (voiceCalls:startCall etc.) are internalAction
  // and can't be called directly from the browser.
  retryCall: anyApi.retryActions.retryCall as FunctionReference<"action", "public", { projectId: string }, unknown>,
  retryExtraction: anyApi.retryActions.retryExtraction as FunctionReference<"action", "public", { projectId: string }, unknown>,
  retryRepoPrep: anyApi.retryActions.retryRepoPrep as FunctionReference<"action", "public", { projectId: string }, unknown>,
  retryBuild: anyApi.retryActions.retryBuild as FunctionReference<
    "action",
    "public",
    { projectId: string; revisionRequestId?: string; targetBranch?: string },
    unknown
  >,
  retryDeploy: anyApi.retryActions.retryDeploy as FunctionReference<"action", "public", { projectId: string }, unknown>,
  // Generic "resume from any step" control (convex/adminRecovery.ts) —
  // resumes a project from any primary-pipeline checkpoint, not just the
  // handful of specific *_FAILED kinds the retry* wrappers above cover.
  resumeProject: anyApi.adminRecovery.resumeProject as FunctionReference<
    "action",
    "public",
    { projectId: string; targetState: string; reason?: string },
    { fromState: string; toState: string; correlationId: string }
  >,
};

export const replayLastResponse = makeFunctionReference<
  "mutation",
  { projectId: string; stage: string; cacheKey?: string },
  { replayRequestId: string; scheduledFunctionId: string }
>("lib/externalCall:replayLastResponse");

export const listCachedResponses = makeFunctionReference<
  "query",
  { projectId: string },
  CachedResponse[]
>("lib/externalCall:listCachedResponses");
