/**
 * ★★★ Pha 6 Task 1b / I-2 — **BỘ SUY TẬP "THỦ TỤC ĐỨNG TRÊN `deployProcedure`", DÙNG CHUNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: BẢN ĐẦU CỦA LƯỢNG TỪ **CHẶN TRONG MỘT DANH SÁCH FILE**.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bộ suy của `deployStepUpFreshness.test.ts` bản đầu quét bằng `readdirSync(server/routers)` —
 * **KHÔNG đệ quy** — và nhận `_core/trpc` bằng regex `/_core\/trpc$/`. Đột biến **R1b** của người
 * review: đặt **cùng một thủ tục** ở `server/_core/systemRouter.ts` (ngoài `server/routers/`, và
 * nó nhập bằng `"./trpc"`) ⇒ **68/68 XANH HẾT**. An ninh vẫn **giữ** (phép siết ở GỐC nên thủ tục
 * ấy vẫn bị che), nhưng **cổng "phải NÓI RA" MÙ** — đúng thứ con số ghim được dựng ra để làm.
 *
 * ⇒ Hai lỗ được đóng bằng **cơ chế**, không bằng cách thêm một thư mục vào danh sách:
 *   • **VỊ TRÍ**: duyệt **đệ quy** toàn `server/**`, không dừng ở một thư mục.
 *   • **DANH TÍNH MODULE**: hỏi *"đường nhập này **phân giải tới** `server/_core/trpc.ts` không"*
 *     bằng **phép nối đường dẫn**, không bằng chính tả của chuỗi. `"./trpc"` · `"../_core/trpc"` ·
 *     `"../../_core/trpc"` đều là **một** module.
 *
 * ⚠⚠ **BA CẦU CHÌ CHO PHẦN BỘ SUY KHÔNG VỚI TỚI** (đảo lượng từ thay vì im lặng bỏ sót):
 * bộ suy chỉ đi **MỘT NẤC NHẬP** (file nhập thẳng từ `_core/trpc`), vì để rẻ nó chỉ phân tích
 * những file có **chứa chữ** `deployProcedure`. Một nấc thứ hai chỉ tồn tại được nếu có ai đó
 * **tái xuất**. Nên thay vì đoán, các cầu chì bắt đúng những hình dạng ấy và **ĐỎ**:
 *   (1) `export * from "…/trpc"` ở bất kỳ file nào ngoài chính `trpc.ts`;
 *   (2) một file trong tập ứng viên **tái xuất** một bí danh của `deployProcedure`;
 *   (3) một file **KHÔNG phải test** dưới `server/**` **nhập** một file `*.test.ts` — xem §PHÂN
 *       ĐÔI dưới đây; cầu chì này là thứ giữ cho phép phân đôi ấy đúng **theo cấu tạo**.
 * Gặp một trong ba ⇒ bộ suy **tự khai là không còn đủ**, không âm thầm bỏ sót.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ PHÂN ĐÔI **SẢN XUẤT** ↔ **KHAI TRONG LƯỚI** — VÀ VÌ SAO NÓ KHÔNG PHẢI MỘT CỬA MIỄN TRỪ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lượt đệ quy đầu tiên bắt thêm **hai** thủ tục mà bản `readdirSync` một-thư-mục không thấy:
 * `deployStepUpFreshness.test.ts#deployMoi` và `vramStepUpFreshness.test.ts#deployKhac` — đó là
 * **phép thử M3 của chính các lưới ấy**, không phải bề mặt của sản phẩm. Gộp chúng vào con số
 * ghim là để một lượt sửa lưới làm đỏ một ô nói về **sản phẩm**; bỏ chúng đi **im lặng** thì mất
 * luôn bằng chứng rằng phép thử M3 còn sống.
 *
 * ⇒ Không bỏ, không gộp: **tách hai tập**, và mỗi tập có lượng từ riêng.
 *   • `thuTuc` — khai trong file **KHÔNG** phải `*.test.ts` ⇒ bề mặt **có thật** của sản phẩm.
 *   • `thuTucTest` — khai trong `*.test.ts` ⇒ **cầu chì**: tập này rỗng nghĩa là phép thử M3 đã
 *     biến mất khỏi các lưới, và lưới phải ĐỎ vì điều đó.
 *
 * ⚠ Phép phân đôi chỉ **đúng** khi một `router({…})` khai trong `*.test.ts` **không thể** được gắn
 * vào `appRouter` thật. `server/routers.ts` không nhập file test nào — nhưng *"hôm nay không"* là
 * một quan sát, không phải một bất biến. Cầu chì (3) biến nó thành bất biến: **bất kỳ** file sản
 * xuất nào dưới `server/**` nhập một `*.test.ts` ⇒ ô mù ⇒ **ĐỎ**.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";
import ts from "typescript";

/** Tên export gốc ở `server/_core/trpc.ts`. */
export const TEN_SAN_DEPLOY = "deployProcedure";
/** Tên phép siết per-call mà **gốc** `deployProcedure` phải chain. */
export const TEN_PHEP_SIET = "requirePerCallFreshTotp";

export interface ThuTucDeploy {
  /** Đường dẫn tương đối gốc repo, dấu `/` (vd `server/routers/programmingRouter.ts`). */
  readonly file: string;
  /** Tên thủ tục trong `router({ … })`. */
  readonly ten: string;
  /**
   * `.input(...)` của thủ tục này có khai ô `totpCode` không.
   * ⚠ Đây là **nửa hợp đồng phía máy chủ** của bất biến step-up: một thủ tục đứng trên
   * `deployProcedure` mà `input` KHÔNG khai `totpCode` thì middleware (đọc raw input) sẽ không bao
   * giờ thấy mã ⇒ **403 mỗi lượt, mọi vai**, và client không có đường nào gửi mã lên.
   */
  readonly khaiTotp: boolean;
  /**
   * ★★★ I-4 — ô `totpCode` ấy có **BẮT BUỘC** không (không `.optional()`/`.nullish()`/`.default()`).
   * ⚠ Đây **không** phải một cổng an ninh — middleware đọc **raw input TRƯỚC zod** và fail-closed,
   * nên `.optional()` chưa bao giờ nới an ninh. Nó là cổng **HỢP ĐỒNG**: chính `.optional()` là thứ
   * khiến `tsc` **ban phước** cho đột biến R2 (gỡ `totpCode` khỏi một điểm gọi client ⇒ 108 file /
   * 1837 ca XANH, tsc SẠCH). Bắt buộc ⇒ lượt gỡ ấy là một **lỗi biên dịch**.
   */
  readonly totpBatBuoc: boolean;
}

export interface KetQuaQuet {
  /** Thủ tục khai trong file **sản xuất** (không phải `*.test.ts`) — bề mặt có thật. */
  readonly thuTuc: readonly ThuTucDeploy[];
  /** Thủ tục khai **trong một lưới** (`*.test.ts`) — phép thử M3 của lưới ấy, không phải sản phẩm. */
  readonly thuTucTest: readonly ThuTucDeploy[];
  /** Ô KHÔNG phân giải được — mỗi mục là một ô KHÔNG AI CANH ⇒ lưới phải ĐỎ. */
  readonly mu: readonly string[];
  /** File đã thật sự parse (có chứa chữ `deployProcedure`). */
  readonly ungVien: readonly string[];
  /** Tổng số file `.ts` đã **duyệt** dưới `server/**` — cầu chì chống "quét trúng 0 file". */
  readonly soFileDuyet: number;
}

function duongTuongDoi(goc: string, p: string): string {
  return relative(goc, p).split(sep).join("/");
}

/** File này là một **lưới** (vitest) chứ không phải mã sản xuất? Hỏi bằng ĐUÔI, không bằng thư mục. */
export function laFileTest(duong: string): boolean {
  return duong.endsWith(".test.ts") || duong.endsWith(".test.tsx");
}

/** MỌI file nguồn dưới một thư mục, **đệ quy**. */
function moiFileTs(goc: string, ra: string[] = [], duoi: readonly string[] = [".ts"]): string[] {
  if (!existsSync(goc)) return ra;
  for (const ten of readdirSync(goc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(goc, ten);
    if (statSync(p).isDirectory()) moiFileTs(p, ra, duoi);
    else if (duoi.some((d) => ten.endsWith(d)) && !ten.endsWith(".d.ts")) ra.push(p);
  }
  return ra;
}

/**
 * MỌI file nguồn dưới `<goc>/<nhanh>` (đệ quy), đường tương đối gốc repo + đường thật.
 * Dùng chung cho MỌI lượng từ *"∀ nơi trong …"* để không lưới nào tự dựng lại phạm vi quét — hai
 * phạm vi khác nhau là hai cơ hội bỏ sót khác nhau (đúng lỗ R1b đã đo được).
 * @param duoi đuôi file cần lấy; mặc định `.ts` + `.tsx` (nửa client nằm trong `.tsx`).
 */
export function moiFileDuoi(
  goc: string,
  nhanh: string,
  duoi: readonly string[] = [".ts", ".tsx"],
): { duong: string; that: string }[] {
  return moiFileTs(join(goc, ...nhanh.split("/")), [], duoi).map((p) => ({
    duong: duongTuongDoi(goc, p),
    that: p,
  }));
}

/** Định danh TRÁI NHẤT của một chuỗi truy cập (`a.use(x).input(y)` → `a`). */
export function gocChuoi(n: ts.Node | undefined): string | null {
  let cur: ts.Node | undefined = n;
  for (;;) {
    if (cur === undefined) return null;
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) cur = cur.expression;
    else if (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur)) cur = cur.expression;
    else if (ts.isCallExpression(cur)) cur = cur.expression;
    else return null;
  }
}

/**
 * Đường nhập `spec` viết trong `tuFile` có **phân giải tới** `dich` không?
 * ⚠ Hỏi bằng phép nối đường dẫn — `"./trpc"` từ `server/_core/systemRouter.ts` và
 * `"../_core/trpc"` từ `server/routers/x.ts` là **cùng một module**, dù chính tả khác hẳn.
 */
export function phanGiaiToi(tuFile: string, spec: string, dich: string): boolean {
  if (!spec.startsWith(".")) return false;
  const p = resolve(dirname(tuFile), spec);
  return p === dich || `${p}.ts` === dich || join(p, "index.ts") === dich;
}

/**
 * Quét `server/**` và trả **mọi** thủ tục có chuỗi bắt nguồn từ `deployProcedure`.
 * @param goc thư mục gốc repo.
 */
export function quetThuTucDeploy(goc: string): KetQuaQuet {
  const THU_MUC_SERVER = join(goc, "server");
  const CORE_TRPC = join(THU_MUC_SERVER, "_core", "trpc.ts");
  const mu: string[] = [];

  const tatCa = moiFileTs(THU_MUC_SERVER);
  if (!existsSync(CORE_TRPC)) mu.push(`không thấy ${duongTuongDoi(goc, CORE_TRPC)} — bộ suy mất điểm neo`);

  const noiDung = new Map<string, string>();
  for (const f of tatCa) noiDung.set(f, readFileSync(f, "utf8"));

  // ── CẦU CHÌ (1): `export * from "…/trpc"` làm nấc nhập thứ hai trở nên có thể ──
  for (const f of tatCa) {
    if (f === CORE_TRPC) continue;
    const ma = noiDung.get(f) ?? "";
    if (!ma.includes("export *")) continue;
    for (const m of ma.matchAll(/export\s+\*\s+(?:as\s+\w+\s+)?from\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      if (spec !== undefined && phanGiaiToi(f, spec, CORE_TRPC)) {
        mu.push(
          `${duongTuongDoi(goc, f)} — \`export * from "${spec}"\` tái xuất \`_core/trpc\` ⇒ bộ suy MỘT NẤC không còn đủ`,
        );
      }
    }
  }

  // ── CẦU CHÌ (3): một file SẢN XUẤT nhập một `*.test.ts` ⇒ phép phân đôi dưới đây thôi đúng ──
  // Chỉ có ý nghĩa vì `thuTuc` **bỏ** các thủ tục khai trong lưới: nếu một router sản xuất nhập
  // được một file test thì một `router({…})` của lưới có thể được gắn vào `appRouter` thật, và
  // lúc ấy "khai trong `*.test.ts`" thôi còn nghĩa là "không với tới được từ dây".
  for (const f of tatCa) {
    const ten = duongTuongDoi(goc, f);
    if (laFileTest(ten)) continue;
    const ma = noiDung.get(f) ?? "";
    if (!ma.includes(".test")) continue;
    for (const m of ma.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g)) {
      const spec = m[1];
      if (spec === undefined) continue;
      const p = resolve(dirname(f), spec);
      for (const ung of [p, `${p}.ts`, `${p}.tsx`]) {
        if (laFileTest(ung.split(sep).join("/")) && existsSync(ung)) {
          mu.push(`${ten} — nhập \`${spec}\` (một file LƯỚI) ⇒ router của lưới có thể vào \`appRouter\` thật`);
        }
      }
    }
  }

  // Chỉ parse file có **chứa chữ** `deployProcedure`: một nấc nhập chỉ tồn tại khi tên ấy xuất
  // hiện (kể cả dạng bí danh `deployProcedure as deployBase`). Nấc thứ hai đã được cầu chì canh.
  const ungVien = tatCa.filter((f) => (noiDung.get(f) ?? "").includes(TEN_SAN_DEPLOY));

  const thuTuc: ThuTucDeploy[] = [];
  for (const f of ungVien) {
    const ten = duongTuongDoi(goc, f);
    const sf = ts.createSourceFile(ten, noiDung.get(f) ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    /** Tên CỤC BỘ trỏ tới `deployProcedure` của `_core/trpc` (kể cả bí danh nhập). */
    const root = new Set<string>();
    if (f === CORE_TRPC) root.add(TEN_SAN_DEPLOY);
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      if (!phanGiaiToi(f, st.moduleSpecifier.text, CORE_TRPC)) continue;
      const nb = st.importClause?.namedBindings;
      if (nb === undefined || !ts.isNamedImports(nb)) continue;
      for (const el of nb.elements) {
        if ((el.propertyName?.text ?? el.name.text) === TEN_SAN_DEPLOY) root.add(el.name.text);
      }
    }
    if (root.size === 0) continue;

    /** `const X = <expr>` ở cấp file → gốc chuỗi của `<expr>`. */
    const bien = new Map<string, string | null>();
    /** `const X = { … }` ở cấp file — cần để **mở** `...spread` khi đọc túi `input`. */
    const objectCuaBien = new Map<string, ts.ObjectLiteralExpression>();
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
        bien.set(d.name.text, gocChuoi(d.initializer));
        if (ts.isObjectLiteralExpression(d.initializer)) objectCuaBien.set(d.name.text, d.initializer);
      }
    }

    /**
     * Tên các ô của một object literal, **mở** cả `...spread` trỏ tới một object khai ở tầng module.
     * ⚠ `vramRouter.ts` viết `const totp = { totpCode: … }` rồi `z.object({ …totp, … })` — hỏi
     * "văn bản có chứa `totpCode`" thì trúng cả comment; hỏi trên cây mà **không** mở spread thì
     * trượt hết hai lệnh phá huỷ.
     */
    const oCuaObject = (n: ts.Node, sau = 0): { ten: string; batBuoc: boolean }[] => {
      if (sau > 4 || !ts.isObjectLiteralExpression(n)) return [];
      const ra: { ten: string; batBuoc: boolean }[] = [];
      for (const p of n.properties) {
        if (ts.isSpreadAssignment(p)) {
          const g = ts.isIdentifier(p.expression) ? objectCuaBien.get(p.expression.text) : undefined;
          if (g !== undefined) ra.push(...oCuaObject(g, sau + 1));
          continue;
        }
        if (p.name === undefined) continue;
        // ⚠ `batBuoc` hỏi trên **văn bản của chính ô ấy**, không của cả object — `z.object({ a:
        //   z.string().optional(), totpCode: z.string() })` phải cho `totpCode` là bắt buộc.
        const val = ts.isPropertyAssignment(p) ? p.initializer.getText(sf) : "";
        ra.push({
          ten: p.name.getText(sf).replace(/["']/g, ""),
          batBuoc: !/\.(optional|nullish|default)\s*\(/.test(val),
        });
      }
      return ra;
    };

    /** Chuỗi `X.input(…).mutation(…)` này khai ô `totpCode` thế nào (có / bắt buộc)? */
    const docTotp = (chuoi: ts.Node): { khai: boolean; batBuoc: boolean } => {
      let khai = false;
      let batBuoc = false;
      const doc = (x: ts.Node): void => {
        if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "input") {
          const a0 = x.arguments[0];
          if (a0 !== undefined) {
            const di2 = (y: ts.Node): void => {
              for (const o of oCuaObject(y)) {
                if (o.ten !== "totpCode") continue;
                khai = true;
                if (o.batBuoc) batBuoc = true;
              }
              ts.forEachChild(y, di2);
            };
            di2(a0);
          }
        }
        ts.forEachChild(x, doc);
      };
      doc(chuoi);
      return { khai, batBuoc };
    };
    /** Leo ngược chuỗi biến tới khi chạm một tên gốc. Bao nhiêu `const` trung gian cũng được. */
    const batNguon = (bd: string | null): boolean => {
      let cur = bd;
      for (let i = 0; i < 32 && cur !== null; i++) {
        if (root.has(cur)) return true;
        if (!bien.has(cur)) return false;
        cur = bien.get(cur) ?? null;
      }
      return false;
    };

    // ── CẦU CHÌ (2): file này TÁI XUẤT một bí danh của `deployProcedure`? ──
    if (f !== CORE_TRPC) {
      for (const st of sf.statements) {
        if (ts.isExportDeclaration(st) && st.exportClause !== undefined && ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) {
            const nguon = el.propertyName?.text ?? el.name.text;
            if (batNguon(nguon)) {
              mu.push(`${ten} — tái xuất \`${nguon}\` (bí danh của \`${TEN_SAN_DEPLOY}\`) ⇒ bộ suy MỘT NẤC không đủ`);
            }
          }
        }
        if (ts.isVariableStatement(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true) {
          for (const d of st.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
            // Một `export const X = <chuỗi bắt nguồn từ deployProcedure>` **không có** `.mutation(`
            // là một SÀN tái xuất được — file khác nhập `X` mà không nhắc `deployProcedure`.
            let coMutation = false;
            const doc = (x: ts.Node): void => {
              if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "mutation") coMutation = true;
              ts.forEachChild(x, doc);
            };
            doc(d.initializer);
            if (!coMutation && batNguon(gocChuoi(d.initializer))) {
              mu.push(`${ten} — \`export const ${d.name.text}\` là SÀN dẫn xuất từ \`${TEN_SAN_DEPLOY}\` ⇒ bộ suy MỘT NẤC không đủ`);
            }
          }
        }
      }
    }

    const di = (n: ts.Node): void => {
      const arg0 = ts.isCallExpression(n) ? n.arguments[0] : undefined;
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "router" &&
        arg0 !== undefined &&
        ts.isObjectLiteralExpression(arg0)
      ) {
        for (const p of arg0.properties) {
          const dong = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1;
          if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) {
            // Một ô `...spread` / shorthand trong `router({…})` chỉ đáng báo khi file này THẬT SỰ
            // có sàn deploy — `server/routers.ts` gắn hàng trăm router con bằng shorthand.
            if (ts.isShorthandPropertyAssignment(p) && batNguon(p.name.text)) {
              mu.push(`${ten}:${dong} — ô shorthand \`${p.name.text}\` bắt nguồn từ \`${TEN_SAN_DEPLOY}\``);
            }
            continue;
          }
          if (batNguon(gocChuoi(p.initializer))) {
            const t = docTotp(p.initializer);
            thuTuc.push({ file: ten, ten: p.name.text, khaiTotp: t.khai, totpBatBuoc: t.batBuoc });
          }
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }

  return {
    thuTuc: thuTuc.filter((t) => !laFileTest(t.file)),
    thuTucTest: thuTuc.filter((t) => laFileTest(t.file)),
    mu,
    ungVien: ungVien.map((f) => duongTuongDoi(goc, f)),
    soFileDuyet: tatCa.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ C-2 (review TOÀN NHÁNH Pha 6) — **NỬA KIA CỦA CÙNG MỘT CÂU, NAY DÙNG CHUNG BỘ SUY NÀY.**
//
// ⚠⚠⚠ VÌ SAO PHẦN NÀY NẰM Ở ĐÂY, KHÔNG PHẢI TRONG MỘT FILE THỨ BA:
// Câu load-bearing của Pha 6 — *"lệnh phá huỷ VRAM phải đòi OTP MỖI LƯỢT"* — được canh bởi **HAI**
// bộ suy AST **độc lập hoàn toàn**, và chúng canh **hai phạm vi khác nhau**:
//
//   | | nửa `deployProcedure` (Task 1b) | nửa "lệnh phá huỷ VRAM" (Task 1) |
//   |---|---|---|
//   | phạm vi quét | `server/**` **đệ quy** | **một file** `vramRouter.ts` |
//   | nhận diện module | phép **nối đường dẫn** | đường dẫn **ghim cứng** |
//
// Đột biến **W3** của người review đo được hậu quả: cùng một hàm **giết tiến trình**, gắn làm
// mutation ở **`server/routers/aiModelRouter.ts`** (đã nối `appRouter`) trên sàn
// `roleProcedure(...).use(require2FA)` — **không step-up nào** — ⇒ **cổng XANH 109 file/1.861 ca,
// `tsc` sạch**. *Độc lập về NGUỒN không đảm bảo độc lập về SAI LẦM: cái YẾU HƠN canh nửa NGUY
// HIỂM HƠN.*
//
// ⇒ Bản vá **không** là "thêm một file nữa vào danh sách của bộ suy yếu". Nó là: **nửa VRAM dùng
//   lại đúng bộ suy đã trả giá để học bài R1b** — cùng phép duyệt đệ quy, cùng `phanGiaiToi()`,
//   cùng `gocChuoi()`, cùng kỷ luật "ô không phân giải được ⇒ ĐỎ".
//
// ⚠⚠ **TẬP "CƠ CHẾ PHÁ HUỶ" ĐƯỢC SUY RA, KHÔNG LIỆT KÊ.** Một bảng tên hàm chép tay ở đây sẽ có
//   phần tử thứ N+1 đúng như mọi bảng trước. Thay vào đó:
//     • **hạt giống** = ∀ hàm lệnh mà `VRAM_COMMAND_DESTRUCTIVE` phân loại PHÁ HUỶ → mọi định
//       danh trong **thân** nó được **NHẬP từ một module KHÁC dưới `server/services/vram/**`**.
//       Hôm nay cho đúng `preemptOwner` + `releaseStaleSharedRow`; `byteRaApi`/`chungPhamVi` là
//       hàm **cục bộ** của `vramCommands.ts` nên không lọt vào (đã đo).
//     • **tập phá huỷ** = **bao đóng NGƯỢC** của hạt giống trên `server/**`: *ai gọi tới được cơ
//       chế ấy*. Bao đóng NGƯỢC (không phải xuôi) là điều kiện để tập không nở ra vô nghĩa —
//       bao đóng xuôi từ `vramPreemptCommand` sẽ nuốt cả `vramSharedLedgerStore` mà mọi lượt
//       đọc đều đi qua.
//   ⇒ `huyHoTieuThu` của W3 — hàm **MỚI**, **tên không khớp mẫu nào**, đặt trong `vramPreempt.ts`,
//     gọi `preemptOwner()` — **tự đưa mình vào tập** mà không ai phải nhớ khai gì.
//
// ⚠ Ba cầu chì (đảo lượng từ thay vì im lặng bỏ sót): hạt giống rỗng · một hàm lệnh PHÁ HUỶ không
//   đóng góp cơ chế nào · một `export *` / tái xuất bí danh làm bao đóng một-nấc-tên không còn đủ.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Thư mục **chủ** của hành vi phá huỷ VRAM. Mọi cơ chế đều được suy ra từ trong đây. */
export const THU_MUC_VRAM = "server/services/vram";
/** File giữ bảng phân loại `VRAM_COMMAND_DESTRUCTIVE`. */
export const FILE_LENH_VRAM = `${THU_MUC_VRAM}/vramCommands.ts`;

/** Một mutation dưới `server/**` với tới được một cơ chế phá huỷ VRAM. */
export interface MutationPhaHuy {
  /** Đường dẫn tương đối gốc repo (dấu `/`). */
  readonly file: string;
  /** Tên ô trong `router({ … })`. */
  readonly ten: string;
  /** Dòng khai (để câu lỗi chỉ đúng chỗ). */
  readonly dong: number;
  /** Chuỗi thủ tục có chain `requirePerCallFreshTotp` — trực tiếp, hoặc qua GỐC `deployProcedure`. */
  readonly siet: boolean;
  /** `true` khi phép siết đến từ **GỐC** `deployProcedure` chứ không từ một `.use()` tại chỗ. */
  readonly sietTuGoc: boolean;
  /** Tên các nút phá huỷ mà ô này với tới — để câu lỗi gọi ĐÍCH DANH. */
  readonly quaNut: readonly string[];
}

export interface KetQuaQuetPhaHuy {
  /** Cơ chế gốc, suy từ thân các hàm lệnh PHÁ HUỶ (`file#tên`). */
  readonly coChe: readonly string[];
  /** Bao đóng NGƯỢC: mọi `file#tên` dưới `server/**` với tới được một cơ chế. */
  readonly nutPhaHuy: readonly string[];
  /** Mọi mutation (mọi router, mọi file) chạm vào bao đóng ấy. */
  readonly mutation: readonly MutationPhaHuy[];
  /** Ô KHÔNG phân giải được — mỗi mục là một ô KHÔNG AI CANH ⇒ lưới phải ĐỎ. */
  readonly mu: readonly string[];
  /** Tổng số file `.ts` đã duyệt — cầu chì chống "quét trúng 0 file". */
  readonly soFileDuyet: number;
}

/**
 * Mọi định danh **CÓ THỂ LÀ MỘT RÀNG BUỘC CẤP MODULE** trong một cây con.
 *
 * ⚠ Bỏ hai hình dạng **không bao giờ** là ràng buộc, vì chúng đẻ ra cạnh giả trong đồ thị gọi:
 *  • **tên ô** của object literal — `{ vramPreemptCommand: true }` trong `VRAM_COMMAND_DESTRUCTIVE`
 *    làm chính **bảng phân loại** trở thành "nút phá huỷ" nếu không lọc;
 *  • **tên thuộc tính** của `a.b` — `broker.preemptStepForOwner` không phải một ràng buộc tên `preemptStepForOwner`.
 */
function dinhDanhTrong(n: ts.Node): Set<string> {
  const ra = new Set<string>();
  const di = (x: ts.Node): void => {
    if (ts.isPropertyAccessExpression(x)) {
      di(x.expression);
      return;
    }
    if ((ts.isPropertyAssignment(x) || ts.isPropertySignature(x)) && x.name !== undefined) {
      if (ts.isPropertyAssignment(x)) di(x.initializer);
      return;
    }
    if (ts.isIdentifier(x)) ra.add(x.text);
    ts.forEachChild(x, di);
  };
  di(n);
  return ra;
}

/** Chuỗi biểu thức này có một lời gọi `.mutation(` không? */
function coMutation(n: ts.Node): boolean {
  let ra = false;
  const di = (x: ts.Node): void => {
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "mutation") {
      ra = true;
    }
    ts.forEachChild(x, di);
  };
  di(n);
  return ra;
}

/**
 * ★★★ *"Ai với tới được cơ chế phá huỷ VRAM, và mutation nào đứng trên họ?"* — lượng từ chạy trên
 * **`server/**` đệ quy**, đúng phạm vi mà bài học R1b đã mua được cho nửa `deployProcedure`.
 *
 * @param goc thư mục gốc repo.
 * @param phanLoai bảng `VRAM_COMMAND_DESTRUCTIVE` (tên hàm lệnh → có phá huỷ không). **Truyền vào**
 *   chứ không nhập: file này cố ý chỉ phụ thuộc `fs`/`path`/`typescript`, và người gọi phải cầm
 *   **chính** bảng đang chạy trong sản xuất, không phải một bản chép.
 */
export function quetLenhPhaHuyVram(goc: string, phanLoai: Readonly<Record<string, boolean>>): KetQuaQuetPhaHuy {
  const THU_MUC_SERVER = join(goc, "server");
  const CORE_TRPC = join(THU_MUC_SERVER, "_core", "trpc.ts");
  const FILE_LENH = join(goc, ...FILE_LENH_VRAM.split("/"));
  const DIR_VRAM = join(goc, ...THU_MUC_VRAM.split("/"));
  const mu: string[] = [];

  const tatCa = moiFileTs(THU_MUC_SERVER);
  const noiDung = new Map<string, string>();
  for (const f of tatCa) noiDung.set(f, readFileSync(f, "utf8"));
  const duongCua = (f: string): string => duongTuongDoi(goc, f);

  if (!existsSync(FILE_LENH)) mu.push(`không thấy ${FILE_LENH_VRAM} — bộ suy mất chủ của phân loại`);

  /** `file thật` → cây đã parse (parse **theo yêu cầu**, không parse cả 1.7k file). */
  const cayCua = new Map<string, ts.SourceFile>();
  const cay = (f: string): ts.SourceFile => {
    const co = cayCua.get(f);
    if (co !== undefined) return co;
    const sf = ts.createSourceFile(duongCua(f), noiDung.get(f) ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    cayCua.set(f, sf);
    return sf;
  };

  /** Ràng buộc nhập của một file: tên CỤC BỘ → `fileThật#tênGốc`. */
  const nhapCua = (f: string): Map<string, string> => {
    const ra = new Map<string, string>();
    for (const st of cay(f).statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const spec = st.moduleSpecifier.text;
      if (!spec.startsWith(".")) continue;
      const p = resolve(dirname(f), spec);
      const dich = [p, `${p}.ts`, join(p, "index.ts")].find((c) => existsSync(c) && c.endsWith(".ts"));
      if (dich === undefined) continue;
      const nb = st.importClause?.namedBindings;
      if (nb === undefined || !ts.isNamedImports(nb)) continue;
      for (const el of nb.elements) ra.set(el.name.text, `${duongCua(dich)}#${el.propertyName?.text ?? el.name.text}`);
    }
    return ra;
  };

  /** Khai báo cấp file: tên → cây con của thân/khởi tạo. Dùng cho cả bao đóng ngược lẫn chuỗi sàn. */
  const khaiCua = (f: string): Map<string, ts.Node> => {
    const ra = new Map<string, ts.Node>();
    for (const st of cay(f).statements) {
      if (ts.isFunctionDeclaration(st) && st.name !== undefined && st.body !== undefined) ra.set(st.name.text, st.body);
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer !== undefined) ra.set(d.name.text, d.initializer);
        }
      }
    }
    return ra;
  };

  // ── (1) HẠT GIỐNG — cơ chế phá huỷ, suy từ THÂN các hàm lệnh được phân loại PHÁ HUỶ ──────────
  const coChe = new Set<string>();
  const lenhKhongCoChe: string[] = [];
  if (existsSync(FILE_LENH)) {
    const nhap = nhapCua(FILE_LENH);
    const khai = khaiCua(FILE_LENH);
    for (const [ten, phaHuy] of Object.entries(phanLoai)) {
      if (!phaHuy) continue;
      const than = khai.get(ten);
      if (than === undefined) {
        mu.push(`${FILE_LENH_VRAM} — không thấy thân của hàm lệnh \`${ten}\` đã phân loại PHÁ HUỶ`);
        continue;
      }
      let them = 0;
      for (const id of dinhDanhTrong(than)) {
        const dich = nhap.get(id);
        if (dich === undefined) continue;
        // Chỉ nhận cơ chế nằm **trong module VRAM** — một `z`/`sql`/tiện ích chung không phải cơ chế.
        if (!dich.startsWith(`${THU_MUC_VRAM}/`)) continue;
        coChe.add(dich);
        them++;
      }
      if (them === 0) lenhKhongCoChe.push(ten);
    }
  }
  if (lenhKhongCoChe.length > 0) {
    mu.push(
      `hàm lệnh PHÁ HUỶ không gọi cơ chế nào dưới ${THU_MUC_VRAM}/ ⇒ bộ suy KHÔNG thấy đường phá huỷ của nó: ${lenhKhongCoChe.join(" · ")}`,
    );
  }

  // ── CẦU CHÌ — `export *` / tái xuất bí danh làm bao đóng theo TÊN không còn đủ ────────────────
  for (const f of tatCa) {
    const ma = noiDung.get(f) ?? "";
    if (!ma.includes("export *")) continue;
    for (const m of ma.matchAll(/export\s+\*\s+(?:as\s+\w+\s+)?from\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      if (spec === undefined || !spec.startsWith(".")) continue;
      const p = resolve(dirname(f), spec);
      const dich = [`${p}.ts`, join(p, "index.ts")].find((c) => existsSync(c));
      if (dich !== undefined && (dich === FILE_LENH || dich.startsWith(DIR_VRAM + sep))) {
        mu.push(`${duongCua(f)} — \`export * from "${spec}"\` tái xuất module VRAM ⇒ bao đóng theo TÊN không còn đủ`);
      }
    }
  }

  // ── (2) BAO ĐÓNG NGƯỢC — ai gọi tới được một cơ chế, trên TOÀN `server/**` ────────────────────
  const nutPhaHuy = new Set<string>(coChe);
  for (let vong = 0; vong < 12; vong++) {
    /** Tên **trần** của mọi nút hiện có — dùng để lọc file bằng VĂN BẢN trước khi parse. */
    const tenTran = new Set([...nutPhaHuy].map((n) => n.split("#")[1] ?? ""));
    let them = 0;
    for (const f of tatCa) {
      const ma = noiDung.get(f) ?? "";
      if (![...tenTran].some((t) => t !== "" && ma.includes(t))) continue;
      const nhap = nhapCua(f);
      const khai = khaiCua(f);
      const rel = duongCua(f);
      for (const [ten, than] of khai) {
        const nut = `${rel}#${ten}`;
        if (nutPhaHuy.has(nut)) continue;
        for (const id of dinhDanhTrong(than)) {
          const dich = nhap.get(id) ?? `${rel}#${id}`;
          if (nutPhaHuy.has(dich)) {
            nutPhaHuy.add(nut);
            them++;
            break;
          }
        }
      }
    }
    if (them === 0) break;
  }

  // ── (3) MUTATION — ∀ `router({…})` dưới `server/**` chạm vào bao đóng ────────────────────────
  const mutation: MutationPhaHuy[] = [];
  const tenTranCuoi = new Set([...nutPhaHuy].map((n) => n.split("#")[1] ?? ""));
  for (const f of tatCa) {
    const ma = noiDung.get(f) ?? "";
    if (!ma.includes("router(")) continue;
    if (![...tenTranCuoi].some((t) => t !== "" && ma.includes(t))) continue;
    const rel = duongCua(f);
    const sf = cay(f);
    const nhap = nhapCua(f);
    const khai = khaiCua(f);

    /** Tên CỤC BỘ trỏ tới GỐC `deployProcedure` của `_core/trpc.ts` (kể cả bí danh nhập). */
    const gocDeploy = new Set<string>();
    if (f === CORE_TRPC) gocDeploy.add(TEN_SAN_DEPLOY);
    for (const [cucBo, dich] of nhap) {
      if (dich === `${duongCua(CORE_TRPC)}#${TEN_SAN_DEPLOY}`) gocDeploy.add(cucBo);
    }

    /** Leo ngược chuỗi `const`: gom phép siết tại chỗ + tên sàn ngoài cùng. */
    const leo = (bd: string | null): { siet: boolean; san: string | null } => {
      let siet = false;
      let cur = bd;
      for (let i = 0; i < 16 && cur !== null; i++) {
        if (gocDeploy.has(cur)) return { siet, san: cur };
        const kh = khai.get(cur);
        if (kh === undefined) return { siet, san: cur };
        if (dinhDanhTrong(kh).has(TEN_PHEP_SIET)) siet = true;
        cur = gocChuoi(kh);
      }
      return { siet, san: null };
    };

    const di = (n: ts.Node): void => {
      const arg0 = ts.isCallExpression(n) ? n.arguments[0] : undefined;
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "router" &&
        arg0 !== undefined &&
        ts.isObjectLiteralExpression(arg0)
      ) {
        for (const p of arg0.properties) {
          if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
          if (!coMutation(p.initializer)) continue;
          const ids = dinhDanhTrong(p.initializer);
          const quaNut = [...ids]
            .filter((id) => nutPhaHuy.has(nhap.get(id) ?? `${rel}#${id}`))
            .sort();
          if (quaNut.length === 0) continue;
          const l = leo(gocChuoi(p.initializer));
          const sietTuGoc = l.san !== null && gocDeploy.has(l.san);
          mutation.push({
            file: rel,
            ten: p.name.text,
            dong: sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1,
            siet: l.siet || ids.has(TEN_PHEP_SIET) || sietTuGoc,
            sietTuGoc,
            quaNut,
          });
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }

  return {
    coChe: [...coChe].sort(),
    nutPhaHuy: [...nutPhaHuy].sort(),
    mutation: mutation.sort((a, b) => `${a.file}#${a.ten}`.localeCompare(`${b.file}#${b.ten}`)),
    mu,
    soFileDuyet: tatCa.length,
  };
}

/**
 * `server/routers.ts` gắn router con vào **không gian tên** mà client gọi (`trpc.<ns>.<thủ tục>`).
 * Trả `ns` → đường dẫn file của router con, để lưới client kiểm được rằng nó bắt **đúng** thủ tục
 * chứ không phải một cái trùng tên ở router khác.
 */
export function anhXaKhongGianTen(goc: string): { anhXa: Record<string, string>; mu: string[] } {
  const GOC_ROUTER = join(goc, "server", "routers.ts");
  const mu: string[] = [];
  const anhXa: Record<string, string> = {};
  if (!existsSync(GOC_ROUTER)) {
    mu.push("không thấy server/routers.ts — không dựng được ánh xạ không-gian-tên");
    return { anhXa, mu };
  }
  const ma = readFileSync(GOC_ROUTER, "utf8");
  const sf = ts.createSourceFile("routers.ts", ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /** định danh nhập → đường dẫn file (tương đối gốc repo). */
  const tuNhap = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (!spec.startsWith(".")) continue;
    const p = `${resolve(dirname(GOC_ROUTER), spec)}.ts`;
    const nb = st.importClause?.namedBindings;
    if (nb === undefined || !ts.isNamedImports(nb)) continue;
    for (const el of nb.elements) tuNhap.set(el.name.text, duongTuongDoi(goc, p));
  }

  const di = (n: ts.Node): void => {
    const arg0 = ts.isCallExpression(n) ? n.arguments[0] : undefined;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "router" &&
      arg0 !== undefined &&
      ts.isObjectLiteralExpression(arg0)
    ) {
      for (const p of arg0.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
        if (!ts.isIdentifier(p.initializer)) continue;
        const f = tuNhap.get(p.initializer.text);
        if (f !== undefined) anhXa[p.name.text] = f;
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  if (Object.keys(anhXa).length === 0) mu.push("server/routers.ts không cho ánh xạ nào — đã đổi hình dạng?");
  return { anhXa, mu };
}
