import { createHash, randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { waitUntil } from "./context.js";
import { db } from "./db.js";
import { readCookie, SESSION_COOKIE } from "./session-cookie.js";
import { AGENT_COLUMNS, type Agent } from "./types.js";

export interface GrantProps {
  agentId: string;
  workspaceId: string;
  userId: string;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateKey(): string {
  return `ah_${randomBytes(32).toString("base64url")}`;
}

export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const alt = request.headers.get("x-api-key");
  return alt?.trim() || null;
}

/** True when the caller presented a static ah_ key rather than an OAuth access token. */
export function isStaticAgentKey(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^bearer\s+(\S+)/i.exec(header.trim());
    return !!match && match[1].startsWith("ah_");
  }
  const alt = request.headers.get("x-api-key")?.trim();
  return !!alt?.startsWith("ah_");
}

export function isMcpPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/mcp/");
}

function dbFailure(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Database error";
  return Response.json({ error: message }, { status: 500 });
}

function touchLastSeen(agent: Agent): void {
  waitUntil(
    Promise.resolve(
      db.from("agents").update({ last_seen_at: new Date().toISOString() }).eq("id", agent.id).eq("workspace_id", agent.workspace_id),
    ).then(({ error: updateError }) => {
      if (updateError) {
        console.error(JSON.stringify({ message: "last_seen update failed", agentId: agent.id, error: updateError.message }));
      }
    }),
  );
}

/** Authenticates an agent by API key (Authorization: Bearer ah_... or X-API-Key). */
export async function authenticateAgent(request: Request): Promise<Agent | Response> {
  const key = bearerFrom(request);
  if (!key) return Response.json({ error: "Missing API key" }, { status: 401 });
  try {
    const { data, error } = await db.from("agents").select(AGENT_COLUMNS).eq("api_key_hash", hashKey(key)).eq("is_active", true).maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: "Invalid API key" }, { status: 401 });
    const agent = data as Agent;
    if (!agent.workspace_id) return Response.json({ error: "Invalid API key" }, { status: 401 });
    touchLastSeen(agent);
    return agent;
  } catch (error) {
    return dbFailure(error);
  }
}

/**
 * Resolves the agent an OAuth grant was issued for. The workspace in the
 * token must match the agent row; a grant cannot be pointed at another tenant.
 */
export async function loadAgentForGrant(props: GrantProps): Promise<Agent | null> {
  if (!props.agentId || !props.workspaceId) return null;
  const { data, error } = await db
    .from("agents")
    .select(AGENT_COLUMNS)
    .eq("id", props.agentId)
    .eq("workspace_id", props.workspaceId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  const agent = data as Agent;
  if (agent.workspace_id !== props.workspaceId) return null;
  touchLastSeen(agent);
  return agent;
}

/**
 * Human identity from a Bearer token or the ah_session cookie. Image requests
 * cannot send Authorization, so the avatar route accepts the cookie too.
 * This does not provision a workspace; mutating routes still use authenticateUser.
 */
export async function userIdFromRequest(request: Request): Promise<string | Response> {
  const token = bearerFrom(request) ?? readCookie(request, SESSION_COOKIE);
  if (!token) return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
    return data.user.id;
  } catch (error) {
    return dbFailure(error);
  }
}

/** Authenticates a human by their Supabase session token and ensures they have a personal workspace. */
export async function authenticateUser(request: Request): Promise<User | Response> {
  const token = bearerFrom(request);
  if (!token) return Response.json({ error: "Missing session token" }, { status: 401 });
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return Response.json({ error: "Invalid session" }, { status: 401 });
    const ensured = await db.rpc("provision_personal_workspace", { p_user_id: data.user.id });
    if (ensured.error) return Response.json({ error: ensured.error.message }, { status: 500 });
    return data.user;
  } catch (error) {
    return dbFailure(error);
  }
}
