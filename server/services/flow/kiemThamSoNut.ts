/**
 * Kiểm tham số TĨNH lúc LƯU phiên bản cho các node có danh mục / khoảng (lô Luồng-form): CÙNG luật cho form có kiểu lẫn ô JSON thô — máy chủ không tin giao diện.
 * Chỉ kiểm giá trị VIẾT THẲNG (không phải biểu thức `{{ … }}`); biểu thức để node kiểm lúc chạy bằng đúng các hàm này. Trả danh sách lỗi (rỗng = hợp lệ).
 * Node `kich-hoat.su-kien` có bộ kiểm riêng ở `kichHoat/suKien.ts` (`kiemThamSoSuKien`).
 */
import { safeInternalPath } from "../../../shared/internalPath";
import { DANH_MUC, chuanHoaThamSo } from "./soLieu/danhMuc";
import { NHOM_PHIEU } from "./nut/baoTri";
import { TIEU_DE_CAM } from "./nut/tichHop";

const laBieuThuc = (v: unknown): boolean => typeof v === "string" && v.includes("{{");
const LOAI_TB = ["REPORT", "INFO", "WARNING"];
const UU_TIEN_TB = ["LOW", "NORMAL", "HIGH"];
const LOAI_PHIEU = ["CORRECTIVE", "BREAKDOWN", "INSPECTION"];

export function kiemThamSoNutMoi(raw: unknown): string[] {
  const nodes = (raw as { nodes?: unknown })?.nodes;
  if (!Array.isArray(nodes)) return [];
  const loi: string[] = [];
  for (const n of nodes as { id?: unknown; type?: unknown; parameters?: Record<string, unknown> }[]) {
    const p = n?.parameters ?? {};
    const id = String(n?.id);
    if (n?.type === "du-lieu.so-lieu") {
      if (typeof p.truyVan !== "string" || laBieuThuc(p.truyVan) || !Object.prototype.hasOwnProperty.call(DANH_MUC, p.truyVan)) {
        loi.push(`node '${id}': truyVan phải là một truy vấn trong danh mục (${Object.keys(DANH_MUC).join(" | ")})`);
      }
      const lit: Record<string, unknown> = {};
      if (p.gio !== undefined && !laBieuThuc(p.gio)) lit.gio = p.gio;
      if (p.gioiHan !== undefined && !laBieuThuc(p.gioiHan)) lit.gioiHan = p.gioiHan;
      try {
        chuanHoaThamSo(lit);
      } catch (e) {
        loi.push(`node '${id}': ${(e as Error).message}`);
      }
    } else if (n?.type === "tich-hop.thong-bao") {
      if (Array.isArray(p.nguoiNhan)) {
        const ok = p.nguoiNhan.length >= 1 && p.nguoiNhan.length <= 20 && p.nguoiNhan.every((x) => (typeof x === "number" && Number.isSafeInteger(x) && x > 0) || (typeof x === "string" && /^\d{1,12}$/.test(x) && Number(x) > 0));
        if (!ok && p.nguoiNhan.length > 0) loi.push(`node '${id}': nguoiNhan phải là danh sách 1–20 id người dùng`);
        if (p.nguoiNhan.length > 20) loi.push(`node '${id}': nguoiNhan tối đa 20 người`);
      }
      if (p.duongDan !== undefined && p.duongDan !== "" && !laBieuThuc(p.duongDan) && safeInternalPath(p.duongDan) === null) loi.push(`node '${id}': duongDan phải là đường dẫn NỘI BỘ bắt đầu bằng một dấu '/' (không URL ngoài, không '//', không dấu gạch ngược)`);
      if (p.loai !== undefined && !laBieuThuc(p.loai) && !LOAI_TB.includes(String(p.loai))) loi.push(`node '${id}': loai phải là ${LOAI_TB.join(" | ")}`);
      if (p.uuTien !== undefined && !laBieuThuc(p.uuTien) && !UU_TIEN_TB.includes(String(p.uuTien))) loi.push(`node '${id}': uuTien phải là ${UU_TIEN_TB.join(" | ")}`);
    } else if (n?.type === "tich-hop.http-doc" || n?.type === "tich-hop.http-gui") {
      // bí mật gõ tay vào tiêu đề: chỉ qua credentialRef (kiem-dinh F1)
      if (p.tieuDe && typeof p.tieuDe === "object" && !Array.isArray(p.tieuDe)) {
        for (const k of Object.keys(p.tieuDe as Record<string, unknown>)) {
          if (TIEU_DE_CAM.has(k.toLowerCase()) || /key|token|secret|passw|auth|cookie/i.test(k)) loi.push(`node '${id}': tiêu đề '${k}' trông như bí mật — dùng bí mật (credentialRef) của luồng, không gõ vào tiêu đề`);
        }
      }
    } else if (n?.type === "bao-tri.tao-phieu") {
      if (p.nhom !== undefined && !laBieuThuc(p.nhom) && !Object.prototype.hasOwnProperty.call(NHOM_PHIEU, String(p.nhom))) loi.push(`node '${id}': nhom phải là ${Object.keys(NHOM_PHIEU).join(" | ")}`);
      if (p.loai !== undefined && !laBieuThuc(p.loai) && !LOAI_PHIEU.includes(String(p.loai))) loi.push(`node '${id}': loai phải là ${LOAI_PHIEU.join(" | ")}`);
      if (p.uuTien !== undefined && !laBieuThuc(p.uuTien)) {
        const u = Number(p.uuTien);
        if (!Number.isInteger(u) || u < 1 || u > 5) loi.push(`node '${id}': uuTien phải là số nguyên 1..5`);
      }
    }
  }
  return loi;
}
