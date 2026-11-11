import { Link } from "react-router-dom";
import { useActivity, useAgents, useTasks } from "../lib/queries";
import { timeAgo } from "../lib/types";

export default function Activity() {
  const { data: rows = [] } = useActivity(150);
  const { data: agents = [] } = useAgents();
  const { data: tasks = [] } = useTasks();
  const agentName = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.name ?? "agent") : "hub");
  const taskTitle = (id: string | null) => tasks.find((t) => t.id === id)?.title;
  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold">Activity</h1>
      <ol className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <span className="w-16 shrink-0 text-xs text-neutral-400">{timeAgo(r.created_at)}</span>
            <span className="font-medium">{agentName(r.agent_id)}</span>
            <span className="text-neutral-500">{r.event.replace(/_/g, " ")}</span>
            {r.task_id && (
              <Link to={`/tasks/${r.task_id}`} className="truncate text-indigo-600 hover:underline dark:text-indigo-300">
                {taskTitle(r.task_id) ?? "task"}
              </Link>
            )}
            {Object.keys(r.detail).length > 0 && <span className="truncate text-xs text-neutral-400">{JSON.stringify(r.detail)}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
