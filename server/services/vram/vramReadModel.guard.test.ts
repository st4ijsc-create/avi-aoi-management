/**
 * ★★★ Pha 5 Task 2 (N8, review vòng 1 — I-1) — **MỌI MẶT ĐỌC CỦA `buildVramAgentState()` PHẢI
 * ĐỨNG SAU ĐÚNG CẶP `("machine_control", "canView")`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI CŨ KHÔNG ĐỦ — HAI ĐỘT BIẾN CỦA REVIEWER ĐỀU **SỐNG SÓT**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lưới đầu của Task 2 neo vào `appParams.action === "canView"`, tức chỉ canh **VẾ HÀNH ĐỘNG**:
 *
 *  • **MINE-1** — đổi `"machine_control"` → `"dashboard"`, **giữ** `"canView"` ⇒ **XANH 25/25**.
 *    Không phải một khả năng lý thuyết: `operator` **CÓ** `dashboard` ở đường seed
 *    (`scripts/seed-all-modules.ts:176-184`) ⇒ **một lượt đổi chuỗi** đưa `processKey` / `owner` /
 *    tên model đang nạp **tới tận operator**, và **785/785 vẫn xanh**.
 *  • **MINE-2b** — thêm `stateRaw: protectedProcedure.query(buildVramAgentState)` ⇒ **XANH
 *    71 file / 1049 test**. Một mặt đọc **THỨ HAI** mở toang, **không cổng nào đỏ**.
 *
 * ⇒ Lời biện hộ cũ (*"hôm nay `vram` có đúng một mặt đọc nên cổng vét cạn là lưới-theo-FILE"*)
 * **đúng ở lập luận, sai ở kết luận**: đường thoát **đang mở**. Lưới đúng phát biểu **CÁI NÓ PHẢI
 * LÀ** và **neo theo ĐƯỜNG THOÁT** — tức theo **call-site của chính hàm mang dữ liệu**, không theo
 * một danh sách file:
 *
 *      MỌI lời gọi `buildVramAgentState()` trong mã sản xuất `server/**` phải nằm sau một cổng
 *      quyền mang **ĐÚNG CẶP** `("machine_control", "canView")` — cả **module** LẪN **hành động**.
 *
 * Một phát biểu đóng **cả I-1 lẫn MINE-2b**: đổi module ⇒ đỏ; mở mặt đọc thứ hai (kể cả trong một
 * **FILE MỚI**) ⇒ đỏ, **kèm con trỏ `file:dòng`** tới đúng chỗ phải sửa.
 *
 * ⚠ Hai hình dạng cổng đều HỢP LỆ, vì hai bề mặt thật đang dùng hai hình dạng:
 *   1. **tRPC** — `X.query(...)` với `X` chain `requirePermission("machine_control","canView")`;
 *   2. **Tool Agent** — thân hàm gọi `checkPermission(…, "machine_control", "canView")` trước khi đọc.
 * Lưới hỏi **cặp giá trị**, không hỏi **tên hàm cổng** — nên một cổng thứ ba đúng cặp vẫn qua, còn
 * một cổng sai cặp thì không, dù nó tên gì.
 *
 * ⚠ Quét theo **AST**, không so chuỗi: một chú thích chứa `requirePermission("machine_control",
 * "canView")` phải **KHÔNG** cứu được một call-site trần.
 * ⚠ Bám **alias nhập khẩu**: `import { buildVramAgentState as x }` rồi gọi `x()` vẫn bị bắt.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** `server/services/vram` → `server`. Neo theo vị trí file test, không theo `process.cwd()`. */
const SERVER_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/** ĐÚNG cặp phải có. Đổi một trong hai vế ⇒ mọi call-site đỏ. */
const MODULE_PHAI_CO = "machine_control";
const HANH_DONG_PHAI_CO = "canView";

/** Tên hàm mang dữ liệu — thứ mà lưới đi theo. */
const HAM_MANG_DU_LIEU = "buildVramAgentState";

function moiFileSanXuat(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      moiFileSanXuat(full, out);
      continue;
    }
    if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name) || /\.d\.ts$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

function moiNut(sf: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = [];
  const di = (n: ts.Node) => {
    out.push(n);
    n.forEachChild(di);
  };
  sf.forEachChild(di);
  return out;
}

/**
 * ⚠ m2-1 — **CHUẨN HOÁ DẤU GẠCH TRƯỚC KHI RÚT GỌN.** `path.join()` trả `\` trên Windows còn
 * `sf.fileName` của TypeScript luôn là `/` ⇒ phép `replace` không khớp và con trỏ in ra nguyên
 * đường dẫn tuyệt đối. Con trỏ vẫn đúng, nhưng một con trỏ khó đọc là một con trỏ ít được đọc.
 */
function chuanHoa(p: string): string {
  return p.replace(/\\/g, "/");
}

function viTri(sf: ts.SourceFile, n: ts.Node): string {
  const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
  return `${chuanHoa(sf.fileName).replace(chuanHoa(SERVER_ROOT), "server")}:${line + 1}`;
}

/** Tên CỤC BỘ mà file này gán cho `buildVramAgentState` (theo dõi cả `as` alias). */
function tenCucBo(sf: ts.SourceFile): Set<string> {
  const ten = new Set<string>();
  for (const n of moiNut(sf)) {
    if (!ts.isImportDeclaration(n)) continue;
    const clause = n.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const el of clause.namedBindings.elements) {
      const goc = el.propertyName?.text ?? el.name.text;
      if (goc === HAM_MANG_DU_LIEU) ten.add(el.name.text);
    }
  }
  // File ĐỊNH NGHĨA nó (không nhập) cũng phải được tính — nếu nó tự gọi chính mình ra một mặt đọc.
  for (const n of moiNut(sf)) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === HAM_MANG_DU_LIEU) ten.add(HAM_MANG_DU_LIEU);
  }
  return ten;
}

/** Chuỗi literal của một đối số, hoặc `null` nếu không phải literal. */
function chuoi(n: ts.Node | undefined): string | null {
  if (n === undefined) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

/**
 * Mọi cặp `(module, action)` xuất hiện trong một **CÂY CON** — với `requirePermission(m, a)` (hai
 * đối đầu) và `checkPermission(uid, role, m, a)` (hai đối CUỐI). Chỉ đọc lời gọi THẬT trên cây.
 */
function capTrongCay(sf: ts.SourceFile, goc: ts.Node): string[] {
  const cap: string[] = [];
  const di = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const ten = n.expression.getText(sf);
      const a = n.arguments;
      if (/(^|\.)requirePermission$/.test(ten) && a.length >= 2) {
        const m = chuoi(a[0]);
        const act = chuoi(a[1]);
        if (m !== null && act !== null) cap.push(`${m}/${act}`);
      } else if (/(^|\.)checkPermission$/.test(ten) && a.length >= 4) {
        const m = chuoi(a[a.length - 2]);
        const act = chuoi(a[a.length - 1]);
        if (m !== null && act !== null) cap.push(`${m}/${act}`);
      }
    }
    n.forEachChild(di);
  };
  di(goc);
  return cap;
}

/** Khai báo `const X = …` cùng file (để mở một bí danh thủ tục như `vramReadProcedure`). */
function khaiBaoCua(sf: ts.SourceFile, ten: string): ts.Node | null {
  for (const n of moiNut(sf)) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ten && n.initializer) {
      return n.initializer;
    }
  }
  return null;
}

/**
 * Với một lời gọi `buildVramAgentState()`, trả về **mọi cặp quyền canh được nó**.
 *
 * Đi LÊN từ chính lời gọi (đường thoát), dừng ở ranh giới gần nhất có nghĩa:
 *  • gặp `….query(…)` / `….mutation(…)` / `….subscription(…)` ⇒ mở **biểu thức thủ tục** (và một
 *    nấc bí danh `const` cùng file) rồi lấy cặp từ đó;
 *  • gặp một khai báo hàm/phương thức ⇒ lấy cặp trong **thân hàm** đó (khuôn của tool).
 */
function capCanhLoiGoi(sf: ts.SourceFile, goi: ts.Node): string[] {
  const cap: string[] = [];
  let cur: ts.Node | undefined = goi;
  while (cur !== undefined) {
    if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
      const ten = cur.expression.name.text;
      if (ten === "query" || ten === "mutation" || ten === "subscription") {
        const thuTuc = cur.expression.expression;
        cap.push(...capTrongCay(sf, thuTuc));
        // Một nấc bí danh: `const vramReadProcedure = protectedProcedure.use(requirePermission(…))`.
        if (ts.isIdentifier(thuTuc)) {
          const kb = khaiBaoCua(sf, thuTuc.text);
          if (kb !== null) cap.push(...capTrongCay(sf, kb));
        }
        return cap;
      }
    }
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isPropertyAssignment(cur)
    ) {
      cap.push(...capTrongCay(sf, cur));
      if (cap.length > 0) return cap;
    }
    cur = cur.parent;
  }
  return cap;
}

interface DiemDoc {
  readonly viTri: string;
  readonly cap: string[];
}

function quet(): DiemDoc[] {
  const diem: DiemDoc[] = [];
  for (const file of moiFileSanXuat(SERVER_ROOT)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes(HAM_MANG_DU_LIEU)) continue; // lọc rẻ trước khi dựng AST
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const ten = tenCucBo(sf);
    if (ten.size === 0) continue;
    for (const n of moiNut(sf)) {
      if (!ts.isCallExpression(n)) continue;
      if (!ts.isIdentifier(n.expression) || !ten.has(n.expression.text)) continue;
      diem.push({ viTri: viTri(sf, n), cap: capCanhLoiGoi(sf, n) });
    }
  }
  return diem;
}

describe("I-1 — MỌI mặt đọc `buildVramAgentState()` đứng sau ĐÚNG CẶP (machine_control, canView)", () => {
  it("★★★ có ÍT NHẤT hai mặt đọc thật — lưới rỗng là lưới xanh vì không tìm thấy gì", () => {
    // ⚠ Nếu phép quét ngừng tìm thấy call-site (đổi tên hàm, đổi cấu trúc thư mục), mọi khẳng định
    // dưới đây thành chân lý rỗng. Ca này là cầu chì cho chính phép quét.
    const diem = quet();
    expect(diem.length, "phép quét không thấy call-site nào ⇒ LƯỚI ĐANG MÙ").toBeGreaterThanOrEqual(2);
  });

  it("★★★ KHÔNG call-site nào thiếu cổng, và KHÔNG call-site nào đứng sau một cặp KHÁC", () => {
    const mong = `${MODULE_PHAI_CO}/${HANH_DONG_PHAI_CO}`;
    const viPham: string[] = [];
    for (const d of quet()) {
      if (d.cap.length === 0) {
        viPham.push(`${d.viTri} — KHÔNG có cổng quyền nào canh lời gọi này (cần ${mong})`);
        continue;
      }
      if (!d.cap.includes(mong)) {
        viPham.push(`${d.viTri} — cổng canh nó là [${d.cap.join(", ")}], KHÔNG phải ${mong}`);
      }
    }
    // ⚠ Thông điệp phải CHỈ ĐƯỜNG: file:dòng của đúng chỗ phải sửa, và cặp đang sai là gì.
    expect(viPham, `mặt đọc VRAM không đủ cổng:\n  ${viPham.join("\n  ")}`).toEqual([]);
  });

  it("★★ hai bề mặt đã biết (router tRPC + tool Agent) đều có mặt trong kết quả quét", () => {
    const duong = quet().map((d) => d.viTri);
    expect(duong.some((v) => v.includes("routers/vramRouter.ts")), duong.join(" | ")).toBe(true);
    expect(duong.some((v) => v.includes("aiLocalTools/vramTools.ts")), duong.join(" | ")).toBe(true);
  });
});
