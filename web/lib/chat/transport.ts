/**
 * The seam. Everything above this line (store, components) is written against
 * `ChatTransport` and never learns whether the events came from a scripted mock
 * or a real streaming backend.
 *
 * Swapping in the real agent is: implement `createSseTransport()` to parse
 * `text/event-stream` into the same `ServerEvent` union, and flip the env var.
 * No component or store change.
 */

import type { ChatRequest, ServerEvent } from "@/lib/chat/protocol";
import { createMockTransport } from "@/lib/chat/mock-transport";

export interface ChatTransport {
  send(req: ChatRequest, signal: AbortSignal): AsyncIterable<ServerEvent>;
}

let cached: ChatTransport | null = null;

export function getChatTransport(): ChatTransport {
  if (!cached) {
    // Only the mock exists today; the branch is here so the swap is obvious.
    cached = createMockTransport();
  }
  return cached;
}
