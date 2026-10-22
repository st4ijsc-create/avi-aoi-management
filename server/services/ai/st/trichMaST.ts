/**
 * ★★ Đợt 9 (2026-10-21) — TRÍCH mã Structured Text từ câu trả lời của model, cho vòng kiểm biên dịch ở bề mặt tương tác.
 *
 * Luật (dieu-phoi duyệt — "nghi ngờ thì BỎ QUA, đừng đoán"):
 *  • Chỉ lấy khối rào ``` … ```. Câu trả lời không có khối rào ⇒ không có mã ST (kể cả khi chữ trông giống ST).
 *  • Nhãn rào thuộc `NHAN_ST` (st, iecst, iec-st, structured-text, iec61131, iec61131-3, scl) ⇒ lấy; `scl` ⇒ phương ngữ SCL.
 *  • Nhãn rào KHÁC (python, ts, js, c, json, text…) ⇒ KHÔNG lấy, kể cả khi thân trông giống ST.
 *  • Rào KHÔNG nhãn ⇒ lấy chỉ khi thân có cặp POU IEC đầy đủ (FUNCTION_BLOCK|FUNCTION|PROGRAM … END_tương ứng) VÀ không có
 *    dấu hiệu ngôn ngữ khác (`def `, `import `, `=>`, `console.`, `#include`, `public class`, `{` đầu dòng…).
 *  • ★ (2026-10-22, đo: 27B dán nhãn ```pascal cho ~58 % khối ST — 42/71 nhãn trên 60 câu trả lời thật) nhãn GẦN-ST
 *    (`NHAN_GAN_ST`: pascal, iec, plc, …) ⇒ lấy CHỈ khi thân có POU IEC đầy đủ + ít nhất một VAR…END_VAR VÀ KHÔNG có dấu hiệu
 *    Pascal thật (`begin`, `end;`, `procedure`, `unit X;`, `uses`, `program X;`). TÍN HIỆU MẠNH (dieu-phoi duyệt): dòng đánh
 *    dấu tệp `// tệp: x.st|x.scl` trong 3 dòng đầu khối hoặc dòng ngay trước khối ⇒ bỏ qua vế "Pascal thật" (vẫn đòi POU + VAR);
 *    `.scl` ⇒ phương ngữ SCL. Không đánh dấu, có BEGIN (SCL TIA) dưới nhãn pascal ⇒ bỏ qua.
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
  /** ★ (2026-10-22) đường tệp từ dòng đánh dấu `// tệp: …` (trong 3 dòng đầu khối / dòng ngay trước); null = không có. */
  tep: string | null;
  /** vị trí trong câu trả lời GỐC (để thay khối khi cần) */
  batDau: number;
  ketThuc: number;
}

/** Nhãn mà model hay dán nhầm cho ST — chỉ nhận khi thân CHẮC là ST (xem `laStChac`). */
export const NHAN_GAN_ST: ReadonlySet<string> = new Set(["pascal", "iec", "plc", "codesys", "twincat", "iec-61131", "61131"]);
const RE_VAR = /\bVAR(_INPUT|_OUTPUT|_IN_OUT|_TEMP|_GLOBAL|_EXTERNAL)?\b[\s\S]*?\bEND_VAR\b/i;
const RE_PASCAL_THAT = /\bbegin\b|\bend\s*[;.]|(^|\n)\s*(procedure\b|unit\s+\w+\s*;|uses\s|program\s+\w+\s*;)/i;

/** Dòng đánh dấu tệp ST/SCL (`// tệp: src/A.st`, `(* tệp: a.scl *)`, `file: x.st`) — đuôi bắt `st` | `scl`. */
const RE_DANH_DAU_TEP = /^\s*(?:\/\/|\(\*|#|--)?\s*(?:tệp|tep|file|tập tin)\s*[:：]\s*(\S+\.(st|scl))\b/i;

/** Đuôi tệp (`st`/`scl`) nếu khối có dòng đánh dấu trong 3 dòng đầu, hoặc dòng chữ NGAY TRƯỚC rào. */
function duoiDanhDau(than: string, dongTruoc: string): { duoi: "st" | "scl"; tep: string } | null {
  for (const d of [...than.split(/\r?\n/).slice(0, 3), dongTruoc]) {
    const m = RE_DANH_DAU_TEP.exec(d);
    if (m) return { duoi: m[2].toLowerCase() as "st" | "scl", tep: m[1].replace(/\\/g, "/") };
  }
  return null;
}

/**
 * Thân dưới nhãn GẦN-ST là ST chắc chắn: (a) POU IEC đầy đủ + VAR…END_VAR, VÀ (b) không dấu hiệu Pascal thật — trừ khi có
 * dòng đánh dấu tệp .st/.scl (tín hiệu mạnh, thay (b)). Dấu hiệu ngôn ngữ khác (`def`, `=>`, `#include`…) luôn loại.
 */
function laStChac(than: string, danhDau: { duoi: "st" | "scl"; tep: string } | null): boolean {
  return RE_POU.test(than) && RE_VAR.test(than) && (danhDau !== null || !RE_PASCAL_THAT.test(than)) && !RE_NGON_NGU_KHAC.test(than);
}

const RE_RAO = /```[ \t]*([A-Za-z0-9_+.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
const RE_POU = /\b(FUNCTION_BLOCK|FUNCTION|PROGRAM)\b[\s\S]*\bEND_(FUNCTION_BLOCK|FUNCTION|PROGRAM)\b/i;
const RE_NGON_NGU_KHAC = /(^|\n)\s*(def |import |from \S+ import|#include|public (static )?(class|void)|using System|package |fn |func |const \w+ = |let \w+ = |console\.|\{\s*$)|=>\s*[{(]/;
// ⚠ `=>` TRẦN là cú pháp IEC (gán đầu ra khi gọi FB: `ftrig(CLK := x, Q => y)`) — đo 2026-10-22: 2/72 câu trả lời ST thật bị loại
//   vì nó. Chỉ `=> {` / `=> (` (hàm mũi tên JS/TS) mới là dấu hiệu ngôn ngữ khác.

export function trichMaST(cauTraLoi: string): KhoiMaST[] {
  const chu = (cauTraLoi ?? "").replace(/<think>[\s\S]*?<\/think>/gi, (m) => " ".repeat(m.length));
  const ra: KhoiMaST[] = [];
  for (const m of chu.matchAll(RE_RAO)) {
    const nhan = (m[1] || "").toLowerCase() || null;
    const than = m[2];
    const dongTruoc = chu.slice(0, m.index ?? 0).replace(/\s+$/, "").split(/\r?\n/).pop() ?? "";
    const danhDau = duoiDanhDau(than, dongTruoc);
    if (nhan !== null && !NHAN_ST.has(nhan) && !(NHAN_GAN_ST.has(nhan) && laStChac(than, danhDau))) continue;
    if (nhan === null && (!RE_POU.test(than) || RE_NGON_NGU_KHAC.test(than))) continue;
    if (!than.trim()) continue;
    const dh = dauHieuScl(than);
    ra.push({
      ma: than,
      nhan,
      tep: danhDau?.tep ?? null,
      laScl: nhan === "scl" || danhDau?.duoi === "scl" || dh.tenKhoiNgoacKep || dh.soThamChieuThang > 0,
      batDau: m.index ?? 0,
      ketThuc: (m.index ?? 0) + m[0].length,
    });
  }
  return ra;
}
