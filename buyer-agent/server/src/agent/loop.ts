import type { ChatFunctionTool, ChatMessages, ChatStreamChunk, ChatToolCall } from "@openrouter/sdk/models";
import {
  BadGatewayResponseError,
  ConnectionError,
  InternalServerResponseError,
  RequestTimeoutError,
  ServiceUnavailableResponseError,
  TooManyRequestsResponseError,
  UnauthorizedResponseError,
} from "@openrouter/sdk/models/errors";
import { registry } from "../connections/registry.ts";
import type { CallHooks, DiscoveredTool, ToolOutcome } from "../connections/types.ts";
import type { FormRequest, FormResponse, UrlPrompt } from "../forms/types.ts";
import { policy } from "../policy/gate.ts";
import { recordActivity } from "../policy/activity.ts";
import type { ApprovalDetail } from "../protocol.ts";
import { sessions, type Run } from "../session/store.ts";
import { BUILTIN_TOOLS, isBuiltin, runBuiltin } from "./builtins.ts";
import { openrouter, modelChain } from "./openrouter.ts";
import { buildSystemPrompt } from "./prompt.ts";

/** A safety net on runaway loops, not a normal stopping condition. */
const MAX_ITERATIONS = 24;
/** Output budget per model turn. */
const MAX_TOKENS = 8000;

/** One tool call the model asked for, reassembled from the stream. */
type ToolCall = { id: string; name: string; args: unknown };

export async function runTurn(run: Run, userText: string): Promise<void> {
  const conversation = sessions.conversation(run.conversationId);
  conversation.messages.push({ role: "user", content: userText });

  const discovered = [...BUILTIN_TOOLS, ...registry.tools()];
  const byName = new Map(discovered.map((t) => [t.qualifiedName, t]));
  const settings = policy.settings;
  const systemPrompt = buildSystemPrompt(discovered, settings);
  const toolParams = buildToolParams(discovered);

  run.emit({ type: "run_start", runId: run.id, conversationId: run.conversationId });
  run.emit({ type: "connections", connections: registry.statuses() });

  let stopReason = "stop";

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (run.aborted) return;

      const { text, toolCalls, finishReason } = await streamOnce(run, systemPrompt, conversation.messages, toolParams);

      if (run.aborted) return;

      // Always append the assistant turn before acting on it.
      const assistant: ChatMessages = {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length > 0
          ? {
              toolCalls: toolCalls.map(
                (call): ChatToolCall => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: jsonArgs(call.args) },
                }),
              ),
            }
          : {}),
      };
      conversation.messages.push(assistant);

      if (finishReason === "content_filter") {
        stopReason = "content_filter";
        run.emit({
          type: "error",
          message: "The model declined to continue. Try rephrasing.",
          retryable: true,
        });
        return;
      }

      if (toolCalls.length === 0) {
        stopReason = finishReason ?? "stop";
        return;
      }

      // Parallel tool calls run concurrently; each result goes back as its own tool message,
      // in call order, right after the assistant turn that requested them.
      const results = await Promise.all(
        toolCalls.map((call) => executeToolUse(run, conversation, byName, call)),
      );
      for (const result of results) conversation.messages.push(result);
    }

    stopReason = "max_iterations";
    run.emit({
      type: "error",
      message: `Stopped after ${MAX_ITERATIONS} steps without finishing. Ask me to continue if that was premature.`,
      retryable: true,
    });
  } catch (err) {
    if (run.aborted) return;
    stopReason = "error";
    run.emit({ type: "error", message: describeError(err), retryable: isRetryable(err) });
  } finally {
    run.emit({ type: "run_end", runId: run.id, stopReason });
    run.finish();
  }
}

/**
 * Reassembles one streamed completion. Tool-call fragments arrive across chunks keyed by `index`,
 * not by id — the id and name land in the first fragment, the JSON arguments after. Accumulating
 * by anything else shows up as a model that randomly fails to call tools on long arguments.
 */
async function streamOnce(
  run: Run,
  systemPrompt: string,
  history: ChatMessages[],
  tools: ChatFunctionTool[],
): Promise<{ text: string; toolCalls: ToolCall[]; finishReason: string | null }> {
  const response = await openrouter.chat.send(
    {
      chatRequest: {
        model: modelChain[0],
        models: modelChain.length > 1 ? modelChain : undefined,
        messages: [{ role: "system", content: systemPrompt }, ...history],
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: MAX_TOKENS,
        stream: true,
      },
    },
    { fetchOptions: { signal: run.signal } },
  );

  if (!isEventStream(response)) {
    throw new Error("Expected a streaming response from OpenRouter.");
  }

  let text = "";
  let finishReason: string | null = null;
  const byIndex = new Map<number, { id: string; name: string; args: string }>();

  for await (const chunk of response) {
    if (run.aborted) break;

    if (chunk.error) {
      throw new Error(`OpenRouter error ${chunk.error.code}: ${chunk.error.message}`);
    }

    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finishReason) finishReason = choice.finishReason;

    const delta = choice.delta;
    if (!delta) continue;

    if (delta.content) {
      text += delta.content;
      run.emit({ type: "text_delta", delta: delta.content });
    }

    // Summarised reasoning, on models that emit it. Streamed for the UI, never persisted —
    // OpenRouter chat-completions is stateless with respect to prior reasoning.
    if (delta.reasoning) {
      run.emit({ type: "thinking_delta", delta: delta.reasoning });
    }

    for (const fragment of delta.toolCalls ?? []) {
      const existing = byIndex.get(fragment.index) ?? { id: "", name: "", args: "" };
      byIndex.set(fragment.index, {
        id: fragment.id ?? existing.id,
        name: fragment.function?.name ?? existing.name,
        args: existing.args + (fragment.function?.arguments ?? ""),
      });
    }
  }

  const toolCalls: ToolCall[] = [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => call)
    .filter((call) => call.name !== "")
    .map((call) => ({ id: call.id, name: call.name, args: parseArgs(call.args) }));

  return { text, toolCalls, finishReason };
}

function isEventStream(value: unknown): value is AsyncIterable<ChatStreamChunk> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

/** Malformed JSON on a truncated stream is common. Hand the model back an empty object and let
 *  the per-tool schema validation produce a readable failure it can recover from. */
function parseArgs(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}

function jsonArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return "{}";
  }
}

async function executeToolUse(
  run: Run,
  conversation: { spent: number },
  byName: Map<string, DiscoveredTool>,
  call: ToolCall,
): Promise<ChatMessages> {
  const tool = byName.get(call.name);

  if (!tool) {
    return toolResult(call.id, `No tool named "${call.name}" is available.`, true);
  }

  const args = call.args ?? {};

  const verdict = policy.evaluate(tool, args, conversation.spent);

  run.emit({
    type: "tool_call_start",
    callId: call.id,
    toolName: tool.name,
    connectionLabel: tool.connectionLabel,
    toolClass: verdict.toolClass,
    args,
  });

  const base = {
    at: new Date().toISOString(),
    conversationId: run.conversationId,
    runId: run.id,
    connectionId: tool.connectionId,
    connectionLabel: tool.connectionLabel,
    tool: tool.name,
    toolClass: verdict.toolClass,
    amount: verdict.amount,
  };

  if (verdict.decision === "block") {
    const explanation = describeBlock(verdict);
    await recordActivity({ ...base, reason: verdict.reason, decision: "blocked", detail: explanation });
    run.emit({ type: "tool_call_end", callId: call.id, ok: false, summary: explanation, blocked: true });
    // Returned as a normal error result, not thrown: the model needs to read this and tell the
    // user why it stopped, rather than stalling on an exception it cannot see.
    return toolResult(call.id, explanation, true);
  }

  if (verdict.decision === "ask") {
    const approvalId = crypto.randomUUID();
    const detail: ApprovalDetail = {
      toolName: tool.name,
      connectionLabel: tool.connectionLabel,
      description: tool.description.split("\n")[0] ?? tool.name,
      toolClass: verdict.toolClass,
      args,
      detectedAmount: verdict.amount,
    };
    run.emit({ type: "approval_request", approvalId, callId: call.id, detail });

    const answer = await run.waitFor<{ decision?: string; remember?: boolean }>(approvalId);

    if (answer?.decision !== "approve") {
      const note = "The user declined this action, so it was not performed.";
      await recordActivity({ ...base, reason: "user:rejected", decision: "blocked", detail: note });
      run.emit({ type: "tool_call_end", callId: call.id, ok: false, summary: note, blocked: true });
      return toolResult(call.id, note, true);
    }

    if (answer.remember) {
      await policy.setOverride(tool.qualifiedName, { mode: "auto" });
    }
  }

  if (verdict.amount !== null) conversation.spent += verdict.amount;

  const hooks = makeHooks(run, call.id);
  const outcome = await invoke(tool, args, hooks);

  await recordActivity({
    ...base,
    reason: verdict.decision === "ask" ? "user:approved" : verdict.reason,
    decision: "allowed",
    outcome: outcome.ok ? "success" : "failure",
    detail: outcome.ok ? undefined : outcome.text.slice(0, 300),
  });

  run.emit({
    type: "tool_call_end",
    callId: call.id,
    ok: outcome.ok,
    summary: summarise(outcome),
  });

  return toolResult(call.id, outcome.text, !outcome.ok);
}

async function invoke(tool: DiscoveredTool, args: unknown, hooks: CallHooks): Promise<ToolOutcome> {
  if (isBuiltin(tool.qualifiedName)) return runBuiltin(tool.qualifiedName, args, hooks);

  const connection = registry.connection(tool.connectionId);
  if (!connection) {
    return {
      ok: false,
      text: `The "${tool.connectionLabel}" service is no longer connected.`,
      retryable: false,
    };
  }
  return connection.callTool(tool.name, args, hooks);
}

/**
 * Both protocols' "I need input" paths, and the agent's own, land here — and all three end up as
 * the same `form_request` event to the browser.
 */
function makeHooks(run: Run, callId: string): CallHooks {
  return {
    async requestForm(request: Omit<FormRequest, "formId">): Promise<FormResponse> {
      const formId = crypto.randomUUID();
      run.emit({ type: "form_request", request: { ...request, formId } });
      const answer = await run.waitFor<FormResponse>(formId);
      return answer ?? { action: "cancel" };
    },
    async requestUrlVisit(prompt: Omit<UrlPrompt, "promptId">): Promise<FormResponse> {
      const promptId = crypto.randomUUID();
      run.emit({ type: "url_prompt", prompt: { ...prompt, promptId } });
      const answer = await run.waitFor<FormResponse>(promptId);
      return answer ?? { action: "cancel" };
    },
    onProgress(note: string) {
      run.emit({ type: "tool_call_progress", callId, note });
    },
  };
}

function buildToolParams(tools: DiscoveredTool[]): ChatFunctionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.qualifiedName,
      description: `[${tool.connectionLabel}] ${tool.description}`,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  }));
}

function toolResult(toolCallId: string, text: string, isError: boolean): ChatMessages {
  return { role: "tool", toolCallId, content: isError ? `Error: ${text}` : text };
}

function describeBlock(verdict: Extract<ReturnType<typeof policy.evaluate>, { decision: "block" }>) {
  const { currencySymbol: c } = policy.settings;
  if (verdict.capBreach) {
    const { kind, limit, wouldBe } = verdict.capBreach;
    return kind === "per_transaction"
      ? `Blocked by the user's spend cap: this call is for ${c}${wouldBe}, above the ${c}${limit} per-transaction limit. Tell the user and let them decide whether to raise the cap.`
      : `Blocked by the user's session cap: this would bring the conversation total to ${c}${wouldBe}, above the ${c}${limit} limit. Tell the user rather than trying a smaller amount.`;
  }
  return "The user's policy denies this tool. It was not called.";
}

function summarise(outcome: ToolOutcome): string {
  const text = outcome.text.replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text || "(no output)";
}

function describeError(err: unknown): string {
  if (err instanceof TooManyRequestsResponseError) {
    return "Rate limited by the model API. Try again shortly.";
  }
  if (err instanceof UnauthorizedResponseError) {
    return "The OpenRouter API key was rejected. Check OPENROUTER_API_KEY.";
  }
  if (err instanceof ConnectionError || err instanceof RequestTimeoutError) {
    return "Could not reach the model API.";
  }
  if (
    err instanceof InternalServerResponseError ||
    err instanceof BadGatewayResponseError ||
    err instanceof ServiceUnavailableResponseError
  ) {
    return "The model API is having trouble. Try again shortly.";
  }
  return err instanceof Error ? err.message : String(err);
}

function isRetryable(err: unknown): boolean {
  return (
    err instanceof TooManyRequestsResponseError ||
    err instanceof ConnectionError ||
    err instanceof RequestTimeoutError ||
    err instanceof InternalServerResponseError ||
    err instanceof BadGatewayResponseError ||
    err instanceof ServiceUnavailableResponseError
  );
}
