/**
 * Doc 31 Đợt B (MP1 / PM6) — BOM-driven component-code backfill.
 * ════════════════════════════════════════════════════════════════════════════
 * A measurement point knows its board POSITION (`refDesignator`, e.g. "R12") but
 * not always WHICH component sits there (`componentCode`). The BOM already
 * carries that map: every `bom_line_items` row pairs a `refDesignator` with a
 * `componentCode`. This service reads the product's BOM and fills a point's
 * empty `componentCode` from the BOM line whose designator matches the point's
 * `refDesignator`.
 *
 * WHY it matters: `componentCode` is the FIRST hop of the Pareto-by-package
 * chain (W8-A / 0191):
 *
 *   measurement_results → point_defs.componentCode → materials.code
 *     → materials.packageId → component_packages
 *
 * With `componentCode` empty on every point (dev DB: 0/119), that chain resolves
 * to nothing and the whole package analytic is dead. Backfilling from the BOM is
 * the cheapest way to light it up.
 *
 * SAFETY / IDEMPOTENCE:
 *   - NON-DESTRUCTIVE: only points whose `componentCode` is NULL/empty are
 *     candidates. A point that already has a componentCode is never overwritten
 *     (reported as `skippedAlreadyLinked`).
 *   - `dryRun` computes the plan and writes nothing (returns `updated: 0`).
 *   - A BOM designator may be a LIST ("R1,R2,R3" / "R1 R2 R3") — each token is
 *     indexed so a point's single refdes still matches.
 *   - Matching is case-insensitive + trimmed.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/connection";
import { measurementPointDefs } from "../../drizzle/schema/product";
import { bomDefinitions, bomLineItems } from "../../drizzle/schema/mes";

export interface ComponentLinkBackfillOptions {
  /** When true (default false via the caller), compute the plan but write nothing. */
  dryRun?: boolean;
}

export interface ComponentLinkUnmatched {
  pointDefId: number;
  code: string;
  refDesignator: string | null;
  /** Why this candidate did not resolve. */
  reason: "no_refdesignator" | "no_bom_match";
}

export interface ComponentLinkBackfillResult {
  productModelId: number;
  /** The BOM whose line items were used (highest-priority non-deleted BOM), or null. */
  bomDefinitionId: number | null;
  /** Empty-code points that resolved to a BOM componentCode. */
  matched: number;
  /** Points actually written (== matched when !dryRun; 0 when dryRun). */
  updated: number;
  /** Points already carrying a componentCode — left untouched. */
  skippedAlreadyLinked: number;
  /** Empty-code points that could NOT be resolved (with the reason). */
  unmatched: ComponentLinkUnmatched[];
  dryRun: boolean;
}

/** Trim + upper-case a designator token for tolerant matching. */
function normRef(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

/** Split a BOM designator cell into individual refdes tokens ("R1, R2" → [R1,R2]). */
function refTokens(s: string | null | undefined): string[] {
  return normRef(s)
    .split(/[\s,;/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Choose the BOM whose lines drive the backfill. Prefers an `active` BOM, then
 * the highest version; only non-deleted BOMs are considered.
 */
function pickBom(boms: Array<{ id: number; status: string; version: number; isActive: boolean }>): number | null {
  if (boms.length === 0) return null;
  const ranked = [...boms].sort((a, b) => {
    const aActive = a.status === "active" && a.isActive ? 1 : 0;
    const bActive = b.status === "active" && b.isActive ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return (b.version ?? 0) - (a.version ?? 0);
  });
  return ranked[0].id;
}

/**
 * Backfill `componentCode` for one product model from its BOM. Pure read when
 * `dryRun`. Fail-safe: DB offline → empty result.
 */
export async function backfillComponentCodesFromBom(
  productModelId: number,
  opts: ComponentLinkBackfillOptions = {},
): Promise<ComponentLinkBackfillResult> {
  const dryRun = !!opts.dryRun;
  const empty: ComponentLinkBackfillResult = {
    productModelId,
    bomDefinitionId: null,
    matched: 0,
    updated: 0,
    skippedAlreadyLinked: 0,
    unmatched: [],
    dryRun,
  };

  const db = await getDb();
  if (!db) return empty;

  // 1. Choose the BOM for this product.
  const boms = await db
    .select({
      id: bomDefinitions.id,
      status: bomDefinitions.status,
      version: bomDefinitions.version,
      isActive: bomDefinitions.isActive,
    })
    .from(bomDefinitions)
    .where(and(eq(bomDefinitions.productModelId, productModelId), isNull(bomDefinitions.deletedAt)));
  const bomDefinitionId = pickBom(boms);
  if (bomDefinitionId == null) return empty;

  // 2. Build refdes → componentCode index from that BOM's lines. First token wins
  //    (a later duplicate designator does not clobber an earlier mapping).
  const lines = await db
    .select({
      componentCode: bomLineItems.componentCode,
      refDesignator: bomLineItems.refDesignator,
    })
    .from(bomLineItems)
    .where(eq(bomLineItems.bomId, bomDefinitionId));

  const refToCode = new Map<string, string>();
  for (const line of lines) {
    const code = (line.componentCode ?? "").trim();
    if (!code) continue;
    for (const tok of refTokens(line.refDesignator)) {
      if (!refToCode.has(tok)) refToCode.set(tok, code);
    }
  }

  // 3. Candidate points: this product, active, not deleted.
  const points = await db
    .select({
      id: measurementPointDefs.id,
      code: measurementPointDefs.code,
      componentCode: measurementPointDefs.componentCode,
      refDesignator: measurementPointDefs.refDesignator,
    })
    .from(measurementPointDefs)
    .where(
      and(
        eq(measurementPointDefs.productModelId, productModelId),
        eq(measurementPointDefs.isActive, true),
        isNull(measurementPointDefs.deletedAt),
      ),
    );

  const result: ComponentLinkBackfillResult = { ...empty, bomDefinitionId };
  // pointId → resolved componentCode, applied in one pass afterwards.
  const toWrite = new Map<number, string>();

  for (const p of points) {
    const existing = (p.componentCode ?? "").trim();
    if (existing) {
      result.skippedAlreadyLinked++;
      continue; // NON-DESTRUCTIVE: never overwrite an existing link.
    }
    const ref = normRef(p.refDesignator);
    if (!ref) {
      result.unmatched.push({ pointDefId: p.id, code: p.code, refDesignator: p.refDesignator ?? null, reason: "no_refdesignator" });
      continue;
    }
    const code = refToCode.get(ref);
    if (!code) {
      result.unmatched.push({ pointDefId: p.id, code: p.code, refDesignator: p.refDesignator ?? null, reason: "no_bom_match" });
      continue;
    }
    result.matched++;
    toWrite.set(p.id, code);
  }

  // 4. Apply (grouped by resolved code so each is a single UPDATE … WHERE IN).
  if (!dryRun && toWrite.size > 0) {
    const byCode = new Map<string, number[]>();
    for (const [pid, code] of toWrite) {
      const arr = byCode.get(code) ?? [];
      arr.push(pid);
      byCode.set(code, arr);
    }
    for (const [code, ids] of byCode) {
      await db
        .update(measurementPointDefs)
        .set({ componentCode: code })
        .where(inArray(measurementPointDefs.id, ids));
    }
    result.updated = toWrite.size;
  }

  return result;
}
