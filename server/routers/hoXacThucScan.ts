/**
 * ★★★ Pha 8 Task 5 — **BỘ SUY "HỌ TUYẾN SONG SONG TRÊN TÀI NGUYÊN XÁC THỰC".**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — PHÉP LIỆT KÊ ĐÃ SÓT ĐÚNG PHẦN TỬ CÓ MÂU THUẪN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `server/_core/totpOnce.ts:20-24` **đã đếm bằng tay** các cặp tuyến song song quanh TOTP và khai
 * **HAI** (`twoFactor.enable ≡ user.verify2FA`, `twoFactor.disable ≡ user.disable2FA`). Phép đếm ấy
 * **sót cặp thứ BA** (`twoFactor.generateSecret ≡ user.setup2FA`) — và đó **chính là** cặp mà hai bản
 * sao **BẤT ĐỒNG**. Nó không chỉ sót; nó sót đúng phần tử duy nhất có mâu thuẫn nội tại. "N+1" lần
 * thứ **mười bảy**.
 *
 * ⇒ Vá cặp thứ tư khi vấp phải nó là cách làm đã chứng minh chỉ dẫn tới cặp thứ năm. Bộ suy dưới
 *   đây **ĐẢO LƯỢNG TỪ**: nó không hỏi *"cặp nào tôi biết"* mà **liệt kê CẢ HỌ từ đĩa**, rồi lưới
 *   `hoTuyenSongSong.test.ts` cưỡng chế:
 *
 *   ***∀ cặp thủ tục thao tác trên CÙNG một tài nguyên xác thực: hai bên phải áp CÙNG bộ phép kiểm
 *   và CÙNG bộ tác động — trừ các cặp được KHAI TÊN kèm lý do.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BA BỘ SUY, KHÔNG MỘT DANH SÁCH NÀO VIẾT TAY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **Tài nguyên xác thực** (`taiNguyenXacThuc`) — ba nhánh, mỗi nhánh neo vào một chủ đã có:
 *     (a) mọi cột **server-only** của `user_secrets`, suy từ `USER_SECRETS_FIELD_VISIBILITY`
 *         (`_core/publicUser.ts`) ⇒ một cột bí mật **thứ BA** tự vào;
 *     (b) mọi cột của `users` xuất hiện **CÙNG một phép chiếu** với một cột (a) trong
 *         `server/db/auth.ts` — hôm nay đúng `twoFactorEnabled` (qua `get2FAStatus`). Ai thêm một
 *         cột nữa vào phép chiếu ấy thì cột ấy tự vào lượng từ;
 *     (c) mọi **bảng** mà `server/db/auth.ts` — **chủ tầng dữ liệu xác thực** — thao tác, trừ
 *         `users`/`userSecrets` (hai bảng ấy đã được (a)+(b) phủ ở mức **CỘT**, vì `users` còn mang
 *         hàng chục cột hồ sơ/nghiệp vụ không thuộc trục xác thực).
 *  2. **Đơn vị xử lý** (`quetDonViXuLy`) — thủ tục tRPC **và** handler express, quét bằng
 *     `moiFileDuoi`/`laFileTest` **dùng chung** với mọi lưới khác ⇒ một thủ tục **MỚI trong FILE
 *     MỚI** nằm trong lượng từ **theo cấu tạo** (phép thử M3).
 *  3. **Tác động** — suy liên module một cấp qua bản đồ `server/db/**`, và một `upsert` chung
 *     (`ghiBiMatNguoiDung`) được **phân giải theo ĐỐI SỐ tại điểm gọi** thành cột thật.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ HAI LỖI THIẾT BỊ ĐÃ ĐO ĐƯỢC TRONG CHÍNH LƯỢT DỰNG BỘ SUY NÀY — VÀ CẢ HAI ĐỀU ĐÃ VÁ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  · **"Chối từ" KHÔNG chỉ là `throw`.** Bản dò đầu tiên hỏi `ThrowStatement` ⇒ handler **express**
 *    (`res.status(401).json(…); return;`) khai ra **0 phép kiểm**, và cả ba cặp có REST trong họ
 *    thành **dương tính giả toàn phần**. Nay `laChoiTu` nhận **cả hai** hình dạng.
 *  · **Tên cột đụng tên tham số.** Bản dò đầu tiên tính *mọi* cột của *mọi* bảng xác thực, nên
 *    `input.code` (đối số người dùng gõ) bị đọc thành `backup_codes.code` và đẻ ra ba chênh lệch
 *    ma. Nay phép kiểm **chỉ** tính cột thuộc (a)+(b) — tập ba tên không đụng tham số nào.
 *
 * ⚠⚠ VÙNG MÙ ĐƯỢC KHAI (đừng đọc màu xanh của lưới đi kèm thành "đã phủ hết")
 *  1. Đây là lưới **HÌNH DẠNG**: nó đọc mã, **không chạy** mã. Nó trả lời *"hai tuyến có MANG cùng
 *     bộ phép kiểm không"*, **không** trả lời *"phép kiểm ấy có chạy trên mọi nhánh không"*. Nửa
 *     hành vi do §3 của lưới đi kèm canh (gọi thật qua `appRouter.createCaller`).
 *  2. **Cột `users` ngoài nhánh (b)** không được canh — trục hồ sơ/phân quyền, không phải xác thực.
 *  3. **SQL thô** (`sql\`UPDATE …\``) không được nhận diện; hôm nay repo có 0 điểm như thế trên các
 *     bảng xác thực — một quan sát theo thời điểm, không phải một bất biến.
 *  4. Suy liên module **một cấp rưỡi** (`server/db/**` đóng bao 4 vòng). Một hàm trung gian nằm
 *     ngoài `server/db/**` che tác động đi sẽ không được nhìn xuyên qua.
 */
import ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { moiFileDuoi, laFileTest } from "./deployProcedureScan";

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Tiện ích AST dùng chung trong file này.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

function nguon(duong: string, ma: string): ts.SourceFile {
  return ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
}

function tenLoiGoi(n: ts.CallExpression): string {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
}

/** Giá trị được gán, rút gọn thành một trong `true|false|null|*`. */
function nhanGiaTri(i: ts.Expression): string {
  if (i.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (i.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (i.kind === ts.SyntaxKind.NullKeyword) return "null";
  return "*";
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * §1 — TÀI NGUYÊN XÁC THỰC (ba nhánh suy ra)
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface TaiNguyenXacThuc {
  /** (a) cột **server-only** của `user_secrets`. */
  readonly cotBiMat: readonly string[];
  /** (b) cột `users` đi CÙNG phép chiếu với một cột (a) trong `server/db/auth.ts`. */
  readonly cotUsers: readonly string[];
  /** (c) bảng do chủ tầng-xác-thực thao tác, trừ `users`/`userSecrets`. */
  readonly bang: readonly string[];
  /** Mọi bảng chủ tầng-xác-thực thao tác (kể cả `users`/`userSecrets`) — dùng để ĐỌC tác động. */
  readonly bangChu: readonly string[];
  /** `bảng → cột`, đọc từ `drizzle/schema/auth.ts`. */
  readonly cotCuaBang: ReadonlyMap<string, ReadonlySet<string>>;
}

/** `bảng → tập cột`, đọc từ `drizzle/schema/auth.ts` (nguồn sự thật của lược đồ xác thực). */
function luocDoXacThuc(goc: string): Map<string, Set<string>> {
  const p = join(goc, "drizzle", "schema", "auth.ts");
  const ra = new Map<string, Set<string>>();
  if (!existsSync(p)) return ra;
  const sf = nguon(p, readFileSync(p, "utf8"));
  const di = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      tenLoiGoi(n.initializer) === "pgTable"
    ) {
      const a1 = n.initializer.arguments[1];
      const cot = new Set<string>();
      if (a1 && ts.isObjectLiteralExpression(a1)) for (const pr of a1.properties) if (pr.name) cot.add(pr.name.getText(sf));
      ra.set(n.name.getText(sf), cot);
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

/**
 * ★★★ Ba nhánh suy ra tài nguyên xác thực.
 * @param cotBiMat tập cột server-only của `user_secrets` — **truyền vào** từ
 *        `moiCotBiMatCuaUserSecrets()` để bộ suy này không giữ bản sao thứ hai của phân loại ấy.
 */
export function taiNguyenXacThuc(goc: string, cotBiMat: readonly string[]): TaiNguyenXacThuc {
  const cotCuaBang = luocDoXacThuc(goc);
  const pAuth = join(goc, "server", "db", "auth.ts");
  const bangChu = new Set<string>();
  const cotUsers = new Set<string>();
  if (existsSync(pAuth)) {
    const sf = nguon(pAuth, readFileSync(pAuth, "utf8"));
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const t = tenLoiGoi(n);
        const a0 = n.arguments[0];
        if (["insert", "delete", "update", "from"].includes(t) && a0 && ts.isIdentifier(a0) && cotCuaBang.has(a0.text)) {
          bangChu.add(a0.text);
        }
        // (b) — phép chiếu `select({…})` chạm một cột bí mật ⇒ mọi cột `users` cùng phép chiếu vào tập.
        if (t === "select" && n.arguments.length === 1 && a0 && ts.isObjectLiteralExpression(a0)) {
          const cot = (pr: ts.ObjectLiteralElementLike, bang: string): string | null =>
            ts.isPropertyAssignment(pr) &&
            ts.isPropertyAccessExpression(pr.initializer) &&
            ts.isIdentifier(pr.initializer.expression) &&
            pr.initializer.expression.text === bang
              ? pr.initializer.name.text
              : null;
          const chamBiMat = a0.properties.some((pr) => {
            const c = cot(pr, "userSecrets");
            return c !== null && cotBiMat.includes(c);
          });
          if (chamBiMat) for (const pr of a0.properties) {
            const c = cot(pr, "users");
            if (c !== null) cotUsers.add(c);
          }
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return {
    cotBiMat: [...cotBiMat].sort(),
    cotUsers: [...cotUsers].sort(),
    bang: [...bangChu].filter((b) => b !== "users" && b !== "userSecrets").sort(),
    bangChu: [...bangChu].sort(),
    cotCuaBang,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * §2 — TÁC ĐỘNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Một tác động **được TÍNH** khi nó chạm đúng tập tài nguyên xác thực (không phải mọi cột `users`). */
export function tacDongDuocTinh(tn: TaiNguyenXacThuc, t: string): boolean {
  const m = /^([A-Za-z_]\w*)[.:]([\w*]+)/.exec(t);
  if (m === null) return false;
  if (tn.bang.includes(m[1]!)) return true;
  if (m[1] === "users") return tn.cotUsers.includes(m[2]!);
  if (m[1] === "userSecrets") return tn.cotBiMat.includes(m[2]!);
  return false;
}

/** Tác động nguyên thuỷ (drizzle) + tác động suy qua bản đồ hàm tầng-db. */
function tacDongTrong(
  node: ts.Node,
  sf: ts.SourceFile,
  tn: TaiNguyenXacThuc,
  banDo: ReadonlyMap<string, ReadonlySet<string>> | null,
): Set<string> {
  const ra = new Set<string>();
  const di = (x: ts.Node): void => {
    if (ts.isCallExpression(x)) {
      const t = tenLoiGoi(x);
      const a0 = x.arguments[0];
      const bang = a0 && ts.isIdentifier(a0) ? a0.text : "";
      if (["insert", "delete", "update"].includes(t) && tn.bangChu.includes(bang)) {
        if (t === "update") {
          // tìm `.set({…})` đi kèm trong CHÍNH chuỗi truy cập này
          let p: ts.Node | undefined = x.parent;
          let setObj: ts.ObjectLiteralExpression | null = null;
          while (p && ts.isPropertyAccessExpression(p)) {
            const c: ts.Node | undefined = p.parent;
            const a = c && ts.isCallExpression(c) ? c.arguments[0] : undefined;
            if (c && ts.isCallExpression(c) && p.name.text === "set" && a && ts.isObjectLiteralExpression(a)) {
              setObj = a;
              break;
            }
            p = c;
          }
          if (setObj !== null) {
            for (const pr of setObj.properties) {
              const k = pr.name ? pr.name.getText(sf) : "?";
              ra.add(`${bang}.${k}=${ts.isPropertyAssignment(pr) ? nhanGiaTri(pr.initializer) : "*"}`);
            }
          } else ra.add(`${bang}:update`);
        } else ra.add(`${bang}:${t}`);
      }
      if (t === "from" && tn.bangChu.includes(bang)) {
        const tr = x.expression;
        if (ts.isPropertyAccessExpression(tr) && ts.isCallExpression(tr.expression) && tenLoiGoi(tr.expression) === "select") {
          ra.add(tr.expression.arguments.length === 0 ? `${bang}:select*` : `${bang}:select{}`);
        }
      }
      if (banDo !== null) {
        const m = banDo.get(t);
        if (m !== undefined) {
          const objArg = x.arguments.find((a): a is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(a));
          for (const v of m) {
            // ★ upsert CHUNG (`ghiBiMatNguoiDung`) — phân giải theo ĐỐI SỐ tại điểm gọi thành cột thật.
            const up = /^(\w+):(insert|update)$/.exec(v);
            let daNo = false;
            if (up !== null && objArg !== undefined) {
              for (const pr of objArg.properties) {
                const k = pr.name ? pr.name.getText(sf) : "?";
                if (tn.cotCuaBang.get(up[1]!)?.has(k) === true) {
                  ra.add(`${up[1]}.${k}=${ts.isPropertyAssignment(pr) ? nhanGiaTri(pr.initializer) : "*"}`);
                  daNo = true;
                }
              }
            }
            if (!daNo) ra.add(v);
          }
        }
      }
    }
    ts.forEachChild(x, di);
  };
  di(node);
  return ra;
}

/** Bản đồ `tên hàm ở server/db/**` → tập tác động, đóng bao 4 vòng (hàm gọi hàm). */
export function banDoTangDb(goc: string, tn: TaiNguyenXacThuc): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const files = moiFileDuoi(goc, "server/db", [".ts"]).filter((f) => !laFileTest(f.duong));
  for (let vong = 0; vong < 4; vong++) {
    for (const f of files) {
      const sf = nguon(f.that, readFileSync(f.that, "utf8"));
      const di = (n: ts.Node): void => {
        if (ts.isFunctionDeclaration(n) && n.name && n.body) {
          const t = tacDongTrong(n.body, sf, tn, vong === 0 ? null : map);
          if (t.size > 0) map.set(n.name.text, new Set([...(map.get(n.name.text) ?? []), ...t]));
        }
        ts.forEachChild(n, di);
      };
      di(sf);
    }
  }
  return map;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * §3 — PHÉP KIỂM
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ Nhánh này là một **CHỐI TỪ** chứ?
 * ⚠⚠ Hai hình dạng, và bỏ sót hình dạng thứ hai đã khiến bản dò đầu tiên khai **0 phép kiểm** cho
 *    mọi handler express: tRPC `throw appError(…)`, express `res.status(4xx).json(…); return;`.
 */
function laChoiTu(n: ts.Node): boolean {
  let co = false;
  const di = (x: ts.Node): void => {
    if (co) return;
    if (ts.isThrowStatement(x)) { co = true; return; }
    if (ts.isCallExpression(x) && tenLoiGoi(x) === "status") {
      const a = x.arguments[0];
      if (a && ts.isNumericLiteral(a) && Number(a.text) >= 400) { co = true; return; }
    }
    ts.forEachChild(x, di);
  };
  di(n);
  return co;
}

/**
 * ★★★ Bộ phép kiểm của một đơn vị xử lý — **hai loại, cả hai SUY RA**:
 *   · `o:<cột>`   — một chối từ mà **điều kiện** chạm một cột tài nguyên (a)/(b);
 *   · `dung:<f>`  — một lời gọi `f` **vừa** có kết quả **điều khiển một chối từ**, **vừa** tiêu thụ
 *                   vật liệu xác thực (đối số chạm một cột (a)/(b), **hoặc** `f` là hàm tầng-db có
 *                   một tác động được tính). Ví dụ đúng: `bcrypt.compare(…, biMat.passwordHash)`,
 *                   `verifyTotpOnce({ secret: status.twoFactorSecret })`, `db.verifyBackupCode(…)`.
 *
 * ⚠⚠⚠ **LỖI THIẾT BỊ THỨ BA, đo được trong chính lượt dựng:** bản dò trước chỉ hỏi vế *"đối số chạm
 *    một cột"* và **không** hỏi vế *"kết quả điều khiển một chối từ"*, cũng không loại cột của bảng
 *    (c). Hệ quả: `dung:and` · `dung:eq` · `dung:where` · `dung:values` · `dung:map` · `dung:query` ·
 *    `dung:mutation` · `dung:json` · `dung:post` · `dung:test` **đều tính là phép kiểm** — tức bộ dò
 *    đang đo **cú pháp drizzle/tRPC**, không đo an ninh, và mọi con số chênh lệch nó in ra đều là
 *    dương tính giả. Hai vế cùng lúc mới là một phép kiểm.
 * ⚠ Chỉ cột (a)+(b): tên cột của bảng (c) (`code` · `userId` · `id`) **đụng tên tham số** người dùng
 *   gõ (`input.code`) và đẻ ra chênh lệch ma — đó là lỗi thiết bị **thứ hai** của cùng lượt.
 *   Việc "tiêu một mã dự phòng" vẫn được canh, nhưng ở trục **TÁC ĐỘNG** (`backupCodes.isUsed=true`),
 *   nơi nó là một sự thật về DB chứ không phải một phỏng đoán về tên.
 */
export function phepKiemTrong(
  node: ts.Node,
  tn: TaiNguyenXacThuc,
  banDo: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const ra = new Set<string>();
  const coTaiNguyen = new Set<string>([...tn.cotBiMat, ...tn.cotUsers]);

  /**
   * `f` có tiêu thụ vật liệu xác thực không?
   * ⚠⚠ **LỖI THIẾT BỊ THỨ TƯ, đo được:** `db.select({ twoFactorEnabled: users.twoFactorEnabled, … })`
   *    có đối số chạm một cột (b) ⇒ `dung:select` được khai là *"phép kiểm"*, và cặp
   *    `generateSecret ↔ setup2FA` — **cặp ĐÃ VÁ ở Pha 7 C-1** — hiện ra như một bất đồng. Một
   *    **MẮT của chuỗi truy vấn** (kết quả của nó lại bị `.` gọi tiếp) không phải một phép kiểm.
   */
  const tieuThu = (f: ts.CallExpression): boolean => {
    const cha = f.parent;
    if (cha !== undefined && ts.isPropertyAccessExpression(cha) && cha.expression === f) return false;
    for (const m of banDo.get(tenLoiGoi(f)) ?? []) if (tacDongDuocTinh(tn, m)) return true;
    let cham = false;
    const d = (y: ts.Node): void => {
      if (cham) return;
      if (ts.isPropertyAccessExpression(y) && coTaiNguyen.has(y.name.text)) { cham = true; return; }
      ts.forEachChild(y, d);
    };
    for (const a of f.arguments) d(a);
    return cham;
  };

  // biến → (cột tài nguyên nó mang, hàm tiêu-thụ đã sinh ra nó). Ba nguồn gán:
  //   `const v = …` · `v = …` · `if (<cond>) { v = … }` (nhánh mã dự phòng của `disable`/`verify`).
  const cot = new Map<string, Set<string>>();
  const ham = new Map<string, Set<string>>();
  const nap = (ten: string, bieuThuc: ts.Node): void => {
    const c = cot.get(ten) ?? new Set<string>();
    const h = ham.get(ten) ?? new Set<string>();
    const d = (y: ts.Node): void => {
      if (ts.isPropertyAccessExpression(y) && coTaiNguyen.has(y.name.text)) c.add(y.name.text);
      if (ts.isCallExpression(y) && tieuThu(y)) h.add(tenLoiGoi(y));
      ts.forEachChild(y, d);
    };
    d(bieuThuc);
    if (c.size > 0) cot.set(ten, c);
    if (h.size > 0) ham.set(ten, h);
  };
  const d0 = (x: ts.Node): void => {
    if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.initializer) nap(x.name.text, x.initializer);
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(x.left)) {
      nap(x.left.text, x.right);
      // `if (await khopMaDuPhong(…)) { verified = true; }` — ĐIỀU KIỆN mới là phép kiểm, không phải `true`.
      let p: ts.Node | undefined = x.parent;
      while (p !== undefined && !ts.isIfStatement(p)) p = p.parent;
      if (p !== undefined && ts.isIfStatement(p)) nap(x.left.text, p.expression);
    }
    ts.forEachChild(x, d0);
  };
  d0(node);

  const di = (x: ts.Node): void => {
    if (ts.isIfStatement(x) && laChoiTu(x.thenStatement)) {
      const d = (y: ts.Node): void => {
        if (ts.isPropertyAccessExpression(y) && coTaiNguyen.has(y.name.text)) ra.add(`o:${y.name.text}`);
        if (ts.isCallExpression(y) && tieuThu(y)) ra.add(`dung:${tenLoiGoi(y)}`);
        if (ts.isIdentifier(y)) {
          if (coTaiNguyen.has(y.text)) ra.add(`o:${y.text}`);
          for (const c of cot.get(y.text) ?? []) ra.add(`o:${c}`);
          for (const f of ham.get(y.text) ?? []) ra.add(`dung:${f}`);
        }
        ts.forEachChild(y, d);
      };
      d(x.expression);
    }
    ts.forEachChild(x, di);
  };
  di(node);
  return ra;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * §4 — CỘT RỜI MÁY CHỦ (trục ĐỌC)
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ Bảng tài nguyên nào bị đơn vị xử lý **TRẢ NGUYÊN HÀNG** ra ngoài?
 *
 * ⚠⚠⚠ **VÌ SAO ĐÂY LÀ MỘT ∀ TUYỆT ĐỐI, KHÔNG PHẢI MỘT PHÉP SO CẶP.** Bản thiết kế đầu định so
 * *"tập cột rời máy chủ"* giữa hai thành viên của một họ. Nhưng họ chỉ được dựng theo tác động
 * **GHI**, còn `session.list` ≡ `user.getSessions` **chỉ ĐỌC** ⇒ chúng **không bao giờ vào chung
 * một họ** ⇒ trục ấy **theo cấu tạo không đỏ được** cho đúng thứ nó sinh ra để bắt. Đó là **lượng
 * từ TỰ THOẢ** mà §Global Constraints gọi tên. ⇒ Phát biểu lại, mạnh hơn và không cần cặp:
 *
 *   ***∀ đơn vị xử lý trong `server/**` trả về kết quả của một phép đọc THÔ (`select()` không phép
 *   chiếu) trên một bảng tài nguyên xác thực: nó KHÔNG được trả nguyên hàng ra ngoài.***
 *
 * ⚠ **FAIL-CLOSED**: một `return <lời gọi đọc thô>` **không kèm phép chiếu nào** là vi phạm. Đó
 *   chính là hình dạng đã để **`user_sessions.sessionToken`** bay xuống trình duyệt qua
 *   `user.getSessions` — trong khi tuyến song song `session.list` chiếu tường minh 10 cột và
 *   **không** có token.
 */
export function bangTraTho(
  node: ts.Node,
  tn: TaiNguyenXacThuc,
  banDo: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const ra = new Set<string>();
  const di = (x: ts.Node): void => {
    if (ts.isReturnStatement(x) && x.expression) {
      let e: ts.Expression = x.expression;
      while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
      // Có BẤT KỲ phép chiếu nào (object literal / `.map`) ⇒ không phải trả thô.
      let chieu = false;
      const dc = (y: ts.Node): void => {
        if (ts.isObjectLiteralExpression(y)) chieu = true;
        ts.forEachChild(y, dc);
      };
      dc(e);
      if (!chieu && ts.isCallExpression(e)) {
        for (const b of tn.bang) if (banDo.get(tenLoiGoi(e))?.has(`${b}:select*`) === true) ra.add(b);
      }
    }
    ts.forEachChild(x, di);
  };
  di(node);
  return ra;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * §5 — ĐƠN VỊ XỬ LÝ
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface DonViXuLy {
  readonly duong: string;
  readonly dong: number;
  readonly ten: string;
  /** `tRPC` | `REST`. */
  readonly loai: string;
  /** Tác động **được tính** (đã lọc qua `tacDongDuocTinh`). */
  readonly tacDong: readonly string[];
  /** Bộ phép kiểm. */
  readonly phepKiem: readonly string[];
  /** Bảng tài nguyên bị TRẢ NGUYÊN HÀNG ra ngoài (∀ tuyệt đối §4 — không phải phép so cặp). */
  readonly traTho: readonly string[];
}

/** Quét **một nguồn bất kỳ** — kể cả nguồn của một file **CHƯA TỒN TẠI** (phép thử M3). */
export function donViTrongNguon(
  duong: string,
  ma: string,
  tn: TaiNguyenXacThuc,
  banDo: ReadonlyMap<string, ReadonlySet<string>>,
): DonViXuLy[] {
  const sf = nguon(duong, ma);
  const ra: DonViXuLy[] = [];
  const ghi = (ten: string, node: ts.Node, loai: string): void => {
    const td = [...tacDongTrong(node, sf, tn, banDo)].filter((t) => tacDongDuocTinh(tn, t)).sort();
    if (td.length === 0) return;
    ra.push({
      duong,
      dong: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      ten,
      loai,
      tacDong: td,
      phepKiem: [...phepKiemTrong(node, tn, banDo)].sort(),
      traTho: [...bangTraTho(node, tn, banDo)].sort(),
    });
  };
  const di = (n: ts.Node): void => {
    if (
      ts.isPropertyAssignment(n) &&
      n.name &&
      ts.isCallExpression(n.initializer) &&
      ["query", "mutation", "subscription"].includes(tenLoiGoi(n.initializer))
    ) {
      ghi(n.name.getText(sf), n.initializer, "tRPC");
      return;
    }
    const a0 = ts.isCallExpression(n) ? n.arguments[0] : undefined;
    if (
      ts.isCallExpression(n) &&
      ["get", "post", "put", "patch", "delete"].includes(tenLoiGoi(n)) &&
      n.arguments.length >= 2 &&
      a0 &&
      ts.isStringLiteral(a0)
    ) {
      ghi(a0.text, n, "REST");
      return;
    }
    ts.forEachChild(n, di);
  };
  ts.forEachChild(sf, di);
  return ra;
}

/** Mọi đơn vị xử lý chạm tài nguyên xác thực trong `server/**`. */
export function quetDonViXuLy(
  goc: string,
  tn: TaiNguyenXacThuc,
  banDo: ReadonlyMap<string, ReadonlySet<string>>,
): DonViXuLy[] {
  const ra: DonViXuLy[] = [];
  for (const f of moiFileDuoi(goc, "server", [".ts"]).filter((x) => !laFileTest(x.duong))) {
    ra.push(...donViTrongNguon(f.duong, readFileSync(f.that, "utf8"), tn, banDo));
  }
  return ra.sort((a, b) => `${a.duong}#${a.ten}`.localeCompare(`${b.duong}#${b.ten}`));
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * §6 — HỌ và BẤT ĐỒNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface CapSongSong {
  /** Khoá ổn định: `đườngA#tênA | đườngB#tênB`, hai đầu đã sắp xếp. */
  readonly khoa: string;
  /** Mọi tác động **NEO** làm hai bên thành cặp song song. */
  readonly neo: readonly string[];
  readonly a: DonViXuLy;
  readonly b: DonViXuLy;
  /**
   * **CHỮ KÝ CHÊNH LỆCH** — hợp của mọi chênh lệch (phép kiểm ∪ tác động ghi) qua mọi neo.
   * `A+x` = chỉ bên A có `x`. Rỗng ⇒ hai bên **KHỚP**.
   */
  readonly lech: readonly string[];
}

const laGhi = (t: string): boolean => !t.includes(":select");

/** Tên đầy đủ, ổn định, của một đơn vị xử lý. */
export function tenDayDu(d: DonViXuLy): string {
  return `${d.duong}#${d.ten}`;
}

/**
 * ★★★ Mọi cặp song song trong toàn họ, **gom theo CẶP** (không theo neo).
 *
 * ⚠⚠ Vì sao gom theo cặp: `backupCodes.isUsed=true` và `backupCodes.usedAt=*` **luôn đi cùng nhau**
 *    (một `UPDATE` hai cột), nên khoá-theo-neo nhân đôi mọi lời khai mà không thêm một bit thông tin
 *    nào. Gom theo cặp cho **một cặp = một lời khai**.
 * ⚠⚠⚠ Và lời khai **KHÔNG phải một tấm vé trắng**: nó ghim **CHỮ KÝ CHÊNH LỆCH chính xác**. Một
 *    chênh lệch **MỚI** trên đúng cặp đã khai vẫn làm cổng **ĐỎ** — miễn trừ là một ảnh chụp có chữ
 *    ký, không phải một lối thoát vĩnh viễn.
 */
export function capSongSong(dv: readonly DonViXuLy[]): CapSongSong[] {
  const ho = new Map<string, DonViXuLy[]>();
  for (const d of dv) for (const t of d.tacDong.filter(laGhi)) {
    if (!ho.has(t)) ho.set(t, []);
    ho.get(t)!.push(d);
  }
  const gom = new Map<string, { neo: Set<string>; a: DonViXuLy; b: DonViXuLy; lech: Set<string> }>();
  const hieu = (xs: readonly string[], ys: readonly string[], dau: string): string[] =>
    xs.filter((x) => !ys.includes(x)).map((x) => `${dau}${x}`);
  for (const [neo, ds] of [...ho].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (ds.length < 2) continue;
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      const [a, b] = [ds[i]!, ds[j]!].sort((x, y) => tenDayDu(x).localeCompare(tenDayDu(y)));
      const khoa = `${tenDayDu(a!)} | ${tenDayDu(b!)}`;
      const o = gom.get(khoa) ?? { neo: new Set<string>(), a: a!, b: b!, lech: new Set<string>() };
      o.neo.add(neo);
      for (const x of hieu(a!.phepKiem, b!.phepKiem, "A+")) o.lech.add(x);
      for (const x of hieu(b!.phepKiem, a!.phepKiem, "B+")) o.lech.add(x);
      for (const x of hieu(a!.tacDong.filter(laGhi), b!.tacDong.filter(laGhi), "A+")) o.lech.add(x);
      for (const x of hieu(b!.tacDong.filter(laGhi), a!.tacDong.filter(laGhi), "B+")) o.lech.add(x);
      gom.set(khoa, o);
    }
  }
  return [...gom]
    .map(([khoa, o]) => ({ khoa, neo: [...o.neo].sort(), a: o.a, b: o.b, lech: [...o.lech].sort() }))
    .sort((x, y) => x.khoa.localeCompare(y.khoa));
}
