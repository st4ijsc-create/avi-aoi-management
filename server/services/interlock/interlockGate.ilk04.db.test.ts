/**
 * ILK-04 (doc 80 Phụ lục D §6/§7.4 "Vá ngay") — CỔNG interlock (`interlockGate.ts`
 * `fetchObservation` nhánh `telemetry_tag`) phải đọc N MẪU **MỚI NHẤT** trong cửa
 * sổ, không phải N mẫu CŨ NHẤT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * TÁI HIỆN ĐÚNG KỊCH BẢN AUDIT (D_HUB_ECN_RECIPE_INTERLOCK.md §6 ILK-04):
 *   120 mẫu trong cửa sổ (windowSeconds=3600), windowSize=50. Giá trị NG chỉ
 *   vượt ngưỡng ở MẪU MỚI NHẤT; 119 mẫu còn lại đều an toàn.
 *   Trước vá — `ORDER BY ts ASC LIMIT 50` lấy đúng 50 mẫu CŨ NHẤT (#1..#50),
 *   toàn bộ dưới ngưỡng ⇒ cổng KHÔNG chặn dù máy đang vi phạm NGAY LÚC NÀY.
 *   Sau vá — `ORDER BY ts DESC LIMIT 50` lấy 50 mẫu MỚI NHẤT (#71..#120) rồi
 *   đảo về thứ tự tăng dần (hợp đồng "series newest-last" của ruleEvaluator)
 *   ⇒ latest = mẫu #120 (vượt ngưỡng) ⇒ cổng CHẶN.
 * ══════════════════════════════════════════════════════════════════════════════
 * Cổng DB thật (`_test`, ép bởi vitest.setup). Không dùng machines/factories —
 * `ot_telemetry.machineId` và `interlock_rules.targetMachineId`/`targetAdapterId`
 * là các cột KHÔNG có FK (đọc trong drizzle/schema/{ot,interlock}.ts) nên số
 * tổng hợp bất kỳ là an toàn cho một fixture tự dựng + tự dọn.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { evaluateInterlockGate } from "./interlockGate";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILK04-${Date.now()}`;
const METRIC = `${DAU}-ng_tag`;
// Số tổng hợp, KHÔNG chạm bảng machines/factories (không cột nào có FK tới đó).
const MACHINE_ID = 990_100_001;
const ADAPTER_ID = 990_100_002;
const NEWEST_VALUE = 34.71;
const OLD_VALUE = 10;
const THRESHOLD = 20;

let sql: ReturnType<typeof postgres>;
let ruleId: number;

describe.skipIf(!DB_URL)("ILK-04 — interlockGate đọc mẫu telemetry MỚI NHẤT trong cửa sổ", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });

    // 120 mẫu cách nhau 20s (⇒ trải ~2380s < windowSeconds=3600s ⇒ CẢ 120 mẫu
    // đều "trong cửa sổ"). Mẫu MỚI NHẤT (#120, gần `now` nhất) = 34.71 (>
    // ngưỡng 20); 119 mẫu còn lại (kể cả 50 mẫu CŨ NHẤT) = 10 (< ngưỡng).
    const now = Date.now();
    const rows: Array<{ ts: Date; value: number }> = [];
    for (let i = 1; i <= 120; i++) {
      rows.push({ ts: new Date(now - (120 - i) * 20_000), value: i === 120 ? NEWEST_VALUE : OLD_VALUE });
    }
    for (const r of rows) {
      await sql`
        INSERT INTO ot_telemetry (ts, "machineId", protocol, metric, "numValue", quality)
        VALUES (${r.ts}, ${MACHINE_ID}, 'mqtt', ${METRIC}, ${r.value}, 'good')`;
    }

    const inserted = await sql`
      INSERT INTO interlock_rules
        (name, scope, "machineId", "sourceType", "sourceKey", "comparisonOperator", threshold,
         "windowSize", "windowSeconds", action, "targetMachineId", enabled, "approvedBy")
      VALUES
        (${`${DAU}-rule`}, 'machine', ${MACHINE_ID}, 'telemetry_tag', ${METRIC}, 'gt', ${THRESHOLD},
         50, 3600, 'block_downstream', ${MACHINE_ID}, true, 999999)
      RETURNING id`;
    ruleId = (inserted[0] as unknown as { id: number }).id;
  }, 60_000);

  afterAll(async () => {
    await sql`DELETE FROM interlock_rules WHERE id = ${ruleId}`;
    await sql`DELETE FROM ot_telemetry WHERE metric = ${METRIC}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ dữ kiện nền — 120 mẫu đã ghi; 50 mẫu CŨ NHẤT đều an toàn; mẫu MỚI NHẤT vượt ngưỡng", async () => {
    const rows = (await sql`
      SELECT "numValue" FROM ot_telemetry WHERE metric = ${METRIC} ORDER BY ts ASC
    `) as unknown as Array<{ numValue: string }>;
    expect(rows).toHaveLength(120);
    const oldest50 = rows.slice(0, 50).map((r) => Number(r.numValue));
    expect(oldest50.every((v) => v < THRESHOLD)).toBe(true);
    expect(Number(rows[rows.length - 1]!.numValue)).toBe(NEWEST_VALUE);
  });

  it("★★★ CHẶN — giá trị MỚI NHẤT vượt ngưỡng dù 50 mẫu cũ nhất đều an toàn (trước vá: không chặn)", async () => {
    const r = await evaluateInterlockGate({ adapterId: ADAPTER_ID, machineId: MACHINE_ID, tagKeys: [] });
    expect(r.failClosed).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ ruleId, action: "block_downstream" });
  });
});
