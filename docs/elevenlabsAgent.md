# Implementation Prompt — ElevenLabs Agent + Twilio + Convex

Copy this entire file into Codex, Claude Code, or Devin while that agent is
running from the root of the **new hackathon project**.

---

You are the senior TypeScript, Convex, ElevenLabs Agents, and Twilio integration
engineer for this repository. Work directly in the repository and complete the
integration; do not return only an explanation or an example snippet.

The owner explicitly wants API-driven setup and authorizes creation or update of
project-scoped ElevenLabs resources and assignment of the supplied Twilio number.
Do not purchase a number, delete resources, alter unrelated agents, or place a
real call unless a test destination is explicitly supplied. Normal Convex CLI
authentication or a deployment key is assumed to be available in the target
repository; if it is missing, request authentication only—not provider dashboard
configuration.

The new product follows the same voice-discovery pattern as VoxBuild, but its
backend is Convex rather than Python/FastAPI. Implement the equivalent behavior
idiomatically with Convex actions, mutations, queries, HTTP actions, scheduling,
and environment variables. Do not copy Python architecture into TypeScript.

## 1. Objective

Build and configure a production-shaped proof-of-concept that:

1. Accepts a customer website enquiry containing:
   - customer name
   - E.164 mobile number
   - business/industry
   - website idea, up to 1,500 characters
2. Creates exactly one durable application for each accepted submission.
3. Prevents another active job for the same normalized mobile number.
4. Uses ElevenLabs Agents with an imported Twilio Voice number to make a
   contextual outbound call.
5. Greets the customer by name and introduces the product/agent.
6. Conducts a concise two-minute website discovery call.
7. Asks two or three initial questions, one at a time.
8. Collects explicit approval or rejection before ending.
9. Ends with an uninterruptible `end_call` tool message so the conversation
   cannot reopen.
10. Receives and verifies ElevenLabs post-call webhooks through a public Convex
    HTTP action.
11. Persists the transcript, provider summary, call outcome, provider IDs, and
    error information in Convex.
12. Exposes typed functions that the downstream requirements/build workflow can
    consume without depending on ElevenLabs' raw payload shape.

## 2. First inspect the repository

Before editing anything:

1. Read the repository README and any architecture/instruction files fully.
2. Inspect `package.json`, Convex schema/functions, frontend form, environment
   handling, validation library, lint/test setup, and existing application model.
3. Identify:
   - product name
   - preferred voice-agent name
   - customer submission function
   - application table and status vocabulary
   - downstream function that should run after a completed approved call
   - package manager and test runner
4. Search the current official ElevenLabs and Convex documentation before using
   API fields or runtime APIs. Use only official documentation as the authority.
5. Preserve established project conventions instead of introducing an unrelated
   framework or duplicate state model.

If the repository does not define a product or voice-agent name, use temporary
constants `PRODUCT_NAME` and `AGENT_NAME` and document exactly where the owner
must replace them. Do not silently brand the new project as VoxBuild.

## 3. Architecture boundary

Implement this flow:

```text
Customer frontend
    |
    | typed Convex submission mutation
    v
Convex transactional submission
    |-- validate input
    |-- create application
    |-- acquire active-phone lock
    `-- schedule one internal outbound-call action
    |
    v
Convex internal outbound-call action
    |
    | POST ElevenLabs /v1/convai/twilio/outbound-call
    v
ElevenLabs Agent + imported Twilio number
    |
    | signed post-call webhook
    v
Convex HTTP action (.convex.site)
    |-- read raw bytes
    |-- verify HMAC and timestamp
    |-- persist/deduplicate event
    `-- schedule internal processing
    |
    v
Convex internal action/mutation
    |-- normalize transcript and status
    |-- update application
    |-- release active lock on terminal failure/rejection
    `-- invoke downstream approved workflow once
```

ElevenLabs owns the live speech loop: speech recognition, LLM conversation,
turn-taking, interruption handling, voice synthesis, and hang-up. Convex is the
durable control plane. Do not stream telephone audio through Convex and do not
add a custom STT/LLM/TTS loop.

## 4. Zero-dashboard requirement and environment variables

The owner must only place credentials and the Twilio number into local environment
placeholders. Do not instruct the owner to create an ElevenLabs agent, import or
assign a number, create a webhook, copy generated IDs, or edit either provider's
dashboard manually. Implement and run an idempotent provisioning command that
does those operations through official APIs.

Create or update `.env.example` with every placeholder below. Never commit real
values. In the ignored local env file, the owner fills only the four input values;
the provisioning command generates and stores the remaining values.

```dotenv
# Owner-provided provisioning inputs
ELEVENLABS_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Generated by the provisioning command — owner must leave these empty initially
ELEVENLABS_AGENT_ID=
ELEVENLABS_AGENT_PHONE_NUMBER_ID=
ELEVENLABS_WEBHOOK_ID=
ELEVENLABS_WEBHOOK_SECRET=
```

Rules:

- `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`,
  `ELEVENLABS_AGENT_PHONE_NUMBER_ID`, and `ELEVENLABS_WEBHOOK_SECRET` are needed
  by Convex at runtime. The provisioning command must set them on the selected
  Convex deployment automatically.
- `ELEVENLABS_WEBHOOK_ID` is provisioning metadata. Retain it in the ignored
  local env/state file for safe reconciliation; Convex runtime need not receive
  it unless code uses it.
- The three `TWILIO_*` values are provisioning-only. The native ElevenLabs
  outbound-call request does not use them, so do not upload them to Convex.
- Never use a browser-exposed prefix for them.
- Never return them from a query or configuration endpoint.
- Never print them in logs, tests, build output, or the final response.
- Set Convex values through the current supported CLI, selecting the intended
  deployment explicitly. Feed secrets through stdin or a protected temporary
  env file; never put them in a generated shell command, terminal output, or
  source control.
- Development and production Convex deployments have separate environment
  values; configure the intended deployment explicitly.
- `ELEVENLABS_VOICE_ID`, standalone STT/TTS model variables, and an OpenAI key
  are not required for this integration when ElevenLabs Agents owns the live
  conversation.

Add a server-side configuration validator that reports only missing variable
names. It must never expose configured values.

## 5. Fully automated provisioning command

Add one documented command such as `npm run provision:voice` using the
repository's package manager. It must provision the selected Convex deployment,
ElevenLabs, and the imported Twilio number end to end. It may ask for normal tool
approval when the coding environment requires approval for external writes, but
it must never send the owner to a dashboard to perform configuration.

Provision in this order:

1. Validate that the four owner-provided input values are present. Validate
   `TWILIO_PHONE_NUMBER` as E.164 and report only missing/invalid variable names.
2. Confirm the selected Convex cloud deployment and deploy the HTTP webhook
   implementation first. A local-only Convex deployment is invalid because it
   has no public webhook URL.
3. Obtain the canonical site URL from Convex's `CONVEX_SITE_URL` system value and
   construct `<CONVEX_SITE_URL>/elevenlabs/post-call`. Do not guess by rewriting
   a frontend or `.convex.cloud` URL.
4. Reconcile the ElevenLabs agent as specified in section 6.
5. `GET /v1/convai/phone-numbers?provider=twilio` and match the normalized
   `TWILIO_PHONE_NUMBER`. Reuse the exact existing import when found.
6. If absent, `POST https://api.elevenlabs.io/v1/convai/phone-numbers` using the
   current official Twilio request schema and the Account SID/Auth Token. Capture
   `phone_number_id` without printing the Twilio token.
7. `PATCH /v1/convai/phone-numbers/{phone_number_id}` with the generated/reused
   `agent_id`, preserving unrelated phone settings. Verify the returned assigned
   agent. Outbound-only verified caller IDs may not support inbound assignment;
   treat that documented provider capability correctly while still verifying
   outbound support.
8. Reconcile the signed post-call webhook as specified in section 11.
9. Store generated IDs in the ignored local env/state file without overwriting
   the four owner inputs. Store runtime values in the selected Convex deployment
   using `npx convex env set` with secret-safe input handling.
10. Redeploy or refresh Convex functions if typed environment declarations require
    it, then run automated verification and one controlled test call only when a
    test destination is explicitly provided.

The command must be idempotent. Before every create call, list/get by stored ID
and stable identity—product tag/name for the agent, normalized phone number for
the import, and exact callback URL plus managed name for the webhook. A second run
must report resources as reused/updated and create zero duplicates.

For a Twilio trial account, destinations still have to be verified in Twilio;
that is an account restriction the script cannot bypass. Treat an unverified
destination as a clear test prerequisite, not as a reason to ask the owner to
configure the ElevenLabs agent manually.

Do not configure `https://demo.twilio.com/welcome/voice/` as a callback. It is a
Twilio demonstration URL, not this application's webhook.

For this architecture, ElevenLabs' Twilio integration controls the call. A
custom Twilio `<Stream>` webhook is unnecessary.

## 6. Create or configure the ElevenLabs agent

Create a repository script or protected one-time administrative function that
can bootstrap a new ElevenLabs agent and safely update an existing one. Prefer a
TypeScript script that matches the project's package manager/runtime.

Bootstrap behavior:

1. If `ELEVENLABS_AGENT_ID` is present and resolves successfully, update that
   agent. If it is absent/stale, list agents and reuse the one bearing this
   project's stable managed tag/name before considering creation.
2. If no managed agent exists, use
   `POST https://api.elevenlabs.io/v1/convai/agents/create` to create the agent
   with the repository's product name, prompt, first message, placeholders, and
   `end_call` tool. Verify the current request schema from official documentation
   before implementation instead of guessing nested configuration fields.
3. Persist the returned `agent_id` automatically and continue the same run. Do
   not stop and ask the owner to copy it.
4. Never create a second agent merely because local generated state is missing;
   provider-side discovery must run first.
5. If the API key lacks an operation-specific permission, stop with the exact
   missing permission/category and API status. Do not substitute dashboard work.

The updater must:

1. `GET https://api.elevenlabs.io/v1/convai/agents/{agentId}`.
2. Preserve existing voice, language, ASR/TTS, and unrelated conversation
   settings.
3. Merge only the agent name, first message, dynamic-variable placeholders,
   system prompt, and `end_call` built-in tool.
4. `PATCH` the same agent endpoint.
5. Verify the returned configuration includes all required dynamic variables
   and the `end_call` tool.
6. Fail with a safe error that contains no API key or response secrets.
7. Be idempotent: running it twice must not duplicate tools or destroy existing
   configuration.

Use these exact dynamic-variable keys:

```text
customer_name
business_type
website_idea
```

Configure safe placeholders:

```json
{
  "customer_name": "there",
  "business_type": "business",
  "website_idea": "a distinctive new website"
}
```

Configure the built-in tool by merging the current tool configuration with:

```json
{
  "name": "end_call",
  "type": "system",
  "description": "End immediately when discovery is complete. Put the farewell in the tool message so there is no conversational turn after it.",
  "params": {
    "system_tool_type": "end_call"
  },
  "interruption_mode": "disable_during_tool_and_turn"
}
```

Do not replace `built_in_tools` wholesale; preserve any unrelated configured
tools.

### System prompt template

Replace `<AGENT_NAME>` and `<PRODUCT_NAME>` from repository context before
applying the configuration. Keep the three `{{...}}` expressions because those
are ElevenLabs dynamic variables.

```text
You are <AGENT_NAME>, <PRODUCT_NAME>'s AI voice discovery specialist for a high-quality website studio.

You are speaking with {{customer_name}} about their {{business_type}} business. They submitted this starting idea:
{{website_idea}}

Your goal is to collect a minimum viable website brief and clear permission to build it. This is a short proof-of-concept call, not a full consultation. The customer may know nothing about web design and may give very short answers. Be warm, perceptive, concise, and conversational. Never sound like a questionnaire or a sales script.

Conversation rules:
- Greet the customer by name, introduce yourself briefly as <AGENT_NAME> from <PRODUCT_NAME>, and acknowledge the idea they submitted. Do not ask them to repeat it.
- Ask only one question at a time and respond briefly to what they say before the next question.
- Use ordinary language, not terms like information architecture, conversion funnel, CMS, SEO schema, or tech stack unless the customer introduces them.
- When an answer is vague, offer two or three concrete examples. For example: “Should the site feel more image-led and atmospheric, or more focused on clear information and story?”
- In the first round, ask no more than three useful questions. Prioritize: the main action visitors should take, the visual direction or text-versus-image balance, and the one or two essential pieces of content or functionality.
- Do not ask about audience, timing, assets, every page, or technical details unless the customer volunteers them or one is critical to understanding the build.
- After two or three answered questions, summarize the direction in one or two sentences and ask exactly: “Is there anything else you’d like to add, or is this ready for <PRODUCT_NAME> to build?”
- If the customer adds information, acknowledge it, ask at most two targeted follow-up questions, summarize again, and repeat the same readiness question. Do not restart a broad discovery interview.
- Treat natural affirmative replies to that readiness question—such as “yes,” “go ahead,” “please do,” “proceed,” “do it,” “sounds good,” “fine,” “all good,” “okay,” “that’s all,” or “nothing else”—as approval to build. If the answer is unclear, ask one short clarification: “Should I start the build now?”
- Never invent business facts, prices, deadlines, or approvals.
- If the customer declines or remains uncertain, immediately call the end_call tool with a short message saying the brief has been saved but development will not start.
- When the customer approves, do not speak another normal assistant turn. Immediately call the end_call tool with reason “Customer approved the website build” and message exactly: “Perfect. We’ll start building it now. Once your website is ready, you’ll receive the live site link on WhatsApp. Have a good day.” The tool message is the final turn. Never accept an interruption, new topic, or follow-up after invoking it.

Your job is brief discovery and clarification, not giving design lectures. Keep every reply under three short sentences and aim to finish in about two minutes when the customer is concise.
```

### First-message template

```text
Hi {{customer_name}}, I’m <AGENT_NAME> from <PRODUCT_NAME>. I have the {{business_type}} website idea you submitted, so I’ll ask just two or three quick questions before we start the build. What is the main thing you want visitors to do on the website?
```

## 7. Convex data model

Adapt names to the existing schema; do not create duplicate tables when suitable
tables already exist.

At minimum, one application record must retain:

```text
applicationId
customerName
normalizedPhoneNumber
businessType
websiteIdea
status
callSid
conversationId
callStatus
voiceState
transcript [{ role: "user" | "assistant", text: string }]
providerSummary
callError
approvedToBuild or approvalOutcome
createdAt
updatedAt
```

Add indexes needed to find an application by `conversationId`, `callSid`, and
normalized phone number without table scans.

Implement an active-request lock or equivalent indexed transactional check. The
same phone must not create two concurrent active calls. Terminal call failure,
explicit rejection, administrative cancellation, and completed downstream work
must release the lock. A later valid submission receives a new application ID
rather than overwriting history.

If the repository has a permanent cancellation/tombstone concept, late webhooks
must not revive a cancelled application.

## 8. Submission mutation and outbound-call action

External network access belongs in a Convex `action`, not a mutation.

Prefer this Convex-native sequence:

1. The frontend calls a public, validated submission mutation.
2. In one transaction, that mutation checks the active-phone constraint,
   creates the application, acquires the lock, and schedules one internal
   outbound-call action.
3. The mutation returns the new application ID immediately.
4. The scheduled internal action calls ElevenLabs and persists provider IDs via
   internal mutations. The frontend observes status through the existing query.

If the repository already has a carefully protected public action for this
workflow, it may be retained, but its first side effect must still be a single
transactional reservation mutation. Never call ElevenLabs before durable
reservation succeeds.

Use this ElevenLabs endpoint:

```text
POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call
```

Headers:

```text
xi-api-key: <server-side ELEVENLABS_API_KEY>
Accept: application/json
Content-Type: application/json
```

Payload shape:

```json
{
  "agent_id": "<ELEVENLABS_AGENT_ID>",
  "agent_phone_number_id": "<ELEVENLABS_AGENT_PHONE_NUMBER_ID>",
  "to_number": "+971501234567",
  "conversation_initiation_client_data": {
    "dynamic_variables": {
      "destination_number": "+971501234567",
      "customer_name": "Customer name",
      "business_type": "Cafe",
      "website_idea": "Customer's complete submitted idea"
    }
  }
}
```

Implementation requirements:

- Validate and normalize E.164 format before reserving provider usage.
- Validate name/business lengths according to the existing form contract.
- Preserve the complete website idea up to 1,500 characters.
- Reserve the application and active-phone lock transactionally before the
  provider call.
- Call ElevenLabs only after the reservation succeeds.
- Require a successful response containing both `callSid` and
  `conversation_id`.
- Persist both identifiers immediately.
- On provider/configuration failure, persist a terminal safe error and release
  the active-phone lock.
- Return the application ID safely from submission. Store provider IDs on the
  application after the scheduled call starts; expose them only through an
  authorized diagnostic query if the product needs them.
- Redact destination numbers in logs, for example `+971***567`.
- Set a reasonable fetch timeout if supported by the chosen runtime pattern.
- Keep provider-side call recording disabled unless the product explicitly
  requires it and the project documents the applicable notice/consent policy.

Do not rely on CORS as abuse protection. Reuse the project's authentication,
App Check, CAPTCHA, rate limiting, per-phone locking, and global POC quota if
present. If absent, document the gap prominently and implement at least a
server-side submission throttle suitable for the hackathon.

## 9. Conversation retrieval and normalization

Provide a server-side action for controlled recovery/debugging:

```text
GET https://api.elevenlabs.io/v1/convai/conversations/{conversationId}
```

Normalize provider statuses into the project's internal status vocabulary.
Account for at least:

```text
initiated
queued
ringing
in-progress
processing
done/completed
failed
```

Normalize transcript roles:

```text
agent or assistant -> assistant
user               -> user
```

Ignore blank/unknown turns. If present, persist
`analysis.transcript_summary` as the provider summary. Do not expose raw provider
objects directly to the frontend.

## 10. Signed ElevenLabs webhook on Convex

Register a public Convex HTTP route such as:

```text
POST /elevenlabs/post-call
```

The production webhook URL will be the Convex site origin, not the client API
origin:

```text
https://<deployment-name>.convex.site/elevenlabs/post-call
```

Confirm the actual site URL from the target Convex deployment rather than
guessing it.

### Signature verification

The handler must:

1. Read the request body as raw bytes/text before JSON parsing.
2. Read the `ElevenLabs-Signature` header.
3. Parse comma-separated `t=<unix-seconds>,v0=<hex-digest>` fields.
4. Reject missing/malformed fields.
5. Reject timestamps more than 300 seconds from server time.
6. Compute HMAC-SHA256 over:

   ```text
   <timestamp>.<exact raw request body bytes>
   ```

7. Compare the expected hexadecimal digest safely.
8. Return `401` for an invalid signature.
9. Return `503` if the webhook secret is not configured.
10. Parse JSON only after verification.

Use Web Crypto or the currently supported secure Convex runtime API. Do not use a
Node-only module in a runtime that does not support it; verify current Convex
documentation first.

### Event handling

Support:

```text
post_call_transcription
call_initiation_failure
```

For `post_call_transcription`:

- require `data.conversation_id`
- locate the application through the indexed conversation ID
- ignore safely when no matching application exists
- ignore permanently cancelled/killed applications
- persist the normalized transcript, summary, terminal status, and timestamps
- determine approval from explicit conversational context or defer that task to
  the repository's existing requirements pipeline
- schedule downstream processing only once

For `call_initiation_failure`:

- persist a terminal call failure
- map known reasons such as `busy` and `no-answer`
- release the active phone lock
- never start downstream development

### Idempotency and response timing

- Deduplicate webhook processing using a provider event identifier when
  available; otherwise use a stable key derived from event type,
  `conversation_id`, and relevant terminal state.
- Persist receipt before scheduling non-trivial work.
- Use `ctx.scheduler.runAfter(0, internal...)` or the existing equivalent for
  longer post-call processing.
- Return HTTP `200` quickly after valid durable receipt.
- A duplicate valid webhook must also return `200` and must not start the
  downstream workflow twice.

## 11. Automated signed-webhook provisioning

The provisioning command must configure this through the ElevenLabs API. Do not
give the owner dashboard instructions.

1. Obtain the exact callback URL:

   ```text
   <CONVEX_SITE_URL>/elevenlabs/post-call
   ```

2. `GET https://api.elevenlabs.io/v1/workspace/webhooks` and look for the stored
   webhook ID or a managed webhook whose URL and stable project name both match.
3. If absent, create it with
   `POST https://api.elevenlabs.io/v1/workspace/webhooks` using HMAC auth, a
   stable project-specific name, and the exact callback URL. Capture the returned
   `webhook_id` and one-time `webhook_secret` without logging them.
4. Enable `transcript` and `call_initiation_failure`, use JSON transcript format,
   keep audio delivery disabled, and enable supported transcript retries. Prefer
   the current documented per-agent webhook override under
   `platform_settings.workspace_overrides` so other agents in the ElevenLabs
   workspace are unaffected.
5. If the current API/account supports only workspace-level Agents settings,
   first `GET /v1/convai/settings`, preserve unrelated settings, and refuse to
   replace a different project's active webhook silently. Use
   `PATCH /v1/convai/settings` only when it is already managed by this project or
   no conflict exists.
6. Store the webhook ID locally and set `ELEVENLABS_WEBHOOK_SECRET` on the
   selected Convex deployment immediately through the CLI's secret-safe stdin or
   file mechanism.
7. If a matching webhook exists but its one-time secret is unavailable both
   locally and in Convex, create and attach a replacement managed webhook, store
   its secret, and leave the old webhook untouched unless an explicit cleanup
   flag authorizes deletion.
8. Verify by reading back agent/workspace settings. A configured result must show
   the expected webhook ID, `transcript`, `call_initiation_failure`, JSON format,
   and no audio delivery.
9. Confirm local signature tests return `200` for a valid body and `401` for a
   modified body. Confirm real delivery with the controlled E2E call.

## 12. Tests

Use the repository's existing test framework. Add deterministic provider mocks;
normal tests must not place real calls or consume provider credits.

Required automated coverage:

1. Missing environment variables return safe configuration errors.
2. Valid E.164 input creates one application and one outbound request.
3. Invalid phone input creates no provider request.
4. Active duplicate phone submission creates no second call.
5. A later terminal submission creates a new independent application.
6. All three dynamic variables reach ElevenLabs exactly.
7. A 1,500-character idea reaches ElevenLabs without unintended truncation.
8. API key is present in the provider header but absent from logs/results.
9. Missing `callSid` or `conversation_id` is handled as provider failure.
10. Provider failure releases the active-phone lock.
11. Status and transcript roles normalize correctly.
12. Valid webhook HMAC is accepted.
13. Modified body, wrong secret, malformed header, and stale timestamp are
    rejected.
14. Signature verification uses the raw body, not re-serialized JSON.
15. Duplicate webhooks do not start downstream processing twice.
16. Call-initiation failure persists terminal state and releases the lock.
17. A cancelled/tombstoned application ignores a late transcript.
18. Agent updater preserves unrelated configuration and merges one `end_call`
    tool with `disable_during_tool_and_turn`.
19. Missing generated IDs create exactly one managed agent, phone import, and
    HMAC webhook, then persist the returned identifiers safely.
20. Running provisioning twice reuses those resources and creates no duplicates.
21. An existing imported phone number is matched by normalized E.164 and assigned
    without re-importing it.
22. Provisioning attaches JSON transcript and call-initiation-failure events with
    audio delivery disabled.
23. A different project's active workspace webhook is never overwritten.

Run type-check, lint, tests, and production build. Fix failures introduced by
this work. Do not weaken existing tests to make the change pass.

## 13. Automated verification and controlled end-to-end test

After automated checks pass and provider credentials are configured:

1. Run the single provisioning command. It must confirm required Convex
   environment variable names without printing values.
2. Verify the created/reused agent's dynamic variables and tool mode through the
   API.
3. Verify the imported Twilio number and assigned agent through the API.
4. Confirm the destination is verified when Twilio is on trial.
5. Submit a form with a real E.164 test number.
6. Confirm the application stores `callSid` and `conversationId`.
7. Answer the call and verify the agent:
   - greets the customer by name
   - introduces itself and the product
   - acknowledges the submitted idea
   - asks only one question at a time
   - asks two or three initial questions
   - offers examples for vague answers
8. Approve when asked whether the brief is ready.
9. Confirm the final message is spoken once and cannot be interrupted.
10. Confirm the call hangs up automatically.
11. Confirm the signed webhook returns `200`.
12. Confirm Convex stores normalized transcript, summary, approval, and terminal
    call state.
13. Confirm downstream processing starts once.
14. Repeat with a busy/no-answer or rejected call and verify no stuck active
    lock remains.
15. Attempt an invalid-signature request and verify `401` with no database
    mutation.

## 14. Security requirements

- Never commit or expose Twilio/ElevenLabs credentials.
- Never paste secret values into README files, agent prompts, issue comments, or
  the final response.
- Keep provider calls and webhook verification server-side.
- Treat webhook bodies and transcripts as untrusted input.
- Validate all fields before database writes or provider calls.
- Store the minimum customer data required for the workflow.
- Redact phone numbers and do not log full transcripts by default.
- Rate-limit or otherwise protect the public submission mutation from automated
  spend abuse.
- Make webhook processing idempotent and replay-aware.
- Keep the webhook signing secret separate from the ElevenLabs API key.
- Provide a documented emergency switch that disables new outbound calls
  without deleting historical data.
- Rotate any credential previously exposed in chat, code, screenshots, or shell
  history before production use.

## 15. Required deliverables

Complete all applicable work and return:

1. Convex schema/index changes.
2. Typed public submission mutation plus scheduled internal outbound-call
   action.
3. Internal reservation/status mutations.
4. Conversation retrieval/normalization action.
5. Signed Convex HTTP webhook route.
6. Idempotent scheduled post-call processor.
7. One idempotent TypeScript provisioning command covering the agent, Twilio
   number import/assignment, HMAC webhook, generated environment values, and
   read-back verification.
8. Updated `.env.example` with empty placeholders.
9. One-command provisioning documentation for Twilio, ElevenLabs, Convex env,
   webhook, and E2E verification.
10. Automated tests and their results.
11. A concise changed-file summary.
12. A redacted provisioning summary showing created/reused resource types and
    verification results, with no secret values.

## 16. Definition of done

The task is complete only when:

- the repository passes its type-check, lint, test, and production-build commands
- no secret exists in source control or output
- the outbound call payload is contextual and typed
- the ElevenLabs agent has the concise discovery prompt and uninterruptible
  final `end_call`
- valid signed webhooks are durable and idempotent
- failed/rejected calls cannot leave a permanent active-phone lock
- Convex owns durable state and recovery
- the downstream workflow receives a normalized approved brief trigger rather
  than a raw provider payload
- setup documentation lets another developer reproduce the integration from a
  clean clone
- after the owner fills only the four input placeholders, one command creates or
  reconciles the agent, imports/assigns the Twilio number, provisions the signed
  webhook, stores generated values, deploys Convex, and verifies configuration
- no ElevenLabs or Twilio dashboard configuration is included as a required step

Do not claim completion if automated provider configuration or a real test call
remains unverified. Clearly distinguish implemented code, API-verified
provisioning, and any external account limitation such as Twilio trial destination
verification.

---

## Reference behavior extracted from VoxBuild

The requirements above intentionally preserve these proven VoxBuild decisions:

- ElevenLabs Agents owns real-time voice latency and turn-taking.
- Twilio supplies the imported telephone number.
- Outbound calls use `/v1/convai/twilio/outbound-call`.
- Context uses `customer_name`, `business_type`, and `website_idea`.
- Website ideas support 1,500 characters.
- Discovery is limited to two or three initial questions.
- Natural approval is accepted only in response to the readiness question.
- The farewell lives inside `end_call` with interruptions disabled.
- Post-call events use timestamped HMAC verification with a five-minute window.
- Durable backend state, not the browser, owns recovery and downstream work.

Do not copy VoxBuild names, Google Cloud components, Python modules, Firestore,
Cloud Run, or Cloud Tasks into the new project unless that repository explicitly
uses them. Implement the same behavior with Convex-native primitives.

## Official implementation references

Re-check these official pages when executing this prompt because provider APIs
can evolve:

- [Create an ElevenLabs agent](https://elevenlabs.io/docs/api-reference/agents/create/)
- [ElevenLabs native Twilio integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration/)
- [Import a Twilio phone number](https://elevenlabs.io/docs/eleven-agents/api-reference/phone-numbers/create)
- [Assign an agent to a phone number](https://elevenlabs.io/docs/eleven-agents/api-reference/phone-numbers/update)
- [ElevenLabs Twilio outbound-call API](https://elevenlabs.io/docs/api-reference/twilio/outbound-call)
- [ElevenLabs dynamic variables](https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables)
- [ElevenLabs post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks)
- [Create an ElevenLabs workspace webhook](https://elevenlabs.io/docs/api-reference/webhooks/create)
- [Configure ElevenLabs Agents workspace webhooks](https://elevenlabs.io/docs/eleven-agents/api-reference/workspace/update)
- [Convex actions](https://docs.convex.dev/functions/actions)
- [Convex HTTP actions](https://docs.convex.dev/functions/http-actions)
- [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [Convex environment variables](https://docs.convex.dev/production/environment-variables)
- [Convex environment CLI](https://docs.convex.dev/cli/reference/env)
