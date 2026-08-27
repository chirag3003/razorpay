/**
 * Wraps the scripted rules with realistic pacing and the message envelope.
 *
 * Pacing lives here rather than in the script so the script stays readable and
 * so the real SSE transport (which gets its timing from the network) can drop
 * in without the script changing.
 */

import type { ChatRequest, ServerEvent } from "@/lib/chat/protocol";
import { selectRule } from "@/lib/chat/mock-script";
import type { ChatTransport } from "@/lib/chat/transport";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** How long to wait *before* emitting each event kind. */
function delayFor(event: ServerEvent): number {
  switch (event.type) {
    case "text_delta":
      return randomBetween(25, 45);
    case "part_start":
      // Text parts open immediately; a widget lands after a beat of "work".
      return event.part.type === "text" ? 0 : 400;
    case "part_update":
      // Reserve Pay approval polling — deliberately slow enough to read.
      return 1_400;
    default:
      return 0;
  }
}

export function createMockTransport(): ChatTransport {
  return {
    async *send(req: ChatRequest, signal: AbortSignal): AsyncIterable<ServerEvent> {
      const messageId = crypto.randomUUID();

      await sleep(randomBetween(250, 600));
      if (signal.aborted) return;

      yield { type: "message_start", messageId };

      const rule = selectRule(req.turn, req.clientState);

      try {
        for await (const event of rule.run(req.turn, req.clientState)) {
          if (signal.aborted) return;
          const wait = delayFor(event);
          if (wait > 0) await sleep(wait);
          if (signal.aborted) return;
          yield event;
        }
      } catch {
        yield {
          type: "error",
          code: "server",
          message: "The assistant hit a problem. Try again?",
          retryable: true,
        };
        return;
      }

      if (signal.aborted) return;
      yield { type: "message_end", messageId };
    },
  };
}
