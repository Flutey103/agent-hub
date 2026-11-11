import { createHash, randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { waitUntil } from "./context.js";
import { db } from "./db.js";
import type { Agent } from "./types.js";

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

function dbFailure(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Database error";
  return Response.json({ error: message }, { status: 500 });
}

/** Authenticates an agent by API key (Authorization: Bearer ah_... or X-API-Key). */
export async function authenticateAgent(request: Request): Promise<Agent | Response> {
  const key = bearerFrom(request);
  if (!key) return Response.json({ error: "Missing API key" }, { status: 401 });
  try {
    const { data, error } = await db
      .from("agents")
      .select("id, slug, name, provider, model, mode, capabilities, system_prompt, is_active")
      .eq("api_key_hash", hashKey(key))
      .eq("is_active", true)
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: "Invalid API key" }, { status: 401 });
    const agent = data as Agent;
    waitUntil(
      Promise.resolve(db.from("agents").update({ last_seen_at: new Date().toISOString() }).eq("id", agent.id)).then(({ error: updateError }) => {
        if (updateError) {
          console.error(JSON.stringify({ message: "last_seen update failed", agentId: agent.id, error: updateError.message }));
        }
      }),
    );
    return agent;
  } catch (error) {
    return dbFailure(error);
  }
}

/** Authenticates a human by their Supabase session token (used by the web UI). */
export async function authenticateUser(request: Request): Promise<User | Response> {
  const token = bearerFrom(request);
  if (!token) return Response.json({ error: "Missing session token" }, { status: 401 });
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return Response.json({ error: "Invalid session" }, { status: 401 });
    return data.user;
  } catch (error) {
    return dbFailure(error);
  }
}
