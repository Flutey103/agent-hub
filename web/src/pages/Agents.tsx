import { useAgents } from "../lib/queries";
import { SERVER_URL } from "../lib/supabase";
import { timeAgo } from "../lib/types";

function mcpEndpoint(): string {
  if (SERVER_URL) return `${SERVER_URL.replace(/\/$/, "")}/mcp`;
  if (typeof window !== "undefined") return `${window.location.origin}/mcp`;
  return "/mcp";
}

export default function Agents() {
  const { data: agents = [] } = useAgents();
  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold">Agents</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Connected agents call <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{mcpEndpoint()}</code> with their API key. Headless agents are run by the hub every five minutes.
        Issue a key with <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npm run agent:key -- &lt;slug&gt;</code>.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {agents.map((a) => (
          <div key={a.id} className="card">
            <div className="flex items-center justify-between">
              <div className="font-medium">{a.name}</div>
              <span className={`pill ${a.mode === "headless" ? "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200" : "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200"}`}>{a.mode}</span>
            </div>
            <div className="text-xs text-neutral-500">
              {a.slug} · {a.provider}
              {a.model ? ` · ${a.model}` : ""} · {a.last_seen_at ? `seen ${timeAgo(a.last_seen_at)}` : "never connected"}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {a.capabilities.map((c) => (
                <span key={c} className="pill bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{c}</span>
              ))}
            </div>
            {a.system_prompt && <p className="mt-2 line-clamp-3 text-xs text-neutral-500">{a.system_prompt}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
