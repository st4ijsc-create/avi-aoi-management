import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ENV } from '../_core/env';

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      console.log("[Database] Connecting to PostgreSQL...");
      // G0: statement_timeout chống truy vấn treo (feature-flag qua ENV, mặc định 30s).
      // Đặt 0 để tắt. Áp dụng ở cấp connection để mọi query đều có trần thời gian.
      const stmtTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30000);
      _client = postgres(process.env.DATABASE_URL, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 30,
        max_lifetime: 60 * 10,
        connection: stmtTimeoutMs > 0
          ? { statement_timeout: stmtTimeoutMs }
          : undefined,
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
