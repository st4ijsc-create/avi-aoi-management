/**
 * ★★★ Pha 8 Task 3 — **LƯỚI CHO HẠ TẦNG ĐO.**
 *
 * ***∀ file `*.test.ts` dưới `server/`, ∀ điểm xoá hàng bảng `users`: điểm ấy phải GIỚI HẠN
 * theo hàng chính file ấy tạo ra.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LƯỚI NÀY TỒN TẠI — NÓ CANH THIẾT BỊ ĐO, KHÔNG CANH SẢN PHẨM
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * vitest chạy các file test **SONG SONG** trên cùng một DB test. Một `beforeEach` xoá rộng ở file
 * A rơi vào **giữa** một ca của file B sẽ xoá đúng hàng B vừa dựng — và **nạn nhân đổi mỗi lượt**.
 * Triệu chứng là *"cổng đỏ KHÔNG TẤT ĐỊNH"*, và nó đã làm **BA PHA LIÊN TIẾP chẩn đoán sai**: nợ
 * *"`totpReplay` — ca đỏ đổi mỗi lượt"* bị quy cho tranh chấp `totp_consumed` suốt từ Pha 6.
 *
 * Đã bắt được **HAI** kẻ, trên **HAI bảng KHÔNG có khoá ngoại với nhau** — nên không kẻ nào giải
 * thích được kẻ kia, và chữa một kẻ **không** làm lộ ra kẻ còn lại:
 *   · kẻ #1 — `donSo()` `DELETE` toàn bảng `totp_consumed`   (vá ở `a7a0f7c1`)
 *   · kẻ #2 — `beforeEach` của `auth.setupAdmin.test.ts`     (`03ad466c` thu về "mọi admin",
 *             Pha 8 Task 3 thu tiếp về "hàng của chính nó")
 *
 * ⇒ Hai lần liên tiếp lớp lỗi này được phát hiện bằng **suy luận thủ công sau nhiều pha nhiễu**.
 *   Lưới này thay chỗ ấy bằng một lượng từ chạy mỗi lượt cổng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO SUY BẰNG **AST**, KHÔNG SO CHUỖI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một lượt quét **regex trên văn bản** trong pha trước **bắt nhầm CHÚ THÍCH** ở 2 file. Và một
 * lưới đỏ vì chú thích sẽ được người sau gỡ bằng cách **xoá chú thích** — tức lưới ấy dạy đúng cái
 * thói quen sai. Phép đo của chính lượt này lặp lại y hệt: bản nháp regex/chuỗi cho **3 dương
 * tính giả**, cả ba là `expect(sql).toContain("DELETE FROM kb_studio_chunks")` và chữ
 * `"truncate"` trong câu văn — **không cái nào là một lượt xoá**.
 * ⇒ D2 dưới đây chỉ nhận literal **THẬT SỰ ĐƯỢC THI HÀNH** như SQL (thẻ `sql\`\``, hoặc đối số của
 *   `.query(` / `.execute(` / `.unsafe(`). Một chuỗi nằm trong `expect(...)` **theo cấu tạo**
 *   không lọt vào tập.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ "LƯỢNG TỪ CÓ **TỰ THOẢ** KHÔNG?" — CÂU HỎI ĐÃ GIẾT MỘT LƯỚI Ở PHA 7
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một lưới lấy tập giao với chính tập phủ thì **theo cấu tạo không bao giờ đỏ được**. Ở đây có ba
 * lớp chống điều đó, và chúng hỏng theo **ba kiểu khác nhau**:
 *   1. **§1 ĐỐI CHỨNG TỔNG HỢP** — bộ nhận diện chạy trên mã dựng sẵn có đáp số **biết trước**
 *      (4 hình dạng hở ⇒ phải bắt; 4 hình dạng có giới hạn ⇒ phải tha). Đây là *hiệu chuẩn thước
 *      bằng một sự kiện có đáp số biết trước* — nếu bộ nhận diện chết, §1 đỏ NGAY, kể cả khi kho
 *      mã sạch tuyệt đối.
 *   2. **§2 SÀN SỐ FILE** — glob rỗng làm vitest im lặng khai XANH (**đã sáu lần**). Sàn này bắt
 *      lượt quét trả về tập rỗng.
 *   3. **§3 SÀN SỐ ĐIỂM XOÁ** — bộ nhận diện còn *sống* nhưng *mù với kho mã thật* (ví dụ đường
 *      dẫn schema đổi) sẽ cho 0 điểm; §1 vẫn xanh vì nó dùng mã tổng hợp. Sàn này bắt đúng khe ấy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÙNG MÙ ĐƯỢC KHAI — ĐỪNG ĐỌC MÀU XANH CỦA FILE NÀY THÀNH "ĐÃ PHỦ HẾT"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. Đây là lưới **HÌNH DẠNG**, không phải lưới **HÀNH VI**. Nó trả lời *"mã có hình dạng xoá
 *     rộng không"*, **không** trả lời *"lượt chạy có thật sự xoá hàng của file khác không"*.
 *  2. Chỉ canh **file test**. `donSo()` (kẻ #1) là **mã sản phẩm** ⇒ nằm NGOÀI lượng từ này. Trục
 *     ấy còn trống.
 *  3. `.where(...)` được tính là "có giới hạn" **theo hình dạng**. Một `.where(sql\`true\`)` lọt.
 *     Đổi lại: nó không đòi hỏi phân tích luồng dữ liệu, nên không có dương tính giả.
 *  4. Lan truyền qua hàm trung gian (`donDep()` gọi ở chỗ khác rồi mới xoá) không được theo dõi
 *     **trừ khi** lượt liệt kê và lượt xoá nằm cùng một thân hàm (đúng hình dạng kẻ #2).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi, laFileTest, gocChuoi } from "../routers/deployProcedureScan";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

/** Bảng bị canh bởi lượng từ CHÍNH. Đổi tên bảng thì đổi ở ĐÚNG MỘT chỗ. */
const BANG_CANH = "users";
/** Tên bảng ấy trong SQL thô. */
const BANG_CANH_SQL = "users";
/** Hook của vitest — nơi lớp lỗi này sinh sống. */
const HOOK = new Set(["beforeEach", "afterEach", "beforeAll", "afterAll"]);
/** Hàm liệt kê **cả bảng** (hoặc cả một vai). Kết quả của chúng chảy vào một lượt xoá ⇒ xoá rộng. */
const LIET_KE = /^(getAll[A-Z]|getUsersByRole$|getUsers$|listAll[A-Z]|findAll[A-Z])/;
/** Hàm thi hành SQL thô. Chỉ literal đi qua đây mới được coi là một lượt xoá THẬT. */
const THI_HANH_SQL = new Set(["query", "execute", "unsafe"]);

type Diem = {
  duong: string;
  dong: number;
  hook: string | null;
  loai: string;
  bang: string;
  coGioiHan: boolean;
};

/**
 * Bộ nhận diện. Tách khỏi lượt quét đĩa để §1 chạy được nó trên **mã tổng hợp có đáp số biết
 * trước** — không tách thì không hiệu chuẩn được thước.
 */
export function quetDiemXoa(duong: string, ma: string): Diem[] {
  const src = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
  const ra: Diem[] = [];

  // Định danh nhập từ một module *schema* ⇒ bảng drizzle. Nhờ vậy `map.delete(k)` / `set.delete(k)`
  // **theo cấu tạo** không lọt vào tập — không cần danh sách loại trừ nào.
  const bang = new Set<string>();
  src.forEachChild((n) => {
    if (!ts.isImportDeclaration(n)) return;
    if (!/schema/i.test(n.moduleSpecifier.getText(src))) return;
    const nb = n.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) bang.add(e.name.text);
  });

  const dongCua = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;

  const tenGoi = (n: ts.CallExpression): string | null =>
    ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text
      : ts.isIdentifier(n.expression) ? n.expression.text
      : null;

  /** Literal có được THI HÀNH như SQL không (thẻ `sql``` hoặc đối số của query/execute/unsafe)? */
  const laSqlThiHanh = (n: ts.Node): boolean => {
    const p = n.parent;
    if (p && ts.isTaggedTemplateExpression(p) && p.template === n) return gocChuoi(p.tag) === "sql";
    if (p && ts.isCallExpression(p) && p.arguments.some((a) => a === n)) {
      const t = tenGoi(p);
      if (t && THI_HANH_SQL.has(t)) return true;
    }
    // `d.execute(sql`DELETE …`)` — literal là template của thẻ `sql`, đã bắt ở nhánh đầu.
    return false;
  };

  const di = (n: ts.Node, hook: string | null): void => {
    let h = hook;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOK.has(n.expression.text)) {
      h = n.expression.text;
    }

    // ── D1: drizzle `<db>.delete(<bảng>)` ──────────────────────────────────────────────────────
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
        && n.expression.name.text === "delete" && n.arguments.length === 1) {
      const a = n.arguments[0]!;
      const ten = ts.isIdentifier(a) ? a.text
        : ts.isPropertyAccessExpression(a) ? a.name.text
        : null;
      if (ten !== null && bang.has(ten)) {
        // CÓ GIỚI HẠN ⟺ lượt xoá là bên nhận của một `.where(...)`.
        const p = n.parent;
        const coWhere = p !== undefined && ts.isPropertyAccessExpression(p) && p.name.text === "where";
        ra.push({ duong, dong: dongCua(n), hook: h, loai: "drizzle", bang: ten, coGioiHan: coWhere });
      }
    }

    // ── D2: SQL thô ĐƯỢC THI HÀNH ─────────────────────────────────────────────────────────────
    if ((ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || ts.isStringLiteral(n))
        && laSqlThiHanh(n)) {
      const txt = n.getText(src);
      const m = /\b(DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(txt);
      if (m) {
        const laTruncate = /TRUNCATE/i.test(m[1]!);
        ra.push({
          duong, dong: dongCua(n), hook: h,
          loai: laTruncate ? "truncate" : "sql-thô",
          bang: m[2]!,
          // `TRUNCATE` KHÔNG BAO GIỜ có giới hạn — nó không nhận mệnh đề `WHERE`.
          coGioiHan: !laTruncate && /\bWHERE\b/i.test(txt),
        });
      }
    }

    // ── D3: `deleteX(id)` được nuôi bằng một lượt LIỆT KÊ trong CÙNG thân hàm ──────────────────
    // `deleteUser(id)` tự nó luôn khoá vào một hàng. Nó chỉ thành xoá rộng khi dòng id chảy ra từ
    // một lượt liệt kê cả bảng — đúng hình dạng của kẻ #2.
    if (ts.isCallExpression(n)) {
      const t = tenGoi(n);
      if (t !== null && /^delete[A-Z]/.test(t)) {
        let than: ts.Node | undefined = n.parent;
        while (than !== undefined && !ts.isFunctionLike(than)) than = than.parent;
        let nguon: string | null = null;
        if (than !== undefined) {
          const tim = (x: ts.Node): void => {
            if (nguon !== null) return;
            if (ts.isCallExpression(x)) {
              const c = tenGoi(x);
              if (c !== null && LIET_KE.test(c)) { nguon = c; return; }
            }
            x.forEachChild(tim);
          };
          than.forEachChild(tim);
        }
        if (nguon !== null) {
          ra.push({
            duong, dong: dongCua(n), hook: h,
            loai: `hàm:${t}←${nguon}`,
            // `getUsersByRole`/`getAllUsers` là người liệt kê bảng `users`.
            bang: BANG_CANH,
            coGioiHan: false,
          });
        }
      }
    }

    n.forEachChild((c) => di(c, h));
  };
  di(src, null);
  return ra;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LƯỢT QUÉT ĐĨA — lượng từ suy từ **ĐĨA**, không từ một danh sách viết tay.
// Dùng lại `moiFileDuoi()`/`laFileTest()` của `deployProcedureScan.ts` đúng §Global Constraints
// (*"đừng viết bộ suy thứ N+1"*): hai phạm vi quét khác nhau là hai cơ hội bỏ sót khác nhau.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const MOI_FILE_TEST = moiFileDuoi(GOC, "server", [".ts", ".tsx"]).filter((f) => laFileTest(f.duong));
const MOI_DIEM: Diem[] = MOI_FILE_TEST.flatMap((f) => quetDiemXoa(f.duong, readFileSync(f.that, "utf8")));

/**
 * **TẬP NGOẠI LỆ — GHIM SỐ.** Mỗi mục là một điểm xoá rộng được tha, kèm lý do MỘT DÒNG.
 * Hôm nay tập này **RỖNG**, và đó là con số bị ghim: thêm một ngoại lệ là một quyết định phải
 * viết ra, không phải một dòng lặng lẽ. Ca *"không có mục chết"* bên dưới giữ cho nó không mục rữa
 * thành một cái lỗ (một ngoại lệ trỏ vào điểm đã được vá vẫn tiếp tục tha điểm **mới** trùng tên).
 */
const NGOAI_LE: { duong: string; dong: number; vi_sao: string }[] = [];

const laBangCanh = (d: Diem) => d.bang === BANG_CANH || d.bang === BANG_CANH_SQL;
const duocTha = (d: Diem) => NGOAI_LE.some((n) => n.duong === d.duong && n.dong === d.dong);

describe("★★★ Pha 8 Task 3 — ∀ file test: xoá hàng `users` phải GIỚI HẠN theo hàng chính nó tạo", () => {
  // ──────────────────────────────────────────────────────────────────────────────────────────────
  // §1 — ĐỐI CHỨNG TỔNG HỢP. Hiệu chuẩn thước trước khi tin số nó đọc.
  // ──────────────────────────────────────────────────────────────────────────────────────────────
  const MA_HO = [
    ['drizzle không `.where`', 'import { users } from "../../drizzle/schema";\nbeforeEach(async () => { await d.delete(users); });'],
    ['liệt kê cả bảng rồi xoá', 'beforeEach(async () => { for (const u of await db.getAllUsers()) await db.deleteUser(u.id); });'],
    ['liệt kê theo vai rồi xoá', 'beforeEach(async () => { const a = await db.getUsersByRole("admin"); for (const x of a) await db.deleteUser(x.id); });'],
    ['SQL thô không `WHERE`', 'beforeEach(async () => { await sql`DELETE FROM users`; });'],
  ] as const;

  const MA_KIN = [
    ['drizzle có `.where`', 'import { users } from "../../drizzle/schema";\nbeforeEach(async () => { await d.delete(users).where(like(users.email, "dau-%")); });'],
    ['xoá theo id đã bắt được', 'afterAll(async () => { if (uid) await db.deleteUser(uid); });'],
    ['SQL thô có `WHERE`', 'beforeEach(async () => { await sql`DELETE FROM users WHERE email = ${e}`; });'],
    ['chuỗi trong `expect`, KHÔNG thi hành', 'it("x", () => { expect(s).toContain("DELETE FROM users"); });'],
  ] as const;

  it("§1a ĐỘT BIẾN TỔNG HỢP — bốn hình dạng xoá rộng đều bị BẮT (thước còn sống)", () => {
    for (const [ten, ma] of MA_HO) {
      const ho = quetDiemXoa("tong-hop.test.ts", ma).filter((d) => !d.coGioiHan);
      expect(ho.length, `bộ nhận diện MÙ với hình dạng "${ten}" — mọi màu xanh bên dưới là vô nghĩa`).toBeGreaterThan(0);
    }
  });

  it("§1b ĐỐI CHỨNG DƯƠNG TỔNG HỢP — bốn hình dạng có giới hạn đều được THA (không dương tính giả)", () => {
    for (const [ten, ma] of MA_KIN) {
      const ho = quetDiemXoa("tong-hop.test.ts", ma).filter((d) => !d.coGioiHan);
      expect(ho, `DƯƠNG TÍNH GIẢ ở hình dạng "${ten}" — lưới này sẽ dạy người sau né bằng cách sai`).toEqual([]);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────────
  // §2 — PHẠM VI. Glob rỗng ⇒ vitest im lặng khai XANH (đã SÁU lần).
  // ──────────────────────────────────────────────────────────────────────────────────────────────
  it("§2 lượt quét đĩa KHÔNG rỗng", () => {
    expect(MOI_FILE_TEST.length, "quét `server/**/*.test.ts` ra quá ít file — phạm vi đã hỏng?").toBeGreaterThanOrEqual(800);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────────
  // §3 — LIÊN HỆ VỚI KHO MÃ THẬT. §1 xanh + §3 đỏ = thước sống nhưng mù với repo.
  // ──────────────────────────────────────────────────────────────────────────────────────────────
  it("§3 bộ nhận diện THẤY kho mã thật (không mù với đường dẫn/hình dạng của repo)", () => {
    // Đo được 2026-08-09: **236** điểm / **822** file. Sàn đặt ở 200 — đủ thấp để một lượt dọn nợ
    // bình thường không làm đỏ, đủ cao để một bộ nhận diện hỏng (rơi về 0, hoặc chỉ còn vài chục
    // vì mất nhánh D1/D2/D3) bị bắt NGAY.
    expect(MOI_DIEM.length, "0 điểm xoá trên toàn bộ file test — bộ nhận diện đang mù với repo").toBeGreaterThanOrEqual(200);
    expect(
      MOI_DIEM.filter(laBangCanh).length,
      `0 điểm xoá trên bảng \`${BANG_CANH}\` — nhận diện bảng đã hỏng (đường dẫn schema đổi?)`,
      // Đo được 2026-08-09: đúng **4** điểm, cả bốn có giới hạn — `machineApiPanelOperator` (1),
      // `operatorBadgeService` (2), `auth.setupAdmin` (1, vừa vá ở lượt này). Sàn đặt ĐÚNG BẰNG 4:
      // đây là con số nhỏ, nên một nhánh nhận diện chết là rơi xuống dưới ngay.
    ).toBeGreaterThanOrEqual(4);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────────
  // §4 — LƯỢNG TỪ CHÍNH.
  // ──────────────────────────────────────────────────────────────────────────────────────────────
  it("§4 ∀ điểm xoá hàng `users` trong file test: PHẢI có giới hạn", () => {
    const viPham = MOI_DIEM.filter((d) => laBangCanh(d) && !d.coGioiHan && !duocTha(d));
    expect(
      viPham.map((d) => `${d.duong}:${d.dong} [${d.hook ?? "ngoài hook"}] ${d.loai}`),
      [
        "Một lượt xoá hàng `users` KHÔNG giới hạn theo hàng chính file ấy tạo.",
        "vitest chạy file SONG SONG ⇒ nó xoá cả hàng mà file khác vừa dựng, và NẠN NHÂN ĐỔI MỖI LƯỢT.",
        "Đây đúng cơ chế đã làm BA PHA LIÊN TIẾP chẩn đoán sai.",
        "⇒ Khoá lượt dọn vào một DẤU RIÊNG của file (xem `DAU` trong `server/auth.setupAdmin.test.ts`),",
        "  KHÔNG xoá cả bảng và KHÔNG xoá theo `role`.",
      ].join("\n"),
    ).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────────
  // §5 — TẬP NGOẠI LỆ: ghim SỐ, và không được mục rữa.
  // ──────────────────────────────────────────────────────────────────────────────────────────────
  it("§5a tập ngoại lệ đúng SỐ đã ghim", () => {
    expect(NGOAI_LE.length, "tập ngoại lệ đổi kích thước — mỗi mục phải là một quyết định có lý do").toBe(0);
  });

  it("§5b không mục ngoại lệ nào CHẾT (mục chết vẫn tiếp tục tha điểm mới trùng chỗ)", () => {
    const chet = NGOAI_LE.filter(
      (n) => !MOI_DIEM.some((d) => d.duong === n.duong && d.dong === n.dong && !d.coGioiHan),
    );
    expect(chet, "ngoại lệ trỏ vào điểm không còn hở — xoá dòng ấy đi").toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────────
  // §6 — LƯỢNG TỪ RỘNG HƠN: MỌI bảng, nhưng chỉ trong HOOK.
  // Đo được hôm nay: **0** vi phạm. Đó là lý do ca này được phát biểu ngay bây giờ — chốt một con
  // số đang bằng 0 thì rẻ; đợi tới khi nó khác 0 thì đã có một pha chẩn đoán sai nữa rồi.
  // ⚠ Hẹp hơn §4 một cách CÓ CHỦ Ý (chỉ hook), vì ngoài hook có những lượt dọn cả-bảng chính đáng
  //   trên bảng dùng riêng. Tên ca nói đúng phạm vi ấy.
  // ──────────────────────────────────────────────────────────────────────────────────────────────
  it("§6 ∀ bảng, ∀ hook của file test: không lượt xoá nào là xoá cả bảng", () => {
    const viPham = MOI_DIEM.filter((d) => d.hook !== null && !d.coGioiHan && !duocTha(d));
    expect(
      viPham.map((d) => `${d.duong}:${d.dong} [${d.hook}] ${d.loai} bảng=${d.bang}`),
      "một hook test xoá cả bảng ⇒ nó phá trạng thái của file chạy song song, trên bảng bất kỳ",
    ).toEqual([]);
  });
});
