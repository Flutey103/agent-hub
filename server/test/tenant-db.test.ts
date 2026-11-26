import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const root = resolve(import.meta.dirname, "../..");

async function database(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create publication supabase_realtime;
  `);
  for (const file of [
    "supabase/migrations/20261109000000_init.sql",
    "supabase/migrations/20261109120000_security_hardening.sql",
    "supabase/migrations/20261126120000_workspaces.sql",
  ]) {
    await db.exec(readFileSync(resolve(root, file), "utf8"));
  }
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
      ($1, 'ada@example.com', '{"full_name":"Ada"}'),
      ($2, 'bea@example.com', '{"full_name":"Bea"}')`,
    [USER_A, USER_B],
  );
  return db;
}

test("RLS and hub functions refuse cross-tenant access", { timeout: 120_000 }, async () => {
  const db = await database();
  const workspaces = await db.query<{ id: string; slug: string; created_by: string }>(
    "select id, slug, created_by from workspaces order by slug",
  );
  assert.equal(workspaces.rows.length, 2);
  const workspaceA = workspaces.rows.find((row) => row.created_by === USER_A);
  const workspaceB = workspaces.rows.find((row) => row.created_by === USER_B);
  assert.ok(workspaceA && workspaceB);
  assert.equal(workspaceA.slug, "personal-111111111111");

  const again = await db.query<{ id: string }>("select private.provision_personal_workspace($1::uuid) as id", [USER_A]);
  assert.equal(again.rows[0].id, workspaceA.id);
  const count = await db.query<{ n: number }>("select count(*)::int as n from workspaces where created_by = $1", [USER_A]);
  assert.equal(count.rows[0].n, 1);

  const agentA = await db.query<{ id: string }>(
    `insert into agents (workspace_id, slug, name, provider, capabilities, api_key_hash)
     values ($1, 'alpha', 'Alpha', 'other', array['editing'], 'hash-a') returning id`,
    [workspaceA.id],
  );
  const agentB = await db.query<{ id: string }>(
    `insert into agents (workspace_id, slug, name, provider, capabilities)
     values ($1, 'alpha', 'Beta', 'other', array['editing']) returning id`,
    [workspaceB.id],
  );
  const taskA = await db.query<{ id: string }>(
    `insert into tasks (workspace_id, title, brief, assignee_capability) values ($1, 'A task', 'do it', 'editing') returning id`,
    [workspaceA.id],
  );
  const taskB = await db.query<{ id: string }>(
    `insert into tasks (workspace_id, title, brief) values ($1, 'B task', 'leave it') returning id`,
    [workspaceB.id],
  );
  await db.query(`insert into artifacts (workspace_id, key, title, content) values ($1, 'brand-voice', 'Voice', 'a'), ($2, 'brand-voice', 'Voice', 'b')`, [
    workspaceA.id,
    workspaceB.id,
  ]);
  await db.query(`insert into facts (workspace_id, statement) values ($1, 'fact a')`, [workspaceA.id]);
  await db.query(`insert into handoff_notes (workspace_id, task_id, summary) values ($1, $2, 'note a')`, [workspaceA.id, taskA.rows[0].id]);
  await db.query(`insert into loops (workspace_id, slug, name, stages) values ($1, 'weekly', 'Weekly', '[]'::jsonb)`, [workspaceA.id]);
  const loop = await db.query<{ id: string }>("select id from loops where workspace_id = $1", [workspaceA.id]);
  await db.query(`insert into loop_runs (workspace_id, loop_id) values ($1, $2)`, [workspaceA.id, loop.rows[0].id]);
  await db.query(`insert into activity (workspace_id, task_id, event) values ($1, $2, 'created')`, [workspaceA.id, taskA.rows[0].id]);
  await db.query(`insert into tool_calls (workspace_id, tool) values ($1, 'list_my_tasks')`, [workspaceA.id]);

  const tables = ["tasks", "artifacts", "facts", "handoff_notes", "loops", "loop_runs", "activity", "tool_calls", "agents"] as const;
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USER_B]);
    await tx.exec("set local role authenticated");
    for (const table of tables) {
      const seen: { rows: { n: number }[] } = await tx.query<{ n: number }>(`select count(*)::int as n from ${table} where workspace_id = $1`, [workspaceA.id]);
      assert.equal(seen.rows[0].n, 0, `user B can see workspace A ${table}`);
    }
    const ownTask = await tx.query<{ n: number }>("select count(*)::int as n from tasks where id = $1", [taskB.rows[0].id]);
    assert.equal(ownTask.rows[0].n, 1);
    const updated = await tx.query("update tasks set title = 'hacked' where id = $1", [taskA.rows[0].id]);
    assert.equal(updated.affectedRows ?? 0, 0);
    await assert.rejects(() => tx.query(`insert into tasks (workspace_id, title, brief) values ($1, 'intrusion', 'no')`, [workspaceA.id]));
    await assert.rejects(() => tx.query("select api_key_hash from agents"));
  });

  const untouched = await db.query<{ title: string }>("select title from tasks where id = $1", [taskA.rows[0].id]);
  assert.equal(untouched.rows[0].title, "A task");

  await db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USER_A]);
    await tx.exec("set local role authenticated");
    const seen = await tx.query<{ n: number }>("select count(*)::int as n from tasks");
    assert.equal(seen.rows[0].n, 1);
    const inserted = await tx.query<{ id: string }>(
      `insert into tasks (workspace_id, title, brief) values ($1, 'mine', 'yes') returning id`,
      [workspaceA.id],
    );
    assert.ok(inserted.rows[0].id);
    const hidden = await tx.query<{ n: number }>("select count(*)::int as n from workspaces where id = $1", [workspaceB.id]);
    assert.equal(hidden.rows[0].n, 0);
    const members = await tx.query<{ n: number }>("select count(*)::int as n from workspace_members where user_id = $1", [USER_B]);
    assert.equal(members.rows[0].n, 0);
    const badge = await tx.query<{ has_api_key: boolean }>("select has_api_key from agents where id = $1", [agentA.rows[0].id]);
    assert.equal(badge.rows[0].has_api_key, true);
    const ensured = await tx.query<{ id: string }>("select ensure_personal_workspace() as id");
    assert.equal(ensured.rows[0].id, workspaceA.id);
    const createdWs = await tx.query<{ id: string }>("select create_workspace('Acme Lab') as id");
    assert.ok(createdWs.rows[0].id);
  });

  await db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USER_B]);
    await tx.exec("set local role authenticated");
    const foreign = await tx.query<{ n: number }>("select count(*)::int as n from workspaces where name = 'Acme Lab'");
    assert.equal(foreign.rows[0].n, 0);
  });

  const crossClaim = await db.query<{ id: string | null }>("select (claim_task($1, $2, 30)).id as id", [taskB.rows[0].id, agentA.rows[0].id]);
  assert.equal(crossClaim.rows[0].id, null);
  const stillQueued = await db.query<{ status: string }>("select status from tasks where id = $1", [taskB.rows[0].id]);
  assert.equal(stillQueued.rows[0].status, "queued");

  const visible = await db.query<{ id: string }>("select id from tasks_for_agent($1)", [agentA.rows[0].id]);
  assert.ok(visible.rows.some((row) => row.id === taskA.rows[0].id));
  assert.equal(visible.rows.some((row) => row.id === taskB.rows[0].id), false);

  const claimed = await db.query<{ id: string | null }>("select (claim_task($1, $2, 30)).id as id", [taskA.rows[0].id, agentA.rows[0].id]);
  assert.equal(claimed.rows[0].id, taskA.rows[0].id);

  await assert.rejects(() => db.query("update tasks set claimed_by = $1 where id = $2", [agentA.rows[0].id, taskB.rows[0].id]));
  await assert.rejects(() =>
    db.query("insert into facts (workspace_id, statement, task_id) values ($1, 'no', $2)", [workspaceA.id, taskB.rows[0].id]),
  );

  await db.query(
    `update tasks set status = 'claimed', claimed_by = $1, lease_expires_at = now() - interval '1 minute', claim_count = 1 where id = $2`,
    [agentB.rows[0].id, taskB.rows[0].id],
  );
  const expired = await db.query<{ n: number }>("select expire_leases() as n");
  assert.ok(expired.rows[0].n >= 1);
  const activity = await db.query<{ workspace_id: string }>(
    "select workspace_id from activity where task_id = $1 and event = 'lease_expired'",
    [taskB.rows[0].id],
  );
  assert.equal(activity.rows[0].workspace_id, workspaceB.id);

  await db.close();
});
