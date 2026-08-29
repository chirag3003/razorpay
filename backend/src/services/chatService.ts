import { and, asc, eq } from "drizzle-orm";
import type { ChatMessages } from "@openrouter/sdk/models";
import { db } from "../db";
import { chatMessages, conversations } from "../db/schema";
import { NotFoundError } from "../errors";
import { runTool, toOpenAITools } from "../agent-interfaces/tools/registry";
import type { ToolContext, ToolResult } from "../agent-interfaces/tools/types";
import { runAgentTurn } from "../llm/agentLoop";
import { buildSystemPrompt } from "../llm/systemPrompt";
import { buildTurnContext } from "../llm/turnContext";
import * as mandateService from "./mandateService";
import { isCollapsible, nextPartId, toolResultToPart } from "../chat/partMapper";
import { deriveTitle, turnToUserText } from "../chat/turnInput";
import type { MessagePart, ServerEvent, TextPart } from "../chat/protocol";
import type { ChatRequestInput, ClientTurnInput } from "../schemas/chat.schema";

/**
 * The storefront chat orchestrator — the Growth Agent.
 *
 * It owns one turn end to end: resolve the conversation, decide which tools the model is allowed
 * to hold, run the loop, project tool results into widgets, and persist the result. It is the
 * only module in the backend that imports both /llm and the tool registry.
 *
 * Per backend/CLAUDE.md's LLM Isolation rule this file is on the allow-list. mandateService,
 * reservePayService and paymentService are not, and must stay unable to reach /llm — that import
 * boundary is what makes "no LLM in the merchant transaction core" checkable with grep rather
 * than by reading code.
 */

/** History fed back to the model. Older turns are still stored, just not replayed. */
const MAX_HISTORY_MESSAGES = 40;

/* -------------------------------------------------------------------------- */
/* conversation storage                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Finds or creates the conversation for this turn.
 *
 * The id is **client-supplied** — the storefront mints one with `crypto.randomUUID()` when the
 * chat panel first opens (web/store/chat-store.ts) and keeps sending it. So the first turn of a
 * conversation arrives with an id that does not exist yet, and creating it here is the normal
 * path, not an error case. That also makes the endpoint naturally idempotent across a reconnect.
 *
 * A client-supplied id is only trusted after an ownership check: an id belonging to somebody else
 * reads as missing rather than forbidden, which is the same anti-probing choice the tool registry
 * makes for UNAUTHORIZED/FORBIDDEN.
 */
export async function resolveConversation(
  userId: string,
  conversationId?: string,
  options: { createIfMissing?: boolean } = {}
) {
  if (!conversationId) {
    const [created] = await db.insert(conversations).values({ userId }).returning();
    if (!created) throw new Error("Failed to create conversation");
    return created;
  }

  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (existing) {
    if (existing.userId !== userId) throw new NotFoundError("Conversation");
    return existing;
  }

  if (!options.createIfMissing) throw new NotFoundError("Conversation");

  const [created] = await db
    .insert(conversations)
    .values({ id: conversationId, userId })
    .onConflictDoNothing()
    .returning();

  // Lost a race with a concurrent first turn on the same id; re-read the winner.
  if (created) return created;
  return resolveConversation(userId, conversationId);
}

async function loadHistory(conversationId: string): Promise<ChatMessages[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));

  // The raw OpenRouter messages, replayed verbatim. Reconstructing them from rendered widgets
  // would be lossy and is the usual way a chat agent starts contradicting itself.
  return rows.slice(-MAX_HISTORY_MESSAGES).map((row) => row.content as unknown as ChatMessages);
}

/** The rendered transcript, for a `{kind:"resume"}` turn. */
export async function loadTranscript(userId: string, conversationId: string) {
  await resolveConversation(userId, conversationId);

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));

  return rows.filter((row) => row.parts && row.parts.length > 0);
}

type PendingRow = {
  role: string;
  content: Record<string, unknown>;
  parts?: MessagePart[];
};

/**
 * Writes the whole turn at once, at the end.
 *
 * Deliberately not incremental: if the customer aborts mid-stream we persist nothing, so a
 * half-finished assistant message never becomes history the model then has to reason about.
 */
async function persistTurn(conversationId: string, rows: PendingRow[], title: string | null) {
  if (rows.length === 0) return;

  await db.transaction(async (tx) => {
    await tx.insert(chatMessages).values(
      rows.map((row) => ({
        conversationId,
        role: row.role,
        content: row.content,
        parts: row.parts ?? null,
      }))
    );

    await tx
      .update(conversations)
      .set({ updatedAt: new Date(), ...(title ? { title } : {}) })
      .where(eq(conversations.id, conversationId));
  });
}

/* -------------------------------------------------------------------------- */
/* the hard gate: place_order is executed directly, never handed to the model */
/* -------------------------------------------------------------------------- */

/**
 * `place_order` is never in the tool list the model sees, on any turn. Not "withheld unless
 * confirmed" — simply never offered. `review.confirm` carries no payload (the frontend sends
 * `{type: "review.confirm"}` with no quoteId) and the customer's one open quote is exactly the
 * row `getOpenCartMandate` returns, so there is no decision left for a model to make: the action
 * plus server state already determine the entire tool call. Routing that through a model round
 * trip would buy nothing and risk something real — nothing forces the model to actually call the
 * tool that round, and it can only reconstruct the quoteId (a UUID) by re-reading it out of
 * earlier conversation text, a needless transcription risk on the highest-stakes call in the
 * system. So `runChatTurn` calls this directly for a confirm turn, before the model loop ever
 * starts, and `place_order` is filtered out of `toOpenAITools()` unconditionally below.
 *
 * Every guard inside `place_order`'s own handler still runs exactly as before — ownership,
 * idempotency, signature and fingerprint verification, the audit-log write — because this calls
 * the same registry entry `runTool` would have called for the model. Only the *decision* to call
 * it, and the sourcing of its argument, move from "the model, reading its own transcript" to
 * "chatService, reading the database."
 */
async function handlePlaceOrderConfirm(
  ctx: ToolContext,
  userId: string,
  turn: ClientTurnInput
): Promise<{ userMessage: ChatMessages; assistantContent: string; parts: MessagePart[] }> {
  const openQuote = await mandateService.getOpenCartMandate(userId);

  const result: ToolResult = openQuote
    ? await runTool(ctx, "place_order", { quoteId: openQuote.id })
    : {
        // No tool ran — there was nothing to call. Stale UI, a double tap after the quote was
        // already consumed, or a quote that expired without being re-prepared. No audit row: no
        // mandate was checked and no money moved, so there's nothing to log.
        ok: false,
        error: {
          code: "quote_expired",
          message: "That order review is no longer available.",
          retryable: true,
          hint: "Ask to review your order again.",
        },
      };

  const part = toolResultToPart("place_order", { quoteId: openQuote?.id }, result);
  const parts = part ? [part] : [];

  return {
    userMessage: { role: "user", content: turnToUserText(turn) },
    // A short, fixed-format summary for the model's own memory in later turns — not model
    // output, just enough that a future "what happened to my order?" has something coherent to
    // read back. place_order's success shape is {order: {orderNumber, total, ...}, ...}.
    assistantContent: result.ok
      ? summarizePlacedOrder(result.data)
      : `Could not place the order: ${result.error.message}`,
    parts,
  };
}

function summarizePlacedOrder(data: unknown): string {
  const order = (data as { order?: { orderNumber?: string; total?: number } } | undefined)?.order;
  if (!order?.orderNumber) return "Order placed.";
  return `Order ${order.orderNumber} placed, total ₹${order.total}.`;
}

/* -------------------------------------------------------------------------- */
/* the turn                                                                   */
/* -------------------------------------------------------------------------- */

export async function* runChatTurn(input: {
  userId: string;
  request: ChatRequestInput;
  signal?: AbortSignal;
}): AsyncGenerator<ServerEvent> {
  const { request } = input;
  const conversation = await resolveConversation(input.userId, request.conversationId, {
    createIfMissing: true,
  });
  const messageId = crypto.randomUUID();

  yield { type: "message_start", messageId };

  // Resume: replay what was rendered before, without spending a model call.
  if (request.turn.kind === "resume") {
    const stored = await loadTranscript(input.userId, conversation.id);
    for (const row of stored) {
      for (const part of row.parts ?? []) {
        yield { type: "part_start", part };
        yield { type: "part_end", partId: part.partId };
      }
    }
    yield { type: "message_end", messageId };
    return;
  }

  const ctx: ToolContext = {
    actor: { type: "user", id: input.userId },
    userId: input.userId,
    conversationId: conversation.id,
  };

  // Confirm: execute place_order directly, no model call. See handlePlaceOrderConfirm's doc
  // comment for why this bypasses the loop entirely rather than merely unlocking the tool.
  if (request.turn.kind === "widget_action" && request.turn.action.type === "review.confirm") {
    const { userMessage, assistantContent, parts } = await handlePlaceOrderConfirm(
      ctx,
      input.userId,
      request.turn
    );

    for (const part of parts) {
      yield { type: "part_start", part };
      yield { type: "part_end", partId: part.partId };
    }

    const rows: PendingRow[] = [
      { role: "user", content: userMessage as unknown as Record<string, unknown> },
      {
        role: "assistant",
        content: { role: "assistant", content: assistantContent } as unknown as Record<
          string,
          unknown
        >,
        parts,
      },
    ];

    try {
      await persistTurn(conversation.id, rows, null);
    } catch (err) {
      console.error(`Failed to persist chat turn for conversation ${conversation.id}:`, err);
    }

    yield { type: "message_end", messageId };
    return;
  }

  // place_order is never in this list — see the comment on handlePlaceOrderConfirm above.
  const tools = toOpenAITools((tool) => tool.name !== "place_order");

  const [history, context] = await Promise.all([
    loadHistory(conversation.id),
    buildTurnContext({
      userId: input.userId,
      route: request.clientState.route,
      recentActions: request.clientState.recentActions,
    }),
  ]);

  const userText = turnToUserText(request.turn);
  const userMessage: ChatMessages = { role: "user", content: userText };

  const messages: ChatMessages[] = [
    { role: "system", content: buildSystemPrompt() },
    ...history,
    // Immediately before the turn, so it is the freshest thing the model reads.
    { role: "system", content: context },
    userMessage,
  ];

  const rows: PendingRow[] = [
    { role: "user", content: userMessage as unknown as Record<string, unknown> },
  ];
  const renderedParts: MessagePart[] = [];

  // Collapsible widgets (today: cart_summary) are held back and flushed once at the end of the
  // turn, so three add_to_cart calls produce one summary rather than three. Everything else is
  // emitted the moment its tool returns, which is what makes a product grid land while the model
  // is still writing.
  const collapsible = new Map<string, MessagePart>();

  let openTextPartId: string | null = null;

  for await (const event of runAgentTurn({ ctx, messages, tools, signal: input.signal })) {
    if (input.signal?.aborted) return;

    switch (event.type) {
      case "text_start": {
        openTextPartId = nextPartId("text");
        const part: TextPart = { type: "text", partId: openTextPartId, text: "", done: false };
        yield { type: "part_start", part };
        break;
      }

      case "text_delta":
        if (openTextPartId) yield { type: "text_delta", partId: openTextPartId, delta: event.delta };
        break;

      case "text_end": {
        if (!openTextPartId) break;
        // Stored complete, so a resume renders the finished text instead of an empty shell.
        renderedParts.push({
          type: "text",
          partId: openTextPartId,
          text: event.text,
          done: true,
        });
        yield { type: "part_end", partId: openTextPartId };
        openTextPartId = null;
        break;
      }

      case "tool_result": {
        const part = toolResultToPart(event.name, event.input, event.result);
        if (!part) break;

        if (isCollapsible(part.type)) {
          collapsible.set(part.type, part);
          break;
        }

        renderedParts.push(part);
        yield { type: "part_start", part };
        yield { type: "part_end", partId: part.partId };
        break;
      }

      case "message":
        rows.push({
          role: event.message.role,
          content: event.message as unknown as Record<string, unknown>,
        });
        break;

      case "failed":
        yield {
          type: "error",
          code: "server",
          message: event.message,
          retryable: event.retryable,
        };
        break;
    }
  }

  for (const part of collapsible.values()) {
    renderedParts.push(part);
    yield { type: "part_start", part };
    yield { type: "part_end", partId: part.partId };
  }

  if (input.signal?.aborted) return;

  // Widgets hang off the last assistant row, which is what a resume replays.
  const lastAssistant = [...rows].reverse().find((row) => row.role === "assistant");
  if (lastAssistant) lastAssistant.parts = renderedParts;

  // The turn failed before the model said anything. Storing a user message with no reply would
  // leave a dangling turn in the history the next request has to reason around, so drop it —
  // the customer saw the error and can simply say it again.
  if (!lastAssistant) {
    yield { type: "message_end", messageId };
    return;
  }

  const title = conversation.title ? null : deriveTitle(userText);

  try {
    await persistTurn(conversation.id, rows, title);
  } catch (err) {
    // The customer already has their answer, and any order they placed is real. Losing the
    // transcript is a bookkeeping failure, not a failed turn — don't tell them it broke.
    console.error(`Failed to persist chat turn for conversation ${conversation.id}:`, err);
  }

  yield { type: "message_end", messageId };
}
