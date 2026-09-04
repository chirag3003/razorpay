import { and, asc, count, desc, eq } from "drizzle-orm";
import { logger } from "../logger";
import type { ChatMessages } from "@openrouter/sdk/models";
import { db } from "../db";
import { chatMessages, conversations } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { runTool, toOpenAITools } from "../agent-interfaces/tools/registry";
import type { ToolContext, ToolResult } from "../agent-interfaces/tools/types";
import { runAgentTurn } from "../llm/agentLoop";
import { buildSystemPrompt } from "../llm/systemPrompt";
import { buildTurnContext } from "../llm/turnContext";
import { MAX_CONVERSATIONS_PER_USER } from "../constants";
import * as mandateService from "./mandateService";
import { isCollapsible, nextPartId, toolResultToPart } from "../chat/partMapper";
import { deriveTitle, turnToUserText } from "../chat/turnInput";
import type { MessagePart, ServerEvent, TextPart } from "../chat/protocol";
import type { ChatRequestInput, ClientTurnInput } from "../schemas/chat.schema";

/**
 * The storefront chat orchestrator. Owns one turn end to end: resolve the conversation, decide
 * which tools the model may hold, run the loop, project results into widgets, persist.
 *
 * The only module importing both /llm and the tool registry. On backend/CLAUDE.md's LLM Isolation
 * allow-list; mandateService, reservePayService and paymentService are not, and that import
 * boundary is what makes "no LLM in the transaction core" greppable.
 */

/** History fed back to the model. Older turns are still stored, just not replayed. */
const MAX_HISTORY_MESSAGES = 40;

/* -------------------------------------------------------------------------- */
/* conversation storage                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Finds or creates the conversation for this turn. The id is client-supplied — the storefront
 * mints one when the panel opens — so a first turn arriving with an unknown id is the normal
 * path, not an error, and the endpoint is idempotent across a reconnect.
 *
 * An id belonging to somebody else reads as missing rather than forbidden, matching the tool
 * registry's anti-probing choice for UNAUTHORIZED/FORBIDDEN.
 */
/**
 * Both creation paths below are client-driven — one mints an id, the other honours the id the
 * client sent — so a client can otherwise create conversations without bound. Cheap to check: the
 * conversations(user_id, updated_at) index already covers it.
 */
async function assertConversationQuota(userId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(conversations)
    .where(eq(conversations.userId, userId));

  if ((row?.total ?? 0) >= MAX_CONVERSATIONS_PER_USER) {
    throw new ConflictError(
      `This account has reached the limit of ${MAX_CONVERSATIONS_PER_USER} conversations. Continue an existing one.`
    );
  }
}

export async function resolveConversation(
  userId: string,
  conversationId?: string,
  options: { createIfMissing?: boolean } = {}
) {
  if (!conversationId) {
    await assertConversationQuota(userId);
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

  await assertConversationQuota(userId);

  const [created] = await db
    .insert(conversations)
    .values({ id: conversationId, userId })
    .onConflictDoNothing()
    .returning();

  // Lost a race with a concurrent first turn on the same id; re-read the winner.
  if (created) return created;
  return resolveConversation(userId, conversationId);
}

/**
 * Where a replayable window may begin.
 *
 * Cutting purely by row count breaks the transcript: each tool round writes an `assistant` row
 * carrying `tool_calls` plus one `tool` row per result, and a `tool` message whose matching
 * `assistant` was cut is rejected with a 400 by every OpenAI-compatible endpoint. That failure is
 * NOT transient — history only grows, so once a conversation crosses the boundary unluckily,
 * every subsequent turn in it fails identically ("The assistant hit a problem. Try again?").
 *
 * A `user` row, or an `assistant` row that called no tools, is always a safe first message.
 */
function isSafeHistoryStart(message: ChatMessages): boolean {
  if (message.role === "user") return true;
  if (message.role !== "assistant") return false;

  // The OpenRouter SDK's shape is camelCase `toolCalls`; `tool_calls` is checked too because
  // these rows are raw JSONB replayed verbatim, so a row written by another producer (or an
  // older build) could carry the wire spelling instead.
  const raw = message as { toolCalls?: unknown; tool_calls?: unknown };
  const toolCalls = raw.toolCalls ?? raw.tool_calls;
  return !Array.isArray(toolCalls) || toolCalls.length === 0;
}

async function loadHistory(conversationId: string): Promise<ChatMessages[]> {
  // Newest-first with a LIMIT, then reversed — the whole transcript was previously read on every
  // turn, each row holding a full OpenRouter message with tool results as JSONB, just to keep the
  // last MAX_HISTORY_MESSAGES. Cost grew with conversation length, unboundedly.
  //
  // Over-fetch, because the window has to be trimmed forward to a turn boundary below and the
  // trimming only ever discards rows.
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(MAX_HISTORY_MESSAGES * 2);

  // Raw OpenRouter messages, replayed verbatim — reconstructing them from rendered widgets is
  // lossy and is how a chat agent starts contradicting itself.
  const messages = rows
    .reverse()
    .slice(-MAX_HISTORY_MESSAGES)
    .map((row) => row.content as unknown as ChatMessages);

  // Walk forward to the first row that can legally start a request.
  const start = messages.findIndex(isSafeHistoryStart);
  if (start === -1) {
    // The whole window is one long tool round with no safe entry point. Sending none of it is
    // correct: the turn loses context but succeeds, where sending a fragment is a guaranteed 400.
    logger.warn("chat", "no safe history boundary in window — dropping history for this turn", {
      conversationId,
      windowSize: messages.length,
    });
    return [];
  }

  return messages.slice(start);
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
 * Writes the whole turn at once, at the end. Not incremental: an abort mid-stream persists
 * nothing, so a half-finished assistant message never becomes history to reason around.
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
 * `place_order` is never in the tool list the model sees — not "withheld unless confirmed",
 * simply never offered. A confirm turn carries no payload and the customer's one open quote is
 * exactly what `getOpenCartMandate` returns, so the action plus server state already determine
 * the whole call and there is no decision left for a model to make. A model round trip would add
 * nothing and risk a transcribed UUID on the highest-stakes call in the system.
 *
 * Every guard in `place_order`'s handler still runs — this calls the same registry entry
 * `runTool` would have. Only the decision to call it, and the source of its argument, move from
 * the model's transcript to the database.
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
        // Nothing to call: stale UI, a double tap after the quote was consumed, or an expired
        // quote never re-prepared. No audit row — no mandate checked, no money moved.
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
    // Fixed-format summary for the model's own memory in later turns — not model output, just
    // enough for a future "what happened to my order?" to read back.
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

  // Replay what was rendered before, without spending a model call.
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

  // Confirm: execute place_order directly, no model call. See handlePlaceOrderConfirm for why
  // this bypasses the loop entirely rather than unlocking the tool.
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
      logger.error("chat", "failed to persist turn", err, { conversationId: conversation.id });
    }

    yield { type: "message_end", messageId };
    return;
  }

  // place_order is never in this list — see handlePlaceOrderConfirm.
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
    // Last before the user turn, so it is the freshest thing the model reads.
    { role: "system", content: context },
    userMessage,
  ];

  const rows: PendingRow[] = [
    { role: "user", content: userMessage as unknown as Record<string, unknown> },
  ];
  const renderedParts: MessagePart[] = [];

  // Collapsible widgets are held back and flushed once at the end, so three add_to_cart calls
  // produce one summary. Everything else is emitted the moment its tool returns, which is what
  // lands a product grid while the model is still writing.
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
        // Stored complete, so a resume renders finished text rather than an empty shell.
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

  // Widgets hang off the last assistant row — that is what a resume replays.
  const lastAssistant = [...rows].reverse().find((row) => row.role === "assistant");
  if (lastAssistant) lastAssistant.parts = renderedParts;

  // The turn failed before the model said anything. A user message with no reply would leave a
  // dangling turn for the next request to reason around, so drop it.
  if (!lastAssistant) {
    yield { type: "message_end", messageId };
    return;
  }

  const title = conversation.title ? null : deriveTitle(userText);

  try {
    await persistTurn(conversation.id, rows, title);
  } catch (err) {
    // The customer has their answer and any order placed is real. Losing the transcript is a
    // bookkeeping failure, not a failed turn.
    logger.error("chat", "failed to persist turn", err, { conversationId: conversation.id });
  }

  yield { type: "message_end", messageId };
}
