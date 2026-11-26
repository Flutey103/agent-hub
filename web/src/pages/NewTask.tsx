import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAgents, useArtifacts } from "../lib/queries";
import { supabase } from "../lib/supabase";
import { useWorkspace } from "../lib/workspace";

export default function NewTask() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { workspaceId } = useWorkspace();
  const { data: agents = [] } = useAgents();
  const { data: artifacts = [] } = useArtifacts();
  const capabilities = useMemo(() => Array.from(new Set(agents.flatMap((a) => a.capabilities))).sort(), [agents]);
  const artifactKeys = useMemo(() => Array.from(new Set(artifacts.map((a) => a.key))).sort(), [artifacts]);

  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [route, setRoute] = useState<string>("cap:");
  const [priority, setPriority] = useState(3);
  const [reviewBy, setReviewBy] = useState("");
  const [inputs, setInputs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const inputIds = inputs
      .map((key) => artifacts.filter((a) => a.key === key).sort((a, b) => b.version - a.version)[0]?.id)
      .filter((x): x is string => !!x);
    const [kind, value] = route.split(":", 2);
    const row = {
      workspace_id: workspaceId,
      title,
      brief,
      acceptance_criteria: acceptance || null,
      priority,
      assignee_capability: kind === "cap" && value ? value : null,
      assignee_agent_id: kind === "agent" ? value : null,
      is_human: kind === "human",
      status: kind === "human" ? "awaiting_human" : "queued",
      review_by_capability: reviewBy || null,
      input_artifact_ids: inputIds,
    };
    const { data, error } = await supabase.from("tasks").insert(row).select("id").single();
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    await supabase.from("activity").insert({ workspace_id: workspaceId, task_id: data.id, event: "created", detail: { by: "human" } });
    await qc.invalidateQueries({ queryKey: ["tasks"] });
    navigate(`/tasks/${data.id}`);
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-3">
      <h1 className="text-xl font-semibold">New task</h1>
      <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <textarea className="input" rows={6} placeholder="Brief: what to do, with enough context for an agent that has never seen this before" value={brief} onChange={(e) => setBrief(e.target.value)} required />
      <textarea className="input" rows={3} placeholder="Acceptance criteria (optional): how the agent or reviewer knows it is done" value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-500">Route to</span>
          <select className="input" value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="cap:">Any agent</option>
            <optgroup label="By capability">
              {capabilities.map((c) => (
                <option key={c} value={`cap:${c}`}>{c}</option>
              ))}
            </optgroup>
            <optgroup label="Specific agent">
              {agents.map((a) => (
                <option key={a.id} value={`agent:${a.id}`}>{a.name}</option>
              ))}
            </optgroup>
            <option value="human:">A human (me)</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-500">Priority (1 highest)</span>
          <select className="input" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>P{p}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-500">Review by capability (optional)</span>
          <select className="input" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)}>
            <option value="">No review</option>
            {capabilities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-500">Attach artifacts (latest version)</span>
          <select className="input h-28" multiple value={inputs} onChange={(e) => setInputs(Array.from(e.target.selectedOptions).map((o) => o.value))}>
            {artifactKeys.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Creating…" : "Create task"}
      </button>
    </form>
  );
}
