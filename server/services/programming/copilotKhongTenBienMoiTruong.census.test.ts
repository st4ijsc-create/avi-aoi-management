/**
 * doc 81 Đợt 3 Task 0 (O3, browser check 2026-10-05) — CENSUS: chuỗi người dùng đọc trên đường Copilot
 * lập trình (IDE / IR / POU — cùng một panel, cùng `POST /api/ai/programming-copilot/stream` và
 * `programming.copilotGenerate`) KHÔNG được nêu tên biến môi trường.
 *
 * Đo trước: panel hiện nguyên "AI_PROGRAMMING_COPILOT_ENABLED is off." (tiếng Anh + tên biến). Lưới
 * `client/src/i18n/deployPreviewKhongTenBienMoiTruong.unit.test.ts` chỉ canh khối
 * `engineering.deployPreview`; lớp lỗi này trên Copilot chưa ai canh.
 *
 * Ba phần, mỗi phần có cầu chì để không xanh trên tập rỗng:
 *  1. NGUỒN — trong các tệp của đường Copilot, không literal nào gán cho một ô hiển thị
 *     (`note` / `reason` / `summary` / `userMessage`) mang hình dạng tên biến môi trường.
 *  2. MÃ — mọi `CopilotErrorCode` (đọc từ union trong nguồn, không import sản phẩm) có khoá
 *     `progCopilot.error.<MÃ>` ở cả vi/en/zh (thiếu ⇒ panel rơi về câu server, mất i18n).
 *  3. LOCALE — mọi GIÁ TRỊ của khối `progCopilot` (đệ quy) ở vi/en/zh không mang tên biến.
 *     (Khoá như `MODEL_OFFLINE` là KHOÁ, không phải giá trị ⇒ không bị đếm.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOC = resolve(__dirname, "..", "..", "..");
const TEN_BIEN_MOI_TRUONG = /[A-Z][A-Z0-9]+_[A-Z0-9_]+/;
/** Literal (", ', `) gán cho ô hiển thị và chứa hình dạng tên biến môi trường. */
const GAN_HIEN_THI_CO_TEN_BIEN = /\b(note|reason|summary|userMessage)\s*:\s*(["'`])((?:(?!\2).)*[A-Z][A-Z0-9]+_[A-Z0-9_]+(?:(?!\2).)*)\2/;

const TEP_DUONG_COPILOT = [
  "server/services/programming/aiProgrammingCopilot.ts",
  "server/services/programming/copilotStream.ts",
  "server/services/programming/copilotSafetyGate.ts",
  "server/routes/programmingCopilotStream.ts",
];
const LOCALES = ["vi", "en", "zh"] as const;

function docLocale(l: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(GOC, "client/src/i18n/locales", `${l}.json`), "utf8")) as Record<string, unknown>;
}

function moiGiaTri(o: unknown, duong: string, ra: Array<[string, string]>): void {
  if (typeof o === "string") ra.push([duong, o]);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) moiGiaTri(v, `${duong}.${k}`, ra);
}

function viPhamNguon(text: string, tep: string): string[] {
  const ra: string[] = [];
  text.split(/\r?\n/).forEach((dong, i) => {
    const t = dong.trim();
    if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) return; // chú thích
    if (GAN_HIEN_THI_CO_TEN_BIEN.test(dong)) ra.push(`${tep}:${i + 1}: ${t}`);
  });
  return ra;
}

function maLoiCopilot(): string[] {
  const src = readFileSync(resolve(GOC, "server/services/programming/aiProgrammingCopilot.ts"), "utf8");
  const m = src.match(/export\s+(?:type\s+CopilotErrorCode\s*=([^;]+);|const\s+COPILOT_ERROR_CODES\s*=\s*\[([^\]]+)\])/);
  if (!m) throw new Error("không thấy định nghĩa CopilotErrorCode — đổi tên? cập nhật lưới theo thủ tục");
  return [...(m[1] ?? m[2]).matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
}

describe("Copilot lập trình — không tên biến môi trường trong chuỗi cho người dùng", () => {
  it("1. nguồn đường Copilot: không literal note/reason/summary/userMessage nêu tên biến môi trường", () => {
    const viPham = TEP_DUONG_COPILOT.flatMap((tep) => viPhamNguon(readFileSync(resolve(GOC, tep), "utf8"), tep));
    expect(viPham, `còn tên biến môi trường:\n${viPham.join("\n")}`).toEqual([]);
  });

  it("2. mọi CopilotErrorCode có progCopilot.error.<MÃ> ở vi/en/zh", () => {
    const ma = maLoiCopilot();
    expect(ma.length).toBeGreaterThanOrEqual(6); // cầu chì: phải đọc được union
    expect(ma).toContain("DISABLED");
    const thieu: string[] = [];
    for (const l of LOCALES) {
      const err = ((docLocale(l).progCopilot as Record<string, unknown> | undefined)?.error ?? {}) as Record<string, unknown>;
      for (const c of ma) if (typeof err[c] !== "string" || !String(err[c]).trim()) thieu.push(`${l}: progCopilot.error.${c}`);
    }
    expect(thieu).toEqual([]);
  });

  for (const l of LOCALES) {
    it(`3. ${l}: mọi giá trị progCopilot.* KHÔNG khớp /[A-Z][A-Z0-9]+_[A-Z0-9_]+/`, () => {
      const ra: Array<[string, string]> = [];
      moiGiaTri(docLocale(l).progCopilot, "progCopilot", ra);
      expect(ra.length).toBeGreaterThan(40); // cầu chì: phải thấy khối
      const viPham = ra.filter(([, v]) => TEN_BIEN_MOI_TRUONG.test(v)).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
      expect(viPham, `${l}.json còn tên biến môi trường:\n${viPham.join("\n")}`).toEqual([]);
    });
  }

  it("cầu chì: biểu thức nguồn bắt đúng dòng lỗi cũ, bỏ qua chú thích / mã / câu thường", () => {
    const cu = [
      `    return { ok: false, refused: false, kind, note: "AI_PROGRAMMING_COPILOT_ENABLED is off." };`,
      `  if (!copilotEnabled()) return { available: false, refused: false, reason: "AI_PROGRAMMING_COPILOT_ENABLED is off." };`,
      `  return { available: false, summary: \`DPC_DEPLOY_ENABLED off\`, metrics: {} };`,
      `      userMessage: 'set URSIM_HOST first',`,
    ];
    for (const d of cu) expect(viPhamNguon(d, "x"), d).toHaveLength(1);
    const khong = [
      ` * Flag: AI_PROGRAMMING_COPILOT_ENABLED`,
      `    process.env.AI_PROGRAMMING_COPILOT_ENABLED === "true" ||`,
      `      code: "SAFETY_REFUSED",`,
      `    return { ok: false, refused: false, kind, errorCode: "DISABLED", note: cauLoiCopilot("DISABLED", lang) };`,
      `      note: "The model returned no code.",`,
    ];
    for (const d of khong) expect(viPhamNguon(d, "x"), d).toHaveLength(0);
  });
});
