/** Publishes the signed-in Supabase access token as the first-party ah_session cookie. */

export async function publishHubSession(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { authorization: `Bearer ${accessToken}` },
    })
    return response.ok
  } catch {
    return false
  }
}

export async function clearHubSession(): Promise<void> {
  try {
    await fetch("/api/session", { method: "DELETE", credentials: "same-origin" })
  } catch {
    // Signing out locally still wins if the cookie request cannot be sent.
  }
}
