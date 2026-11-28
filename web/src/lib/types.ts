export type TaskStatus = "queued" | "claimed" | "in_review" | "awaiting_human" | "done" | "failed" | "cancelled";

export interface Agent {
  id: string;
  slug: string;
  name: string;
  provider: string;
  model: string | null;
  mode: "connected" | "headless";
  capabilities: string[];
  system_prompt: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  workspace_id?: string;
  has_api_key?: boolean;
  oauth_client_id?: string | null;
  created_by?: string | null;
  avatar_url?: string | null;
  client_uri?: string | null;
  logo_uri?: string | null;
  website_url?: string | null;
}

export interface Task {
  id: string;
  title: string;
  brief: string;
  acceptance_criteria: string | null;
  status: TaskStatus;
  priority: number;
  assignee_capability: string | null;
  assignee_agent_id: string | null;
  is_human: boolean;
  claimed_by: string | null;
  lease_expires_at: string | null;
  claim_count: number;
  scheduled_for: string | null;
  due_at: string | null;
  parent_task_id: string | null;
  loop_run_id: string | null;
  stage_index: number | null;
  review_by_capability: string | null;
  input_artifact_ids: string[];
  output_artifact_ids: string[];
  result_summary: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Artifact {
  id: string;
  key: string;
  version: number;
  title: string;
  kind: string;
  content: string | null;
  metadata: Record<string, unknown>;
  created_by_agent: string | null;
  task_id: string | null;
  created_at: string;
}

export interface LoopStage {
  name: string;
  brief: string;
  acceptance?: string;
  capability?: string;
  agent?: string;
  human?: boolean;
  review_by?: string;
  inputs?: string[];
}

export interface Loop {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  cron: string | null;
  next_run_at: string | null;
  is_active: boolean;
  stages: LoopStage[];
}

export interface HandoffNote {
  id: string;
  task_id: string;
  agent_id: string | null;
  summary: string;
  decisions: string[];
  open_questions: string[];
  suggested_next: string | null;
  created_at: string;
}

export interface ActivityRow {
  id: number;
  agent_id: string | null;
  task_id: string | null;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface Fact {
  id: string;
  statement: string;
  source_url: string | null;
  confidence: number | null;
  tags: string[];
  recorded_by: string | null;
  task_id: string | null;
  valid_until: string | null;
  created_at: string;
}

export interface ToolCall {
  id: number;
  agent_id: string | null;
  task_id: string | null;
  tool: string;
  ok: boolean;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export interface LoopRun {
  id: string;
  loop_id: string;
  status: "running" | "done" | "failed" | "cancelled";
  current_stage: number;
  started_at: string;
  completed_at: string | null;
}

export interface Member {
  user_id: string;
  role: "owner" | "admin" | "member";
}

export const PRIORITY_LABEL: Record<number, string> = {
  1: "Urgent",
  2: "High",
  3: "Normal",
  4: "Low",
  5: "Lowest",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Queued",
  claimed: "In progress",
  in_review: "In review",
  awaiting_human: "Needs you",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const STATUS_CLASS: Record<TaskStatus, string> = {
  queued: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
  claimed: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
  in_review: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  awaiting_human: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
  cancelled: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
