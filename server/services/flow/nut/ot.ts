/**
 * ★★★ Luồng AI Đợt 8.5 — NODE OT (CHẾ ĐỘ MÔ PHỎNG). Spec §4.5 nhóm OT, §4.6 hạng `ot`; quyết định D4: chỉ ĐỌC + ĐỀ XUẤT.
 *
 *   • `ot.doc-tag`      (hạng `doc`) — đọc giá trị tag/telemetry mới nhất qua `server/db/otTelemetry.ts#getLatestTelemetry`
 *                       (CHỈ ĐỌC). Nguồn tiêm được cho lưới (`__datNguonDocTagChoTest`).
 *   • `ot.de-xuat-lenh` (hạng `ot`, atMostOnce) — đề xuất MỘT lệnh cho MỘT máy. Đi `congOtLuong.kiemVaDeXuat` (bọc
 *                       `aiControlGate`): mức 4–5 ⇒ LỖI node, không đề xuất; mức ≤ 3 ⇒ chờ người duyệt (mô phỏng).
 *   • `ot.de-xuat-luong` (hạng `ot`, atMostOnce) — đề xuất chạy MỘT FOE workflow đã duyệt (id + phiên bản), cùng hàm bao.
 *
 * ⚠ Không node nào ở đây gọi dispatcher / động cơ FOE / driver — census `ot/otLuongCensus.test.ts`. Đồng ý một đề xuất chỉ
 * đẩy item sang cổng `dong-y` kèm `thucThi.daGui = false` ("đã duyệt (mô phỏng) — không gửi").
 * Item ra: `{ deXuatId, muc, ketQua: "da-de-xuat", nguon: "luong-ai", moPhong: true, deXuat, duyet?, thucThi? }`.
 */
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem, type NguCanhChay } from "../dangKyNut";
import { LoiCongOt, kiemVaDeXuat, type KetQuaKiemOt } from "../ot/congOtLuong";
import { LoiNgoaiPhamVi, chuanHoaIdMay } from "../idTaiNguyen";

/**
 * Máy phải TỒN TẠI và thuộc phạm vi CHỦ LƯỢT / người chạy thử (`ngu.kiemPhamVi`, dựng lúc chạy từ người dùng hiện tại). KHÔNG có bộ kiểm
 * (lượt không chủ / chủ bị khoá, xoá, mất quyền) ⇒ TỪ CHỐI — đóng theo mặc định. Ngoài phạm vi và không tồn tại: cùng MỘT lỗi.
 */
async function kiemMayTrongPhamVi(ngu: NguCanhChay, may: number): Promise<void> {
  if (!ngu.kiemPhamVi) throw new LoiCongOt(0, "Không xác định được người chạy luồng (khoá / mất quyền / chưa có chủ lượt) — từ chối tham chiếu máy.", "CHU_LUOT_KHONG_XAC_DINH");
  if (!(await ngu.kiemPhamVi.may(may))) throw new LoiNgoaiPhamVi();
}

/** Một dòng telemetry đọc được (hình dạng `TelemetryLatestRow` rút gọn). */
export interface DongTag {
  tagKey: string;
  valueNumeric: number | null;
  valueText: string | null;
  quality: string;
  timestamp: string;
  unit: string | null;
}
export type NguonDocTag = (y: { machineId: number; tagKey?: string; limit?: number }) => Promise<DongTag[]>;

const nguonMacDinh: NguonDocTag = async (y) => (await import("../../../db/otTelemetry")).getLatestTelemetry(y);
let nguonDocTag: NguonDocTag = nguonMacDinh;

/** Chỉ lưới: thay nguồn đọc tag. `null` ⇒ về nguồn thật (CSDL, chỉ đọc). */
export function __datNguonDocTagChoTest(f: NguonDocTag | null): void {
  nguonDocTag = f ?? nguonMacDinh;
}

/** Đọc giá trị tag: `may` (số), `tag` (tuỳ chọn — vắng ⇒ các tag mới nhất), `gioiHan` (≤ 100), `truongRa` (mặc định `tag`). */
dangKyNut({
  type: "ot.doc-tag",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "doc",
  lapLai: "idempotent",
  async chay(thamSo, ngu) {
    const vao = ngu.inputs.main ?? [];
    const ra = [];
    // Lượt 1: đánh giá tham số + chuẩn hoá + KIỂM PHẠM VI cho MỌI item — chưa đọc gì. Lượt 2: đọc đúng các giá trị đã kiểm.
    const dsItem = [];
    for (const item of vao) {
      const t = danhGiaThamSo(thamSo, nguCanhItem(ngu, item, vao)) as Record<string, unknown>;
      const may = chuanHoaIdMay(t.may);
      if (may === null) throw new LoiCongOt(0, `ot.doc-tag: 'may' phải là số nguyên dương (nhận ${JSON.stringify(t.may)?.slice(0, 40)})`);
      await kiemMayTrongPhamVi(ngu, may);
      dsItem.push({ item, t, may });
    }
    for (const { item, t, may } of dsItem) {
      const tag = typeof t.tag === "string" && t.tag !== "" ? t.tag : undefined;
      const gioiHan = Math.min(Math.max(Number(t.gioiHan ?? (tag ? 1 : 20)) || 1, 1), 100);
      const dong = await nguonDocTag({ machineId: may, tagKey: tag, limit: gioiHan });
      const gon = dong.map((d) => ({
        tag: d.tagKey, giaTri: d.valueNumeric ?? d.valueText, donVi: d.unit, chatLuong: d.quality, thoiDiem: d.timestamp,
      }));
      const truongRa = typeof t.truongRa === "string" && t.truongRa ? t.truongRa : "tag";
      ra.push({ json: { ...item.json, [truongRa]: tag ? (gon[0] ?? null) : gon } });
    }
    return { main: ra };
  },
});

/** Đánh giá tham số trên item DUY NHẤT (một node = một đề xuất = một hàng chờ). Nhiều item ⇒ lỗi, không đề xuất hàng loạt. */
function thamSoMotItem(thamSo: Record<string, unknown>, ngu: NguCanhChay, loai: string): Record<string, unknown> {
  const vao = ngu.inputs.main ?? [];
  if (vao.length !== 1) throw new LoiCongOt(5, `${loai}: nhận đúng 1 item (nhận ${vao.length}) — mỗi đề xuất OT là một lượt duyệt riêng`);
  return danhGiaThamSo(thamSo, nguCanhItem(ngu, vao[0], vao)) as Record<string, unknown>;
}

const nguDeXuat = (ngu: NguCanhChay) => ({ runId: ngu.runId, nodeId: ngu.nodeId, idempotencyKey: ngu.idempotencyKey, boKiem: ngu.kiemPhamVi });

/** Kết quả của `kiemVaDeXuat` ⇒ đầu ra node: mức 4–5 ⇒ LỖI node (không đề xuất) · mức ≤ 3 ⇒ yêu cầu chờ duyệt (mô phỏng). */
function ketQuaNut(kq: KetQuaKiemOt, loai: string) {
  if (kq.ketQua === "tu-choi-muc-cao") {
    throw new LoiCongOt(kq.muc, `${loai}: tu-choi-muc-cao (mức ${kq.muc}, ${kq.ma}) — ${kq.lyDo}`);
  }
  return kq.yeuCauCho;
}

/** Đề xuất một lệnh: `may`, `lenh` (stop/pause/start/reset/set_machine_param… — khớp CHÍNH XÁC), `tag`, `giaTri`, `hetHanGio`. */
dangKyNut({
  type: "ot.de-xuat-lenh",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["dong-y", "tu-choi", "het-han"],
  tacDungPhu: "ot",
  lapLai: "atMostOnce",
  async chay(thamSo, ngu) {
    const t = thamSoMotItem(thamSo, ngu, "ot.de-xuat-lenh");
    // id không hợp lệ ⇒ cổng OT từ chối theo hình dạng (không đọc máy); id hợp lệ ⇒ phải thuộc phạm vi TRƯỚC khi cổng đọc `device_tags`.
    const may = chuanHoaIdMay(t.may);
    if (may === null) throw new LoiCongOt(5, `ot.de-xuat-lenh: tu-choi-muc-cao (mức 5, KHONG_NHAN_RA) — TỪ CHỐI (fail-closed, mức 5) — máy phải là số nguyên dương (nhận ${JSON.stringify(t.may)?.slice(0, 40)})`);
    await kiemMayTrongPhamVi(ngu, may);
    const kq = await kiemVaDeXuat({ loai: "lenh", may, lenh: t.lenh, tag: t.tag, giaTri: t.giaTri, hetHanGio: t.hetHanGio }, nguDeXuat(ngu));
    return ketQuaNut(kq, "ot.de-xuat-lenh");
  },
});

/** Đề xuất chạy một FOE workflow ĐÃ DUYỆT: `workflowId`, `version`, `thamSo` (ghi kèm cho người duyệt), `hetHanGio`. */
dangKyNut({
  type: "ot.de-xuat-luong",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["dong-y", "tu-choi", "het-han"],
  tacDungPhu: "ot",
  lapLai: "atMostOnce",
  async chay(thamSo, ngu) {
    const t = thamSoMotItem(thamSo, ngu, "ot.de-xuat-luong");
    if (!ngu.kiemPhamVi) throw new LoiCongOt(0, "Không xác định được người chạy luồng (khoá / mất quyền / chưa có chủ lượt) — từ chối tham chiếu FOE workflow.", "CHU_LUOT_KHONG_XAC_DINH");
    const kq = await kiemVaDeXuat({ loai: "luong-foe", workflowId: t.workflowId, version: t.version, thamSo: t.thamSo, hetHanGio: t.hetHanGio }, nguDeXuat(ngu));
    return ketQuaNut(kq, "ot.de-xuat-luong");
  },
});
