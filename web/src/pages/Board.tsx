import TaskCard from "../components/TaskCard";
import { useAgents, useTasks } from "../lib/queries";
import { STATUS_LABEL, type TaskStatus } from "../lib/types";

const COLUMNS: TaskStatus[] = ["queued", "claimed", "in_review", "awaiting_human", "done"];

export default function Board() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: agents = [] } = useAgents();
  if (isLoading) return <div className="text-sm text-neutral-500">Loading board…</div>;
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Board</h1>
      <div className="grid grid-cols-5 gap-3">
        {COLUMNS.map((status) => {
          const col = tasks.filter((t) => t.status === status || (status === "done" && t.status === "failed"));
          return (
            <div key={status} className="min-w-0">
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <span>{STATUS_LABEL[status]}</span>
                <span>{col.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {col.slice(0, 50).map((t) => (
                  <TaskCard key={t.id} task={t} agents={agents} />
                ))}
                {col.length === 0 && <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-400 dark:border-neutral-700">Empty</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
