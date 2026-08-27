// Shared Hono context typing — every route/middleware file uses this so `c.get("userId")` is
// typed consistently across the app.
export type AppEnv = {
  Variables: {
    userId: string;
  };
};

// Separate context typing for the /api/admin routes — admin auth is its own token/middleware
// (middleware/adminAuth.ts), never mixed with the human-session `userId` above.
export type AdminEnv = {
  Variables: {
    admin: true;
  };
};
