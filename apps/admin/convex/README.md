# BuildPilot Admin — Convex backend

Control-plane backend for BuildPilot (docs/project-requirements.md Section 4.2). No Convex
deployment has been created yet in this environment (docs/task-plan.md T0.1), so
`convex/_generated/` in this repo was **hand-written** to match what `npx convex dev`/
`npx convex codegen` produce, instead of generated. Once a real deployment exists:

```bash
npx convex dev   # log in, create/select a project, and overwrite convex/_generated/
```

## Layout

- `schema.ts` — full table list (shared contract #1).
- `lib/stageAttempt.ts` — durable stage-attempt lifecycle: `beginStageAttempt` /
  `completeStageAttempt` / `failStageAttempt`, plus `begin`/`complete`/`fail` internal-mutation
  wrappers for actions (shared contract #3).
- `lib/externalCall.ts` — `callExternal(ctx, { stage, projectId, cacheKey, live }, ...)`, the
  wrapper every external-call action uses for stage-attempt bookkeeping and "replay last
  successful response" demo-resilience fallback (shared contract #4; see
  docs/project-requirements.md Sections 9-10).
- `businesses.ts` — `searchBusinesses` action (Context.dev `POST /web/search`) and
  `listBusinesses` query (PHASE 1 / T2.4).
- `test.setup.ts` — the `import.meta.glob` module map used by `convex-test` in `*.test.ts` files.
  Convex function tests run under the `edge-runtime` Vitest environment (see the
  `@vitest-environment edge-runtime` docblock at the top of each test file) and need
  `server.deps.inline: ['convex-test']` in `vitest.config.ts`.

## Environment variables

Set these on the Convex deployment (`npx convex env set NAME value`), **not** in
`apps/admin/.env.local` — they're read by backend functions via `process.env`, never bundled into
the frontend.

| Variable              | Description                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONTEXTDEV_API_KEY`  | Context.dev API key (bearer token), required by `searchBusinesses`.                                                                                                            |
| `CONTEXTDEV_BASE_URL` | Optional override for the Context.dev API base URL. Defaults to `https://api.context.dev/v1`.                                                                                  |
| `DEFAULT_CALL_PHONE`  | Number assigned to every business row `searchBusinesses` creates, since Context.dev can't verify a phone number belongs to the business. Defaults to `+971588711809` if unset. |
