/**
 * doc 54 A3 — one-time backfill: encrypt any existing PLAINTEXT broker passwords in
 * mqtt_client_profiles at rest (AES-256-GCM via secretBox). Idempotent — rows already
 * `enc:v1:` or null are skipped. Uses the SAME key the server uses (secretBox reads
 * SECRET_ENCRYPTION_KEY, else derives from JWT_SECRET), so the running server can decrypt.
 *
 *   npx tsx scripts/backfill-broker-passwords.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { encryptSecret, isEncrypted } from "../server/services/security/secretBox";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql<{ id: number; password: string | null }[]>`
      SELECT id, password FROM mqtt_client_profiles WHERE password IS NOT NULL AND password <> ''`;
    let done = 0, skipped = 0;
    for (const r of rows) {
      if (!r.password || isEncrypted(r.password)) { skipped++; continue; }
      const enc = encryptSecret(r.password);
      await sql`UPDATE mqtt_client_profiles SET password = ${enc} WHERE id = ${r.id}`;
      done++;
    }
    console.log(`[backfill-broker-passwords] encrypted ${done}, already-encrypted/skipped ${skipped}, total ${rows.length}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
