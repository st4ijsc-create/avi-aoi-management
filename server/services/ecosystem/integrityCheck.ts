/**
 * U6-c (doc 21 §6 U6 / G-12) — READ-ONLY soft-reference integrity checker.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The canonical asset↔task↔program↔genealogy links are `integer("machineId")` /
 * `integer("...Id")` / `varchar("...Code")` SOFT-REFS — they carry NO database
 * FK (`.references()`), integrity is app-enforced. Bulk-adding real FKs is risky
 * (a single orphan row would fail the migration and there is no safe place to
 * put it), so G-12 is closed instead with:
 *
 *   (1) a documented SOFT-REF CONTRACT (doc 21 §6 U6 — which column references
 *       which table, app-enforced), and
 *   (2) THIS read-only checker that scans the key soft-refs and REPORTS orphans
 *       (a non-null ref that points at a row that does not exist), exposed via a
 *       small admin tRPC read procedure (adminRouter.softRefIntegrity).
 *
 * This gives integrity VISIBILITY (an operator can see + fix drift) WITHOUT the
 * risky FK migration and WITHOUT changing any write path. It is strictly
 * read-only: SELECT-only, never mutates, DB-absent → honest empty result.
 *
 * The checked soft-refs (the CONTRACT, mirrored in doc 21 §6):
 *   • tasks.assignedDeviceId        → robots.id      (only when assignedDeviceKind='robot')
 *   • program_projects.deviceId     → machines.id  ∪  robots.id  (either registry)
 *   • genealogy_chain.stationCode   → stations.code  (varchar soft-ref)
 *   • safety_events.robotId         → robots.id
 * ════════════════════════════════════════════════════════════════════════════
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";

/** One soft-ref rule's orphan report. */
export interface SoftRefOrphanReport {
  /** Stable rule id, e.g. "tasks.assignedDeviceId->robots.id". */
  rule: string;
  /** Human description of the contract this rule enforces. */
  contract: string;
  /** Number of rows whose non-null ref points at a missing target. */
  orphanCount: number;
  /** A small sample of orphan source rows (id + the dangling ref value). */
  sample: Array<{ id: number | string; ref: string | number | null }>;
  /** True when the scan could not run (DB absent / query error) — honest seam. */
  skipped: boolean;
}

/** Aggregate integrity report across all checked soft-refs. */
export interface IntegrityReport {
  ok: boolean;
  totalOrphans: number;
  checkedAt: string;
  rules: SoftRefOrphanReport[];
}

const SAMPLE_LIMIT = 10;

/**
 * One rule = a raw SELECT that finds source rows whose non-null soft-ref has no
 * matching target row. Raw SQL (not the drizzle query builder) so the checker is
 * resilient to schema-object drift and works uniformly for id- and code- refs.
 * Every query is a plain SELECT — read-only.
 */
interface RuleDef {
  rule: string;
  contract: string;
  /** Count of orphans. */
  countSql: ReturnType<typeof sql>;
  /** Sample of orphan rows: { id, ref }. */
  sampleSql: ReturnType<typeof sql>;
}

function ruleDefs(): RuleDef[] {
  return [
    {
      rule: "tasks.assignedDeviceId->robots.id",
      contract:
        "tasks.assignedDeviceId references robots.id when assignedDeviceKind='robot' (app-enforced soft-ref).",
      countSql: sql`
        SELECT count(*)::int AS n
        FROM tasks t
        WHERE t."assignedDeviceId" IS NOT NULL
          AND t."assignedDeviceKind" = 'robot'
          AND NOT EXISTS (SELECT 1 FROM robots r WHERE r.id = t."assignedDeviceId")`,
      sampleSql: sql`
        SELECT t.id AS id, t."assignedDeviceId" AS ref
        FROM tasks t
        WHERE t."assignedDeviceId" IS NOT NULL
          AND t."assignedDeviceKind" = 'robot'
          AND NOT EXISTS (SELECT 1 FROM robots r WHERE r.id = t."assignedDeviceId")
        ORDER BY t.id LIMIT ${SAMPLE_LIMIT}`,
    },
    {
      rule: "program_projects.deviceId->machines.id|robots.id",
      contract:
        "program_projects.deviceId references EITHER machines.id OR robots.id (the bound device; app-enforced soft-ref).",
      countSql: sql`
        SELECT count(*)::int AS n
        FROM program_projects p
        WHERE p."deviceId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = p."deviceId")
          AND NOT EXISTS (SELECT 1 FROM robots r WHERE r.id = p."deviceId")`,
      sampleSql: sql`
        SELECT p.id AS id, p."deviceId" AS ref
        FROM program_projects p
        WHERE p."deviceId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = p."deviceId")
          AND NOT EXISTS (SELECT 1 FROM robots r WHERE r.id = p."deviceId")
        ORDER BY p.id LIMIT ${SAMPLE_LIMIT}`,
    },
    {
      rule: "genealogy_chain.stationCode->stations.code",
      contract:
        "genealogy_chain.stationCode references stations.code (varchar soft-ref; app-enforced).",
      countSql: sql`
        SELECT count(*)::int AS n
        FROM genealogy_chain g
        WHERE g."stationCode" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM stations s WHERE s.code = g."stationCode")`,
      sampleSql: sql`
        SELECT g.id AS id, g."stationCode" AS ref
        FROM genealogy_chain g
        WHERE g."stationCode" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM stations s WHERE s.code = g."stationCode")
        ORDER BY g.id LIMIT ${SAMPLE_LIMIT}`,
    },
    {
      rule: "safety_events.robotId->robots.id",
      contract:
        "safety_events.robotId references robots.id (nullable soft-ref; app-enforced).",
      countSql: sql`
        SELECT count(*)::int AS n
        FROM safety_events e
        WHERE e."robotId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM robots r WHERE r.id = e."robotId")`,
      sampleSql: sql`
        SELECT e.id AS id, e."robotId" AS ref
        FROM safety_events e
        WHERE e."robotId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM robots r WHERE r.id = e."robotId")
        ORDER BY e.id LIMIT ${SAMPLE_LIMIT}`,
    },
  ];
}

/** Extract rows from a drizzle raw-SQL execute() result across driver shapes. */
function resultRows(res: unknown): any[] {
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && Array.isArray((res as any).rows)) return (res as any).rows;
  return [];
}

/**
 * Run all soft-ref integrity rules. READ-ONLY. Never throws — a DB-absent or
 * query error yields a `skipped:true` rule (honest seam), not a crash.
 */
export async function checkSoftRefIntegrity(): Promise<IntegrityReport> {
  const checkedAt = new Date().toISOString();
  const db = await getDb().catch(() => null);
  const defs = ruleDefs();

  if (!db) {
    // DB absent → honest empty result (all rules skipped).
    return {
      ok: true,
      totalOrphans: 0,
      checkedAt,
      rules: defs.map((d) => ({
        rule: d.rule,
        contract: d.contract,
        orphanCount: 0,
        sample: [],
        skipped: true,
      })),
    };
  }

  const rules: SoftRefOrphanReport[] = [];
  for (const d of defs) {
    try {
      const countRes = await db.execute(d.countSql);
      const orphanCount = Number(resultRows(countRes)[0]?.n ?? 0);
      let sample: SoftRefOrphanReport["sample"] = [];
      if (orphanCount > 0) {
        const sampleRes = await db.execute(d.sampleSql);
        sample = resultRows(sampleRes).map((r) => ({
          id: r.id,
          ref: r.ref ?? null,
        }));
      }
      rules.push({ rule: d.rule, contract: d.contract, orphanCount, sample, skipped: false });
    } catch (err) {
      // A missing table / permission / driver hiccup → skip THIS rule honestly.
      console.error(`[integrityCheck] rule ${d.rule} failed:`, (err as Error)?.message ?? err);
      rules.push({ rule: d.rule, contract: d.contract, orphanCount: 0, sample: [], skipped: true });
    }
  }

  const totalOrphans = rules.reduce((s, r) => s + r.orphanCount, 0);
  return { ok: totalOrphans === 0, totalOrphans, checkedAt, rules };
}
