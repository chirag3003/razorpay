import type { ChatMessages, ChatStreamChunk, ChatFunctionTool } from "@openrouter/sdk/models";
import { openrouter, modelChain } from "../clients/openrouter";
import { runTool } from "../agent-interfaces/tools/registry";
import type { ToolContext, ToolResult } from "../agent-interfaces/tools/types";
import { logger } from "../logger";
import { LLM_ROUND_TIMEOUT_MS } from "../constants";

/**
 * The model/tool loop, no framework. Owns three things: talking to OpenRouter, reassembling a
 * streamed response, running the tools the model asked for.
 *
 * It does not know what a widget is, does not touch the database, and does not decide which tools
 * exist — the caller passes those in. That is what lets chatService enforce the `place_order`
 * gate: the loop can only call a tool handed to it.
 */

/** Enough rounds for search → add → status → prepare, with slack. Prevents a runaway tool loop. */
const MAX_ROUNDS = 8;

export type LoopEvent =
  /** The model started speaking. */
  | { type: "text_start" }
  | { type: "text_delta"; delta: string }
  /** The model stopped speaking, with the full text for persistence. */
  | { type: "text_end"; text: string }
  /** A tool ran. `result` is always a ToolResult — runTool never throws. */
  | { type: "tool_result"; name: string; input: unknown; result: ToolResult }
  /** Append to the conversation transcript, in order. Emitted as each message is finalised. */
  | { type: "message"; message: ChatMessages }
  /** The turn could not continue. Terminal. */
  | { type: "failed"; message: string; retryable: boolean };

type PendingToolCall = { id: string; name: string; args: string };

function isEventStream(
  value: unknown
): value is AsyncIterable<ChatStreamChunk> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

/**
 * Rejects if `promise` has not settled within LLM_ROUND_TIMEOUT_MS.
 *
 * A plain AbortSignal cannot do this job: `@openrouter/sdk` does not reject when the signal it
 * was given fires — the promise never settles at all (verified against the live SDK). So the
 * timeout has to live on our side of the call, and the abandoned request is left running rather
 * than cancelled. Leaking a background fetch is strictly better than the alternative, which is a
 * chat turn that hangs forever: the SSE stream stays open, the client sees `message_start` and
 * nothing more, and nothing is logged, because the round log only runs once the stream completes.
 *
 * Observed for real: a malformed message array (an orphaned `tool` message, which is what
 * unordered history used to produce) made the provider accept the request and never answer.
 */
function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${LLM_ROUND_TIMEOUT_MS}ms`)),
      LLM_ROUND_TIMEOUT_MS
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** Token counts for one round. Null when the provider omits usage from the stream. */
type RoundUsage = { prompt: number; completion: number; total: number };

type RoundResult = {
  text: string;
  toolCalls: PendingToolCall[];
  /** The model that actually answered, which is not necessarily modelChain[0]. */
  model: string | null;
  usage: RoundUsage | null;
  ms: number;
};

/**
 * Reassembles one streamed completion. Tool-call fragments arrive across chunks keyed by `index`,
 * not by id — the id and name land in the first fragment, the JSON arguments after. Accumulating
 * by anything else shows up as a model that randomly fails to call tools on long arguments.
 */
async function* streamOnce(
  messages: ChatMessages[],
  tools: ChatFunctionTool[],
  signal: AbortSignal | undefined
): AsyncGenerator<LoopEvent, RoundResult> {
  const startedAt = Date.now();
  const response = await withTimeout(
    openrouter.chat.send(
    {
      chatRequest: {
        model: modelChain[0],
        // OpenRouter fails over server-side through this list — a dead primary costs no extra
        // round trip.
        models: modelChain.length > 1 ? modelChain : undefined,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        // Sequential calls keep the audit trail and cart mutations deterministically ordered.
        parallelToolCalls: false,
        // 0, not 0.3. Sampling noise has no upside in a UUID, a slot id or a category slug, and
        // tool arguments are where accuracy actually matters; the prose-quality argument is weak
        // because the system prompt already constrains output to one or two short sentences.
        // searchQueryBuilder.ts already uses 0 for exactly this reason.
        temperature: 0,
        maxTokens: 1_500,
        stream: true,
      },
    },
    // No `signal` here, deliberately — see withTimeout. @openrouter/sdk does not reject when its
    // abort signal fires; the promise simply never settles. Handing it one turns every abandoned
    // chat request into a permanently wedged turn. The loop below still checks `signal.aborted`
    // between chunks, so a closed panel stops being served promptly; the underlying fetch is
    // left to finish on its own rather than cancelled.
      {}
    ),
    "OpenRouter request"
  );

  if (!isEventStream(response)) {
    throw new Error("Expected a streaming response from OpenRouter");
  }

  let text = "";
  let textOpen = false;
  let model: string | null = null;
  // Arrives on the final chunk of a stream. The only per-turn cost signal available, and it was
  // read nowhere — so there was no record of what a conversation cost or how long it took.
  let usage: RoundUsage | null = null;
  const byIndex = new Map<number, PendingToolCall>();

  // Manual iteration so every chunk is individually time-bounded — a stream that opens and then
  // stalls is the same failure as one that never opens.
  const iterator = (response as AsyncIterable<any>)[Symbol.asyncIterator]();

  while (true) {
    const next = await withTimeout(iterator.next(), "OpenRouter stream chunk");
    if (next.done) break;
    const chunk = next.value;

    if (signal?.aborted) break;

    if (chunk.error) {
      throw new Error(`OpenRouter error ${chunk.error.code}: ${chunk.error.message}`);
    }

    // The model that actually answered, not just modelChain[0] — this is what makes a silent
    // server-side fallover to the secondary model visible instead of assumed.
    if (chunk.model) model = chunk.model;

    if (chunk.usage) {
      usage = {
        prompt: chunk.usage.promptTokens ?? 0,
        completion: chunk.usage.completionTokens ?? 0,
        total: chunk.usage.totalTokens ?? 0,
      };
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      if (!textOpen) {
        textOpen = true;
        yield { type: "text_start" };
      }
      text += delta.content;
      yield { type: "text_delta", delta: delta.content };
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

  if (textOpen) yield { type: "text_end", text };

  return {
    text,
    toolCalls: [...byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
      .filter((call) => call.name !== ""),
    model,
    usage,
    ms: Date.now() - startedAt,
  };
}

/**
 * Runs a full turn: model, tools, model again, until the model stops asking for tools. Yields as
 * it goes so the caller can stream. Never throws — the caller holds an open SSE stream, so a
 * failure becomes a terminal `failed` event rather than an exception that kills it mid-message.
 */
export async function* runAgentTurn(input: {
  ctx: ToolContext;
  messages: ChatMessages[];
  tools: ChatFunctionTool[];
  signal?: AbortSignal;
}): AsyncGenerator<LoopEvent, void> {
  const messages = [...input.messages];

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const stream = streamOnce(messages, input.tools, input.signal);

      let result: RoundResult;
      while (true) {
        const next = await stream.next();
        if (next.done) {
          result = next.value;
          break;
        }
        yield next.value;
      }

      if (input.signal?.aborted) return;

      // model + usage + latency: the only cost and performance visibility in the system. Both
      // response.model and token usage are on every response and were previously read nowhere, so
      // a degraded answer could not be attributed to a model and a turn had no cost record.
      logger.info("llm", `round ${round + 1}`, {
        model: result.model ?? modelChain[0],
        // A model in modelChain[0]'s place but not equal to it means OpenRouter's server-side
        // failover fired — the one thing a per-round log line needs to make visible.
        fallback: result.model !== null && result.model !== modelChain[0] ? true : undefined,
        toolCalls: result.toolCalls.length,
        ms: result.ms,
        promptTokens: result.usage?.prompt,
        completionTokens: result.usage?.completion,
        totalTokens: result.usage?.total,
      });

      const assistant: ChatMessages = {
        role: "assistant",
        content: result.text || null,
        ...(result.toolCalls.length > 0
          ? {
              toolCalls: result.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.args || "{}" },
              })),
            }
          : {}),
      };

      messages.push(assistant);
      yield { type: "message", message: assistant };

      // No tools requested — the model is done talking.
      if (result.toolCalls.length === 0) return;

      for (const call of result.toolCalls) {
        // Malformed JSON is common on a truncated stream. Treat it as a recoverable tool
        // failure rather than an exception that ends the turn.
        let args: unknown = {};
        let parseError: string | null = null;
        try {
          args = call.args.trim() ? JSON.parse(call.args) : {};
        } catch {
          parseError = `Arguments for ${call.name} were not valid JSON.`;
        }

        const toolResult: ToolResult = parseError
          ? {
              ok: false,
              error: {
                code: "invalid_input",
                message: parseError,
                retryable: true,
                hint: "Re-send the call with valid JSON arguments.",
              },
            }
          : await runTool(input.ctx, call.name, args);

        yield { type: "tool_result", name: call.name, input: args, result: toolResult };

        const toolMessage: ChatMessages = {
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify(toolResult),
        };
        messages.push(toolMessage);
        yield { type: "message", message: toolMessage };
      }
    }

    // Fell out of the round cap with the model still asking for tools.
    logger.warn("llm", `round cap hit (${MAX_ROUNDS}) with the model still calling tools`);
    yield {
      type: "failed",
      message: "The assistant got stuck working on that. Try rephrasing?",
      retryable: true,
    };
  } catch (err) {
    if (input.signal?.aborted) return;
    logger.error("llm", "agent loop failed", err);
    yield {
      type: "failed",
      message: "The assistant hit a problem. Try again?",
      retryable: true,
    };
  }
}
