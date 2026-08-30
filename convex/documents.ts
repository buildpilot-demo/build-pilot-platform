// convex/documents.ts
//
// Stage 5 (Person C), T4.1 — Phase 6 (Document Generation) — NOT YET
// IMPLEMENTED. This file exists only as the scheduler target
// convex/requirements.ts's T3.3 (`extractRequirements`) dispatches to once
// requirements are validated, per docs/task-plan.md T3.3 requirement 5
// ("schedule generateDocuments — Person C's T4.1 in Stage 5, per the
// function path they publish; this is a fire-and-forget scheduler call, no
// live coordination needed"). Replace `handler` below with the real
// implementation: generate README.md / BUILD_SPEC.md / REQUIREMENTS.md /
// UI_GUIDELINES.md from the validated requirements, store them in
// `generatedDocuments`, and transition
// DOCUMENTS_GENERATING -> DOCUMENTS_READY (PRD Section 6, Phase 6).

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

export const generateDocuments = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (_ctx, { projectId }) => {
    console.warn(
      `generateDocuments(${projectId}): not implemented yet (Stage 5 T4.1) — requirements were ` +
        "validated, but no documents have been generated. The project stays at " +
        "REQUIREMENTS_VALIDATED until T4.1 is implemented.",
    );
  },
});
