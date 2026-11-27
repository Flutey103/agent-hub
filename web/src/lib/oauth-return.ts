import { AUTH_CALLBACK_FLAG, OAUTH_RETURN_STORAGE_KEY, authorizeResumeTarget, isAuthCallback } from "../../../shared/oauth-return"

const NOT_A_CALLBACK = { callback: false, target: null }
let decided: { callback: true; target: string | null } | undefined

function callbackFlag(): boolean {
  try {
    return sessionStorage.getItem(AUTH_CALLBACK_FLAG) === "1"
  } catch {
    return false
  }
}

function storedReturn(): string | null {
  try {
    return localStorage.getItem(OAUTH_RETURN_STORAGE_KEY)
  } catch {
    return null
  }
}

function thisLoadIsCallback(search: string, hash: string): boolean {
  if (callbackFlag()) return true
  if (isAuthCallback(search, hash)) return true
  return isAuthCallback(window.location.search, window.location.hash)
}

/**
 * Whether this page load is a Supabase callback that should resume an /authorize request.
 * The decision is remembered for the load so a later render still redirects after storage is cleared.
 */
export function peekAuthorizeResume(search: string, hash: string): { callback: boolean; target: string | null } {
  if (decided) return decided
  if (!thisLoadIsCallback(search, hash)) return NOT_A_CALLBACK
  const target = authorizeResumeTarget({ search, hash, callbackFlag: true, stored: storedReturn() })
  decided = { callback: true, target }
  return decided
}

export function commitAuthorizeResume(): void {
  try {
    sessionStorage.removeItem(AUTH_CALLBACK_FLAG)
    localStorage.removeItem(OAUTH_RETURN_STORAGE_KEY)
  } catch {
    // Storage can be blocked. The navigation still uses the path already read.
  }
}
