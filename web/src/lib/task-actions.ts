import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { serverPost } from "./api"
import { supabase } from "./supabase"
import { useWorkspace } from "./workspace"

export function usePreviewLock() {
  const { demo } = useWorkspace()
  return (label = "That change") => {
    if (!demo) return false
    toast("Preview only", { description: `${label} isn't saved in the sample workspace.` })
    return true
  }
}

export async function refreshWork(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["tasks"] }),
    qc.invalidateQueries({ queryKey: ["task"] }),
    qc.invalidateQueries({ queryKey: ["activity"] }),
    qc.invalidateQueries({ queryKey: ["handoff"] }),
    qc.invalidateQueries({ queryKey: ["loops"] }),
    qc.invalidateQueries({ queryKey: ["loop_runs"] }),
  ])
}

export async function approveTask(taskId: string, summary: string) {
  await serverPost(`/human/tasks/${taskId}/complete`, { summary: summary.trim() || "Approved" })
}

export async function requestTaskChanges(workspaceId: string, taskId: string, note: string) {
  const summary = note.trim()
  if (!summary) throw new Error("Add a note so the assistant knows what to change.")
  const { error } = await supabase
    .from("tasks")
    .update({ status: "queued", is_human: false, claimed_by: null, lease_expires_at: null, result_summary: summary })
    .eq("id", taskId)
    .eq("workspace_id", workspaceId)
  if (error) throw new Error(error.message)
  const { error: activityError } = await supabase.from("activity").insert({
    workspace_id: workspaceId,
    task_id: taskId,
    event: "changes_requested",
    detail: { note: summary },
  })
  if (activityError) throw new Error(activityError.message)
}

export async function cancelTask(workspaceId: string, taskId: string) {
  const { error } = await supabase.from("tasks").update({ status: "cancelled" }).eq("id", taskId).eq("workspace_id", workspaceId)
  if (error) throw new Error(error.message)
}
