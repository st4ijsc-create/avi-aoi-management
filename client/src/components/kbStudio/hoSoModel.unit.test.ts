/**
 * R3 — tab Hồ sơ model (`HoSoModelView`), cây thật, `t` tra thật vi.json.
 * ĐỘT BIẾN PHẢI BẮT: server không liên lạc được vẫn vẽ ô model · ngưỡng thừa kế hiện như "đo tại chỗ" ·
 * vắng thư mục báo cáo hiện bảng rỗng/0 % · lệch cấu hình không cảnh báo.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VI = JSON.parse(readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "i18n", "locales", "vi.json"), "utf8"));
function tThat(key: string, a?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : typeof a === "string" ? a : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : undefined) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: tThat, i18n: { language: "vi" } }) }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

const { HoSoModelView } = await import("./ModelBuilderTab");
type HS = Parameters<typeof HoSoModelView>[0]["hs"];
const HS_OK: HS = {
  dangPhucVu: { trangThai: "ok", modelFile: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", ctxMoiSlot: 65536, soSlot: 1, banDung: "b9814-487a6cc16" },
  cauHinh: { modelKhai: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", llamaServerModel: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", ggufMaxCtx: 65536, nganSachNghi: 12000, hoSoSampling: "hien-tai", modelNhung: "Qwen3-Embedding-0.6B-f16.gguf" },
  lech: [],
  hoSoRouter: { label: "Qwen3.6-35B-A3B", provenance: "none", measuredOn: "2026-09-22", thresholdsInheritedFrom: "Qwen3-30B-A3B (MoE)", needsLocalMeasurement: true, latencyPinMs: 700, easyMaxChars: 160, hardMinChars: 700 },
  soDoSong: { luot: 120, loi: 2, coDoNghi: 80, nghiTB: 2100, traTB: 900, treTrungVi: 21000, theoModel: [{ model: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", luot: 100 }] },
  baoCaoDo: [{ truc: "H", nhan: "H-r2b-sau", soLuot: 3, dat: 25, tong: 36, luc: "2026-09-23T06:00:00Z" }],
};
const ve = (hs: HS) => renderToStaticMarkup(createElement(HoSoModelView, { hs }));

describe("HoSoModelView", () => {
  it("đủ nguồn: model thật, ngưỡng THỪA KẾ nói rõ + cảnh báo cần đo, báo cáo có % ; không khoá thiếu", () => {
    const h = ve(HS_OK);
    expect(h).not.toContain("‹THIẾU:");
    expect(h).toMatch(/data-testid="hoso-model-that"[\s\S]*?Qwen3\.6-35B-A3B-UD-Q4_K_XL\.gguf/);
    expect(h).toMatch(/data-testid="hoso-router-nguon"[\s\S]*?THỪA KẾ từ Qwen3-30B-A3B/);
    expect(h).toContain("KHÔNG rút từ phép đo của model đang chạy");
    expect(h).toContain("25/36 = 69 %");
    expect(h).not.toContain('data-testid="hoso-lech"');
  });

  it("server không liên lạc được ⇒ câu trạng thái, KHÔNG vẽ ô model", () => {
    const h = ve({ ...HS_OK, dangPhucVu: { trangThai: "khong-lien-lac", lyDo: "timeout" } });
    expect(h).toContain('data-testid="hoso-khong-lien-lac"');
    expect(h).toContain("timeout");
    expect(h).not.toContain('data-testid="hoso-model-that"');
  });

  it("vắng thư mục báo cáo ⇒ nói rõ 'không phải 0 %', không bảng; lệch cấu hình ⇒ cảnh báo từng mã", () => {
    const h = ve({ ...HS_OK, baoCaoDo: null, lech: ["llama-server-model-lech", "ctx-slot-nho-hon-tran"] });
    expect(h).toContain('data-testid="hoso-khong-bao-cao"');
    expect(h).not.toContain('data-testid="hoso-bang-bao-cao"');
    expect(h).toContain('data-testid="hoso-lech"');
    expect((h.match(/<li>/g) ?? []).length).toBe(2);
    expect(h).not.toContain("‹THIẾU:");
  });
});
