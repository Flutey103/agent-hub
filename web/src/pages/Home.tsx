import { Link } from "react-router-dom"
import { productName } from "../../../shared/brand"
import { Onboarding } from "@/components/onboarding"
import { EmptyState, ErrorText, LoadingBlock, PageHeader, StatusLabel } from "@/components/ui-bits"
import { useAgents, useTasks } from "@/lib/queries"
import { PRIORITY_LABEL, timeAgo, type Agent, type Task } from "@/lib/types"
import { usePageTitle } from "@/lib/utils"
import { usePaths } from "@/lib/workspace"

function isToday(iso: string | null) {
  if (!iso) return false
  const date = new Date(iso)
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

export default function HomePage() {
  usePageTitle(`Home — ${productName}`)
  const paths = usePaths()
  const tasks = useTasks()
  const agents = useAgents()
  if (tasks.isLoading || agents.isLoading) return <LoadingBlock />
  if (tasks.error) return <ErrorText message={tasks.error.message} />
  const all = tasks.data ?? []
  const needs = all.filter((task) => task.status === "awaiting_human")
  const running = all.filter((task) => task.status === "claimed" || task.status === "in_review")
  const done = all.filter((task) => task.status === "done" && isToday(task.completed_at))
  const agentRows = agents.data ?? []

  return (
    <div>
      <PageHeader title="Home" description="What needs you, what is running, and what finished today." />
      <Onboarding />
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Assistants</h2>
        {agentRows.length === 0 ? (
          <EmptyState title="No assistants yet" body="Connect Claude, ChatGPT or Grok and their status will show up here." action={{ label: "Connect an assistant", to: paths.agents }} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {agentRows.map((agent) => (
              <Link key={agent.id} to={paths.agents} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm">
                <span className={`size-2 rounded-full ${agent.last_seen_at ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span>{agent.name}</span>
                <span className="text-xs text-muted-foreground">{agent.last_seen_at ? timeAgo(agent.last_seen_at) : "Waiting"}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      <div className="grid gap-6 lg:grid-cols-3">
        <TaskColumn title="Needs you" tasks={needs} agents={agentRows} empty="Nothing is waiting on you." />
        <TaskColumn title="In progress" tasks={running} agents={agentRows} empty="No assistant is holding a task." />
        <TaskColumn title="Done today" tasks={done} agents={agentRows} empty="Nothing has been finished today." />
      </div>
    </div>
  )
}

function TaskColumn({ title, tasks, agents, empty }: { title: string; tasks: Task[]; agents: Agent[]; empty: string }) {
  const paths = usePaths()
  return (
    <section>
      <h2 className="mb-2 flex items-center justify-between text-sm font-medium">
        {title}
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </h2>
      <div className="space-y-2">
        {tasks.slice(0, 8).map((task) => {
          const holder = agents.find((agent) => agent.id === (task.claimed_by ?? task.assignee_agent_id))
          return (
            <Link key={task.id} to={paths.task(task.id)} className="block rounded-lg border p-3 hover:bg-accent">
              <div className="text-sm font-medium">{task.title}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <StatusLabel status={task.status} />
                <span>{PRIORITY_LABEL[task.priority] ?? `P${task.priority}`}</span>
                {holder ? <span>{holder.name}</span> : null}
                <span>{timeAgo(task.updated_at)}</span>
              </div>
            </Link>
          )
        })}
        {tasks.length === 0 ? <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p> : null}
      </div>
    </section>
  )
}
