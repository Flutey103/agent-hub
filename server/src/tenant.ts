import { db, HubError } from "./db.js";

/** 404, not 403, so a caller cannot tell a foreign id from a missing one. */
export async function requireMembership(userId: string, workspaceId: string): Promise<void> {
  const { data, error } = await db.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (error) throw new HubError(error.message, 500);
  if (!data) throw new HubError("Not found", 404);
}

/** Owner or admin. 404 when the caller is not a member, so foreign workspaces stay hidden. */
export async function requireWorkspaceAdmin(userId: string, workspaceId: string): Promise<void> {
  const { data, error } = await db.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (error) throw new HubError(error.message, 500);
  if (!data) throw new HubError("Not found", 404);
  const role = (data as { role?: string }).role;
  if (role !== "owner" && role !== "admin") throw new HubError("Only an owner or admin can do that", 403);
}

export async function ensurePersonalWorkspace(userId: string): Promise<void> {
  const { error } = await db.rpc("provision_personal_workspace", { p_user_id: userId });
  if (error) throw new HubError(error.message, 500);
}
