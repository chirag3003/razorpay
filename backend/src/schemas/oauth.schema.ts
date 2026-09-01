import { z } from "zod";

// RFC 7591 dynamic client registration. Only the fields actually read — a real client may send
// contacts, logo_uri and others, which zod drops rather than rejects.
export const registerClientSchema = z.object({
  client_name: z.string().min(1).optional(),
  redirect_uris: z.array(z.string()).min(1),
});

export type RegisterClientInput = z.infer<typeof registerClientSchema>;

// GET /oauth/authorize query params.
export const createAuthorizationRequestSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string(),
  code_challenge: z.string().min(43).max(128), // RFC 7636 length bounds for the S256 verifier
  code_challenge_method: z.string(),
  scope: z.string().optional(),
  state: z.string().optional(),
});

export type CreateAuthorizationRequestInput = z.infer<typeof createAuthorizationRequestSchema>;

export const authorizeDecisionSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approve", "deny"]),
});

// One schema for both grant types. The handler dispatches on grant_type, so fields unused by a
// given grant are not read rather than rejected.
export const tokenRequestSchema = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  code: z.string().optional(),
  code_verifier: z.string().optional(),
  redirect_uri: z.string().optional(),
  refresh_token: z.string().optional(),
  client_id: z.string().min(1),
});

export type TokenRequestInput = z.infer<typeof tokenRequestSchema>;
