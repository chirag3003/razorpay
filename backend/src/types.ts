// Shared Hono context typing — every route/middleware file uses this so `c.get("userId")` is
// typed consistently across the app.
export type AppEnv = {
  Variables: {
    userId: string;
  };
};
