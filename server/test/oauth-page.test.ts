import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AUTH_CALLBACK_FLAG, authorizeResumeTarget, isSafeAuthorizePath, parseOAuthReturn, serializeOAuthReturn } from "../../shared/oauth-return.js";
import { isMcpPath, isStaticAgentKey } from "../src/auth.js";
import { prefillAgentName, providerFromClientName, resolveCapabilities } from "../src/capabilities.js";
import { sessionCookie, clearSessionCookie, SESSION_COOKIE } from "../src/session-cookie.js";
import { ConfigError } from "../src/env.js";
import { consentHandleBoundToBrowser, postedAccessToken, sessionFailure, sessionPostHeadersAllowed } from "../src/oauth.js";
import { OAUTH_SESSION_SCRIPT, renderConsentPage } from "../src/oauth-page.js";
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
  assert.match(html, /name="action" value="approve"/);
  assert.match(html, /name="action" value="deny"/);
  assert.match(html, /claude\.ai/);
  assert.equal(html.includes("oauth-session.js"), false);
  assert.equal(html.includes("access_token"), false);
  assert.equal(html.includes('type="password"'), false);
});

test("login page checks for an existing session and offers an email link", () => {
  const html = renderConsentPage({
    mode: "login",
    handle: `handle"1`,
    clientName: `</script><script>alert(1)</script>`,
    redirectHost: "claude.ai",
    redirectIsLoopback: false,
    scope: ["mcp"],
  });
  assert.equal(html.includes("</script><script>alert"), false);
  assert.match(html, /Checking your sign-in/);
  assert.match(html, /id="login-panel" hidden/);
  assert.match(html, /Email me a sign-in link/);
  assert.match(html, /type="password"/);
  assert.match(html, /name="action" value="login"/);
  assert.equal(html.includes("access_token"), false);
  assert.match(html, new RegExp(`src="${OAUTH_SESSION_SCRIPT.replaceAll(".", "\\.")}"`));
  assert.match(html, /name="handle" value="handle&#34;1"/);
  assert.equal(html.includes("value=\"all\" selected"), false);
});

test("a rejected browser session shows the login form instead of posting again", () => {
  const html = renderConsentPage({
    mode: "login",
    handle: "handle-1",
    clientName: "Claude",
    redirectHost: "claude.ai",
    redirectIsLoopback: false,
    scope: ["mcp"],
    error: "That sign-in expired. Sign in again.",
    sessionRejected: "invalid",
  });
  assert.match(html, /data-session-rejected="invalid"/);
  assert.match(html, /id="checking"[^>]*hidden/);
  assert.equal(/id="login-panel" hidden/.test(html), false);
  assert.match(html, /That sign-in expired/);
});

test("session handoff allows the no-referrer Origin null post and rejects a cross-site post", () => {
  const url = "https://agent-hub.example/authorize?client_id=https%3A%2F%2Fchatgpt.com%2Foauth%2Fclient.json";
  const ok = new Request(url, {
    method: "POST",
    headers: { origin: "https://agent-hub.example", "sec-fetch-site": "same-origin" },
  });
  const noReferrer = new Request(url, {
    method: "POST",
    headers: { origin: "null", "sec-fetch-site": "same-origin" },
  });
  const noFetchMetadata = new Request(url, {
    method: "POST",
    headers: { origin: "https://agent-hub.example" },
  });
  const cross = new Request(url, {
    method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  });
  const mismatchedSite = new Request(url, {
    method: "POST",
    headers: { origin: "https://agent-hub.example", "sec-fetch-site": "cross-site" },
  });
  const wrongOrigin = new Request(url, {
    method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "same-origin" },
  });
  assert.equal(sessionPostHeadersAllowed(ok), true);
  assert.equal(sessionPostHeadersAllowed(noReferrer), true);
  assert.equal(sessionPostHeadersAllowed(noFetchMetadata), true);
  assert.equal(sessionPostHeadersAllowed(cross), false);
  assert.equal(sessionPostHeadersAllowed(mismatchedSite), false);
  assert.equal(sessionPostHeadersAllowed(wrongOrigin), false);
  assert.equal(sessionPostHeadersAllowed(new Request(url)), true);
  assert.equal(postedAccessToken("  header.payload.sig  "), "header.payload.sig");
  assert.equal(postedAccessToken(""), null);
  assert.equal(postedAccessToken("two tokens"), null);
  assert.equal(postedAccessToken("x".repeat(8193)), null);
  assert.equal(postedAccessToken(new File(["tok"], "tok.txt")), null);
});

test("the app session cookie is first-party and readable on a later visit", () => {
  const request = new Request("https://agent-hub.example/authorize?client_id=abc");
  const set = sessionCookie("header.payload.sig", request);
  assert.match(set, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Secure/);
  assert.equal(set.includes("header.payload.sig"), true);
  const cleared = clearSessionCookie(request);
  assert.match(cleared, /Max-Age=0/);
  const local = sessionCookie("tok", new Request("http://127.0.0.1/authorize?x=1"));
  assert.equal(local.includes("Secure"), false);
});

test("a missing service role binding is reported without blaming the session", () => {
  const missing = sessionFailure(new ConfigError("SUPABASE_SERVICE_ROLE_KEY"));
  assert.equal(missing.rejection, undefined);
  assert.match(missing.message, /Supabase service role secret/);
  assert.equal(missing.log.binding, "SUPABASE_SERVICE_ROLE_KEY");
  assert.equal(JSON.stringify(missing.log).includes("eyJ"), false);
  const invalid = sessionFailure({ name: "AuthApiError", status: 401, code: "bad_jwt", message: "invalid JWT" });
  assert.equal(invalid.rejection, "invalid");
  assert.match(invalid.message, /expired/);
  assert.equal(invalid.log.status, 401);
  assert.equal(invalid.log.code, "bad_jwt");
  const offline = sessionFailure({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" });
  assert.equal(offline.rejection, "error");
  assert.match(offline.message, /Could not check your sign-in/);
});

test("consent cookie binds the handle to this browser", async () => {
  const handle = "consent-handle";
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(handle)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const cookie = `__Host-oauth-consent-${hash.slice(0, 16)}=${hash}`;
  const bound = new Request("https://agent-hub.example/authorize?client_id=abc", { headers: { cookie } });
  const missing = new Request("https://agent-hub.example/authorize?client_id=abc");
  const swapped = new Request("https://agent-hub.example/authorize?client_id=abc", {
    headers: { cookie: `__Host-oauth-consent-${hash.slice(0, 16)}=${"0".repeat(64)}` },
  });
  assert.equal(await consentHandleBoundToBrowser(bound, handle), true);
  assert.equal(await consentHandleBoundToBrowser(missing, handle), false);
  assert.equal(await consentHandleBoundToBrowser(swapped, handle), false);
});

test("magic-link return stays on the same authorize request", () => {
  const now = 1_700_000_000_000;
  const path = "/authorize?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A9%2Fcb&state=s&code_challenge=c";
  assert.equal(isSafeAuthorizePath(path), true);
  assert.equal(isSafeAuthorizePath("/authorize"), false);
  assert.equal(isSafeAuthorizePath("//evil.example/authorize?x=1"), false);
  assert.equal(isSafeAuthorizePath("https://evil.example/authorize?x=1"), false);
  assert.equal(isSafeAuthorizePath("/authorize?x=1\n"), false);
  assert.equal(isSafeAuthorizePath("/\\authorize?x=1"), false);
  const stored = serializeOAuthReturn(path, now);
  assert.equal(parseOAuthReturn(stored, now + 1000), path);
  assert.equal(parseOAuthReturn(stored, now + 60 * 60 * 1000 + 1), null);
  assert.equal(parseOAuthReturn(JSON.stringify({ path: "https://evil.example", exp: now + 1000 }), now), null);
  assert.equal(
    authorizeResumeTarget({ search: "?code=abc", hash: "", callbackFlag: false, stored, now: now + 1000 }),
    path,
  );
  assert.equal(
    authorizeResumeTarget({ search: "", hash: "", callbackFlag: true, stored, now: now + 1000 }),
    path,
  );
  assert.equal(authorizeResumeTarget({ search: "?code=abc&type=recovery", hash: "", callbackFlag: false, stored, now }), null);
  assert.equal(authorizeResumeTarget({ search: "", hash: "#access_token=x&type=magiclink", callbackFlag: false, stored, now }), path);
  assert.equal(authorizeResumeTarget({ search: "", hash: "", callbackFlag: false, stored, now }), null);
  const index = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
  assert.match(index, new RegExp(`sessionStorage.setItem\\("${AUTH_CALLBACK_FLAG}"`));
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
