import { SERVER_URL, supabase } from "./supabase";

/** Calls the hub server as the signed-in human. */
export async function serverSend<T = unknown>(method: "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`${SERVER_URL}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

export function serverPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return serverSend<T>("POST", path, body);
}
