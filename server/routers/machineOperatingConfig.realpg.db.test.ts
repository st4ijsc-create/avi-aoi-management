/**
 * I-3 (mc-feature-review.md) — INTEGRATION test of `upsertOperatingConfigReport`
 * against the ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL → <db>_test).
 *
 * The sibling `machineOperatingConfig.test.ts` only proves the service against
 * `__otFakeDb`'s `onConflictDoUpdate`, which IGNORES `target`/`targetWhere`
 * entirely (see that fake's own source) — it cannot catch a wrong-arbiter bug,
 * and Postgres itself is what actually enforces "the ON CONFLICT target must
 * match a real unique/exclusion constraint or index" (42P10 invalid_column_reference
 * when it doesn't). This project has hit fake-vs-real-PG mismatches before
 * (memory: ANY-array 42809, date_bin 42803) — this test is the proof migration
 * 0298's two PARTIAL unique indexes (`uq_moc_machine_scope` WHERE productModelId
 * IS NULL / `uq_moc_product_scope` WHERE productModelId IS NOT NULL) really do
 * resolve the service's `targetWhere` arbiters on a REAL Postgres.
 *
 * `machine_operating_config` has no FK (soft refs, by design — see the table's
 * own header comment), so this test needs no factory/workshop/line/station/
 * machine/product fixture chain — a synthetic, high-range machineId/productModelId
 * pair (unlikely to collide with real seeded ids) is enough, cleaned up in afterAll.
 *
 * Skipped when no DATABASE_URL (matches every other `*.db.test.ts` in this repo).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { upsertOperatingConfigReport } from "../services/machineOperatingConfigService";

const DB_URL = process.env.DATABASE_URL;

// High, run-unique synthetic ids — no FK on this table, so nothing else needs
// to exist for these to be valid rows; just needs to not collide across runs.
const RUN = Date.now() % 1_000_000;
const MACHINE_ID = 900_000_000 + RUN;
const PRODUCT_ID = 800_000_000 + RUN;

let sql: ReturnType<typeof postgres>;

describe.skipIf(!DB_URL)("upsertOperatingConfigReport — real Postgres partial-index upsert (I-3)", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM machine_operating_config WHERE "machineId" = ${MACHINE_ID}`.catch(() => {});
    await sql.end({ timeout: 5 });
  });

  it("a machine-scoped row and a product-scoped row for the SAME (machineId, configKind) coexist, and re-reporting each in place updates it with no duplicate and no 42P10", async () => {
    // 1) First machine-scoped report (productModelId null → lands on uq_moc_machine_scope).
    const machineRow1 = await upsertOperatingConfigReport({
      machineId: MACHINE_ID,
      configKind: "screw_program",
      productModelId: null,
      baselineVersion: "1",
      adjustments: { torqueTarget: { value: 1.8, by: "tech1" } },
      effective: [{ key: "torqueTarget", value: 1.8, source: "machine", baselineValue: 1.35 }],
      checksum: "ck-machine-1",
      reportedBy: "SIM-M",
    });
    expect(machineRow1.scope).toBe("machine");
    expect(machineRow1.productModelId).toBeNull();

    // 2) First product-scoped report for the SAME (machineId, configKind) — a
    // DIFFERENT partial index (uq_moc_product_scope). Must NOT collide with #1.
    const productRow1 = await upsertOperatingConfigReport({
      machineId: MACHINE_ID,
      configKind: "screw_program",
      productModelId: PRODUCT_ID,
      baselineVersion: "1",
      adjustments: { torqueTarget: { value: 3.2, by: "tech2" } },
      effective: [{ key: "torqueTarget", value: 3.2, source: "machineProduct", baselineValue: 1.35 }],
      checksum: "ck-product-1",
      reportedBy: "SIM-M",
    });
    expect(productRow1.scope).toBe("machine_product");
    expect(productRow1.productModelId).toBe(PRODUCT_ID);
    expect(productRow1.id).not.toBe(machineRow1.id);

    // 3) Re-report the machine-scoped row IN PLACE — must resolve against
    // uq_moc_machine_scope again (same id, updated checksum), never throw
    // 42P10, never insert a second row.
    const machineRow2 = await upsertOperatingConfigReport({
      machineId: MACHINE_ID,
      configKind: "screw_program",
      productModelId: null,
      baselineVersion: "1",
      adjustments: { torqueTarget: { value: 1.9, by: "tech1" } },
      effective: [{ key: "torqueTarget", value: 1.9, source: "machine", baselineValue: 1.35 }],
      checksum: "ck-machine-2",
      reportedBy: "SIM-M",
    });
    expect(machineRow2.id).toBe(machineRow1.id);
    expect(machineRow2.checksum).toBe("ck-machine-2");

    // 4) Re-report the product-scoped row IN PLACE — must resolve against
    // uq_moc_product_scope again, independent of the machine-scoped row.
    const productRow2 = await upsertOperatingConfigReport({
      machineId: MACHINE_ID,
      configKind: "screw_program",
      productModelId: PRODUCT_ID,
      baselineVersion: "1",
      adjustments: { torqueTarget: { value: 3.4, by: "tech2" } },
      effective: [{ key: "torqueTarget", value: 3.4, source: "machineProduct", baselineValue: 1.35 }],
      checksum: "ck-product-2",
      reportedBy: "SIM-M",
    });
    expect(productRow2.id).toBe(productRow1.id);
    expect(productRow2.checksum).toBe("ck-product-2");

    // 5) The DEFINITIVE real-Postgres proof: exactly 2 rows total for this
    // (machineId, configKind) — one machine-scoped, one product-scoped — with
    // the LATEST checksums, queried independently of the service/drizzle layer.
    const rows = await sql`
      SELECT id, "productModelId", scope, checksum
      FROM machine_operating_config
      WHERE "machineId" = ${MACHINE_ID} AND "configKind" = 'screw_program'
      ORDER BY "productModelId" NULLS FIRST
    `;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ productModelId: null, scope: "machine", checksum: "ck-machine-2" });
    expect(rows[1]).toMatchObject({ productModelId: PRODUCT_ID, scope: "machine_product", checksum: "ck-product-2" });
  });
});
