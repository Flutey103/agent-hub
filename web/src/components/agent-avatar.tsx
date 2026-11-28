import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { Agent } from "@/lib/types"

const COLORS = [
  "bg-rose-100 text-rose-950 dark:bg-rose-950 dark:text-rose-100",
  "bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-100",
  "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100",
  "bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100",
  "bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100",
  "bg-violet-100 text-violet-950 dark:bg-violet-950 dark:text-violet-100",
  "bg-fuchsia-100 text-fuchsia-950 dark:bg-fuchsia-950 dark:text-fuchsia-100",
  "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
]

const SIZES = {
  sm: "size-5 text-[9px]",
  md: "size-7 text-xs",
  lg: "size-10 text-sm",
}

export function agentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
}

export function avatarColor(seed: string): string {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 33 + seed.charCodeAt(index)) >>> 0
  return COLORS[hash % COLORS.length]
}

export function AgentAvatar({
  name,
  avatarUrl,
  seed,
  size = "sm",
  className,
}: {
  name: string
  avatarUrl?: string | null
  seed?: string
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <Avatar className={cn(SIZES[size], avatarColor(seed || name || "?"), className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback className="bg-transparent font-medium text-current" delayMs={avatarUrl ? 600 : 0}>
        {agentInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

export function AgentIdentity({
  agent,
  size = "sm",
  className,
}: {
  agent: Pick<Agent, "id" | "name" | "avatar_url">
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", className)}>
      <AgentAvatar name={agent.name} avatarUrl={agent.avatar_url} seed={agent.id} size={size} />
      <span className="truncate">{agent.name}</span>
    </span>
  )
}

export function findAgent(agents: Agent[] | undefined, id: string | null | undefined): Agent | undefined {
  if (!id) return undefined
  return agents?.find((agent) => agent.id === id)
}

export function taskActor(task: { claimed_by: string | null; assignee_agent_id: string | null }, agents: Agent[] | undefined): Agent | undefined {
  return findAgent(agents, task.claimed_by) ?? findAgent(agents, task.assignee_agent_id)
}

export function approvalAgent(
  task: { claimed_by: string | null; assignee_agent_id: string | null; parent_task_id: string | null },
  tasks: { id: string; claimed_by: string | null; assignee_agent_id: string | null }[],
  agents: Agent[] | undefined,
): Agent | undefined {
  const direct = taskActor(task, agents)
  if (direct) return direct
  const parent = task.parent_task_id ? tasks.find((item) => item.id === task.parent_task_id) : undefined
  return parent ? taskActor(parent, agents) : undefined
}
