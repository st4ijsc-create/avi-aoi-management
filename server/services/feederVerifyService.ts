/**
 * Doc 35 W4-C.1 — Feeder-setup verification service (wrong-part guard).
 *
 * Before a run, an operator scans a (slot + reel). This service resolves the
 * EXPECTED component for that slot (from the loaded feeder setup — feeder_materials
 * for the machine+slot — or an explicit expectedComponentCode passed by the caller
 * from a BOM/program), compares it to the scanned component, and PERSISTS the
 * check as a feeder_setup_verifications row (verdict match|mismatch).
 *
 * SAFETY / GATING:
 *   - RECORDING a check always works (no flag needed).
 *   - ENFORCEMENT (blocking a run when the setup has a mismatch / is incomplete)
 *     is gated by FEEDER_VERIFY_ENFORCED (DEFAULT OFF). With the flag OFF,
 *     assertSetupOkForRun() is advisory — it returns the status but never throws.
 *   - There is NO machine-control write path here; this is a setup ledger only.
 */
import { getDb } from "../db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import {
  feederSetupVerifications,
  feederMaterials,
  type InsertFeederSetupVerification,
} from "../../drizzle/schema";

export type FeederVerdict = "match" | "mismatch";

export function isFeederVerifyEnforced(): boolean {
  return (
    process.env.FEEDER_VERIFY_ENFORCED === "true" ||
    process.env.FEEDER_VERIFY_ENFORCED === "1"
  );
}

/**
 * Normalize a scanned payload to a bare component code. A scanned reel barcode may
 * be the raw component code OR carry it in a delimited/prefixed form; for the MVP we
 * trim + upper-case and strip a trailing lot suffix after a ':' or '|' if present.
 */
export function normalizeComponentCode(raw: string | null | undefined): string {
  if (!raw) return "";
  const first = String(raw).trim().split(/[|:;,\s]/)[0];
  return first.trim().toUpperCase();
}

/**
 * Resolve the expected component for a machine + slot from the loaded feeder setup.
 * Returns the active feeder_materials row's componentCode (the planned load), or null.
 */
export async function getExpectedComponentForSlot(
  machineId: number,
  slotCode: string | null | undefined,
): Promise<{ expectedComponentCode: string | null; feederMaterialId: number | null }> {
  const db = await getDb();
  if (!db || !slotCode) return { expectedComponentCode: null, feederMaterialId: null };

  const rows = await db
    .select({
      id: feederMaterials.id,
      componentCode: feederMaterials.componentCode,
      status: feederMaterials.status,
    })
    .from(feederMaterials)
    .where(and(eq(feederMaterials.machineId, machineId), eq(feederMaterials.slotCode, slotCode)))
    .orderBy(desc(feederMaterials.updatedAt))
    .limit(1);

  if (rows.length === 0) return { expectedComponentCode: null, feederMaterialId: null };
  return { expectedComponentCode: rows[0].componentCode, feederMaterialId: rows[0].id };
}

export interface VerifyScanInput {
  machineId: number;
  slotCode?: string | null;
  scannedReel?: string | null;
  /** Component decoded from the scanned reel; if omitted, derived from scannedReel. */
  scannedComponentCode?: string | null;
  /** Explicit expected code from a BOM/program; if omitted, resolved from feeder setup. */
  expectedComponentCode?: string | null;
  lineId?: number | null;
  productModelId?: number | null;
  programId?: number | null;
  verifiedBy?: number | null;
}

export interface VerifyScanResult {
  id: number;
  verdict: FeederVerdict;
  expectedComponentCode: string | null;
  scannedComponentCode: string;
  feederMaterialId: number | null;
  enforced: boolean;
}

/**
 * Verify one scan and persist the check. Returns match|mismatch. Never blocks —
 * recording is always allowed; enforcement lives in assertSetupOkForRun().
 */
export async function verifyScan(input: VerifyScanInput): Promise<VerifyScanResult> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const scanned = normalizeComponentCode(input.scannedComponentCode ?? input.scannedReel);

  let expected = input.expectedComponentCode ? normalizeComponentCode(input.expectedComponentCode) : null;
  let feederMaterialId: number | null = null;
  if (!expected) {
    const resolved = await getExpectedComponentForSlot(input.machineId, input.slotCode);
    expected = resolved.expectedComponentCode ? normalizeComponentCode(resolved.expectedComponentCode) : null;
    feederMaterialId = resolved.feederMaterialId;
  }

  // A mismatch when we HAVE an expected and it differs from the scan. When no
  // expected can be resolved we still record, but conservatively flag mismatch
  // (setup is not proven correct — the run gate should treat it as unverified).
  const verdict: FeederVerdict = expected != null && expected === scanned && scanned !== "" ? "match" : "mismatch";

  const values: InsertFeederSetupVerification = {
    machineId: input.machineId,
    lineId: input.lineId ?? null,
    productModelId: input.productModelId ?? null,
    programId: input.programId ?? null,
    slotCode: input.slotCode ?? null,
    expectedComponentCode: expected,
    scannedComponentCode: scanned || null,
    scannedReel: input.scannedReel ?? null,
    feederMaterialId,
    verdict,
    verifiedBy: input.verifiedBy ?? null,
  };

  const [row] = await db.insert(feederSetupVerifications).values(values).returning({ id: feederSetupVerifications.id });

  return {
    id: row.id,
    verdict,
    expectedComponentCode: expected,
    scannedComponentCode: scanned,
    feederMaterialId,
    enforced: isFeederVerifyEnforced(),
  };
}

export interface SetupSlotStatus {
  slotCode: string | null;
  latestVerdict: FeederVerdict | null;
  verifiedAt: Date | null;
  expectedComponentCode: string | null;
  scannedComponentCode: string | null;
}

export interface SetupStatus {
  machineId: number;
  productModelId: number | null;
  loadedSlotCount: number;      // distinct feeder slots currently loaded for this machine
  verifiedSlotCount: number;    // distinct slots with at least one verification
  matchedSlotCount: number;     // slots whose LATEST verdict is 'match'
  hasMismatch: boolean;         // any loaded/verified slot whose latest verdict is 'mismatch'
  complete: boolean;            // every loaded slot has a latest verdict of 'match'
  enforced: boolean;
  slots: SetupSlotStatus[];
}

/**
 * Aggregate the LATEST verification per slot for a machine (optionally scoped to a
 * product model) and derive a setup-complete / has-mismatch status a run can gate on.
 */
export async function getSetupStatus(machineId: number, productModelId?: number | null): Promise<SetupStatus> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const conds = [eq(feederSetupVerifications.machineId, machineId), isNotNull(feederSetupVerifications.slotCode)];
  if (productModelId != null) conds.push(eq(feederSetupVerifications.productModelId, productModelId));

  // Latest verification row per slotCode (DISTINCT ON, newest verifiedAt first).
  const latest = await db
    .selectDistinctOn([feederSetupVerifications.slotCode], {
      slotCode: feederSetupVerifications.slotCode,
      verdict: feederSetupVerifications.verdict,
      verifiedAt: feederSetupVerifications.verifiedAt,
      expectedComponentCode: feederSetupVerifications.expectedComponentCode,
      scannedComponentCode: feederSetupVerifications.scannedComponentCode,
    })
    .from(feederSetupVerifications)
    .where(and(...conds))
    .orderBy(feederSetupVerifications.slotCode, desc(feederSetupVerifications.verifiedAt));

  // Distinct loaded slots for the machine (the setup that MUST be verified).
  const loaded = await db
    .select({ slotCode: feederMaterials.slotCode })
    .from(feederMaterials)
    .where(and(eq(feederMaterials.machineId, machineId), isNotNull(feederMaterials.slotCode)))
    .groupBy(feederMaterials.slotCode);

  const loadedSlots = new Set(loaded.map((r) => r.slotCode).filter((s): s is string => s != null));
  const latestBySlot = new Map<string, (typeof latest)[number]>();
  for (const r of latest) if (r.slotCode) latestBySlot.set(r.slotCode, r);

  const matchedSlotCount = latest.filter((r) => r.verdict === "match").length;
  const hasMismatch = latest.some((r) => r.verdict === "mismatch");

  // complete = every LOADED slot has a latest verdict of 'match'. If nothing is
  // loaded (no setup rows), fall back to "all verified slots matched & none mismatched".
  let complete: boolean;
  if (loadedSlots.size > 0) {
    complete = [...loadedSlots].every((slot) => latestBySlot.get(slot)?.verdict === "match");
  } else {
    complete = latest.length > 0 && !hasMismatch;
  }

  return {
    machineId,
    productModelId: productModelId ?? null,
    loadedSlotCount: loadedSlots.size,
    verifiedSlotCount: latest.length,
    matchedSlotCount,
    hasMismatch,
    complete,
    enforced: isFeederVerifyEnforced(),
    slots: latest.map((r) => ({
      slotCode: r.slotCode,
      latestVerdict: (r.verdict as FeederVerdict) ?? null,
      verifiedAt: r.verifiedAt ?? null,
      expectedComponentCode: r.expectedComponentCode ?? null,
      scannedComponentCode: r.scannedComponentCode ?? null,
    })),
  };
}

export interface RunGateResult {
  allowed: boolean;
  blocked: boolean;
  reason: string | null;
  status: SetupStatus;
}

/**
 * Run-gate helper. When FEEDER_VERIFY_ENFORCED is ON and the setup is not complete
 * or has a mismatch, returns { allowed:false, blocked:true }. When the flag is OFF
 * it is ADVISORY — always allowed, but still reports the status/reason. This helper
 * NEVER throws; the caller (a run-start path) decides how to surface a block.
 *
 * WIRING NOTE (for the wave-lead): to actually gate a run, a run-start service
 * should call this and refuse to proceed when result.blocked is true.
 */
export async function assertSetupOkForRun(machineId: number, productModelId?: number | null): Promise<RunGateResult> {
  const status = await getSetupStatus(machineId, productModelId);
  const enforced = isFeederVerifyEnforced();
  const problem = status.hasMismatch ? "feeder setup has a mismatch" : !status.complete ? "feeder setup not fully verified" : null;
  const blocked = enforced && problem != null;
  return {
    allowed: !blocked,
    blocked,
    reason: problem,
    status,
  };
}

/**
 * List verification checks for a machine's setup (newest first), optionally scoped
 * to a product model. Used by the router listForSetup endpoint.
 */
export async function listForSetup(
  machineId: number,
  opts?: { productModelId?: number | null; limit?: number },
): Promise<(typeof feederSetupVerifications.$inferSelect)[]> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const conds = [eq(feederSetupVerifications.machineId, machineId)];
  if (opts?.productModelId != null) conds.push(eq(feederSetupVerifications.productModelId, opts.productModelId));
  return db
    .select()
    .from(feederSetupVerifications)
    .where(and(...conds))
    .orderBy(desc(feederSetupVerifications.verifiedAt))
    .limit(Math.min(Math.max(opts?.limit ?? 100, 1), 500));
}
