/**
 * ★★★ PHA 2A TASK 5 — LƯỚI CANH BẢN LIỆT KÊ ĐƯỜNG CẤP PHÁT.
 *
 * Bản liệt kê ở `vramAllocationSites.ts` là ĐẦU VÀO của Pha 2B. Một tài liệu thì trôi; một lưới
 * thì nổ. File này biến bản liệt kê thành lưới: nó QUÉT LẠI `server/**` + `scripts/**` bằng máy
 * và đòi kết quả quét khớp TỪNG DÒNG với mảng đã khai báo.
 *
 * ⚠ VÌ SAO PHẢI BỎ CHÚ THÍCH **VÀ** NỘI DUNG CHUỖI trước khi quét — cả hai đều là lỗi THẬT đã
 * gặp khi dựng máy quét này:
 *   • Chú thích: repo này viết docstring rất dài và nhắc `loadModel()`/`spawn()`/`getLlama()`
 *     hàng chục lần. Quét thô đếm ra số vô nghĩa và không ai duy trì nổi.
 *   • Chuỗi: `plugins/sidecar/pluginSignature.ts:51` có câu `"… refusing to spawn (tampered …)"`.
 *     Bản quét đầu tiên của chính task này đếm nó thành MỘT điểm `spawn(` — một hộ tiêu thụ MA.
 *     Bảng liệt kê mà có hộ ma thì Pha 2B trừ dư địa cho một thứ không tồn tại.
 *
 * ⚠ LƯỚI NÀY BẮT ĐƯỢC GÌ / KHÔNG BẮT ĐƯỢC GÌ — nói đúng, đừng nói rộng hơn:
 *   BẮT: thêm/bớt/di chuyển một lời gọi thuộc `SCAN_PATTERNS` trong `server/` hoặc `scripts/`.
 *   KHÔNG BẮT: một hộ tiêu thụ cấp phát bằng API mà `SCAN_PATTERNS` chưa biết tên (ví dụ một
 *        thư viện GPU mới), hoặc một tiến trình ngoài do người vận hành khởi động bằng tay.
 *        Đó là lý do `vramAllocationSites.ts` còn có khối `CONSUMERS_WITHOUT_A_CODE_SITE` viết
 *        bằng tay — máy quét KHÔNG thay được nó.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { KNOWN_ALLOCATION_SITES, WIRED_ALLOCATION_SITE_COUNT } from "./vramAllocationSites";

/**
 * Bỏ chú thích VÀ nội dung chuỗi, GIỮ NGUYÊN số dòng (mọi `\n` được giữ lại) để thông báo lỗi
 * còn chỉ đúng dòng. Máy trạng thái nhỏ, không phải parser — nhưng nó phải đúng ở đúng hai thứ
 * mà bản quét ngây thơ sai: `//`/`/* *​/` và `'` `"` `` ` ``.
 */
export function stripCommentsAndStrings(src: string): string {
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
    // Trong chuỗi: NUỐT nội dung, giữ dấu nháy đóng/mở và mọi xuống dòng.
    const quote = mode === "sq" ? "'" : mode === "dq" ? '"' : "`";
    if (c === "\\") { i += 2; continue; }
    if (c === quote) { mode = "code"; out += c; i++; continue; }
    if (c === "\n") out += c;
    i++;
  }
  return out;
}

/**
 * Tên hàm/lớp cấp phát mà máy quét biết. `symbol` trong bản liệt kê phải là MỘT trong các khoá
 * này — nếu không, ca "mọi symbol đều quét được" bên dưới sẽ đỏ (chống khai báo một `symbol`
 * mà máy quét không bao giờ tìm, tức một dòng bảng KHÔNG BAO GIỜ được kiểm).
 */
const SCAN_PATTERNS: Readonly<Record<string, RegExp>> = {
  "beginVramAllocation(": /\bbeginVramAllocation\s*\(\s*\{/g,
  "beginVram(": /\bbeginVram\s*\(\s*\{/g,
  "InferenceSession.create(": /\bInferenceSession\s*\.\s*create\s*\(/g,
  ".loadModel(": /\.\s*loadModel\s*\(/g,
  ".createContext(": /\.\s*createContext\s*\(/g,
  ".createEmbeddingContext(": /\.\s*createEmbeddingContext\s*\(/g,
  ".createRankingContext(": /\.\s*createRankingContext\s*\(/g,
  "getLlama(": /\bgetLlama\s*\(/g,
  "spawn(": /(?<![.\w])spawn\s*\(/g,
};

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ["server", "scripts"] as const;
const SCAN_EXTS = [".ts", ".tsx", ".mjs", ".mts", ".js"] as const;

/** File test KHÔNG được quét: chúng dựng mock `loadModel`/`getLlama` hàng trăm lần. */
const isTestFile = (rel: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);

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
      if (isTestFile(rel)) continue;
      const code = stripCommentsAndStrings(fs.readFileSync(fileAbs, "utf8"));
      for (const [symbol, re] of Object.entries(SCAN_PATTERNS)) {
        re.lastIndex = 0;
        const n = (code.match(re) ?? []).length;
        if (n > 0) found.set(`${rel}\u0000${symbol}`, n);
      }
    }
  }
  return found;
}

/** Bản liệt kê gộp lại thành cùng hình dạng với kết quả quét (một dòng = một lần xuất hiện). */
function declaredCounts(): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of KNOWN_ALLOCATION_SITES) {
    const k = `${s.file}\u0000${s.symbol}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

const pretty = (k: string) => k.replace("\u0000", "  →  ");

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

  it("★★★ 3. WIRED_ALLOCATION_SITE_COUNT = số điểm beginVramAllocation ĐẾM ĐƯỢC BẰNG MÁY (không cộng dồn trong đầu)", () => {
    const found = scanRepo();
    let n = 0;
    for (const [k, count] of found) {
      const [file, symbol] = k.split("\u0000");
      if (symbol !== "beginVramAllocation(" && symbol !== "beginVram(") continue;
      // `vramWiring.ts` định nghĩa hàm; nó không phải một ĐIỂM GỌI.
      if (file === "server/services/vram/vramWiring.ts") continue;
      if (!file.startsWith("server/")) continue;
      n += count;
    }
    expect(
      n,
      "Con số này ĐÃ SAI HAI LẦN LIÊN TIẾP ở pha trước vì được cộng dồn thay vì đếm lại.\n" +
        "ĐẾM LẠI: git grep -n \"await beginVramAllocation({\" -- server/ | grep -v '\\.test\\.'\n" +
        "         git grep -n \"await beginVram({\"           -- server/ | grep -v '\\.test\\.'",
    ).toBe(WIRED_ALLOCATION_SITE_COUNT);
  });

  it("4. mọi `symbol` khai báo đều là một khoá mà máy quét thật sự tìm", () => {
    const known = new Set(Object.keys(SCAN_PATTERNS));
    const unknown = [...new Set(KNOWN_ALLOCATION_SITES.map((s) => s.symbol))].filter((s) => !known.has(s));
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

  it("7. máy lọc chuỗi/chú thích thật sự chạy (chống tái sinh hộ tiêu thụ MA)", () => {
    const src = [
      "// spawn( trong chú thích dòng",
      "/* getLlama( trong chú thích khối */",
      'const msg = "refusing to spawn (tampered)";',
      "const real = spawn(cmd, args);",
    ].join("\n");
    const code = stripCommentsAndStrings(src);
    const re = SCAN_PATTERNS["spawn("];
    re.lastIndex = 0;
    expect((code.match(re) ?? []).length).toBe(1);
    // Số dòng phải được giữ nguyên, nếu không thông báo lỗi sẽ chỉ sai chỗ.
    expect(code.split("\n").length).toBe(src.split("\n").length);
  });
});
