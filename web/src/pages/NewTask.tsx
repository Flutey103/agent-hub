import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { productName } from "../../../shared/brand"
import { Button } from "@/components/ui/button"
import { Field, Input, Textarea } from "@/components/ui/input"
import { Select } from "@/components/ui/menu"
import { PageHeader } from "@/components/ui-bits"
import { useAgents, useArtifacts } from "@/lib/queries"
import { supabase } from "@/lib/supabase"
import { usePreviewLock } from "@/lib/task-actions"
import { usePageTitle } from "@/lib/utils"
import { usePaths, useWorkspace } from "@/lib/workspace"

export default function NewTaskPage() {
  usePageTitle(`New task — ${productName}`)
  const navigate = useNavigate()
  const paths = usePaths()
  const qc = useQueryClient()
  const { workspaceId } = useWorkspace()
  const locked = usePreviewLock()
  const { data: agents = [] } = useAgents()
  const { data: artifacts = [] } = useArtifacts()
  const capabilities = useMemo(() => Array.from(new Set(agents.flatMap((agent) => agent.capabilities))).sort(), [agents])
  const artifactKeys = useMemo(() => Array.from(new Set(artifacts.map((artifact) => artifact.key))).sort(), [artifacts])
  const [title, setTitle] = useState("")
  const [brief, setBrief] = useState("")
  const [acceptance, setAcceptance] = useState("")
  const [route, setRoute] = useState("any")
  const [priority, setPriority] = useState("3")
  const [reviewBy, setReviewBy] = useState("none")
  const [inputs, setInputs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const routeOptions = [
    { value: "any", label: "Any assistant" },
    { value: "human", label: "Me" },
    ...capabilities.map((capability) => ({ value: `cap:${capability}`, label: capability, group: "By capability" })),
    ...agents.map((agent) => ({ value: `agent:${agent.id}`, label: agent.name, group: "Specific assistant" })),
  ]

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked("Creating a task")) return
    setBusy(true)
    setError(null)
    const inputIds = inputs
      .map((key) => artifacts.filter((artifact) => artifact.key === key).sort((a, b) => b.version - a.version)[0]?.id)
      .filter((id): id is string => Boolean(id))
    const row = {
      workspace_id: workspaceId,
      title,
      brief,
      acceptance_criteria: acceptance || null,
      priority: Number(priority),
      assignee_capability: route.startsWith("cap:") ? route.slice(4) : null,
      assignee_agent_id: route.startsWith("agent:") ? route.slice(6) : null,
      is_human: route === "human",
      status: route === "human" ? "awaiting_human" : "queued",
      review_by_capability: reviewBy === "none" ? null : reviewBy,
      input_artifact_ids: inputIds,
    }
    const { data, error: insertError } = await supabase.from("tasks").insert(row).select("id").single()
    if (insertError || !data) {
      setError(insertError?.message ?? "Could not create the task")
      setBusy(false)
      return
    }
    await supabase.from("activity").insert({ workspace_id: workspaceId, task_id: data.id, event: "created", detail: { by: "human" } })
    await qc.invalidateQueries({ queryKey: ["tasks"] })
    navigate(paths.task(data.id as string))
  }

  function toggleKey(key: string) {
    setInputs((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-3">
      <PageHeader title="New task" description="Write it so an assistant that has never seen this business can do the work." />
      <Field label="Title">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
      </Field>
      <Field label="Brief">
        <Textarea value={brief} onChange={(event) => setBrief(event.target.value)} required />
      </Field>
      <Field label="Acceptance" hint="Optional. How you or a reviewer will know it is done.">
        <Textarea value={acceptance} onChange={(event) => setAcceptance(event.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Route to">
          <Select value={route} onValueChange={setRoute} options={routeOptions} />
        </Field>
        <Field label="Priority">
          <Select
            value={priority}
            onValueChange={setPriority}
            options={[
              { value: "1", label: "P1 · Urgent" },
              { value: "2", label: "P2 · High" },
              { value: "3", label: "P3 · Normal" },
              { value: "4", label: "P4 · Low" },
              { value: "5", label: "P5 · Lowest" },
            ]}
          />
        </Field>
      </div>
      <Field label="Review by" hint="Optional. Another capability checks the result.">
        <Select value={reviewBy} onValueChange={setReviewBy} options={[{ value: "none", label: "No review" }, ...capabilities.map((capability) => ({ value: capability, label: capability }))]} />
      </Field>
      {artifactKeys.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Attach documents</legend>
          <div className="grid gap-2">
            {artifactKeys.map((key) => (
              <button key={key} type="button" aria-pressed={inputs.includes(key)} onClick={() => toggleKey(key)} className={`min-h-11 rounded-md border px-3 text-left text-sm ${inputs.includes(key) ? "border-foreground" : ""}`}>
                {key}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full sm:w-auto" disabled={busy}>
        {busy ? "Creating…" : "Create task"}
      </Button>
    </form>
  )
}
