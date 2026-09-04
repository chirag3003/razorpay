import { env } from "../config/env";
import {
  SARVAM_STT_MODEL,
  SARVAM_TRANSLATE_MODEL,
  SARVAM_TTS_MODEL,
  SARVAM_TTS_SPEAKER,
} from "../constants";
import { VoiceServiceError, VoiceUnavailableError } from "../errors";
import { logger } from "../logger";

/**
 * Sarvam AI — the speech stack behind chat voice input/output. Three endpoints, no SDK: the
 * official `sarvamai` package wraps the same three POSTs and would be the only dependency in
 * this tree pulled in for that little, so plain fetch it is (the same argument CLAUDE.md makes
 * against an LLM framework).
 *
 * Only `services/voiceService.ts` should import this. Everything here is a thin transport —
 * which language to speak in, when to translate and how to truncate are decisions, and
 * decisions live in the service.
 */

const SARVAM_BASE = "https://api.sarvam.ai";

// Speech synthesis on a long reply is the slowest of the three and still lands well inside this.
// Without a timeout a hung upstream holds the request open until the client gives up, and the
// customer watches a spinner that will never resolve.
const REQUEST_TIMEOUT_MS = 30_000;

/** False when SARVAM_API_KEY is unset — the storefront hides the mic rather than offering a 503. */
export const voiceConfigured = Boolean(env.SARVAM_API_KEY);

function apiKey(): string {
  if (!env.SARVAM_API_KEY) throw new VoiceUnavailableError();
  return env.SARVAM_API_KEY;
}

async function sarvamFetch<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("api-subscription-key", apiKey());

  let res: Response;
  try {
    res = await fetch(`${SARVAM_BASE}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Transport failure or the timeout above. Log the cause here — the client only ever sees
    // the generic message, and without this line an upstream outage is invisible.
    logger.error("voice", `sarvam ${path} unreachable`, err);
    throw new VoiceServiceError("Could not reach the voice service");
  }

  if (!res.ok) {
    // Sarvam's error bodies carry useful detail (bad language code, oversize input) but can
    // quote the customer's own speech back, so they are logged and never returned.
    const detail = await res.text().catch(() => "");
    logger.warn("voice", `sarvam ${path} ${res.status}`, { detail: detail.slice(0, 500) });
    throw new VoiceServiceError("The voice service rejected that request");
  }

  return (await res.json()) as T;
}

/* -------------------------------------------------------------------------- */

type TranscribeResponse = {
  request_id?: string;
  transcript: string;
  /** BCP-47 of what was actually spoken — the input to everything downstream. */
  language_code?: string;
  language_probability?: number;
};

/**
 * `mode: "translate"` is why this works at all: saaras:v3 returns ENGLISH text no matter which
 * of the 23 languages was spoken, so the English-only agent can answer it, while
 * `language_code` still reports the original so the reply can be spoken back in it.
 *
 * `language_code: "unknown"` asks for auto-detection rather than making the customer pick.
 */
export async function transcribe(audio: Blob, filename: string): Promise<TranscribeResponse> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", SARVAM_STT_MODEL);
  form.append("mode", "translate");
  form.append("language_code", "unknown");

  // No Content-Type header: fetch must set it itself to include the multipart boundary.
  return sarvamFetch<TranscribeResponse>("/speech-to-text", { method: "POST", body: form });
}

type TranslateResponse = { translated_text: string };

export async function translate(
  input: string,
  sourceLanguageCode: string,
  targetLanguageCode: string
): Promise<string> {
  const body = await sarvamFetch<TranslateResponse>("/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input,
      source_language_code: sourceLanguageCode,
      target_language_code: targetLanguageCode,
      model: SARVAM_TRANSLATE_MODEL,
      // Devanagari for Hindi rather than romanised Hindi. bulbul pronounces native script
      // correctly; romanised text it reads as if it were English.
      output_script: "fully-native",
    }),
  });
  return body.translated_text;
}

type SpeechResponse = { audios: string[] };

/** Returns base64 WAV. Sarvam chunks long input, so the array is joined before decoding. */
export async function synthesize(text: string, targetLanguageCode: string): Promise<string> {
  const body = await sarvamFetch<SpeechResponse>("/text-to-speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      target_language_code: targetLanguageCode,
      model: SARVAM_TTS_MODEL,
      speaker: SARVAM_TTS_SPEAKER,
    }),
  });

  const audio = body.audios?.join("") ?? "";
  if (!audio) throw new VoiceServiceError("The voice service returned no audio");
  return audio;
}
