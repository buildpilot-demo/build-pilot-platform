import { queryGeneric } from "convex/server";
import { v } from "convex/values";

// NOTE: Admin authentication is intentionally disabled for now; any user can
// access these queries. Authentication will be added back in a future pass.

function needsAttention(state: string) {
  return state === "MANUAL_INTERVENTION_REQUIRED" || state.endsWith("_FAILED");
}

export const getDashboard = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").order("desc").take(50);
    const recentActivity = await ctx.db.query("activityEvents").order("desc").take(25);
    return {
      totals: {
        projects: projects.length,
        active: projects.filter(
          (project) => !["DELIVERED", "CANCELLED"].includes(String(project.state)) && !needsAttention(String(project.state)),
        ).length,
        delivered: projects.filter((project) => project.state === "DELIVERED").length,
        needsAttention: projects.filter((project) => needsAttention(String(project.state))).length,
      },
      projects,
      recentActivity,
    };
  },
});

export const searchProjects = queryGeneric({
  args: { query: v.string(), state: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const projects = args.state
      ? await ctx.db
          .query("projects")
          .filter((query) => query.eq(query.field("state"), args.state))
          .order("desc")
          .take(100)
      : await ctx.db.query("projects").order("desc").take(100);
    const search = args.query.trim().toLowerCase();
    if (!search) return projects;

    const matching = await Promise.all(
      projects.map(async (project) => {
        const business = await ctx.db.get("businesses", project.businessId);
        const haystack = [
          project._id,
          project.name,
          project.correlationId,
          business?.name,
          business?.category,
          business?.city,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(search) ? project : null;
      }),
    );
    return matching.filter((project) => project !== null);
  },
});

export const getProjectDetails = queryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) return null;
    const [business, workflowRun, repository, deployment, activity, revisionRequest, buildJob] = await Promise.all([
      ctx.db.get("businesses", project.businessId),
      project.workflowRunId
        ? ctx.db.get("workflowRuns", project.workflowRunId)
        : Promise.resolve(null),
      project.repositoryId
        ? ctx.db.get("repositories", project.repositoryId)
        : Promise.resolve(null),
      project.liveDeploymentId
        ? ctx.db.get("deployments", project.liveDeploymentId)
        : Promise.resolve(null),
      ctx.db
        .query("activityEvents")
        .filter((query) => query.eq(query.field("projectId"), args.projectId))
        .order("desc")
        .take(200),
      // Surfaces revision-loop failures (REVISION_BUILD_FAILED etc.) for T7.3's
      // "Retry Revision" action — these live on revisionRequests.status, not
      // project.state, since revision transitions leave the stable primary
      // project state unchanged (see stateMachine.ts).
      project.activeRevisionRequestId
        ? ctx.db.get("revisionRequests", project.activeRevisionRequestId)
        : Promise.resolve(null),
      // Most recent Devin build job, so the Admin UI can show live session
      // progress (status_enum, pull request, merge status) alongside the
      // coarse project.state — see devin.ts::recordDevinProgress.
      ctx.db
        .query("buildJobs")
        .withIndex("by_project_id", (query) => query.eq("projectId", args.projectId))
        .order("desc")
        .first(),
    ]);
    const [voiceSession, transcript, requirement] = await Promise.all([
      ctx.db
        .query("voiceSessions")
        .filter((query) => query.eq(query.field("projectId"), args.projectId))
        .order("desc")
        .first(),
      ctx.db
        .query("transcripts")
        .filter((query) => query.eq(query.field("projectId"), args.projectId))
        .order("desc")
        .first(),
      ctx.db
        .query("requirements")
        .filter((query) => query.eq(query.field("projectId"), args.projectId))
        .order("desc")
        .first(),
    ]);
    const requirementVersion = requirement?.currentVersionId
      ? await ctx.db.get("requirementVersions", requirement.currentVersionId)
      : null;
    return {
      project,
      business,
      workflowRun,
      repository,
      deployment,
      activity,
      revisionRequest,
      voiceSession,
      transcript,
      requirement,
      requirementVersion,
      buildJob,
    };
  },
});

// Dedicated, reactively-subscribed feed of a single build job's progress
// events (Devin session messages/status changes + new-commit signals) — kept
// separate from getProjectDetails so it can update independently as Devin
// makes progress, mirroring projects.ts::projectActivity's pattern for the
// state-transition timeline.
export const getBuildProgress = queryGeneric({
  args: { buildJobId: v.id("buildJobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("buildProgressEvents")
      .withIndex("by_build_job_timestamp", (query) => query.eq("buildJobId", args.buildJobId))
      .order("asc")
      .take(500);
  },
});

export const getHealth = queryGeneric({
  args: {},
  handler: async (ctx) => {
    // GITHUB_TOKEN/GITHUB_ORG alone aren't sufficient for repository
    // preparation to work — an active templateVersions row (populated by
    // github:configureStarterTemplate, see README.md) is also required, and
    // GITHUB_STARTER_REPO must be set for that action to run. Surface both
    // here so a missing one-time setup step doesn't stay invisible until an
    // operator hits "No active starter template is configured" mid-pipeline.
    const activeTemplate = await ctx.db
      .query("templateVersions")
      .withIndex("by_status", (query) => query.eq("status", "active"))
      .first();
    // LLM_PROVIDER selects which of these credentials requirements
    // extraction actually needs (see convex/requirements.ts resolveLlmConfig);
    // default is "openai" when unset.
    const llmProvider = (process.env.LLM_PROVIDER ?? "openai").trim().toLowerCase();
    const llmApiKeyEnvVar = llmProvider === "groq" ? "GROQ_API_KEY" : llmProvider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
    const services = [
      ["Convex", true],
      ["Context.dev", Boolean(process.env.CONTEXTDEV_API_KEY)],
      ["ElevenLabs", Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID)],
      [`LLM (${llmProvider})`, Boolean(process.env[llmApiKeyEnvVar])],
      ["GitHub", Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_ORG)],
      [
        "GitHub Starter Template",
        Boolean(process.env.GITHUB_STARTER_REPO) && activeTemplate !== null,
      ],
      ["Devin", Boolean(process.env.DEVIN_API_KEY)],
      ["Firebase", Boolean(process.env.FIREBASE_PROJECT_ID)],
      [
        "Generated Sites Backend",
        Boolean(process.env.GENERATED_SITE_CONVEX_URL && process.env.SITE_TENANT_PROVISION_TOKEN),
      ],
      ["Twilio", Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)],
    ].map(([name, configured]) => ({
      name: String(name),
      status: configured ? "OPERATIONAL" : "NOT_CONFIGURED",
      message: configured ? "Configuration is available" : "Required Convex environment variables are missing",
    }));
    return {
      status: services.every((service) => service.status === "OPERATIONAL")
        ? "OPERATIONAL"
        : "DEGRADED",
      checkedAt: Date.now(),
      services,
    };
  },
});
