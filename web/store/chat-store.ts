"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";
import { getAddresses } from "@/lib/api/addresses";
import { getChatTranscript } from "@/lib/api/chat";
import {
  base64ToAudioBlob,
  isVoiceUnavailable,
  synthesizeSpeech,
  transcribeAudio,
} from "@/lib/api/voice";
import { useAuthStore, handleAuthApiError } from "@/store/auth-store";
import { ApiError } from "@/lib/api/client";
import { useCartStore } from "@/store/cart-store";
import { getChatTransport } from "@/lib/chat/transport";
import { buildClientState } from "@/lib/chat/client-state";
import {
  CHAT_PROTOCOL_VERSION,
  lastTransientPartId,
  WIDGET_LIFECYCLE,
  type ChatErrorCode,
  type ChatMessage,
  type ClientOp,
  type ClientTurn,
  type MessagePart,
  type ServerEvent,
  type WidgetAction,
} from "@/lib/chat/protocol";
import type { Address } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* dispatch table                                                             */
/* -------------------------------------------------------------------------- */

type ActionSpec = {
  /** Client-side side effect, awaited before anything else. */
  effect?: (action: WidgetAction) => Promise<void>;
  /** Visible user-bubble text, or null to stay silent. */
  echo?: (action: WidgetAction) => string | null;
  /** Does this start an agent turn now, or queue for the next one? */
  send: "immediate" | "deferred" | "never";
  /** Freeze the emitting widget. */
  resolves: boolean;
};

function cartStore() {
  return useCartStore.getState();
}

const ACTION_SPECS: Record<WidgetAction["type"], ActionSpec> = {
  quick_reply: {
    echo: (a) => (a.type === "quick_reply" ? a.text : null),
    send: "immediate",
    resolves: true,
  },
  // Cart writes go straight to the cart store — never through the agent. The
  // DB enforces one cart per user, so this is what keeps the header badge and
  // /cart page in sync. The agent learns about them via clientState on the
  // next turn.
  "cart.add": {
    effect: async (a) => {
      if (a.type === "cart.add") await cartStore().addItem(a.productId, a.qty);
    },
    send: "deferred",
    resolves: false,
  },
  "cart.set_qty": {
    effect: async (a) => {
      if (a.type === "cart.set_qty") await cartStore().updateQty(a.itemId, a.qty);
    },
    send: "deferred",
    resolves: false,
  },
  "cart.remove": {
    effect: async (a) => {
      if (a.type === "cart.remove") await cartStore().removeItem(a.itemId);
    },
    send: "deferred",
    resolves: false,
  },
  "cart.checkout": { echo: () => "Let's check out", send: "immediate", resolves: false },
  "address.select": {
    echo: (a) => (a.type === "address.select" ? a.oneLine : null),
    send: "immediate",
    resolves: true,
  },
  "address.add_requested": {
    echo: () => "Add a new address",
    send: "immediate",
    resolves: true,
  },
  "address.created": {
    echo: (a) => (a.type === "address.created" ? a.oneLine : null),
    send: "immediate",
    resolves: true,
  },
  "slot.select": {
    echo: (a) => (a.type === "slot.select" ? a.label : null),
    send: "immediate",
    resolves: true,
  },
  "review.confirm": { echo: () => "Confirm and pay", send: "immediate", resolves: true },
  "review.edit": {
    echo: (a) => (a.type === "review.edit" ? `Change my ${a.target}` : null),
    send: "immediate",
    resolves: true,
  },
  "reserve_pay.choose_amount": {
    // Not resolved: the same widget is patched in place through approval.
    send: "immediate",
    resolves: false,
  },
  "reserve_pay.intent_opened": { send: "deferred", resolves: false },
  "reserve_pay.approved_claim": {
    echo: () => "I've approved it",
    send: "immediate",
    resolves: false,
  },
  "reserve_pay.cancel": { echo: () => "Not now", send: "immediate", resolves: true },
  "reserve_pay.top_up": { echo: () => "Top up my reserve", send: "immediate", resolves: true },
  "reserve_pay.renew": { echo: () => "Set up a new reserve", send: "immediate", resolves: true },
  "fallback.web_checkout": { send: "never", resolves: true },
  retry: { send: "immediate", resolves: true },
};

/** Ops the agent is allowed to run on the client. Anything else is dropped. */
const ALLOWED_OPS: ClientOp["kind"][] = [
  "cart.add",
  "cart.set_qty",
  "cart.remove",
  "cart.clear",
  "nav",
];

/* -------------------------------------------------------------------------- */
/* durable conversation id                                                    */
/* -------------------------------------------------------------------------- */

// Kept in localStorage, decoupled from the sessionStorage-scoped transcript
// below — so a returning user (new tab, browser restart) can rehydrate their
// history from the server via `rehydrateOrGreet` instead of always
// re-greeting from scratch.
const CONVERSATION_ID_KEY = "freshcart-chat-conversation-id";

function readStoredConversationId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(CONVERSATION_ID_KEY);
  } catch {
    return null;
  }
}

function writeStoredConversationId(id: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONVERSATION_ID_KEY, id);
  } catch {
    // Private browsing / storage disabled — the id just won't survive a
    // restart, which is a fine fallback.
  }
}

/* -------------------------------------------------------------------------- */
/* store                                                                      */
/* -------------------------------------------------------------------------- */

type ChatState = {
  open: boolean;
  conversationId: string;
  messages: ChatMessage[];
  status: "idle" | "streaming" | "error";
  activePartId: string | null;
  resolutions: Record<string, WidgetAction>;
  pendingActions: WidgetAction[];
  addresses: Address[];
  draft: string;
  error: { code: ChatErrorCode; message: string; retryable: boolean } | null;

  /**
   * Voice is a property of the *turn*, not of the conversation: speak the reply only when the
   * question was spoken. Typing, or tapping a widget, goes back to a silent reply mid-conversation.
   * All of it is transient and none of it is persisted — see `partialize` below.
   */
  voicePhase: "idle" | "transcribing" | "speaking";
  /** BCP-47 of the language the user last spoke, to answer in. */
  voiceLanguage: string | null;
  /** True while the turn in flight came from the mic. */
  spokenTurn: boolean;
  /** The server has no Sarvam key: hide the mic rather than offer a button that 503s. */
  voiceUnavailable: boolean;

  openChat: () => void;
  closeChat: () => void;
  setDraft: (draft: string) => void;
  /** Transcribe a recording, then send it as an ordinary text turn. */
  sendVoice: (audio: Blob, filename: string) => Promise<void>;
  stopSpeaking: () => void;
  refreshAddresses: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
  dispatch: (partId: string, action: WidgetAction) => Promise<void>;
  resetConversation: () => void;

  /** Internal: try a free GET rehydrate first, falling back to a greet turn. */
  rehydrateOrGreet: () => Promise<void>;
  /** Internal: builds the request, opens the stream, folds events into state. */
  sendTurnInternal: (turn: ClientTurn) => Promise<void>;
};

let abortController: AbortController | null = null;

/* -------------------------------------------------------------------------- */
/* speech playback                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One element and one object URL at a time, module-level for the same reason `abortController`
 * is: there is only ever one conversation, so a second reply starting must silence the first
 * rather than talk over it. The URL is revoked on every replacement — a leaked blob URL holds
 * the decoded audio in memory for the life of the document.
 */
let audioElement: HTMLAudioElement | null = null;
let audioUrl: string | null = null;

function stopPlayback() {
  audioElement?.pause();
  audioElement = null;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
}

async function playSpeech(base64: string): Promise<void> {
  stopPlayback();
  audioUrl = URL.createObjectURL(base64ToAudioBlob(base64));
  const element = new Audio(audioUrl);
  audioElement = element;

  await new Promise<void>((resolve) => {
    element.onended = () => resolve();
    // Autoplay policy, a decode failure, an unplugged output — none of them are worth an error
    // in the transcript. The reply is already on screen; it just isn't read aloud.
    element.onerror = () => resolve();
    element.play().catch(() => resolve());
  });

  // Another reply may have replaced us while this one played.
  if (audioElement === element) stopPlayback();
}

/**
 * Speak an assistant message, if the turn that prompted it was spoken. Everything here is
 * best-effort: a failure leaves the reply on screen in text, which is the whole fallback.
 */
async function speakMessage(set: SetFn, get: GetFn, messageId: string) {
  const state = get();
  if (!state.spokenTurn) return;

  const message = state.messages.find((m) => m.id === messageId);
  if (!message) return;

  // Only prose is speakable. A widget-only reply (a product grid, an address picker) produces
  // no utterance at all — reading a grid aloud would be worse than the silence.
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(" ");
  if (!text) return;

  const token = useAuthStore.getState().token;
  if (!token) return;

  set({ voicePhase: "speaking" });
  try {
    const speech = await synthesizeSpeech(token, text, state.voiceLanguage ?? "en-IN");
    await playSpeech(speech.audio);
  } catch (err) {
    // Only the "not configured" case is worth saying out loud, and only once — the flag hides
    // the mic afterwards. A synthesis failure stays silent on purpose: the reply is already
    // readable on screen, and a toast every turn would be noise.
    if (isVoiceUnavailable(err)) {
      set({ voiceUnavailable: true });
      toast.error("Voice isn't set up on this server yet.");
    }
  } finally {
    set((s) => (s.voicePhase === "speaking" ? { voicePhase: "idle" } : s));
  }
}

function newMessage(role: ChatMessage["role"], parts: MessagePart[] = []): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    createdAt: Date.now(),
    parts,
    status: role === "user" ? "complete" : "streaming",
  };
}

function textMessage(role: ChatMessage["role"], text: string): ChatMessage {
  const message = newMessage(role, [
    { type: "text", partId: crypto.randomUUID(), text, done: true },
  ]);
  message.status = "complete";
  return message;
}

function initialConversationId(): string {
  const existing = readStoredConversationId();
  if (existing) return existing;
  const id = crypto.randomUUID();
  writeStoredConversationId(id);
  return id;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      open: false,
      conversationId: initialConversationId(),
      messages: [],
      status: "idle",
      activePartId: null,
      resolutions: {},
      pendingActions: [],
      addresses: [],
      draft: "",
      error: null,
      voicePhase: "idle",
      voiceLanguage: null,
      spokenTurn: false,
      voiceUnavailable: false,

      openChat: () => {
        set({ open: true });
        const { messages, refreshAddresses } = get();
        void refreshAddresses();
        // First open of this tab session — try to restore history for free
        // before falling back to a greet turn.
        if (messages.length === 0) void get().rehydrateOrGreet();
      },

      closeChat: () => {
        // Audio outliving the panel it came from is the most jarring failure here.
        get().stopSpeaking();
        set({ open: false });
      },

      setDraft: (draft) => set({ draft }),

      refreshAddresses: async () => {
        const token = useAuthStore.getState().token;
        if (!token) return;
        try {
          set({ addresses: await getAddresses(token) });
        } catch {
          // Non-fatal: the picker falls back to the add-address path.
        }
      },

      sendText: async (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        // Typing mid-conversation switches the reply back to silent, even if the previous turn
        // was spoken. Stop any playback still running from that previous turn.
        get().stopSpeaking();
        set((s) => ({
          messages: [...s.messages, textMessage("user", trimmed)],
          draft: "",
          spokenTurn: false,
          // Typing free text abandons whatever widget was awaiting an answer.
          activePartId: null,
        }));
        await get().sendTurnInternal({ kind: "text", text: trimmed });
      },

      sendVoice: async (audio, filename) => {
        const token = useAuthStore.getState().token;
        if (!token) return;

        get().stopSpeaking();
        set({ voicePhase: "transcribing" });

        let transcript: string;
        let languageCode: string;
        try {
          const result = await transcribeAudio(token, audio, filename);
          transcript = result.transcript;
          languageCode = result.languageCode;
        } catch (err) {
          set({ voicePhase: "idle" });
          if (isVoiceUnavailable(err)) {
            // Voice was never configured on this server. Hide the control from here on — but
            // say so first: silently swallowing this is indistinguishable from a dead button,
            // and leaves the customer with no idea their recording went nowhere.
            set({ voiceUnavailable: true });
            toast.error("Voice isn't set up on this server yet. You can type instead.");
            return;
          }
          if (handleAuthApiError(err)) return;
          toast.error(
            err instanceof ApiError && err.code === "VALIDATION"
              ? "I didn't catch that — try again?"
              : "Couldn't transcribe that. You can type instead."
          );
          return;
        }

        // From here the turn is indistinguishable from a typed one: the transcript enters the
        // transcript as an ordinary user message and goes through the same sendTurnInternal.
        // Only `spokenTurn` remembers where it came from, and only to decide whether to speak.
        set((s) => ({
          messages: [...s.messages, textMessage("user", transcript)],
          draft: "",
          activePartId: null,
          voicePhase: "idle",
          voiceLanguage: languageCode,
          spokenTurn: true,
        }));
        await get().sendTurnInternal({ kind: "text", text: transcript });
      },

      stopSpeaking: () => {
        stopPlayback();
        set((s) => (s.voicePhase === "speaking" ? { voicePhase: "idle" } : s));
      },

      dispatch: async (partId, action) => {
        const spec = ACTION_SPECS[action.type];
        if (!spec) return;

        // A tap is not speech: whatever this turn replies with, it replies in text.
        get().stopSpeaking();
        set({ spokenTurn: false });

        if (spec.effect) {
          try {
            await spec.effect(action);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "That didn't work. Try again?";
            set((s) => ({
              messages: [
                ...s.messages,
                newMessageWithError(message),
              ],
            }));
            return;
          }
        }

        if (spec.resolves) {
          set((s) => ({ resolutions: { ...s.resolutions, [partId]: action } }));
        }

        const echo = spec.echo?.(action) ?? null;
        if (echo) {
          set((s) => ({ messages: [...s.messages, textMessage("user", echo)] }));
        }

        if (spec.send === "deferred") {
          set((s) => ({ pendingActions: [...s.pendingActions, action] }));
          return;
        }
        if (spec.send === "never") return;

        await get().sendTurnInternal({ kind: "widget_action", partId, action });
      },

      resetConversation: () => {
        abortController?.abort();
        abortController = null;
        stopPlayback();
        const conversationId = crypto.randomUUID();
        writeStoredConversationId(conversationId);
        set({
          conversationId,
          messages: [],
          status: "idle",
          activePartId: null,
          resolutions: {},
          pendingActions: [],
          draft: "",
          error: null,
          voicePhase: "idle",
          voiceLanguage: null,
          spokenTurn: false,
        });
      },

      /* ---------------------------------------------------------------- */

      rehydrateOrGreet: async () => {
        const token = useAuthStore.getState().token;
        const { conversationId } = get();
        if (token) {
          try {
            const transcript = await getChatTranscript(conversationId, token);
            if (transcript.messages.length > 0) {
              set({
                messages: transcript.messages.map((m) => ({
                  id: m.id,
                  role: "assistant",
                  createdAt: Date.now(),
                  status: "complete",
                  parts: m.parts,
                })),
              });
              return;
            }
          } catch {
            // New conversation, or the server's unreachable — fall through to
            // the greet turn below either way.
          }
        }
        await get().sendTurnInternal({ kind: "resume" });
      },

      sendTurnInternal: async (turn: ClientTurn) => {
        const token = useAuthStore.getState().token;
        if (!token) return;

        // A turn sent before the cart has hydrated makes the agent confidently
        // announce an empty cart.
        const cart = useCartStore.getState();
        if (cart.status === "idle" || cart.status === "loading") {
          try {
            await cart.fetchCart();
          } catch {
            // Fall through — an empty cart is better than a hung chat.
          }
        }

        abortController?.abort();
        const controller = new AbortController();
        abortController = controller;

        const { pendingActions, addresses, conversationId } = get();
        set({ status: "streaming", error: null, pendingActions: [] });

        const request = {
          conversationId,
          token,
          turn,
          clientState: buildClientState({
            route: typeof window === "undefined" ? "/" : window.location.pathname,
            addresses,
            recentActions: pendingActions,
          }),
          protocolVersion: CHAT_PROTOCOL_VERSION,
        };

        let messageId: string | null = null;

        try {
          for await (const event of getChatTransport().send(request, controller.signal)) {
            if (controller.signal.aborted) return;
            messageId = applyEvent(set, get, event, messageId);
          }
          // Don't clobber a status the `error` event already set — the
          // backend's failure path is one `error` frame and then the stream
          // just ends, with no trailing `message_end`.
          set((s) => (s.status === "streaming" ? { status: "idle" } : s));
        } catch {
          set({
            status: "error",
            error: {
              code: "network",
              message: "Couldn't reach the assistant. Try again?",
              retryable: true,
            },
          });
        } finally {
          if (abortController === controller) abortController = null;
        }
      },
    }),
    {
      name: "freshcart-chat",
      storage: createJSONStorage(() => sessionStorage),
      // Stored messages are protocol parts, so the wire's drift detector governs them too: a
      // transcript written under an older version can be missing fields this build's widgets
      // read, which crashes the panel on rehydrate rather than degrading.
      version: CHAT_PROTOCOL_VERSION,
      // Dropping the transcript is the migration. Parts cannot be back-filled — the data a newer
      // widget wants was never captured — and an explicit migrate keeps zustand from logging
      // "couldn't be migrated" on every load after a bump.
      migrate: () => ({ messages: [], resolutions: {}, activePartId: null }),
      // `conversationId` is sourced from localStorage (see
      // `initialConversationId`/`writeStoredConversationId`), not this
      // sessionStorage-scoped slice.
      partialize: (state) => ({
        messages: state.messages,
        resolutions: state.resolutions,
        activePartId: state.activePartId,
      }),
      onRehydrateStorage: () => (state) => {
        // A stream that was mid-flight when the tab was evicted is dead.
        if (!state) return;
        for (const message of state.messages) {
          if (message.status === "streaming") message.status = "complete";
        }
      },
    }
  )
);

/* -------------------------------------------------------------------------- */
/* streaming reducer                                                          */
/* -------------------------------------------------------------------------- */

type SetFn = (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void;
type GetFn = () => ChatState;

function newMessageWithError(message: string, retryable = false): ChatMessage {
  const msg = newMessage("assistant", [
    {
      type: "error",
      partId: crypto.randomUUID(),
      code: "server",
      title: "That didn't work",
      detail: message,
      actions: retryable
        ? [{ id: "retry", label: "Try again", action: { type: "retry" } as WidgetAction }]
        : [],
    },
  ]);
  msg.status = "complete";
  return msg;
}

function applyEvent(
  set: SetFn,
  get: GetFn,
  event: ServerEvent,
  messageId: string | null
): string | null {
  switch (event.type) {
    case "message_start":
      set((s) => ({ messages: [...s.messages, { ...newMessage("assistant"), id: event.messageId }] }));
      return event.messageId;

    case "part_start": {
      // Directives are effects, not content — run and don't render.
      if (event.part.type === "client_directive") {
        void runDirective(set, event.part.op, event.part.echo);
        return messageId;
      }
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === messageId ? { ...m, parts: [...m.parts, event.part] } : m
        ),
      }));
      return messageId;
    }

    case "text_delta":
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id !== messageId
            ? m
            : {
                ...m,
                parts: m.parts.map((p) =>
                  p.partId === event.partId && p.type === "text"
                    ? { ...p, text: p.text + event.delta }
                    : p
                ),
              }
        ),
      }));
      return messageId;

    case "part_update":
      // Shallow merge — this is what lets Reserve Pay approval resolve in place
      // instead of appending a second widget.
      set((s) => ({
        messages: s.messages.map((m) => ({
          ...m,
          parts: m.parts.map((p) =>
            p.partId === event.partId ? ({ ...p, ...event.patch } as MessagePart) : p
          ),
        })),
      }));
      return messageId;

    case "part_end":
      set((s) => ({
        messages: s.messages.map((m) => ({
          ...m,
          parts: m.parts.map((p) =>
            p.partId === event.partId && p.type === "text" ? { ...p, done: true } : p
          ),
        })),
      }));
      return messageId;

    case "message_end": {
      const message = get().messages.find((m) => m.id === event.messageId);
      const nextActive = message ? lastTransientPartId(message.parts) : null;
      // Fire-and-forget: the transcript must finish rendering now, not after synthesis.
      void speakMessage(set, get, event.messageId);
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === event.messageId ? { ...m, status: "complete" as const } : m
        ),
        // Only hand the baton over when this turn actually asked something new.
        // A turn that just patches an existing widget (Reserve Pay approval) or
        // replies with plain text must leave the pending widget answerable —
        // otherwise the thing the user is mid-way through goes dead. Already
        // answered widgets stay frozen regardless, via `resolutions`.
        activePartId: nextActive ?? s.activePartId,
      }));
      return messageId;
    }

    case "error":
      // The mock never really failed mid-stream, so this only mattered in
      // theory before: without a transcript entry, a real failure just looks
      // like the assistant silently stopped thinking.
      set((s) => ({
        status: "error",
        error: { code: event.code, message: event.message, retryable: event.retryable },
        messages: [...s.messages, newMessageWithError(event.message, event.retryable)],
      }));
      return messageId;
  }
}

async function runDirective(set: SetFn, op: ClientOp, echo?: string) {
  if (!ALLOWED_OPS.includes(op.kind)) return;
  const cart = useCartStore.getState();
  try {
    if (op.kind === "cart.add") await cart.addItem(op.productId, op.qty);
    else if (op.kind === "cart.set_qty") await cart.updateQty(op.itemId, op.qty);
    else if (op.kind === "cart.remove") await cart.removeItem(op.itemId);
    else if (op.kind === "cart.clear") await cart.clear();
    else if (op.kind === "nav" && typeof window !== "undefined") {
      window.location.assign(op.href);
      return;
    }
    if (echo) toast.success(echo);
  } catch {
    set((s) => ({
      messages: [...s.messages, newMessageWithError("I couldn't update your cart.")],
    }));
  }
}

/* -------------------------------------------------------------------------- */

/** Clearing the transcript on logout mirrors auth-store resetting the cart. */
if (typeof window !== "undefined") {
  useAuthStore.subscribe((state, prev) => {
    if (prev.token && !state.token) {
      useChatStore.getState().resetConversation();
      useChatStore.setState({ open: false, addresses: [] });
    }
  });
}

export function useIsChatOpen() {
  return useChatStore((s) => s.open);
}

export { WIDGET_LIFECYCLE };
