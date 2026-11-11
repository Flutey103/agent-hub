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
| `agents` | One row per agent: provider, model, `connected` or `headless`, capability tags, API key hash |
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

1. **Database.** In a Supabase project, run `supabase/migrations/20261109000000_init.sql`, then `supabase/migrations/20261109120000_security_hardening.sql`, then `supabase/seed.sql` (SQL editor, or `supabase db push` and `supabase db seed`). Enable the `pg_cron` extension first if you want lease expiry to run inside Postgres as well; the Worker cron does it too, and `expire_leases()` is safe to run from both.
2. **Env.** Copy `.env.example` to `.env` at the repo root and fill in the Supabase URL, anon key and service role key. Add provider keys only for agents you want to run headless. `npm run dev` also reads Worker secrets from `.dev.vars` when that file exists.
3. **Install and run.**

```bash
npm install
```

```bash
npm run dev
```

Wrangler serves the API, MCP and the built UI on `http://127.0.0.1:43123`. Create a user in Supabase Auth (email and password) to sign in to the UI. For Vite hot reload of the UI only, run `npm run dev:web` (port 5173) while the Worker is up; the dev server proxies `/api` and `/mcp`.

4. **Issue a key for a connected agent.**

```bash
npm run agent:key -- claude-creative
```

The key is printed once; only its SHA-256 hash is stored.

## Connecting agents

**Claude Code / Claude desktop.** Add the hub as a remote MCP server with the key as a header:

```bash
claude mcp add --transport http agent-hub http://localhost:8787/mcp --header "Authorization: Bearer ah_..."
```

Then a scheduled routine such as "Open agent-hub, list my tasks, claim the highest priority one and work it to completion" turns Claude into a worker on a timer. Claude.ai's connector UI expects OAuth rather than a static header; see "Next steps".

**ChatGPT.** Either add the MCP server as a connector in developer mode (same URL and header), or create a Custom GPT with an Action imported from `http://<host>/api/openapi.json` using Bearer auth. ChatGPT scheduled tasks can then run the same "work my queue" prompt.

**Grok.** Call the REST endpoints from an xAI function-calling agent, or let the hub run it: set `XAI_API_KEY`, mark the agent `headless`, and the runner claims and works matching tasks every scheduler tick.

**Headless mode** is the reliable path for unattended loops. A Cron Trigger every five minutes expires leases, starts loops whose cron time has passed, then lets each headless agent claim and work one task through its provider's API with the hub tools attached. Anthropic agents use `claude-opus-5-5` by default; OpenAI and xAI agents use the model on the agent row. Deploy steps and the secret list are in [DEPLOY.md](DEPLOY.md).

## The seeded loop

`weekly-social-content` runs Monday 07:00:

1. Grok (`social-search`) finds five industry articles and records facts
2. Claude (`social-copy`) drafts LinkedIn and X posts from `brand-voice` and `design-system-summary`
3. ChatGPT (`editing`) edits for tone and accuracy against the facts
4. You approve in the Inbox, which closes the run

Replace the placeholder `brand-voice` and `design-system-summary` artifacts in the Artifacts page before the first run. Press "Run now" on the Loops page to try it without waiting for Monday.

## Next steps

- OAuth on `/mcp` so Claude.ai and ChatGPT's connector UIs can add the hub without a pasted header
- Outbound webhooks on `loop_completed` and `awaiting_human` (Teams, HubSpot publish)
- Full-text search (tsvector) for `search_knowledge` once content grows
- A loop editor in the UI; today loops are rows in the `loops` table
- Server-side refusal fallbacks for the Anthropic runner (`fallbacks: "default"`) once the SDK pin is confirmed
