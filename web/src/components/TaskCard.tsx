import { Clock, User } from "lucide-react";
import { Link } from "react-router-dom";
import { STATUS_CLASS, STATUS_LABEL, timeAgo, type Agent, type Task } from "../lib/types";

export default function TaskCard({ task, agents }: { task: Task; agents: Agent[] }) {
  const holder = agents.find((a) => a.id === task.claimed_by);
  const assignee = agents.find((a) => a.id === task.assignee_agent_id);
  return (
    <Link to={`/tasks/${task.id}`} className="card block hover:border-indigo-400">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="text-sm font-medium leading-snug">{task.title}</div>
        <span className="pill shrink-0 bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">P{task.priority}</span>
      </div>
      <div className="mb-2 line-clamp-2 text-xs text-neutral-500">{task.brief}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`pill ${STATUS_CLASS[task.status]}`}>{STATUS_LABEL[task.status]}</span>
        {task.is_human ? (
          <span className="pill bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <User size={10} className="mr-0.5 inline" />
            human
          </span>
        ) : (
          (assignee || task.assignee_capability) && (
            <span className="pill bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{assignee?.name ?? task.assignee_capability}</span>
          )
        )}
        {holder && <span className="text-neutral-500">held by {holder.name}</span>}
        <span className="ml-auto flex items-center gap-1 text-neutral-400">
          <Clock size={10} /> {timeAgo(task.updated_at)}
        </span>
      </div>
    </Link>
  );
}
