# BuildPilot — Final Technical Requirements Document
# (Hackathon MVP)

---

## 1. Product Overview

BuildPilot is an AI-driven autonomous website acquisition and delivery platform.
Admin selects a business → full pipeline runs automatically → customer receives their live website via WhatsApp.

---

## 2. Architecture Principle

> UI sends intent. Convex owns state. UI observes state.

- All workflow transitions live in **Convex**
- **React** is a thin command + observe layer only
- All external service calls originate from **Convex**
- All external callbacks enter through **Convex HTTP Actions**
- Every external call wrapped behind a thin interface with **"replay last successful response"** fallback for demo resilience

---

## 3. Hackathon vs Production Actor Mapping

> Manager note: Keep the architecture, change the actors for the demo.
> Live business calling and production WhatsApp are the two demo-breakers. Devin now runs identically in both paths.

| Step | Production Path (v2) | Hackathon MVP Path |
|---|---|---|
| Business call | ElevenLabs + Twilio → real business | ElevenLabs + Twilio → **demo line (own phone / seeded test business)** |
| Code generation | **Devin autonomous agent** (same as production) | **Devin autonomous agent** — receives BUILD_SPEC + REQUIREMENTS from repo, implements site, runs lint/tests/build, pushes |
| WhatsApp delivery | Twilio Production Business API + approved templates | **Twilio WhatsApp Sandbox** (participants join via sandbox code) |

**Devin is the primary coding agent in both hackathon and production. Demo resilience for the autonomous build step relies on bounded session timeouts, the replay-fallback interface (Section 9), and manual-intervention fallback if a session doesn't complete before the demo cutoff.**

---

## 4. Tech Stack & Responsibilities

### 4.1 React Frontend (Firebase Hosted)
**Responsibility: Command + Observe only**
- Capture city / location / search criteria from admin
- Trigger Convex mutations (select business, retry stage)
- Subscribe to reactive Convex queries (live state, activity timeline)
- Render workflow status, pipeline progress, manual-intervention prompts with retry controls
- **Must NOT:** call ElevenLabs, OpenAI, GitHub, or Firebase directly
- **Must NOT:** own workflow state, decide next step, or orchestrate multi-step logic

### 4.2 Convex (Control-Plane Backend)
**Responsibility: Authoritative orchestrator and system of record**
- Own all database tables, workflow state, and business logic
- Run queries, mutations, actions, HTTP actions, scheduled jobs
- Trigger every external service call; receive every external webhook
- Enforce idempotency, stage lease locking, retry policy, audit events
- Each external call wrapped in thin interface layer with cached last-successful-response fallback
- Tables: `businesses`, `leads`, `projects`, `voiceSessions`, `transcripts`, `requirements`, `requirementVersions`, `buildJobs`, `deployments`, `notifications`, `activityEvents`, `integrationEvents`, `assets`, `revisionRequests`, `revisionAssets`, `whatsappMessages`, `workflowRuns`, `stageAttempts`, `webhookEvents`, `callAttempts`, `repositories`, `generatedDocuments`, `templateVersions`, `siteTenants`, `siteSubmissions`

### 4.3 Context.dev
**Responsibility: Business discovery data provider**
- Accepts: city, area, category, radius, max results
- Returns: business name, category, phone, address, website, location
- Convex normalizes response → stores in `businesses` table
- Convex enforces: E.164 phone normalization, contact eligibility, do-not-contact check, dedup by source + externalId
- **Hackathon:** seeded test business record used as primary demo target; real search shown as live feature

### 4.4 ElevenLabs
**Responsibility: AI voice agent for business discovery call**
- Convex initiates outbound conversation via ElevenLabs agent
- Agent uses Twilio as telephony transport (not direct calling)
- Agent collects: business purpose, services, target users, pages, branding, CTA, contact details
- On call end → ElevenLabs fires webhook → Convex HTTP Action receives it
- Convex validates signature, deduplicates by conversation ID, stores transcript
- **Hackathon:** calls demo line (own phone or seeded test business) — same tech stack, zero unpredictability, judges can watch/hear it live

### 4.5 Twilio
**Responsibility: Voice telephony + WhatsApp messaging**
- **Voice:** ElevenLabs uses Twilio to place outbound call
- **WhatsApp outbound:** Convex sends delivery URL and revision-complete messages
- **WhatsApp inbound:** Customer replies/media → Twilio webhook → Convex HTTP Action
- Convex validates all Twilio webhook signatures
- Convex stores all message events idempotently by Twilio message SID
- Enforces: E.164 normalization, opt-out suppression, calling window
- **Hackathon:** Twilio WhatsApp **Sandbox** used explicitly — participants join via sandbox join code before demo. Stated openly in demo narrative.

### 4.6 OpenAI
**Responsibility: Requirement extraction**
- Sends transcript + schema prompt → returns structured requirements JSON
- Convex validates schema, stores candidate requirement version with model/prompt/schema version
- Must NOT invent facts — unknown fields remain unknown
- On insufficient data → `REQUIREMENTS_INSUFFICIENT` → manual intervention
- Scope ends at requirements JSON — OpenAI does not generate or touch site code

### 4.7 Devin
**Responsibility: Primary autonomous coding agent — customer website developer (hackathon AND production)**
- Receives: repo URL, branch, BUILD_SPEC path, base commit, target branch, correlation ID
- Reads and implements from BUILD_SPEC.md + REQUIREMENTS.md
- Runs lint, tests, build; pushes to configured branch
- For revisions: applies scoped change as subtask linked to main lead/project
- **Used identically in hackathon and production** — no template-fill substitute; same session flow, same validation gates
- Demo resilience: session wrapped behind bounded timeout + the replay-fallback interface (Section 9); if a session doesn't complete before the demo cutoff, falls to `MANUAL_INTERVENTION_REQUIRED` with a pre-recorded replay available

### 4.8 GitHub
**Responsibility: Customer site repository host + CI/CD execution plane**
- Convex creates private repo per project via GitHub API
- Convex pushes: validated React starter template, Convex starter, Firebase config, generated docs, assets
- Convex dispatches 3 GitHub Actions workflows:
  - `validate-repository` — **concrete rule: `npm ci` + lint + test + build exits 0 on exact initial commit**
  - `validate-candidate` — **concrete rule: specific output files exist + production build succeeds + no secrets in bundle**
  - `deploy-firebase` — deploy to preview target, **concrete rule: HTTP 200 + `<title>` tag present on live URL**, promote to live
- GitHub Actions is **execution plane only** — Convex owns all state transitions
- Convex verifies: run ID, exact commit SHA, artifact checksum before advancing state

### 4.9 Firebase Hosting
**Responsibility: Static frontend hosting only**
- Hosts BuildPilot admin React app (one site/target)
- Hosts each generated customer React site (unique site/target per customer)
- All dynamic functionality served by Convex — Firebase hosts no backend logic
- GitHub Actions deploys to preview target first → Convex validates → promotes to live
- Rollback: previous known-good release retained if candidate fails

### 4.10 Shared Generated-Site Convex Backend
**Responsibility: Multi-tenant backend for all generated customer websites**
- One shared Convex deployment, isolated by `siteId` per customer
- Every query/mutation enforces server-side `siteId` isolation
- Stores: contact form submissions, tenant records, public website data
- Public operations require: schema validation, rate limiting, spam protection
- No customer-specific deploy keys or credentials in any repo

---

## 5. Validation Rules (Concrete — Pre-Defined)

> Manager note: "requirements validated / repository validated / build completion detected / live URL validated" each need one concrete rule — define before building.

| Checkpoint | Concrete Validation Rule |
|---|---|
| Requirements validated | Structured JSON matches defined schema; all required fields present (business name, at least 1 page, CTA defined); no placeholder/invented values |
| Repository validated | `npm ci` + `npm run lint` + `npm test` + `npm run build` all exit 0 on exact initial commit in clean CI environment |
| Build completion detected | Reported commit exists on target branch; expected output files present; production build artifact uploaded by GitHub Actions; artifact checksum matches |
| Live URL validated | HTTP 200 on live URL; `<title>` tag present in HTML; JS bundle loads without 4xx/5xx; Convex connection succeeds; no API secrets visible in bundle |
| Revision validated | Same as live URL validation + requested change verifiable (color value changed, logo file replaced, copy updated) |

---

## 6. End-to-End Flow with Responsibility Mapping

### PHASE 1 — Business Discovery
Admin (React)     → enters city + category
React             → calls Convex mutation: searchBusinesses()
Convex Action     → calls Context.dev API
Context.dev       → returns business list
Convex            → normalizes, deduplicates, enforces eligibility, stores in `businesses`
React             → subscribes to reactive query, renders results live
[Hackathon]       → seeded test business pre-loaded; real search shown as live feature

### PHASE 2 — Lead & Project Creation
Admin (React)     → selects eligible business
React             → calls Convex mutation: selectBusiness()
Convex            → validates eligibility + do-not-contact
Convex            → atomically creates: Lead + Project + WorkflowRun
Convex            → sets state: PROJECT_CREATED
Convex            → schedules call automatically (no admin action needed)

### PHASE 3 — Voice Discovery Call
Convex            → validates: E.164 number, eligibility, calling window, attempt policy
Convex Action     → calls ElevenLabs: startCall() with business context
ElevenLabs        → initiates AI conversation agent
Twilio            → places outbound voice call to target number
[Hackathon]       → target = demo line (own phone / seeded test number)
Convex            → sets state: CALL_QUEUED → CALLING
Convex            → stores: ElevenLabs conversation ID, Twilio call SID, voiceSession

### PHASE 4 — Call Completion & Transcript

ElevenLabs        → fires webhook on call end
Convex HTTP Action→ validates ElevenLabs signature
Convex            → deduplicates by conversation ID (idempotent)
Convex            → resolves conversation ID → project
Convex            → stores transcript in `transcripts`
Convex            → sets state: CALL_COMPLETED → TRANSCRIPT_RECEIVED
Convex            → schedules requirement extraction automatically


### PHASE 5 — Requirement Extraction & Validation

Convex Action     → sends transcript + schema prompt to OpenAI
OpenAI            → returns structured requirements JSON
Convex            → validates schema (concrete rule — see Section 5)
Convex            → stores in `requirements` + `requirementVersions` (model/prompt/schema version recorded)
Convex            → sets state: REQUIREMENTS_PROCESSING → REQUIREMENTS_READY → REQUIREMENTS_VALIDATED
Convex            → schedules document + code generation


### PHASE 6 — Document Generation

Convex Action     → generates: README.md, BUILD_SPEC.md, REQUIREMENTS.md, UI_GUIDELINES.md
Convex            → stores in `generatedDocuments`
Convex            → sets state: DOCUMENTS_GENERATING → DOCUMENTS_READY


### PHASE 7 — Asset Collection

Convex            → collects assets (discovery provider / WhatsApp media)
Convex            → validates: MIME type from bytes, size limits, provenance, sanitizes filenames
Convex            → stores binaries in Convex File Storage, metadata in `assets`
Convex            → rejects: executable content, oversized files, unknown provenance


### PHASE 8 — GitHub Repository Preparation

Convex Action     → creates private GitHub repo via GitHub API
Convex            → pushes: starter template (pinned version), Convex starter, Firebase config
Convex            → pushes: generated docs, business assets
Convex            → records: repo ID, branch, initial commit SHA, template version
Convex            → dispatches `validate-repository` GitHub Actions workflow
GitHub Actions    → runs: npm ci, lint, test, build on exact initial commit
GitHub Actions    → reports result + run ID back to Convex
Convex            → verifies commit + run result (concrete rule — see Section 5)
Convex            → sets state: REPOSITORY_PREPARING → REPOSITORY_READY


### PHASE 9 — Build Validation & Completion

Convex Action     → dispatches Devin session with repo URL, branch, BUILD_SPEC path, base commit, correlation ID
Convex            → sets state: BUILD_QUEUED → DEVIN_BUILDING
Devin             → reads BUILD_SPEC.md + REQUIREMENTS.md, implements site, runs lint/tests/build, pushes to target branch
Convex            → detects completed push via webhook/poll
Convex            → dispatches `validate-candidate` on target commit
GitHub Actions    → runs: tests, scans, production build, uploads artifact + evidence
Convex            → verifies: commit SHA, artifact checksum, scan results (concrete rule — see Section 5)
Convex            → sets state: BUILD_VALIDATING → BUILD_COMPLETED


### PHASE 10 — Firebase Deployment

Convex            → provisions/verifies SiteTenant record (siteId)
Convex            → injects public siteId + Convex URL into build config
Convex            → dispatches `deploy-firebase` GitHub Actions workflow
GitHub Actions    → deploys to Firebase preview/candidate target
GitHub Actions    → runs smoke test: HTTP 200 + title tag check (concrete rule — see Section 5)
GitHub Actions    → promotes to Firebase live target on success
Convex            → verifies live URL (concrete validation — see Section 5)
Convex            → stores: firebaseProjectId, deploymentId, commitSha, liveUrl, artifactChecksum
Convex            → sets state: DEPLOYMENT_QUEUED → DEPLOYING → LIVE


### PHASE 11 — Customer Delivery (WhatsApp)

Convex Action     → sends WhatsApp message via Twilio with liveUrl + revision instructions
[Hackathon]       → uses Twilio WhatsApp Sandbox; recipient joined via sandbox code pre-demo
Twilio            → delivers message
Twilio            → fires status callback → Convex HTTP Action
Convex            → stores: message SID, delivery status, recipient, project binding
Convex            → sets state: NOTIFICATION_PENDING → DELIVERED


### PHASE 12 — Customer Revision Loop _(attempt only if Phases 1–11 solid)_

Customer          → replies on WhatsApp (text correction or logo image)
Twilio            → fires inbound webhook → Convex HTTP Action
Convex            → validates signature, resolves sender → lead → project
Convex            → stores message + downloads media (validates MIME, size, provenance)
Convex            → classifies scope: supported (text, color, logo) vs manual intervention (new page/feature)
Convex            → creates RevisionRequest linked to original leadId + projectId
Convex            → acquires build lock, queues revision
Convex Action     → dispatches Devin subtask linked to original lead/project on existing repo
Devin             → applies scoped change, pushes to revision branch
Convex            → dispatches `validate-candidate` on revision commit
GitHub Actions    → validates revision build
Convex            → dispatches `deploy-firebase` for revision
GitHub Actions    → deploys to preview, smoke tests, promotes to live
Convex            → validates updated live URL (concrete rule — see Section 5)
Convex Action     → sends WhatsApp: "Work done — check your website: {{liveUrl}}"
Convex            → sets revisionRequest.status: REVISION_COMPLETED


---

## 7. Hackathon Build Order (Spine-First)

> Manager note: build spine-first so you always have a demoable path even if later stages aren't done.

| Priority | Stage | Risk |
|---|---|---|
| 1 | Convex schema + state machine (Lead/Project/WorkflowRun) | Foundation — everything plugs into this |
| 2 | Search → select → create Lead/Project | Fast, low-risk, demoable immediately |
| 3 | Demo-line call → ElevenLabs + Twilio → transcript → OpenAI structured requirements | Most novel segment — protect it |
| 4 | Devin autonomous build → GitHub repo → Firebase deploy | Core delivery — Devin session |
| 5 | WhatsApp Sandbox notification | Delivery confirmation |
| 6 | Revision loop | Attempt only if 1–5 are solid |

**Do not move to stage 6 until stages 1–5 are verified end-to-end.**

---

## 8. Workflow State Machine

### Primary Project States

PROJECT_CREATED → CALL_QUEUED → CALLING → CALL_COMPLETED → TRANSCRIPT_RECEIVED
→ REQUIREMENTS_PROCESSING → REQUIREMENTS_READY → REQUIREMENTS_VALIDATING → REQUIREMENTS_VALIDATED
→ DOCUMENTS_GENERATING → DOCUMENTS_READY → REPOSITORY_PREPARING → REPOSITORY_READY
→ BUILD_QUEUED → DEVIN_BUILDING → BUILD_VALIDATING → BUILD_COMPLETED
→ DEPLOYMENT_QUEUED → DEPLOYING → LIVE → NOTIFICATION_PENDING → DELIVERED


> Note: `DEVIN_BUILDING` is active in both hackathon and production — Devin's own lint/test/build run happens here; `validate-candidate` (BUILD_VALIDATING) is the independent GitHub Actions re-verification of Devin's push.

### Revision States (per RevisionRequest)

REVISION_REQUESTED → REVISION_ASSETS_RECEIVED → REVISION_QUEUED
→ DEVIN_REVISING → REVISION_TESTING → REVISION_DEPLOYING
→ REVISION_LIVE → REVISION_NOTIFICATION_PENDING → REVISION_COMPLETED


### Failure States
BUSINESS_SEARCH_FAILED | CALL_FAILED | TRANSCRIPT_FAILED | REQUIREMENTS_FAILED
DOCUMENT_GENERATION_FAILED | GITHUB_FAILED | BUILD_VALIDATION_FAILED
DEPLOYMENT_FAILED | NOTIFICATION_FAILED | REVISION_BUILD_FAILED
REVISION_DEPLOYMENT_FAILED | REVISION_NOTIFICATION_FAILED

Each failure stores: `failedStage`, `errorCode`, `retryable`, `retryCount`, `maxRetries`, `correlationId`, `provider`, `providerRequestId`

---

## 9. Demo Resilience — Replay Fallback

> Manager note: wrap each external call behind a thin interface with "replay last successful response" fallback.

Every external integration in Convex must implement:
- **Live mode:** call real provider, store response
- **Replay mode:** return last stored successful response for that stage + project
- Admin UI must expose a **"Replay Last Response"** button per stage when in `MANUAL_INTERVENTION_REQUIRED`
- Fallback does not skip state transitions — Convex still processes the replayed response through the same pipeline

Applies to: Context.dev search, ElevenLabs call result, OpenAI extraction, Devin build result, GitHub Actions result, Firebase deploy result, Twilio delivery status.

---

## 10. Idempotency & Durability Rules

- Every external call → create `stageAttempt` first with deterministic idempotency key (`projectId:stage:version`)
- Every inbound webhook → store in `webhookEvents` by provider event ID before processing
- Lease/lock with expiry per stage — no concurrent execution of same stage
- Reconcile timed-out provider requests before creating new resource
- Retry only retryable errors with bounded exponential backoff + jitter
- Exhausted/non-retryable → `MANUAL_INTERVENTION_REQUIRED` with auditable reason

---

## 11. Failure Recovery

| Failed Stage | Admin Action | Resume From |
|---|---|---|
| CALL_FAILED | Retry Call | CALL_QUEUED |
| REQUIREMENTS_FAILED | Retry Extraction | REQUIREMENTS_PROCESSING |
| GITHUB_FAILED | Retry Repo Prep | REPOSITORY_PREPARING |
| BUILD_VALIDATION_FAILED | Retry Build | BUILD_QUEUED |
| DEPLOYMENT_FAILED | Retry Deploy | DEPLOYMENT_QUEUED |
| REVISION_BUILD_FAILED | Retry Revision | REVISION_QUEUED |

- Auto-retry first (bounded backoff); admin retry only after auto exhausted
- Completed stages never re-run
- Failed revision → previous live deployment stays untouched
- Manual intervention queue for: ambiguous replies, non-retryable failures, exhausted workflows

---

## 12. Security Rules

- All admin mutations/queries require server-side authentication + authorization
- All webhook signatures validated (ElevenLabs, Twilio, GitHub)
- No API secrets in browser, repos, or generated bundles
- All credentials in Convex environment variables only
- Customer text, transcripts, media = untrusted input — cannot override system rules
- Filenames sanitized, MIME verified from bytes, size/dimension limits enforced
- Rate limits on: search, call initiation, webhook processing, revision intake, retries
- Contact eligibility, calling window, opt-out enforced before every call or message
- Tenant isolation enforced server-side on every generated-site operation

---

## 13. Deployment Topology

BuildPilot React Admin       → Firebase Hosting (buildpilot site/target)
BuildPilot Orchestration     → Convex (control-plane deployment)

Customer React Site          → Firebase Hosting (unique site/target per customer)
Customer Site Backend        → Shared Generated-site Convex deployment (isolated by siteId)


---

## 14. Starter Template Responsibility

- Maintained as a **versioned immutable template** in a dedicated source repo
- Convex stores active template version + commit SHA
- Per project: Convex selects version → copies to customer repo → injects customer config/docs/assets
- Template includes: React + TypeScript + Vite + Convex + routing + Firebase config + linting + tests + lockfile + error boundary + health check target
- Devin customizes on top of template per BUILD_SPEC.md + REQUIREMENTS.md — no boilerplate regeneration — identically in hackathon and production

---

## 15. GitHub Actions — Workflow Files

| Workflow | Trigger | Runs | Owned By |
|---|---|---|---|
| `validate-repository` | Convex dispatch | npm ci, lint, test, build on initial commit | GitHub (execution) |
| `validate-candidate` | Convex dispatch | tests, scans, build, artifact upload on target commit | GitHub (execution) |
| `deploy-firebase` | Convex dispatch | deploy to preview, HTTP 200 + title check, promote to live | GitHub (execution) |
| `deploy-buildpilot` | CI push | deploy BuildPilot admin frontend to Firebase | GitHub |

All workflows: least-privilege permissions, pinned action versions, bounded timeouts, protected live environment, secrets server-side only.

---

## 16. Demo Setup Checklist (Pre-configured Before Demo)

- [ ] One seeded test business in `businesses` table (name, phone = demo line, category, address)
- [ ] Demo phone line ready to receive ElevenLabs + Twilio call
- [ ] ElevenLabs agent configured + webhook URL pointed to Convex HTTP Action
- [ ] Twilio voice number active, WhatsApp Sandbox active, participant joined via sandbox code
- [ ] OpenAI key configured in Convex environment
- [ ] Devin API access configured; BUILD_SPEC.md / REQUIREMENTS.md generation validated against Devin's expected input format
- [ ] GitHub token + org configured, template repo accessible
- [ ] Firebase project configured, Hosting sites/targets provisioned
- [ ] Shared generated-site Convex deployment active
- [ ] Replay fallback tested for: ElevenLabs result, OpenAI extraction, Devin build result, GitHub Actions result, Firebase deploy
- [ ] Spending caps, timeout values, retry limits set
- [ ] Admin authentication working on deployed BuildPilot URL

---

## 17. Out of Scope (MVP)

Billing, subscription management, RBAC, multi-org tenancy, advanced CRM, analytics, custom domain purchase, full CMS, customer portal, mobile app, complex CI/CD, enterprise monitoring, automated pricing, multi-language voice, complex change-request approval, production WhatsApp Business API approval.

