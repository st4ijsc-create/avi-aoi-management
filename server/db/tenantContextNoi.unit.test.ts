/**
 * ĐIỂM NỐI `runWithTenantScope` → đường dữ liệu: cơ chế, không phải chính sách.
 *
 * Ca kiểm ở đây canh ba thứ mà một cổng CSDL KHÔNG canh được:
 *   1. Danh tính đi được qua AsyncLocalStorage tới tầng dữ liệu (không cần luồn `ctx`).
 *   2. Cổng an toàn `quyetDinhCuongChe` — BẢNG QUYẾT ĐỊNH đầy đủ, kể cả nhánh
 *      "phạm vi rỗng" (đo được: bật GUC với danh sách mã rỗng ⇒ 0 hàng trên CẢ 40 bảng).
 *   3. Lối đi KHÔNG mang danh tính KHÔNG mở giao dịch và KHÔNG đặt GUC nào.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chayVoiDanhTinhTenant,
  layPhamViTenantHienTai,
  quyetDinhCuongChe,
  chayTheoPhamViTenantHienTai,
  type TenantScope,
} from "./tenantContext";

const CO_GOC = process.env.TENANT_RLS_ENABLED;
beforeEach(() => {
  delete process.env.TENANT_RLS_ENABLED;
});
afterEach(() => {
  if (CO_GOC === undefined) delete process.env.TENANT_RLS_ENABLED;
  else process.env.TENANT_RLS_ENABLED = CO_GOC;
});

/** db giả: ghi lại có mở giao dịch không và những câu lệnh nào đã chạy. */
function dbGia() {
  const lenh: string[] = [];
  let soGiaoDich = 0;
  const tx = {
    execute: async (q: unknown) => {
      lenh.push(JSON.stringify((q as { queryChunks?: unknown[] })?.queryChunks ?? q));
      return [];
    },
    danhDau: "TX" as const,
  };
  const db = {
    danhDau: "DB" as const,
    execute: tx.execute,
    transaction: async <T,>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      soGiaoDich += 1;
      return fn(tx);
    },
  };
  return { db, lenh, soGiaoDich: () => soGiaoDich };
}

const SCOPE_CO_MA: TenantScope = { bypass: false, factoryCodes: ["F01"], corporateCodes: [] };
const SCOPE_RONG: TenantScope = { bypass: false, factoryCodes: [], corporateCodes: [] };
const SCOPE_ADMIN: TenantScope = { bypass: true, factoryCodes: [], corporateCodes: [] };

describe("AsyncLocalStorage — danh tính tới được tầng dữ liệu", () => {
  it("ngoài mọi request ⇒ KHÔNG có phạm vi (đây là lối đi tác vụ nền)", () => {
    expect(layPhamViTenantHienTai()).toBeUndefined();
  });

  it("trong `chayVoiDanhTinhTenant` ⇒ đọc lại được, kể cả sau `await`", async () => {
    const thay = await chayVoiDanhTinhTenant(SCOPE_CO_MA, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      return layPhamViTenantHienTai();
    });
    expect(thay).toEqual(SCOPE_CO_MA);
    // và KHÔNG rò ra ngoài
    expect(layPhamViTenantHienTai()).toBeUndefined();
  });

  it("hai nhánh song song KHÔNG lẫn phạm vi của nhau", async () => {
    const [x, y] = await Promise.all([
      chayVoiDanhTinhTenant({ factoryCodes: ["FA"] }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return layPhamViTenantHienTai()?.factoryCodes;
      }),
      chayVoiDanhTinhTenant({ factoryCodes: ["FB"] }, async () => {
        return layPhamViTenantHienTai()?.factoryCodes;
      }),
    ]);
    expect(x).toEqual(["FA"]);
    expect(y).toEqual(["FB"]);
  });
});

describe("quyetDinhCuongChe — BẢNG QUYẾT ĐỊNH", () => {
  it("cờ TẮT ⇒ không cưỡng chế, bất kể phạm vi (hành vi y hệt hôm nay)", () => {
    for (const s of [SCOPE_CO_MA, SCOPE_RONG, SCOPE_ADMIN, undefined]) {
      expect(quyetDinhCuongChe(s)).toEqual({ cuongChe: false, lyDo: "co-tat" });
    }
  });

  it("cờ BẬT + KHÔNG danh tính ⇒ không cưỡng chế (tác vụ nền phải sống)", () => {
    process.env.TENANT_RLS_ENABLED = "true";
    expect(quyetDinhCuongChe(undefined)).toEqual({ cuongChe: false, lyDo: "khong-danh-tinh" });
  });

  it("cờ BẬT + phạm vi RỖNG (không được gán nhà máy) ⇒ KHÔNG cưỡng chế", () => {
    process.env.TENANT_RLS_ENABLED = "true";
    // Đo được: GUC bật + danh sách mã rỗng ⇒ suppliers 5→0, device_types 31→0,
    // alarm_taxonomy 175→0 … cả 40 bảng về 0. RLS lọc IM LẶNG ⇒ màn hình trắng
    // không kèm lời giải thích. Quyết định này thuộc tầng ứng dụng
    // (accessControl.DENY_ALL_ROWS + NO_FACTORY_ASSIGNMENT_MESSAGE), nơi CÓ kênh
    // nói cho người dùng biết vì sao.
    expect(quyetDinhCuongChe(SCOPE_RONG)).toEqual({ cuongChe: false, lyDo: "pham-vi-rong" });
  });

  it("cờ BẬT + có mã ⇒ CƯỠNG CHẾ", () => {
    process.env.TENANT_RLS_ENABLED = "true";
    expect(quyetDinhCuongChe(SCOPE_CO_MA)).toEqual({ cuongChe: true });
    expect(quyetDinhCuongChe({ bypass: false, corporateCodes: ["C1"], factoryCodes: [] })).toEqual({ cuongChe: true });
  });

  it("cờ BẬT + admin (bypass) ⇒ CƯỠNG CHẾ (chạy thật, GUC bypass='on')", () => {
    process.env.TENANT_RLS_ENABLED = "true";
    expect(quyetDinhCuongChe(SCOPE_ADMIN)).toEqual({ cuongChe: true });
  });
});

describe("chayTheoPhamViTenantHienTai — điểm nối", () => {
  it("cờ TẮT ⇒ KHÔNG mở giao dịch, KHÔNG câu lệnh nào, nhận thẳng `db`", async () => {
    const { db, lenh, soGiaoDich } = dbGia();
    const nhan = await chayVoiDanhTinhTenant(SCOPE_CO_MA, () =>
      chayTheoPhamViTenantHienTai(db, async (h) => h.danhDau),
    );
    expect(nhan).toBe("DB");
    expect(soGiaoDich()).toBe(0);
    expect(lenh).toHaveLength(0);
  });

  it("cờ BẬT + có mã ⇒ mở giao dịch và đặt ĐỦ BỐN GUC", async () => {
    process.env.TENANT_RLS_ENABLED = "true";
    const { db, lenh, soGiaoDich } = dbGia();
    const nhan = await chayVoiDanhTinhTenant(SCOPE_CO_MA, () =>
      chayTheoPhamViTenantHienTai(db, async (h) => h.danhDau),
    );
    expect(nhan).toBe("TX"); // chạy trên handle GIAO DỊCH, không phải pool
    expect(soGiaoDich()).toBe(1);
    const het = lenh.join(" ");
    expect(het).toContain("app.tenant_rls_active");
    expect(het).toContain("app.tenant_bypass");
    expect(het).toContain("app.tenant_factory_codes");
    expect(het).toContain("app.tenant_corporate_codes");
    expect(lenh).toHaveLength(4);
  });

  it("cờ BẬT + KHÔNG danh tính ⇒ pass-through (tác vụ nền KHÔNG chết)", async () => {
    process.env.TENANT_RLS_ENABLED = "true";
    const { db, lenh, soGiaoDich } = dbGia();
    const nhan = await chayTheoPhamViTenantHienTai(db, async (h) => h.danhDau);
    expect(nhan).toBe("DB");
    expect(soGiaoDich()).toBe(0);
    expect(lenh).toHaveLength(0);
  });

  it("cờ BẬT + phạm vi RỖNG ⇒ pass-through (không làm trắng màn hình)", async () => {
    process.env.TENANT_RLS_ENABLED = "true";
    const { db, soGiaoDich } = dbGia();
    const nhan = await chayVoiDanhTinhTenant(SCOPE_RONG, () =>
      chayTheoPhamViTenantHienTai(db, async (h) => h.danhDau),
    );
    expect(nhan).toBe("DB");
    expect(soGiaoDich()).toBe(0);
  });

  it("cờ đọc tại THỜI ĐIỂM GỌI — lật giữa chừng là ăn ngay, không cần khởi động lại", async () => {
    const { db, soGiaoDich } = dbGia();
    await chayVoiDanhTinhTenant(SCOPE_CO_MA, () => chayTheoPhamViTenantHienTai(db, async () => 0));
    expect(soGiaoDich()).toBe(0);
    process.env.TENANT_RLS_ENABLED = "true";
    await chayVoiDanhTinhTenant(SCOPE_CO_MA, () => chayTheoPhamViTenantHienTai(db, async () => 0));
    expect(soGiaoDich()).toBe(1);
  });
});
