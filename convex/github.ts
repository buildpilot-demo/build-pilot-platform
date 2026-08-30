// convex/github.ts
//
// Stage 5 (Person C), T4.4 — Phase 8 (GitHub Repository Preparation) — NOT
// YET IMPLEMENTED. This file exists only as the scheduler target
// convex/assets.ts's T4.2 (`collectAssets`) dispatches to once asset
// collection finishes (with or without any assets — Phase 7 is not a hard
// blocker), per docs/task-plan.md T4.2 requirement 4. Replace `handler` below
// with the real implementation: create
// a private per-project repo from the pinned starter template, push the
// generated docs (`generatedDocuments`) and validated assets, record it in
// `repositories`, dispatch `validate-repository`, and transition
// REPOSITORY_PREPARING (PRD Section 4.4 / docs/task-plan.md T4.4).

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

export const prepareRepository = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (_ctx, { projectId }) => {
    console.warn(
      `prepareRepository(${projectId}): not implemented yet (Stage 5 T4.4) — documents were ` +
        "generated, but no repository has been created. The project stays at DOCUMENTS_READY " +
        "until T4.4 is implemented.",
    );
  },
});
