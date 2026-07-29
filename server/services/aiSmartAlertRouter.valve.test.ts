/**
 * Sprint 5 §2.5 — cửa sổ gộp Redis KHÔNG còn là cổng chặn.
 *
 * Trần cũ `nextCount > 3` return sớm TRƯỚC cả đường ghi DB lẫn nhật ký
 * predictive_alert_occurrences ⇒ lần tái diễn thứ 4+ trong 5 phút biến mất
 * KHÔNG dấu vết. Hai hệ quả: KPI Wave 4 đếm thiếu NGAY TẠI CỬA, và flood
 * ISA-18.2 (>10/10 phút) không bao giờ kích hoạt được cho MỘT máy — trần cứng
 * 3/5 phút = 6/10 phút, dưới ngưỡng.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { predictiveAlerts, machines, predictiveAlertOccurrences, users } from "../../drizzle/schema";

const calls: { kind: string }[] = [];
let seedOpenAlertRows: any[] = [];

function chain(getRows: () => any[]) {
  const node: any = {
    where: () => node,
    orderBy: () => node,
    limit: async () => getRows(),
    then: (r: any, j: any) => Promise.resolve(getRows()).then(r, j),
    catch: (j: any) => Promise.resolve(getRows()).catch(j),
  };
  return node;
}

vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: (_c?: any) => ({
      from: (table: any) => {
        if (table === predictiveAlerts) return chain(() => seedOpenAlertRows);
        if (table === machines) return chain(() => [{ code: "M-01" }]);
        if (table === users) return chain(() => []);
        return chain(() => []);
      },
    }),
    insert: (table: any) => ({
      values: (_v: any) => {
        calls.push({ kind: table === predictiveAlertOccurrences ? "occ" : "insert" });
        return table === predictiveAlertOccurrences
          ? Promise.resolve(undefined)
          : { returning: async () => [{ id: 1 }] };
      },
    }),
    update: (_t: any) => ({ set: (_v: any) => ({ where: () => Promise.resolve(undefined) }) }),
    execute: async () => ({ rows: [] }),
  }),
}));
vi.mock("./aiGgufEngine", () => ({
  generateText: vi.fn(async () => ({ text: "" })),
  isGgufAvailable: vi.fn(async () => false),
}));
vi.mock("./notificationService", () => ({ sendAlertNotification: vi.fn(async () => undefined) }));
vi.mock("./emailService", () => ({ sendAlertEmail: vi.fn(async () => undefined) }));

beforeEach(() => {
  calls.length = 0;
  seedOpenAlertRows = [];
});
afterEach(() => { delete process.env.ROUTE_ALERT_MAX_PER_WINDOW; });

describe("routeAlert — cửa sổ gộp không còn nuốt lần tái diễn", () => {
  it("gọi 12 lần liên tiếp trong cùng cửa sổ ⇒ 12 dòng nhật ký (đủ để flood >10/10ph kích hoạt)", async () => {
    const { routeAlert } = await import("./aiSmartAlertRouter");
    // Dòng cha "đang mở" để mọi lượt sau lượt đầu đi nhánh update.
    seedOpenAlertRows = [{ id: 77, severity: "HIGH", occurrenceCount: 1, notificationSentAt: new Date() }];
    for (let i = 0; i < 12; i++) {
      await routeAlert({ type: "MACHINE_FAILURE", machineId: 8201, severity: "HIGH", message: "x", data: {} } as any);
    }
    expect(calls.filter((c) => c.kind === "occ")).toHaveLength(12); // trước đây: 3
  });

  it("chạm van an toàn ⇒ CẢNH BÁO ra log và bỏ lượt, không im lặng", async () => {
    process.env.ROUTE_ALERT_MAX_PER_WINDOW = "2";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { routeAlert } = await import("./aiSmartAlertRouter");
    seedOpenAlertRows = [{ id: 78, severity: "HIGH", occurrenceCount: 1, notificationSentAt: new Date() }];
    for (let i = 0; i < 4; i++) {
      await routeAlert({ type: "MACHINE_FAILURE", machineId: 8202, severity: "HIGH", message: "x", data: {} } as any);
    }
    expect(calls.filter((c) => c.kind === "occ").length).toBeLessThan(4);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("VAN AN TOÀN");
    warn.mockRestore();
  });
});
