"use client";

import { useRef } from "react";
import { Mic, SendHorizonal } from "lucide-react";
import { toast } from "sonner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useChatStore } from "@/store/chat-store";

export function ChatComposer({
  composerRef,
}: {
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const sendText = useChatStore((s) => s.sendText);
  const status = useChatStore((s) => s.status);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const ref = composerRef ?? fallbackRef;

  const canSend = draft.trim().length > 0;

  function submit() {
    if (!canSend) return;
    void sendText(draft);
  }

  return (
    <form
      className="shrink-0 border-t bg-background p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          ref={ref}
          value={draft}
          rows={1}
          placeholder="Ask for anything — milk, snacks, reorder…"
          aria-label="Message the assistant"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. On touch keyboards Enter
            // is usually a newline key, so the send button is the real path.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="gap-1">
          <InputGroupButton
            size="icon-sm"
            aria-label="Voice input (coming soon)"
            onClick={() => toast("Voice input is coming soon")}
          >
            <Mic className="size-4" />
          </InputGroupButton>

          <InputGroupButton
            type="submit"
            size="icon-sm"
            variant="default"
            className="ml-auto"
            aria-label="Send message"
            disabled={!canSend || status === "streaming"}
          >
            <SendHorizonal className="size-4" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
