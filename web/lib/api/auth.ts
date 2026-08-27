import { apiFetch } from "@/lib/api/client";
import type { User } from "@/lib/types";

type AuthResponse = { user: User; token: string };

export function signup(data: {
  name: string;
  email: string;
  phone: string;
  password: string;
}) {
  return apiFetch<AuthResponse>("/api/auth/signup", {
    method: "POST",
    body: data,
  });
}

export function login(data: { email: string; password: string }) {
  return apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: data,
  });
}

export function getMe(token: string) {
  return apiFetch<{ user: User }>("/api/auth/me", { token });
}

// Not implemented by the backend yet — see backend/issues.md. Calling this
// will fail until PATCH /api/auth/me is added there.
export function updateProfile(
  token: string,
  data: Partial<{ name: string; email: string; phone: string }>
) {
  return apiFetch<{ user: User }>("/api/auth/me", {
    method: "PATCH",
    token,
    body: data,
  });
}
