import { z } from "zod";

/**
 * Validated once, at boot. A missing ANTHROPIC_API_KEY should crash startup, not surface as a
 * mysterious failure three turns into a conversation the user is watching.
 */
const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required to run the agent loop"),
  PORT: z.coerce.number().int().positive().default(4100),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  /** Where the connection registry and activity log are written. */
  DATA_DIR: z.string().default("./data"),
  /** Optional. Until this is set the voice routes answer 501 rather than pretending to work. */
  SARVAM_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(Bun.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
