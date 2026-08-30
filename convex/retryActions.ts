import { actionGeneric, makeFunctionReference, type FunctionReference } from "convex/server";
import { v, type GenericId } from "convex/values";

// T7.3's admin-facing "retry" entry points from Section 11's Failure
// Recovery table. Each is a thin public wrapper around the corresponding
// stage's now-internal action — the wrapper is what the Admin UI calls; no
// orchestration/retry logic lives here (Section 4.1).
// Splitting it this way means:
//   - a raw API client can never reach the real stage actions at all
//     (they're internalAction, not part of the public API);
//   - the automated pipeline (ctx.scheduler) is unaffected, since the
//     scheduler can still call internal actions directly, with no user
//     identity required.
// NOTE: Admin authentication is intentionally disabled for now; any user can
// call these wrappers. Authentication will be added back in a future pass.

type ProjectArg = { projectId: GenericId<"projects"> };

const startCallRef = makeFunctionReference<"action">("voiceCalls:startCall") as unknown as FunctionReference<
  "action",
  "internal",
  ProjectArg,
  unknown
>;
const extractRequirementsRef = makeFunctionReference<"action">(
  "requirements:extractRequirements",
) as unknown as FunctionReference<"action", "internal", ProjectArg, unknown>;
const prepareRepositoryRef = makeFunctionReference<"action">("github:prepareRepository") as unknown as FunctionReference<
  "action",
  "internal",
  ProjectArg,
  unknown
>;
const dispatchDevinBuildRef = makeFunctionReference<"action">(
  "devin:dispatchDevinBuild",
) as unknown as FunctionReference<
  "action",
  "internal",
  ProjectArg & { revisionRequestId?: GenericId<"revisionRequests">; targetBranch?: string },
  unknown
>;
const deployToFirebaseRef = makeFunctionReference<"action">("deployments:deployToFirebase") as unknown as FunctionReference<
  "action",
  "internal",
  ProjectArg,
  unknown
>;

export const retryCall = actionGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.runAction(startCallRef, args);
  },
});

export const retryExtraction = actionGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.runAction(extractRequirementsRef, args);
  },
});

export const retryRepoPrep = actionGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.runAction(prepareRepositoryRef, args);
  },
});

export const retryBuild = actionGeneric({
  args: {
    projectId: v.id("projects"),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    targetBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(dispatchDevinBuildRef, args);
  },
});

export const retryDeploy = actionGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.runAction(deployToFirebaseRef, args);
  },
});
