import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { ConvexHttpClient } from "convex/browser";
import { v, type GenericId, type Value } from "convex/values";

import { callExternal, type ExternalCallContext } from "./lib/externalCall.js";
import { transitionProject, type StateMachineContext } from "./stateMachine.js";

declare const process: { env: Record<string, string | undefined> };

type ProjectId = GenericId<"projects">;
type DeploymentId = GenericId<"deployments">;

type DeploymentContext = {
  projectId: ProjectId;
  workflowRunId: GenericId<"workflowRuns">;
  correlationId: string;
  buildJobId: GenericId<"buildJobs">;
  repositoryOwner: string;
  repositoryName: string;
  targetBranch: string;
  commitSha: string;
  artifactChecksum: string;
};

type DeploymentStatusContext = DeploymentContext & {
  deploymentRowId: DeploymentId;
  status: string;
  firebaseProjectId: string;
  firebaseSiteId: string;
  siteId: string;
  convexUrl: string;
  liveUrl: string;
  // The branch-HEAD commit the dispatched deploy-firebase.yml run actually
  // executes against (one commit ahead of commitSha — see startDeployment).
  // Falls back to commitSha for rows written before this field existed.
  deployedCommitSha: string;
};

type ProviderResponse = { status: number; requestId: string; body: Value };

const contextRef = makeFunctionReference<"query">("deployments:loadDeploymentContext");
const statusContextRef = makeFunctionReference<"query">("deployments:loadDeploymentStatusContext");
const queueRef = makeFunctionReference<"mutation">("deployments:queueDeployment");
const startRef = makeFunctionReference<"mutation">("deployments:startDeployment");
const completeRef = makeFunctionReference<"mutation">("deployments:completeDeployment");
const failRef = makeFunctionReference<"mutation">("deployments:failDeployment");
const reconcileRef = makeFunctionReference<"action">("deployments:reconcileFirebaseDeployment");
const deployTimeoutRef = makeFunctionReference<"action">("deployments:checkFirebaseDeploymentTimeout");
// Lives on the *other* Convex project (buildpilot-sites), not this
// deployment — invoked via ConvexHttpClient against GENERATED_SITE_CONVEX_URL
// below, never ctx.runMutation.
const provisionTenantRef = makeFunctionReference<"mutation">("siteTenants:provisionTenant");
// Implemented in T5.1: notifies the customer once their site is live.
const deliveryRef = makeFunctionReference<"action">("whatsapp:sendDeliveryMessage");

const FIREBASE_DEPLOY_POLL_INTERVAL_MS = Number(process.env.FIREBASE_DEPLOY_POLL_INTERVAL_MS ?? 15_000);
const FIREBASE_DEPLOY_TIMEOUT_MS = Number(process.env.FIREBASE_DEPLOY_TIMEOUT_MS ?? 900_000);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function object(value: Value): Record<string, Value> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, Value>;
  throw new Error("Provider returned an unexpected response");
}

function githubHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${required("GITHUB_TOKEN")}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function externalRequest(
  ctx: ExternalCallContext,
  config: {
    projectId: ProjectId;
    correlationId: string;
    stage: string;
    cacheKey: string;
    provider: string;
    replayHandler: string;
    replayArgs?: Record<string, Value>;
    live: (recordRequest: (id: string) => Promise<void>) => Promise<ProviderResponse>;
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
    live: async (attempt) => await config.live(attempt.recordProviderRequest),
  });
}

async function githubRequest(
  ctx: ExternalCallContext,
  context: { projectId: ProjectId; correlationId: string },
  cacheKey: string,
  path: string,
  method = "GET",
  body?: Value,
  replayHandler = "deployments:deployToFirebase",
  replayArgs?: Record<string, Value>,
): Promise<ProviderResponse> {
  return await externalRequest(ctx, {
    projectId: context.projectId,
    correlationId: context.correlationId,
    stage: "FIREBASE_DEPLOY",
    cacheKey,
    provider: "github",
    replayHandler,
    replayArgs,
    live: async (recordRequest) => {
      const response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: githubHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const raw = await response.text();
      const requestId = response.headers.get("x-github-request-id") ?? `github:${response.status}:${cacheKey}`;
      await recordRequest(requestId);
      let responseBody: Value = null;
      if (raw) {
        try { responseBody = JSON.parse(raw) as Value; } catch { responseBody = raw; }
      }
      if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${raw.slice(0, 500)}`);
      return { status: response.status, requestId, body: responseBody };
    },
  });
}

function siteSuffix(projectId: ProjectId): string {
  return String(projectId).toLowerCase().replace(/[^a-z0-9]/g, "").slice(-12);
}

export const loadDeploymentContext = internalQueryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<DeploymentContext> => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project?.repositoryId || !project.workflowRunId) throw new Error("Project repository or workflow is unavailable");
    const repository = await ctx.db.get("repositories", project.repositoryId);
    if (!repository) throw new Error("Repository not found");
    const build = await ctx.db
      .query("buildJobs")
      .withIndex("by_project_id", (query) => query.eq("projectId", args.projectId))
      .filter((query) => query.eq(query.field("status"), "completed"))
      .order("desc")
      .first();
    if (!build?.resultCommitSha || !build.artifactChecksum) throw new Error("No validated build is ready to deploy");
    return {
      projectId: args.projectId,
      workflowRunId: build.workflowRunId,
      correlationId: project.correlationId,
      buildJobId: build._id,
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
      targetBranch: build.targetBranch,
      commitSha: build.resultCommitSha,
      artifactChecksum: build.artifactChecksum,
    };
  },
});

export const loadDeploymentStatusContext = internalQueryGeneric({
  args: { projectId: v.id("projects"), deploymentId: v.optional(v.id("deployments")) },
  handler: async (ctx, args): Promise<DeploymentStatusContext> => {
    const base = await (async (): Promise<DeploymentContext> => {
      const project = await ctx.db.get("projects", args.projectId);
      if (!project?.repositoryId || !project.workflowRunId) throw new Error("Project repository or workflow is unavailable");
      const repository = await ctx.db.get("repositories", project.repositoryId);
      const deployment = args.deploymentId
        ? await ctx.db.get("deployments", args.deploymentId)
        : await ctx.db.query("deployments").withIndex("by_project_id", (query) => query.eq("projectId", args.projectId)).order("desc").first();
      if (!repository || !deployment || deployment.projectId !== args.projectId) throw new Error("Deployment context not found");
      const build = await ctx.db.get("buildJobs", deployment.buildJobId);
      if (!build) throw new Error("Deployment build not found");
      return {
        projectId: args.projectId,
        workflowRunId: deployment.workflowRunId,
        correlationId: project.correlationId,
        buildJobId: build._id,
        repositoryOwner: repository.owner,
        repositoryName: repository.name,
        targetBranch: build.targetBranch,
        commitSha: deployment.commitSha,
        artifactChecksum: deployment.artifactChecksum,
      };
    })();
    const deployment = args.deploymentId
      ? await ctx.db.get("deployments", args.deploymentId)
      : await ctx.db.query("deployments").withIndex("by_project_id", (query) => query.eq("projectId", args.projectId)).order("desc").first();
    if (!deployment) throw new Error("Deployment not found");
    const tenant = await ctx.db.query("siteTenants").withIndex("by_project_id", (query) => query.eq("projectId", args.projectId)).first();
    if (!tenant) throw new Error("Site tenant not found");
    return {
      ...base,
      deploymentRowId: deployment._id,
      status: deployment.status,
      firebaseProjectId: deployment.firebaseProjectId,
      firebaseSiteId: deployment.firebaseSiteId,
      siteId: tenant.siteId,
      convexUrl: tenant.convexUrl,
      liveUrl: deployment.liveUrl ?? `https://${deployment.firebaseSiteId}.web.app`,
      deployedCommitSha: deployment.deployedCommitSha ?? deployment.commitSha,
    };
  },
});

export const queueDeployment = internalMutationGeneric({
  args: { projectId: v.id("projects"), workflowRunId: v.id("workflowRuns"), correlationId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) throw new Error("Project not found");
    if (project.state === "BUILD_COMPLETED" || project.state === "DEPLOYMENT_FAILED") {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "DEPLOYMENT_QUEUED", { workflowRunId: args.workflowRunId, correlationId: args.correlationId, stage: "FIREBASE_DEPLOY" });
    } else if (project.state !== "DEPLOYMENT_QUEUED" && project.state !== "DEPLOYING" && project.state !== "LIVE") {
      throw new Error(`Cannot deploy while project is ${project.state}`);
    }
    return null;
  },
});

export const startDeployment = internalMutationGeneric({
  args: {
    projectId: v.id("projects"), workflowRunId: v.id("workflowRuns"), correlationId: v.string(), buildJobId: v.id("buildJobs"),
    firebaseProjectId: v.string(), firebaseSiteId: v.string(), siteId: v.string(), convexUrl: v.string(), commitSha: v.string(), deployedCommitSha: v.string(), artifactChecksum: v.string(), githubRunId: v.string(), liveUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenant = await ctx.db.query("siteTenants").withIndex("by_project_id", (query) => query.eq("projectId", args.projectId)).first();
    if (tenant) {
      if (tenant.firebaseProjectId !== args.firebaseProjectId || tenant.firebaseSiteId !== args.firebaseSiteId || tenant.siteId !== args.siteId) throw new Error("Existing site tenant does not match deployment configuration");
      await ctx.db.patch("siteTenants", tenant._id, { convexUrl: args.convexUrl, status: "active", updatedAt: now });
    } else {
      await ctx.db.insert("siteTenants", {
        projectId: args.projectId,
        siteId: args.siteId,
        firebaseProjectId: args.firebaseProjectId,
        firebaseSiteId: args.firebaseSiteId,
        convexUrl: args.convexUrl,
        backendVersion: process.env.GENERATED_SITE_BACKEND_VERSION?.trim() || "v1",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }
    const existing = await ctx.db.query("deployments")
      .filter((query) => query.and(query.eq(query.field("projectId"), args.projectId), query.eq(query.field("commitSha"), args.commitSha), query.eq(query.field("artifactChecksum"), args.artifactChecksum)))
      .order("desc").first();
    let deploymentId: DeploymentId;
    const fields = {
      workflowRunId: args.workflowRunId,
      buildJobId: args.buildJobId,
      firebaseProjectId: args.firebaseProjectId,
      firebaseSiteId: args.firebaseSiteId,
      githubRunId: args.githubRunId,
      commitSha: args.commitSha,
      deployedCommitSha: args.deployedCommitSha,
      artifactChecksum: args.artifactChecksum,
      status: "deploying",
      liveUrl: args.liveUrl,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch("deployments", existing._id, fields);
      deploymentId = existing._id;
    } else {
      deploymentId = await ctx.db.insert("deployments", { projectId: args.projectId, ...fields, createdAt: now });
    }
    const project = await ctx.db.get("projects", args.projectId);
    if (project?.state === "DEPLOYMENT_QUEUED") await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "DEPLOYING", { workflowRunId: args.workflowRunId, correlationId: args.correlationId, stage: "FIREBASE_DEPLOY", provider: "github", providerRequestId: args.githubRunId });
    return deploymentId;
  },
});

export const completeDeployment = internalMutationGeneric({
  args: { projectId: v.id("projects"), deploymentId: v.id("deployments"), workflowRunId: v.id("workflowRuns"), correlationId: v.string(), providerDeploymentId: v.string(), githubRunId: v.string(), liveUrl: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch("deployments", args.deploymentId, { deploymentId: args.providerDeploymentId, githubRunId: args.githubRunId, status: "live", liveUrl: args.liveUrl, validatedAt: now, promotedAt: now, updatedAt: now });
    await ctx.db.patch("projects", args.projectId, { liveDeploymentId: args.deploymentId, liveUrl: args.liveUrl, updatedAt: now });
    const project = await ctx.db.get("projects", args.projectId);
    if (project?.state === "DEPLOYING") await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "LIVE", { workflowRunId: args.workflowRunId, correlationId: args.correlationId, stage: "FIREBASE_DEPLOY", provider: "firebase", providerRequestId: args.providerDeploymentId });
    return null;
  },
});

export const failDeployment = internalMutationGeneric({
  args: { projectId: v.id("projects"), deploymentId: v.optional(v.id("deployments")), workflowRunId: v.id("workflowRuns"), correlationId: v.string(), message: v.string(), providerRequestId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.deploymentId) await ctx.db.patch("deployments", args.deploymentId, { status: "failed", failedStage: "FIREBASE_DEPLOY", errorCode: "DEPLOYMENT_FAILED", errorMessage: args.message, retryable: true, retryCount: 1, maxRetries: 3, provider: "firebase", providerRequestId: args.providerRequestId, updatedAt: now });
    const project = await ctx.db.get("projects", args.projectId);
    if (project && ["DEPLOYMENT_QUEUED", "DEPLOYING"].includes(project.state)) {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "DEPLOYMENT_FAILED", {
        workflowRunId: args.workflowRunId, correlationId: args.correlationId, stage: "FIREBASE_DEPLOY", failedStage: "FIREBASE_DEPLOY",
        errorCode: "DEPLOYMENT_FAILED", errorMessage: args.message, retryable: true, retryCount: 1, maxRetries: 3, provider: "firebase", providerRequestId: args.providerRequestId,
      });
    }
    return null;
  },
});

// Internal: reachable only from server-side code (ctx.scheduler, the new
// admin-gated retryDeploy wrapper in retryActions.ts) — never directly by a
// client/raw API call (T7.4, Section 12).
export const deployToFirebase = internalActionGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(contextRef, args) as DeploymentContext;
    await ctx.runMutation(queueRef, { projectId: args.projectId, workflowRunId: context.workflowRunId, correlationId: context.correlationId });
    const firebaseProjectId = required("FIREBASE_PROJECT_ID");
    // FIREBASE_SITE_PREFIX is a single shared prefix (e.g. "buildpilot"), not
    // one value per business/project — siteSuffix(projectId) below already
    // makes the resulting Hosting site ID unique per project, so the prefix
    // itself is meant to stay static across every deployment.
    const configuredSite = process.env.FIREBASE_SITE_ID?.trim();
    const firebaseSiteId = configuredSite || `${required("FIREBASE_SITE_PREFIX")}-${siteSuffix(args.projectId)}`;
    const siteId = `site_${siteSuffix(args.projectId)}`;
    // Must be the *shared, multi-tenant* Convex deployment's client API URL
    // (https://<other-deployment>.convex.cloud) that every generated
    // customer site's frontend talks to — a second, separate Convex project
    // from the one this pipeline itself runs on (see README.md's env var
    // table and docs/task-plan.md T0.1/T4.10). Never this deployment's own
    // URL, and never a `.convex.site` URL — that domain only serves HTTP
    // Actions (e.g. this deployment's own CONVEX_CALLBACK_URL webhook).
    const convexUrl = required("GENERATED_SITE_CONVEX_URL");
    const liveUrl = `https://${firebaseSiteId}.web.app`;
    // Scopes the two GitHub write calls below to this specific invocation
    // rather than to context.commitSha/artifactChecksum alone, which stay
    // identical across every retry (Retry Deploy / admin Resume) of the same
    // completed build. Without this, callExternal's idempotency cache
    // (lib/stageAttempt.ts) would permanently replay the *first* attempt's
    // responses on every later retry — no new commit pushed, no new
    // workflow actually dispatched — exactly the "Retry Build does nothing"
    // bug already fixed for Devin session creation in dispatchDevinBuild,
    // just showing up here as an infinite reconcileFirebaseDeployment poll
    // loop instead (see 6 below for the other half of that symptom).
    const attemptToken = Date.now().toString(36);
    let deploymentRowId: DeploymentId | undefined;
    try {
      // Step 1 of T4.10: provision/verify this project's siteTenants record
      // on the *shared* generated-site deployment (convexUrl) itself, not
      // just this deployment's own siteTenants row (written below by
      // startRef) — submitInquiry validates against a tenant row living on
      // that other project's own database, which nothing else populates.
      // Idempotent (upsert by siteId), so safe to re-run on every retry.
      const tenantClient = new ConvexHttpClient(convexUrl);
      await tenantClient.mutation(provisionTenantRef, {
        token: required("SITE_TENANT_PROVISION_TOKEN"),
        projectId: String(args.projectId),
        siteId,
        firebaseProjectId,
        firebaseSiteId,
        convexUrl,
        backendVersion: process.env.GENERATED_SITE_BACKEND_VERSION?.trim() || "v1",
      });
      const config = `VITE_SITE_ID=${siteId}\nVITE_CONVEX_URL=${convexUrl}\n`;
      // GitHub's "create or update file contents" PUT requires the file's
      // current `sha` when it already exists (a plain create-only payload
      // 422s with `"sha" wasn't supplied` on the second and later deploys,
      // since the first deploy already committed .env.production) — fetch
      // it first so this call is a real upsert, not just a first-deploy-only
      // create.
      const existingConfig = await githubRequest(ctx as unknown as ExternalCallContext, context, `site-config-lookup-${context.targetBranch}-${attemptToken}`, `/repos/${context.repositoryOwner}/${context.repositoryName}/contents/.env.production?ref=${encodeURIComponent(context.targetBranch)}`, "GET", undefined, "deployments:deployToFirebase").catch(() => null);
      const existingConfigSha = existingConfig?.body !== null && existingConfig?.body !== undefined
        ? (() => { const sha = object(existingConfig.body).sha; return typeof sha === "string" ? sha : undefined; })()
        : undefined;
      const configResponse = await githubRequest(ctx as unknown as ExternalCallContext, context, `site-config-${context.commitSha}-${attemptToken}`, `/repos/${context.repositoryOwner}/${context.repositoryName}/contents/.env.production`, "PUT", {
        message: "Configure public generated-site tenant",
        content: base64(config),
        branch: context.targetBranch,
        ...(existingConfigSha ? { sha: existingConfigSha } : {}),
      });
      // This PUT creates a *new* commit on top of context.commitSha (the
      // branch's HEAD moves). deploy-firebase.yml is then dispatched by
      // `ref` (the branch name), not by exact SHA, so the run GitHub
      // actually creates executes against — and reports back with —
      // this new commit, not context.commitSha. Polling for
      // context.commitSha (the pre-config-push value) would never match any
      // real run and loop forever; this is the bug that produced the
      // repeated "success (pending)" reconcileFirebaseDeployment polls.
      const configBody = object(configResponse.body);
      const deployedCommitSha = typeof object(configBody.commit).sha === "string" ? String(object(configBody.commit).sha) : context.commitSha;
      const dispatch = await githubRequest(ctx as unknown as ExternalCallContext, context, `dispatch-${context.commitSha}-${context.artifactChecksum}-${attemptToken}`, `/repos/${context.repositoryOwner}/${context.repositoryName}/actions/workflows/deploy-firebase.yml/dispatches`, "POST", {
        ref: context.targetBranch,
        inputs: {
          commit_sha: deployedCommitSha,
          artifact_checksum: context.artifactChecksum,
          firebase_project_id: firebaseProjectId,
          firebase_site_id: firebaseSiteId,
          site_id: siteId,
          correlation_id: context.correlationId,
        },
      });
      deploymentRowId = await ctx.runMutation(startRef, {
        projectId: args.projectId, workflowRunId: context.workflowRunId, correlationId: context.correlationId, buildJobId: context.buildJobId,
        firebaseProjectId, firebaseSiteId, siteId, convexUrl, commitSha: context.commitSha, deployedCommitSha, artifactChecksum: context.artifactChecksum, githubRunId: dispatch.requestId, liveUrl,
      }) as DeploymentId;
      // Detects deploy-firebase.yml's success signal by polling GitHub
      // Actions until the dispatched run completes, bounded by
      // checkFirebaseDeploymentTimeout scheduled alongside it.
      await ctx.scheduler.runAfter(FIREBASE_DEPLOY_POLL_INTERVAL_MS, reconcileRef, { projectId: args.projectId, deploymentId: deploymentRowId });
      await ctx.scheduler.runAfter(FIREBASE_DEPLOY_TIMEOUT_MS, deployTimeoutRef, { projectId: args.projectId, deploymentId: deploymentRowId });
      return { deploymentId: deploymentRowId, workflowRequestId: dispatch.requestId, liveUrl };
    } catch (error) {
      await ctx.runMutation(failRef, { projectId: args.projectId, deploymentId: deploymentRowId, workflowRunId: context.workflowRunId, correlationId: context.correlationId, message: error instanceof Error ? error.message : "Deployment dispatch failed", providerRequestId: context.correlationId });
      throw error;
    }
  },
});

// Internal: self-scheduled reconciliation poll, never called by a client.
export const reconcileFirebaseDeployment = internalActionGeneric({
  args: { projectId: v.id("projects"), deploymentId: v.optional(v.id("deployments")), pollToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(statusContextRef, { projectId: args.projectId, deploymentId: args.deploymentId }) as DeploymentStatusContext;
    // Already resolved (e.g. checkFirebaseDeploymentTimeout fired, or a
    // previous poll already advanced this deployment) — stop polling.
    if (context.status !== "deploying") return { status: context.status };
    const pollToken = args.pollToken ?? Date.now().toString(36);
    const replayArgs = { deploymentId: context.deploymentRowId, pollToken };
    // Must filter by deployedCommitSha (the commit deploy-firebase.yml
    // actually ran against, one commit ahead of commitSha after the
    // .env.production config push — see deployToFirebase), not commitSha
    // itself, or this never matches any real run and polls forever.
    const runsResponse = await githubRequest(ctx as unknown as ExternalCallContext, context, `deploy-status-${context.deployedCommitSha}-${pollToken}`, `/repos/${context.repositoryOwner}/${context.repositoryName}/actions/workflows/deploy-firebase.yml/runs?head_sha=${context.deployedCommitSha}&event=workflow_dispatch&per_page=10`, "GET", undefined, "deployments:reconcileFirebaseDeployment", replayArgs);
    const runs = object(runsResponse.body).workflow_runs;
    const run = Array.isArray(runs) ? runs.find((item) => item !== null && typeof item === "object" && !Array.isArray(item) && (item as Record<string, Value>).head_sha === context.deployedCommitSha) as Record<string, Value> | undefined : undefined;
    if (!run || run.status !== "completed") {
      // Detects deploy-firebase.yml's result by polling GitHub Actions
      // until the dispatched run completes — bounded by
      // checkFirebaseDeploymentTimeout, scheduled alongside the first poll.
      await ctx.scheduler.runAfter(FIREBASE_DEPLOY_POLL_INTERVAL_MS, reconcileRef, {
        projectId: args.projectId, deploymentId: context.deploymentRowId, pollToken: Date.now().toString(36),
      });
      return { status: "pending" as const };
    }
    const runId = String(run.id);
    if (run.conclusion !== "success") {
      await ctx.runMutation(failRef, { projectId: args.projectId, deploymentId: context.deploymentRowId, workflowRunId: context.workflowRunId, correlationId: context.correlationId, message: `Firebase workflow concluded ${String(run.conclusion)}`, providerRequestId: runId });
      return { status: "failed" as const, runId };
    }
    try {
      const verification = await externalRequest(ctx as unknown as ExternalCallContext, {
        projectId: args.projectId,
        correlationId: context.correlationId,
        stage: "LIVE_URL_VERIFICATION",
        cacheKey: `${context.commitSha}:${context.liveUrl}:${pollToken}`,
        provider: "firebase",
        replayHandler: "deployments:reconcileFirebaseDeployment",
        replayArgs,
        live: async (recordRequest) => {
          const htmlResponse = await fetch(context.liveUrl, { redirect: "follow" });
          const requestId = htmlResponse.headers.get("x-firebase-request-id") ?? `live:${htmlResponse.status}:${context.commitSha}`;
          await recordRequest(requestId);
          const html = await htmlResponse.text();
          if (htmlResponse.status !== 200) throw new Error(`Live URL returned HTTP ${htmlResponse.status}`);
          if (!/<title(?:\s[^>]*)?>[\s\S]*?<\/title>/i.test(html)) throw new Error("Live HTML does not contain a title");
          const scripts = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi), (match) => new URL(match[1], context.liveUrl).toString());
          if (!scripts.length) throw new Error("Live HTML does not load a JavaScript bundle");
          let combined = html;
          for (const script of scripts.slice(0, 20)) {
            const response = await fetch(script);
            if (!response.ok) throw new Error(`JavaScript bundle ${script} returned HTTP ${response.status}`);
            combined += `\n${await response.text()}`;
          }
          const secretPatterns = [
            /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
            /DEVIN_API_KEY\s*[:=]/i,
            /GITHUB_TOKEN\s*[:=]/i,
            /FIREBASE_SERVICE_ACCOUNT\s*[:=]/i,
            /TWILIO_AUTH_TOKEN\s*[:=]/i,
          ];
          if (secretPatterns.some((pattern) => pattern.test(combined))) throw new Error("A private credential marker is visible in the deployed bundle");
          if (!combined.includes(context.siteId) || !combined.includes(context.convexUrl)) throw new Error("Deployed bundle is not configured for the expected site tenant");
          const convexResponse = await fetch(context.convexUrl, { method: "GET", redirect: "manual" });
          if (convexResponse.status >= 500) throw new Error(`Shared Convex endpoint returned HTTP ${convexResponse.status}`);
          return { status: 200, requestId, body: { liveUrl: context.liveUrl, titlePresent: true, scriptsChecked: scripts.length, convexReachable: true } };
        },
      });
      await ctx.runMutation(completeRef, { projectId: args.projectId, deploymentId: context.deploymentRowId, workflowRunId: context.workflowRunId, correlationId: context.correlationId, providerDeploymentId: runId, githubRunId: runId, liveUrl: context.liveUrl });
      await ctx.scheduler.runAfter(0, deliveryRef, { projectId: args.projectId });
      return { status: "live" as const, runId, liveUrl: context.liveUrl, verification: verification.body };
    } catch (error) {
      await ctx.runMutation(failRef, { projectId: args.projectId, deploymentId: context.deploymentRowId, workflowRunId: context.workflowRunId, correlationId: context.correlationId, message: error instanceof Error ? error.message : "Live URL verification failed", providerRequestId: runId });
      throw error;
    }
  },
});

// Bounds reconcileFirebaseDeployment's self-rescheduled polling loop. A
// stuck/never-completing deploy-firebase.yml run (or a live-URL
// verification that never resolves) is an ordinary retryable deployment
// failure (Section 11: Retry Deploy -> resume from DEPLOYMENT_QUEUED) —
// it never touches projects.liveUrl/liveDeploymentId, so the previous
// live deployment is left untouched.
// Internal: self-scheduled timeout check, never called by a client.
export const checkFirebaseDeploymentTimeout = internalActionGeneric({
  args: { projectId: v.id("projects"), deploymentId: v.id("deployments") },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(statusContextRef, { projectId: args.projectId, deploymentId: args.deploymentId }).catch(() => null) as DeploymentStatusContext | null;
    if (!context || context.status !== "deploying") return { timedOut: false };
    await ctx.runMutation(failRef, {
      projectId: args.projectId,
      deploymentId: context.deploymentRowId,
      workflowRunId: context.workflowRunId,
      correlationId: context.correlationId,
      message: "Firebase deployment did not complete within the configured timeout",
      providerRequestId: context.commitSha,
    });
    return { timedOut: true };
  },
});
