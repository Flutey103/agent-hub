import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { currentEnv } from "./context.js";

/**
 * Worker secrets are applied with `wrangler secret put` and are not vars, so
 * `wrangler types` does not list them. Optional provider keys may be absent.
 */
declare global {
  interface Env {
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    OAUTH_KV: KVNamespace;
    /** Injected by the OAuth provider on requests it forwards to the default handler. */
    OAUTH_PROVIDER?: OAuthHelpers;
    ANTHROPIC_API_KEY?: string;
    OPENAI_API_KEY?: string;
    XAI_API_KEY?: string;
  }
}

type EnvName = keyof Env | "PUBLIC_URL" | "DEFAULT_LEASE_MINUTES" | "RUNNER_ENABLED";

function read(name: EnvName): string | undefined {
  const bound = currentEnv();
  if (bound && name in bound) {
    const value = bound[name];
    if (typeof value === "string") return value;
  }
  return process.env[name];
}

function required(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = read(name);
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get publicUrl() {
    return (read("PUBLIC_URL") || "http://localhost:8787").replace(/\/$/, "");
  },
  get defaultLeaseMinutes() {
    const n = Number(read("DEFAULT_LEASE_MINUTES") ?? 30);
    return Number.isFinite(n) && n > 0 ? n : 30;
  },
  get runnerEnabled() {
    return (read("RUNNER_ENABLED") ?? "true") !== "false";
  },
  get anthropicApiKey() {
    return read("ANTHROPIC_API_KEY") ?? "";
  },
  get openaiApiKey() {
    return read("OPENAI_API_KEY") ?? "";
  },
  get xaiApiKey() {
    return read("XAI_API_KEY") ?? "";
  },
};
