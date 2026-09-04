import { z } from "zod";

export const speakSchema = z.object({
  // The assistant's reply, in English. Length is not capped here on purpose: voiceService
  // truncates at a sentence boundary, which is a better answer than a 400 for a reply that
  // happened to run long.
  text: z.string().min(1, "text is required"),
  // BCP-47, as returned by POST /api/voice/transcribe. Not an enum: saaras detects more
  // languages than bulbul can speak, and voiceService falls back to English for the difference
  // rather than rejecting a code that was legitimately detected.
  languageCode: z
    .string()
    .regex(/^[a-z]{2,3}-[A-Z]{2}$/, "languageCode must look like 'hi-IN'")
    .default("en-IN"),
});

export type SpeakInput = z.infer<typeof speakSchema>;
