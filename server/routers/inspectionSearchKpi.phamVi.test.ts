/**
 * Q0-3 — `inspection.searchKpi` ở MỨC ROUTER: phạm vi nhà máy + giải id → code.
 * kiem-dinh 2026-11-06 (lô C ❌): đột biến s3 (bỏ bước giải id→code) và s4 (bỏ userId/userRole khi gọi
 * `summarizeInspections`) sống sót — test DB của `summarizeInspections` gọi thẳng hàm DB nên không thấy router.
 * Không chạm DB: `../db` giữ nguyên trừ `summarizeInspections` (bản ghi lại tham số) và `phaiDoiMatKhau`;
 * `getDb` (chỉ dùng để giải id→code) là bản giả trả theo THỨ TỰ máy → tuyến → nhà máy.
 *
 * Phạm vi thật (lọc theo nhà máy gán cho người dùng) do `summarizeInspections`/`resolveDataScope` thực thi và được ghim
 * bằng DB ở `server/db/statisticsScope.test.ts` (probe `summarizeInspections` {admin:5, userA:2}); ở đây ghim rằng ROUTER
 * luôn chuyển đúng danh tính người gọi xuống, để người ngoài phạm vi không bao giờ nhận KPI không-lọc.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ goi: [] as Array<Record<string, unknown>>, hangDoi: [] as unknown[][] }));
function chuoi(kq: unknown[]): any {
  const c: any = new Proxy(function () {}, {
    get(_t, p) {
      if (p === "then") return (res: (v: unknown) => void) => res(kq);
      return () => c;
    },
    apply() { return c; },
  });
  return c;
}
vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  return { ...actual, getDb: async () => ({ select: () => chuoi(h.hangDoi.shift() ?? []) }) };
});
vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    phaiDoiMatKhau: async () => false,
    summarizeInspections: async (p: Record<string, unknown>) => {
      h.goi.push(p);
      return { total: 0, okCount: 0, ngCount: 0, ntfCount: 0, yieldRate: 0, machineStats: [], dateStats: [], productStats: [] };
    },
    searchInspections: async (p: Record<string, unknown>) => {
      h.goi.push(p);
      return { data: [], total: 0 };
    },
  };
});

import { inspectionRouter } from "./inspectionRouters";

const caller = (id: number, role: string) =>
  inspectionRouter.createCaller({ user: { id, role, name: "u", twoFactorEnabled: true } } as never);

beforeEach(() => { h.goi.length = 0; h.hangDoi.length = 0; });

describe("inspection.searchKpi — danh tính người gọi", () => {
  it("s4 — chuyển userId + userRole của TỪNG người gọi xuống summarizeInspections (hai người khác phạm vi)", async () => {
    await caller(11, "engineer").searchKpi({});
    await caller(22, "supervisor").searchKpi({});
    expect(h.goi).toHaveLength(2);
    expect(h.goi[0]).toMatchObject({ userId: 11, userRole: "engineer" });
    expect(h.goi[1]).toMatchObject({ userId: 22, userRole: "supervisor" });
  });

  it("admin cũng được chuyển danh tính (việc bỏ lọc cho admin là của tầng DB, không phải của router)", async () => {
    await caller(1, "admin").searchKpi({});
    expect(h.goi[0]).toMatchObject({ userId: 1, userRole: "admin" });
  });
});

describe("inspection.searchKpi — giải id → code (cùng bộ lọc với search)", () => {
  it("s3 — machineId / lineId / factoryId được giải thành machineCode / lineCode / factoryCode; id KHÔNG đi tiếp", async () => {
    h.hangDoi.push([{ code: "M-77" }], [{ code: "L-3" }], [{ code: "F-B" }]); // thứ tự: máy, tuyến, nhà máy
    await caller(11, "engineer").searchKpi({ machineId: 77, lineId: 3, factoryId: 9 } as never);
    expect(h.goi[0]).toMatchObject({ machineCode: "M-77", lineCode: "L-3", factoryCode: "F-B", userId: 11 });
    expect(h.goi[0]).not.toHaveProperty("machineId");
    expect(h.goi[0]).not.toHaveProperty("lineId");
    expect(h.goi[0]).not.toHaveProperty("factoryId");
  });

  it("CODE tường minh luôn THẮNG id (không tra cứu)", async () => {
    h.hangDoi.push([{ code: "SAI" }]);
    await caller(11, "engineer").searchKpi({ machineId: 77, machineCode: "M-GO-TAY" } as never);
    expect(h.goi[0]).toMatchObject({ machineCode: "M-GO-TAY" });
    expect(h.hangDoi).toHaveLength(1); // không tiêu thụ hàng đợi ⇒ không tra máy
  });

  it("id KHÔNG ra code (không tồn tại) ⇒ đặt khongKhop=true (KHÔNG bỏ bộ lọc), cho CẢ searchKpi VÀ search; vẫn mang danh tính người gọi", async () => {
    for (const goi of [
      (c: ReturnType<typeof caller>) => c.searchKpi({ machineId: 999999 } as never),
      (c: ReturnType<typeof caller>) => c.search({ machineId: 999999 } as never),
      (c: ReturnType<typeof caller>) => c.searchKpi({ lineId: 999999 } as never),
      (c: ReturnType<typeof caller>) => c.search({ factoryId: 999999 } as never),
    ]) {
      h.goi.length = 0;
      h.hangDoi.push([]);
      await goi(caller(22, "supervisor"));
      expect(h.goi[0]).toMatchObject({ khongKhop: true, userId: 22, userRole: "supervisor" });
      expect(h.goi[0]).not.toHaveProperty("machineCode");
    }
  });

  it("id hợp lệ ra code ⇒ KHÔNG đặt khongKhop (lọc đúng như cũ), cho cả search", async () => {
    h.hangDoi.push([{ code: "M-77" }]);
    await caller(11, "engineer").search({ machineId: 77 } as never);
    expect(h.goi[0]).toMatchObject({ machineCode: "M-77", userId: 11 });
    expect(h.goi[0]).not.toHaveProperty("khongKhop");
  });
});
