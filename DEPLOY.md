# Deploy Agent Hub to Cloudflare Workers

One Worker, `agent-hub`, serves the API, the MCP Streamable HTTP endpoint, and the built web UI at `https://agent-hub.flutey103.workers.dev`.

You need a Cloudflare account whose workers.dev subdomain is `flutey103`, and Wrangler logged in (`npx wrangler login`). This repo does not contain credentials.

## 1. Database

Apply every file in `supabase/migrations/` in order, then `supabase/seed.sql`, if the project does not already have them. The second migration matches the live database: it hides `agents.api_key_hash` from `anon` and `authenticated`, pins function `search_path`, and moves `pg_trgm` into the `extensions` schema. `20261126120000_workspaces.sql` adds workspaces and replaces the open RLS policies. It expects the tenant tables to be empty. `seed.sql` no longer inserts demo rows.

## 2. Build the web UI

Vite bakes the browser Supabase settings at build time. Put them in `.env` at the repo root (same file as local development) or export them for the build:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The anon key is public in the browser bundle. Do not put the service role key in `VITE_*`. Leave `VITE_SERVER_URL` unset so the UI calls `/api` on the same origin.

## 3. Worker variables

These are already in `wrangler.jsonc` and are uploaded on deploy. They are not secrets:

| Name | Value |
|---|---|
| `PUBLIC_URL` | `https://agent-hub.flutey103.workers.dev` |
| `DEFAULT_LEASE_MINUTES` | `30` |
| `RUNNER_ENABLED` | `true` |

`RUNNER_ENABLED=false` skips headless provider calls. The cron trigger stays in place and still expires leases and starts due loops.

## 4. Secrets

Set these with Wrangler. The command prompts for the value; do not pass it as an argument. Provider keys are optional. If a provider key is unset, the Worker still boots and serves the UI, `/api`, and `/mcp`. Headless agents for that provider are skipped.

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put XAI_API_KEY
```

Required for any database call:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional, one per headless provider:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `XAI_API_KEY`

`SUPABASE_URL` is the same project URL as `VITE_SUPABASE_URL`. It is a secret here only so the real project URL is not committed. The service role key bypasses RLS and must stay server-side.

## 5. Deploy

```bash
npm install
npm run deploy
```

`npm run deploy` builds the web app, typechecks and bundles the Worker, and runs `wrangler deploy`.

## Workers Builds

Git-connected deploys use **Workers & Pages** → **agent-hub** → **Settings** → **Builds**. The Worker name stays `agent-hub`, matching `name` in `wrangler.jsonc`. Commands run from the repository root, where `wrangler.jsonc` lives. Workers Builds does not run a `[build]` command from that file, so the dashboard build command has to build the web app.

| Setting | Value |
|---|---|
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

`npm run build` writes the UI to `web/dist` (the assets directory in `wrangler.jsonc`) and the Worker bundle to `dist/worker`. `npx wrangler deploy` then uploads that Worker from the same root.

Build variables (public; add them as build variables, not build secrets). Vite inlines them while the build command runs. They are not Worker runtime bindings.

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL, `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public in the browser bundle) |

Runtime Worker secrets (**Settings** → **Variables and Secrets**, or `npx wrangler secret put`). These are not build variables. `SUPABASE_URL` is the same project URL as `VITE_SUPABASE_URL`. The service role key bypasses RLS and stays server-side.

| Name |
|---|
| `SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` |

Optional provider secrets are listed in section 4. OAuth tokens live in the `OAUTH_KV` binding (`18f7ffed2fd24c7c8bccb4089c266966` in `wrangler.jsonc`), not in a secret. No new Worker secret is required. Build variables stay `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Local Worker

```bash
npm run dev
```

That builds `web/` and starts `wrangler dev` on port 43123. For local secrets, copy the Worker keys into `.dev.vars` in the repo root (gitignored). If `.dev.vars` exists, Wrangler ignores `.env` for the Worker, so keep the two files in sync or use only `.env`.

Trigger the cron handler once:

```bash
curl "http://127.0.0.1:43123/cdn-cgi/local/scheduled?cron=*/5+*+*+*+*"
```

## Issue an agent key

`npm run agent:key` still runs on your machine, not in the Worker. It reads `.env` at the repo root and writes the hash with the service role:

```bash
npm run agent:key -- claude-creative --workspace <workspace-slug>
```

The Agents page in the signed-in UI can create and revoke keys for the workspace you have selected. A personal workspace slug looks like `personal-` plus the first 12 hex characters of the user id.

## Direct upload

`wrangler deploy` bundles the Worker and uploads assets for you. A direct upload (the Workers script upload API plus the assets upload API) needs:

- Worker module: `dist/worker/worker.js`, written by `npm run build` (`wrangler deploy --dry-run --outdir dist/worker`). The source map sits next to it and is not required for the upload.
- Static assets directory: `web/dist` (Vite output: `index.html` and hashed files under `web/dist/assets`).

The Worker name is `agent-hub`. Assets use SPA fallback. Requests to `/api/*`, `/mcp`, `/mcp/*`, `/authorize`, `/token`, `/register`, and `/.well-known/*` hit the Worker first.
