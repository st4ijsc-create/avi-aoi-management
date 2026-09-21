import { describe, it, expect } from "vitest";
import { mucCanhBao } from "./ThanhTrangThaiAiLocal";

const GiB = 1024 ** 3;

/**
 * ★★★ G14 — ngưỡng cảnh báo phải là KHẲNG ĐỊNH ĐO ĐƯỢC, không phải trực giác.
 * Mỗi ngưỡng dưới đây rút từ một sự cố thật trong đợt audit 2026-09-21/22.
 */
describe("mucCanhBao — VRAM", () => {
  it("★★★ CA THẬT: card còn 3 GiB mà bộ cấp phát hứa 22 GiB ⇒ 3 GiB phải là BÌNH THƯỜNG, còn <2 GiB mới kêu", () => {
    expect(mucCanhBao({ loai: "vram", giaTri: 3 * GiB })).toBe("binh-thuong");
    expect(mucCanhBao({ loai: "vram", giaTri: 1.5 * GiB })).toBe("canh-bao");
    expect(mucCanhBao({ loai: "vram", giaTri: 0.5 * GiB })).toBe("nguy");
  });
  it("★ biên đúng tại ngưỡng", () => {
    expect(mucCanhBao({ loai: "vram", giaTri: 2 * GiB })).toBe("binh-thuong");
    expect(mucCanhBao({ loai: "vram", giaTri: 1 * GiB })).toBe("canh-bao");
  });
});

describe("mucCanhBao — ngân sách đọc", () => {
  it("★★★ cảnh báo phải tới TRƯỚC lúc tác nhân mù, không phải lúc đã mù", () => {
    expect(mucCanhBao({ loai: "ngan-sach", giaTri: 79 })).toBe("binh-thuong");
    expect(mucCanhBao({ loai: "ngan-sach", giaTri: 80 })).toBe("canh-bao");
    expect(mucCanhBao({ loai: "ngan-sach", giaTri: 100 })).toBe("nguy");
  });
});

describe("mucCanhBao — tốc độ sinh token", () => {
  it("★ 210 tok/s (đo thật trên Qwen3-Coder) là bình thường; tụt dưới 5 là dấu hiệu tràn RAM", () => {
    expect(mucCanhBao({ loai: "toc-do", giaTri: 210.3 })).toBe("binh-thuong");
    expect(mucCanhBao({ loai: "toc-do", giaTri: 4 })).toBe("canh-bao");
    expect(mucCanhBao({ loai: "toc-do", giaTri: 1 })).toBe("nguy");
  });
});

describe("mucCanhBao — MÁY, và nguyên tắc 'không biết ≠ tốt'", () => {
  it("★★★ engine hỏng ⇒ NGUY (đây là ô cứu ta khỏi đổ lỗi cho model khi máy mới là thứ hỏng)", () => {
    expect(mucCanhBao({ loai: "may", giaTri: null, mayHong: true })).toBe("nguy");
    expect(mucCanhBao({ loai: "may", giaTri: null, mayHong: false })).toBe("binh-thuong");
  });
  it("★★★ KHÔNG ĐO ĐƯỢC ⇒ 'binh-thuong' (xám) — ô sẽ hiện '—', TUYỆT ĐỐI không hiện 0 như một phép đo", () => {
    for (const loai of ["vram", "ngan-sach", "toc-do"] as const) {
      expect(mucCanhBao({ loai, giaTri: null }), loai).toBe("binh-thuong");
      expect(mucCanhBao({ loai, giaTri: undefined }), loai).toBe("binh-thuong");
      expect(mucCanhBao({ loai, giaTri: NaN }), loai).toBe("binh-thuong");
    }
  });
  it("★ số 0 THẬT vẫn phải kêu — khác hẳn 'không đo được'", () => {
    expect(mucCanhBao({ loai: "vram", giaTri: 0 })).toBe("nguy");
    expect(mucCanhBao({ loai: "toc-do", giaTri: 0 })).toBe("nguy");
  });
});
