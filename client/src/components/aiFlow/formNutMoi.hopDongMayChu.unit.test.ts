/**
 * Hợp đồng form ⇄ máy chủ (census, lô Luồng-form): danh mục trong form PHẢI khớp danh mục máy chủ (truy vấn số liệu, sự kiện, nhóm phiếu), và MỌI giá trị form có thể sinh
 * ra phải qua bộ kiểm tham số tĩnh của máy chủ lúc lưu — form không bao giờ sinh thứ máy chủ từ chối. Đồng thời 4 node mới phải có form có kiểu (dò `case "<type>"`
 * trong NodeConfigPanel); node khác có danh mục/khoảng mà dùng JSON thô phải khai lý do (danh sách chỉ được GIẢM).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { NHOM_PHIEU_FORM, SU_KIEN_NOI_BO, TRAN_NGUOI_NHAN_FORM, TRUY_VAN_SO_LIEU } from "./FormNutMoi";
import { TOAN_TU_CHON_FORM, TRAN_NHANH_CHON_FORM } from "./FormChon";
import { CONG_CHON, TOAN_TU_CHON, TRAN_NHANH_CHON } from "../../../../server/services/flow/nut/chon";
import { CHO_MAC_DINH_GIAY, CHO_TOI_DA_GIAY, TRAN_THONG_DIEP_DUNG_LOI } from "../../../../server/services/flow/nut/cho";
import { HUONG_SAP_XEP, KIEU_SAP_XEP, TOAN_TU_LOC, TRAN_DIEU_KIEN_LOC } from "../../../../server/services/flow/nut/loc";
import { CHO_MAC_DINH_GIAY_FORM, CHO_TOI_DA_GIAY_FORM, HUONG_SAP_XEP_FORM, KIEU_SAP_XEP_FORM, TOAN_TU_LOC_FORM, TRAN_DIEU_KIEN_LOC_FORM, TRAN_THONG_DIEP_FORM } from "./FormLoc";
import { DANH_MUC } from "../../../../server/services/flow/soLieu/danhMuc";
import { SU_KIEN_CHO_PHEP, kiemThamSoSuKien } from "../../../../server/services/flow/kichHoat/suKien";
import { NHOM_PHIEU } from "../../../../server/services/flow/nut/baoTri";
import { kiemThamSoNutMoi } from "../../../../server/services/flow/kiemThamSoNut";
import { danhSachNut } from "../../../../server/services/flow/dangKyNut";
import "../../../../server/services/flow/nut"; // đăng ký đủ loại node

const AQUI = dirname(fileURLToPath(import.meta.url));
const dinh = (type: string, parameters: Record<string, unknown>) => ({ nodes: [{ id: "n", type, parameters }] });

describe("danh mục form ⇄ máy chủ", () => {
  it("truy vấn số liệu · sự kiện · nhóm phiếu khớp ĐÚNG tập của máy chủ (không thừa, không thiếu)", () => {
    expect(TRUY_VAN_SO_LIEU.map((x) => x.v).sort()).toEqual(Object.keys(DANH_MUC).sort());
    expect(SU_KIEN_NOI_BO.map((x) => x.v).sort()).toEqual([...SU_KIEN_CHO_PHEP].sort());
    expect(NHOM_PHIEU_FORM.map((x) => x.v).sort()).toEqual(Object.keys(NHOM_PHIEU).sort());
    expect(TRAN_NGUOI_NHAN_FORM).toBe(20);
  });

  it("★ mọi giá trị form có thể sinh đều qua bộ kiểm máy chủ lúc lưu", () => {
    for (const x of TRUY_VAN_SO_LIEU) for (const [gio, gioiHan] of [[1, 1], [168, 20], [undefined, undefined]]) expect(kiemThamSoNutMoi(dinh("du-lieu.so-lieu", { truyVan: x.v, gio, gioiHan })), x.v).toEqual([]);
    for (const x of SU_KIEN_NOI_BO) for (const bat of [true, false]) expect(kiemThamSoSuKien(dinh("kich-hoat.su-kien", { suKien: x.v, bat, cuaSoPhut: 1440, tranMoiGio: 30 })), x.v).toEqual([]);
    for (const loai of ["REPORT", "INFO", "WARNING"]) for (const uuTien of ["LOW", "NORMAL", "HIGH"]) expect(kiemThamSoNutMoi(dinh("tich-hop.thong-bao", { nguoiNhan: [1, 2], tieuDe: "x", loai, uuTien }))).toEqual([]);
    expect(kiemThamSoNutMoi(dinh("tich-hop.thong-bao", { nguoiNhan: Array.from({ length: TRAN_NGUOI_NHAN_FORM }, (_, i) => i + 1), tieuDe: "x" }))).toEqual([]);
    for (const x of NHOM_PHIEU_FORM) for (const uuTien of [1, 2, 3, 4, 5]) for (const loai of ["CORRECTIVE", "BREAKDOWN", "INSPECTION"]) expect(kiemThamSoNutMoi(dinh("bao-tri.tao-phieu", { may: "{{ $json.idMay }}", tieuDe: "abc", nhom: x.v, uuTien, loai }))).toEqual([]);
    // biên: ngoài khoảng mà ô JSON thô gõ được vẫn bị máy chủ chặn (form chỉ là thêm một lớp)
    expect(kiemThamSoNutMoi(dinh("du-lieu.so-lieu", { truyVan: "oee.trung-binh", gio: 169 })).length).toBe(1);
    expect(kiemThamSoSuKien(dinh("kich-hoat.su-kien", { suKien: "ng.alert", cuaSoPhut: 1441 })).length).toBe(1);
  });
});

describe("census: node có tham số theo danh mục / khoảng phải có form có kiểu hoặc khai lý do dùng JSON thô", () => {
  /** Node có danh mục/khoảng nhưng dùng JSON thô (hoặc form riêng ở case khác) — mỗi mục có lý do; chỉ được GIẢM. */
  const JSON_THO_CO_LY_DO: Record<string, string> = {
    "ai.tra-tri-thuc": "kho (all|vendor|studio|api) và k (1..8) — xếp vào lô form tiếp theo; máy chủ kiểm lúc chạy.",
    "ai.agent": "luồng con khai danh sách đối tượng lồng nhau — cần trình soạn riêng; máy chủ kiểm lúc lưu.",
    "ai.sinh-ma": "ngôn ngữ / vòng sửa — chưa có form; máy chủ kiểm lúc chạy.",
    "ot.doc-tag": "node OT có form-ot riêng hoặc JSON thô qua cổng aiControlGate.",
    "ot.de-xuat-lenh": "node OT: form-ot riêng, qua cổng aiControlGate.",
    "ot.de-xuat-luong": "node OT: JSON thô qua cổng aiControlGate.",
    "luong.goi-con": "chọn luồng con cần bộ chọn riêng — lô sau; máy chủ kiểm lúc lưu.",
  };
  const NODE_MOI_CO_FORM = ["du-lieu.so-lieu", "tich-hop.thong-bao", "kich-hoat.su-kien", "bao-tri.tao-phieu", "logic.chon", "logic.gom", "logic.cho", "logic.dung-loi", "logic.loc", "logic.sap-xep"];

  it("4 node mới có `case` trong NodeConfigPanel; danh sách JSON-thô-có-lý-do không chứa node mới và không có mục lỗi thời", () => {
    const nguon = readFileSync(join(AQUI, "NodeConfigPanel.tsx"), "utf8");
    for (const t of NODE_MOI_CO_FORM) expect(nguon.includes(`case "${t}":`), `${t} thiếu form có kiểu`).toBe(true);
    const dangKy = new Set(danhSachNut().map((n) => n.type));
    for (const [t, ly] of Object.entries(JSON_THO_CO_LY_DO)) {
      expect(NODE_MOI_CO_FORM.includes(t), `${t} đã có form — xoá khỏi danh sách`).toBe(false);
      expect(dangKy.has(t), `${t} không còn đăng ký — xoá khỏi danh sách`).toBe(true);
      expect(ly.length, t).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("logic.chon: form ⇄ máy chủ", () => {
  it("toán tử · trần điều kiện · cổng ra khớp tập của máy chủ; mọi điều kiện form sinh ra qua bộ kiểm lúc lưu", () => {
    expect([...TOAN_TU_CHON_FORM].sort()).toEqual([...TOAN_TU_CHON].sort());
    expect(TRAN_NHANH_CHON_FORM).toBe(TRAN_NHANH_CHON);
    expect(CONG_CHON).toEqual(["nhanh-1", "nhanh-2", "nhanh-3", "nhanh-4", "nhanh-5", "khac"]);
    const dinh = (nhanh: unknown[]) => ({ nodes: [{ id: "c", type: "logic.chon", parameters: { giaTri: "{{ $json.x }}", nhanh } }] });
    for (const so of TOAN_TU_CHON_FORM) {
      const dich = so === "in" ? ["a", 1, "2", null] : so === "eq" ? "dien" : 3;
      expect(kiemThamSoNutMoi(dinh([{ so, dich }])), so).toEqual([]);
    }
    // ngoài khoảng gõ tay bằng JSON vẫn bị máy chủ chặn
    expect(kiemThamSoNutMoi(dinh(Array.from({ length: 6 }, () => ({ so: "eq", dich: 1 })))).length).toBe(1);
    expect(kiemThamSoNutMoi(dinh([{ so: "regex", dich: ".*" }])).length).toBe(1);
    expect(kiemThamSoNutMoi(dinh([{ so: "gt", dich: "5" }])).length).toBe(1);
    expect(kiemThamSoNutMoi(dinh([{ so: "in", dich: "a" }])).length).toBe(1);
  });
});

describe("logic.cho / dung-loi / loc / sap-xep: form ⇄ máy chủ", () => {
  it("hằng số của form KHỚP máy chủ (khoảng giây, trần thông điệp, toán tử, trần điều kiện, hướng, kiểu)", () => {
    expect(CHO_TOI_DA_GIAY_FORM).toBe(CHO_TOI_DA_GIAY);
    expect(CHO_MAC_DINH_GIAY_FORM).toBe(CHO_MAC_DINH_GIAY);
    expect(TRAN_THONG_DIEP_FORM).toBe(TRAN_THONG_DIEP_DUNG_LOI);
    expect([...TOAN_TU_LOC_FORM].sort()).toEqual([...TOAN_TU_LOC].sort());
    expect(TRAN_DIEU_KIEN_LOC_FORM).toBe(TRAN_DIEU_KIEN_LOC);
    expect([...HUONG_SAP_XEP_FORM]).toEqual([...HUONG_SAP_XEP]);
    expect([...KIEU_SAP_XEP_FORM]).toEqual([...KIEU_SAP_XEP]);
  });
  it("★ mọi giá trị form có thể sinh đều qua bộ kiểm lúc lưu; ngoài khoảng gõ tay bằng JSON vẫn bị chặn", () => {
    const d = (type: string, parameters: Record<string, unknown>) => ({ nodes: [{ id: "n", type, parameters }] });
    for (const giay of [0, 1, CHO_MAC_DINH_GIAY_FORM, CHO_TOI_DA_GIAY_FORM]) expect(kiemThamSoNutMoi(d("logic.cho", { giay })), String(giay)).toEqual([]);
    expect(kiemThamSoNutMoi(d("logic.cho", { giay: CHO_TOI_DA_GIAY_FORM + 1 })).length).toBe(1);
    expect(kiemThamSoNutMoi(d("logic.dung-loi", { thongDiep: "x".repeat(TRAN_THONG_DIEP_FORM) }))).toEqual([]);
    for (const so of TOAN_TU_LOC_FORM) {
      const dich = so === "in" ? ["a", 1, "2", null] : so === "eq" ? "dien" : 3;
      expect(kiemThamSoNutMoi(d("logic.loc", { dieuKien: [{ giaTri: "{{ $json.x }}", so, dich }] })), so).toEqual([]);
    }
    for (const huong of HUONG_SAP_XEP_FORM) for (const kieu of KIEU_SAP_XEP_FORM) expect(kiemThamSoNutMoi(d("logic.sap-xep", { giaTri: "{{ $json.x }}", huong, kieu }))).toEqual([]);
    expect(kiemThamSoNutMoi(d("logic.loc", { dieuKien: [{ giaTri: "{{ $json.x }}", so: "regex", dich: ".*" }] })).length).toBe(1);
  });
});
