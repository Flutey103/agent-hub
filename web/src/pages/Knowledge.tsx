import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { productName } from "../../../shared/brand"
import { MarkdownView } from "@/components/markdown-view"
import { Button } from "@/components/ui/button"
import { Field, Input, Textarea } from "@/components/ui/input"
import { EmptyState, ErrorText, LoadingBlock, PageHeader } from "@/components/ui-bits"
import { useArtifacts, useFacts } from "@/lib/queries"
import { supabase } from "@/lib/supabase"
import { usePreviewLock } from "@/lib/task-actions"
import { timeAgo, type Artifact } from "@/lib/types"
import { usePageTitle } from "@/lib/utils"
import { usePaths, useWorkspace } from "@/lib/workspace"

export default function KnowledgePage({ view }: { view: "documents" | "facts" }) {
  usePageTitle(`${view === "facts" ? "Facts" : "Knowledge"} — ${productName}`)
  const paths = usePaths()
  return (
    <div>
      <PageHeader title="Knowledge" description="Documents the assistants share, and the short facts they should remember." />
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button variant={view === "documents" ? "secondary" : "outline"} asChild>
          <Link to={paths.knowledge}>Documents</Link>
        </Button>
        <Button variant={view === "facts" ? "secondary" : "outline"} asChild>
          <Link to={paths.facts}>Facts</Link>
        </Button>
      </div>
      {view === "facts" ? <FactsScreen /> : <DocumentsScreen />}
    </div>
  )
}

function DocumentsScreen() {
  const { workspaceId } = useWorkspace()
  const locked = usePreviewLock()
  const qc = useQueryClient()
  const artifacts = useArtifacts()
  const [params, setParams] = useSearchParams()
  const selectedKey = params.get("key")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [newKey, setNewKey] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [query, setQuery] = useState("")

  const byKey = useMemo(() => {
    const map = new Map<string, Artifact[]>()
    for (const artifact of artifacts.data ?? []) map.set(artifact.key, [...(map.get(artifact.key) ?? []), artifact])
    for (const list of map.values()) list.sort((a, b) => b.version - a.version)
    return map
  }, [artifacts.data])
  const keys = [...byKey.keys()].filter((key) => {
    const latest = byKey.get(key)?.[0]
    const haystack = `${key} ${latest?.title ?? ""}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })
  const versions = selectedKey ? byKey.get(selectedKey) : undefined
  const latest = versions?.[0]
  const showDetail = Boolean(selectedKey) || editing

  async function save(key: string, title: string, content: string) {
    if (locked("Saving a document")) return
    const version = (byKey.get(key)?.[0]?.version ?? 0) + 1
    const { error } = await supabase.from("artifacts").insert({ workspace_id: workspaceId, key, version, title, kind: "markdown", content })
    if (error) {
      window.alert(error.message)
      return
    }
    await qc.invalidateQueries({ queryKey: ["artifacts"] })
    setEditing(false)
    setParams({ key })
    setNewKey("")
    setNewTitle("")
  }

  if (artifacts.isLoading) return <LoadingBlock />
  if (artifacts.error) return <ErrorText message={artifacts.error.message} />

  return (
    <div className="md:grid md:grid-cols-[16rem_minmax(0,1fr)] md:gap-6">
      <div className={showDetail ? "hidden md:block" : "block"}>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents" aria-label="Search documents" />
        <div className="mt-3 space-y-2 rounded-lg border p-3">
          <Field label="New document">
            <Input value={newKey} onChange={(event) => setNewKey(event.target.value.trim())} placeholder="key, such as brand-voice" />
          </Field>
          <Field label="Title">
            <Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
          </Field>
          <Button
            className="w-full"
            disabled={!newKey || !newTitle}
            onClick={() => {
              setParams({})
              setDraft("")
              setEditing(true)
            }}
          >
            Write it
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-1">
          {keys.map((key) => {
            const current = byKey.get(key)?.[0]
            if (!current) return null
            return (
              <button
                key={key}
                type="button"
                className={`rounded-md px-2 py-2 text-left text-sm ${selectedKey === key ? "bg-accent" : ""}`}
                onClick={() => {
                  setParams({ key })
                  setEditing(false)
                }}
              >
                <div className="font-medium">{current.title}</div>
                <div className="text-xs text-muted-foreground">
                  {key} · v{current.version} · {timeAgo(current.created_at)}
                </div>
              </button>
            )
          })}
          {keys.length === 0 ? <p className="px-2 py-4 text-sm text-muted-foreground">No documents yet. Add one the assistants can read by key.</p> : null}
        </div>
      </div>
      <div className={showDetail ? "block" : "hidden md:block"}>
        <Button variant="ghost" className="mb-2 md:hidden" onClick={() => { setParams({}); setEditing(false) }}>
          All documents
        </Button>
        {editing ? (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-sm font-medium">{latest ? `New version of ${latest.key}` : `${newTitle} (${newKey})`}</div>
            <Textarea className="min-h-64 font-mono" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <div className="grid gap-2 sm:flex">
              <Button onClick={() => void save(latest?.key ?? newKey, latest?.title ?? newTitle, draft)}>Save as v{(latest?.version ?? 0) + 1}</Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Discard
              </Button>
            </div>
          </div>
        ) : latest && versions ? (
          <article className="rounded-lg border p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-medium">{latest.title}</h2>
                <p className="text-xs text-muted-foreground">
                  {latest.key} · v{latest.version} · {versions.length} version{versions.length === 1 ? "" : "s"}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(latest.content ?? "")
                  setEditing(true)
                }}
              >
                Edit as a new version
              </Button>
            </div>
            <div className="mt-4">
              <MarkdownView content={latest.content ?? ""} />
            </div>
            {versions[1] ? <VersionChanges previous={versions[1].content ?? ""} next={latest.content ?? ""} /> : null}
          </article>
        ) : (
          <EmptyState title="Pick a document" body="Agents read these by a stable key. Edit by saving a new version, so the old one stays." />
        )}
      </div>
    </div>
  )
}

function VersionChanges({ previous, next }: { previous: string; next: string }) {
  const previousLines = new Set(previous.split("\n"))
  const added = next.split("\n").filter((line) => line.trim() && !previousLines.has(line))
  if (added.length === 0) return null
  return (
    <div className="mt-4 border-t pt-3">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">New in this version</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {added.slice(0, 12).map((line, index) => (
          <li key={index} className="overflow-wrap-anywhere rounded bg-emerald-500/10 px-2 py-1">
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

function FactsScreen() {
  const { workspaceId } = useWorkspace()
  const locked = usePreviewLock()
  const qc = useQueryClient()
  const facts = useFacts()
  const [statement, setStatement] = useState("")
  const [source, setSource] = useState("")
  const [tags, setTags] = useState("")
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add() {
    if (locked("Recording a fact")) return
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from("facts").insert({
      workspace_id: workspaceId,
      statement: statement.trim(),
      source_url: source.trim() || null,
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    })
    setBusy(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setStatement("")
    setSource("")
    setTags("")
    await qc.invalidateQueries({ queryKey: ["facts"] })
  }

  if (facts.isLoading) return <LoadingBlock />
  if (facts.error) return <ErrorText message={facts.error.message} />
  const needle = query.trim().toLowerCase()
  const rows = (facts.data ?? []).filter((fact) => `${fact.statement} ${fact.tags.join(" ")}`.toLowerCase().includes(needle))

  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <Field label="Fact">
          <Textarea value={statement} onChange={(event) => setStatement(event.target.value)} required placeholder="A single sourced statement" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Source URL" hint="Optional">
            <Input value={source} onChange={(event) => setSource(event.target.value)} placeholder="https://" />
          </Field>
          <Field label="Tags" hint="Comma separated">
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="pricing, brand" />
          </Field>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy || !statement.trim()}>
          {busy ? "Saving…" : "Record fact"}
        </Button>
      </form>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search facts" aria-label="Search facts" />
      {rows.length === 0 ? (
        <EmptyState title="No facts yet" body="Record a statement the assistants should be able to look up later." />
      ) : (
        <ul className="space-y-2">
          {rows.map((fact) => (
            <li key={fact.id} className="rounded-lg border p-3">
              <p className="text-sm">{fact.statement}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {fact.source_url ? (
                  <a className="underline" href={fact.source_url} target="_blank" rel="noreferrer">
                    Source
                  </a>
                ) : null}
                {fact.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
                <span>{timeAgo(fact.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
