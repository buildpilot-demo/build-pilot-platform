# BuildPilot Admin

React + TypeScript + Vite frontend for the BuildPilot admin dashboard. Deployed to Firebase
Hosting; talks only to the `buildpilot-admin` Convex deployment (see `docs/project-requirements.md`
for the full architecture). This app is currently scaffolding only — the routes below render
placeholder "Coming soon" states until their owning stage implements them.

## Structure

- `src/pages/<screen>/` — one folder per screen (`dashboard`, `search`, `projects`, `health`,
  `not-found`). Each page is responsible for its own content only; nav/header chrome lives in
  `Layout`.
- `src/components/` — shared/reusable UI (`Layout`, `ComingSoon`, `ErrorBoundary`).
- `src/hooks/` — Convex query/mutation hooks. Pages should call hooks from here rather than
  `useQuery`/`useMutation` directly, so Convex access patterns stay consistent as stages are added.
- `src/lib/` — the Convex client (`convexClient.ts`) plus formatting/validation helpers
  (`format.ts`, `validation.ts`). Client-side validation here is UX-only; Convex remains the
  source of truth (see `docs/project-requirements.md` Section 12.2).

## Routes

| Path                   | Page                      | Filled in during    |
| ---------------------- | ------------------------- | ------------------- |
| `/`                    | redirects to `/dashboard` | —                   |
| `/dashboard`           | pipeline overview         | Stage 8             |
| `/search`              | business discovery        | Stage 3             |
| `/projects/:projectId` | project detail/tracking   | Stages 3-7          |
| `/health`              | deploy smoke test         | already implemented |
| `*`                    | not found                 | —                   |

## Setup

```bash
npm install         # from the repo root (npm workspaces)
cp apps/admin/.env.example apps/admin/.env.local
# edit .env.local and set VITE_CONVEX_URL to your Convex deployment URL
```

## Scripts

Run from `apps/admin/` (or prefix with `npm run <script> --workspace admin` from the repo root):

- `npm run dev` — start the Vite dev server
- `npm run build` — typecheck (`tsc -b`) and build for production
- `npm run preview` — preview the production build
- `npm run lint` — ESLint
- `npm run format` / `npm run format:check` — Prettier
- `npm run test` / `npm run test:watch` — Vitest + React Testing Library

## Health check

`/health` renders a minimal page reporting that the bundle loaded and whether the Convex client
has an active WebSocket connection. Intended for post-deploy smoke tests against Firebase Hosting.

## Styling

Tailwind CSS v4 (via `@tailwindcss/vite`), imported in `src/index.css`. No component library is
installed yet; the PRD lists `shadcn/ui` and `Lucide Icons` as optional additions for later
stages.

## Environment variables

| Variable          | Description                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_CONVEX_URL` | Convex deployment URL (e.g. `https://<name>.convex.cloud`). Never hardcode this in source — always read it from the environment. |
