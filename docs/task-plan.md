# BuildPilot — Hackathon Implementation Task Plan

Derived from [project-requirements.md](./project-requirements.md). Follows the spine-first build order in PRD Section 7: get the core pipeline fully working end-to-end before attempting the revision loop.

---

## 1. How to use this document

This plan is organized **stage by stage**, not by domain specialty — there is no "voice person" or "deploy person." Three people, Person A / Person B / Person C, each own a stage in the common setup phase and then two more stages later on. **No stage is ever shared by two people** — whoever owns a stage builds all of it, start to finish, using their own Coding Agent session.

The shape of the whole plan:

```
Stage 0 (Person C)  ‖  Stage 1 (Person B)  ‖  Stage 2 (Person A)      <- common setup, fully parallel
                              ↓ (all three complete)
Stage 3 (A)  ‖  Stage 4 (B)  ‖  Stage 5 (C)  ‖  Stage 6 (C)  ‖  Stage 8 (A)     <- independent, no mid-flight sync points
                              ↓
[Stage 7 — optional/stretch, B, only after Stage 9 proves the core pipeline once]
                              ↓
Stage 9 — Integration, wiring & merge (all three, joint)
                              ↓
Stage 10 — Demo rehearsal (all three, joint)
```

| Person | Stages owned |
|---|---|
| **A** | Stage 2, Stage 3, Stage 8 |
| **B** | Stage 1, Stage 4, Stage 7 (optional) |
| **C** | Stage 0, Stage 5, Stage 6 |

**The common setup phase is three stages, run by three different people at the same time:**
- **Stage 0 — every account and environment-variable setup, for every service — is Person C's alone.** This now includes creating the Convex projects (previously scattered elsewhere), plus ElevenLabs, Twilio, OpenAI, Devin, GitHub, and Firebase.
- **Stage 1 — the Convex schema, state machine, and shared-contracts foundation — is Person B's alone.**
- **Stage 2 — scaffolding the React admin app (folders, routing, tooling) — is Person A's alone.**

The only thing Stage 1 and Stage 2 need from Stage 0 is the Convex deployment URL, which exists two minutes into Stage 0 — Person C creates the two Convex projects first, shares the URLs immediately, and the other two proceed in parallel from that point on.

Once all three are done, the plan forks into five independent stages (3, 4, 5, 6, 8) plus one optional stretch stage (7) — each with a single owner, each buildable without waiting on anyone else. Every place one stage's task would need another stage's live output, it instead depends on the **Shared Contracts** Person B publishes at the end of Stage 1 (Section 3) — a short list of names and shapes, not behavior. Where useful, a stage also seeds its own 🧪 fixture/mock data for fast local iteration instead of waiting on a real upstream run. The real wiring-together happens once, in Stage 9, with everyone in the room, followed by Stage 10, the joint demo rehearsal.

**One credential handoff, and only one, exists in the whole plan:** Person C creates the ElevenLabs account in Stage 0 but doesn't use it again — Person B needs the login/API key before Stage 4 (specifically T3.0b, a browser step). That's flagged inline where it happens.

**On workload:** Stage 5 (Person C) is the single largest stage in the plan — it's what you get when document generation, GitHub, Devin dispatch, and Firebase deploy are consolidated under one owner instead of split, as requested. If you'd rather even out total workload across the three people, the cleanest lever is swapping who takes Stage 0 vs. Stage 1 vs. Stage 2 up front — those three are fully interchangeable — and/or reassigning Stage 5 to whoever has the most hackathon time available.

Task tags used throughout:
- 🌐 **Browser** — done directly in a portal/console. Never delegate this to a Coding Agent.
- 💻 **Coding** — paste the "Paste to Coding Agent" block into your own Coding Agent session and review the result. The block is ready to paste as-is.
- 🧪 **Fixture** — optional: seed mock data directly in the Convex dashboard for fast local iteration, standing in for another stage's not-yet-real output.

Every task keeps its original ID (T1.1, T3.2, etc.) from the PRD's phase numbering, so it stays traceable — except the new Stage 2 (React scaffolding), which has no PRD phase of its own and uses fresh IDs (`TR.1`, `TR.2`).

---

## 2. Stage overview

| Stage | Name | Maps to PRD | Executor | Runs alongside |
|---|---|---|---|---|
| 0 | Accounts & environment setup | Section 16 checklist | **Person C**, solo | Stages 1, 2 |
| 1 | Convex schema, state machine & shared contracts foundation | Build Order #1 | **Person B**, solo | Stages 0, 2 |
| 2 | React admin app scaffold | — (new, not a PRD phase) | **Person A**, solo | Stages 0, 1 |
| 3 | Business discovery → Lead/Project creation | Build Order #2, Phases 1–2 | **Person A** | Stages 4, 5, 6, 8 |
| 4 | Voice call → transcript → requirements | Build Order #3, Phases 3–5 | **Person B** | Stages 3, 5, 6, 8 |
| 5 | Documents → GitHub → Devin build → Firebase deploy | Build Order #4, Phases 6–10 | **Person C** | Stages 3, 4, 6, 8 |
| 6 | WhatsApp Sandbox delivery | Build Order #5, Phase 11 | **Person C** | Stages 3, 4, 5, 8 |
| 7 | Customer revision loop — optional/stretch | Build Order #6, Phase 12 | **Person B** | — build whenever, but don't test end-to-end until Stage 9 has proven the core pipeline once |
| 8 | Admin real-time tracking dashboard | Cross-cutting, Section 4.1 | **Person A** | Stages 3, 4, 5, 6 |
| 9 | Integration, wiring & merge | — | **All three**, joint | — |
| 10 | Demo rehearsal & pre-flight checklist | Section 16 | **All three**, joint | — |

Within one person's own queue, stages are still done in listed order (e.g. Person A: Stage 2 → Stage 3 → Stage 8), since later ones build on earlier ones. Across people, nothing in Stages 3–8 blocks on anyone else once Stages 0, 1, and 2 are all done.

---

## 3. Shared contracts (published by Person B at the end of Stage 1)

This is the **only** cross-person coordination in the entire plan. Person B defines the shapes below while implementing Stage 1, informed directly by the PRD, and publishes them once Stage 1 deploys (see the announcement at the end of Stage 1, Section 5). Everyone else builds against the published contracts from that point on — nobody needs to check back with anyone else until Stage 9. Consolidating stages under single owners (per this plan's new structure) collapsed what used to be nine contracts down to seven — most of the old cross-person handoffs are now internal to one person's own stage.

| # | Contract | Frozen shape | Used independently by |
|---|---|---|---|
| 1 | `convex/schema.ts` tables | Full table list from Section 4.2 (businesses, leads, projects, voiceSessions, transcripts, requirements, requirementVersions, buildJobs, deployments, notifications, activityEvents, integrationEvents, assets, revisionRequests, revisionAssets, whatsappMessages, workflowRuns, stageAttempts, webhookEvents, callAttempts, repositories, generatedDocuments, templateVersions, siteTenants, siteSubmissions) — B deploys this in T1.1 | A, B, C — all their functions read/write these tables |
| 2 | `convex/stateMachine.ts` — `transitionProject(ctx, projectId, toState, metadata)` | Signature + full state enum from Section 8 — B deploys in T1.2 | A, B, C — every state-changing function |
| 3 | `convex/lib/stageAttempt.ts` — `beginStageAttempt` / `completeStageAttempt` / `failStageAttempt` | Signatures from Section 10 — B deploys in T1.3 | A, B, C — every external-call action |
| 4 | `convex/lib/externalCall.ts` — `callExternal(ctx, { stage, projectId, live, cacheKey })` | Signature from Section 9 — B deploys in T1.4 | A, B, C — every external-call action |
| 5 | Scheduler hook: `selectBusiness` → `voiceCalls:startCall(projectId)` | Function path + `projectId`-only argument | A writes the `ctx.scheduler.runAfter(0, ...)` call in T2.3 (Stage 3); B implements `startCall` in T3.1 (Stage 4) — each builds independently against this signature |
| 6 | `sendDeliveryMessage(projectId)` function name/path | `convex/whatsapp.ts::sendDeliveryMessage` | C implements it in T5.1 (Stage 6); B's optional Stage 7 revision pipeline (T6.2) calls it by name without needing to touch C's code |
| 7 | Build/deploy dispatch functions: `dispatchDevinBuild(projectId, ...)` (T4.7), the `validate-candidate` workflow trigger (T4.6/T4.8), and the `deploy-firebase` workflow trigger (T4.6/T4.10) | Function signatures + workflow names, all defined by C in Stage 5 | C implements and uses these directly in Stage 5; B's optional Stage 7 revision pipeline (T6.2) reuses/calls the same functions by name for revision builds |

**Practical effect:** because these are names and shapes, not behavior, nobody is blocked waiting for anyone else's function body to exist — only for Person B to publish the list at the end of Stage 1.

---

## 4. Stage 0 — Accounts & Environment Setup

**Executor: Person C, solo.** Every account and credential for every service, for everyone's later work, done here, up front, so nobody else touches a portal except for the one flagged handoff below. Runs in parallel with Stage 1 (Person B) and Stage 2 (Person A).

### T0.1 — Create Convex projects
🌐 **Browser**
**Why:** Section 4.2/4.10 — two separate Convex deployments: one control-plane (BuildPilot admin) and one shared multi-tenant backend for generated customer sites. Do this first, immediately — it's the only thing Stage 1 and Stage 2 need from this stage before they can start.

**Steps:**
1. Go to the Convex dashboard (dashboard.convex.dev) and sign in.
2. Click **New Project**, name it `buildpilot-admin` (control-plane). This creates the project and its default `dev` deployment. Get the deployment URL and deploy key:
   a. Inside the project, use the deployment switcher (top left) to confirm you're on the deployment you want to use going forward — `dev` is fine for the hackathon, or create a `production` deployment if you want a stable one others build against.
   b. Click **Settings** in the left sidebar of that deployment, then open the **URL & Deploy Key** tab.
   c. The **Deployment URL** (looks like `https://<deployment-name>.convex.cloud`) is shown directly on that page — copy it.
   d. Under **Deploy Key**, click **Generate Production Deploy Key** (or **Generate Deploy Key** if you're on a dev deployment) — it's shown once, so copy it immediately into a password manager or secrets store.
3. Click **New Project** again, name it `buildpilot-sites` (shared generated-site backend). Repeat step 2a–2d for this project to get its own deployment URL and deploy key.
4. Save both deploy keys as Convex environment variables directly, don't paste into chat with any Coding Agent. Immediately share the `buildpilot-admin` deployment URL with Person B (for their Stage 1 schema work) and Person A (for their Stage 2 React scaffold env config), and share dashboard access (**Project Settings → Members**) with Person B, so they aren't blocked on you for anything further.

**Depends on:** nothing

---

### T0.2 — Create GitHub org + template repo shell
🌐 **Browser**
**Why:** Section 4.8 — Convex creates a private repo per project by copying from a pinned starter template. The empty repo + org need to exist before you write the template into it.

**Steps:**
1. Create (or designate) a GitHub organization for the hackathon, e.g. `buildpilot-demo`.
2. Create a new **private** repository under that org named `buildpilot-starter-template`.
3. In repo **Settings → General**, confirm "Template repository" can be enabled later (leave unchecked for now — content is populated later, in T4.3).
4. In org **Settings → Actions → General**, ensure Actions are enabled for the org and set permissions to "Allow select actions" or "Allow all actions" (least-privilege can be tightened after workflows are written).
5. Note the org name and repo URL — needed again in T4.4.

**Depends on:** nothing

---

### T0.3 — Create GitHub API credentials
🌐 **Browser**
**Why:** Convex needs API access to create per-customer repos programmatically (Section 4.8).

**Steps:**
1. In GitHub, go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens** (or create a GitHub App if preferred for the org).
2. Create a token scoped to the `buildpilot-demo` org with permissions: Repository (Read/Write, Administration for repo creation), Actions (Read/Write), Contents (Read/Write).
3. Set an expiry that comfortably covers the hackathon window.
4. Copy the token value immediately (shown once). Keep it for T0.9 below.

**Depends on:** T0.2 (own)

---

### T0.4 — Create Firebase project + Hosting sites/targets
🌐 **Browser**
**Why:** Section 4.9/13 — one Firebase project hosts the BuildPilot admin app plus one Hosting site/target per generated customer site.

**Steps:**
1. Go to the Firebase console (console.firebase.google.com), create a new project, e.g. `buildpilot-hackathon`.
2. Under **Build → Hosting**, click **Add another site**, create a site/target named `buildpilot-admin` for the admin app.
3. Create one more site/target for the seeded demo customer, e.g. `buildpilot-demo-customer`.
4. In **Project Settings → Service accounts**, generate a new private key (JSON) for a service account with Firebase Hosting Admin role — this is what GitHub Actions will use to deploy.
5. In **Project Settings → General**, note the Project ID.
6. Save the service account JSON securely — it goes into GitHub Actions secrets in T0.10 below, never committed to a repo.

**Depends on:** nothing

---

### T0.5 — Create ElevenLabs account + configure voice agent
🌐 **Browser**
**Why:** Section 4.4 — the AI voice agent that runs the business discovery call. This is the one account in the whole plan that gets handed off: you create it here, but Person B operates it from Stage 4 onward.

**Steps:**
1. Sign up / log in at elevenlabs.io, enable Conversational AI.
2. Create a new Agent. Configure its system prompt to collect: business purpose, services, target users, desired pages, branding preferences, CTA, contact details (per Section 4.4).
3. Under the agent's **Telephony** settings, select Twilio as the outbound calling transport — do T0.6 first if you haven't, then return here to link the number.
4. Note the Agent ID and generate an API key under **Profile → API Keys**.
5. Leave the webhook URL field blank for now — Person B fills it in at T3.0b in Stage 4, once their webhook endpoint (T3.2) is deployed.
6. **Hand off (the plan's one required handoff):** before Stage 4 begins, share the ElevenLabs login (or an invited team member seat) and the API key with Person B, so they can complete T3.0b themselves.

**Depends on:** nothing

---

### T0.6 — Create Twilio account, voice number, WhatsApp Sandbox
🌐 **Browser**
**Why:** Section 4.5 — telephony transport for the voice call and WhatsApp delivery channel. Both consumers of this account (Stage 4's call placement and Stage 6's WhatsApp delivery) are your own later stages, so no handoff is needed here.

**Steps:**
1. Sign up / log in at twilio.com console.
2. Under **Phone Numbers → Buy a number**, purchase one voice-capable number for outbound calling.
3. Under **Messaging → Try it out → Send a WhatsApp message**, activate the WhatsApp Sandbox. Note the sandbox number and join code.
4. From your own phone (or the seeded demo business's phone), send the join code to the sandbox number to opt in as a participant. Sandbox sessions expire, so this gets re-done closer to the demo — that re-join happens in your own T5.0 in Stage 6.
5. Note the Account SID and Auth Token from the console dashboard home page.
6. Return to T0.5 and link this Twilio number under the agent's telephony settings.
7. Share the demo line's phone number (not the credentials — just the number) with Person A, for their T2.1 in Stage 3.

**Depends on:** nothing

---

### T0.7 — Obtain OpenAI API key
🌐 **Browser**
**Why:** Section 4.6 — transcript-to-structured-requirements extraction (Person B's T3.3 in Stage 4). Just an environment variable — no portal access needed by Person B.

**Steps:**
1. Log in at platform.openai.com, go to **API Keys**, create a new secret key scoped to this project.
2. Set a reasonable spending cap under **Settings → Limits** (per Section 16 checklist).
3. Save the key for T0.9 below.

**Depends on:** nothing

---

### T0.8 — Obtain Devin API access
🌐 **Browser**
**Why:** Section 4.7 — Devin is the autonomous coding agent Convex dispatches to build each customer's website. You use this yourself in Stage 5 — no handoff needed.

**Steps:**
1. Log in to the Devin platform/portal, confirm API access is enabled for the account/org being used.
2. Generate an API key/token for programmatic session dispatch.
3. Confirm (in the portal docs) the expected input format for starting a session (repo URL, branch, spec file path, base commit, correlation ID) — this directly shapes your own T4.1 and T4.7 later in Stage 5.
4. Save the API key for T0.9 below.

**Depends on:** nothing

---

### T0.9 — Load all secrets into Convex environment variables
🌐 **Browser**
**Why:** Section 12 — "All credentials in Convex environment variables only." No secret should ever reach a Coding Agent, a repo, or the browser bundle.

**Steps:**
1. In the Convex dashboard, open the `buildpilot-admin` project → **Settings → Environment Variables** (or run `npx convex env set KEY value` / `npx convex env list` from the CLI against the correct deployment — check `.env.local`'s `CONVEX_DEPLOYMENT` to confirm you're targeting `dev:` and not `prod` unless intended).
2. Add: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_PHONE_NUMBER_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_NUMBER`, `TWILIO_WHATSAPP_NUMBER`, `OPENAI_API_KEY`, `DEVIN_API_KEY`, `GITHUB_TOKEN`, `GITHUB_ORG`, `FIREBASE_PROJECT_ID`, `CONTEXTDEV_API_KEY`. `ELEVENLABS_WEBHOOK_SECRET` gets added later, once Person B completes T3.0b in Stage 4 — **do not skip it**: `convex/http.ts`'s ElevenLabs webhook handler returns HTTP 503 for every callback until this is set, which silently stalls every project at the voice-call stage with no visible error until you check the webhook logs.
3. You've collected all of these values yourself in T0.2–T0.8 above — no need to gather anything from anyone else. `ELEVENLABS_AGENT_PHONE_NUMBER_ID` comes from the ElevenLabs dashboard's **Conversational AI → Phone Numbers** page (the number linked to Twilio), not from T0.5/T0.6 — don't assume the agent ID alone is enough to place calls.
4. After setting variables, run `npx convex run admin:getHealth '{}'` (or open the Admin UI's health page) and confirm every service shows `OPERATIONAL`, not just that the env vars exist — `getHealth` only checks presence, not validity, so also do a real smoke test per integration (e.g. `npx convex run businesses:searchBusinesses '{"city":"Dubai","category":"restaurant","maxResults":5}'`) before assuming a stage is ready, especially for any newly-integrated third-party API whose actual endpoint shape you haven't verified against current docs.
5. Repeat for the `buildpilot-sites` deployment if it needs anything beyond its own deploy key.

**Depends on:** T0.1 (own)

---

### T0.10 — Configure GitHub Actions secrets (Firebase)
🌐 **Browser**
**Why:** The GitHub Actions workflows written later in T4.6 need Firebase credentials to deploy. The org, template repo, and Firebase project all already exist by the end of Stage 0 (your own T0.2, T0.4) — no reason to wait until Stage 5 to add these.

**Steps:**
1. In the `buildpilot-demo` org (created in your own T0.2), go to **Settings → Secrets and variables → Actions**. Set these at the **org** level so every generated customer repo inherits them automatically — no per-project setup needed later.
2. Add secret `FIREBASE_SERVICE_ACCOUNT` = the JSON key generated in your own T0.4.
3. Add secret `FIREBASE_PROJECT_ID` = the project ID from your own T0.4.
4. Confirm org Actions permissions (T0.2 step 4) allow workflows in generated repos to read these secrets.
5. Two values can't be added yet: the Convex callback secret `CONVEX_CALLBACK_TOKEN` and its companion variable `CONVEX_CALLBACK_URL`, since neither exists until you implement the workflow-to-Convex callback in Stage 5 (your own T4.5/T4.6) — those get added later, in T4.9.

**Depends on:** T0.2, T0.4 (own)

---

## 5. Stage 1 — Convex Schema, State Machine & Shared Contracts Foundation

**Executor: Person B, solo.** This is the foundation every other stage builds on, and the source of the Shared Contracts in Section 3. Runs in parallel with Stage 0 (Person C) and Stage 2 (Person A) — starts as soon as Person C shares the Convex deployment URL (a couple of minutes into Stage 0), not after all of Stage 0 finishes.

### T1.1 — Define full Convex schema
💻 **Coding**
**Description:** Create `convex/schema.ts` with every table from PRD Section 4.2. **This is the top-priority task in the whole plan — everything in Stages 3–8 reads or writes these tables.**

**Paste to Coding Agent:**
```
Implement the Convex schema in convex/schema.ts for the buildpilot-admin
deployment, covering these tables (see docs/project-requirements.md Section
4.2 for the authoritative list): businesses, leads, projects, voiceSessions,
transcripts, requirements, requirementVersions, buildJobs, deployments,
notifications, activityEvents, integrationEvents, assets, revisionRequests,
revisionAssets, whatsappMessages, workflowRuns, stageAttempts, webhookEvents,
callAttempts, repositories, generatedDocuments, templateVersions, siteTenants,
siteSubmissions.

Design each table's fields based on how it's used across the E2E flow in
Section 6 (Phases 1-12) and the state machine in Section 8. In particular:
- workflowRuns and projects must carry the full state enum from Section 8
  (primary states + revision states + failure states) as a Convex union type.
- stageAttempts must support idempotency keys of the form
  "projectId:stage:version" (Section 10) and lease/lock fields with expiry.
- webhookEvents must store provider + provider event ID for dedup before
  processing (Section 10).
- failure-state records must capture failedStage, errorCode, retryable,
  retryCount, maxRetries, correlationId, provider, providerRequestId
  (Section 8 "Failure States").

Add appropriate indexes for the query patterns needed downstream (e.g.
projects by workflowRun state, activityEvents by projectId, stageAttempts by
idempotency key). Do not implement any functions yet — schema only.

This schema will immediately be built on by two other engineers' Convex
code — keep table and field names unambiguous since they'll be relying on
this as the single source of truth without re-deriving it themselves.
```
**Depends on:** Person C's T0.1 (Stage 0 — Convex deployment URL, shared within minutes)

---

### T1.2 — Implement workflow state machine helpers
💻 **Coding**
**Description:** Central module enforcing valid state transitions so no other code can move a project into an illegal state.

**Paste to Coding Agent:**
```
Implement a state machine module (e.g. convex/stateMachine.ts) that:
1. Encodes the full transition graph from docs/project-requirements.md
   Section 8: primary project states, revision states, and failure states.
2. Exposes a single function, e.g. transitionProject(ctx, projectId,
   toState, metadata), that validates the current state allows a transition
   to toState, throws if not, and otherwise updates the project/workflowRun
   record and writes an activityEvents row recording the transition
   (fromState, toState, timestamp, correlationId, stage) so the Admin
   dashboard has a full audit trail to render.
3. Every other Convex function that changes project state — including the
   ones written by the other two engineers — must go through this helper.
   Publish its exact function signature clearly (e.g. in a short code
   comment or README note) since it's a shared dependency across every
   stage.
Do not implement the individual stage functions yet.
```
**Depends on:** T1.1 (own)

---

### T1.3 — Implement idempotency & stage-lease locking
💻 **Coding**
**Description:** Section 10 — every external call must be wrapped in a stageAttempt with a deterministic idempotency key and a lease lock preventing concurrent execution of the same stage.

**Paste to Coding Agent:**
```
Implement convex/lib/stageAttempt.ts with:
1. beginStageAttempt(ctx, projectId, stage, version) — computes idempotency
   key "projectId:stage:version" (Section 10), checks for an existing
   in-flight or completed attempt with that key, acquires a lease with an
   expiry (reject if another attempt already holds the lease and hasn't
   expired), and inserts a stageAttempts row.
2. completeStageAttempt(ctx, attemptId, result) and
   failStageAttempt(ctx, attemptId, error) to close out an attempt.
3. A reconciliation helper that, before creating a new provider resource,
   checks for a timed-out previous attempt on the same idempotency key and
   reconciles rather than double-creating (Section 10, "Reconcile timed-out
   provider requests").
4. Bounded exponential backoff + jitter helper for retryable errors, and a
   path that marks the project MANUAL_INTERVENTION_REQUIRED with an
   auditable reason once retries are exhausted or the error is
   non-retryable.
This module is a shared dependency — every external-call action across
every stage must use it rather than reimplementing retry/locking logic
locally.
```
**Depends on:** T1.1, T1.2 (own)

---

### T1.4 — Implement replay-fallback interface
💻 **Coding**
**Description:** Section 9 — demo resilience wrapper around every external integration.

**Paste to Coding Agent:**
```
Implement convex/lib/externalCall.ts exporting a generic wrapper, e.g.
callExternal(ctx, { stage, projectId, live: () => Promise<T>, cacheKey }),
that:
1. In "live" mode, calls the provided live() function and, on success,
   stores the response keyed by (projectId, stage) as the "last successful
   response" for that stage.
2. In "replay" mode (a project-level or global flag), skips the live call
   and returns the last stored successful response for that stage +
   project, then still runs it through the same downstream processing/state
   transition path as a live response would (Section 9 — "Fallback does not
   skip state transitions").
3. Exposes a Convex mutation, e.g. replayLastResponse(projectId, stage),
   that the Admin UI's "Replay Last Response" button (Stage 8's T7.3) calls
   directly for a project sitting in MANUAL_INTERVENTION_REQUIRED.
Every external integration built by anyone — Context.dev search, ElevenLabs
call result, OpenAI extraction, Devin build result, GitHub Actions result,
Firebase deploy result, Twilio delivery status (Section 9 list) — must be
wrapped in this. Publish its exact signature so the rest of the code can
import and use it directly rather than each writing their own version.
```
**Depends on:** T1.3 (own)

---

### Stage 1 complete — publish the Shared Contracts. Announce to Person A and Person C: T1.1–T1.4 are deployed, here are the shapes in Section 3. This is the one moment in the whole plan where two people are waiting on a third — from here on, every stage runs fully independently with no further check-ins until Stage 9.

---

## 6. Stage 2 — React Admin App Scaffold

**Executor: Person A, solo.** No PRD phase maps to this stage directly — it's the structural shell every later UI stage (Stage 3's search screen, Stage 8's dashboard) builds real screens into. Runs in parallel with Stage 0 (Person C) and Stage 1 (Person B); only needs the Convex deployment URL (shared within minutes of Stage 0 starting), not the actual schema or any deployed functions.

### TR.1 — Initialize the BuildPilot Admin React project
💻 **Coding**
**Description:** Scaffold the React admin app itself — tooling only, no screens yet.

**Paste to Coding Agent:**
```
Initialize the BuildPilot Admin frontend as a new Vite + React + TypeScript
project (in a new `buildpilot-admin-ui` repo, or an `apps/admin` folder if
this is a monorepo — pick whichever matches how the rest of the codebase is
organized) with:
1. ESLint + Prettier config, a basic Vitest/React Testing Library test
   setup, and a committed lockfile.
2. The Convex React client SDK wired up (convex/react), reading the
   deployment URL from an environment variable (e.g. VITE_CONVEX_URL) —
   never hardcode the Convex deployment URL.
3. A React error boundary at the app root.
4. A health-check route/component so Firebase Hosting deploys can be smoke
   tested later.
Do not build any actual screens yet — this task is scaffolding only.
```
**Depends on:** Person C's T0.1 (Stage 0 — Convex deployment URL, shared within minutes)

---

### TR.2 — Define folder structure, routing skeleton & shared layout
💻 **Coding**
**Description:** The structural shell every later stage's screens plug into, so nobody invents folder conventions mid-stage.

**Paste to Coding Agent:**
```
On top of the scaffolded project (TR.1), set up:
1. A folder structure: src/pages (one folder per screen), src/components
   (shared/reusable UI), src/hooks (Convex query/mutation hooks),
   src/lib (Convex client, formatting/validation helpers).
2. Client-side routing (react-router or equivalent) with placeholder pages
   already stubbed for each screen the plan will build later: /search
   (business discovery, filled in during Stage 3), /projects/:projectId
   (project detail/tracking, filled in during Stages 3–7), /dashboard
   (pipeline overview, filled in during Stage 8). Each placeholder just
   renders a "Coming soon" state for now — this task does not implement
   any screen logic.
3. A shared layout component (nav/header + content area) all pages render
   inside, so later stages don't each build their own page chrome.
4. Basic styling setup (Tailwind, CSS modules, or whatever the team
   already prefers) so later stages have a consistent base to build on.
```
**Depends on:** TR.1 (own)

---

### Stage 2 complete — the scaffold is ready for Stage 3 (your own next stage) and Stage 8 to build real screens into.

---

## 7. Stage 3 — Business Discovery → Lead/Project Creation

**Executor: Person A.** Starts once Stages 0, 1, and 2 are all complete — continues directly on top of your own Stage 2 scaffold.

### T2.1 — Seed demo business record (optional; superseded by T2.3's phone override)
🌐 **Browser**
**Why:** Section 16 checklist item — hackathon demo relies on a contactable phone number, not on whatever Context.dev's web search happens to surface, to guarantee reliability.

> **Note (learned during first live run):** we originally shipped this as a
> `seedDemoBusiness` mutation + "Save demo target" button in the Admin UI. It
> was removed because it let testers skip real business search entirely,
> which defeated end-to-end testing. The phone-override flow on `selectBusiness`
> (see T2.3) replaces it — you no longer need to manually seed a row here
> unless you want a business that doesn't show up in Context.dev search at
> all. If you do, you can still add a document directly in the Convex
> dashboard's `businesses` table with `contactEligible: true` and a valid
> E.164 `phone`/`normalizedPhone`.

**Depends on:** T1.1 (Stage 1), Person C's T0.6 (Stage 0 — phone number)

---

### T2.2 — Implement Context.dev search integration
💻 **Coding**
**Description:** Section 4.3 / Phase 1 — live search feature.

> ⚠️ **Verify before implementing:** Context.dev (docs.context.dev) is a web
> scraping / brand-intelligence API. It has **no local-business-directory
> endpoint** — there is no `POST /v1/search` or anything that takes
> city/category/radius and returns structured name/phone/address/geo like
> Google Places does. Calling `/v1/search` (a URL we assumed existed without
> checking the docs) returns **HTTP 404**. The only usable endpoint for this
> feature is `POST /v1/web/search` — a generic web search that returns
> `{ results: [{ url, title, description, relevance }] }` snippets, no
> guaranteed phone number. Before writing this integration (or re-running it
> against a new Context.dev account/plan), fetch
> `https://docs.context.dev/llms.txt` and confirm `/web/search`'s current
> request/response shape hasn't changed — do not assume a Places-style API
> exists.

**Paste to Coding Agent:**
```
Implement a Convex action searchBusinesses(city, area, category, radius,
maxResults) in convex/businesses.ts that:
1. Calls Context.dev's POST /web/search endpoint (base URL/key read from
   environment variables — CONTEXTDEV_API_KEY) via the callExternal wrapper
   from convex/lib/externalCall.ts (stage = "BUSINESS_SEARCH"). Build the
   query from city/area/category (e.g. "<category> near <area> in <city>
   contact phone number"); request numResults clamped to [10, 100] since
   the API rejects values below 10.
2. Normalizes each { url, title, description } result into the businesses
   table shape from schema.ts: name = title, website = url, address =
   description (often contains a phone number as free text, but do not
   rely on regex-extracting it as ground truth). Since Context.dev cannot
   verify a phone number belongs to the business, assign every row
   phone/normalizedPhone = DEFAULT_CALL_PHONE (Convex env var, defaults to
   "+971588711809" if unset), contactEligible: true, and
   contactBasis: "default_admin_number" — admins can still override the
   number per selection (T2.3), but no row is blocked from being called.
3. Dedup by (source, externalId) — update in place rather than duplicate on
   re-search.
4. On failure (missing env, non-2xx response, zero results), throw rather
   than silently falling back to fixture/mock data — BUSINESS_SEARCH runs
   before a project exists, so there's no project to transition to
   BUSINESS_SEARCH_FAILED yet; let the action error surface to the Admin UI.
Also implement a reactive query listBusinesses(filters) for the Admin UI
search results screen (T2.4).
```
**Depends on:** T1.1, T1.4 (Stage 1)

---

### T2.3 — Implement selectBusiness → Lead/Project/WorkflowRun creation
💻 **Coding**
**Description:** Phase 2 — atomic creation of the tracking records and auto-scheduling of the call.

> Because T2.2's search results carry a shared default number
> (`DEFAULT_CALL_PHONE`, not a per-business verified number),
> `selectBusiness` accepts an optional `overridePhone` (E.164) so the admin
> can point the call at a different number they control instead. Eligibility
> and do-not-contact validation has been intentionally removed from this
> mutation (per admin decision) — every business is treated as contactable
> and always resolves to a usable E.164 number: `overridePhone` if given,
> else the business's existing phone, else `DEFAULT_CALL_PHONE`.

**Paste to Coding Agent:**
```
Implement a Convex mutation selectBusiness(businessId, selectedBy?,
overridePhone?) in convex/projects.ts that:
1. Resolves the call number as overridePhone (normalized via
   businesses.ts's normalizePhone) if supplied, else the business's
   existing phone/normalizedPhone, else the DEFAULT_CALL_PHONE env var
   (fallback "+971588711809" if unset) — always falls back rather than
   throwing, and patches the business record's
   phone/normalizedPhone/contactEligible (true)/doNotContact (false)/
   contactBasis ("admin_override" when overridePhone was given, otherwise
   "default_admin_number") before proceeding. No eligibility/do-not-contact
   validation blocks selection.
2. Atomically creates a *new* Lead, Project, and WorkflowRun record linked
   together on every call (single Convex mutation = atomic by default) —
   deliberately does not dedupe against an existing active lead for the
   same business (T7.x demo/testing aid), so the admin can re-run the full
   voice-call flow for the same business as many times as needed. Each
   project is independent and starts fresh at PROJECT_CREATED, so no
   state-machine transition is ever attempted on an already-progressed
   project — this keeps stateMachine.ts's transition validation intact.
3. Sets project state to PROJECT_CREATED via the state machine helper,
   which will also write the activityEvents row for the dashboard.
4. Schedules the outbound call automatically with no further admin action
   required — use ctx.scheduler.runAfter(0, ...) to enqueue
   convex/voiceCalls.ts::startCall(projectId), per the scheduler hook
   contract frozen in Section 3, row 5. Person B is building startCall
   independently against the same contract — this resolves cleanly once
   both sides deploy, no live coordination needed.
```
**Depends on:** T1.1, T1.2 (Stage 1)

---

### T2.4 — Admin UI: search & select business screen
💻 **Coding**
**Description:** First real screen of the admin app — command + observe only, per Section 4.1. Fills in the `/search` placeholder from Stage 2.

**Paste to Coding Agent:**
```
Build the React admin screen for business discovery, replacing the /search
placeholder from the earlier scaffold:
1. A form capturing city, area, category, radius, max results, calling
   searchBusinesses via a Convex mutation/action trigger — never call
   Context.dev directly from React (Section 4.1 "Must NOT").
2. A results list using useQuery(listBusinesses) so it updates reactively
   as Convex writes rows — no manual fetch/polling code. Do not surface a
   "Website" link per row — the admin only needs the business identity and
   the ability to call it. listBusinesses also joins each business to its
   most recent lead (by_business_id index) and returns leadStatus/projectId
   so the UI knows whether a call has already been placed.
3. A single "call phone override" input (persisted in localStorage,
   pre-filled from VITE_DEFAULT_CALL_PHONE) since Context.dev search can't
   supply verified phone numbers — every business is pre-assigned the
   backend's DEFAULT_CALL_PHONE at search time (T2.2), so this field starts
   populated but stays editable per search. Each result row renders a
   "Call" button (no per-row eligibility gating/labels) that calls
   selectBusiness with overridePhone set to that value when present —
   selectBusiness runs in the background (mutation creates the Lead/
   Project/WorkflowRun and schedules startCall) without navigating away, so
   the admin can keep working the results list while the call is placed.
4. Once a business's projectId is populated (a call has already been
   started for it), its row becomes clickable and additionally renders a
   "View project" button alongside "Call" — clicking anywhere on the row,
   or the "View project" button, navigates to /projects/:projectId to view
   that project's detail view and live activity timeline (filled in
   further across Stages 4–7). The "Call" button always remains visible and
   enabled even after a project exists, since selectBusiness (T2.3) always
   creates a new independent Lead/Project/WorkflowRun rather than reusing
   one — this lets the admin re-run the voice-call flow for the same
   business repeatedly for testing. Clicking "Call" never auto-navigates;
   the admin explicitly opens a row's "View project" button when they want
   to watch progress.
```
**Depends on:** T2.2, T2.3 (own)

---

## 8. Stage 4 — Voice Call → Transcript → Requirements

**Executor: Person B.** Starts once Stages 0, 1, and 2 are all complete — continues directly on top of your own Stage 1 foundation. Needs the ElevenLabs credentials Person C hands off from their T0.5 before T3.0b.

### T3.1 — Implement startCall Convex action
💻 **Coding**
**Description:** Phase 3 — Convex initiates the outbound call via ElevenLabs.

**Paste to Coding Agent:**
```
Implement a Convex action startCall(projectId) in convex/voiceCalls.ts
that:
1. Validates E.164 number format, contact eligibility, calling-window
   policy, and attempt/retry policy for the target business (read from
   businesses/leads tables).
2. Calls the ElevenLabs API to start a conversation via the callExternal
   wrapper from convex/lib/externalCall.ts (stage = "VOICE_CALL"), passing
   business context (name, category, whatever fields the agent prompt
   needs) so the agent can personalize the call.
3. Stores the returned ElevenLabs conversation ID and Twilio call SID in a
   new voiceSessions record linked to the project.
4. Transitions project state CALL_QUEUED -> CALLING via the state machine
   helper from convex/stateMachine.ts.
5. On failure (ineligible, rate-limited, provider error), transition to
   CALL_FAILED with failedStage/errorCode/retryable populated, matching the
   Failure Recovery table in Section 11 (Retry Call -> resume from
   CALL_QUEUED).
This will be scheduled automatically by selectBusiness (Person A's T2.3,
Stage 3) via ctx.scheduler, per the scheduler hook contract frozen in
Section 3, row 5 — build the function signature to match that contract
directly, no need to check back with Person A.
```
🧪 **Fixture for fast local iteration:** seed a test `projects`/`businesses`
row directly in the Convex dashboard and invoke `startCall(projectId)`
manually from the dashboard's function runner, rather than waiting on the
real `selectBusiness` scheduling path every time you test. The real
scheduler wiring gets confirmed once in Stage 9.

**Depends on:** Stage 1 shared contracts (Section 3, rows 1–5), Person C's T0.5/T0.6 (Stage 0 — credentials)

---

### T3.2 — Implement ElevenLabs webhook HTTP Action
💻 **Coding**
**Description:** Phase 4 — receives call-end webhook, stores transcript, advances state.

**Paste to Coding Agent:**
```
Implement a Convex HTTP Action at route /webhooks/elevenlabs in
convex/http.ts (or convex/webhooks/elevenlabs.ts) that:
1. Validates the ElevenLabs webhook signature (read secret from
   ELEVENLABS_WEBHOOK_SECRET env var) — reject with 401 on failure.
2. Deduplicates by ElevenLabs conversation ID: look up webhookEvents by
   (provider="elevenlabs", providerEventId=conversationId); if already
   processed, return 200 immediately without reprocessing (Section 10).
3. Resolves conversation ID -> voiceSessions row -> project.
4. Stores the transcript payload in the transcripts table.
5. Transitions project state CALL_COMPLETED -> TRANSCRIPT_RECEIVED via the
   state machine helper.
6. Schedules requirement extraction automatically via ctx.scheduler
   (convex/requirements.ts::extractRequirements, your own T3.3 below).
7. Treat all transcript/customer text as untrusted input per Section 12 —
   store as opaque data, never interpolate into prompts or code.
After deploying, note the live HTTP Action URL for T3.0b below
(format: https://<deployment>.convex.site/webhooks/elevenlabs).
```
**Depends on:** Stage 1 shared contracts (Section 3, rows 1–4)

---

### T3.0b — Point ElevenLabs webhook at Convex
🌐 **Browser**
**Why:** Section 4.4 — "On call end → ElevenLabs fires webhook → Convex HTTP Action receives it." This is where you use the ElevenLabs credentials handed off from Person C's T0.5.

**Steps:**
1. Log in to the ElevenLabs dashboard using the credentials Person C shared, open the Agent.
2. Under **Webhooks / Post-call settings**, paste the Convex HTTP Action URL from T3.2.
3. If ElevenLabs supports a signing secret for webhook verification, generate/copy it and add `ELEVENLABS_WEBHOOK_SECRET` in Convex env vars yourself (Person C left this one for you in T0.9).
4. Save. Trigger a test call if the portal supports it, and confirm (via the Convex dashboard **Logs** tab) that the HTTP Action received a request.

**Depends on:** T3.2 (own task), Person C's T0.5 (Stage 0 — credential handoff)

---

### T3.3 — Implement OpenAI requirement extraction
💻 **Coding**
**Description:** Phase 5 — Section 4.6, revised so a business owner's
incomplete call answers never block the pipeline. Business name, page
list, and CTA are treated as **optional-with-defaults** rather than hard
requirements: if the transcript doesn't contain them, the extraction step
fills a sensible default (e.g. business name -> "Untitled Business",
pages -> a single default "Home" page, CTA -> label "Contact Us" / action
"contact") and proceeds, rather than failing the checkpoint. These
defaults are placeholders the business owner (or the human operator via
the admin UI / revision loop) can edit later — they are not treated as
model-invented values by the placeholder/invented-value check, since
they're inserted by our own code, not guessed by OpenAI.

**Paste to Coding Agent:**
```
Implement a Convex action extractRequirements(projectId) in
convex/requirements.ts that:
1. Loads the transcript for the project (populated by your own webhook
   handler, table: transcripts), sends it plus a schema-constrained prompt
   to OpenAI via the callExternal wrapper (stage =
   "REQUIREMENTS_EXTRACTION"), requesting structured JSON output only —
   the model must not invent facts; unknown fields must remain null/absent,
   not guessed (Section 4.6).
2. After parsing the response, fills defaults for any missing/blank
   business name, pages list, or CTA (see Description above) instead of
   treating them as hard-required fields, then validates the resulting
   JSON against the requirements schema — the only remaining failure mode
   is a fundamentally malformed payload (not a JSON object) or a
   placeholder/invented-looking value coming from OpenAI itself.
3. On validation success: store as a new row in requirements +
   requirementVersions (recording model name, prompt version, schema
   version), transition REQUIREMENTS_PROCESSING -> REQUIREMENTS_READY ->
   REQUIREMENTS_VALIDATED.
4. On validation failure (malformed payload): transition to
   REQUIREMENTS_FAILED with errorCode = "REQUIREMENTS_INSUFFICIENT",
   retryable = false, routing to MANUAL_INTERVENTION_REQUIRED per Section
   4.6.
5. On success, schedule generateDocuments — Person C's T4.1 in Stage 5,
   per the function path they publish; this is a fire-and-forget scheduler
   call, no live coordination needed.
6. Trigger this from the transcript-received scheduler call your own
   webhook handler (T3.2) makes.
```
🧪 **Fixture for fast local iteration:** seed a `transcripts` row directly in
the Convex dashboard with a realistic sample transcript and run
`extractRequirements(projectId)` against it, rather than placing a real
call every time you want to test extraction. Confirm against a real,
webhook-produced transcript once before moving on.

**Depends on:** T1.1, T1.4 (Stage 1)

---

### T3.4 — Admin UI: call & transcript & requirements panel
💻 **Coding**
**Description:** Lets a human watch the call progress and inspect what was extracted. Extends the `/projects/:projectId` placeholder from Stage 2.

**Paste to Coding Agent:**
```
Extend the project detail view (scaffolded in Stage 2) with a panel that:
1. Uses useQuery to reactively show voiceSessions status (CALL_QUEUED /
   CALLING / CALL_COMPLETED) for the current project — no polling code, the
   Convex subscription pushes updates automatically.
2. Once TRANSCRIPT_RECEIVED, renders the stored transcript text.
3. Once REQUIREMENTS_VALIDATED, renders the structured requirements JSON
   in a readable field-by-field layout (not raw JSON dump) — business name,
   pages, CTA, branding, contact details, etc.
4. If state is REQUIREMENTS_FAILED, show the errorCode and a "Retry
   Extraction" button that calls extractRequirements again (Section 11
   Failure Recovery table).
```
**Depends on:** T3.3 (own)

---

## 9. Stage 5 — Documents → GitHub → Devin Build → Firebase Deploy

**Executor: Person C.** Starts once Stages 0, 1, and 2 are all complete — continues directly on top of your own Stage 0 GitHub/Firebase/Devin accounts. This is the single largest stage in the plan (see the workload note in Section 1) — budget more time for it than the others.

### T4.1 — Implement document generation action
💻 **Coding**
**Description:** Phase 6 — generates the docs your own repo/build pipeline (and Devin) will read.

**Paste to Coding Agent:**
```
Implement a Convex action generateDocuments(projectId) in
convex/documents.ts that:
1. Reads the validated requirements for the project.
2. Generates README.md, BUILD_SPEC.md, REQUIREMENTS.md, UI_GUIDELINES.md as
   text content (template + requirements interpolation — this can call
   OpenAI again for prose generation if desired, or be deterministic
   templating). Keep BUILD_SPEC.md structured enough for Devin to parse
   reliably, matching the input format you confirmed against the Devin
   portal in your own T0.8 — you own both ends of this format (generation
   here, and consumption in T4.4/T4.7 below), so there's no one else to
   coordinate the structure with.
3. Stores each as a row in generatedDocuments linked to the project.
4. Transitions DOCUMENTS_GENERATING -> DOCUMENTS_READY.
5. Schedule prepareRepository (your own T4.4 below) automatically on
   success.
```
🧪 **Fixture for fast local iteration:** if you want to build/test T4.4
before T4.1's requirements-reading path is fully wired to real data, seed a
`requirements` row directly in the Convex dashboard and run
`generateDocuments(projectId)` against it.

**Depends on:** T1.2 (Stage 1)

---

### T4.2 — Implement asset collection & validation
💻 **Coding**
**Description:** Phase 7 — Section 12 security rules for uploaded/collected media.

**Paste to Coding Agent:**
```
Implement a Convex action collectAssets(projectId) in convex/assets.ts
that:
1. Gathers any available business assets (from Context.dev result / WhatsApp
   media if present at this point).
2. For each asset: verifies MIME type from file bytes (not filename/
   extension), enforces size limits, sanitizes filenames, records
   provenance, and rejects executable content or unknown provenance
   (Section 12 + Phase 7).
3. Stores accepted binaries in Convex File Storage, with metadata rows in
   the assets table.
4. This stage can complete with zero assets (not a hard blocker) — proceed
   to repository preparation regardless once validation of what exists is
   done. Any imagery gap left here (no logo/hero/product images from the
   business) is not filled in this step — it's addressed after the repo
   exists, by sourcing licensed stock images in T4.5b below.
```
**Depends on:** Stage 1 shared contracts (Section 3, rows 1–4)

---

### T4.3 — Build the starter template repo content
💻 **Coding**
**Description:** Section 14 — the versioned immutable template Devin builds on top of.

**Paste to Coding Agent:**
```
Populate the buildpilot-starter-template GitHub repo (created empty in your
own T0.2) with a versioned starter template containing: React +
TypeScript + Vite, Convex integration wiring, routing, Firebase Hosting
config, a committed lockfile, a React error boundary, and a health-check
route/target (Section 14). No lint config or test setup needed — the CI
workflows (your own T4.6) only run a production build, not lint/test.
This is the
base every generated customer site starts from — keep it minimal and
generic, no business-specific content. Tag the initial commit/version so
Convex can reference a pinned templateVersion + commit SHA later (your
T4.4).
```
**Depends on:** T0.2 (own, Stage 0)

---

### T4.4 — Implement Convex GitHub repo creation action
💻 **Coding**
**Description:** Phase 8 — per-project private repo, seeded from the template.

**Paste to Coding Agent:**
```
Implement a Convex action prepareRepository(projectId) in
convex/github.ts that:
1. Calls the GitHub API (token from GITHUB_TOKEN env var, org from
   GITHUB_ORG) via the callExternal wrapper from convex/lib/externalCall.ts
   (stage = "REPOSITORY_PREP") to create a new private repo for this
   project.
2. Pushes the pinned starter template version (your T4.3), the generated
   docs (your T4.1, table: generatedDocuments), and validated assets (your
   T4.2) to the new repo's initial commit.
3. Records repo ID, default branch, initial commit SHA, and templateVersion
   in the repositories table.
4. Dispatches the validate-repository GitHub Actions workflow (your T4.6)
   via the GitHub API's workflow_dispatch, or relies on a push trigger if
   simpler — confirm with the workflow's actual trigger in T4.6.
5. Transitions REPOSITORY_PREPARING; on GitHub API failure, transition to
   GITHUB_FAILED (Section 11 Failure Recovery: Retry Repo Prep -> resume
   from REPOSITORY_PREPARING).
```
**Depends on:** T4.1, T4.2, T4.3 (own)

---

### T4.5 — Implement validate-repository result verification
💻 **Coding**
**Description:** Phase 8 completion — Section 5 concrete rule.

**Paste to Coding Agent:**
```
Implement a Convex HTTP Action or polling action that receives/fetches the
validate-repository workflow's result (GitHub Actions run ID + conclusion)
and:
1. Verifies: npm ci + build both exited 0, on the exact initial commit SHA
   recorded in repositories (Section 5 "Repository validated" rule) —
   reject if the run reports a different commit.
2. On success, transition REPOSITORY_PREPARING -> REPOSITORY_READY and
   schedule the stock image sourcing step (your T4.5b below), which itself
   schedules the Devin build dispatch (T4.7) once it's done.
3. On failure, transition to GITHUB_FAILED with the run's failure reason.
```
**Depends on:** T4.4, T4.6 (own)

---

### T4.6 — Write GitHub Actions workflow files
💻 **Coding**
**Description:** Section 15 — the three Convex-dispatched workflows plus the BuildPilot admin's own CI deploy. Kept intentionally minimal for the hackathon demo: build-check + deploy, no test suite and no security-scan stage in the pipeline.

**Paste to Coding Agent:**
```
Write these GitHub Actions workflow YAML files in the starter template repo
(and the buildpilot-admin-ui repo for the 4th one). Keep all of them
straightforward and quick to run — no test runner and no security-scan
step in any of them; the only gate before deploy is "does it build":

1. .github/workflows/validate-repository.yml — triggered by
   workflow_dispatch (called from Convex per your T4.4). Runs npm ci, npm
   run build on the exact commit passed in; exits non-zero on any failure;
   reports back to Convex (via a callback HTTP request to a Convex HTTP
   Action endpoint, or by writing run status Convex then polls for — pick
   one approach and keep it consistent across all 3 dispatched workflows).

2. .github/workflows/validate-candidate.yml — triggered by
   workflow_dispatch on a target commit (Devin's push, or a revision
   commit). Runs npm ci, npm run build, uploads the build artifact, and
   computes/reports an artifact checksum (used later to confirm the exact
   build that gets deployed). No test suite and no separate security-scan
   step here — the deployed bundle is already checked for accidentally-
   embedded secrets independently, at runtime, by Convex in T4.10.

3. .github/workflows/deploy-firebase.yml — triggered by workflow_dispatch.
   Deploys the build straight to the live Firebase Hosting target for that
   site/target in one step — no separate preview target, promote step, or
   in-workflow smoke test. Convex already verifies the live URL
   independently right after this workflow reports success (your own
   T4.10), so a second check inside the workflow would just be duplicate
   work.

4. .github/workflows/deploy-buildpilot.yml — triggered on push to main in
   the buildpilot-admin-ui repo. Deploys the BuildPilot admin React app to
   its own Firebase Hosting site/target (separate from customer sites).
   This one deploys the admin app Person A scaffolded in Stage 2 —
   coordinate the exact repo path/branch this watches with them (the only
   other coordination point in Stage 5, besides the contracts in Section 3).

All four: least-privilege permissions blocks, pinned action versions (no
floating @main/@master tags), a bounded job timeout, and read secrets only
from GitHub Actions repo/org secrets — never hardcoded. These are free to
declare and keep a stuck run from blocking the demo, so keep them even
though the pipeline itself is intentionally bare-bones (Section 15).
```
**Depends on:** T4.3 (own)

---

### T4.9 — Add the Convex callback secret to GitHub Actions
🌐 **Browser**
**Why:** The Firebase secrets these workflows need were already configured back in Stage 0 (your own T0.10). The only thing that couldn't be set up that early is the Convex callback secret — its name/value doesn't exist until you implement the workflow-to-Convex reporting mechanism.

**Resolved design (T4.5/T4.6/T4.8/T4.10):** the reporting mechanism is polling, not a callback — Convex calls the GitHub Actions API on a fixed schedule from `github.ts` (`reconcileRepositoryValidation`), `devin.ts` (`reconcileDevinStatus`/`reconcileCandidateValidation`), and `deployments.ts` (`reconcileFirebaseDeployment`), and those polling actions are the sole source of truth for every state transition. On top of that, each of the three dispatched workflows in the starter template (`validate-repository.yml`, `validate-candidate.yml`, `deploy-firebase.yml`) now also POSTs its conclusion to a new Convex HTTP Action, `POST /webhooks/github-workflow` (`convex/http.ts`), as a **best-effort, low-latency supplement**: the endpoint verifies a bearer token, resolves the project from `correlation_id`, and simply schedules the matching reconcile action to run immediately instead of waiting for its next poll. A missing/misconfigured callback (unset `CONVEX_CALLBACK_URL`, wrong token, network blip) never blocks the pipeline — every workflow's callback step runs with `if: always()` and only emits a `::warning::` on failure; polling picks up the result regardless. This means two values are needed, not one: `CONVEX_CALLBACK_TOKEN` (secret) and `CONVEX_CALLBACK_URL` (variable, not sensitive — it's just the endpoint's URL).

**Steps:**
1. Generate a random token value, e.g.: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
2. In the `buildpilot-demo` org, **Settings → Secrets and variables → Actions** (same place as T0.10):
   - Add secret `CONVEX_CALLBACK_TOKEN` = the value generated above.
   - Add variable `CONVEX_CALLBACK_URL` = `https://<your-deployment>.convex.site/webhooks/github-workflow` — note the `.convex.site` domain for HTTP Actions, not `.convex.cloud` (the client API domain used for `VITE_CONVEX_URL` elsewhere).
3. Set the same token on the Convex deployment side, so the HTTP Action can verify incoming callbacks: `npx convex env set CONVEX_CALLBACK_TOKEN <value>` (or Convex dashboard → Settings → Environment Variables).
4. Confirm `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_PROJECT_ID` (from T0.10) are still present and correctly scoped.
5. Writing org-level Actions secrets/variables needs the `admin:org` scope — a plain `repo`/`workflow`-scoped token (e.g. what a coding agent's `gh` session typically has) can't do this via API/CLI and will 403; use the GitHub UI, or run `gh auth refresh -h github.com -s admin:org` first if you want to do it via `gh secret set --org buildpilot-demo` / `gh variable set --org buildpilot-demo`.

**Depends on:** T0.10 (own, Stage 0), T4.6 (own)

---

### T4.5b — Source, license-check, and push stock images for the customer site
💻 **Coding**
**Description:** Fills any imagery gap left by T4.2 (zero/insufficient business assets), now that a repo exists to push into (T4.4) — Section 12 media rules apply to these images too. Runs after repository validation (T4.5) and before the Devin build dispatch (T4.7).

**Paste to Coding Agent:**
```
Implement a Convex action sourceStockImages(projectId) in convex/assets.ts
that runs after validate-repository succeeds (your own T4.5) and before
dispatchDevinBuild (your own T4.7):
1. Check the assets table (populated by your own T4.2) for this project.
   If existing business assets already cover the site's imagery needs
   (e.g. a logo plus at least one hero/product image), skip straight to
   step 6.
2. Otherwise, derive 3-6 image search queries from the project's
   requirements/BUILD_SPEC.md (business type, tone, key sections/pages).
3. Start a short Devin AI session (same DEVIN_API_KEY / callExternal
   wrapper pattern as T4.7, stage = "STOCK_IMAGE_SOURCING") instructing it
   to find and download images that are explicitly copyright-free or
   openly licensed for commercial use (public domain, CC0, or a source
   whose license Devin confirms permits commercial use), one per query.
   For any image whose license requires attribution, Devin must capture
   the photographer/source name and a link back to the source alongside
   the file.
4. Run every downloaded image through the same validation as T4.2: verify
   MIME type from file bytes (not filename/extension), enforce size
   limits, sanitize filenames, and reject anything that isn't clearly a
   still image or whose license can't be confirmed.
5. Push accepted images into the repo created in T4.4 (e.g.
   public/assets/images/ or src/assets/images/) as a new commit on the
   default branch. If any image requires attribution, include/update a
   CREDITS.md (or similar) in that same commit listing each image's
   source and required credit line, and note that file's path/requirement
   in BUILD_SPEC.md so Devin's build (T4.7) surfaces it (e.g. in the site
   footer).
6. Record each accepted image in the assets table with its license type,
   source URL, and attribution text (empty if none required). Record the
   resulting commit SHA on the project — this supersedes the T4.4 initial
   commit SHA as the base commit T4.7 passes to Devin.
7. This stage can also complete with zero new images pushed (T4.2 assets
   were already sufficient, or no license-clean images were found) — not
   a hard blocker. Either way, schedule dispatchDevinBuild (your own
   T4.7) on completion.
```
**Depends on:** T4.2, T4.4, T4.5 (own)

---

### T4.7 — Implement Devin dispatch action
💻 **Coding**
**Description:** Phase 9 — Section 4.7, the core autonomous build step.

**Paste to Coding Agent:**
```
Implement a Convex action dispatchDevinBuild(projectId) in convex/devin.ts
that:
1. Calls the Devin API (key from DEVIN_API_KEY env var, request shape per
   the input format confirmed against the Devin portal — your own T0.8)
   via the callExternal wrapper (stage = "DEVIN_BUILD"), passing: repo URL,
   branch, BUILD_SPEC.md path (your own T4.1), base commit SHA (the commit
   recorded by your own T4.5b, which may include sourced stock images and
   a CREDITS.md), target branch, and a correlation ID for tracing.
2. Records the returned Devin session ID in buildJobs.
3. Transitions BUILD_QUEUED -> DEVIN_BUILDING.
4. Wraps the session in a bounded timeout (config value, e.g. from an env
   var DEVIN_SESSION_TIMEOUT_MS) — implement this as a scheduled Convex
   function that fires after the timeout and, if the session hasn't
   completed, transitions the project to MANUAL_INTERVENTION_REQUIRED with
   errorCode = "DEVIN_SESSION_TIMEOUT" rather than hanging indefinitely
   (Section 4.7 "Demo resilience").
This function's signature is published as a Shared Contract (Section 3,
row 7) — Person B's optional Stage 7 revision pipeline reuses it directly.
```
**Depends on:** T4.5b (own)

---

### T4.8 — Implement Devin completion detection + validate-candidate dispatch
💻 **Coding**
**Description:** Phase 9 continued — Section 5 build-completion rule.

**Paste to Coding Agent:**
```
Implement Convex logic (webhook HTTP Action if Devin supports callbacks,
otherwise a scheduled polling action) that:
1. Detects Devin's completed push to the target branch.
2. Verifies: the reported commit exists on the target branch, expected
   output files are present, and dispatches the validate-candidate
   workflow (your T4.6) on that commit.
3. On validate-candidate's result, verifies commit SHA and artifact
   checksum match expectations (Section 5 "Build completion detected" +
   "Repository validated" rules combined for the candidate commit).
4. On success, transition BUILD_VALIDATING -> BUILD_COMPLETED and schedule
   Firebase deployment (your T4.10).
5. On failure, transition to BUILD_VALIDATION_FAILED (Section 11: Retry
   Build -> resume from BUILD_QUEUED).
```
**Depends on:** T4.6, T4.7 (own)

---

### T4.10 — Implement Firebase deployment dispatch + live URL verification
💻 **Coding**
**Description:** Phase 10 — Section 5 live-URL rule.

**Paste to Coding Agent:**
```
Implement a Convex action deployToFirebase(projectId) in
convex/deployments.ts that:
1. Provisions or verifies a siteTenants record (siteId) for this project in
   the shared generated-site Convex deployment.
2. Injects the public siteId + shared-site Convex URL into the build config
   pushed to the customer repo (env file or build-time config, never a
   hardcoded secret — Section 4.10 "No customer-specific deploy keys or
   credentials in any repo").
3. Dispatches deploy-firebase (your T4.6) via the callExternal wrapper
   (stage = "FIREBASE_DEPLOY").
4. On the workflow's success signal, independently verifies the live URL:
   HTTP 200, <title> tag present, JS bundle loads without 4xx/5xx, Convex
   connection succeeds, no API secrets visible in the bundle (Section 5
   "Live URL validated" rule) — this check runs from Convex, not just
   trusted from the GitHub Actions report.
5. Stores firebaseProjectId, deploymentId, commitSha, liveUrl,
   artifactChecksum in deployments.
6. Transitions DEPLOYMENT_QUEUED -> DEPLOYING -> LIVE.
7. On failure, transition to DEPLOYMENT_FAILED (Section 11: Retry Deploy ->
   resume from DEPLOYMENT_QUEUED); on candidate failure the previous live
   deployment must remain untouched (Section 11).
8. On success, schedule your own sendDeliveryMessage (Stage 6, T5.1)
   automatically — you own both ends of this handoff, no coordination
   needed.
```
**Depends on:** T4.6, T4.8, T4.9 (own)

---

## 10. Stage 6 — WhatsApp Sandbox Delivery

**Executor: Person C.** Continues directly on top of your own Stage 5 deploy pipeline and your own Stage 0 Twilio account — no new credentials or contracts needed from anyone else.

### T5.1 — Implement WhatsApp send + delivery status callback
💻 **Coding**
**Description:** Phase 11 — Section 4.5.

**Paste to Coding Agent:**
```
Implement in convex/whatsapp.ts:
1. A Convex action sendDeliveryMessage(projectId) that sends a WhatsApp
   message via Twilio (Account SID/Auth Token from env vars, sandbox number
   from TWILIO_WHATSAPP_NUMBER) containing the liveUrl and revision
   instructions, via the callExternal wrapper (stage =
   "WHATSAPP_DELIVERY"). Enforce E.164 normalization and opt-out
   suppression before sending (Section 4.5 + Section 12). liveUrl comes
   from the deployments table your own T4.10 populates.
2. A Convex HTTP Action at /webhooks/twilio-status that receives Twilio's
   delivery status callback, validates the Twilio webhook signature,
   stores the event idempotently by Twilio message SID in whatsappMessages
   (dedup per Section 10), and updates delivery status.
3. Transition NOTIFICATION_PENDING -> DELIVERED on confirmed delivery; on
   send failure, transition to NOTIFICATION_FAILED.
This function's name/path is published as a Shared Contract (Section 3,
row 6) — Person B's optional Stage 7 revision pipeline calls it by name.
After deploying, note the webhook URL for T5.0 below.
```
**Depends on:** T4.10 (own, Stage 5)

---

### T5.0 — Point Twilio status callback at Convex + re-join sandbox
🌐 **Browser**
**Why:** Twilio needs to know where to send delivery status events; sandbox participation can expire and must be refreshed before demo day. You already have Twilio console access from your own T0.6.

**Steps:**
1. In the Twilio console, under the WhatsApp Sandbox settings, set the "Status callback URL" to the Convex HTTP Action URL from T5.1.
2. Confirm the demo participant phone (yours or the seeded business's) has an active sandbox session — re-send the join code from your own T0.6 if it's been more than 72 hours (sandbox sessions expire).
3. Send a test message through the sandbox to confirm the status callback fires (check the Convex dashboard **Logs** tab).

**Depends on:** T5.1 (own task), T0.6 (own, Stage 0)

---

## 11. Stage 7 — Customer Revision Loop (optional/stretch)

**Executor: Person B.** Build this whenever you like, in parallel with everything else, using the 🧪 fixture pattern below — but hold off *testing it end-to-end* against a real pipeline run until Stage 9 has proven the core pipeline once. This is the only stage where you reuse another person's (Person C's) functions directly, per the Shared Contracts (Section 3, rows 6–7).

### T6.1 — Implement inbound WhatsApp webhook + classification
💻 **Coding**

**Paste to Coding Agent:**
```
Implement a Convex HTTP Action at /webhooks/twilio-inbound that:
1. Validates the Twilio webhook signature.
2. Resolves sender phone -> lead -> project.
3. Stores the inbound message; if media is attached, downloads and
   validates it (MIME from bytes, size, provenance — same validation rules
   Person C used for asset collection in their T4.2, Stage 5, for
   consistency).
4. Classifies scope: "supported" (text correction, color, logo) vs
   "manual intervention" (new page/feature request) — a simple keyword/LLM
   classification step is fine for the hackathon; be conservative and
   default to manual intervention when unsure (Phase 12).
5. Creates a RevisionRequest linked to the original leadId + projectId,
   state REVISION_REQUESTED -> REVISION_ASSETS_RECEIVED.
```
🧪 **Fixture for fast local iteration:** seed a `revisionRequests` row
directly and test T6.2 below against it before wiring up a real inbound
message.

**Depends on:** Stage 1 shared contracts (Section 3, rows 1–4)

---

### T6.2 — Implement revision build/deploy/notify pipeline
💻 **Coding**

**Paste to Coding Agent:**
```
Implement the revision pipeline in convex/revisions.ts, reusing Person C's
Stage 5 building blocks rather than duplicating logic:
1. Acquire the stage lease/lock (convex/lib/stageAttempt.ts) before
   queuing, so a revision can't run concurrently with another build on the
   same project.
2. Dispatch a Devin subtask by calling Person C's dispatchDevinBuild
   (Section 3, row 7; their T4.7, Stage 5) linked to the original
   lead/project, targeting the existing repo and a new revision branch.
   State REVISION_QUEUED -> DEVIN_REVISING.
3. Reuse the validate-candidate workflow trigger (Section 3, row 7;
   Person C's T4.6/T4.8 pattern) on the revision commit. State ->
   REVISION_TESTING.
4. Reuse the deploy-firebase workflow trigger (Section 3, row 7; Person
   C's T4.10 pattern) for the revision, including the same independent
   live-URL verification, plus confirm the specific requested change is
   verifiable (color value changed / logo file replaced / copy updated —
   Section 5 "Revision validated" rule). State -> REVISION_DEPLOYING ->
   REVISION_LIVE.
5. Trigger the WhatsApp "Work done" notification by calling Person C's
   sendDeliveryMessage (Section 3, row 6; their T5.1, Stage 6) by name —
   don't reimplement WhatsApp sending here. State ->
   REVISION_NOTIFICATION_PENDING -> REVISION_COMPLETED.
6. On any step's failure, use the matching Section 11 failure/recovery
   states (REVISION_BUILD_FAILED, REVISION_DEPLOYMENT_FAILED,
   REVISION_NOTIFICATION_FAILED) and leave the previous live deployment
   untouched.
This reads the RevisionRequest your own T6.1 creates.
```
**Depends on:** T6.1 (own), Stage 1 shared contracts (Section 3, row 7); calls Person C's Stage 5/6 functions once they're deployed

---

## 12. Stage 8 — Admin Real-Time Tracking Dashboard

**Executor: Person A.** Continues directly on top of your own Stage 2 scaffold and Stage 3 UI work — can start as soon as Stage 1 is deployed, renders whatever project data exists (including stub/empty states), so it doesn't wait on Stages 4–7 either.

### T7.1 — Pipeline overview dashboard
💻 **Coding**
**Description:** The centerpiece of the hackathon demo — judges watch this screen while the pipeline runs. Fills in the `/dashboard` placeholder from Stage 2.

Design note: Convex queries (`useQuery`) are already push-based and reactive over a websocket — every write on the backend re-renders any subscribed component automatically. That *is* the "real-time, auto-refresh, no extra complexity" behavior the project needs — there is no manual polling loop to write.

**Paste to Coding Agent:**
```
Build the /dashboard screen (replacing the placeholder from Stage 2) that:
1. Uses useQuery to reactively list all active projects with their current
   workflowRun state, rendered as a pipeline/stepper visual matching the
   primary state sequence in Section 8 (PROJECT_CREATED through DELIVERED).
2. Highlights the currently-active stage per project and shows elapsed time
   in that stage.
3. Visually flags any project in a *_FAILED or MANUAL_INTERVENTION_REQUIRED
   state in a distinct color/badge.
4. No setInterval/polling code anywhere — rely entirely on Convex query
   reactivity for updates. This must feel instantaneous when a backend
   mutation fires during a live demo, regardless of which stage's code
   triggered it.
```
**Depends on:** T1.2 (Stage 1), TR.2 (own, Stage 2)

---

### T7.2 — Project detail: activity timeline / event log
💻 **Coding**

**Paste to Coding Agent:**
```
Build a per-project detail view that uses useQuery on activityEvents
(filtered by projectId, ordered by timestamp) to render a live-updating
timeline of every state transition and integrationEvent written since the
project was created — this is the "track every step the agent is
performing" view, and it will show activity from every stage's
integrations automatically since they all write through the shared state
machine helper. Each row shows: timestamp, stage, from-state -> to-state,
and provider (if an external call), correlationId for cross-referencing
with stageAttempts. Auto-scrolls to the newest event as it streams in via
the reactive subscription.
```
**Depends on:** T1.2 (Stage 1), T7.1 (own)

---

### T7.3 — Manual intervention & replay controls
💻 **Coding**

**Paste to Coding Agent:**
```
On the project detail view, when workflowRun.state ==
MANUAL_INTERVENTION_REQUIRED (or a specific *_FAILED state), render:
1. The failure reason (errorCode, provider, retryable) pulled reactively
   from the project record.
2. A stage-specific "Retry" button wired to the matching retry entry point
   from the Section 11 Failure Recovery table (Retry Call, Retry
   Extraction, Retry Repo Prep, Retry Build, Retry Deploy, Retry Revision)
   — these functions live across every stage's code, so the button just
   calls the mutation/action by name; confirm exact names as each stage
   lands.
3. A "Replay Last Response" button calling the replayLastResponse mutation
   from Stage 1's T1.4, visible per-stage wherever a cached
   last-successful-response exists for that project+stage.
Both actions are simple mutation calls from React — no orchestration logic
lives in the frontend (Section 4.1).
```
**Depends on:** T1.4 (Stage 1), T7.2 (own)

---

### T7.4 — Admin authentication (deferred)
💻 **Coding**

**Status: deferred for the hackathon build.** Admin mutations/queries deliberately do **not** enforce authentication right now — any user can access the backend/dashboard unauthenticated, so the team isn't blocked building/demoing the rest of the pipeline. Section 12's "All admin mutations/queries require server-side authentication + authorization" requirement is intentionally not met yet.

**Paste to Coding Agent (do this later, post-hackathon or once there's time):**
```
Implement server-side authentication + authorization for all admin
mutations/queries (Section 12 "All admin mutations/queries require
server-side authentication + authorization") — use Convex Auth (or a
Convex-supported auth provider) so no admin action can be invoked
unauthenticated, including from a raw API client. Gate every dashboard
route behind a logged-in check.
```
**Human step (only if using an external auth provider like Clerk/Auth0):** create the provider account/application in its portal and share the client ID/keys. Convex's built-in auth may need no separate portal at all — check before doing this step.
**Depends on:** T1.1 (Stage 1)

---

### T7.5 — Business detail view: one business, many projects
💻 **Coding**

**Status: implemented.** The schema already modeled `businesses -> leads -> projects` as one-to-many (`projects.businessId` carries no uniqueness constraint, and `projects.ts:selectBusiness` deliberately starts a brand-new Lead/Project/WorkflowRun on every call so the same business can be re-run any number of times) — this task surfaces that relationship in the Admin UI instead of only ever showing the single most-recent project.

**What changed:**
1. `convex/businesses.ts::getBusinessDetails` — new query: given a `businessId`, loads every lead for that business (`by_business_id` index) and resolves each one's project, returning the full project history (most-recent first) plus `latestProjectId`.
2. `admin/src/pages/BusinessPage.tsx` (new route `/businesses/:businessId`) — the business "home": shows the latest project's live pipeline (`PipelineStepper`), failure-recovery controls (`FailureRecoveryPanel`), and activity timeline (`LiveActivityFeed`), a "Call this business" action that starts another independent project for the same business at any time, and a "Project history" table (`ProjectTable`) listing every project ever started for it.
3. `admin/src/pages/SearchPage.tsx` — a business row now always opens `/businesses/:id` (rather than only being clickable once a project exists, and rather than jumping straight into a single project), since a business may have zero, one, or many prior projects.

**No data migration required:** the schema shape (`businesses` 1 : N `leads`/`projects`) was already correct; this was purely a query + UI gap, not a schema gap. Existing businesses/projects work with the new view without any backfill.
**Depends on:** T2.3, T2.4 (Stage 3), T7.1 (own Stage 8)

---

### T7.6 — Generic "resume from any step" recovery control
💻 **Coding**

**Status: implemented.** T7.3's Failure Recovery table only wires up one-click retries for five specific `*_FAILED` states (`CALL_FAILED`, `REQUIREMENTS_FAILED`, `GITHUB_FAILED`, `BUILD_VALIDATION_FAILED`, `DEPLOYMENT_FAILED`) plus `REVISION_BUILD_FAILED` — every other failure (`TRANSCRIPT_FAILED`, `DOCUMENT_GENERATION_FAILED`, `NOTIFICATION_FAILED`, `BUSINESS_SEARCH_FAILED`, `REVISION_DEPLOYMENT_FAILED`, `REVISION_NOTIFICATION_FAILED`, or a project simply parked in `MANUAL_INTERVENTION_REQUIRED`) had no admin recovery path at all, because `stateMachine.ts`'s `TRANSITIONS` graph is intentionally forward-only and doesn't define a resume edge out of those states.

**What changed:**
1. `stateMachine.ts::adminForceProjectState` — a new, explicitly admin-only escape hatch (never called by pipeline code) that force-writes `projects.state` + `workflowRuns.state` to an operator-chosen checkpoint, bypassing the `TRANSITIONS` adjacency check, clearing any stale failure metadata (`failedStage`, `errorCode`, `retryCount`, …) so the retried stage doesn't inherit the previous attempt's error, and always recording an audited `activityEvents` row (`eventType: "ADMIN_OVERRIDE"`) with the before/after state and operator-supplied reason.
2. `convex/adminRecovery.ts` (new) — `resumeProject(projectId, targetState)`: validates `targetState` against `RESUMABLE_CHECKPOINTS` (the 8 primary-pipeline entry points: `PROJECT_CREATED`, `CALL_QUEUED`, `REQUIREMENTS_PROCESSING`, `DOCUMENTS_GENERATING`, `REPOSITORY_PREPARING`, `BUILD_QUEUED`, `DEPLOYMENT_QUEUED`, `NOTIFICATION_PENDING`), force-transitions to it, then invokes that checkpoint's normal entry-point action (`voiceCalls:startCall`, `requirements:extractRequirements`, `documents:generateDocuments`, `github:prepareRepository`, `devin:dispatchDevinBuild`, `deployments:deployToFirebase`, `whatsapp:sendDeliveryMessage`) exactly as the automated pipeline itself would — no orchestration logic beyond that thin wrapper, matching Section 4.1 and the existing `retryActions.ts` pattern. Each stage's own `begin*` mutation guard (e.g. `voiceCalls.ts:queueCall`'s `if (project.state !== "CALL_QUEUED")`) already treats "already at the expected checkpoint" as a no-op, so forcing the state directly to the checkpoint is sufficient — no edge-by-edge state-machine changes were needed.
3. `admin/src/components/FailureRecoveryPanel.tsx` — now renders for **any** `*_FAILED`/`MANUAL_INTERVENTION_REQUIRED` project (not just the five with a dedicated button), and always shows a "Resume from step" dropdown + button wired to `resumeProject`, alongside the existing stage-specific retry button when one applies.
4. `admin/src/lib/resume.ts` (new) — frontend mirror of the 8 resumable checkpoints, following the existing `lib/pipeline.ts` / `lib/failureRecovery.ts` convention of duplicating backend constants so the Admin app stays independent of the Convex module graph.

**Applies to existing businesses/projects automatically, no migration:** the control reads/writes the same `projects`/`workflowRuns`/`activityEvents` rows every project already has; there is no new schema field and no backfill step. Any project created before this change — regardless of which state it's stuck in — can be resumed from any of the 8 checkpoints immediately.

**Scope note (not covered, follow-up if needed):** the revision loop (`REVISION_*`) only has its original `RECOVERY_ACTION_LABEL`/`Retry Revision` path for `REVISION_BUILD_FAILED`; a fully generic per-checkpoint resume for the revision loop (`REVISION_QUEUED`, `REVISION_DEPLOYING`, `REVISION_NOTIFICATION_PENDING`) was left out to keep this change's blast radius small — extend `RESUMABLE_CHECKPOINTS`/`RESUMABLE_TARGET_STATES` in `adminRecovery.ts` + `resume.ts` the same way if that's needed later.
**Depends on:** T1.2 (Stage 1), T7.3 (own Stage 8)

---

### T7.7 — Devin build: fix "Retry Build", hardened reconciliation, live progress, auto-merge

💻 **Coding**

**Status: implemented.** A production incident walked through the full lifecycle of `devin.ts`'s build/retry pipeline end-to-end and surfaced several real gaps, fixed incrementally:

**What changed:**
1. **`queueBuild`'s retry guard never actually fired.** It only transitioned `project.state -> BUILD_QUEUED` when coming from `REPOSITORY_READY` (the first-ever dispatch). Clicking "Retry Build" from `BUILD_VALIDATION_FAILED`/`MANUAL_INTERVENTION_REQUIRED` (or `REVISION_ASSETS_RECEIVED`-only for revisions) silently skipped the transition — a brand-new Devin session got dispatched behind the scenes, but `project.state`/`revisionRequest.status` never moved, so the Admin UI kept showing the stale failure forever. Fixed by widening the guard to the graph-exact set of valid predecessor states (`REPOSITORY_READY`, `BUILD_VALIDATION_FAILED`, `MANUAL_INTERVENTION_REQUIRED` for initial; `REVISION_ASSETS_RECEIVED`, `REVISION_BUILD_FAILED` for revisions) — deliberately not a blanket "state != target" check (unlike `voiceCalls.ts:queueCall`) since Devin builds can legitimately be mid-flight (`DEVIN_BUILDING`/`DEVIN_REVISING`) when this mutation replays, and those have no edge to `BUILD_QUEUED`/`REVISION_QUEUED`.
2. **`failBuildTimeout` never updated `revisionRequestId`'s own status.** Revision transitions leave the stable `project.state` untouched (by design, see `stateMachine.ts`), so a timed-out revision build left `revisionRequest.status` stuck at `REVISION_QUEUED`/`DEVIN_REVISING` with no valid edge back to `REVISION_QUEUED` for any future retry. Fixed by also transitioning the revision to `REVISION_BUILD_FAILED` there.
3. **`dispatchDevinBuild`'s idempotency cache silently replayed stale sessions.** Its Devin `POST /sessions` call was cached (`callExternal`/`lib/stageAttempt.ts`) by `${baseCommitSha}:${targetBranch}` — identical across every retry of the same commit/branch. Since the *original* session-creation call had already succeeded once, retrying just replayed that cached (now-dead/expired) `sessionId` with **no live HTTP call and no new logs** — looked like "Retry Build does nothing." Fixed by scoping the cache/idempotency key to the (always-fresh-per-retry) `buildJobId` instead.
4. **Resume-aware retry instead of rebuilding from scratch.** Devin's session can keep working (or simply go idle) after our own `checkBuildTimeout` gives up on it — a naive retry would dispatch a brand-new session and redo all of that work. `dispatchDevinBuild` now, before anything else: checks the target branch's real GitHub HEAD commit against a *failed* prior attempt's base commit; if there's more work already on the branch, checks that prior Devin session's live status (`GET /v1/sessions/{id}`) and — if not `expired` — sends it a follow-up message (`POST /v1/sessions/{id}/message`) asking it to verify/finish/push, reusing the same session (`resumeBuildAttempt`); only falls back to a brand-new session (still pointed at the existing branch/commit, not from scratch) if the old one truly can't be resumed (`markBuildContinued`).
5. **Live Devin session progress (the "what is Devin actually doing" ask).** Confirmed via Devin's API docs that `GET /v1/sessions/{id}` exposes `status_enum`, a `messages` array (session-level progress events), and `pull_request` — no need to guess from GitHub commits alone. `reconcileDevinStatus` now parses and records these every poll (`recordDevinProgress` -> new `buildProgressEvents` table, deduped by event ID) plus a lightweight GitHub branch-HEAD check as a secondary "new commit pushed" signal. New `buildJobs` fields: `statusEnum`, `pullRequestUrl`, `lastPolledAt`, `lastKnownCommitSha`, `resumedFromBuildJobId`/`resumedAt`, `mergedAt`/`mergeCommitSha`/`mergeError`. Admin UI: new `BuildProgressPanel` component + `admin.ts::getBuildProgress` reactive query (mirrors `projects.ts::projectActivity`'s pattern), rendered on the project detail page.
6. **Idle ("blocked"/"awaiting instructions") sessions were treated as still-building forever.** After a resume message, Devin frequently re-verifies, decides nothing needs to change, and goes idle (`status_enum: "blocked"`) instead of formally ending the session — since this pipeline never sends a further reply, that idle state was previously indistinguishable from "still working" and polled forever until `checkBuildTimeout` eventually re-failed it. `reconcileDevinStatus` now treats `blocked`/`suspend_requested*` as finished whenever there's already a commit on the branch. Commit-SHA extraction also now falls back to the branch HEAD (not just `structured_output.commit_sha`, which the plain-text build prompts never populate in practice).
7. **An uncaught GitHub 404 could silently strand a build forever.** The post-completion verification hard-asserted `package.json`/`src`/`BUILD_SPEC.md` existed at Devin's commit — Devin has full control of the working tree and, on a real build, dropped `BUILD_SPEC.md` (a root-level doc file, not part of the shippable site) from the final commit, 404ing that check. The error wasn't wrapped in `try/catch`, so the whole action died uncaught: no `failedRef` call, no further scheduled polls, build stuck in `"building"` indefinitely — which looked like a stale/non-reactive Admin UI but was actually a dead backend. Fixed by (a) wrapping the whole verification+dispatch block (and the equivalent block in `reconcileCandidateValidation`) in `try/catch` that routes any failure into `failedRef`, and (b) replacing the specific-filename checks with a generic "commit has *some* files" sanity check (non-empty root directory listing) that doesn't assume anything about how Devin organized the repo. Verified live end-to-end against an actual stuck production build.
8. **Added an auto-merge-to-main step.** Once `validate-candidate.yml` passes, `reconcileCandidateValidation` now merges the validated branch into the repository's default branch via GitHub's Merges API (`mergeToDefaultBranch`) — best-effort; a conflict is recorded on `buildJobs.mergeError` but never blocks deployment, which already deploys from the validated commit/artifact directly.
9. **`checkBuildTimeout` now does one last live reconciliation** before declaring a timeout, so a build that finishes right at the timeout boundary isn't discarded and rebuilt from scratch.
10. **`CANDIDATE_VALIDATION_TIMEOUT_MS` default raised** from 15 to 30 minutes (both this and `DEVIN_SESSION_TIMEOUT_MS` are configurable via Convex env vars without a code change).

**Also clarified (no code change needed, just confusing env var naming):** `FIREBASE_SITE_PREFIX` is intentionally a single *shared* prefix, not one value per business — `deployments.ts` already appends a per-project suffix itself. `GENERATED_SITE_CONVEX_URL` must point to the **second**, separate `buildpilot-sites` Convex deployment from T0.1 (its `.convex.cloud` client URL) — never this deployment's own URL, and never a `.convex.site` URL (that domain is only for this deployment's own `CONVEX_CALLBACK_URL` HTTP Action, which itself is a **GitHub Actions org variable**, not a Convex env var). See the expanded env var table in `README.md` and inline comments in `deployments.ts` added alongside this fix.

**No data migration required:** all new `buildJobs`/`buildProgressEvents` fields are optional/additive.
**Depends on:** T4.7, T4.8 (own Stage 5), T7.3 (own Stage 8)

---

### T7.8 — Firebase deployment: fix the identical class of retry bugs as T7.7

💻 **Coding**

**Status: implemented.** Following T7.7's Devin build directly into deployment (`convex/deployments.ts`) surfaced the same three bug patterns again, this time in `deployToFirebase`/`reconcileFirebaseDeployment` — an infinite `reconcileFirebaseDeployment` poll loop (every `FIREBASE_DEPLOY_POLL_INTERVAL_MS`, forever) was the visible symptom.

**What changed:**
1. **`reconcileFirebaseDeployment` polled the wrong commit SHA.** `deployToFirebase` pushes a `.env.production` config commit *before* dispatching `deploy-firebase.yml` by branch ref — so the dispatched run actually executes against that new commit, not `deployment.commitSha`. Polling GitHub Actions by the old `commitSha` could never match any real run. Fixed with a new `deployments.deployedCommitSha` field, set from the config-commit push's own response and used for all subsequent polling/filtering.
2. **The config-file PUT never fetched the file's current `sha`.** Any retry after the first successful deploy 422'd (`"sha" wasn't supplied"`) instead of updating the file — GitHub's contents API requires the existing blob `sha` to update a file that already exists. Fixed by fetching it first (a real upsert now, not create-only).
3. **Both GitHub write calls were cached by `commitSha`/`artifactChecksum` alone** (unchanged across retries), so a retry would have silently replayed the *first* attempt's stale responses via `callExternal`'s idempotency cache — same root cause as T7.7 item 3. Fixed with a fresh per-invocation `attemptToken` folded into both cache keys.

**No data migration required:** `deployments.deployedCommitSha` is optional/additive.
**Depends on:** T4.10 (own Stage 5), T7.7 (own, above)

---

### T7.9 — Ops/config gaps found deploying a real build end-to-end (GitHub secrets, repo visibility, Firebase Hosting sites)

🌐 **Browser** / 💻 **Coding**

**Status: resolved.** Continuing to chase T7.7/T7.8's fixes through an actual live deployment surfaced three environment/infrastructure gaps — not pipeline code bugs, but real blockers a fully-fixed pipeline now correctly *surfaces* instead of hanging on.

**What was found and fixed:**
1. **`FIREBASE_SERVICE_ACCOUNT` wasn't reaching generated repos.** The real `deploy-firebase.yml` run failed at `google-github-actions/auth` (`credentials_json` empty). Root cause: the buildpilot-demo org's `FIREBASE_SERVICE_ACCOUNT` secret is scoped to **"All public repositories"**, but every generated customer repo was created **private** (`github.ts::prepareRepository`), so it never matched. (Confirmed via the GitHub Actions run logs and jobs API — `GITHUB_TOKEN` doesn't have `admin:org` scope to list/inspect org secrets directly, matching the limitation already called out in T4.9.)
2. **Fix: made generated-repo visibility configurable.** Added `GITHUB_REPO_VISIBILITY` env var (`convex/github.ts`) — defaults to `private`; set to `public` (as done here) to create every generated repo as public instead, so an org secrets policy of "All public repositories" reaches them. The actual GitHub-returned `private` flag is now threaded through to `repositories.isPrivate` (`saveRepository` gained an `isPrivate` arg) instead of being hardcoded, in case an org policy forces a different outcome than requested.
3. **Fixing that surfaced a second, unrelated blocker:** once auth succeeded, `firebase deploy` itself failed with `could not find site "<site>" for project "<project>"`. Firebase Hosting sites are never auto-created by `firebase deploy` — nothing in the pipeline provisioned one for a newly-generated project. Added an "Ensure Firebase Hosting site exists" step to `deploy-firebase.yml` (checks `hosting:sites:list`, creates via `hosting:sites:create` only if missing) — pushed to `buildpilot-starter-template` (so every future generated repo gets it) and to both branches of the already-generated repo used for this investigation (so it took effect immediately without waiting for a fresh repo).

Verified live end-to-end after both fixes: build, deploy, and Convex's own independent live-URL verification (HTML/JS bundle, secret-leak scan, tenant-config check) all passed — `deployments.status` reached `"live"` with a real Firebase Hosting URL.
**Depends on:** T0.10, T4.9, T4.10 (Stage 0/5), T7.7, T7.8 (own, above)

---

### T7.10 — Ops/config gap: WhatsApp Sandbox `From` number and missing status callback

🌐 **Browser**

**Status: resolved.** Continuing the same end-to-end trace into WhatsApp delivery (T5.1) surfaced two more environment gaps — again, not code bugs.

**What was found and fixed:**
1. **Twilio error 63007** ("could not find a Channel with the specified From address") on every delivery attempt. `TWILIO_WHATSAPP_NUMBER` was set to the same value as `TWILIO_VOICE_NUMBER` (the purchased voice number) — but per T0.6, WhatsApp Sandbox messages must be sent `from` Twilio's fixed, shared Sandbox number `+14155238886`, never a regular purchased number. Corrected the env var; verified the retried send actually delivered (confirmed `status: delivered` directly via the Twilio Messages API).
2. **`TWILIO_STATUS_CALLBACK_URL` (T5.0) was never configured**, so `http.ts`'s `NOTIFICATION_PENDING -> DELIVERED` webhook transition could never fire even on a fully successful send. Set it to `<this-deployment>.convex.site/webhooks/twilio-status`.

**Depends on:** T0.6, T5.0, T5.1 (own Stage 6)

---

### T7.11 — WhatsApp delivery status: add the missing polling fallback (architecture gap)

💻 **Coding**

**Status: implemented.** T7.10 left one project's `project.state` stuck at `NOTIFICATION_PENDING` despite the WhatsApp message being genuinely delivered (confirmed independently via the Twilio Messages API), because that message was sent before `TWILIO_STATUS_CALLBACK_URL` existed. Root-causing that revealed a real architecture gap, not just a one-off missed env var: every *other* external dependency in this pipeline (GitHub Actions runs in `github.ts`/`devin.ts`, Devin sessions, Firebase deploys in `deployments.ts`) treats **polling as the source of truth** and its webhook as a best-effort accelerator only (the explicit design note from T4.5/T4.6/T4.8/T4.10 — "a missing/misconfigured callback... never blocks the pipeline; polling picks up the result regardless"). WhatsApp delivery (T5.1/T5.0) was the one exception: `NOTIFICATION_PENDING -> DELIVERED` only ever fired from `http.ts`'s Twilio status webhook, with **no polling fallback** — so any callback misconfiguration (wrong/unset URL, signature mismatch, Twilio-side delivery issue, org network policy, etc.) leaves a project stuck forever with no self-healing path, unlike every other stage.

**What changed (`convex/whatsapp.ts`):**
1. Added `reconcileWhatsAppDeliveryStatus` — a self-rescheduling poll (mirrors `reconcileFirebaseDeployment`/`reconcileCandidateValidation`'s pattern) that fetches the message's current status directly from Twilio's Message resource and feeds it through the **same** `http.ts:recordTwilioStatus` mutation the webhook already uses — so both paths share one finalization/dedup implementation and can never disagree about the outcome.
2. Added `checkWhatsAppDeliveryTimeout`, bounding that poll the same way every other reconciliation loop in this pipeline is bounded (`WHATSAPP_DELIVERY_TIMEOUT_MS`, default 15 minutes) — falls back to the existing `failDelivery` retryable-failure path.
3. `sendDeliveryMessage` now schedules both right after a successful send, alongside the existing webhook path (`WHATSAPP_DELIVERY_POLL_INTERVAL_MS`, default 15s) — both configurable via Convex env vars without a code change, matching every other poll interval/timeout in the pipeline.
4. New `whatsapp:loadWhatsAppMessageStatus` internal query backs both new actions' "already resolved?" checks.

**Verified against the actual stuck project:** ran `reconcileWhatsAppDeliveryStatus` directly — it correctly found the message `delivered` on Twilio's side and, via `recordTwilioStatus`, updated `whatsappMessages.status`, `notifications.status`/`deliveredAt`, and transitioned `project.state` all the way to `DELIVERED`. This closes T7.10's residual gap with a real fix rather than a one-off manual correction, and any future callback outage will now self-heal the same way.

**No data migration required:** no new schema fields; reuses `whatsappMessages`/`notifications`/`webhookEvents` as-is.
**Depends on:** T5.0, T5.1 (own Stage 6), T7.10 (own, above)

---

### T7.12 — Repository validation: drop the redundant GitHub Actions build-check + polling loop

💻 **Coding**

**Status: implemented.** The Admin UI's activity timeline showed `REPOSITORY_PREPARING -> REPOSITORY_READY` taking ~40 seconds. That stage (T4.4/T4.5/T4.6) dispatched a `workflow_dispatch` run of `validate-repository.yml` (`npm ci && npm run build`) against the freshly-seeded repo and polled GitHub Actions every 15s (`REPOSITORY_VALIDATION_POLL_INTERVAL_MS`, up to a 15-minute timeout) before advancing.

**Rationale for removal:** the repo is generated from a pinned starter-template commit (verified against `templateVersions.commitSha` before use — see `prepareRepository`'s existing pinned-commit check) and seeded with exactly one atomic commit (generated docs + validated assets, via the Git Data API) — there's no unverified code path here for a build-check to catch. The actual buildable output comes later from Devin's own commit, which downstream `validate-candidate.yml` (T4.6/T4.8) already re-validates with a real `npm run build` before deploy — this stage's own build-check was fully redundant with that one.

**What changed (`convex/github.ts::prepareRepository`):**
1. Removed the `workflow_dispatch` POST to `validate-repository.yml` after the seed commit's ref update.
2. Removed `reconcileRepositoryValidation` and `checkRepositoryValidationTimeout` (now-dead poll/timeout actions) and their `REPOSITORY_VALIDATION_POLL_INTERVAL_MS`/`REPOSITORY_VALIDATION_TIMEOUT_MS` env vars.
3. `prepareRepository` now calls `completeRepositoryValidation` (`REPOSITORY_PREPARING -> REPOSITORY_READY`) directly once the seed commit lands, then immediately schedules the Devin build dispatch (same watchdog as before).
4. `convex/http.ts`'s `GITHUB_WORKFLOW_RECONCILERS` webhook-callback map dropped its now-nonexistent `"validate-repository"` entry (`validate-candidate`/`deploy-firebase` unaffected).

`validate-repository.yml` itself is left as-is in the starter template repo (harmless — nothing dispatches it anymore); this is a pipeline-side removal only.

**No data migration required.**
**Depends on:** T4.4, T4.5, T4.6 (own Stage 5)

---

### T7.13 — Generated-site Convex backend: `submitInquiry` was never actually reachable (missing deployment + tenant provisioning), plus a `buildpilot-sites` cleanup

💻 **Coding**

**Status: implemented.** A live customer site's enquiry form failed in the browser console with `Could not find public function for 'siteSubmissions:submitInquiry'`. Traced to two compounding gaps — neither was a Devin/build-instructions problem; the generated site's own form wiring (`src/lib/convex.ts`, the onSubmit call) was already correct.

**What was found:**
1. `GENERATED_SITE_CONVEX_URL` (T0.1/T4.10's "second, separate Convex project," `buildpilot-sites`) had **never had any code deployed to it** — confirmed empty (zero tables) via `npx convex data`. `submitInquiry` couldn't exist there no matter what the customer repo's own `convex/` folder looked like.
2. Even once deployed, nothing in the pipeline ever provisioned a `siteTenants` row **in that project's own database** — T4.10 item 1 ("Provisions or verifies a siteTenants record... in the shared generated-site Convex deployment") had never actually been implemented; `deployToFirebase` only ever wrote its own control-plane copy of that row.

**What changed:**
1. New `siteTenants:provisionTenant` public mutation (guarded by a new `SITE_TENANT_PROVISION_TOKEN` shared secret, set on both deployments) — upserts a `siteTenants` row by `siteId`.
2. `deployments.ts::deployToFirebase` now calls it cross-deployment via `ConvexHttpClient` (targeting `GENERATED_SITE_CONVEX_URL`) before dispatching the Firebase deploy workflow — satisfies T4.10 item 1 for every future deploy, and is idempotent (safe to re-run on retries).
3. Manually backfilled and verified the one already-live, already-broken demo site end-to-end (replayed its exact failed form submission via `npx convex run`) — confirmed it now succeeds.

**Follow-up architecture cleanup (same investigation):** the fix above was first implemented by pushing this repo's *entire* `convex/` folder — the full control-plane schema (businesses, projects, workflowRuns, etc.) — to `buildpilot-sites`, since `submitInquiry`/`provisionTenant` lived alongside everything else in one shared codebase. That's not what T0.1 intended ("two Convex projects... one shared multi-tenant backend for generated customer sites") and cluttered the dashboard with ~30 unused control-plane tables. Split into a genuinely separate, minimal codebase:
4. New `sites-backend/` directory — its own `package.json`/`tsconfig.json`/`convex/` folder, deployed independently to `buildpilot-sites`. Schema trimmed to just `siteTenants` + `siteSubmissions`; only `submitInquiry` and `provisionTenant` live there.
5. Root `convex/schema.ts`: removed `siteSubmissions` (nothing in the control plane ever read/wrote it) and reverted `siteTenants.projectId` back to `v.id("projects")` (a real local reference again, now that the table isn't shared with a foreign project's ID space). Deleted `convex/siteSubmissions.ts`/`convex/siteTenants.ts` from the root project — `deployToFirebase`'s cross-deployment call only needs a function-path string (`makeFunctionReference`), not a local module.
6. `convex/admin.ts::getHealth` gained a "Generated Sites Backend" check (`GENERATED_SITE_CONVEX_URL` + `SITE_TENANT_PROVISION_TOKEN` both set), so this exact class of gap is visible in the Admin UI going forward instead of silently failing per-site.
7. `README.md`: documented `SITE_TENANT_PROVISION_TOKEN` and `sites-backend/`'s own install/deploy steps.

**Note:** removing a table from `schema.ts` and pushing doesn't delete it from Convex — it becomes unvalidated but stays listed (empty) until manually deleted via the dashboard (no CLI command exists for this). The ~30 leftover empty tables from the pre-split push are still visible in `buildpilot-sites`'s dashboard for that reason; functionally inert, cosmetic only.

**No data migration required:** the control-plane `siteTenants.projectId` field-type revert is compatible with existing rows (an `Id` value is a valid string). `sites-backend`'s schema is new/independent.
**Depends on:** T0.1, T4.10 (Stage 0/5), T7.8 (own, above — same `deployToFirebase`)

---

## 13. Stage 9 — Integration, Wiring & Merge

**Executor: All three, joint.** Once every stage owner has independently finished (or reached a good stopping point on) Stages 3–8.

This is the second and last joint session in the whole plan (the first was creating the Convex projects together at the very start). Consolidating stages under single owners already absorbed most of what used to be cross-person integration risk — the remaining real integration points are few, but budget time for this anyway; it's where the last surprises surface.

1. **Merge branches.** Merge all code into one deployment (`buildpilot-admin` for the control-plane functions, `buildpilot-admin-ui` for the React app, plus the repo/template work from Stage 5). Resolve any naming drift against the Section 3 contracts as you go.
2. **Confirm the real cross-person wiring, in pipeline order:**
   - `selectBusiness` (Person A's T2.3, Stage 3) actually schedules `startCall` (Person B's T3.1, Stage 4) via `ctx.scheduler` — place one real test call.
   - The rest of Stage 4 (webhook → transcript → extraction) is entirely Person B's own work end to end — confirm it runs cleanly against a real call, no fixture needed at this point.
   - The rest of Stage 5 (docs → repo → build → deploy) is entirely Person C's own work end to end — confirm it runs cleanly against Stage 4's real requirements output.
   - Stage 6 (WhatsApp delivery) is Person C's own continuation of Stage 5 — confirm it reads the real `liveUrl` Stage 5 produced.
   - If Stage 7 (revision loop) is in scope: confirm Person B's revision pipeline (T6.2) successfully calls Person C's real `dispatchDevinBuild`, `validate-candidate`, `deploy-firebase`, and `sendDeliveryMessage` functions (Section 3, rows 6–7) — this is the one stage with real cross-person calls to wire and test here.
   - Deploy the BuildPilot admin app itself (Person A's Stage 2/8 work) via `deploy-buildpilot.yml` (Person C's Stage 5, T4.6) — confirm the repo path/branch coordination from T4.6 resolved correctly.
3. **Run one full, unassisted, timed end-to-end pass** — city search → select → call → transcript → requirements → docs → repo → Devin build → deploy → WhatsApp delivery — with real data at every step. Note the total elapsed time for demo pacing.
4. Fix whatever the real run surfaces that isolated testing didn't catch (this is expected — it's why this stage exists), then re-run step 3 until it passes cleanly.

Only once this stage is clean should you move to Stage 10 (demo rehearsal) below.

---

## 14. Stage 10 — Demo Rehearsal & Pre-Flight Checklist

**Executor: All three, joint** (~1–2 hours before the demo slot).

Walk this list together, matching PRD Section 16 exactly:

1. Confirm `npx convex run businesses:searchBusinesses '{"city":"<city>","category":"<category>","maxResults":5}'` returns `mode: "live"` results from Context.dev (see T2.2's note — it uses `/web/search`, not a structured directory API, so results have no verified phone). Have the admin "call phone override" field (Stage 3's T2.4) ready with a number you control — that's what every call actually dials, per T2.3.
2. Confirm the override phone number is reachable and ready to receive the ElevenLabs/Twilio call.
3. Confirm the ElevenLabs agent + `ELEVENLABS_AGENT_PHONE_NUMBER_ID` + webhook URL/`ELEVENLABS_WEBHOOK_SECRET` (Stage 4's T3.0b) are correctly configured — place one full test call through the Admin UI, not just a curl against the API, so the webhook path is also exercised.
4. Confirm the Twilio voice number is active and the WhatsApp Sandbox participant has joined within the last 72 hours (Stage 6's T5.0).
5. Confirm the OpenAI key is loaded and under its spending cap.
6. Confirm Devin API access works and BUILD_SPEC.md/REQUIREMENTS.md generation (Stage 5's T4.1) matches what Devin's session actually expects.
7. Confirm the GitHub token/org and template repo are accessible from Convex.
8. Confirm the Firebase project and both Hosting sites/targets are provisioned and deploy successfully.
9. Confirm the shared generated-site Convex deployment (`buildpilot-sites`) is active and isolates by `siteId`.
10. Test the replay fallback (Stage 1's T1.4 / Stage 8's T7.3) for each integration listed in Section 9 — deliberately force one failure and confirm "Replay Last Response" recovers the flow live.
11. Confirm spending caps, timeout values, and retry limits are all set to sane values for a live demo (not defaults meant for production scale).
12. Admin authentication (Stage 8's T7.4) is deferred for this build — the dashboard/backend is intentionally open to any user for now, so there's nothing to confirm here yet. Revisit once T7.4 is implemented.
13. Run one full, unassisted, timed end-to-end pass — city search → select (with call phone override) → call → transcript → requirements → docs → repo → Devin build → deploy → WhatsApp delivery — and note the total elapsed time so the live demo pacing is known in advance.
14. **General lesson from the first live run:** whenever a task references a third-party API by name (Context.dev, ElevenLabs, Twilio, OpenAI, GitHub, Devin, Firebase), verify the actual current endpoint/request/response shape against that provider's live docs before wiring it up or re-running it against a new project — don't assume an endpoint exists just because it reads naturally (e.g. `/search`). A quick `npx convex run <module>:<action> '{...}'` smoke test against the real API, in addition to `getHealth`'s presence-only check, is cheap insurance against a stage silently 404ing or falling back to mock data.

---

## 15. Quick reference — task ID index

**By stage:**
- **Stage 0** (Person C): T0.1, T0.2, T0.3, T0.4, T0.5, T0.6, T0.7, T0.8, T0.9, T0.10
- **Stage 1** (Person B): T1.1, T1.2, T1.3, T1.4
- **Stage 2** (Person A): TR.1, TR.2
- **Stage 3** (Person A): T2.1, T2.2, T2.3, T2.4
- **Stage 4** (Person B): T3.1, T3.2, T3.0b, T3.3, T3.4
- **Stage 5** (Person C): T4.1, T4.2, T4.3, T4.4, T4.5, T4.6, T4.9, T4.5b, T4.7, T4.8, T4.10
- **Stage 6** (Person C): T5.1, T5.0
- **Stage 7 — optional** (Person B): T6.1, T6.2
- **Stage 8** (Person A): T7.1, T7.2, T7.3, T7.4, T7.5, T7.6, T7.7, T7.8, T7.9, T7.10, T7.11, T7.12, T7.13
- **Stage 9** (All three): Integration & merge
- **Stage 10** (All three): Demo rehearsal

**By person:**
- **Person A:** Stage 2 (TR.1 💻, TR.2 💻), Stage 3 (T2.1 🌐, T2.2 💻, T2.3 💻, T2.4 💻), Stage 8 (T7.1 💻, T7.2 💻, T7.3 💻, T7.4 💻, T7.5 💻, T7.6 💻, T7.7 💻, T7.8 💻, T7.9 🌐/💻, T7.10 🌐, T7.11 💻, T7.12 💻, T7.13 💻)
- **Person B:** Stage 1 (T1.1 💻, T1.2 💻, T1.3 💻, T1.4 💻), Stage 4 (T3.1 💻, T3.2 💻, T3.0b 🌐, T3.3 💻, T3.4 💻), Stage 7 — optional (T6.1 💻, T6.2 💻)
- **Person C:** Stage 0 (T0.1–T0.10, all 🌐), Stage 5 (T4.1 💻, T4.2 💻, T4.3 💻, T4.4 💻, T4.5 💻, T4.6 💻, T4.9 🌐, T4.5b 💻, T4.7 💻, T4.8 💻, T4.10 💻), Stage 6 (T5.1 💻, T5.0 🌐)
