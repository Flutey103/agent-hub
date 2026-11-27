import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { productName } from "../../../shared/brand"
import { CRON_PRESETS, WORKFLOW_TEMPLATES } from "@/config/workflows"
import { Button } from "@/components/ui/button"
import { Field, Input, Textarea } from "@/components/ui/input"
import { Select } from "@/components/ui/menu"
import { ErrorText, LoadingBlock, PageHeader } from "@/components/ui-bits"
import { useAgents, useLoops } from "@/lib/queries"
import { supabase } from "@/lib/supabase"
import { usePreviewLock } from "@/lib/task-actions"
import type { LoopStage } from "@/lib/types"
import { usePageTitle } from "@/lib/utils"
import { usePaths, useWorkspace } from "@/lib/workspace"

interface DraftStage {
  name: string
  brief: string
  acceptance: string
  route: string
  review: string
}

const emptyStage = (): DraftStage => ({ name: "", brief: "", acceptance: "", route: "any", review: "none" })

function slugify(value: string) {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
  return slug || "workflow"
}

function fromStage(stage: LoopStage, agents: { id: string; slug: string }[]): DraftStage {
  let route = "any"
  if (stage.human) route = "human"
  else if (stage.agent) route = `agent:${stage.agent}`
  else if (stage.capability) route = `cap:${stage.capability}`
  return {
    name: stage.name,
    brief: stage.brief,
    acceptance: stage.acceptance ?? "",
    route: agents.some((agent) => `agent:${agent.slug}` === route) || route === "human" || route.startsWith("cap:") || route === "any" ? route : "any",
    review: stage.review_by || "none",
  }
}

function toStage(draft: DraftStage): LoopStage {
  const stage: LoopStage = { name: draft.name.trim(), brief: draft.brief.trim() }
  if (draft.acceptance.trim()) stage.acceptance = draft.acceptance.trim()
  if (draft.route === "human") stage.human = true
  else if (draft.route.startsWith("cap:")) stage.capability = draft.route.slice(4)
  else if (draft.route.startsWith("agent:")) stage.agent = draft.route.slice(6)
  if (draft.review !== "none") stage.review_by = draft.review
  return stage
}

export default function WorkflowEditorPage() {
  const { id } = useParams()
  const creating = !id
  usePageTitle(`${creating ? "New workflow" : "Edit workflow"} — ${productName}`)
  const paths = usePaths()
  const navigate = useNavigate()
  const { workspaceId } = useWorkspace()
  const locked = usePreviewLock()
  const qc = useQueryClient()
  const loops = useLoops()
  const agentsQuery = useAgents()
  const existing = (loops.data ?? []).find((loop) => loop.id === id)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [cron, setCron] = useState("manual")
  const [customCron, setCustomCron] = useState("")
  const [active, setActive] = useState(true)
  const [stages, setStages] = useState<DraftStage[]>([emptyStage(), emptyStage()])
  const [loaded, setLoaded] = useState(creating)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (creating || !existing || loaded || agentsQuery.isLoading) return
    setName(existing.name)
    setDescription(existing.description ?? "")
    const preset = CRON_PRESETS.find((item) => item.cron === existing.cron)
    setCron(preset ? preset.id : "custom")
    setCustomCron(preset ? "" : (existing.cron ?? ""))
    setActive(existing.is_active)
    setStages(existing.stages.map((stage) => fromStage(stage, agentsQuery.data ?? [])))
    setLoaded(true)
  }, [creating, existing, loaded, agentsQuery.data, agentsQuery.isLoading])

  const capabilities = useMemo(() => Array.from(new Set((agentsQuery.data ?? []).flatMap((agent) => agent.capabilities))).sort(), [agentsQuery.data])
  const routeOptions = [
    { value: "any", label: "Any assistant" },
    { value: "human", label: "Me" },
    ...capabilities.map((capability) => ({ value: `cap:${capability}`, label: capability, group: "Capability" })),
    ...(agentsQuery.data ?? []).map((agent) => ({ value: `agent:${agent.slug}`, label: agent.name, group: "Assistant" })),
  ]
  const reviewOptions = [{ value: "none", label: "No review" }, ...capabilities.map((capability) => ({ value: capability, label: capability }))]

  function applyTemplate(templateId: string) {
    const template = WORKFLOW_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    setName(template.name)
    setDescription(template.description)
    const preset = CRON_PRESETS.find((item) => item.cron === template.cron)
    setCron(preset?.id ?? "manual")
    setStages(template.stages.map((stage) => fromStage(stage, agentsQuery.data ?? [])))
  }

  async function save() {
    if (locked("Saving a workflow")) return
    const cleaned = stages.map(toStage).filter((stage) => stage.name && stage.brief)
    if (!name.trim() || cleaned.length === 0) {
      setError("Add a name and at least one stage with a name and a brief.")
      return
    }
    const cronValue = cron === "custom" ? customCron.trim() : (CRON_PRESETS.find((item) => item.id === cron)?.cron ?? null)
    if (cron === "custom" && (cronValue ?? "").split(/\s+/).length !== 5) {
      setError("A custom schedule needs five cron fields, for example 0 9 * * 1-5.")
      return
    }
    setBusy(true)
    setError(null)
    const payload = { name: name.trim(), description: description.trim() || null, cron: cronValue || null, is_active: active, stages: cleaned }
    const result = creating
      ? await supabase.from("loops").insert({ ...payload, workspace_id: workspaceId, slug: slugify(name) }).select("id").single()
      : await supabase.from("loops").update(payload).eq("id", id).eq("workspace_id", workspaceId).select("id").single()
    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    await qc.invalidateQueries({ queryKey: ["loops"] })
    toast("Workflow saved")
    navigate(paths.workflows)
  }

  if (!creating && loops.isLoading) return <LoadingBlock />
  if (!creating && !loops.isLoading && !existing) return <ErrorText message="Workflow not found" />

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={paths.workflows} className="mb-3 inline-flex min-h-11 items-center text-sm text-muted-foreground">
        Workflows
      </Link>
      <PageHeader title={creating ? "New workflow" : "Edit workflow"} description="Stages run in order. A human stage waits in your inbox." />
      {creating ? (
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {WORKFLOW_TEMPLATES.map((template) => (
            <Button key={template.id} variant="outline" onClick={() => applyTemplate(template.id)}>
              Use “{template.name}”
            </Button>
          ))}
        </div>
      ) : null}
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Schedule" hint="The schedule arms after the first run.">
          <Select value={cron} onValueChange={setCron} options={[...CRON_PRESETS.map((item) => ({ value: item.id, label: item.label })), { value: "custom", label: "Custom cron" }]} />
        </Field>
        {cron === "custom" ? (
          <Field label="Cron">
            <Input value={customCron} onChange={(event) => setCustomCron(event.target.value)} placeholder="0 9 * * 1-5" />
          </Field>
        ) : null}
        <Button variant={active ? "secondary" : "outline"} onClick={() => setActive((value) => !value)}>
          {active ? "Active" : "Paused"}
        </Button>
        <div className="space-y-3">
          {stages.map((stage, index) => (
            <div key={index} className="space-y-2 rounded-lg border p-3">
              <div className="text-sm font-medium">Stage {index + 1}</div>
              <Field label="Name">
                <Input value={stage.name} onChange={(event) => update(index, { name: event.target.value })} />
              </Field>
              <Field label="Brief">
                <Textarea value={stage.brief} onChange={(event) => update(index, { brief: event.target.value })} />
              </Field>
              <Field label="Who does it">
                <Select value={stage.route} onValueChange={(route) => update(index, { route })} options={routeOptions} />
              </Field>
              <Field label="Review by">
                <Select value={stage.review} onValueChange={(review) => update(index, { review })} options={reviewOptions} />
              </Field>
              {stages.length > 1 ? (
                <Button variant="ghost" onClick={() => setStages((current) => current.filter((_, item) => item !== index))}>
                  Remove stage
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        <Button variant="outline" className="w-full" onClick={() => setStages((current) => [...current, emptyStage()])}>
          Add stage
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button className="w-full sm:w-auto" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save workflow"}
        </Button>
      </div>
    </div>
  )

  function update(index: number, patch: Partial<DraftStage>) {
    setStages((current) => current.map((stage, item) => (item === index ? { ...stage, ...patch } : stage)))
  }
}
