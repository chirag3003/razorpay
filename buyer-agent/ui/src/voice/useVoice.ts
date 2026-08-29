import { useCallback, useEffect, useState } from "react";

/**
 * Voice capture seam — Phase 5, not yet implemented.
 *
 * The hook exists now so the composer's mic button has a real home and the shape is settled:
 * capture in the browser, transcribe on the server, never a provider key in client code.
 *
 * When this is built, do NOT reach for `new MediaRecorder(stream)` with defaults — Chrome emits
 * webm/opus and Sarvam's transcribe endpoint takes mp3/wav at 16 kHz. Capture via an AudioWorklet
 * and encode 16 kHz mono WAV here before POSTing to /api/voice/transcribe.
 */
export function useVoice() {
  const [available, setAvailable] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    // The server is the source of truth for whether a provider is configured, so the button
    // cannot appear enabled in a build where voice was never set up.
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { voice?: { available?: boolean } }) => setAvailable(Boolean(d.voice?.available)))
      .catch(() => setAvailable(false));
  }, []);

  const toggle = useCallback(() => {
    setRecording((r) => !r);
  }, []);

  return { available, recording, toggle };
}
