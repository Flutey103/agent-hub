import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useArtifacts } from "../lib/queries";
import { supabase } from "../lib/supabase";
import { timeAgo, type Artifact } from "../lib/types";

export default function Artifacts() {
  const qc = useQueryClient();
  const { data: artifacts = [] } = useArtifacts();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const byKey = useMemo(() => {
    const m = new Map<string, Artifact[]>();
    for (const a of artifacts) m.set(a.key, [...(m.get(a.key) ?? []), a]);
    for (const list of m.values()) list.sort((x, y) => y.version - x.version);
    return m;
  }, [artifacts]);
  const latest = selectedKey ? byKey.get(selectedKey)?.[0] : undefined;

  async function saveVersion(key: string, title: string, content: string) {
    const version = (byKey.get(key)?.[0]?.version ?? 0) + 1;
    const { error } = await supabase.from("artifacts").insert({ key, version, title, kind: "markdown", content });
    if (error) return alert(error.message);
    await qc.invalidateQueries({ queryKey: ["artifacts"] });
    setEditing(false);
    setSelectedKey(key);
    setNewKey("");
    setNewTitle("");
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-4">
      <div>
        <h1 className="mb-3 text-xl font-semibold">Artifacts</h1>
        <div className="card mb-3 space-y-2">
          <div className="text-xs font-semibold uppercase text-neutral-500">New artifact</div>
          <input className="input" placeholder="key (e.g. brand-voice)" value={newKey} onChange={(e) => setNewKey(e.target.value.trim())} />
          <input className="input" placeholder="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <button
            className="btn w-full justify-center"
            disabled={!newKey || !newTitle}
            onClick={() => {
              setSelectedKey(null);
              setDraft("");
              setEditing(true);
            }}
          >
            Write content
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {Array.from(byKey.entries()).map(([key, versions]) => (
            <button
              key={key}
              className={`rounded-md px-2 py-1.5 text-left text-sm ${selectedKey === key ? "bg-indigo-50 dark:bg-indigo-950" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
              onClick={() => {
                setSelectedKey(key);
                setEditing(false);
              }}
            >
              <div className="font-medium">{versions[0].title}</div>
              <div className="text-xs text-neutral-500">
                {key} · v{versions[0].version} · {timeAgo(versions[0].created_at)}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div>
        {editing ? (
          <div className="card space-y-2">
            <div className="text-sm font-medium">{latest ? `New version of ${latest.key}` : `${newTitle} (${newKey})`}</div>
            <textarea className="input font-mono" rows={24} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => saveVersion(latest?.key ?? newKey, latest?.title ?? newTitle, draft)}>
                Save as v{(latest?.version ?? 0) + 1}
              </button>
              <button className="btn" onClick={() => setEditing(false)}>
                Discard
              </button>
            </div>
          </div>
        ) : latest ? (
          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="font-medium">{latest.title}</div>
                <div className="text-xs text-neutral-500">
                  {latest.key} · v{latest.version} · {latest.kind} · {byKey.get(latest.key)?.length} version(s)
                </div>
              </div>
              <button
                className="btn"
                onClick={() => {
                  setDraft(latest.content ?? "");
                  setEditing(true);
                }}
              >
                Edit as new version
              </button>
            </div>
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-sm">{latest.content}</pre>
          </div>
        ) : (
          <div className="text-sm text-neutral-500">Select an artifact to read it. Agents read these by key, so keep keys stable and bump versions.</div>
        )}
      </div>
    </div>
  );
}
