import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { productName } from "../../../shared/brand"
import { AgentAvatar, AgentIdentity, findAgent } from "@/components/agent-avatar"
import { MarkdownView } from "@/components/markdown-view"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/input"
import { ErrorText, LoadingBlock, StatusLabel } from "@/components/ui-bits"
import { useAgents, useArtifactsByIds, useHandoffNotes, useTask, useToolCalls } from "@/lib/queries"
import { approveTask, cancelTask, refreshWork, requestTaskChanges, usePreviewLock } from "@/lib/task-actions"
import { PRIORITY_LABEL, timeAgo, type Artifact } from "@/lib/types"
import { usePageTitle } from "@/lib/utils"
import { usePaths, useWorkspace } from "@/lib/workspace"

export default function TaskDetailPage() {
  const { id } = useParams()
  const paths = usePaths()
  const { workspaceId } = useWorkspace()
  const qc = useQueryClient()
  const locked = usePreviewLock()
  const taskQuery = useTask(id)
  const agents = useAgents()
  const notes = useHandoffNotes(id)
  const calls = useToolCalls(id)
  const task = taskQuery.data
  usePageTitle(task ? `${task.title} — ${productName}` : `Task — ${productName}`)
  const ids = [...(task?.input_artifact_ids ?? []), ...(task?.output_artifact_ids ?? [])]
  const artifacts = useArtifactsByIds(ids)
  const [summary, setSummary] = useState("")
  const [changesOpen, setChangesOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (taskQuery.isLoading) return <LoadingBlock />
  if (taskQuery.error || !task) return <ErrorText message={taskQuery.error?.message ?? "Task not found"} />

  const roster = agents.data
  const assignee = findAgent(roster, task.assignee_agent_id)
  const claimed = findAgent(roster, task.claimed_by)
  const named = (agentId: string | null) => findAgent(roster, agentId)
  const inputs = (artifacts.data ?? []).filter((artifact) => task.input_artifact_ids.includes(artifact.id))
  const outputs = (artifacts.data ?? []).filter((artifact) => task.output_artifact_ids.includes(artifact.id))
  const canAct = ["awaiting_human", "in_review", "queued", "claimed"].includes(task.status)

  async function approve() {
    if (locked("Approving")) return
    setBusy(true)
    setError(null)
    try {
      await approveTask(task!.id, summary || "Approved")
      await refreshWork(qc)
      toast("Marked done")
    } catch (approveError) {
      setError((approveError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function sendBack() {
    if (locked("Sending changes")) return
    setBusy(true)
    setError(null)
    try {
      await requestTaskChanges(workspaceId, task!.id, summary)
      await refreshWork(qc)
      setChangesOpen(false)
      toast("Sent back")
    } catch (changeError) {
      setError((changeError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (locked("Cancelling")) return
    setBusy(true)
    try {
      await cancelTask(workspaceId, task!.id)
      await refreshWork(qc)
      toast("Cancelled")
    } catch (cancelError) {
      setError((cancelError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const timeline = [
    ...(notes.data ?? []).map((note) => ({ at: note.created_at, kind: "note" as const, note })),
    ...inputs.map((artifact) => ({ at: artifact.created_at, kind: "input" as const, artifact })),
    ...outputs.map((artifact) => ({ at: artifact.created_at, kind: "output" as const, artifact })),
    ...(calls.data ?? []).map((call) => ({ at: call.created_at, kind: "call" as const, call })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-4">
        <Link to={paths.tasks} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" /> Tasks
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{task.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            <StatusLabel status={task.status} />
            <span>{PRIORITY_LABEL[task.priority]}</span>
            <span className="inline-flex items-center gap-1.5">
              Assignee {assignee ? <AgentIdentity agent={assignee} /> : task.is_human ? "You" : (task.assignee_capability ?? "Anyone")}
            </span>
            {claimed ? (
              <span className="inline-flex items-center gap-1.5">
                Claimed by <AgentIdentity agent={claimed} />
              </span>
            ) : null}
            <span>Updated {timeAgo(task.updated_at)}</span>
          </div>
        </div>
        <section className="rounded-lg border p-4">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Brief</h2>
          <p className="mt-2 text-sm whitespace-pre-wrap">{task.brief}</p>
          {task.acceptance_criteria ? (
            <>
              <h2 className="mt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">Acceptance</h2>
              <p className="mt-2 text-sm whitespace-pre-wrap">{task.acceptance_criteria}</p>
            </>
          ) : null}
        </section>
        <section className="space-y-3">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Timeline</h2>
          {timeline.length === 0 ? <p className="text-sm text-muted-foreground">No handoffs, documents or tool calls yet.</p> : null}
          {timeline.map((item, index) => (
            <article key={`${item.kind}-${index}`} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{timeAgo(item.at)}</div>
              {item.kind === "note" ? (
                <div className="mt-1 flex items-start gap-2 text-sm">
                  {named(item.note.agent_id) ? <AgentAvatar name={named(item.note.agent_id)!.name} avatarUrl={named(item.note.agent_id)?.avatar_url} seed={item.note.agent_id ?? undefined} className="mt-0.5" /> : null}
                  <div className="min-w-0">
                    <div className="font-medium">{named(item.note.agent_id)?.name ?? "You"} handed off</div>
                    <p className="mt-1 whitespace-pre-wrap">{item.note.summary}</p>
                    {item.note.suggested_next ? <p className="mt-2 text-xs text-muted-foreground">Next: {item.note.suggested_next}</p> : null}
                  </div>
                </div>
              ) : null}
              {item.kind === "input" || item.kind === "output" ? <ArtifactBody artifact={item.artifact} label={item.kind === "input" ? "Input" : "Output"} /> : null}
              {item.kind === "call" ? (
                <div className="mt-1 flex items-center gap-2 text-sm">
                  {named(item.call.agent_id) ? <AgentAvatar name={named(item.call.agent_id)!.name} avatarUrl={named(item.call.agent_id)?.avatar_url} seed={item.call.agent_id ?? undefined} /> : null}
                  <div className="min-w-0">
                    <span className="font-medium">{item.call.tool}</span>
                    <span className="text-muted-foreground"> · {named(item.call.agent_id)?.name ?? "Assistant"} · {item.call.ok ? "ok" : "failed"}</span>
                    {item.call.duration_ms != null ? <span className="text-muted-foreground"> · {item.call.duration_ms} ms</span> : null}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      </div>
      {canAct ? (
        <aside className="h-fit rounded-lg border p-4 lg:sticky lg:top-6">
          <h2 className="text-sm font-medium">{task.is_human ? "Your decision" : "Override"}</h2>
          <Textarea className="mt-3" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Note for the record" />
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
          <div className="mt-3 grid gap-2">
            <Button disabled={busy} onClick={() => void approve()}>
              {task.loop_run_id ? "Approve and advance" : "Mark done"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setChangesOpen(true)}>
              Request changes
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void cancel()}>
              Cancel task
            </Button>
          </div>
        </aside>
      ) : null}
      <ResponsiveDialog open={changesOpen} onOpenChange={setChangesOpen} title="Request changes" description="The task returns to the queue with your note.">
        <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What should change?" />
        <Button className="mt-3 w-full" disabled={busy} onClick={() => void sendBack()}>
          Send back
        </Button>
      </ResponsiveDialog>
    </div>
  )
}

function ArtifactBody({ artifact, label }: { artifact: Artifact; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1">
      <button type="button" className="flex min-h-11 w-full items-center justify-between text-left text-sm" onClick={() => setOpen((value) => !value)}>
        <span>
          {label}: {artifact.title} <span className="text-muted-foreground">v{artifact.version}</span>
        </span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? <MarkdownView content={artifact.content ?? ""} /> : null}
    </div>
  )
}
