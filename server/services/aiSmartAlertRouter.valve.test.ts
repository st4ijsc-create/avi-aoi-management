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
    // Vòng sửa cuối, mục 3 — trần=2: lượt 1,2 ghi được (count 1,2 ≤ trần), lượt 3,4
    // chạm van (count 3,4 > trần) và bị bỏ. Đây là assertion DUY NHẤT canh biên
    // nextCount > cap; lỏng thành toBeLessThan(4) sẽ không bắt được lỗi off-by-one.
    expect(calls.filter((c) => c.kind === "occ").length).toBe(2);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("VAN AN TOÀN");
    warn.mockRestore();
  });

  // Sprint 5 debt E5 — throttle: trước sửa, MỖI lượt chạm trần lại warn ⇒ một
  // vòng lặp hỏng 1000 lượt/phút sinh 1000 dòng warn/phút — chính log dùng để
  // BẮT vòng lặp hỏng lại trở thành một vòng lặp gây ồn khác. Chỉ dòng warn
  // ĐẦU TIÊN của mỗi cửa sổ 5 phút được in ra.
  it("chạm van an toàn NHIỀU lần trong cùng cửa sổ ⇒ chỉ warn LẦN ĐẦU, không lặp lại mỗi lượt", async () => {
    process.env.ROUTE_ALERT_MAX_PER_WINDOW = "2";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { routeAlert } = await import("./aiSmartAlertRouter");
    seedOpenAlertRows = [{ id: 79, severity: "HIGH", occurrenceCount: 1, notificationSentAt: new Date() }];
    // Trần=2 ⇒ lượt 3,4,5,6 đều CHẠM van (4 lần chạm trong cùng cửa sổ), nhưng
    // chỉ lượt 3 (lần chạm ĐẦU TIÊN) được warn — lượt 4,5,6 im lặng ở log (vẫn
    // bị BỎ đúng như van cũ, chỉ không warn lặp lại).
    for (let i = 0; i < 6; i++) {
      await routeAlert({ type: "MACHINE_FAILURE", machineId: 8203, severity: "HIGH", message: "x", data: {} } as any);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // Sprint 5 debt E7(c) — trước đây chỉ assert log chứa chuỗi "VAN AN TOÀN"
  // chung chung, không kiểm được vận hành có tra đúng máy/loại cảnh báo đang
  // có vòng lặp hỏng hay không. Log THẬT đã nêu cả khoá lẫn số đếm — bài test
  // này lấp khoảng trống assertion, không đổi hành vi.
  it("nội dung cảnh báo van phải nêu RÕ khoá + số đếm, không chỉ 'VAN AN TOÀN' chung chung", async () => {
    process.env.ROUTE_ALERT_MAX_PER_WINDOW = "2";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { routeAlert } = await import("./aiSmartAlertRouter");
    seedOpenAlertRows = [{ id: 80, severity: "HIGH", occurrenceCount: 1, notificationSentAt: new Date() }];
    for (let i = 0; i < 3; i++) {
      await routeAlert({ type: "MACHINE_FAILURE", machineId: 8204, severity: "HIGH", message: "x", data: {} } as any);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("MACHINE_FAILURE:8204:all"); // khoá (consolidationKey) THẬT
    expect(msg).toContain("3"); // số đếm (nextCount) tại đúng lượt chạm van
    warn.mockRestore();
  });
});
