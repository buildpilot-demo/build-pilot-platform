# BuildPilot Admin

React + TypeScript + Vite frontend for the BuildPilot admin dashboard. Deployed to Firebase
Hosting; talks only to the `buildpilot-admin` Convex deployment (see `docs/project-requirements.md`
for the full architecture). Some routes below are still scaffolding-only placeholders ("Coming
soon") until their owning stage implements them.

## Structure

- `src/pages/<screen>/` — one folder per screen (`dashboard`, `search`, `projects`, `health`,
  `not-found`). Each page is responsible for its own content only; nav/header chrome lives in
  `Layout`.
- `src/components/` — shared/reusable UI (`Layout`, `ComingSoon`, `ErrorBoundary`).
- `src/hooks/` — Convex query/mutation hooks (e.g. `useBusinessSearch.ts`, `useConvexHealth.ts`).
  Pages should call hooks from here rather than `useQuery`/`useMutation`/`useAction` directly, so
  Convex access patterns stay consistent as stages are added.
- `src/lib/` — the Convex client (`convexClient.ts`) plus formatting/validation helpers
  (`format.ts`, `validation.ts`). Client-side validation here is UX-only; Convex remains the
  source of truth (see `docs/project-requirements.md` Section 12.2).

## Routes

| Path                   | Page                      | Filled in during           |
| ---------------------- | ------------------------- | -------------------------- |
| `/`                    | redirects to `/dashboard` | —                          |
| `/dashboard`           | pipeline overview         | implemented (Stage 8 T7.x) |
| `/search`              | business discovery        | implemented (Stage 3 T2.4) |
| `/projects/:projectId` | project detail/tracking   | Stages 3-7                 |
| `/health`              | deploy smoke test         | already implemented        |
| `*`                    | not found                 | —                          |

## Setup

```bash
npm install         # from the repo root (npm workspaces)
cp apps/admin/.env.example apps/admin/.env.local
# edit .env.local and set VITE_CONVEX_URL to your Convex deployment URL
```

### Convex backend

The Convex backend lives in a sibling `convex/` directory at the repo root, not inside this
package (see the root `README`/`convex.json`). This app imports its generated API client via the
`@convex/*` alias (`apps/admin/vite.config.ts`, `vitest.config.ts`, `tsconfig.app.json`), which
points at `../../convex`. That means **`npx convex dev` must be run at least once from the repo
root** before `npm run build`/`npm run test` here will work — `convex/_generated/` is gitignored
there (not committed), so it doesn't exist until you do.

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

| Variable                  | Description                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_CONVEX_URL`         | Convex deployment URL (e.g. `https://<name>.convex.cloud`). Never hardcode this in source — always read it from the environment.                                                                     |
| `VITE_DEFAULT_CALL_PHONE` | Optional. Pre-fills the search screen's "call phone override" input the first time it loads (then persisted in localStorage). Should match the backend's `DEFAULT_CALL_PHONE` Convex env var if set. |
