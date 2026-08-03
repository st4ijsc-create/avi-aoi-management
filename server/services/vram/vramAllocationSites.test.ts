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
  KNOWN_ALLOCATION_SITE_ROW_COUNT,
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

/**
 * Mẫu MODULE — quét trên nguồn đã bỏ chú thích nhưng GIỮ chuỗi.
 *
 * ★★★ N-1 (re-review vòng 1) — BẤT ĐỐI XỨNG TRONG CHÍNH BẢN VÁ TRƯỚC. Vòng trước tôi dựng lớp
 * MODULE **vì đã nhận ra alias đánh bại mẫu tên-hàm**, rồi chỉ áp nó cho `child_process` và
 * KHÔNG áp cho hai thư viện GPU. Reviewer khai thác đúng nửa còn thiếu:
 *
 *     import { InferenceSession as ORT } from "onnxruntime-node";
 *     const mk = ORT.create;
 *     mk("m.onnx", { executionProviders: ["dml"] });   // phiên DirectML THẬT ⇒ 9/9 XANH
 *
 * Tôi đã tự chạy lại và xác nhận 9/9 xanh trước khi sửa. Có sẵn insight đúng mà chỉ dùng một
 * nửa thì lỗ còn nguyên ở nửa kia.
 *
 * ⚠ HAI HÌNH DẠNG MẪU KHÁC NHAU, CÓ CHỦ Ý — không phải thiếu nhất quán:
 *   • `child_process` dùng mẫu ĐỊNH DANH `/\bchild_process/` (KHÔNG có `\b` đuôi) để bắt CẢ
 *     `child_process_1` — dạng biến do TypeScript/bundler sinh ra, và là dạng mà
 *     `server/license/sdk/index.cjs` dùng (xem N-2 ở `SCAN_EXTS`). Đo được: `\bchild_process\b`
 *     khớp **0** lần trong file đó, `\bchild_process` khớp **8**.
 *   • Hai thư viện GPU dùng mẫu DẠNG-NHẬP (`from`/`import(`/`require(` + chuỗi specifier). Mẫu
 *     định danh trần cho chúng là KHÔNG DÙNG ĐƯỢC: `onnxruntime-node`/`node-llama-cpp` xuất hiện
 *     dày đặc trong câu lỗi, mảng `techStack`, đường dẫn đóng gói. Đo TRONG ĐÚNG PHẠM VI QUÉT
 *     (đã loại file test và artifact — hai thứ máy quét loại theo cấu trúc): định danh trần
 *     **61** lần, dạng nhập **23** lần ⇒ **38 dòng nhiễu thuần**. Nhiễu gấp 1,65 lần tín hiệu thì
 *     bảng sẽ bị người sau tắt đi — đúng lý do tôi đã từ chối mẫu `exec(` trần.
 *     ⚠ P-2 (re-review vòng 2): bản trước ghi "212 lần", đo trong phạm vi CÓ CẢ file test và
 *     artifact. Quyết định không đổi, chỉ con số là sai phạm vi — và một con số sai phạm vi dùng
 *     để biện minh cho một quyết định đúng vẫn là một lập luận hỏng.
 */
const MODULE_PATTERNS: Readonly<Record<string, RegExp>> = {
  child_process: /\bchild_process/g,
  "import onnxruntime-node": /(?:from|import|require)\s*\(?\s*["'](?:node:)?onnxruntime-node(?:\/[^"']*)?["']/g,
  "import node-llama-cpp": /(?:from|import|require)\s*\(?\s*["'](?:node:)?node-llama-cpp(?:\/[^"']*)?["']/g,
};

const ALL_SYMBOLS = new Set([...Object.keys(CALL_PATTERNS), ...Object.keys(MODULE_PATTERNS)]);

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ["server", "scripts"] as const;
/**
 * ★★★ N-2 (re-review vòng 1) — `.cjs` VẮNG MẶT, VÀ ĐÓ KHÔNG PHẢI GIẢ THUYẾT.
 *
 * `server/license/sdk/index.cjs` — **1.543 dòng, nằm ngay trong `server/`, chưa từng được quét
 * một lần nào** — sinh tiến trình thật, và sinh theo đúng hình dạng né tránh mà lưới tự nhận đã
 * phủ: `require('child_pr' + <hàm>)` (specifier bị CẮT ĐÔI ⇒ mẫu dạng-nhập vô dụng) rồi
 * `child_process_1['execSync'](…)` (tên hàm nằm trong CHUỖI ⇒ mẫu lời gọi vô dụng, vì lượt quét
 * lời gọi đã xoá nội dung chuỗi).
 *
 * ⚠ ĐO ĐƯỢC, VÀ NÓ ĐỔI CẢ CÁCH VÁ: chỉ mở rộng `SCAN_EXTS` là **KHÔNG ĐỦ** — với mẫu cũ
 * `\bchild_process\b`, file này khớp **0 lần** dù đã được đọc. Phải mở rộng `SCAN_EXTS` **VÀ**
 * bỏ `\b` đuôi của mẫu định danh (xem `MODULE_PATTERNS`) thì nó mới hiện ra: **8 lần**.
 *
 * Hôm nay nó chạy `wmic`/`dmidecode` để lấy vân tay phần cứng (CPU, KHÔNG phải hộ VRAM) — nhưng
 * nó là **bằng chứng sống** rằng cả hai lớp mẫu đều né được, nên nó được ghi vào bảng chính chứ
 * không chỉ vá âm thầm.
 *
 * Rà toàn bộ đuôi file thật có trong `SCAN_ROOTS`: `.ts` 1.753 · `.mjs` 137 · `.py` **13** ·
 * `.ps1` 3 · `.mts` 3 · `.js` 2 · `.cjs` **1**. Thêm `.cjs`; thêm `.cts`/`.jsx` phòng trước (hôm
 * nay 0 file). ⚠ `.py` và `.ps1` thì mẫu quét hiện tại **không đọc hiểu được** — xem vùng mù (E)
 * trong `vramAllocationSites.ts`.
 */
const SCAN_EXTS = [".ts", ".tsx", ".mjs", ".mts", ".js", ".cjs", ".cts", ".jsx"] as const;

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

  it("★★ 3c. P-1 — ĐỘ DÀI bảng bị khoá, và khớp đúng tổng lần xuất hiện quét được", () => {
    // Vì sao cần: docstring của artifact từng ghi "120 dòng" khi bảng đã lên 151, và KHÔNG ca nào
    // ràng buộc độ dài nên không có gì đỏ. Một con số cũ sót lại trong chính file cảnh báo về
    // việc cộng dồn số cũ — khoá nó lại bằng khẳng định thay vì bằng lời hứa.
    expect(
      KNOWN_ALLOCATION_SITES.length,
      "Đổi bảng thì phải đổi KNOWN_ALLOCATION_SITE_ROW_COUNT (và mọi con số nhắc lại trong docstring).",
    ).toBe(KNOWN_ALLOCATION_SITE_ROW_COUNT);

    let scanned = 0;
    for (const n of scanRepo().values()) scanned += n;
    expect(
      KNOWN_ALLOCATION_SITES.length,
      "Độ dài bảng phải bằng TỔNG lần xuất hiện quét được — ca 1 và ca 2 đã canh từng khoá, " +
        "ca này canh con số mà con người sẽ đi trích dẫn.",
    ).toBe(scanned);
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

    // N-2: dạng biến do bundler sinh (`child_process_1`) — mẫu phải KHÔNG có `\b` đuôi.
    const cjsShape = stripComments("const child_process_1 = require('child_pr' + x); child_process_1['execSync'](c);");
    mre.lastIndex = 0;
    expect((cjsShape.match(mre) ?? []).length, "phải bắt được `child_process_1` (hình dạng của index.cjs)").toBe(2);

    // Số dòng phải được giữ nguyên, nếu không thông báo lỗi sẽ chỉ sai chỗ.
    expect(noStrings.split("\n").length).toBe(src.split("\n").length);
  });

  it("★★★ 7b. N-1 — ALIAS thư viện GPU phải bị bắt (ca đã im lặng ở re-review vòng 1)", () => {
    // Phiên ONNX DirectML THẬT, không tiến trình con nào, và KHÔNG một mẫu lời gọi nào khớp:
    // `InferenceSession` bị đổi tên thành `ORT`, rồi `.create` bị tách thành một biến `mk`.
    const src = [
      'import { InferenceSession as ORT } from "onnxruntime-node";',
      "const mk = ORT.create;",
      'mk("m.onnx", { executionProviders: ["dml"] });',
    ].join("\n");

    const noStrings = stripCommentsAndStrings(src);
    const cre = CALL_PATTERNS["InferenceSession.create("];
    cre.lastIndex = 0;
    expect(
      (noStrings.match(cre) ?? []).length,
      "mẫu LỜI GỌI cố ý KHÔNG bắt được ca này — đó là lý do phải có lớp MODULE",
    ).toBe(0);

    const keepStrings = stripComments(src);
    const mre = MODULE_PATTERNS["import onnxruntime-node"];
    mre.lastIndex = 0;
    expect((keepStrings.match(mre) ?? []).length, "lớp MODULE phải bắt được alias qua specifier").toBe(1);

    // Cùng lý lẽ cho node-llama-cpp — nửa còn thiếu của bản vá trước.
    const llama = stripComments('const { getLlama: g } = await import("node-llama-cpp");');
    const lre = MODULE_PATTERNS["import node-llama-cpp"];
    lre.lastIndex = 0;
    expect((llama.match(lre) ?? []).length).toBe(1);

    // …và mẫu dạng-nhập KHÔNG được khớp câu văn xuôi (lý do không dùng định danh trần).
    lre.lastIndex = 0;
    expect(
      (stripComments('techStack: ["node-llama-cpp", "React 19"], msg = "node-llama-cpp not available"').match(lre) ?? []).length,
      "mảng techStack / câu lỗi KHÔNG được đếm là một lượt nạp thư viện",
    ).toBe(0);
  });

  it("★★ 7c. DÂY BẪY cho vùng mù Python — hai file trainer còn tồn tại và còn chạm CUDA", () => {
    /**
     * P-5: đã QUYẾT ĐỊNH **không** thêm một vòng quét `.py`. Sản lượng đo được là 0 — cả 13 file
     * `scripts/*.py` đều có **0** điểm cấp phát GPU (1 solver CP-SAT đã phân loại là CPU, 1 mô
     * phỏng MQTT, 1 migration, 1 test websocket, 9 codemod dùng một lần) — còn chi phí là một bộ
     * mẫu Python phải nuôi mãi mãi. Đó đúng là lớp lỗi đã hai lần bị từ chối (`exec(` trần, định
     * danh thư viện trần).
     *
     * TOÀN BỘ GPU-Python của repo = **2 file, cả hai NGOÀI `SCAN_ROOTS`**, và cả hai đã được gọi
     * đích danh ở mục N-6b. Thay cho một vòng quét, đây là dây bẫy 3 dòng: nếu chúng biến mất,
     * đổi tên, hay thôi chạm CUDA thì mục N-6b trong bản liệt kê đã cũ và phải được đọc lại.
     */
    for (const rel of ["tools/trainer/train.py", "tools/trainer/finetune_lora.py"]) {
      const abs = path.join(REPO_ROOT, rel);
      expect(fs.existsSync(abs), `${rel} biến mất ⇒ mục N-6b của bản liệt kê đã cũ`).toBe(true);
      expect(
        /cuda/i.test(fs.readFileSync(abs, "utf8")),
        `${rel} thôi chạm CUDA ⇒ đọc lại mục N-6b (hộ external-process không có số)`,
      ).toBe(true);
    }
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
