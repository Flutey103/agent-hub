import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

interface WorkspaceContextValue {
  workspaceId: string;
  workspaces: Workspace[];
  setWorkspaceId: (id: string) => void;
  createWorkspace: (name: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const STORAGE_KEY = "agent-hub.workspaceId";

async function loadWorkspaces(): Promise<Workspace[]> {
  const { error: ensuredError } = await supabase.rpc("ensure_personal_workspace");
  if (ensuredError) throw new Error(ensuredError.message);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error(userError?.message ?? "Not signed in");
  const { data, error } = await supabase.from("workspace_members").select("role, workspaces(id, name, slug)").eq("user_id", userData.user.id);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    role: Workspace["role"];
    workspaces: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
  }[];
  return rows
    .flatMap((row) => {
      const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
      if (!workspace) return [];
      return [{ ...workspace, role: row.role }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function WorkspaceProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspaces()
      .then((next) => {
        if (cancelled) return;
        if (!next.length) {
          setError("No workspace is available for this account.");
          setWorkspaces([]);
          return;
        }
        const stored = localStorage.getItem(STORAGE_KEY);
        const selected = next.some((workspace) => workspace.id === stored) ? stored : next[0].id;
        setWorkspaces(next);
        setWorkspaceIdState(selected);
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session.user.id]);

  function setWorkspaceId(id: string) {
    setWorkspaceIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  async function createWorkspace(name: string) {
    const { data, error: createError } = await supabase.rpc("create_workspace", { p_name: name });
    if (createError) throw new Error(createError.message);
    const next = await loadWorkspaces();
    setWorkspaces(next);
    const created = typeof data === "string" ? data : next[next.length - 1]?.id;
    if (created) setWorkspaceId(created);
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card w-full max-w-md space-y-2 p-6">
          <h1 className="text-lg font-semibold">Agent Hub</h1>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }
  if (!workspaces || !workspaceId) return <div className="p-8 text-sm text-neutral-500">Loading workspace…</div>;

  return <WorkspaceContext.Provider value={{ workspaceId, workspaces, setWorkspaceId, createWorkspace }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceProvider is missing");
  return value;
}
