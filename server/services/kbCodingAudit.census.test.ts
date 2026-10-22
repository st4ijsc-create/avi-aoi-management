/**
 * ★★ Đợt 9 — CENSUS TĨNH: mọi lời gọi SINH CHỮ của đường KB coding / agent phải để lại dấu vết (`ai_gateway_metrics` + `ai_llm_audit`).
 *
 * Hình dạng ĐẢO CHIỀU, cùng khuôn `TASK_AUDIT_POLICY`: tệp nào gọi engine sinh chữ (`generateText[Stream]` · `generateJSON` ·
 * `chatCompletion[Stream]` lấy từ `aiGgufEngine`) mà KHÔNG đi qua cổng (`planInference` / `routeInference`), KHÔNG qua một lớp bọc đã qua
 * cổng (`streamCodingModel`) và KHÔNG dùng helper chỉ-ghi (`ghiLuotNgoaiCong`) ⇒ ĐỎ — trừ khi nằm trong danh sách MIỄN dưới đây,
 * mỗi mục có LÝ DO. Thêm một đường sinh chữ mới mà quên dấu vết ⇒ lưới đỏ đúng chỗ (mặc định của đường mới là GHI, không phải im lặng).
 * (Embedding / kiểm "có model không" — `isGgufAvailable`, `generateEmbedding` — không phải sinh chữ nên không thuộc lưới này.)
 *
 * ⚠ Cố ý đọc MÃ NGUỒN (kiểu TS bị xoá lúc chạy). Cùng họ với `aiLocalKnowledgeApi.sseCensus.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const GOC = process.cwd();

/** Thư mục / tệp thuộc đường KB coding + agent + công cụ cục bộ (tương đối từ gốc repo). */
const PHAM_VI: { dir: string; chiTep?: RegExp }[] = [
  { dir: "server/services", chiTep: /^(aiLocalKnowledge[A-Za-z]*|aiCodingAgent|aiAgentPlanner)\.ts$/ },
  { dir: "server/services/aiCodingCli" },
  { dir: "server/services/aiLocalTools" },
  { dir: "server/services/ai" },
];

/** MIỄN có lý do. Khoá = đường tệp tương đối. */
const MIEN: Record<string, string> = {
  // (trống: aiAgentPlanner đã đi qua `planInference` — không cần miễn. Ghi chú: nếu sau này planner bị đưa ra ngoài cổng thì
  //  khai ở đây với lý do "chờ việc đưa agent qua cổng", KHÔNG thêm im lặng.)
};

const TEN_SINH_CHU = /\b(generateTextStream|generateText|generateJSON|chatCompletionStream|chatCompletion)\b/;
const DAU_VET = /\b(planInference|routeInference|ghiLuotNgoaiCong|streamCodingModel)\s*(<[^()]*>)?\s*\(/;

function bocChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

function lietKe(dir: string, chiTep?: RegExp): string[] {
  const abs = resolve(GOC, dir);
  const out: string[] = [];
  for (const ten of readdirSync(abs)) {
    const p = resolve(abs, ten);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!chiTep) out.push(...lietKe(`${dir}/${ten}`, chiTep));
      continue;
    }
    if (!/\.ts$/.test(ten) || /\.(test|spec|d)\.ts$/.test(ten) || /^__/.test(ten)) continue;
    if (chiTep && !chiTep.test(ten)) continue;
    out.push(p);
  }
  return out;
}

/** Tệp có LẤY hàm sinh chữ từ `aiGgufEngine` (import tĩnh hoặc `await import(...)`) — nhìn 500 ký tự đứng trước tên module. */
function goiEngineSinhChu(src: string): boolean {
  const code = bocChuThich(src);
  for (const m of code.matchAll(/aiGgufEngine"/g)) {
    const truoc = code.slice(Math.max(0, (m.index ?? 0) - 500), m.index);
    // chỉ xét câu lệnh chứa nó: từ `import`/`const` gần nhất
    const cau = truoc.slice(Math.max(truoc.lastIndexOf("import "), truoc.lastIndexOf("const {"), truoc.lastIndexOf("const{")));
    if (TEN_SINH_CHU.test(cau)) return true;
    // dạng truy cập thuộc tính: `(await import("…aiGgufEngine")).chatCompletionStream`
    const sau = code.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 24);
    if (new RegExp("^\\s*\\)\\s*\\)\\s*\\.\\s*" + TEN_SINH_CHU.source).test(sau)) return true;
  }
  return false;
}

const tepTrongPhamVi = (): string[] => [...new Set(PHAM_VI.flatMap((p) => lietKe(p.dir, p.chiTep)))].sort();

describe("census — mọi lời gọi sinh chữ của đường KB coding / agent đều để lại dấu vết", () => {
  it("phạm vi quét không rỗng và có mặt các điểm gọi đã biết (bắt census mù vì glob rỗng)", () => {
    const ds = tepTrongPhamVi().map((p) => relative(GOC, p).replace(/\\/g, "/"));
    expect(ds.length).toBeGreaterThan(40);
    for (const k of ["server/services/aiCodingAgent.ts", "server/services/ai/agent/goiModelMayChu.ts", "server/services/ai/phuQuyetToolNative.ts"]) expect(ds).toContain(k);
  });

  it("tệp gọi engine sinh chữ ⇒ phải có cổng / lớp bọc đã qua cổng / ghiLuotNgoaiCong (hoặc miễn có lý do)", () => {
    const vi: string[] = [];
    const daThay: string[] = [];
    for (const p of tepTrongPhamVi()) {
      const rel = relative(GOC, p).replace(/\\/g, "/");
      const src = readFileSync(p, "utf8");
      if (!goiEngineSinhChu(src)) continue;
      daThay.push(rel);
      if (MIEN[rel]) continue;
      if (!DAU_VET.test(bocChuThich(src))) vi.push(rel);
    }
    // các điểm gọi engine đã biết PHẢI được lưới nhìn thấy (nếu một lần refactor làm bộ dò mù, ca này đỏ)
    for (const k of ["server/services/aiCodingAgent.ts", "server/services/ai/agent/goiModelMayChu.ts", "server/services/ai/phuQuyetToolNative.ts"]) {
      expect(daThay, `bộ dò không còn thấy lời gọi engine ở ${k}`).toContain(k);
    }
    expect(vi, `tệp gọi engine sinh chữ NGOÀI cổng mà không để lại dấu vết:\n${vi.join("\n")}`).toEqual([]);
  });

  it("mọi mục miễn còn đúng (tệp tồn tại, có lý do) — không để miễn mồ côi", () => {
    for (const [rel, lyDo] of Object.entries(MIEN)) {
      expect(lyDo.length, `miễn ${rel} thiếu lý do`).toBeGreaterThan(10);
      expect(() => statSync(resolve(GOC, rel))).not.toThrow();
    }
  });

  it("đột biến: bộ dò BẮT một tệp giả gọi engine không dấu vết, và THA tệp đi qua cổng", () => {
    const xau = 'const { generateText } = await import("./aiGgufEngine");\nawait generateText({});';
    const tot = xau + '\nconst plan = await planInference({ task: "chat", text: "" });';
    expect(goiEngineSinhChu(xau) && !DAU_VET.test(bocChuThich(xau))).toBe(true);
    expect(goiEngineSinhChu(tot) && !DAU_VET.test(bocChuThich(tot))).toBe(false);
    // dạng truy cập thuộc tính (đường agent)
    expect(goiEngineSinhChu('const f = (await import("../../aiGgufEngine")).chatCompletionStream;')).toBe(true);
    // chỉ nhắc tên trong chú thích ⇒ không tính
    expect(goiEngineSinhChu('// const { generateText } = await import("./aiGgufEngine");')).toBe(false);
    // import engine nhưng KHÔNG lấy hàm sinh chữ (vd. isGgufAvailable) ⇒ không thuộc lưới
    expect(goiEngineSinhChu('const { isGgufAvailable } = await import("./aiGgufEngine");')).toBe(false);
  });
});
