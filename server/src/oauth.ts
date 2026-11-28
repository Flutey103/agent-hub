/**
 * OAuth approval for MCP connectors. The provider validates the request,
 * PKCE, and the client. This page signs the user in with Supabase, lets them
 * pick a workspace and an agent name, then stores the new agent id in the
 * token props. The web app stores the Supabase access token in the ah_session
 * cookie on sign-in and refresh. This page reads that cookie and renders
 * Approve without asking for a password again.
 */
import { AuthorizationError, CimdFetchError, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createClient } from "@supabase/supabase-js";
import type { Context } from "hono";
import { deleteAgent, registerConnectedAgent } from "./agents-admin.js";
import { prefillAgentName } from "./capabilities.js";
import { db, HubError } from "./db.js";
import { ConfigError, env } from "./env.js";
import { renderConsentPage, renderMessagePage, type ConsentView } from "./oauth-page.js";
import { readCookie, SESSION_COOKIE, sessionCookie } from "./session-cookie.js";
import { ensurePersonalWorkspace } from "./tenant.js";

interface SessionUser {
  id: string;
  email: string | null;
}

interface Membership {
  id: string;
  name: string;
  role: string;
}

function html(body: string, extra?: Headers, status = 200): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  if (!headers.has("content-security-policy")) headers.set("content-security-policy", "frame-ancestors 'none'");
  if (!headers.has("x-frame-options")) headers.set("x-frame-options", "DENY");
  return new Response(body, { status, headers });
}

const MAX_ACCESS_TOKEN_LENGTH = 8192;

/**
 * Cookie name from @cloudflare/workers-oauth-provider: `__Host-oauth-` + `consent` + `-` + the
 * first 16 hex chars of the SHA-256 of the consent handle. The value is the full hash.
 */
const CONSENT_COOKIE_PREFIX = "__Host-oauth-consent-";

/**
 * Header check for the session handoff. Referrer-Policy is no-referrer, and the Fetch standard
 * then sends `Origin: null` on this POST, so a missing or null Origin is not a cross-site request.
 * A concrete Origin that belongs to another site is still rejected, as is Sec-Fetch-Site: cross-site.
 * The consent binding cookie is the CSRF check.
 */
export function sessionPostHeadersAllowed(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      if (origin !== new URL(request.url).origin) return false;
    } catch {
      return false;
    }
  }
  return site === null || site === "same-origin" || site === "same-site" || site === "none";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/** True when this browser holds the __Host- cookie beginConsent set for this handle. */
export async function consentHandleBoundToBrowser(request: Request, handle: string): Promise<boolean> {
  if (!handle) return false;
  const hash = await sha256Hex(handle);
  const cookie = readCookie(request, `${CONSENT_COOKIE_PREFIX}${hash.slice(0, 16)}`);
  if (!cookie) return false;
  return timingSafeEqual(cookie, hash);
}

export function postedAccessToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!token || token.length > MAX_ACCESS_TOKEN_LENGTH || /\s/.test(token)) return null;
  return token;
}

function rejectionKind(error: { status?: number; message?: string } | null): "invalid" | "error" {
  if (!error) return "invalid";
  const status = error.status ?? 0;
  if (status >= 500) return "error";
  const message = (error.message ?? "").toLowerCase();
  if (status === 0 && (message.includes("fetch") || message.includes("network") || message.includes("timeout"))) return "error";
  return "invalid";
}

const NOT_CONFIGURED = "Sign-in cannot be checked because this server is missing its Supabase service role secret.";

/** Maps a getUser failure to a page and a log line that never includes the token or a key value. */
export function sessionFailure(error: unknown): {
  title: string;
  message: string;
  rejection?: "invalid" | "error";
  log: Record<string, string | number | null>;
} {
  if (error instanceof ConfigError) {
    return {
      title: "Server is not configured",
      message: NOT_CONFIGURED,
      log: { message: "oauth session check failed", reason: "missing_binding", binding: error.binding },
    };
  }
  const record = error && typeof error === "object" ? (error as { status?: unknown; code?: unknown; message?: unknown; name?: unknown }) : {};
  const status = typeof record.status === "number" ? record.status : null;
  const code = typeof record.code === "string" ? record.code : null;
  const name = error instanceof Error ? error.name : typeof record.name === "string" ? record.name : "unknown";
  const message = typeof record.message === "string" ? record.message : "";
  const rejection = rejectionKind({ status: status ?? undefined, message });
  return {
    title: "Sign in required",
    message: rejection === "invalid" ? "That sign-in expired. Sign in again." : "Could not check your sign-in. Refresh the page to try again.",
    rejection,
    log: { message: "oauth session rejected", name, status, code },
  };
}

function sessionFailureResponse(error: unknown, fail: (message: string, rejection: "invalid" | "error") => Response | Promise<Response>): Response | Promise<Response> {
  const failure = sessionFailure(error);
  console.error(JSON.stringify(failure.log));
  if (!failure.rejection) return html(renderMessagePage(failure.title, failure.message), undefined, 500);
  return fail(failure.message, failure.rejection);
}

async function readSession(request: Request): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

async function membershipsFor(userId: string): Promise<Membership[]> {
  await ensurePersonalWorkspace(userId);
  const { data, error } = await db.from("workspace_members").select("role, workspaces(id, name)").eq("user_id", userId);
  if (error) throw new HubError(error.message, 500);
  const rows = (data ?? []) as { role: string; workspaces: { id: string; name: string } | { id: string; name: string }[] | null }[];
  return rows.flatMap((row) => {
    const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
    if (!workspace) return [];
    return [{ id: workspace.id, name: workspace.name, role: row.role }];
  });
}

function grantedScope(requested: string[]): string[] {
  const scope = ["mcp"];
  if (requested.includes("offline_access")) scope.push("offline_access");
  return scope;
}

export async function handleAuthorize(c: Context): Promise<Response> {
  const oauth = c.env.OAUTH_PROVIDER;
  if (!oauth) return html(renderMessagePage("OAuth is not configured", "This server has no OAuth provider binding."), undefined, 500);
  try {
    if (c.req.method === "GET") return await showConsent(c.req.raw, oauth);
    if (c.req.method === "POST") return await submitConsent(c.req.raw, oauth);
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return html(renderMessagePage("Authorization request declined", error.description), undefined, 400);
    if (error instanceof CimdFetchError) return html(renderMessagePage("This app could not be verified", "The client's metadata document could not be loaded."), undefined, 400);
    if (error instanceof HubError) return html(renderMessagePage("Could not connect the agent", error.message), undefined, error.status);
    if (error instanceof ConfigError) {
      console.error(JSON.stringify({ message: "oauth config missing", binding: error.binding }));
      return html(renderMessagePage("Server is not configured", NOT_CONFIGURED), undefined, 500);
    }
    throw error;
  }
}

async function showConsent(request: Request, oauth: OAuthHelpers): Promise<Response> {
  const oauthRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(oauthRequest);
  const consent = await oauth.beginConsent(oauthRequest);
  const user = await readSession(request);
  const view = await viewFor(user, details.clientName, consent.handle, {
    clientName: details.clientName,
    clientDomain: details.clientDomain,
    redirectHost: details.redirectHost,
    redirectIsLoopback: details.redirectIsLoopback,
    scope: grantedScope(details.scope),
  });
  return html(renderConsentPage(view), consent.headers);
}

async function viewFor(
  user: SessionUser | null,
  clientName: string,
  handle: string,
  base: Omit<ConsentView, "handle" | "mode" | "email" | "workspaces" | "agentName" | "sessionRejected">,
  error?: string,
  sessionRejected?: ConsentView["sessionRejected"],
): Promise<ConsentView> {
  if (!user) return { ...base, handle, mode: "login", error, sessionRejected };
  const workspaces = await membershipsFor(user.id);
  return {
    ...base,
    handle,
    mode: "approve",
    email: user.email,
    workspaces,
    agentName: prefillAgentName(clientName),
    error,
  };
}

async function consentContext(request: Request, oauth: OAuthHelpers) {
  const oauthRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(oauthRequest);
  const base = {
    clientName: details.clientName,
    clientDomain: details.clientDomain,
    redirectHost: details.redirectHost,
    redirectIsLoopback: details.redirectIsLoopback,
    scope: grantedScope(details.scope),
  };
  return { oauthRequest, details, base };
}

async function submitConsent(request: Request, oauth: OAuthHelpers): Promise<Response> {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const handle = String(form.get("handle") ?? "");
  if (!handle) return html(renderMessagePage("Approval expired", "Start the connection again from your client."), undefined, 400);

  if (action === "login") return passwordLogin(request, oauth, form, handle);
  if (action === "session") return acceptBrowserSession(request, oauth, form, handle);

  if (action === "deny") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  const user = await readSession(request);
  if (!user) return html(renderMessagePage("Sign in required", "The approval page expired. Start again from your client."), undefined, 401);

  const { oauthRequest, details, base } = await consentContext(request, oauth);
  const owned = await membershipsFor(user.id);
  const workspaceId = String(form.get("workspace_id") ?? "");
  const preset = String(form.get("preset") ?? "all");
  const agentName = String(form.get("agent_name") ?? "").trim() || prefillAgentName(details.clientName);
  if (!owned.some((workspace) => workspace.id === workspaceId)) {
    const view = await viewFor(user, details.clientName, handle, base, "Choose a workspace you belong to.");
    return html(renderConsentPage(view));
  }

  const approved = await oauth.approveConsent(request, handle, { scope: grantedScope(oauthRequest.scope) });
  let agentId: string | null = null;
  try {
    const client = await oauth.lookupClient(approved.request.clientId);
    const agent = await registerConnectedAgent({
      userId: user.id,
      workspaceId,
      name: agentName,
      preset,
      clientId: approved.request.clientId,
      clientName: client?.clientName || details.clientName,
    });
    agentId = agent.id;
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: user.id,
      metadata: { agentId: agent.id, workspaceId, agentName: agent.name },
      scope: approved.request.scope,
      props: { agentId: agent.id, workspaceId, userId: user.id },
      revokeExistingGrants: false,
    });
    const headers = new Headers(approved.headers);
    headers.set("location", redirectTo);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (agentId) await deleteAgent(agentId, workspaceId).catch(() => {});
    throw error;
  }
}

async function passwordLogin(request: Request, oauth: OAuthHelpers, form: FormData, handle: string): Promise<Response> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const { details, base } = await consentContext(request, oauth);
  // A fresh client: signInWithPassword stores a user session on the client it
  // is called on, and the shared service-role client must not pick that up.
  const authClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await authClient.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) {
    const view = await viewFor(null, details.clientName, handle, base, signedIn.error?.message ?? "Sign-in failed");
    return html(renderConsentPage(view));
  }
  const user = { id: signedIn.data.user.id, email: signedIn.data.user.email ?? null };
  const view = await viewFor(user, details.clientName, handle, base);
  const headers = new Headers();
  headers.append("set-cookie", sessionCookie(signedIn.data.session.access_token, request));
  return html(renderConsentPage(view), headers);
}

/**
 * The web app keeps the Supabase session in localStorage, which this
 * server-rendered page cannot see. The browser posts the access token and
 * Supabase verifies it before ah_session is set. Approve still checks
 * workspace membership. The consent handle must match the __Host- cookie from
 * this page. Origin may be the string "null" because the page sends no referrer.
 */
async function acceptBrowserSession(request: Request, oauth: OAuthHelpers, form: FormData, handle: string): Promise<Response> {
  const { details, base } = await consentContext(request, oauth);
  const fail = async (message: string, rejection: "invalid" | "error") => {
    const view = await viewFor(null, details.clientName, handle, base, message, rejection);
    return html(renderConsentPage(view));
  };
  if (!sessionPostHeadersAllowed(request)) {
    return html(
      renderMessagePage("Approval could not be confirmed", "This request did not come from the approval page. Start the connection again from your client."),
      undefined,
      403,
    );
  }
  if (!(await consentHandleBoundToBrowser(request, handle))) {
    return html(
      renderMessagePage("Approval expired", "This browser did not start the connection, or it expired. Start again from your client."),
      undefined,
      400,
    );
  }
  const token = postedAccessToken(form.get("access_token"));
  if (!token) return fail("That sign-in expired. Sign in again.", "invalid");
  try {
    const result = await db.auth.getUser(token);
    if (result.error || !result.data.user) return sessionFailureResponse(result.error ?? new Error("no user"), fail);
    const user = { id: result.data.user.id, email: result.data.user.email ?? null };
    const view = await viewFor(user, details.clientName, handle, base);
    const headers = new Headers();
    headers.append("set-cookie", sessionCookie(token, request));
    return html(renderConsentPage(view), headers);
  } catch (error) {
    return sessionFailureResponse(error, fail);
  }
}
