import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { STATUS_LABEL, type TaskStatus } from "@/lib/types"

const DOT: Record<TaskStatus, string> = {
  queued: "bg-zinc-400",
  claimed: "bg-sky-500",
  in_review: "bg-violet-500",
  awaiting_human: "bg-amber-500",
  done: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-300",
}

export function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", DOT[status], className)} aria-hidden />
}

export function StatusLabel({ status }: { status: TaskStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">{actions}</div> : null}
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: { label: string; to?: string; onClick?: () => void } }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action ? (
        <div className="mt-4">
          {action.to ? (
            <Button asChild className="w-full sm:w-auto">
              <Link to={action.to}>{action.label}</Link>
            </Button>
          ) : (
            <Button className="w-full sm:w-auto" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function LoadingBlock() {
  return (
    <div className="space-y-2" aria-busy="true">
      <span className="sr-only">Loading</span>
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-16 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  )
}

export function ErrorText({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}
