/**
 * Doc 35 W4-C.2 — MSD floor-life clock (J-STD-020).
 *
 * Moisture-sensitive devices (MSD) have a limited floor-life once removed from dry
 * storage. This service opens an exposure log when a reel is removed, derives the
 * allowed floor-life hours from the J-STD-020 MSL level, and computes remaining
 * floor-life + an advisory status (ok|warning|expired|baking).
 *
 * SAFETY / GATING: ADVISORY only — there is NO hard enforcement. Any scheduler that
 * periodically re-evaluates / raises alerts is gated by MSD_TRACKING_ENABLED
 * (DEFAULT OFF). Opening/closing/baking + status queries work regardless of the flag.
 */
import { getDb } from "../db";
import { eq, desc, isNull } from "drizzle-orm";
import { msdExposureLogs, type InsertMsdExposureLog } from "../../drizzle/schema";

export type MsdStatus = "ok" | "warning" | "expired" | "baking";
export type MslLevel = "1" | "2" | "2a" | "3" | "4" | "5" | "5a" | "6";

/**
 * J-STD-020 MSL level → allowed floor-life in HOURS (at ≤30°C / 60%RH).
 *   1  → unlimited        (null)
 *   2  → 1 year   = 8760h
 *   2a → 4 weeks  = 672h
 *   3  → 168h
 *   4  → 72h
 *   5  → 48h
 *   5a → 24h
 *   6  → "Time On Label" → mandatory bake before use → 0h of floor-life.
 */
export const MSL_FLOOR_LIFE_HOURS: Record<MslLevel, number | null> = {
  "1": null,
  "2": 8760,
  "2a": 672,
  "3": 168,
  "4": 72,
  "5": 48,
  "5a": 24,
  "6": 0,
};

/** Warn when remaining floor-life drops to/below this fraction of the allowance. */
const WARNING_FRACTION = 0.2;

export function isMsdTrackingEnabled(): boolean {
  return process.env.MSD_TRACKING_ENABLED === "true" || process.env.MSD_TRACKING_ENABLED === "1";
}

/** Normalize a raw MSL string (e.g. "2A", " 5a ") to a canonical level, or null. */
export function normalizeMslLevel(raw: string | null | undefined): MslLevel | null {
  if (raw == null) return null;
  const k = String(raw).trim().toLowerCase();
  return (k in MSL_FLOOR_LIFE_HOURS ? (k as MslLevel) : null);
}

export function floorLifeHoursForMsl(level: string | null | undefined): number | null {
  const norm = normalizeMslLevel(level);
  if (norm == null) return null; // unknown level → treat as unlimited/unknown (no clock)
  return MSL_FLOOR_LIFE_HOURS[norm];
}

export interface MsdComputation {
  allowedHours: number | null;   // null = unlimited (MSL 1) or unknown
  exposedHours: number;          // hours accrued since removal (or up to closedAt/bakeStartedAt)
  remainingHours: number | null; // null when unlimited
  status: MsdStatus;
}

/**
 * Compute exposed / remaining floor-life + status for one exposure. When baking is
 * in progress (bakeStartedAt set, not yet closed) the status is 'baking' and the
 * floor-life clock is considered stopped at bakeStartedAt.
 */
export function computeMsdStatus(args: {
  removedFromDryAt: Date;
  mslLevel: string;
  now?: Date;
  bakeStartedAt?: Date | null;
  closedAt?: Date | null;
}): MsdComputation {
  const now = args.now ?? new Date();
  const allowedHours = floorLifeHoursForMsl(args.mslLevel);

  // The clock stops at the earliest of: closedAt (returned to dry), bakeStartedAt
  // (bake resets/pauses exposure), or now.
  const stopAt = args.closedAt ?? args.bakeStartedAt ?? now;
  const exposedMs = Math.max(0, stopAt.getTime() - args.removedFromDryAt.getTime());
  const exposedHours = exposedMs / 3_600_000;

  if (args.bakeStartedAt && !args.closedAt) {
    return { allowedHours, exposedHours, remainingHours: allowedHours == null ? null : Math.max(0, allowedHours - exposedHours), status: "baking" };
  }

  if (allowedHours == null) {
    return { allowedHours: null, exposedHours, remainingHours: null, status: "ok" };
  }

  const remainingHours = allowedHours - exposedHours;
  let status: MsdStatus;
  if (remainingHours <= 0) status = "expired";
  else if (remainingHours <= allowedHours * WARNING_FRACTION) status = "warning";
  else status = "ok";

  return { allowedHours, exposedHours, remainingHours: Math.max(0, remainingHours), status };
}

export interface OpenExposureInput {
  componentCode: string;
  reelId?: string | null;
  materialId?: number | null;
  mslLevel: string;
  removedFromDryAt?: Date;      // defaults to now
  machineId?: number | null;
  loggedBy?: number | null;
  notes?: string | null;
}

/** Open a new MSD exposure (starts the floor-life clock). */
export async function openExposure(input: OpenExposureInput) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const removedFromDryAt = input.removedFromDryAt ?? new Date();
  const allowedHours = floorLifeHoursForMsl(input.mslLevel);
  const comp = computeMsdStatus({ removedFromDryAt, mslLevel: input.mslLevel });

  const values: InsertMsdExposureLog = {
    componentCode: input.componentCode,
    reelId: input.reelId ?? null,
    materialId: input.materialId ?? null,
    mslLevel: normalizeMslLevel(input.mslLevel) ?? String(input.mslLevel),
    removedFromDryAt,
    floorLifeHoursAllowed: allowedHours == null ? null : String(allowedHours),
    exposedHoursAccrued: comp.exposedHours.toFixed(2),
    status: comp.status,
    machineId: input.machineId ?? null,
    loggedBy: input.loggedBy ?? null,
    notes: input.notes ?? null,
  };

  const [row] = await db.insert(msdExposureLogs).values(values).returning({ id: msdExposureLogs.id });
  return { id: row.id, ...comp };
}

/** Mark a bake started for an exposure (status → baking; floor-life clock pauses). */
export async function startBake(id: number, bakeStartedAt?: Date) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const when = bakeStartedAt ?? new Date();
  await db
    .update(msdExposureLogs)
    .set({ bakeStartedAt: when, status: "baking", updatedAt: new Date() })
    .where(eq(msdExposureLogs.id, id));
  return { success: true };
}

/** Close an exposure (reel returned to dry storage — clock stops). */
export async function closeExposure(id: number, closedAt?: Date) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const when = closedAt ?? new Date();

  const [existing] = await db.select().from(msdExposureLogs).where(eq(msdExposureLogs.id, id)).limit(1);
  if (!existing) throw new Error("MSD exposure not found");

  const comp = computeMsdStatus({
    removedFromDryAt: existing.removedFromDryAt,
    mslLevel: existing.mslLevel,
    bakeStartedAt: existing.bakeStartedAt,
    closedAt: when,
  });

  await db
    .update(msdExposureLogs)
    .set({ closedAt: when, exposedHoursAccrued: comp.exposedHours.toFixed(2), updatedAt: new Date() })
    .where(eq(msdExposureLogs.id, id));
  return { success: true, ...comp };
}

type MsdRow = typeof msdExposureLogs.$inferSelect;
type MsdRowWithComputed = MsdRow & MsdComputation;

function withComputed(row: MsdRow, now: Date): MsdRowWithComputed {
  const comp = computeMsdStatus({
    removedFromDryAt: row.removedFromDryAt,
    mslLevel: row.mslLevel,
    bakeStartedAt: row.bakeStartedAt,
    closedAt: row.closedAt,
    now,
  });
  return { ...row, ...comp };
}

/** List OPEN exposures (not yet closed) with live computed status. */
export async function listActive(): Promise<MsdRowWithComputed[]> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db
    .select()
    .from(msdExposureLogs)
    .where(isNull(msdExposureLogs.closedAt))
    .orderBy(desc(msdExposureLogs.removedFromDryAt));
  const now = new Date();
  return rows.map((r) => withComputed(r, now));
}

/**
 * Open exposures whose live status is 'warning' or 'expired' — i.e. remaining
 * floor-life is at/below the warning threshold. Computed in-app (not in SQL) so
 * the MSL→hours policy stays in one place.
 */
export async function expiringSoon(): Promise<MsdRowWithComputed[]> {
  const active = await listActive();
  return active.filter((r) => r.status === "warning" || r.status === "expired");
}
