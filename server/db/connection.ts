import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ENV } from '../_core/env';

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      console.log("[Database] Connecting to PostgreSQL...");
      _client = postgres(process.env.DATABASE_URL, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 30,
        max_lifetime: 60 * 10,
      });
      _db = drizzle(_client);
      console.log("[Database] Connected successfully");
    } catch (error) {
      console.error("[Database] Failed to connect:", error);
      _db = null;
      _client = null;
    }
  }
  return _db;
}
