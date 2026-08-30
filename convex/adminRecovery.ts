import {
  actionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v, type GenericId } from "convex/values";

import { adminForceProjectState, type ProjectState } from "./stateMachine.js";

// Generic "resume from any step" admin control (Section 11's Failure
// Recovery table only wires up a handful of specific *_FAILED -> retry
// mappings — this covers every checkpoint in the primary pipeline, so an
// operator can resume a project from any of them regardless of which stage
// actually failed, or push it back to an earlier checkpoint to re-run work).
// Unlike convex/retryActions.ts (which just re-invokes a stage's action
// as-is), this first force-writes the project + workflow run back to the
// chosen checkpoint state via stateMachine.ts::adminForceProjectState
// (bypassing the normal forward-only TRANSITIONS graph, fully audited via
// an ADMIN_OVERRIDE activityEvents row) before invoking that checkpoint's
// entry-point action. No orchestration/retry logic beyond that lives here,
// mirroring retryActions.ts's own thin-wrapper pattern.
//
// NOTE: Admin authentication is intentionally disabled for now; any user can
// call this wrapper. Authentication will be added back in a future pass
// (see T7.4 in docs/task-plan.md).

type ProjectId = GenericId<"projects">;
type ProjectArg = { projectId: ProjectId };

const startCallRef = makeFunctionReference<"action">("voiceCalls:startCall") as unknown as FunctionReference<
  "action",
  "internal",
  ProjectArg,
  unknown
>;
const extractRequirementsRef = makeFunctionReference<"action">(
  "requirements:extractRequirements",
) as unknown as FunctionReference<"action", "internal", ProjectArg, unknown>;
const generateDocumentsRef = makeFunctionReference<"action">(
  "documents:generateDocuments",
) as unknown as FunctionReference<"action", "internal", ProjectArg, unknown>;
const prepareRepositoryRef = makeFunctionReference<"action">("github:prepareRepository") as unknown as FunctionReference<
  "action",
  "internal",
  ProjectArg,
  unknown
>;
const dispatchDevinBuildRef = makeFunctionReference<"action">(
  "devin:dispatchDevinBuild",
) as unknown as FunctionReference<"action", "internal", ProjectArg, unknown>;
const deployToFirebaseRef = makeFunctionReference<"action">("deployments:deployToFirebase") as unknown as FunctionReference<
  "action",
  "internal",
  ProjectArg,
  unknown
>;
const sendDeliveryMessageRef = makeFunctionReference<"action">(
  "whatsapp:sendDeliveryMessage",
) as unknown as FunctionReference<"action", "internal", ProjectArg, unknown>;

// Every checkpoint an operator may resume a project from, and the
// entry-point action that drives the pipeline forward from there. Order
// matches the primary state sequence in stateMachine.ts so the Admin UI can
// render them as an ordered "resume from" list.
export const RESUMABLE_CHECKPOINTS: ReadonlyArray<{
  state: ProjectState;
  label: string;
  action: FunctionReference<"action", "internal", ProjectArg, unknown>;
}> = [
  { state: "PROJECT_CREATED", label: "Restart from business selection (place a new call)", action: startCallRef },
  { state: "CALL_QUEUED", label: "Retry voice call", action: startCallRef },
  { state: "REQUIREMENTS_PROCESSING", label: "Retry requirement extraction", action: extractRequirementsRef },
  { state: "DOCUMENTS_GENERATING", label: "Retry document generation", action: generateDocumentsRef },
  { state: "REPOSITORY_PREPARING", label: "Retry repository preparation", action: prepareRepositoryRef },
  { state: "BUILD_QUEUED", label: "Retry Devin build", action: dispatchDevinBuildRef },
  { state: "DEPLOYMENT_QUEUED", label: "Retry Firebase deployment", action: deployToFirebaseRef },
  { state: "NOTIFICATION_PENDING", label: "Retry WhatsApp delivery", action: sendDeliveryMessageRef },
];

const CHECKPOINTS_BY_STATE = new Map(RESUMABLE_CHECKPOINTS.map((checkpoint) => [checkpoint.state, checkpoint]));

function correlationId(): string {
  return `admin-resume-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const applyResume = internalMutationGeneric({
  args: { projectId: v.id("projects"), targetState: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const correlation = correlationId();
    const { fromState } = await adminForceProjectState(
      ctx as unknown as Parameters<typeof adminForceProjectState>[0],
      args.projectId as unknown as Parameters<typeof adminForceProjectState>[1],
      args.targetState as ProjectState,
      { correlationId: correlation, stage: "ADMIN_RESUME", reason: args.reason },
    );
    return { fromState, correlationId: correlation };
  },
});

const applyResumeRef = makeFunctionReference<"mutation">("adminRecovery:applyResume") as unknown as FunctionReference<
  "mutation",
  "internal",
  { projectId: ProjectId; targetState: string; reason?: string },
  { fromState: string; correlationId: string }
>;

export const resumeProject = actionGeneric({
  args: { projectId: v.id("projects"), targetState: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const checkpoint = CHECKPOINTS_BY_STATE.get(args.targetState as ProjectState);
    if (!checkpoint) {
      throw new Error(`"${args.targetState}" is not a supported resume checkpoint`);
    }
    const { fromState, correlationId: resumeCorrelationId } = await ctx.runMutation(applyResumeRef, args);
    const result = await ctx.runAction(checkpoint.action, { projectId: args.projectId });
    return { fromState, toState: args.targetState, correlationId: resumeCorrelationId, result };
  },
});
