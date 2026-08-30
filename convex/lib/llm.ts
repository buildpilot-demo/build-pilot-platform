// Shared LLM client for Convex actions that need a structured-JSON
// completion (as opposed to requirements.ts's own copy of this logic, which
// is left untouched to avoid regressing the working transcript-extraction
// path). Supports the same provider set/env vars as requirements.ts:
// LLM_PROVIDER (openai default, or groq/gemini) + LLM_MODEL override.
import type { Value } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

export type LlmProvider = "openai" | "groq" | "gemini";

export const LLM_PROVIDERS: readonly LlmProvider[] = ["openai", "groq", "gemini"];

const LLM_PROVIDER_DEFAULTS: Record<LlmProvider, { apiKeyEnvVar: string; baseUrlEnvVar: string; baseUrl: string; model: string }> = {
  openai: { apiKeyEnvVar: "OPENAI_API_KEY", baseUrlEnvVar: "OPENAI_BASE_URL", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  groq: { apiKeyEnvVar: "GROQ_API_KEY", baseUrlEnvVar: "GROQ_BASE_URL", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  gemini: { apiKeyEnvVar: "GEMINI_API_KEY", baseUrlEnvVar: "GEMINI_BASE_URL", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-1.5-flash" },
};

export type LlmConfig = { provider: LlmProvider; apiKey: string | undefined; apiKeyEnvVar: string; model: string; baseUrl: string };

export function resolveLlmConfig(): LlmConfig {
  const requested = (process.env.LLM_PROVIDER ?? "openai").trim().toLowerCase();
  const provider = LLM_PROVIDERS.find((candidate) => candidate === requested);
  if (!provider) throw new Error(`Unsupported LLM_PROVIDER "${requested}"; expected one of ${LLM_PROVIDERS.join(", ")}`);
  const defaults = LLM_PROVIDER_DEFAULTS[provider];
  return {
    provider,
    apiKey: process.env[defaults.apiKeyEnvVar],
    apiKeyEnvVar: defaults.apiKeyEnvVar,
    model: process.env.LLM_MODEL ?? defaults.model,
    baseUrl: (process.env[defaults.baseUrlEnvVar] ?? defaults.baseUrl).replace(/\/$/, ""),
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export type LlmJsonResult = { providerRequestId: string; model: string; provider: LlmProvider; data: Value };

export type LlmJsonRequest = {
  systemPrompt: string;
  userContent: string;
  jsonSchema: Record<string, unknown>;
  schemaName: string;
};

// Parses the OpenAI-compatible chat/completions response shape, used by
// both the OpenAI and Groq providers.
function parseOpenAiCompatibleResponse(payload: unknown, fallbackModel: string, provider: LlmProvider): LlmJsonResult {
  const root = objectValue(payload);
  if (!root) throw new Error(`${provider} returned an invalid response`);
  const providerRequestId = typeof root.id === "string" ? root.id : "unavailable";
  const model = typeof root.model === "string" ? root.model : fallbackModel;
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = objectValue(choices[0]);
  const message = objectValue(choice?.message);
  let content: unknown = message?.content;
  if (Array.isArray(content)) content = content.map((part) => objectValue(part)?.text).filter((part): part is string => typeof part === "string").join("");
  if (typeof content !== "string") throw new Error(`${provider} response did not include JSON content`);
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error(`${provider} returned malformed JSON`);
  }
  if (!objectValue(data)) throw new Error(`${provider} JSON response must be an object`);
  return { providerRequestId, model, provider, data: data as Value };
}

// Parses the Gemini generateContent response shape.
function parseGeminiResponse(payload: unknown, fallbackModel: string): LlmJsonResult {
  const root = objectValue(payload);
  if (!root) throw new Error("gemini returned an invalid response");
  const providerRequestId = typeof root.responseId === "string" ? root.responseId : "unavailable";
  const model = typeof root.modelVersion === "string" ? root.modelVersion : fallbackModel;
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const candidate = objectValue(candidates[0]);
  const messageContent = objectValue(candidate?.content);
  const parts = Array.isArray(messageContent?.parts) ? messageContent?.parts : [];
  const text = parts.map((part) => objectValue(part)?.text).filter((part): part is string => typeof part === "string").join("");
  if (!text) throw new Error("gemini response did not include JSON content");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("gemini returned malformed JSON");
  }
  if (!objectValue(data)) throw new Error("gemini JSON response must be an object");
  return { providerRequestId, model, provider: "gemini", data: data as Value };
}

async function callOpenAiCompatibleJson(config: LlmConfig, request: LlmJsonRequest): Promise<LlmJsonResult> {
  // OpenAI supports strict json_schema response formatting. Groq only
  // guarantees that for a subset of models, so for it we fall back to a
  // generic JSON response format and inline the schema in the prompt.
  const useStrictSchema = config.provider === "openai";
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: useStrictSchema
        ? { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema } }
        : { type: "json_object" },
      messages: [
        {
          role: "system",
          content: useStrictSchema
            ? request.systemPrompt
            : `${request.systemPrompt} Respond with a single JSON object that matches this JSON Schema exactly: ${JSON.stringify(request.jsonSchema)}`,
        },
        { role: "user", content: request.userContent },
      ],
    }),
  });
  if (!response.ok) throw new Error(`${config.provider} returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return parseOpenAiCompatibleResponse(await response.json(), config.model, config.provider);
}

async function callGeminiJson(config: LlmConfig, request: LlmJsonRequest): Promise<LlmJsonResult> {
  const response = await fetch(`${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: `${request.systemPrompt} Respond with a single JSON object that matches this JSON Schema exactly: ${JSON.stringify(request.jsonSchema)}` }],
      },
      contents: [{ role: "user", parts: [{ text: request.userContent }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) throw new Error(`gemini returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return parseGeminiResponse(await response.json(), config.model);
}

export async function callLlmJson(config: LlmConfig, request: LlmJsonRequest): Promise<LlmJsonResult> {
  return config.provider === "gemini" ? callGeminiJson(config, request) : callOpenAiCompatibleJson(config, request);
}
