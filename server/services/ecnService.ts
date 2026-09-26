/**
 * Engineering Change (ECN / ECO) service — doc 35 Wave W4-D, task 1.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The system had NO general engineering-change workflow. This service owns the
 * maker-checker lifecycle over drizzle/schema/ecn.ts:
 *
 *   draft ──submit──▶ submitted ──review──▶ in_review ──approve──▶ approved
 *     │                   │                    │                      │
 *     └── close ◀─────────┴──── reject ────────┴── reject             │
 *                                (rejected) ──close──▶ closed         │
 *                                                                     ▼
 *                                          approved ──implement──▶ implemented ──close──▶ closed
 *
 * SEGREGATION OF DUTIES: the person who REQUESTED a change may not APPROVE it
 * (mirrors thresholdGovernanceService.assertApprovalSoD / ncrService). Enforced
 * in `transitionEcn` at the approve step. A null / sentinel requester (<= 0,
 * e.g. system-generated) is treated as non-self.
 *
 * All transitions are stamped onto the row itself (reviewedBy / approvedBy /
 * implementedBy / closedBy + timestamps) — a self-contained audit trail. Pure
 * DB; null-guarded; fail-safe on offline DB.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  engineeringChanges,
  engineeringChangeItems,
  ECN_CHANGE_TYPES,
  type EcnChangeType,
  type EcnImpactSummary,
  type EcnItemAction,
  type EcnStatus,
  type EngineeringChange,
  type EngineeringChangeItem,
} from "../../drizzle/schema/ecn";

export class EcnError extends Error {
  constructor(
    message: string,
    // doc 80 Đợt 0 Task 8 (ECN-03) — "CONFLICT": the CAS UPDATE in transitionEcn
    // matched 0 rows (status changed out from under the caller between read and
    // write). Mapped to TRPCError "CONFLICT" in ecnRouter's toTrpc.
    readonly code: "NOT_FOUND" | "BAD_STATE" | "SOD" | "CONFLICT" | "DB" = "BAD_STATE",
  ) {
    super(message);
    this.name = "EcnError";
  }
}

async function db() {
  const d = await getDb();
  if (!d) throw new EcnError("Database not available", "DB");
  return d;
}

/** Generate a human-facing ECN key: ECN-YYYYMMDD-<6 hex>. */
function generateEcnKey(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `ECN-${ymd}-${rand}`;
}

export interface CreateEcnItemInput {
  entityType: string;
  entityRef?: number | null;
  entityCode?: string | null;
  action?: EcnItemAction;
  description?: string | null;
  note?: string | null;
}

export interface CreateEcnInput {
  title: string;
  changeType: EcnChangeType;
  requestedBy: number;
  ecnKey?: string;
  productModelId?: number | null;
  bomId?: number | null;
  recipeId?: number | null;
  programId?: number | null;
  processId?: number | null;
  targetDescription?: string | null;
  reason?: string | null;
  impactSummary?: EcnImpactSummary | null;
  effectivityDate?: Date | string | null;
  note?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
  /** Optional per-affected-entity lines created alongside the header. */
  items?: CreateEcnItemInput[];
}

function coerceDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Create a new engineering change (status='draft'). */
export async function createEcn(input: CreateEcnInput): Promise<EngineeringChange> {
  if (!ECN_CHANGE_TYPES.includes(input.changeType)) {
    throw new EcnError(`changeType must be one of ${ECN_CHANGE_TYPES.join(", ")}`, "BAD_STATE");
  }
  if (!input.title?.trim()) throw new EcnError("title is required", "BAD_STATE");

  const d = await db();
  const [row] = await d
    .insert(engineeringChanges)
    .values({
      ecnKey: input.ecnKey ?? generateEcnKey(),
      title: input.title.trim(),
      changeType: input.changeType,
      productModelId: input.productModelId ?? null,
      bomId: input.bomId ?? null,
      recipeId: input.recipeId ?? null,
      programId: input.programId ?? null,
      processId: input.processId ?? null,
      targetDescription: input.targetDescription ?? null,
      reason: input.reason ?? null,
      impactSummary: (input.impactSummary ?? null) as any,
      effectivityDate: coerceDate(input.effectivityDate),
      requestedBy: input.requestedBy,
      note: input.note ?? null,
      status: "draft",
      corporateCode: input.corporateCode ?? null,
      factoryId: input.factoryId ?? null,
    })
    .returning();

  if (input.items?.length) {
    await d.insert(engineeringChangeItems).values(
      input.items.map((it) => ({
        ecnId: row.id,
        entityType: it.entityType,
        entityRef: it.entityRef ?? null,
        entityCode: it.entityCode ?? null,
        action: (it.action ?? "modify") as EcnItemAction,
        description: it.description ?? null,
        note: it.note ?? null,
      })),
    );
  }
  return row;
}

export interface ListEcnFilter {
  status?: EcnStatus;
  changeType?: EcnChangeType;
  productModelId?: number;
  limit?: number;
}

export async function listEcn(filter: ListEcnFilter = {}): Promise<EngineeringChange[]> {
  const d = await getDb();
  if (!d) return [];
  const conds = [] as any[];
  if (filter.status) conds.push(eq(engineeringChanges.status, filter.status));
  if (filter.changeType) conds.push(eq(engineeringChanges.changeType, filter.changeType));
  if (filter.productModelId) conds.push(eq(engineeringChanges.productModelId, filter.productModelId));
  return d
    .select()
    .from(engineeringChanges)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(engineeringChanges.createdAt))
    .limit(filter.limit ?? 100);
}

export async function getEcnById(id: number): Promise<EngineeringChange | null> {
  const d = await getDb();
  if (!d) return null;
  const [row] = await d.select().from(engineeringChanges).where(eq(engineeringChanges.id, id)).limit(1);
  return row ?? null;
}

export async function getEcnItems(ecnId: number): Promise<EngineeringChangeItem[]> {
  const d = await getDb();
  if (!d) return [];
  return d
    .select()
    .from(engineeringChangeItems)
    .where(eq(engineeringChangeItems.ecnId, ecnId))
    .orderBy(desc(engineeringChangeItems.id));
}

/** Legal forward transitions of the ECN lifecycle. */
const LEGAL_TRANSITIONS: Record<EcnStatus, EcnStatus[]> = {
  draft: ["submitted", "closed"],
  submitted: ["in_review", "rejected", "closed"],
  in_review: ["approved", "rejected", "closed"],
  approved: ["implemented", "rejected", "closed"],
  rejected: ["closed"],
  implemented: ["closed"],
  closed: [],
};

export type EcnAction = "submit" | "review" | "approve" | "reject" | "implement" | "close";

const ACTION_TARGET: Record<EcnAction, EcnStatus> = {
  submit: "submitted",
  review: "in_review",
  approve: "approved",
  reject: "rejected",
  implement: "implemented",
  close: "closed",
};

export interface TransitionEcnInput {
  id: number;
  action: EcnAction;
  actorId: number;
  /** Optional decision comment (approve / reject / close reason). */
  comment?: string | null;
  /** Optional effectivity date set/updated at approve time. */
  effectivityDate?: Date | string | null;
  /**
   * doc 80 Đợt 0 Task 8 (ECN-03) — the status the CALLER currently sees for this
   * ECN (fetched moments before the user clicked the action button). Used as the
   * "from" state for BOTH the legal-transition check and the UPDATE's WHERE
   * clause below, so a transition only applies if the row is STILL in that
   * state. Omitted (legacy/system callers) → falls back to the status just read
   * by this function — same effect as before this task, no weaker.
   */
  expectedStatus?: EcnStatus;
}

/**
 * Advance an ECN. Enforces the legal-transition table and SoD (requester ≠
 * reviewer ≠ approver — doc 80 ECN-05) and a compare-and-swap on `status` (doc
 * 80 ECN-03: the UPDATE only applies `WHERE id=$1 AND status=$expected`; a
 * concurrent transition that already moved the row away from `$expected` makes
 * this UPDATE match 0 rows ⇒ EcnError("CONFLICT") instead of silently
 * clobbering the other transition's result). Throws EcnError on any violation.
 */
export async function transitionEcn(input: TransitionEcnInput): Promise<EngineeringChange> {
  const d = await db();
  const current = await getEcnById(input.id);
  if (!current) throw new EcnError(`ECN ${input.id} not found`, "NOT_FOUND");

  const targetStatus = ACTION_TARGET[input.action];
  if (!targetStatus) throw new EcnError(`Unknown action ${input.action}`, "BAD_STATE");

  // ECN-03 — the state this transition is FROM. Prefer what the caller says it
  // sees; fall back to the freshly-read row for callers that don't send it yet.
  const fromStatus: EcnStatus = input.expectedStatus ?? current.status;

  if (!LEGAL_TRANSITIONS[fromStatus].includes(targetStatus)) {
    throw new EcnError(`Illegal ECN transition ${fromStatus} -> ${targetStatus}`, "BAD_STATE");
  }

  const now = new Date();
  const set: Record<string, unknown> = { status: targetStatus, updatedAt: now };
  if (input.comment != null) set.decisionComment = input.comment;

  switch (input.action) {
    case "submit":
      set.submittedAt = now;
      break;
    case "review":
      // ECN-05 — SoD mở rộng sang bước xem xét: người yêu cầu không được tự xem
      // xét ECN của mình (trước bản vá chỉ chặn ở approve). A null/sentinel
      // requester (<= 0, e.g. system-generated) is treated as non-self.
      if (current.requestedBy != null && current.requestedBy > 0 && current.requestedBy === input.actorId) {
        throw new EcnError("Segregation of duties: cannot review your own engineering change", "SOD");
      }
      set.reviewedBy = input.actorId;
      set.reviewedAt = now;
      break;
    case "approve": {
      // SoD — the requester cannot approve their own change.
      if (current.requestedBy != null && current.requestedBy > 0 && current.requestedBy === input.actorId) {
        throw new EcnError("Segregation of duties: cannot approve your own engineering change", "SOD");
      }
      // ECN-05 — người đã xem xét (reviewedBy) không được đồng thời là người
      // duyệt: buộc HAI người khác vai ở hai bước xem xét/duyệt.
      if (current.reviewedBy != null && current.reviewedBy > 0 && current.reviewedBy === input.actorId) {
        throw new EcnError("Segregation of duties: the reviewer cannot also approve the same engineering change", "SOD");
      }
      set.approvedBy = input.actorId;
      set.approvedAt = now;
      const eff = coerceDate(input.effectivityDate);
      if (eff) set.effectivityDate = eff;
      break;
    }
    case "reject":
      // The reviewer/approver rejecting is stamped as the reviewer of record.
      set.reviewedBy = input.actorId;
      set.reviewedAt = now;
      break;
    case "implement":
      set.implementedBy = input.actorId;
      set.implementedAt = now;
      break;
    case "close":
      set.closedBy = input.actorId;
      set.closedAt = now;
      break;
  }

  // ECN-03 — conditional UPDATE (compare-and-swap on `status`). Postgres
  // serializes concurrent UPDATEs on the SAME row: whichever commits first
  // changes `status` away from `fromStatus`, so the second UPDATE's WHERE
  // clause matches 0 rows instead of double-applying the transition.
  const [updated] = await d
    .update(engineeringChanges)
    .set(set as any)
    .where(and(eq(engineeringChanges.id, input.id), eq(engineeringChanges.status, fromStatus)))
    .returning();

  if (!updated) {
    throw new EcnError(
      `ECN ${input.id} is no longer in status "${fromStatus}" — it was changed by someone else; reload and retry`,
      "CONFLICT",
    );
  }
  return updated;
}
