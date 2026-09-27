/**
 * doc 80 Đợt 1 Task 7 — hợp đồng chẩn đoán ST ↔ i18n.
 *
 * UI dịch chẩn đoán qua `engineering.stDiag.<code>` với `params` làm biến nội suy. Hai cách hỏng
 * im lặng mà test này bắt: (1) một mã parser phát ra nhưng thiếu khoá ở vi/en/zh ⇒ i18next trả
 * `defaultValue` tiếng Anh cho người dùng Việt/Trung; (2) bản dịch dùng `{{x}}` mà chẩn đoán không
 * gửi `x` ⇒ người dùng đọc nguyên "{{x}}".
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { checkStructuredText, type StDiagnostic } from "./stParser";

const ROOT = path.resolve(__dirname, "../../../..");
const LOCALES = ["vi", "en", "zh"].map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, "client/src/i18n/locales", `${l}.json`), "utf8"))] as const);
const keyOf = (loc: any, code: string): string | undefined => loc?.engineering?.stDiag?.[code];

// Mọi mã khai báo trong union `StDiagCode` (đọc từ nguồn — thêm mã mới mà quên khoá là đỏ).
const SRC = readFileSync(path.join(__dirname, "stParser.ts"), "utf8");
const UNION = /export type StDiagCode =([\s\S]*?);/.exec(SRC)![1];
const ALL_CODES = [...UNION.matchAll(/"(st[A-Za-z]+)"/g)].map((m) => m[1]);

describe("ST diagnostics ↔ i18n", () => {
  it("mọi mã trong StDiagCode có khoá engineering.stDiag.<code> ở cả vi/en/zh", () => {
    expect(ALL_CODES.length).toBeGreaterThanOrEqual(20);
    const missing: string[] = [];
    for (const [l, loc] of LOCALES) for (const c of ALL_CODES) if (!keyOf(loc, c)) missing.push(`${l}:${c}`);
    expect(missing).toEqual([]);
  });

  it("mọi {{biến}} của bản dịch đều có trong params của chẩn đoán THẬT mà parser phát ra", () => {
    const dir = path.join(__dirname, "golden-st");
    const sources: string[] = [];
    for (const sub of ["valid", "invalid"]) for (const f of readdirSync(path.join(dir, sub))) sources.push(readFileSync(path.join(dir, sub, f), "utf8"));
    // thêm vài ca phát ra các mã không có trong bộ vàng
    sources.push(
      "PROGRAM P\nVAR x : MC_Power; END_VAR\nEND_PROGRAM",                       // stUnknownType + stNoAssignment
      "METHOD M\nEND_METHOD",                                                // stUnsupported
      "CONFIGURATION C\nEND_CONFIGURATION\nPROGRAM P VAR a : INT; END_VAR a := 1; END_PROGRAM", // stUnchecked
      "PROGRAM P\nVAR t : TON; x : BOOL; END_VAR\nTON(IN := x);\nt(IN := x, Q => x, QQ => x);\nx(1);\nEND_PROGRAM", // stFbTypeCall, stBadOutput, stNotCallable
      "PROGRAM P\nVAR a : ; END_VAR\nEND_PROGRAM",                           // stExpectedType
      "PROGRAM P\nVAR a : INT; END_VAR\na := 5 $ 3;\nEND_PROGRAM",           // stUnexpectedChar
      "PROGRAM P\nVAR a : INT; END_VAR\na := 16#;\nEND_PROGRAM",             // stBadLiteral numeric
      "   (* chỉ chú thích *)   ",                                            // stEmpty
      "{ pragma never closed",                                               // stUnterminatedComment (pragma)
    );
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const s of sources) {
      for (const d of checkStructuredText(s).diagnostics as StDiagnostic[]) {
        seen.add(d.code);
        for (const [l, loc] of LOCALES) {
          const tpl = keyOf(loc, d.code);
          if (!tpl) { problems.push(`${l}:${d.code} thiếu khoá`); continue; }
          for (const m of tpl.matchAll(/\{\{(\w+)\}\}/g)) {
            if (!d.params || !(m[1] in d.params)) problems.push(`${l}:${d.code} cần {{${m[1]}}} nhưng params=${JSON.stringify(d.params)}`);
          }
        }
      }
    }
    expect([...new Set(problems)]).toEqual([]);
    // Phủ: mọi mã trừ stNoAssignment (mã đó do ADAPTER gắn, không phải parser) đều đã thật sự được phát ra.
    const notSeen = ALL_CODES.filter((c) => !seen.has(c) && c !== "stNoAssignment");
    expect(notSeen).toEqual([]);
  });
});
