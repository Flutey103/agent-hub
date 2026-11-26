import { db, HubError } from "./db.js";

/** 404, not 403, so a caller cannot tell a foreign id from a missing one. */
export async function requireMembership(userId: string, workspaceId: string): Promise<void> {
  const { data, error } = await db.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (error) throw new HubError(error.message, 500);
  if (!data) throw new HubError("Not found", 404);
}

export async function ensurePersonalWorkspace(userId: string): Promise<void> {
  const { error } = await db.rpc("provision_personal_workspace", { p_user_id: userId });
  if (error) throw new HubError(error.message, 500);
}
