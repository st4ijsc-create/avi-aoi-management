/**
 * R4 — lưới kiểm máy sau nạp (`kbKiemSauNap.ts`).
 * ĐỘT BIẾN PHẢI BẮT: bỏ cờ quét ảnh · coi OCR là ổn · "đã kiểm, ổn" lẫn với "chưa kiểm" · mất cảnh báo cắt.
 */
import { describe, it, expect } from "vitest";
import { kiemSauNap, kiemKhiKhongCoChu } from "./kbKiemSauNap";

const ma = (k: { canhBao: { ma: string }[] }) => k.canhBao.map((c) => c.ma);

describe("kiemSauNap", () => {
  it("PDF chữ bình thường ⇒ canhBao RỖNG (đã kiểm, ổn) + số trang / ký tự mỗi trang", () => {
    const k = kiemSauNap({ sourceType: "pdf", charCount: 9000, truncated: false, pageCount: 3 }, 6);
    expect(k).toMatchObject({ soTrang: 3, soKyTu: 9000, soDoan: 6, kyTuMoiTrang: 3000, ocrSoTrang: null, canhBao: [] });
  });

  it("PDF quét ảnh, OCR không cấp chữ ⇒ ĐỎ `pdf-quet-khong-ocr` dù vẫn lưu được vài đoạn vụn", () => {
    const k = kiemSauNap({ sourceType: "pdf", charCount: 30, truncated: false, pageCount: 5, scannedNoOcr: true }, 1);
    expect(ma(k)).toEqual(["pdf-quet-khong-ocr"]);
    expect(k.canhBao[0].muc).toBe("do");
    expect(k.kyTuMoiTrang).toBe(6);
  });

  it("lý do OCR không chạy đi theo kết quả CHỈ khi quét ảnh (`thieu-pdftoppm` — đo được trên máy này)", () => {
    expect(kiemSauNap({ sourceType: "pdf", charCount: 0, truncated: false, pageCount: 1, scannedNoOcr: true, ocrLyDo: "thieu-pdftoppm" }, 0).ocrLyDo).toBe("thieu-pdftoppm");
    expect(kiemSauNap({ sourceType: "pdf", charCount: 900, truncated: false, pageCount: 1, ocrLyDo: "thieu-pdftoppm" }, 1).ocrLyDo).toBeUndefined();
  });

  it("chữ từ OCR ⇒ VÀNG `ocr` + số trang OCR; văn bản bị cắt ⇒ VÀNG `bi-cat`", () => {
    const k = kiemSauNap({ sourceType: "pdf", charCount: 4000, truncated: true, pageCount: 2, ocrUsed: true, ocrPagesProcessed: 2 }, 3);
    expect(ma(k)).toEqual(["ocr", "bi-cat"]);
    expect(k.canhBao.every((c) => c.muc === "vang")).toBe(true);
    expect(k.ocrSoTrang).toBe(2);
  });

  it("0 đoạn ⇒ ĐỎ `khong-doan`; tệp không phải PDF ⇒ không có số trang", () => {
    const k = kiemSauNap({ sourceType: "md", charCount: 10, truncated: false }, 0);
    expect(ma(k)).toEqual(["khong-doan"]);
    expect(k.soTrang).toBeNull();
    expect(k.kyTuMoiTrang).toBeNull();
  });
});

describe("kiemKhiKhongCoChu", () => {
  it("job thất bại vì không có chữ ⇒ ĐỎ `khong-trich-duoc-chu`, kèm cờ quét ảnh khi bộ parse biết", () => {
    expect(ma(kiemKhiKhongCoChu({ sourceType: "pdf", charCount: 0, truncated: false, pageCount: 4, scannedNoOcr: true }))).toEqual([
      "khong-trich-duoc-chu",
      "pdf-quet-khong-ocr",
    ]);
    expect(ma(kiemKhiKhongCoChu({ sourceType: "docx", charCount: 0, truncated: false }))).toEqual(["khong-trich-duoc-chu"]);
  });
});
