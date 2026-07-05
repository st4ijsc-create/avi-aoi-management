/**
 * Pure helpers for the Threshold Approvals batch-approve summary (doc 31 OP8).
 *
 * WA-1 owns the server `batchApprove(ids[]) → per-id results` endpoint; its exact
 * result shape is not pinned at build time, so `normalizeBatchResponse` tolerates
 * several plausible encodings and buckets each result into approved / skipped
 * (Separation-of-Duties — e.g. self-approve) / failed. Kept side-effect-free so it
 * can be unit-tested in the node env (repo convention: *.unit.test.ts).
 */

export type BatchResultCategory = "approved" | "skipped" | "failed";

/** A single per-id result as it might arrive from the server (loose on purpose). */
export interface RawBatchItem {
  id?: number | string | null;
  status?: string | null;
  ok?: boolean | null;
  approved?: boolean | null;
  applied?: boolean | null;
  skipped?: boolean | null;
  reason?: string | null;
  error?: string | null;
  message?: string | null;
  code?: string | null;
}

export interface NormalizedBatchItem {
  id: number | null;
  category: BatchResultCategory;
  reason: string | null;
}

export interface BatchSummary {
  approved: number;
  skipped: number;
  failed: number;
  total: number;
  items: NormalizedBatchItem[];
}

/** Reasons that mean "not counted as failure" — a deliberate SoD/business skip. */
const SKIP_HINT = /self|\bsod\b|\bown\b|forbidden|different\s+reviewer|requester/i;

function toId(v: RawBatchItem["id"]): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstReason(item: RawBatchItem): string | null {
  return item.reason ?? item.error ?? item.message ?? item.code ?? null;
}

function categorize(item: RawBatchItem): BatchResultCategory {
  const reason = firstReason(item);

  // 1. Explicit status string wins.
  const status = (item.status ?? "").toString().trim().toLowerCase();
  if (status) {
    if (["approved", "applied", "ok", "success", "done"].includes(status)) return "approved";
    if (["skipped", "self", "self_approve", "self-approve", "sod", "own", "forbidden", "conflict"].includes(status)) return "skipped";
    if (["failed", "error", "not_found", "notfound", "invalid", "rejected"].includes(status)) return "failed";
    // Unknown status string → fall through to boolean flags.
  }

  // 2. Boolean success flags.
  if (item.ok === true || item.approved === true || item.applied === true) return "approved";
  if (item.skipped === true) return "skipped";

  // 3. Explicit failure with a reason that indicates an SoD skip vs a hard error.
  if (item.ok === false || item.approved === false) {
    return reason && SKIP_HINT.test(reason) ? "skipped" : "failed";
  }

  // 4. Nothing conclusive — if a reason smells like SoD treat it as a skip.
  if (reason && SKIP_HINT.test(reason)) return "skipped";

  return "failed";
}

/** Pull the per-id array out of whatever envelope the server used. */
export function extractItems(resp: unknown): RawBatchItem[] {
  if (Array.isArray(resp)) return resp as RawBatchItem[];
  if (resp && typeof resp === "object") {
    const o = resp as Record<string, unknown>;
    for (const key of ["results", "items", "outcomes", "data"]) {
      if (Array.isArray(o[key])) return o[key] as RawBatchItem[];
    }
  }
  return [];
}

/** Normalize a batchApprove response into bucketed counts + per-id detail. */
export function normalizeBatchResponse(resp: unknown): BatchSummary {
  const raw = extractItems(resp);
  const items: NormalizedBatchItem[] = raw.map((r) => ({
    id: toId(r?.id),
    category: categorize(r ?? {}),
    reason: firstReason(r ?? {}),
  }));
  return {
    approved: items.filter((i) => i.category === "approved").length,
    skipped: items.filter((i) => i.category === "skipped").length,
    failed: items.filter((i) => i.category === "failed").length,
    total: items.length,
    items,
  };
}
