import { describe, it, expect, afterEach } from "vitest";
import { argmaxSoftmax, cheDoNhanDang, chonDong, coChuViet, giaiMaChiSo, rongVietOcr } from "./ocrVietOcr";

describe("ocrVietOcr — phần THUẦN", () => {
  it("rộng đầu vào: tỉ lệ theo cao 32, làm tròn LÊN bội 10, kẹp [32, 512]", () => {
    expect(rongVietOcr(320, 32)).toBe(320);
    expect(rongVietOcr(321, 32)).toBe(330);
    expect(rongVietOcr(10, 32)).toBe(32);
    expect(rongVietOcr(5000, 32)).toBe(512);
  });
  it("giải mã: bỏ pad/bắt đầu/mask, dừng ở kết thúc, ký tự từ chỉ số 4", () => {
    expect(giaiMaChiSo([4, 5, 3, 6, 2, 4], "abc")).toBe("abc");
    expect(giaiMaChiSo([1, 0, 4], "xyz")).toBe("x");
  });
  it("argmax + xác suất softmax thật (không phải logit)", () => {
    const r = argmaxSoftmax([0, 0, Math.log(8)], 0, 3);
    expect(r.i).toBe(2);
    expect(r.p).toBeCloseTo(0.8, 5);
  });
  it("★ chữ Việt: nhận ă â đ ê ô ơ ư và chữ có dấu thanh; KHÔNG nhận ASCII thuần", () => {
    for (const s of ["áp suất", "Bước", "đèn", "tỷ lệ"]) expect(coChuViet(s), s).toBe(true);
    for (const s of ["Error code E082", "void <= 25%", "support@st4i.vn"]) expect(coChuViet(s), s).toBe(false);
  });
  it("★★ tu-dong: dòng VietOCR mang chữ Việt ⇒ VietOCR; dòng Latin thuần ⇒ paddle; một bên hỏng ⇒ bên kia", () => {
    const p = { text: "ap suat khi nen thap", score: 0.96 };
    const v = { text: "áp suất khí nén thấp", score: 0.92 };
    expect(chonDong(p, v)).toBe(v);
    const pe = { text: "Error code E082", score: 0.98 };
    const ve = { text: "It Is Error code E082", score: 0.9 };
    expect(chonDong(pe, ve)).toBe(pe);
    expect(chonDong(null, v)).toBe(v);
    expect(chonDong(p, null)).toBe(p);
  });
});

describe("cheDoNhanDang — mặc định theo tệp model", () => {
  const cu = process.env.OCR_REC_ENGINE;
  const cuDir = process.env.OCR_VIETOCR_DIR;
  afterEach(() => {
    if (cu === undefined) delete process.env.OCR_REC_ENGINE; else process.env.OCR_REC_ENGINE = cu;
    if (cuDir === undefined) delete process.env.OCR_VIETOCR_DIR; else process.env.OCR_VIETOCR_DIR = cuDir;
  });
  it("★ không có tệp VietOCR ⇒ paddle, kể cả khi khai vietocr/tu-dong (máy thiếu model giữ hành vi cũ)", () => {
    process.env.OCR_VIETOCR_DIR = "Z:/khong/ton/tai";
    for (const v of ["", "vietocr", "tu-dong"]) {
      process.env.OCR_REC_ENGINE = v;
      expect(cheDoNhanDang(), v).toBe("paddle");
    }
  });
  it("khai 'paddle' luôn thắng; giá trị lạ ⇒ paddle", () => {
    process.env.OCR_REC_ENGINE = "paddle";
    expect(cheDoNhanDang()).toBe("paddle");
    process.env.OCR_REC_ENGINE = "abc";
    expect(cheDoNhanDang()).toBe("paddle");
  });
});
