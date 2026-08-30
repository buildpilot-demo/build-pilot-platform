import { defineApp } from "convex/server";
import { v } from "convex/values";

/**
 * Declares the deployment environment variables that Convex functions read
 * through the typed `env` export from `_generated/server`. Values are set per
 * deployment with `npx convex env set <NAME> <value>`; every var is optional
 * here because the call sites validate presence and fall back at runtime.
 */
const app = defineApp({
  env: {
    OPENAI_API_KEY: v.optional(v.string()),
    OPENAI_REQUIREMENTS_MODEL: v.optional(v.string()),
    REQUIREMENTS_MAX_ATTEMPTS: v.optional(v.string()),

    ELEVENLABS_API_KEY: v.optional(v.string()),
    ELEVENLABS_AGENT_ID: v.optional(v.string()),
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: v.optional(v.string()),
    ELEVENLABS_WEBHOOK_SECRET: v.optional(v.string()),

    CALL_MAX_ATTEMPTS: v.optional(v.string()),
    CALL_WINDOW_START_HOUR_UTC: v.optional(v.string()),
    CALL_WINDOW_END_HOUR_UTC: v.optional(v.string()),

    CONTEXTDEV_API_KEY: v.optional(v.string()),
    CONTEXTDEV_BASE_URL: v.optional(v.string()),
    DEFAULT_CALL_PHONE: v.optional(v.string()),

    EXTERNAL_CALL_GLOBAL_REPLAY: v.optional(v.string()),
  },
});

export default app;
