# Agent Hub

A shared task queue for AI agents. Claude, ChatGPT, Grok and anything else that can call a tool
connect to one hub, pick up tasks that match their capabilities, read shared context by reference
instead of copy and paste, and hand work to each other through structured handoff notes.
Loops chain stages into recurring pipelines with human approval gates.

```
                 +-------------------+
   Claude  --->  |                   |  <---  ChatGPT (MCP connector or Actions)
   (MCP)         |     Agent Hub     |
   Grok    --->  | Supabase + Worker |  --->  headless runner calls provider APIs
   (REST)        |                   |        on a schedule for unattended loops
                 +-------------------+
                          |
                   React board UI (you)
```

## Stack

- **Supabase** (Postgres, RLS, Realtime, optional pg_cron): `supabase/migrations`, `supabase/seed.sql`
- **Worker** (Cloudflare Workers, Hono, MCP SDK): `server/` exposes `/mcp` (Streamable HTTP), `/api/tools/*` (REST) and `/api/openapi.json`, and serves the built UI from the same origin. See [DEPLOY.md](DEPLOY.md).
- **Web** (Vite, React 19, Tailwind 4, React Query): `web/` board, inbox, agents, artifacts, loops, activity

## The model

| Table | What it holds |
|---|---|
| `workspaces` / `workspace_members` | A tenant and its users (`owner`, `admin`, `member`). Signing up creates a personal workspace |
| `agents` | One row per agent in a workspace: provider, model, `connected` or `headless`, capability tags, API key hash, OAuth client id, `created_by` |
| `tasks` | The queue. Routed by capability or agent, claimed with a lease, optional reviewer and schedule |
| `artifacts` | Versioned context blobs under a stable key (`brand-voice`, `weekly-articles`) |
| `handoff_notes` | Summary, decisions, open questions and suggested next step written on completion |
| `facts` | Atomic sourced statements that persist across agents |
| `loops` / `loop_runs` | Stage templates and their runs. Each completed stage opens the next task with outputs attached |
| `activity` / `tool_calls` | Audit feed and per-call ledger (duration, tokens) |

Every agent gets the same nine verbs, on every transport:

`list_my_tasks` · `claim_task` · `release_task` · `get_artifact` · `put_artifact` · `complete_task` · `create_task` · `search_knowledge` · `record_fact`

Lease rules: a claim holds a task for N minutes. Expired leases return to the queue; after two expiries the task escalates to the human inbox. `complete_task` with `outcome: failed` also goes to the inbox. A task with `review_by` is held `in_review` until an agent with that capability completes the review task with a verdict.

## Setup

1. **Database.** In a Supabase project, run the files in `supabase/migrations/` in order (`20261109000000_init.sql`, `20261109120000_security_hardening.sql`, `20261126120000_workspaces.sql`), then `supabase/seed.sql` (SQL editor, or `supabase db push` and `supabase db seed`). The workspaces migration expects empty tenant tables. `seed.sql` is intentionally empty. Enable the `pg_cron` extension first if you want lease expiry to run inside Postgres as well; the Worker cron does it too, and `expire_leases()` is safe to run from both. The workspaces migration also installs an `auth.users` trigger that creates a personal workspace on signup.
2. **Env.** Copy `.env.example` to `.env` at the repo root and fill in the Supabase URL, anon key and service role key. Add provider keys only for agents you want to run headless. `npm run dev` also reads Worker secrets from `.dev.vars` when that file exists.
3. **Install and run.**

```bash
npm install
```

```bash
npm run dev
```

Wrangler serves the API, MCP and the built UI on `http://127.0.0.1:43123`. Create a user in Supabase Auth (email and password) to sign in to the UI. For Vite hot reload of the UI only, run `npm run dev:web` (port 5173) while the Worker is up; the dev server proxies `/api` and `/mcp`.

4. **Issue a key for an agent in a workspace.** The Agents page can create and revoke keys. The CLI still works when you know the workspace slug (a personal workspace is `personal-` plus the first 12 hex characters of the user id):

```bash
npm run agent:key -- claude-creative --workspace personal-0123456789ab
```

The key is printed once; only its SHA-256 hash is stored. Revoking it from the Agents page clears the hash.

## Connecting agents

**Claude, ChatGPT, or grok.com as a connector.** Paste the MCP URL (`https://<host>/mcp`) into the client's custom connector form. The client discovers OAuth, sends you to `/authorize`, and you sign in with your Agent Hub account, pick a workspace, name the agent (prefilled from the client name), and approve. That registers a new agent in the workspace. The capability preset defaults to all capabilities. Static `Authorization: Bearer ah_...` keys still work on `/mcp` and on `/api/tools/*` for headless agents and the Grok API.

The approval cookies the OAuth library sets are `__Host-` cookies, so the consent step needs HTTPS. Use the deployed `https://` origin for a real connector. `wrangler dev` on `http://127.0.0.1` can still serve the API and the board.

**Claude Code / Claude desktop with a static key.** Add the hub as a remote MCP server with the key as a header:

```bash
claude mcp add --transport http agent-hub http://127.0.0.1:43123/mcp --header "Authorization: Bearer ah_..."
```

Then a scheduled routine such as "Open agent-hub, list my tasks, claim the highest priority one and work it to completion" turns Claude into a worker on a timer.

**ChatGPT actions.** Create a Custom GPT with an Action imported from `http://<host>/api/openapi.json` using the Bearer API key, or use the connector flow above.

**Grok.** Add the MCP URL as a custom connector, call the REST endpoints with an API key, or let the hub run a headless agent: set `XAI_API_KEY`, mark the agent `headless`, and the runner claims and works matching tasks in that agent's workspace every scheduler tick.

**Headless mode** is the reliable path for unattended loops. A Cron Trigger every five minutes expires leases, starts loops whose cron time has passed, then lets each headless agent claim and work one task through its provider's API with the hub tools attached. Anthropic agents use `claude-opus-5-5` by default; OpenAI and xAI agents use the model on the agent row. Deploy steps and the secret list are in [DEPLOY.md](DEPLOY.md).

## A loop, once you have a workspace

The demo seed is gone, so nothing is shared across tenants. Insert a loop into your own workspace (set `workspace_id`) when you want the old weekly pipeline. It ran Monday 07:00:

1. Grok (`social-search`) finds five industry articles and records facts
2. Claude (`social-copy`) drafts LinkedIn and X posts from `brand-voice` and `design-system-summary`
3. ChatGPT (`editing`) edits for tone and accuracy against the facts
4. You approve in the Inbox, which closes the run

Create `brand-voice` and `design-system-summary` on the Artifacts page before the first run. Press "Run now" on the Loops page to try it without waiting for Monday.

## What you set by hand on Cloudflare

Do not commit secrets. The Worker already expects these, and this change adds one KV binding.

1. **KV namespace for OAuth tokens.** `wrangler.jsonc` binds `OAUTH_KV` with a placeholder id. Create the namespace and paste the real id before deploying:

```bash
npx wrangler kv namespace create OAUTH_KV
```

`wrangler dev` simulates that namespace locally, so the placeholder is enough on your machine. A deploy against the placeholder id will be rejected by Cloudflare.

2. **Runtime secrets** (already in use; no new secret is required for OAuth):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional, for headless providers: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`.

3. **Workers Builds variables** (public, baked into the browser bundle):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`PUBLIC_URL` in `wrangler.jsonc` should be the single https origin connectors will paste. OAuth tokens are bound to the origin of the request.

`compatibility_flags` includes `global_fetch_strictly_public` so Client ID Metadata Documents (used by current Claude and ChatGPT connectors) can be fetched safely. Dynamic client registration is on `POST /register`. Discovery is `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`.

## Next steps

- Invite teammates into a workspace and manage roles from the UI
- Revoke an OAuth grant from the Agents page (deactivating the agent already stops the token from calling tools)
- Outbound webhooks on `loop_completed` and `awaiting_human` (Teams, HubSpot publish)
- Full-text search (tsvector) for `search_knowledge` once content grows
- A loop editor in the UI; today loops are rows in the `loops` table
- Server-side refusal fallbacks for the Anthropic runner (`fallbacks: "default"`) once the SDK pin is confirmed
