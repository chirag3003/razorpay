import { apiFetch, ApiError } from "@/lib/api/client";

export type Transcription = {
  /** Always English, whichever language was spoken — see API.md §6.13a. */
  transcript: string;
  /** BCP-47 of what was actually spoken. Feed this straight back to `speak`. */
  languageCode: string;
};

export function transcribeAudio(
  token: string,
  audio: Blob,
  filename: string
): Promise<Transcription> {
  const body = new FormData();
  body.append("file", audio, filename);
  return apiFetch<Transcription>("/api/voice/transcribe", {
    method: "POST",
    token,
    body,
  });
}

export type Speech = {
  /** base64 WAV. */
  audio: string;
  /**
   * What it was *actually* spoken in, which is not always what was asked for: more languages can
   * be transcribed than synthesised, and the backend falls back to en-IN rather than failing.
   */
  languageCode: string;
};

export function synthesizeSpeech(
  token: string,
  text: string,
  languageCode: string
): Promise<Speech> {
  return apiFetch<Speech>("/api/voice/speak", {
    method: "POST",
    token,
    body: { text, languageCode },
  });
}

/**
 * The server has no SARVAM_API_KEY, so voice was never configured here. Distinct from a failure:
 * retrying will not help and the mic should be hidden rather than shown broken.
 */
export function isVoiceUnavailable(err: unknown): boolean {
  return err instanceof ApiError && err.code === "VOICE_UNAVAILABLE";
}

/** base64 WAV from `speak` into something an `<audio>` element can play. */
export function base64ToAudioBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "audio/wav" });
}
