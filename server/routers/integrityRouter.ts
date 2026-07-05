/**
 * W3-A (doc 27 §2 M1/M6/M11 — Đợt 3 item 3.1) — Master-data INTEGRITY admin API.
 *
 * Surfaces the two-phase FK/unique rollout (migrations 0179 orphan audit + 0180
 * conditional enforcement) to administrators:
 *   • summary — per relationship: the REAL DB enforcement state (pg_constraint
 *     convalidated / pg_indexes) + the latest orphan/duplicate scan snapshot
 *     from integrity_scan_results + scheduler status. Read-only, fail-safe.
 *   • runNow  — trigger an on-demand scan (writes a fresh snapshot).
 *   • history — recent scan rows for one relationship (trend while repairing).
 *
 * RBAC: admin-only (schema-level integrity is a DBA concern; sample ids may
 * reference any tenant's rows).
 */
import { z } from "zod";
import { sql } from "drizzle-orm";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db/connection";
import {
  INTEGRITY_RELATIONSHIPS,
  getConstraintStates,
  getIntegrityScanSchedulerStatus,
  runIntegrityScanNow,
} from "../services/integrityScanService";

interface LastScanRow {
  scanKey: string;
  violationCount: number;
  sampleIds: unknown;
  scanSource: string;
  scannedAt: Date | string;
}

export const integrityRouter = router({
  /** Enforcement + latest-scan overview for every governed relationship. */
  summary: adminProcedure.query(async () => {
    const db = await getDb();
    const scheduler = getIntegrityScanSchedulerStatus();

    // Latest scan row per key (fail-safe: table may predate migration 0179).
    let lastScans = new Map<string, LastScanRow>();
    if (db) {
      try {
        const rows = (await db.execute(sql`
          SELECT DISTINCT ON ("scanKey")
            "scanKey" AS "scanKey", "violationCount" AS "violationCount",
            "sampleIds" AS "sampleIds", "scanSource" AS "scanSource", "scannedAt" AS "scannedAt"
          FROM integrity_scan_results
          ORDER BY "scanKey", "scannedAt" DESC`)) as unknown as LastScanRow[];
        lastScans = new Map(rows.map((r) => [r.scanKey, r]));
      } catch (err) {
        console.warn("[integrityRouter] integrity_scan_results unavailable (run migration 0179?):", (err as Error)?.message);
      }
    }

    const states = new Map((await getConstraintStates()).map((s) => [s.key, s]));

    const relationships = INTEGRITY_RELATIONSHIPS.map((rel) => {
      const state = states.get(rel.key);
      const last = lastScans.get(rel.key);
      return {
        key: rel.key,
        kind: rel.kind,
        childTable: rel.childTable,
        childColumn: rel.childColumn,
        parentTable: rel.parentTable ?? null,
        parentColumn: rel.parentColumn ?? null,
        enforcement: rel.enforcement,
        repair: rel.repair,
        constraintName: rel.constraintName,
        // Real DB state: 'validated' | 'not-valid' (new writes checked, legacy
        // rows unverified) | 'missing' (deferred/skipped — scanner-covered).
        dbState: !state || !state.exists ? "missing" : state.validated ? "validated" : "not-valid",
        lastScan: last
          ? {
              violationCount: Number(last.violationCount),
              samples: last.sampleIds ?? [],
              scanSource: last.scanSource,
              scannedAt: last.scannedAt instanceof Date ? last.scannedAt.toISOString() : String(last.scannedAt),
            }
          : null,
      };
    });

    return {
      relationships,
      scheduler,
      totals: {
        relationships: relationships.length,
        validated: relationships.filter((r) => r.dbState === "validated").length,
        notValid: relationships.filter((r) => r.dbState === "not-valid").length,
        missing: relationships.filter((r) => r.dbState === "missing").length,
        dirty: relationships.filter((r) => (r.lastScan?.violationCount ?? 0) > 0).length,
      },
      generatedAt: new Date().toISOString(),
    };
  }),

  /** Run the orphan/duplicate scan now (single-flight; result also persisted). */
  runNow: adminProcedure.mutation(async () => {
    return runIntegrityScanNow("manual");
  }),

  /** Recent scan snapshots for one relationship key (repair-progress trend). */
  history: adminProcedure
    .input(z.object({
      key: z.string().min(1).max(160),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [] };
      try {
        const rows = (await db.execute(sql`
          SELECT "violationCount" AS "violationCount", "sampleIds" AS "sampleIds",
                 "scanSource" AS "scanSource", "scannedAt" AS "scannedAt"
          FROM integrity_scan_results
          WHERE "scanKey" = ${input.key}
          ORDER BY "scannedAt" DESC
          LIMIT ${input.limit}`)) as unknown as Array<Record<string, unknown>>;
        return { rows };
      } catch (err) {
        console.warn("[integrityRouter] history query failed:", (err as Error)?.message);
        return { rows: [] };
      }
    }),
});
