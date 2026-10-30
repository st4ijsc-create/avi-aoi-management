/**
 * Đợt 10.4b (L1) — LỖI của đường sinh chữ bằng model NGOÀI, đọc từ hợp đồng `shared/ai/sinhChuNgoai.ts`:
 *   • JSON TRƯỚC khi mở SSE (`LoiTruocSse`, HTTP 428/403/404/429/409/400/413) hoặc khung SSE `error` {code, tranVuot, vet};
 *   • một lớp lỗi có kiểu (`status`/`code`/`muc`/`tranVuot`/`vet`) để bề mặt PHÂN BIỆT: 428 ⇒ mở hộp xác nhận vận hành; còn lại ⇒ hiện câu bản địa.
 * Chuỗi hiển thị chỉ lấy từ khoá i18n theo `code` (mã do máy chủ đặt, không phải chữ model chọn); `error` thô của máy chủ chỉ là dự phòng khi thiếu khoá.
 * `vet` từ máy chủ được KIỂM KIỂU từng ô (số hữu hạn không âm, chuỗi cắt độ dài) trước khi dùng ở huy hiệu.
 */
import i18n from "i18next";
import { HTTP_LOI_TRUOC_SSE, MA_CAN_XAC_NHAN_VAN_HANH, MUC_DU_LIEU, TRAN_VUOT, type MucDuLieuChung, type TranVuot, type VetNgoai } from "@shared/ai/sinhChuNgoai";

const laTranVuot = (v: unknown): v is TranVuot => typeof v === "string" && (TRAN_VUOT as readonly string[]).includes(v);
const laMuc = (v: unknown): v is MucDuLieuChung => typeof v === "string" && (MUC_DU_LIEU as readonly string[]).includes(v);

/** Mã lỗi thuộc đường ngoài: bảng HTTP trước-SSE, tiền tố `NGOAI_`, hoặc `modelNgoaiChuaCaiDat` (bề mặt đóng — 404 của KB). */
export function laMaLoiNgoai(code: unknown): code is string {
  return typeof code === "string" && (Object.prototype.hasOwnProperty.call(HTTP_LOI_TRUOC_SSE, code) || code.startsWith("NGOAI_") || code === "modelNgoaiChuaCaiDat");
}

const so = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Kiểm kiểu `vet` từ máy chủ; thiếu `callId` nguyên dương hoặc thiếu nhà cung cấp/model ⇒ null (không dựng huy hiệu từ gói hỏng). */
export function bocVetNgoai(v: unknown): VetNgoai | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const callId = typeof o.callId === "number" && Number.isInteger(o.callId) && o.callId > 0 ? o.callId : null;
  if (callId === null || typeof o.nhaCungCap !== "string" || !o.nhaCungCap || typeof o.model !== "string" || !o.model) return null;
  return { nhaCungCap: o.nhaCungCap.slice(0, 64), model: o.model.slice(0, 160), tokenVao: so(o.tokenVao), tokenRa: so(o.tokenRa), chiPhiUocUsd: so(o.chiPhiUocUsd), callId };
}

/** Câu hiển thị cho một mã lỗi ngoài (+ trần nào bị vượt, nếu có). */
export function thongDiepLoiNgoai(code: string, tranVuot?: TranVuot, macDinh?: string): string {
  const goc = String(i18n.t(`errors.reason.${code}`, { defaultValue: macDinh || code }));
  if (!tranVuot) return goc;
  const tv = String(i18n.t(`hopDongYNgoai.tranVuot.${tranVuot}`, { defaultValue: tranVuot }));
  return `${goc} (${tv})`;
}

export class LoiSinhChuNgoai extends Error {
  readonly status: number;
  readonly code: string;
  readonly muc?: MucDuLieuChung;
  readonly tranVuot?: TranVuot;
  readonly vet: VetNgoai | null;
  constructor(init: { status: number; code: string; error?: unknown; muc?: unknown; tranVuot?: unknown; vet?: unknown }) {
    const tv = laTranVuot(init.tranVuot) ? init.tranVuot : undefined;
    super(thongDiepLoiNgoai(init.code, tv, typeof init.error === "string" ? init.error.slice(0, 300) : undefined));
    this.name = "LoiSinhChuNgoai";
    this.status = init.status;
    this.code = init.code;
    if (laMuc(init.muc)) this.muc = init.muc;
    if (tv) this.tranVuot = tv;
    this.vet = bocVetNgoai(init.vet);
  }
  /** 428 — chưa xác nhận "người gõ = dữ liệu vận hành": bề mặt hỏi MỘT lần rồi gửi lại với `xacNhanVanHanh: true`. */
  get canXacNhanVanHanh(): boolean {
    return this.code === MA_CAN_XAC_NHAN_VAN_HANH;
  }
}

/** Thân JSON của phản hồi không-ok ⇒ lỗi ngoài có kiểu, hoặc null (lỗi khác: giữ đường cũ). */
export function docLoiTruocSse(status: number, body: unknown): LoiSinhChuNgoai | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!laMaLoiNgoai(b.code)) return null;
  return new LoiSinhChuNgoai({ status, code: b.code, error: b.error, muc: b.muc, tranVuot: b.tranVuot });
}
