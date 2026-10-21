/**
 * H2 (audit 2026-10-21) — quyền duyệt `flow.duyet`, phần THUẦN: ma trận vai × vai yêu cầu, tách người bật / người chạy.
 */
import { describe, expect, it } from "vitest";
import { THU_BAC_VAI_DUYET, kiemQuyenDuyet, vaiDuDeDuyet } from "./quyenDuyet";

describe("vaiDuDeDuyet — thứ bậc vai", () => {
  it("bước yêu cầu supervisor: chỉ supervisor và admin; operator/maintenance/quality_inspector/engineer KHÔNG", () => {
    expect(["operator", "maintenance", "quality_inspector", "engineer", "supervisor", "admin"].map((r) => vaiDuDeDuyet(r, "supervisor"))).toEqual([
      false, false, false, false, true, true,
    ]);
  });
  it("bước yêu cầu operator: mọi vai ghi được duyệt; viewer/user KHÔNG BAO GIỜ", () => {
    expect(["operator", "maintenance", "quality_inspector", "engineer", "supervisor", "admin"].every((r) => vaiDuDeDuyet(r, "operator"))).toBe(true);
    expect(vaiDuDeDuyet("viewer", "operator")).toBe(false);
    expect(vaiDuDeDuyet("user", "viewer")).toBe(false);
  });
  it("admin duyệt được mọi bước kể cả vai yêu cầu lạ; vai yêu cầu lạ ⇒ fail-closed: chỉ đúng vai đó", () => {
    expect(vaiDuDeDuyet("admin", "ke-toan-truong")).toBe(true);
    expect(vaiDuDeDuyet("supervisor", "ke-toan-truong")).toBe(false);
    expect(vaiDuDeDuyet("ke-toan-truong", "ke-toan-truong")).toBe(true);
    expect(vaiDuDeDuyet("", "")).toBe(false);
  });
  it("không phân biệt hoa thường / khoảng trắng; bảng thứ bậc đủ các vai của hệ thống", () => {
    expect(vaiDuDeDuyet(" Supervisor ", "SUPERVISOR")).toBe(true);
    expect(Object.keys(THU_BAC_VAI_DUYET).sort()).toEqual(["admin", "engineer", "maintenance", "operator", "quality_inspector", "supervisor", "user", "viewer"]);
  });
});

describe("kiemQuyenDuyet — tách người làm / người duyệt", () => {
  const sup = { id: 7, role: "supervisor" };
  const ok = (lienQuan: { nguoiBat: (number | null)[]; nguoiChay: (number | null)[] }, nd = sup) => kiemQuyenDuyet({ nguoiDuyet: nd, vaiTroDuyet: "supervisor", lienQuan });
  it("người khác hoàn toàn ⇒ được", () => {
    expect(ok({ nguoiBat: [1], nguoiChay: [2] })).toEqual({ ok: true });
  });
  it("chính người BẬT phiên bản (kể cả ở luồng cha) ⇒ TRUNG_NGUOI_BAT; admin cũng KHÔNG được miễn", () => {
    expect(ok({ nguoiBat: [1, 7], nguoiChay: [] })).toMatchObject({ ok: false, ma: "TRUNG_NGUOI_BAT" });
    expect(ok({ nguoiBat: [7], nguoiChay: [] }, { id: 7, role: "admin" })).toMatchObject({ ok: false, ma: "TRUNG_NGUOI_BAT" });
  });
  it("chính người KÍCH HOẠT lượt (kể cả lượt gốc của cây lượt con) ⇒ TRUNG_NGUOI_CHAY", () => {
    expect(ok({ nguoiBat: [1], nguoiChay: [null, 7] })).toMatchObject({ ok: false, ma: "TRUNG_NGUOI_CHAY" });
  });
  it("lịch/webhook/MCP (chuLuong NULL) và dữ liệu cũ (approvedBy NULL) ⇒ chỉ còn luật vai; vai thấp ⇒ VAI_THAP trước", () => {
    expect(ok({ nguoiBat: [null], nguoiChay: [null] })).toEqual({ ok: true });
    expect(ok({ nguoiBat: [1], nguoiChay: [] }, { id: 8, role: "operator" })).toMatchObject({ ok: false, ma: "VAI_THAP" });
  });
});
