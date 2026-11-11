export type TaskStatus = "queued" | "claimed" | "in_review" | "awaiting_human" | "done" | "failed" | "cancelled";

export interface Agent {
  id: string;
  slug: string;
  name: string;
  provider: "anthropic" | "openai" | "xai" | "other";
  model: string | null;
  mode: "connected" | "headless";
  capabilities: string[];
  system_prompt: string | null;
  is_active: boolean;
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
  created_by_agent: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Artifact {
  id: string;
  key: string;
  version: number;
  title: string;
  kind: "markdown" | "json" | "url" | "image" | "text";
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
  /** Artifact keys to attach as inputs (latest version resolved at task creation). */
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

export interface LoopRun {
  id: string;
  loop_id: string;
  status: "running" | "done" | "failed" | "cancelled";
  current_stage: number;
  started_at: string;
  completed_at: string | null;
}
