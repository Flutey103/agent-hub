/**
 * HTTP API and MCP endpoint. Same routes as the Express server.
 * Static files are served by Workers assets; this app only sees /api and /mcp
 * unless a request falls through to the ASSETS binding.
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { User } from "@supabase/supabase-js";
import { authenticateAgent, authenticateUser } from "./auth.js";
import { HubError } from "./db.js";
import { env } from "./env.js";
import { completeHumanTask, startLoop } from "./loops.js";
import { handleMcp } from "./mcp.js";
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

api.get("/health", (c) =>
  c.json({
    ok: true,
    tools: tools.map((t) => t.name),
    mcp: `${env.publicUrl}/mcp`,
    openapi: `${env.publicUrl}/api/openapi.json`,
  }),
);

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
    servers: [{ url: env.publicUrl }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    security: [{ bearerAuth: [] }],
    paths,
  });
});

api.get("/me", async (c) => {
  const agent = await authenticateAgent(c.req.raw);
  if (agent instanceof Response) return agent;
  return c.json({ id: agent.id, slug: agent.slug, name: agent.name, capabilities: agent.capabilities, mode: agent.mode });
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
    return c.json(await completeHumanTask(c.req.param("id"), summary, user.email ?? "user"));
  } catch (error) {
    return toolError(c, error);
  }
});

api.post("/human/loops/:id/run", async (c) => {
  const user = await authenticateUser(c.req.raw);
  if (user instanceof Response) return user;
  try {
    return c.json(await startLoop(c.req.param("id")));
  } catch (error) {
    return toolError(c, error);
  }
});

api.all("*", (c) => c.json({ error: "Not found" }, 404));

app.route("/api", api);

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
