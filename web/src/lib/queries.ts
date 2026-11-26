import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "./supabase";
import type { ActivityRow, Agent, Artifact, HandoffNote, Loop, Task } from "./types";
import { useWorkspace } from "./workspace";

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

const AGENT_COLUMNS = "id,slug,name,provider,model,mode,capabilities,system_prompt,is_active,last_seen_at,workspace_id,has_api_key,oauth_client_id,created_by";

export function useAgents() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: () => rows<Agent>(supabase.from("agents").select(AGENT_COLUMNS).eq("workspace_id", workspaceId).order("name")),
  });
}

export function useTasks() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["tasks", workspaceId],
    queryFn: () => rows<Task>(supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("priority").order("created_at", { ascending: false }).limit(500)),
  });
}

export function useTask(id: string | undefined) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["task", workspaceId, id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").eq("workspace_id", workspaceId).eq("id", id!).single();
      if (error) throw new Error(error.message);
      return data as Task;
    },
  });
}

export function useHandoffNotes(taskId: string | undefined) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["handoff", workspaceId, taskId],
    enabled: !!taskId,
    queryFn: () => rows<HandoffNote>(supabase.from("handoff_notes").select("*").eq("workspace_id", workspaceId).eq("task_id", taskId!).order("created_at")),
  });
}

export function useArtifacts() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["artifacts", workspaceId],
    queryFn: () => rows<Artifact>(supabase.from("artifacts").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300)),
  });
}

export function useArtifactsByIds(ids: string[]) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["artifacts", workspaceId, ids],
    enabled: ids.length > 0,
    queryFn: () => rows<Artifact>(supabase.from("artifacts").select("*").eq("workspace_id", workspaceId).in("id", ids)),
  });
}

export function useLoops() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["loops", workspaceId],
    queryFn: () => rows<Loop>(supabase.from("loops").select("*").eq("workspace_id", workspaceId).order("name")),
  });
}

export function useActivity(limit = 100) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["activity", workspaceId, limit],
    queryFn: () => rows<ActivityRow>(supabase.from("activity").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit)),
  });
}

/** Invalidate task and activity queries when the database changes. */
export function useRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("hub")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["task"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "activity" }, () => {
        void qc.invalidateQueries({ queryKey: ["activity"] });
        void qc.invalidateQueries({ queryKey: ["artifacts"] });
        void qc.invalidateQueries({ queryKey: ["handoff"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
