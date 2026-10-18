/**
 * MultiPL-E — chuẩn hoá hàng dữ liệu + GHÉP chương trình để chạy.
 *
 * Hai chế độ:
 *   hoan-thanh  giao thức GỐC của MultiPL-E: chương trình = prompt + phần hoàn thành (cắt ở stop token) + tests.
 *   chat        model chat trả TOÀN BỘ hàm (có thể kèm hàm phụ/ import) trong khối mã; bộ ghép đặt mã ấy vào khung
 *               ngôn ngữ (import/using của prompt, lớp `Problem` cho Java/C#) rồi nối tests. Hàm `main` model tự viết
 *               bị bỏ (tests có main riêng). Đây là cách KHÁC giao thức gốc ⇒ số chat KHÔNG so thẳng với bảng công bố.
 *
 * Bù khác biệt nền tảng (ghi rõ, áp cho MỌI lời giải như nhau):
 *   • C++/MSVC: `long` 32 bit trên Windows (LP64 trên Linux nơi MultiPL-E được thiết kế) ⇒ viết lại `long` đơn lẻ
 *     thành `long long`; `<bits/stdc++.h>` (GCC) ⇒ header thay thế gộp mọi header chuẩn (xem chay.mjs).
 */
import fs from "node:fs";

export const NGON_NGU_MPE = ["py", "cpp", "cs", "go", "java", "js", "rs", "ts"];
const STOP_PY = ["\ndef ", "\nclass ", "\nif __name__", "\nprint(", "\n#"];

/** Đọc một tệp jsonl đã tải ⇒ hàng chuẩn hoá {name, lang, bo, prompt, tests, stop}. */
export function docBo(duLieu, bo, lang) {
  const tep = `${duLieu}/${bo}-${lang}.jsonl`;
  if (!fs.existsSync(tep)) return [];
  return fs.readFileSync(tep, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r) => {
    if (lang === "py") {
      const name = `${r.task_id.replace("/", "_")}_${r.entry_point}`;
      return { name, lang, bo, prompt: r.prompt, tests: `${r.test}\n\ncheck(${r.entry_point})\n`, stop: STOP_PY, canonical: r.canonical_solution };
    }
    return { name: r.name, lang, bo, prompt: r.prompt, tests: r.tests, stop: r.stop_tokens };
  });
}

/** Tên hàm cần viết — từ dòng chữ ký cuối của prompt. */
export function tenHam(row) {
  const p = row.prompt.trimEnd();
  const re = { py: /def\s+(\w+)\s*\(/g, js: /function\s+(\w+)\s*\(/g, ts: /function\s+(\w+)\s*[<(]/g, go: /func\s+(\w+)\s*\(/g,
    rs: /fn\s+(\w+)\s*[<(]/g }[row.lang] ?? /(\w+)\s*\([^()]*\)\s*\{/g;
  const ds = [...p.matchAll(re)];
  return ds.length ? ds[ds.length - 1][1] : null;
}

// ── quét ngoặc nhọn bỏ qua chuỗi/ký tự/chú thích ──────────────────────────────────────────────────────
function boQua(code, i, lang) {
  const c = code[i], n = code[i + 1];
  if (c === "/" && n === "/") { const j = code.indexOf("\n", i); return j < 0 ? code.length : j; }
  if (c === "/" && n === "*") { const j = code.indexOf("*/", i + 2); return j < 0 ? code.length : j + 2; }
  if (c === '"' || (c === "`" && (lang === "go" || lang === "js" || lang === "ts"))) {
    if (c === '"' && lang === "cs" && code[i - 1] === "@") { // chuỗi nguyên văn C#
      let j = i + 1;
      while (j < code.length) { if (code[j] === '"' && code[j + 1] === '"') j += 2; else if (code[j] === '"') return j + 1; else j++; }
      return code.length;
    }
    let j = i + 1;
    while (j < code.length && code[j] !== c) j += code[j] === "\\" && c !== "`" ? 2 : 1;
    return j + 1;
  }
  if (c === "'") {
    if (lang === "rs" && !/^'(\\.[^']*|[^\\'])'/.test(code.slice(i, i + 12))) return i + 1; // lifetime 'a
    let j = i + 1;
    while (j < code.length && code[j] !== "'") j += code[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  return -1;
}

/** Chỉ số dấu `}` khớp với `{` ở vị trí `mo` (hoặc -1). */
export function timDong(code, mo, lang) {
  let sau = 0;
  for (let i = mo; i < code.length;) {
    const b = boQua(code, i, lang);
    if (b >= 0) { i = b; continue; }
    if (code[i] === "{") sau++;
    else if (code[i] === "}") { sau--; if (sau === 0) return i; }
    i++;
  }
  return -1;
}

/** [đầu, cuối) của định nghĩa hàm khớp `reChuKy` (đầu = đầu dòng chữ ký; cuối = sau `}`). */
function timHam(code, reChuKy, lang) {
  const m = reChuKy.exec(code);
  if (!m) return null;
  const mo = code.indexOf("{", m.index + m[0].length - 1);
  if (mo < 0) return null;
  const dong = timDong(code, mo, lang);
  if (dong < 0) return null;
  const dau = code.lastIndexOf("\n", m.index) + 1;
  return [dau, dong + 1];
}

function boHam(code, reChuKy, lang) {
  const r = timHam(code, reChuKy, lang);
  return r ? code.slice(0, r[0]) + code.slice(r[1]) : code;
}

/** Bỏ dòng `}` đầu tiên của tests (đóng hàm của prompt) — khi đã thay cả hàm bằng mã model. */
const boNgoacDauTests = (tests) => tests.replace(/^\s*\}[ \t]*\r?\n/, "");

/** Khối mã của câu trả lời chat (bỏ <think>): ưu tiên khối chứa tên hàm, dài nhất; không rào ⇒ cả văn bản. */
export function khoiMaChat(text, ten) {
  const s = String(text ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "");
  const ds = [...s.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (!ds.length) return s.trim();
  const co = ten ? ds.filter((d) => new RegExp(`\\b${ten}\\b`).test(d)) : [];
  return (co.length ? co : ds).sort((a, b) => b.length - a.length)[0];
}

/** C++/MSVC: `long` đơn lẻ ⇒ `long long` (không đụng `long long`, `long double`). */
export function vaLongCpp(src) {
  return src.replace(/\blong(\s+long|\s+double)?\b/g, (m, sau) => (sau ? m : "long long"));
}

export function ghepHoanThanh(row, hoanThanh) {
  const prog = `${row.prompt}${hoanThanh}\n${row.tests}`;
  return row.lang === "cpp" ? vaLongCpp(prog) : prog;
}

export function ghepChat(row, code) {
  const ten = tenHam(row);
  switch (row.lang) {
    case "py":
      // Hàm của prompt (có docstring) + `pass` được ĐỊNH NGHĨA LẠI bởi mã model — giữ import của prompt.
      return `${row.prompt}    pass\n\n${code}\n\n${row.tests}`;
    case "js":
    case "ts":
      return `${code}\n\n${row.tests}`;
    case "go": {
      const pkg = row.prompt.match(/^package\s+\w+/m)[0];
      // Import CHỈ lấy từ khối import (chú thích ví dụ của prompt có chuỗi `strlen("")` — đừng quét cả prompt).
      const imp = new Set();
      const layImport = (src) => src
        .replace(/^\s*import\s*\(([\s\S]*?)\)/m, (_, k) => { for (const m of k.matchAll(/"([^"]+)"/g)) imp.add(m[1]); return ""; })
        .replace(/^\s*import\s+(?:\w+\s+)?"([^"]+)"\s*$/gm, (_, k) => { imp.add(k); return ""; });
      layImport(row.prompt);
      let than = layImport(code.replace(/^\s*package\s+\w+\s*$/m, ""));
      than = boHam(than, /func\s+main\s*\(\s*\)/, "go");
      return `${pkg}\n\nimport (\n${[...imp].map((x) => `\t"${x}"`).join("\n")}\n)\n\n${than}\n\n${row.tests}`;
    }
    case "cpp": {
      const dau = row.prompt.split("\n").filter((l) => /^\s*(#include|using\s+namespace)/.test(l)).join("\n");
      const than = boHam(code, /\bint\s+main\s*\([^)]*\)/, "cpp");
      return vaLongCpp(`${dau}\n${than}\n${boNgoacDauTests(row.tests)}`);
    }
    case "rs": {
      const than = boHam(code, /\bfn\s+main\s*\(\s*\)/, "rs");
      const use = row.prompt.split("\n").filter((l) => /^\s*use\s/.test(l) && !than.includes(l.trim())).join("\n");
      return `${use}\n${than}\n${boNgoacDauTests(row.tests)}`;
    }
    case "java":
    case "cs": {
      const tuKhoa = row.lang === "java" ? "import" : "using";
      const reDau = new RegExp(`^\\s*${tuKhoa}\\s+[\\w.*]+\\s*;\\s*$`, "gm");
      const iLop = row.prompt.indexOf("class Problem");
      const dau = new Set(row.prompt.slice(0, iLop).split("\n").map((l) => l.trim()).filter(Boolean));
      let than = code.replace(reDau, (l) => { dau.add(l.trim()); return ""; }).replace(/^\s*(package|namespace)\s+[\w.]+\s*;\s*$/gm, "");
      // Model trả cả lớp ⇒ lấy THÂN lớp chứa hàm; kiểu phụ (lớp/record khác) giữ lại, đặt sau lớp Problem.
      const reLop = /(?:public\s+|internal\s+|static\s+|final\s+)*class\s+\w+[^{]*\{/g;
      let thanhVien = than, phu = "";
      for (const m of than.matchAll(reLop)) {
        const mo = m.index + m[0].length - 1;
        const dong = timDong(than, mo, row.lang);
        if (dong < 0) continue;
        const ben = than.slice(mo + 1, dong);
        if (ten && new RegExp(`\\b${ten}\\s*\\(`).test(ben)) {
          thanhVien = ben;
          phu = (than.slice(0, m.index) + than.slice(dong + 1)).trim();
          break;
        }
      }
      thanhVien = boHam(thanhVien, row.lang === "java" ? /\bstatic\s+void\s+main\s*\(/ : /\bstatic\s+(?:void|int|async\s+\w+)\s+Main\s*\(/, row.lang);
      return `${[...dau].join("\n")}\nclass Problem {\n${thanhVien}\n${boNgoacDauTests(row.tests)}\n${phu}\n`;
    }
    default:
      throw new Error(`ngôn ngữ lạ ${row.lang}`);
  }
}

/** Câu hỏi chế độ chat. */
export function cauHoiChat(row) {
  const ten = tenHam(row);
  return `Hoàn thành hàm \`${ten}\` dưới đây (ngôn ngữ: ${row.lang}). Trả về TOÀN BỘ hàm \`${ten}\` (giữ nguyên chữ ký; có thể kèm hàm phụ và import cần thiết) trong MỘT khối mã. Không viết hàm main hay test.\n\n\`\`\`\n${row.prompt.trimEnd()}\n\`\`\``;
}
