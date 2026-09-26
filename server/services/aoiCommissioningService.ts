/**
 * AOI/AVI Commissioning service (doc 27 §3 gap C4 + §2 gap M8 · Wave-2 W2-D).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The SHARED SEAM between the AOI Onboarding Wizard (aoiOnboardingRouter) and the
 * inspection ingest path (machineApiRouters / hot-folder — W2-C / W2-A).
 *
 * CONTRACT FOR INGEST CONSUMERS (W2-C):
 *   const mode = await getAoiIngestMode(machineId);   // "production" | "commissioning"
 *   → when "commissioning", TAG the submission (e.g. stamp a `commissioning`
 *     marker into the inspection remark/metadata). NEVER reject on this value.
 *
 * GATE SEMANTICS — SOFT BY DESIGN (do not "harden" this without a plan):
 *   • A machine is "production" ⇔ its NEWEST signed aoi_commissioning_records row
 *     has status 'commissioned'.
 *   • A machine with NO record (i.e. every machine that existed before this
 *     feature) is "commissioning" — its submissions are still accepted, only
 *     tagged. Existing machines keep working unchanged; operators can promote
 *     them any time via the wizard's sign-off step (≤1 minute).
 *   • FAIL-OPEN: any DB error / missing DB ⇒ "production" (no tag, never throw)
 *     so a lookup hiccup can never mislabel or break the hot ingest path.
 *
 * PERFORMANCE: per-machine result is cached (30 s TTL) so consulting the gate on
 * every submitInspection costs ~0. Mutations in aoiOnboardingRouter call
 * invalidateAoiCommissioningCache(machineId) after every status change.
 *
 * This service performs NO RBAC and writes NO audit rows — that is the router's
 * job (recordAuditEvent). It only owns the table access + the cached lookup.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { DbUnavailableError } from "../_core/dbErrors";
import { getDb } from "../db";
import {
  aoiCommissioningRecords,
  type AoiCommissioningRecord,
} from "../../drizzle/schema";

export type AoiIngestMode = "production" | "commissioning";

export const AOI_COMMISSIONING_STATUSES = ["draft", "commissioned", "decommissioned"] as const;
export type AoiCommissioningStatus = (typeof AOI_COMMISSIONING_STATUSES)[number];

/** Resolved drizzle db (non-null). */
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

// ─── Cached ingest-mode lookup (the seam ingest consults) ────────────────────

const CACHE_TTL_MS = 30_000;
const modeCache = new Map<number, { mode: AoiIngestMode; at: number }>();

/** Drop the cached mode for one machine (or all when omitted). */
export function invalidateAoiCommissioningCache(machineId?: number): void {
  if (machineId == null) modeCache.clear();
  else modeCache.delete(machineId);
}

/**
 * "production" | "commissioning" for a machine — cached, NEVER throws (fail-open
 * to "production" on any error so the ingest hot path is unaffected by lookups).
 */
export async function getAoiIngestMode(machineId: number): Promise<AoiIngestMode> {
  const hit = modeCache.get(machineId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.mode;
  let mode: AoiIngestMode;
  try {
    const latest = await getLatestSignedRecord(machineId);
    mode = latest?.status === "commissioned" ? "production" : "commissioning";
  } catch {
    // FAIL-OPEN (soft gate): a broken lookup must neither throw nor mislabel.
    return "production";
  }
  modeCache.set(machineId, { mode, at: Date.now() });
  return mode;
}

/** Convenience boolean over getAoiIngestMode (same caching + fail-open). */
export async function isAoiMachineCommissioned(machineId: number): Promise<boolean> {
  return (await getAoiIngestMode(machineId)) === "production";
}

// ─── Record access (used by aoiOnboardingRouter) ─────────────────────────────

/** Newest NON-draft record — the row that decides the machine's ingest mode. */
export async function getLatestSignedRecord(
  machineId: number,
): Promise<AoiCommissioningRecord | null> {
  const d = await requireDb();
  const [row] = await d
    .select()
    .from(aoiCommissioningRecords)
    .where(and(
      eq(aoiCommissioningRecords.machineId, machineId),
      ne(aoiCommissioningRecords.status, "draft"),
    ))
    .orderBy(desc(aoiCommissioningRecords.id))
    .limit(1);
  return row ?? null;
}

/** Current wizard draft for a machine (newest, at most one is maintained). */
export async function getDraftRecord(
  machineId: number,
): Promise<AoiCommissioningRecord | null> {
  const d = await requireDb();
  const [row] = await d
    .select()
    .from(aoiCommissioningRecords)
    .where(and(
      eq(aoiCommissioningRecords.machineId, machineId),
      eq(aoiCommissioningRecords.status, "draft"),
    ))
    .orderBy(desc(aoiCommissioningRecords.id))
    .limit(1);
  return row ?? null;
}

/**
 * Create-or-update the machine's single wizard draft (resumable state).
 * configSnapshot is stored as-is — the ROUTER is responsible for stripping
 * secrets (plaintext keys) before calling this.
 */
export async function saveDraftRecord(params: {
  machineId: number;
  configSnapshot: Record<string, unknown>;
  userId: number | null;
}): Promise<AoiCommissioningRecord> {
  const d = await requireDb();
  const existing = await getDraftRecord(params.machineId);
  if (existing) {
    const [row] = await d
      .update(aoiCommissioningRecords)
      .set({ configSnapshot: params.configSnapshot as never, updatedAt: new Date() })
      .where(eq(aoiCommissioningRecords.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await d
    .insert(aoiCommissioningRecords)
    .values({
      machineId: params.machineId,
      status: "draft",
      configSnapshot: params.configSnapshot as never,
      createdBy: params.userId,
    })
    .returning();
  return row;
}

/** Delete the machine's wizard draft (abandon). Returns whether one existed. */
export async function deleteDraftRecord(machineId: number): Promise<boolean> {
  const d = await requireDb();
  const removed = await d
    .delete(aoiCommissioningRecords)
    .where(and(
      eq(aoiCommissioningRecords.machineId, machineId),
      eq(aoiCommissioningRecords.status, "draft"),
    ))
    .returning();
  return removed.length > 0;
}

/**
 * Promote the machine's draft to 'commissioned' (the sign-off). The caller
 * (router) has already validated the dry-run gate / override and writes the
 * audit row. Invalidates the mode cache.
 */
export async function commissionFromDraft(params: {
  machineId: number;
  signedBy: number;
  note: string | null;
}): Promise<AoiCommissioningRecord | null> {
  const d = await requireDb();
  const draft = await getDraftRecord(params.machineId);
  if (!draft) return null;
  const [row] = await d
    .update(aoiCommissioningRecords)
    .set({
      status: "commissioned",
      signedBy: params.signedBy,
      signedAt: new Date(),
      note: params.note,
      updatedAt: new Date(),
    })
    .where(eq(aoiCommissioningRecords.id, draft.id))
    .returning();
  invalidateAoiCommissioningCache(params.machineId);
  return row ?? null;
}

/**
 * Revoke the machine's current 'commissioned' record → 'decommissioned'.
 * Returns the updated row, or null when the machine has no commissioned record.
 */
export async function decommissionMachine(params: {
  machineId: number;
  actorId: number;
  reason: string | null;
}): Promise<AoiCommissioningRecord | null> {
  const d = await requireDb();
  const latest = await getLatestSignedRecord(params.machineId);
  if (!latest || latest.status !== "commissioned") return null;
  const [row] = await d
    .update(aoiCommissioningRecords)
    .set({
      status: "decommissioned",
      note: params.reason ?? latest.note,
      updatedAt: new Date(),
    })
    .where(eq(aoiCommissioningRecords.id, latest.id))
    .returning();
  invalidateAoiCommissioningCache(params.machineId);
  return row ?? null;
}

/** Full ledger for one machine, newest first (drafts included for the wizard UI). */
export async function listRecordsForMachine(
  machineId: number,
): Promise<AoiCommissioningRecord[]> {
  const d = await requireDb();
  return d
    .select()
    .from(aoiCommissioningRecords)
    .where(eq(aoiCommissioningRecords.machineId, machineId))
    .orderBy(desc(aoiCommissioningRecords.id));
}

/** All records (for the machine-picker status badges). Small table by nature. */
export async function listAllRecords(): Promise<AoiCommissioningRecord[]> {
  const d = await requireDb();
  return d
    .select()
    .from(aoiCommissioningRecords)
    .orderBy(desc(aoiCommissioningRecords.id));
}
