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
  const NODE_MOI_CO_FORM = ["du-lieu.so-lieu", "tich-hop.thong-bao", "kich-hoat.su-kien", "bao-tri.tao-phieu"];

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
