/** Browser storage key for the /authorize URL a magic link should resume. */
export const OAUTH_RETURN_STORAGE_KEY = "ah_oauth_return"

/**
 * Set in sessionStorage before the Supabase client strips `code` from the URL.
 * The app reads it to know this page load is an auth callback.
 */
export const AUTH_CALLBACK_FLAG = "ah_auth_callback"

/** How long a magic-link return path stays valid. The consent handle is minted again on return. */
export const OAUTH_RETURN_TTL_MS = 60 * 60 * 1000

const MAX_AUTHORIZE_PATH = 4096

/** True when the path is a same-origin /authorize request and not an open redirect. */
export function isSafeAuthorizePath(path: string): boolean {
  return authorizeReturnPath(path) !== null
}

/** Path and query to navigate to, or null when the value must not be used as a redirect. */
export function authorizeReturnPath(path: string): string | null {
  if (path.length === 0 || path.length > MAX_AUTHORIZE_PATH) return null
  if (!path.startsWith("/authorize?")) return null
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return null
  let url: URL
  try {
    url = new URL(path, "https://agent-hub.local")
  } catch {
    return null
  }
  if (url.origin !== "https://agent-hub.local" || url.pathname !== "/authorize" || url.search.length < 2) return null
  return url.pathname + url.search
}

export function serializeOAuthReturn(path: string, now = Date.now()): string | null {
  const safe = authorizeReturnPath(path)
  if (!safe) return null
  return JSON.stringify({ path: safe, exp: now + OAUTH_RETURN_TTL_MS })
}

export function parseOAuthReturn(raw: string | null, now = Date.now()): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { path?: unknown; exp?: unknown }
    if (typeof parsed.path !== "string" || typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null
    if (parsed.exp < now) return null
    return authorizeReturnPath(parsed.path)
  } catch {
    return null
  }
}

/** True for a Supabase magic-link or PKCE landing, and false for password recovery. */
export function isAuthCallback(search: string, hash: string): boolean {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash)
  if (query.get("type") === "recovery" || fragment.get("type") === "recovery") return false
  return query.has("code") || fragment.has("access_token") || fragment.get("type") === "magiclink"
}

export function authorizeResumeTarget(input: {
  search: string
  hash: string
  callbackFlag: boolean
  stored: string | null
  now?: number
}): string | null {
  if (!input.callbackFlag && !isAuthCallback(input.search, input.hash)) return null
  return parseOAuthReturn(input.stored, input.now ?? Date.now())
}
