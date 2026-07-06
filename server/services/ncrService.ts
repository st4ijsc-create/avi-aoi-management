/**
 * Non-Conformance Report (NCR / MRB) service — doc 35 Wave W4-B, task 2.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The NCR/MRB entity was entirely missing: an NG inspection or a rejected lot had
 * nowhere formal to be RAISED, REVIEWED, DISPOSITIONED and CLOSED. This service
 * owns that lifecycle over drizzle/schema/ncr.ts:
 *
 *   open ──review──▶ in_review ──disposition──▶ dispositioned ──close──▶ closed
 *    │                                                                    ▲
 *    └────────────────────── close (cancel, decidedBy) ───────────────────┘
 *
 * SEGREGATION OF DUTIES: the person who RAISED an NCR may not be the person who
 * DISPOSITIONS it (mirrors thresholdGovernanceService.assertApprovalSoD /
 * goldenSample approve). Enforced in `transitionNcr` at the disposition step.
 *
 * All transitions are stamped onto the row itself (reviewedBy/decidedBy/closedBy
 * + timestamps) — a self-contained audit trail. Pure DB; null-guarded.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  nonconformanceReports,
  NCR_DISPOSITIONS,
  type NcrDisposition,
  type NcrSource,
  type NcrStatus,
  type NonconformanceReport,
} from "../../drizzle/schema/ncr";

export class NcrError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "BAD_STATE" | "SOD" | "DB" = "BAD_STATE") {
    super(message);
    this.name = "NcrError";
  }
}

async function db() {
  const d = await getDb();
  if (!d) throw new NcrError("Database not available", "DB");
  return d;
}

/** Generate a human-facing NCR key: NCR-YYYYMMDD-<6 hex>. */
function generateNcrKey(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `NCR-${ymd}-${rand}`;
}

export interface CreateNcrInput {
  source: NcrSource;
  raisedBy: number;
  ncrKey?: string;
  linkedInspectionId?: number | null;
  lotNumber?: string | null;
  serialNumber?: string | null;
  productModelId?: number | null;
  defectSummary?: string | null;
  quarantineLocationId?: number | null;
  reason?: string | null;
  note?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

/** Raise a new NCR (status='open'). */
export async function createNcr(input: CreateNcrInput): Promise<NonconformanceReport> {
  const d = await db();
  const [row] = await d
    .insert(nonconformanceReports)
    .values({
      ncrKey: input.ncrKey ?? generateNcrKey(),
      source: input.source,
      linkedInspectionId: input.linkedInspectionId ?? null,
      lotNumber: input.lotNumber ?? null,
      serialNumber: input.serialNumber ?? null,
      productModelId: input.productModelId ?? null,
      defectSummary: input.defectSummary ?? null,
      quarantineLocationId: input.quarantineLocationId ?? null,
      raisedBy: input.raisedBy,
      reason: input.reason ?? null,
      note: input.note ?? null,
      status: "open",
      corporateCode: input.corporateCode ?? null,
      factoryId: input.factoryId ?? null,
    })
    .returning();
  return row;
}

export interface ListNcrFilter {
  status?: NcrStatus;
  source?: NcrSource;
  lotNumber?: string;
  serialNumber?: string;
  productModelId?: number;
  limit?: number;
}

export async function listNcr(filter: ListNcrFilter = {}): Promise<NonconformanceReport[]> {
  const d = await getDb();
  if (!d) return [];
  const conds = [] as any[];
  if (filter.status) conds.push(eq(nonconformanceReports.status, filter.status));
  if (filter.source) conds.push(eq(nonconformanceReports.source, filter.source));
  if (filter.lotNumber) conds.push(eq(nonconformanceReports.lotNumber, filter.lotNumber));
  if (filter.serialNumber) conds.push(eq(nonconformanceReports.serialNumber, filter.serialNumber));
  if (filter.productModelId) conds.push(eq(nonconformanceReports.productModelId, filter.productModelId));
  return d
    .select()
    .from(nonconformanceReports)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(nonconformanceReports.raisedAt))
    .limit(filter.limit ?? 100);
}

export async function getNcrById(id: number): Promise<NonconformanceReport | null> {
  const d = await getDb();
  if (!d) return null;
  const [row] = await d.select().from(nonconformanceReports).where(eq(nonconformanceReports.id, id)).limit(1);
  return row ?? null;
}

/** Legal forward transitions of the NCR lifecycle. */
const LEGAL_TRANSITIONS: Record<NcrStatus, NcrStatus[]> = {
  open: ["in_review", "closed"],
  in_review: ["dispositioned", "closed"],
  dispositioned: ["closed"],
  closed: [],
};

export type NcrAction = "review" | "disposition" | "close";

export interface TransitionNcrInput {
  id: number;
  action: NcrAction;
  actorId: number;
  /** Required when action='disposition'. */
  disposition?: NcrDisposition;
  quarantineLocationId?: number | null;
  note?: string | null;
}

/**
 * Advance an NCR. Enforces legal transitions and SoD (raiser ≠ decider at the
 * disposition step). Throws NcrError on any violation.
 */
export async function transitionNcr(input: TransitionNcrInput): Promise<NonconformanceReport> {
  const d = await db();
  const current = await getNcrById(input.id);
  if (!current) throw new NcrError(`NCR ${input.id} not found`, "NOT_FOUND");

  const targetStatus: NcrStatus =
    input.action === "review" ? "in_review" : input.action === "disposition" ? "dispositioned" : "closed";

  if (!LEGAL_TRANSITIONS[current.status].includes(targetStatus)) {
    throw new NcrError(`Illegal NCR transition ${current.status} -> ${targetStatus}`, "BAD_STATE");
  }

  const now = new Date();
  const set: Record<string, unknown> = { status: targetStatus, updatedAt: now };
  if (input.note != null) set.note = input.note;
  if (input.quarantineLocationId != null) set.quarantineLocationId = input.quarantineLocationId;

  if (input.action === "review") {
    set.reviewedBy = input.actorId;
    set.reviewedAt = now;
  } else if (input.action === "disposition") {
    if (!input.disposition || !NCR_DISPOSITIONS.includes(input.disposition)) {
      throw new NcrError(`disposition is required and must be one of ${NCR_DISPOSITIONS.join(", ")}`, "BAD_STATE");
    }
    // SoD — the raiser cannot disposition their own NCR. A null/sentinel raiser
    // (<= 0, e.g. system-raised) is treated as non-self.
    if (current.raisedBy != null && current.raisedBy > 0 && current.raisedBy === input.actorId) {
      throw new NcrError("Segregation of duties: cannot disposition your own NCR", "SOD");
    }
    set.disposition = input.disposition;
    set.decidedBy = input.actorId;
    set.decidedAt = now;
  } else {
    set.closedBy = input.actorId;
    set.closedAt = now;
  }

  const [updated] = await d
    .update(nonconformanceReports)
    .set(set as any)
    .where(eq(nonconformanceReports.id, input.id))
    .returning();
  return updated;
}
