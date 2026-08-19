/**
 * ★★★ BỘ SUY **"THỦ TỤC NÀY ĐỨNG SAU CỔNG GIẤY PHÉP NÀO"** — dùng chung, chạy trên `server/**`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO NÓ LÀ MỘT LƯỢNG TỪ, KHÔNG PHẢI MỘT DANH SÁCH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lượt nối cổng `MOD_AI` chạm **hơn hai chục file router**. Một bảng kê chép tay *"những file đã
 * nối"* sẽ có phần tử thứ N+1 đúng như mọi bảng chép tay khác trong repo này: ai đó thêm một thủ
 * tục vào `aiChatRouter.ts` ngày mai, nó **kế thừa** sàn đã cổng nên vẫn đúng — nhưng ai đó tạo
 * `aiFooRouter.ts` mới thì **không cổng nào**, và không lưới nào biết.
 *
 * ⇒ File này trả lời **hai** câu, và hai câu ấy đi NGƯỢC chiều nhau — đó là toàn bộ giá trị của nó:
 *
 *   (1) *"∀ thủ tục thuộc bề mặt AI: nó có đứng sau `MOD_AI` không?"*  ← phủ sóng
 *   (2) *"∀ thủ tục **NGOÀI** bề mặt AI: nó có **LỠ** đứng sau `MOD_AI` không?"*  ← **KHÔNG HỒI QUY**
 *
 * Câu (2) là câu quan trọng hơn. Khoá nhầm một thủ tục vận hành = làm hỏng khách **không** mua AI,
 * và đó là ràng buộc số một của cả lượt việc. Một cổng chỉ phát biểu (1) sẽ **xanh** khi ai đó bọc
 * `moduleGate("MOD_AI")` quanh cả `productionRouters.ts`.
 *
 * ── Cách phân giải (trên CÂY, không trên văn bản) ─────────────────────────────────────────────
 * `moduleProcedure("MOD_X")` và `<sàn>.use(moduleGate("MOD_X"))` đều là **một lời gọi có đối số
 * chuỗi**. Bộ suy:
 *   • dựng ánh xạ **TOÀN CỤC** `file#tênConst → mã module`, đi qua cả **bí danh nhập** và **nhiều
 *     nấc `const`** (`A = moduleProcedure("MOD_AI")` · `B = A.use(x)` · `C = B`) bằng một điểm bất
 *     động — nên tái xuất một sàn đã cổng sang file khác vẫn được nhìn thấy;
 *   • với mỗi ô trong `router({…})`: lấy mã **TẠI CHỖ** nếu chuỗi có `.use(moduleGate("…"))`, nếu
 *     không thì leo về gốc chuỗi (`gocChuoi`) và tra ánh xạ trên.
 *
 * ── BA CẦU CHÌ (đảo lượng từ thay vì im lặng bỏ sót) ──────────────────────────────────────────
 *   (a) `moduleGate(x)` / `moduleProcedure(x)` với `x` **không phải chuỗi literal** ⇒ ô mù: bộ suy
 *       không biết đó là module nào, và một mã module tính động là đúng thứ làm cả hai câu trên vô
 *       nghĩa.
 *   (b) một file **có nhắc** `moduleGate`/`moduleProcedure` mà bộ suy **không rút ra** ràng buộc
 *       nào ⇒ ô mù: nó được viết bằng một hình dạng bộ suy chưa biết đọc.
 *   (c) `export * from "…/trpc"` ở file khác `trpc.ts` ⇒ ô mù: phép nhận diện theo tên hết đủ.
 *
 * ⚠ Bộ suy **KHÔNG** phát biểu gì về tuyến Express — `moduleGate` là middleware tRPC và không với
 *   tới đó. Nửa ấy có bộ suy riêng ở cuối file (`quetCongAiExpress`), vì bài học "lỗ thứ chín"
 *   (`phamViDocCensus`) nói rằng một cổng chỉ thấy tRPC là một cổng **mù một nửa hệ**.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import ts from "typescript";
import { moiFileDuoi, gocChuoi, phanGiaiToi, laFileTest } from "./deployProcedureScan";

/** Tên export GỐC ở `server/_core/trpc.ts` mở đường vào cổng giấy phép. */
export const TEN_SAN_CONG = ["moduleProcedure", "moduleGate"] as const;

/** Một thủ tục tRPC kèm mã module (nếu có) mà nó đứng sau. */
export interface ThuTucCong {
  /** Đường tương đối gốc repo, dấu `/`. */
  readonly file: string;
  readonly dong: number;
  /** Tên ô trong `router({ … })`. */
  readonly ten: string;
  /** Đường router bao quanh (`aiChatRouter` · `aiVisionRouter.advanced`). */
  readonly duongRouter: string;
  /** Định danh sàn ngoài cùng của chuỗi (`protectedProcedure` · `thuTucVanHanh` · …). */
  readonly san: string;
  readonly loai: "query" | "mutation" | "subscription";
  /** Mã SKU mà thủ tục này đứng sau, hoặc `null` khi KHÔNG có cổng giấy phép nào. */
  readonly module: string | null;
}

export interface KetQuaQuetCong {
  readonly thuTuc: readonly ThuTucCong[];
  /** Ô KHÔNG phân giải được — mỗi mục là một chỗ KHÔNG AI CANH ⇒ lưới phải ĐỎ. */
  readonly mu: readonly string[];
  /** Số file `.ts` đã duyệt — cầu chì chống "quét trúng 0 file". */
  readonly soFileDuyet: number;
  /** Số file đã thật sự parse (có chứa `router(`). */
  readonly soFileParse: number;
}

/** Khoá ỔN ĐỊNH (không mang số dòng — dòng trôi ở mỗi lượt sửa). */
export function khoaCong(t: Pick<ThuTucCong, "file" | "duongRouter" | "ten">): string {
  return `${t.file}#${t.duongRouter}.${t.ten}`;
}

/** Đối số thứ nhất của một lời gọi, khi nó là literal chuỗi. `undefined` ⇒ không phải literal. */
function chuoiDoiSoDau(n: ts.CallExpression): string | undefined {
  const a = n.arguments[0];
  if (a === undefined) return undefined;
  if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  return undefined;
}

/**
 * Quét `server/**` và trả **mọi** thủ tục tRPC kèm mã module mà nó đứng sau.
 * @param goc thư mục gốc repo.
 */
export function quetCongGiayPhep(goc: string): KetQuaQuetCong {
  const CORE_TRPC = join(goc, "server", "_core", "trpc.ts");
  const mu: string[] = [];

  const tatCa = moiFileDuoi(goc, "server", [".ts"]);
  if (!existsSync(CORE_TRPC)) mu.push("không thấy server/_core/trpc.ts — bộ suy mất điểm neo");

  const noiDung = new Map<string, string>();
  for (const f of tatCa) noiDung.set(f.that, readFileSync(f.that, "utf8"));

  const cayCua = new Map<string, ts.SourceFile>();
  const cay = (f: { duong: string; that: string }): ts.SourceFile => {
    const co = cayCua.get(f.that);
    if (co !== undefined) return co;
    const sf = ts.createSourceFile(
      f.duong,
      noiDung.get(f.that) ?? "",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    cayCua.set(f.that, sf);
    return sf;
  };

  // ── CẦU CHÌ (c): `export * from "…/trpc"` làm phép nhận diện theo TÊN hết đủ ─────────────────
  for (const f of tatCa) {
    if (f.that === CORE_TRPC) continue;
    const ma = noiDung.get(f.that) ?? "";
    if (!ma.includes("export *")) continue;
    for (const m of ma.matchAll(/export\s+\*\s+(?:as\s+\w+\s+)?from\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      if (spec !== undefined && phanGiaiToi(f.that, spec, CORE_TRPC)) {
        mu.push(`${f.duong} — \`export * from "${spec}"\` tái xuất \`_core/trpc\` ⇒ nhận diện theo TÊN hết đủ`);
      }
    }
  }

  /** `file#tên` → mã module ĐÃ BIẾT (từ một lời gọi literal tại chỗ). */
  const modulCua = new Map<string, string>();
  /** `file#tên` → `file#tên` cha (kế thừa sàn). */
  const chaCua = new Map<string, string>();
  /** File nào có ràng buộc nào được rút ra (cho cầu chì (b)). */
  const fileCoRangBuoc = new Set<string>();
  /** File NHẬP `moduleGate`/`moduleProcedure` từ `_core/trpc` — chỉ những file NÀY bị cầu chì (b) hỏi. */
  const fileNhapCong = new Set<string>();

  /** Ràng buộc nhập của một file: tên CỤC BỘ → `fileTươngĐối#tênGốc`. */
  const nhapCua = (f: { duong: string; that: string }): Map<string, string> => {
    const ra = new Map<string, string>();
    for (const st of cay(f).statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const spec = st.moduleSpecifier.text;
      if (!spec.startsWith(".")) continue;
      const p = resolve(dirname(f.that), spec);
      const dich = [p, `${p}.ts`, join(p, "index.ts")].find((c) => c.endsWith(".ts") && existsSync(c));
      if (dich === undefined) continue;
      const rel = tatCa.find((x) => x.that === dich)?.duong;
      if (rel === undefined) continue;
      const nb = st.importClause?.namedBindings;
      if (nb === undefined || !ts.isNamedImports(nb)) continue;
      for (const el of nb.elements) ra.set(el.name.text, `${rel}#${el.propertyName?.text ?? el.name.text}`);
    }
    return ra;
  };

  /**
   * Mã module khai TẠI CHỖ trong một cây con: lời gọi `moduleProcedure("…")` /
   * `moduleGate("…")` mà callee (kể cả bí danh nhập) trỏ về `_core/trpc`.
   * Trả `{ ma }` khi rõ; `{ mu: true }` khi có lời gọi nhưng đối số KHÔNG phải literal.
   */
  const maTaiCho = (
    n: ts.Node,
    tenCong: Set<string>,
    sf: ts.SourceFile,
  ): { ma: string | null; mu: string | null } => {
    let ma: string | null = null;
    let loi: string | null = null;
    const di = (x: ts.Node): void => {
      if (ts.isCallExpression(x)) {
        const callee = ts.isIdentifier(x.expression)
          ? x.expression.text
          : ts.isPropertyAccessExpression(x.expression)
            ? x.expression.name.text
            : "";
        if (tenCong.has(callee)) {
          const s = chuoiDoiSoDau(x);
          if (s === undefined) {
            loi = `đối số của \`${callee}(…)\` KHÔNG phải chuỗi literal: \`${x.getText(sf).slice(0, 80)}\``;
          } else if (ma === null) {
            ma = s;
          }
        }
      }
      ts.forEachChild(x, di);
    };
    di(n);
    return { ma, mu: loi };
  };

  // ── Pha A: rút ràng buộc `const` ở CẤP FILE ─────────────────────────────────────────────────
  for (const f of tatCa) {
    const ma = noiDung.get(f.that) ?? "";
    const nhacCong = TEN_SAN_CONG.some((t) => ma.includes(t));
    if (!ma.includes("const ") && !nhacCong) continue;
    const sf = cay(f);
    const nhap = nhapCua(f);

    /** Tên CỤC BỘ trỏ tới `moduleProcedure`/`moduleGate` GỐC của `_core/trpc`. */
    const tenCong = new Set<string>();
    if (f.that === CORE_TRPC) for (const t of TEN_SAN_CONG) tenCong.add(t);
    for (const [cucBo, dich] of nhap) {
      for (const t of TEN_SAN_CONG) if (dich === `server/_core/trpc.ts#${t}`) tenCong.add(cucBo);
    }
    if (tenCong.size > 0) fileNhapCong.add(f.duong);

    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
        const nut = `${f.duong}#${d.name.text}`;
        if (tenCong.size > 0) {
          const r = maTaiCho(d.initializer, tenCong, sf);
          if (r.mu !== null) {
            mu.push(`${f.duong} — ${r.mu}`);
            fileCoRangBuoc.add(f.duong);
          }
          if (r.ma !== null) {
            modulCua.set(nut, r.ma);
            fileCoRangBuoc.add(f.duong);
            continue;
          }
        }
        const g = gocChuoi(d.initializer);
        if (g === null) continue;
        chaCua.set(nut, nhap.get(g) ?? `${f.duong}#${g}`);
      }
    }
    void nhacCong;
  }

  // ── Pha B: điểm bất động — kế thừa mã module dọc chuỗi `const` (xuyên file) ──────────────────
  for (let vong = 0; vong < 16; vong++) {
    let them = 0;
    for (const [nut, cha] of chaCua) {
      if (modulCua.has(nut)) continue;
      const m = modulCua.get(cha);
      if (m !== undefined) {
        modulCua.set(nut, m);
        them++;
      }
    }
    if (them === 0) break;
  }

  // ── Pha C: mọi ô trong `router({…})` ────────────────────────────────────────────────────────
  const thuTuc: ThuTucCong[] = [];
  let soFileParse = 0;
  for (const f of tatCa) {
    const ma = noiDung.get(f.that) ?? "";
    if (!ma.includes("router(")) continue;
    // ⚠ Bề mặt CÓ THẬT của sản phẩm = file **KHÔNG** phải `*.test.ts`. Một `router({…})` khai trong
    //   một lưới không nối được vào `appRouter` (`server/routers.ts` không nhập file test nào — và
    //   `deployProcedureScan.quetThuTucDeploy` có cầu chì ĐỎ nếu điều đó đổi). Gộp chúng vào con số
    //   ghim thì một lượt sửa LƯỚI làm đỏ một ô nói về SẢN PHẨM.
    if (laFileTest(f.duong)) continue;
    soFileParse++;
    const sf = cay(f);
    const nhap = nhapCua(f);

    const tenCong = new Set<string>();
    if (f.that === CORE_TRPC) for (const t of TEN_SAN_CONG) tenCong.add(t);
    for (const [cucBo, dich] of nhap) {
      for (const t of TEN_SAN_CONG) if (dich === `server/_core/trpc.ts#${t}`) tenCong.add(cucBo);
    }

    /** `router({…})` của một biểu thức (bỏ qua `.use()` bọc ngoài nếu có). */
    const objRouter = (n: ts.Node): ts.ObjectLiteralExpression | null => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "router" &&
        n.arguments[0] !== undefined &&
        ts.isObjectLiteralExpression(n.arguments[0])
      ) {
        return n.arguments[0];
      }
      return null;
    };

    const xuLy = (obj: ts.ObjectLiteralExpression, duongR: string[]): void => {
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const ten =
          ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(sf);
        const con = objRouter(p.initializer);
        if (con !== null) {
          xuLy(con, [...duongR, ten]);
          continue;
        }
        const san = gocChuoi(p.initializer);
        if (san === null || san === "router") continue;

        let loai: ThuTucCong["loai"] | null = null;
        const doc = (x: ts.Node): void => {
          if (loai === null && ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
            const m = x.expression.name.text;
            if ((m === "query" || m === "mutation" || m === "subscription") && x.arguments[0] !== undefined) {
              loai = m;
            }
          }
          ts.forEachChild(x, doc);
        };
        doc(p.initializer);
        if (loai === null) continue;

        // Mã TẠI CHỖ (`.use(moduleGate("…"))` viết thẳng trên chuỗi) thắng; nếu không, leo về gốc.
        let module: string | null = null;
        if (tenCong.size > 0) {
          const r = maTaiCho(p.initializer, tenCong, sf);
          if (r.mu !== null) mu.push(`${f.duong}#${ten} — ${r.mu}`);
          module = r.ma;
        }
        if (module !== null) fileCoRangBuoc.add(f.duong);
        if (module === null) module = modulCua.get(nhap.get(san) ?? `${f.duong}#${san}`) ?? null;

        thuTuc.push({
          file: f.duong,
          dong: sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1,
          ten,
          duongRouter: duongR.join("."),
          san,
          loai,
          module,
        });
      }
    };

    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
        const obj = objRouter(d.initializer);
        if (obj !== null) xuLy(obj, [d.name.text]);
      }
    }
  }

  // ── CẦU CHÌ (b): file NHẬP cổng từ `_core/trpc` mà bộ suy KHÔNG rút được ràng buộc nào ────────
  //    Hỏi theo **PHÉP NHẬP**, không theo văn bản: một file chỉ nhắc `moduleGate` trong chú thích
  //    (`env.ts`, `vramRouter.ts`, `moduleAccessMap.ts`, chính file này…) không phải một ô mù.
  //    Nhập rồi mà không đọc ra được ⇒ nó được viết bằng hình dạng bộ suy chưa biết, và im lặng bỏ
  //    qua chính là cách cổng này chết.
  //    ⚠ `_core/trpc.ts` là CHỦ của hai export ấy — nó khai chúng bằng `function`/`export {}`, và
  //      `moduleProcedure(moduleCode: string)` nhận đối số ĐỘNG **theo thiết kế**. Miễn trừ đúng
  //      một file này, và miễn trừ ấy là một **hằng có tên** để không ai nới thầm.
  const FILE_CHU_CUA_CONG = "server/_core/trpc.ts";
  for (const duong of fileNhapCong) {
    if (duong === FILE_CHU_CUA_CONG || laFileTest(duong) || fileCoRangBuoc.has(duong)) continue;
    mu.push(
      `${duong} — NHẬP \`moduleGate\`/\`moduleProcedure\` từ \`_core/trpc\` nhưng bộ suy KHÔNG rút ra ràng buộc nào ⇒ viết bằng hình dạng chưa biết đọc`,
    );
  }

  return { thuTuc, mu: mu.sort(), soFileDuyet: tatCa.length, soFileParse };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NỬA **EXPRESS** — bề mặt mà bản điều tra tRPC ở trên KHÔNG đếm được.
//
// ⚠⚠ Bài học "lỗ thứ chín" (`phamViDocCensus.test.ts` lượt 4): một cổng chỉ nhìn tRPC là một cổng
//    **mù một nửa hệ**. `moduleGate` là middleware tRPC; mười tuyến `/api/ai/**` (SSE + KB cục bộ)
//    và cổng `/v1` đi đường Express, không qua nó. Nên phần này đếm **tuyến Express thuộc AI** và
//    hỏi một câu **cấu trúc** mà không phép đo thời gian chạy nào thay được: *lượt gắn middleware
//    giấy phép có đứng TRƯỚC mọi lượt đăng ký tuyến AI không?* — gắn sau thì nó canh **rỗng**.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export interface TuyenAiExpress {
  readonly file: string;
  readonly dong: number;
  readonly duongTuyen: string;
}

export interface KetQuaQuetExpress {
  /** Mọi tuyến `app.<verb>("/api/ai…")` tìm thấy dưới `server/**`. */
  readonly tuyen: readonly TuyenAiExpress[];
  /** Dòng gắn middleware giấy phép trên nhánh `/api/ai` (−1 nếu KHÔNG có). */
  readonly dongGanCong: number;
  /** Dòng của lượt `registerAi*(app)` SỚM NHẤT trong cùng file gắn cổng (−1 nếu không có). */
  readonly dongDangKySomNhat: number;
  readonly mu: readonly string[];
}

/** File chịu trách nhiệm gắn nhánh Express AI. */
export const FILE_GAN_TUYEN_AI = "server/_core/index.ts";
/** Tên middleware giấy phép Express. */
export const TEN_MIDDLEWARE_CONG = "chanTuyenAiTheoGiayPhep";

export function quetCongAiExpress(goc: string): KetQuaQuetExpress {
  const mu: string[] = [];
  const tuyen: TuyenAiExpress[] = [];
  const tatCa = moiFileDuoi(goc, "server", [".ts"]);

  for (const f of tatCa) {
    if (laFileTest(f.duong)) continue;
    const ma = readFileSync(f.that, "utf8");
    if (!ma.includes("/api/ai")) continue;
    const dong = ma.split("\n");
    for (let i = 0; i < dong.length; i++) {
      const m = /\bapp\.(get|post|put|patch|delete|use)\(\s*["'](\/api\/ai[^"']*)["']/.exec(dong[i] ?? "");
      if (m !== null && m[2] !== undefined) {
        tuyen.push({ file: f.duong, dong: i + 1, duongTuyen: m[2] });
      }
    }
  }

  const ganFile = tatCa.find((x) => x.duong === FILE_GAN_TUYEN_AI);
  let dongGanCong = -1;
  let dongDangKySomNhat = -1;
  if (ganFile === undefined) {
    mu.push(`không thấy ${FILE_GAN_TUYEN_AI} — bộ suy mất chủ của nhánh Express`);
  } else {
    const dong = readFileSync(ganFile.that, "utf8").split("\n");
    for (let i = 0; i < dong.length; i++) {
      const ln = dong[i] ?? "";
      if (dongGanCong === -1 && /app\.use\(\s*["']\/api\/ai["']\s*,/.test(ln) && ln.includes(TEN_MIDDLEWARE_CONG)) {
        dongGanCong = i + 1;
      }
      if (dongDangKySomNhat === -1 && /^\s*register(AiStreamingRoutes|AiLocalKnowledgeRoutes)\(app\)/.test(ln)) {
        dongDangKySomNhat = i + 1;
      }
    }
  }

  return { tuyen, dongGanCong, dongDangKySomNhat, mu };
}
