import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { chatRequestSchema } from "../schemas/chat.schema";
import * as chatService from "../services/chatService";
import { DomainError } from "../errors";
import { logger } from "../logger";
import { requireAuth } from "../middleware/auth";
import { CHAT_PROTOCOL_VERSION } from "../chat/protocol";
import type { ServerEvent } from "../chat/protocol";
import type { AppEnv } from "../types";

/**
 * Thin, like every other route: validate, call one service, stream what it yields. Orchestration
 * lives in chatService.
 *
 * `text/event-stream`, one JSON `ServerEvent` per frame — the union web/lib/chat/protocol.ts
 * already defines, which keeps the frontend swap to one file.
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

  // Fail outside the stream, where a normal error response still reaches a client that would
  // otherwise receive parts it cannot render.
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
      // A closed panel stops being served promptly: the loop checks this signal between stream
      // chunks. It is NOT handed to the OpenRouter SDK — that SDK never settles its promise when
      // its abort signal fires, so passing it turns every abandoned request into a wedged turn.
      // See withTimeout in llm/agentLoop.ts.
      for await (const event of chatService.runChatTurn({
        userId,
        request,
        signal: c.req.raw.signal,
      })) {
        await send(event);
      }
    } catch (err) {
      if (c.req.raw.signal.aborted) return;

      // Headers are already sent, so an exception cannot become a 4xx/5xx. As an error frame the
      // stream stays well-formed and the panel renders a retryable failure instead of hanging.
      logger.error("chat", "turn failed", err);
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
