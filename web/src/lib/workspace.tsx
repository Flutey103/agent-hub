import type { Session } from "@supabase/supabase-js"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { demoEmail, demoUserId, demoWorkspaces } from "./demo-data"
import { supabase } from "./supabase"

export interface Workspace {
  id: string
  name: string
  slug: string
  role: "owner" | "admin" | "member"
}

interface WorkspaceContextValue {
  workspaceId: string
  workspace: Workspace
  workspaces: Workspace[]
  setWorkspaceId: (id: string) => void
  createWorkspace: (name: string) => Promise<void>
  renameWorkspace: (name: string) => Promise<void>
  demo: boolean
  basePath: string
  userId: string | null
  email: string | null
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
const STORAGE_KEY = "agent-hub.workspaceId"

async function loadWorkspaces(): Promise<Workspace[]> {
  const { error: ensuredError } = await supabase.rpc("ensure_personal_workspace")
  if (ensuredError) throw new Error(ensuredError.message)
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error(userError?.message ?? "Not signed in")
  const { data, error } = await supabase.from("workspace_members").select("role, workspaces(id, name, slug)").eq("user_id", userData.user.id)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as {
    role: Workspace["role"]
    workspaces: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null
  }[]
  return rows
    .flatMap((row) => {
      const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces
      if (!workspace) return []
      return [{ ...workspace, role: row.role }]
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function DemoWorkspace({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(demoWorkspaces)
  const [workspaceId, setWorkspaceIdState] = useState(demoWorkspaces[0].id)
  const workspace = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0]

  function setWorkspaceId(id: string) {
    setWorkspaceIdState(id)
  }

  async function createWorkspace(name: string) {
    const id = `ws-${Math.random().toString(36).slice(2, 8)}`
    const next = { id, name: name.trim(), slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"), role: "owner" as const }
    setWorkspaces((current) => [...current, next])
    setWorkspaceId(id)
  }

  async function renameWorkspace(name: string) {
    setWorkspaces((current) => current.map((item) => (item.id === workspaceId ? { ...item, name: name.trim() } : item)))
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspaceId,
        workspace,
        workspaces,
        setWorkspaceId,
        createWorkspace,
        renameWorkspace,
        demo: true,
        basePath: "/preview",
        userId: demoUserId,
        email: demoEmail,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

export function WorkspaceProvider({ session, demo = false, children }: { session?: Session | null; demo?: boolean; children: ReactNode }) {
  if (demo) return <DemoWorkspace>{children}</DemoWorkspace>
  return <LiveWorkspace session={session ?? null}>{children}</LiveWorkspace>
}

function LiveWorkspace({ session, children }: { session: Session | null; children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadWorkspaces()
      .then((next) => {
        if (cancelled) return
        if (!next.length) {
          setError("No workspace is available for this account.")
          setWorkspaces([])
          return
        }
        const stored = localStorage.getItem(STORAGE_KEY)
        const selected = next.some((workspace) => workspace.id === stored) ? stored : next[0].id
        setWorkspaces(next)
        setWorkspaceIdState(selected)
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message)
      })
    return () => {
      cancelled = true
    }
  }, [session?.user.id])

  function setWorkspaceId(id: string) {
    setWorkspaceIdState(id)
    localStorage.setItem(STORAGE_KEY, id)
  }

  async function createWorkspace(name: string) {
    const { data, error: createError } = await supabase.rpc("create_workspace", { p_name: name })
    if (createError) throw new Error(createError.message)
    const next = await loadWorkspaces()
    setWorkspaces(next)
    const created = typeof data === "string" ? data : next[next.length - 1]?.id
    if (created) setWorkspaceId(created)
  }

  async function renameWorkspace(name: string) {
    if (!workspaceId) return
    const trimmed = name.trim()
    const { error: updateError } = await supabase.from("workspaces").update({ name: trimmed }).eq("id", workspaceId)
    if (updateError) throw new Error(updateError.message)
    setWorkspaces((current) => current?.map((item) => (item.id === workspaceId ? { ...item, name: trimmed } : item)) ?? current)
  }

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="w-full max-w-md space-y-2 rounded-lg border p-6">
          <h1 className="text-lg font-semibold">Workspace</h1>
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }
  if (!workspaces || !workspaceId) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading workspace…</p>
      </div>
    )
  }
  const workspace = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0]

  return (
    <WorkspaceContext.Provider
      value={{
        workspaceId,
        workspace,
        workspaces,
        setWorkspaceId,
        createWorkspace,
        renameWorkspace,
        demo: false,
        basePath: "",
        userId: session?.user.id ?? null,
        email: session?.user.email ?? null,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error("WorkspaceProvider is missing")
  return value
}

export function usePaths() {
  const { basePath } = useWorkspace()
  return {
    home: `${basePath}/home`,
    inbox: `${basePath}/inbox`,
    tasks: `${basePath}/tasks`,
    newTask: `${basePath}/tasks/new`,
    task: (id: string) => `${basePath}/tasks/${id}`,
    workflows: `${basePath}/workflows`,
    newWorkflow: `${basePath}/workflows/new`,
    workflow: (id: string) => `${basePath}/workflows/${id}`,
    knowledge: `${basePath}/knowledge`,
    facts: `${basePath}/knowledge/facts`,
    agents: `${basePath}/agents`,
    activity: `${basePath}/activity`,
    settings: `${basePath}/settings`,
  }
}
