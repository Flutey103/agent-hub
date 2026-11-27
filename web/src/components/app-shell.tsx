import { Activity, Bot, Home, Inbox, Library, ListTodo, LogOut, Menu, Moon, Plus, Repeat, Search, Settings, Sun } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { productName } from "../../../shared/brand"
import { CommandPalette } from "@/components/command-palette"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { supabase } from "@/lib/supabase"
import { useTasks } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { usePaths, useWorkspace } from "@/lib/workspace"

const NAV = [
  { id: "home", label: "Home", icon: Home },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "workflows", label: "Workflows", icon: Repeat },
  { id: "knowledge", label: "Knowledge", icon: Library },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
] as const

function isActive(pathname: string, base: string, id: string) {
  const path = `${base}/${id}`
  return pathname === path || pathname.startsWith(`${path}/`)
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const paths = usePaths()
  const { demo, email, basePath } = useWorkspace()
  const { data: tasks } = useTasks()
  const { resolved, setTheme } = useTheme()
  const [menu, setMenu] = useState(false)
  const [palette, setPalette] = useState(false)
  const needsYou = tasks?.filter((task) => task.status === "awaiting_human").length ?? 0
  const pathFor = (id: string) => paths[id as keyof typeof paths] as string

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPalette((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  async function signOut() {
    if (!demo) await supabase.auth.signOut()
    window.location.assign("/")
  }

  function go(id: string) {
    setMenu(false)
    navigate(pathFor(id))
  }

  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      {demo ? (
        <div className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          Sample workspace for {productName}. Nothing you change here is saved.
        </div>
      ) : null}
      <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-sidebar md:flex">
          <div className="flex h-14 items-center px-3 text-sm font-semibold">{productName}</div>
          <div className="px-3">
            <WorkspaceSwitcher />
          </div>
          <div className="px-3 pt-3">
            <Button className="w-full" onClick={() => navigate(paths.newTask)}>
              <Plus /> New task
            </Button>
          </div>
          <nav className="mt-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
            {NAV.map((item) => (
              <NavButton key={item.id} item={item} active={isActive(pathname, basePath, item.id)} count={item.id === "inbox" ? needsYou : 0} onClick={() => go(item.id)} />
            ))}
          </nav>
          <div className="space-y-1 border-t p-3">
            <Button variant="ghost" className="w-full justify-start" onClick={() => setPalette(true)}>
              <Search /> Search
              <span className="ml-auto text-xs text-muted-foreground">⌘K</span>
            </Button>
            <Button variant="ghost" className="w-full justify-start" onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}>
              {resolved === "dark" ? <Sun /> : <Moon />} {resolved === "dark" ? "Light mode" : "Dark mode"}
            </Button>
            <Button variant="ghost" className="w-full justify-start" onClick={() => void signOut()}>
              <LogOut /> Sign out
            </Button>
            {email ? <p className="truncate px-3 text-xs text-muted-foreground">{email}</p> : null}
          </div>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-2 backdrop-blur md:hidden">
            <WorkspaceSwitcher compact />
            <Button size="icon" variant="ghost" className="ml-auto" aria-label="Search" onClick={() => setPalette(true)}>
              <Search />
            </Button>
            <Button size="icon" variant="ghost" aria-label="New task" onClick={() => navigate(paths.newTask)}>
              <Plus />
            </Button>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:py-6 md:pb-8">{children}</main>
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-4">
          {NAV.slice(0, 3).map((item) => (
            <BottomItem key={item.id} item={item} active={isActive(pathname, basePath, item.id)} count={item.id === "inbox" ? needsYou : 0} onClick={() => go(item.id)} />
          ))}
          <button type="button" className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground" onClick={() => setMenu(true)}>
            <Menu className="size-5" />
            More
          </button>
        </div>
      </nav>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="w-[min(100%,20rem)]">
          <SheetHeader>
            <SheetTitle>{productName}</SheetTitle>
          </SheetHeader>
          <div className="mb-3">
            <WorkspaceSwitcher />
          </div>
          <nav className="flex flex-col gap-0.5">
            {NAV.map((item) => (
              <NavButton key={item.id} item={item} active={isActive(pathname, basePath, item.id)} count={item.id === "inbox" ? needsYou : 0} onClick={() => go(item.id)} />
            ))}
          </nav>
          <div className="mt-4 space-y-2">
            <Button variant="outline" className="w-full" onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}>
              {resolved === "dark" ? <Sun /> : <Moon />} {resolved === "dark" ? "Light mode" : "Dark mode"}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => void signOut()}>
              <LogOut /> Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  )
}

function NavButton({
  item,
  active,
  count,
  onClick,
}: {
  item: (typeof NAV)[number]
  active: boolean
  count: number
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex min-h-11 items-center gap-2 rounded-md px-3 text-left text-sm", active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{item.label}</span>
      {count > 0 ? <span className="rounded-full bg-amber-500/15 px-1.5 text-xs text-amber-700 dark:text-amber-300">{count}</span> : null}
    </button>
  )
}

function BottomItem({
  item,
  active,
  count,
  onClick,
}: {
  item: (typeof NAV)[number]
  active: boolean
  count: number
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button type="button" onClick={onClick} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]", active ? "text-foreground" : "text-muted-foreground")}>
      <Icon className="size-5" />
      {item.label}
      {count > 0 ? <span className="absolute top-1 right-[calc(50%-1.4rem)] size-2 rounded-full bg-amber-500" aria-label={`${count} waiting`} /> : null}
    </button>
  )
}

function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { workspace, workspaces, setWorkspaceId, createWorkspace } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onCreate() {
    setBusy(true)
    setError(null)
    try {
      await createWorkspace(name.trim())
      setName("")
      setOpen(false)
    } catch (createError) {
      setError((createError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className={cn("max-w-full justify-between", compact ? "h-11 min-w-0 flex-1 px-3" : "w-full")}>
            <span className="truncate">{workspace.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {workspaces.map((item) => (
            <DropdownMenuItem key={item.id} onSelect={() => setWorkspaceId(item.id)}>
              <span className="truncate">{item.name}</span>
              {item.id === workspace.id ? <span className="ml-auto text-xs text-muted-foreground">Current</span> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setOpen(true)}>New workspace</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title="New workspace" description="Use one workspace per business.">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void onCreate()
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="Northwind Studio" />
          </Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Creating…" : "Create workspace"}
          </Button>
        </form>
      </ResponsiveDialog>
    </>
  )
}
