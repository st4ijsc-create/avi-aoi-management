/**
 * Unit tests for the CANONICAL KPI helpers (doc 27 decision #4, gaps A2/A3/A4/A8).
 * Pure math + SQL fragment rendering — no database required.
 */
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  finalYield,
  fpyFromFirstInspections,
  dpmo,
  sigmaLevelFromDpmo,
  sixSigmaFromCounts,
  roundPct,
  normInv,
  getFactoryTimezone,
  getDbStorageTimezone,
  assertValidTimezone,
  factoryLocalTsSql,
  factoryDateSql,
  factoryDayTextSql,
  factoryHourTextSql,
  factoryDateTruncSql,
  factoryHourOfDaySql,
  finalYieldPassCondSql,
  finalYieldPctSql,
  firstInspectionsSql,
  fpyAggregateSql,
} from "./kpi";
import { computeSixSigmaMetrics } from "./spc";

const dialect = new PgDialect();
const render = (chunk: any) => dialect.sqlToQuery(chunk);

const ORIGINAL_FACTORY_TZ = process.env.FACTORY_TZ;
const ORIGINAL_STORAGE_TZ = process.env.FACTORY_DB_STORAGE_TZ;
afterEach(() => {
  if (ORIGINAL_FACTORY_TZ === undefined) delete process.env.FACTORY_TZ;
  else process.env.FACTORY_TZ = ORIGINAL_FACTORY_TZ;
  if (ORIGINAL_STORAGE_TZ === undefined) delete process.env.FACTORY_DB_STORAGE_TZ;
  else process.env.FACTORY_DB_STORAGE_TZ = ORIGINAL_STORAGE_TZ;
});

// ─── Canonical yield math (decision #4 golden numbers) ────────────────────

describe("finalYield — canonical final yield (NTF = PASS)", () => {
  it("golden: 100 boards, 90 OK, 5 NTF, 5 NG → 95%", () => {
    expect(finalYield({ ok: 90, ntf: 5, total: 100 })).toBe(95);
  });

  it("returns 0 for empty population", () => {
    expect(finalYield({ ok: 0, ntf: 0, total: 0 })).toBe(0);
  });

  it("100% when everything passes (incl. all-NTF)", () => {
    expect(finalYield({ ok: 0, ntf: 10, total: 10 })).toBe(100);
  });
});

describe("fpyFromFirstInspections — true FPY (NTF/retests excluded)", () => {
  it("golden: NTF is NOT a first pass — 90 OK firsts of 100 firsts → 90% (not 95%)", () => {
    // 100 boards, first inspections: 90 OK, 5 NTF, 5 NG.
    // NTF stays in the denominator but never in the numerator.
    expect(fpyFromFirstInspections({ firstPass: 90, firstTotal: 100 })).toBe(90);
  });

  it("returns 0 when there are no usable serials", () => {
    expect(fpyFromFirstInspections({ firstPass: 0, firstTotal: 0 })).toBe(0);
  });
});

describe("dpmo / sigma — opportunities-based (gap A8)", () => {
  it("uses opportunities, not units: 5 defects / (100 boards × 30 points) → 1666.67 DPMO", () => {
    expect(dpmo({ defects: 5, opportunities: 100 * 30 })).toBeCloseTo(1666.6667, 3);
  });

  it("returns 0 for zero opportunities", () => {
    expect(dpmo({ defects: 5, opportunities: 0 })).toBe(0);
  });

  it("classic reference point: 6210 DPMO ≈ 4.0σ", () => {
    expect(sigmaLevelFromDpmo(6210)).toBeCloseTo(4.0, 1);
  });

  it("perfect quality caps at 6σ", () => {
    expect(sigmaLevelFromDpmo(0)).toBe(6);
  });

  it("sixSigmaFromCounts wires opportunitiesPerUnit into DPMO", () => {
    const m = sixSigmaFromCounts({ defects: 5, units: 100, opportunitiesPerUnit: 30 });
    expect(m.dpmo).toBe(1667); // rounded
    expect(m.defectRate).toBeCloseTo(5 / 3000, 10);
    expect(m.sigmaLevel).toBeCloseTo(sigmaLevelFromDpmo(1666.6667), 1);
  });

  it("computeSixSigmaMetrics (spc.ts) delegates and stays back-compatible", () => {
    const oldStyle = computeSixSigmaMetrics(5, 1000); // opportunitiesPerUnit defaults to 1
    expect(oldStyle.dpmo).toBe(5000);
    expect(oldStyle.yieldPercent).toBe(99.5);
    expect(oldStyle.sigmaLevel).toBeCloseTo(normInv(1 - 0.005) + 1.5, 2);
    // and the new parameter changes the result as expected
    const withOpp = computeSixSigmaMetrics(5, 1000, 50);
    expect(withOpp.dpmo).toBe(100); // 5 / 50,000 × 1e6
  });
});

describe("roundPct", () => {
  it("rounds to the requested precision", () => {
    expect(roundPct(33.33333, 2)).toBe(33.33);
    expect(roundPct(33.35, 1)).toBe(33.4);
  });
});

// ─── Timezone helpers ──────────────────────────────────────────────────────

describe("timezone configuration", () => {
  it("FACTORY_TZ env wins; defaults to Asia/Ho_Chi_Minh", () => {
    delete process.env.FACTORY_TZ;
    expect(getFactoryTimezone()).toBe("Asia/Ho_Chi_Minh");
    process.env.FACTORY_TZ = "Asia/Tokyo";
    expect(getFactoryTimezone()).toBe("Asia/Tokyo");
  });

  it("FACTORY_DB_STORAGE_TZ env wins; defaults to UTC (drizzle stores toISOString wall time)", () => {
    delete process.env.FACTORY_DB_STORAGE_TZ;
    expect(getDbStorageTimezone()).toBe("UTC");
    process.env.FACTORY_DB_STORAGE_TZ = "Asia/Bangkok";
    expect(getDbStorageTimezone()).toBe("Asia/Bangkok");
  });

  it("rejects invalid / injection-shaped timezone names", () => {
    expect(() => assertValidTimezone("Not/A_Real_Zone_XYZ")).toThrow();
    expect(() => assertValidTimezone("Asia/Ho_Chi_Minh'; DROP TABLE x;--")).toThrow();
  });
});

// ─── SQL fragment builders ─────────────────────────────────────────────────

describe("factory-timezone SQL fragments (gap A2)", () => {
  it("renders the storage→factory AT TIME ZONE chain with INLINED literals (no params)", () => {
    process.env.FACTORY_TZ = "Asia/Ho_Chi_Minh";
    process.env.FACTORY_DB_STORAGE_TZ = "UTC";
    const q = render(factoryLocalTsSql(sql`"inspectionTime"`));
    expect(q.sql).toBe(`(("inspectionTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')`);
    // Literals are inlined so the SAME expression can appear in SELECT and
    // GROUP BY without parameter-number mismatches.
    expect(q.params).toHaveLength(0);
  });

  it("bucket builders wrap the local-time chain", () => {
    process.env.FACTORY_TZ = "Asia/Ho_Chi_Minh";
    process.env.FACTORY_DB_STORAGE_TZ = "UTC";
    const col = sql`pi."inspectionTime"`;
    expect(render(factoryDateSql(col)).sql).toContain("CAST(");
    expect(render(factoryDayTextSql(col)).sql).toContain("'YYYY-MM-DD'");
    expect(render(factoryHourTextSql(col)).sql).toContain("'YYYY-MM-DD HH24:00'");
    expect(render(factoryDateTruncSql("day", col)).sql).toContain("date_trunc('day',");
    expect(render(factoryHourOfDaySql(col)).sql).toContain("EXTRACT(HOUR FROM");
    for (const frag of [factoryDateSql(col), factoryDayTextSql(col), factoryDateTruncSql("hour", col)]) {
      expect(render(frag).sql).toContain("AT TIME ZONE 'Asia/Ho_Chi_Minh'");
    }
  });

  it("rejects non-whitelisted date_trunc units", () => {
    expect(() => factoryDateTruncSql("day'); DROP TABLE x;--", sql`ts`)).toThrow();
  });
});

describe("canonical yield / FPY SQL fragments", () => {
  it("final-yield pass condition counts OK and NTF", () => {
    const q = render(finalYieldPassCondSql(sql`"overallResult"`));
    expect(q.sql).toBe(`"overallResult" IN ('OK', 'NTF')`);
  });

  it("finalYieldPctSql renders the canonical (ok+ntf)/count formula", () => {
    const q = render(finalYieldPctSql(sql`mr.result`, { countExpr: sql`COUNT(mr.id)` }));
    expect(q.sql).toBe(
      "ROUND(SUM(CASE WHEN mr.result IN ('OK', 'NTF') THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2)",
    );
  });

  it("firstInspectionsSql picks the earliest row per serial and excludes empty serials", () => {
    const q = render(firstInspectionsSql());
    expect(q.sql).toContain(`SELECT DISTINCT ON ("product_inspections"."serialNumber")`);
    expect(q.sql).toContain(`"product_inspections"."serialNumber" <> ''`);
    expect(q.sql).toContain(`ORDER BY "product_inspections"."serialNumber", "product_inspections"."inspectionTime" ASC, "product_inspections"."id" ASC`);
  });

  it("fpyAggregateSql counts only overallResult = 'OK' as a first pass", () => {
    const q = render(fpyAggregateSql());
    expect(q.sql).toContain("COUNT(*) FILTER (WHERE result = 'OK')::int AS first_pass");
  });

  it("fpyAggregateSql supports machine/bucket grouping", () => {
    expect(render(fpyAggregateSql({ groupBy: "machine" })).sql).toContain("GROUP BY machine_id");
    const bucketQ = render(fpyAggregateSql({ groupBy: "bucket", bucketExpr: sql`1` }));
    expect(bucketQ.sql).toContain("AS bucket");
    expect(bucketQ.sql).toContain("GROUP BY bucket");
  });
});
