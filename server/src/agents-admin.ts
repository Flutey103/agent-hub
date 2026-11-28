import { randomBytes } from "node:crypto";
import { sourcesFromHints, type AvatarHints } from "./avatar.js";
import { generateKey, hashKey } from "./auth.js";
import { providerFromClientName, resolveCapabilities } from "./capabilities.js";
import { db, HubError } from "./db.js";
import { requireMembership } from "./tenant.js";
import { AGENT_COLUMNS, type Agent } from "./types.js";

const PROVIDERS = new Set(["anthropic", "openai", "xai", "other"]);
const MODES = new Set(["connected", "headless"]);

export function agentSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "agent"}-${randomBytes(3).toString("hex")}`;
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw new HubError("Agent name must be 1-80 characters");
  return trimmed;
}

async function insertAgent(row: Record<string, unknown>): Promise<Agent> {
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await db.from("agents").insert(row).select(AGENT_COLUMNS).single();
    if (!result.error && result.data) return result.data as Agent;
    lastError = result.error;
    if (!result.error?.message.toLowerCase().includes("duplicate") && !result.error?.message.toLowerCase().includes("unique")) {
      throw new HubError(result.error?.message ?? "Agent insert failed", 500);
    }
    row.slug = agentSlug(String(row.name));
  }
  throw new HubError(lastError?.message ?? "Agent insert failed", 500);
}

export async function createAgentWithKey(input: {
  userId: string;
  workspaceId: string;
  name: string;
  provider?: string;
  mode?: string;
  preset?: string;
  capabilities?: string[];
  model?: string | null;
  systemPrompt?: string | null;
}): Promise<{ agent: Agent; apiKey: string }> {
  await requireMembership(input.userId, input.workspaceId);
  const provider = input.provider ?? "other";
  const mode = input.mode ?? "connected";
  if (!PROVIDERS.has(provider)) throw new HubError("Unknown provider");
  if (!MODES.has(mode)) throw new HubError("Unknown mode");
  const name = cleanName(input.name);
  const apiKey = generateKey();
  const agent = await insertAgent({
    workspace_id: input.workspaceId,
    slug: agentSlug(name),
    name,
    provider,
    model: input.model?.trim() || null,
    mode,
    capabilities: resolveCapabilities(input.preset, input.capabilities ?? []),
    system_prompt: input.systemPrompt?.trim() || null,
    api_key_hash: hashKey(apiKey),
    is_active: true,
    created_by: input.userId,
    avatar_url: null,
    client_uri: null,
    logo_uri: null,
    website_url: null,
  });
  return { agent, apiKey };
}

export async function revokeAgentKey(userId: string, workspaceId: string, agentId: string): Promise<void> {
  await requireMembership(userId, workspaceId);
  const existing = await db.from("agents").select("id").eq("id", agentId).eq("workspace_id", workspaceId).maybeSingle();
  if (existing.error) throw new HubError(existing.error.message, 500);
  if (!existing.data) throw new HubError("Not found", 404);
  const { error } = await db.from("agents").update({ api_key_hash: null }).eq("id", agentId).eq("workspace_id", workspaceId);
  if (error) throw new HubError(error.message, 500);
}

/** Registers the agent a connector approval is allowed to act as. */
export async function registerConnectedAgent(input: {
  userId: string;
  workspaceId: string;
  name: string;
  preset?: string;
  clientId: string;
  clientName: string;
  clientUri?: string | null;
  logoUri?: string | null;
  redirectUris?: string[] | null;
  websiteUrl?: string | null;
}): Promise<Agent> {
  await requireMembership(input.userId, input.workspaceId);
  const name = cleanName(input.name);
  const hints: AvatarHints = {
    clientId: input.clientId,
    clientUri: input.clientUri,
    logoUri: input.logoUri,
    redirectUris: input.redirectUris,
    websiteUrl: input.websiteUrl,
  };
  const sources = sourcesFromHints(hints);
  return insertAgent({
    workspace_id: input.workspaceId,
    slug: agentSlug(name),
    name,
    provider: providerFromClientName(input.clientName),
    mode: "connected",
    capabilities: resolveCapabilities(input.preset),
    is_active: true,
    created_by: input.userId,
    oauth_client_id: input.clientId,
    avatar_url: null,
    client_uri: sources.client_uri,
    logo_uri: sources.logo_uri,
    website_url: sources.website_url,
  });
}

export async function deleteAgent(agentId: string, workspaceId: string): Promise<void> {
  const result = await db.from("agents").delete().eq("id", agentId).eq("workspace_id", workspaceId);
  if (result.error) throw new HubError(result.error.message, 500);
}

export function publicAgent(agent: Agent) {
  return {
    id: agent.id,
    slug: agent.slug,
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    mode: agent.mode,
    capabilities: agent.capabilities,
    workspace_id: agent.workspace_id,
  };
}
