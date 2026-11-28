import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useState, type FormEvent } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { toast } from "sonner"
import { productName } from "../../../shared/brand"
import { CAPABILITY_PRESETS } from "@/lib/capabilities"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/input"
import { Select } from "@/components/ui/menu"
import { EmptyState, ErrorText, LoadingBlock, PageHeader } from "@/components/ui-bits"
import { serverSend } from "@/lib/api"
import { useActivity, useAgents, useToolCalls } from "@/lib/queries"
import { SERVER_URL, supabase } from "@/lib/supabase"
import { usePreviewLock } from "@/lib/task-actions"
import { timeAgo, type Agent, type ToolCall } from "@/lib/types"
import { usePageTitle } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

const CLIENTS = [
  { name: "Claude", steps: ["Open Settings, then Connectors.", "Add a custom connector.", "Paste the MCP URL.", "Sign in when asked and approve the assistant."] },
  { name: "ChatGPT", steps: ["Open Settings, then Apps or Connectors.", "Create a new app.", "Paste the same MCP URL.", "Approve it on the consent screen."] },
  { name: "Grok", steps: ["On grok.com, add the MCP URL as a custom connector.", "Or call the REST tools with an API key as Authorization: Bearer ah_….", "Approve the connector if the browser asks."] },
]

function mcpEndpoint() {
  if (SERVER_URL) return `${SERVER_URL.replace(/\/$/, "")}/mcp`
  if (typeof window !== "undefined") return `${window.location.origin}/mcp`
  return "/mcp"
}

function spark(calls: ToolCall[], agentId: string) {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (29 - index))
    return { key: date.toISOString().slice(0, 10), count: 0 }
  })
  for (const call of calls) {
    if (call.agent_id !== agentId) continue
    const bucket = days.find((day) => day.key === call.created_at.slice(0, 10))
    if (bucket) bucket.count += 1
  }
  const max = Math.max(1, ...days.map((day) => day.count))
  return days.map((day) => ({ ...day, height: day.count === 0 ? 8 : Math.round((day.count / max) * 100) }))
}

export default function AgentsPage() {
  usePageTitle(`Agents — ${productName}`)
  const { workspaceId, workspace } = useWorkspace()
  const qc = useQueryClient()
  const locked = usePreviewLock()
  const agents = useAgents()
  const calls = useToolCalls()
  const activity = useActivity(80)
  const endpoint = mcpEndpoint()
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState("")
  const [provider, setProvider] = useState("other")
  const [mode, setMode] = useState("connected")
  const [preset, setPreset] = useState("all")
  const [extra, setExtra] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ name: string; apiKey: string } | null>(null)
  const [profile, setProfile] = useState<Agent | null>(null)
  const [revoke, setRevoke] = useState<Agent | null>(null)
  const canBackfill = workspace.role === "owner" || workspace.role === "admin"

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  async function createKey(event: FormEvent) {
    event.preventDefault()
    if (locked("Creating a key")) return
    setBusy(true)
    setError(null)
    try {
      const created = await serverSend<{ agent: { name: string }; api_key: string }>("POST", `/workspaces/${workspaceId}/api-keys`, {
        name,
        provider,
        mode,
        preset,
        capabilities: extra.split(",").map((item) => item.trim()).filter(Boolean),
      })
      setIssued({ name: created.agent.name, apiKey: created.api_key })
      setName("")
      await qc.invalidateQueries({ queryKey: ["agents"] })
    } catch (createError) {
      setError((createError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmRevoke() {
    if (!revoke) return
    if (locked("Revoking a key")) return
    setError(null)
    try {
      await serverSend("DELETE", `/workspaces/${workspaceId}/api-keys/${revoke.id}`)
      await qc.invalidateQueries({ queryKey: ["agents"] })
      setRevoke(null)
      setProfile(null)
      toast("Key revoked")
    } catch (revokeError) {
      setError((revokeError as Error).message)
    }
  }

  async function setActive(agent: Agent, isActive: boolean) {
    if (locked(isActive ? "Reactivating" : "Deactivating")) return
    const { error: updateError } = await supabase.from("agents").update({ is_active: isActive }).eq("id", agent.id).eq("workspace_id", workspaceId)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await qc.invalidateQueries({ queryKey: ["agents"] })
  }

  async function refreshIcons() {
    if (locked("Refreshing icons")) return
    setError(null)
    try {
      const result = await serverSend<{ updated: number; failed: number; remaining: number }>("POST", `/workspaces/${workspaceId}/avatars/backfill`)
      await qc.invalidateQueries({ queryKey: ["agents"] })
      const failed = result.failed ? ` ${result.failed} could not be fetched.` : ""
      const remaining = result.remaining ? ` ${result.remaining} still to do — run it again.` : ""
      toast(`Updated ${result.updated} ${result.updated === 1 ? "icon" : "icons"}.${failed}${remaining}`)
    } catch (refreshError) {
      setError((refreshError as Error).message)
    }
  }

  if (agents.isLoading) return <LoadingBlock />
  if (agents.error) return <ErrorText message={agents.error.message} />
  const rows = agents.data ?? []
  const liveProfile = rows.find((agent) => agent.id === profile?.id) ?? profile

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agents"
        description="Connect a chat assistant with the MCP URL, or issue a revocable API key."
        actions={
          canBackfill ? (
            <Button variant="outline" onClick={() => void refreshIcons()}>
              Refresh missing icons
            </Button>
          ) : null
        }
      />
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">MCP URL</h2>
        <p className="text-sm text-muted-foreground">Paste this into the client. You'll approve the assistant and choose the workspace.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <code className="min-w-0 flex-1 overflow-wrap-anywhere rounded-md bg-muted px-3 py-3 text-sm">{endpoint}</code>
          <Button className="w-full sm:w-auto" onClick={() => void copy(endpoint)}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {CLIENTS.map((client) => (
            <article key={client.name} className="rounded-lg border p-3">
              <h3 className="font-medium">{client.name}</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
                {client.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">API keys</h2>
        <p className="text-sm text-muted-foreground">A key is shown once and stored only as a hash. Revoking it stops that key immediately.</p>
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={createKey}>
          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
          </Field>
          <Field label="Provider">
            <Select value={provider} onValueChange={setProvider} options={[{ value: "anthropic", label: "Anthropic" }, { value: "openai", label: "OpenAI" }, { value: "xai", label: "xAI" }, { value: "other", label: "Other" }]} />
          </Field>
          <Field label="Mode">
            <Select value={mode} onValueChange={setMode} options={[{ value: "connected", label: "Connected" }, { value: "headless", label: "Headless" }]} />
          </Field>
          <Field label="Capabilities">
            <Select value={preset} onValueChange={setPreset} options={CAPABILITY_PRESETS.map((item) => ({ value: item.id, label: item.label }))} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Extra capabilities" hint="Optional, comma separated">
              <Input value={extra} onChange={(event) => setExtra(event.target.value)} />
            </Field>
          </div>
          <Button type="submit" className="sm:col-span-2 sm:w-fit" disabled={busy}>
            {busy ? "Creating…" : "Create API key"}
          </Button>
        </form>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {issued ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p className="font-medium">Key for {issued.name}</p>
            <p className="mt-1 text-muted-foreground">Copy it now. It will not be shown again.</p>
            <code className="mt-2 block overflow-wrap-anywhere rounded bg-background px-2 py-2">{issued.apiKey}</code>
            <Button className="mt-2" variant="outline" onClick={() => void navigator.clipboard.writeText(issued.apiKey)}>
              Copy key
            </Button>
          </div>
        ) : null}
      </section>

      {rows.length === 0 ? (
        <EmptyState title="No assistants yet" body="Connect one with the URL above. The card turns live after the first tool call." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((agent) => (
            <button key={agent.id} type="button" className="rounded-lg border p-4 text-left" onClick={() => setProfile(agent)}>
              <div className="flex items-center gap-3">
                <AgentAvatar name={agent.name} avatarUrl={agent.avatar_url} seed={agent.id} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{agent.name}</span>
                    <span className={`size-2 shrink-0 rounded-full ${agent.last_seen_at ? "bg-emerald-500" : "bg-amber-500"}`} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {agent.provider} · {agent.mode} · {agent.last_seen_at ? `seen ${timeAgo(agent.last_seen_at)}` : "waiting for the first call"}
                    {!agent.is_active ? " · inactive" : ""}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {agent.capabilities.slice(0, 4).map((capability) => (
                  <span key={capability} className="rounded-full border px-2 py-0.5 text-xs">
                    {capability}
                  </span>
                ))}
                {agent.oauth_client_id ? <span className="rounded-full border px-2 py-0.5 text-xs">OAuth</span> : null}
                {agent.has_api_key ? <span className="rounded-full border px-2 py-0.5 text-xs">API key</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}

      <ResponsiveDialog open={Boolean(liveProfile)} onOpenChange={(open) => !open && setProfile(null)} title={liveProfile?.name ?? "Assistant"} description="Status, capabilities and recent actions.">
        {liveProfile ? (
          <AgentProfile
            key={liveProfile.id}
            agent={liveProfile}
            calls={calls.data ?? []}
            activity={activity.data ?? []}
            onRevoke={() => setRevoke(liveProfile)}
            onToggle={() => void setActive(liveProfile, !liveProfile.is_active)}
          />
        ) : null}
      </ResponsiveDialog>
      <ResponsiveDialog open={Boolean(revoke)} onOpenChange={(open) => !open && setRevoke(null)} title="Revoke API key?" description="The assistant will have to be given a new key.">
        <Button variant="destructive" className="w-full" onClick={() => void confirmRevoke()}>
          Revoke key
        </Button>
      </ResponsiveDialog>
    </div>
  )
}

function AgentProfile({
  agent,
  calls,
  activity,
  onRevoke,
  onToggle,
}: {
  agent: Agent
  calls: ToolCall[]
  activity: { id: number; agent_id: string | null; event: string; created_at: string }[]
  onRevoke: () => void
  onToggle: () => void
}) {
  const { workspaceId } = useWorkspace()
  const locked = usePreviewLock()
  const qc = useQueryClient()
  const [website, setWebsite] = useState(agent.website_url ?? "")
  const [imageUrl, setImageUrl] = useState(agent.oauth_client_id ? "" : (agent.logo_uri ?? ""))
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const bars = useMemo(() => spark(calls, agent.id), [calls, agent.id])
  const recent = activity.filter((row) => row.agent_id === agent.id).slice(0, 6)

  async function saveIcon(refresh: boolean) {
    if (locked(refresh ? "Refreshing the icon" : "Saving the icon")) return
    setBusy(true)
    setFormError(null)
    try {
      const body = refresh
        ? { refresh: true }
        : {
            website_url: website.trim(),
            ...(agent.oauth_client_id ? {} : { image_url: imageUrl.trim() }),
          }
      await serverSend("POST", `/workspaces/${workspaceId}/agents/${agent.id}/avatar`, body)
      await qc.invalidateQueries({ queryKey: ["agents"] })
      toast(refresh ? "Icon refreshed" : "Icon saved")
    } catch (saveError) {
      setFormError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <AgentAvatar name={agent.name} avatarUrl={agent.avatar_url} seed={agent.id} size="lg" />
        <p className="text-sm text-muted-foreground">
        {agent.last_seen_at ? `Last seen ${timeAgo(agent.last_seen_at)}` : "Waiting for the first call"} · {agent.mode}
        </p>
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          void saveIcon(false)
        }}
      >
        <Field label="Website" hint="We fetch this site's icon on the server. The browser never loads it from the other site.">
          <Input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://example.com" inputMode="url" maxLength={500} />
        </Field>
        {agent.oauth_client_id ? null : (
          <Field label="Icon URL" hint="Optional. An https image, if you already have one.">
            <Input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://example.com/icon.png" inputMode="url" maxLength={2000} />
          </Field>
        )}
        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="submit" variant="outline" disabled={busy}>
            {busy ? "Saving…" : "Save icon"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void saveIcon(true)}>
            Refresh icon
          </Button>
        </div>
      </form>
      <div className="flex h-12 items-end gap-px" aria-hidden>
        {bars.map((bar) => (
          <span key={bar.key} className="min-w-0 flex-1 rounded-sm bg-foreground/70" style={{ height: `${bar.height}%` }} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Tool calls, last 30 days</p>
      <div className="flex flex-wrap gap-1">
        {agent.capabilities.map((capability) => (
          <span key={capability} className="rounded-full border px-2 py-0.5 text-xs">
            {capability}
          </span>
        ))}
      </div>
      {agent.system_prompt ? <p className="text-sm text-muted-foreground">{agent.system_prompt}</p> : null}
      <ul className="space-y-1 text-sm">
        {recent.map((row) => (
          <li key={row.id} className="flex justify-between gap-2">
            <span>{row.event.replace(/_/g, " ")}</span>
            <span className="text-xs text-muted-foreground">{timeAgo(row.created_at)}</span>
          </li>
        ))}
        {recent.length === 0 ? <li className="text-muted-foreground">No actions recorded yet.</li> : null}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" onClick={onToggle}>
          {agent.is_active ? "Deactivate" : "Reactivate"}
        </Button>
        {agent.has_api_key ? (
          <Button variant="destructive" onClick={onRevoke}>
            Revoke key
          </Button>
        ) : null}
      </div>
    </div>
  )
}
