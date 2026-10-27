/**
 * Kiểm tham số TĨNH lúc LƯU phiên bản cho các node có danh mục / khoảng (lô Luồng-form): CÙNG luật cho form có kiểu lẫn ô JSON thô — máy chủ không tin giao diện.
 * Chỉ kiểm giá trị VIẾT THẲNG (không phải biểu thức `{{ … }}`); biểu thức để node kiểm lúc chạy bằng đúng các hàm này. Trả danh sách lỗi (rỗng = hợp lệ).
 * Node `kich-hoat.su-kien` có bộ kiểm riêng ở `kichHoat/suKien.ts` (`kiemThamSoSuKien`).
 */
import { safeInternalPath } from "../../../shared/internalPath";
import { DANH_MUC, chuanHoaThamSo } from "./soLieu/danhMuc";
import { NHOM_PHIEU } from "./nut/baoTri";
import { TIEU_DE_CAM } from "./nut/tichHop";
import { laTenBiMat } from "./xuatNhap";
import { TOAN_TU_CHON, TRAN_NHANH_CHON } from "./nut/chon";
import { CHO_TOI_DA_GIAY, TRAN_THONG_DIEP_DUNG_LOI } from "./nut/cho";
import { kiemDinhNghiaBieuMau } from "./nut/bieuMau";
import { CHON_MODEL_RE } from "../ai/chonModel/kieu";
import { RE_TEN_MAY_CHU_MCP, RE_TEN_TOOL_MCP, TRAN_DOI_SO_MCP } from "./nut/mcpKhach";
import { laHostAiNgoai } from "../ai/ngoai/hostAiNgoai";
import { LOAI_KIEM_DINH_NGOAI, laChonModelNgoai } from "./nut/kiemDinhNgoai";
import { HUONG_SAP_XEP, KIEU_SAP_XEP, TOAN_TU_LOC, TRAN_DIEU_KIEN_LOC } from "./nut/loc";

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
    // Đợt 10.2 — `chonModel` của node AI là chuỗi CỐ ĐỊNH khớp hợp đồng (auto | vai-tro:<id> | ho-so:<id> | ngoai:<ncc>:<model>), KHÔNG biểu thức (dữ liệu item không được chọn model). Lỗi LÚC LƯU,
    // chỉ nêu node sai — node khác kiểm độc lập. (Còn phải có trong danh mục lúc GỌI: máy chủ giải ở `giaiChonModel`.)
    // ★ 10.4 — `ai.kiem-dinh-ngoai` có nhánh RIÊNG (chỉ model ngoài cố định, rỗng = việc phải điền sau nhập) ⇒ không kiểm hai lần.
    if (typeof n?.type === "string" && n.type.startsWith("ai.") && n.type !== LOAI_KIEM_DINH_NGOAI && p.chonModel !== undefined && p.chonModel !== null) {
      if (typeof p.chonModel !== "string" || laBieuThuc(p.chonModel) || !CHON_MODEL_RE.test(p.chonModel)) {
        loi.push(`node '${id}': chonModel phải là chuỗi cố định (auto | vai-tro:<id> | ho-so:<id> | ngoai:<nhà-cung-cấp>:<model>), không phải biểu thức`);
      }
    }
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
    } else if (n?.type === LOAI_KIEM_DINH_NGOAI) {
      // ★ 10.4 — model ngoài CỐ ĐỊNH (không auto / model cục bộ / biểu thức). VẮNG / rỗng chỉ chấp nhận như "việc phải điền" (node mới thả lên
      //   canvas; sau NHẬP — xuatNhap bỏ chonModel ngoai:* + việc "chon-model"); node chưa chọn model không chạy được (lỗi lúc chạy).
      if (p.chonModel !== undefined && p.chonModel !== "" && !laChonModelNgoai(p.chonModel)) loi.push(`node '${id}': chonModel phải là model ngoài cố định dạng 'ngoai:<nhà cung cấp>:<model>'`);
      if (p.truongRa !== undefined && !laBieuThuc(p.truongRa) && (typeof p.truongRa !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(p.truongRa))) loi.push(`node '${id}': truongRa phải là tên trường (chữ, số, _; ≤ 48 ký tự)`);
    } else if (n?.type === "tich-hop.http-doc" || n?.type === "tich-hop.http-gui") {
      // Đợt 10.3 B4 — URL VIẾT THẲNG tới máy chủ AI ngoài ⇒ từ chối lúc lưu (biểu thức: node kiểm lúc chạy, cùng hàm + tập động).
      if (typeof p.url === "string" && !laBieuThuc(p.url)) {
        try {
          if (laHostAiNgoai(new URL(p.url).hostname)) loi.push(`node '${id}': DICH_LA_AI_NGOAI — url trỏ tới máy chủ AI ngoài; dùng node AI với model 'ngoai:…' (đi qua cổng AI ngoài)`);
        } catch {
          /* URL hỏng: node kiểm lúc chạy */
        }
      }
      // bí mật gõ tay vào tiêu đề: chỉ qua credentialRef (kiem-dinh F1)
      if (p.tieuDe && typeof p.tieuDe === "object" && !Array.isArray(p.tieuDe)) {
        for (const k of Object.keys(p.tieuDe as Record<string, unknown>)) {
          if (TIEU_DE_CAM.has(k.toLowerCase()) || laTenBiMat(k)) loi.push(`node '${id}': tiêu đề '${k}' trông như bí mật — dùng bí mật (credentialRef) của luồng, không gõ vào tiêu đề`);
        }
      }
    } else if (n?.type === "logic.chon") {
      if (p.nhanh !== undefined && !Array.isArray(p.nhanh)) loi.push(`node '${id}': nhanh phải là danh sách điều kiện`);
      else {
        const ds = (p.nhanh ?? []) as { so?: unknown; dich?: unknown }[];
        if (ds.length > TRAN_NHANH_CHON) loi.push(`node '${id}': tối đa ${TRAN_NHANH_CHON} điều kiện (có ${ds.length})`);
        ds.forEach((d, i) => {
          if (!d || typeof d !== "object" || !(TOAN_TU_CHON as readonly string[]).includes(String(d.so))) {
            loi.push(`node '${id}': điều kiện ${i + 1}: so phải là ${TOAN_TU_CHON.join(" | ")}`);
            return;
          }
          if (d.so === "in" && !laBieuThuc(d.dich) && !(Array.isArray(d.dich) && d.dich.length >= 1 && d.dich.length <= 50)) loi.push(`node '${id}': điều kiện ${i + 1}: 'in' cần danh sách 1–50 giá trị`);
          if (d.so !== "in" && d.so !== "eq" && !laBieuThuc(d.dich) && !(typeof d.dich === "number" && Number.isFinite(d.dich))) loi.push(`node '${id}': điều kiện ${i + 1}: '${String(d.so)}' cần một SỐ`);
        });
      }
    } else if (n?.type === "tich-hop.mcp-goi") {
      if (typeof p.server !== "string" || !RE_TEN_MAY_CHU_MCP.test(p.server)) loi.push(`node '${id}': server phải là tên máy chủ MCP cố định (a-z, 0-9, -, _; không biểu thức)`);
      if (typeof p.tool !== "string" || !RE_TEN_TOOL_MCP.test(p.tool)) loi.push(`node '${id}': tool phải là tên tool cố định (không biểu thức)`);
      if (p.thamSo !== undefined && (!p.thamSo || typeof p.thamSo !== "object" || Array.isArray(p.thamSo))) loi.push(`node '${id}': thamSo phải là đối tượng`);
      else if (p.thamSo !== undefined && JSON.stringify(p.thamSo).length > TRAN_DOI_SO_MCP) loi.push(`node '${id}': thamSo quá ${TRAN_DOI_SO_MCP} byte`);
    } else if (n?.type === "nguoi.bieu-mau") {
      if (!laBieuThuc(p.truong)) for (const l of kiemDinhNghiaBieuMau(p.truong)) loi.push(`node '${id}': ${l}`);
    } else if (n?.type === "logic.cho") {
      if (p.giay !== undefined && !laBieuThuc(p.giay) && !(typeof p.giay === "number" && Number.isFinite(p.giay) && p.giay >= 0 && p.giay <= CHO_TOI_DA_GIAY)) loi.push(`node '${id}': giay phải là số 0 … ${CHO_TOI_DA_GIAY}`);
    } else if (n?.type === "logic.dung-loi") {
      if (p.thongDiep !== undefined && typeof p.thongDiep !== "string") loi.push(`node '${id}': thongDiep phải là chuỗi`);
      else if (typeof p.thongDiep === "string" && !laBieuThuc(p.thongDiep) && p.thongDiep.length > TRAN_THONG_DIEP_DUNG_LOI) loi.push(`node '${id}': thongDiep tối đa ${TRAN_THONG_DIEP_DUNG_LOI} ký tự`);
    } else if (n?.type === "logic.loc") {
      if (!Array.isArray(p.dieuKien) || p.dieuKien.length < 1) loi.push(`node '${id}': dieuKien cần ít nhất 1 điều kiện`);
      else {
        const ds = p.dieuKien as { giaTri?: unknown; so?: unknown; dich?: unknown }[];
        if (ds.length > TRAN_DIEU_KIEN_LOC) loi.push(`node '${id}': tối đa ${TRAN_DIEU_KIEN_LOC} điều kiện (có ${ds.length})`);
        ds.forEach((d, i) => {
          if (!d || typeof d !== "object" || !(TOAN_TU_LOC as readonly string[]).includes(String(d.so))) {
            loi.push(`node '${id}': điều kiện ${i + 1}: so phải là ${TOAN_TU_LOC.join(" | ")}`);
            return;
          }
          if (typeof d.giaTri !== "string" || !d.giaTri.trim()) loi.push(`node '${id}': điều kiện ${i + 1}: giaTri (biểu thức) không được rỗng`);
          if (d.so === "in" && !laBieuThuc(d.dich) && !(Array.isArray(d.dich) && d.dich.length >= 1 && d.dich.length <= 50)) loi.push(`node '${id}': điều kiện ${i + 1}: 'in' cần danh sách 1–50 giá trị`);
          if (d.so !== "in" && d.so !== "eq" && !laBieuThuc(d.dich) && !(typeof d.dich === "number" && Number.isFinite(d.dich))) loi.push(`node '${id}': điều kiện ${i + 1}: '${String(d.so)}' cần một SỐ`);
        });
      }
    } else if (n?.type === "logic.sap-xep") {
      if (typeof p.giaTri !== "string" || !p.giaTri.trim()) loi.push(`node '${id}': giaTri (biểu thức khoá) không được rỗng`);
      if (p.huong !== undefined && !(HUONG_SAP_XEP as readonly string[]).includes(String(p.huong))) loi.push(`node '${id}': huong phải là ${HUONG_SAP_XEP.join(" | ")}`);
      if (p.kieu !== undefined && !(KIEU_SAP_XEP as readonly string[]).includes(String(p.kieu))) loi.push(`node '${id}': kieu phải là ${KIEU_SAP_XEP.join(" | ")}`);
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
