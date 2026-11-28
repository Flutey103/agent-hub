/**
 * HTTP API and MCP endpoint. Same routes as the Express server.
 * Static files are served by Workers assets; this app only sees /api and /mcp
 * unless a request falls through to the ASSETS binding.
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { User } from "@supabase/supabase-js";
import { createAgentWithKey, publicAgent, revokeAgentKey } from "./agents-admin.js";
import { backfillAgentAvatars, serveAgentAvatar, updateAgentAvatar } from "./avatar.js";
import { authenticateAgent, authenticateUser, bearerFrom } from "./auth.js";
import { db, HubError } from "./db.js";
import { ConfigError } from "./env.js";
import { completeHumanTask, startLoop } from "./loops.js";
import { handleMcp } from "./mcp.js";
import { handleAuthorize } from "./oauth.js";
import { clearSessionCookie, sessionCookie } from "./session-cookie.js";
import { jsonSchemaFor, runTool, toolByName, tools } from "./tools.js";
import type { Agent } from "./types.js";

const MAX_BODY = 5 * 1024 * 1024;

type AppEnv = {
  Bindings: Env;
  Variables: {
    agent: Agent;
    user: User;
  };
};

export const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: (origin) => origin,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "mcp-session-id", "mcp-protocol-version", "Last-Event-ID", "Accept"],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
    maxAge: 86400,
  }),
);

app.onError((error, c) => {
  console.error(JSON.stringify({ message: "request failed", method: c.req.method, path: c.req.path, error: error.message }));
  const status = error instanceof HubError ? error.status : 500;
  return c.json({ error: status === 500 && !(error instanceof HubError) ? "Internal error" : error.message }, status as 400);
});

const api = new Hono<AppEnv>();

api.use("*", async (c, next) => {
  const length = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY) return c.json({ error: "Payload too large" }, 413);
  await next();
});

api.get("/health", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    ok: true,
    tools: tools.map((t) => t.name),
    mcp: `${origin}/mcp`,
    oauth: `${origin}/.well-known/oauth-authorization-server`,
    openapi: `${origin}/api/openapi.json`,
  });
});

api.get("/openapi.json", (c) => {
  const paths: Record<string, unknown> = {};
  for (const t of tools) {
    paths[`/api/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.description,
        requestBody: { required: true, content: { "application/json": { schema: jsonSchemaFor(t) } } },
        responses: { "200": { description: "Tool result", content: { "application/json": { schema: { type: "object" } } } } },
      },
    };
  }
  return c.json({
    openapi: "3.1.0",
    info: {
      title: "Agent Hub",
      version: "0.1.0",
      description: "Shared task queue for AI agents. Authenticate with your agent API key as a Bearer token.",
    },
    servers: [{ url: new URL(c.req.url).origin }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    security: [{ bearerAuth: [] }],
    paths,
  });
});

api.get("/me", async (c) => {
  const agent = await authenticateAgent(c.req.raw);
  if (agent instanceof Response) return agent;
  return c.json({
    id: agent.id,
    slug: agent.slug,
    name: agent.name,
    capabilities: agent.capabilities,
    mode: agent.mode,
    workspace_id: agent.workspace_id,
  });
});

api.post("/tools/:name", async (c) => {
  const agent = await authenticateAgent(c.req.raw);
  if (agent instanceof Response) return agent;
  const tool = toolByName.get(c.req.param("name"));
  if (!tool) return c.json({ error: `Unknown tool ${c.req.param("name")}` }, 404);
  const body = await readJson(c);
  if (body instanceof Response) return body;
  try {
    return c.json(await runTool(agent, tool.name, body));
  } catch (error) {
    return toolError(c, error);
  }
});

api.post("/human/tasks/:id/complete", async (c) => {
  const user = await authenticateUser(c.req.raw);
  if (user instanceof Response) return user;
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const summary = typeof body.summary === "string" && body.summary.trim() ? body.summary : "Completed in the hub UI";
  try {
    return c.json(await completeHumanTask(c.req.param("id"), summary, { id: user.id, email: user.email }));
  } catch (error) {
    return toolError(c, error);
  }
});

api.post("/human/loops/:id/run", async (c) => {
  const user = await authenticateUser(c.req.raw);
  if (user instanceof Response) return user;
  try {
    return c.json(await startLoop(c.req.param("id"), { userId: user.id }));
  } catch (error) {
    return toolError(c, error);
  }
});

api.post("/workspaces/:workspaceId/api-keys", async (c) => {
  const user = await authenticateUser(c.req.raw);
  if (user instanceof Response) return user;
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter((item): item is string => typeof item === "string") : [];
  try {
    const created = await createAgentWithKey({
      userId: user.id,
      workspaceId: c.req.param("workspaceId"),
      name: typeof body.name === "string" ? body.name : "",
      provider: typeof body.provider === "string" ? body.provider : undefined,
      mode: typeof body.mode === "string" ? body.mode : undefined,
      preset: typeof body.preset === "string" ? body.preset : undefined,
      capabilities,
      model: typeof body.model === "string" ? body.model : null,
      systemPrompt: typeof body.system_prompt === "string" ? body.system_prompt : null,
    });
    return c.json({ agent: publicAgent(created.agent), api_key: created.apiKey });
  } catch (error) {
    return toolError(c, error);
  }
});

api.get("/agents/:id/avatar", (c) => serveAgentAvatar(c.req.raw, c.req.param("id")));

api.post("/workspaces/:workspaceId/agents/:agentId/avatar", async (c) => {
  const user = await authenticateUser(c.req.raw);
  if (user instanceof Response) return user;
  const body = await readJson(c);
  if (body instanceof Response) return body;
  try {
    const agent = await updateAgentAvatar({
      userId: user.id,
      workspaceId: c.req.param("workspaceId"),
      agentId: c.req.param("agentId"),
      websiteUrl: body.website_url === undefined ? undefined : typeof body.website_url === "string" ? body.website_url : null,
      imageUrl: body.image_url === undefined ? undefined : typeof body.image_url === "string" ? body.image_url : null,
      refresh: body.refresh === true,
    });
    return c.json({ agent: publicAgent(agent), avatar_url: agent.avatar_url });
  } catch (error) {
    return toolError(c, error);
  }
});

api.post("/workspaces/:workspaceId/avatars/backfill", async (c) => {
  const user = await authenticateUser(c.req.raw);
  if (user instanceof Response) return user;
  const oauth = c.env.OAUTH_PROVIDER;
  try {
    const result = await backfillAgentAvatars({
      userId: user.id,
      workspaceId: c.req.param("workspaceId"),
      lookupClient: oauth ? (clientId) => oauth.lookupClient(clientId) : undefined,
    });
    return c.json(result);
  } catch (error) {
    return toolError(c, error);
  }
});

api.delete("/workspaces/:workspaceId/api-keys/:agentId", async (c) => {
  const user = await authenticateUser(c.req.raw);
  if (user instanceof Response) return user;
  try {
    await revokeAgentKey(user.id, c.req.param("workspaceId"), c.req.param("agentId"));
    return c.json({ ok: true });
  } catch (error) {
    return toolError(c, error);
  }
});

api.post("/session", async (c) => {
  const token = bearerFrom(c.req.raw);
  if (!token || token.length > 8192 || /\s/.test(token)) return c.json({ error: "Missing session token" }, 401);
  const origin = c.req.header("origin");
  const expected = new URL(c.req.url).origin;
  if (origin && origin !== "null" && origin !== expected) return c.json({ error: "Forbidden" }, 403);
  if (c.req.header("sec-fetch-site") === "cross-site") return c.json({ error: "Forbidden" }, 403);
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return c.json({ error: "Invalid session" }, 401);
  } catch (error) {
    if (error instanceof ConfigError) return c.json({ error: "Server is not configured" }, 500);
    console.error(JSON.stringify({ message: "session cookie rejected", name: error instanceof Error ? error.name : "unknown" }));
    return c.json({ error: "Could not check sign-in" }, 502);
  }
  c.header("set-cookie", sessionCookie(token, c.req.raw));
  return c.body(null, 204);
});

api.delete("/session", (c) => {
  c.header("set-cookie", clearSessionCookie(c.req.raw));
  return c.body(null, 204);
});

api.all("*", (c) => c.json({ error: "Not found" }, 404));

app.route("/api", api);

app.on(["GET", "POST"], "/authorize", (c) => handleAuthorize(c));

app.all("/mcp", async (c) => {
  const length = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY) return c.json({ error: "Payload too large" }, 413);
  const agent = await authenticateAgent(c.req.raw);
  if (agent instanceof Response) return agent;
  return handleMcp(c.req.raw, agent);
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown> | Response> {
  const text = await c.req.text();
  if (text.length > MAX_BODY) return c.json({ error: "Payload too large" }, 413);
  if (!text) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    return {};
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
}

function toolError(c: Context<AppEnv>, error: unknown): Response {
  const status = error instanceof HubError ? error.status : 400;
  const message = error instanceof Error ? error.message : "Request failed";
  return c.json({ error: message }, status as 400);
}
