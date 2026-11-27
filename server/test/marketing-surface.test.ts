import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { renderConsentPage } from "../src/oauth-page.js"

test("public name and early-access pricing each live in one file", () => {
  const brand = readFileSync(new URL("../../shared/brand.ts", import.meta.url), "utf8")
  const pricing = readFileSync(new URL("../../web/src/config/pricing.ts", import.meta.url), "utf8")
  assert.match(brand, /export const productName = "Agent Hub"/)
  assert.match(pricing, /Early-access pricing/)
  assert.match(pricing, /\$29/)
  assert.match(pricing, /\$19/)
  assert.match(pricing, /"Free"/)
})

test("worker assets serve the SPA and keep OAuth off the fallback", () => {
  const text = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8")
  assert.match(text, /"not_found_handling": "single-page-application"/)
  const block = text.match(/"run_worker_first":\s*\[([\s\S]*?)\]/)
  assert.ok(block)
  const paths = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual(paths, ["/api/*", "/mcp", "/mcp/*", "/authorize", "/token", "/register", "/.well-known/*"])
})

test("approval page is usable on a narrow screen", () => {
  const html = renderConsentPage({
    mode: "login",
    handle: "handle-1",
    clientName: "Claude",
    redirectHost: "claude.ai",
    redirectIsLoopback: false,
    scope: ["mcp"],
  })
  assert.match(html, /width=device-width/)
  assert.match(html, /min-height:\s*44px/)
  assert.match(html, /overflow-x:\s*hidden/)
  assert.match(html, /Agent Hub/)
})
