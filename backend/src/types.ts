// Shared Hono context typing, so `c.get("userId")` is typed the same everywhere.
export type AppEnv = {
  Variables: {
    userId: string;
  };
};

// /api/admin routes only. Admin auth is its own token/middleware and never sets `userId`.
export type AdminEnv = {
  Variables: {
    admin: true;
  };
};
