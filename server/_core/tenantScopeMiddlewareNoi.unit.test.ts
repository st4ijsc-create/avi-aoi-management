/**
 * NỬA THỨ NHẤT của điểm nối: `tenantScopeMiddleware` phải ĐẶT phạm vi tenant vào
 * AsyncLocalStorage cho suốt vòng đời request.
 *
 * VÌ SAO CẦN CA KIỂM RIÊNG: `server/db/tenantContextNoi.unit.test.ts` chứng minh
 * cơ chế ALS + cổng an toàn hoạt động khi CÓ AI ĐÓ gọi `chayVoiDanhTinhTenant`.
 * Nó KHÔNG chứng minh rằng đường request thật sự gọi hàm ấy. Bỏ đúng một lời gọi
 * ở `trpc.ts` là toàn bộ cơ chế thành trơ trở lại — đúng thứ đã xảy ra suốt từ
 * 2026-06 (cờ bật, chính sách có, `runWithTenantScope` 0 nơi gọi). Ca này gọi qua
 * `createCaller`, tức đi qua ĐÚNG chuỗi middleware của `protectedProcedure`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockCorporate = vi.fn();
const mockFactory = vi.fn();
// ⚠ PHẢI giữ nguyên phần còn lại của module: `server/db/index.ts` RE-EXPORT từ
// `./auth`, và `trpc.ts` gọi `phaiDoiMatKhau` qua cái barrel đó. Một factory mock
// "sạch" (chỉ trả hai hàm) sẽ làm barrel mất `phaiDoiMatKhau` ⇒ mọi thủ tục ném
// `phaiDoiMatKhau is not a function`. Đây đúng là khuôn nợ đã có sẵn trong repo
// (85 file mock `../db` thiếu `phaiDoiMatKhau`) — không chép lại nó ở đây.
vi.mock("../db/auth", async (nhapThat) => ({
  ...(await nhapThat<typeof import("../db/auth")>()),
  getUserCorporateAssignments: (...a: unknown[]) => mockCorporate(...a),
  getUserFactoryAssignments: (...a: unknown[]) => mockFactory(...a),
  phaiDoiMatKhau: async () => false,
}));

import { router, protectedProcedure } from "./trpc";
import { clearAssignmentCache } from "./accessControl";
import { layPhamViTenantHienTai, type TenantScope } from "../db/tenantContext";

const CO_GOC = process.env.TENANT_RLS_ENABLED;

/** Router bé xíu: mỗi việc là báo lại phạm vi mà tầng dữ liệu NHÌN THẤY. */
const routerThu = router({
  phamViTangDuLieu: protectedProcedure.query(
    async (): Promise<TenantScope | undefined> => {
      await Promise.resolve(); // qua một ranh giới async — ALS phải sống sót
      return layPhamViTenantHienTai();
    },
  ),
});

const nguoiDung = (id: number, role: string) =>
  ({ user: { id, role, name: `u${id}`, twoFactorEnabled: true } }) as never;

beforeEach(() => {
  clearAssignmentCache();
  mockCorporate.mockReset().mockResolvedValue([]);
  mockFactory.mockReset().mockResolvedValue([]);
  delete process.env.TENANT_RLS_ENABLED;
});
afterEach(() => {
  if (CO_GOC === undefined) delete process.env.TENANT_RLS_ENABLED;
  else process.env.TENANT_RLS_ENABLED = CO_GOC;
});

describe("tenantScopeMiddleware — danh tính có tới được tầng dữ liệu không", () => {
  it("cờ TẮT ⇒ tầng dữ liệu KHÔNG thấy phạm vi nào (hành vi y hệt hôm nay)", async () => {
    mockFactory.mockResolvedValue([{ factoryCode: "F01" }]);
    const thay = await routerThu.createCaller(nguoiDung(7, "engineer")).phamViTangDuLieu();
    expect(thay).toBeUndefined();
  });

  it("cờ BẬT + người dùng có nhà máy ⇒ tầng dữ liệu THẤY đúng mã của họ", async () => {
    process.env.TENANT_RLS_ENABLED = "true";
    mockFactory.mockResolvedValue([{ factoryCode: "F01" }, { factoryCode: "F02" }]);
    mockCorporate.mockResolvedValue([{ corporateCode: "C9" }]);
    const thay = await routerThu.createCaller(nguoiDung(7, "engineer")).phamViTangDuLieu();
    expect(thay).toEqual({ bypass: false, factoryCodes: ["F01", "F02"], corporateCodes: ["C9"] });
  });

  it("cờ BẬT + admin ⇒ tầng dữ liệu thấy bypass", async () => {
    process.env.TENANT_RLS_ENABLED = "true";
    const thay = await routerThu.createCaller(nguoiDung(1, "admin")).phamViTangDuLieu();
    expect(thay).toEqual({ bypass: true, factoryCodes: [], corporateCodes: [] });
    // admin KHÔNG được tra bảng gán — giữ nguyên đường tắt cũ
    expect(mockFactory).not.toHaveBeenCalled();
  });

  it("phạm vi KHÔNG rò sang lời gọi kế tiếp (pool dùng chung ⇒ đây là rủi ro thật)", async () => {
    process.env.TENANT_RLS_ENABLED = "true";
    mockFactory.mockResolvedValue([{ factoryCode: "F01" }]);
    await routerThu.createCaller(nguoiDung(7, "engineer")).phamViTangDuLieu();
    // ngoài mọi request: phải sạch
    expect(layPhamViTenantHienTai()).toBeUndefined();
  });

  it("hai người dùng gọi SONG SONG ⇒ mỗi người thấy đúng phạm vi của mình", async () => {
    process.env.TENANT_RLS_ENABLED = "true";
    mockFactory.mockImplementation(async (id: number) =>
      id === 7 ? [{ factoryCode: "F-BAY" }] : [{ factoryCode: "F-CHIN" }],
    );
    const [a, b] = await Promise.all([
      routerThu.createCaller(nguoiDung(7, "engineer")).phamViTangDuLieu(),
      routerThu.createCaller(nguoiDung(9, "engineer")).phamViTangDuLieu(),
    ]);
    expect(a?.factoryCodes).toEqual(["F-BAY"]);
    expect(b?.factoryCodes).toEqual(["F-CHIN"]);
  });
});
