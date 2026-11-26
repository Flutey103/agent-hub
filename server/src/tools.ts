/**
 * The single tool catalogue. Zod shapes feed the MCP server; JSON schemas feed
 * REST/OpenAPI and the provider SDKs for headless agents.
 */
import { z, type ZodRawShape } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { waitUntil } from "./context.js";
import { db } from "./db.js";
import * as hub from "./hub.js";
import type { Agent } from "./types.js";

export interface ToolDef {
  name: string;
  description: string;
  shape: ZodRawShape;
  run: (agent: Agent, input: Record<string, unknown>) => Promise<unknown>;
}

const uuid = z.string().uuid();

export const tools: ToolDef[] = [
  {
    name: "list_my_tasks",
    description: "List tasks available to you: queued tasks matching your capabilities or assigned to you, plus tasks you currently hold.",
    shape: { include_claimed: z.boolean().optional().describe("Include tasks you already hold (default true)") },
    run: (agent, input) => hub.listMyTasks(agent, input as never),
  },
  {
    name: "claim_task",
    description: "Claim a queued task for a lease window. Returns the full brief and input artifacts. Nobody else can claim it until the lease expires or you release or complete it.",
    shape: {
      task_id: uuid,
      lease_minutes: z.number().int().min(5).max(480).optional().describe("How long you need (default 30)"),
    },
    run: (agent, input) => hub.claimTask(agent, input as never),
  },
  {
    name: "release_task",
    description: "Give a claimed task back to the queue because you cannot do it.",
    shape: { task_id: uuid, reason: z.string().optional() },
    run: (agent, input) => hub.releaseTask(agent, input as never),
  },
  {
    name: "get_artifact",
    description: "Read an artifact by id, or by key (latest version unless version is given). Artifacts hold shared context: briefs, research, drafts, brand guides.",
    shape: { id: uuid.optional(), key: z.string().optional(), version: z.number().int().optional() },
    run: (agent, input) => hub.getArtifact(agent, input as never),
  },
  {
    name: "put_artifact",
    description: "Save a new version of an artifact under a stable key. Pass task_id to attach it as an output of the task you hold.",
    shape: {
      key: z.string().min(1).describe("Stable slug such as weekly-articles"),
      title: z.string().min(1),
      content: z.string(),
      kind: z.enum(["markdown", "json", "url", "image", "text"]).optional(),
      metadata: z.record(z.unknown()).optional(),
      task_id: uuid.optional(),
    },
    run: (agent, input) => hub.putArtifact(agent, input as never),
  },
  {
    name: "complete_task",
    description: "Finish a task you hold with a handoff note. Use outcome failed if it cannot be done. For review tasks, set verdict.",
    shape: {
      task_id: uuid,
      summary: z.string().min(1).describe("What you did and what the next agent needs to know"),
      decisions: z.array(z.string()).optional(),
      open_questions: z.array(z.string()).optional(),
      suggested_next: z.string().optional(),
      outcome: z.enum(["done", "failed"]).optional(),
      verdict: z.enum(["approved", "changes_requested"]).optional().describe("Only for review tasks"),
    },
    run: (agent, input) => hub.completeTask(agent, input as never),
  },
  {
    name: "create_task",
    description: "Create a task for another agent (by capability or slug) or for a human. Attach shared context by artifact key.",
    shape: {
      title: z.string().min(1),
      brief: z.string().min(1),
      acceptance_criteria: z.string().optional(),
      capability: z.string().optional().describe("Route to any agent with this capability"),
      agent_slug: z.string().optional().describe("Route to one specific agent"),
      for_human: z.boolean().optional(),
      priority: z.number().int().min(1).max(5).optional(),
      due_at: z.string().datetime().optional(),
      scheduled_for: z.string().datetime().optional().describe("Do not release to the queue before this time"),
      input_artifact_keys: z.array(z.string()).optional(),
      review_by: z.string().optional().describe("Capability that must approve the output before it counts as done"),
      parent_task_id: uuid.optional(),
    },
    run: (agent, input) => hub.createTask(agent, input as never),
  },
  {
    name: "search_knowledge",
    description: "Search artifacts, recorded facts and past handoff notes.",
    shape: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
    run: (agent, input) => hub.searchKnowledge(agent, input as never),
  },
  {
    name: "record_fact",
    description: "Record one atomic, sourced fact so other agents can find it later.",
    shape: {
      statement: z.string().min(1),
      source_url: z.string().url().optional(),
      confidence: z.number().min(0).max(1).optional(),
      tags: z.array(z.string()).optional(),
      task_id: uuid.optional(),
      valid_until: z.string().datetime().optional(),
    },
    run: (agent, input) => hub.recordFact(agent, input as never),
  },
];

export const toolByName = new Map(tools.map((t) => [t.name, t]));

export function jsonSchemaFor(tool: ToolDef): Record<string, unknown> {
  const schema = zodToJsonSchema(z.object(tool.shape), { $refStrategy: "none" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** Validates, runs and ledgers one tool call. */
export async function runTool(agent: Agent, name: string, rawInput: unknown): Promise<unknown> {
  const tool = toolByName.get(name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  const parsed = z.object(tool.shape).safeParse(rawInput ?? {});
  if (!parsed.success) throw new Error(`Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  if (!agent.workspace_id) throw new Error("Agent is not bound to a workspace");
  const started = Date.now();
  const taskId = typeof (parsed.data as { task_id?: unknown }).task_id === "string" ? (parsed.data as { task_id: string }).task_id : null;
  try {
    const out = await tool.run(agent, parsed.data as Record<string, unknown>);
    ledger({ workspace_id: agent.workspace_id, agent_id: agent.id, task_id: taskId, tool: name, ok: true, duration_ms: Date.now() - started });
    return out;
  } catch (e) {
    ledger({ workspace_id: agent.workspace_id, agent_id: agent.id, task_id: taskId, tool: name, ok: false, duration_ms: Date.now() - started });
    throw e;
  }
}

function ledger(row: { workspace_id: string; agent_id: string; task_id: string | null; tool: string; ok: boolean; duration_ms: number }) {
  waitUntil(
    Promise.resolve(db.from("tool_calls").insert(row)).then(({ error }) => {
      if (error) console.error(JSON.stringify({ message: "tool call ledger failed", tool: row.tool, error: error.message }));
    }),
  );
}
