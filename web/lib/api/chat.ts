import { apiFetch } from "@/lib/api/client";
import type { MessagePart } from "@/lib/chat/protocol";

export type ChatTranscript = {
  conversationId: string;
  protocolVersion: number;
  messages: { id: string; parts: MessagePart[] }[];
};

/**
 * No model call — replays whatever's already stored server-side for this
 * conversation. Only assistant turns carry rendered `parts`, so this never
 * reconstructs user bubbles, same as a `resume` turn wouldn't either.
 */
export function getChatTranscript(
  conversationId: string,
  token: string
): Promise<ChatTranscript> {
  return apiFetch<ChatTranscript>(`/api/chat/${conversationId}`, { token });
}
