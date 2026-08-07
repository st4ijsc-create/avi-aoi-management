/**
 * ★★★ Pha 7 Task 2 — **CHẶNG CUỐI: MỌI Ô TRÊN MẶT ĐỌC VRAM PHẢI CÓ NGƯỜI ĐỌC THẬT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ KHUÔN CHUNG mà review TOÀN NHÁNH Pha 6 gọi tên (chỉ ghép cả nhánh mới thấy)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * *"Task 1, 2 và 5 ĐỀU dừng lời khai ở **BIÊN PAYLOAD** và đều gọi đó là 'tới được người đọc'.
 * Chặng cuối — payload **RA MÀN HÌNH** — không task nào nhận."*
 *
 * Hai hệ quả **đo được** của khuôn ấy: `truncatedIdentityWrites` (Task 5) **0 điểm đọc**;
 * `notAnInvariant`/`variesWith`/`beforeAfterEvidence` (Task 2) **424 B/lượt · ≈298 KiB/giờ/panel ·
 * 0 lượt đọc**. Cả hai đã được vá **theo TỪNG Ô** — và đó chính là chỗ lưới này tồn tại: vá theo ô
 * thì **luôn có ô thứ N+1** (lớp lỗi đã tái diễn **MƯỜI LĂM** lần trong chuỗi pha này).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐẢO LƯỢNG TỪ — LUẬT, KHÔNG PHẢI DANH SÁCH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *     ***∀ ô lá của `VramAgentState`: ô ấy PHẢI có một NGƯỜI ĐỌC THẬT.***
 *
 * Và **"người đọc thật"** có định nghĩa **CHẶT**, vì chính định nghĩa lỏng là cái đẻ ra khuôn trên:
 *   • **NGƯỜI** — bị đọc trong mã render của một màn thật (`VramBrokerPanel` · `AIBrainDashboard`),
 *     kể cả gián tiếp qua các hàm `translateVram*` mà mã ấy gọi; **hoặc**
 *   • **AGENT** — bị đọc trên đường dựng **`textSummary`** (tham số của `tomTat()` ở
 *     `vramTools.ts`), kể cả gián tiếp qua `catSach()`/`H()`.
 * ⚠⚠ **"CÓ MẶT TRONG PAYLOAD" KHÔNG TÍNH.** Agent **chỉ nhận `textSummary`** — đo hai lần độc lập:
 *   `aiLocalKnowledgeService.ts:2070` / `:2351` (đường stream) / `:2396`. Một ô chỉ nằm ở
 *   `data.state` thì Agent **KHÔNG BAO GIỜ** thấy. Vì thế gốc của phép quét mặt Agent là **tham số
 *   của `tomTat()`**, KHÔNG phải biến `state` mà `handler` gán vào `data.state`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HAI CẦU CHÌ CHỐNG "LƯỚI MÙ" (bài học: glob rỗng ⇒ vitest im lặng khai XANH, **bốn** lần)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **Gốc phải tìm thấy** ở CẢ HAI bề mặt — không tìm thấy ⇒ ĐỎ, chứ không phải "0 vi phạm".
 *   2. **Tập ô và tập đọc phải không rỗng** và đủ lớn — nếu bộ quét hỏng, mọi khẳng định dưới là
 *      **chân lý rỗng**.
 * ⚠ Và một cầu chì thứ ba, tinh vi hơn: **mỗi đường ĐỌC phải khớp một ô có thật** (`docLac`). Một
 *   bộ quét trả về `"headroom.effective.bytesAtReadMsX"` sẽ "phủ" 0 ô mà không ai biết.
 *
 * ⚠ **PHẠM VI ĐƯỢC NÓI THẲNG, KHÔNG HỨA QUÁ:** lưới này chứng minh *"có một ĐIỂM ĐỌC SẢN PHẨM"*.
 * Repo có **0** file `*.test.tsx` (không harness render), nên *"pixel ấy đã lên màn"* nằm ngoài
 * tầm mọi lưới hôm nay — một ô **còn mở**, không phải một ô được coi là đã đóng.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { vramStateLeafPaths } from "./vramStateFieldPaths";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/services/vram
const GOC = join(TEST_DIR, "..", "..", ".."); // gốc repo

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HAI BỀ MẶT — **ĐƯỜNG DẪN TƯỜNG MINH**, và mỗi đường bị kiểm TỒN TẠI trước khi tin
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Mặt **AGENT**: gốc là tham số của `tomTat()` — tức **chỉ** thứ đi vào `textSummary`. */
const MAT_AGENT = "server/services/aiLocalTools/vramTools.ts";
/** Mặt **NGƯỜI**: gốc là `const s = <query>.data` với `<query> = trpc.vram.state.useQuery(...)`. */
const MAT_NGUOI = ["client/src/components/ai/VramBrokerPanel.tsx", "client/src/pages/AIBrainDashboard.tsx"];

/** Đoạn cuối là **TÊN PHƯƠNG THỨC**, không phải một nút dữ liệu (`x.map` ⇒ nút là `x`). */
const PHUONG_THUC =
  /^(map|filter|join|length|some|every|slice|includes|find|sort|flatMap|toFixed|toLocaleString|forEach|at|reduce|concat|indexOf|entries|keys|values)$/;

const CACHE = new Map<string, ts.SourceFile>();
function ast(rel: string): ts.SourceFile {
  const co = CACHE.get(rel);
  if (co !== undefined) return co;
  const f = join(GOC, rel);
  const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  CACHE.set(rel, sf);
  return sf;
}
function moiNut(sf: ts.SourceFile): ts.Node[] {
  const ra: ts.Node[] = [];
  const di = (n: ts.Node): void => {
    ra.push(n);
    n.forEachChild(di);
  };
  sf.forEachChild(di);
  return ra;
}

/** Chuỗi `a.b.c` (bỏ `!`, `(...)`, `as T`) → `{goc, doan}`. */
function chuoi(n: ts.Node): { goc: ts.Node; doan: string[] } {
  const doan: string[] = [];
  let cur: ts.Node = n;
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) {
      doan.unshift(cur.name.text);
      cur = cur.expression;
    } else if (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur)) {
      cur = cur.expression;
    } else break;
  }
  return { goc: cur, doan };
}

/**
 * `@/x` → `client/src/x` · `@shared/x` → `shared/x` · tương đối → theo file gọi.
 * ⚠ Vì sao cần: `translateVramTruncatedNotice()` / `translateVramNonFiniteFields()` đọc
 * `.truncated` / `.rawLength` / `.path` / `.was` **trong `client/src/lib/errorCodes.ts`**, không
 * trong panel. Một bộ quét dừng ở biên FILE sẽ khai oan 5 ô là *"không ai đọc"* — đúng lớp lỗi
 * *"đo bằng công cụ khác công cụ đang chạy"*.
 */
function giaiModule(tuFile: string, spec: string): string | null {
  let p: string;
  if (spec.startsWith("@/")) p = join("client", "src", spec.slice(2));
  else if (spec.startsWith("@shared/")) p = join("shared", spec.slice(8));
  else if (spec.startsWith(".")) p = resolve(dirname(join(GOC, tuFile)), spec).slice(GOC.length + 1);
  else return null;
  const chuanHoa = p.split(sep).join("/");
  for (const duoi of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(join(GOC, chuanHoa + duoi))) return chuanHoa + duoi;
  }
  return null;
}

interface Rang {
  readonly file: string;
  readonly ten: string;
  readonly duong: string;
  readonly tu: number;
  readonly den: number;
}
interface HatGiong {
  readonly file: string;
  readonly ten: string;
  readonly nut: ts.Node;
  readonly sf: ts.SourceFile;
}

interface KetQua {
  readonly doc: Set<string>;
  readonly rang: readonly Rang[];
}

/**
 * ★★★ **BỘ QUÉT NGƯỜI ĐỌC.** Ràng buộc **CÓ PHẠM VI** (`tu`/`den`) chứ không theo tên trần: cùng
 * một chữ `h` là hộ giữ chỗ ở vòng lặp này và hộ nền ở vòng lặp kia; một bảng alias không phạm vi
 * trộn chúng lại và **khai khống** ~20 ô là "đã có người đọc". Đo được trong lúc dựng lưới này.
 */
function quetNguoiDoc(hatGiong: readonly HatGiong[]): KetQua {
  const rang: Rang[] = [];
  const daCo = new Set<string>();
  const themRang = (file: string, ten: string, duong: string, pv: ts.Node, sf: ts.SourceFile): boolean => {
    const tu = pv.getStart(sf);
    const den = pv.getEnd();
    const k = `${file}#${ten}#${duong}#${tu}`;
    if (daCo.has(k)) return false;
    daCo.add(k);
    rang.push({ file, ten, duong, tu, den });
    return true;
  };
  for (const h of hatGiong) themRang(h.file, h.ten, "", h.nut, h.sf);

  /** Ràng buộc TRONG NHẤT bao quanh vị trí này. */
  const co = (file: string, ten: string, viTri: number): Set<string> => {
    const ung = rang.filter((b) => b.file === file && b.ten === ten && viTri >= b.tu && viTri <= b.den);
    if (ung.length === 0) return new Set();
    const trong = Math.max(...ung.map((b) => b.tu));
    return new Set(ung.filter((b) => b.tu === trong).map((b) => b.duong));
  };

  interface Mod {
    readonly sf: ts.SourceFile;
    readonly nut: ts.Node[];
    readonly ham: Map<string, { params: ts.NodeArray<ts.ParameterDeclaration>; than: ts.Node; sf: ts.SourceFile }>;
    readonly nhap: Map<string, { file: string; ten: string }>;
  }
  const MOD = new Map<string, Mod>();
  function nap(file: string): Mod {
    const co2 = MOD.get(file);
    if (co2 !== undefined) return co2;
    const sf = ast(file);
    const nut = moiNut(sf);
    const ham = new Map<string, { params: ts.NodeArray<ts.ParameterDeclaration>; than: ts.Node; sf: ts.SourceFile }>();
    const nhap = new Map<string, { file: string; ten: string }>();
    for (const n of nut) {
      if (ts.isFunctionDeclaration(n) && n.name !== undefined) {
        ham.set(n.name.text, { params: n.parameters, than: n, sf });
      }
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer !== undefined &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
      ) {
        ham.set(n.name.text, { params: n.initializer.parameters, than: n.initializer, sf });
      }
      if (
        ts.isImportDeclaration(n) &&
        n.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(n.importClause.namedBindings) &&
        ts.isStringLiteral(n.moduleSpecifier)
      ) {
        const dich = giaiModule(file, n.moduleSpecifier.text);
        if (dich !== null) {
          for (const el of n.importClause.namedBindings.elements) {
            nhap.set(el.name.text, { file: dich, ten: (el.propertyName ?? el.name).text });
          }
        }
      }
    }
    const m: Mod = { sf, nut, ham, nhap };
    MOD.set(file, m);
    return m;
  }

  function giai(file: string, sf: ts.SourceFile, e: ts.Node | undefined, viTri: number): Set<string> {
    const ra = new Set<string>();
    if (e === undefined) return ra;
    if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) {
      return giai(file, sf, e.expression, viTri);
    }
    if (ts.isConditionalExpression(e)) {
      for (const x of giai(file, sf, e.whenTrue, viTri)) ra.add(x);
      for (const x of giai(file, sf, e.whenFalse, viTri)) ra.add(x);
      return ra;
    }
    if (
      ts.isBinaryExpression(e) &&
      (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      for (const x of giai(file, sf, e.left, viTri)) ra.add(x);
      for (const x of giai(file, sf, e.right, viTri)) ra.add(x);
      return ra;
    }
    if (ts.isArrayLiteralExpression(e)) {
      for (const el of e.elements) if (ts.isSpreadElement(el)) for (const x of giai(file, sf, el.expression, viTri)) ra.add(x);
      return ra;
    }
    if (ts.isIdentifier(e)) return co(file, e.text, viTri);
    if (ts.isPropertyAccessExpression(e)) {
      const { goc, doan } = chuoi(e);
      const nen = ts.isIdentifier(goc) ? co(file, goc.text, viTri) : giai(file, sf, goc, viTri);
      for (const b of nen) ra.add([b, ...doan].filter((x) => x !== "").join("."));
      return ra;
    }
    // `X.map(...)` / `X.filter(...)` giữ nguyên tập của `X` (mảng ⇒ mảng).
    if (
      ts.isCallExpression(e) &&
      ts.isPropertyAccessExpression(e.expression) &&
      /^(map|filter|slice|concat|sort)$/.test(e.expression.name.text)
    ) {
      return giai(file, sf, e.expression.expression, viTri);
    }
    return ra;
  }

  for (const h of hatGiong) nap(h.file);

  // Điểm bất động: biến trung gian · `for…of` · callback của `.map`/… · **THAM SỐ HÀM** (xuyên file).
  for (let vong = 0; vong < 8; vong++) {
    let doi = false;
    for (const file of [...MOD.keys()]) {
      const m = MOD.get(file)!;
      for (const n of m.nut) {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
          let pv: ts.Node | undefined = n.parent;
          while (pv !== undefined && !ts.isBlock(pv) && !ts.isSourceFile(pv)) pv = pv.parent;
          for (const d of giai(file, m.sf, n.initializer, n.getStart(m.sf))) {
            if (themRang(file, n.name.text, d, pv ?? m.sf, m.sf)) doi = true;
          }
        }
        if (ts.isForOfStatement(n)) {
          const decl = n.initializer;
          if (
            ts.isVariableDeclarationList(decl) &&
            decl.declarations[0] !== undefined &&
            ts.isIdentifier(decl.declarations[0].name)
          ) {
            const ten = decl.declarations[0].name.text;
            for (const d of giai(file, m.sf, n.expression, n.getStart(m.sf))) {
              if (themRang(file, ten, `${d}[]`, n, m.sf)) doi = true;
            }
          }
        }
        if (!ts.isCallExpression(n)) continue;
        if (
          ts.isPropertyAccessExpression(n.expression) &&
          /^(map|forEach|filter|find|some|every|flatMap)$/.test(n.expression.name.text)
        ) {
          const nguon = giai(file, m.sf, n.expression.expression, n.getStart(m.sf));
          const cb = n.arguments[0];
          if (
            cb !== undefined &&
            (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
            cb.parameters[0] !== undefined &&
            ts.isIdentifier(cb.parameters[0].name)
          ) {
            const ten = cb.parameters[0].name.text;
            for (const d of nguon) if (themRang(file, ten, `${d}[]`, cb, m.sf)) doi = true;
          }
        }
        // Gọi một HÀM (cùng file **hoặc NHẬP KHẨU**) ⇒ ràng tham số vào thân hàm ấy.
        if (ts.isIdentifier(n.expression)) {
          const ten = n.expression.text;
          let dich = m.ham.get(ten);
          let fileDich = file;
          const nh = m.nhap.get(ten);
          if (dich === undefined && nh !== undefined) {
            dich = nap(nh.file).ham.get(nh.ten);
            fileDich = nh.file;
          }
          if (dich === undefined) continue;
          n.arguments.forEach((arg, i) => {
            const p = dich!.params[i];
            if (p === undefined || !ts.isIdentifier(p.name)) return;
            for (const d of giai(file, m.sf, arg, n.getStart(m.sf))) {
              if (themRang(fileDich, p.name.text, d, dich!.than, dich!.sf)) doi = true;
            }
          });
        }
      }
    }
    if (!doi) break;
  }

  const doc = new Set<string>();
  for (const file of MOD.keys()) {
    const m = MOD.get(file)!;
    for (const n of m.nut) {
      if (!ts.isPropertyAccessExpression(n)) continue;
      if (ts.isPropertyAccessExpression(n.parent)) continue; // chỉ lấy chuỗi DÀI NHẤT
      const { goc, doan } = chuoi(n);
      if (!ts.isIdentifier(goc)) continue;
      for (const b of co(file, goc.text, n.getStart(m.sf))) {
        const cuoi = doan[doan.length - 1];
        const dd = cuoi !== undefined && PHUONG_THUC.test(cuoi) ? doan.slice(0, -1) : doan;
        // Đọc `a.b.c` ⇒ đã CHẠM `a.b` — ghi cả mọi tiền tố.
        for (let i = 1; i <= dd.length; i++) {
          const d = [b, ...dd.slice(0, i)].filter((x) => x !== "").join(".");
          if (d !== "") doc.add(d);
        }
      }
    }
  }
  return { doc, rang };
}

// ── HẠT GIỐNG: **AGENT** = tham số của `tomTat()`, KHÔNG phải `data.state` ────────────────────
function hatAgent(): HatGiong[] {
  const sf = ast(MAT_AGENT);
  const ra: HatGiong[] = [];
  for (const n of moiNut(sf)) {
    if (
      ts.isFunctionDeclaration(n) &&
      n.name?.text === "tomTat" &&
      n.parameters[0] !== undefined &&
      ts.isIdentifier(n.parameters[0].name)
    ) {
      ra.push({ file: MAT_AGENT, ten: n.parameters[0].name.text, nut: n, sf });
    }
  }
  return ra;
}

// ── HẠT GIỐNG: **NGƯỜI** = `const s = <query>.data`, `<query>` là `trpc.vram.state.useQuery` ──
function hatNguoi(): HatGiong[] {
  const ra: HatGiong[] = [];
  for (const file of MAT_NGUOI) {
    const sf = ast(file);
    const nut = moiNut(sf);
    const bienQuery = new Set<string>();
    for (const n of nut) {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer !== undefined &&
        ts.isCallExpression(n.initializer) &&
        /trpc\.vram\.state\.useQuery/.test(n.initializer.expression.getText(sf))
      ) {
        bienQuery.add(n.name.text);
      }
    }
    for (const n of nut) {
      if (!ts.isVariableDeclaration(n) || n.initializer === undefined || !ts.isIdentifier(n.name)) continue;
      const kt = n.initializer;
      if (!ts.isPropertyAccessExpression(kt) || kt.name.text !== "data") continue;
      if (!ts.isIdentifier(kt.expression) || !bienQuery.has(kt.expression.text)) continue;
      let pv: ts.Node | undefined = n.parent;
      while (pv !== undefined && !ts.isBlock(pv) && !ts.isSourceFile(pv)) pv = pv.parent;
      ra.push({ file, ten: n.name.text, nut: pv ?? sf, sf });
    }
  }
  return ra;
}

const O = [...vramStateLeafPaths()].sort();
const AGENT = quetNguoiDoc(hatAgent());
const NGUOI = quetNguoiDoc(hatNguoi());

/** Ô có người đọc ⇔ có ít nhất một bề mặt đọc **đúng đường ấy**. */
function nguoiDocCua(o: string): string[] {
  const ra: string[] = [];
  if (AGENT.doc.has(o)) ra.push("AGENT(textSummary)");
  if (NGUOI.doc.has(o)) ra.push("NGƯỜI(màn hình)");
  return ra;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §0 — CẦU CHÌ: một lưới MÙ khai "0 vi phạm" y hệt một lưới ĐẠT
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §0 cầu chì — bộ quét phải THẬT SỰ nhìn thấy cả hai bề mặt", () => {
  it("★★★ mọi đường của hai bề mặt TỒN TẠI trên đĩa (một đường gõ sai là một bề mặt vitest bỏ qua)", () => {
    for (const f of [MAT_AGENT, ...MAT_NGUOI]) {
      expect(existsSync(join(GOC, f)), `KHÔNG có trên đĩa: ${f}`).toBe(true);
    }
  });

  it("★★★ tìm được GỐC ở CẢ HAI bề mặt — không tìm thấy ⇒ mọi khẳng định dưới là chân lý rỗng", () => {
    expect(
      hatAgent().length,
      "không thấy `tomTat(s, lang)` ở vramTools.ts ⇒ mặt AGENT đang KHÔNG được đo (và Agent CHỈ nhận textSummary)",
    ).toBe(1);
    // Hai màn, mỗi màn một biến payload.
    expect(
      hatNguoi().map((h) => `${h.file}#${h.ten}`).join(" · "),
      "không thấy `const s = <trpc.vram.state.useQuery(...)>.data` ⇒ mặt NGƯỜI đang KHÔNG được đo",
    ).not.toBe("");
    expect(new Set(hatNguoi().map((h) => h.file)).size, "phải đo ĐỦ hai màn người").toBe(MAT_NGUOI.length);
  });

  it("★★★ hai tập KHÔNG rỗng và đủ lớn (bộ quét hỏng ⇒ 0 đường ⇒ 108 ô 'không ai đọc' — không phải 0)", () => {
    expect(O.length, "bộ liệt kê ô TỪ KIỂU không rút được gì").toBeGreaterThanOrEqual(90);
    expect(AGENT.doc.size, "mặt AGENT đọc 0 đường ⇒ bộ quét hỏng").toBeGreaterThanOrEqual(60);
    expect(NGUOI.doc.size, "mặt NGƯỜI đọc 0 đường ⇒ bộ quét hỏng").toBeGreaterThanOrEqual(40);
  });

  it("★★★ MỌI đường ĐỌC phải khớp một ô CÓ THẬT — một bộ quét lệch tên 'phủ' 0 ô mà vẫn xanh", () => {
    /**
     * ⚠ Cầu chì tinh vi nhất của file này. Nó **KHÔNG** đòi đọc-hết; nó đòi mọi đường bộ quét phát
     * ra phải **tồn tại trong kiểu** (là một lá, hoặc một NÚT trung gian của một lá). Một lượt đổi
     * tên ở `vramReadModel.ts` mà quên đổi ở người đọc ⇒ đường ấy thành **CON TRỎ CHẾT** và luật
     * chính vẫn đỏ; nhưng chiều ngược — bộ quét tự sinh ra rác — thì **chỉ ca này** bắt được.
     */
    const nut = new Set<string>();
    for (const o of O) {
      const doan = o.split(".");
      for (let i = 1; i <= doan.length; i++) {
        const d = doan.slice(0, i).join(".");
        nut.add(d);
        // ⚠ `defer.hosts[]` là phần tử; `defer.hosts` là **chính mảng** — người đọc chạm cả hai
        //   (`s.defer.hosts.map(...)`), nên cả hai đều là NÚT có thật.
        nut.add(d.replace(/\[\]$/, ""));
      }
    }
    const lac = [...AGENT.doc, ...NGUOI.doc].filter((d) => !nut.has(d)).sort();
    expect(
      lac.join("\n"),
      "bộ quét phát ra một đường KHÔNG có trong kiểu `VramAgentState` ⇒ nó đang 'phủ' một ô không tồn tại",
    ).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §1 — LUẬT: ∀ ô ⇒ có NGƯỜI ĐỌC THẬT. Không có lựa chọn thứ ba (luật Task 4 Pha 4).
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §1 — MỌI ô của mặt đọc VRAM phải có NGƯỜI ĐỌC THẬT (hoặc bị XOÁ)", () => {
  it("★★★ 0 ô có-người-ghi-mà-không-ai-đọc", () => {
    const khong = O.filter((o) => nguoiDocCua(o).length === 0);
    expect(
      khong.map((o) => `  ✗ ${o}`).join("\n"),
      "Những ô này đi trên dây MỖI LƯỢT `vram.state` mà KHÔNG người đọc nào nhận.\n" +
        "Luật (Task 4 Pha 4): **NGƯỜI ĐỌC THẬT hoặc BỊ XOÁ** — không có lựa chọn thứ ba.\n" +
        "• người đọc thật = hiện cho NGƯỜI trên màn, HOẶC vào `textSummary` cho Agent;\n" +
        "• 'có mặt trong payload' KHÔNG tính — Agent CHỈ nhận `textSummary`\n" +
        "  (aiLocalKnowledgeService.ts:2070 / :2351 / :2396, đo hai lần độc lập).\n" +
        "⇒ Thêm một điểm đọc ở `vramTools.tomTat()` (mặt Agent) hoặc ở mã render của panel,\n" +
        "   hoặc XOÁ ô khỏi `VramAgentState`.",
    ).toBe("");
  });

  it("★★ mặt AGENT phải phủ ÍT NHẤT bằng mặt NGƯỜI (Agent là mặt rộng hơn, và là mặt không ai nhìn)", () => {
    /**
     * ⚠ Vì sao đây là một luật chứ không phải một quan sát: mặt NGƯỜI có người **ngồi trước màn**
     * và sẽ kêu khi thiếu; mặt AGENT thì **không ai kêu** — một ô rơi khỏi `textSummary` hỏng theo
     * chiều **IM LẶNG**. Nếu một ngày mặt người đọc một ô mà mặt Agent không, ca này chỉ đường tới
     * đúng chỗ phải vá.
     */
    const chiNguoi = O.filter((o) => NGUOI.doc.has(o) && !AGENT.doc.has(o));
    expect(
      chiNguoi.join("\n"),
      "ô hiện trên màn NGƯỜI mà KHÔNG vào `textSummary` ⇒ Agent quyết định mà thiếu đúng ô người đang nhìn",
    ).toBe("");
  });

  it("★★★ ĐỐI CHỨNG — luật KHÔNG phải chân lý rỗng: có ô đọc bởi CẢ HAI và có ô CHỈ mặt Agent", () => {
    const caHai = O.filter((o) => nguoiDocCua(o).length === 2);
    const chiAgent = O.filter((o) => AGENT.doc.has(o) && !NGUOI.doc.has(o));
    expect(caHai.length, "0 ô nào được cả hai đọc ⇒ một trong hai bộ quét đang mù").toBeGreaterThanOrEqual(20);
    expect(chiAgent.length, "0 ô chỉ-Agent ⇒ hai tập trùng khít một cách đáng ngờ").toBeGreaterThanOrEqual(10);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §2 — BA Ô CỦA PHA 6 TASK 2 + Ô CỦA TASK 5: **neo ĐÍCH DANH**, để một lượt hoàn nguyên có TÊN
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §2 — bốn ô mà review TOÀN NHÁNH đã đo là '0 lượt đọc' phải ở lại có người đọc", () => {
  /**
   * ⚠⚠ **Ca này KHÔNG thay §1, và cũng không phải một danh sách cạnh tranh với nó.** §1 là lượng
   * từ; ca này là **CON TRỎ ĐÍCH DANH**: khi ai đó gỡ một điểm đọc, §1 nói *"ô X không ai đọc"*
   * còn ca này nói thêm *"và đó chính là ô mà review Pha 6 đã đo được 424 B/lượt · 0 lượt đọc"*.
   * Một ca đỏ có **lịch sử** thì người sau không vá bằng cách xoá ô đi cho nhanh.
   */
  const NEO: readonly { readonly o: string; readonly viSao: string }[] = [
    { o: "headroom.effective.notAnInvariant", viSao: "Pha 6 Task 2 — 424 B/lượt · 0 lượt đọc" },
    { o: "headroom.effective.variesWith", viSao: "Pha 6 Task 2 — 424 B/lượt · 0 lượt đọc" },
    { o: "headroom.effective.beforeAfterEvidence", viSao: "Pha 6 Task 2 — 424 B/lượt · 0 lượt đọc" },
    { o: "ledger.foreign.truncatedIdentityWrites", viSao: "Pha 6 Task 5 — 0 điểm đọc ở client/** và vramTools.ts" },
  ];

  for (const { o, viSao } of NEO) {
    it(`★★★ ${o} — có người đọc THẬT (${viSao})`, () => {
      expect(O, `${o} không còn trong kiểu — nếu XOÁ cố ý thì gỡ luôn mục này khỏi NEO`).toContain(o);
      expect(nguoiDocCua(o).join(" + "), `${o}: quay lại 0 người đọc`).not.toBe("");
    });
  }

  it("★★★ `beforeAfterEvidence` phải TỚI ĐƯỢC mặt Agent — tức nội dung nó phải ASCII", () => {
    /**
     * ⚠⚠ Đây là **điều kiện tồn tại** của người đọc ấy, không phải một sở thích chính tả:
     * `vramPhrases.exhaustive.test.ts` §C cưỡng chế *"`lang=en` ⇒ không một chữ phi-ASCII"* và
     * *"`lang=zh` ⇒ không một dấu tiếng Việt"*. Một câu tiếng Việt trong ô này thì **không có cách
     * nào** vào `textSummary` của hai ngôn ngữ ấy ⇒ ô lại về 0 người đọc ở 2/3 phiên.
     */
    const src = readFileSync(join(GOC, "server/services/vram/vramReadModel.ts"), "utf8");
    const khoi = src.slice(src.indexOf("export const VRAM_BEFORE_AFTER_EVIDENCE"));
    const cau = khoi.slice(0, khoi.indexOf(";"));
    expect(cau.length, "không tìm thấy hằng `VRAM_BEFORE_AFTER_EVIDENCE`").toBeGreaterThan(40);
    expect(/^[\x20-\x7E\r\n]+$/.test(cau), `hằng chứa ký tự phi-ASCII ⇒ nó rơi khỏi textSummary en/zh:\n${cau}`).toBe(
      true,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §3 — CÔNG CỤ CỦA LƯỚI KHÔNG ĐƯỢC RÒ VÀO ĐỒ THỊ NHẬP SẢN XUẤT
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★ §3 — `vramStateFieldPaths.ts` là công cụ của LƯỚI, không phải mã sản xuất", () => {
  it("★★ KHÔNG một file sản xuất nào nhập nó (nó kéo theo `typescript` + `node:fs`)", () => {
    /**
     * ⚠ M-6 của Pha 4 đã trả giá đúng lớp này: một lượt nhập vô tình kéo `vramReconciler`
     * (+ `child_process`) vào **đồ thị nạp SỚM của mọi tiến trình**. File công cụ này nặng hơn thế.
     */
    const nhap = quetNhap("vramStateFieldPaths");
    const sanXuat = nhap.filter((f) => !/\.test\.tsx?$/.test(f));
    expect(sanXuat.join("\n"), "một file SẢN XUẤT đang nhập công cụ của lưới").toBe("");
    expect(nhap.length, "không file test nào nhập nó ⇒ nó là mã chết").toBeGreaterThanOrEqual(2);
  });
});

/** `git grep`-lite: file nào có một `import … from "…<ten>"`. Quét đúng ba nhánh Pha 5 chạm tới. */
function quetNhap(ten: string): string[] {
  const ra: string[] = [];
  const re = new RegExp(`from\\s+["'][^"']*${ten}["']`);
  const di = (thuMuc: string): void => {
    if (!existsSync(thuMuc)) return;
    for (const item of readdirSync(thuMuc)) {
      const p = join(thuMuc, item);
      if (statSync(p).isDirectory()) {
        if (item === "node_modules" || item === "dist" || item === ".git") continue;
        di(p);
      } else if (/\.tsx?$/.test(item) && re.test(readFileSync(p, "utf8"))) {
        ra.push(p.slice(GOC.length + 1).split(sep).join("/"));
      }
    }
  };
  for (const nhanh of ["server", join("client", "src"), "shared"]) di(join(GOC, nhanh));
  return ra;
}
