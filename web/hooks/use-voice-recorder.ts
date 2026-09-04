"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Microphone capture for the chat composer, via MediaRecorder.
 *
 * The backend accepts WebM/Opus and MP4/AAC directly, which is exactly what browsers produce, so
 * there is no transcoding step here — the recorded blob is posted as-is.
 *
 * `getUserMedia` needs a secure context. localhost counts; testing from another device on the LAN
 * does not, and the permission request will fail there without an obvious reason.
 */

export type RecorderState = "idle" | "requesting" | "recording";

export type RecorderError =
  | "permission-denied"
  | "no-microphone"
  | "unsupported"
  | "failed";

/** The transcription endpoint is the synchronous one, documented for clips under 30s. */
export const MAX_CLIP_MS = 30_000;

// Speech doesn't need music-grade bitrate, and a smaller blob is a faster upload on a phone.
const AUDIO_BITS_PER_SECOND = 32_000;

// In preference order. Chrome/Firefox take the first, Safari the MP4; the final entry lets the
// browser choose if it likes none of them.
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "",
];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of MIME_CANDIDATES) {
    if (type === "" || MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

function fileExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

export function useVoiceRecorder(onClip: (audio: Blob, filename: string) => void) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ending a stream's tracks makes MediaRecorder fire `onstop` on its own, so tearing down while
  // recording looks exactly like the user tapping stop. This tells the two apart: set it and the
  // clip is discarded instead of sent.
  const cancelledRef = useRef(false);
  // Held in a ref so `stop` doesn't have to be recreated when the callback identity changes,
  // which would otherwise re-run the unmount cleanup mid-recording.
  const onClipRef = useRef(onClip);
  useEffect(() => {
    onClipRef.current = onClip;
  });

  /**
   * Release the microphone. Called from every exit path — a stopped recorder does NOT release
   * the device, and a browser tab left showing the recording indicator after the chat sheet
   * closes is alarming in a way no error message would be.
   */
  const teardown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    timerRef.current = null;
    autoStopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  /** Stop recording and throw the clip away — the user abandoned it. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    recorderRef.current?.stop();
    teardown();
    setState("idle");
    setElapsedMs(0);
  }, [teardown]);

  // Closing the chat panel mid-recording must discard, not send: without this the abandoned clip
  // is transcribed and posted as a chat turn the user never chose to send.
  useEffect(() => cancel, [cancel]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      teardown();
      setState("idle");
      return;
    }
    // `onstop` fires after this and is where the clip is assembled and handed over.
    recorder.stop();
  }, [teardown]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setError(null);

    const mimeType = pickMimeType();
    if (mimeType === null || typeof navigator === "undefined" || !navigator.mediaDevices) {
      setError("unsupported");
      return;
    }

    setState("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "permission-denied"
          : name === "NotFoundError" || name === "DevicesNotFoundError"
            ? "no-microphone"
            : "failed"
      );
      setState("idle");
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setError("unsupported");
      setState("idle");
      return;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    cancelledRef.current = false;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      if (cancelledRef.current) {
        chunksRef.current = [];
        teardown();
        return;
      }
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      teardown();
      setState("idle");
      setElapsedMs(0);
      // An empty blob means the user tapped stop before any audio arrived. Nothing to send —
      // silently doing nothing is the right response to a mis-tap.
      if (blob.size > 0) {
        onClipRef.current(blob, `recording.${fileExtension(type)}`);
      }
    };

    recorder.onerror = () => {
      teardown();
      setState("idle");
      setElapsedMs(0);
      setError("failed");
    };

    recorder.start();
    setState("recording");
    setElapsedMs(0);

    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
    // Stop ourselves at the endpoint's ceiling rather than uploading a clip it will reject.
    autoStopRef.current = setTimeout(() => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, MAX_CLIP_MS);
  }, [state, teardown]);

  return { state, elapsedMs, error, start, stop, cancel };
}
