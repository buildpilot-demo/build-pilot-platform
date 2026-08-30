import {
  actionGeneric,
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
type RepositoryId = GenericId<"repositories">;

type RepositoryContext = {
  projectId: ProjectId;
  workflowRunId: GenericId<"workflowRuns">;
  correlationId: string;
  projectName: string;
  state: string;
  documents: Array<{ path: string; content: string }>;
  assets: Array<{ storageId: GenericId<"_storage">; path: string }>;
  template: { id: GenericId<"templateVersions">; repositoryUrl: string; commitSha: string; version: string };
};

type StoredRepository = {
  id: RepositoryId;
  owner: string;
  name: string;
  isPrivate: boolean;
  defaultBranch: string;
  initialCommitSha: string;
  correlationId: string;
  workflowRunId: GenericId<"workflowRuns">;
  status: string;
};

type GitHubResponse = {
  status: number;
  requestId: string;
  body: Value;
};

const contextRef = makeFunctionReference<"query">("github:loadRepositoryContext");
const failureContextRef = makeFunctionReference<"query">("github:loadRepositoryFailureContext");
const storedRef = makeFunctionReference<"query">("github:loadStoredRepository");
const beginRef = makeFunctionReference<"mutation">("github:beginRepositoryPreparation");
const saveRef = makeFunctionReference<"mutation">("github:saveRepository");
const failRef = makeFunctionReference<"mutation">("github:failRepositoryPreparation");
const validatedRef = makeFunctionReference<"mutation">("github:completeRepositoryValidation");
// Image sourcing (assets:sourceStockImages) has been removed from the
// pipeline — static images will be included in the starter template
// instead. Repository preparation now dispatches the Devin build directly,
// immediately after the seed commit lands — see the note above
// completeRepositoryValidation's call site in prepareRepository for why the
// separate GitHub Actions validate-repository.yml dispatch/poll was dropped.
const dispatchDevinBuildRef = makeFunctionReference<"action">("devin:dispatchDevinBuild");
// See BUILD_DISPATCH_WATCHDOG_MS below / devin.ts::checkBuildDispatchTimeout.
const checkBuildDispatchTimeoutRef = makeFunctionReference<"action">("devin:checkBuildDispatchTimeout");
const saveTemplateRef = makeFunctionReference<"mutation">("github:saveActiveTemplate");

// Mirrors devin.ts's own BUILD_DISPATCH_WATCHDOG_MS constant/value —
// duplicated here (rather than imported) to avoid a cross-module env-var
// coupling; keep both in sync if this is ever tuned.
const BUILD_DISPATCH_WATCHDOG_MS = Number(process.env.BUILD_DISPATCH_WATCHDOG_MS ?? 600_000);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "customer-site";
}

function repoParts(repositoryUrl: string): { owner: string; name: string } {
  const normalized = repositoryUrl.replace(/\.git$/, "");
  const match = normalized.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (!match) throw new Error(`Unsupported GitHub template URL: ${repositoryUrl}`);
  return { owner: match[1], name: match[2] };
}

function object(value: Value): Record<string, Value> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, Value>;
  throw new Error("GitHub returned an unexpected response");
}

function stringField(value: Value, field: string): string {
  const result = object(value)[field];
  if (typeof result !== "string" || !result) throw new Error(`GitHub response is missing ${field}`);
  return result;
}

async function githubCall(
  ctx: ExternalCallContext,
  context: { projectId: ProjectId; correlationId: string },
  cacheKey: string,
  request: { method?: string; path: string; body?: Value; replayHandler?: string; replayArgs?: Record<string, Value>; retryNotFound?: boolean },
): Promise<GitHubResponse> {
  return await callExternal<GitHubResponse>(ctx, {
    projectId: context.projectId,
    stage: "REPOSITORY_PREP",
    version: cacheKey,
    cacheKey,
    provider: "github",
    correlationId: context.correlationId,
    replayHandler: { functionName: request.replayHandler ?? "github:prepareRepository", args: request.replayArgs },
    providerRequestId: (response) => response.requestId,
    live: async (attempt) => {
      let conflictAttempt = 0;
      let notFoundAttempt = 0;
      for (;;) {
        const response = await fetch(`https://api.github.com${request.path}`, {
          method: request.method ?? "GET",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${required("GITHUB_TOKEN")}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
        });
        const requestId = response.headers.get("x-github-request-id") ?? `${response.status}:${cacheKey}`;
        await attempt.recordProviderRequest(requestId);
        const raw = await response.text();
        let body: Value = null;
        if (raw) {
          try {
            body = JSON.parse(raw) as Value;
          } catch {
            body = raw;
          }
        }
        if (!response.ok) {
          if (response.status === 409 && conflictAttempt < CONTENT_CONFLICT_RETRIES) {
            conflictAttempt += 1;
            await sleep(CONTENT_CONFLICT_RETRY_DELAY_MS * conflictAttempt);
            continue;
          }
          // GitHub's "generate repository from template" endpoint (the
          // .../generate POST below) returns as soon as the repo object
          // exists, but populates the initial commit and default-branch ref
          // asynchronously afterwards. A GET for that ref immediately after
          // creation can 404 for a few seconds while that catches up, even
          // though the repo itself is already visible (confirmed by the
          // GitHub UI showing the freshly created repo). Retry with backoff
          // instead of failing outright, but only for callers that opt in
          // (request.retryNotFound) - a 404 on other calls is a real error.
          if (request.retryNotFound && response.status === 404 && notFoundAttempt < REPO_INIT_NOT_FOUND_RETRIES) {
            notFoundAttempt += 1;
            await sleep(Math.min(REPO_INIT_NOT_FOUND_RETRY_DELAY_MS * notFoundAttempt, 10_000));
            continue;
          }
          throw new Error(`GitHub ${request.method ?? "GET"} ${request.path} failed (${response.status}): ${raw.slice(0, 500)}`);
        }
        return { status: response.status, requestId, body };
      }
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GitHub's Contents API commits each PUT against the branch's current head
// and can return 409 ("... is at X but expected Y") when consecutive writes
// to the same branch land before the previous commit has fully propagated —
// a known replication-lag quirk (not a real concurrent-edit conflict, since
// prepareRepository writes files to a brand-new repo strictly sequentially).
// Retrying after a short backoff resolves it without any special handling.
const CONTENT_CONFLICT_RETRIES = 4;
const CONTENT_CONFLICT_RETRY_DELAY_MS = 1_000;

// See the request.retryNotFound comment in githubCall's live handler above:
// covers the async lag between a template-generated repo appearing and its
// default-branch ref becoming queryable. 8 attempts with delay capped at 10s
// (1.5s, 3s, 4.5s, 6s, 7.5s, 9s, 10s, 10s - ~51s total) comfortably covers
// the lag observed in practice without hanging indefinitely on a repo whose
// creation genuinely failed.
const REPO_INIT_NOT_FOUND_RETRIES = 8;
const REPO_INIT_NOT_FOUND_RETRY_DELAY_MS = 1_500;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export const loadRepositoryContext = internalQueryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<RepositoryContext> => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);
    if (!project.workflowRunId) throw new Error(`Project ${args.projectId} has no workflow run`);
    const template = await ctx.db
      .query("templateVersions")
      .withIndex("by_status", (query) => query.eq("status", "active"))
      .order("desc")
      .first();
    if (!template) throw new Error("No active starter template is configured");
    const allDocuments = await ctx.db
      .query("generatedDocuments")
      .filter((query) => query.eq(query.field("projectId"), args.projectId))
      .order("desc")
      .collect();
    const seen = new Set<string>();
    const documents = allDocuments.filter((document) => {
      if (seen.has(document.path)) return false;
      seen.add(document.path);
      return true;
    }).map((document) => ({ path: document.path, content: document.content }));
    // documents.ts now emits exactly one document per project: the
    // machine-readable, cinematic-3D src/site.config.ts (see
    // docs/DEVIN_3D_WEBSITE_SPEC.md). SITE_BRIEF.md was folded into the
    // Devin build prompt itself (devin.ts) instead of a separate file.
    if (documents.length < 1) throw new Error("Generated project documents are incomplete");
    const assets = (await ctx.db
      .query("assets")
      .withIndex("by_project_id", (query) => query.eq("projectId", args.projectId))
      .filter((query) => query.eq(query.field("status"), "validated"))
      .collect()).map((asset) => ({ storageId: asset.storageId, path: `public/assets/${asset.sanitizedFilename}` }));
    return {
      projectId: args.projectId,
      workflowRunId: project.workflowRunId,
      correlationId: project.correlationId,
      projectName: project.name ?? `customer-${args.projectId}`,
      state: project.state,
      documents,
      assets,
      template: { id: template._id, repositoryUrl: template.repositoryUrl, commitSha: template.commitSha, version: template.version },
    };
  },
});

// Lightweight lookup used only for failure reporting when
// loadRepositoryContext itself throws (e.g. no active starter template) —
// unlike loadRepositoryContext this never throws for "incomplete" data, so
// prepareRepository can always record a GITHUB_FAILED transition instead of
// leaving the project stuck in REPOSITORY_PREPARING with no error surfaced.
export const loadRepositoryFailureContext = internalQueryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<{ workflowRunId: GenericId<"workflowRuns">; correlationId: string } | null> => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project?.workflowRunId) return null;
    return { workflowRunId: project.workflowRunId, correlationId: project.correlationId };
  },
});

export const loadStoredRepository = internalQueryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<StoredRepository> => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project?.repositoryId) throw new Error(`Project ${args.projectId} has no repository`);
    const repository = await ctx.db.get("repositories", project.repositoryId);
    if (!repository?.initialCommitSha) throw new Error("Repository has no initial commit");
    if (!project.workflowRunId) throw new Error("Project has no workflow run");
    return {
      id: repository._id,
      owner: repository.owner,
      name: repository.name,
      isPrivate: repository.isPrivate,
      defaultBranch: repository.defaultBranch,
      initialCommitSha: repository.initialCommitSha,
      correlationId: project.correlationId,
      workflowRunId: project.workflowRunId,
      status: repository.status,
    };
  },
});

type BeginRepositoryPreparationResult =
  | { status: "ready"; previousState: string; workflowRunId: GenericId<"workflowRuns">; correlationId: string }
  | { status: "not_ready" };

// documents:generateDocuments schedules github:prepareRepository with
// ctx.scheduler.runAfter(0, ...) right after persisting src/site.config.ts.
// Convex scheduled functions are delivered at-least-once, and (now that
// document generation makes a real LLM call instead of completing
// synchronously) that scheduling can plausibly fire more than once for the
// same project. A redundant prepareRepository invocation must not race the
// legitimate one's still-committing persistDocuments write: this mutation
// checks project state AND document existence in one atomic transaction —
// closing the race — and returns "not_ready" (rather than throwing)
// whenever it can't confirm both, so the action layer can quietly skip
// instead of misdiagnosing this as "documents incomplete" and marking the
// whole project GITHUB_FAILED out from under the invocation that's about
// to succeed.
export const beginRepositoryPreparation = internalMutationGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<BeginRepositoryPreparationResult> => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);
    if (!project.workflowRunId) throw new Error(`Project ${args.projectId} has no workflow run`);
    const previousState = project.state;
    const workflowRunId = project.workflowRunId;
    const correlationId = project.correlationId;
    if (previousState === "DOCUMENTS_READY" || previousState === "GITHUB_FAILED") {
      const document = await ctx.db
        .query("generatedDocuments")
        .withIndex("by_project_type", (query) => query.eq("projectId", args.projectId))
        .filter((query) => query.eq(query.field("type"), "site_config"))
        .first();
      if (!document) return { status: "not_ready" };
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "REPOSITORY_PREPARING", {
        workflowRunId,
        correlationId,
        stage: "REPOSITORY_PREP",
      });
      return { status: "ready", previousState, workflowRunId, correlationId };
    }
    if (previousState === "REPOSITORY_PREPARING" || previousState === "REPOSITORY_READY") {
      return { status: "ready", previousState, workflowRunId, correlationId };
    }
    return { status: "not_ready" };
  },
});

export const saveRepository = internalMutationGeneric({
  args: {
    projectId: v.id("projects"),
    templateVersionId: v.id("templateVersions"),
    githubRepositoryId: v.string(),
    owner: v.string(),
    name: v.string(),
    url: v.string(),
    isPrivate: v.boolean(),
    defaultBranch: v.string(),
    targetBranch: v.string(),
    initialCommitSha: v.string(),
    githubRunId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("repositories")
      .withIndex("by_project_id", (query) => query.eq("projectId", args.projectId))
      .first();
    const now = Date.now();
    const { projectId, ...repositoryFields } = args;
    let repositoryId: RepositoryId;
    if (existing) {
      await ctx.db.patch("repositories", existing._id, { ...repositoryFields, status: "validating", updatedAt: now });
      repositoryId = existing._id;
    } else {
      repositoryId = await ctx.db.insert("repositories", {
        projectId,
        provider: "github",
        ...repositoryFields,
        status: "validating",
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch("projects", projectId, { repositoryId, updatedAt: now });
    return repositoryId;
  },
});

export const failRepositoryPreparation = internalMutationGeneric({
  args: { projectId: v.id("projects"), workflowRunId: v.id("workflowRuns"), correlationId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    // DOCUMENTS_READY is included alongside REPOSITORY_PREPARING because
    // loadRepositoryContext (e.g. missing active starter template) can throw
    // before beginRepositoryPreparation has transitioned the project off of
    // DOCUMENTS_READY; both are valid GITHUB_FAILED sources per stateMachine.ts.
    if (project?.state === "REPOSITORY_PREPARING" || project?.state === "DOCUMENTS_READY") {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "GITHUB_FAILED", {
        workflowRunId: args.workflowRunId,
        correlationId: args.correlationId,
        stage: "REPOSITORY_PREP",
        failedStage: "REPOSITORY_PREP",
        errorCode: "GITHUB_API_FAILED",
        errorMessage: args.message,
        retryable: true,
        retryCount: 1,
        maxRetries: 3,
        provider: "github",
        providerRequestId: args.correlationId,
      });
    }
    return null;
  },
});

export const completeRepositoryValidation = internalMutationGeneric({
  args: { projectId: v.id("projects"), repositoryId: v.id("repositories"), workflowRunId: v.id("workflowRuns"), correlationId: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("repositories", args.repositoryId, { status: "ready", updatedAt: Date.now() });
    const project = await ctx.db.get("projects", args.projectId);
    if (project?.state === "REPOSITORY_PREPARING") {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "REPOSITORY_READY", {
        workflowRunId: args.workflowRunId,
        correlationId: args.correlationId,
        stage: "REPOSITORY_VALIDATION",
        provider: "github",
        providerRequestId: args.runId,
      });
    }
    return null;
  },
});

export const configureStarterTemplate = actionGeneric({
  args: {},
  handler: async (ctx) => {
    // NOTE: Admin authentication is intentionally disabled for now; any user
    // can call this. Authentication will be added back in a future pass.
    const repositoryUrl = required("GITHUB_STARTER_REPO");
    const repository = repoParts(repositoryUrl);
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${required("GITHUB_TOKEN")}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const repositoryResponse = await fetch(
      `https://api.github.com/repos/${repository.owner}/${repository.name}`,
      { headers },
    );
    if (!repositoryResponse.ok) {
      throw new Error(`GitHub starter repository lookup failed (${repositoryResponse.status})`);
    }
    const repositoryBody = (await repositoryResponse.json()) as Record<string, unknown>;
    const defaultBranch = String(repositoryBody.default_branch ?? "main");
    const commitResponse = await fetch(
      `https://api.github.com/repos/${repository.owner}/${repository.name}/commits/${encodeURIComponent(defaultBranch)}`,
      { headers },
    );
    if (!commitResponse.ok) {
      throw new Error(`GitHub starter commit lookup failed (${commitResponse.status})`);
    }
    const commitBody = (await commitResponse.json()) as Record<string, unknown>;
    const commitSha = String(commitBody.sha ?? "");
    if (!commitSha) throw new Error("GitHub starter repository did not return a commit SHA");
    return await ctx.runMutation(saveTemplateRef, {
      name: repository.name,
      version: commitSha.slice(0, 12),
      repositoryUrl,
      commitSha,
    });
  },
});

export const saveActiveTemplate = internalMutationGeneric({
  args: {
    name: v.string(),
    version: v.string(),
    repositoryUrl: v.string(),
    commitSha: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const active = await ctx.db
      .query("templateVersions")
      .withIndex("by_status", (query) => query.eq("status", "active"))
      .collect();
    for (const template of active) {
      if (template.commitSha !== args.commitSha) {
        await ctx.db.patch("templateVersions", template._id, {
          status: "retired",
          updatedAt: now,
        });
      }
    }
    const existing = await ctx.db
      .query("templateVersions")
      .withIndex("by_commit_sha", (query) => query.eq("commitSha", args.commitSha))
      .first();
    if (existing) {
      await ctx.db.patch("templateVersions", existing._id, {
        status: "active",
        validatedAt: now,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("templateVersions", {
      ...args,
      status: "active",
      validatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Internal: reachable only from server-side code (ctx.scheduler, the new
// admin-gated retryRepoPrep wrapper in retryActions.ts) — never directly by
// a client/raw API call (T7.4, Section 12).
export const prepareRepository = internalActionGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    // context is loaded inside the try/catch below (rather than before it)
    // so that failures here — e.g. "No active starter template is
    // configured" — are still recorded as GITHUB_FAILED instead of leaving
    // the project stuck in REPOSITORY_PREPARING/DOCUMENTS_READY with no
    // error surfaced to the operator.
    let context: RepositoryContext | undefined;
    try {
      const begun = await ctx.runMutation(beginRef, { projectId: args.projectId }) as BeginRepositoryPreparationResult;
      if (begun.status === "not_ready") {
        // A redundant/duplicate dispatch of this action for the same
        // project (see beginRepositoryPreparation's comment) — the
        // invocation that's actually ready will carry this through. Return
        // quietly instead of throwing so this doesn't mark the project
        // GITHUB_FAILED out from under it.
        return { skipped: true as const };
      }
      context = await ctx.runQuery(contextRef, args) as RepositoryContext;
      const existing = begun.previousState === "REPOSITORY_PREPARING"
        ? await ctx.runQuery(storedRef, args).catch(() => null) as StoredRepository | null
        : null;
      let owner: string;
      let name: string;
      let repositoryId: string;
      let url: string;
      let defaultBranch: string;
      let isPrivate: boolean;
      if (existing) {
        owner = existing.owner;
        name = existing.name;
        repositoryId = String(existing.id);
        url = `https://github.com/${owner}/${name}`;
        defaultBranch = existing.defaultBranch;
        isPrivate = existing.isPrivate;
      } else {
        const template = repoParts(context.template.repositoryUrl);
        const pinned = await githubCall(ctx as unknown as ExternalCallContext, context, `template-${context.template.commitSha}`, {
          path: `/repos/${template.owner}/${template.name}/commits/${context.template.commitSha}`,
        });
        if (stringField(pinned.body, "sha") !== context.template.commitSha) throw new Error("Pinned template commit could not be verified");
        owner = required("GITHUB_ORG");
        name = `${slug(context.projectName)}-${String(args.projectId).slice(-8).toLowerCase()}`;
        // Defaults to private; set GITHUB_REPO_VISIBILITY=public to create
        // generated site repos as public instead. Needed, for example, when
        // an org's Actions secrets (e.g. FIREBASE_SERVICE_ACCOUNT) are
        // scoped to "All public repositories" rather than "All
        // repositories" — a private repo would never see that secret and
        // every workflow run needing it would fail at that step.
        const requestedPrivate = (process.env.GITHUB_REPO_VISIBILITY?.trim().toLowerCase() ?? "private") !== "public";
        const created = await githubCall(ctx as unknown as ExternalCallContext, context, `create-${name}`, {
          method: "POST",
          path: `/repos/${template.owner}/${template.name}/generate`,
          body: { owner, name, private: requestedPrivate, description: `BuildPilot site for ${context.projectName}`, include_all_branches: false },
        });
        const body = object(created.body);
        repositoryId = String(body.id);
        url = stringField(created.body, "html_url");
        defaultBranch = typeof body.default_branch === "string" ? body.default_branch : "main";
        // Trust GitHub's actual response over what we asked for (e.g. an org
        // policy could force all repos private regardless of the request).
        isPrivate = typeof body.private === "boolean" ? body.private : requestedPrivate;
      }
      // Seed every generated document and validated asset as a single atomic
      // commit via the Git Data API, rather than one Contents-API PUT per
      // file. Consecutive per-file PUTs each commit against the branch's
      // current head and can 409 ("... is at X but expected Y") when
      // GitHub's internal ref replication lags behind rapid, sequential
      // writes to the same branch. Building one tree/commit and updating the
      // ref once avoids that race entirely, and since blobs/trees/commits
      // are inert until the final ref update, a retry that fails partway
      // through leaves the branch untouched.
      const files: Array<{ path: string; content: string }> = [
        ...context.documents.map((document) => ({
          path: document.path,
          content: base64(new TextEncoder().encode(document.content)),
        })),
      ];
      for (const asset of context.assets) {
        const assetUrl = await ctx.storage.getUrl(asset.storageId);
        if (!assetUrl) continue;
        const response = await fetch(assetUrl);
        if (!response.ok) throw new Error(`Unable to read validated asset ${asset.path}`);
        files.push({ path: asset.path, content: base64(new Uint8Array(await response.arrayBuffer())) });
      }
      const baseRef = await githubCall(ctx as unknown as ExternalCallContext, context, `base-ref-${defaultBranch}`, {
        path: `/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
        retryNotFound: true,
      });
      const baseCommitSha = stringField(object(baseRef.body).object, "sha");
      const baseCommit = await githubCall(ctx as unknown as ExternalCallContext, context, `base-commit-${baseCommitSha}`, {
        path: `/repos/${owner}/${name}/git/commits/${baseCommitSha}`,
      });
      const baseTreeSha = stringField(object(baseCommit.body).tree, "sha");
      const blobs: Array<{ path: string; sha: string }> = [];
      for (const file of files) {
        const blob = await githubCall(ctx as unknown as ExternalCallContext, context, `blob-${file.path}`, {
          method: "POST",
          path: `/repos/${owner}/${name}/git/blobs`,
          body: { content: file.content, encoding: "base64" },
        });
        blobs.push({ path: file.path, sha: stringField(blob.body, "sha") });
      }
      const tree = await githubCall(ctx as unknown as ExternalCallContext, context, `tree-${name}`, {
        method: "POST",
        path: `/repos/${owner}/${name}/git/trees`,
        body: {
          base_tree: baseTreeSha,
          tree: blobs.map((blob) => ({ path: blob.path, mode: "100644", type: "blob", sha: blob.sha })),
        },
      });
      const commit = await githubCall(ctx as unknown as ExternalCallContext, context, `commit-${name}`, {
        method: "POST",
        path: `/repos/${owner}/${name}/git/commits`,
        body: { message: "Add generated documents and validated assets", tree: stringField(tree.body, "sha"), parents: [baseCommitSha] },
      });
      const initialCommitSha = stringField(commit.body, "sha");
      await githubCall(ctx as unknown as ExternalCallContext, context, `update-ref-${defaultBranch}`, {
        method: "PATCH",
        path: `/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(defaultBranch)}`,
        body: { sha: initialCommitSha, force: false },
      });
      const repositoryId2 = await ctx.runMutation(saveRef, {
        projectId: args.projectId,
        templateVersionId: context.template.id,
        githubRepositoryId: repositoryId,
        owner,
        name,
        url,
        isPrivate,
        defaultBranch,
        // Demo target: Devin pulls and pushes directly on the repository's
        // default branch instead of a separate candidate branch, so there's
        // a single branch throughout the whole build/validate/deploy flow.
        targetBranch: defaultBranch,
        initialCommitSha,
      }) as RepositoryId;
      // No separate build-validation step: this is the repo's first commit,
      // generated straight from the pinned/verified starter template (its
      // own commit SHA was checked against context.template.commitSha
      // above), so there's nothing template-side left to validate. Skip the
      // validate-repository.yml GitHub Actions dispatch + poll and go
      // straight to REPOSITORY_READY, then kick off the Devin build.
      await ctx.runMutation(validatedRef, {
        projectId: args.projectId,
        repositoryId: repositoryId2,
        workflowRunId: context.workflowRunId,
        correlationId: context.correlationId,
        runId: initialCommitSha,
      });
      await ctx.scheduler.runAfter(0, dispatchDevinBuildRef, { projectId: args.projectId });
      // Watchdog: dispatchDevinBuild is scheduled immediately above, but if
      // that action is ever killed before reaching its first state
      // transition (uncaught error, platform-level timeout), nothing else
      // would move this project off REPOSITORY_READY. Self-heals by
      // dispatching the build again, a no-op if the pipeline already
      // advanced normally.
      await ctx.scheduler.runAfter(BUILD_DISPATCH_WATCHDOG_MS, checkBuildDispatchTimeoutRef, { projectId: args.projectId });
      return { owner, name, initialCommitSha };
    } catch (error) {
      const failureIds = context
        ? { workflowRunId: context.workflowRunId, correlationId: context.correlationId }
        : await ctx.runQuery(failureContextRef, args) as { workflowRunId: GenericId<"workflowRuns">; correlationId: string } | null;
      if (failureIds) {
        await ctx.runMutation(failRef, {
          projectId: args.projectId,
          workflowRunId: failureIds.workflowRunId,
          correlationId: failureIds.correlationId,
          message: error instanceof Error ? error.message : "Repository preparation failed",
        });
      }
      throw error;
    }
  },
});

