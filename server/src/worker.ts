import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { app } from "./app.js";
import { isMcpPath, isStaticAgentKey, loadAgentForGrant, type GrantProps } from "./auth.js";
import { runWithContext } from "./context.js";
import { handleMcp } from "./mcp.js";
import { tick } from "./scheduler.js";

const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const props = (ctx as ExecutionContext & { props?: GrantProps }).props;
    const authUser = (ctx as ExecutionContext & { auth?: { userId?: string } }).auth?.userId;
    if (!props?.agentId || !props.workspaceId || (authUser && authUser !== props.userId)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return runWithContext(env, ctx, async () => {
      const agent = await loadAgentForGrant(props);
      if (!agent) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleMcp(request, agent);
    });
  },
};

const providers = new Map<string, OAuthProvider>();

/** One provider per origin so the token audience matches the URL the client pasted. */
export function createOAuthProvider(base: string): OAuthProvider {
  const existing = providers.get(base);
  if (existing) return existing;
  const provider = new OAuthProvider({
    apiRoute: "/mcp",
    apiHandler: mcpApiHandler,
    defaultHandler: { fetch: (request, env, ctx) => app.fetch(request, env, ctx) },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: ["mcp", "offline_access"],
    requiredScopes: ["mcp"],
    resourceMetadata: {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      resource_name: "Agent Hub",
    },
    clientIdMetadataDocumentEnabled: true,
    allowPrivateUseRedirectUris: true,
    onError(error) {
      console.error(
        JSON.stringify({
          message: "oauth error",
          code: error.code,
          description: error.description,
          status: error.status,
        }),
      );
    },
  });
  providers.set(base, provider);
  return provider;
}

function providerFor(request: Request): OAuthProvider {
  return createOAuthProvider(new URL(request.url).origin);
}

export default {
  async fetch(request, env, ctx) {
    return runWithContext(env, ctx, async () => {
      const url = new URL(request.url);
      if (isMcpPath(url.pathname) && isStaticAgentKey(request)) return app.fetch(request, env, ctx);
      try {
        return await providerFor(request).fetch(request, env, ctx);
      } catch (error) {
        if (error instanceof TypeError) {
          console.error(JSON.stringify({ message: "oauth provider init failed", error: error.message }));
          return Response.json({ error: "OAuth provider misconfigured for this host" }, { status: 500 });
        }
        throw error;
      }
    });
  },
  async scheduled(controller, env, ctx) {
    console.log(
      JSON.stringify({
        message: "scheduler tick started",
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
      }),
    );
    await runWithContext(env, ctx, () => tick());
  },
} satisfies ExportedHandler<Env>;
