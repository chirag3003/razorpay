/**
 * The seam. Everything above this line (store, components) is written against
 * `ChatTransport` and never learns how the events were actually produced —
 * that used to be a scripted mock, now it's `createSseTransport()` parsing
 * the real backend's `text/event-stream` response.
 */

import type { ChatRequest, ServerEvent } from "@/lib/chat/protocol";
import { createSseTransport } from "@/lib/chat/sse-transport";

export interface ChatTransport {
  send(req: ChatRequest, signal: AbortSignal): AsyncIterable<ServerEvent>;
}

let cached: ChatTransport | null = null;

export function getChatTransport(): ChatTransport {
  if (!cached) cached = createSseTransport();
  return cached;
}
