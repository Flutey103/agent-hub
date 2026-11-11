import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { serverPost } from "../lib/api";
import { useAgents, useArtifactsByIds, useHandoffNotes, useTask } from "../lib/queries";
import { supabase } from "../lib/supabase";
import { STATUS_CLASS, STATUS_LABEL, timeAgo, type Artifact } from "../lib/types";

function ArtifactBlock({ a }: { a: Artifact }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span className="text-sm font-medium">
          {a.title} <span className="text-neutral-400">({a.key} v{a.version})</span>
        </span>
        <span className="text-xs text-neutral-400">{open ? "hide" : "show"}</span>
      </button>
      {open && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{a.content}</pre>}
    </div>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { data: task, isLoading } = useTask(id);
  const { data: agents = [] } = useAgents();
  const { data: notes = [] } = useHandoffNotes(id);
  const ids = [...(task?.input_artifact_ids ?? []), ...(task?.output_artifact_ids ?? [])];
  const { data: artifacts = [] } = useArtifactsByIds(ids);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !task) return <div className="text-sm text-neutral-500">Loading…</div>;
  const agentName = (aid: string | null) => agents.find((a) => a.id === aid)?.name ?? (aid ? "unknown agent" : "human");
  const inputs = artifacts.filter((a) => task.input_artifact_ids.includes(a.id));
  const outputs = artifacts.filter((a) => task.output_artifact_ids.includes(a.id));
  const canComplete = ["awaiting_human", "in_review", "queued", "claimed"].includes(task.status);

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await serverPost(`/human/tasks/${task!.id}/complete`, { summary });
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      await qc.invalidateQueries({ queryKey: ["task", task!.id] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    await supabase.from("tasks").update({ status: "cancelled" }).eq("id", task!.id);
    await qc.invalidateQueries({ queryKey: ["tasks"] });
    await qc.invalidateQueries({ queryKey: ["task", task!.id] });
  }

  return (
    <div className="max-w-4xl space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800">
        <ArrowLeft size={14} /> Board
      </Link>
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">{task.title}</h1>
        <span className={`pill ${STATUS_CLASS[task.status]}`}>{STATUS_LABEL[task.status]}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-neutral-500">
        <div>Assigned: {task.is_human ? "human" : agentName(task.assignee_agent_id) !== "human" ? agentName(task.assignee_agent_id) : (task.assignee_capability ?? "anyone")}</div>
        <div>Held by: {task.claimed_by ? agentName(task.claimed_by) : "nobody"}</div>
        <div>Updated: {timeAgo(task.updated_at)}</div>
        {task.review_by_capability && <div>Review by: {task.review_by_capability}</div>}
        {task.lease_expires_at && <div>Lease ends: {new Date(task.lease_expires_at).toLocaleString()}</div>}
        {task.due_at && <div>Due: {new Date(task.due_at).toLocaleString()}</div>}
        {task.parent_task_id && (
          <div>
            Parent: <Link className="underline" to={`/tasks/${task.parent_task_id}`}>open</Link>
          </div>
        )}
      </div>

      <section className="card">
        <h2 className="mb-1 text-xs font-semibold uppercase text-neutral-500">Brief</h2>
        <p className="whitespace-pre-wrap text-sm">{task.brief}</p>
        {task.acceptance_criteria && (
          <>
            <h2 className="mb-1 mt-3 text-xs font-semibold uppercase text-neutral-500">Acceptance criteria</h2>
            <p className="whitespace-pre-wrap text-sm">{task.acceptance_criteria}</p>
          </>
        )}
      </section>

      {inputs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase text-neutral-500">Inputs</h2>
          {inputs.map((a) => (
            <ArtifactBlock key={a.id} a={a} />
          ))}
        </section>
      )}
      {outputs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase text-neutral-500">Outputs</h2>
          {outputs.map((a) => (
            <ArtifactBlock key={a.id} a={a} />
          ))}
        </section>
      )}

      {notes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase text-neutral-500">Handoff notes</h2>
          {notes.map((n) => (
            <div key={n.id} className="card text-sm">
              <div className="mb-1 text-xs text-neutral-500">
                {agentName(n.agent_id)} · {timeAgo(n.created_at)}
              </div>
              <p className="whitespace-pre-wrap">{n.summary}</p>
              {n.decisions.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {n.decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
              {n.open_questions.length > 0 && (
                <div className="mt-2 text-xs">
                  <span className="font-medium">Open questions:</span> {n.open_questions.join(" · ")}
                </div>
              )}
              {n.suggested_next && <div className="mt-2 text-xs"><span className="font-medium">Suggested next:</span> {n.suggested_next}</div>}
            </div>
          ))}
        </section>
      )}

      {canComplete && (
        <section className="card space-y-2">
          <h2 className="text-xs font-semibold uppercase text-neutral-500">{task.is_human ? "Your action" : "Override"}</h2>
          <textarea className="input" rows={3} placeholder="Note for the record (what you approved or decided)" value={summary} onChange={(e) => setSummary(e.target.value)} />
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={complete}>
              <Check size={14} /> Mark done{task.loop_run_id ? " and advance loop" : ""}
            </button>
            <button className="btn" disabled={busy} onClick={cancel}>
              Cancel task
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
