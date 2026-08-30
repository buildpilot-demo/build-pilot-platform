// convex/projects.ts
//
// Stage 3 (Person A), T2.3. Implements PHASE 2 (Lead & Project Creation,
// docs/project-requirements.md Section 6):
//
//   Admin (React)     -> selects eligible business
//   React             -> calls Convex mutation: selectBusiness()
//   Convex            -> atomically creates: Lead + Project + WorkflowRun
//   Convex             -> sets state: PROJECT_CREATED
//   Convex             -> schedules call automatically (no admin action needed)
//
// Deliberately deviates from the PRD's literal "validates eligibility +
// do-not-contact" step: this hackathon build treats business selection as
// unconditional (T7.x demo/testing aid) so an admin can re-run the full
// voice-call flow against the same business as many times as needed for
// testing/demo purposes, without ever getting blocked or needing to dedupe
// against a prior lead. Nothing here weakens do-not-contact enforcement
// for the *call itself* — convex/voiceCalls.ts::startCall still checks
// `business.contactEligible`/`business.doNotContact` before dialing.
//
// Scheduler hook (docs/task-plan.md Section 3, contract #5, row 5):
//
//   selectBusiness -> voiceCalls:startCall(projectId)
//
// `startCall` (Person B, Stage 4 T3.1) only proceeds when
// `project.state === "CALL_QUEUED"` (see its own doc comment), so this
// mutation must drive the state machine through PROJECT_CREATED ->
// CALL_QUEUED — not just PROJECT_CREATED — before scheduling it, per the
// exact sequence voiceCalls.ts's header comment documents. Both sides
// build against this contract independently; nothing here reaches into
// voiceCalls.ts beyond calling `internal.voiceCalls.startCall({ projectId })`.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_CALL_PHONE_FALLBACK, normalizePhone } from "./businesses";
import { transitionProject, type ProjectState } from "./stateMachine";

export const selectBusiness = mutation({
  args: {
    businessId: v.id("businesses"),
    selectedBy: v.optional(v.string()),
    overridePhone: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    leadId: Id<"leads">;
    projectId: Id<"projects">;
    workflowRunId: Id<"workflowRuns">;
    correlationId: string;
  }> => {
    const business = await ctx.db.get(args.businessId);
    if (!business) {
      throw new Error(`selectBusiness: business ${args.businessId} not found`);
    }

    // Requirement 1: resolve the call number. Always falls back rather
    // than throwing — overridePhone > the business's existing number >
    // DEFAULT_CALL_PHONE — and every path re-opens the business for
    // contact (contactEligible: true, doNotContact: false), regardless of
    // whatever it was set to before.
    const existingPhone = business.phoneE164 ?? business.phoneRaw;
    const resolvedPhone = args.overridePhone
      ? normalizePhone(args.overridePhone)
      : existingPhone || process.env.DEFAULT_CALL_PHONE || DEFAULT_CALL_PHONE_FALLBACK;
    const contactBasis = args.overridePhone ? "admin_override" : "default_admin_number";

    const now = Date.now();
    await ctx.db.patch(business._id, {
      phoneRaw: resolvedPhone,
      phoneE164: resolvedPhone,
      contactEligible: true,
      doNotContact: false,
      contactBasis,
      updatedAt: now,
    });

    // Requirement 2: a brand-new Lead + Project + WorkflowRun every call,
    // with no dedupe against any existing lead for this business.
    const correlationId = crypto.randomUUID();

    const leadId = await ctx.db.insert("leads", {
      businessId: business._id,
      status: "NEW",
      notes: args.selectedBy ? `Selected by ${args.selectedBy}` : undefined,
      createdAt: now,
      updatedAt: now,
    });

    const projectId = await ctx.db.insert("projects", {
      leadId,
      businessId: business._id,
      correlationId,
      createdAt: now,
      updatedAt: now,
    });

    const workflowRunId = await ctx.db.insert("workflowRuns", {
      projectId,
      runType: "PRIMARY",
      correlationId,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Requirement 3: every project starts fresh (undefined -> PROJECT_CREATED),
    // so this is always a legal INITIAL_STATES transition — never a
    // transition attempted on an already-progressed project.
    const transitionReason = args.selectedBy
      ? `Business selected by ${args.selectedBy}`
      : "Business selected via Admin UI";
    await transitionProject(ctx, projectId, "PROJECT_CREATED", {
      correlationId,
      stage: "PROJECT_CREATION",
      reason: transitionReason,
    });

    // startCall (convex/voiceCalls.ts) only starts dialing when
    // project.state === "CALL_QUEUED" -- see this file's header comment.
    await transitionProject(ctx, projectId, "CALL_QUEUED", {
      correlationId,
      stage: "PROJECT_CREATION",
      eventType: "AUTO_ADVANCE",
      reason: "Auto-queuing the voice call immediately after project creation",
    });

    // Requirement 4: schedule the call with no further admin action.
    await ctx.scheduler.runAfter(0, internal.voiceCalls.startCall, { projectId });

    return { leadId, projectId, workflowRunId, correlationId };
  },
});

// ---------------------------------------------------------------------------
// listProjectsForDashboard -- Stage 8 (Person A), T7.x. Backs the Admin
// UI's pipeline dashboard (/dashboard). Read-only: doesn't decide anything,
// just reports the current state stateMachine.ts already computed.
// ---------------------------------------------------------------------------

export interface DashboardProjectRow {
  projectId: Id<"projects">;
  businessName: string;
  correlationId: string;
  /** The primary workflowRun's state (falls back to `projects.state` if, for some reason, no primary run exists yet). Null only for a row inserted this instant, before its first transitionProject call lands. */
  state: ProjectState | null;
  /** Set (mirrors the failure-metadata block) only while `state` is a `*_FAILED` state or MANUAL_INTERVENTION_REQUIRED. */
  failedStage: string | null;
  /** When `state` was entered -- i.e. how long the project has been in its *current* stage. */
  stateEnteredAt: number;
  createdAt: number;
}

export const listProjectsForDashboard = query({
  args: {},
  handler: async (ctx): Promise<DashboardProjectRow[]> => {
    const projects = await ctx.db.query("projects").collect();

    const rows = await Promise.all(
      projects.map(async (project): Promise<DashboardProjectRow> => {
        const [business, workflowRuns] = await Promise.all([
          ctx.db.get(project.businessId),
          ctx.db
            .query("workflowRuns")
            .withIndex("by_project", (q) => q.eq("projectId", project._id))
            .collect(),
        ]);
        // The primary run is the one with no revisionRequestId (see
        // convex/stateMachine.ts's own findWorkflowRun) -- a revision's own
        // run is a separate row and isn't shown on this primary-pipeline view.
        const primaryRun = workflowRuns.find((run) => run.revisionRequestId === undefined);

        return {
          projectId: project._id,
          businessName: business?.name ?? "Unknown business",
          correlationId: project.correlationId,
          state: primaryRun?.state ?? project.state ?? null,
          failedStage: primaryRun?.failedStage ?? project.failedStage ?? null,
          stateEnteredAt: primaryRun?.updatedAt ?? project.updatedAt,
          createdAt: project.createdAt,
        };
      }),
    );

    return rows.sort((a, b) => b.stateEnteredAt - a.stateEnteredAt);
  },
});

/**
 * Aggregated reactive view backing the Admin UI's project detail panel
 * (the admin frontend's `/projects/:projectId`, scaffolded in Stage 2). Combines
 * the project row with its latest voiceSession, latest transcript, and
 * requirements row into a single query so the whole panel subscribes
 * through one `useQuery` call — Convex re-runs and pushes this
 * automatically whenever any of those four tables changes for this
 * project (a new voiceSession, the transcript arriving, requirements
 * being validated/failing, ...), no polling needed on the client.
 */
export const getProjectDetail = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) {
      return null;
    }

    const business = await ctx.db.get(project.businessId);

    const voiceSessions = await ctx.db
      .query("voiceSessions")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    voiceSessions.sort((a, b) => b.createdAt - a.createdAt);

    const transcripts = await ctx.db
      .query("transcripts")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    transcripts.sort((a, b) => b.receivedAt - a.receivedAt);

    const requirements = await ctx.db
      .query("requirements")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();

    return {
      project,
      businessName: business?.name ?? null,
      voiceSession: voiceSessions[0] ?? null,
      transcript: transcripts[0] ?? null,
      requirements,
    };
  },
});
