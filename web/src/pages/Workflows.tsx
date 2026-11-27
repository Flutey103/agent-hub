import { useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { productName } from "../../../shared/brand"
import { Button } from "@/components/ui/button"
import { EmptyState, ErrorText, LoadingBlock, PageHeader } from "@/components/ui-bits"
import { useLoopRuns, useLoops } from "@/lib/queries"
import { serverPost } from "@/lib/api"
import { supabase } from "@/lib/supabase"
import { usePreviewLock } from "@/lib/task-actions"
import { timeAgo } from "@/lib/types"
import { usePageTitle } from "@/lib/utils"
import { usePaths, useWorkspace } from "@/lib/workspace"
import { useState } from "react"

export default function WorkflowsPage() {
  usePageTitle(`Workflows — ${productName}`)
  const paths = usePaths()
  const { workspaceId } = useWorkspace()
  const qc = useQueryClient()
  const locked = usePreviewLock()
  const loops = useLoops()
  const runs = useLoopRuns()
  const [busy, setBusy] = useState<string | null>(null)

  async function run(id: string) {
    if (locked("Running a workflow")) return
    setBusy(id)
    try {
      await serverPost(`/human/loops/${id}/run`)
      await qc.invalidateQueries({ queryKey: ["tasks"] })
      await qc.invalidateQueries({ queryKey: ["loops"] })
      await qc.invalidateQueries({ queryKey: ["loop_runs"] })
      toast("Run started")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function toggle(id: string, active: boolean) {
    if (locked(active ? "Resuming" : "Pausing")) return
    const { error } = await supabase.from("loops").update({ is_active: active }).eq("id", id).eq("workspace_id", workspaceId)
    if (error) {
      toast.error(error.message)
      return
    }
    await qc.invalidateQueries({ queryKey: ["loops"] })
  }

  if (loops.isLoading) return <LoadingBlock />
  if (loops.error) return <ErrorText message={loops.error.message} />

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="A workflow is a sequence of stages. Each finished stage opens the next task."
        actions={
          <Button asChild className="w-full sm:w-auto">
            <Link to={paths.newWorkflow}>New workflow</Link>
          </Button>
        }
      />
      {(loops.data ?? []).length === 0 ? (
        <EmptyState title="No workflows yet" body="Create one in the form. You don't need to edit the database." action={{ label: "Create a workflow", to: paths.newWorkflow }} />
      ) : (
        <div className="space-y-3">
          {(loops.data ?? []).map((loop) => {
            const history = (runs.data ?? []).filter((run) => run.loop_id === loop.id)
            return (
              <article key={loop.id} className="rounded-lg border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="font-medium">{loop.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {loop.is_active ? "Active" : "Paused"} · {loop.cron ?? "Manual"} · {loop.next_run_at ? `next ${timeAgo(loop.next_run_at)}` : "not armed"}
                    </p>
                    {loop.description ? <p className="mt-2 text-sm text-muted-foreground">{loop.description}</p> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Button variant="outline" onClick={() => void toggle(loop.id, !loop.is_active)}>
                      {loop.is_active ? "Pause" : "Resume"}
                    </Button>
                    <Button disabled={busy === loop.id} onClick={() => void run(loop.id)}>
                      {busy === loop.id ? "Starting…" : "Run now"}
                    </Button>
                    <Button variant="outline" className="col-span-2 sm:col-span-1" asChild>
                      <Link to={paths.workflow(loop.id)}>Edit</Link>
                    </Button>
                  </div>
                </div>
                <ol className="mt-4 space-y-2">
                  {loop.stages.map((stage, index) => (
                    <li key={`${stage.name}-${index}`} className="rounded-md border px-3 py-2 text-sm">
                      <div className="font-medium">
                        {index + 1}. {stage.name}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{stage.human ? "You" : (stage.agent ?? stage.capability ?? "Any assistant")}</p>
                    </li>
                  ))}
                </ol>
                <div className="mt-4">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Run history</h3>
                  {history.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No runs yet.</p> : null}
                  <ul className="mt-2 space-y-1">
                    {history.map((run) => (
                      <li key={run.id} className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                        <span className="capitalize">{run.status}</span>
                        <span className="text-muted-foreground">Stage {run.current_stage + 1}</span>
                        <span className="text-muted-foreground">{timeAgo(run.started_at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
