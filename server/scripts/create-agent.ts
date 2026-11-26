/**
 * Issue (or rotate) an API key for an agent in one workspace.
 *   npm run agent:key -- <slug> --workspace <workspace-slug>
 *   npm run agent:key -- <slug> --workspace <workspace-slug> --create "Display name" provider cap1,cap2
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

const args = process.argv.slice(2);
let workspaceSlug: string | undefined;
let create = false;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--workspace") workspaceSlug = args[++i];
  else if (args[i] === "--create") create = true;
  else positional.push(args[i]);
}

const slug = positional[0];
if (!slug || !workspaceSlug) {
  console.error('Usage: npm run agent:key -- <slug> --workspace <workspace-slug> [--create "Name" anthropic|openai|xai|other cap1,cap2]');
  process.exit(1);
}

let workspace = (await db.from("workspaces").select("id, slug, name").eq("slug", workspaceSlug).maybeSingle()).data as
  | { id: string; slug: string; name: string }
  | null;
if (!workspace && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceSlug)) {
  workspace = (await db.from("workspaces").select("id, slug, name").eq("id", workspaceSlug).maybeSingle()).data as
    | { id: string; slug: string; name: string }
    | null;
}
if (!workspace) {
  const known = (await db.from("workspaces").select("slug, name").order("name")).data ?? [];
  console.error(`No workspace ${workspaceSlug}.`);
  if (known.length) console.error(known.map((item) => `  ${item.slug}  ${item.name}`).join("\n"));
  process.exit(1);
}

const key = generateKey();
const api_key_hash = hashKey(key);

if (create) {
  const name = positional[1];
  const provider = positional[2];
  const caps = positional[3];
  if (!name || !provider) {
    console.error('--create needs a name and provider after the slug');
    process.exit(1);
  }
  const { error } = await db.from("agents").insert({
    workspace_id: workspace.id,
    slug,
    name,
    provider,
    mode: "connected",
    capabilities: caps ? caps.split(",").map((c) => c.trim()).filter(Boolean) : [],
    api_key_hash,
  });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
} else {
  const { data, error } = await db.from("agents").update({ api_key_hash }).eq("workspace_id", workspace.id).eq("slug", slug).select("id");
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!data?.length) {
    console.error(`No agent ${slug} in workspace ${workspace.slug}. Add --create "Name" provider caps to create it.`);
    process.exit(1);
  }
}

console.log(`API key for ${slug} in ${workspace.slug} (shown once):\n\n  ${key}\n`);
console.log("Use it as: Authorization: Bearer <key>");
