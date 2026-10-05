/**
 * doc 81 Đợt 3 Task 0 (O3, browser check 2026-10-05) — CENSUS: chuỗi người dùng đọc trên đường Copilot
 * lập trình (IDE / IR / POU — cùng một panel, cùng `POST /api/ai/programming-copilot/stream` và
 * `programming.copilotGenerate`) KHÔNG được nêu tên biến môi trường.
 *
 * Đo trước: panel hiện nguyên "AI_PROGRAMMING_COPILOT_ENABLED is off." (tiếng Anh + tên biến). Lưới
 * `client/src/i18n/deployPreviewKhongTenBienMoiTruong.unit.test.ts` chỉ canh khối
 * `engineering.deployPreview`; lớp lỗi này trên Copilot chưa ai canh.
 *
 * Final wave (doc 81 Đợt 3, Task 0 minor 1 + M-2) — MỞ RỘNG, không nới:
 *  - tệp: + `server/routers/programmingRouter.ts` (copilotSuggest/Explain/Generate/Complete) và
 *    `server/services/programming/programmingService.ts` (đường deploy — ghi chú `detail.reason` của hàng SIMULATED);
 *  - ô: + `message` / `error`;
 *  - biểu thức: MỌI literal của biểu thức gán cho ô (kể cả ternary / nối chuỗi `+` trải nhiều dòng), template literal
 *    bỏ phần `${…}` (tên định danh nội suy không phải chữ người dùng đọc); dừng ở thuộc tính kế tiếp (`, code: "X_Y"`
 *    không bị đếm nhầm vào `error:`).
 *
 * Ba phần, mỗi phần có cầu chì để không xanh trên tập rỗng:
 *  1. NGUỒN — trong các tệp trên, không literal nào gán cho một ô hiển thị
 *     (`note` / `reason` / `summary` / `userMessage` / `message` / `error`) mang hình dạng tên biến môi trường.
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
/** Đầu một phép gán cho ô hiển thị: `note:` … (không khớp `noteKey:`, `errorCode:` — ranh giới từ hai phía). */
const O_HIEN_THI = /\b(note|reason|summary|userMessage|message|error)\s*:(?!:)/g;
/** Literal chuỗi (", ', `) — không vượt dòng với "/'; backtick trong phạm vi đoạn đã ghép. */
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
/** Thuộc tính kế tiếp ở cùng cấp: `, ten:` — đoạn biểu thức của ô dừng tại đây. */
const THUOC_TINH_KE = /,\s*[A-Za-z_$][\w$]*\s*:/;

const TEP_DUONG_COPILOT = [
  "server/services/programming/aiProgrammingCopilot.ts",
  "server/services/programming/copilotStream.ts",
  "server/services/programming/copilotSafetyGate.ts",
  "server/routes/programmingCopilotStream.ts",
  // Final wave — router của các thủ tục Copilot + đường deploy (ghi chú của hàng SIMULATED).
  "server/routers/programmingRouter.ts",
  "server/services/programming/programmingService.ts",
];
const LOCALES = ["vi", "en", "zh"] as const;

function docLocale(l: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(GOC, "client/src/i18n/locales", `${l}.json`), "utf8")) as Record<string, unknown>;
}

function moiGiaTri(o: unknown, duong: string, ra: Array<[string, string]>): void {
  if (typeof o === "string") ra.push([duong, o]);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) moiGiaTri(v, `${duong}.${k}`, ra);
}

const laChuThich = (t: string) => t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");

/** Đoạn biểu thức của ô bắt đầu ở `tu` trên dòng `i`, ghép dòng nối tiếp (`+` / `?` / `:` / `(` cuối dòng hoặc đầu dòng sau). */
function doanBieuThuc(dong: string[], i: number, tu: number): string {
  let doan = dong[i].slice(tu);
  let j = i;
  while (j + 1 < dong.length && j - i < 6) {
    const cuoi = doan.trimEnd();
    const sau = dong[j + 1].trim();
    if (laChuThich(sau)) break;
    if (/[+?:(]$/.test(cuoi) || /^[+?:]/.test(sau) || (cuoi.endsWith(":") && sau !== "")) {
      doan += "\n" + dong[j + 1];
      j++;
    } else break;
  }
  const cat = doan.search(THUOC_TINH_KE);
  return cat >= 0 ? doan.slice(0, cat) : doan;
}

function viPhamNguon(text: string, tep: string): string[] {
  const ra: string[] = [];
  const dong = text.split(/\r?\n/);
  dong.forEach((d, i) => {
    if (laChuThich(d.trim())) return;
    for (const m of d.matchAll(O_HIEN_THI)) {
      const doan = doanBieuThuc(dong, i, (m.index ?? 0) + m[0].length);
      for (const lit of doan.matchAll(LITERAL)) {
        const noiDung = lit[1] === "`" ? lit[2].replace(/\$\{[^}]*\}/g, "") : lit[2];
        if (TEN_BIEN_MOI_TRUONG.test(noiDung)) {
          ra.push(`${tep}:${i + 1}: ${m[1]}: ${JSON.stringify(lit[0].slice(0, 90))}`);
          break;
        }
      }
    }
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
  it("1. nguồn đường Copilot + deploy: không literal note/reason/summary/userMessage/message/error nêu tên biến môi trường", () => {
    const viPham = TEP_DUONG_COPILOT.flatMap((tep) => viPhamNguon(readFileSync(resolve(GOC, tep), "utf8"), tep));
    expect(viPham, `còn tên biến môi trường:\n${viPham.join("\n")}`).toEqual([]);
  });

  it("1b. cầu chì tập đo: mỗi tệp có ≥1 phép gán ô hiển thị được quét (không xanh vì tệp rỗng / đổi tên)", () => {
    for (const tep of TEP_DUONG_COPILOT) {
      const src = readFileSync(resolve(GOC, tep), "utf8");
      const n = src.split(/\r?\n/).filter((d) => !laChuThich(d.trim()) && /\b(note|reason|summary|userMessage|message|error)\s*:(?!:)/.test(d)).length;
      expect(n, tep).toBeGreaterThan(0);
    }
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
      // Final wave — ô message / error; nối chuỗi; template có nội suy MÀ phần chữ vẫn nêu tên biến
      `      message: "Copilot is off (AI_PROGRAMMING_COPILOT_ENABLED)",`,
      `    return { ok: false, error: "Deploy blocked: " + "DPC_DEPLOY_ENABLED is off" };`,
      `      error: \`\${who} — set DPC_DEPLOY_ENABLED=true\`,`,
    ];
    for (const d of cu) expect(viPhamNguon(d, "x"), d).toHaveLength(1);
    // Final wave — ternary trải nhiều dòng (đúng hình dạng programmingService.ts trước khi sửa)
    const ternary = [
      `      detail: {`,
      `        reason: !dpcDeployEnabled()`,
      `          ? "DPC_DEPLOY_ENABLED is off (default) — recorded as simulated."`,
      `          : "No HITL sign-off (confirmedBy) — recorded as simulated.",`,
      `      },`,
    ].join("\n");
    expect(viPhamNguon(ternary, "x")).toHaveLength(1);
    const khong = [
      ` * Flag: AI_PROGRAMMING_COPILOT_ENABLED`,
      `    process.env.AI_PROGRAMMING_COPILOT_ENABLED === "true" ||`,
      `      code: "SAFETY_REFUSED",`,
      `    return { ok: false, refused: false, kind, errorCode: "DISABLED", note: cauLoiCopilot("DISABLED", lang) };`,
      `      note: "The model returned no code.",`,
      // Final wave — thuộc tính kế tiếp không bị đếm vào ô trước; tên định danh nội suy không phải chữ hiển thị
      `    res.status(403).json({ success: false, error: "Forbidden", code: "PERMISSION_DENIED" });`,
      `      error: \`Module "\${MODULE_COPILOT}" chưa được cấp phép cho hệ thống này.\`,`,
      `        reasonCode: "DEPLOY_GATE_OFF",`,
    ];
    for (const d of khong) expect(viPhamNguon(d, "x"), d).toHaveLength(0);
  });
});
