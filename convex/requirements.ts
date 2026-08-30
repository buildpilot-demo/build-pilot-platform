// convex/requirements.ts
//
// Stage 4, T3.3 — Phase 5 (OpenAI requirement extraction) — NOT YET
// IMPLEMENTED. This file exists only as the scheduler target
// convex/webhooks/elevenlabs.ts's T3.2 webhook handler dispatches to once a
// transcript is received, so that wiring type-checks and the pipeline
// doesn't dead-end with a missing function reference. Replace `handler`
// below with the real implementation described in docs/task-plan.md T3.3:
// load the transcript, send it through callExternal (stage =
// "REQUIREMENTS_EXTRACTION") to OpenAI, validate/default the structured
// result, store requirements + requirementVersions, and transition
// REQUIREMENTS_PROCESSING -> REQUIREMENTS_READY -> REQUIREMENTS_VALIDATED
// (or -> REQUIREMENTS_FAILED on a malformed payload).

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

export const extractRequirements = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (_ctx, { projectId }) => {
    console.warn(
      `extractRequirements(${projectId}): not implemented yet (T3.3) — the transcript was ` +
        "received and stored, but no OpenAI extraction has run. The project stays at " +
        "TRANSCRIPT_RECEIVED until T3.3 is implemented.",
    );
  },
});
