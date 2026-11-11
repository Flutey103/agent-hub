/**
 * Issue (or rotate) an API key for a connected agent.
 *   npm run agent:key -- <slug>
 *   npm run agent:key -- <slug> --create "Display name" provider cap1,cap2
 * The key is printed once and only its hash is stored.
 *
 * Writes through the Supabase service role in the repo-root .env file.
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: resolve(root, ".env") });

const { generateKey, hashKey } = await import("../src/auth.js");
const { db } = await import("../src/db.js");

const [slug, flag, name, provider, caps] = process.argv.slice(2);
if (!slug) {
  console.error("Usage: npm run agent:key -- <slug> [--create \"Name\" anthropic|openai|xai|other cap1,cap2]");
  process.exit(1);
}

const key = generateKey();
const api_key_hash = hashKey(key);

if (flag === "--create") {
  if (!name || !provider) {
    console.error("--create needs a name and provider");
    process.exit(1);
  }
  const { error } = await db.from("agents").insert({
    slug,
    name,
    provider,
    mode: "connected",
    capabilities: caps ? caps.split(",").map((c) => c.trim()) : [],
    api_key_hash,
  });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
} else {
  const { data, error } = await db.from("agents").update({ api_key_hash }).eq("slug", slug).select("id");
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!data?.length) {
    console.error(`No agent with slug ${slug}. Add --create "Name" provider caps to create it.`);
    process.exit(1);
  }
}

console.log(`API key for ${slug} (shown once):\n\n  ${key}\n`);
console.log("Use it as: Authorization: Bearer <key>");
