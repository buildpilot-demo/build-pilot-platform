import { internalMutationGeneric } from "convex/server";

// One-time backfill: populates activityEvents.elapsedMs and
// projects.totalDurationMs for rows written before stateMachine.ts started
// computing those fields on every transition (see elapsedSincePreviousEvent
// in stateMachine.ts). Idempotent — always recomputes from source
// timestamps rather than trusting any previously-stored value, so it's safe
// to re-run (e.g. after importing more historical data).
//
// Run via: npx convex run adminBackfill:backfillActivityDurations
export const backfillActivityDurations = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    let projectsUpdated = 0;
    let eventsUpdated = 0;

    for (const project of projects) {
      await ctx.db.patch("projects", project._id, {
        totalDurationMs: project.updatedAt - project.createdAt,
      });
      projectsUpdated += 1;

      const events = await ctx.db
        .query("activityEvents")
        .withIndex("by_project_timestamp", (query) => query.eq("projectId", project._id))
        .order("asc")
        .collect();

      let previousTimestamp: number | undefined;
      for (const event of events) {
        const elapsedMs = previousTimestamp !== undefined ? event.timestamp - previousTimestamp : undefined;
        if (elapsedMs !== event.elapsedMs) {
          await ctx.db.patch("activityEvents", event._id, { elapsedMs });
          eventsUpdated += 1;
        }
        previousTimestamp = event.timestamp;
      }
    }

    return { projectsUpdated, eventsUpdated };
  },
});
