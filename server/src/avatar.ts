/**
 * Resolves an agent icon without letting the browser contact the client's host.
 * logo_uri wins. Otherwise the homepage (client_uri, an https client id, or a
 * redirect origin) is fetched and the largest icon link is used, then /favicon.ico.
 * Bytes are cached in OAUTH_KV under avatar:<agent id> and served from this Worker.
 * Fetch failures never throw out of attachAvatarBestEffort.
 */
import { userIdFromRequest } from "./auth.js";
import { currentEnv, waitUntil } from "./context.js";
import { db, HubError } from "./db.js";
import { requireMembership, requireWorkspaceAdmin } from "./tenant.js";
import { AGENT_COLUMNS, type Agent } from "./types.js";

export const AVATAR_MAX_BYTES = 64 * 1024;
const HTML_MAX_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 2_500;
const RESOLVE_BUDGET_MS = 4_000;
const MAX_REDIRECTS = 2;
const MAX_ICON_ATTEMPTS = 3;

const AGENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "cache-control": "no-store" };

export interface AvatarHints {
  logoUri?: string | null;
  clientUri?: string | null;
  clientId?: string | null;
  redirectUris?: string[] | null;
  websiteUrl?: string | null;
}

export interface ResolvedImage {
  bytes: Uint8Array;
  contentType: string;
  sourceUrl: string;
}

export interface AvatarStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

export type PublicFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface ClientMetadata {
  clientId?: string | null;
  clientUri?: string | null;
  client_uri?: string | null;
  logoUri?: string | null;
  logo_uri?: string | null;
  redirectUris?: string[] | null;
  redirect_uris?: string[] | null;
  websiteUrl?: string | null;
}

export function avatarCacheKey(agentId: string): string {
  return `avatar:${agentId}`;
}

export function avatarHintsFromClient(client: ClientMetadata | null | undefined, extras?: AvatarHints): AvatarHints {
  const redirectUris = [
    ...(Array.isArray(client?.redirectUris) ? client.redirectUris : []),
    ...(Array.isArray(client?.redirect_uris) ? client.redirect_uris : []),
    ...(extras?.redirectUris ?? []),
  ].filter((value): value is string => typeof value === "string");
  return {
    clientId: extras?.clientId ?? client?.clientId ?? null,
    clientUri: extras?.clientUri ?? client?.clientUri ?? client?.client_uri ?? null,
    logoUri: extras?.logoUri ?? client?.logoUri ?? client?.logo_uri ?? null,
    websiteUrl: extras?.websiteUrl ?? client?.websiteUrl ?? null,
    redirectUris,
  };
}

export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host || host.length > 253) return false;
  return !isBlockedHost(host);
}

export function publicOrigin(value: string | null | undefined): string | null {
  if (!value || !isPublicHttpsUrl(value)) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function homepageFromHints(hints: AvatarHints): string | null {
  const explicit = publicOrigin(hints.websiteUrl);
  if (explicit) return explicit;
  const fromClient = publicOrigin(hints.clientUri);
  if (fromClient) return fromClient;
  const fromId = publicOrigin(hints.clientId);
  if (fromId) return fromId;
  for (const redirect of hints.redirectUris ?? []) {
    const origin = publicOrigin(redirect);
    if (origin) return origin;
  }
  return null;
}

export function sourcesFromHints(hints: AvatarHints): { client_uri: string | null; logo_uri: string | null; website_url: string | null } {
  return {
    client_uri: fit(publicHref(hints.clientUri), 2000),
    logo_uri: fit(publicHref(hints.logoUri), 2000),
    website_url: fit(homepageFromHints(hints), 500),
  };
}

export function iconCandidatesFromHtml(html: string, pageUrl: string): string[] {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
  const found: { url: string; size: number }[] = [];
  const tags = cleaned.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags.slice(0, 40)) {
    const rel = attr(tag, "rel");
    if (!rel || !isIconRel(rel)) continue;
    const href = attr(tag, "href");
    if (!href || href.startsWith("data:") || href.startsWith("javascript:")) continue;
    let absolute: string;
    try {
      absolute = new URL(href, pageUrl).href;
    } catch {
      continue;
    }
    if (!isPublicHttpsUrl(absolute)) continue;
    found.push({ url: absolute, size: iconSize(rel, attr(tag, "sizes")) });
  }
  found.sort((left, right) => right.size - left.size);
  const urls: string[] = [];
  for (const item of found) {
    if (!urls.includes(item.url)) urls.push(item.url);
  }
  return urls;
}

export async function resolveAvatarImage(hints: AvatarHints, fetchImpl: PublicFetch = fetch, parent?: AbortSignal): Promise<ResolvedImage | null> {
  if (parent?.aborted) return null;
  const logo = publicHref(hints.logoUri);
  if (logo) {
    const image = await fetchImage(logo, fetchImpl, parent);
    if (image) return image;
  }
  const home = homepageFromHints(hints);
  if (!home) return null;
  const pageUrl = `${home}/`;
  const html = await fetchHtml(pageUrl, fetchImpl, parent);
  const discovered = html ? iconCandidatesFromHtml(html, pageUrl) : [];
  const favicon = `${home}/favicon.ico`;
  const shortlist = discovered.filter((url) => url !== favicon).slice(0, 2);
  if (isPublicHttpsUrl(favicon)) shortlist.push(favicon);
  const tried = new Set<string>(logo ? [logo] : []);
  let attempts = 0;
  for (const url of shortlist) {
    if (tried.has(url)) continue;
    tried.add(url);
    if (attempts >= MAX_ICON_ATTEMPTS) break;
    attempts += 1;
    const image = await fetchImage(url, fetchImpl, parent);
    if (image) return image;
  }
  return null;
}

export function kvAvatarStore(kv: KVNamespace): AvatarStore {
  return {
    async put(key, bytes, contentType) {
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      await kv.put(key, copy, { metadata: { contentType } });
    },
    async get(key) {
      const result = await kv.getWithMetadata<{ contentType?: string }>(key, { type: "arrayBuffer" });
      if (!result.value) return null;
      const bytes = new Uint8Array(result.value);
      const sniffed = sniffImage(bytes);
      const declared = result.metadata?.contentType;
      const contentType = sniffed ?? (declared && declared.startsWith("image/") && declared !== "image/svg+xml" ? declared : null);
      if (!contentType) return null;
      return { bytes, contentType };
    },
  };
}

export async function rememberAgentAvatar(
  agentId: string,
  workspaceId: string,
  hints: AvatarHints,
  options?: { fetch?: PublicFetch; store?: AvatarStore | null },
): Promise<"stored" | "skipped"> {
  const deadline = AbortSignal.timeout(RESOLVE_BUDGET_MS);
  const image = await resolveAvatarImage(hints, options?.fetch ?? fetch, deadline).catch((error: unknown) => {
    console.error(JSON.stringify({ message: "avatar fetch failed", agentId, error: error instanceof Error ? error.name : "unknown" }));
    return null;
  });
  if (!image) return "skipped";
  const store = resolveStore(options && "store" in options ? options.store : undefined);
  let avatarUrl = `/api/agents/${agentId}/avatar`;
  if (store) {
    try {
      await store.put(avatarCacheKey(agentId), image.bytes, image.contentType);
    } catch (error) {
      console.error(JSON.stringify({ message: "avatar cache failed", agentId, error: error instanceof Error ? error.name : "unknown" }));
      avatarUrl = toDataUrl(image.bytes, image.contentType);
    }
  } else {
    avatarUrl = toDataUrl(image.bytes, image.contentType);
  }
  if (avatarUrl.length > 120_000) return "skipped";
  const { error } = await db
    .from("agents")
    .update({ avatar_url: avatarUrl })
    .eq("id", agentId)
    .eq("workspace_id", workspaceId);
  if (error) throw new HubError(error.message, 500);
  console.log(JSON.stringify({ message: "avatar stored", agentId, bytes: image.bytes.byteLength, contentType: image.contentType }));
  return "stored";
}

/** Approval keeps going even when the icon cannot be fetched or saved. */
export async function attachAvatarBestEffort(
  agentId: string,
  workspaceId: string,
  hints: AvatarHints,
  options?: { fetch?: PublicFetch; store?: AvatarStore | null },
): Promise<void> {
  try {
    const outcome = await rememberAgentAvatar(agentId, workspaceId, hints, options);
    if (outcome === "skipped") {
      console.log(JSON.stringify({ message: "avatar skipped", agentId }));
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "avatar resolve failed", agentId, error: error instanceof Error ? error.message : "unknown" }));
  }
}

export function scheduleAvatar(agentId: string, workspaceId: string, hints: AvatarHints): void {
  waitUntil(attachAvatarBestEffort(agentId, workspaceId, hints));
}

export async function updateAgentAvatar(input: {
  userId: string;
  workspaceId: string;
  agentId: string;
  websiteUrl?: string | null;
  imageUrl?: string | null;
  refresh?: boolean;
  fetch?: PublicFetch;
  store?: AvatarStore | null;
}): Promise<Agent> {
  await requireMembership(input.userId, input.workspaceId);
  const existing = await loadAgent(input.agentId, input.workspaceId);
  const patch: Record<string, string | null> = {};
  if (input.websiteUrl !== undefined) {
    patch.website_url = input.websiteUrl ? normalizeWebsite(input.websiteUrl) : null;
  }
  if (input.imageUrl !== undefined) {
    if (existing.oauth_client_id) throw new HubError("This assistant takes its icon from the connected app. Refresh the icon instead.");
    patch.logo_uri = input.imageUrl ? normalizeImageUrl(input.imageUrl) : null;
  }
  if (input.websiteUrl === undefined && input.imageUrl === undefined && !input.refresh) {
    throw new HubError("Add a website or an icon URL");
  }
  let agent = existing;
  if (Object.keys(patch).length > 0) {
    const updated = await db.from("agents").update(patch).eq("id", input.agentId).eq("workspace_id", input.workspaceId).select(AGENT_COLUMNS).single();
    if (updated.error || !updated.data) throw new HubError(updated.error?.message ?? "Agent update failed", 500);
    agent = updated.data as Agent;
  }
  const hints = hintsFromAgent(agent);
  if (!homepageFromHints(hints) && !publicHref(hints.logoUri)) {
    throw new HubError("Add a website or an icon URL");
  }
  const outcome = await rememberAgentAvatar(input.agentId, input.workspaceId, hints, { fetch: input.fetch, store: input.store });
  if (outcome === "skipped") throw new HubError("Could not fetch an icon from that site. The website was saved.", 422);
  return loadAgent(input.agentId, input.workspaceId);
}

export async function backfillAgentAvatars(input: {
  userId: string;
  workspaceId: string;
  lookupClient?: (clientId: string) => Promise<ClientMetadata | null>;
  fetch?: PublicFetch;
  store?: AvatarStore | null;
  budgetMs?: number;
}): Promise<{ updated: number; skipped: number; failed: number; remaining: number }> {
  await requireWorkspaceAdmin(input.userId, input.workspaceId);
  const listed = await db
    .from("agents")
    .select("id, oauth_client_id, client_uri, logo_uri, website_url, avatar_url")
    .eq("workspace_id", input.workspaceId)
    .limit(100);
  if (listed.error) throw new HubError(listed.error.message, 500);
  const rows = (listed.data ?? []) as {
    id: string;
    oauth_client_id: string | null;
    client_uri: string | null;
    logo_uri: string | null;
    website_url: string | null;
    avatar_url: string | null;
  }[];
  const deadline = Date.now() + (input.budgetMs ?? 20_000);
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let index = 0;
  for (; index < rows.length; index += 1) {
    if (Date.now() > deadline) break;
    const row = rows[index];
    if (row.avatar_url) {
      skipped += 1;
      continue;
    }
    let client: ClientMetadata | null = null;
    if (row.oauth_client_id && input.lookupClient) {
      try {
        client = await input.lookupClient(row.oauth_client_id);
      } catch {
        client = null;
      }
    }
    const hints = avatarHintsFromClient(client, {
      clientId: row.oauth_client_id,
      clientUri: row.client_uri,
      logoUri: row.logo_uri,
      websiteUrl: row.website_url,
    });
    if (!homepageFromHints(hints) && !publicHref(hints.logoUri)) {
      skipped += 1;
      continue;
    }
    const sources = sourcesFromHints(hints);
    const patch: Record<string, string> = {};
    if (!row.client_uri && sources.client_uri) patch.client_uri = sources.client_uri;
    if (!row.logo_uri && sources.logo_uri) patch.logo_uri = sources.logo_uri;
    if (!row.website_url && sources.website_url) patch.website_url = sources.website_url;
    if (Object.keys(patch).length > 0) {
      const saved = await db.from("agents").update(patch).eq("id", row.id).eq("workspace_id", input.workspaceId);
      if (saved.error) throw new HubError(saved.error.message, 500);
    }
    try {
      const outcome = await rememberAgentAvatar(row.id, input.workspaceId, hints, { fetch: input.fetch, store: input.store });
      if (outcome === "stored") updated += 1;
      else failed += 1;
    } catch (error) {
      console.error(JSON.stringify({ message: "avatar backfill failed", agentId: row.id, error: error instanceof Error ? error.message : "unknown" }));
      failed += 1;
    }
  }
  return { updated, skipped, failed, remaining: rows.length - index };
}

export async function serveAgentAvatar(request: Request, agentId: string): Promise<Response> {
  if (!AGENT_ID.test(agentId)) return new Response(null, { status: 404, headers: NO_STORE });
  const userId = await userIdFromRequest(request);
  if (userId instanceof Response) return userId;
  const kv = currentEnv()?.OAUTH_KV;
  if (!kv) return new Response(null, { status: 404, headers: NO_STORE });
  const image = await loadAvatarForUser(userId, agentId, kvAvatarStore(kv));
  if (!image) return new Response(null, { status: 404, headers: NO_STORE });
  return new Response(image.bytes, {
    headers: {
      "content-type": image.contentType,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      vary: "cookie",
      "content-security-policy": "default-src 'none'",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function loadAvatarForUser(userId: string, agentId: string, store: AvatarStore): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const row = await db.from("agents").select("id, workspace_id").eq("id", agentId).maybeSingle();
  if (row.error) throw new HubError(row.error.message, 500);
  const agent = row.data as { id: string; workspace_id: string } | null;
  if (!agent?.workspace_id) return null;
  try {
    await requireMembership(userId, agent.workspace_id);
  } catch (error) {
    if (error instanceof HubError && error.status === 404) return null;
    throw error;
  }
  return store.get(avatarCacheKey(agentId));
}

function hintsFromAgent(agent: Agent): AvatarHints {
  return {
    clientId: agent.oauth_client_id,
    clientUri: agent.client_uri,
    logoUri: agent.logo_uri,
    websiteUrl: agent.website_url,
  };
}

async function loadAgent(agentId: string, workspaceId: string): Promise<Agent> {
  const result = await db.from("agents").select(AGENT_COLUMNS).eq("id", agentId).eq("workspace_id", workspaceId).maybeSingle();
  if (result.error) throw new HubError(result.error.message, 500);
  if (!result.data) throw new HubError("Not found", 404);
  return result.data as Agent;
}

function resolveStore(store: AvatarStore | null | undefined): AvatarStore | null {
  if (store !== undefined) return store;
  const kv = currentEnv()?.OAUTH_KV;
  return kv ? kvAvatarStore(kv) : null;
}

function normalizeWebsite(value: string): string {
  const url = parsePublic(value, "Website");
  if (url.origin.length > 500) throw new HubError("Website URL is too long");
  return url.origin;
}

function normalizeImageUrl(value: string): string {
  const url = parsePublic(value, "Icon URL");
  url.hash = "";
  if (url.href.length > 2000) throw new HubError("Icon URL is too long");
  return url.href;
}

function parsePublic(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HubError(`${label} must be an https URL`);
  }
  if (!isPublicHttpsUrl(url.href)) throw new HubError(`${label} must be a public https URL`);
  return url;
}

function publicHref(value: string | null | undefined): string | null {
  if (!value || !isPublicHttpsUrl(value)) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function fit(value: string | null, max: number): string | null {
  if (!value || value.length > max) return null;
  return value;
}

function isBlockedHost(host: string): boolean {
  if (host === "localhost" || host === "0.0.0.0" || host === "metadata.google.internal" || host === "metadata.google") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localdomain")) return true;
  if (host.endsWith(".intranet") || host.endsWith(".lan") || host.endsWith(".home.arpa") || host.endsWith(".arpa")) return true;
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  if (host.includes(":")) return isBlockedIPv6(host);
  const v4 = ipv4Status(host);
  return v4 === "blocked";
}

function ipv4Status(host: string): "hostname" | "public" | "blocked" {
  if (!/^[\d.]+$/.test(host)) return "hostname";
  const parts = host.split(".");
  if (parts.length !== 4) return "blocked";
  if (parts.some((part) => part.length === 0 || part.length > 3 || (part.length > 1 && part.startsWith("0")) || !/^\d+$/.test(part))) return "blocked";
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => n > 255)) return "blocked";
  return isPrivateIPv4(nums[0], nums[1], nums[2]) ? "blocked" : "public";
}

function isPrivateIPv4(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8:")) return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (mapped) return ipv4Status(mapped[1]) !== "public";
  if (normalized.startsWith("::ffff:")) return true;
  return false;
}

function isIconRel(rel: string): boolean {
  const tokens = rel.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.includes("icon") || tokens.includes("apple-touch-icon") || tokens.includes("apple-touch-icon-precomposed");
}

function iconSize(rel: string, sizes: string | null): number {
  if (sizes) {
    if (sizes.trim().toLowerCase() === "any") return 512;
    let best = 0;
    for (const part of sizes.split(/\s+/)) {
      const match = /^(\d+)x(\d+)$/i.exec(part);
      if (match) best = Math.max(best, Number(match[1]), Number(match[2]));
    }
    if (best > 0) return best;
  }
  const tokens = rel.toLowerCase().split(/\s+/);
  if (tokens.includes("apple-touch-icon") || tokens.includes("apple-touch-icon-precomposed")) return 180;
  return 32;
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i").exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!value) return null;
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

async function fetchHtml(url: string, fetchImpl: PublicFetch, parent?: AbortSignal): Promise<string | null> {
  const loaded = await fetchPublic(url, "text/html,application/xhtml+xml;q=0.9", HTML_MAX_BYTES, fetchImpl, parent);
  if (!loaded) return null;
  const type = loaded.contentType;
  const looksHtml = type === "text/html" || type === "application/xhtml+xml" || (type === "" && loaded.bytes[0] === 0x3c);
  if (!looksHtml) return null;
  return new TextDecoder().decode(loaded.bytes);
}

async function fetchImage(url: string, fetchImpl: PublicFetch, parent?: AbortSignal): Promise<ResolvedImage | null> {
  const loaded = await fetchPublic(url, "image/png,image/jpeg,image/webp,image/gif,image/x-icon;q=0.8,*/*;q=0.1", AVATAR_MAX_BYTES, fetchImpl, parent);
  if (!loaded) return null;
  const contentType = acceptImage(loaded.bytes, loaded.contentType);
  if (!contentType) return null;
  return { bytes: loaded.bytes, contentType, sourceUrl: loaded.finalUrl };
}

async function fetchPublic(
  url: string,
  accept: string,
  maxBytes: number,
  fetchImpl: PublicFetch,
  parent?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (parent?.aborted || !isPublicHttpsUrl(current)) return null;
    const timed = linkSignal(parent, FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: { accept, "user-agent": "AgentHubAvatar/1.0" },
        signal: timed.signal,
      });
    } catch {
      timed.cancel();
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      timed.cancel();
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) return null;
      try {
        current = new URL(location, current).href;
      } catch {
        return null;
      }
      continue;
    }
    try {
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const bytes = await readLimited(response, maxBytes);
      if (!bytes) return null;
      return { bytes, contentType, finalUrl: current };
    } finally {
      timed.cancel();
    }
  }
  return null;
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const BLOCKED_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/plain",
  "application/javascript",
  "text/javascript",
]);

function acceptImage(bytes: Uint8Array, declared: string): string | null {
  if (BLOCKED_TYPES.has(declared)) return null;
  return sniffImage(bytes);
}

export function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && (bytes[2] === 0x01 || bytes[2] === 0x02) && bytes[3] === 0x00) return "image/x-icon";
  return null;
}

function toDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

function linkSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParent = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", onParent, { once: true });
  }
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}
