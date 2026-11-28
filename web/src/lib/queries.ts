import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { demoActivity, demoAgents, demoArtifacts, demoFacts, demoLoops, demoMembers, demoNotes, demoRuns, demoTasks, demoToolCalls } from "./demo-data"
import { supabase } from "./supabase"
import type { ActivityRow, Agent, Artifact, Fact, HandoffNote, Loop, LoopRun, Member, Task, ToolCall } from "./types"
import { useWorkspace } from "./workspace"

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

function inDemoWorkspace(workspaceId: string) {
  return workspaceId === "ws-north"
}

const AGENT_COLUMNS = "id,slug,name,provider,model,mode,capabilities,system_prompt,is_active,last_seen_at,workspace_id,has_api_key,oauth_client_id,created_by,avatar_url,client_uri,logo_uri,website_url"

export function useAgents() {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["agents", workspaceId, demo],
    queryFn: () => (demo ? (inDemoWorkspace(workspaceId) ? demoAgents : []) : rows<Agent>(supabase.from("agents").select(AGENT_COLUMNS).eq("workspace_id", workspaceId).order("name"))),
  })
}

export function useTasks() {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["tasks", workspaceId, demo],
    queryFn: () =>
      demo
        ? inDemoWorkspace(workspaceId)
          ? demoTasks
          : []
        : rows<Task>(supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("priority").order("created_at", { ascending: false }).limit(500)),
  })
}

export function useTask(id: string | undefined) {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["task", workspaceId, id, demo],
    enabled: !!id,
    queryFn: async () => {
      if (demo) {
        const task = inDemoWorkspace(workspaceId) ? demoTasks.find((item) => item.id === id) : undefined
        if (!task) throw new Error("Task not found")
        return task
      }
      const { data, error } = await supabase.from("tasks").select("*").eq("workspace_id", workspaceId).eq("id", id!).single()
      if (error) throw new Error(error.message)
      return data as Task
    },
  })
}

export function useHandoffNotes(taskId: string | undefined) {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["handoff", workspaceId, taskId, demo],
    enabled: !!taskId,
    queryFn: () =>
      demo
        ? inDemoWorkspace(workspaceId)
          ? demoNotes.filter((note) => note.task_id === taskId)
          : []
        : rows<HandoffNote>(supabase.from("handoff_notes").select("*").eq("workspace_id", workspaceId).eq("task_id", taskId!).order("created_at")),
  })
}

export function useArtifacts() {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["artifacts", workspaceId, demo],
    queryFn: () =>
      demo
        ? inDemoWorkspace(workspaceId)
          ? demoArtifacts
          : []
        : rows<Artifact>(supabase.from("artifacts").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300)),
  })
}

export function useArtifactsByIds(ids: string[]) {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["artifacts", workspaceId, ids, demo],
    enabled: ids.length > 0,
    queryFn: () =>
      demo
        ? inDemoWorkspace(workspaceId)
          ? demoArtifacts.filter((artifact) => ids.includes(artifact.id))
          : []
        : rows<Artifact>(supabase.from("artifacts").select("*").eq("workspace_id", workspaceId).in("id", ids)),
  })
}

export function useFacts() {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["facts", workspaceId, demo],
    queryFn: () =>
      demo
        ? inDemoWorkspace(workspaceId)
          ? demoFacts
          : []
        : rows<Fact>(supabase.from("facts").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300)),
  })
}

export function useLoops() {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["loops", workspaceId, demo],
    queryFn: () => (demo ? (inDemoWorkspace(workspaceId) ? demoLoops : []) : rows<Loop>(supabase.from("loops").select("*").eq("workspace_id", workspaceId).order("name"))),
  })
}

export function useLoopRuns() {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["loop_runs", workspaceId, demo],
    queryFn: () =>
      demo
        ? inDemoWorkspace(workspaceId)
          ? demoRuns
          : []
        : rows<LoopRun>(supabase.from("loop_runs").select("*").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(100)),
  })
}

export function useActivity(limit = 100) {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["activity", workspaceId, limit, demo],
    queryFn: () =>
      demo
        ? inDemoWorkspace(workspaceId)
          ? demoActivity.slice(0, limit)
          : []
        : rows<ActivityRow>(supabase.from("activity").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit)),
  })
}

export function useToolCalls(taskId?: string) {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["tool_calls", workspaceId, taskId ?? "all", demo],
    queryFn: async () => {
      if (demo) {
        const all = inDemoWorkspace(workspaceId) ? demoToolCalls : []
        return taskId ? all.filter((call) => call.task_id === taskId) : all
      }
      let query = supabase.from("tool_calls").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200)
      if (taskId) query = query.eq("task_id", taskId)
      return rows<ToolCall>(query)
    },
  })
}

export function useMembers() {
  const { workspaceId, demo } = useWorkspace()
  return useQuery({
    queryKey: ["members", workspaceId, demo],
    queryFn: async () => {
      if (demo) return workspaceId === "ws-north" ? demoMembers : demoMembers.filter((member) => member.role === "owner")
      const { data, error } = await supabase.from("workspace_members").select("user_id, role").eq("workspace_id", workspaceId)
      if (error) throw new Error(error.message)
      return (data ?? []) as Member[]
    },
  })
}

/** Invalidate task and activity queries when the database changes. */
export function useRealtime() {
  const qc = useQueryClient()
  const { workspaceId, demo } = useWorkspace()
  useEffect(() => {
    if (demo) return
    const channel = supabase
      .channel(`hub-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void qc.invalidateQueries({ queryKey: ["tasks"] })
        void qc.invalidateQueries({ queryKey: ["task"] })
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "activity", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void qc.invalidateQueries({ queryKey: ["activity"] })
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "artifacts", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void qc.invalidateQueries({ queryKey: ["artifacts"] })
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "handoff_notes", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void qc.invalidateQueries({ queryKey: ["handoff"] })
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "facts", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void qc.invalidateQueries({ queryKey: ["facts"] })
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tool_calls", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void qc.invalidateQueries({ queryKey: ["tool_calls"] })
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "loops", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void qc.invalidateQueries({ queryKey: ["loops"] })
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "agents", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void qc.invalidateQueries({ queryKey: ["agents"] })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [qc, workspaceId, demo])
}
