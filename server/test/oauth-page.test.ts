import assert from "node:assert/strict";
import { test } from "node:test";
import { isMcpPath, isStaticAgentKey } from "../src/auth.js";
import { prefillAgentName, providerFromClientName, resolveCapabilities } from "../src/capabilities.js";
import { renderConsentPage } from "../src/oauth-page.js";
import { createOAuthProvider } from "../src/worker.js";

test("capability presets and client names", () => {
  assert.deepEqual(resolveCapabilities(undefined), resolveCapabilities("all"));
  assert.ok(resolveCapabilities("editing", ["Custom-Tag"]).includes("custom-tag"));
  assert.equal(resolveCapabilities("research", ["bad tag", ""]).includes("bad tag"), false);
  assert.equal(providerFromClientName("Claude Desktop"), "anthropic");
  assert.equal(providerFromClientName("ChatGPT"), "openai");
  assert.equal(providerFromClientName("Grok"), "xai");
  assert.equal(prefillAgentName("https://claude.ai/oauth/client.json"), "claude.ai");
});

test("approval page escapes the client name and defaults to every capability", () => {
  const html = renderConsentPage({
    mode: "approve",
    handle: "handle-1",
    clientName: `<img src=x onerror=alert(1)>`,
    redirectHost: "claude.ai",
    redirectIsLoopback: true,
    scope: ["mcp"],
    email: "ada@example.com",
    workspaces: [{ id: "ws-1", name: "Ada's workspace", role: "owner" }],
    agentName: `<img src=x onerror=alert(1)>`,
  });
  assert.equal(html.includes("<img"), false);
  assert.match(html, /&#60;img/);
  assert.match(html, /This sends access to an app on your computer/);
  assert.match(html, /value="all" selected/);
  assert.match(html, /claude\.ai/);
});

test("oauth provider accepts the production and loopback resource URLs", () => {
  assert.ok(createOAuthProvider("https://agent-hub.flutey103.workers.dev"));
  assert.ok(createOAuthProvider("http://127.0.0.1:43123"));
});

test("static ah_ keys are recognized only on the MCP path", () => {
  const bearer = new Request("https://example.com/mcp", { headers: { authorization: "Bearer ah_test" } });
  const oauth = new Request("https://example.com/mcp", { headers: { authorization: "Bearer user:grant:secret" } });
  const header = new Request("https://example.com/mcp", { headers: { "x-api-key": "ah_test" } });
  assert.equal(isStaticAgentKey(bearer), true);
  assert.equal(isStaticAgentKey(oauth), false);
  assert.equal(isStaticAgentKey(header), true);
  assert.equal(isMcpPath("/mcp"), true);
  assert.equal(isMcpPath("/mcp/tools"), true);
  assert.equal(isMcpPath("/api/tools/list_my_tasks"), false);
});
