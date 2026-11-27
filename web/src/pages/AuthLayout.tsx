import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { productName } from "../../../shared/brand"

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh overflow-x-clip bg-background">
      <header className="flex h-14 items-center px-4">
        <Link to="/" className="text-sm font-semibold">
          {productName}
        </Link>
      </header>
      <main className="mx-auto w-full max-w-md px-4 pb-16">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  )
}

export function Notice({ children, tone = "status" }: { children: ReactNode; tone?: "status" | "alert" }) {
  return (
    <p role={tone} className={tone === "alert" ? "text-sm text-destructive" : "rounded-md border bg-muted px-3 py-3 text-sm"}>
      {children}
    </p>
  )
}
