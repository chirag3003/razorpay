import { useRef, useState } from "react";
import { useVoice } from "../voice/useVoice.ts";

export function Composer({
  busy,
  awaitingUser,
  onSend,
  onStop,
}: {
  busy: boolean;
  awaitingUser: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const voice = useVoice();

  function submit() {
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  }

  return (
    <div className="border-t border-ink-850 bg-ink-900/80 px-4 py-3 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        {awaitingUser && (
          <p className="mb-2 text-xs text-caution">
            Waiting on you — answer the card above to let the agent continue.
          </p>
        )}

        <div className="flex items-end gap-2 rounded-xl border border-ink-700 bg-ink-950 px-2.5 py-2 focus-within:border-accent-dim">
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={busy ? "Working…" : "Ask the agent to do something"}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="max-h-40 flex-1 resize-none bg-transparent py-1 text-sm text-ink-100 outline-none placeholder:text-ink-700"
          />

          {/* Hidden entirely rather than shown-disabled: a mic that does nothing when clicked is
              worse than no mic. It appears the moment the server reports a provider. */}
          {voice.available && (
            <button
              type="button"
              onClick={voice.toggle}
              title="Voice input"
              className={
                "shrink-0 rounded-md p-1.5 transition " +
                (voice.recording ? "bg-danger/20 text-danger" : "text-ink-500 hover:text-ink-300")
              }
            >
              <MicIcon />
            </button>
          )}

          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 hover:bg-ink-800"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-ink-950 transition hover:brightness-110 disabled:opacity-30"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" strokeLinecap="round" />
    </svg>
  );
}
