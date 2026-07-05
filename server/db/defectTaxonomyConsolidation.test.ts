/**
 * Doc 31 Đợt E (WE-3, WB-2 finding) — defect taxonomy consolidation (migration 0201).
 *
 * Integration test against the isolated test DB. Proves the 5 duplicate pairs
 * (older 0086/0089 IPC codes vs newer 0137 "p4e" seed) are consolidated:
 *   1. Each duplicate is soft-retired (isActive=false, deletedAt NULL) with
 *      aliasOfCode pointing at the surviving canonical code.
 *   2. Exactly one ACTIVE row remains per canonical code.
 *   3. getDefectCatalogByCode resolves BOTH the survivor code AND the retired
 *      duplicate code to the same surviving row (forward alias — never unmatched).
 *   4. No operational row (measurement_results / defect_segmentations) references
 *      a retired duplicate id (no orphan on an inactive code).
 *
 * Requires the test DB provisioned + 0201 applied
 * (`node scripts/apply-migration-0201.mjs` or a fresh `node scripts/setup-test-db.mjs`).
 */
import { describe, it, expect } from "vitest";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { getDb } from "./connection";
import { getDefectCatalogByCode } from "./product";
import { defectCatalog, measurementResults, defectSegmentations } from "../../drizzle/schema";

// [survivor (0086/0089 canonical), retired duplicate (0137)]
const PAIRS: Array<[string, string]> = [
  ["BRIDGING", "SOLDER_BRIDGE"],
  ["COLD_JOINT", "COLD_SOLDER"],
  ["VOID", "SOLDER_VOID"],
  ["COMPONENT_MISALIGNMENT", "MISALIGNMENT"],
  ["REVERSE_POLARITY", "REVERSED_POLARITY"],
];

describe("Doc 31 WE-3 — defect taxonomy consolidation (0201)", () => {
  it("soft-retires each duplicate and records aliasOfCode → survivor", async () => {
    const d = await getDb();
    expect(d).toBeTruthy();
    for (const [survivor, dup] of PAIRS) {
      const rows = await d!.select().from(defectCatalog).where(eq(defectCatalog.code, dup));
      expect(rows.length, `duplicate ${dup} must still exist (soft-retired, not hard-deleted)`).toBe(1);
      expect(rows[0].isActive, `${dup} must be deactivated`).toBe(false);
      expect(rows[0].aliasOfCode, `${dup} must alias to ${survivor}`).toBe(survivor);
      expect(rows[0].deletedAt, `${dup} must NOT be hard-deleted`).toBeNull();
    }
  });

  it("keeps exactly one ACTIVE row per surviving canonical code", async () => {
    const d = await getDb();
    for (const [survivor] of PAIRS) {
      const active = await d!
        .select()
        .from(defectCatalog)
        .where(and(eq(defectCatalog.code, survivor), eq(defectCatalog.isActive, true), isNull(defectCatalog.deletedAt)));
      expect(active.length, `exactly one active ${survivor}`).toBe(1);
    }
  });

  it("resolves BOTH the survivor code and the retired duplicate code to the survivor row", async () => {
    for (const [survivor, dup] of PAIRS) {
      const viaSurvivor = await getDefectCatalogByCode(survivor);
      const viaDup = await getDefectCatalogByCode(dup);
      expect(viaSurvivor?.code, `${survivor} resolves`).toBe(survivor);
      expect(viaDup, `${dup} must resolve via alias (never unmatched)`).toBeTruthy();
      expect(viaDup?.code, `${dup} resolves to survivor ${survivor}`).toBe(survivor);
      expect(viaDup?.id).toBe(viaSurvivor?.id);
      expect(viaDup?.isActive).toBe(true);
    }
  });

  it("leaves no operational reference pointing at a retired duplicate (no orphan)", async () => {
    const d = await getDb();
    const dupCodes = PAIRS.map(([, dup]) => dup);
    const dupRows = await d!.select().from(defectCatalog).where(inArray(defectCatalog.code, dupCodes));
    const dupIds = dupRows.map((r) => r.id);
    expect(dupIds.length).toBe(PAIRS.length);
    const mr = await d!.select().from(measurementResults).where(inArray(measurementResults.defectCatalogId, dupIds));
    expect(mr.length, "no measurement_results may reference a retired duplicate").toBe(0);
    const seg = await d!.select().from(defectSegmentations).where(inArray(defectSegmentations.defectCatalogId, dupIds));
    expect(seg.length, "no defect_segmentations may reference a retired duplicate").toBe(0);
  });
});
