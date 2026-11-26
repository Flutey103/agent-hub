-- Multi-tenant workspaces.
-- The service role bypasses RLS, so the worker must also scope every query by
-- workspace_id. These policies are the guarantee for the browser (anon key).
--
-- Expects empty tenant tables: there is no backfill. Applying this on a
-- database that already has agents, tasks, artifacts, loops, or facts fails
-- on purpose.

do $$
begin
  if exists (select 1 from public.agents)
     or exists (select 1 from public.tasks)
     or exists (select 1 from public.artifacts)
     or exists (select 1 from public.loops)
     or exists (select 1 from public.facts) then
    raise exception '20261126120000_workspaces expects empty tenant tables. Refusing to add workspace_id without a backfill.';
  end if;
end $$;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Workspaces and membership
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index workspaces_created_by_idx on public.workspaces (created_by);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('owner', 'admin', 'member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Membership lookups used by RLS. security definer so the policy does not
-- recurse through workspace_members. The only identity it trusts is auth.uid().
create or replace function private.is_member(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.member_role(p_workspace uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = p_workspace
    and m.user_id = (select auth.uid());
$$;

revoke all on function private.is_member(uuid) from public;
revoke all on function private.member_role(uuid) from public;
grant execute on function private.is_member(uuid) to authenticated, service_role;
grant execute on function private.member_role(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Personal workspace on signup, and on demand for the first API call
-- ---------------------------------------------------------------------------
create or replace function private.provision_personal_workspace(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
  ws_slug text;
  ws_name text;
  user_email text;
  meta jsonb;
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;
  -- session_user is the logged-in role. current_user would be the owner
  -- because this function is security definer.
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if auth.uid() is null and session_user not in ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  ws_slug := 'personal-' || substr(replace(p_user_id::text, '-', ''), 1, 12);

  select w.id into existing from public.workspaces w where w.slug = ws_slug;
  if existing is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (existing, p_user_id, 'owner')
    on conflict (workspace_id, user_id) do nothing;
    return existing;
  end if;

  select u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb)
    into user_email, meta
  from auth.users u
  where u.id = p_user_id;

  ws_name := coalesce(
    nullif(btrim(meta->>'full_name'), ''),
    nullif(btrim(meta->>'name'), ''),
    nullif(split_part(coalesce(user_email, ''), '@', 1), ''),
    'Personal'
  );
  ws_name := left(ws_name, 60) || '''s workspace';

  insert into public.workspaces (name, slug, created_by)
  values (ws_name, ws_slug, p_user_id)
  returning id into existing;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (existing, p_user_id, 'owner');
  return existing;
exception
  when unique_violation then
    select w.id into existing from public.workspaces w where w.slug = ws_slug;
    insert into public.workspace_members (workspace_id, user_id, role)
    values (existing, p_user_id, 'owner')
    on conflict (workspace_id, user_id) do nothing;
    return existing;
end $$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_personal_workspace(new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

revoke all on function private.provision_personal_workspace(uuid) from public;
revoke all on function private.handle_new_user() from public;
grant execute on function private.provision_personal_workspace(uuid) to service_role;

create or replace function public.ensure_personal_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return private.provision_personal_workspace(uid);
end $$;

create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ws uuid;
  base text;
  ws_slug text;
  clean text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  clean := btrim(coalesce(p_name, ''));
  if char_length(clean) < 1 or char_length(clean) > 80 then
    raise exception 'workspace name must be 1-80 characters';
  end if;
  base := btrim(regexp_replace(lower(clean), '[^a-z0-9]+', '-', 'g'), '-');
  if base = '' then
    base := 'workspace';
  end if;
  base := left(base, 40);
  ws_slug := base || '-' || substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8);
  insert into public.workspaces (name, slug, created_by)
  values (clean, ws_slug, uid)
  returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, uid, 'owner');
  return ws;
end $$;

revoke all on function public.ensure_personal_workspace() from public, anon;
revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.ensure_personal_workspace() to authenticated;
grant execute on function public.create_workspace(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant execute on function private.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- workspace_id on every tenant table. Slugs and artifact keys are unique
-- inside a workspace, not globally.
-- ---------------------------------------------------------------------------
alter table public.agents add column workspace_id uuid not null references public.workspaces (id) on delete cascade;
alter table public.agents add column created_by uuid references auth.users (id) on delete set null;
alter table public.agents add column oauth_client_id text;
alter table public.agents add column has_api_key boolean generated always as (api_key_hash is not null) stored;
create index agents_created_by_idx on public.agents (created_by);
create index agents_oauth_client_idx on public.agents (workspace_id, oauth_client_id) where oauth_client_id is not null;
comment on column public.agents.created_by is 'User who created this agent. OAuth connectors and API keys set it; it is the agent owner.';
comment on column public.agents.oauth_client_id is 'OAuth client id when the agent was registered from a connector approval.';
comment on column public.agents.has_api_key is 'True when a revocable ah_ key hash is stored. The hash itself is not readable by the browser.';

alter table public.agents drop constraint agents_slug_key;
alter table public.agents add constraint agents_workspace_slug_key unique (workspace_id, slug);

alter table public.artifacts add column workspace_id uuid not null references public.workspaces (id) on delete cascade;
alter table public.artifacts drop constraint artifacts_key_version_key;
alter table public.artifacts add constraint artifacts_workspace_key_version_key unique (workspace_id, key, version);

alter table public.loops add column workspace_id uuid not null references public.workspaces (id) on delete cascade;
alter table public.loops drop constraint loops_slug_key;
alter table public.loops add constraint loops_workspace_slug_key unique (workspace_id, slug);

alter table public.loop_runs add column workspace_id uuid not null references public.workspaces (id) on delete cascade;
create index loop_runs_workspace_idx on public.loop_runs (workspace_id);

alter table public.tasks add column workspace_id uuid not null references public.workspaces (id) on delete cascade;
create index tasks_workspace_idx on public.tasks (workspace_id, status, priority, created_at);

alter table public.handoff_notes add column workspace_id uuid not null references public.workspaces (id) on delete cascade;
create index handoff_notes_workspace_idx on public.handoff_notes (workspace_id);

alter table public.facts add column workspace_id uuid not null references public.workspaces (id) on delete cascade;
create index facts_workspace_idx on public.facts (workspace_id);

alter table public.activity add column workspace_id uuid not null references public.workspaces (id) on delete cascade;
create index activity_workspace_idx on public.activity (workspace_id, created_at desc);

alter table public.tool_calls add column workspace_id uuid not null references public.workspaces (id) on delete cascade;
create index tool_calls_workspace_idx on public.tool_calls (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Refuse cross-workspace references, including writes from the service role
-- (RLS does not apply to it). workspace_id itself cannot be moved.
-- ---------------------------------------------------------------------------
create or replace function private.workspace_of(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_id is null then
    return null;
  end if;
  case p_kind
    when 'agent' then
      return (select workspace_id from public.agents where id = p_id);
    when 'task' then
      return (select workspace_id from public.tasks where id = p_id);
    when 'loop' then
      return (select workspace_id from public.loops where id = p_id);
    when 'loop_run' then
      return (select workspace_id from public.loop_runs where id = p_id);
    else
      raise exception 'unknown relation %', p_kind;
  end case;
end $$;

create or replace function private.enforce_tenant_boundary()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_ws uuid;
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id cannot be changed' using errcode = '42501';
  end if;
  if new.workspace_id is null then
    raise exception 'workspace_id is required' using errcode = '23502';
  end if;

  if tg_table_name = 'agents' and tg_op = 'INSERT' then
    if new.created_by is not null and auth.uid() is not null and new.created_by is distinct from auth.uid() then
      raise exception 'created_by must be the signed-in user' using errcode = '42501';
    end if;
  end if;

  if tg_table_name = 'tasks' then
    parent_ws := private.workspace_of('agent', new.assignee_agent_id);
    if new.assignee_agent_id is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
    parent_ws := private.workspace_of('agent', new.claimed_by);
    if new.claimed_by is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
    parent_ws := private.workspace_of('agent', new.created_by_agent);
    if new.created_by_agent is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
    parent_ws := private.workspace_of('task', new.parent_task_id);
    if new.parent_task_id is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
    parent_ws := private.workspace_of('loop_run', new.loop_run_id);
    if new.loop_run_id is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
  elsif tg_table_name = 'artifacts' then
    parent_ws := private.workspace_of('agent', new.created_by_agent);
    if new.created_by_agent is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
    parent_ws := private.workspace_of('task', new.task_id);
    if new.task_id is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
  elsif tg_table_name = 'facts' then
    parent_ws := private.workspace_of('agent', new.recorded_by);
    if new.recorded_by is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
    parent_ws := private.workspace_of('task', new.task_id);
    if new.task_id is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
  elsif tg_table_name = 'handoff_notes' then
    parent_ws := private.workspace_of('task', new.task_id);
    if parent_ws is null or parent_ws <> new.workspace_id then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
    parent_ws := private.workspace_of('agent', new.agent_id);
    if new.agent_id is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
  elsif tg_table_name = 'loop_runs' then
    parent_ws := private.workspace_of('loop', new.loop_id);
    if parent_ws is null or parent_ws <> new.workspace_id then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
  elsif tg_table_name = 'activity' or tg_table_name = 'tool_calls' then
    parent_ws := private.workspace_of('task', new.task_id);
    if new.task_id is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
    parent_ws := private.workspace_of('agent', new.agent_id);
    if new.agent_id is not null and (parent_ws is null or parent_ws <> new.workspace_id) then
      raise exception 'cross-workspace reference refused' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

revoke all on function private.workspace_of(text, uuid) from public;
revoke all on function private.enforce_tenant_boundary() from public;
grant execute on function private.workspace_of(text, uuid) to authenticated, service_role;
grant execute on function private.enforce_tenant_boundary() to authenticated, service_role;

do $$ declare t text;
begin
  foreach t in array array['agents','artifacts','loops','loop_runs','tasks','handoff_notes','facts','activity','tool_calls'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.enforce_tenant_boundary()', t || '_tenant_boundary', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Hub functions. Return type of tasks changes with the new column, so the
-- functions that return tasks are dropped and recreated.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_task(uuid, uuid, integer);
drop function if exists public.tasks_for_agent(uuid);

create function public.claim_task(p_task_id uuid, p_agent_id uuid, p_lease_minutes int default 30)
returns public.tasks
language plpgsql
set search_path = public
as $$
declare
  t public.tasks;
  agent_ws uuid;
begin
  select workspace_id into agent_ws from agents where id = p_agent_id;
  if agent_ws is null then
    return null;
  end if;

  select * into t from tasks where id = p_task_id and workspace_id = agent_ws for update skip locked;
  if not found then return null; end if;
  if t.status <> 'queued' then return null; end if;
  if t.scheduled_for is not null and t.scheduled_for > now() then return null; end if;
  if t.is_human then return null; end if;
  if t.assignee_agent_id is not null and t.assignee_agent_id <> p_agent_id then return null; end if;
  if t.assignee_capability is not null and not exists (
    select 1 from agents a
    where a.id = p_agent_id
      and a.workspace_id = agent_ws
      and t.assignee_capability = any(a.capabilities)
  ) then return null; end if;

  update tasks set
    status = 'claimed',
    claimed_by = p_agent_id,
    lease_expires_at = now() + make_interval(mins => p_lease_minutes),
    claim_count = claim_count + 1
  where id = p_task_id and workspace_id = agent_ws
  returning * into t;

  insert into activity (workspace_id, agent_id, task_id, event, detail)
    values (agent_ws, p_agent_id, p_task_id, 'claimed', jsonb_build_object('lease_minutes', p_lease_minutes));
  return t;
end $$;

create function public.tasks_for_agent(p_agent_id uuid)
returns setof public.tasks
language sql
stable
set search_path = public
as $$
  select t.*
  from tasks t
  join agents a on a.id = p_agent_id and t.workspace_id = a.workspace_id
  where t.is_human = false
    and (
      (t.status = 'queued'
        and (t.scheduled_for is null or t.scheduled_for <= now())
        and (t.assignee_agent_id = p_agent_id
             or (t.assignee_agent_id is null
                 and (t.assignee_capability is null or t.assignee_capability = any(a.capabilities)))))
      or (t.status in ('claimed', 'in_review') and t.claimed_by = p_agent_id)
    )
  order by t.priority asc, t.created_at asc
$$;

create or replace function public.expire_leases()
returns int
language plpgsql
set search_path = public
as $$
declare
  n int := 0;
  r record;
begin
  for r in
    select * from tasks
    where status = 'claimed' and lease_expires_at < now()
    for update skip locked
  loop
    if r.claim_count >= 2 then
      update tasks set status = 'awaiting_human', claimed_by = null, lease_expires_at = null
      where id = r.id and workspace_id = r.workspace_id;
      insert into activity (workspace_id, task_id, event, detail)
        values (r.workspace_id, r.id, 'escalated', jsonb_build_object('reason', 'lease expired twice'));
    else
      update tasks set status = 'queued', claimed_by = null, lease_expires_at = null
      where id = r.id and workspace_id = r.workspace_id;
      insert into activity (workspace_id, task_id, event, detail)
        values (r.workspace_id, r.id, 'lease_expired', jsonb_build_object('claim_count', r.claim_count));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.claim_task(uuid, uuid, integer) from public, anon;
revoke all on function public.tasks_for_agent(uuid) from public, anon;
revoke all on function public.expire_leases() from public, anon;
grant execute on function public.claim_task(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.tasks_for_agent(uuid) to authenticated, service_role;
grant execute on function public.expire_leases() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS. Membership, not "any authenticated user".
-- ---------------------------------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array['agents','artifacts','loops','loop_runs','tasks','handoff_notes','facts','activity','tool_calls'] loop
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.is_member(workspace_id))) with check ((select private.is_member(workspace_id)))',
      t || '_member_all',
      t
    );
  end loop;
end $$;

alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_members force row level security;

create policy workspaces_select on public.workspaces
  for select to authenticated
  using ((select private.is_member(id)));

create policy workspaces_update on public.workspaces
  for update to authenticated
  using ((select private.member_role(id)) in ('owner', 'admin'))
  with check ((select private.member_role(id)) in ('owner', 'admin'));

create policy workspaces_delete on public.workspaces
  for delete to authenticated
  using ((select private.member_role(id)) = 'owner');

create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using ((select private.is_member(workspace_id)) or user_id = (select auth.uid()));

create policy workspace_members_insert on public.workspace_members
  for insert to authenticated
  with check ((select private.member_role(workspace_id)) in ('owner', 'admin'));

create policy workspace_members_update on public.workspace_members
  for update to authenticated
  using ((select private.member_role(workspace_id)) in ('owner', 'admin'))
  with check ((select private.member_role(workspace_id)) in ('owner', 'admin'));

create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using ((select private.member_role(workspace_id)) in ('owner', 'admin'));

-- Direct inserts into workspaces go through create_workspace() / the signup
-- trigger, both security definer. There is no insert policy on purpose.

-- ---------------------------------------------------------------------------
-- Grants. New tables are not exposed to the Data API unless granted.
-- api_key_hash stays hidden. New agent columns are granted explicitly because
-- agents uses column privileges, and a new column is not covered by those.
-- ---------------------------------------------------------------------------
grant select (workspace_id, created_by, oauth_client_id, has_api_key) on table public.agents to authenticated;
grant insert (workspace_id, created_by) on table public.agents to authenticated;

revoke select (
  id, slug, name, provider, model, mode, capabilities, system_prompt, is_active, last_seen_at, created_at
) on table public.agents from anon;

grant select, insert, update, delete on
  public.tasks,
  public.artifacts,
  public.loops,
  public.loop_runs,
  public.handoff_notes,
  public.facts,
  public.activity,
  public.tool_calls,
  public.workspaces,
  public.workspace_members
to authenticated;

grant select, insert, update, delete on
  public.agents,
  public.tasks,
  public.artifacts,
  public.loops,
  public.loop_runs,
  public.handoff_notes,
  public.facts,
  public.activity,
  public.tool_calls,
  public.workspaces,
  public.workspace_members
to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

revoke all on
  public.workspaces,
  public.workspace_members
from anon;
