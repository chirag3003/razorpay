import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.ts";
import { registry } from "../connections/registry.ts";
import type { CallHooks, DiscoveredTool, ToolOutcome } from "../connections/types.ts";
import type { FormRequest, FormResponse, UrlPrompt } from "../forms/types.ts";
import { policy } from "../policy/gate.ts";
import { recordActivity } from "../policy/activity.ts";
import type { ApprovalDetail } from "../protocol.ts";
import { sessions, type Run } from "../session/store.ts";
import { BUILTIN_TOOLS, isBuiltin, runBuiltin } from "./builtins.ts";
import { buildSystemPrompt } from "./prompt.ts";

const MODEL = "claude-opus-5";
/** A safety net on runaway loops, not a normal stopping condition. */
const MAX_ITERATIONS = 24;
/** Beyond this the tool schemas cost more context than they earn; switch to server-side search. */
const TOOL_SEARCH_THRESHOLD = 40;

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export async function runTurn(run: Run, userText: string): Promise<void> {
  const conversation = sessions.conversation(run.conversationId);
  conversation.messages.push({ role: "user", content: userText });

  const discovered = [...BUILTIN_TOOLS, ...registry.tools()];
  const byName = new Map(discovered.map((t) => [t.qualifiedName, t]));
  const settings = policy.settings;

  run.emit({ type: "run_start", runId: run.id, conversationId: run.conversationId });
  run.emit({ type: "connections", connections: registry.statuses() });

  const useToolSearch = discovered.length > TOOL_SEARCH_THRESHOLD;
  const tools = buildToolParams(discovered, useToolSearch);

  let stopReason = "end_turn";

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (run.aborted) return;

      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        // Summarised rather than omitted so the UI can show reasoning instead of a silent pause.
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "high" },
        // A safety refusal routes to a fallback model instead of dead-ending the user's turn.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [
          {
            type: "text",
            text: buildSystemPrompt(discovered, settings),
            // Tools render before system, which renders before messages. One breakpoint here
            // caches the stable prefix; everything volatile lives in messages after it.
            cache_control: { type: "ephemeral" },
          },
        ],
        tools,
        messages: conversation.messages,
      });

      stream.on("text", (delta) => run.emit({ type: "text_delta", delta }));
      stream.on("thinking", (delta) => run.emit({ type: "thinking_delta", delta }));

      const message = await stream.finalMessage();
      stopReason = message.stop_reason ?? "end_turn";

      // Always append the assistant turn before acting on it — thinking blocks have to be echoed
      // back unchanged for the next request on the same model to accept them.
      conversation.messages.push({ role: "assistant", content: message.content });

      if (message.stop_reason === "refusal") {
        const category = message.stop_details?.type === "refusal" ? message.stop_details.category : null;
        run.emit({
          type: "error",
          message: `The model declined to continue${category ? ` (${category})` : ""}. Try rephrasing.`,
          retryable: true,
        });
        return;
      }

      // A server-side tool hit its iteration limit mid-turn; re-send to let it continue.
      if (message.stop_reason === "pause_turn") continue;

      const toolUses = message.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
      );

      if (toolUses.length === 0) return;

      // Parallel tool calls run concurrently, and every result goes back in ONE user message.
      // Splitting them across messages trains the model out of parallelising.
      const results = await Promise.all(
        toolUses.map((use) => executeToolUse(run, conversation, byName, use)),
      );

      conversation.messages.push({ role: "user", content: results });
    }

    stopReason = "max_iterations";
    run.emit({
      type: "error",
      message: `Stopped after ${MAX_ITERATIONS} steps without finishing. Ask me to continue if that was premature.`,
      retryable: true,
    });
  } catch (err) {
    stopReason = "error";
    run.emit({ type: "error", message: describeError(err), retryable: isRetryable(err) });
  } finally {
    run.emit({ type: "run_end", runId: run.id, stopReason });
    run.finish();
  }
}

async function executeToolUse(
  run: Run,
  conversation: { spent: number },
  byName: Map<string, DiscoveredTool>,
  use: Anthropic.Beta.BetaToolUseBlock,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const tool = byName.get(use.name);

  if (!tool) {
    return toolResult(use.id, `No tool named "${use.name}" is available.`, true);
  }

  // Tool inputs arrive already parsed by the SDK, but they are `unknown` by contract — never
  // string-match the serialised form, escaping differs between models.
  const args = use.input ?? {};

  const verdict = policy.evaluate(tool, args, conversation.spent);

  run.emit({
    type: "tool_call_start",
    callId: use.id,
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
    run.emit({ type: "tool_call_end", callId: use.id, ok: false, summary: explanation, blocked: true });
    // Returned as a normal error result, not thrown: the model needs to read this and tell the
    // user why it stopped, rather than stalling on an exception it cannot see.
    return toolResult(use.id, explanation, true);
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
    run.emit({ type: "approval_request", approvalId, callId: use.id, detail });

    const answer = await run.waitFor<{ decision?: string; remember?: boolean }>(approvalId);

    if (answer?.decision !== "approve") {
      const note = "The user declined this action, so it was not performed.";
      await recordActivity({ ...base, reason: "user:rejected", decision: "blocked", detail: note });
      run.emit({ type: "tool_call_end", callId: use.id, ok: false, summary: note, blocked: true });
      return toolResult(use.id, note, true);
    }

    if (answer.remember) {
      await policy.setOverride(tool.qualifiedName, { mode: "auto" });
    }
  }

  if (verdict.amount !== null) conversation.spent += verdict.amount;

  const hooks = makeHooks(run, use.id);
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
    callId: use.id,
    ok: outcome.ok,
    summary: summarise(outcome),
  });

  return toolResult(use.id, outcome.text, !outcome.ok);
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

function buildToolParams(tools: DiscoveredTool[], useToolSearch: boolean) {
  const params: Anthropic.Beta.BetaToolUnion[] = tools.map((tool, index) => ({
    name: tool.qualifiedName,
    description: `[${tool.connectionLabel}] ${tool.description}`,
    input_schema: tool.inputSchema as Anthropic.Beta.BetaTool["input_schema"],
    // With search on, defer everything except the first few so the model still has a foothold —
    // the API rejects a request where every tool is deferred.
    ...(useToolSearch && index >= BUILTIN_TOOLS.length ? { defer_loading: true } : {}),
  }));

  if (useToolSearch) {
    params.push({ type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" });
  }
  return params;
}

function toolResult(
  toolUseId: string,
  text: string,
  isError: boolean,
): Anthropic.Beta.BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: toolUseId, content: text, is_error: isError };
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
  if (err instanceof Anthropic.RateLimitError) {
    return "Rate limited by the model API. Try again shortly.";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  }
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the model API.";
  if (err instanceof Anthropic.APIError) return `Model API error ${err.status ?? ""}: ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.APIConnectionError) {
    return true;
  }
  return err instanceof Anthropic.APIError && typeof err.status === "number" && err.status >= 500;
}
