import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamChat } from "../lib/api.ts";
import type { ConnectionStatus, ServerEvent } from "../lib/protocol.ts";
import type { ChatState, TranscriptItem } from "./types.ts";

const CONVERSATION_KEY = "buyer-agent.conversationId";

function conversationId(): string {
  let id = sessionStorage.getItem(CONVERSATION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(CONVERSATION_KEY, id);
  }
  return id;
}

const uid = () => crypto.randomUUID();

export function useChat(onConnections: (c: ConnectionStatus[]) => void) {
  const [state, setState] = useState<ChatState>({
    items: [],
    runId: null,
    busy: false,
    awaitingUser: false,
  });
  const abortRef = useRef<AbortController | null>(null);
  const convo = useRef(conversationId());

  // Keep the callback current without making it a dependency of the event reducer.
  const connectionsRef = useRef(onConnections);
  useEffect(() => {
    connectionsRef.current = onConnections;
  }, [onConnections]);

  const apply = useCallback((event: ServerEvent) => {
    setState((prev) => reduce(prev, event, connectionsRef.current));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => ({
        ...prev,
        busy: true,
        awaitingUser: false,
        items: [...prev.items, { kind: "user", id: uid(), text: trimmed }],
      }));

      try {
        for await (const event of streamChat(
          { conversationId: convo.current, text: trimmed },
          controller.signal,
        )) {
          apply(event);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        apply({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        });
      } finally {
        // Close any still-streaming block: the connection ended, so nothing more is coming.
        setState((prev) => ({
          ...prev,
          busy: false,
          awaitingUser: false,
          items: prev.items.map((i) =>
            (i.kind === "assistant" || i.kind === "thinking") && i.streaming
              ? { ...i, streaming: false }
              : i,
          ),
        }));
      }
    },
    [apply],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, busy: false, awaitingUser: false }));
  }, []);

  /** Answer whatever the run is parked on. */
  const resolve = useCallback(async (payload: Record<string, unknown>, mark: (s: ChatState) => ChatState) => {
    setState((prev) => ({ ...mark(prev), awaitingUser: false }));
    const runId = stateRef.current.runId;
    if (!runId) return;
    await api.resolve(runId, payload).catch(() => {});
  }, []);

  // A ref mirror so `resolve` can read runId without re-creating on every state change.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const reset = useCallback(async () => {
    abortRef.current?.abort();
    await api.resetConversation(convo.current).catch(() => {});
    sessionStorage.removeItem(CONVERSATION_KEY);
    convo.current = conversationId();
    setState({ items: [], runId: null, busy: false, awaitingUser: false });
  }, []);

  return { state, send, stop, reset, resolve };
}

function reduce(
  state: ChatState,
  event: ServerEvent,
  onConnections: (c: ConnectionStatus[]) => void,
): ChatState {
  switch (event.type) {
    case "run_id":
      return { ...state, runId: event.runId };

    case "run_start":
      return { ...state, runId: event.runId };

    case "connections":
      onConnections(event.connections);
      return state;

    case "text_delta":
      return appendStream(state, "assistant", event.delta);

    case "thinking_delta":
      return appendStream(state, "thinking", event.delta);

    case "tool_call_start":
      return {
        ...state,
        items: [
          ...seal(state.items),
          {
            kind: "tool",
            id: uid(),
            callId: event.callId,
            toolName: event.toolName,
            connectionLabel: event.connectionLabel,
            toolClass: event.toolClass,
            args: event.args,
            status: "running",
            progress: [],
          },
        ],
      };

    case "tool_call_progress":
      return {
        ...state,
        items: state.items.map((i) =>
          i.kind === "tool" && i.callId === event.callId
            ? { ...i, progress: [...i.progress, event.note] }
            : i,
        ),
      };

    case "tool_call_end":
      return {
        ...state,
        items: state.items.map((i) =>
          i.kind === "tool" && i.callId === event.callId
            ? {
                ...i,
                status: event.blocked ? "blocked" : event.ok ? "ok" : "failed",
                summary: event.summary,
              }
            : i,
        ),
      };

    case "approval_request":
      return {
        ...state,
        awaitingUser: true,
        items: [
          ...seal(state.items),
          {
            kind: "approval",
            id: uid(),
            approvalId: event.approvalId,
            detail: event.detail,
            status: "pending",
          },
        ],
      };

    case "form_request":
      return {
        ...state,
        awaitingUser: true,
        items: [
          ...seal(state.items),
          { kind: "form", id: uid(), request: event.request, status: "pending" },
        ],
      };

    case "url_prompt":
      return {
        ...state,
        awaitingUser: true,
        items: [
          ...seal(state.items),
          { kind: "url_prompt", id: uid(), prompt: event.prompt, status: "pending" },
        ],
      };

    case "error":
      return {
        ...state,
        items: [
          ...seal(state.items),
          { kind: "error", id: uid(), message: event.message, retryable: event.retryable },
        ],
      };

    case "run_end":
      return { ...state, busy: false, awaitingUser: false, items: seal(state.items) };
  }
}

/**
 * Append to the trailing streaming block of the given kind, or start a new one.
 *
 * The "trailing" part matters: once a tool call lands after some prose, the next prose belongs in a
 * new bubble rather than being glued onto text the user already read past.
 */
function appendStream(state: ChatState, kind: "assistant" | "thinking", delta: string): ChatState {
  const last = state.items[state.items.length - 1];
  if (last && last.kind === kind && last.streaming) {
    const items = state.items.slice(0, -1);
    items.push({ ...last, text: last.text + delta });
    return { ...state, items };
  }
  return {
    ...state,
    items: [
      ...seal(state.items),
      { kind, id: uid(), text: delta, streaming: true } as TranscriptItem,
    ],
  };
}

/** Freeze any open streaming block so a later append starts fresh. */
function seal(items: TranscriptItem[]): TranscriptItem[] {
  return items.map((i) =>
    (i.kind === "assistant" || i.kind === "thinking") && i.streaming ? { ...i, streaming: false } : i,
  );
}
