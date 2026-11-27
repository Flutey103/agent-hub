import { OAUTH_RETURN_STORAGE_KEY, serializeOAuthReturn } from "../../shared/oauth-return"
import { checkEmailSignIn, magicLinkErrorMessage } from "@/lib/auth-copy"
import { supabase, supabaseConfigured } from "@/lib/supabase"

const REFRESH_WITHIN_MS = 60_000

function showLogin(): void {
  const checking = document.getElementById("checking")
  const panel = document.getElementById("login-panel")
  if (checking) checking.hidden = true
  if (panel) panel.hidden = false
  const email = document.querySelector("#login-panel input[name=email]")
  if (email instanceof HTMLInputElement && document.activeElement === document.body) email.focus()
}

function setStatus(message: string, isError = false): void {
  const status = document.getElementById("magic-status")
  if (!status) return
  status.textContent = message
  status.classList.toggle("error", isError)
  status.classList.toggle("notice", !isError && message.length > 0)
}

async function currentAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) return null
  const expiresAtMs = (data.session.expires_at ?? 0) * 1000
  const fresh = expiresAtMs === 0 || expiresAtMs > Date.now() + REFRESH_WITHIN_MS
  if (fresh) return data.session.access_token
  const refreshed = await supabase.auth.refreshSession()
  if (refreshed.data.session?.access_token) return refreshed.data.session.access_token
  if (expiresAtMs > Date.now()) return data.session.access_token
  return null
}

function postAccessToken(token: string): void {
  const form = document.getElementById("session-form")
  if (!(form instanceof HTMLFormElement)) return
  const input = form.querySelector("input[name=access_token]")
  if (!(input instanceof HTMLInputElement)) return
  input.value = token
  const checking = document.getElementById("checking")
  if (checking) {
    checking.hidden = false
    checking.textContent = "Signing in…"
  }
  const panel = document.getElementById("login-panel")
  if (panel) panel.hidden = true
  form.submit()
}

async function sendMagicLink(button: HTMLButtonElement): Promise<void> {
  const emailInput = document.querySelector("#login-panel input[name=email]")
  const email = emailInput instanceof HTMLInputElement ? emailInput.value.trim() : ""
  if (!email) {
    setStatus("Enter your email and we'll send the link.", true)
    return
  }
  if (!supabaseConfigured) {
    setStatus("This build has no sign-in service configured.", true)
    return
  }
  const stored = serializeOAuthReturn(window.location.pathname + window.location.search)
  if (!stored) {
    setStatus("This approval link is not valid. Start again from your client.", true)
    return
  }
  button.disabled = true
  setStatus("")
  try {
    localStorage.setItem(OAUTH_RETURN_STORAGE_KEY, stored)
  } catch {
    setStatus("This browser blocked site storage, so the email link cannot return here.", true)
    button.disabled = false
    return
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  })
  button.disabled = false
  if (error) {
    try {
      localStorage.removeItem(OAUTH_RETURN_STORAGE_KEY)
    } catch {
      // The failed request did not send a link, so a leftover return path only matters if storage works later.
    }
    setStatus(magicLinkErrorMessage(error.message), true)
    return
  }
  setStatus(checkEmailSignIn(email))
}

function bindMagicLink(): void {
  const button = document.getElementById("magic-link")
  if (!(button instanceof HTMLButtonElement)) return
  button.addEventListener("click", () => {
    void sendMagicLink(button)
  })
}

async function main(): Promise<void> {
  if (document.body.dataset.mode !== "login") return
  bindMagicLink()
  const rejected = document.body.dataset.sessionRejected
  if (rejected === "invalid") {
    showLogin()
    if (supabaseConfigured) void supabase.auth.signOut({ scope: "local" })
    return
  }
  if (rejected) {
    showLogin()
    return
  }
  if (!supabaseConfigured) {
    showLogin()
    return
  }
  try {
    const token = await currentAccessToken()
    if (token) {
      postAccessToken(token)
      return
    }
  } catch {
    // The password form still works when the session lookup throws.
  }
  showLogin()
}

void main()
