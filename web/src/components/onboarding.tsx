import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { WORKFLOW_TEMPLATES } from "@/config/workflows"
import { Button } from "@/components/ui/button"
import { useAgents, useTasks } from "@/lib/queries"
import { usePreviewLock } from "@/lib/task-actions"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { usePaths, useWorkspace } from "@/lib/workspace"

const DISMISS_KEY = "agent-hub.checklist.dismissed"

export function Onboarding() {
  const { workspace, workspaceId, demo } = useWorkspace()
  const paths = usePaths()
  const agents = useAgents()
  const tasks = useTasks()
  const qc = useQueryClient()
  const locked = usePreviewLock()
  const [hidden, setHidden] = useState(() => localStorage.getItem(DISMISS_KEY) === "1")
  const [busy, setBusy] = useState(false)
  if (hidden) return null

  const named = !workspace.slug.startsWith("personal-") && !workspace.name.endsWith("'s workspace")
  const connected = (agents.data?.length ?? 0) >= 1
  const second = (agents.data?.length ?? 0) >= 2
  const hasTask = (tasks.data?.length ?? 0) >= 1
  const handedOff = (tasks.data ?? []).some((task) => task.status === "done" && Boolean(task.result_summary))
  const steps = [
    { done: named, title: "Name the workspace after a business", detail: "Each business gets its own desk.", action: "Rename", to: paths.settings },
    { done: connected, title: "Connect your first assistant", detail: "Paste the MCP URL into Claude, ChatGPT or Grok.", action: "Connect", to: paths.agents },
    { done: second, title: "Connect a second assistant", detail: "A handoff needs two. Grok or ChatGPT uses the same URL.", action: "Add another", to: paths.agents },
    { done: hasTask, title: "Give them a shared task", detail: "Or load the draft-and-review workflow. Aim for a handoff in the first 10 minutes.", action: "New task", to: paths.newTask },
    { done: handedOff, title: "Approve the first handoff", detail: "When a draft reaches the inbox, approve it or send it back.", action: "Open inbox", to: paths.inbox },
  ]
  const finished = steps.filter((step) => step.done).length

  async function loadStarter() {
    if (locked("Loading a workflow")) return
    const template = WORKFLOW_TEMPLATES[0]
    setBusy(true)
    const { error } = await supabase.from("loops").insert({
      workspace_id: workspaceId,
      slug: "draft-and-review",
      name: template.name,
      description: template.description,
      cron: template.cron,
      is_active: true,
      stages: template.stages,
    })
    setBusy(false)
    if (error) {
      toast.error(error.message)
      return
    }
    await qc.invalidateQueries({ queryKey: ["loops"] })
    toast("Starter workflow added")
  }

  return (
    <section className="mb-6 rounded-lg border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">First handoff</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {finished} of {steps.length}. Connect two assistants and approve one piece of work.
          </p>
        </div>
        <Button variant="ghost" className="self-start" onClick={() => { localStorage.setItem(DISMISS_KEY, "1"); setHidden(true) }}>
          Dismiss
        </Button>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-2 rounded-md bg-muted/60 px-3 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm", step.done && "text-muted-foreground line-through")}>
                {index + 1}. {step.title}
              </div>
              <p className="text-xs text-muted-foreground">{step.detail}</p>
            </div>
            {step.done ? null : (
              <Button variant="outline" className="w-full sm:w-auto" asChild>
                <Link to={step.to}>{step.action}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
      {!demo && !hasTask ? (
        <Button className="mt-3 w-full sm:w-auto" disabled={busy} onClick={() => void loadStarter()}>
          {busy ? "Adding…" : "Load the starter workflow"}
        </Button>
      ) : null}
    </section>
  )
}
