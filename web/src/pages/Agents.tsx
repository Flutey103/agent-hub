import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { serverSend } from "../lib/api";
import { CAPABILITY_PRESETS } from "../lib/capabilities";
import { useAgents } from "../lib/queries";
import { SERVER_URL, supabase } from "../lib/supabase";
import { timeAgo, type Agent } from "../lib/types";
import { useWorkspace } from "../lib/workspace";

function mcpEndpoint(): string {
  if (SERVER_URL) return `${SERVER_URL.replace(/\/$/, "")}/mcp`;
  if (typeof window !== "undefined") return `${window.location.origin}/mcp`;
  return "/mcp";
}

const CONNECTORS = [
  { name: "Claude", text: "Settings → Connectors → Add custom connector. Paste the MCP URL. Sign in when asked and approve the agent." },
  { name: "ChatGPT", text: "Settings → Apps or Connectors → New app. Paste the same MCP URL and approve it in Agent Hub." },
  { name: "Grok", text: "Add the MCP URL as a custom connector on grok.com, or call the REST tools with an API key as Authorization: Bearer ah_…." },
];

export default function Agents() {
  const qc = useQueryClient();
  const { workspaceId } = useWorkspace();
  const { data: agents = [] } = useAgents();
  const endpoint = mcpEndpoint();
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("other");
  const [mode, setMode] = useState("connected");
  const [preset, setPreset] = useState("all");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; apiKey: string } | null>(null);

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function createKey(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      const created = await serverSend<{ agent: { name: string }; api_key: string }>("POST", `/workspaces/${workspaceId}/api-keys`, {
        name,
        provider,
        mode,
        preset,
        capabilities: extra.split(",").map((item) => item.trim()).filter(Boolean),
      });
      setIssued({ name: created.agent.name, apiKey: created.api_key });
      setName("");
      await qc.invalidateQueries({ queryKey: ["agents"] });
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(agent: Agent) {
    setError(null);
    try {
      await serverSend("DELETE", `/workspaces/${workspaceId}/api-keys/${agent.id}`);
      await qc.invalidateQueries({ queryKey: ["agents"] });
    } catch (revokeError) {
      setError((revokeError as Error).message);
    }
  }

  async function setActive(agent: Agent, isActive: boolean) {
    const { error: updateError } = await supabase.from("agents").update({ is_active: isActive }).eq("id", agent.id).eq("workspace_id", workspaceId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["agents"] });
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Agents</h1>
        <p className="text-sm text-neutral-500">Connect a client with OAuth, or issue a revocable API key for a headless agent or the Grok API.</p>
      </div>

      <section className="card space-y-3">
        <h2 className="font-medium">Connect a connector</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Paste this MCP URL into the client. It will send you to an approval page where you sign in, pick this workspace, and name the agent.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-neutral-100 px-2 py-1 text-sm dark:bg-neutral-800">{endpoint}</code>
          <button className="btn" type="button" onClick={() => void copy(endpoint)}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <ul className="space-y-2 text-sm">
          {CONNECTORS.map((connector) => (
            <li key={connector.name}>
              <span className="font-medium">{connector.name}. </span>
              <span className="text-neutral-600 dark:text-neutral-300">{connector.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">API keys</h2>
        <p className="text-sm text-neutral-500">A key is shown once and stored only as a hash, scoped to this workspace. Revoking it stops that key immediately.</p>
        <form className="grid gap-2 md:grid-cols-2" onSubmit={createKey}>
          <input className="input" placeholder="Agent name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
          <select className="input" value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="xai">xAI</option>
            <option value="other">Other</option>
          </select>
          <select className="input" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="connected">Connected</option>
            <option value="headless">Headless</option>
          </select>
          <select className="input" value={preset} onChange={(event) => setPreset(event.target.value)}>
            {CAPABILITY_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <input className="input md:col-span-2" placeholder="Extra capabilities, comma separated (optional)" value={extra} onChange={(event) => setExtra(event.target.value)} />
          <button className="btn btn-primary md:col-span-2 w-fit" disabled={busy}>{busy ? "Creating…" : "Create API key"}</button>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {issued && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p className="font-medium">Key for {issued.name}</p>
            <p className="mt-1 text-neutral-600 dark:text-neutral-300">Copy it now. Agent Hub will not show it again.</p>
            <code className="mt-2 block break-all rounded bg-white px-2 py-1 dark:bg-neutral-900">{issued.apiKey}</code>
            <button className="btn mt-2" type="button" onClick={() => void navigator.clipboard.writeText(issued.apiKey)}>Copy key</button>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3">
        {agents.map((agent) => (
          <div key={agent.id} className="card">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">{agent.name}</div>
              <span className={`pill ${agent.mode === "headless" ? "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200" : "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200"}`}>{agent.mode}</span>
            </div>
            <div className="text-xs text-neutral-500">
              {agent.slug} · {agent.provider}
              {agent.model ? ` · ${agent.model}` : ""} · {agent.last_seen_at ? `seen ${timeAgo(agent.last_seen_at)}` : "never connected"}
              {!agent.is_active && " · inactive"}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {agent.capabilities.map((capability) => (
                <span key={capability} className="pill bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{capability}</span>
              ))}
              {agent.oauth_client_id && <span className="pill bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">OAuth</span>}
              {agent.has_api_key && <span className="pill bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">API key</span>}
            </div>
            {agent.system_prompt && <p className="mt-2 line-clamp-3 text-xs text-neutral-500">{agent.system_prompt}</p>}
            <div className="mt-3 flex gap-2">
              {agent.has_api_key && (
                <button className="btn" type="button" onClick={() => void revoke(agent)}>Revoke key</button>
              )}
              <button className="btn" type="button" onClick={() => void setActive(agent, !agent.is_active)}>{agent.is_active ? "Deactivate" : "Reactivate"}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
