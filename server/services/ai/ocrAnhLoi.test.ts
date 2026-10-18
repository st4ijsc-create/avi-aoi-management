/**
 * ★★ Đợt 3b — OCR ẢNH LỖI: chỉ ảnh (byte đầu, không tin MIME), trần kích thước, cờ/model vắng nói thật, một lượt mỗi
 * người, hết giờ, trần ký tự. Phụ thuộc OCR tiêm (không nạp ONNX).
 */
import { describe, expect, it } from "vitest";
import { giaiMaAnhBase64, nhanDangLoaiAnh, ocrAnhLoi, TRAN_BYTE_ANH, TRAN_KY_TU_OCR, type PhuThuocOcr } from "./ocrAnhLoi";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const b64 = (b: Buffer) => b.toString("base64");

function dep(p: Partial<PhuThuocOcr> = {}): PhuThuocOcr {
  return {
    batOcr: () => true,
    coModel: () => true,
    ocr: async () => ({ ok: true, text: "TypeError: x is undefined\n  at a.ts:3", confidence: 0.91 }),
    ...p,
  };
}

describe("ocrAnhLoi", () => {
  it("nhận dạng chữ ký byte: png/jpeg/webp/gif/bmp; văn bản/svg ⇒ null", () => {
    expect(nhanDangLoaiAnh(PNG)).toBe("png");
    expect(nhanDangLoaiAnh(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(nhanDangLoaiAnh(Buffer.from("RIFF0000WEBPVP8 ", "latin1"))).toBe("webp");
    expect(nhanDangLoaiAnh(Buffer.from("GIF89a", "latin1"))).toBe("gif");
    expect(nhanDangLoaiAnh(Buffer.from("BM00", "latin1"))).toBe("bmp");
    expect(nhanDangLoaiAnh(Buffer.from("<svg xmlns=", "latin1"))).toBeNull();
    expect(nhanDangLoaiAnh(Buffer.from("hello", "latin1"))).toBeNull();
  });

  it("★★ base64: tiền tố data: được bỏ; ký tự lạ ⇒ KHONG_PHAI_ANH; vượt trần ⇒ ANH_QUA_LON (trước khi giải mã)", () => {
    expect(giaiMaAnhBase64(`data:image/png;base64,${b64(PNG)}`)).toMatchObject({ ok: true });
    expect(giaiMaAnhBase64("@@@")).toMatchObject({ ok: false, ma: "KHONG_PHAI_ANH" });
    expect(giaiMaAnhBase64("A".repeat(Math.ceil(((TRAN_BYTE_ANH + 1024) * 4) / 3)))).toMatchObject({ ok: false, ma: "ANH_QUA_LON" });
  });

  it("★★★ MIME giả: tệp văn bản đội tên ảnh ⇒ KHONG_PHAI_ANH, OCR KHÔNG được gọi", async () => {
    let goi = 0;
    const r = await ocrAnhLoi(1, `data:image/png;base64,${b64(Buffer.from("rm -rf /"))}`, dep({ ocr: async () => { goi++; return { ok: true, text: "x", confidence: 1 }; } }));
    expect(r).toMatchObject({ ok: false, ma: "KHONG_PHAI_ANH" });
    expect(goi).toBe(0);
  });

  it("★★ cờ tắt / thiếu model ⇒ nói thật lý do, không bịa chữ", async () => {
    expect(await ocrAnhLoi(1, b64(PNG), dep({ batOcr: () => false }))).toMatchObject({ ok: false, ma: "OCR_TAT" });
    expect(await ocrAnhLoi(1, b64(PNG), dep({ coModel: () => false }))).toMatchObject({ ok: false, ma: "OCR_THIEU_MODEL" });
    expect(await ocrAnhLoi(1, b64(PNG), dep({ ocr: async () => ({ ok: true, text: "", confidence: 0, degraded: true }) }))).toMatchObject({ ok: false, ma: "OCR_KHONG_DOC_DUOC" });
    expect(await ocrAnhLoi(1, b64(PNG), dep({ ocr: async () => ({ ok: true, text: "   ", confidence: 0 }) }))).toMatchObject({ ok: false, ma: "OCR_RONG" });
  });

  it("★★ thành công ⇒ chữ + độ tin cậy; chữ dài ⇒ cắt + cờ catBot", async () => {
    expect(await ocrAnhLoi(1, b64(PNG), dep())).toMatchObject({ ok: true, text: "TypeError: x is undefined\n  at a.ts:3", doTinCay: 0.91, loai: "png" });
    const dai = await ocrAnhLoi(1, b64(PNG), dep({ ocr: async () => ({ ok: true, text: "x".repeat(TRAN_KY_TU_OCR + 5), confidence: 0.5 }) }));
    expect(dai.ok && dai.text.length).toBe(TRAN_KY_TU_OCR);
    expect(dai.ok && dai.catBot).toBe(true);
  });

  it("★★ một lượt mỗi người: lượt thứ hai khi lượt đầu đang chạy ⇒ OCR_DANG_BAN; người khác không bị chặn", async () => {
    let tha!: () => void;
    const cham = dep({ ocr: () => new Promise((res) => { tha = () => res({ ok: true, text: "a", confidence: 1 }); }) });
    const p1 = ocrAnhLoi(7, b64(PNG), cham);
    await new Promise((r) => setTimeout(r, 0));
    expect(await ocrAnhLoi(7, b64(PNG), dep())).toMatchObject({ ok: false, ma: "OCR_DANG_BAN" });
    expect(await ocrAnhLoi(8, b64(PNG), dep())).toMatchObject({ ok: true });
    tha();
    expect(await p1).toMatchObject({ ok: true });
    expect(await ocrAnhLoi(7, b64(PNG), dep())).toMatchObject({ ok: true });
  });
});
