/**
 * R4 (kế hoạch AI Local 2026-09-22 §4) — KIỂM MÁY SAU NẠP cho một job Training Studio. Thuần: đầu vào là
 * `ParsedDocumentMeta` mà bộ parse ĐÃ tính (và trước bản này bị vứt đi) + số đoạn thật đã lưu.
 *
 * Chuyển lời dặn trong hướng dẫn ("PDF quét ảnh ra 0 đoạn") thành cảnh báo MÁY, có mã + mức + lý do,
 * lưu vào `kb_ingest_jobs."ketQuaMay"` (mig 0360) để tab Tác vụ hiện huy hiệu:
 *   · `pdf-quet-khong-ocr` (đỏ)  — mật độ chữ dưới ngưỡng (trang ảnh) và OCR không cấp được chữ: đoạn lưu
 *                                  (nếu có) chỉ là mảnh vụn của lớp chữ, trợ lý gần như không dùng được.
 *   · `khong-trich-duoc-chu` (đỏ) — tệp không ra chữ nào (job thất bại) — kèm cờ quét ảnh nếu bộ parse biết.
 *   · `khong-doan` (đỏ)          — nạp "thành công" mà 0 đoạn được lưu.
 *   · `ocr` (vàng)               — chữ đến từ OCR: nên xem mẫu đoạn, OCR có thể sai dấu/chữ số.
 *   · `bi-cat` (vàng)            — văn bản vượt trần ký tự, phần đuôi KHÔNG được nạp.
 * Không có cảnh báo ⇒ `canhBao: []` (đã kiểm, ổn) — KHÁC `ketQuaMay: null` (chưa từng kiểm).
 */
import type { ParsedDocumentMeta } from "./kbDocParser";

export type MaCanhBaoNap = "pdf-quet-khong-ocr" | "khong-trich-duoc-chu" | "khong-doan" | "ocr" | "bi-cat";
export type MucCanhBao = "do" | "vang";

export interface CanhBaoNap {
  ma: MaCanhBaoNap;
  muc: MucCanhBao;
}

export interface KetQuaMayNap {
  soTrang: number | null;
  soKyTu: number;
  soDoan: number;
  /** Ký tự mỗi trang — chỉ có với PDF (có số trang). */
  kyTuMoiTrang: number | null;
  ocrSoTrang: number | null;
  /** Chỉ khi quét ảnh mà OCR không cấp chữ: mã lý do (`thieu-pdftoppm` · `tat-kb-ocr` · …). */
  ocrLyDo?: string;
  canhBao: CanhBaoNap[];
}

const MUC: Record<MaCanhBaoNap, MucCanhBao> = {
  "pdf-quet-khong-ocr": "do",
  "khong-trich-duoc-chu": "do",
  "khong-doan": "do",
  ocr: "vang",
  "bi-cat": "vang",
};

function co(ma: MaCanhBaoNap): CanhBaoNap {
  return { ma, muc: MUC[ma] };
}

export function kiemSauNap(meta: Partial<ParsedDocumentMeta> | null | undefined, soDoan: number): KetQuaMayNap {
  const soTrang = typeof meta?.pageCount === "number" && meta.pageCount > 0 ? meta.pageCount : null;
  const soKyTu = Math.max(0, Number(meta?.charCount ?? 0) || 0);
  const canhBao: CanhBaoNap[] = [];
  if (meta?.scannedNoOcr) canhBao.push(co("pdf-quet-khong-ocr"));
  if (soDoan <= 0) canhBao.push(co("khong-doan"));
  if (meta?.ocrUsed) canhBao.push(co("ocr"));
  if (meta?.truncated) canhBao.push(co("bi-cat"));
  return {
    soTrang,
    soKyTu,
    soDoan: Math.max(0, soDoan),
    kyTuMoiTrang: soTrang ? Math.round(soKyTu / soTrang) : null,
    ocrSoTrang: meta?.ocrUsed ? Number(meta.ocrPagesProcessed ?? 0) : null,
    ...(meta?.scannedNoOcr && meta.ocrLyDo ? { ocrLyDo: meta.ocrLyDo } : {}),
    canhBao,
  };
}

/** Job THẤT BẠI vì không trích được chữ — `meta` có khi bộ parse chạy xong (vd PDF quét ảnh, OCR tắt). */
export function kiemKhiKhongCoChu(meta: Partial<ParsedDocumentMeta> | null | undefined): KetQuaMayNap {
  const k = kiemSauNap(meta, 0);
  const canhBao: CanhBaoNap[] = [co("khong-trich-duoc-chu")];
  if (meta?.scannedNoOcr) canhBao.push(co("pdf-quet-khong-ocr"));
  return { ...k, canhBao };
}
