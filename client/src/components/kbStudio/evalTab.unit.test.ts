/**
 * R1 — lưới EvalTab (Training Studio): logic thuần (`evalTabLogic.ts`) + cây thật của phần trình
 * bày (`BangKetQuaEval.tsx`) qua `renderToStaticMarkup`. `t` giả TRA THẬT `vi.json` ⇒ gõ sai khoá ⇒
 * `‹THIẾU:…›` ⇒ đỏ (khuôn `bangProblems.unit.test.ts`). Đuôi `.unit.test.ts` bắt buộc (glob client).
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • `phanTram(null)` ra "0 %" ⇒ §1 và §4 đỏ (không biết ≠ 0).
 *   • lượt `khong-do-duoc` vẫn vẽ bảy ô ⇒ §4 đỏ.
 *   • `laCauSai` bỏ nhánh `quaNguong` (trúng top‑K nhưng dưới ngưỡng coi là đúng) ⇒ §3 đỏ.
 *   • `chuoiBieuDo` không sắp tăng dần / không đánh dấu lượt sau nạp ⇒ §2 đỏ.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "..", "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));

function tThat(key: string, a?: unknown, b?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : typeof a === "string" ? a : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : b) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tThat, i18n: { language: "vi", changeLanguage: () => {} } }),
}));

const { phanTram, chuoiBieuDo, laCauSai, locCau } = await import("./evalTabLogic");
const { BangKetQuaEval } = await import("./BangKetQuaEval");
type KQ = import("./evalTabLogic").KetQuaCau;

const cauDung: KQ = {
  id: "T01", cauHoi: "NG bao nhiêu thì dừng line?", loai: "trong", de: "ok", hangNguon: 1, diemNguon: 0.71,
  quaNguong: true, dapAnNguCanh: true, top1: { sourceRef: "aoi-thresholds.md", score: 0.71 }, tuChoiDung: null,
  duongOng: true, duongOngBatKy: true, trichDan: [{ sourcePath: "aoi-thresholds.md", score: 0.71, studio: true }], hits: [],
};
const cauDuoiNguong: KQ = { ...cauDung, id: "T02", diemNguon: 0.44, quaNguong: false };
const cauNgoai: KQ = {
  ...cauDung, id: "N01", loai: "ngoai", hangNguon: null, diemNguon: null, quaNguong: false, dapAnNguCanh: null,
  tuChoiDung: true, top1: { sourceRef: "aoi-reports.md", score: 0.31 },
};

describe("§1 phanTram — không biết ≠ 0", () => {
  it("null/undefined/NaN ⇒ —; 0 ⇒ 0 %; 0.8333 ⇒ 83 %", () => {
    expect(phanTram(null)).toBe("—");
    expect(phanTram(undefined)).toBe("—");
    expect(phanTram(Number.NaN)).toBe("—");
    expect(phanTram(0)).toBe("0 %");
    expect(phanTram(0.8333)).toBe("83 %");
  });
});

describe("§2 chuoiBieuDo", () => {
  const luot = (id: number, t: string, soChunk: number, hash = "h1", tongHop: unknown = { trungNguon: 0.5, dapAnNguCanh: 0.4, duongOng: null }) => ({
    id, createdAt: t, trangThai: "xong", soChunk, soNguon: 10, lanNapCuoi: null, boVangHash: hash, tongHop,
  });
  it("sắp tăng dần theo thời gian (server trả mới trước) + đánh dấu lượt sau nạp + đổi đề; null giữ null", () => {
    const d = chuoiBieuDo([
      luot(3, "2026-09-23T03:00:00Z", 35, "h2"),
      luot(2, "2026-09-23T02:00:00Z", 29),
      luot(1, "2026-09-23T01:00:00Z", 29, "h1", null),
    ]);
    expect(d.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(d.map((x) => x.sauNap)).toEqual([false, false, true]);
    expect(d.map((x) => x.doiDe)).toEqual([false, false, true]);
    expect(d[0].trungNguon).toBeNull();
    expect(d[1]).toMatchObject({ trungNguon: 50, dapAnNguCanh: 40, duongOng: null });
  });
});

describe("§3 laCauSai / locCau", () => {
  it("trúng top‑K nhưng dưới ngưỡng = SAI (không tới prompt); câu ngoài từ chối đúng = đúng", () => {
    expect(laCauSai(cauDung)).toBe(false);
    expect(laCauSai(cauDuoiNguong)).toBe(true);
    expect(laCauSai(cauNgoai)).toBe(false);
    expect(laCauSai({ ...cauNgoai, tuChoiDung: false })).toBe(true);
    expect(laCauSai({ ...cauDung, duongOng: false })).toBe(true);
    expect(laCauSai({ ...cauDung, duongOng: null })).toBe(false);
    expect(locCau([cauDung, cauDuoiNguong, cauNgoai], true).map((k) => k.id)).toEqual(["T02"]);
  });
});

describe("§4 BangKetQuaEval — cây thật", () => {
  const luot = {
    id: 9, trangThai: "xong", lyDo: null, k: 5, nguong: 0.5, tangDuongOng: false, soChunk: 29, soNguon: 10,
    embedModel: "Qwen3-Embedding-0.6B-f16.gguf", msTong: 4200,
    tongHop: { soCau: 3, soCauTrong: 2, soCauNgoai: 1, soCauHong: 0, trungNguon: 1, mrr: 1, quaNguong: 0.5, dapAnNguCanh: 1, duongOng: null, duongOngBatKy: null, tuChoiDung: 1 },
    ketQua: [cauDung, cauDuoiNguong, cauNgoai],
  };

  it("bảy ô; ô đường ống '—' khi tầng tắt (không '0 %'); không khoá thiếu", () => {
    const html = renderToStaticMarkup(createElement(BangKetQuaEval, { luot, chiSai: false }));
    expect(html).not.toContain("‹THIẾU:");
    expect(html).toMatch(/data-testid="eval-o-trung-nguon"[\s\S]*?100 %/);
    expect(html).toMatch(/data-testid="eval-o-qua-nguong"[\s\S]*?50 %/);
    expect(html).toMatch(/data-testid="eval-o-duong-ong"[^>]*>[\s\S]*?—/);
    expect(html).not.toMatch(/data-testid="eval-o-duong-ong"[\s\S]{0,300}0 %/);
    expect(html).toContain('data-so-sai="1"');
    expect(html).toContain('data-cau="N01"');
  });

  it("tầng đường ống BẬT: tài liệu nạp bị bản hệ thống lấn chỗ ⇒ ✗ kèm nhãn 'bản hệ thống', ô 'mọi kho' tách riêng", () => {
    const html = renderToStaticMarkup(
      createElement(BangKetQuaEval, {
        luot: {
          ...luot,
          tangDuongOng: true,
          tongHop: { ...luot.tongHop, duongOng: 0.5, duongOngBatKy: 1 },
          ketQua: [cauDung, { ...cauDung, id: "T03", duongOng: false, duongOngBatKy: true }],
        },
        chiSai: false,
      }),
    );
    expect(html).not.toContain("‹THIẾU:");
    expect(html).toMatch(/data-testid="eval-o-duong-ong"[\s\S]*?50 %/);
    expect(html).toMatch(/data-testid="eval-o-duong-ong-bat-ky"[\s\S]*?100 %/);
    expect((html.match(/data-ban-he-thong/g) ?? []).length).toBe(1);
  });

  it("chỉ câu sai ⇒ chỉ còn T02", () => {
    const html = renderToStaticMarkup(createElement(BangKetQuaEval, { luot, chiSai: true }));
    expect(html).toContain('data-cau="T02"');
    expect(html).not.toContain('data-cau="T01"');
  });

  it("lượt không đo được ⇒ chỉ cảnh báo, KHÔNG có ô số nào", () => {
    const html = renderToStaticMarkup(
      createElement(BangKetQuaEval, { luot: { ...luot, trangThai: "khong-do-duoc", lyDo: "engine vắng", tongHop: null }, chiSai: false }),
    );
    expect(html).toContain('data-testid="eval-khong-do"');
    expect(html).toContain("engine vắng");
    expect(html).not.toContain("eval-o-trung-nguon");
    expect(html).not.toContain("%");
  });

  it("có câu đề hỏng ⇒ cảnh báo đếm đúng", () => {
    const html = renderToStaticMarkup(
      createElement(BangKetQuaEval, { luot: { ...luot, tongHop: { ...luot.tongHop, soCauHong: 2 } }, chiSai: false }),
    );
    expect(html).toContain('data-testid="eval-cau-hong"');
    expect(html).toContain("2 câu có ĐỀ HỎNG");
  });
});
