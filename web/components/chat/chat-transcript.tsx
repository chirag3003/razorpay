"use client";

import { useEffect, useRef } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessageView } from "@/components/chat/chat-message";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { useChatStore } from "@/store/chat-store";

export function ChatTranscript() {
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const { scrollRef, contentRef, pinned, onScroll, scrollToBottom } =
    useStickToBottom<HTMLDivElement>();

  // Smooth-scroll once per new message; token-by-token growth is handled by the
  // ResizeObserver inside the hook (instantly, so it doesn't chase).
  const lastCount = useRef(messages.length);
  useEffect(() => {
    if (messages.length > lastCount.current && pinned) scrollToBottom(true);
    lastCount.current = messages.length;
  }, [messages.length, pinned, scrollToBottom]);

  const thinking =
    status === "streaming" &&
    messages.at(-1)?.role === "assistant" &&
    messages.at(-1)?.parts.every((p) => p.type === "text" && !p.text) !== false;

  return (
    <div className="relative min-h-0 flex-1">
      {/* A plain scroller, not ScrollArea: stick-to-bottom needs the scrolling
          element, and this gets native momentum scrolling on iOS. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        aria-live="polite"
        className="h-full overflow-y-auto overscroll-contain scroll-pb-4"
      >
        <div ref={contentRef} className="flex flex-col gap-4 p-4">
          {messages.map((message) => (
            <ChatMessageView key={message.id} message={message} />
          ))}
          {thinking && <ThinkingRow />}
        </div>
      </div>

      {!pinned && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          onClick={() => scrollToBottom(true)}
        >
          <ArrowDown className="size-4" />
          New messages
        </Button>
      )}
    </div>
  );
}

function ThinkingRow() {
  return (
    <p className="shimmer text-sm text-muted-foreground" aria-label="Assistant is typing">
      Thinking…
    </p>
  );
}
