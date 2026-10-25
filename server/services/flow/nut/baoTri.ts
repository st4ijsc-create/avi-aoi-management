/**
 * ★★★ Luồng AI — NODE `bao-tri.tao-phieu`: tạo MỘT phiếu bảo trì (`maintenance_work_orders`) cho một máy (lô Luồng-A, mẫu #5 "phiếu bảo trì → phân loại → tạo việc").
 * Hạng `ngoai-ghi`, atMostOnce. Ghi qua ĐÚNG MỘT điểm ghi `services/maintenance/ghiPhieuBaoTri.ts` (cũng là điểm ghi của `maintenance.createWorkOrder`).
 *
 * KIỂM LÚC CHẠY (fail-closed, mọi thứ tính từ CHỦ LƯỢT HIỆN TẠI, không tin quyền lúc tạo luồng):
 *   • chủ lượt hợp lệ (động cơ dựng `BoKiemPhamVi`; chủ khoá / chỉ-đọc / vắng ⇒ không có bộ kiểm ⇒ TỪ CHỐI);
 *   • máy tồn tại và nằm trong phạm vi chủ (`BoKiemPhamVi.may`); luồng gắn nhà máy F ⇒ máy phải thuộc F (nhà máy của máy tra CSDL);
 *   • chủ có quyền `machine_monitoring/canCreate` như router.
 * Nhóm KHÔNG có cột trong bảng ⇒ ghi vào TIÊU ĐỀ ("[Điện] …") và dòng đầu mô tả ("Nhóm: … · nguồn: Luồng AI <luồng>/<lượt>"). `assignedTo` để trống.
 * Tham số: `may` (id máy, biểu thức theo item) · `tieuDe` · `moTa` · `nhom` (dien | co-khi | plc-phan-mem | vat-tu-khac; lạ ⇒ vat-tu-khac) · `uuTien` (1..5, mặc định 3) · `loai`
 * (CORRECTIVE | BREAKDOWN | INSPECTION, mặc định CORRECTIVE) · `truongRa` (mặc định `phieu`). Ra: `{ id, soPhieu, may, nhom }`.
 * ★ Mọi item = một phiếu; trần số item mỗi lượt-node `TRAN_PHIEU_MOI_LUOT` (lỗi rõ ràng, không tạo gì khi vượt).
 */
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { checkPermission } from "../../../_core/accessControl";
import { getDb } from "../../../db/connection";
import { dangKyNut, nguCanhItem, type KetQuaChay } from "../dangKyNut";
import { chuanHoaIdMay } from "../idTaiNguyen";
import { nhaMayCuaMay } from "../kichHoat/suKien";
import { nhaMayCuaLuong } from "../phamViLuong";
import { ghiPhieuBaoTri } from "../../maintenance/ghiPhieuBaoTri";

export class LoiBaoTri extends Error {
  constructor(message: string, readonly ma: string) {
    super(message);
  }
}

export const TRAN_PHIEU_MOI_LUOT = 20;
export const NHOM_PHIEU: Readonly<Record<string, string>> = {
  dien: "Điện",
  "co-khi": "Cơ khí",
  "plc-phan-mem": "PLC/Phần mềm",
  "vat-tu-khac": "Vật tư/Khác",
};
const LOAI_CHO_PHEP = new Set(["CORRECTIVE", "BREAKDOWN", "INSPECTION"]);

const chuanNhom = (v: unknown): string => {
  const k = String(v ?? "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(NHOM_PHIEU, k) ? k : "vat-tu-khac";
};

dangKyNut({
  type: "bao-tri.tao-phieu",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "ngoai-ghi",
  lapLai: "atMostOnce",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const bo = ngu.kiemPhamVi;
    const pv = bo?.phamVi;
    if (!bo || !pv || typeof pv.userId !== "number" || typeof pv.userRole !== "string") {
      throw new LoiBaoTri("Không xác định được chủ luồng (bị khoá / mất quyền / chưa có chủ lượt) — từ chối tạo phiếu.", "CHU_LUOT_KHONG_XAC_DINH");
    }
    const nhaMayLuong = ngu.flowId === "chay-thu" ? undefined : await nhaMayCuaLuong(ngu.flowId);
    if (nhaMayLuong === undefined) throw new LoiBaoTri("Không xác định được nhà máy của luồng — từ chối tạo phiếu.", "LUONG_KHONG_XAC_DINH");
    const vao = ngu.inputs.main ?? [{ json: {} }];
    if (vao.length > TRAN_PHIEU_MOI_LUOT) throw new LoiBaoTri(`Một lượt-node chỉ được tạo tối đa ${TRAN_PHIEU_MOI_LUOT} phiếu (nhận ${vao.length} item) — không tạo gì.`, "QUA_TRAN_PHIEU");
    if (!(await checkPermission(pv.userId, pv.userRole, "machine_monitoring", "canCreate"))) {
      throw new LoiBaoTri("Chủ luồng không có quyền tạo phiếu bảo trì (machine_monitoring/canCreate).", "THIEU_QUYEN");
    }
    // Lượt 1 — kiểm TẤT CẢ item trước khi ghi bất kỳ phiếu nào (không ghi từng phần).
    const ke: { item: (typeof vao)[number]; may: number; nhom: string; tieuDe: string; moTa: string; uuTien: number; loai: "CORRECTIVE" | "BREAKDOWN" | "INSPECTION"; truongRa: string }[] = [];
    for (const item of vao) {
      const t = danhGiaThamSo(thamSo, nguCanhItem(ngu, item, vao)) as Record<string, unknown>;
      const may = chuanHoaIdMay(t.may);
      if (may === null) throw new LoiBaoTri("may phải là id máy hợp lệ", "THAM_SO_SAI");
      const tieuDe = String(t.tieuDe ?? "").trim();
      if (tieuDe.length < 3) throw new LoiBaoTri("tieuDe là bắt buộc (≥ 3 ký tự)", "THAM_SO_SAI");
      const uuTien = t.uuTien === undefined || t.uuTien === null || t.uuTien === "" ? 3 : Number(t.uuTien);
      if (!Number.isInteger(uuTien) || uuTien < 1 || uuTien > 5) throw new LoiBaoTri("uuTien phải là số nguyên 1..5", "THAM_SO_SAI");
      const loai = String(t.loai ?? "CORRECTIVE");
      if (!LOAI_CHO_PHEP.has(loai)) throw new LoiBaoTri("loai phải là CORRECTIVE | BREAKDOWN | INSPECTION", "THAM_SO_SAI");
      if (!(await bo.may(may))) throw new LoiBaoTri(`Máy ${may} không tồn tại hoặc ngoài phạm vi của chủ luồng.`, "MAY_NGOAI_PHAM_VI");
      if (nhaMayLuong !== null && (await nhaMayCuaMay(may)) !== nhaMayLuong) throw new LoiBaoTri(`Máy ${may} không thuộc nhà máy của luồng.`, "MAY_NGOAI_PHAM_VI");
      ke.push({ item, may, nhom: chuanNhom(t.nhom), tieuDe, moTa: String(t.moTa ?? "").slice(0, 3000), uuTien, loai: loai as never, truongRa: String(t.truongRa ?? "phieu") });
    }
    const db = await getDb();
    if (!db) throw new LoiBaoTri("CSDL không khả dụng — không tạo phiếu.", "KHONG_CO_DB");
    const ra = [];
    for (const k of ke) {
      const tenNhom = NHOM_PHIEU[k.nhom];
      const row = await ghiPhieuBaoTri(db, {
        machineId: k.may,
        title: `[${tenNhom}] ${k.tieuDe}`.slice(0, 256),
        description: `Nhóm: ${tenNhom} · nguồn: Luồng AI ${ngu.flowId}/${ngu.runId}${k.moTa ? `\n${k.moTa}` : ""}`.slice(0, 4000),
        type: k.loai,
        priority: k.uuTien,
        status: "OPEN",
        assignedTo: null,
      });
      ra.push({ json: { ...k.item.json, [k.truongRa]: { id: row.id, soPhieu: row.workOrderNumber, may: k.may, nhom: k.nhom } } });
    }
    return { main: ra };
  },
});
