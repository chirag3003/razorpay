import type { ActivityRow, ConnectionStatus, ServerEvent, Settings, ToolPolicy } from "./protocol.ts";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  connections: () => json<{ connections: ConnectionStatus[] }>("/api/connections"),

  addConnection: (input: {
    kind: "mcp" | "a2a";
    label?: string;
    url?: string;
    command?: string;
    args?: string[];
    token?: string;
  }) => json<{ connection: ConnectionStatus }>("/api/connections", {
    method: "POST",
    body: JSON.stringify(input),
  }),

  removeConnection: (id: string) =>
    json<{ ok: boolean }>(`/api/connections/${id}`, { method: "DELETE" }),

  reconnect: (id: string) =>
    json<{ connection: ConnectionStatus }>(`/api/connections/${id}/reconnect`, { method: "POST" }),

  tools: () => json<{ tools: ToolPolicy[] }>("/api/tools"),

  settings: () => json<{ settings: Settings }>("/api/settings"),

  updateSettings: (patch: Partial<Settings>) =>
    json<{ settings: Settings }>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  setOverride: (input: { qualifiedName: string; mode?: string; toolClass?: string }) =>
    json<{ settings: Settings }>("/api/settings/overrides", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  activity: () => json<{ activity: ActivityRow[] }>("/api/activity"),

  resolve: (runId: string, payload: unknown) =>
    json<{ ok: boolean }>(`/api/runs/${runId}/resolve`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  resetConversation: (id: string) =>
    json<{ ok: boolean }>(`/api/conversations/${id}/reset`, { method: "POST" }),
};

/**
 * Opens a turn and yields events as they arrive.
 *
 * Hand-rolled rather than EventSource because the turn is started by a POST (EventSource is
 * GET-only) and because we want the request body to carry the message.
 */
export async function* streamChat(
  body: { conversationId: string; text: string },
  signal: AbortSignal,
): AsyncGenerator<ServerEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Chat request failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by a blank line; a partial frame stays in the buffer.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (line) {
        try {
          yield JSON.parse(line.slice(5).trim()) as ServerEvent;
        } catch {
          // A malformed frame should not kill the stream.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
