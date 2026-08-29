import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { chatRequestSchema } from "../schemas/chat.schema";
import * as chatService from "../services/chatService";
import { DomainError } from "../errors";
import { requireAuth } from "../middleware/auth";
import { CHAT_PROTOCOL_VERSION } from "../chat/protocol";
import type { ServerEvent } from "../chat/protocol";
import type { AppEnv } from "../types";

/**
 * The storefront chat agent.
 *
 * Thin, like every other route: validate, call one service, stream what it yields. All the
 * orchestration lives in chatService.
 *
 * The response is `text/event-stream` carrying one JSON `ServerEvent` per frame — exactly the
 * union web/lib/chat/protocol.ts already defines, which is what makes the frontend swap a
 * one-file change (`createSseTransport()` in web/lib/chat/transport.ts).
 */
export const chatRoutes = new Hono<AppEnv>();

chatRoutes.use("*", requireAuth);

/** Rendered transcript for a conversation, for rehydrating a panel without a model call. */
chatRoutes.get("/:conversationId", async (c) => {
  const rows = await chatService.loadTranscript(
    c.get("userId"),
    c.req.param("conversationId")
  );

  return c.json({
    conversationId: c.req.param("conversationId"),
    protocolVersion: CHAT_PROTOCOL_VERSION,
    messages: rows.map((row) => ({ id: row.id, parts: row.parts ?? [] })),
  });
});

chatRoutes.post("/", zValidator("json", chatRequestSchema), async (c) => {
  const request = c.req.valid("json");
  const userId = c.get("userId");

  // A client speaking an older protocol would receive parts it cannot render. Fail loudly and
  // outside the stream, where a normal error response still reaches it.
  if (request.protocolVersion !== CHAT_PROTOCOL_VERSION) {
    return c.json(
      {
        error: `Unsupported chat protocol version ${request.protocolVersion}; this server speaks ${CHAT_PROTOCOL_VERSION}.`,
        code: "PROTOCOL_VERSION_MISMATCH",
      },
      400
    );
  }

  return streamSSE(c, async (stream) => {
    const send = (event: ServerEvent) => stream.writeSSE({ data: JSON.stringify(event) });

    try {
      // The client's abort propagates all the way to the OpenRouter request, so a closed panel
      // stops costing tokens immediately.
      for await (const event of chatService.runChatTurn({
        userId,
        request,
        signal: c.req.raw.signal,
      })) {
        await send(event);
      }
    } catch (err) {
      if (c.req.raw.signal.aborted) return;

      // Headers are already sent, so an exception cannot become a 4xx/5xx. It becomes an error
      // frame instead — the stream stays well-formed and the panel renders a failure it can
      // retry from, rather than hanging on a truncated response.
      console.error("Chat turn failed:", err);
      await send({
        type: "error",
        code: "server",
        message:
          err instanceof DomainError
            ? err.message
            : "The assistant hit a problem. Try again?",
        retryable: true,
      });
    }
  });
});
