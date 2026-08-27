"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";
import { getAddresses } from "@/lib/api/addresses";
import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { getChatTransport } from "@/lib/chat/transport";
import { buildClientState } from "@/lib/chat/client-state";
import { resetMockSession } from "@/lib/chat/mock-script";
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

  openChat: () => void;
  closeChat: () => void;
  setDraft: (draft: string) => void;
  refreshAddresses: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
  dispatch: (partId: string, action: WidgetAction) => Promise<void>;
  resetConversation: () => void;

  /** Internal: builds the request, opens the stream, folds events into state. */
  sendTurnInternal: (turn: ClientTurn) => Promise<void>;
};

let abortController: AbortController | null = null;

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

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      open: false,
      conversationId: crypto.randomUUID(),
      messages: [],
      status: "idle",
      activePartId: null,
      resolutions: {},
      pendingActions: [],
      addresses: [],
      draft: "",
      error: null,

      openChat: () => {
        set({ open: true });
        const { messages, refreshAddresses } = get();
        void refreshAddresses();
        // First open of a fresh conversation — let the agent greet.
        if (messages.length === 0) void get().sendTurnInternal({ kind: "resume" });
      },

      closeChat: () => set({ open: false }),

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
        set((s) => ({
          messages: [...s.messages, textMessage("user", trimmed)],
          draft: "",
          // Typing free text abandons whatever widget was awaiting an answer.
          activePartId: null,
        }));
        await get().sendTurnInternal({ kind: "text", text: trimmed });
      },

      dispatch: async (partId, action) => {
        const spec = ACTION_SPECS[action.type];
        if (!spec) return;

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
        resetMockSession();
        set({
          conversationId: crypto.randomUUID(),
          messages: [],
          status: "idle",
          activePartId: null,
          resolutions: {},
          pendingActions: [],
          draft: "",
          error: null,
        });
      },

      /* ---------------------------------------------------------------- */

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
          set({ status: "idle" });
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
      partialize: (state) => ({
        conversationId: state.conversationId,
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

function newMessageWithError(message: string): ChatMessage {
  const msg = newMessage("assistant", [
    {
      type: "error",
      partId: crypto.randomUUID(),
      code: "server",
      title: "That didn't work",
      detail: message,
      actions: [],
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
      set({
        status: "error",
        error: { code: event.code, message: event.message, retryable: event.retryable },
      });
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
