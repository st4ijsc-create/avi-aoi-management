/**
 * DORA service — DB I/O + flag wiring around the pure math in dora.ts
 * (doc 44 W6-4 · gap G5.20; SYNAPSE_Tang5 Ch.15).
 *
 * Records deployment events (from a CI/CD hook OR a manual admin API) into
 * `deployment_events` (migration 0267) and computes the four DORA keys over a
 * rolling window.
 *
 * Posture:
 *   • WRITE is gated by DORA_ENABLED (default OFF → recordDeployment no-ops honestly).
 *   • READ is always safe: when the table is absent OR empty, metrics degrade to the
 *     `no_data` band — numbers are NEVER invented.
 *   • Raw SQL wrapped in try/catch (fail-open), mirroring defectCorrelationService — so
 *     the feature is safe to ship before the migration is applied or the flag is flipped.
 */
import { computeDoraMetrics, type DeploymentEvent, type DeploymentStatus, type DoraMetrics } from "./dora";

/** doc 44 G5.20 — DORA write path is gated (default OFF). Reads are always allowed. */
export function doraEnabled(): boolean {
  return process.env.DORA_ENABLED === "true" || process.env.DORA_ENABLED === "1";
}

const VALID_STATUS: readonly DeploymentStatus[] = ["success", "failed", "rolled_back"];

export interface RecordDeploymentInput {
  version?: string | null;
  commitSha?: string | null;
  environment?: string | null;
  service?: string | null;
  status?: DeploymentStatus;
  deployedBy?: string | null;
  deployedAt?: Date | string | null;
  leadTimeMs?: number | null;
  meta?: Record<string, unknown> | null;
}

export interface RecordDeploymentResult {
  recorded: boolean;
  id?: number;
  reason?: string;
}

/**
 * Record a deployment event. No-op (recorded:false) when DORA_ENABLED is off or the
 * table is absent — never throws into the caller (CI hook / admin API).
 */
export async function recordDeployment(input: RecordDeploymentInput): Promise<RecordDeploymentResult> {
  if (!doraEnabled()) return { recorded: false, reason: "DORA_DISABLED" };
  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (!db) return { recorded: false, reason: "NO_DB" };
    const { sql } = await import("drizzle-orm");

    const status: DeploymentStatus = VALID_STATUS.includes(input.status as DeploymentStatus)
      ? (input.status as DeploymentStatus)
      : "success";
    const environment = (input.environment ?? "production").slice(0, 64);
    const deployedAt =
      input.deployedAt instanceof Date
        ? input.deployedAt
        : input.deployedAt
          ? new Date(input.deployedAt)
          : new Date();
    const leadTimeMs =
      typeof input.leadTimeMs === "number" && Number.isFinite(input.leadTimeMs) && input.leadTimeMs >= 0
        ? Math.floor(input.leadTimeMs)
        : null;
    const meta = input.meta && typeof input.meta === "object" ? input.meta : {};

    const res = await db.execute(sql`
      INSERT INTO deployment_events
        (version, commit_sha, environment, service, status, deployed_by, deployed_at, lead_time_ms, meta)
      VALUES (
        ${input.version ?? null}, ${input.commitSha ?? null}, ${environment}, ${input.service ?? null},
        ${status}, ${input.deployedBy ?? null}, ${deployedAt}, ${leadTimeMs}, ${JSON.stringify(meta)}::jsonb
      )
      RETURNING id
    `);
    const rows = ((res as { rows?: unknown[] })?.rows ?? res ?? []) as Array<Record<string, unknown>>;
    const id = Array.isArray(rows) && rows.length ? Number(rows[0].id) : undefined;
    return { recorded: true, id };
  } catch (err: any) {
    // Table absent / DB error → honest no-op (do not fail a deploy hook).
    // data-raw-ok: DORA ghi nhận KHÔNG THÀNH (`recorded: false`) — không được làm hỏng một
    // lượt deploy vì chuyện đo đạc. `reason` đi vào bảng số liệu kỹ thuật, không lên màn hình.
    return { recorded: false, reason: err?.message ? String(err.message).slice(0, 200) : "DB_ERROR" };
  }
}

/** Read recent deployment events (raw SQL, fail-open → [] when absent). */
export async function listDeployments(opts: { environment?: string; limit?: number; windowDays?: number } = {}): Promise<
  DeploymentEvent[]
> {
  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (!db) return [];
    const { sql } = await import("drizzle-orm");
    const limit = Math.min(Math.max(1, opts.limit ?? 500), 2000);
    const windowDays = Math.min(Math.max(1, opts.windowDays ?? 90), 365);
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const env = opts.environment ?? null;

    const res = await db.execute(sql`
      SELECT id, version, commit_sha, environment, service, status, deployed_by, deployed_at, lead_time_ms
      FROM deployment_events
      WHERE deployed_at >= ${cutoff.toISOString()}
        AND (${env}::text IS NULL OR environment = ${env})
      ORDER BY deployed_at DESC
      LIMIT ${limit}
    `);
    const rows = ((res as { rows?: unknown[] })?.rows ?? res ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return [];
    return rows.map(mapRow);
  } catch {
    return []; // table absent → no data
  }
}

function mapRow(row: Record<string, unknown>): DeploymentEvent {
  const raw = row.lead_time_ms;
  return {
    id: row.id != null ? Number(row.id) : undefined,
    version: (row.version as string | null) ?? null,
    commitSha: (row.commit_sha as string | null) ?? null,
    environment: String(row.environment ?? "production"),
    service: (row.service as string | null) ?? null,
    status: (row.status as DeploymentStatus) ?? "success",
    deployedBy: (row.deployed_by as string | null) ?? null,
    deployedAt: row.deployed_at instanceof Date ? row.deployed_at : new Date(String(row.deployed_at)),
    leadTimeMs: raw != null ? Number(raw) : null,
  };
}

/**
 * Compute the four DORA metrics over a rolling window. Fail-open: an absent table or
 * empty log yields an all-`no_data` result rather than an error.
 */
export async function getDoraMetrics(opts: { environment?: string; windowDays?: number } = {}): Promise<DoraMetrics> {
  const windowDays = Math.min(Math.max(1, opts.windowDays ?? 30), 365);
  const events = await listDeployments({ environment: opts.environment, windowDays, limit: 2000 });
  return computeDoraMetrics(events, { windowDays });
}
