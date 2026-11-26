/**
 * The hub verbs. Every transport (MCP, REST, headless runner) calls these.
 * The service role bypasses RLS, so every read and write is filtered by the
 * acting agent's workspace.
 */
import { db, HubError, must } from "./db.js";
import { env } from "./env.js";
import { advanceLoop } from "./loops.js";
import type { Agent, Artifact, Task } from "./types.js";

function workspaceOf(agent: Agent): string {
  if (!agent.workspace_id) throw new HubError("Agent is not bound to a workspace", 403);
  return agent.workspace_id;
}

export async function logActivity(
  workspaceId: string,
  agentId: string | null,
  taskId: string | null,
  event: string,
  detail: Record<string, unknown> = {},
) {
  await db.from("activity").insert({ workspace_id: workspaceId, agent_id: agentId, task_id: taskId, event, detail });
}

async function latestArtifactsByIds(workspaceId: string, ids: string[]): Promise<Artifact[]> {
  if (!ids.length) return [];
  const { data, error } = await db.from("artifacts").select("*").eq("workspace_id", workspaceId).in("id", ids);
  if (error) throw new HubError(error.message, 500);
  return (data ?? []) as Artifact[];
}

export async function latestArtifactByKey(key: string, workspaceId: string, version?: number): Promise<Artifact | null> {
  let q = db.from("artifacts").select("*").eq("workspace_id", workspaceId).eq("key", key);
  q = version ? q.eq("version", version) : q.order("version", { ascending: false }).limit(1);
  const { data, error } = await q.maybeSingle();
  if (error) throw new HubError(error.message, 500);
  return (data as Artifact | null) ?? null;
}

async function getTaskOwned(agent: Agent, taskId: string): Promise<Task> {
  const workspaceId = workspaceOf(agent);
  const task = must(
    await db.from("tasks").select("*").eq("id", taskId).eq("workspace_id", workspaceId).maybeSingle(),
    "Task",
  ) as Task;
  if (task.workspace_id !== workspaceId || task.claimed_by !== agent.id) throw new HubError("You have not claimed this task", 403);
  return task;
}

async function taskInWorkspace(taskId: string, workspaceId: string): Promise<void> {
  const { data, error } = await db.from("tasks").select("id").eq("id", taskId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new HubError(error.message, 500);
  if (!data) throw new HubError("Task not found", 404);
}

// ---------------------------------------------------------------------------

export async function listMyTasks(agent: Agent, opts: { include_claimed?: boolean } = {}) {
  const workspaceId = workspaceOf(agent);
  const { data, error } = await db.rpc("tasks_for_agent", { p_agent_id: agent.id });
  if (error) throw new HubError(error.message, 500);
  const tasks = ((data ?? []) as Task[]).filter((task) => task.workspace_id === workspaceId);
  const filtered = opts.include_claimed === false ? tasks.filter((t) => t.status === "queued") : tasks;
  return filtered.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    capability: t.assignee_capability,
    due_at: t.due_at,
    lease_expires_at: t.lease_expires_at,
    brief_preview: t.brief.slice(0, 240),
  }));
}

export async function claimTask(agent: Agent, input: { task_id: string; lease_minutes?: number }) {
  const workspaceId = workspaceOf(agent);
  const lease = input.lease_minutes ?? env.defaultLeaseMinutes;
  const { data, error } = await db.rpc("claim_task", { p_task_id: input.task_id, p_agent_id: agent.id, p_lease_minutes: lease });
  if (error) throw new HubError(error.message, 500);
  const task = data as Task | null;
  if (!task?.id || task.workspace_id !== workspaceId) {
    throw new HubError("Task is not available to claim (already claimed, not yet scheduled, or outside your capabilities)", 409);
  }
  const inputs = await latestArtifactsByIds(workspaceId, task.input_artifact_ids);
  const parent = task.parent_task_id
    ? ((
        await db
          .from("tasks")
          .select("id,title,brief,acceptance_criteria,result_summary")
          .eq("id", task.parent_task_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle()
      ).data as Partial<Task> | null)
    : null;
  return {
    task: {
      id: task.id,
      title: task.title,
      brief: task.brief,
      acceptance_criteria: task.acceptance_criteria,
      priority: task.priority,
      due_at: task.due_at,
      lease_expires_at: task.lease_expires_at,
      review_by_capability: task.review_by_capability,
      parent_task: parent,
    },
    inputs: inputs.map((a) => ({ id: a.id, key: a.key, version: a.version, title: a.title, kind: a.kind, content: a.content, metadata: a.metadata })),
    instructions:
      "Do the work described in brief. Save any output with put_artifact (pass task_id so it is attached). Record durable findings with record_fact. Finish with complete_task including a handoff note. Call release_task if you cannot do it.",
  };
}

export async function releaseTask(agent: Agent, input: { task_id: string; reason?: string }) {
  const task = await getTaskOwned(agent, input.task_id);
  if (task.status !== "claimed") throw new HubError(`Task is ${task.status}, not claimed`, 409);
  const { error } = await db
    .from("tasks")
    .update({ status: "queued", claimed_by: null, lease_expires_at: null })
    .eq("id", task.id)
    .eq("workspace_id", task.workspace_id);
  if (error) throw new HubError(error.message, 500);
  await logActivity(task.workspace_id, agent.id, task.id, "released", { reason: input.reason ?? null });
  return { ok: true, task_id: task.id, status: "queued" };
}

export async function getArtifact(agent: Agent, input: { id?: string; key?: string; version?: number }) {
  const workspaceId = workspaceOf(agent);
  let artifact: Artifact | null = null;
  if (input.id) {
    artifact = must(
      await db.from("artifacts").select("*").eq("id", input.id).eq("workspace_id", workspaceId).maybeSingle(),
      "Artifact",
    ) as Artifact;
  } else if (input.key) {
    artifact = await latestArtifactByKey(input.key, workspaceId, input.version);
    if (!artifact) throw new HubError(`No artifact with key ${input.key}`, 404);
  } else {
    throw new HubError("Provide id or key");
  }
  if (artifact.workspace_id !== workspaceId) throw new HubError("Artifact not found", 404);
  return artifact;
}

export async function putArtifact(
  agent: Agent,
  input: { key: string; title: string; content: string; kind?: Artifact["kind"]; metadata?: Record<string, unknown>; task_id?: string },
) {
  const workspaceId = workspaceOf(agent);
  if (input.task_id) await getTaskOwned(agent, input.task_id);
  const latest = await latestArtifactByKey(input.key, workspaceId);
  const version = (latest?.version ?? 0) + 1;
  const row = {
    workspace_id: workspaceId,
    key: input.key,
    version,
    title: input.title,
    kind: input.kind ?? "markdown",
    content: input.content,
    metadata: input.metadata ?? {},
    created_by_agent: agent.id,
    task_id: input.task_id ?? null,
  };
  const artifact = must(await db.from("artifacts").insert(row).select("*").single(), "Artifact insert") as Artifact;
  if (input.task_id) {
    const task = await getTaskOwned(agent, input.task_id);
    await db
      .from("tasks")
      .update({ output_artifact_ids: [...task.output_artifact_ids, artifact.id] })
      .eq("id", task.id)
      .eq("workspace_id", workspaceId);
  }
  await logActivity(workspaceId, agent.id, input.task_id ?? null, "artifact_saved", { key: artifact.key, version, title: artifact.title });
  return { id: artifact.id, key: artifact.key, version: artifact.version, title: artifact.title };
}

export async function completeTask(
  agent: Agent,
  input: {
    task_id: string;
    summary: string;
    decisions?: string[];
    open_questions?: string[];
    suggested_next?: string;
    outcome?: "done" | "failed";
    verdict?: "approved" | "changes_requested";
  },
) {
  const task = await getTaskOwned(agent, input.task_id);
  if (task.status !== "claimed") throw new HubError(`Task is ${task.status}, not claimed`, 409);
  const workspaceId = task.workspace_id;

  await db.from("handoff_notes").insert({
    workspace_id: workspaceId,
    task_id: task.id,
    agent_id: agent.id,
    summary: input.summary,
    decisions: input.decisions ?? [],
    open_questions: input.open_questions ?? [],
    suggested_next: input.suggested_next ?? null,
  });

  const outcome = input.outcome ?? "done";
  const now = new Date().toISOString();

  if (outcome === "failed") {
    await db
      .from("tasks")
      .update({ status: "awaiting_human", claimed_by: null, lease_expires_at: null, result_summary: input.summary })
      .eq("id", task.id)
      .eq("workspace_id", workspaceId);
    await logActivity(workspaceId, agent.id, task.id, "failed", { summary: input.summary });
    return { ok: true, task_id: task.id, status: "awaiting_human" };
  }

  if (task.review_by_capability && !task.parent_task_id) {
    await db
      .from("tasks")
      .update({ status: "in_review", claimed_by: null, lease_expires_at: null, result_summary: input.summary })
      .eq("id", task.id)
      .eq("workspace_id", workspaceId);
    await db.from("tasks").insert({
      workspace_id: workspaceId,
      title: `Review: ${task.title}`,
      brief: `Review the outputs of the parent task against its acceptance criteria.\n\nParent brief:\n${task.brief}\n\nAcceptance criteria:\n${task.acceptance_criteria ?? "(none given)"}\n\nComplete this task with verdict "approved" or "changes_requested". If changes are requested, save a markdown artifact with your notes (key: review-notes) so the original agent can act on it.`,
      acceptance_criteria: "A clear verdict with reasons tied to the acceptance criteria.",
      priority: task.priority,
      assignee_capability: task.review_by_capability,
      parent_task_id: task.id,
      loop_run_id: task.loop_run_id,
      input_artifact_ids: task.output_artifact_ids,
      created_by_agent: agent.id,
    });
    await logActivity(workspaceId, agent.id, task.id, "sent_for_review", { review_by: task.review_by_capability });
    return { ok: true, task_id: task.id, status: "in_review" };
  }

  if (task.parent_task_id) {
    const parent = (
      await db.from("tasks").select("*").eq("id", task.parent_task_id).eq("workspace_id", workspaceId).maybeSingle()
    ).data as Task | null;
    await db
      .from("tasks")
      .update({ status: "done", completed_at: now, claimed_by: null, lease_expires_at: null, result_summary: input.summary })
      .eq("id", task.id)
      .eq("workspace_id", workspaceId);
    if (parent && parent.status === "in_review") {
      if (input.verdict === "changes_requested") {
        await db
          .from("tasks")
          .update({
            status: "queued",
            input_artifact_ids: Array.from(new Set([...parent.input_artifact_ids, ...task.output_artifact_ids])),
            brief: `${parent.brief}\n\n--- Reviewer requested changes ---\n${input.summary}`,
          })
          .eq("id", parent.id)
          .eq("workspace_id", workspaceId);
        await logActivity(workspaceId, agent.id, parent.id, "changes_requested", { by: agent.slug });
      } else {
        await db.from("tasks").update({ status: "done", completed_at: now }).eq("id", parent.id).eq("workspace_id", workspaceId);
        await logActivity(workspaceId, agent.id, parent.id, "approved", { by: agent.slug });
        await advanceLoop({ ...parent, status: "done" });
      }
    }
    await logActivity(workspaceId, agent.id, task.id, "completed", { verdict: input.verdict ?? null });
    return { ok: true, task_id: task.id, status: "done", parent_task_id: task.parent_task_id };
  }

  await db
    .from("tasks")
    .update({ status: "done", completed_at: now, claimed_by: null, lease_expires_at: null, result_summary: input.summary })
    .eq("id", task.id)
    .eq("workspace_id", workspaceId);
  await logActivity(workspaceId, agent.id, task.id, "completed", { outputs: task.output_artifact_ids.length });
  await advanceLoop({ ...task, status: "done" });
  return { ok: true, task_id: task.id, status: "done" };
}

export async function createTask(
  agent: Agent,
  input: {
    title: string;
    brief: string;
    acceptance_criteria?: string;
    capability?: string;
    agent_slug?: string;
    for_human?: boolean;
    priority?: number;
    due_at?: string;
    scheduled_for?: string;
    input_artifact_keys?: string[];
    review_by?: string;
    parent_task_id?: string;
  },
) {
  const workspaceId = workspaceOf(agent);
  let assigneeAgentId: string | null = null;
  if (input.agent_slug) {
    const a = (await db.from("agents").select("id").eq("workspace_id", workspaceId).eq("slug", input.agent_slug).maybeSingle()).data;
    if (!a) throw new HubError(`No agent with slug ${input.agent_slug}`, 404);
    assigneeAgentId = a.id;
  }
  if (input.parent_task_id) await taskInWorkspace(input.parent_task_id, workspaceId);
  const inputIds: string[] = [];
  for (const key of input.input_artifact_keys ?? []) {
    const a = await latestArtifactByKey(key, workspaceId);
    if (a) inputIds.push(a.id);
  }
  const row = {
    workspace_id: workspaceId,
    title: input.title,
    brief: input.brief,
    acceptance_criteria: input.acceptance_criteria ?? null,
    priority: input.priority ?? 3,
    assignee_capability: input.capability ?? null,
    assignee_agent_id: assigneeAgentId,
    is_human: input.for_human ?? false,
    status: input.for_human ? "awaiting_human" : "queued",
    due_at: input.due_at ?? null,
    scheduled_for: input.scheduled_for ?? null,
    input_artifact_ids: inputIds,
    review_by_capability: input.review_by ?? null,
    parent_task_id: input.parent_task_id ?? null,
    created_by_agent: agent.id,
  };
  const task = must(await db.from("tasks").insert(row).select("*").single(), "Task insert") as Task;
  await logActivity(workspaceId, agent.id, task.id, "created", { by: agent.slug, capability: task.assignee_capability });
  return { id: task.id, title: task.title, status: task.status };
}

export async function searchKnowledge(agent: Agent, input: { query: string; limit?: number }) {
  const workspaceId = workspaceOf(agent);
  const limit = Math.min(input.limit ?? 10, 50);
  const like = `%${input.query.replace(/[%_]/g, "\\$&")}%`;
  const [artifacts, facts, notes] = await Promise.all([
    db
      .from("artifacts")
      .select("id,key,version,title,kind,created_at,content")
      .eq("workspace_id", workspaceId)
      .or(`title.ilike.${like},content.ilike.${like}`)
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("facts")
      .select("id,statement,source_url,confidence,tags,created_at,valid_until")
      .eq("workspace_id", workspaceId)
      .ilike("statement", like)
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("handoff_notes")
      .select("id,task_id,summary,suggested_next,created_at")
      .eq("workspace_id", workspaceId)
      .ilike("summary", like)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);
  return {
    artifacts: (artifacts.data ?? []).map((a) => ({ ...a, content: a.content ? String(a.content).slice(0, 600) : null })),
    facts: facts.data ?? [],
    handoff_notes: notes.data ?? [],
  };
}

export async function recordFact(
  agent: Agent,
  input: { statement: string; source_url?: string; confidence?: number; tags?: string[]; task_id?: string; valid_until?: string },
) {
  const workspaceId = workspaceOf(agent);
  if (input.task_id) await taskInWorkspace(input.task_id, workspaceId);
  const fact = must(
    await db
      .from("facts")
      .insert({
        workspace_id: workspaceId,
        statement: input.statement,
        source_url: input.source_url ?? null,
        confidence: input.confidence ?? null,
        tags: input.tags ?? [],
        recorded_by: agent.id,
        task_id: input.task_id ?? null,
        valid_until: input.valid_until ?? null,
      })
      .select("id")
      .single(),
    "Fact insert",
  ) as { id: string };
  return { id: fact.id };
}
