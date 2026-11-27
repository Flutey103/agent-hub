import { useState } from "react"
import { Link } from "react-router-dom"
import { productName } from "../../../shared/brand"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState, ErrorText, LoadingBlock, PageHeader } from "@/components/ui-bits"
import { useActivity, useAgents, useTasks, useToolCalls } from "@/lib/queries"
import { timeAgo } from "@/lib/types"
import { usePageTitle } from "@/lib/utils"
import { usePaths } from "@/lib/workspace"

export default function ActivityPage() {
  usePageTitle(`Activity — ${productName}`)
  const paths = usePaths()
  const [tab, setTab] = useState<"events" | "calls">("events")
  const [query, setQuery] = useState("")
  const activity = useActivity(200)
  const calls = useToolCalls()
  const agents = useAgents()
  const tasks = useTasks()
  const agentName = (id: string | null) => (id ? (agents.data?.find((agent) => agent.id === id)?.name ?? "Assistant") : "Hub")
  const taskTitle = (id: string | null) => tasks.data?.find((task) => task.id === id)?.title
  const needle = query.trim().toLowerCase()

  if (activity.isLoading || calls.isLoading) return <LoadingBlock />
  if (activity.error) return <ErrorText message={activity.error.message} />

  const events = (activity.data ?? []).filter((row) => `${row.event} ${agentName(row.agent_id)}`.toLowerCase().includes(needle))
  const toolRows = (calls.data ?? []).filter((row) => `${row.tool} ${agentName(row.agent_id)}`.toLowerCase().includes(needle))

  return (
    <div>
      <PageHeader title="Activity" description="What happened in this workspace, including every tool call." />
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button variant={tab === "events" ? "secondary" : "outline"} onClick={() => setTab("events")}>
          Events
        </Button>
        <Button variant={tab === "calls" ? "secondary" : "outline"} onClick={() => setTab("calls")}>
          Tool calls
        </Button>
      </div>
      <Input className="mb-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter" aria-label="Filter activity" />
      {tab === "events" ? (
        events.length === 0 ? (
          <EmptyState title="No events yet" body="Claims, handoffs and approvals will show up here as assistants work." />
        ) : (
          <ol className="space-y-2">
            {events.map((row) => (
              <li key={row.id} className="rounded-lg border px-3 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium">{agentName(row.agent_id)}</span>
                  <span className="text-muted-foreground">{row.event.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(row.created_at)}</span>
                </div>
                {row.task_id ? (
                  <Link className="mt-1 inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline" to={paths.task(row.task_id)}>
                    {taskTitle(row.task_id) ?? "Open task"}
                  </Link>
                ) : null}
                {Object.keys(row.detail).length > 0 ? <p className="mt-1 text-xs break-words text-muted-foreground">{JSON.stringify(row.detail)}</p> : null}
              </li>
            ))}
          </ol>
        )
      ) : toolRows.length === 0 ? (
        <EmptyState title="No tool calls yet" body="When an assistant uses the hub, the call, the duration and whether it worked are recorded here." />
      ) : (
        <ul className="space-y-2">
          {toolRows.map((row) => (
            <li key={row.id} className="rounded-lg border px-3 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`size-2 rounded-full ${row.ok ? "bg-emerald-500" : "bg-red-500"}`} />
                <span className="font-medium">{row.tool}</span>
                <span className="text-muted-foreground">{agentName(row.agent_id)}</span>
                {row.duration_ms != null ? <span className="text-xs text-muted-foreground">{row.duration_ms} ms</span> : null}
                <span className="text-xs text-muted-foreground">{timeAgo(row.created_at)}</span>
              </div>
              {row.task_id ? (
                <Link className="mt-1 inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline" to={paths.task(row.task_id)}>
                  {taskTitle(row.task_id) ?? "Open task"}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
