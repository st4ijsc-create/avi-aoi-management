/**
 * ★★ Đợt 3b (3.5) — "DÁN ẢNH LỖI VÀO CHAT": ảnh chụp màn hình ⇒ OCR ⇒ CHỮ chèn vào câu hỏi.
 *
 * Model lập trình chính KHÔNG có thị giác — nên ảnh không bao giờ đi tới model; chỉ chữ OCR trích được. Đường OCR là
 * dịch vụ SẴN CÓ của Training Studio (`ocrService.runOcrTrang`: DET → từng dòng → REC, ONNX qua cổng VRAM), không
 * dựng engine mới.
 *
 * Hàng rào: CHỈ ẢNH (nhận dạng theo BYTE ĐẦU — không tin MIME client), trần kích thước, một lượt OCR mỗi người một lúc,
 * trần giờ, trần ký tự đầu ra. Cờ OCR tắt / thiếu model ⇒ nói THẬT lý do (không bịa chữ).
 */
import { isOcrEngineEnabled, ocrModelsAvailable, runOcrTrang } from "./ocrService";

export const TRAN_BYTE_ANH = 4 * 1024 * 1024;
export const TRAN_KY_TU_OCR = 8_000;
export const HAN_GIO_OCR_MS = 45_000;

export type LoaiAnh = "png" | "jpeg" | "webp" | "gif" | "bmp";

export type MaLoiOcrAnh =
  | "ANH_QUA_LON"
  | "KHONG_PHAI_ANH"
  | "OCR_TAT"
  | "OCR_THIEU_MODEL"
  | "OCR_DANG_BAN"
  | "OCR_HET_GIO"
  | "OCR_KHONG_DOC_DUOC"
  | "OCR_RONG";

export type KetQuaOcrAnh =
  | { ok: true; text: string; doTinCay: number; catBot: boolean; loai: LoaiAnh }
  | { ok: false; ma: MaLoiOcrAnh };

/** Nhận dạng ảnh theo CHỮ KÝ BYTE ĐẦU. THUẦN. */
export function nhanDangLoaiAnh(b: Uint8Array): LoaiAnh | null {
  const la = (...x: number[]) => x.every((v, i) => b[i] === v);
  if (b.length >= 8 && la(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (b.length >= 3 && la(0xff, 0xd8, 0xff)) return "jpeg";
  if (b.length >= 12 && la(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  if (b.length >= 6 && la(0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "gif";
  if (b.length >= 2 && la(0x42, 0x4d)) return "bmp";
  return null;
}

/** base64 (có thể kèm tiền tố `data:image/...;base64,`) ⇒ Buffer, hoặc lỗi. THUẦN. */
export function giaiMaAnhBase64(s: string): { ok: true; buf: Buffer } | { ok: false; ma: "ANH_QUA_LON" | "KHONG_PHAI_ANH" } {
  const than = s.replace(/^data:[a-z0-9.+/-]+;base64,/i, "").replace(/\s+/g, "");
  if (than.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(than)) return { ok: false, ma: "KHONG_PHAI_ANH" };
  if (Math.floor((than.length * 3) / 4) > TRAN_BYTE_ANH + 3) return { ok: false, ma: "ANH_QUA_LON" };
  const buf = Buffer.from(than, "base64");
  if (buf.length > TRAN_BYTE_ANH) return { ok: false, ma: "ANH_QUA_LON" };
  return { ok: true, buf };
}

export interface PhuThuocOcr {
  batOcr: () => boolean;
  coModel: () => boolean;
  ocr: (anh: Buffer) => Promise<{ ok: boolean; text: string; confidence: number; degraded?: boolean }>;
}

const MAC_DINH: PhuThuocOcr = {
  batOcr: isOcrEngineEnabled,
  coModel: ocrModelsAvailable,
  ocr: (anh) => runOcrTrang(anh, { language: "auto" }),
};

const dangChay = new Set<number>();

export async function ocrAnhLoi(userId: number, base64: string, dep: PhuThuocOcr = MAC_DINH): Promise<KetQuaOcrAnh> {
  const gm = giaiMaAnhBase64(base64);
  if (!gm.ok) return gm;
  const loai = nhanDangLoaiAnh(gm.buf);
  if (!loai) return { ok: false, ma: "KHONG_PHAI_ANH" };
  if (!dep.batOcr()) return { ok: false, ma: "OCR_TAT" };
  if (!dep.coModel()) return { ok: false, ma: "OCR_THIEU_MODEL" };
  if (dangChay.has(userId)) return { ok: false, ma: "OCR_DANG_BAN" };
  dangChay.add(userId);
  let hen: ReturnType<typeof setTimeout> | undefined;
  // ⚠ Khoá "một lượt mỗi người" nhả khi lượt OCR THẬT xong — không khi ta thôi chờ (hết giờ): lượt bị bỏ chờ vẫn đang
  //   giữ CPU/VRAM, mở cho lượt thứ hai lúc ấy là chồng tải.
  const luot = Promise.resolve()
    .then(() => dep.ocr(gm.buf))
    .finally(() => dangChay.delete(userId));
  try {
    const kq = await Promise.race([
      luot,
      new Promise<"het-gio">((res) => {
        hen = setTimeout(() => res("het-gio"), HAN_GIO_OCR_MS);
      }),
    ]);
    if (kq === "het-gio") return { ok: false, ma: "OCR_HET_GIO" };
    if (!kq.ok || kq.degraded) return { ok: false, ma: "OCR_KHONG_DOC_DUOC" };
    const text = kq.text.replace(/\r\n/g, "\n").trim();
    if (!text) return { ok: false, ma: "OCR_RONG" };
    return {
      ok: true,
      text: text.slice(0, TRAN_KY_TU_OCR),
      doTinCay: Number(kq.confidence) || 0,
      catBot: text.length > TRAN_KY_TU_OCR,
      loai,
    };
  } catch {
    return { ok: false, ma: "OCR_KHONG_DOC_DUOC" };
  } finally {
    if (hen) clearTimeout(hen);
  }
}
