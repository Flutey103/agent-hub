/** First-party session cookie. SameSite=Lax so a top-level visit from ChatGPT still sends it. */

export const SESSION_COOKIE = "ah_session";

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function secureFlag(request: Request): string {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

export function sessionCookie(token: string, request: Request): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600${secureFlag(request)}`;
}

export function clearSessionCookie(request: Request): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag(request)}`;
}
