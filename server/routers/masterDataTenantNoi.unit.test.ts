/**
 * `masterDataRouter.listAll`/`getOne` CÓ THẬT SỰ đi qua `chayTheoPhamViTenantHienTai` không?
 *
 * ── VÌ SAO PHẢI CÓ TỆP NÀY (một đột biến SỐNG SÓT đã đòi nó) ────────────────
 * 2026-08-18: gỡ bỏ lớp bọc RLS khỏi `listAll` và `getOne` (đưa hai hàm về đúng
 * `db.select()` như trước) rồi chạy `masterDataRouter.test.ts` (33 ca) +
 * `tenantRlsCuongChe.db.test.ts` (18 ca): **51/51 VẪN XANH**. Đột biến ĐÃ ăn
 * (đếm được 2 dấu vết trong tệp nguồn, số lời gọi `chayTheoPhamViTenantHienTai`
 * rơi 5→3) mà không lưới nào đỏ.
 *
 * Lý do lỗ hổng: `masterDataRouter.test.ts` giả lập `../db/connection` bằng
 * FakeDb nên không bao giờ chạm CSDL thật; còn `tenantRlsCuongChe.db.test.ts`
 * canh ĐÚNG HÌNH DẠNG lời gọi trên CSDL thật nhưng **tự dựng lời gọi ấy**, nó
 * không đi qua router. Hai lưới cộng lại vẫn để lọt "router thôi không gọi nữa".
 *
 * ── CÁI TỆP NÀY CANH ───────────────────────────────────────────────────────
 * Không canh chính sách RLS (việc đó thuộc `tenantRlsCuongChe.db.test.ts`), mà
 * canh MỘT điều duy nhất: khi cờ BẬT và người gọi CÓ phạm vi, truy vấn của
 * `listAll`/`getOne` chạy **bên trong một giao dịch có đủ bốn GUC**, chứ không
 * chạy thẳng trên pool. Đó chính là thứ đột biến trên xoá đi.
 *
 * ── `congMaTenant` bị giả lập thành "cho qua tất" — CÓ CHỦ Ý ────────────────
 * Cổng ở tầng ứng dụng được cố tình vô hiệu hoá để mô hình hoá đúng tình huống
 * mà phòng vệ theo chiều sâu sinh ra để chịu: **lớp một hỏng, lớp hai có còn
 * không?** Nếu để cả hai lớp cùng lọc thì không ô nào phân biệt được lớp nào đã
 * làm việc, và đột biến lại sống sót lần nữa.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { getTableName } from "drizzle-orm";

/**
 * Ghi lại đường đi thật của truy vấn: chạy trên `db` hay trên handle giao dịch.
 *
 * ⚠ CHỈ ghi truy vấn chạm ĐÚNG bảng đang xét. Đường đi của `protectedProcedure`
 * có sẵn những truy vấn khác trên `db` (RBAC/giấy phép); gộp chung vào một danh
 * sách thì ô kiểm đo nhầm thứ và không phân biệt được lớp nào đã làm việc.
 */
const ghi = { moGiaoDich: 0, soGuc: 0, chayTren: [] as string[], bangQuanTam: "suppliers" };

function taoHandle(nhan: string) {
  const chuoi = (bang?: string) => {
    const c: any = {
      from: (t: any) => chuoi(safeTableName(t)),
      where: () => c,
      limit: async () => {
        if (bang === ghi.bangQuanTam) ghi.chayTren.push(nhan);
        return [];
      },
      orderBy: async () => {
        if (bang === ghi.bangQuanTam) ghi.chayTren.push(nhan);
        return [];
      },
    };
    return c;
  };
  return {
    select: () => chuoi(),
    execute: async () => {
      ghi.soGuc++;
      return [];
    },
  } as any;
}

function safeTableName(t: any): string | undefined {
  try {
    return getTableName(t);
  } catch {
    return undefined;
  }
}

const dbGia: any = taoHandle("db");
dbGia.transaction = async (fn: any) => {
  ghi.moGiaoDich++;
  return fn(taoHandle("tx"));
};

vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => dbGia) }));

// Cổng tầng ứng dụng "cho qua tất" — xem docblock đầu tệp.
vi.mock("../db/hierarchy", async (orig) => ({
  ...(await orig<typeof import("../db/hierarchy")>()),
  congMaTenant: vi.fn(async () => undefined),
}));

// `requirePermission` cho qua; `getTenantScope` cấp danh tính CÓ phạm vi cho
// `tenantScopeMiddleware` (nó `await import("./accessControl")` lúc chạy).
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
  getTenantScope: vi.fn(async () => ({ factoryCodes: ["FAC-A"], corporateCodes: [] })),
}));

import { masterDataRouter } from "./masterDataRouter";

const caller = masterDataRouter.createCaller({ user: { id: 7, role: "engineer", name: "E" } } as any);
const CO_GOC = process.env.TENANT_RLS_ENABLED;

beforeEach(() => {
  ghi.moGiaoDich = 0;
  ghi.soGuc = 0;
  ghi.chayTren = [];
  ghi.bangQuanTam = "suppliers";
});
afterAll(() => {
  if (CO_GOC === undefined) delete process.env.TENANT_RLS_ENABLED;
  else process.env.TENANT_RLS_ENABLED = CO_GOC;
});

describe("masterDataRouter — hai điểm nghẽn có nhận nuôi cưỡng chế CSDL không", () => {
  it("cờ BẬT + có phạm vi ⇒ `listAll` chạy TRONG giao dịch, đủ BỐN GUC", async () => {
    process.env.TENANT_RLS_ENABLED = "true";
    await caller.suppliers.list({});
    expect(ghi.moGiaoDich, "listAll không mở giao dịch ⇒ lớp bọc RLS đã bị gỡ").toBe(1);
    expect(ghi.soGuc, "thiếu GUC ⇒ chính sách RLS không được kích hoạt").toBe(4);
    expect(ghi.chayTren, "truy vấn chạy thẳng trên pool, không trên handle giao dịch").toEqual(["tx"]);
  });

  it("cờ BẬT + có phạm vi ⇒ `getOne` cũng vậy", async () => {
    process.env.TENANT_RLS_ENABLED = "true";
    await caller.suppliers.get({ id: 1 });
    expect(ghi.moGiaoDich).toBe(1);
    expect(ghi.soGuc).toBe(4);
    expect(ghi.chayTren).toEqual(["tx"]);
  });

  it("cả bốn bảng CÓ THỂ cưỡng chế đều đi qua điểm nghẽn này", async () => {
    // materials · tools · suppliers · customers là ĐÚNG bốn bảng RLS có hàng mang
    // mã tenant (36/388 hàng, đo 2026-08-18). Nếu một bảng rơi khỏi `listAll`
    // sang truy vấn tự viết, ô này đỏ.
    process.env.TENANT_RLS_ENABLED = "true";
    const bon: [string, any][] = [
      ["materials", caller.materials],
      ["tools", caller.tools],
      ["suppliers", caller.suppliers],
      ["customers", caller.customers],
    ];
    for (const [ten, goi] of bon) {
      ghi.moGiaoDich = 0;
      ghi.chayTren = [];
      ghi.bangQuanTam = ten;
      await goi.list({});
      expect(ghi.moGiaoDich, `${ten}: không mở giao dịch`).toBe(1);
      expect(ghi.chayTren, `${ten}: truy vấn không chạy trên handle giao dịch`).toEqual(["tx"]);
    }
  });

  it("CHỐNG VÁ QUÁ TAY — cờ TẮT ⇒ KHÔNG giao dịch, KHÔNG GUC (y hệt trước đây)", async () => {
    process.env.TENANT_RLS_ENABLED = "false";
    await caller.suppliers.list({});
    expect(ghi.moGiaoDich, "cờ tắt mà vẫn mở giao dịch ⇒ đã thêm chi phí cho lối đi mặc định").toBe(0);
    expect(ghi.soGuc).toBe(0);
    expect(ghi.chayTren).toEqual(["db"]);
  });
});
