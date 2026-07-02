/**
 * Doc 24 / Wave-1 phase C2 — Hardware commissioning / FAT gate service.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY (STRENGTHEN-ONLY): this service owns the `commissioning_records` sign-off
 * ledger and the single predicate the command dispatcher consults BEFORE any real
 * hardware write: isCommissioned(adapterId). It mirrors the proven sim-gate → deploy
 * precondition (programmingService): a real (non-simulated) control write is refused
 * (degraded to 'simulated') unless the adapter has an ACTIVE, non-expired, SIGNED
 * commissioning record.
 *
 *   • isCommissioned(adapterId) — TRUE iff ≥1 record with status='active' AND
 *     (expiresAt IS NULL OR expiresAt > now()). Read at call time so a just-created /
 *     just-revoked / just-expired record takes effect immediately. NEVER throws for
 *     the "no DB" case → returns false (fail-safe: uncommissioned ⇒ blocked).
 *   • createRecord — SIGN an adapter as commissioned (admin-gated at the router).
 *   • revokeRecord — rescind an active record (admin-gated). Append-mostly: we flip
 *     status to 'revoked' + stamp revokedBy/revokedAt/revokeReason (auditable).
 *   • listRecords — read the ledger for an adapter (admin visibility).
 *
 * This service has NO device I/O and NEVER calls a driver. It only reads/writes the
 * ledger. The gate itself lives in commandDispatcher.dispatch() (single write path).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { commissioningRecords, type CommissioningRecord } from "../../../drizzle/schema";

/** Commissioning record lifecycle status (plain string; no pg enum). */
export type CommissioningStatus = "active" | "revoked" | "expired";

/**
 * Master flag for the C2 gate. When ON (the DEFAULT — safe by default) the
 * dispatcher requires an adapter to be commissioned before a real write; an
 * uncommissioned adapter is FORCED down the 'simulated' path. May be set false ONLY
 * for legacy/dev. Read at RUNTIME (not module load) so tests/ops can toggle it.
 *
 * DEFAULT-ON rationale: a missing/misconfigured flag must be the SAFE state. Absence
 * of the env var ⇒ gate ENGAGED ⇒ no real write to an un-signed adapter. Only an
 * explicit "false"/"0" opts out (for legacy adapters already commissioned out-of-band
 * or dev boxes with no hardware).
 */
export function isCommissioningRequired(): boolean {
  const v = process.env.OT_COMMISSIONING_REQUIRED;
  // DEFAULT ON: only an explicit opt-out disables the gate.
  return !(v === "false" || v === "0");
}

/**
 * TRUE iff `adapterId` has an ACTIVE, non-expired, signed commissioning record.
 *
 * Fail-safe: if the DB is unavailable we return FALSE (⇒ the dispatcher will NOT do
 * a real write; it degrades to simulated). This can only ever be STRICTER than the
 * pre-C2 behaviour — it never authorizes a write that wasn't already authorized.
 */
export async function isCommissioned(adapterId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false; // fail-safe: no DB ⇒ treat as NOT commissioned.

  const rows = await db
    .select()
    .from(commissioningRecords)
    .where(and(eq(commissioningRecords.adapterId, adapterId), eq(commissioningRecords.status, "active")));

  const now = Date.now();
  return rows.some((r) => {
    if (r.status !== "active") return false;
    if (r.expiresAt == null) return true;
    return new Date(r.expiresAt).getTime() > now;
  });
}

export interface CreateCommissioningInput {
  adapterId: number;
  /** User (users.id) signing off — owns responsibility for the FAT acceptance. */
  signedBy: number;
  fatReference?: string | null;
  /** Optional validity expiry; omit / null = no expiry. */
  expiresAt?: Date | null;
  notes?: string | null;
}

/**
 * SIGN an adapter as commissioned (create an 'active' record). Admin-gated at the
 * router. Verifies the adapter exists so we never commission a phantom id.
 */
export async function createRecord(input: CreateCommissioningInput): Promise<CommissioningRecord> {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [row] = await db
    .insert(commissioningRecords)
    .values({
      adapterId: input.adapterId,
      status: "active",
      fatReference: input.fatReference ?? null,
      signedBy: input.signedBy,
      signedAt: new Date(),
      expiresAt: input.expiresAt ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  return row;
}

/**
 * REVOKE a commissioning record (flip 'active' → 'revoked' + stamp who/when/why).
 * Append-mostly (no delete) so the ledger stays auditable. Returns the updated row,
 * or null if the record does not exist / was already terminal.
 */
export async function revokeRecord(
  recordId: number,
  revokedBy: number,
  reason?: string | null,
): Promise<CommissioningRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [row] = await db
    .update(commissioningRecords)
    .set({
      status: "revoked",
      revokedBy,
      revokedAt: new Date(),
      revokeReason: reason ?? null,
    })
    .where(and(eq(commissioningRecords.id, recordId), eq(commissioningRecords.status, "active")))
    .returning();
  return row ?? null;
}

/** List the commissioning ledger for an adapter (newest first). Admin visibility. */
export async function listRecords(adapterId: number): Promise<CommissioningRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(commissioningRecords)
    .where(eq(commissioningRecords.adapterId, adapterId))
    .orderBy(desc(commissioningRecords.id));
}
