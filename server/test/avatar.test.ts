import assert from "node:assert/strict";
import { after, test } from "node:test";
import { attachAvatarBestEffort, avatarCacheKey, backfillAgentAvatars, homepageFromHints, iconCandidatesFromHtml, isPublicHttpsUrl, loadAvatarForUser, resolveAvatarImage, sourcesFromHints, updateAgentAvatar, type AvatarStore, type PublicFetch } from "../src/avatar.js";
import { HubError, setDbForTests } from "../src/db.js";
import { MemoryDb } from "./memory-db.js";

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";

class MapStore implements AvatarStore {
  readonly values = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.values.set(key, { bytes, contentType });
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
}

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function png(bytes: Uint8Array = PNG, type = "image/png"): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": type } });
}

test("public https urls reject private and non-https hosts", () => {
  const blocked = [
    "http://example.com/favicon.ico",
    "https://user:pass@example.com/a.png",
    "https://127.0.0.1/logo.png",
    "https://127.0.0.1:443/logo.png",
    "https://10.1.2.3/a",
    "https://192.168.1.9/a",
    "https://172.16.4.1/a",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/a",
    "https://[fd00::1]/a",
    "https://localhost/a",
    "https://app.internal/a",
    "https://metadata.google.internal/",
    "https://2130706433/",
    "https://0177.0.0.1/",
    "https://example.com:8443/a",
    "not a url",
  ];
  for (const value of blocked) assert.equal(isPublicHttpsUrl(value), false, value);
  assert.equal(isPublicHttpsUrl("https://example.com/favicon.ico"), true);
  assert.equal(isPublicHttpsUrl("https://cdn.example.com/icons/logo.png"), true);
  assert.equal(isPublicHttpsUrl("https://8.8.8.8/a"), true);
});

test("icon parser prefers the largest link and ignores comments", () => {
  const htmlBody = `
    <!-- <link rel="icon" href="https://evil.example/secret.png" sizes="512x512"> -->
    <link rel="stylesheet" href="/app.css">
    <link rel="icon" href="/small.png" sizes="16x16">
    <link rel="apple-touch-icon" href="/apple.png" sizes="180x180">
    <link rel="icon" href="https://cdn.example.com/any.png" sizes="any">
    <link rel="shortcut icon" href="http://insecure.example/nope.ico">
  `;
  const urls = iconCandidatesFromHtml(htmlBody, "https://example.com/docs/index.html");
  assert.deepEqual(urls, [
    "https://cdn.example.com/any.png",
    "https://example.com/apple.png",
    "https://example.com/small.png",
  ]);
  assert.equal(homepageFromHints({ clientId: "https://chatgpt.com/oauth/client.json" }), "https://chatgpt.com");
  assert.equal(homepageFromHints({ redirectUris: ["http://127.0.0.1/callback", "https://claude.ai/cb"] }), "https://claude.ai");
  assert.deepEqual(sourcesFromHints({ logoUri: "https://127.0.0.1/logo.png", clientUri: "https://claude.ai/docs" }), {
    client_uri: "https://claude.ai/docs",
    logo_uri: null,
    website_url: "https://claude.ai",
  });
});

test("logo_uri is used before the homepage, and a private redirect is not fetched", async () => {
  const seen: string[] = [];
  const logoFetch: PublicFetch = async (url) => {
    seen.push(url);
    if (url.includes("127.0.0.1") || url.includes("evil.example")) throw new Error(url);
    if (url === "https://cdn.example.com/logo.png") return png();
    return new Response("no", { status: 404 });
  };
  const fromLogo = await resolveAvatarImage({ logoUri: "https://cdn.example.com/logo.png", clientUri: "https://example.com" }, logoFetch);
  assert.equal(fromLogo?.contentType, "image/png");
  assert.deepEqual(seen, ["https://cdn.example.com/logo.png"]);

  seen.length = 0;
  const page = `
    <!-- <link rel="icon" href="https://evil.example/x.png" sizes="512x512"> -->
    <link rel="icon" href="/small.png" sizes="16x16">
    <link rel="apple-touch-icon" href="/big.png" sizes="180x180">
  `;
  const discovered = await resolveAvatarImage(
    { clientUri: "https://example.com/app" },
    async (url) => {
      seen.push(url);
      if (url.includes("evil.example")) throw new Error(url);
      if (url === "https://example.com/") return html(page);
      if (url === "https://example.com/big.png") return png();
      return new Response("no", { status: 404 });
    },
  );
  assert.equal(discovered?.sourceUrl, "https://example.com/big.png");
  assert.deepEqual(seen, ["https://example.com/", "https://example.com/big.png"]);

  seen.length = 0;
  const blocked = await resolveAvatarImage(
    { logoUri: "https://cdn.example.com/redirect.png" },
    async (url) => {
      seen.push(url);
      if (!url.startsWith("https://cdn.example.com/")) throw new Error(url);
      return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret.png" } });
    },
  );
  assert.equal(blocked, null);
  assert.deepEqual(seen, ["https://cdn.example.com/redirect.png"]);
});

test("oversized and non-image responses fall through to favicon.ico", async () => {
  const seen: string[] = [];
  const image = await resolveAvatarImage({ websiteUrl: "https://example.com" }, async (url) => {
    seen.push(url);
    if (url === "https://example.com/") {
      return html(`<link rel="icon" href="/huge.png" sizes="256x256"><link rel="icon" href="/mark.svg" sizes="128x128">`);
    }
    if (url === "https://example.com/huge.png") {
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png", "content-length": "999999" } });
    }
    if (url === "https://example.com/mark.svg") return new Response("<svg xmlns='http://www.w3.org/2000/svg'/>", { status: 200, headers: { "content-type": "image/svg+xml" } });
    if (url === "https://example.com/favicon.ico") return png(Uint8Array.from([0, 0, 1, 0, 1, 0, 0, 0]), "image/x-icon");
    return new Response("no", { status: 404 });
  });
  assert.equal(image?.contentType, "image/x-icon");
  assert.ok(seen.includes("https://example.com/favicon.ico"));
  assert.equal(seen.some((url) => url.includes("127.0.0.1")), false);
});

test("a failed fetch does not throw, and a resolved icon is cached for members only", async () => {
  const memory = new MemoryDb();
  setDbForTests(memory.client() as never);
  memory.rows("workspace_members").push(
    { workspace_id: WS, user_id: USER, role: "owner" },
    { workspace_id: WS, user_id: OTHER, role: "member" },
  );
  memory.rows("agents").push({
    id: AGENT,
    workspace_id: WS,
    slug: "keyed",
    name: "Keyed",
    provider: "other",
    model: null,
    mode: "connected",
    capabilities: [],
    system_prompt: null,
    is_active: true,
    created_by: USER,
    oauth_client_id: null,
    avatar_url: null,
    client_uri: null,
    logo_uri: null,
    website_url: null,
  });
  const store = new MapStore();
  await attachAvatarBestEffort(AGENT, WS, { logoUri: "https://cdn.example.com/logo.png" }, {
    store,
    fetch: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(memory.rows("agents")[0].avatar_url, null);
  assert.equal(store.values.size, 0);

  const updated = await updateAgentAvatar({
    userId: USER,
    workspaceId: WS,
    agentId: AGENT,
    websiteUrl: "https://example.com/docs",
    imageUrl: "https://cdn.example.com/logo.png",
    store,
    fetch: async (url) => {
      if (url === "https://cdn.example.com/logo.png") return png();
      throw new Error(url);
    },
  });
  assert.equal(updated.website_url, "https://example.com");
  assert.equal(updated.logo_uri, "https://cdn.example.com/logo.png");
  assert.equal(updated.avatar_url, `/api/agents/${AGENT}/avatar`);
  const cached = store.values.get(avatarCacheKey(AGENT));
  assert.equal(cached?.contentType, "image/png");
  assert.equal(cached?.bytes[0], 0x89);

  const visible = await loadAvatarForUser(USER, AGENT, store);
  assert.equal(visible?.contentType, "image/png");
  assert.equal(await loadAvatarForUser(OTHER, "99999999-9999-4999-8999-999999999999", store), null);
  memory.rows("agents")[0].workspace_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.equal(await loadAvatarForUser(USER, AGENT, store), null);
  memory.rows("agents")[0].workspace_id = WS;

  await assert.rejects(
    () => updateAgentAvatar({ userId: USER, workspaceId: WS, agentId: AGENT, websiteUrl: "https://127.0.0.1/admin", store, fetch: async () => png() }),
    (error: unknown) => error instanceof HubError && /public https/.test(error.message),
  );
  await assert.rejects(
    () => updateAgentAvatar({ userId: OTHER, workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", agentId: AGENT, refresh: true, store }),
    (error: unknown) => error instanceof HubError && error.status === 404,
  );
});

test("backfill is owner or admin and skips agents that already have an icon", async () => {
  const memory = new MemoryDb();
  setDbForTests(memory.client() as never);
  memory.rows("workspace_members").push({ workspace_id: WS, user_id: USER, role: "member" }, { workspace_id: WS, user_id: OTHER, role: "admin" });
  memory.rows("agents").push(
    {
      id: AGENT,
      workspace_id: WS,
      oauth_client_id: "https://chatgpt.com/oauth/client.json",
      client_uri: null,
      logo_uri: null,
      website_url: null,
      avatar_url: null,
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      workspace_id: WS,
      oauth_client_id: null,
      client_uri: null,
      logo_uri: null,
      website_url: null,
      avatar_url: "/api/agents/44444444-4444-4444-8444-444444444444/avatar",
    },
  );
  const store = new MapStore();
  await assert.rejects(
    () => backfillAgentAvatars({ userId: USER, workspaceId: WS, store, fetch: async () => png() }),
    (error: unknown) => error instanceof HubError && error.status === 403,
  );
  const result = await backfillAgentAvatars({
    userId: OTHER,
    workspaceId: WS,
    store,
    lookupClient: async () => ({ logoUri: "https://cdn.example.com/gpt.png", clientUri: "https://chatgpt.com" }),
    fetch: async (url) => (url === "https://cdn.example.com/gpt.png" ? png() : new Response("no", { status: 404 })),
  });
  assert.deepEqual(result, { updated: 1, skipped: 1, failed: 0, remaining: 0 });
  const filled = memory.rows("agents").find((row) => row.id === AGENT);
  assert.equal(filled?.avatar_url, `/api/agents/${AGENT}/avatar`);
  assert.equal(filled?.logo_uri, "https://cdn.example.com/gpt.png");
  assert.equal(filled?.website_url, "https://chatgpt.com");
  assert.ok(store.values.has(avatarCacheKey(AGENT)));
});

after(() => setDbForTests(null));
