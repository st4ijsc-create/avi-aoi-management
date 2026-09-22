import { describe, it, expect } from "vitest";
import { mucCanhBao, tachNghiSinh } from "./ThanhTrangThaiAiLocal";

// ★ F2 (2026-09-22) — hai vị từ mới: % ngữ cảnh và tách nghĩ/sinh. "Không biết ≠ 0" là luật đắt nhất.
describe("mucCanhBao — % ngữ cảnh đã dùng (F2)", () => {
  it("★★★ ca thật: lượt nghĩ hết trần rồi trả rỗng ⇒ ≥95 % là NGUY, 85–94 % là CẢNH BÁO, dưới là bình thường", () => {
    expect(mucCanhBao({ loai: "ctx", giaTri: 84 })).toBe("binh-thuong");
    expect(mucCanhBao({ loai: "ctx", giaTri: 85 })).toBe("canh-bao");
    expect(mucCanhBao({ loai: "ctx", giaTri: 95 })).toBe("nguy");
    expect(mucCanhBao({ loai: "ctx", giaTri: 100 })).toBe("nguy");
  });
  it("không biết trần ⇒ bình thường (xám), không phải cảnh báo giả", () => {
    expect(mucCanhBao({ loai: "ctx", giaTri: null })).toBe("binh-thuong");
    expect(mucCanhBao({ loai: "ctx", giaTri: Number.NaN })).toBe("binh-thuong");
  });
});

describe("tachNghiSinh — nghĩ / sinh / % ctx / tok/s (F2)", () => {
  it("★★★ 'nghĩ 5.000 rồi trả 300' KHÁC 'trả 5.300': sinh = ra − nghĩ, không gộp", () => {
    const r = tachNghiSinh({ tokensIn: 700, tokensOut: 5300, tokensReasoning: 5000, latencyMs: 10_000, ctxMax: 32_768 });
    expect(r.nghi).toBe(5000);
    expect(r.sinh).toBe(300);
    expect(r.gop).toBe(false);
    expect(r.pcCtx).toBe(18); // (700 + 5300) / 32768 = 18,3 %
    expect(r.tokMoiGiay).toBe(530); // tốc độ GỘP — không bịa hai tốc độ khi server không tách thời gian
  });
  it("★★★ server KHÔNG đếm được suy luận ⇒ nghi = null, sinh = số GỘP và cờ gop = true (không giả là 'sinh')", () => {
    const r = tachNghiSinh({ tokensIn: 100, tokensOut: 900, latencyMs: 3000 });
    expect(r.nghi).toBeNull();
    expect(r.sinh).toBe(900);
    expect(r.gop).toBe(true);
    expect(r.pcCtx, "không biết trần ⇒ null, không phải 0 %").toBeNull();
  });
  it("0 suy luận đo được là 0 (đã xem trọn luồng), không phải 'không biết'", () => {
    const r = tachNghiSinh({ tokensIn: 10, tokensOut: 40, tokensReasoning: 0, latencyMs: 1000, ctxMax: 100 });
    expect(r.nghi).toBe(0);
    expect(r.sinh).toBe(40);
    expect(r.gop).toBe(false);
    expect(r.pcCtx).toBe(50);
  });
  it("số lệch (nghĩ > ra) không ra âm; % ctx kẹp 100; thời gian 0 ⇒ tok/s null", () => {
    const r = tachNghiSinh({ tokensIn: 90, tokensOut: 30, tokensReasoning: 50, latencyMs: 0, ctxMax: 100 });
    expect(r.sinh).toBe(0);
    expect(r.pcCtx).toBe(100);
    expect(r.tokMoiGiay).toBeNull();
  });
});

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
