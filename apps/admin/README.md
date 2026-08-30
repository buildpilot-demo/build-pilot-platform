# BuildPilot Admin

React + TypeScript + Vite frontend for the BuildPilot admin dashboard. Deployed to Firebase
Hosting; talks only to the `buildpilot-admin` Convex deployment (see `docs/project-requirements.md`
for the full architecture). This app is currently scaffolding only — no screens yet.

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

## Environment variables

| Variable          | Description                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_CONVEX_URL` | Convex deployment URL (e.g. `https://<name>.convex.cloud`). Never hardcode this in source — always read it from the environment. |
