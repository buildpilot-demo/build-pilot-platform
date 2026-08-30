# BuildPilot

BuildPilot is an AI-driven autonomous website acquisition and delivery platform. Convex is the central backend and orchestration layer; the `admin/` React app is a thin control-plane UI that only sends intent and renders live state from Convex.

See [`docs/readme.md`](docs/readme.md) for the full product requirements and end-to-end architecture, and [`docs/task-plan.md`](docs/task-plan.md) for the implementation plan.

## Repository layout

```
convex/          Control-plane Convex backend: schema, functions, HTTP actions, state machine
sites-backend/   A second, separate Convex project (buildpilot-sites) — the shared,
                 multi-tenant backend every generated customer site's frontend talks to
                 directly. Deliberately minimal: just siteTenants + siteSubmissions.
admin/           Admin console (React + Vite), deployed to Firebase Hosting
tests/           Integration-style tests for the Convex state machine & pipeline
docs/            Product requirements, task plan, and prompt references
```

## Prerequisites

- Node.js 22+
- npm
- A [Convex](https://www.convex.dev) account/project
- A [Firebase](https://firebase.google.com) project with Hosting enabled (for the admin app deploy)

## 1. Deploying the Convex backend

The Convex functions in `convex/` are the source of truth for all workflow state.

From the repo root:

```bash
npm install
```

### Local development deployment

```bash
npx convex dev
```

This logs you into Convex (first run only), creates/links a dev deployment, pushes the schema and functions in `convex/`, and watches for changes. It prints a deployment URL (e.g. `https://<deployment>.convex.cloud`) — copy this for the admin app's `VITE_CONVEX_URL`.

### Production deployment

```bash
npx convex deploy
```

Run this from the repo root (or wire it into CI) to push `convex/` to your production Convex deployment.

### Required environment variables

Configure these on the Convex deployment (via `npx convex env set NAME value`, or the Convex dashboard's Environment Variables page) — they're consumed directly by `convex/*.ts`:

| Variable | Used for |
| --- | --- |
| `CONTEXTDEV_API_KEY`, `CONTEXTDEV_BASE_URL` | Business search (Context.dev web search — raw discovery only; see `LLM_PROVIDER` below for the extraction/filtering step) |
| `CONTEXTDEV_FETCH_COUNT` | Optional, defaults to `20`. How many raw web-search snippets Context.dev returns per search before the LLM extracts and filters them down to the Admin UI's "Max Results" (default 5) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_PHONE_NUMBER_ID`, `ELEVENLABS_BASE_URL`, `ELEVENLABS_WEBHOOK_SECRET` | Outbound voice calls |
| `ELEVENLABS_MOCK_CONVERSATION` | Optional, defaults to `N`. Set to `Y` to skip the real ElevenLabs/Twilio call entirely: clicking "Call" in the admin app instead picks a sample transcript from `convex/data/mockConversations.json` (matched to the business's category where possible) and feeds it through the same state-machine transitions and requirements-extraction path a real ElevenLabs webhook would (`CALL_QUEUED` → `CALLING` → `CALL_COMPLETED` → `TRANSCRIPT_RECEIVED`). Useful for testing the rest of the pipeline end-to-end without live telephony or `ELEVENLABS_*` credentials configured. Set to `N` (or unset) to keep the real flow unchanged. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_STATUS_CALLBACK_URL` | Telephony + WhatsApp delivery |
| `LLM_PROVIDER`, `LLM_MODEL` | Requirements extraction from transcripts, and business-lead extraction/filtering from Context.dev's raw web-search results (see `convex/lib/llm.ts`, used by both `convex/requirements.ts` and `convex/businesses.ts`). `LLM_PROVIDER` selects `openai` (default), `groq`, or `gemini`; `LLM_MODEL` overrides that provider's default model (`gpt-4o-mini` / `llama-3.3-70b-versatile` / `gemini-1.5-flash`). |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | OpenAI credentials, used when `LLM_PROVIDER=openai` |
| `GROQ_API_KEY`, `GROQ_BASE_URL` | Groq credentials, used when `LLM_PROVIDER=groq` |
| `GEMINI_API_KEY`, `GEMINI_BASE_URL` | Gemini credentials, used when `LLM_PROVIDER=gemini` |
| `GITHUB_TOKEN`, `GITHUB_ORG`, `GITHUB_STARTER_REPO` | Repository creation from the starter template |
| `GITHUB_REPO_VISIBILITY` | Optional, defaults to `private`. Set to `public` to create every generated customer-site repo as public instead — needed if your org's Actions secrets (e.g. `FIREBASE_SERVICE_ACCOUNT`) are scoped to "All public repositories" rather than "All repositories", since a private repo would never see them and every workflow run needing that secret fails at that step. Fine for a demo; reconsider before shipping real customer code publicly. |
| `DEVIN_API_KEY`, `DEVIN_API_BASE_URL` | Automated site build sessions |
| `FIREBASE_PROJECT_ID`, `FIREBASE_SITE_ID`, `FIREBASE_SITE_PREFIX` | Generated-site deployment target — see note below |
| `GENERATED_SITE_CONVEX_URL` | The **shared, multi-tenant** Convex deployment (`buildpilot-sites` per the task plan's Stage 0 — a *second*, separate Convex project from this one) that every generated customer site's own frontend talks to. Must be that project's client API URL (`https://<other-deployment>.convex.cloud`) — **not** this deployment's own URL, and not a `.convex.site` URL (that domain is only for HTTP Actions, e.g. `CONVEX_CALLBACK_URL` below). |
| `SITE_TENANT_PROVISION_TOKEN` | Shared secret authorizing `deployments.ts::deployToFirebase`'s cross-deployment call to `siteTenants:provisionTenant`. **Set the same value on both Convex deployments** (this one and `buildpilot-sites`, via `npx convex env set SITE_TENANT_PROVISION_TOKEN <value>` run from each project's directory) — this deployment sends it, `buildpilot-sites` checks it. |
| `CONVEX_CALLBACK_TOKEN` | Auth for inbound webhook callbacks (set on **this** Convex deployment) |
| `CONVEX_CALLBACK_URL` | *Not* a Convex-deployment env var — set as a GitHub Actions **organization** variable (`buildpilot-demo` org → Settings → Secrets and variables → Actions), pointing generated repos' workflows back at **this** deployment's own HTTP Actions endpoint: `https://<this-deployment>.convex.site/webhooks/github-workflow` (see T4.9 in `docs/task-plan.md`). |

`FIREBASE_SITE_PREFIX` is a single shared prefix (e.g. `buildpilot`), not per-business — `deployments.ts::deployToFirebase` appends a per-project suffix itself (`${FIREBASE_SITE_PREFIX}-${siteSuffix(projectId)}`) so every project still gets a unique Firebase Hosting site ID without needing a different env var per customer. Set `FIREBASE_SITE_ID` instead only if you want to hardcode one fixed site (e.g. for local testing of a single project) rather than deriving one per project.

Integration status/configuration can be checked at runtime from `convex/admin.ts`'s status query, which reports which of these are set.

### Deploying the generated-sites backend (`sites-backend/`)

`sites-backend/` is a **separate Convex project** (`buildpilot-sites`) with its own minimal `convex/` folder — just `siteTenants` + `siteSubmissions` and the two functions customer sites call (`submitInquiry`) and this deployment calls cross-project (`provisionTenant`). It is not part of this repo's `convex/` deploy.

```bash
cd sites-backend
npm install
npx convex dev    # first run: link to the buildpilot-sites project, or create it
```

Set `SITE_TENANT_PROVISION_TOKEN` there too (same value as on this deployment — see the env var table above), then copy its dev/prod deployment URL into `GENERATED_SITE_CONVEX_URL` on **this** deployment. For a one-shot push without leaving `npx convex dev` running, use `npx convex dev --once` (pushes to your dev deployment) or `npx convex deploy` (pushes to `buildpilot-sites`'s own prod deployment — point `GENERATED_SITE_CONVEX_URL` at whichever one you actually deploy to).

### One-time setup: registering the starter template

Repository preparation (`convex/github.ts`'s `prepareRepository`) seeds every customer site by generating a new repo from a pinned starter template commit. That pin lives in the `templateVersions` Convex table and is **not** populated automatically — it must be registered once per environment (fresh Convex deployment, or whenever you want to point at a different/updated starter repo).

After setting `GITHUB_TOKEN`, `GITHUB_ORG`, and `GITHUB_STARTER_REPO` (e.g. `https://github.com/buildpilot-demo/buildpilot-starter-template.git`) on the Convex deployment, run:

```bash
npx convex run github:configureStarterTemplate
```

This looks up the starter repo's default branch and latest commit SHA on GitHub and saves it as the active `templateVersions` row. Until this has been run at least once, every repository-preparation attempt (and any Admin "Resume" action that re-enters `REPOSITORY_PREPARING`) will fail with `No active starter template is configured`. Re-run the same command any time you want to re-pin to the starter repo's latest commit.

### Admin authentication (T7.4 — removed)

There is no authentication: the admin console is open to anyone who can reach it, and every Convex query/mutation/action is callable without a signed-in user. The Convex Auth scaffolding (`convex/auth.ts`, `convex/lib/auth.ts`, `convex/lib/bootstrapAdmin.ts`, and the admin app's `LoginPage`) has been deleted along with the `@convex-dev/auth` dependency.

## 2. Running the admin frontend

The admin console lives in `admin/` and is a separate Vite + React app.

```bash
cd admin
npm install
cp .env.example .env
```

Edit `admin/.env` and set `VITE_CONVEX_URL` to your Convex deployment URL from step 1 (dev or prod):

```
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

Then start the dev server:

```bash
npm run dev
```

This serves the admin app at `http://localhost:4173` (configured in `admin/vite.config.ts`).

Other useful scripts (run from `admin/`):

```bash
npm run typecheck   # type-check the app (tsconfig.app.json + tsconfig.node.json)
npm run build        # typecheck + production build to admin/dist
npm run preview      # preview the production build locally
```

### Deploying the admin app to Firebase Hosting

The admin app deploys to the `buildpilot-admin` Firebase Hosting site (see `admin/firebase.json` / `admin/.firebaserc`). This is automated by [`.github/workflows/deploy-buildpilot.yml`](.github/workflows/deploy-buildpilot.yml) on every push to `main` that touches `admin/**`, using the `VITE_CONVEX_URL` repo variable and a `FIREBASE_SERVICE_ACCOUNT` secret.

To deploy manually:

```bash
cd admin
npm run build
npx firebase-tools deploy --only hosting --project <your-firebase-project-id>
```

(Requires the [Firebase CLI](https://firebase.google.com/docs/cli) to be authenticated: `firebase login`.)

## 3. Running tests

### Backend integration/E2E tests

The `tests/` directory (plus `*.test.ts` files inside `convex/`) exercises the Convex state machine and pipeline stages end-to-end against a simulated Convex context — covering flows like external call retries/idempotency, stage attempts, and replaying the last integration response. Run them from the repo root:

```bash
npm install
npm test
```

This runs `vitest run` across the project. To run a single file or watch mode:

```bash
npx vitest run tests/stageAttempt.test.ts
npx vitest
```

Type-check the backend separately with:

```bash
npm run typecheck
```

### Admin frontend checks

From `admin/`:

```bash
npm run typecheck
```
