/**
 * ★★★ PHA 2A TASK 5 — LƯỚI CANH BẢN LIỆT KÊ ĐƯỜNG CẤP PHÁT.
 *
 * Bản liệt kê ở `vramAllocationSites.ts` là ĐẦU VÀO của Pha 2B. Một tài liệu thì trôi; một lưới
 * thì nổ. File này QUÉT LẠI `server/**` + `scripts/**` bằng máy và đòi kết quả quét khớp TỪNG
 * DÒNG với mảng đã khai báo.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ C-1 (review vòng 1) — BẢN ĐẦU CỦA LƯỚI NÀY ĐỂ MỘT SIDECAR GPU ĐI QUA.
 *
 * Reviewer thêm `cp.spawn("llama-server.exe", ["-ngl","999"])` VÀ
 * `execFile("whisper-cuda.exe", …)` vào `server/services/aiExplainability.ts` ⇒ **7/7 XANH**.
 * Tôi đã tự chạy lại đúng hai đột biến đó và xác nhận: lưới im lặng. Hai lỗ:
 *
 *   1. mẫu `spawn(` viết là `(?<![.\w])spawn\s*\(` — chặn TƯỜNG MINH dạng gọi THÀNH VIÊN, nên
 *      `cp.spawn(...)` / `child_process.spawn(...)` VÔ HÌNH. Tôi viết `(?<![.\w])` để né
 *      `re.exec(`, rồi áp nhầm nó cho `spawn` — nơi dạng thành viên mới là dạng phổ biến.
 *   2. `execFile(` VẮNG MẶT hoàn toàn — dù đó chính là API của một hộ GPU **ĐÃ BIẾT VÀ ĐÃ ĐƯỢC
 *      GHI TÊN TRONG CHÍNH BÁO CÁO NÀY** (whisper.cpp, `kbVideoTranscriber.ts:212`).
 *
 * Và docstring của artifact lúc đó **TUYÊN BỐ** lưới này đóng đúng lớp lỗi sidecar 7,8 GB của
 * Đợt 0. Một lưới sai kèm một lời tuyên bố sai nguy hiểm hơn không có lưới, vì nó làm người sau
 * NGỪNG TÌM. Nên bản vá này không chỉ thêm mẫu mà đổi CẤU TRÚC quét.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * ★★ HAI LƯỢT QUÉT, HAI PHIÊN BẢN NGUỒN — vì sao không thể chỉ có một:
 *
 *   • `stripCommentsAndStrings()` (bỏ CẢ chú thích LẪN nội dung chuỗi) → cho `CALL_PATTERNS`.
 *     Bỏ chuỗi là BẮT BUỘC: `plugins/sidecar/pluginSignature.ts:51` có câu
 *     `"… refusing to spawn (tampered …)"` — bản quét đầu tiên đếm nó thành một điểm `spawn(`,
 *     tức một **hộ tiêu thụ MA**. Bảng có hộ ma thì Pha 2B trừ dư địa cho thứ không tồn tại.
 *
 *   • `stripComments()` (bỏ chú thích, GIỮ chuỗi) → cho `MODULE_PATTERNS`, vì module specifier
 *     NẰM TRONG một chuỗi (`from "node:child_process"`).
 *
 * ★★★ VÌ SAO PHẢI CÓ `MODULE_PATTERNS` chứ không chỉ thêm tên hàm: `kbPdfOcr.ts` và
 * `kbVideoTranscriber.ts` (hộ whisper.cpp) gọi qua `promisify(execFile)` rồi `execFileAsync(...)`
 * — **không mẫu lời gọi nào bắt được**, dù thêm bao nhiêu tên hàm. Cùng lớp: alias, destructure
 * đổi tên, `await import("child_process")`. Bắt Ở MODULE là chỗ DUY NHẤT mọi biến thể phải đi qua:
 * muốn sinh tiến trình con thì phải có `child_process` trong file, không có đường vòng.
 * ⇒ Hai lớp bổ sung nhau: mẫu lời gọi cho biết cấp phát Ở ĐÂU, mẫu module cho biết file nào CÓ
 * KHẢ NĂNG sinh tiến trình. Kiểm chứng: lượt vá này làm `kbVideoTranscriber.ts` (whisper) và
 * `kbPdfOcr.ts` lần đầu tiên xuất hiện trong bảng — trước đó cả hai vô hình.
 *
 * ⚠ VÌ SAO KHÔNG CÓ MẪU `exec(` TRẦN: `.exec(` là API RegExp và xuất hiện ~40 lần trong `server/`
 * (`re.exec(text)`). Đưa vào là nhấn chìm bảng bằng nhiễu tới mức không ai duy trì nổi — mà một
 * bảng không ai duy trì thì không phải lưới. `child_process.exec` được phủ bằng `MODULE_PATTERNS`
 * thay thế: file nào dùng nó cũng phải có `child_process` trước.
 *
 * ⚠ LƯỚI NÀY VẪN KHÔNG BẮT ĐƯỢC GÌ — nói đúng, đừng nói rộng hơn (câu này thay cho lời tuyên bố
 * sai đã bị C-1 bác):
 *   • một thư viện GPU mà `SCAN_PATTERNS` chưa biết tên (WebGPU, TensorRT trực tiếp, binding CUDA
 *     khác) — đi qua HOÀN TOÀN im lặng;
 *   • `client/**` và `tools/**` nằm NGOÀI `SCAN_ROOTS`;
 *   • tiến trình do người vận hành khởi động bằng tay — không có dòng mã nào để quét.
 *   ⇒ Vì thế `vramAllocationSites.ts` còn khối `CONSUMERS_WITHOUT_A_CODE_SITE` viết bằng tay.
 *     Máy quét KHÔNG thay được nó, và không được để ai tin là nó thay được.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  KNOWN_ALLOCATION_SITES,
  WIRED_ALLOCATION_SITE_COUNT,
  PERMIT_SYMBOL_OCCURRENCES_THAT_ARE_NOT_CALL_SITES,
} from "./vramAllocationSites";

/** Bỏ chú thích. GIỮ nội dung chuỗi. Giữ nguyên số dòng. */
export function stripComments(src: string): string {
  return scrub(src, false);
}
/** Bỏ chú thích VÀ nội dung chuỗi (giữ dấu nháy). Giữ nguyên số dòng. */
export function stripCommentsAndStrings(src: string): string {
  return scrub(src, true);
}

function scrub(src: string, killStrings: boolean): string {
  let out = "";
  let i = 0;
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && d === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") { mode = "sq"; out += c; i++; continue; }
      if (c === '"') { mode = "dq"; out += c; i++; continue; }
      if (c === "`") { mode = "tpl"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i += 2; } else { if (c === "\n") out += c; i++; }
      continue;
    }
    const quote = mode === "sq" ? "'" : mode === "dq" ? '"' : "`";
    if (c === "\\") { if (!killStrings) out += c + (d ?? ""); i += 2; continue; }
    if (c === quote) { mode = "code"; out += c; i++; continue; }
    if (killStrings) { if (c === "\n") out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

/**
 * Mẫu LỜI GỌI — quét trên nguồn đã bỏ chú thích + chuỗi.
 *
 * ⚠ Mọi mẫu sinh-tiến-trình dùng `\b…` chứ KHÔNG dùng `(?<![.\w])…`: `\b` khớp CẢ dạng trần
 * (`spawn(`) LẪN dạng thành viên (`cp.spawn(`, `this.deps.spawn(`) — chính lỗ C-1.
 */
const CALL_PATTERNS: Readonly<Record<string, RegExp>> = {
  // ⚠ I-7: KHÔNG đòi `\(\s*\{`. Bản trước đòi, nên `beginVramAllocation(opts)` — truyền BIẾN,
  // đúng cách hai lớp bọc đang gọi, và một cách hợp lệ để viết một điểm nối MỚI — VÔ HÌNH.
  "beginVramAllocation(": /\bbeginVramAllocation\s*\(/g,
  "beginVram(": /\bbeginVram\s*\(/g,
  "InferenceSession.create(": /\bInferenceSession\s*\.\s*create\s*\(/g,
  ".loadModel(": /\.\s*loadModel\s*\(/g,
  ".createContext(": /\.\s*createContext\s*\(/g,
  ".createEmbeddingContext(": /\.\s*createEmbeddingContext\s*\(/g,
  ".createRankingContext(": /\.\s*createRankingContext\s*\(/g,
  "getLlama(": /\bgetLlama\s*\(/g,
  "spawn(": /\bspawn\s*\(/g,
  "spawnSync(": /\bspawnSync\s*\(/g,
  "execFile(": /\bexecFile\s*\(/g,
  "execFileSync(": /\bexecFileSync\s*\(/g,
  "execSync(": /\bexecSync\s*\(/g,
  "fork(": /\bfork\s*\(/g,
};

/** Mẫu MODULE — quét trên nguồn đã bỏ chú thích nhưng GIỮ chuỗi. */
const MODULE_PATTERNS: Readonly<Record<string, RegExp>> = {
  child_process: /\bchild_process\b/g,
};

const ALL_SYMBOLS = new Set([...Object.keys(CALL_PATTERNS), ...Object.keys(MODULE_PATTERNS)]);

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ["server", "scripts"] as const;
const SCAN_EXTS = [".ts", ".tsx", ".mjs", ".mts", ".js"] as const;

/** File test KHÔNG được quét: chúng dựng mock `loadModel`/`getLlama` hàng trăm lần. */
const isTestFile = (rel: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);

/**
 * ⚠ TỰ LOẠI TRỪ — và vì sao nó KHÔNG mở một lỗ mới.
 *
 * Bản liệt kê nhắc tên `child_process` 28 lần trong các ô `note`; mẫu MODULE quét trên nguồn CÒN
 * GIỮ CHUỖI nên nó tự khớp chính mình. Nếu khai 28 dòng "child_process" cho artifact thì mỗi lần
 * sửa một câu ghi chú lại phải sửa con số — một lưới như thế sẽ bị người sau tắt đi.
 *
 * An toàn được, vì artifact là module **CHỈ DỮ LIỆU**: nó không import gì và không gọi gì, nên nó
 * KHÔNG THỂ cấp phát. Tính chất đó không được để trôi ⇒ ca `8` bên dưới canh nó.
 */
const SELF_EXCLUDED = new Set(["server/services/vram/vramAllocationSites.ts"]);

function listFiles(dirAbs: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const p = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
      listFiles(p, acc);
    } else acc.push(p);
  }
  return acc;
}

/** Khoá đối chiếu: `${file}\u0000${symbol}` → số lần xuất hiện. */
function scanRepo(): Map<string, number> {
  const found = new Map<string, number>();
  for (const root of SCAN_ROOTS) {
    const abs = path.join(REPO_ROOT, root);
    if (!fs.existsSync(abs)) continue;
    for (const fileAbs of listFiles(abs)) {
      const rel = path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
      if (!SCAN_EXTS.some((x) => rel.endsWith(x))) continue;
      if (isTestFile(rel) || SELF_EXCLUDED.has(rel)) continue;
      const raw = fs.readFileSync(fileAbs, "utf8");
      const noStrings = stripCommentsAndStrings(raw);
      const keepStrings = stripComments(raw);
      for (const [symbol, re] of Object.entries(CALL_PATTERNS)) {
        re.lastIndex = 0;
        const n = (noStrings.match(re) ?? []).length;
        if (n > 0) found.set(`${rel}\u0000${symbol}`, n);
      }
      for (const [symbol, re] of Object.entries(MODULE_PATTERNS)) {
        re.lastIndex = 0;
        const n = (keepStrings.match(re) ?? []).length;
        if (n > 0) found.set(`${rel}\u0000${symbol}`, n);
      }
    }
  }
  return found;
}

function declaredCounts(): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of KNOWN_ALLOCATION_SITES) {
    const k = `${s.file}\u0000${s.symbol}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

const pretty = (k: string) => k.replace("\u0000", "  →  ");
const PERMIT_SYMBOLS = new Set(["beginVramAllocation(", "beginVram("]);

describe("Pha 2A Task 5 — bản liệt kê đường cấp phát VRAM", () => {
  it("★★★ 1. KHÔNG có điểm cấp phát nào trong server/ hoặc scripts/ mà bản liệt kê chưa khai", () => {
    const found = scanRepo();
    const declared = declaredCounts();

    const undeclared: string[] = [];
    for (const [k, n] of found) {
      const d = declared.get(k) ?? 0;
      if (n > d) undeclared.push(`${pretty(k)} — quét thấy ${n}, bản liệt kê khai ${d}`);
    }

    expect(
      undeclared,
      "Có điểm cấp phát VRAM MỚI chưa được khai báo.\n" +
        "Đây KHÔNG phải lỗi test — đây là lưới đang làm đúng việc của nó.\n" +
        "Thêm dòng tương ứng vào KNOWN_ALLOCATION_SITES (server/services/vram/vramAllocationSites.ts),\n" +
        "và TRẢ LỜI câu hỏi: lượt cấp phát đó có đi qua beginVramAllocation() không?\n" +
        "Nếu KHÔNG, Pha 2B sẽ cưỡng chế trên một con số thiếu đúng bằng khối byte này.\n" +
        `Chưa khai:\n  ${undeclared.join("\n  ")}`,
    ).toEqual([]);
  });

  it("★★ 2. KHÔNG có dòng nào trong bản liệt kê đã chết (mã đã xoá/đổi mà bảng còn giữ)", () => {
    const found = scanRepo();
    const declared = declaredCounts();

    const stale: string[] = [];
    for (const [k, d] of declared) {
      const n = found.get(k) ?? 0;
      if (d > n) stale.push(`${pretty(k)} — bản liệt kê khai ${d}, quét chỉ thấy ${n}`);
    }

    expect(
      stale,
      "Bản liệt kê khai nhiều hơn thực tế. Một dòng chết làm Pha 2B trừ dư địa cho một hộ tiêu " +
        "thụ KHÔNG TỒN TẠI (hướng lỗi ngược, nhưng vẫn là sổ nói sai).\n" +
        `Dòng chết:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("★★★ 3. WIRED_ALLOCATION_SITE_COUNT = số ĐIỂM GỌI beginVramAllocation đếm được BẰNG MÁY", () => {
    const found = scanRepo();

    // Tổng THÔ mọi lần xuất hiện của hai ký hiệu giấy phép trong `server/`…
    let raw = 0;
    for (const [k, count] of found) {
      const [file, symbol] = k.split("\u0000");
      if (!PERMIT_SYMBOLS.has(symbol)) continue;
      if (!file.startsWith("server/")) continue;
      raw += count;
    }
    // …trừ những lần xuất hiện KHÔNG PHẢI điểm gọi (khai báo hàm + pass-through của lớp bọc).
    // Khai TƯỜNG MINH thay vì lọc bằng regex: đây đúng là hai cái bẫy đếm-hai-lần, và một bộ lọc
    // ngầm sẽ lặng lẽ nuốt cả một điểm gọi THẬT nếu ai đó đổi cách viết.
    const excluded = PERMIT_SYMBOL_OCCURRENCES_THAT_ARE_NOT_CALL_SITES.length;

    expect(
      raw - excluded,
      "Con số này ĐÃ SAI HAI LẦN LIÊN TIẾP ở pha trước vì được cộng dồn thay vì đếm lại.\n" +
        `Quét thô thấy ${raw} lần xuất hiện, trừ ${excluded} lần KHÔNG phải điểm gọi.\n` +
        "ĐẾM LẠI BẰNG TAY: git grep -nE 'beginVram(Allocation)?[[:space:]]*\\(' -- server/ | grep -v '.test.'",
    ).toBe(WIRED_ALLOCATION_SITE_COUNT);
  });

  it("★★ 3b. mỗi dòng trong danh sách LOẠI TRỪ phải thật sự tồn tại trong mã", () => {
    const found = scanRepo();
    const missing = PERMIT_SYMBOL_OCCURRENCES_THAT_ARE_NOT_CALL_SITES.filter(
      (x) => (found.get(`${x.file}\u0000${x.symbol}`) ?? 0) === 0,
    ).map((x) => `${x.file} → ${x.symbol}`);
    expect(
      missing,
      "Một mục LOẠI TRỪ không còn tồn tại ⇒ nó đang trừ khống, và WIRED_ALLOCATION_SITE_COUNT " +
        "đang thấp hơn sự thật. Hướng lỗi nguy hiểm: sổ tưởng ít hộ hơn thực tế.",
    ).toEqual([]);
  });

  it("4. mọi `symbol` khai báo đều là một khoá mà máy quét thật sự tìm", () => {
    const unknown = [...new Set(KNOWN_ALLOCATION_SITES.map((s) => s.symbol))].filter((s) => !ALL_SYMBOLS.has(s));
    expect(
      unknown,
      "Một `symbol` không nằm trong SCAN_PATTERNS sẽ KHÔNG BAO GIỜ được quét ⇒ dòng bảng đó là " +
        "trang trí, không phải lưới. Thêm mẫu quét, hoặc sửa `symbol`.",
    ).toEqual([]);
  });

  it("5. mọi dòng đều có `note` thật (bảng này được đọc bởi người thiết kế Pha 2B)", () => {
    const thin = KNOWN_ALLOCATION_SITES.filter((s) => s.note.trim().length < 20).map((s) => `${s.file} → ${s.symbol}`);
    expect(thin, "Dòng thiếu ghi chú — Pha 2B không quyết định được gì từ một ô trống.").toEqual([]);
  });

  it("6. hai hộ tiêu thụ NGOÀI tiến trình lớn nhất vẫn còn trong bảng và vẫn ĐÃ NỐI", () => {
    // Chốt bằng tên: sidecar thị giác (7,8 GB) là hộ đã lọt qua 7 task + 7 review ở Đợt 0;
    // cron kb-sync là hộ 03:00 đã lọt ở Đợt 2. Nếu ai đó gỡ giấy phép của chúng, ca này đỏ.
    const vision = KNOWN_ALLOCATION_SITES.filter((s) => s.file.endsWith("llamaVisionSidecar.ts"));
    const kbSync = KNOWN_ALLOCATION_SITES.filter((s) => s.file.endsWith("kbSyncScheduler.ts"));
    expect(vision.length).toBeGreaterThan(0);
    expect(kbSync.length).toBeGreaterThan(0);
    expect(vision.every((s) => s.wired)).toBe(true);
    expect(kbSync.every((s) => s.wired)).toBe(true);
  });

  it("★★★ 7. C-1 — lưới BẮT ĐƯỢC một sidecar GPU ở mọi dạng gọi (đây là ca đã từng im lặng)", () => {
    const src = [
      "// spawn( trong chú thích dòng",
      "/* getLlama( trong chú thích khối */",
      'const msg = "refusing to spawn (tampered)";', //           chuỗi — KHÔNG được đếm
      "const a = spawn(cmd, args);", //                            dạng trần
      'const b = cp.spawn("llama-server.exe", ["-ngl", "999"]);', // THÀNH VIÊN (lỗ C-1 #1)
      "const c = child_process.spawn(x, y);", //                   thành viên đủ tên
      "const d = this.deps.spawn({ command });", //                thành viên lồng
      "execFile(whisperBin, args, cb);", //                        execFile (lỗ C-1 #2)
      "const e = promisify(execFile);", //                         alias — mẫu lời gọi KHÔNG bắt…
    ].join("\n");

    const noStrings = stripCommentsAndStrings(src);
    const countCall = (s: string) => {
      const re = CALL_PATTERNS[s];
      re.lastIndex = 0;
      return (noStrings.match(re) ?? []).length;
    };

    expect(countCall("spawn("), "phải bắt CẢ dạng trần lẫn dạng thành viên, KHÔNG đếm chuỗi").toBe(4);
    expect(countCall("execFile("), "execFile phải nằm trong SCAN_PATTERNS").toBe(1);

    // …và alias/promisify được phủ bằng LỚP THỨ HAI: mẫu module trên nguồn còn giữ chuỗi.
    const keepStrings = stripComments('import { execFile } from "node:child_process";');
    const mre = MODULE_PATTERNS["child_process"];
    mre.lastIndex = 0;
    expect((keepStrings.match(mre) ?? []).length, "mẫu module phải thấy specifier trong chuỗi").toBe(1);

    // Số dòng phải được giữ nguyên, nếu không thông báo lỗi sẽ chỉ sai chỗ.
    expect(noStrings.split("\n").length).toBe(src.split("\n").length);
  });

  it("★★ 8. artifact vẫn là module CHỈ DỮ LIỆU — điều kiện làm cho việc tự loại trừ an toàn", () => {
    // `vramAllocationSites.ts` bị loại khỏi lượt quét (nó nhắc tên `child_process` trong ghi chú).
    // Việc đó CHỈ an toàn chừng nào nó không import và không gọi được gì. Ca này giữ tính chất đó.
    for (const rel of SELF_EXCLUDED) {
      const code = stripCommentsAndStrings(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
      expect(/^\s*import\s/m.test(code), `${rel} có câu lệnh import ⇒ không còn là module chỉ-dữ-liệu`).toBe(false);
      expect(/\brequire\s*\(/.test(code), `${rel} có require() ⇒ không còn là module chỉ-dữ-liệu`).toBe(false);
      for (const [symbol, re] of Object.entries(CALL_PATTERNS)) {
        re.lastIndex = 0;
        expect((code.match(re) ?? []).length, `${rel} chứa lời gọi ${symbol} ⇒ phải bỏ khỏi SELF_EXCLUDED`).toBe(0);
      }
    }
  });
});
