import type { ChatMessages, ChatStreamChunk, ChatFunctionTool } from "@openrouter/sdk/models";
import { openrouter, modelChain } from "../clients/openrouter";
import { runTool } from "../agent-interfaces/tools/registry";
import type { ToolContext, ToolResult } from "../agent-interfaces/tools/types";

/**
 * The model ↔ tool loop. ~180 lines, no framework.
 *
 * It owns exactly three things: talking to OpenRouter, reassembling a streamed response, and
 * running the tools the model asked for. It does not know what a widget is, does not touch the
 * database, and does not decide which tools exist — the caller passes those in. That separation is
 * what lets `chatService` enforce the `place_order` gate: the loop can only ever call a tool that
 * was handed to it.
 *
 * Nothing here is Claude-specific. Swapping to GPT or Llama is `OPENROUTER_MODEL`.
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
 * Reassembles one streamed completion.
 *
 * Tool-call fragments arrive spread across chunks and keyed by `index`, not by id — the id and
 * name usually land in the first fragment and the JSON arguments dribble in after. Accumulating
 * by index is the whole trick, and getting it wrong shows up as a model that "randomly" fails to
 * call tools on long arguments.
 */
async function* streamOnce(
  messages: ChatMessages[],
  tools: ChatFunctionTool[],
  signal: AbortSignal | undefined
): AsyncGenerator<LoopEvent, { text: string; toolCalls: PendingToolCall[] }> {
  const response = await openrouter.chat.send(
    {
      chatRequest: {
        model: modelChain[0],
        // OpenRouter fails over server-side through this list, so a dead primary costs no extra
        // round trip from us. This is the entirety of our provider-resilience story.
        models: modelChain.length > 1 ? modelChain : undefined,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        // Sequential tool calls keep the audit trail and cart mutations in a deterministic order.
        parallelToolCalls: false,
        temperature: 0.3,
        maxTokens: 1_500,
        stream: true,
      },
    },
    { fetchOptions: signal ? { signal } : undefined }
  );

  if (!isEventStream(response)) {
    throw new Error("Expected a streaming response from OpenRouter");
  }

  let text = "";
  let textOpen = false;
  const byIndex = new Map<number, PendingToolCall>();

  for await (const chunk of response) {
    if (signal?.aborted) break;

    if (chunk.error) {
      throw new Error(`OpenRouter error ${chunk.error.code}: ${chunk.error.message}`);
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
  };
}

/**
 * Runs a full turn: model, tools, model again, until the model stops asking for tools.
 *
 * Yields as it goes so the caller can stream to the customer rather than waiting for the whole
 * turn. Never throws — a failure becomes a terminal `failed` event, because the caller is holding
 * an open SSE stream and an exception there would kill it mid-message.
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

      let result: { text: string; toolCalls: PendingToolCall[] };
      while (true) {
        const next = await stream.next();
        if (next.done) {
          result = next.value;
          break;
        }
        yield next.value;
      }

      if (input.signal?.aborted) return;

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
        // A model can emit malformed JSON, especially when a stream is truncated. Treat it as a
        // tool failure it can recover from rather than as an exception that ends the turn.
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
    yield {
      type: "failed",
      message: "The assistant got stuck working on that. Try rephrasing?",
      retryable: true,
    };
  } catch (err) {
    if (input.signal?.aborted) return;
    console.error("Agent loop failed:", err);
    yield {
      type: "failed",
      message: "The assistant hit a problem. Try again?",
      retryable: true,
    };
  }
}
