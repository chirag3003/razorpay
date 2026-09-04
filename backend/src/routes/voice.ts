import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { voiceConfigured } from "../clients/sarvam";
import { MAX_VOICE_UPLOAD_BYTES } from "../constants";
import { ValidationError, VoiceUnavailableError } from "../errors";
import { requireAuth } from "../middleware/auth";
import { speakSchema } from "../schemas/voice.schema";
import * as voiceService from "../services/voiceService";
import type { AppEnv } from "../types";

export const voiceRoutes = new Hono<AppEnv>();

// Authed like every other storefront route, and for one extra reason: Sarvam bills per call, so
// an open relay here is someone else's transcription budget spent on our key.
voiceRoutes.use("*", requireAuth);

// Audio does not fit under the global MAX_REQUEST_BODY_BYTES (256 KB), which is why server.ts
// mounts this router ahead of that middleware. This is the replacement ceiling — the router is
// not unbounded, it is bounded differently.
voiceRoutes.use(
  "*",
  bodyLimit({
    maxSize: MAX_VOICE_UPLOAD_BYTES,
    onError: (c) =>
      c.json({ error: "That recording is too large", code: "PAYLOAD_TOO_LARGE" }, 413),
  })
);

// Answered before any handler runs, so an unconfigured deployment gives one honest reason
// instead of a 500 from deep inside the client.
voiceRoutes.use("*", async (_c, next) => {
  if (!voiceConfigured) throw new VoiceUnavailableError();
  await next();
});

/**
 * Transcribe a recording. Returns English text plus the language actually spoken, so the caller
 * can send the text to the chat agent and later ask for the reply in the same language.
 */
voiceRoutes.post("/transcribe", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof Blob)) {
    throw new ValidationError("Expected a multipart body with a 'file' field");
  }

  const filename = file instanceof File && file.name ? file.name : "recording.webm";
  return c.json(await voiceService.listen(file, filename));
});

/**
 * Speak an English reply in the customer's language. `languageCode` is whatever /transcribe
 * reported; a language with no synthesis voice is answered in English rather than refused.
 */
voiceRoutes.post("/speak", zValidator("json", speakSchema), async (c) => {
  const { text, languageCode } = c.req.valid("json");
  return c.json(await voiceService.speak(text, languageCode));
});
