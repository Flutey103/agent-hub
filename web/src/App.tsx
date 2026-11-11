import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { useRealtime } from "./lib/queries";
import { supabase, supabaseConfigured } from "./lib/supabase";
import Activity from "./pages/Activity";
import Agents from "./pages/Agents";
import Artifacts from "./pages/Artifacts";
import Board from "./pages/Board";
import Inbox from "./pages/Inbox";
import Login from "./pages/Login";
import Loops from "./pages/Loops";
import NewTask from "./pages/NewTask";
import TaskDetail from "./pages/TaskDetail";

function Authed() {
  useRealtime();
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Board />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/tasks/new" element={<NewTask />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/artifacts" element={<Artifacts />} />
        <Route path="/loops" element={<Loops />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function MissingSupabaseConfig() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-md space-y-2 p-6">
        <h1 className="text-lg font-semibold">Agent Hub</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          This build has no Supabase browser credentials. Set <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">VITE_SUPABASE_URL</code> and{" "}
          <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">VITE_SUPABASE_ANON_KEY</code> and run the web build again.
        </p>
        <p className="text-sm text-neutral-500">The API and MCP endpoint on this origin do not use those keys. They stay in the browser bundle only.</p>
      </div>
    </div>
  );
}

function SessionApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  if (!session) return <Login />;
  return <Authed />;
}

export default function App() {
  if (!supabaseConfigured) return <MissingSupabaseConfig />;
  return <SessionApp />;
}
