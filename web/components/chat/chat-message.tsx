"use client";

import { Bubble, BubbleContent, BubbleGroup } from "@/components/ui/bubble";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { WidgetPart } from "@/components/chat/widget-registry";
import type { ChatMessage as ChatMessageType } from "@/lib/chat/protocol";

export function ChatMessageView({ message }: { message: ChatMessageType }) {
  const isUser = message.role === "user";

  // A turn that only patched an existing widget (or only carried a directive)
  // has nothing of its own to show — don't leave an empty bubble behind.
  const hasVisibleContent = message.parts.some(
    (part) =>
      part.type !== "client_directive" && (part.type !== "text" || part.text.length > 0)
  );
  if (!hasVisibleContent) return null;

  return (
    <BubbleGroup>
      {message.parts.map((part) => {
        if (part.type === "client_directive") return null;

        if (part.type === "text") {
          // An empty text part is a stream that hasn't produced a token yet —
          // the typing indicator already covers that, so don't flash an
          // empty bubble.
          if (!part.text) return null;
          return (
            <Bubble
              key={part.partId}
              variant={isUser ? "default" : "tinted"}
              align={isUser ? "end" : "start"}
            >
              <BubbleContent>
                {/* Only the assistant's prose is markdown. A customer who types *not sure*
                    means asterisks, and a voice transcript is literal by definition. */}
                {isUser ? part.text : <MarkdownMessage text={part.text} />}
              </BubbleContent>
            </Bubble>
          );
        }

        // Widgets get the ghost variant: full width, no padding, no bubble
        // background — the card supplies its own chrome.
        return (
          <Bubble key={part.partId} variant="ghost" align="start" className="w-full">
            <BubbleContent className="w-full">
              <WidgetPart part={part} />
            </BubbleContent>
          </Bubble>
        );
      })}
    </BubbleGroup>
  );
}
