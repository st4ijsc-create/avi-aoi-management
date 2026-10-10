/**
 * doc 81 Đợt 4 Task A1 — resolve WHERE a command lands, for the safety-PLC preflight.
 *
 * Before Đợt 4 the preflight read every enabled safety-PLC config (R-1C-b): one real PLC offline on
 * line 2 refused every real write on line 1. The matcher (safetyPreflightPolicy.plcConfigAppliesToTarget)
 * now keeps only the configs that guard the target; this module builds that target.
 *
 * Ruling R-4-c (fail-closed): anything that cannot be resolved returns `null`, and `null` means
 * "every config applies" (the pre-Đợt-4 set) — a resolution failure can never make the set SMALLER.
 * Fix round 1 (R-4-d): the WRITTEN adapter's machine is always a target (never replaced by the caller's
 * machineId); the caller's machineId / robotId add their own targets (union). See resolveSafetyTargets.
 * Shared by the gate (adapterFacade.getSafetyStatus) and the Safety panel (safetySourceHealth) so the
 * panel predicts with the same target.
 */
import { sql } from "drizzle-orm";
import type { SafetyTarget } from "./safetyPreflightPolicy";

export interface SafetyTargetRef {
  /** device_adapters.id; ≤ 0 (ROBOT_NO_OT_ADAPTER_ID) ⇒ no adapter. */
  adapterId?: number | null;
  machineId?: number | null;
  robotId?: number | null;
}

type Num = number | string | null;
const n = (v: Num | undefined): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function rows<T>(d: { execute: (q: unknown) => Promise<unknown> }, q: unknown): Promise<T[]> {
  const r = (await d.execute(q)) as unknown;
  if (Array.isArray(r)) return r as T[];
  const maybe = (r as { rows?: unknown })?.rows;
  return Array.isArray(maybe) ? (maybe as T[]) : [];
}

type Exec = { execute: (q: unknown) => Promise<unknown> };

/** machine => station => line => workshop => factory, one join; any missing link => null. */
async function resolveMachine(d: Exec, machineId: number): Promise<SafetyTarget | null> {
  const [m] = await rows<{ stationId: Num; lineId: Num; factoryId: Num }>(
    d,
    sql`SELECT s.id AS "stationId", l.id AS "lineId", w."factoryId"
        FROM machines m
        JOIN stations s ON s.id = m."stationId"
        JOIN production_lines l ON l.id = s."lineId"
        JOIN workshops w ON w.id = l."workshopId"
        WHERE m.id = ${machineId}`,
  );
  const stationId = n(m?.stationId);
  const lineId = n(m?.lineId);
  const factoryId = n(m?.factoryId);
  if (stationId === null || lineId === null || factoryId === null) return null;
  return { robotId: null, machineId, stationId, lineId, factoryId, stationRobotIds: [], lineLevelRobotIds: [], lineRobotIds: [] };
}

/** robot => its station (=> line) or line; unplaced / contradictory / dangling => null. */
async function resolveRobot(d: Exec, robotId: number): Promise<SafetyTarget | null> {
  const [r] = await rows<{ stationId: Num; lineId: Num; stationLine: Num; stationFound: boolean | null }>(
    d,
    sql`SELECT r."stationId", r."lineId", s."lineId" AS "stationLine", (s.id IS NOT NULL) AS "stationFound"
        FROM robots r LEFT JOIN stations s ON s.id = r."stationId" WHERE r.id = ${robotId}`,
  );
  if (!r) return null; // unknown robot
  const stationId = n(r.stationId);
  const robotLine = n(r.lineId);
  let lineId: number | null;
  if (stationId !== null) {
    if (r.stationFound !== true) return null; // dangling station id
    const stationLine = n(r.stationLine);
    if (stationLine === null) return null;
    if (robotLine !== null && robotLine !== stationLine) return null; // contradictory placement
    lineId = stationLine;
  } else {
    lineId = robotLine;
  }
  if (lineId === null) return null; // unplaced robot
  const [l] = await rows<{ factoryId: Num }>(
    d,
    sql`SELECT w."factoryId" FROM production_lines l JOIN workshops w ON w.id = l."workshopId" WHERE l.id = ${lineId}`,
  );
  const factoryId = n(l?.factoryId);
  if (factoryId === null) return null;
  return { robotId, machineId: null, stationId, lineId, factoryId, stationRobotIds: [], lineLevelRobotIds: [], lineRobotIds: [] };
}

/**
 * doc 81 Đợt 4 fix round 1 (ruling R-4-d) — the targets a safety preflight must cover:
 *   • the target actually WRITTEN, derived SERVER-SIDE from the adapter (device_adapters.machineId => its chain) —
 *     a caller-supplied machineId can never replace it;
 *   • PLUS the caller's machineId and/or robotId target when given (UNION — more configs, never fewer);
 *   • any requested part that cannot be resolved (adapter row missing, adapter bound to no machine, unknown
 *     machine/robot, broken chain, DB error) or nothing requested => null => EVERY config applies.
 * Never throws.
 */
export async function resolveSafetyTargets(ref: SafetyTargetRef): Promise<SafetyTarget[] | null> {
  try {
    const robotId = ref.robotId != null && ref.robotId > 0 ? ref.robotId : null;
    const machineId = ref.machineId != null && ref.machineId > 0 ? ref.machineId : null;
    const adapterId = ref.adapterId != null && ref.adapterId > 0 ? ref.adapterId : null;
    if (robotId === null && machineId === null && adapterId === null) return null;

    const { getDb } = await import("../../db/connection");
    const d = (await getDb()) as unknown as Exec | null;
    if (!d || typeof d.execute !== "function") return null;

    const out: SafetyTarget[] = [];
    if (adapterId !== null) {
      const [a] = await rows<{ machineId: Num }>(d, sql`SELECT "machineId" FROM device_adapters WHERE id = ${adapterId}`);
      if (!a) return null; // adapter unknown
      const written = n(a.machineId);
      if (written === null) return null; // adapter bound to no machine: the written target is unknown
      const t = await resolveMachine(d, written);
      if (!t) return null;
      out.push(t);
    }
    if (machineId !== null && !out.some((t) => t.machineId === machineId)) {
      const t = await resolveMachine(d, machineId);
      if (!t) return null;
      out.push(t);
    }
    if (robotId !== null) {
      const t = await resolveRobot(d, robotId);
      if (!t) return null;
      out.push(t);
    }
    if (out.length === 0) return null;
    // fix round 2 (M7) — the robots placed on each target's station: their robot-targeted configs guard it too.
    // fix round 3 (R-4-o) — and the robots of each target's LINE (on a station of the line, or line-level only).
    for (const t of out) {
      const rs = await rows<{ id: Num; stationId: Num; onLine: Num }>(
        d,
        sql`SELECT r.id, r."stationId", COALESCE(s."lineId", r."lineId") AS "onLine"
            FROM robots r LEFT JOIN stations s ON s.id = r."stationId"
            WHERE s."lineId" = ${t.lineId} OR (r."stationId" IS NULL AND r."lineId" = ${t.lineId})
            ORDER BY r.id`,
      );
      const ids = (pred: (r: { id: Num; stationId: Num }) => boolean) =>
        rs.filter(pred).map((r) => n(r.id)).filter((x): x is number => x !== null);
      t.stationRobotIds = t.stationId === null ? [] : ids((r) => n(r.stationId) === t.stationId);
      t.lineLevelRobotIds = ids((r) => n(r.stationId) === null);
      t.lineRobotIds = ids(() => true);
    }
    return out;
  } catch {
    return null; // fail-closed: every config applies
  }
}
