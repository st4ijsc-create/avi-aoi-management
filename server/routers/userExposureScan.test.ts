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
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi, laFileTest, nguoiDocBiMatCuaUserSecrets } from "./deployProcedureScan";
import { moiCotBiMatCuaUserSecrets } from "../_core/publicUser";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/routers
const GOC_REPO = join(TEST_DIR, "..", "..");
const DB_AUTH = join(GOC_REPO, "server", "db", "auth.ts");

/**
 * ★★★ Pha 7 / review TOÀN NHÁNH **C-2** — cột bí mật của `user_secrets`, **SUY RA** từ chủ duy
 * nhất (`server/_core/publicUser.ts::USER_SECRETS_FIELD_VISIBILITY`), không chép tay lần thứ hai.
 */
const COT_BI_MAT = moiCotBiMatCuaUserSecrets();

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

/**
 * ★★★ Pha 7 / review TOÀN NHÁNH **C-2** — **NGƯỜI ĐỌC BÍ MẬT: nửa mà bộ suy cũ MÙ THEO CẤU TẠO.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO CẦN: `nguoiDocTho()` hỏi *"`.select()` KHÔNG phép chiếu nối `.from(users)`"*. Sau 9c,
 * hai người đọc **duy nhất** còn chạm bí mật — `layBiMatNguoiDung()`
 * (`select({passwordHash, twoFactorSecret}).from(userSecrets)`) và `get2FAStatus()`
 * (`leftJoin(userSecrets)`) — **đều CÓ phép chiếu** và **đều không đọc `users` thô** ⇒ **cả hai
 * nằm ngoài lượng từ theo CẤU TẠO**. Bộ quét bề mặt chặt nhất của nhánh này **mù đúng hai hàm
 * cuối cùng còn cầm hạt giống TOTP**.
 *
 * ⇒ Vị từ ở đây **ngược lại**: một hàm xuất khẩu là **người đọc BÍ MẬT** khi phép chiếu của nó
 *   **CHẠM một cột bí mật của `user_secrets`** — dù là `.select({ x: userSecrets.<cột> })`, hay
 *   một khoá chiếu **mang đúng tên cột** (đủ phủ cả `leftJoin`). Tập cột bí mật **SUY RA** từ
 *   `USER_SECRETS_FIELD_VISIBILITY`, nên một cột bí mật **thứ BA** ngày mai tự vào lượng từ.
 *
 * ⚠⚠ Pha 8 Task 4a — **thân của vị từ đã chuyển về `deployProcedureScan.ts`** vì nó có **người
 *    tiêu thụ thứ hai** (`server/_core/hangRaoKhongAiCanh.test.ts`, luật KHAI BẮT BUỘC). Giữ hai
 *    bản sao là đúng lớp "N+1 bộ suy": bản yếu hơn sẽ quyết định lưới nào đỏ. Ô `cầu chì` dưới đây
 *    **không đổi** — nó vẫn neo vào hai hàm đo được, nên một lượt chuyển nhà làm trượt bộ suy vẫn ĐỎ.
 */
function nguoiDocBiMat(): string[] {
  return nguoiDocBiMatCuaUserSecrets(GOC_REPO, COT_BI_MAT);
}

const DOC_BI_MAT = nguoiDocBiMat();

/**
 * ⚠⚠ **HỢP, không thay thế.** Người đọc bí mật vào **luôn** lượng từ "hàng thô không được thoát"
 * ở dưới (trả `status` trần cũng là rò), **và** vào lượng từ ô-BÍ-MẬT riêng ở §5.
 */
const DOC_THO = [...new Set([...nguoiDocTho(), ...DOC_BI_MAT])].sort();

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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ §5 (C-2) — **Ô BÍ MẬT: một trục KHÁC, vì `dungTran()` MÙ với nó THEO THIẾT KẾ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Luật ở trên canh *"cả HÀNG thoát ra"*, và `dungTran()` **cố ý** loại `user.id` / `u?.email` ra
 * khỏi đường thoát — nếu không nó **bắt nhầm** (đã đo: lượt chạy đầu bắt nhầm 6 chỗ). Với `users`
 * đó là đúng: đọc **một trường** của `users` là vô hại.
 *
 * ⚠⚠⚠ Với `user_secrets` thì **NGƯỢC LẠI**: đọc **đúng một trường** *là* lượt rò. Đột biến của
 * lượt review — `twoFactorSecret: status?.twoFactorSecret ?? null` — là một **ĐỌC TRƯỜNG**, nên nó
 * đi qua luật trên **theo cấu tạo**, và nó đã đi qua thật: `tsc` sạch, 58/58 XANH.
 * ⇒ Bất biến thứ hai, trên **cùng bộ quét, khác lượng từ**:
 *
 *   ***∀ điểm trong `server/**` đọc một Ô BÍ MẬT của `user_secrets` ra từ một NGƯỜI ĐỌC BÍ MẬT:
 *   giá trị ấy KHÔNG được thoát khỏi hàm (`return` / `res.json`), trừ khi đã bị GIẢM về boolean.***
 *
 * ⚠ **FAIL-CLOSED.** Chỉ một tập **ĐÓNG** các phép giảm được coi là an toàn (`!x` · `!!x` ·
 *   `Boolean(x)` · so `== null` / `!= null` / `=== null` / `!== null` / `=== undefined` /
 *   `!== undefined`) — mọi hình dạng khác là **ĐỎ**. `?? null`, `String(x)`, `x.slice(0,4)`,
 *   `x ? "a" : "b"` đều **không** nằm trong tập ấy, và đó là chủ ý: *"không hiểu thì ĐỎ, không tha"*.
 * ⚠ Đây là lý do `hasSecret: !!status?.twoFactorSecret` — một ô **SUY RA** — vẫn hợp lệ, còn ô
 *   **mang giá trị** thì không. Ca ĐỐI CHỨNG DƯƠNG ở dưới đo lại đúng ranh giới ấy.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Định danh **GỐC** của một chuỗi truy cập (`user[0].x` → `user`, `a?.b.c` → `a`). */
function tenGoc(e: ts.Node): string | null {
  let cur: ts.Node = e;
  for (;;) {
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) cur = cur.expression;
    else if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur)) cur = cur.expression;
    else return null;
  }
}

/** Phép so với `null`/`undefined` — cho ra boolean, không mang giá trị đi đâu. */
function laSoVoiRong(n: ts.BinaryExpression): boolean {
  const k = n.operatorToken.kind;
  const laSo =
    k === ts.SyntaxKind.EqualsEqualsToken ||
    k === ts.SyntaxKind.ExclamationEqualsToken ||
    k === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    k === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  if (!laSo) return false;
  const rong = (x: ts.Node): boolean =>
    x.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(x) && x.text === "undefined");
  return rong(n.left) || rong(n.right);
}

/**
 * ★★★ Người **TIÊU THỤ** bí mật — tập **ĐÓNG**, và cố ý nhỏ.
 *
 * ⚠⚠ Vì sao cần: `server/_core/trpc.ts:341` viết `return await verifyTotpOnce({ secret:
 * u.twoFactorSecret, … })`. Ô bí mật nằm **trong biểu thức `return`**, nhưng cái rời hàm là **KẾT
 * QUẢ của lượt verify** (`{hopLe, phatLai}`), không phải hạt giống. Bắt nó là **bắt nhầm**, và một
 * lưới bắt nhầm là một lưới sẽ bị người sau tắt đi.
 * ⚠⚠⚠ Nhưng *"nằm trong đối số của một lời gọi bất kỳ"* là một luật **QUÁ RỘNG**:
 * `return { t: String(s.twoFactorSecret) }` cũng có hình dạng ấy, và nó **rò thật**. Nên đây là một
 * **DANH SÁCH CHO PHÉP** (fail-closed), không phải một luật hình dạng: một người tiêu thụ **thứ
 * N+1** làm lưới **ĐỎ** cho tới khi ai đó **quyết** rằng nó thật sự tiêu thụ chứ không phát đi.
 * ⚠ `Boolean` nằm đây **và** trong bộ giảm — hai đường tới cùng một kết luận, không phải bản sao.
 */
const TIEU_THU = ["verifyTotpOnce", "compare", "khopMaDuPhong", "Boolean"] as const;

/**
 * Ô bí mật `tu` (nằm trong biểu thức thoát `chan`) có **an toàn** không.
 * An toàn ⇔ đã bị **GIẢM về boolean**, **hoặc** đã đi vào đối số của một **NGƯỜI TIÊU THỤ** đã khai.
 * ⚠ Mọi thứ khác ⇒ **KHÔNG an toàn** (fail-closed).
 */
function daAnToan(tu: ts.Node, chan: ts.Node): boolean {
  let truoc: ts.Node = tu;
  let cur: ts.Node | undefined = tu.parent;
  while (cur) {
    if (ts.isPrefixUnaryExpression(cur) && cur.operator === ts.SyntaxKind.ExclamationToken) return true;
    if (ts.isBinaryExpression(cur) && laSoVoiRong(cur)) return true;
    // Đi vào ĐỐI SỐ của một lời gọi (không phải vào `expression` của nó).
    if (ts.isCallExpression(cur) && cur.arguments.some((a) => a === truoc || a.pos <= truoc.pos && truoc.end <= a.end)) {
      return (TIEU_THU as readonly string[]).includes(tenLoiGoi(cur));
    }
    if (cur === chan) break;
    truoc = cur;
    cur = cur.parent;
  }
  return false;
}

/** Mọi lượt ĐỌC một ô bí mật ra từ một biến nhiễm, nằm trong cây `goc`. */
function oBiMatTrong(goc: ts.Node, nhiem: ReadonlySet<string>): ts.Node[] {
  const ra: ts.Node[] = [];
  const di = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && COT_BI_MAT.includes(n.name.text)) {
      const g = tenGoc(n.expression);
      if (g !== null && nhiem.has(g)) ra.push(n);
    }
    // `status["twoFactorSecret"]`
    if (
      ts.isElementAccessExpression(n) &&
      n.argumentExpression &&
      ts.isStringLiteral(n.argumentExpression) &&
      COT_BI_MAT.includes(n.argumentExpression.text)
    ) {
      const g = tenGoc(n.expression);
      if (g !== null && nhiem.has(g)) ra.push(n);
    }
    ts.forEachChild(n, di);
  };
  di(goc);
  return ra;
}

/** Hạt giống nhiễm của một lời gọi người-đọc-bí-mật (phủ cả `const u = [await f(id)]`). */
function hatGiongCua(goi: ts.CallExpression): Set<string> {
  const hat = new Set<string>();
  let cur: ts.Node = goi;
  while (
    cur.parent &&
    (ts.isAwaitExpression(cur.parent) ||
      ts.isParenthesizedExpression(cur.parent) ||
      ts.isAsExpression(cur.parent) ||
      ts.isNonNullExpression(cur.parent) ||
      // ⚠ `const user = [await get2FAStatus(id)]` — hình dạng THẬT ở `twoFactorRouter.ts` (4 chỗ).
      //   Thiếu nhánh này thì bốn thủ tục 2FA nguy nhất nằm ngoài lượng từ, im lặng.
      ts.isArrayLiteralExpression(cur.parent))
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
  }
  return hat;
}

function quetRoBiMat(): { viPham: ViPham[]; soDiemGoi: number } {
  const viPham: ViPham[] = [];
  let soDiemGoi = 0;
  const SAN_XUAT = moiFileDuoi(GOC_REPO, "server", [".ts"]).filter((f) => !laFileTest(f.duong));

  for (const f of SAN_XUAT) {
    const src = readFileSync(f.that, "utf8");
    if (!DOC_BI_MAT.some((r) => src.includes(r))) continue;
    const sf = nguon(f.that);

    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && DOC_BI_MAT.includes(tenLoiGoi(n))) {
        const h = hamBao(n);
        const than = h ? (h as ts.FunctionLikeDeclaration).body : undefined;
        if (than) {
          soDiemGoi++;
          const nhiem = hatGiongCua(n);
          if (nhiem.size > 0) {
            // Đường thoát: `return <expr>` và `res.json/send(<expr>)` — cùng hình dạng với luật trên.
            const soat = (x: ts.Node): void => {
              const chan: ts.Node[] = [];
              if (ts.isReturnStatement(x) && x.expression) chan.push(x.expression);
              if (
                ts.isCallExpression(x) &&
                ts.isPropertyAccessExpression(x.expression) &&
                ["json", "send", "jsonp"].includes(x.expression.name.text)
              ) {
                chan.push(...x.arguments);
              }
              for (const c of chan) {
                for (const o of oBiMatTrong(c, nhiem)) {
                  if (!daAnToan(o, c)) {
                    viPham.push({
                      duong: f.duong,
                      dong: dong(sf, o),
                      ham: tenHamBao(n),
                      bien: o.getText(sf).slice(0, 60),
                    });
                  }
                }
              }
              ts.forEachChild(x, soat);
            };
            soat(than);
          }
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return { viPham, soDiemGoi };
}

const KQ_BM0 = quetRoBiMat();
const KQ_BM = {
  ...KQ_BM0,
  viPham: KQ_BM0.viPham.filter(
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

describe("★★★ C-2 §5 — ∀ Ô BÍ MẬT của `user_secrets` KHÔNG được rời máy chủ (trục mà Net 2 mù)", () => {
  it("★★★ cầu chì — tập cột bí mật và tập NGƯỜI ĐỌC BÍ MẬT đều KHÁC RỖNG (rỗng ⇒ chân lý rỗng)", () => {
    expect(
      COT_BI_MAT.length,
      "0 cột bí mật ⇒ mọi ô của §5 là chân lý rỗng.\n" +
        "⚠ Nếu `user_secrets` thật sự không còn bí mật nào thì đó là một QUYẾT ĐỊNH KIẾN TRÚC phải " +
        "nói ra, không phải một lưới im lặng chuyển sang xanh.",
    ).toBeGreaterThan(0);
    expect(COT_BI_MAT, "hạt giống TOTP phải nằm trong tập").toContain("twoFactorSecret");
    expect(COT_BI_MAT, "hash mật khẩu phải nằm trong tập").toContain("passwordHash");
    // ⚠ Hai người đọc mà bộ suy CŨ mù theo cấu tạo — nếu bộ suy mới trượt chúng, nó đang mù đúng
    //   thứ nó được dựng ra để thấy.
    expect(DOC_BI_MAT, "`layBiMatNguoiDung` (select có phép chiếu trên `userSecrets`)").toContain("layBiMatNguoiDung");
    expect(DOC_BI_MAT, "`get2FAStatus` (leftJoin `userSecrets`)").toContain("get2FAStatus");
    // …và HỢP phải thật sự NỚI RỘNG tập cũ, nếu không C-2 chưa đóng gì cả.
    expect(
      DOC_BI_MAT.filter((d) => !nguoiDocTho().includes(d)).length,
      "bộ suy BÍ MẬT không bắt thêm hàm nào so với bộ suy HÀNG THÔ ⇒ C-2 chưa nới được lượng từ",
    ).toBeGreaterThanOrEqual(2);
  });

  it("★★★ cầu chì — quét thấy đủ ĐIỂM GỌI người-đọc-bí-mật (0 ⇒ lưới đang canh một tập rỗng)", () => {
    // Đo được ở lượt vá: 14 điểm gọi trên 8 file (`twoFactorRouter` ×4 · `userRouters` ×4 ·
    // `routers.ts` · `authService` · `_core/index.ts` · `oauth.ts` ×2 · `_core/trpc.ts`).
    expect(
      KQ_BM.soDiemGoi,
      "không tìm thấy điểm gọi người-đọc-bí-mật nào trong server/** — phạm vi quét đã hỏng?",
    ).toBeGreaterThanOrEqual(10);
  });

  it("★★★★ ∀ — KHÔNG ô bí mật nào của `user_secrets` thoát ra khỏi máy chủ", () => {
    const bao = KQ_BM.viPham.map((v) => `  · ${v.duong}:${v.dong}  (${v.ham})  ô: ${v.bien}`).join("\n");
    expect(
      bao,
      "MỘT Ô BÍ MẬT CỦA `user_secrets` RỜI MÁY CHỦ.\n" +
        "⚠ `twoFactorSecret` là HẠT GIỐNG sinh mọi mã OTP — ai đọc được thì tự sinh mã hợp lệ MÃI\n" +
        "  MÃI ⇒ vé một-lần · sổ chống phát lại · step-up mỗi lượt ĐỀU THÀNH TRANG TRÍ.\n" +
        "⇒ Đừng phát giá trị. Phát một ô SUY RA (`!!x`, `Boolean(x)`, `x != null`) — đúng khuôn\n" +
        "  `hasSecret` của `user.get2FAStatus` và `mustChangePassword` của QĐ-1.\n",
    ).toBe("");
  });

  it("★★★★ ĐỘT BIẾN THƯỜNG TRỰC — đúng lượt rò mà reviewer đo (tsc sạch, 58/58 XANH) phải bị BẮT", () => {
    /**
     * ⚠⚠⚠ Đây là ca **neo vào cơ chế**: nguyên văn đột biến C-2, chạy qua **chính bộ quét** này.
     * Trước C-2 nó đi lọt **theo cấu tạo** (một ĐỌC TRƯỜNG, mà `dungTran()` cố ý bỏ qua).
     */
    const ma = `
      export const r = { get2FAStatus: async (ctx: any) => {
        const status = await db.get2FAStatus(ctx.user.id);
        return {
          enabled: status?.twoFactorEnabled || false,
          hasSecret: !!status?.twoFactorSecret,
          twoFactorSecret: status?.twoFactorSecret ?? null,
        };
      } };`;
    const sf = ts.createSourceFile("server/x/dot.ts", ma, ts.ScriptTarget.Latest, true);
    const found: ts.Node[] = [];
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && DOC_BI_MAT.includes(tenLoiGoi(n))) {
        const h = hamBao(n);
        const than = h ? (h as ts.FunctionLikeDeclaration).body : undefined;
        const nhiem = hatGiongCua(n);
        if (than) {
          const soat = (x: ts.Node): void => {
            if (ts.isReturnStatement(x) && x.expression) {
              for (const o of oBiMatTrong(x.expression, nhiem)) {
                if (!daAnToan(o, x.expression)) found.push(o);
              }
            }
            ts.forEachChild(x, soat);
          };
          soat(than);
        }
      }
      ts.forEachChild(n, di);
    };
    ts.forEachChild(sf, di);
    expect(found.length, "đột biến C-2 nguyên văn KHÔNG bị bắt ⇒ lỗ vẫn mở").toBe(1);
    expect(found[0]!.getText(sf)).toContain("twoFactorSecret");
  });

  it("★★★ M3 — lượt rò trong **FILE MỚI CHƯA TỒN TẠI**, và bốn biến thể vòng tránh, đều bị bắt", () => {
    const fileMoi = "server/routers/secretN1Router.ts";
    expect(existsSync(join(GOC_REPO, fileMoi)), "ca này giả định file ấy chưa tồn tại").toBe(false);
    const ca: Array<[string, string]> = [
      ["file MỚI, trả thẳng ô", `const b = await layBiMatNguoiDung(id); return { h: b.passwordHash };`],
      ["`?? null`", `const s = await get2FAStatus(id); return { t: s?.twoFactorSecret ?? null };`],
      ["truy cập theo CHUỖI", `const s = await get2FAStatus(id); return { t: s["twoFactorSecret"] };`],
      ["`res.json`", `const s = await get2FAStatus(id); res.json({ t: s?.twoFactorSecret });`],
      ["ba ngôi (không phải phép GIẢM)", `const s = await get2FAStatus(id); return { t: s ? s.twoFactorSecret : "" };`],
      ["qua MẢNG (`[await f()]`)", `const u = [await get2FAStatus(id)]; return { t: u[0]!.twoFactorSecret };`],
    ];
    for (const [ten, than] of ca) {
      const ma = `export async function f(id: number, res: any) { ${than} }`;
      const sf = ts.createSourceFile(fileMoi, ma, ts.ScriptTarget.Latest, true);
      let bat = 0;
      const di = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && DOC_BI_MAT.includes(tenLoiGoi(n))) {
          const h = hamBao(n);
          const thanH = h ? (h as ts.FunctionLikeDeclaration).body : undefined;
          const nhiem = hatGiongCua(n);
          if (thanH) {
            const soat = (x: ts.Node): void => {
              const chan: ts.Node[] = [];
              if (ts.isReturnStatement(x) && x.expression) chan.push(x.expression);
              if (
                ts.isCallExpression(x) &&
                ts.isPropertyAccessExpression(x.expression) &&
                ["json", "send"].includes(x.expression.name.text)
              ) chan.push(...x.arguments);
              for (const c of chan) for (const o of oBiMatTrong(c, nhiem)) if (!daAnToan(o, c)) bat++;
              ts.forEachChild(x, soat);
            };
            soat(thanH);
          }
        }
        ts.forEachChild(n, di);
      };
      ts.forEachChild(sf, di);
      expect(bat, `biến thể "${ten}" phải bị bắt`).toBeGreaterThanOrEqual(1);
    }
  });

  it("★★ KHÔNG BẮT NHẦM — ô SUY RA (`!!` · `Boolean` · `!= null`) và lượt TIÊU THỤ vẫn XANH", () => {
    const sach: Array<[string, string]> = [
      ["`!!`", `const s = await get2FAStatus(id); return { hasSecret: !!s?.twoFactorSecret };`],
      ["`Boolean()`", `const s = await get2FAStatus(id); return { c: Boolean(s?.twoFactorSecret) };`],
      ["`!= null`", `const s = await get2FAStatus(id); return { c: s?.twoFactorSecret != null };`],
      ["`!x` một lần", `const s = await get2FAStatus(id); return { thieu: !s?.twoFactorSecret };`],
      [
        "TIÊU THỤ (không thoát)",
        `const s = await get2FAStatus(id);
         const ok = await verifyTotpOnce({ userId: id, secret: s!.twoFactorSecret!, token: "1" });
         return { success: ok.hopLe };`,
      ],
      [
        "so mật khẩu (đường đăng nhập THẬT)",
        `const b = await layBiMatNguoiDung(id);
         const ok = await bcrypt.compare(mk, b.passwordHash ?? "");
         return { ok };`,
      ],
    ];
    for (const [ten, than] of sach) {
      const ma = `export async function f(id: number, mk: string) { ${than} }`;
      const sf = ts.createSourceFile("server/x/sach.ts", ma, ts.ScriptTarget.Latest, true);
      let bat = 0;
      const di = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && DOC_BI_MAT.includes(tenLoiGoi(n))) {
          const h = hamBao(n);
          const thanH = h ? (h as ts.FunctionLikeDeclaration).body : undefined;
          const nhiem = hatGiongCua(n);
          if (thanH) {
            const soat = (x: ts.Node): void => {
              if (ts.isReturnStatement(x) && x.expression) {
                for (const o of oBiMatTrong(x.expression, nhiem)) if (!daAnToan(o, x.expression)) bat++;
              }
              ts.forEachChild(x, soat);
            };
            soat(thanH);
          }
        }
        ts.forEachChild(n, di);
      };
      ts.forEachChild(sf, di);
      expect(bat, `hình dạng SẠCH "${ten}" bị bắt nhầm ⇒ lưới này sẽ bị người sau tắt đi`).toBe(0);
    }
  });

  it("★★★ CỔNG KIỂU phải CÒN trên `user.get2FAStatus` — gỡ nó thì tầng biên dịch tắt lặng lẽ", () => {
    /**
     * ⚠ Cổng KIỂU (`KhongMangBiMat<…>`) và bộ quét này đóng **hai nửa khác nhau**: cổng bắt lúc
     * **biên dịch** nhưng **chỉ nơi được khai**; bộ quét bắt **mọi nơi** nhưng lúc chạy lưới. Gỡ
     * lời khai kiểu ⇒ `tsc` thôi đỏ cho đột biến C-2, và **không ca nào khác** nhận ra.
     */
    const src = readFileSync(join(GOC_REPO, "server", "routers", "userRouters.ts"), "utf8");
    expect(
      /get2FAStatus:[\s\S]{0,200}?Promise<\s*KhongMangBiMat</.test(src),
      "`user.get2FAStatus` mất lời khai kiểu `Promise<KhongMangBiMat<…>>` ⇒ cổng lúc BIÊN DỊCH đã tắt",
    ).toBe(true);
    const pu = readFileSync(join(GOC_REPO, "server", "_core", "publicUser.ts"), "utf8");
    expect(
      /\[K in ServerOnlyUserSecretField\]\?:\s*never/.test(pu),
      "phần giao `{ [K in ServerOnlyUserSecretField]?: never }` biến mất ⇒ `KhongMangBiMat` thành `T`",
    ).toBe(true);
  });
});
