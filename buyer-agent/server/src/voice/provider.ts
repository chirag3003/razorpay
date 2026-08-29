import { env } from "../config/env.ts";

/**
 * The voice seam.
 *
 * Deliberately an interface with no implementation wired yet: voice is the last thing being built,
 * and a half-working microphone is worse than an honest 501. What this fixes now is the *shape* —
 * transcription and synthesis both go through the server (never a provider key in the browser),
 * and swapping Sarvam for anything else is one file.
 */
export interface VoiceProvider {
  readonly name: string;
  transcribe(audio: Blob, opts?: { languageCode?: string }): Promise<TranscriptionResult>;
  speak(text: string, opts?: { languageCode?: string; speaker?: string }): Promise<ArrayBuffer>;
}

export type TranscriptionResult = {
  text: string;
  /** BCP-47, as detected by the provider. */
  languageCode: string;
};

/**
 * Returns null until a provider is configured. Callers must handle null rather than assuming
 * voice exists — the UI hides the mic on the same signal.
 */
export function getVoiceProvider(): VoiceProvider | null {
  if (!env.SARVAM_API_KEY) return null;
  // Phase 5: return createSarvamProvider(env.SARVAM_API_KEY) — see ./sarvam.ts for the exact
  // call shapes, which are already verified against Sarvam's current API.
  return null;
}

export function voiceStatus() {
  return {
    available: getVoiceProvider() !== null,
    configured: Boolean(env.SARVAM_API_KEY),
    provider: env.SARVAM_API_KEY ? "sarvam" : null,
  };
}
