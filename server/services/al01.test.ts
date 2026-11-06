/**
 * ★ Pha 0 AL0-1 (2026-11-04) — chặn hai nguồn lũ cảnh báo đo được (TechDocs 40 §1):
 *   (1) bộ dò detectDefectSpike / detectYieldDrop KHÔNG còn chạy theo lịch của AlertEvaluator (53 416 thông báo một tiêu đề, 5 người);
 *   (2) luật MQTT THROUGHPUT_LOW KHÔNG bắn khi không có message nào trong 24 h trước cửa sổ (3 183 lần bắn mù — không có nguồn MQTT thật).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const may = vi.hoisted(() => ({ goiDo: [] as string[], soLeoThang: 0, traVe: [] as unknown[], khongDb: false }));
vi.mock("./aiSmartAlertRouter", () => ({
  detectDefectSpike: async () => (may.goiDo.push("spike"), { id: 1 }),
  detectYieldDrop: async () => (may.goiDo.push("yield"), { id: 2 }),
  routeAlert: async () => void may.goiDo.push("route"),
  processAutoEscalation: async () => (may.soLeoThang++, 0),
}));
vi.mock("../routers/alertRouters", () => ({ evaluateActiveAlertSettings: async () => 0 }));
vi.mock("../db/connection", () => ({ getDb: async () => ({ select: () => ({ from: () => ({ where: async () => [{ id: 1 }], then: undefined }) }) }) }));
vi.mock("../db", () => ({ getDb: async () => (may.khongDb ? null : { execute: async () => may.traVe.shift() ?? [] }) }));

import { triggerAlertEvaluatorCycle } from "./alertEvaluatorScheduler";
import { __coMessageTruocCuaSoChoTest, __danhGiaLuatChoTest } from "./alertEvaluationService";

beforeEach(() => {
  may.goiDo = [];
  may.soLeoThang = 0;
  may.traVe = [];
  may.khongDb = false;
});

describe("AL0-1 (1) — AlertEvaluator không chạy bộ dò spike / yield", () => {
  it("★★★ một chu kỳ: KHÔNG gọi detectDefectSpike / detectYieldDrop / routeAlert; leo thang vẫn chạy", async () => {
    await triggerAlertEvaluatorCycle();
    expect(may.goiDo).toEqual([]);
    expect(may.soLeoThang).toBe(1);
  });
  it("★★ ghim nguồn: tệp lịch không còn GỌI hai bộ dò", () => {
    const src = readFileSync(join(__dirname, "alertEvaluatorScheduler.ts"), "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/detectDefectSpike\s*\(|detectYieldDrop\s*\(|routeAlert\s*\(/);
  });
});

describe("AL0-1 — coMessageTruocCuaSo đọc kết quả (SQL thật: al01.db.test.ts)", () => {
  it("★★ boolean / 't' / 'true' ⇒ true; 'f' / false / rỗng ⇒ false; không có DB ⇒ false (không bắn mù)", async () => {
    for (const co of [true, "t", "true"]) {
      may.traVe = [[{ co }]];
      expect(await __coMessageTruocCuaSoChoTest(30), String(co)).toBe(true);
    }
    for (const r of [[{ co: false }], [{ co: "f" }], []]) {
      may.traVe = [r];
      expect(await __coMessageTruocCuaSoChoTest(30), JSON.stringify(r)).toBe(false);
    }
    may.khongDb = true;
    expect(await __coMessageTruocCuaSoChoTest(30)).toBe(false);
  });
});

describe("AL0-1 (2) — THROUGHPUT_LOW cần luồng từng sống", () => {
  const luat = { id: 7, name: "Throughput thấp", ruleType: "THROUGHPUT_LOW", thresholdValue: "1", comparisonOperator: "LT", timeWindowMinutes: 30 };
  it("★★★ 0 msg/phút VÀ không message nào 24 h trước cửa sổ ⇒ KHÔNG bắn (không có nguồn)", async () => {
    may.traVe = [[{ count: "0" }], [{ co: false }]];
    const kq = await __danhGiaLuatChoTest(luat);
    expect(kq.triggered).toBe(false);
    expect(kq.message).toContain("không có nguồn");
  });
  it("★★★ 0 msg/phút NHƯNG luồng từng sống ⇒ BẮN như cũ (throughput rơi thật)", async () => {
    may.traVe = [[{ count: "0" }], [{ co: true }]];
    expect((await __danhGiaLuatChoTest(luat)).triggered).toBe(true);
  });
  it("★★ luồng sống, throughput trên ngưỡng ⇒ không bắn; THROUGHPUT_HIGH không đổi", async () => {
    may.traVe = [[{ count: "300" }], [{ co: true }]];
    expect((await __danhGiaLuatChoTest(luat)).triggered).toBe(false);
    may.traVe = [[{ count: "3000" }]];
    expect((await __danhGiaLuatChoTest({ ...luat, ruleType: "THROUGHPUT_HIGH", comparisonOperator: "GT", thresholdValue: "50" })).triggered).toBe(true);
  });
});
