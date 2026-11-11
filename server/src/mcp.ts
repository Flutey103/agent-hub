import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { runTool, tools } from "./tools.js";
import type { Agent } from "./types.js";

const MAX_BODY = 5 * 1024 * 1024;

function buildServer(agent: Agent): McpServer {
  const server = new McpServer({ name: "agent-hub", version: "0.1.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.name.replace(/_/g, " "), description: tool.description, inputSchema: tool.shape },
      async (args: Record<string, unknown>) => {
        try {
          const out = await runTool(agent, tool.name, args);
          return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] };
        }
      },
    );
  }
  return server;
}

/**
 * Stateless Streamable HTTP endpoint: one server and transport per request.
 * WebStandardStreamableHTTPServerTransport speaks Request/Response, which is
 * what the Workers runtime (and the Node wrapper inside the MCP SDK) uses.
 */
export async function handleMcp(request: Request, agent: Agent): Promise<Response> {
  const server = buildServer(agent);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    maxRequestBodySize: MAX_BODY,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error(JSON.stringify({ message: "mcp error", error: error instanceof Error ? error.message : String(error) }));
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
    return Response.json({ error: "MCP error" }, { status: 500 });
  }
}
