/**
 * Sarvam AI adapter — NOT YET WIRED.
 *
 * Verified call shapes for when Phase 5 starts (package: `sarvamai`):
 *
 *   const client = new SarvamAIClient({ apiSubscriptionKey });
 *
 *   // Speech to text. `language_code: "unknown"` auto-detects, which gets us multilingual input
 *   // for free rather than making the user pick a language first.
 *   const res = await client.speechToText.transcribe(file, {
 *     model: "saarika:v2.5",
 *     language_code: "unknown",
 *   });
 *   // -> { request_id, transcript, language_code }
 *
 *   // Text to speech.
 *   const audio = await client.textToSpeech.stream({
 *     text,
 *     target_language_code: "hi-IN",
 *     speaker: "shubh",
 *     model: "bulbul:v3",
 *     output_audio_codec: "mp3",
 *   });
 *   // -> Response; Buffer.from(await audio.arrayBuffer())
 *
 * THE GOTCHA THAT WILL COST AN HOUR IF IGNORED:
 * Chrome's MediaRecorder produces webm/opus. Sarvam's transcribe accepts .mp3/.wav, and its bulk
 * API notes that raw PCM must be 16 kHz. So the browser side must capture through an AudioWorklet
 * and encode 16 kHz mono WAV itself — handing this a webm blob will fail. Do not plan around
 * `new MediaRecorder(stream)` with default options.
 */
export {};
