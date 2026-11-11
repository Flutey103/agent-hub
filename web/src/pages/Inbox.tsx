import TaskCard from "../components/TaskCard";
import { useAgents, useTasks } from "../lib/queries";

export default function Inbox() {
  const { data: tasks = [] } = useTasks();
  const { data: agents = [] } = useAgents();
  const mine = tasks.filter((t) => t.status === "awaiting_human");
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold">Inbox</h1>
      <p className="mb-4 text-sm text-neutral-500">Tasks that need a human: approval gates, failures and escalations.</p>
      <div className="flex flex-col gap-2">
        {mine.map((t) => (
          <TaskCard key={t.id} task={t} agents={agents} />
        ))}
        {mine.length === 0 && <div className="card text-sm text-neutral-500">Nothing waiting on you.</div>}
      </div>
    </div>
  );
}
