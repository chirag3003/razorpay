"use client";

import { useCallback, useEffect, useRef } from "react";
import { Loader2, Mic, SendHorizonal, Square } from "lucide-react";
import { toast } from "sonner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useVoiceRecorder, MAX_CLIP_MS } from "@/hooks/use-voice-recorder";
import { useChatStore } from "@/store/chat-store";
import { cn } from "@/lib/utils";

const RECORDER_ERROR_COPY: Record<string, string> = {
  "permission-denied":
    "Microphone access is blocked. Allow it in your browser's site settings to talk.",
  "no-microphone": "No microphone found. You can type instead.",
  unsupported: "This browser can't record audio. You can type instead.",
  failed: "Recording didn't work. You can type instead.",
};

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function ChatComposer({
  composerRef,
}: {
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const sendText = useChatStore((s) => s.sendText);
  const sendVoice = useChatStore((s) => s.sendVoice);
  const status = useChatStore((s) => s.status);
  const voicePhase = useChatStore((s) => s.voicePhase);
  const voiceUnavailable = useChatStore((s) => s.voiceUnavailable);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const ref = composerRef ?? fallbackRef;

  const onClip = useCallback(
    (audio: Blob, filename: string) => void sendVoice(audio, filename),
    [sendVoice]
  );
  const recorder = useVoiceRecorder(onClip);

  useEffect(() => {
    if (recorder.error) toast.error(RECORDER_ERROR_COPY[recorder.error]);
  }, [recorder.error]);

  const canSend = draft.trim().length > 0;
  const recording = recorder.state === "recording";
  const transcribing = voicePhase === "transcribing";
  const busy = recorder.state === "requesting" || transcribing;

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
          placeholder={
            recording
              ? "Listening…"
              : transcribing
                ? "Transcribing…"
                : "Ask for anything — milk, snacks, reorder…"
          }
          aria-label="Message the assistant"
          disabled={recording || transcribing}
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
          {/* Hidden once the server has told us it has no Sarvam key — a control that can only
              fail is worse than no control. */}
          {!voiceUnavailable && (
            <InputGroupButton
              size="icon-sm"
              aria-label={recording ? "Stop recording and send" : "Record a voice message"}
              aria-pressed={recording}
              disabled={busy || status === "streaming"}
              className={cn(recording && "text-destructive")}
              onClick={() => (recording ? recorder.stop() : void recorder.start())}
            >
              {transcribing || recorder.state === "requesting" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : recording ? (
                <Square className="size-3.5 fill-current" />
              ) : (
                <Mic className="size-4" />
              )}
            </InputGroupButton>
          )}

          {recording && (
            <span
              // Announced so a screen-reader user knows recording started and, near the cap,
              // that it is about to stop itself.
              role="status"
              className="text-xs font-medium tabular-nums text-destructive"
            >
              {formatElapsed(recorder.elapsedMs)} / {formatElapsed(MAX_CLIP_MS)}
            </span>
          )}

          <InputGroupButton
            type="submit"
            size="icon-sm"
            variant="default"
            className="ml-auto"
            aria-label="Send message"
            disabled={!canSend || status === "streaming" || recording || transcribing}
          >
            <SendHorizonal className="size-4" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
