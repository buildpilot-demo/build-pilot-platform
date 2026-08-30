BuildPilot — Product Requirements & E2E Devin Development Plan

1. Product Name

BuildPilot

2. Product Vision

BuildPilot is an AI-driven autonomous website acquisition and delivery platform.

Instead of waiting for a customer to request a website, BuildPilot proactively discovers nearby businesses and lets an admin select one. That selection creates the lead and project and starts a fully automated Convex workflow: an ElevenLabs agent calls through Twilio, OpenAI produces structured requirements, Convex prepares a ready-to-code GitHub repository from a maintained starter template, Devin builds the website, Firebase Hosting publishes it, and Twilio WhatsApp delivers the verified URL. Customers can then reply in WhatsApp with a correction or logo, which Convex turns into a linked Devin revision subtask and automatically redeploys.

Convex is the central backend and orchestration layer.

The React frontend must remain intentionally thin.

The frontend may only:

- initiate user commands,
- render live data from Convex,
- collect temporary form input,
- retry a failed workflow stage when manual intervention is required.

The frontend must never own workflow state or orchestration logic.

⸻

3. Core Product Principle

UI sends intent. Convex owns state. UI observes state.

All business workflow transitions must be owned by Convex.

The UI must not determine:

- what the next workflow step is,
- whether an external integration succeeded,
- whether Devin completed,
- whether deployment completed,
- whether a retry is required.

⸻

4. Main End-to-End Product Flow

Admin Opens the Firebase-hosted BuildPilot Frontend
↓
Select City / Location
↓
Search Businesses using Context.dev
↓
Display Business Results
↓
Admin Selects Business
↓
Create Lead + Project in Convex
↓
AUTOMATION STARTS
↓
Convex Triggers ElevenLabs Call
↓
ElevenLabs Voice Agent Calls the Business through Twilio
↓
Call Completes
↓
ElevenLabs Webhook → Convex
↓
Transcript Stored
↓
Convex Triggers OpenAI
↓
Structured Website Requirements Generated
↓
Requirements Automatically Validated
↓
Convex Generates Development Docs
↓
Convex Creates GitHub Repository
↓
Push React Starter Project
↓
Push Convex Starter Backend
↓
Push Firebase Hosting Configuration
↓
Push Requirement Documents
↓
Push Business Images / Assets
↓
Validate Initial Repository
↓
Trigger Devin Automatically
↓
Devin Develops Website
↓
Devin Runs Tests
↓
Devin Pushes Completed Code
↓
Convex Detects Build Completion
↓
Deploy Frontend to Firebase Hosting
↓
Validate Live URL
↓
Store Deployment Details in Convex
↓
Send Final URL through Twilio WhatsApp
↓
Initial Workflow Complete
↓
Customer Can Reply on WhatsApp with Corrections or a Logo
↓
Twilio WhatsApp Webhook → Convex
↓
Convex Creates a Revision Request and Devin Subtask for the Main Lead
↓
Devin Applies Changes, Tests, Pushes, and Redeploys
↓
Convex Validates the Updated Live Website
↓
Twilio WhatsApp Sends “Work done — check your website”
↓
Revision Workflow Complete

⸻

5. Product Scope

5.1 In Scope

The hackathon MVP must support:

- Admin dashboard
- BuildPilot React frontend deployed to Firebase Hosting
- BuildPilot orchestration backend deployed to Convex
- Business discovery
- Location-based business search
- Context.dev integration
- Business selection
- Lead and project creation
- Automatic AI voice call initiation after business selection
- ElevenLabs voice agent using Twilio for telephony
- ElevenLabs webhook handling
- Transcript storage
- OpenAI requirement extraction
- Automatic requirement validation
- Development document generation
- GitHub repository creation
- React starter project
- Convex starter backend
- Customer React frontend deployed to Firebase Hosting
- Customer website backend provided by Convex
- Business/reference asset upload
- Devin integration
- Build progress tracking
- Firebase Hosting deployment
- Deployment URL tracking
- Real-time workflow timeline
- Failure handling
- Manual retry
- Customer delivery notification through Twilio WhatsApp
- Customer correction requests through WhatsApp
- Logo/image intake through WhatsApp
- Devin revision subtasks linked to the main lead/project
- Automatic revision deployment and completion notification

⸻

6. Out of Scope for MVP

Do not spend primary hackathon development time on:

- Billing
- Subscription management
- Advanced RBAC
- Multi-organization tenancy
- Complex CRM
- Advanced analytics
- Custom domain purchase
- Full CMS
- Advanced customer portal
- Mobile application
- Complex CI/CD
- Enterprise monitoring
- Automated pricing
- Production-scale lead qualification
- Multi-language voice optimization
- Multi-round or complex change-request approval workflows

⸻

7. Technical Stack

Frontend

React
TypeScript
Vite
Convex React SDK

Optional UI libraries:

Tailwind CSS
shadcn/ui
Lucide Icons

Backend

Convex

Convex will provide:

- database,
- queries,
- mutations,
- actions,
- HTTP actions,
- scheduled operations,
- orchestration,
- real-time subscriptions,
- activity events,
- workflow status.

External Services

Context.dev
Business Discovery
ElevenLabs
Voice Agent Orchestration
Twilio
Voice Telephony and WhatsApp Messaging
OpenAI
Requirement Extraction
Technical Document Generation
GitHub
Repository Management
GitHub Actions
Isolated Validation, Build, and Firebase Deployment Runner
Devin
Autonomous Development
Firebase Hosting
BuildPilot Admin Frontend and Generated Customer Frontend Hosting
Convex
BuildPilot Orchestration Backend and Shared Multi-tenant Customer Website Backend
Twilio WhatsApp
Customer Delivery and Revision Messages

7.1 Deployment Topology

BuildPilot and the generated customer websites use the same frontend/backend platform split:

```text
BuildPilot React Admin Frontend → Firebase Hosting
BuildPilot Control-plane Backend → Convex

Generated Customer React Frontend → Firebase Hosting
Generated Customer Website Backend → Convex
```

For the hackathon MVP:

- deploy the BuildPilot admin application to its own Firebase Hosting site/target,
- deploy the BuildPilot orchestration schema, functions, workflows, and webhooks to its own Convex deployment,
- deploy every customer React website to its own Firebase Hosting site/target,
- connect customer websites to the shared multi-tenant generated-site Convex deployment using a unique `siteId`,
- keep the BuildPilot control-plane data/functions logically separate from public customer-site functions, even if both Convex deployments belong to the same Convex team,
- store the BuildPilot admin URL, BuildPilot Convex URL, customer Firebase URL, customer Convex URL, and backend version explicitly in configuration/Convex records.

⸻

8. Architecture Rules

8.1 Frontend MUST NOT

The React frontend must never:

- call ElevenLabs directly,
- call OpenAI directly,
- call GitHub directly,
- call Devin directly,
- deploy to Firebase directly,
- manage workflow state,
- decide the next workflow stage,
- mark external tasks complete,
- persist business workflow status locally,
- orchestrate multiple backend calls.

  8.2 Frontend MAY

The frontend may:

- capture city/location,
- capture search criteria,
- trigger Convex mutations,
- select discovered businesses,
- retry failed stages,
- subscribe to reactive Convex queries,
- display status,
- display activity timelines,
- maintain temporary presentation state.

⸻

9. Convex Responsibilities

Convex is the authoritative backend.

Convex must own:

- project state,
- business records,
- lead records,
- workflow state,
- call state,
- transcript state,
- requirement state,
- repository state,
- generated-site tenant and backend-version state,
- build state,
- deployment state,
- notification state,
- revision request and subtask state,
- audit history,
- retry history.

⸻

10. Recommended Convex Tables

businesses
leads
projects
voiceSessions
transcripts
requirements
requirementVersions
buildJobs
deployments
notifications
activityEvents
integrationEvents
assets
revisionRequests
revisionAssets
whatsappMessages
workflowRuns
stageAttempts
webhookEvents
callAttempts
repositories
generatedDocuments
templateVersions
siteTenants
siteSubmissions

Required uniqueness/index rules include:

- business source + external ID,
- one active project per selected lead,
- workflow run by project/revision and type,
- stage attempt by idempotency key,
- webhook event by provider + provider event ID,
- voice/call attempt by ElevenLabs conversation ID and Twilio call SID,
- WhatsApp message by Twilio message SID,
- repository by GitHub repository ID,
- deployment by Firebase site ID + release/deployment ID,
- revision queue by project + received time,
- site tenant by site ID and project ID.

Store provider IDs as opaque strings. Normalize phone numbers separately and never use a mutable business name, URL, or phone number as the sole foreign key.

⸻

11. Workflow State Model

Business discovery records use their own eligibility/discovery status; `BUSINESS_DISCOVERED` is not a project state because no project exists yet.

Lead selection is recorded as an activity/lead event. The primary project workflow begins after the lead and project are created atomically and runs once per project:

PROJECT_CREATED
CALL_QUEUED
CALLING
DISCOVERY_IN_PROGRESS
CALL_COMPLETED
TRANSCRIPT_RECEIVED
REQUIREMENTS_PROCESSING
REQUIREMENTS_READY
REQUIREMENTS_VALIDATING
REQUIREMENTS_VALIDATED
DOCUMENTS_GENERATING
DOCUMENTS_READY
REPOSITORY_PREPARING
REPOSITORY_READY
BUILD_QUEUED
DEVIN_BUILDING
DEVIN_TESTING
BUILD_VALIDATING
BUILD_COMPLETED
DEPLOYMENT_QUEUED
DEPLOYING
LIVE
NOTIFICATION_PENDING
DELIVERED

`DELIVERED` is the stable primary project state. A delivered project must remain live while any correction is processed.

Each correction uses a separate `revisionRequests.status` state machine so revisions can repeat without overwriting the primary project state:

REVISION_REQUESTED
REVISION_ASSETS_RECEIVED
REVISION_QUEUED
DEVIN_REVISING
REVISION_TESTING
REVISION_DEPLOYING
REVISION_LIVE
REVISION_NOTIFICATION_PENDING
REVISION_COMPLETED

Cross-cutting terminal/control states may include `MANUAL_INTERVENTION_REQUIRED` and `CANCELLED`. Cancellation must stop future scheduled work but preserve all completed records and the last known-good live deployment.

Only one revision may modify or deploy a project at a time. Later requests must be queued in receipt order or explicitly merged before Devin starts. Every revision stores its own base commit, working branch, resulting commit, build job, deployment attempt, and notification result.

⸻

12. Failure States

BUSINESS_SEARCH_FAILED
CALL_FAILED
TRANSCRIPT_FAILED
REQUIREMENTS_FAILED
DOCUMENT_GENERATION_FAILED
GITHUB_FAILED
DEVIN_FAILED
TESTING_FAILED
BUILD_VALIDATION_FAILED
DEPLOYMENT_FAILED
NOTIFICATION_FAILED
REVISION_INTAKE_FAILED
REVISION_BUILD_FAILED
REVISION_DEPLOYMENT_FAILED
REVISION_NOTIFICATION_FAILED

Each failure must include:

failedStage
errorCode
errorMessage
retryable
retryCount
maxRetries
lastAttemptAt
nextRetryAt
provider
providerRequestId
correlationId

Failures belong to a `workflowRun`, `stageAttempt`, or `revisionRequest`; they must not erase the last stable project state. Preserve the raw provider response in restricted integration logs after removing secrets and sensitive headers.

12.1 Durable Orchestration, Idempotency, and Concurrency

Convex must treat every external operation as an at-least-once operation that may time out after succeeding.

Required rules:

- Create a `workflowRun` for the initial build and one for every revision.
- Create a durable `stageAttempt` before calling an external provider.
- Use deterministic idempotency keys such as `projectId:stage:version` and `revisionId:stage:attempt`.
- Store every inbound webhook in `webhookEvents` using the provider event/message ID as a unique key before processing it.
- Validate state preconditions in the same Convex transaction that claims a stage.
- Use a lease/lock with an expiry for long-running stages so two schedulers cannot run the same stage concurrently.
- Persist the provider request/session ID before scheduling the next stage.
- Retry only retryable errors with bounded exponential backoff and jitter.
- Reconcile timed-out requests with the provider before creating another external resource.
- Move exhausted or non-retryable attempts to manual intervention with an auditable reason.
- Redact API keys, authorization headers, full webhook signatures, and unnecessary customer data from logs.

12.2 Minimum Security, Privacy, and Contact Policy

Even for the MVP:

- Require authenticated admin access; advanced RBAC may remain out of scope.
- Authorize every admin query, mutation, action, and retry on the server.
- Encrypt secrets in provider/Convex environment configuration and never store them in project repositories.
- Validate signatures for ElevenLabs, Twilio, Devin, GitHub, and deployment callbacks where supported.
- Apply rate limits to search, call initiation, webhook processing, revision intake, and retries.
- Keep configurable retention periods for recordings, transcripts, WhatsApp messages, and uploaded assets.
- Record the contact source, permitted contact basis/consent where required, do-not-contact status, local calling hours, and opt-out events before initiating voice or WhatsApp contact.
- Stop all automated contact immediately for opted-out or blocked numbers.
- Treat transcripts, customer messages, documents, and media as untrusted input; they must never be allowed to reveal secrets or override system/development safety rules.

12.3 Operational Limits and Observability

Define these values in configuration rather than provider code:

- maximum calls and call duration per lead,
- allowed calling hours and timezone,
- maximum automatic retries per stage,
- maximum workflow and Devin runtime,
- maximum revision messages/assets and upload size,
- maximum concurrent builds/deployments,
- per-project and daily spending limits,
- transcript, recording, message, asset, and integration-log retention.

Every external call must emit structured activity/attempt data with `projectId`, `workflowRunId`, `stage`, `correlationId`, provider, latency, outcome, and sanitized error. The admin dashboard must surface stalled workflows, expired leases, exhausted retries, webhook failures, cost/usage threshold warnings, and delivery failures. Provide an emergency stop/cancel command owned by Convex.

12.4 Execution Plane

Convex owns decisions and state transitions, but commands that require a filesystem, package installation, production build, browser tests, secret scanning, or Firebase CLI must run in an isolated execution environment.

For the MVP, use minimal GitHub Actions workflows committed with the template:

- `validate-repository`: check out the exact commit and run install, lint, tests, build, and scans before Devin starts.
- `validate-candidate`: validate the exact Devin completion commit and upload immutable build/test evidence.
- `deploy-firebase`: deploy the recorded artifact to a preview/candidate target, run smoke tests, and promote only after success.

Convex dispatches each workflow through GitHub, stores the run ID and target commit, consumes authenticated GitHub events or reconciles status through scheduled checks, verifies the returned commit/artifact checksum, and only then advances workflow state. GitHub Actions is an execution plane, not the workflow authority. Workflow files must use least-privilege permissions, pinned action versions, protected environments for live deployment, bounded timeouts, and server-side secrets.

⸻

13. Repository Preparation Strategy

Before Devin starts development, Convex should prepare a ready-to-run development repository.

Recommended repository:

customer-site/
├── README.md
│
├── .github/
│ └── workflows/
│   ├── validate-repository.yml
│   ├── validate-candidate.yml
│   └── deploy-firebase.yml
│
├── docs/
│ ├── BUILD_SPEC.md
│ ├── REQUIREMENTS.md
│ └── UI_GUIDELINES.md
│
├── public/
│ └── images/
│ ├── logo.png
│ ├── hero.jpg
│ └── business-image-01.jpg
│
├── src/
│ ├── components/
│ ├── pages/
│ ├── layouts/
│ ├── hooks/
│ ├── config/
│ ├── App.tsx
│ └── main.tsx
│
├── convex/
│ ├── schema.ts
│ ├── contact.ts
│ └── business.ts
│
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
├── firebase.json
└── .gitignore

The repository should already run successfully before Devin starts.

Expected validation commands:

npm ci
npm run lint
npm test
npm run build

Commit the package-manager lockfile. A development-server smoke test must use a bounded health check; automation must not wait indefinitely on `npm run dev`.
The CI test script must run once and exit; it must not enter watch mode.

13.1 Generated Website Backend Model

For the hackathon MVP, generated sites use a shared, pre-deployed, multi-tenant Convex backend rather than trying to create a new Convex deployment for every lead.

- Convex maintains and deploys the generic generated-site schema and functions separately from customer repositories.
- Each customer project receives a unique `siteId`/tenant record and the pinned public Convex deployment URL/backend version.
- Every generated-site query and mutation enforces `siteId` isolation server-side; a client-supplied ID alone must never authorize cross-site reads or writes.
- Public operations such as contact-form submission require schema validation, rate limiting, spam protection, and no privileged client secret.
- Contact submissions are stored in `siteSubmissions` with tenant ownership, minimal customer data, consent/notice metadata, retention status, and an activity/audit reference.
- Admin reads of generated-site submissions require authentication and tenant/project authorization.
- The customer repository contains the typed client contract and compatible starter backend source for development/reference, but no deployment credentials.
- Devin may configure and use approved generic functions; customer-specific backend changes are out of MVP scope unless they are added safely to the shared backend and deployed before the customer site.
- A future production mode may provision isolated Convex deployments per customer, but it requires an explicit provisioning, secret rotation, migration, and teardown design.

⸻

14. Development Template Strategy

Do not generate boilerplate repeatedly using AI.

Convex must maintain a validated, reusable, pre-generated React starter project as a versioned template. The template should live in a dedicated source repository or versioned template bundle, and Convex should store the active template version and commit SHA in configuration.

The template source is immutable per version. Publishing a new active version requires its own lint, test, build, dependency-security, and deployment smoke checks. Existing customer repositories remain pinned to their recorded version unless an explicit migration is created.

For every new project, Convex must:

- select the active template version,
- create the customer GitHub repository,
- copy or push the pre-generated React + TypeScript + Vite project,
- include the pre-generated Convex backend and Firebase Hosting configuration,
- inject only customer-specific configuration, generated documents, and assets,
- record the template version and initial commit SHA on the project,
- install locked dependencies and validate lint, tests, and production build before Devin starts,
- upgrade the shared template independently instead of regenerating boilerplate for each lead.

BASE TEMPLATE

- GENERATED REQUIREMENTS
- CUSTOMER DATA
- # CUSTOMER ASSETS
  INITIAL DEVIN REPOSITORY

The starter template should already include:

- React
- TypeScript
- Vite
- Convex
- routing
- reusable components
- environment configuration
- Firebase Hosting config
- sample contact functionality
- basic testing setup
- linting
- build scripts,
- a committed lockfile,
- an error boundary and not-found route,
- baseline accessibility and metadata checks,
- a health/smoke-test target,
- documented environment-variable schema,
- the shared generated-site backend client contract and tenant-safe data helpers.

⸻

15. Devin Responsibility

Devin should focus only on customer-specific development.

Devin must:

- read docs/BUILD_SPEC.md,
- understand automatically validated requirements,
- use provided assets,
- customize existing starter project,
- implement pages,
- configure and use the approved shared Convex functions,
- maintain responsive design,
- run tests,
- run build,
- fix errors,
- push final code to GitHub,
- complete linked revision subtasks against the existing repository when requested.

Devin should not be responsible for:

- discovering businesses,
- talking to customers,
- preparing raw requirements,
- creating workflow state,
- validating or approving requirements manually.

⸻

16. Devin Base Instruction

Use a task similar to:

Build the customer website using the validated requirements defined in:
docs/BUILD_SPEC.md
docs/REQUIREMENTS.md
The repository already contains a working React + TypeScript + Convex starter project.
Use the existing project structure.
Requirements:

- Implement all validated pages and functionality.
- Use provided business assets.
- Keep the application responsive.
- Use only the approved shared Convex functions for dynamic backend functionality.
- Keep frontend business logic minimal.
- Firebase Hosting will host the frontend.
- Run linting, tests, and production build.
- Fix all blocking issues before completion.
- Do not alter validated business scope.
- Push completed code to the configured branch.

⸻

17. Development Phases

Phase 0 — Repository & Development Foundation

Goal

Create the BuildPilot platform repository and establish the base architecture.

Tasks

- Create root project.
- Create React frontend.
- Add TypeScript.
- Configure Vite.
- Configure the BuildPilot Convex control-plane deployment.
- Configure the BuildPilot Firebase Hosting site/target.
- Add environment setup.
- Add linting.
- Add formatting.
- Add test framework.
- Add common folder structure.
- Add integration abstraction folder.
- Add workflow folder.
- Add authenticated admin access.
- Add environment validation and secret-management documentation.
- Add minimal GitHub Actions validation and deployment workflows.
- Add a `deploy-buildpilot` workflow for the admin frontend.

Recommended structure:

buildpilot/
├── .github/
│ └── workflows/
│   └── deploy-buildpilot.yml
├── frontend/
├── convex/
│ ├── integrations/
│ ├── workflows/
│ └── http.ts
├── docs/
├── firebase.json
├── .firebaserc
└── README.md

Validation

Run:

npm install
npm run dev
npm run build

Verify:

- React starts.
- Convex connects.
- Production frontend build succeeds.
- BuildPilot Firebase target is configured.
- Deployed BuildPilot URL loads and connects to the BuildPilot Convex deployment.
- Basic query works.
- Basic mutation works.
- No hard-coded credentials.
- Unauthenticated admin mutations and queries are rejected.

Phase Exit Criteria

- Frontend is running.
- BuildPilot frontend is deployed or deployable to Firebase Hosting.
- BuildPilot Convex backend is deployed and reachable.
- Environment configuration is documented.
- Test command executes successfully.

⸻

Phase 1 — Convex Core Schema & Workflow Foundation

Goal

Create the authoritative backend state model.

Tasks

Create schemas for:

- businesses
- leads
- projects
- voiceSessions
- transcripts
- requirements
- requirementVersions
- buildJobs
- deployments
- activityEvents
- integrationEvents
- assets
- notifications
- revisionRequests
- revisionAssets
- whatsappMessages
- workflowRuns
- stageAttempts
- webhookEvents
- callAttempts
- repositories
- generatedDocuments
- templateVersions
- siteTenants
- siteSubmissions

Implement project state machine.

Implement helper methods for:

transitionProjectState()
createActivityEvent()
markStageFailed()
retryStage()
claimStageLease()
completeStageAttempt()
recordWebhookOnce()

Important Rule

No React state must be used as authoritative workflow state.

Testing

Test:

- project creation,
- state transitions,
- invalid transitions,
- activity event creation,
- failure tracking,
- retry count.
- duplicate scheduling and expired stage leases,
- separate initial-build and revision workflow runs.

Phase Exit Criteria

- State machine works.
- Invalid state transitions are rejected.
- Activity events are created.
- UI can subscribe to project state.

⸻

Phase 2 — Admin UI Shell

Goal

Build the thin admin command and monitoring UI.

Pages

Dashboard
Business Discovery
Project Details
Requirements Details
Activity Timeline

UI Capabilities

Dashboard:

- discovered businesses,
- active calls,
- active builds,
- live sites,
- failed workflows.
- stalled workflows and operational-limit warnings.

Project page:

- current status,
- workflow timeline,
- business details,
- call details,
- requirements,
- repository URL,
- build status,
- deployment URL.
- current revision queue and revision history,
- manual-intervention reason and safe retry controls.
- cancel/emergency-stop control.

UI Rule

The frontend must derive all workflow status from Convex.

Testing

Verify:

- dashboard reacts to Convex changes,
- no manual refresh required,
- no integration credentials exist in browser,
- no workflow chaining exists in React.
- unauthenticated access is rejected.

⸻

Phase 3 — Context.dev Business Discovery

Goal

Enable real business discovery.

Backend Flow

React
↓
Convex Action
↓
Context.dev
↓
Normalize Response
↓
Convex Database
↓
Reactive Query
↓
React

Tasks

Create:

convex/integrations/contextDev.ts

Functions:

searchBusinesses()
normalizeBusiness()

Search inputs:

- city,
- area,
- category,
- radius,
- max results.

Persist

Store:

externalId
name
category
phone
address
website
location
source
phoneE164
contactEligibility
contactEligibilityReason
doNotContact

Testing

Test:

- valid search,
- empty results,
- provider error,
- duplicate business,
- missing phone number.
- invalid/non-callable phone number,
- duplicate source records for the same business,
- do-not-contact or ineligible contact.

Phase Exit Criteria

- Admin searches city/category.
- Businesses appear live.
- Admin can select an eligible business; ineligible results remain visible with a reason but cannot start automation.

⸻

Phase 4 — Lead Selection & Project Creation

Goal

Convert a discovered business into an active BuildPilot project.

Flow

Business Selected
↓
Validate Contact Eligibility
↓
Create Lead
↓
Create Project
↓
PROJECT_CREATED
↓
Queue Voice Call Automatically

Tasks

Create:

selectBusiness()
createLead()
createProject()
startProjectAutomation()

Testing

Verify:

- one project per selected lead,
- project receives correct business info,
- activity event created,
- duplicate accidental selection handled safely,
- successful project creation automatically schedules the call exactly once.
- lead creation, project creation, workflow-run creation, and call scheduling are committed atomically or safely reconciled.

⸻

Phase 5 — ElevenLabs Voice Discovery

Goal

Initiate and track the business discovery call.

Flow

Project Created
↓
CALL_QUEUED
↓
Convex Action
↓
ElevenLabs Voice Agent
↓
Twilio Voice
↓
CALLING

Tasks

Create:

convex/integrations/elevenLabs.ts

Implement:

startCall()

ElevenLabs owns the conversational agent behavior and uses Twilio as the telephony transport for the outbound voice call. Convex initiates and tracks the ElevenLabs conversation; the admin does not start the call manually.

Configuration must include the ElevenLabs agent identifier, Twilio-enabled outbound number, allowed destination regions, and webhook secrets. Credentials must remain in Convex environment variables.

Before calling, verify the normalized E.164 number, contact eligibility, do-not-contact status, configured local calling window, and maximum-attempt policy.

Pass:

- business name,
- phone number,
- business category,
- location,
- call context.

Voice Agent Goal

Collect:

- business purpose,
- products/services,
- target users,
- website goals,
- pages,
- colors,
- branding,
- CTA,
- contact details,
- special requirements.

Call Outcomes

Track at minimum:

- answered and completed,
- busy,
- no answer,
- voicemail,
- rejected,
- invalid/unreachable number,
- provider error,
- customer opt-out,
- incomplete discovery.

Busy/no-answer outcomes may schedule a bounded retry inside the allowed calling window. Invalid numbers, explicit rejection, opt-out, and exhausted attempts require no further automatic calls. An incomplete discovery must not silently produce invented requirements.

Testing

Test:

- successful call initiation,
- invalid number,
- provider rejection,
- timeout,
- duplicate call request.
- retry limit and calling-window enforcement,
- opt-out suppression,
- unanswered and incomplete calls.

⸻

Phase 6 — ElevenLabs Webhook & Transcript Processing

Goal

Receive completed call events without frontend involvement.

Route

/webhooks/elevenlabs

Flow

ElevenLabs
↓
Convex HTTP Action
↓
Validate Event
↓
Check Idempotency
↓
Resolve Provider Conversation and Twilio Call IDs to Project
↓
Store Transcript
↓
Update Voice Session
↓
CALL_COMPLETED
↓
Schedule Requirements Workflow

Testing

Test:

- valid webhook,
- invalid signature,
- duplicate webhook,
- missing transcript,
- malformed payload.
- unknown conversation/call correlation,
- out-of-order completion and transcript events,
- recording/transcript retention policy.

Phase Exit Criteria

- Transcript appears automatically after call.
- UI is not involved in continuation.

⸻

Phase 7 — OpenAI Requirement Extraction

Goal

Convert conversation into structured development requirements.

Flow

Transcript
↓
Convex Action
↓
OpenAI
↓
Structured JSON
↓
Parse and Store Candidate Requirement Version
↓
Requirement Version
↓
REQUIREMENTS_READY

Requirement Output

Include:

- business details,
- site goal,
- pages,
- features,
- branding,
- contact,
- CTA,
- content,
- technical requirements.

Extraction Rules

- Preserve explicit unknowns instead of inventing customer facts, claims, contact data, services, prices, or branding.
- Store prompt/model/schema versions with every requirement version.
- Treat transcript content as untrusted data, not instructions to the orchestration system.
- If required information cannot be safely defaulted, fail with `REQUIREMENTS_INSUFFICIENT` for manual intervention rather than continuing.
- Apply content and policy checks before generating public website copy.

Testing

Test:

- normal transcript,
- incomplete transcript,
- malformed AI response,
- required field validation,
- retry behavior.
- prompt-injection content inside a transcript,
- insufficient information and unsupported claims.

⸻

Phase 8 — Automatic Requirements Validation

Goal

Validate extracted requirements and continue the workflow without a human approval checkpoint.

Automatic validation proves that the requirement package is structurally complete and safe enough to build; it does not prove that inferred business facts are correct. Unknown facts must remain unknown or use clearly non-factual placeholder copy. The delivered WhatsApp revision loop is the customer correction path for the MVP.

Validation

- enforce the structured requirements schema,
- verify required business, page, branding, CTA, and contact fields,
- normalize safe defaults for optional or missing fields,
- reject contradictions or unusable output,
- retry extraction automatically when validation fails,
- mark the stage failed for manual intervention only after retry policy is exhausted.

Flow

REQUIREMENTS_READY
↓
Validate Structured Requirements
↓
REQUIREMENTS_VALIDATED
↓
Schedule Document Workflow

Testing

Verify:

- only schema-valid requirements continue,
- validation results and retries are audited,
- active requirement version is stored.

⸻

Phase 9 — Development Document Generation

Goal

Generate Devin-ready documentation.

Required Docs

README.md
docs/BUILD_SPEC.md
docs/REQUIREMENTS.md
docs/UI_GUIDELINES.md

BUILD_SPEC Must Include

- product overview,
- business context,
- target audience,
- pages,
- page-level behavior,
- features,
- visual requirements,
- provided assets,
- frontend requirements,
- Convex requirements,
- Firebase requirements,
- acceptance criteria,
- testing requirements.

Testing

Validate:

- required sections exist,
- no placeholder content,
- correct business data included,
- validated requirement version used.

⸻

Phase 10 — Asset Collection & Preparation

Goal

Prepare business and design assets for the repository.

Possible Assets

logo
hero image
business images
gallery images
design references

Possible sources are the selected discovery record/provider response, explicitly licensed stock assets, or later customer-supplied WhatsApp media. Do not scrape or republish assets from an existing website unless the source and reuse permission are recorded.

Storage

Store binary files in Convex File Storage.

Metadata in Convex:

projectId
storageId
fileName
mimeType
size
purpose
source
checksum

Asset Rules

Production assets:

public/images/

Reference-only assets:

docs/references/

Only use assets that are customer-supplied, provider-supplied with permitted reuse, or otherwise licensed for the generated site. Record provenance and usage permission. Sanitize filenames, verify MIME type from bytes, enforce file-size/dimension limits, reject executable/vector content that cannot be safely sanitized, and never expose private Convex storage URLs directly.

Testing

Verify:

- original bytes preserved,
- file exists,
- checksum is stored,
- unsupported types rejected,
- missing image does not block MVP,
- unlicensed or unknown-provenance images are not published,
- malicious, oversized, or MIME-spoofed uploads are rejected.

⸻

Phase 11 — GitHub Repository Preparation

Goal

Create a runnable customer development workspace.

Flow

REQUIREMENTS_VALIDATED
↓
Create GitHub Repo
↓
Push Starter Project
↓
Push Convex Starter
↓
Push Firebase Config
↓
Push Requirement Docs
↓
Push Assets
↓
Create Initial Commit
↓
Convex Dispatches `validate-repository` GitHub Action
↓
Verify Action Run, Commit, and Evidence
↓
REPOSITORY_READY

Important

Do not push:

node_modules
dist
secret files
.env

Repository Rules

- Use a private repository by default unless an explicit public-repository policy says otherwise.
- Grant Devin only the repository permissions required for the build.
- Pin the default branch and base commit used by each build job.
- Use a dedicated build/revision branch and merge only a validated result.
- Do not place Convex deploy keys, Firebase service credentials, Twilio credentials, or provider tokens in GitHub content.
- Persist GitHub repository ID, installation/account ID, branch, commit SHA, and provider request IDs instead of relying only on names or URLs.

Store in Convex

repositoryUrl
repositoryName
branch
initialCommitSha
templateVersion
requirementVersion

Testing

The GitHub Actions runner checks out the exact initial commit in a clean environment.

Run:

npm ci
npm run lint
npm test
npm run build

All must succeed before triggering Devin.

⸻

Phase 12 — Devin Build Integration

Goal

Trigger autonomous customer website development.

Flow

REPOSITORY_READY
↓
Create Build Job
↓
Trigger Devin
↓
BUILD_QUEUED
↓
DEVIN_BUILDING

Pass to Devin

- repository,
- branch,
- BUILD_SPEC path,
- testing requirements,
- completion expectations,
- immutable base commit and target branch,
- project/revision correlation ID,
- allowed scope and forbidden secret/configuration changes.

Store

devinSessionId
status
startedAt
repositoryCommit

Testing

Test:

- Devin starts,
- invalid repo,
- provider failure,
- duplicate start request,
- session ID persisted,
- least-privilege repository access,
- unexpected changes outside the allowed scope.

⸻

Phase 13 — Devin Monitoring & Completion

Goal

Track build without frontend orchestration.

Use:

- Devin webhook when available,
- scheduled status checks when callback is unavailable.

States

DEVIN_BUILDING
DEVIN_TESTING
BUILD_VALIDATING
BUILD_COMPLETED
DEVIN_FAILED

Completion Flow

Devin Reports Completion
↓
Convex Resolves the Reported Commit
↓
Convex Dispatches `validate-candidate` for that Exact Commit
↓
GitHub Actions Returns Test, Build, Scan, and Artifact Evidence
↓
Convex Verifies Evidence and Commit
↓
BUILD_COMPLETED

Completion Validation

Before marking complete:

- expected branch exists,
- new commit exists,
- package files exist,
- production build succeeds,
- changed files stay within allowed scope,
- dependency and secret scans pass,
- the reported completion commit matches the fetched repository commit.

Never trust provider status alone. Convex must verify the repository commit and validation evidence before transitioning to `BUILD_COMPLETED`.

Testing

Test:

- running session,
- completed session,
- failed session,
- timeout,
- retry.

⸻

Phase 14 — Deployment to Firebase Hosting

Goal

Deploy the generated frontend.

Flow

BUILD_COMPLETED
↓
DEPLOYMENT_QUEUED
↓
Provision or Verify Generated-site Tenant
↓
Inject Public Site ID and Convex Deployment URL at Build Time
↓
Resolve Verified Immutable Artifact for the Recorded Commit
↓
Convex Dispatches `deploy-firebase` GitHub Action
↓
Deploy to Firebase Preview / Candidate Target
↓
Run Live Validation
↓
Promote Validated Candidate to Firebase Live
↓
Verify URL
↓
LIVE

Firebase Role

Firebase hosts both categories of frontend:

- the BuildPilot React admin/control interface,
- each generated customer React website.

Convex hosts both categories of backend:

- the BuildPilot control-plane/orchestration backend,
- the shared tenant-isolated generated customer website backend.

Firebase remains frontend hosting only; it does not own workflow or customer-site backend state.

Do not use Firestore.

Generated dynamic website functionality must use Convex.

Deployment Safety

- Choose and document one Firebase ownership model. For the MVP, use one controlled Firebase project with a unique Hosting site/target per customer.
- Store the stable Hosting site ID separately from the generated live URL.
- Never deploy directly over the known-good live release. Validate a preview/candidate release first, then promote it.
- Pin every deployment to an immutable Git commit and build artifact checksum.
- If validation or promotion fails, retain or restore the previous known-good release and do not send a completion message.
- Expose only public build-time values such as the Convex URL and `siteId`; service-account credentials remain server-side.
- Apply per-project quotas and cleanup policies for preview releases and abandoned projects.

Validation

After deployment:

- URL returns HTTP success,
- main page loads,
- JS bundle loads,
- Convex connection succeeds,
- critical UI section is visible.
- generated-site Convex tenant isolation succeeds,
- contact-form smoke request succeeds without exposing another site's data,
- no secrets appear in the generated JS bundle,
- revision validation confirms the requested change.

Store

firebaseProjectId
deploymentId
commitSha
liveUrl
deployedAt
artifactChecksum
previousDeploymentId
validationResult

⸻

Phase 15 — Customer Delivery

Goal

Send the completed website URL to the customer through Twilio WhatsApp.

Flow

LIVE
↓
Send Twilio WhatsApp Message
↓
Store Delivery Result
↓
DELIVERED

Example message:

Hello,
Your new website is ready.
Website:
{{liveUrl}}
Please review it and let us know if you need any updates.

You can reply here with a correction, such as a color change, or attach your logo.

Testing

Verify:

- URL is correct,
- only successful deployment triggers delivery,
- duplicate delivery prevented,
- Twilio message SID and delivery status persisted.

Implementation

- Add a server-side Twilio integration under `convex/integrations/`.
- Send from an approved Twilio WhatsApp sender to the business WhatsApp-capable number.
- Use an approved outbound template whenever required; do not assume a free-form message is permitted outside an active customer-service conversation window.
- Route inbound messages and status callbacks to Convex HTTP Actions.
- Validate Twilio webhook signatures before processing any message or media.
- Store outbound, delivered, read, failed, and inbound message events idempotently.
- Normalize recipient numbers to E.164 and bind the delivery message SID, sender, recipient, lead, project, and deployment so replies can be resolved safely.
- If the number is not WhatsApp-capable, opted out, or delivery permanently fails, mark `NOTIFICATION_FAILED` for manual intervention; do not repeatedly message it.

⸻

Phase 16 — WhatsApp Revision Loop

Goal

Allow the customer to reply after delivery with a small correction or provide a logo/image, then automatically update the existing website.

Flow

Customer Replies to the Delivery WhatsApp Thread
↓
Twilio WhatsApp Webhook → Convex HTTP Action
↓
Validate Signature and Resolve Customer / Main Lead / Project
↓
Store Message and Download Supported Media
↓
Create Revision Request Linked to the Main Lead and Project
↓
Convert the Request into a Scoped Devin Subtask
↓
Trigger Devin Automatically on the Existing Repository
↓
Devin Applies the Change
↓
Devin Runs Tests and Production Build
↓
Devin Pushes the Completed Code
↓
Convex Detects Completion and Redeploys to Firebase Hosting
↓
Convex Validates the Existing Live URL
↓
Twilio WhatsApp Sends “Work done — check your website: {{liveUrl}}”

Revision Rules

- Link every revision to the original `leadId`, `projectId`, repository, deployment, and WhatsApp conversation.
- Accept a revision automatically only when the inbound sender matches the delivered recipient and the message can be resolved unambiguously to one active project conversation.
- Create a Devin subtask under the main lead/project build context; do not create a new customer project.
- Represent the parent/subtask relationship in Convex even if the Devin API does not expose native parent-child tasks.
- Preserve the existing live URL whenever possible.
- Treat text changes, color changes, and supplied logo/image replacements as supported MVP corrections.
- Classify scope before creating Devin work. A supported correction must affect the existing site without adding a new product area, integration, page family, data model, or commercial commitment.
- Store inbound text, Twilio message SID, media metadata, Convex storage IDs, created subtask/session ID, commit SHA, deployment result, and outbound completion message SID.
- Process Twilio webhooks idempotently so duplicate webhook delivery cannot create duplicate Devin work.
- Queue revisions per project and lock the base commit before development; do not let concurrent messages deploy over each other.
- Coalesce consecutive messages only during a short, explicit intake window and preserve the original messages in the audit log.
- Enforce supported MIME types, byte limits, image dimension limits, filename sanitization, malware/content checks, and media-download timeouts before exposing uploads to Devin.
- Treat customer text and files as untrusted requirements/assets, never as system instructions or authorization to access secrets, unrelated repositories, or external systems.
- If the request is ambiguous, unsupported, unsafe, or materially expands scope, mark it for manual intervention instead of guessing.
- If the revision fails, keep the current live website unchanged and expose a retry action to the admin.

Testing

Verify:

- a color-change reply creates one linked revision and Devin subtask,
- a logo attachment is stored and made available to Devin,
- duplicate Twilio events do not duplicate subtasks,
- concurrent replies are serialized without lost updates,
- unknown senders and ambiguous project matches are quarantined,
- unsafe and oversized media is rejected,
- successful revision reuses the project repository and live URL,
- completion is sent only after the updated website passes validation,
- failed revisions preserve the previously working deployment.

⸻

Phase 17 — Realtime Admin Command Center

Goal

Make the entire automation visually observable.

The UI should subscribe to:

project status
activity events
voice session
requirements
build job
deployment
notification delivery
revision queue and active revision
manual-intervention items

Example timeline:

✓ Business Selected
✓ AI Call Completed
✓ Requirements Generated
✓ Requirements Validated
✓ Repository Created
● Devin Building
○ Testing
○ Deploy
○ Deliver

No polling from React.

No manual refresh.

⸻

Phase 18 — Retry & Recovery

Goal

Ensure one failed integration does not require restarting the whole workflow.

Admin should be able to retry only the failed stage.

Examples:

CALL_FAILED
→ Retry Call
GITHUB_FAILED
→ Retry Repository Preparation
DEVIN_FAILED
→ Retry Build
DEPLOYMENT_FAILED
→ Retry Deployment
REVISION_BUILD_FAILED
→ Retry Revision Subtask

Retry must continue from the failed stage.

Never restart completed stages unnecessarily.

Retry Policy

- Define per-stage timeout, maximum attempts, retryable error codes, backoff, and reconciliation behavior.
- Automatic retries occur first; the admin retry is available only after the stage is safely retryable or automatic attempts are exhausted.
- A retry must reuse the stage idempotency key or reconcile the previous provider request before creating a replacement.
- Repository, deployment, and notification retries must check whether the intended commit, release, or message already exists.
- Manual intervention must allow cancel, retry, or resolve-with-note without mutating completed historical attempts.
- Provide a dead-letter/admin queue for unknown webhooks, ambiguous replies, non-retryable provider failures, and exhausted workflows.

⸻

Phase 19 — End-to-End Automated Validation

Create one happy-path integration scenario.

Scenario

Search Dubai Restaurant
↓
Select Business
↓
Create Project
↓
Start ElevenLabs Call through Twilio Automatically
↓
Receive Transcript
↓
Generate Requirements
↓
Validate Automatically
↓
Generate Docs
↓
Create GitHub Repo
↓
Push Starter Project
↓
Trigger Devin
↓
Build Website
↓
Deploy Firebase
↓
Store URL
↓
Deliver
↓
Reply with Color Change or Logo
↓
Validate Identity and Scope
↓
Queue Linked Devin Revision Subtask
↓
Test Candidate
↓
Promote to Live and Send Completion WhatsApp

Validate

At every stage assert:

correct project state
required database record
activity event
external identifier
error handling
idempotency under duplicate delivery
recovery after a timeout that occurred after provider success
no duplicate repository, Devin job, deployment, or customer message
previous live release preserved during a failed revision

⸻

Phase 20 — Demo Readiness

Prepare One Reliable Demo Path

Preconfigure:

- one location,
- one business category,
- working Context.dev credentials,
- working ElevenLabs agent,
- verified Twilio voice flow,
- approved Twilio WhatsApp sender and webhook,
- OpenAI key,
- GitHub token,
- Devin integration,
- Firebase deployment configuration,
- shared generated-site Convex deployment and tenant configuration,
- approved call/WhatsApp contact policy and demo recipient consent,
- provider quotas, timeout values, retry limits, and demo spending cap.

Demo UI Must Clearly Show

BUSINESS DISCOVERY
↓
VOICE DISCOVERY
↓
REQUIREMENTS
↓
GITHUB
↓
DEVIN
↓
FIREBASE
↓
DELIVERED
↓
REVISION REQUESTED
↓
REVISION COMPLETED

⸻

18. Basic Test Checklist

BuildPilot Platform

- BuildPilot React frontend deploys to its configured Firebase Hosting target.
- The deployed admin frontend connects to the BuildPilot Convex backend.
- Authentication, reactive queries, mutations, actions, and workflow monitoring work from the deployed URL.
- No Convex, Firebase, or provider secret is embedded in the frontend bundle.

Business Search

- Context.dev responds.
- Results normalized.
- Duplicate records handled.
- Missing phone handled.
- Contact eligibility, do-not-contact, and normalized E.164 number enforced.

Call

- Call starts automatically after project creation.
- ElevenLabs uses Twilio for the voice call.
- Session ID stored.
- Webhook handled.
- Transcript persisted.
- Busy/no-answer retry policy and opt-out suppression work.
- Duplicate scheduling cannot create a second call.

Requirements

- OpenAI invoked.
- JSON validated.
- Version stored.
- Automatic validation works.
- Unknown or insufficient facts are not invented.

Repository

- Repo created.
- Starter project pushed.
- Docs pushed.
- Assets pushed.
- Build works before Devin.
- Template version, repository ID, lockfile, initial commit, and tenant configuration are recorded.
- Repository contains no credentials or generated secret files.

Devin

- Session starts.
- Status tracked.
- Completion detected.
- Failure handled.
- Completion commit and allowed file scope are independently verified.

Firebase

- Deployment succeeds.
- URL stored.
- Site loads.
- Convex backend reachable.
- Shared Convex backend enforces tenant isolation.
- Candidate deployment is validated before live promotion.
- Failed revision leaves the previous live release available.

Realtime UI

- Status changes automatically.
- Activity timeline updates.
- No page refresh required.

WhatsApp Delivery and Revisions

- Final URL is sent through Twilio WhatsApp.
- Inbound correction text and logo media are linked to the main lead/project.
- One Devin revision subtask is created per idempotent customer request.
- Updated code is tested, redeployed, and validated.
- The customer receives a work-complete WhatsApp message with the live URL.
- Unknown senders, ambiguous matches, opt-outs, and unsupported requests require manual intervention.

Recovery

- Failed stage displayed.
- Retry resumes correct stage.
- Duplicate external callbacks do not duplicate work.
- A timeout after provider success is reconciled rather than repeated.
- Expired leases recover without concurrent stage execution.

Security and Operations

- Admin endpoints require authentication and server-side authorization.
- All supported webhook signatures are validated against the exact request payload.
- Rate limits, retention, calling windows, spending limits, and emergency stop work.
- Logs and activity events contain correlation IDs but no secrets.
- Unsafe or oversized customer media is rejected.

⸻

19. Mandatory Engineering Rules

1. Convex is the authoritative system of record.
1. React must remain a thin command-and-query interface.
1. All external services must be called from Convex.
1. External callbacks must enter through Convex HTTP Actions.
1. Every external event must be idempotent.
1. Every major stage must create an activity event.
1. No API secrets may exist in the browser.
1. Do not generate starter boilerplate with OpenAI for every project.
1. Use a validated reusable starter template.
1. Devin must receive a runnable repository.
1. Do not trigger Devin until requirements are automatically validated.
1. Do not deploy until the Devin build is validated.
1. Do not notify the customer until the live site is verified.
1. Failed workflows must resume from the failed stage.
1. Firebase must host the BuildPilot frontend and generated customer frontends only; Convex must host their backend state and functions.
1. Generated dynamic functionality must use Convex.
1. Successful lead and project creation must start the remaining pipeline automatically.
1. ElevenLabs must use Twilio for outbound voice telephony.
1. Customer delivery and revision messaging must use Twilio WhatsApp.
1. Revision requests must remain linked to the original lead, project, repository, and deployment.
1. Keep the last working deployment live if a revision fails.
1. Initial builds and repeatable revisions must use separate workflow-run state.
1. Only one build or revision may deploy a project at a time.
1. Admin commands require authentication and server-side authorization.
1. Contact eligibility, calling windows, consent/permission where required, and opt-outs must be enforced before messaging or calling.
1. The MVP generated-site Convex backend is shared and multi-tenant; every operation must enforce tenant isolation.
1. Validate a candidate deployment before promoting it to the live Firebase target.
1. Provider success must be reconciled after timeouts before retrying resource creation.
1. Customer and provider content is untrusted input and cannot override system rules or access secrets.

⸻

20. Hackathon Priority Order

Build in this order:

1. Convex schema, workflow runs, idempotency, and state machines
2. Admin authentication and UI shell
3. Validated template and shared generated-site Convex backend
4. Context.dev business discovery and contact eligibility
5. Business selection and atomic automation start
6. ElevenLabs call through Twilio
7. ElevenLabs webhook and correlation
8. Requirement extraction
9. Automatic requirement validation
10. BUILD_SPEC generation
11. GitHub repo preparation and runnable starter push
12. Devin integration and build monitoring
13. Candidate validation and Firebase live promotion
14. Realtime pipeline and manual-intervention queue
15. Twilio WhatsApp customer delivery
16. WhatsApp correction and logo revision loop
17. Retry, reconciliation, and rollback handling
18. Security/operational-limit validation
19. Stretch features

Do not move to stretch features until the complete primary flow works.

⸻

21. Hackathon Success Definition

BuildPilot succeeds when one business can move through this complete flow without manually performing backend operations:

Search
↓
Select
↓
Call
↓
Understand
↓
Validate
↓
Prepare
↓
Build
↓
Deploy
↓
Deliver

The revision success path must also work without backend operations by the admin:

Customer Reply / Logo
↓
Validate Identity and Scope
↓
Queue Linked Devin Revision
↓
Test Candidate
↓
Promote to Live
↓
Send WhatsApp Completion

The admin should only need to:

Search
Select
Monitor

After selection creates the lead and project, everything else must be automated by Convex and the connected services. The admin intervenes only when a failed stage exhausts automatic retries or a customer request requires clarification.

⸻

22. Final Product Architecture

```text
BUILD PILOT CONTROL PLANE

Admin
  │
  ▼
BuildPilot React Frontend
(Firebase Hosting)
  │ commands + reactive queries
  ▼
BuildPilot Convex Backend
(database, workflow state, actions, HTTP webhooks, scheduling, retries)
  │
  ├── Context.dev
  ├── ElevenLabs Agent ──→ Twilio Voice
  ├── OpenAI
  ├── GitHub ──→ Devin ──→ GitHub
  └── GitHub Actions
          │ validate, build, deploy
          ▼

GENERATED CUSTOMER SITE

Customer React Frontend
(Customer Firebase Hosting Site / Stable Live URL)
  │ queries + mutations scoped by siteId
  ▼
Shared Generated-site Convex Backend
(tenant-isolated customer data and public website functions)
  │
  ▼
BuildPilot Convex stores deployment result
  │
  ▼
Twilio WhatsApp sends URL to Customer
  │
  ▼
Customer correction / logo reply
  │
  ▼
BuildPilot Convex Revision Request
  │
  ▼
Devin Revision Subtask → Validate → Firebase Redeploy
  │
  ▼
Twilio WhatsApp Completion
```

⸻

23. Required Implementation Configuration

Before an end-to-end demo or production-like run, record these non-secret decisions in project configuration/documentation:

- admin authentication provider, allowed admin identities, and session policy,
- Context.dev endpoint/version, response mapping, usage limits, and asset/contact reuse rules,
- ElevenLabs agent ID, webhook event contract, transcript/recording settings, and Twilio integration mode,
- Twilio voice number, WhatsApp sender, approved delivery/completion template IDs when required, status callback URLs, calling regions/hours, and opt-out handling,
- OpenAI model, structured-output schema version, prompt versions, timeouts, and content-policy behavior,
- GitHub organization/owner, GitHub App installation, private-repository policy, branch names, workflow permissions, and protected live environment,
- Devin API/session contract, completion callback or polling contract, repository permissions, timeout, and whether native parent/subtasks exist,
- Firebase project, unique Hosting site/target naming strategy, preview/live promotion mechanism, service account scope, quotas, and rollback retention,
- shared generated-site Convex deployment URL, backend version, tenant provisioning rules, public-operation limits, and tenant-isolation tests,
- retention periods, spending caps, concurrency limits, retry policies, alert recipients, and emergency-stop owner.

If Devin has no native subtask relationship, Convex must create a normal Devin session and preserve the parent relationship in `revisionRequests.parentBuildJobId`; this must not block the revision workflow.

Do not commit secret values to this README. Document environment-variable names, owners, and rotation procedure separately.

⸻

24. Final Development Instruction for Devin

Treat this document as the master development plan.

Implement phases sequentially.

For each phase:

1. Read the complete phase requirements.
2. Inspect existing implementation before changing code.
3. Implement only the required scope.
4. Add or update tests.
5. Run linting.
6. Run relevant tests.
7. Run production build where applicable.
8. Fix blocking issues.
9. Record completed work.
10. Do not move to the next phase until current exit criteria pass.

When there is ambiguity:

- preserve the architecture rule,
- keep workflow ownership in Convex,
- keep React thin,
- avoid unnecessary infrastructure,
- favor reliable hackathon execution over over-engineering.

The primary objective is a stable end-to-end autonomous workflow, not maximum feature count.
