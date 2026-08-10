/**
 * ★★★ Pha 7 Task 8b — **LƯỢNG TỪ TRÊN TRỤC "KHO TRÊN ĐĨA":**
 * ***∀ lượt ghi `localStorage`/`sessionStorage` trong `client/src/**`, giá trị ghi KHÔNG được dẫn
 * xuất từ đối tượng người dùng (`auth.me`).***
 * (Tự khai `Pha 5` để `vramPha5Gate.test.ts` kéo file này vào lượng từ *"mọi lưới tự khai một pha
 *  phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG CANH MỘT CÁI TÊN KHOÁ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nợ được phát hiện là **một** khoá — `manus-runtime-user-info` — nhưng luật *"khoá tên ấy không
 * được tồn tại"* là một **danh sách một phần tử**, và danh sách nào cũng có phần tử thứ N+1 (**16**
 * lần trong dự án này). Đổi tên khoá là đủ để lách.
 *
 * Nên bất biến được phát biểu trên **NGUỒN**, không trên **TÊN**:
 *
 *   > ***KHÔNG khoá kho-trên-đĩa nào mang một đối tượng người dùng.***
 *
 * Và **cả hai đầu đều SUY RA**, không viết tay:
 *  • **Nguồn người dùng** — suy ra từ AST: lời gọi `auth.me.useQuery(…)` (thủ tục tRPC **duy nhất**
 *    trả hàng `users` cho client, xem `server/_core/publicUser.ts`) **cộng** mọi hook **xuất khẩu
 *    từ file có gọi nó** (hôm nay ra `useAuth`; một hook thứ hai viết ngày mai tự vào lượng từ).
 *  • **Phạm vi quét** — mọi `.ts`/`.tsx` dưới `client/src`, trừ file test. Một lượt ghi **MỚI trong
 *    FILE MỚI** nằm trong lượng từ **theo cấu tạo** — **phép thử M3**.
 *
 * Vết bẩn (taint) được **lan theo phép gán** đến điểm bất động: `const s = q.data` · `const { user }
 * = useAuth()` · `const state = useMemo(() => ({ user: q.data }), […])` đều mang vết.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÙNG MÙ ĐƯỢC KHAI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. Lan qua **lời gọi hàm khác** (`luu(user)` rồi `luu` mới `setItem`) không được theo dõi.
 *  2. Kho khác (`IndexedDB`, `document.cookie`, `window.name`) không thuộc lượng từ này.
 *  3. Vết bẩn theo **TÊN trong một file**, không theo scope — cố ý **thừa** hơn là **thiếu**; hướng
 *     sai của nó là *bắt nhầm*, và ca "KHÔNG BẮT NHẦM" bên dưới đo giới hạn ấy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { getTableColumns, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { donKhoaMangNguoiDung, KHOA_DA_BO, MAU_DANH_TINH } from "./donKhoaNguoiDung";
/**
 * ★★★ Pha 8 Task 5 — hai NGUỒN SỰ THẬT phía máy chủ, nhập vào **lưới** chứ không vào bó mã trình
 * duyệt. Các file `*.unit.test.ts` dưới `client/src` chạy trong môi trường **node** (xem
 * `vitest.config.ts`), nên ràng buộc *"`publicUser.ts` nhập `drizzle/schema` nên không mang sang
 * trình duyệt được"* — một ràng buộc về **bó mã lúc chạy** — không cấm lượt đối chiếu này.
 */
import * as SCHEMA from "../../../drizzle/schema";
import { PUBLIC_USER_FIELDS } from "../../../server/_core/publicUser";

/** Kho giả tối thiểu đúng bề mặt `Storage` mà người dọn dùng (`length`/`key`/`getItem`/`removeItem`). */
function khoGia(kho: Map<string, string>): Storage {
  return {
    get length() {
      return kho.size;
    },
    key: (i: number) => [...kho.keys()][i] ?? null,
    getItem: (k: string) => kho.get(k) ?? null,
    removeItem: (k: string) => void kho.delete(k),
  } as unknown as Storage;
}

const THU_MUC = fileURLToPath(new URL(".", import.meta.url)); // …/client/src/lib
const GOC = join(THU_MUC, "..", "..", ".."); // gốc repo
const CLIENT = join(GOC, "client", "src");

/** Thủ tục tRPC **duy nhất** trả hàng `users` cho client. Đổi nó là một quyết định nói ra. */
const NGUON_GOC = "auth.me";
const KHO = ["localStorage", "sessionStorage"];

interface ViPham {
  readonly duong: string;
  readonly dong: number;
  readonly vi: string;
}

function moiFile(goc: string, ra: string[] = []): string[] {
  if (!existsSync(goc)) return ra;
  for (const ten of readdirSync(goc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(goc, ten);
    if (statSync(p).isDirectory()) moiFile(p, ra);
    else if ((ten.endsWith(".ts") || ten.endsWith(".tsx")) && !ten.endsWith(".d.ts")) ra.push(p);
  }
  return ra;
}

function duong(p: string): string {
  return relative(GOC, p).split(sep).join("/");
}

const laTest = (d: string) => /\.(unit\.)?(test|spec)\.tsx?$/.test(d);

const MOI = moiFile(CLIENT)
  .map((p) => ({ duong: duong(p), that: p }))
  .filter((f) => !laTest(f.duong));

/**
 * ★★★ **SUY RA tập hook mang người dùng** — không liệt kê. Một file có gọi `auth.me.useQuery` thì
 * **mọi hàm nó xuất khẩu** đều bị coi là mang người dùng ra ngoài.
 */
function hookMangNguoiDung(): Set<string> {
  const ra = new Set<string>();
  for (const f of MOI) {
    const src = readFileSync(f.that, "utf8");
    if (!src.includes(`${NGUON_GOC}.useQuery`)) continue;
    const sf = ts.createSourceFile(f.duong, src, ts.ScriptTarget.Latest, true);
    const di = (n: ts.Node): void => {
      const xuat =
        ts.canHaveModifiers(n) &&
        (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (xuat && ts.isFunctionDeclaration(n) && n.name) ra.add(n.name.text);
      if (xuat && ts.isVariableStatement(n)) {
        for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) ra.add(d.name.text);
      }
      ts.forEachChild(n, di);
    };
    ts.forEachChild(sf, di);
  }
  return ra;
}

const HOOK = hookMangNguoiDung();

/** Biểu thức này có **trực tiếp** lấy người dùng ra không (`auth.me.useQuery(…)` hoặc một hook ấy)? */
function laNguon(e: ts.Node, sf: ts.SourceFile): boolean {
  if (!ts.isCallExpression(e)) return false;
  const t = e.expression.getText(sf);
  if (t.endsWith(`${NGUON_GOC}.useQuery`)) return true;
  return HOOK.has(t);
}

/**
 * ★★★ Ô **mang nguyên đối tượng** người dùng. Suy từ hình dạng của chính nguồn: `useQuery` trả
 * `{ data }`, hook `useAuth` trả `{ user }`, và `me` là tên thủ tục. Đi sâu vào một ô KHÁC
 * (`user.role`, `user.id`) là đọc **một Ô**, không phải mang **đối tượng**.
 */
const O_MANG_DOI_TUONG = new Set(["data", "user", "me"]);

/** Định danh do một mẫu ràng buộc sinh ra, **kèm** tên ô nguồn (`{ data: q }` → `q` ← `data`). */
function tenCuaMau(n: ts.BindingName): { ten: string; oNguon: string | null }[] {
  if (ts.isIdentifier(n)) return [{ ten: n.text, oNguon: null }];
  const ra: { ten: string; oNguon: string | null }[] = [];
  for (const e of n.elements) {
    if (ts.isOmittedExpression(e)) continue;
    const o =
      ts.isBindingElement(e) && e.propertyName && (ts.isIdentifier(e.propertyName) || ts.isStringLiteral(e.propertyName))
        ? e.propertyName.text
        : ts.isBindingElement(e) && ts.isIdentifier(e.name)
          ? e.name.text
          : null;
    for (const t of tenCuaMau(e.name)) ra.push({ ten: t.ten, oNguon: t.oNguon ?? o });
  }
  return ra;
}

/**
 * ★★★ VỊ TỪ TRUNG TÂM — chạy trên **một nguồn bất kỳ**, kể cả nguồn của file **chưa tồn tại**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ **"ĐỐI TƯỢNG người dùng", KHÔNG phải "một ô của nó"** — và lan theo **CẤU TRÚC**, không theo
 * **CHỨA**.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Phép đo đầu tiên chạy với vị từ thô *"biểu thức có NHẮC TỚI một tên bẩn"* ⇒ **5** điểm, mà soi
 * tay thì **4 là BẮT NHẦM**:
 *   · `FirstRunTour.tsx:136` ghi chuỗi `user?.role` — một **Ô**, không phải đối tượng;
 *   · `Dashboard.tsx:272,472` ghi `widgetStyle`/`visibleMetrics` — `useState(…)` chỉ **chứa** tên
 *     bẩn ở đâu đó trong đối số;
 *   · `useLicenseModules.ts:76` ghi `JSON.stringify(data)`, mà `data` ra từ
 *     `trpc.license.getAllowedModules.useQuery(…, { enabled: isAuthenticated && … })` — **tên bẩn
 *     nằm trong TUỲ CHỌN của một query KHÁC**, không phải trong giá trị trả về.
 * ⇒ Một lưới bắt nhầm 4 chỗ là một lưới sẽ bị ai đó tắt đi. Hai phép sửa lượng từ:
 *   (a) chỉ ô **mang nguyên đối tượng** mới lan (`q.data`, `x.user`), không phải ô bất kỳ;
 *   (b) lan theo **vị trí giá trị** (bọc/ghép/nhánh/`JSON.stringify`), **không** qua đối số của một
 *       lời gọi bất kỳ.
 */
export function viPhamTrongNguon(duongFile: string, ma: string): ViPham[] {
  const sf = ts.createSourceFile(duongFile, ma, ts.ScriptTarget.Latest, true);
  const ban = new Set<string>();

  const khaiBao: { ten: { ten: string; oNguon: string | null }[]; kh: ts.Expression }[] = [];
  const thu = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.initializer) khaiBao.push({ ten: tenCuaMau(n.name), kh: n.initializer });
    ts.forEachChild(n, thu);
  };
  ts.forEachChild(sf, thu);

  const laStringify = (e: ts.CallExpression): boolean => /(^|\.)JSON\.stringify$/.test(e.expression.getText(sf));

  /** Biểu thức này **MANG** đối tượng người dùng (không phải chỉ nhắc tới nó). */
  const mangDoiTuong = (e: ts.Node): boolean => {
    if (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isNonNullExpression(e)) return mangDoiTuong(e.expression);
    if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) return mangDoiTuong(e.expression);
    if (ts.isIdentifier(e)) return ban.has(e.text);
    if (ts.isPropertyAccessExpression(e)) return O_MANG_DOI_TUONG.has(e.name.text) && mangDoiTuong(e.expression);
    if (ts.isElementAccessExpression(e)) return mangDoiTuong(e.expression);
    if (ts.isCallExpression(e)) return laNguon(e, sf) || (laStringify(e) && e.arguments.some(mangDoiTuong));
    if (ts.isBinaryExpression(e)) return mangDoiTuong(e.left) || mangDoiTuong(e.right);
    if (ts.isConditionalExpression(e)) return mangDoiTuong(e.whenTrue) || mangDoiTuong(e.whenFalse);
    if (ts.isTemplateExpression(e)) return e.templateSpans.some((s) => mangDoiTuong(s.expression));
    if (ts.isArrayLiteralExpression(e)) return e.elements.some(mangDoiTuong);
    if (ts.isObjectLiteralExpression(e))
      return e.properties.some((p) => {
        if (ts.isPropertyAssignment(p)) return mangDoiTuong(p.initializer);
        if (ts.isShorthandPropertyAssignment(p)) return ban.has(p.name.text);
        if (ts.isSpreadAssignment(p)) return mangDoiTuong(p.expression);
        return false;
      });
    return false;
  };

  for (let vong = 0; vong < 8; vong++) {
    let doi = false;
    for (const k of khaiBao) {
      // Rã đúng: `const { user } = useAuth()` mang đối tượng; `const { isAuthenticated } = useAuth()`
      // là một **Ô** (boolean) — tên bẩn của nó chính là thứ đã bắt nhầm `useLicenseModules`.
      const tuNguon = ts.isCallExpression(k.kh) && laNguon(k.kh, sf);
      for (const t of k.ten) {
        if (ban.has(t.ten)) continue;
        const nhiem = tuNguon ? t.oNguon === null || O_MANG_DOI_TUONG.has(t.oNguon) : mangDoiTuong(k.kh);
        if (!nhiem) continue;
        ban.add(t.ten);
        doi = true;
      }
    }
    if (!doi) break;
  }

  const chamBan = (e: ts.Node): boolean => mangDoiTuong(e);

  // ── ∀ lượt ghi kho ───────────────────────────────────────────────────────────────────────────
  const ra: ViPham[] = [];
  const soat = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "setItem" &&
      KHO.some((k) => n.expression.getText(sf).startsWith(k) || n.expression.getText(sf).endsWith(`.${k}.setItem`))
    ) {
      const gt = n.arguments[1];
      if (gt && chamBan(gt)) {
        ra.push({
          duong: duongFile,
          dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          vi: `ghi đối tượng người dùng xuống đĩa: \`${n.getText(sf).replace(/\s+/g, " ").slice(0, 90)}\``,
        });
      }
    }
    ts.forEachChild(n, soat);
  };
  ts.forEachChild(sf, soat);
  return ra;
}

describe("★★★ Pha 5/7 Task 8b — ∀ khoá kho-trên-đĩa: KHÔNG khoá nào mang đối tượng người dùng", () => {
  it("★★★ cầu chì — quét thấy đủ file, và SUY RA được ≥1 hook mang người dùng (0 ⇒ chân lý rỗng)", () => {
    expect(MOI.length, "quét trúng 0 file client — bộ suy phạm vi đã hỏng?").toBeGreaterThan(300);
    expect(
      [...HOOK].join(" · "),
      `không suy ra được hook nào gọi \`${NGUON_GOC}.useQuery\` — bộ suy NGUỒN đã hỏng?`,
    ).not.toBe("");
  });

  it("★★★ TOÀN `client/src` — 0 lượt ghi kho-trên-đĩa mang đối tượng người dùng", () => {
    const vp = MOI.flatMap((f) => viPhamTrongNguon(f.duong, readFileSync(f.that, "utf8")));
    expect(
      vp.map((v) => `${v.duong}:${v.dong} — ${v.vi}`).join("\n"),
      "có lượt ghi `auth.me` xuống đĩa người dùng",
    ).toBe("");
  });

  it("★★★ M3 — lượt ghi trong **FILE MỚI CHƯA TỒN TẠI**, dưới một TÊN KHOÁ KHÁC, vẫn bị bắt", () => {
    const fileMoi = "client/src/lib/luuNguoiDungN1.ts";
    expect(existsSync(join(GOC, fileMoi)), "ca này giả định file ấy chưa tồn tại").toBe(false);
    const ma = `
      import { useAuth } from "@/_core/hooks/useAuth";
      export function Luu() {
        const { user } = useAuth();
        localStorage.setItem("mot-cai-ten-hoan-toan-khac", JSON.stringify(user));
      }`;
    expect(viPhamTrongNguon(fileMoi, ma).length, "đổi tên khoá KHÔNG được lách").toBeGreaterThanOrEqual(1);
  });

  it("★★★ bốn biến thể vòng tránh đều bị bắt (query thô · qua biến trung gian · sessionStorage · gói trong object)", () => {
    const ca: Array<[string, string]> = [
      ["query thô", `const q = trpc.auth.me.useQuery(); localStorage.setItem("k", JSON.stringify(q.data));`],
      ["biến trung gian", `const q = trpc.auth.me.useQuery(); const u = q.data; const v = u; localStorage.setItem("k", JSON.stringify(v));`],
      ["sessionStorage", `const { user } = useAuth(); sessionStorage.setItem("k", JSON.stringify(user));`],
      ["gói trong object", `const q = trpc.auth.me.useQuery(); localStorage.setItem("k", JSON.stringify({ me: q.data, t: Date.now() }));`],
    ];
    for (const [ten, than] of ca) {
      expect(viPhamTrongNguon("client/src/x/moi.ts", `function f() { ${than} }`).length, `biến thể "${ten}" phải bị bắt`).toBeGreaterThanOrEqual(1);
    }
  });

  it("★★ KHÔNG BẮT NHẦM — ghi thứ KHÔNG phải người dùng, và ĐỌC người dùng để hiển thị, đều không bị bắt", () => {
    const sach = `
      function f() {
        const { user } = useAuth();
        localStorage.setItem("theme", "dark");
        localStorage.setItem("nav-mode", JSON.stringify({ collapsed: true }));
        return user?.name;
      }`;
    expect(viPhamTrongNguon("client/src/x/sach.ts", sach), "lượt ghi không mang người dùng KHÔNG được bị bắt").toEqual([]);
    // ⚠⚠ RANH GIỚI ĐƯỢC KHAI: ghi **một Ô** của người dùng (`user.id`, `user?.role`) KHÔNG nằm
    //    trong lượng từ — bất biến 8b nói *"không khoá nào chứa ĐỐI TƯỢNG người dùng"*. Đây chính
    //    là 4 điểm mà vị từ thô ban đầu **bắt nhầm** (`FirstRunTour` · `Dashboard`×2 ·
    //    `useLicenseModules`); một lưới bắt nhầm là một lưới sẽ bị tắt.
    const o = `function f() {
      const { user } = useAuth();
      const role = user?.role ?? "";
      localStorage.setItem("last-uid", String(user.id));
      localStorage.setItem("tour:role", role);
    }`;
    expect(viPhamTrongNguon("client/src/x/o.ts", o), "ghi một Ô KHÔNG phải ghi ĐỐI TƯỢNG").toEqual([]);
    // …nhưng chính đối tượng ấy thì có.
    const doiTuong = `function f() { const { user } = useAuth(); localStorage.setItem("k", JSON.stringify(user)); }`;
    expect(viPhamTrongNguon("client/src/x/dt.ts", doiTuong).length, "ghi ĐỐI TƯỢNG phải bị bắt").toBe(1);
  });

  it("★★★ khoá cũ KHÔNG còn là một CHUỖI TRONG MÃ (chú thích lịch sử thì được giữ)", () => {
    // ⚠ Hỏi bằng **AST**, không bằng `includes`: một chú thích *"khoá X đã bị xoá, đây là lý do"*
    //   là **tài liệu**, còn một **chuỗi trong mã** là một lượt đọc/ghi. Bộ đo thô không phân biệt
    //   được hai thứ ấy và sẽ ép người ta xoá mất lời giải thích.
    const bat: string[] = [];
    for (const f of MOI) {
      if (f.duong === "client/src/lib/donKhoaNguoiDung.ts") continue; // người DỌN giữ danh sách lịch sử
      const src = readFileSync(f.that, "utf8");
      if (!src.includes(KHOA_DA_BO[0])) continue;
      const sf = ts.createSourceFile(f.duong, src, ts.ScriptTarget.Latest, true);
      const di = (n: ts.Node): void => {
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && KHOA_DA_BO.includes(n.text as never)) {
          bat.push(`${f.duong}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
        }
        ts.forEachChild(n, di);
      };
      ts.forEachChild(sf, di);
    }
    expect(bat.join(" · "), "khoá cũ vẫn là một chuỗi TRONG MÃ ⇒ vẫn có người ghi hoặc đọc").toBe("");
  });

  it("★★★ DỌN DỮ LIỆU CŨ — khoá mang người dùng bị xoá khỏi đĩa lúc khởi động, khoá lành thì KHÔNG", () => {
    const kho = new Map<string, string>([
      ["manus-runtime-user-info", JSON.stringify({ id: 1, username: "admin", role: "admin", name: "A" })],
      ["mot-ten-khac", JSON.stringify({ id: 9, email: "x@y.z", role: "viewer" })],
      ["theme", "dark"],
      ["nav-mode", JSON.stringify({ collapsed: true })],
      ["ho-so-may", JSON.stringify({ id: 3, name: "SPI-01", role: "line" })], // KHÔNG có username/email
      ["rac", "{khong-phai-json"],
    ]);
    const gia = {
      get length() { return kho.size; },
      key: (i: number) => [...kho.keys()][i] ?? null,
      getItem: (k: string) => kho.get(k) ?? null,
      removeItem: (k: string) => void kho.delete(k),
    };
    const daBo = donKhoaMangNguoiDung(gia as unknown as Storage);
    expect(daBo.sort(), "phải xoá ĐÚNG các khoá mang người dùng").toEqual(["manus-runtime-user-info", "mot-ten-khac"]);
    expect([...kho.keys()].sort(), "khoá lành KHÔNG được đụng").toEqual(["ho-so-may", "nav-mode", "rac", "theme"]);
    // ⚠ Bất biến của người dọn là **HÌNH DẠNG**, không phải cái tên: khoá thứ hai không có trong
    //   danh sách nào mà vẫn bị xoá.
    expect(KHOA_DA_BO.includes("manus-runtime-user-info"), "khoá đã bỏ được ghi tên để đọc lại lịch sử").toBe(true);
  });

  it("★★★ M-2 — hai mẩu danh tính MỚI (`twoFactorEnabled`/`lastSignedIn`) dọn được, và `{id,name,role}` VẪN SỐNG", () => {
    /**
     * ★★★ Pha 7 / review TOÀN NHÁNH **M-2**, và ô này **BÁC BỎ đề xuất nguyên văn của báo cáo**.
     *
     * Báo cáo đề nghị *"suy `MAU_DANH_TINH` từ `PUBLIC_USER_FIELDS`"*. Đo lại: `PUBLIC_USER_FIELDS`
     * chứa **`name`**, nên phép suy ấy sẽ khớp `{ id, name }` của **mọi** đối tượng nghiệp vụ —
     * máy, sản phẩm, dây chuyền — và **XOÁ NHẦM** chúng khỏi `localStorage`. Vế thứ hai của ô này
     * ghim đúng chuyện đó: ngày ai đó "sửa" theo đề xuất ấy, ô này **ĐỎ**.
     *
     * Vế thứ nhất đo rằng hai phần tử **chết** (`passwordHash`/`twoFactorSecret` — không bao giờ
     * còn ra khỏi máy chủ sau Task 7+9) đã được thay bằng hai ô **còn sống** và **riêng của tài
     * khoản**.
     */
    const kho = new Map<string, string>([
      // Bản ghi cũ KHÔNG có `username`/`email`/`openId`/`loginMethod` — trước M-2 nó SỐNG SÓT.
      ["phien-cu", JSON.stringify({ id: 7, name: "Ai Đó", role: "admin", twoFactorEnabled: false })],
      ["phien-cu-2", JSON.stringify({ id: 8, name: "Ai Đó Nữa", lastSignedIn: "2026-08-01T00:00:00Z" })],
      // …và ba đối tượng NGHIỆP VỤ mang đúng hình dạng `{id, name, …}` phải KHÔNG bị đụng.
      ["ho-so-may", JSON.stringify({ id: 3, name: "SPI-01", role: "line" })],
      ["san-pham", JSON.stringify({ id: 4, name: "PCB-A", createdAt: "2026-01-01", updatedAt: "2026-02-02" })],
      ["day-chuyen", JSON.stringify([{ id: 5, name: "L1" }, { id: 6, name: "L2" }])],
    ]);
    const gia = {
      get length() { return kho.size; },
      key: (i: number) => [...kho.keys()][i] ?? null,
      getItem: (k: string) => kho.get(k) ?? null,
      removeItem: (k: string) => void kho.delete(k),
    };
    const daBo = donKhoaMangNguoiDung(gia as unknown as Storage);
    expect(
      daBo.sort(),
      "hai ô danh tính MỚI không dọn được bản ghi cũ ⇒ `MAU_DANH_TINH` vẫn còn phần tử chết",
    ).toEqual(["phien-cu", "phien-cu-2"]);
    expect(
      [...kho.keys()].sort(),
      "ĐỐI TƯỢNG NGHIỆP VỤ BỊ XOÁ NHẦM.\n" +
        "⚠ Đây là hậu quả của việc suy `MAU_DANH_TINH` từ `PUBLIC_USER_FIELDS` (nó chứa `name`).\n" +
        "⇒ Tập ấy phải là *những ô mà CHỈ một tài khoản mới có*, một khái niệm HẸP HƠN.",
    ).toEqual(["day-chuyen", "ho-so-may", "san-pham"]);
  });

  it("★★★★ Pha 8 Task 5 / CHIỀU 1 (thừa ⇒ ĐỎ) — ∀ phần tử `MAU_DANH_TINH` là một ô THẬT của `auth.me`", () => {
    /**
     * ⚠⚠ **`PUBLIC_USER_FIELDS` DÙNG LÀM CẬN TRÊN, KHÔNG LÀM NGUỒN SUY** — và khác biệt ấy là cả
     *    bài học M-2. Suy `MAU_DANH_TINH` **=** tập ấy thì `name` lọt vào và mọi `{id,name}` nghiệp
     *    vụ bị xoá nhầm. Đòi `MAU_DANH_TINH` **⊆** tập ấy thì chỉ chặn phần tử **không có thật** —
     *    đúng hai phần tử chết (`passwordHash`/`twoFactorSecret`) mà M-2 đã phải thay bằng tay.
     */
    const congKhai = new Set<string>(PUBLIC_USER_FIELDS as readonly string[]);
    expect(congKhai.size, "cầu chì: `PUBLIC_USER_FIELDS` rỗng ⇒ ô này đúng theo cấu tạo").toBeGreaterThan(5);
    const khongCoThat = MAU_DANH_TINH.filter((k) => !congKhai.has(k));
    expect(
      khongCoThat.join(" · "),
      "PHẦN TỬ KHÔNG CÓ THẬT TRONG `auth.me`.\n" +
        "Nó không làm sai điều gì — nó chỉ **chiếm chỗ** của phép nhận diện thật, và người đọc sau\n" +
        "sẽ tưởng tập này đang canh nhiều hơn thực tế. Đúng lớp lỗi M-2 (`passwordHash` +\n" +
        "`twoFactorSecret` nằm lại sau khi đã rời `users`). ⇒ Thay bằng một ô CÒN SỐNG.",
    ).toBe("");
  });

  it("★★★★ Pha 8 Task 5 / CHIỀU 2 (cạm bẫy ⇒ ĐỎ) — không phần tử nào là cột của bảng nghiệp vụ `{id,name}`", () => {
    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ★★★ **CA CHỐNG HỒI QUY CHO ĐÚNG CẠM BẪY ĐÃ ĐO ĐƯỢC.**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Đề xuất *"suy `MAU_DANH_TINH` từ `PUBLIC_USER_FIELDS`"* hỏng **theo chiều MỞ**: tập ấy chứa
     * `name`, và `name` là cột của **90** bảng `{id, name}` trong `drizzle/schema` (đo 2026-08-10)
     * — máy, sản phẩm, dây chuyền, trạm… ⇒ mọi đối tượng nghiệp vụ bị **XOÁ NHẦM** khỏi
     * `localStorage`. Ô M-2 phía trên bắt được điều đó bằng **ba fixture**; ô này bắt bằng một
     * **LƯỢNG TỪ trên toàn schema**, nên nó không phụ thuộc vào việc ai đó có nhớ thêm fixture hay
     * không, và nó nêu **đích danh** phần tử phạm luật.
     *
     * ⚠ NGOẠI LỆ được **KHAI ĐÍCH DANH + GHIM SỐ** (khuôn Task 4 Bước 3): một cặp (ô, bảng) mới
     *   phải là một quyết định NÓI RA, không phải một lượt trôi.
     */
    const bang: Array<{ ten: string; cot: string[] }> = [];
    for (const [ten, v] of Object.entries(SCHEMA as Record<string, unknown>)) {
      if (v && is(v as never, PgTable)) {
        try {
          bang.push({ ten, cot: Object.keys(getTableColumns(v as never)) });
        } catch {
          /* không phải bảng dùng được — bỏ qua */
        }
      }
    }
    // "Đối tượng nghiệp vụ" = bảng KHÔNG PHẢI tài khoản mà mang đúng hình dạng `{id, name}` —
    // chính hình dạng mà docstring của người dọn cam kết KHÔNG đụng tới.
    const NGHIEP_VU = bang.filter(
      (b) => b.ten !== "users" && b.ten !== "userSecrets" && b.cot.includes("id") && b.cot.includes("name"),
    );
    expect(NGHIEP_VU.length, "cầu chì: không suy ra được bảng nghiệp vụ nào ⇒ ô này là chân lý rỗng").toBeGreaterThan(50);

    /** Ngoại lệ đã khai — mỗi mục một lý do một dòng. ⚠ GHIM SỐ ngay dưới. */
    const MIEN: ReadonlyArray<readonly [string, string]> = [
      // `mqttClientProfiles.username` là tài khoản đăng nhập **broker MQTT** của một thiết bị —
      // không phải hồ sơ người dùng, và không có đường nào ghi nó xuống kho-trên-đĩa trình duyệt.
      ["username", "mqttClientProfiles"],
    ];
    const SO_MIEN_NGHIEP_VU = 1;
    expect(
      MIEN.length,
      "số NGOẠI LỆ đã đổi — mỗi cặp (ô, bảng) được miễn phải có lý do một dòng tại chỗ khai",
    ).toBe(SO_MIEN_NGHIEP_VU);

    const duocMien = new Set(MIEN.map(([o, b]) => `${o}@${b}`));
    const pham: string[] = [];
    for (const k of MAU_DANH_TINH) {
      for (const b of NGHIEP_VU) {
        if (b.cot.includes(k) && !duocMien.has(`${k}@${b.ten}`)) pham.push(`${k}@${b.ten}`);
      }
    }
    expect(
      `${pham.length}${pham.length ? ` — ${pham.slice(0, 8).join(" · ")}` : ""}`,
      "MẨU DANH TÍNH TRÙNG VỚI CỘT CỦA ĐỐI TƯỢNG NGHIỆP VỤ.\n" +
        "⚠ Một ô như thế làm người dọn XOÁ NHẦM máy/sản phẩm/dây chuyền khỏi `localStorage` —\n" +
        "  hỏng theo chiều MỞ, và im lặng (người dùng chỉ thấy cấu hình 'tự nhiên mất').\n" +
        "⚠ Nếu bạn vừa suy tập này từ `PUBLIC_USER_FIELDS`: **ĐÓ LÀ CẠM BẪY ĐÃ ĐO ĐƯỢC.** Tập ấy\n" +
        "  chứa `name`, và `name` nằm trên hàng chục bảng nghiệp vụ. Dùng nó làm CẬN TRÊN (ô\n" +
        "  CHIỀU 1) thì đúng; dùng nó làm NGUỒN SUY thì sai.",
    ).toBe("0");
  });

  it("★★★★ Pha 8 Task 5 / CHIỀU 3 (thiếu ⇒ ĐỎ) — ∀ phần tử phải GÁNH TẢI, và bằng chứng ràng buộc HAI CHIỀU", () => {
    /**
     * ⚠⚠ **KHÔNG TỰ THOẢ.** Ô này không hỏi tập về chính tập: `BANG_CHUNG` là một artefact **viết
     *    riêng**, và hai chiều được kiểm tường minh — bỏ một phần tử khỏi `MAU_DANH_TINH` thì bản
     *    ghi bằng chứng của nó **sống sót** (⇒ ĐỎ); thêm một phần tử mà không có bằng chứng thì
     *    tập khoá **lệch** (⇒ ĐỎ). Đó là chỗ *"neo hai chiều vào chỗ TIÊU THỤ"*: người tiêu thụ
     *    thật của danh sách này là `donKhoaMangNguoiDung`, nên bằng chứng đi qua đúng hàm ấy.
     */
    const BANG_CHUNG: Record<(typeof MAU_DANH_TINH)[number], unknown> = {
      username: "nguyenvana",
      email: "a@b.c",
      openId: "local_1783673235595_3unhqnawq79",
      loginMethod: "password",
      twoFactorEnabled: false,
      lastSignedIn: "2026-08-01T00:00:00Z",
    };

    // ── Ràng buộc HAI CHIỀU giữa tập và bằng chứng ───────────────────────────────────────────
    expect(
      Object.keys(BANG_CHUNG).sort(),
      "tập bằng chứng LỆCH khỏi `MAU_DANH_TINH` ⇒ hoặc một phần tử mới chưa có bằng chứng (nên\n" +
        "không ai biết nó có tác dụng gì), hoặc một phần tử vừa bị xoá mà bằng chứng còn nằm lại",
    ).toEqual([...MAU_DANH_TINH].sort());

    // ── Mỗi phần tử phải GÁNH TẢI: bản ghi chỉ có `id` + ô ấy phải bị dọn ────────────────────
    for (const k of MAU_DANH_TINH) {
      const kho = new Map<string, string>([
        [`bc-${k}`, JSON.stringify({ id: 77, [k]: BANG_CHUNG[k] })],
      ]);
      expect(
        donKhoaMangNguoiDung(khoGia(kho)),
        `mẩu danh tính \`${k}\` KHÔNG dọn được bản ghi mà nó là dấu hiệu DUY NHẤT ⇒ phần tử CHẾT`,
      ).toEqual([`bc-${k}`]);

      // …và đối chứng ÂM: bỏ đúng ô ấy đi thì bản ghi phải SỐNG (chứng minh `id` không tự làm nên
      // phán quyết — nếu không, ô trên xanh vì `id`, và cả tập này là trang trí).
      const khongCo = new Map<string, string>([[`am-${k}`, JSON.stringify({ id: 77 })]]);
      expect(
        donKhoaMangNguoiDung(khoGia(khongCo)),
        `bản ghi CHỈ có \`id\` cũng bị dọn ⇒ phép nhận diện không dùng tới \`${k}\`, và ô trên xanh vì lý do sai`,
      ).toEqual([]);
    }
  });

  it("★★ người dọn KHÔNG được nổ khi kho không có / bị chặn", () => {
    expect(() => donKhoaMangNguoiDung(undefined)).not.toThrow();
    const hong = {
      get length(): number { throw new Error("SecurityError"); },
      key: () => null, getItem: () => null, removeItem: () => {},
    };
    expect(() => donKhoaMangNguoiDung(hong as unknown as Storage)).not.toThrow();
  });
});
