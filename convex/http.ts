// convex/http.ts
//
// Convex's HTTP Action router. Kept as thin route wiring only — the actual
// handler logic lives next to the integration it belongs to (here,
// convex/webhooks/elevenlabs.ts's T3.2). HTTP Actions are served off the
// deployment's `.convex.site` domain (not `.convex.cloud`), so once
// deployed the live URL for this route is:
//
//   https://<deployment>.convex.site/webhooks/elevenlabs
//
// That's the URL to paste into the ElevenLabs agent's Webhooks / post-call
// settings (T3.0b).

import { httpRouter } from "convex/server";
import { elevenLabsWebhook } from "./webhooks/elevenlabs";

const http = httpRouter();

http.route({
  path: "/webhooks/elevenlabs",
  method: "POST",
  handler: elevenLabsWebhook,
});

export default http;
