/**
 * OAuth approval for MCP connectors. The provider validates the request,
 * PKCE, and the client. This page signs the user in with Supabase, lets them
 * pick a workspace and an agent name, then stores the new agent id in the
 * token props.
 */
import { AuthorizationError, CimdFetchError, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createClient } from "@supabase/supabase-js";
import type { Context } from "hono";
import { deleteAgent, registerConnectedAgent } from "./agents-admin.js";
import { prefillAgentName } from "./capabilities.js";
import { db, HubError } from "./db.js";
import { env } from "./env.js";
import { renderConsentPage, renderMessagePage, type ConsentView } from "./oauth-page.js";
import { ensurePersonalWorkspace } from "./tenant.js";

const SESSION_COOKIE = "ah_session";

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

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600${secure ? "; Secure" : ""}`;
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
  base: Omit<ConsentView, "handle" | "mode" | "email" | "workspaces" | "agentName">,
  error?: string,
): Promise<ConsentView> {
  if (!user) return { ...base, handle, mode: "login", error };
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

async function submitConsent(request: Request, oauth: OAuthHelpers): Promise<Response> {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const handle = String(form.get("handle") ?? "");
  if (!handle) return html(renderMessagePage("Approval expired", "Start the connection again from your client."), undefined, 400);

  if (action === "login") {
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const oauthRequest = await oauth.parseAuthRequest(request);
    const details = await oauth.describeConsent(oauthRequest);
    const base = {
      clientName: details.clientName,
      clientDomain: details.clientDomain,
      redirectHost: details.redirectHost,
      redirectIsLoopback: details.redirectIsLoopback,
      scope: grantedScope(details.scope),
    };
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

  if (action === "deny") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  const user = await readSession(request);
  if (!user) return html(renderMessagePage("Sign in required", "The approval page expired. Start again from your client."), undefined, 401);

  const oauthRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(oauthRequest);
  const base = {
    clientName: details.clientName,
    clientDomain: details.clientDomain,
    redirectHost: details.redirectHost,
    redirectIsLoopback: details.redirectIsLoopback,
    scope: grantedScope(details.scope),
  };
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
