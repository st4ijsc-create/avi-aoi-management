/**
 * DB requirements check (doc 27 §11 decision #1 — TimescaleDB MANDATORY on the
 * MAIN DB).
 *
 * Runs once at server bootstrap. Verifies that the main database has the
 * `timescaledb` extension installed and that the inspection-core tables were
 * converted to hypertables by migration 0172. When the requirement is unmet
 * (e.g. dev on native Windows PG where the extension does not exist), it logs
 * a PROMINENT error banner — loud, on every startup, greppable — so the gap
 * cannot silently persist the way migration 0118's no-op did (gap R2).
 *
 * Deliberately NON-FATAL: dev environments must keep starting. Production is
 * expected to run on timescale/timescaledb-ha (see docker-compose.yml and
 * scripts/migrate-to-timescaledb.md).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";

/** Tables migration 0172 must have converted to hypertables. */
const REQUIRED_HYPERTABLES = [
  "product_inspections",
  "measurement_results",
  "ot_telemetry",
  "oee_metrics",
  "machine_heartbeats",
  "process_results",
] as const;

export interface DbRequirementsResult {
  timescaledbInstalled: boolean;
  hypertables: string[];
  missingHypertables: string[];
  ok: boolean;
}

function banner(lines: string[]): string {
  const bar = "═".repeat(78);
  return ["", bar, ...lines.map((l) => `  ${l}`), bar, ""].join("\n");
}

/**
 * Check the main DB against doc 27 decision #1. Logs an error banner when the
 * requirement is unmet; a single OK line when met. Never throws.
 */
export async function checkDbRequirements(): Promise<DbRequirementsResult> {
  const result: DbRequirementsResult = {
    timescaledbInstalled: false,
    hypertables: [],
    missingHypertables: [...REQUIRED_HYPERTABLES],
    ok: false,
  };

  const db = await getDb();
  if (!db) return result; // no DB configured — nothing sensible to report here

  try {
    const ext = (await db.execute(
      sql`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS installed`,
    )) as unknown as Array<{ installed: boolean }>;
    result.timescaledbInstalled = Boolean(ext?.[0]?.installed);

    if (result.timescaledbInstalled) {
      const rows = (await db.execute(
        sql`SELECT hypertable_name FROM timescaledb_information.hypertables
            WHERE hypertable_schema = 'public'`,
      )) as unknown as Array<{ hypertable_name: string }>;
      const present = new Set(rows.map((r) => r.hypertable_name));
      result.hypertables = REQUIRED_HYPERTABLES.filter((t) => present.has(t));
      result.missingHypertables = REQUIRED_HYPERTABLES.filter((t) => !present.has(t));
    }
  } catch (err: any) {
    console.error("[DbRequirements] check failed:", err?.message ?? err);
    return result;
  }

  result.ok = result.timescaledbInstalled && result.missingHypertables.length === 0;

  if (!result.timescaledbInstalled) {
    console.error(
      banner([
        "‼️  TimescaleDB required by doc 27 decision #1 — inspection tables are UNPARTITIONED",
        "",
        "The main DB has NO timescaledb extension, so product_inspections /",
        "measurement_results / telemetry tables grow without partitioning and the",
        "native 12-month retention (migration 0173, decision #2) is NOT active.",
        "App-level dataRetentionService is the only thing pruning them right now.",
        "",
        "FIX: move the main DB to timescale/timescaledb-ha (ships timescaledb +",
        "pgvector) and re-apply migration 0172. Runbook: scripts/migrate-to-timescaledb.md",
      ]),
    );
  } else if (result.missingHypertables.length > 0) {
    console.error(
      banner([
        "‼️  TimescaleDB present but migration 0172 incomplete (doc 27 decision #1)",
        "",
        `Not hypertables yet: ${result.missingHypertables.join(", ")}`,
        "Re-apply drizzle/0172_inspection_hypertables.sql (node run-0172-0173-migration.mjs).",
      ]),
    );
  } else {
    console.log(
      `[DbRequirements] OK — TimescaleDB installed, ${result.hypertables.length}/${REQUIRED_HYPERTABLES.length} required hypertables present (doc 27 decision #1 met)`,
    );
  }

  return result;
}
