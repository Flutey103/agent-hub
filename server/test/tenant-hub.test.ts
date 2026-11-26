import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createAgentWithKey, registerConnectedAgent, revokeAgentKey } from "../src/agents-admin.js";
import { hashKey, loadAgentForGrant } from "../src/auth.js";
import { resolveCapabilities } from "../src/capabilities.js";
import { setDbForTests } from "../src/db.js";
import { HubError } from "../src/db.js";
import * as hub from "../src/hub.js";
import { completeHumanTask, startLoop } from "../src/loops.js";
import type { Agent } from "../src/types.js";
import { MemoryDb } from "./memory-db.js";

const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function agent(id: string, workspaceId: string, slug: string): Agent {
  return {
    id,
    slug,
    name: slug,
    provider: "other",
    model: null,
    mode: "connected",
    capabilities: ["editing"],
    system_prompt: null,
    is_active: true,
    workspace_id: workspaceId,
    created_by: workspaceId === WS_A ? USER_A : USER_B,
    oauth_client_id: null,
  };
}

test("server queries refuse another workspace", async () => {
  const memory = new MemoryDb();
  setDbForTests(memory.client() as never);
  const agentA = agent("agent-a", WS_A, "alpha");
  const agentB = agent("agent-b", WS_B, "beta");
  memory.rows("agents").push({ ...agentA }, { ...agentB });
  memory.rows("workspace_members").push(
    { workspace_id: WS_A, user_id: USER_A, role: "owner" },
    { workspace_id: WS_B, user_id: USER_B, role: "owner" },
  );
  memory.rows("artifacts").push(
    { id: "art-b", workspace_id: WS_B, key: "brand-voice", version: 3, title: "Secret", content: "tenant b only", kind: "markdown" },
    { id: "art-a", workspace_id: WS_A, key: "brand-voice", version: 1, title: "Ours", content: "tenant a", kind: "markdown" },
  );
  memory.rows("facts").push({ id: "fact-b", workspace_id: WS_B, statement: "secret-brand-fact", source_url: null });
  memory.rows("handoff_notes").push({ id: "note-b", workspace_id: WS_B, summary: "secret-brand-fact", task_id: "task-b" });
  memory.rows("tasks").push({
    id: "task-b",
    workspace_id: WS_B,
    title: "Foreign",
    brief: "do not touch",
    status: "queued",
    claimed_by: null,
    is_human: false,
    assignee_capability: "editing",
    input_artifact_ids: [],
    output_artifact_ids: [],
    priority: 3,
  });
  memory.rows("loops").push({
    id: "loop-a",
    workspace_id: WS_A,
    slug: "weekly",
    name: "Weekly",
    description: null,
    cron: null,
    next_run_at: null,
    is_active: true,
    stages: [{ name: "Write", brief: "Write it", capability: "editing" }],
  });

  await assert.rejects(() => hub.getArtifact(agentA, { id: "art-b" }), (error: unknown) => error instanceof HubError && error.status === 404);
  const own = await hub.getArtifact(agentA, { key: "brand-voice" });
  assert.equal(own.id, "art-a");
  assert.equal(own.content, "tenant a");

  const found = await hub.searchKnowledge(agentA, { query: "secret-brand" });
  assert.deepEqual(found.artifacts, []);
  assert.deepEqual(found.facts, []);
  assert.deepEqual(found.handoff_notes, []);

  await assert.rejects(() => hub.createTask(agentA, { title: "cross", brief: "no", agent_slug: "beta" }), (error: unknown) => error instanceof HubError);
  assert.equal(memory.rows("tasks").some((row) => row.title === "cross"), false);

  await assert.rejects(() => hub.putArtifact(agentA, { key: "notes", title: "Notes", content: "x", task_id: "task-b" }), (error: unknown) => error instanceof HubError);
  assert.equal(memory.rows("artifacts").some((row) => row.workspace_id === WS_B && row.key === "notes"), false);
  assert.equal(memory.rows("artifacts").some((row) => row.key === "notes"), false);

  await assert.rejects(() => hub.recordFact(agentA, { statement: "nope", task_id: "task-b" }), (error: unknown) => error instanceof HubError);
  assert.equal(memory.rows("facts").some((row) => row.statement === "nope"), false);
  const recorded = await hub.recordFact(agentA, { statement: "ours" });
  assert.equal(memory.rows("facts").find((row) => row.id === recorded.id)?.workspace_id, WS_A);

  await assert.rejects(() => hub.releaseTask(agentA, { task_id: "task-b" }), (error: unknown) => error instanceof HubError);
  await assert.rejects(() => hub.completeTask(agentA, { task_id: "task-b", summary: "stolen" }), (error: unknown) => error instanceof HubError);
  assert.equal(memory.rows("tasks").find((row) => row.id === "task-b")?.status, "queued");

  const claim = await hub.claimTask(agentA, { task_id: "task-b" }).catch((error: unknown) => error);
  assert.ok(claim instanceof HubError);
  assert.equal(memory.rows("tasks").find((row) => row.id === "task-b")?.status, "queued");

  memory.rows("tasks").push({
    id: "task-a",
    workspace_id: WS_A,
    title: "Mine",
    brief: "do this work please",
    status: "queued",
    claimed_by: null,
    is_human: false,
    assignee_capability: "editing",
    input_artifact_ids: [],
    output_artifact_ids: [],
    priority: 1,
  });
  const listed = await hub.listMyTasks(agentA, { include_claimed: false });
  assert.deepEqual(listed.map((task) => task.id), ["task-a"]);

  await assert.rejects(() => completeHumanTask("task-a", "done", { id: USER_B, email: "b@example.com" }), (error: unknown) => error instanceof HubError && error.status === 404);
  assert.equal(memory.rows("tasks").find((row) => row.id === "task-a")?.status, "queued");
  await assert.rejects(() => startLoop("loop-a", { userId: USER_B }), (error: unknown) => error instanceof HubError && error.status === 404);
  assert.equal(memory.rows("loop_runs").length, 0);

  assert.equal(await loadAgentForGrant({ agentId: "agent-a", workspaceId: WS_B, userId: USER_B }), null);
  const loaded = await loadAgentForGrant({ agentId: "agent-a", workspaceId: WS_A, userId: USER_A });
  assert.equal(loaded?.id, "agent-a");

  const created = await createAgentWithKey({ userId: USER_A, workspaceId: WS_A, name: "Keyed", preset: "research" });
  assert.notEqual(created.apiKey, memory.rows("agents").find((row) => row.id === created.agent.id)?.api_key_hash);
  assert.equal(memory.rows("agents").find((row) => row.id === created.agent.id)?.api_key_hash, hashKey(created.apiKey));
  assert.equal(created.agent.workspace_id, WS_A);
  assert.deepEqual(created.agent.capabilities, resolveCapabilities("research"));
  await revokeAgentKey(USER_A, WS_A, created.agent.id);
  assert.equal(memory.rows("agents").find((row) => row.id === created.agent.id)?.api_key_hash, null);
  await assert.rejects(() => revokeAgentKey(USER_B, WS_B, created.agent.id), (error: unknown) => error instanceof HubError && error.status === 404);

  const connected = await registerConnectedAgent({
    userId: USER_A,
    workspaceId: WS_A,
    name: "Claude",
    clientId: "client-1",
    clientName: "Claude",
  });
  assert.equal(connected.oauth_client_id, "client-1");
  assert.equal(connected.workspace_id, WS_A);
  assert.equal(connected.provider, "anthropic");
  assert.ok(connected.capabilities.includes("social-copy"));
  await assert.rejects(
    () => registerConnectedAgent({ userId: USER_A, workspaceId: WS_B, name: "Nope", clientId: "client-2", clientName: "Grok" }),
    (error: unknown) => error instanceof HubError && error.status === 404,
  );
});

after(() => setDbForTests(null));
