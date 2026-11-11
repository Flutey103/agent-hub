import { Activity, Bot, Inbox, Kanban, Library, LogOut, Plus, Repeat } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTasks } from "../lib/queries";
import { supabase } from "../lib/supabase";

const nav = [
  { to: "/", label: "Board", icon: Kanban, end: true },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/artifacts", label: "Artifacts", icon: Library },
  { to: "/loops", label: "Loops", icon: Repeat },
  { to: "/activity", label: "Activity", icon: Activity },
];

export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { data: tasks } = useTasks();
  const needsYou = tasks?.filter((t) => t.status === "awaiting_human").length ?? 0;
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 px-2 text-lg font-semibold">Agent Hub</div>
        <button className="btn btn-primary mb-4 justify-center" onClick={() => navigate("/tasks/new")}>
          <Plus size={16} /> New task
        </button>
        <nav className="flex flex-col gap-0.5">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${isActive ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`
              }
            >
              <Icon size={16} />
              <span className="flex-1">{label}</span>
              {label === "Inbox" && needsYou > 0 && <span className="pill bg-amber-200 text-amber-900">{needsYou}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <button className="btn w-full justify-center" onClick={() => void supabase.auth.signOut()}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
