/**
 * Loop engine: turns a loop template into a chain of tasks, one stage at a time.
 * Every row stays in the loop's workspace. A human caller must be a member.
 */
import { CronExpressionParser } from "cron-parser";
import { db, HubError, must } from "./db.js";
import { latestArtifactByKey, logActivity } from "./hub.js";
import { requireMembership } from "./tenant.js";
import type { Loop, LoopRun, LoopStage, Task } from "./types.js";

export function nextRunFromCron(cron: string, from = new Date()): Date | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: from }).next().toDate();
  } catch {
    return null;
  }
}

export async function createStageTask(loop: Loop, run: LoopRun, stageIndex: number, carriedArtifactIds: string[]) {
  const stage: LoopStage | undefined = loop.stages[stageIndex];
  if (!stage) throw new HubError(`Loop ${loop.slug} has no stage ${stageIndex}`);
  const workspaceId = loop.workspace_id;
  if (run.workspace_id !== workspaceId) throw new HubError("Loop run is in a different workspace", 409);

  const inputIds = [...carriedArtifactIds];
  for (const key of stage.inputs ?? []) {
    const a = await latestArtifactByKey(key, workspaceId);
    if (a) inputIds.push(a.id);
  }

  let assigneeAgentId: string | null = null;
  if (stage.agent) {
    const a = (await db.from("agents").select("id").eq("workspace_id", workspaceId).eq("slug", stage.agent).maybeSingle()).data;
    if (!a) throw new HubError(`Loop ${loop.slug} stage ${stageIndex} names unknown agent ${stage.agent}`);
    assigneeAgentId = a.id;
  }

  const isHuman = stage.human === true;
  const task = must(
    await db
      .from("tasks")
      .insert({
        workspace_id: workspaceId,
        title: `${loop.name}: ${stage.name}`,
        brief: stage.brief,
        acceptance_criteria: stage.acceptance ?? null,
        status: isHuman ? "awaiting_human" : "queued",
        assignee_capability: stage.capability ?? null,
        assignee_agent_id: assigneeAgentId,
        is_human: isHuman,
        loop_run_id: run.id,
        stage_index: stageIndex,
        review_by_capability: stage.review_by ?? null,
        input_artifact_ids: Array.from(new Set(inputIds)),
      })
      .select("*")
      .single(),
    "Stage task insert",
  ) as Task;

  await db.from("loop_runs").update({ current_stage: stageIndex }).eq("id", run.id).eq("workspace_id", workspaceId);
  await logActivity(workspaceId, null, task.id, "stage_opened", { loop: loop.slug, stage: stage.name, index: stageIndex });
  return task;
}

/** Called when a task reaches done. Opens the next stage or closes the run. */
export async function advanceLoop(task: Task) {
  if (!task.loop_run_id || task.stage_index === null || !task.workspace_id) return;
  const run = (
    await db.from("loop_runs").select("*").eq("id", task.loop_run_id).eq("workspace_id", task.workspace_id).maybeSingle()
  ).data as LoopRun | null;
  if (!run || run.status !== "running") return;
  const loop = (await db.from("loops").select("*").eq("id", run.loop_id).eq("workspace_id", task.workspace_id).maybeSingle()).data as Loop | null;
  if (!loop) return;

  const next = task.stage_index + 1;
  if (next >= loop.stages.length) {
    await db.from("loop_runs").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", run.id).eq("workspace_id", task.workspace_id);
    await logActivity(task.workspace_id, null, task.id, "loop_completed", { loop: loop.slug, run_id: run.id });
    return;
  }
  await createStageTask(loop, run, next, task.output_artifact_ids);
}

export async function startLoop(loopId: string, opts?: { userId?: string }) {
  const loop = must(await db.from("loops").select("*").eq("id", loopId).maybeSingle(), "Loop") as Loop;
  if (opts?.userId) {
    try {
      await requireMembership(opts.userId, loop.workspace_id);
    } catch (error) {
      if (error instanceof HubError && error.status === 404) throw new HubError("Loop: not found", 404);
      throw error;
    }
  }
  const run = must(
    await db.from("loop_runs").insert({ loop_id: loop.id, workspace_id: loop.workspace_id }).select("*").single(),
    "Loop run insert",
  ) as LoopRun;
  const first = await createStageTask(loop, run, 0, []);
  const nextRun = loop.cron ? nextRunFromCron(loop.cron) : null;
  await db.from("loops").update({ next_run_at: nextRun?.toISOString() ?? null }).eq("id", loop.id).eq("workspace_id", loop.workspace_id);
  return { run_id: run.id, first_task_id: first.id, next_run_at: nextRun };
}

/**
 * Starts every active loop whose next_run_at has passed.
 * The claim update is guarded by `next_run_at <= now`. Postgres rechecks that
 * predicate after taking the row lock, so two overlapping cron invocations
 * only one of them inserts a run. Each run stays in that loop's workspace.
 */
export async function startDueLoops() {
  const now = new Date().toISOString();
  const { data, error } = await db.from("loops").select("id,slug,workspace_id").eq("is_active", true).lte("next_run_at", now);
  if (error) {
    console.error(JSON.stringify({ message: "due loops query failed", error: error.message }));
    return;
  }
  for (const l of data ?? []) {
    const holdUntil = new Date(Date.now() + 60_000).toISOString();
    const claim = await db
      .from("loops")
      .update({ next_run_at: holdUntil })
      .eq("id", l.id)
      .eq("workspace_id", l.workspace_id)
      .lte("next_run_at", now)
      .select("id");
    if (claim.error) {
      console.error(JSON.stringify({ message: "loop claim failed", slug: l.slug, error: claim.error.message }));
      continue;
    }
    if (!claim.data?.length) continue;
    try {
      await startLoop(l.id);
      console.log(JSON.stringify({ message: "loop started", slug: l.slug, workspaceId: l.workspace_id }));
    } catch (e) {
      console.error(JSON.stringify({ message: "loop start failed", slug: l.slug, error: (e as Error).message }));
    }
  }
}

/** Human completion from the web UI: marks done and advances the loop. */
export async function completeHumanTask(taskId: string, summary: string, user: { id: string; email?: string | null }) {
  const loaded = await db.from("tasks").select("*").eq("id", taskId).maybeSingle();
  if (loaded.error) throw new HubError(loaded.error.message, 500);
  if (!loaded.data) throw new HubError("Task: not found", 404);
  const task = loaded.data as Task;
  try {
    await requireMembership(user.id, task.workspace_id);
  } catch (error) {
    if (error instanceof HubError && error.status === 404) throw new HubError("Task: not found", 404);
    throw error;
  }
  if (!["awaiting_human", "in_review", "queued", "claimed"].includes(task.status)) throw new HubError(`Task is ${task.status}`, 409);
  const now = new Date().toISOString();
  await db
    .from("tasks")
    .update({ status: "done", completed_at: now, claimed_by: null, lease_expires_at: null, result_summary: summary })
    .eq("id", task.id)
    .eq("workspace_id", task.workspace_id);
  await db.from("handoff_notes").insert({ workspace_id: task.workspace_id, task_id: task.id, summary, decisions: [], open_questions: [] });
  await logActivity(task.workspace_id, null, task.id, "completed", { by: user.email ?? "user" });
  await advanceLoop({ ...task, status: "done" });
  return { ok: true };
}
