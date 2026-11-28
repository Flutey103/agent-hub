import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { productName } from "../../../shared/brand"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/menu"
import { EmptyState, ErrorText, LoadingBlock, PageHeader, StatusDot, StatusLabel } from "@/components/ui-bits"
import { AgentIdentity, taskActor } from "@/components/agent-avatar"
import { useAgents, useTasks } from "@/lib/queries"
import { PRIORITY_LABEL, STATUS_LABEL, timeAgo, type Task, type TaskStatus } from "@/lib/types"
import { usePageTitle } from "@/lib/utils"
import { usePaths } from "@/lib/workspace"

const BOARD: TaskStatus[] = ["queued", "claimed", "in_review", "awaiting_human", "done", "failed"]

export default function TasksPage() {
  usePageTitle(`Tasks — ${productName}`)
  const paths = usePaths()
  const tasksQuery = useTasks()
  const agents = useAgents()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [view, setView] = useState<"list" | "board">("list")
  const roster = agents.data

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (tasksQuery.data ?? []).filter((task) => {
      if (status !== "all" && task.status !== status) return false
      if (!needle) return true
      return `${task.title} ${task.brief}`.toLowerCase().includes(needle)
    })
  }, [tasksQuery.data, query, status])

  if (tasksQuery.isLoading) return <LoadingBlock />
  if (tasksQuery.error) return <ErrorText message={tasksQuery.error.message} />

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="List by default. The board stacks on a phone so it doesn't scroll sideways."
        actions={
          <Button asChild className="w-full sm:w-auto">
            <Link to={paths.newTask}>New task</Link>
          </Button>
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
        <Select
          value={status}
          onValueChange={setStatus}
          options={[{ value: "all", label: "All statuses" }, ...BOARD.map((item) => ({ value: item, label: STATUS_LABEL[item] }))]}
        />
        <div className="grid grid-cols-2 gap-1 rounded-md border p-1">
          <Button variant={view === "list" ? "secondary" : "ghost"} onClick={() => setView("list")}>
            List
          </Button>
          <Button variant={view === "board" ? "secondary" : "ghost"} onClick={() => setView("board")}>
            Board
          </Button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="No tasks match" body="Create a task and route it to an assistant, or clear the filters." action={{ label: "New task", to: paths.newTask }} />
      ) : view === "list" ? (
        <div className="space-y-2">
          {filtered.map((task) => (
            <Link key={task.id} to={paths.task(task.id)} className="block rounded-lg border p-3 hover:bg-accent">
              <div className="flex items-start gap-2">
                <StatusDot status={task.status} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{task.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{STATUS_LABEL[task.status]}</span>
                    <span>{PRIORITY_LABEL[task.priority]}</span>
                    <TaskWho task={task} agents={roster} />
                    <span>{timeAgo(task.updated_at)}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {BOARD.map((column) => {
            const cards = filtered.filter((task) => task.status === column)
            if (cards.length === 0 && status === "all") {
              return (
                <section key={column} className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                  {STATUS_LABEL[column]} · 0
                </section>
              )
            }
            if (cards.length === 0) return null
            return (
              <section key={column} className="min-w-0">
                <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {STATUS_LABEL[column]} · {cards.length}
                </h2>
                <div className="space-y-2">
                  {cards.map((task) => (
                    <Link key={task.id} to={paths.task(task.id)} className="block rounded-lg border p-3 hover:bg-accent">
                      <div className="text-sm font-medium">{task.title}</div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.brief}</p>
                      <div className="mt-2 text-xs text-muted-foreground">
                        <TaskWho task={task} agents={roster} />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TaskWho({ task, agents }: { task: Task; agents: ReturnType<typeof useAgents>["data"] }) {
  const actor = taskActor(task, agents)
  if (actor) return <AgentIdentity agent={actor} />
  if (task.is_human) return <span>You</span>
  return <span>{task.assignee_capability ?? "Anyone"}</span>
}
