/**
 * Doc 31 Đợt D (UX2 / PM9 — WD-2) — product readiness scorer tests.
 *
 *  1) scoreReadiness: pure math + per-item checklist for a fully-configured, a
 *     partially-configured, an all-VISUAL, and an empty product.
 *  2) computeProductReadinessBatch: CONSTANT query count regardless of N ids
 *     (no N+1) — proven with a select-counting fake db.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── (2) counting fake db for the no-N+1 proof ──
const counts = { select: 0 };
const genericRows: any[] = [{ id: 1, code: "P1", name: "Prod 1", referenceImageUrl: null, imageWidth: null, imageHeight: null }];
function makeChain(rows: any[]): any {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    for: () => chain,
    then: (resolve: (v: any[]) => any, reject?: (e: any) => any) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}
const countingDb = {
  select: (_proj?: any) => {
    counts.select++;
    return makeChain(genericRows);
  },
};
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => countingDb) }));

import {
  scoreReadiness,
  computeProductReadinessBatch,
  type ReadinessAggregate,
} from "./productReadinessService";

function agg(partial: Partial<ReadinessAggregate>): ReadinessAggregate {
  return {
    productModelId: 1,
    productCode: "P1",
    productName: "Prod 1",
    hasImage: false,
    hasDims: false,
    pointCount: 0,
    numericPoints: 0,
    numericWithLimits: 0,
    withComponent: 0,
    fiducials: 0,
    goldens: 0,
    releases: 0,
    mappings: 0,
    panels: 0,
    ...partial,
  };
}

describe("scoreReadiness — math + checklist", () => {
  it("a fully-configured product scores 100 / ready", () => {
    const r = scoreReadiness(agg({
      hasImage: true, hasDims: true,
      pointCount: 100, numericPoints: 50, numericWithLimits: 50, withComponent: 100,
      fiducials: 3, goldens: 1, releases: 1, mappings: 2, panels: 1,
    }));
    expect(r.score).toBe(100);
    expect(r.band).toBe("ready");
    for (const it of r.items) {
      if (it.weight > 0) expect(it.status).toBe("ok");
    }
  });

  it("a partially-configured product yields the exact weighted score + gap detail", () => {
    // image partial(0.5)*15=7.5 · points 15 · limits (20/60)*25=8.333 · component 0
    // · fiducials 0.5*10=5 · golden 0 · release 0 · mapping 10  = 45.83 → 46.
    const r = scoreReadiness(agg({
      hasImage: true, hasDims: false,
      pointCount: 117, numericPoints: 60, numericWithLimits: 20, withComponent: 0,
      fiducials: 1, goldens: 0, releases: 0, mappings: 1, panels: 0,
    }));
    expect(r.score).toBe(46);
    expect(r.band).toBe("blocked");

    const byKey = Object.fromEntries(r.items.map((i) => [i.key, i]));
    expect(byKey.image.status).toBe("partial");
    expect(byKey.limits.status).toBe("partial");
    expect(byKey.limits.detail).toContain("40/60"); // 40 of 60 numeric points missing limits
    expect(byKey.componentCode.status).toBe("missing");
    expect(byKey.componentCode.detail).toContain("117/117");
    expect(byKey.golden.status).toBe("missing");
    expect(byKey.release.status).toBe("missing");
    expect(byKey.fiducials.status).toBe("partial");
    expect(byKey.mapping.status).toBe("ok");
    expect(byKey.panel.status).toBe("na"); // informational, no penalty
    expect(byKey.panel.weight).toBe(0);
  });

  it("an all-VISUAL product does not get penalised for missing numeric limits", () => {
    const r = scoreReadiness(agg({
      hasImage: true, hasDims: true,
      pointCount: 10, numericPoints: 0, numericWithLimits: 0, withComponent: 10,
      fiducials: 2, goldens: 1, releases: 1, mappings: 1, panels: 0,
    }));
    const limits = r.items.find((i) => i.key === "limits")!;
    expect(limits.status).toBe("na");
    expect(limits.fraction).toBe(1);
    expect(r.score).toBe(100);
  });

  it("an empty product is blocked with points + limits missing", () => {
    const r = scoreReadiness(agg({}));
    expect(r.score).toBe(0);
    expect(r.band).toBe("blocked");
    const byKey = Object.fromEntries(r.items.map((i) => [i.key, i]));
    expect(byKey.points.status).toBe("missing");
    expect(byKey.limits.status).toBe("missing");
  });
});

describe("computeProductReadinessBatch — no N+1", () => {
  beforeEach(() => { counts.select = 0; });

  it("issues the SAME (constant) number of queries for 1 and for 50 products", async () => {
    await computeProductReadinessBatch([1]);
    const forOne = counts.select;
    counts.select = 0;
    await computeProductReadinessBatch(Array.from({ length: 50 }, (_, i) => i + 1));
    const forFifty = counts.select;
    expect(forOne).toBe(forFifty);
    // 7 aggregate queries: products + points + fiducials + golden + release + mapping + panel.
    expect(forOne).toBe(7);
  });
});
