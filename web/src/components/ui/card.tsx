import * as React from "react"
import { cn } from "@/lib/utils"

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-lg border bg-card text-card-foreground", className)} {...props} />
}

export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", className)} {...props} />
}

export function Separator({ className, ...props }: React.ComponentProps<"div">) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} {...props} />
}
