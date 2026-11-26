import { useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useState } from "react";
import { serverPost } from "../lib/api";
import { useLoops } from "../lib/queries";
import { supabase } from "../lib/supabase";
import { useWorkspace } from "../lib/workspace";

export default function Loops() {
  const qc = useQueryClient();
  const { workspaceId } = useWorkspace();
  const { data: loops = [] } = useLoops();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string) {
    setBusy(id);
    setError(null);
    try {
      await serverPost(`/human/loops/${id}/run`);
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      await qc.invalidateQueries({ queryKey: ["loops"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(id: string, active: boolean) {
    await supabase.from("loops").update({ is_active: active }).eq("id", id).eq("workspace_id", workspaceId);
    await qc.invalidateQueries({ queryKey: ["loops"] });
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold">Loops</h1>
      <p className="mb-4 text-sm text-neutral-500">Recurring pipelines. Each stage becomes a task when the previous one is done, with its outputs attached.</p>
      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      <div className="space-y-3">
        {loops.map((l) => (
          <div key={l.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{l.name}</div>
                <div className="text-xs text-neutral-500">
                  {l.slug} · cron {l.cron ?? "manual"} · next {l.next_run_at ? new Date(l.next_run_at).toLocaleString() : "not scheduled"}
                </div>
                {l.description && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{l.description}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn" onClick={() => toggle(l.id, !l.is_active)}>
                  {l.is_active ? "Pause" : "Resume"}
                </button>
                <button className="btn btn-primary" disabled={busy === l.id} onClick={() => run(l.id)}>
                  <Play size={14} /> Run now
                </button>
              </div>
            </div>
            <ol className="mt-3 grid gap-2 md:grid-cols-2">
              {l.stages.map((s, i) => (
                <li key={i} className="rounded-md border border-neutral-200 p-2 text-sm dark:border-neutral-800">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {i + 1}. {s.name}
                    </span>
                    <span className={`pill ${s.human ? "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200" : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"}`}>
                      {s.human ? "human" : (s.agent ?? s.capability ?? "any agent")}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-xs text-neutral-500">{s.brief}</p>
                  {s.review_by && <div className="mt-1 text-xs text-neutral-500">Reviewed by {s.review_by}</div>}
                </li>
              ))}
            </ol>
          </div>
        ))}
        {loops.length === 0 && <div className="card text-sm text-neutral-500">No loops in this workspace yet. A loop is a row in the loops table with a stages JSON array.</div>}
      </div>
    </div>
  );
}
