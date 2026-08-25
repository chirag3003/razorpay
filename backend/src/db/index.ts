import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env";

export const db = drizzle({ connection: env.DATABASE_URL });
