/**
 * The real transport. POSTs to the backend's `/api/chat` and parses its
 * `text/event-stream` body into the same `ServerEvent` union the mock used to
 * produce synthetically — see `transport.ts` for the seam this fills.
 */

import { BASE_URL } from "@/lib/api/client";
import type { ChatRequest, ServerEvent } from "@/lib/chat/protocol";
import type { ChatTransport } from "@/lib/chat/transport";

export function createSseTransport(): ChatTransport {
  return {
    async *send(req: ChatRequest, signal: AbortSignal): AsyncIterable<ServerEvent> {
      if (!BASE_URL) {
        yield {
          type: "error",
          code: "server",
          message: "NEXT_PUBLIC_API_BASE_URL is not set — add it to web/.env.local",
          retryable: false,
        };
        return;
      }

      let res: Response;
      try {
        res = await fetch(`${BASE_URL}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${req.token}`,
          },
          body: JSON.stringify(req),
          signal,
        });
      } catch (err) {
        if (isAbort(err)) return;
        yield {
          type: "error",
          code: "network",
          message: "Couldn't reach the assistant. Try again?",
          retryable: true,
        };
        return;
      }

      if (!res.ok) {
        yield await errorEventFromResponse(res);
        return;
      }
      if (!res.body) {
        yield {
          type: "error",
          code: "server",
          message: "The assistant sent an empty response.",
          retryable: true,
        };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          // The last element may be a partial line split across chunks — hold
          // it back until more data arrives (or the stream ends).
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const event = parseSseLine(line);
            if (event) yield event;
          }
        }
        // Flush a trailing unterminated line, if the stream ended without a
        // final newline.
        const event = parseSseLine(buffer);
        if (event) yield event;
      } catch (err) {
        if (isAbort(err)) return;
        yield {
          type: "error",
          code: "network",
          message: "Connection dropped. Try again?",
          retryable: true,
        };
      }
    },
  };
}

function parseSseLine(line: string): ServerEvent | null {
  // Ignore blank lines (SSE message separators) and `:`-prefixed comments
  // (keep-alives) — the backend emits neither today, but a proxy in front of
  // it might.
  if (!line.startsWith("data:")) return null;
  const payload = line.slice("data:".length).trimStart();
  if (!payload) return null;
  try {
    return JSON.parse(payload) as ServerEvent;
  } catch {
    // A malformed frame shouldn't take down the whole stream.
    return null;
  }
}

async function errorEventFromResponse(res: Response): Promise<ServerEvent> {
  let message = "The assistant hit a problem. Try again?";
  try {
    const body = (await res.json()) as { error?: string; code?: string };
    if (body?.error) message = body.error;
  } catch {
    // Non-JSON error body — keep the generic message.
  }

  if (res.status === 401 || res.status === 403) {
    return { type: "error", code: "unauthorized", message, retryable: false };
  }
  return { type: "error", code: "server", message, retryable: true };
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
