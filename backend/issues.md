# Known gaps found while integrating `web/`

## ~~Missing: profile update endpoint~~ — resolved

`PATCH /api/auth/me` is implemented (`src/routes/auth.ts`, `userService.updateUser`), matching
the spec below exactly, and documented in `API.md` §6.3a. Verified: partial update, `GET
/api/auth/me` reflects the change, malformed email returns the standard Zod `400`, email
collision with another account returns `409 CONFLICT`, and the route is 401 without a token.

<details>
<summary>Original spec</summary>

`PATCH /api/auth/me`

- Auth required (same `requireAuth` middleware as the rest of `/api/auth/me`, `/api/addresses*`, etc).
- Body: any subset of `{ name: string; email: string; phone: string }` (all optional, at least one
  expected — mirror the partial-update convention already used by `PATCH /api/addresses/:id`).
- On success: `200 { "user": User }` (same `User` shape as signup/login/`GET /api/auth/me`).
- On email collision with another user's account: `409 { "error": "...", "code": "CONFLICT" }`
  (same convention as signup).
- Validation errors (e.g. malformed email): standard Zod `400` shape per `API.md` §3.

Implementation should follow the existing service-layer convention in `backend/CLAUDE.md` —
add the update logic to `userService.ts`, keep the route handler in `routes/auth.ts` thin.

</details>
