import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * Service-role client. Bypasses RLS; never ship this key to a browser.
 * Cached per isolate for a given URL and key. Session persistence is off,
 * so the client holds no user request state.
 */
let cached: { url: string; key: string; client: SupabaseClient } | undefined;

export function getDb(): SupabaseClient {
  const url = env.supabaseUrl;
  const key = env.supabaseServiceRoleKey;
  if (!cached || cached.url !== url || cached.key !== key) {
    cached = {
      url,
      key,
      client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    };
  }
  return cached.client;
}

export const db: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getDb();
    const value = Reflect.get(client, prop, client) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});

export class HubError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new HubError(`${what}: ${result.error.message}`, 500);
  if (result.data === null || result.data === undefined) throw new HubError(`${what}: not found`, 404);
  return result.data;
}
