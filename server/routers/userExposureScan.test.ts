/**
 * ★★★ Pha 7 Task 7 / Net 2 — **LƯỢNG TỪ TRÊN TRỤC "BỀ MẶT":**
 * ***∀ điểm trong `server/**` đọc một HÀNG `users` THÔ mà giá trị ấy THOÁT ra khỏi hàm ⇒ nó phải đi
 * qua phép làm sạch của chủ duy nhất (`server/_core/publicUser.ts`).***
 * (Tự khai `Pha 5` để `vramPha5Gate.test.ts` kéo file này vào lượng từ *"mọi lưới tự khai một pha
 *  phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG LIỆT KÊ 5 ĐƯỜNG ĐÃ ĐẾM ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bước 2 đếm được **5 đường đang rò** (`auth.me` · `user.list` · `userAssignment
 * .getAllUserAssignments` · `user.getById` · `user.search`) — và **thứ nguy nhất KHÔNG PHẢI**
 * `auth.me` (cái đang được vá) mà là `user.list`: nó trả hàng thô của **MỌI** người dùng, tức hạt
 * giống 2FA của **cả những admin khác**. Phép đếm-trước-khi-đổi đã lật quyết định **lần thứ SÁU**.
 *
 * Một danh sách 5 tên là một danh sách **có phần tử thứ SÁU**. Nên bất biến được phát biểu ở dạng
 * ∀ trên **CẤU TRÚC**, và cả hai đầu của nó đều được **SUY RA**, không viết tay:
 *
 *  • **Tập người đọc thô** — suy ra bằng cách phân tích chính `server/db/auth.ts`: hàm xuất khẩu nào
 *    có `.select().from(users)` **KHÔNG có phép chiếu cột**. Hôm nay ra **8** hàm; một hàm đọc
 *    **thứ chín** viết ngày mai tự vào lượng từ, không cần ai nhớ sửa file này.
 *  • **Phạm vi quét** — `moiFileDuoi(GOC, "server", [".ts"])` + `laFileTest`, **DÙNG LẠI** bộ suy của
 *    `deployProcedureScan.ts` (đúng §Global Constraints: *"đừng viết bộ suy thứ N+1"*). Một route
 *    **MỚI trong FILE MỚI** nằm trong lượng từ **theo cấu tạo** — đây chính là **phép thử M3**
 *    (*"lưới theo ĐƯỜNG THOÁT, không theo FILE"*, lớp lỗi đã tái diễn 11 lần).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÙNG MÙ ĐƯỢC KHAI (đừng đọc màu xanh của ô này thành "đã phủ hết")
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **Gán vào thuộc tính** (`(req as any).externalUser = user`) **KHÔNG** bị coi là đường thoát.
 *     Đo được ở Bước 2: 5 route REST + 2 route ở `externalInspectionApi.ts` chỉ đọc `.id`/`.role`
 *     từ ô ấy, không bao giờ phát nguyên hàng. Bắt nó sẽ là **bắt nhầm**; phủ nó cần phân tích liên
 *     thủ tục — chi phí vượt giá trị **hôm nay**. Nếu một ngày `req.externalUser` được `res.json`
 *     nguyên hàng, ô này **KHÔNG** thấy.
 *  2. Lan truyền qua **lời gọi hàm khác** (`f(user)` rồi `f` trả nó ra) không được theo dõi.
 *  3. Đường **SQL thô** (`sql\`SELECT * FROM users\``) không được nhận diện — hôm nay repo có **0**
 *     điểm như thế (đã `git grep -niE "select \\*.*from \\"?users"`), nhưng đó là một quan sát theo
 *     thời điểm, không phải một bất biến.
 *
 * ⇒ Vùng mù được **ĐẾM và CÓ TÊN**, không im lặng — đúng khuôn `@KHONG-CONG-2FA` của
 *   `sessionGrantScan.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi, laFileTest } from "./deployProcedureScan";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/routers
const GOC_REPO = join(TEST_DIR, "..", "..");
const DB_AUTH = join(GOC_REPO, "server", "db", "auth.ts");

/**
 * ★★★ PHÉP LÀM SẠCH DUY NHẤT. **Tập ĐÓNG về khái niệm** (chiếu-cho-phép · chiếu-danh-sách ·
 * làm-rỗng-giữ-kiểu), cả ba đều ở `server/_core/publicUser.ts`. Thêm một phép thứ tư là một quyết
 * định kiến trúc phải nói ra — thêm một *đường trả về* thì không được im lặng.
 */
const LAM_SACH = ["toPublicUser", "toPublicUsers", "redactServerOnlyUserFields"] as const;

/** Dấu khai vùng mù có chủ ý, kèm lý do ngay tại chỗ. */
const DAU_MIEN = "@USER-RAW-OK";
/** ★★★ GHIM số lượt miễn đang tồn tại. Hôm nay: **0**. Một lượt miễn mới phải là một quyết định. */
const SO_MIEN = 0;

// ── bộ nhận diện AST dùng chung ────────────────────────────────────────────────────────────────
function nguon(duong: string): ts.SourceFile {
  return ts.createSourceFile(duong, readFileSync(duong, "utf8"), ts.ScriptTarget.Latest, true);
}

function tenLoiGoi(n: ts.CallExpression): string {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
}

function laHam(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n)
  );
}

/** Hàm bao gần nhất của một node (để giới hạn phạm vi phân tích lan truyền). */
function hamBao(n: ts.Node): ts.Node | undefined {
  let cur: ts.Node | undefined = n.parent;
  while (cur && !laHam(cur)) cur = cur.parent;
  return cur;
}

/** Tên hàm bao gần nhất — chỉ để thông báo lỗi trỏ đúng chỗ. */
function tenHamBao(n: ts.Node): string {
  let cur: ts.Node | undefined = n;
  while (cur) {
    if ((ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) && cur.name) return cur.name.getText();
    if (cur.parent && ts.isVariableDeclaration(cur.parent) && cur.parent.name) return cur.parent.name.getText();
    if (cur.parent && ts.isPropertyAssignment(cur.parent) && cur.parent.name) return cur.parent.name.getText();
    if (cur.parent && ts.isCallExpression(cur.parent) && ts.isPropertyAccessExpression(cur.parent.expression)) {
      return cur.parent.expression.name.text; // `.query(async () => …)` → "query"
    }
    cur = cur.parent;
  }
  return "<ẩn danh>";
}

function dong(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}

// ── (1) SUY RA tập người đọc hàng THÔ từ chính `server/db/auth.ts` ─────────────────────────────
/**
 * Một hàm xuất khẩu là **người đọc thô** khi thân nó chứa `.select()` **KHÔNG tham số** nối tới
 * `.from(users)`. `db.select({ id: users.id }).from(users)` (có phép chiếu) **không** tính — đó
 * đúng là hình dạng đã an toàn, và 30 điểm `.from(users)` còn lại trong repo đều thuộc loại này.
 */
function nguoiDocTho(): string[] {
  const sf = nguon(DB_AUTH);
  const ra = new Set<string>();
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && tenLoiGoi(n) === "from" && n.arguments.length === 1) {
      const dich = n.arguments[0]!;
      if (ts.isIdentifier(dich) && dich.text === "users") {
        const truoc = n.expression;
        if (ts.isPropertyAccessExpression(truoc) && ts.isCallExpression(truoc.expression)) {
          const sel = truoc.expression;
          if (tenLoiGoi(sel) === "select" && sel.arguments.length === 0) {
            const h = hamBao(n);
            if (h && ts.isFunctionDeclaration(h) && h.name) ra.add(h.name.text);
          }
        }
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return [...ra].sort();
}

const DOC_THO = nguoiDocTho();

// ── (2) phân tích lan truyền + đường thoát ─────────────────────────────────────────────────────
type ViPham = { duong: string; dong: number; ham: string; bien: string };

/**
 * Identifier này là **dùng TRẦN** — tức **cả đối tượng** đi ra, chứ không phải một trường của nó?
 *
 * ⚠⚠ Ô `user.id` / `user?.email` / `users.length` là **ĐỌC TRƯỜNG**: chỉ một giá trị vô hại rời
 * hàng, không phải hàng. Coi chúng là đường thoát chính là **BẮT NHẦM** — và lưới bắt nhầm là lưới
 * sẽ bị người sau tắt đi. Lượt chạy ĐẦU TIÊN của lưới này bắt nhầm **6 chỗ** đúng vì thiếu nhánh
 * `p.expression === n` dưới đây (`notificationRouters` `users.map(u => u.id)` · `routers.ts`
 * `existingAdmins.length` · `_core/index.ts` `user.lockedUntil.getTime()` · …).
 * ⚠ Lối ra của hàng **qua** `.map()` vẫn được canh — nhưng bằng luật PP_MANG riêng, ở đó phép
 *   nhiễm chỉ lan khi thân hàm gọi lại **trả về chính phần tử**.
 */
function dungTran(n: ts.Identifier): boolean {
  const p = n.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p)) return false; // `a.user` (khoá) hoặc `user.a` (ĐỌC TRƯỜNG)
  if (ts.isElementAccessExpression(p) && p.expression === n) return false; // `user["a"]`
  if (ts.isPropertyAssignment(p) && p.name === n) return false; // `{ user: … }` — KHOÁ
  if (ts.isBindingElement(p) && p.name === n) return false; // tên vừa khai báo
  if (ts.isVariableDeclaration(p) && p.name === n) return false;
  if (ts.isParameter(p) && p.name === n) return false;
  if (ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p)) return false;
  return true;
}

/** Mọi tên được ràng buộc bởi một mẫu khai báo (`x` · `{a, ...rest}` · `[a, b]`). */
function tenRangBuoc(name: ts.BindingName, ra: Set<string>): void {
  if (ts.isIdentifier(name)) ra.add(name.text);
  else for (const el of name.elements) if (ts.isBindingElement(el)) tenRangBuoc(el.name, ra);
}

const PP_MANG = new Set(["map", "filter", "slice", "concat", "flatMap", "flat", "sort", "reverse", "find"]);

/**
 * Phân tích **trong một hàm**: từ tập biến nhiễm ban đầu, chạy tới điểm bất động, rồi tìm mọi
 * **đường thoát** (`return …` / `res.json(…)` / `res.send(…)`) không đi qua phép làm sạch.
 */
function thoatKhoi(than: ts.Node, sf: ts.SourceFile, hatGiong: Set<string>): ts.Node[] {
  const nhiem = new Set(hatGiong);

  /** Node biểu thức mang giá trị nhiễm (kết quả `.map()` nhiễm chẳng hạn). */
  const bieuThucNhiem = new Set<ts.Node>();

  const dungTranNhiem = (n: ts.Node): boolean =>
    ts.isIdentifier(n) && nhiem.has(n.text) && dungTran(n);

  /** Biểu thức này có mang giá trị nhiễm không (một tầng, đủ cho các hình dạng thật trong repo)? */
  function bieuThucMangNhiem(e: ts.Node): boolean {
    let co = false;
    const di = (n: ts.Node): void => {
      if (co) return;
      if (bieuThucNhiem.has(n)) { co = true; return; }
      if (dungTranNhiem(n)) { co = true; return; }
      // `X.map(cb)` — kết quả nhiễm CHỈ KHI thân `cb` trả về chính giá trị nhiễm.
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const goc = n.expression.expression;
        if (ts.isIdentifier(goc) && nhiem.has(goc.text) && PP_MANG.has(n.expression.name.text)) {
          if (n.arguments.length === 0 || traVeNhiem(n.arguments[0]!)) { co = true; return; }
        }
      }
      ts.forEachChild(n, di);
    };
    di(e);
    return co;
  }

  /** Hàm gọi lại (`u => …`) có trả ra chính phần tử nhiễm không? */
  function traVeNhiem(cb: ts.Node): boolean {
    if (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb)) return false;
    const cuc = new Set<string>();
    if (cb.parameters.length > 0) tenRangBuoc(cb.parameters[0]!.name, cuc);
    if (cuc.size === 0) return false;
    // Điểm bất động cục bộ trong thân cb.
    let doi = true;
    while (doi) {
      doi = false;
      const di = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && n.initializer && mangTen(n.initializer, cuc)) {
          const truoc = cuc.size;
          tenRangBuoc(n.name, cuc);
          if (cuc.size !== truoc) doi = true;
        }
        ts.forEachChild(n, di);
      };
      di(cb.body);
    }
    // Thân rút gọn: `u => u`
    if (!ts.isBlock(cb.body)) return mangTenTran(cb.body, cuc);
    let co = false;
    const di2 = (n: ts.Node): void => {
      if (co) return;
      if (ts.isReturnStatement(n) && n.expression && mangTenTran(n.expression, cuc) && !quaLamSach(n.expression, cuc)) {
        co = true;
        return;
      }
      ts.forEachChild(n, di2);
    };
    di2(cb.body);
    return co;
  }

  function mangTen(e: ts.Node, tap: Set<string>): boolean {
    let co = false;
    const di = (n: ts.Node): void => {
      if (co) return;
      if (ts.isIdentifier(n) && tap.has(n.text) && dungTran(n)) { co = true; return; }
      ts.forEachChild(n, di);
    };
    di(e);
    return co;
  }
  const mangTenTran = mangTen;

  /** Biểu thức này đã được bọc trong một phép làm sạch chưa? */
  function quaLamSach(e: ts.Node, tap: Set<string>): boolean {
    let sach = true;
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && (LAM_SACH as readonly string[]).includes(tenLoiGoi(n))) return; // dừng nhánh
      if (ts.isIdentifier(n) && tap.has(n.text) && dungTran(n)) { sach = false; return; }
      if (bieuThucNhiem.has(n)) { sach = false; return; }
      ts.forEachChild(n, di);
    };
    di(e);
    return sach;
  }

  // ── điểm bất động: lan truyền nhiễm trong thân hàm ────────────────────────────────────────
  let doi = true;
  let vong = 0;
  while (doi && vong++ < 12) {
    doi = false;
    const di = (n: ts.Node): void => {
      // `const Y = <bt nhiễm>` → Y nhiễm
      if (ts.isVariableDeclaration(n) && n.initializer && bieuThucMangNhiem(n.initializer)) {
        const truoc = nhiem.size;
        tenRangBuoc(n.name, nhiem);
        if (nhiem.size !== truoc) doi = true;
      }
      // `for (const Y of <bt nhiễm>)` → Y nhiễm
      if (ts.isForOfStatement(n) && bieuThucMangNhiem(n.expression)) {
        if (ts.isVariableDeclarationList(n.initializer)) {
          for (const d of n.initializer.declarations) {
            const truoc = nhiem.size;
            tenRangBuoc(d.name, nhiem);
            if (nhiem.size !== truoc) doi = true;
          }
        }
      }
      // `X.push(<bt nhiễm>)` → X nhiễm
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        (n.expression.name.text === "push" || n.expression.name.text === "unshift") &&
        ts.isIdentifier(n.expression.expression) &&
        // ⚠ `!quaLamSach(…)`, KHÔNG phải `bieuThucMangNhiem(…)`: `result.push({ user: toPublicUser(user) })`
        //    **đã sạch** — nếu vẫn nhiễm `result` thì lưới bắt nhầm đúng bản vá của chính nó.
        n.arguments.some((a) => !quaLamSach(a, nhiem))
      ) {
        if (!nhiem.has(n.expression.expression.text)) {
          nhiem.add(n.expression.expression.text);
          doi = true;
        }
      }
      // kết quả `.map()` nhiễm → ghi nhớ node để tầng trên thấy
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const goc = n.expression.expression;
        if (
          ts.isIdentifier(goc) &&
          nhiem.has(goc.text) &&
          PP_MANG.has(n.expression.name.text) &&
          n.arguments.length > 0 &&
          traVeNhiem(n.arguments[0]!) &&
          !bieuThucNhiem.has(n)
        ) {
          bieuThucNhiem.add(n);
          doi = true;
        }
      }
      ts.forEachChild(n, di);
    };
    di(than);
  }

  // ── tìm đường thoát ──────────────────────────────────────────────────────────────────────
  const thoat: ts.Node[] = [];
  const soat = (n: ts.Node): void => {
    if (n !== than && laHam(n)) {
      // hàm lồng: chỉ đi vào nếu nó KHÔNG phải một hàm gọi lại đã được xét ở trên
      ts.forEachChild(n, soat);
      return;
    }
    if (ts.isReturnStatement(n) && n.expression && !quaLamSach(n.expression, nhiem)) {
      thoat.push(n);
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ["json", "send", "jsonp"].includes(n.expression.name.text) &&
      n.arguments.some((a) => !quaLamSach(a, nhiem))
    ) {
      thoat.push(n);
    }
    ts.forEachChild(n, soat);
  };
  soat(than);
  return thoat;
}

function quetViPham(): { viPham: ViPham[]; soDiemGoi: number; mien: number } {
  const viPham: ViPham[] = [];
  let soDiemGoi = 0;
  let mien = 0;

  const SAN_XUAT = moiFileDuoi(GOC_REPO, "server", [".ts"]).filter((f) => !laFileTest(f.duong));

  for (const f of SAN_XUAT) {
    const src = readFileSync(f.that, "utf8");
    if (!DOC_THO.some((r) => src.includes(r))) continue;
    const sf = nguon(f.that);

    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && DOC_THO.includes(tenLoiGoi(n))) {
        const h = hamBao(n);
        if (h) {
          soDiemGoi++;
          // hạt giống: biến được gán từ lời gọi này
          const hat = new Set<string>();
          let cur: ts.Node = n;
          while (
            cur.parent &&
            (ts.isAwaitExpression(cur.parent) ||
              ts.isParenthesizedExpression(cur.parent) ||
              ts.isAsExpression(cur.parent) ||
              ts.isNonNullExpression(cur.parent))
          ) {
            cur = cur.parent;
          }
          if (cur.parent && ts.isVariableDeclaration(cur.parent) && cur.parent.initializer === cur) {
            tenRangBuoc(cur.parent.name, hat);
          } else if (
            cur.parent &&
            ts.isBinaryExpression(cur.parent) &&
            cur.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(cur.parent.left)
          ) {
            hat.add(cur.parent.left.text);
          } else if (cur.parent && ts.isReturnStatement(cur.parent)) {
            // `return db.getAllUsers()` — thoát NGAY, không qua biến nào
            const than = (h as ts.FunctionLikeDeclaration).body;
            const vung = than ? src.slice(than.pos, than.end) : "";
            if (vung.includes(DAU_MIEN)) mien++;
            else
              viPham.push({
                duong: f.duong,
                dong: dong(sf, n),
                ham: tenHamBao(n),
                bien: "<trả THẲNG kết quả>",
              });
          }

          if (hat.size > 0) {
            const than = (h as ts.FunctionLikeDeclaration).body;
            if (than) {
              const vung = src.slice(than.pos, than.end);
              const ra = thoatKhoi(than, sf, hat);
              if (ra.length > 0) {
                if (vung.includes(DAU_MIEN)) mien++;
                else
                  viPham.push({
                    duong: f.duong,
                    dong: dong(sf, ra[0]!),
                    ham: tenHamBao(n),
                    bien: [...hat].join("/"),
                  });
              }
            }
          }
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return { viPham, soDiemGoi, mien };
}

const KQ0 = quetViPham();
/** Gộp trùng: một hàm gọi người-đọc-thô **hai lần** cho cùng một biến chỉ là **một** đường thoát. */
const KQ = {
  ...KQ0,
  viPham: KQ0.viPham.filter(
    (v, i, a) => a.findIndex((x) => x.duong === v.duong && x.dong === v.dong && x.bien === v.bien) === i,
  ),
};

describe("★★★ Task 7 / Net 2 — ∀ BỀ MẶT: hàng `users` thô không được RỜI MÁY CHỦ chưa làm sạch", () => {
  it("★★★ cầu chì — tập người đọc THÔ được SUY RA và không rỗng (rỗng ⇒ mọi ô dưới là chân lý rỗng)", () => {
    expect(
      DOC_THO.length,
      "không suy ra được hàm nào đọc hàng `users` thô từ server/db/auth.ts — file đã đổi hình dạng?",
    ).toBeGreaterThanOrEqual(6);
    // Neo vào hai cái ĐO ĐƯỢC ở Bước 2 — nếu bộ suy trượt chúng thì nó đang mù đúng thứ cần thấy.
    expect(DOC_THO, "`getAllUsers` (nguồn của `user.list`) phải nằm trong tập").toContain("getAllUsers");
    expect(DOC_THO, "`getUserByOpenId` (nguồn của `ctx.user`) phải nằm trong tập").toContain("getUserByOpenId");
  });

  it("★★★ cầu chì — quét thấy đủ nhiều ĐIỂM GỌI (0 điểm ⇒ lưới đang canh một tập rỗng)", () => {
    expect(
      KQ.soDiemGoi,
      "không tìm thấy điểm gọi người-đọc-thô nào trong server/** — phạm vi quét đã hỏng?",
    ).toBeGreaterThanOrEqual(15);
  });

  it("★★★ ∀ — KHÔNG đường nào để hàng `users` thô thoát ra chưa làm sạch", () => {
    const bao = KQ.viPham
      .map((v) => `  · ${v.duong}:${v.dong}  (${v.ham})  biến: ${v.bien}`)
      .join("\n");
    expect(
      bao,
      "HÀNG `users` THÔ THOÁT RA KHỎI MÁY CHỦ.\n" +
        "⚠ `twoFactorSecret` là HẠT GIỐNG sinh mọi mã OTP — rò ra là 2FA toàn hệ thành trang trí.\n" +
        "⇒ Bọc bằng `toPublicUser()` / `toPublicUsers()` / `redactServerOnlyUserFields()` " +
        "(server/_core/publicUser.ts), hoặc khai vùng mù bằng dấu `" +
        DAU_MIEN +
        "` kèm lý do ngay tại chỗ (và cập nhật SO_MIEN).\n",
    ).toBe("");
  });

  it("★★★ SỐ lượt miễn được GHIM — một vùng mù mới phải là một quyết định NÓI RA", () => {
    expect(
      KQ.mien,
      `số lượt khai \`${DAU_MIEN}\` đã đổi (${KQ.mien} ≠ ${SO_MIEN}) — mỗi lượt miễn là một chỗ ` +
        "lưới này CỐ Ý không canh; nó phải được đếm, không được trôi im lặng",
    ).toBe(SO_MIEN);
  });

  it("★★ KHÔNG BẮT NHẦM — nơi chỉ đọc TRƯỜNG của hàng thô vẫn phải XANH", () => {
    // `notificationRouters.broadcast`: `const users = await db.getUsers(); users.map(u => u.id)`
    // — đọc trường, KHÔNG phát hàng ⇒ nếu ô này đỏ thì lưới đang bắt nhầm và sẽ bị người sau tắt đi.
    const nham = KQ.viPham.filter((v) => v.duong.includes("notificationRouters"));
    expect(nham.map((v) => `${v.duong}:${v.dong}`).join(" · "), "bắt nhầm nơi chỉ đọc `u.id`").toBe("");
    const nham2 = KQ.viPham.filter((v) => v.duong.endsWith("server/_core/authService.ts"));
    expect(nham2.map((v) => `${v.duong}:${v.dong}`).join(" · "), "bắt nhầm đường xác minh mật khẩu").toBe("");
  });
});
