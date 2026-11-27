import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { productName } from "../../../shared/brand"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/input"
import { EmptyState, ErrorText, LoadingBlock, PageHeader, StatusLabel } from "@/components/ui-bits"
import { useAgents, useTasks } from "@/lib/queries"
import { approveTask, refreshWork, requestTaskChanges, usePreviewLock } from "@/lib/task-actions"
import { PRIORITY_LABEL, timeAgo, type Task } from "@/lib/types"
import { usePageTitle } from "@/lib/utils"
import { usePaths, useWorkspace } from "@/lib/workspace"

export default function InboxPage() {
  usePageTitle(`Inbox — ${productName}`)
  const paths = usePaths()
  const { workspaceId } = useWorkspace()
  const qc = useQueryClient()
  const locked = usePreviewLock()
  const tasksQuery = useTasks()
  const agents = useAgents()
  const items = (tasksQuery.data ?? []).filter((task) => task.status === "awaiting_human")
  const [selected, setSelected] = useState<string | null>(null)
  const [changesFor, setChangesFor] = useState<Task | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const active = items.find((task) => task.id === selected) ?? items[0]

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const index = Math.max(0, items.findIndex((task) => task.id === active?.id))
      const key = event.key.toLowerCase()
      if (key === "j") setSelected(items[Math.min(items.length - 1, index + 1)]?.id ?? null)
      if (key === "k") setSelected(items[Math.max(0, index - 1)]?.id ?? null)
      if (key === "a" && active) void approve(active)
      if (key === "r" && active) {
        setChangesFor(active)
        setNote("")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  async function approve(task: Task) {
    if (locked("Approving")) return
    setBusy(true)
    try {
      await approveTask(task.id, "Approved")
      await refreshWork(qc)
      toast("Approved")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function sendBack() {
    if (!changesFor) return
    if (locked("Sending changes")) return
    setBusy(true)
    try {
      await requestTaskChanges(workspaceId, changesFor.id, note)
      await refreshWork(qc)
      setChangesFor(null)
      toast("Sent back")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (tasksQuery.isLoading) return <LoadingBlock />
  if (tasksQuery.error) return <ErrorText message={tasksQuery.error.message} />

  return (
    <div>
      <PageHeader title="Inbox" description="Approvals and questions. On a keyboard, J and K move, A approves, R requests changes." />
      {items.length === 0 ? (
        <EmptyState title="Nothing is waiting" body="When an assistant needs a decision, it lands here with approve and request-changes on the card." action={{ label: "See tasks", to: paths.tasks }} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            {items.map((task) => (
              <article key={task.id} className={`rounded-lg border p-3 ${active?.id === task.id ? "border-foreground" : ""}`}>
                <button type="button" className="w-full text-left" onClick={() => setSelected(task.id)}>
                  <div className="text-sm font-medium">{task.title}</div>
                  <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{task.brief}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <StatusLabel status={task.status} />
                    <span>{PRIORITY_LABEL[task.priority]}</span>
                    <span>{timeAgo(task.updated_at)}</span>
                  </div>
                </button>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button disabled={busy} onClick={() => void approve(task)}>
                    Approve
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => { setChangesFor(task); setNote("") }}>
                    Request changes
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <aside className="hidden rounded-lg border p-4 lg:block">
            {active ? (
              <>
                <h2 className="text-base font-semibold">{active.title}</h2>
                <p className="mt-3 text-sm whitespace-pre-wrap">{active.brief}</p>
                <Link className="mt-4 inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline" to={paths.task(active.id)}>
                  Open the full task
                </Link>
              </>
            ) : null}
          </aside>
        </div>
      )}
      <ResponsiveDialog open={Boolean(changesFor)} onOpenChange={(open) => !open && setChangesFor(null)} title="Request changes" description="The task goes back to the queue with your note.">
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should change?" />
        <Button className="mt-3 w-full" disabled={busy} onClick={() => void sendBack()}>
          Send back
        </Button>
      </ResponsiveDialog>
    </div>
  )
}
