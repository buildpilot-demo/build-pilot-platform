import {
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
  type FunctionReference,
} from "convex/server";
import { v, type GenericId } from "convex/values";

import { normalizePhone } from "./businesses.js";

const startCallReference = makeFunctionReference<"action">(
  "voiceCalls:startCall",
) as unknown as FunctionReference<
  "action",
  "internal",
  { projectId: GenericId<"projects"> },
  unknown
>;

function correlationId(): string {
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Default outbound-call number (T7.x demo/testing aid) — kept in sync with
// businesses.ts's DEFAULT_CALL_PHONE so a selection always has somewhere to
// dial even if the business row predates the default-number backfill.
const DEFAULT_CALL_PHONE = process.env.DEFAULT_CALL_PHONE?.trim() || "+971588711809";

export const selectBusiness = mutationGeneric({
  args: {
    businessId: v.id("businesses"),
    selectedBy: v.optional(v.string()),
    // Admin-supplied phone override (T7.x demo/testing aid): the admin can
    // still point the call at a different number they control instead of
    // the default. Falls back to DEFAULT_CALL_PHONE when omitted.
    overridePhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db.get("businesses", args.businessId);
    if (!business) throw new Error(`Business ${args.businessId} not found`);
    const now = Date.now();
    // Eligibility/do-not-contact/phone-format validation removed per admin
    // request — every business is treated as contactable, always dialing
    // the admin override (if provided), the business's existing phone, or
    // DEFAULT_CALL_PHONE as a last resort.
    const requestedPhone = args.overridePhone?.trim() || business.normalizedPhone || business.phone || DEFAULT_CALL_PHONE;
    const normalizedPhone = normalizePhone(requestedPhone) ?? DEFAULT_CALL_PHONE;
    await ctx.db.patch("businesses", args.businessId, {
      phone: normalizedPhone,
      normalizedPhone,
      contactEligible: true,
      doNotContact: false,
      contactBasis: args.overridePhone?.trim() ? "admin_override" : business.contactBasis ?? "default_admin_number",
      updatedAt: now,
    });
    business.normalizedPhone = normalizedPhone;
    business.contactEligible = true;
    business.doNotContact = false;

    // Every call to selectBusiness spins up a brand-new Lead/Project/
    // WorkflowRun (T7.x demo/testing aid) instead of reusing an existing
    // in-flight one — this lets the admin re-test the voice call for the
    // same business as many times as needed without touching (or replaying
    // state transitions on) a project that's already progressed elsewhere
    // in the pipeline, which would risk invalid state-machine transitions.
    // Each new project starts fresh at PROJECT_CREATED and runs the normal
    // state flow independently.
    const correlation = correlationId();
    const leadId = await ctx.db.insert("leads", {
      businessId: args.businessId,
      status: "selected",
      selectedBy: args.selectedBy,
      selectedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const projectId = await ctx.db.insert("projects", {
      leadId,
      businessId: args.businessId,
      state: "PROJECT_CREATED",
      name: business.name,
      correlationId: correlation,
      createdAt: now,
      updatedAt: now,
      totalDurationMs: 0,
    });
    const workflowRunId = await ctx.db.insert("workflowRuns", {
      projectId,
      type: "initial",
      state: "PROJECT_CREATED",
      status: "active",
      version: 1,
      correlationId: correlation,
      startedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("projects", projectId, { workflowRunId });
    await ctx.db.patch("leads", leadId, { projectId, status: "active", updatedAt: now });
    await ctx.db.insert("activityEvents", {
      projectId,
      workflowRunId,
      eventType: "PROJECT_CREATED",
      stage: "BUSINESS_SELECTION",
      toState: "PROJECT_CREATED",
      timestamp: now,
      correlationId: correlation,
      message: `Selected ${business.name}`,
    });
    const scheduledFunctionId = await ctx.scheduler.runAfter(0, startCallReference, { projectId });
    return { leadId, projectId, workflowRunId, scheduledFunctionId, alreadySelected: false };
  },
});

export const listProjects = queryGeneric({
  args: {
    state: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 100)));
    const projects = args.state
      ? await ctx.db.query("projects").withIndex("by_state", (query) => query.eq("state", args.state as never)).order("desc").take(limit)
      : await ctx.db.query("projects").order("desc").take(limit);
    return await Promise.all(projects.map(async (project) => ({
      ...project,
      business: await ctx.db.get("businesses", project.businessId),
      lead: await ctx.db.get("leads", project.leadId),
    })));
  },
});

export const getProject = queryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) return null;
    const [business, lead, workflowRun, voiceSessions, transcripts, requirement] = await Promise.all([
      ctx.db.get("businesses", project.businessId),
      ctx.db.get("leads", project.leadId),
      project.workflowRunId ? ctx.db.get("workflowRuns", project.workflowRunId) : null,
      ctx.db.query("voiceSessions").withIndex("by_project_id", (query) => query.eq("projectId", args.projectId)).order("desc").collect(),
      ctx.db.query("transcripts").withIndex("by_project_id", (query) => query.eq("projectId", args.projectId)).order("desc").collect(),
      ctx.db.query("requirements").withIndex("by_project_id", (query) => query.eq("projectId", args.projectId)).order("desc").first(),
    ]);
    const requirementVersion = requirement?.currentVersionId ? await ctx.db.get("requirementVersions", requirement.currentVersionId) : null;
    const activity = await ctx.db.query("activityEvents").withIndex("by_project_timestamp", (query) => query.eq("projectId", args.projectId)).order("desc").take(200);
    return { project, business, lead, workflowRun, voiceSessions, transcripts, requirement, requirementVersion, activity };
  },
});

export const projectDetail = getProject;

// Dedicated, reactively-subscribed activity feed for a single project's
// detail view (T7.2): every state transition transitionProject() writes,
// in chronological order. Kept separate from getProject/getProjectDetails
// so the live timeline can update independently of the rest of the page.
export const projectActivity = queryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activityEvents")
      .withIndex("by_project_timestamp", (query) => query.eq("projectId", args.projectId))
      .order("asc")
      .take(500);
  },
});
