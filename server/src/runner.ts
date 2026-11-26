/**
 * Headless runner: for agents in headless mode, the hub itself calls the
 * provider API, hands the model the hub tools, and lets it work one task.
 * This is what makes unattended loops reliable.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { db } from "./db.js";
import { env } from "./env.js";
import { listMyTasks, logActivity, releaseTask } from "./hub.js";
import { jsonSchemaFor, runTool, tools } from "./tools.js";
import { AGENT_COLUMNS, type Agent } from "./types.js";

const MAX_TURNS = 30;

function systemPrompt(agent: Agent): string {
  return [
    agent.system_prompt ?? `You are ${agent.name}, an agent connected to a shared task hub.`,
    "",
    "You are working one task from the hub. Rules:",
    "- Read every input artifact before producing anything.",
    "- Save outputs with put_artifact and pass task_id so they attach to the task.",
    "- Record durable, sourced findings with record_fact.",
    "- Finish by calling complete_task with a clear handoff note. If you cannot do the task, call complete_task with outcome failed and explain why.",
    "- Do not ask questions; there is no human in this conversation. Put open questions in the handoff note.",
  ].join("\n");
}

function taskPrompt(claim: unknown): string {
  return `Here is the task you have claimed, with its input artifacts:\n\n${JSON.stringify(claim, null, 2)}\n\nBegin.`;
}

async function toolResult(agent: Agent, name: string, input: unknown): Promise<{ ok: boolean; text: string }> {
  try {
    return { ok: true, text: JSON.stringify(await runTool(agent, name, input)) };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}

// ---- Anthropic ---------------------------------------------------------------

async function runAnthropic(agent: Agent, claim: unknown): Promise<{ completed: boolean; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const toolDefs: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: jsonSchemaFor(t) as Anthropic.Tool.InputSchema,
  }));
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: taskPrompt(claim) }];
  let completed = false;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages
      .stream({
        model: agent.model ?? "claude-opus-5-5",
        max_tokens: 32000,
        system: [{ type: "text", text: systemPrompt(agent), cache_control: { type: "ephemeral" } }],
        tools: toolDefs,
        messages,
      })
      .finalMessage();

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") break;
    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const r = await toolResult(agent, u.name, u.input);
      if (u.name === "complete_task" && r.ok) completed = true;
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.text, is_error: !r.ok });
    }
    messages.push({ role: "user", content: results });
    if (completed) break;
  }
  return { completed, inputTokens, outputTokens };
}

// ---- OpenAI and xAI (OpenAI-compatible) --------------------------------------

async function runOpenAICompatible(agent: Agent, claim: unknown): Promise<{ completed: boolean; inputTokens: number; outputTokens: number }> {
  const isXai = agent.provider === "xai";
  const client = new OpenAI({
    apiKey: isXai ? env.xaiApiKey : env.openaiApiKey,
    baseURL: isXai ? "https://api.x.ai/v1" : undefined,
  });
  const toolDefs: ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: jsonSchemaFor(t) },
  }));
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(agent) },
    { role: "user", content: taskPrompt(claim) },
  ];
  let completed = false;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.chat.completions.create({
      model: agent.model ?? (isXai ? "grok-4" : "gpt-5"),
      messages,
      tools: toolDefs,
    });
    inputTokens += response.usage?.prompt_tokens ?? 0;
    outputTokens += response.usage?.completion_tokens ?? 0;
    const msg = response.choices[0]?.message;
    if (!msg) break;
    messages.push(msg);
    const calls = msg.tool_calls ?? [];
    if (!calls.length) break;
    for (const call of calls) {
      if (call.type !== "function") continue;
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const r = await toolResult(agent, call.function.name, args);
      if (call.function.name === "complete_task" && r.ok) completed = true;
      messages.push({ role: "tool", tool_call_id: call.id, content: r.text });
    }
    if (completed) break;
  }
  return { completed, inputTokens, outputTokens };
}

// ---- Orchestration -----------------------------------------------------------

function providerConfigured(agent: Agent): boolean {
  if (agent.provider === "anthropic") return !!env.anthropicApiKey;
  if (agent.provider === "openai") return !!env.openaiApiKey;
  if (agent.provider === "xai") return !!env.xaiApiKey;
  return false;
}

/** Works at most one task per headless agent per tick. */
export async function runHeadlessAgents() {
  const { data } = await db.from("agents").select(AGENT_COLUMNS).eq("mode", "headless").eq("is_active", true);
  for (const agent of (data ?? []) as Agent[]) {
    if (!providerConfigured(agent)) continue;
    const queued = (await listMyTasks(agent, { include_claimed: false })).filter((t) => t.status === "queued");
    const next = queued[0];
    if (!next) continue;

    let claim: unknown;
    try {
      claim = await runTool(agent, "claim_task", { task_id: next.id, lease_minutes: 60 });
    } catch {
      continue;
    }
    console.log(JSON.stringify({ message: "headless run started", agent: agent.slug, title: next.title }));
    const started = Date.now();
    try {
      const result = agent.provider === "anthropic" ? await runAnthropic(agent, claim) : await runOpenAICompatible(agent, claim);
      await db.from("tool_calls").insert({
        workspace_id: agent.workspace_id,
        agent_id: agent.id,
        task_id: next.id,
        tool: "headless_run",
        ok: result.completed,
        duration_ms: Date.now() - started,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
      });
      if (!result.completed) {
        await releaseTask(agent, { task_id: next.id, reason: "Headless run ended without complete_task" }).catch(() => {});
        await logActivity(agent.workspace_id, agent.id, next.id, "runner_incomplete", {});
      }
    } catch (e) {
      console.error(JSON.stringify({ message: "headless run failed", agent: agent.slug, error: (e as Error).message }));
      await releaseTask(agent, { task_id: next.id, reason: `Runner error: ${(e as Error).message}` }).catch(() => {});
    }
  }
}
