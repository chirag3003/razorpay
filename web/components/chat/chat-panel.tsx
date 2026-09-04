"use client";

import { useRef } from "react";
import { RotateCcw, Sparkles, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatLoginGate } from "@/components/chat/chat-login-gate";
import { ChatTranscript } from "@/components/chat/chat-transcript";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import { useChatStore } from "@/store/chat-store";

export function ChatPanel() {
  const open = useChatStore((s) => s.open);
  const closeChat = useChatStore((s) => s.closeChat);
  const resetConversation = useChatStore((s) => s.resetConversation);
  const hasMessages = useChatStore((s) => s.messages.length > 0);
  const speaking = useChatStore((s) => s.voicePhase === "speaking");
  const stopSpeaking = useChatStore((s) => s.stopSpeaking);
  const isAuthed = useAuthStore((s) => s.status === "authenticated");

  const isDesktop = useMediaQuery("(min-width: 640px)");
  const { inset: keyboardInset, viewportHeight } = useKeyboardInset(open && !isDesktop);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : closeChat())}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        showCloseButton={false}
        // Desktop focuses the composer; on mobile that would summon the
        // keyboard and swallow half the sheet before anything is read.
        initialFocus={isDesktop ? composerRef : handleRef}
        // The mobile height MUST stay an inline style. SheetContent's base
        // classes include `data-[side=bottom]:h-auto`, which is specificity
        // (0,2,0) — a plain `h-[...]` class is (0,1,0) and silently loses, and
        // tailwind-merge won't drop it because the variant prefixes differ.
        // The sheet then grows past the top of the screen and the transcript
        // can never scroll. Inline style outranks any selector; don't "tidy"
        // this back into className.
        style={
          isDesktop
            ? undefined
            : {
                height: viewportHeight
                  ? `min(94svh, ${Math.round(viewportHeight - 12)}px)`
                  : "94svh",
                bottom: keyboardInset || undefined,
              }
        }
        className={cn(
          "flex flex-col gap-0 p-0",
          isDesktop ? "h-full w-full sm:max-w-md" : "rounded-t-2xl"
        )}
      >
        {!isDesktop && (
          // Looks like a drag handle and there's no drag-to-dismiss, so make
          // the obvious tap target actually close the sheet.
          <button
            ref={handleRef}
            type="button"
            aria-label="Close chat"
            className="mx-auto mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30"
            onClick={closeChat}
          />
        )}

        <div className="flex shrink-0 items-center gap-2 border-b p-3">
          <div className="flex size-7 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="size-4 text-primary" />
          </div>
          <SheetTitle className="flex-1">FreshCart Assistant</SheetTitle>
          {/* Only route to silence a spoken reply short of closing the panel. */}
          {speaking && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Stop speaking"
              onClick={stopSpeaking}
            >
              <Volume2 className="size-4 animate-pulse text-primary" />
            </Button>
          )}
          {hasMessages && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Start a new conversation"
              onClick={resetConversation}
            >
              <RotateCcw className="size-4" />
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={closeChat}>
            Close
          </Button>
        </div>

        {isAuthed ? (
          <>
            <ChatTranscript />
            <ChatComposer composerRef={composerRef} />
          </>
        ) : (
          <ChatLoginGate />
        )}
      </SheetContent>
    </Sheet>
  );
}
