/**
 * ★★ Đợt 9 (2026-10-21) — TRÍCH mã Structured Text từ câu trả lời của model, cho vòng kiểm biên dịch ở bề mặt tương tác.
 *
 * Luật (dieu-phoi duyệt — "nghi ngờ thì BỎ QUA, đừng đoán"):
 *  • Chỉ lấy khối rào ``` … ```. Câu trả lời không có khối rào ⇒ không có mã ST (kể cả khi chữ trông giống ST).
 *  • Nhãn rào thuộc `NHAN_ST` (st, iecst, iec-st, structured-text, iec61131, iec61131-3, scl) ⇒ lấy; `scl` ⇒ phương ngữ SCL.
 *  • Nhãn rào KHÁC (python, ts, js, c, json, text…) ⇒ KHÔNG lấy, kể cả khi thân trông giống ST.
 *  • Rào KHÔNG nhãn ⇒ lấy chỉ khi thân có cặp POU IEC đầy đủ (FUNCTION_BLOCK|FUNCTION|PROGRAM … END_tương ứng) VÀ không có
 *    dấu hiệu ngôn ngữ khác (`def `, `import `, `=>`, `console.`, `#include`, `public class`, `{` đầu dòng…).
 *  • Phần suy luận `<think>…</think>` bị bỏ trước khi trích.
 * Phương ngữ SCL: nhãn `scl`, hoặc dấu hiệu TIA (`FUNCTION_BLOCK "Ten"` / tham chiếu `#bien`).
 */
import { dauHieuScl } from "./sclSangSt";

export const NHAN_ST: ReadonlySet<string> = new Set(["st", "iecst", "iec-st", "structured-text", "structuredtext", "iec61131", "iec61131-3", "scl"]);

export interface KhoiMaST {
  /** thân khối (không gồm rào) */
  ma: string;
  nhan: string | null;
  laScl: boolean;
  /** vị trí trong câu trả lời GỐC (để thay khối khi cần) */
  batDau: number;
  ketThuc: number;
}

const RE_RAO = /```[ \t]*([A-Za-z0-9_+.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
const RE_POU = /\b(FUNCTION_BLOCK|FUNCTION|PROGRAM)\b[\s\S]*\bEND_(FUNCTION_BLOCK|FUNCTION|PROGRAM)\b/i;
const RE_NGON_NGU_KHAC = /(^|\n)\s*(def |import |from \S+ import|#include|public (static )?(class|void)|using System|package |fn |func |const \w+ = |let \w+ = |console\.|\{\s*$)|=>/;

export function trichMaST(cauTraLoi: string): KhoiMaST[] {
  const chu = (cauTraLoi ?? "").replace(/<think>[\s\S]*?<\/think>/gi, (m) => " ".repeat(m.length));
  const ra: KhoiMaST[] = [];
  for (const m of chu.matchAll(RE_RAO)) {
    const nhan = (m[1] || "").toLowerCase() || null;
    const than = m[2];
    if (nhan !== null && !NHAN_ST.has(nhan)) continue;
    if (nhan === null && (!RE_POU.test(than) || RE_NGON_NGU_KHAC.test(than))) continue;
    if (!than.trim()) continue;
    const dh = dauHieuScl(than);
    ra.push({
      ma: than,
      nhan,
      laScl: nhan === "scl" || dh.tenKhoiNgoacKep || dh.soThamChieuThang > 0,
      batDau: m.index ?? 0,
      ketThuc: (m.index ?? 0) + m[0].length,
    });
  }
  return ra;
}
