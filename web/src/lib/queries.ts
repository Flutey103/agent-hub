import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "./supabase";
import type { ActivityRow, Agent, Artifact, HandoffNote, Loop, Task } from "./types";

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => rows<Agent>(supabase.from("agents").select("id,slug,name,provider,model,mode,capabilities,system_prompt,is_active,last_seen_at").order("name")),
  });
}

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: () => rows<Task>(supabase.from("tasks").select("*").order("priority").order("created_at", { ascending: false }).limit(500)),
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ["task", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").eq("id", id!).single();
      if (error) throw new Error(error.message);
      return data as Task;
    },
  });
}

export function useHandoffNotes(taskId: string | undefined) {
  return useQuery({
    queryKey: ["handoff", taskId],
    enabled: !!taskId,
    queryFn: () => rows<HandoffNote>(supabase.from("handoff_notes").select("*").eq("task_id", taskId!).order("created_at")),
  });
}

export function useArtifacts() {
  return useQuery({
    queryKey: ["artifacts"],
    queryFn: () => rows<Artifact>(supabase.from("artifacts").select("*").order("created_at", { ascending: false }).limit(300)),
  });
}

export function useArtifactsByIds(ids: string[]) {
  return useQuery({
    queryKey: ["artifacts", ids],
    enabled: ids.length > 0,
    queryFn: () => rows<Artifact>(supabase.from("artifacts").select("*").in("id", ids)),
  });
}

export function useLoops() {
  return useQuery({ queryKey: ["loops"], queryFn: () => rows<Loop>(supabase.from("loops").select("*").order("name")) });
}

export function useActivity(limit = 100) {
  return useQuery({
    queryKey: ["activity", limit],
    queryFn: () => rows<ActivityRow>(supabase.from("activity").select("*").order("created_at", { ascending: false }).limit(limit)),
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
