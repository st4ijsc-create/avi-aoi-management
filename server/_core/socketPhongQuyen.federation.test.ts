/**
 * socketPhongQuyen.federation.test.ts — ★★★ PV-socket-1 fix round 1 (I1 · m2 · m3): cổng phòng federation đi qua BỘ ĐỌC THẬT của nó.
 *
 * `socketPhamViSite.test.ts` tiêm CẢ BA bộ đọc qua `__datCongFederationChoTest` ⇒ ánh xạ sang `moduleGate` / `accessControl` THẬT (đúng
 * module + hành động hỏi `checkPermission`, `isAdmin` ⇒ toàn quyền, MÃ TẬP ĐOÀN chứ không phải mã nhà máy) không được lưới nào đo. Tệp này
 * KHÔNG dùng seam: chỉ thay hai mô-đun nguồn (`./accessControl`, `./moduleGate`) bằng `vi.fn`, rồi gọi `phongFederationDuocVao` THẬT.
 * Không CSDL, không socket.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ac = vi.hoisted(() => ({
  checkPermission: vi.fn(async (..._a: unknown[]) => true),
  getUserAssignmentCodes: vi.fn(async (..._a: unknown[]) => ({ corporateCodes: [] as string[], factoryCodes: [] as string[], isAdmin: false })),
}));
const mg = vi.hoisted(() => ({ isModuleLicensed: vi.fn(async (..._a: unknown[]) => true) }));
vi.mock("./accessControl", () => ac);
vi.mock("./moduleGate", () => mg);

import {
  phongFederationDuocVao,
  duocVaoPhongFederation,
  phongSitesTapDoan,
  phongNhanSiteUpdate,
  __datCongFederationChoTest,
} from "./socketPhongQuyen";

const nguoi = (id: number, role: string) => ({ clientType: "browser", user: { id, role } });
const maGan = (corporateCodes: string[], factoryCodes: string[], isAdmin = false) => ({ corporateCodes, factoryCodes, isAdmin });

beforeEach(() => {
  __datCongFederationChoTest(null); // KHÔNG seam: bộ đọc mặc định
  ac.checkPermission.mockReset().mockResolvedValue(true);
  ac.getUserAssignmentCodes.mockReset().mockResolvedValue(maGan([], []));
  mg.isModuleLicensed.mockReset().mockResolvedValue(true);
});

describe("★★★ I1 — bộ đọc THẬT của cổng federation", () => {
  it("người tập đoàn ⇒ ĐÚNG sites:corp:{mỗi MÃ TẬP ĐOÀN} (không phải mã nhà máy); hỏi đúng MOD_FEDERATION + (id, vai, admin_system, canView)", async () => {
    ac.getUserAssignmentCodes.mockResolvedValue(maGan(["C-A", "VN.HCM"], ["F-X", "C-B"]));
    expect(await phongFederationDuocVao(nguoi(11, "engineer"))).toEqual(["sites:corp:C-A", "sites:corp:VN.HCM"]);
    expect(mg.isModuleLicensed).toHaveBeenCalledWith("MOD_FEDERATION");
    expect(ac.checkPermission).toHaveBeenCalledTimes(1);
    expect(ac.checkPermission).toHaveBeenCalledWith(11, "engineer", "admin_system", "canView");
    expect(ac.getUserAssignmentCodes).toHaveBeenCalledWith(11, "engineer");
  });

  it("toàn quyền (isAdmin) ⇒ CHỈ sites:all; đối chứng: người có admin_system nhưng KHÔNG toàn quyền ⇒ KHÔNG sites:all (0 mã ⇒ [])", async () => {
    ac.getUserAssignmentCodes.mockResolvedValueOnce(maGan([], [], true));
    expect(await phongFederationDuocVao(nguoi(1, "admin"))).toEqual(["sites:all"]);
    ac.getUserAssignmentCodes.mockResolvedValueOnce(maGan([], ["F-X"]));
    expect(await phongFederationDuocVao(nguoi(12, "engineer"))).toEqual([]);
    ac.getUserAssignmentCodes.mockResolvedValueOnce(maGan(["C-A"], []));
    const p = await phongFederationDuocVao(nguoi(13, "engineer"));
    expect(p).toEqual(["sites:corp:C-A"]);
    expect(p).not.toContain("sites:all");
  });

  it("checkPermission false (kể cả admin có hàng canView=false) ⇒ []; đối chứng cùng người, quyền true ⇒ có phòng", async () => {
    ac.getUserAssignmentCodes.mockResolvedValue(maGan([], [], true));
    ac.checkPermission.mockResolvedValueOnce(false);
    expect(await phongFederationDuocVao(nguoi(1, "admin"))).toEqual([]);
    expect(ac.getUserAssignmentCodes).not.toHaveBeenCalled();
    expect(await phongFederationDuocVao(nguoi(1, "admin"))).toEqual(["sites:all"]);
  });

  it("lỗi ở BẤT KỲ bộ đọc nào ⇒ [] (fail-closed); không phải socket người dùng ⇒ [] và không hỏi gì", async () => {
    ac.getUserAssignmentCodes.mockResolvedValue(maGan(["C-A"], []));
    mg.isModuleLicensed.mockRejectedValueOnce(new Error("x"));
    expect(await phongFederationDuocVao(nguoi(11, "engineer"))).toEqual([]);
    ac.checkPermission.mockRejectedValueOnce(new Error("x"));
    expect(await phongFederationDuocVao(nguoi(11, "engineer"))).toEqual([]);
    ac.getUserAssignmentCodes.mockRejectedValueOnce(new Error("x"));
    expect(await phongFederationDuocVao(nguoi(11, "engineer"))).toEqual([]);
    expect(await phongFederationDuocVao(nguoi(11, "engineer"))).toEqual(["sites:corp:C-A"]); // đối chứng
    ac.checkPermission.mockClear();
    expect(await phongFederationDuocVao({ clientType: "machine", user: null })).toEqual([]);
    expect(ac.checkPermission).not.toHaveBeenCalled();
  });

  it("duocVaoPhongFederation: chỉ phòng thuộc danh sách; phòng khác / không phải chuỗi ⇒ false", async () => {
    ac.getUserAssignmentCodes.mockResolvedValue(maGan(["C-A"], ["C-B"]));
    expect(await duocVaoPhongFederation(nguoi(11, "engineer"), "sites:corp:C-A")).toBe(true);
    expect(await duocVaoPhongFederation(nguoi(11, "engineer"), "sites:corp:C-B")).toBe(false);
    expect(await duocVaoPhongFederation(nguoi(11, "engineer"), "sites:all")).toBe(false);
    expect(await duocVaoPhongFederation(nguoi(11, "engineer"), 1 as never)).toBe(false);
  });
});

describe("★★ m2 — giấy phép MOD_FEDERATION (cùng quyết định `moduleProcedure` của router)", () => {
  it("không có giấy phép ⇒ [] kể cả admin, và không hỏi quyền; đối chứng: có giấy phép ⇒ sites:all", async () => {
    ac.getUserAssignmentCodes.mockResolvedValue(maGan([], [], true));
    mg.isModuleLicensed.mockResolvedValueOnce(false);
    expect(await phongFederationDuocVao(nguoi(1, "admin"))).toEqual([]);
    expect(ac.checkPermission).not.toHaveBeenCalled();
    expect(await phongFederationDuocVao(nguoi(1, "admin"))).toEqual(["sites:all"]);
  });
});

describe("★★ m3 — mã tập đoàn là chữ tự do: khoá phòng chỉ đòi chuỗi khác rỗng, ≤ 100, không ký tự điều khiển", () => {
  it("hợp lệ: VN.HCM · có khoảng trắng · tiếng Việt · đúng 100 ký tự", () => {
    for (const m of ["VN.HCM", "ACME CORP", "Tập đoàn Miền Nam", "x".repeat(100)]) expect(phongSitesTapDoan(m), m).toBe(`sites:corp:${m}`);
  });
  it("từ chối: rỗng · 101 ký tự · ký tự điều khiển (C0, DEL, C1) · không phải chuỗi", () => {
    for (const m of ["", "x".repeat(101), "a\nb", "a\u0000", "\u0007x", "a\u007f", "a\u0085"]) expect(phongSitesTapDoan(m), JSON.stringify(m)).toBeNull();
    for (const m of [null, undefined, 1, ["C-A"], { a: 1 }]) expect(phongSitesTapDoan(m)).toBeNull();
  });
  it("cổng + phát dùng cùng khoá: người VN.HCM vào sites:corp:VN.HCM, site VN.HCM (không cục bộ) phát tới đúng phòng ấy; mã có ký tự điều khiển bị bỏ ở CẢ hai phía", async () => {
    ac.getUserAssignmentCodes.mockResolvedValue(maGan(["VN.HCM", "bad\u0001"], []));
    expect(await phongFederationDuocVao(nguoi(11, "engineer"))).toEqual(["sites:corp:VN.HCM"]);
    expect(phongNhanSiteUpdate({ corporateCode: "VN.HCM", isLocal: false })).toEqual(["sites:all", "sites:corp:VN.HCM"]);
    expect(phongNhanSiteUpdate({ corporateCode: "bad\u0001", isLocal: false })).toEqual(["sites:all"]);
    expect(phongNhanSiteUpdate({ corporateCode: "VN.HCM", isLocal: true })).toEqual(["sites:all"]);
    expect(phongNhanSiteUpdate({ corporateCode: null, isLocal: false })).toEqual(["sites:all"]);
    expect(phongNhanSiteUpdate({ corporateCode: "VN.HCM" })).toEqual(["sites:all"]); // isLocal không rõ ⇒ coi như cục bộ
  });
});
