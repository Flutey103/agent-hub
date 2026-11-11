-- Agent Hub: shared task queue for AI agents
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create type task_status as enum ('queued','claimed','in_review','awaiting_human','done','failed','cancelled');
create type agent_mode as enum ('connected','headless');

-- ---------------------------------------------------------------------------
-- Agents: one row per connected or headless agent
-- ---------------------------------------------------------------------------
create table agents (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  provider      text not null check (provider in ('anthropic','openai','xai','other')),
  model         text,
  mode          agent_mode not null default 'connected',
  capabilities  text[] not null default '{}',
  system_prompt text,
  api_key_hash  text unique,
  is_active     boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index agents_capabilities_idx on agents using gin (capabilities);

-- ---------------------------------------------------------------------------
-- Artifacts: versioned context blobs referenced by key
-- ---------------------------------------------------------------------------
create table artifacts (
  id               uuid primary key default gen_random_uuid(),
  key              text not null,
  version          int  not null default 1,
  title            text not null,
  kind             text not null default 'markdown' check (kind in ('markdown','json','url','image','text')),
  content          text,
  metadata         jsonb not null default '{}'::jsonb,
  created_by_agent uuid references agents(id),
  task_id          uuid,
  created_at       timestamptz not null default now(),
  unique (key, version)
);
create index artifacts_key_idx on artifacts (key);
create index artifacts_content_trgm_idx on artifacts using gin (content gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Loops: templates that chain stages into recurring pipelines
-- stages: [{ "name": "...", "brief": "...", "capability": "social-search" | "agent": "slug" | "human": true, "review_by": "capability"? }]
-- ---------------------------------------------------------------------------
create table loops (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text,
  cron        text,
  next_run_at timestamptz,
  is_active   boolean not null default true,
  stages      jsonb not null,
  created_at  timestamptz not null default now()
);

create table loop_runs (
  id            uuid primary key default gen_random_uuid(),
  loop_id       uuid not null references loops(id) on delete cascade,
  status        text not null default 'running' check (status in ('running','done','failed','cancelled')),
  current_stage int  not null default 0,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- Tasks: the work queue
-- ---------------------------------------------------------------------------
create table tasks (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  brief                text not null,
  acceptance_criteria  text,
  status               task_status not null default 'queued',
  priority             int not null default 3 check (priority between 1 and 5),
  assignee_capability  text,
  assignee_agent_id    uuid references agents(id),
  is_human             boolean not null default false,
  claimed_by           uuid references agents(id),
  lease_expires_at     timestamptz,
  claim_count          int not null default 0,
  scheduled_for        timestamptz,
  due_at               timestamptz,
  parent_task_id       uuid references tasks(id),
  loop_run_id          uuid references loop_runs(id) on delete set null,
  stage_index          int,
  review_by_capability text,
  input_artifact_ids   uuid[] not null default '{}',
  output_artifact_ids  uuid[] not null default '{}',
  result_summary       text,
  created_by_agent     uuid references agents(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  completed_at         timestamptz
);
create index tasks_status_idx on tasks (status, priority, created_at);
create index tasks_capability_idx on tasks (assignee_capability) where status = 'queued';
create index tasks_loop_run_idx on tasks (loop_run_id);

alter table artifacts add constraint artifacts_task_fk foreign key (task_id) references tasks(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Handoff notes: the structured knowledge transfer on completion
-- ---------------------------------------------------------------------------
create table handoff_notes (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references tasks(id) on delete cascade,
  agent_id       uuid references agents(id),
  summary        text not null,
  decisions      jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  suggested_next text,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Facts: atomic, sourced statements that persist across agents
-- ---------------------------------------------------------------------------
create table facts (
  id          uuid primary key default gen_random_uuid(),
  statement   text not null,
  source_url  text,
  confidence  numeric(3,2) check (confidence between 0 and 1),
  tags        text[] not null default '{}',
  recorded_by uuid references agents(id),
  task_id     uuid references tasks(id) on delete set null,
  valid_until timestamptz,
  created_at  timestamptz not null default now()
);
create index facts_tags_idx on facts using gin (tags);
create index facts_statement_trgm_idx on facts using gin (statement gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Activity and tool-call ledger
-- ---------------------------------------------------------------------------
create table activity (
  id         bigint generated always as identity primary key,
  agent_id   uuid references agents(id),
  task_id    uuid references tasks(id) on delete cascade,
  event      text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_created_idx on activity (created_at desc);

create table tool_calls (
  id            bigint generated always as identity primary key,
  agent_id      uuid references agents(id),
  task_id       uuid references tasks(id) on delete set null,
  tool          text not null,
  ok            boolean not null default true,
  duration_ms   int,
  input_tokens  int,
  output_tokens int,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger tasks_updated_at before update on tasks for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Atomic claim with lease. Returns the task row or null.
-- ---------------------------------------------------------------------------
create or replace function claim_task(p_task_id uuid, p_agent_id uuid, p_lease_minutes int default 30)
returns tasks language plpgsql as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task_id for update skip locked;
  if not found then return null; end if;
  if t.status <> 'queued' then return null; end if;
  if t.scheduled_for is not null and t.scheduled_for > now() then return null; end if;
  if t.is_human then return null; end if;
  if t.assignee_agent_id is not null and t.assignee_agent_id <> p_agent_id then return null; end if;
  if t.assignee_capability is not null and not exists (
    select 1 from agents a where a.id = p_agent_id and t.assignee_capability = any(a.capabilities)
  ) then return null; end if;

  update tasks set status = 'claimed', claimed_by = p_agent_id,
    lease_expires_at = now() + make_interval(mins => p_lease_minutes),
    claim_count = claim_count + 1
  where id = p_task_id returning * into t;
  insert into activity (agent_id, task_id, event, detail)
    values (p_agent_id, p_task_id, 'claimed', jsonb_build_object('lease_minutes', p_lease_minutes));
  return t;
end $$;

-- Release expired leases back to the queue; after two expiries open it to a human
create or replace function expire_leases() returns int language plpgsql as $$
declare n int := 0; r record;
begin
  for r in select * from tasks where status = 'claimed' and lease_expires_at < now() for update skip locked loop
    if r.claim_count >= 2 then
      update tasks set status = 'awaiting_human', claimed_by = null, lease_expires_at = null where id = r.id;
      insert into activity (task_id, event, detail)
        values (r.id, 'escalated', jsonb_build_object('reason','lease expired twice'));
    else
      update tasks set status = 'queued', claimed_by = null, lease_expires_at = null where id = r.id;
      insert into activity (task_id, event, detail)
        values (r.id, 'lease_expired', jsonb_build_object('claim_count', r.claim_count));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Tasks visible to an agent: unclaimed and matching capability or direct assignment, plus its own claims
create or replace function tasks_for_agent(p_agent_id uuid)
returns setof tasks language sql stable as $$
  select t.* from tasks t
  join agents a on a.id = p_agent_id
  where t.is_human = false
    and (
      (t.status = 'queued'
        and (t.scheduled_for is null or t.scheduled_for <= now())
        and (t.assignee_agent_id = p_agent_id
             or (t.assignee_agent_id is null
                 and (t.assignee_capability is null or t.assignee_capability = any(a.capabilities)))))
      or (t.status in ('claimed','in_review') and t.claimed_by = p_agent_id)
    )
  order by t.priority asc, t.created_at asc
$$;

-- ---------------------------------------------------------------------------
-- RLS: signed-in humans can see and edit everything (single-tenant internal tool).
-- The server uses the service role and bypasses RLS.
-- ---------------------------------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array['agents','artifacts','loops','loop_runs','tasks','handoff_notes','facts','activity','tool_calls'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
  end loop;
end $$;

-- Never expose key hashes to the browser
revoke select (api_key_hash) on agents from authenticated, anon;

-- Realtime for the board
alter publication supabase_realtime add table tasks, activity;

-- pg_cron if available: expire leases every minute
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('agent-hub-expire-leases', '* * * * *', 'select expire_leases()');
  end if;
end $$;
