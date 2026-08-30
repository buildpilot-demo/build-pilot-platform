import {
  internalActionGeneric,
  type FunctionReference,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v, type GenericId } from "convex/values";

import { callExternal, type ExternalCallContext } from "./lib/externalCall.js";
import { transitionProject, type StateMachineContext } from "./stateMachine.js";

declare const process: { env: Record<string, string | undefined> };

// Every other external dependency in this pipeline (GitHub Actions runs,
// Devin sessions, Firebase deploys) treats polling as the source of truth
// and its webhook as a best-effort accelerator only (see the T4.5/T4.6/T4.8/
// T4.10 design note in docs/task-plan.md). WhatsApp delivery status
// (T5.1/T5.0) was the one exception — NOTIFICATION_PENDING -> DELIVERED only
// ever fired from http.ts's Twilio status webhook, with no polling fallback.
// If that webhook is ever misconfigured/unreachable (e.g. TWILIO_STATUS_
// CALLBACK_URL unset — exactly what happened in production), a project sits
// at NOTIFICATION_PENDING forever even though the message was genuinely
// delivered. reconcileWhatsAppDeliveryStatus below closes that gap by
// polling Twilio's Message resource directly and feeding the result through
// the *same* http.ts:recordTwilioStatus mutation the webhook uses, so both
// paths share one finalization/dedup implementation.
const WHATSAPP_DELIVERY_POLL_INTERVAL_MS = Number(process.env.WHATSAPP_DELIVERY_POLL_INTERVAL_MS ?? 15_000);
const WHATSAPP_DELIVERY_TIMEOUT_MS = Number(process.env.WHATSAPP_DELIVERY_TIMEOUT_MS ?? 900_000);
const TERMINAL_MESSAGE_STATUSES = new Set(["delivered", "read", "failed", "undelivered"]);

const recordTwilioStatusRef = makeFunctionReference<"mutation">(
  "http:recordTwilioStatus",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { payload: Record<string, string>; signatureValidated: boolean; replay: boolean },
  { duplicate: boolean }
>;
const reconcileDeliveryStatusRef = makeFunctionReference<"action">("whatsapp:reconcileWhatsAppDeliveryStatus");
const checkDeliveryStatusTimeoutRef = makeFunctionReference<"action">("whatsapp:checkWhatsAppDeliveryTimeout");
const loadWhatsAppMessageStatusRef = makeFunctionReference<"query">(
  "whatsapp:loadWhatsAppMessageStatus",
) as unknown as FunctionReference<
  "query",
  "internal",
  { messageSid: string },
  { status: string } | null
>;

type DeliveryContext = {
  projectId: GenericId<"projects">;
  workflowRunId: GenericId<"workflowRuns">;
  deploymentId: GenericId<"deployments">;
  revisionRequestId?: GenericId<"revisionRequests">;
  recipient: string;
  liveUrl: string;
  correlationId: string;
  businessName: string;
  businessCategory: string;
};

type TwilioMessage = {
  sid: string;
  status: string;
  from: string;
  to: string;
  body: string;
};

const prepareDeliveryReference = makeFunctionReference<"query">(
  "whatsapp:prepareDelivery",
) as unknown as FunctionReference<
  "query",
  "internal",
  { projectId: GenericId<"projects"> },
  DeliveryContext
>;

const markNotificationPendingReference = makeFunctionReference<"mutation">(
  "whatsapp:markNotificationPending",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { projectId: GenericId<"projects"> },
  null
>;

const persistDeliveryReference = makeFunctionReference<"mutation">(
  "whatsapp:persistDelivery",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  DeliveryContext & { message: TwilioMessage },
  null
>;

const failDeliveryReference = makeFunctionReference<"mutation">(
  "whatsapp:failDelivery",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { projectId: GenericId<"projects">; errorMessage: string },
  null
>;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function normalizeE164(value: string): string {
  const normalized = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("WhatsApp recipient must be a valid E.164 phone number");
  }
  return normalized;
}

function whatsappAddress(value: string): string {
  return `whatsapp:${normalizeE164(value.replace(/^whatsapp:/i, ""))}`;
}

function deliveryBody(liveUrl: string, businessName: string, businessCategory: string): string {
  const greeting = businessName.trim() ? `Hi ${businessName.trim()},` : "Hi,";
  return `${greeting}\n\nThank you for choosing BuildPilot. Your new website for ${businessCategory} is ready to view:\n\n${liveUrl}\n\nReply to us if any changes are needed. Our support team will contact you.\n\nWarm regards,\nBuildPilot`;
}

async function twilioRequest(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  body: string,
): Promise<TwilioMessage> {
  const form = new URLSearchParams({ From: from, To: to, Body: body });
  const statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL?.trim();
  if (statusCallback) form.set("StatusCallback", statusCallback);
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.sid !== "string") {
    const message = typeof payload.message === "string" ? payload.message : `Twilio returned ${response.status}`;
    throw new Error(message);
  }
  return {
    sid: payload.sid,
    status: typeof payload.status === "string" ? payload.status : "queued",
    from,
    to,
    body,
  };
}

async function reconcileTwilioMessage(
  accountSid: string,
  authToken: string,
  messageSid?: string,
): Promise<{ status: "succeeded"; result: TwilioMessage } | { status: "pending" } | { status: "not_found" }> {
  if (!messageSid) return { status: "not_found" };
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(messageSid)}.json`,
    { headers: { Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` } },
  );
  if (response.status === 404) return { status: "not_found" };
  if (!response.ok) return { status: "pending" };
  const payload = (await response.json()) as Record<string, unknown>;
  if (typeof payload.sid !== "string") return { status: "pending" };
  return {
    status: "succeeded",
    result: {
      sid: payload.sid,
      status: typeof payload.status === "string" ? payload.status : "queued",
      from: typeof payload.from === "string" ? payload.from : "",
      to: typeof payload.to === "string" ? payload.to : "",
      body: typeof payload.body === "string" ? payload.body : "",
    },
  };
}

// Uncached, one-off read of a message's current delivery status (including
// Twilio's own error fields) — used by the polling reconciler below, not
// the stageAttempt reconciliation flow, so it doesn't need callExternal's
// replay/audit machinery (mirrors devin.ts::fetchBranchHeadSha's rationale).
async function fetchTwilioMessageDetails(
  accountSid: string,
  authToken: string,
  messageSid: string,
): Promise<{ status: string; from: string; to: string; errorCode?: string; errorMessage?: string } | null> {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(messageSid)}.json`,
    { headers: { Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` } },
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as Record<string, unknown>;
  if (typeof payload.status !== "string") return null;
  return {
    status: payload.status,
    from: typeof payload.from === "string" ? payload.from : "",
    to: typeof payload.to === "string" ? payload.to : "",
    errorCode: payload.error_code !== null && payload.error_code !== undefined ? String(payload.error_code) : undefined,
    errorMessage: typeof payload.error_message === "string" ? payload.error_message : undefined,
  };
}

// Internal: scheduled automatically once a deployment goes LIVE; not part
// of Section 11's admin-triggered retry table, never called by a client.
export const sendDeliveryMessage = internalActionGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<TwilioMessage> => {
    try {
      const delivery = await ctx.runQuery(prepareDeliveryReference, { projectId: args.projectId });
      await ctx.runMutation(markNotificationPendingReference, { projectId: args.projectId });
      const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
      const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
      const from = whatsappAddress(requiredEnv("TWILIO_WHATSAPP_NUMBER"));
      const to = whatsappAddress(delivery.recipient);
      const body = deliveryBody(delivery.liveUrl, delivery.businessName, delivery.businessCategory);
      const message = await callExternal(ctx as unknown as ExternalCallContext, {
        stage: "WHATSAPP_DELIVERY",
        projectId: args.projectId,
        version: delivery.revisionRequestId ?? delivery.deploymentId,
        provider: "twilio",
        correlationId: delivery.correlationId,
        cacheKey: String(delivery.revisionRequestId ?? delivery.deploymentId),
        replayHandler: { functionName: "whatsapp:sendDeliveryMessage" },
        live: async () => await twilioRequest(accountSid, authToken, from, to, body),
        providerRequestId: (message) => message.sid,
        reconcile: async (attempt) =>
          await reconcileTwilioMessage(accountSid, authToken, attempt.providerRequestId),
        process: async (message) => {
          await ctx.runMutation(persistDeliveryReference, { ...delivery, message });
          return message;
        },
      });
      // The Twilio status webhook (T5.0) is a best-effort accelerator only —
      // this poll (bounded by checkWhatsAppDeliveryTimeout) is the actual
      // source of truth for NOTIFICATION_PENDING -> DELIVERED, matching
      // every other external dependency in this pipeline. Without it, a
      // misconfigured/unreachable callback URL leaves the project stuck
      // forever even after a fully successful send.
      if (!TERMINAL_MESSAGE_STATUSES.has(message.status)) {
        await ctx.scheduler.runAfter(WHATSAPP_DELIVERY_POLL_INTERVAL_MS, reconcileDeliveryStatusRef, { messageSid: message.sid });
        await ctx.scheduler.runAfter(WHATSAPP_DELIVERY_TIMEOUT_MS, checkDeliveryStatusTimeoutRef, { messageSid: message.sid, projectId: args.projectId });
      }
      return message;
    } catch (error) {
      await ctx.runMutation(failDeliveryReference, {
        projectId: args.projectId,
        errorMessage: error instanceof Error ? error.message : "WhatsApp delivery failed",
      });
      throw error;
    }
  },
});

export const loadWhatsAppMessageStatus = internalQueryGeneric({
  args: { messageSid: v.string() },
  handler: async (ctx, args): Promise<{ status: string } | null> => {
    const message = await ctx.db
      .query("whatsappMessages")
      .filter((query) =>
        query.and(
          query.eq(query.field("provider"), "twilio"),
          query.eq(query.field("messageSid"), args.messageSid),
        ),
      )
      .first();
    return message ? { status: message.status } : null;
  },
});

export const prepareDelivery = internalQueryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<DeliveryContext> => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);
    if (!project.workflowRunId) throw new Error("Project has no active workflow run");
    const business = await ctx.db.get("businesses", project.businessId);
    if (!business) throw new Error("Project business was not found");
    if (!business.contactEligible || business.doNotContact) {
      throw new Error("Contact is suppressed for this business");
    }
    const recipient = normalizeE164(business.normalizedPhone ?? business.phone ?? "");
    const optedOut = await ctx.db
      .query("whatsappMessages")
      .filter((query) =>
        query.and(
          query.eq(query.field("direction"), "inbound"),
          query.or(
            query.eq(query.field("from"), whatsappAddress(recipient)),
            query.eq(query.field("from"), recipient),
          ),
          query.eq(query.field("optOutDetected"), true),
        ),
      )
      .first();
    if (optedOut) throw new Error("Contact is suppressed because the recipient opted out");
    const revisionRequestId = project.activeRevisionRequestId;
    const deployment = project.liveDeploymentId
      ? await ctx.db.get("deployments", project.liveDeploymentId)
      : await ctx.db
          .query("deployments")
          .filter((query) =>
            query.and(
              query.eq(query.field("projectId"), args.projectId),
              query.eq(query.field("status"), "live"),
            ),
          )
          .order("desc")
          .first();
    if (!deployment) throw new Error("No live deployment exists for this project");
    const liveUrl = deployment.liveUrl ?? project.liveUrl;
    if (!liveUrl || !/^https:\/\//i.test(liveUrl)) throw new Error("Project has no valid live URL");
    return {
      projectId: args.projectId,
      workflowRunId: project.workflowRunId,
      deploymentId: deployment._id,
      revisionRequestId,
      recipient,
      liveUrl,
      correlationId: project.correlationId,
      businessName: business.name,
      businessCategory: business.category,
    };
  },
});

export const markNotificationPending = internalMutationGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);
    if (project.activeRevisionRequestId) {
      const revision = await ctx.db.get("revisionRequests", project.activeRevisionRequestId);
      if (revision?.status === "REVISION_LIVE") {
        await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "REVISION_NOTIFICATION_PENDING", {
          correlationId: project.correlationId,
          stage: "WHATSAPP_DELIVERY",
          workflowRunId: revision.workflowRunId,
          revisionRequestId: revision._id,
        });
      }
    } else if (project.state === "LIVE") {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "NOTIFICATION_PENDING", {
        correlationId: project.correlationId,
        stage: "WHATSAPP_DELIVERY",
        workflowRunId: project.workflowRunId,
      });
    }
    return null;
  },
});

export const persistDelivery = internalMutationGeneric({
  args: {
    projectId: v.id("projects"),
    workflowRunId: v.id("workflowRuns"),
    deploymentId: v.id("deployments"),
    revisionRequestId: v.optional(v.id("revisionRequests")),
    recipient: v.string(),
    liveUrl: v.string(),
    correlationId: v.string(),
    message: v.object({
      sid: v.string(),
      status: v.string(),
      from: v.string(),
      to: v.string(),
      body: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existingMessage = await ctx.db
      .query("whatsappMessages")
      .filter((query) =>
        query.and(
          query.eq(query.field("provider"), "twilio"),
          query.eq(query.field("messageSid"), args.message.sid),
        ),
      )
      .first();
    const messageValue = {
      projectId: args.projectId,
      revisionRequestId: args.revisionRequestId,
      provider: "twilio" as const,
      messageSid: args.message.sid,
      direction: "outbound" as const,
      from: args.message.from,
      to: args.message.to,
      body: args.message.body,
      mediaCount: 0,
      status: args.message.status,
      sentAt: now,
      updatedAt: now,
    };
    if (existingMessage) await ctx.db.patch("whatsappMessages", existingMessage._id, messageValue);
    else await ctx.db.insert("whatsappMessages", messageValue);
    const existingNotification = await ctx.db
      .query("notifications")
      .filter((query) =>
        query.and(
          query.eq(query.field("provider"), "twilio"),
          query.eq(query.field("messageSid"), args.message.sid),
        ),
      )
      .first();
    const notificationValue = {
      projectId: args.projectId,
      workflowRunId: args.workflowRunId,
      deploymentId: args.deploymentId,
      revisionRequestId: args.revisionRequestId,
      provider: "twilio",
      channel: "whatsapp" as const,
      recipient: args.recipient,
      messageSid: args.message.sid,
      status: args.message.status,
      sentAt: now,
      updatedAt: now,
    };
    if (existingNotification) await ctx.db.patch("notifications", existingNotification._id, notificationValue);
    else await ctx.db.insert("notifications", { ...notificationValue, createdAt: now });
    return null;
  },
});

export const failDelivery = internalMutationGeneric({
  args: { projectId: v.id("projects"), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) return null;
    const now = Date.now();
    const metadata = {
      correlationId: project.correlationId,
      stage: "WHATSAPP_DELIVERY",
      failedStage: "WHATSAPP_DELIVERY",
      errorCode: "WHATSAPP_DELIVERY_FAILED",
      errorMessage: args.errorMessage.slice(0, 500),
      retryable: true,
      retryCount: 1,
      maxRetries: 3,
      provider: "twilio",
      providerRequestId: "unavailable",
      lastAttemptAt: now,
    };
    if (project.activeRevisionRequestId) {
      const revision = await ctx.db.get("revisionRequests", project.activeRevisionRequestId);
      if (revision?.status === "REVISION_NOTIFICATION_PENDING" || revision?.status === "REVISION_LIVE") {
        await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "REVISION_NOTIFICATION_FAILED", {
          ...metadata,
          workflowRunId: revision.workflowRunId,
          revisionRequestId: revision._id,
        });
      }
    } else if (project.state === "NOTIFICATION_PENDING" || project.state === "LIVE") {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId, "NOTIFICATION_FAILED", {
        ...metadata,
        workflowRunId: project.workflowRunId,
      });
    }
    return null;
  },
});

// Internal: self-scheduled reconciliation poll, never called by a client —
// the polling half of WhatsApp delivery tracking (see the comment above
// sendDeliveryMessage's scheduling of this). Feeds Twilio's current message
// status through the *same* http.ts:recordTwilioStatus mutation the status
// webhook uses, so both paths share one finalization/dedup implementation
// and can never disagree about the outcome.
export const reconcileWhatsAppDeliveryStatus = internalActionGeneric({
  args: { messageSid: v.string() },
  handler: async (ctx, args) => {
    const message = await ctx.runQuery(loadWhatsAppMessageStatusRef, { messageSid: args.messageSid });
    // Already resolved — by the webhook, a previous poll, or this message
    // was never actually tied to a project (e.g. an inbound message) —
    // stop polling rather than double-process.
    if (!message || TERMINAL_MESSAGE_STATUSES.has(message.status)) return { status: message?.status ?? "unknown" };
    const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
    const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
    const details = await fetchTwilioMessageDetails(accountSid, authToken, args.messageSid);
    if (!details || !TERMINAL_MESSAGE_STATUSES.has(details.status)) {
      // Detects Twilio's delivery outcome by polling until the message
      // reaches a terminal status — checkWhatsAppDeliveryTimeout (scheduled
      // alongside the first poll) bounds this loop.
      await ctx.scheduler.runAfter(WHATSAPP_DELIVERY_POLL_INTERVAL_MS, reconcileDeliveryStatusRef, { messageSid: args.messageSid });
      return { status: "pending" as const };
    }
    const payload: Record<string, string> = {
      MessageSid: args.messageSid,
      MessageStatus: details.status,
      From: details.from,
      To: details.to,
      ...(details.errorCode ? { ErrorCode: details.errorCode } : {}),
      ...(details.errorMessage ? { ErrorMessage: details.errorMessage } : {}),
    };
    await ctx.runMutation(recordTwilioStatusRef, { payload, signatureValidated: true, replay: false });
    return { status: details.status };
  },
});

// Bounds reconcileWhatsAppDeliveryStatus's self-rescheduled polling loop. A
// stuck/never-resolving message status is treated as an ordinary retryable
// delivery failure (Section 11: Retry -> resume from NOTIFICATION_PENDING),
// matching every other timeout in this pipeline.
// Internal: self-scheduled timeout check, never called by a client.
export const checkWhatsAppDeliveryTimeout = internalActionGeneric({
  args: { messageSid: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const message = await ctx.runQuery(loadWhatsAppMessageStatusRef, { messageSid: args.messageSid });
    if (!message || TERMINAL_MESSAGE_STATUSES.has(message.status)) return { timedOut: false };
    await ctx.runMutation(failDeliveryReference, {
      projectId: args.projectId,
      errorMessage: "Twilio did not report a final delivery status within the configured timeout",
    });
    return { timedOut: true };
  },
});
