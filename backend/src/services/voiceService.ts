import * as sarvam from "../clients/sarvam";
import {
  DEFAULT_VOICE_LANGUAGE,
  MAX_TTS_INPUT_CHARS,
  isSpeakableLanguage,
} from "../constants";
import { ValidationError } from "../errors";
import { logger } from "../logger";

/**
 * Chat voice input and output. Two entry points, one each way:
 *
 *   listen()  audio -> English text + the language it was spoken in
 *   speak()   English text + a language -> audio in that language
 *
 * The asymmetry is deliberate and is the whole design. The agent, every widget's copy and the
 * catalog are English, so the pipeline normalises *into* English on the way in and back *out of*
 * it on the way down. A Hindi speaker is understood and answered aloud in Hindi; the product
 * cards under that answer are still English. Closing that last gap means translating widget
 * payloads and product names, which is a much larger piece of work — see web/issues.md.
 */

export type Transcription = {
  /** Always English — see the `mode: "translate"` note in clients/sarvam.ts. */
  transcript: string;
  /** BCP-47 of what was spoken, for speak() to answer in. */
  languageCode: string;
};

export async function listen(audio: Blob, filename: string): Promise<Transcription> {
  const result = await sarvam.transcribe(audio, filename);

  const transcript = result.transcript?.trim() ?? "";
  if (!transcript) {
    // Silence, or a clip of pure background noise. A domain error rather than an empty 200 so
    // the client can say "I didn't catch that" instead of sending an empty turn to the agent.
    throw new ValidationError("No speech detected in that recording");
  }

  // Auto-detection can come back empty or as the literal "unknown" on a very short clip.
  const detected = result.language_code;
  const languageCode =
    detected && detected !== "unknown" ? detected : DEFAULT_VOICE_LANGUAGE;

  logger.info("voice", "transcribed", {
    languageCode,
    chars: transcript.length,
    confidence: result.language_probability,
  });

  return { transcript, languageCode };
}

/**
 * English `text` spoken in `languageCode`. Returns base64 WAV.
 *
 * Two deliberate degradations, both preferring an imperfect answer to none:
 * - a language saaras can transcribe but bulbul cannot speak falls back to English rather than
 *   failing the turn (a Santali speaker is understood, then answered in English)
 * - over-long text is truncated at a sentence boundary rather than rejected
 */
export async function speak(
  text: string,
  languageCode: string
): Promise<{ audio: string; languageCode: string }> {
  const spokenLanguage = isSpeakableLanguage(languageCode)
    ? languageCode
    : DEFAULT_VOICE_LANGUAGE;

  if (spokenLanguage !== languageCode) {
    logger.info("voice", "no voice for language, falling back", {
      requested: languageCode,
      spoken: spokenLanguage,
    });
  }

  let script = truncateForSpeech(text);

  if (spokenLanguage !== DEFAULT_VOICE_LANGUAGE) {
    script = await sarvam.translate(script, DEFAULT_VOICE_LANGUAGE, spokenLanguage);
    // Translation can grow the text past the synthesis cap even when the English fitted.
    script = truncateForSpeech(script);
  }

  const audio = await sarvam.synthesize(script, spokenLanguage);
  logger.info("voice", "synthesized", { languageCode: spokenLanguage, chars: script.length });

  return { audio, languageCode: spokenLanguage };
}

/**
 * Cut to the last sentence that fits rather than mid-word. Falls back to a hard slice when the
 * text has no sentence break in range — one very long sentence is still better spoken partly
 * than not at all.
 */
function truncateForSpeech(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_TTS_INPUT_CHARS) return trimmed;

  const window = trimmed.slice(0, MAX_TTS_INPUT_CHARS);
  const lastBreak = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf("\n")
  );

  // Only honour a break in the last third, so a reply isn't cut to one opening sentence.
  return lastBreak > MAX_TTS_INPUT_CHARS * 0.66
    ? window.slice(0, lastBreak + 1)
    : window;
}
