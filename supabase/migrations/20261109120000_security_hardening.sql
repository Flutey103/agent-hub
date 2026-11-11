-- Security hardening applied on the live database after the initial migration.
-- Safe to re-run: grants and search_path pins are idempotent, and the extension
-- move no-ops when pg_trgm is already in the extensions schema.
--
-- 1. Column privileges so anon/authenticated cannot read or write agents.api_key_hash.
--    Table-level SELECT cannot be narrowed with a column REVOKE (PostgreSQL ORs
--    table and column privileges), so table SELECT/INSERT/UPDATE are replaced
--    with grants that list every column except the hash.
-- 2. Pin search_path on hub functions. Empty search_path would break them
--    because the bodies use unqualified public table names, so the pin is `public`
--    (pg_catalog is still searched implicitly).
-- 3. Move pg_trgm out of public into the extensions schema without dropping the
--    gin indexes that depend on it.

-- ---------------------------------------------------------------------------
-- agents.api_key_hash
-- ---------------------------------------------------------------------------
revoke select, insert, update on table public.agents from public, anon, authenticated;
revoke delete on table public.agents from anon;

grant select (
  id,
  slug,
  name,
  provider,
  model,
  mode,
  capabilities,
  system_prompt,
  is_active,
  last_seen_at,
  created_at
) on table public.agents to anon, authenticated;

grant insert (
  slug,
  name,
  provider,
  model,
  mode,
  capabilities,
  system_prompt,
  is_active
) on table public.agents to authenticated;

grant update (
  slug,
  name,
  provider,
  model,
  mode,
  capabilities,
  system_prompt,
  is_active,
  last_seen_at
) on table public.agents to authenticated;

revoke select (api_key_hash), insert (api_key_hash), update (api_key_hash) on table public.agents from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pinned search_path
-- ---------------------------------------------------------------------------
alter function public.set_updated_at() set search_path = public;
alter function public.claim_task(uuid, uuid, integer) set search_path = public;
alter function public.expire_leases() set search_path = public;
alter function public.tasks_for_agent(uuid) set search_path = public;

-- ---------------------------------------------------------------------------
-- pg_trgm -> extensions
-- ---------------------------------------------------------------------------
create schema if not exists extensions;

do $$
declare
  ext_schema text;
begin
  select n.nspname into ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if ext_schema is null then
    execute 'create extension pg_trgm schema extensions';
  elsif ext_schema <> 'extensions' then
    execute 'alter extension pg_trgm set schema extensions';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema extensions to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema extensions to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema extensions to service_role;
  end if;
end $$;
