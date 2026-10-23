/**
 * SCADA R0 Task 9 (D2) — cột `interlock_rules."khiThieuDuLieu"` (migration 0430) trên DB test thật.
 * Áp trước: `node scripts/apply-migration-0430.mjs --test-only`.
 *
 * Số tổng hợp (machineId/adapterId) — `ot_telemetry.machineId` và `interlock_rules.targetMachineId/targetAdapterId` không có FK.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { evaluateInterlockGate } from "./interlockGate";

const DB_URL = process.env.DATABASE_URL;
const MACHINE_ID = 990_430_001;
const ADAPTER_ID = 990_430_002;
const DAU = `T9-${Date.now()}`;

let sql: ReturnType<typeof postgres>;
const ruleIds: number[] = [];

async function chenLuat(extra: string | null): Promise<number> {
  const cols = extra ? `, "khiThieuDuLieu"` : "";
  const vals = extra ? `, '${extra}'` : "";
  const rows = await sql.unsafe(
    `INSERT INTO interlock_rules
       (name, scope, "machineId", "sourceType", "sourceKey", "comparisonOperator", threshold, "windowSize", "windowSeconds",
        action, "targetMachineId", "targetAdapterId", enabled, "approvedBy"${cols})
     VALUES ('${DAU}-${extra ?? "mac-dinh"}', 'machine', ${MACHINE_ID}, 'telemetry_tag', '${DAU}-tag', 'gt', 80, 50, 300,
        'block_downstream', ${MACHINE_ID}, ${ADAPTER_ID}, true, 1${vals}) RETURNING id`,
  );
  ruleIds.push(rows[0].id as number);
  return rows[0].id as number;
}

describe.skipIf(!DB_URL)("migration 0430 — khiThieuDuLieu", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    if (ruleIds.length) await sql`DELETE FROM interlock_rules WHERE id IN ${sql(ruleIds)}`;
    await sql`DELETE FROM ot_telemetry WHERE "machineId" = ${MACHINE_ID}`;
    await sql.end();
  });

  it("luật chèn KHÔNG khai cột ⇒ đọc ra 'chan'", async () => {
    const id = await chenLuat(null);
    const [r] = await sql`SELECT "khiThieuDuLieu" AS k FROM interlock_rules WHERE id = ${id}`;
    expect(r.k).toBe("chan");
  });

  it("'cho_qua' được giữ; giá trị lạ bị CHECK từ chối", async () => {
    const id = await chenLuat("cho_qua");
    const [r] = await sql`SELECT "khiThieuDuLieu" AS k FROM interlock_rules WHERE id = ${id}`;
    expect(r.k).toBe("cho_qua");
    await expect(sql`UPDATE interlock_rules SET "khiThieuDuLieu" = 'la' WHERE id = ${id}`).rejects.toMatchObject({ code: "23514" });
  });

  it("cổng THẬT (bộ đệm tắt): không có hàng telemetry ⇒ luật mặc định CHẶN, luật cho_qua thì không", async () => {
    expect(process.env.SCADA_LIVE_CACHE_ENABLED).not.toBe("true");
    const macDinh = await chenLuat(null);
    const choQua = await chenLuat("cho_qua");
    const kq = await evaluateInterlockGate({ adapterId: ADAPTER_ID, machineId: MACHINE_ID, tagKeys: [] });
    const cuaToi = kq.violations.filter((v) => [macDinh, choQua].includes(v.ruleId));
    expect(cuaToi.map((v) => v.ruleId)).toEqual([macDinh]);
    expect(cuaToi[0].lyDo).toBe("thieu_du_lieu");
    expect(cuaToi.map((v) => v.ruleId)).not.toContain(choQua);
    expect(kq.blocked).toBe(true);
  });
});
