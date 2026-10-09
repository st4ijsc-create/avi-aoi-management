/**
 * doc 81 Đợt 4 Task A1 — resolve WHERE a command lands, for the safety-PLC preflight.
 *
 * Before Đợt 4 the preflight read every enabled safety-PLC config (R-1C-b): one real PLC offline on
 * line 2 refused every real write on line 1. The matcher (safetyPreflightPolicy.plcConfigAppliesToTarget)
 * now keeps only the configs that guard the target; this module builds that target.
 *
 * Ruling R-4-c (fail-closed): anything that cannot be resolved returns `null`, and `null` means
 * "every config applies" (the pre-Đợt-4 set) — a resolution failure can never make the set SMALLER.
 *   • machine (ctx.machineId, else device_adapters.machineId of the adapter) ⇒ station ⇒ line ⇒
 *     workshop ⇒ factory, in ONE join; a missing link ⇒ null;
 *   • robot ⇒ robots.stationId / robots.lineId (a station gives its line); no placement, a station
 *     whose line differs from robots.lineId, or a missing line ⇒ null;
 *   • both a robot and a machine, or neither ⇒ null;
 *   • any DB error / no DB ⇒ null. Never throws.
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

export async function resolveSafetyTarget(ref: SafetyTargetRef): Promise<SafetyTarget | null> {
  try {
    const robotId = ref.robotId != null && ref.robotId > 0 ? ref.robotId : null;
    let machineId = ref.machineId != null && ref.machineId > 0 ? ref.machineId : null;
    const adapterId = ref.adapterId != null && ref.adapterId > 0 ? ref.adapterId : null;
    if (robotId === null && machineId === null && adapterId === null) return null;

    const { getDb } = await import("../../db/connection");
    const d = (await getDb()) as unknown as { execute: (q: unknown) => Promise<unknown> } | null;
    if (!d || typeof d.execute !== "function") return null;

    if (robotId !== null) {
      if (machineId !== null) return null; // ambiguous ⇒ fail-closed
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
      return { robotId, machineId: null, stationId, lineId, factoryId };
    }

    if (machineId === null && adapterId !== null) {
      const [a] = await rows<{ machineId: Num }>(d, sql`SELECT "machineId" FROM device_adapters WHERE id = ${adapterId}`);
      machineId = n(a?.machineId);
      if (machineId === null) return null;
    }
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
    return { robotId: null, machineId, stationId, lineId, factoryId };
  } catch {
    return null; // fail-closed: every config applies
  }
}
