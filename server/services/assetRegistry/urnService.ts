/**
 * doc 44 Batch W2-A2 (gap G1.10) — Asset URN + ISA-95 path service.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SYNAPSE Tầng-1 spec §6.2 — every machine is an Asset with a canonical identity:
 *   urn        = urn:syn:asset:{site}:{line}:{cell}:{equipment}
 *   isa95_path = {site}/{area}/{line}/{cell}/{equipment}
 * Segments are SLUGS of the hierarchy codes (factory→site, workshop→area,
 * production_line→line, station→cell, machine→equipment). Slug rule is SHARED
 * with the UNS topic convention: lowercase, Vietnamese diacritics stripped,
 * only [a-z0-9-]; a missing hierarchy level → 'unassigned'.
 *
 * Persistence: machines.urn / machines.isa95_path (migration 0251 adds the
 * columns + backfills). syncAssetIdentity() recomputes + upserts for one
 * machine; it is HOOKED (fire-and-forget, never blocking the mutation) into
 * server/db/hierarchy.ts createMachine/updateMachine/approveMachine and into
 * station/line reassignment (updateStation/updateProductionLine).
 *
 * Collision handling: URN uniqueness is a PARTIAL index over ACTIVE rows
 * (uq_machines_urn_active). Two distinct active codes can slug to the same
 * segment ('AOI 01' vs 'AOI-01') — on collision the equipment segment gets a
 * deterministic '-m{id}' suffix (same rule the 0251 backfill uses).
 *
 * FAIL-SAFE: everything here is best-effort — a sync failure (e.g. migration
 * 0251 not applied yet) is swallowed with a once-per-process warning and NEVER
 * fails the machine mutation that triggered it.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, ne } from "drizzle-orm";

/** Hierarchy level fallback when a level is missing/unmapped (shared UNS convention). */
export const UNASSIGNED_SEGMENT = "unassigned";

/**
 * Slug a hierarchy/machine code for URN/path segments (shared UNS rule):
 * lowercase → strip Vietnamese diacritics (NFD + đ/Đ) → non-[a-z0-9-] runs → '-'
 * → collapse '-' runs → trim '-' → empty ⇒ 'unassigned'.
 */
export function slugSegment(raw: string | null | undefined): string {
  if (raw == null) return UNASSIGNED_SEGMENT;
  const slug = String(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || UNASSIGNED_SEGMENT;
}

/** Raw hierarchy codes for one machine (any level may be missing). */
export interface AssetIdentityCodes {
  factoryCode?: string | null;
  workshopCode?: string | null;
  lineCode?: string | null;
  stationCode?: string | null;
  machineCode?: string | null;
}

export interface AssetIdentity {
  urn: string;
  path: string;
}

/**
 * PURE builder: codes → { urn, path } (spec §6.2). Exported so the REST layer
 * can compute a fallback identity for rows the backfill/hook has not stamped yet.
 */
export function identityFromCodes(codes: AssetIdentityCodes, equipmentSuffix = ""): AssetIdentity {
  const site = slugSegment(codes.factoryCode);
  const area = slugSegment(codes.workshopCode);
  const line = slugSegment(codes.lineCode);
  const cell = slugSegment(codes.stationCode);
  const equipment = slugSegment(codes.machineCode) + equipmentSuffix;
  return {
    urn: `urn:syn:asset:${site}:${line}:${cell}:${equipment}`,
    path: `${site}/${area}/${line}/${cell}/${equipment}`,
  };
}

/** Load the hierarchy codes for one machine (LEFT joins — levels may be missing). */
async function loadCodes(machineId: number): Promise<
  | (AssetIdentityCodes & { isActive: boolean; currentUrn: string | null; currentPath: string | null })
  | null
> {
  const { getDb } = await import("../../db/connection");
  const { machines, stations, productionLines, workshops, factories } = await import("../../../drizzle/schema");
  const d = await getDb();
  if (!d) return null;
  const [row] = await d
    .select({
      machineCode: machines.code,
      isActive: machines.isActive,
      currentUrn: machines.urn,
      currentPath: machines.isa95Path,
      stationCode: stations.code,
      lineCode: productionLines.code,
      workshopCode: workshops.code,
      factoryCode: factories.code,
    })
    .from(machines)
    .leftJoin(stations, eq(machines.stationId, stations.id))
    .leftJoin(productionLines, eq(stations.lineId, productionLines.id))
    .leftJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .leftJoin(factories, eq(workshops.factoryId, factories.id))
    .where(eq(machines.id, machineId))
    .limit(1);
  return row ?? null;
}

/** Compute the canonical URN for a machine from the LIVE hierarchy (no write). */
export async function computeUrn(machineId: number): Promise<string | null> {
  const row = await loadCodes(machineId);
  return row ? identityFromCodes(row).urn : null;
}

/** Compute the canonical ISA-95 path for a machine from the LIVE hierarchy (no write). */
export async function computePath(machineId: number): Promise<string | null> {
  const row = await loadCodes(machineId);
  return row ? identityFromCodes(row).path : null;
}

/**
 * Recompute + upsert machines.urn / machines.isa95_path for one machine.
 * Collision-aware: if another ACTIVE machine already holds the computed URN the
 * equipment segment gets a '-m{id}' suffix (deterministic, matches 0251).
 * Returns the stamped identity, or null when the machine/DB is unavailable.
 * THROWS on real DB errors — fire-and-forget callers use queueAssetIdentitySync.
 */
export async function syncAssetIdentity(machineId: number): Promise<AssetIdentity | null> {
  const row = await loadCodes(machineId);
  if (!row) return null;

  const { getDb } = await import("../../db/connection");
  const { machines } = await import("../../../drizzle/schema");
  const d = await getDb();
  if (!d) return null;

  let identity = identityFromCodes(row);

  // Collision check among OTHER active machines (partial unique index scope).
  const [holder] = await d
    .select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.urn, identity.urn), eq(machines.isActive, true), ne(machines.id, machineId)))
    .limit(1);
  if (holder) identity = identityFromCodes(row, `-m${machineId}`);

  if (row.currentUrn === identity.urn && row.currentPath === identity.path) {
    return identity; // already in sync — no write
  }

  await d
    .update(machines)
    .set({ urn: identity.urn, isa95Path: identity.path, updatedAt: new Date() })
    .where(eq(machines.id, machineId));
  return identity;
}

// ── Fire-and-forget wrappers (the ONLY thing the db-layer hooks call) ─────────
// A failure (e.g. 0251 not applied yet, mocked db in tests) must NEVER surface
// into the machine mutation path — warn once per process, then stay silent.

let warnedOnce = false;
function swallow(context: string) {
  return (err: unknown): void => {
    if (warnedOnce) return;
    warnedOnce = true;
    console.warn(
      `[assetRegistry] URN sync skipped (${context}): ${(err as Error)?.message ?? err} — ` +
        "further sync warnings suppressed (is migration 0251 applied?)",
    );
  };
}

/** Fire-and-forget: sync one machine's URN/path. Never throws, never blocks. */
export function queueAssetIdentitySync(machineId: number, context = "machine"): void {
  if (!Number.isInteger(machineId) || machineId <= 0) return;
  void syncAssetIdentity(machineId).catch(swallow(context));
}

/** Fire-and-forget: resync every machine on a station (station→line reassignment/rename). */
export function queueStationAssetIdentitySync(stationId: number): void {
  if (!Number.isInteger(stationId) || stationId <= 0) return;
  void (async () => {
    const { getDb } = await import("../../db/connection");
    const { machines } = await import("../../../drizzle/schema");
    const d = await getDb();
    if (!d) return;
    const rows = await d.select({ id: machines.id }).from(machines).where(eq(machines.stationId, stationId));
    for (const r of rows) await syncAssetIdentity(r.id);
  })().catch(swallow("station"));
}

/** Fire-and-forget: resync every machine under a production line (line→workshop reassignment/rename). */
export function queueLineAssetIdentitySync(lineId: number): void {
  if (!Number.isInteger(lineId) || lineId <= 0) return;
  void (async () => {
    const { getDb } = await import("../../db/connection");
    const { machines, stations } = await import("../../../drizzle/schema");
    const d = await getDb();
    if (!d) return;
    const rows = await d
      .select({ id: machines.id })
      .from(machines)
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .where(eq(stations.lineId, lineId));
    for (const r of rows) await syncAssetIdentity(r.id);
  })().catch(swallow("line"));
}
