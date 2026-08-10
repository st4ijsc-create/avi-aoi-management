/**
 * ★★★ Pha 7 Task 6 / Bước 7 — **ĐẢO LƯỢNG TỪ: "MỌI ĐƯỜNG CẤP PHIÊN ĐỀU ĐÒI BẰNG CHỨNG DANH TÍNH".**
 * (Lưới này đóng nợ Pha 5/6/7 nên nó tự khai `Pha 5` để `vramPha5Gate.test.ts` kéo nó vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG LIỆT KÊ 7 ĐƯỜNG ĐÃ ĐẾM ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Phép đếm Bước 2 tìm được **7 đường cấp phiên** (`res.cookie(COOKIE_NAME…)` **4** điểm ·
 * `sdk.createSessionToken` **5** điểm · `establishSession` **3** người gọi), và **cái nguy hiểm
 * thứ hai KHÔNG PHẢI cái đang vá** — `POST /api/external/auth/login` (`_core/index.ts`) đúc một
 * JWT **cùng khuôn**, dùng thẳng làm cookie phiên được (đã ĐO), mà **không có cổng 2FA**.
 * Một danh sách 7 tên là một danh sách **có phần tử thứ TÁM** — lớp lỗi *"cái gì LIỆT KÊ thì luôn
 * có phần tử thứ N+1"* đã tái diễn **mười lăm** lần trong chuỗi pha này.
 *
 * ⇒ Bất biến được phát biểu ở dạng **∀ trên cấu trúc**, trên **LOẠI BẰNG CHỨNG** (tập đóng, khái
 *   niệm) chứ không trên **ĐƯỜNG** (tập mở, cứ thêm hoài):
 *
 *   ***∀ điểm đúc thẻ phiên trong mã sản xuất `server/**`: hàm bao quanh nó phải chứa ít nhất một
 *   BẰNG CHỨNG DANH TÍNH — mật khẩu vừa xác minh, HOẶC vé "bước mật khẩu đã qua", HOẶC một
 *   assertion IdP ngoài vừa xác minh.***
 *
 * Một endpoint cấp phiên **thứ tám** sinh ra ở bất kỳ đâu — file mới, thư mục mới, tên khác — tự
 * đưa mình vào lượng từ và làm ô này **ĐỎ**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HAI LƯỢNG TỪ, VÌ MỘT CÂU CÓ HAI NỬA — VÀ NỬA THỨ HAI LÀ NỬA ĐANG HỞ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §2 canh *"có bằng chứng"*. Nhưng `POST /api/external/auth/login` **thoả §2** (nó gọi
 * `comparePasswordConstantTime`) mà vẫn là một lỗ: nó **không bao giờ hỏi** 2FA có bật không ⇒
 * `supervisor1` bật 2FA vẫn lấy được thẻ 30 ngày **chỉ bằng mật khẩu** (ĐO ĐƯỢC, Bước 2).
 * ⇒ §3 canh nửa còn lại:
 *
 *   ***∀ đường cấp phiên bằng MẬT KHẨU CỤC BỘ: hoặc nó hỏi `get2FAStatus`, hoặc nó KHAI RA vùng mù
 *   bằng dấu `@KHONG-CONG-2FA` ngay tại chỗ — và SỐ lượt khai được GHIM.***
 *
 * ⚠ Vì sao dùng dấu khai thay vì bắt đỏ ngay: sửa `/api/external/auth/login` là đổi hành vi một
 *   **API hướng ra ngoài đã tài liệu hoá** (`docs/API_REFERENCE.md` + OpenAPI) có **client thật
 *   trong repo** (`FactoryAlertSystem/src/services/authService.ts`) ⇒ **chủ dự án quyết**, không
 *   phải một lượt vá lặng lẽ. Nhưng vùng mù ấy **không được ở trạng thái im lặng**: nó bị đếm, có
 *   tên, và một vùng mù **thứ hai** làm ô này ĐỎ ngay.
 *
 * ⚠⚠ **DÙNG LẠI BỘ SUY ĐÃ CÓ, KHÔNG VIẾT BỘ THỨ N+1.** Phạm vi quét (`moiFileDuoi`) và phép nhận
 *   diện lưới (`laFileTest`) lấy từ `deployProcedureScan.ts` — đúng chỉ dẫn §Global Constraints
 *   (*"Dùng lại `server/routers/deployProcedureScan.ts`"*), và đúng bài học **C-2**: hai bộ suy
 *   độc lập canh hai nửa một câu ở hai phạm vi thì cái yếu canh nửa nguy hiểm hơn.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi, laFileTest } from "./deployProcedureScan";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/routers
const GOC_REPO = join(TEST_DIR, "..", "..");

/**
 * ★★★ ĐIỂM ĐÚC THẺ PHIÊN. Ba hình dạng, đo được ở Bước 2 và **đóng theo cấu tạo**:
 * `signSession` có **đúng một** người gọi (`createSessionToken`) ⇒ `createSessionToken` là cửa đúc
 * JWT duy nhất; `res.cookie(COOKIE_NAME…)` là cửa gắn thẻ vào trình duyệt duy nhất.
 */
const HINH_DANG_DUC = ["createSessionToken", "signSession"] as const;

/**
 * ★★★ TẬP BẰNG CHỨNG DANH TÍNH — **tập ĐÓNG về khái niệm** (mật khẩu · vé bước-mật-khẩu · IdP
 * ngoài), không phải danh sách đường. Thêm một *loại* bằng chứng là một quyết định kiến trúc phải
 * nói ra; thêm một *đường* thì không được im lặng.
 */
const BANG_CHUNG = [
  "verifyCredentials", // mật khẩu — đường dùng chung (`_core/authService.ts`)
  "comparePasswordConstantTime", // mật khẩu — so khớp chống side-channel dùng chung
  "kiemVe2FA", // vé "bước mật khẩu của CHÍNH userId ấy đã qua" (Pha 7 Task 6)
  "consumeStateEntry", // nonce OAuth một-lần của callback IdP ngoài
  "exchangeCodeForToken", // đổi mã uỷ quyền với IdP (đường SDK portal)
  "consumeAssertion", // chữ ký assertion SAML
] as const;

/** Hàm **uỷ quyền** đúc phiên: nó đúc hộ, nên nghĩa vụ chứng minh chuyển sang NGƯỜI GỌI nó. */
const HAM_UY_QUYEN = "establishSession";

/**
 * ★★★★ Pha 7 / review TOÀN NHÁNH **I-1** — **MIỄN TRỪ LÀ MỘT ÁNH XẠ `đường:hàm`, KHÔNG PHẢI MỘT
 * TẬP TÊN.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO ĐỔI: **PHÉP THỬ M3 CỦA CHÍNH FILE NÀY ĐÃ THẤT BẠI, ĐO ĐƯỢC.**
 * Bản trước hỏi *"tên hàm bao ∈ {establishSession, createSessionToken, signSession}"* — **chỉ
 * TÊN**. Người review dựng `server/routers/__reviewProbeSession.ts`:
 *
 *     const establishSession = async (req, res) => {
 *       const token = await sdk.createSessionToken(String(req.query.openId ?? ""), { name: "" });
 *       res.cookie(COOKIE_NAME, token, getSessionCookieOptions(req));
 *       res.json({ ok: true });
 *     };
 *     export function dangKyCuaHau(app) { app.post("/api/backdoor", establishSession); }
 *
 * ⇒ Một tuyến **cấp phiên đầy đủ cho BẤT KỲ AI** — không mật khẩu, không vé, không IdP — trong một
 *   **FILE MỚI**, và lưới khai **XANH 9/9**. Vì tên trùng ⇒ nó được xếp vào *"đúc HỘ"* và **rơi
 *   khỏi** lượng từ; và ô ghim dưới đây so **TẬP đã dedup** nên tập cũng **không đổi**.
 * Đúng docstring của chính file này (dòng 23-24): *"Một endpoint cấp phiên **thứ tám** sinh ra ở
 * bất kỳ đâu — file mới, thư mục mới, tên khác — tự đưa mình vào lượng từ và làm ô này **ĐỎ**"*.
 * Nó đã **không** làm thế.
 *
 * ⇒ Miễn trừ nay ghim **CẢ ĐƯỜNG LẪN TÊN**. Một hàm **cùng tên** ở một **file khác** KHÔNG được
 *   miễn hộ — nó là một đường cấp phiên mới và phải chứng minh bằng chứng như mọi đường khác.
 * ⚠ Lý lẽ cũ vẫn đúng và vẫn giữ: `sdk.createSessionToken` gọi `signSession` là **tầng dưới của
 *   cùng một cửa đúc**, không phải một đường mới (lượt chạy đầu của lưới này đã bắt nhầm nó).
 *   Khác biệt là nay *"cùng một cửa đúc"* được ghim bằng **vị trí trên đĩa**, thứ không sửa được
 *   bằng cách đặt trùng tên — đúng bài học `vramPha5Gate` (*"NHẬN DIỆN BẰNG VỊ TRÍ, KHÔNG BẰNG
 *   CHÍNH TẢ"*).
 */
const ANH_XA_UY_QUYEN: readonly (readonly [duong: string, ham: string])[] = [
  ["server/_core/authService.ts", "establishSession"],
  ["server/_core/sdk.ts", "createSessionToken"],
];

const LA_HAM_UY_QUYEN = (duong: string, ten: string): boolean =>
  ANH_XA_UY_QUYEN.some(([d, h]) => d === duong && h === ten);

/**
 * ★★★ SỐ **CẶP `đường:hàm`** uỷ quyền được phép tồn tại. **GHIM = 2** — và con số này là một **phép
 * đếm ĐỘC LẬP**, không phải con số tôi định trước: lượt ghim đầu tiên viết **3** (thêm
 * `server/_core/sdk.ts:signSession`) và ca dưới **ĐỎ ngay**, vì `signSession` **không bao giờ là
 * hàm BAO của một điểm đúc** — nó *là* một hình dạng đúc, được gọi **bên trong**
 * `createSessionToken`. Ghi lại để lượt sau không "sửa" ô này bằng cách thêm cặp thứ ba.
 * ⚠ Trước I-1 con số này đếm trên **TẬP TÊN đã dedup**, nên hai hàm cùng tên ở hai file làm nó
 *   **không nhúc nhích** — chính là cửa mà đột biến của reviewer đi qua.
 */
const SO_HAM_UY_QUYEN = 2;

/** Dấu khai vùng mù 2FA (xem §3). */
const DAU_KHONG_CONG_2FA = "@KHONG-CONG-2FA";
/** ★★★ GHIM số vùng mù 2FA đang được khai. Hôm nay: **1** (`/api/external/auth/login`). */
const SO_VUNG_MU_2FA = 1;

// ── quét ────────────────────────────────────────────────────────────────────────────────────
const SAN_XUAT = moiFileDuoi(GOC_REPO, "server", [".ts"]).filter((f) => !laFileTest(f.duong));

type DiemDuc = {
  duong: string;
  dong: number;
  ham: string;
  than: string;
  loai: string;
  /**
   * ★★★★ **I-2** — node AST của hàm bao. Bằng chứng phải đọc **trên CÂY**; `than` (văn bản) chỉ
   * còn dùng cho những thứ **thật sự là văn bản** (dấu khai `@KHONG-CONG-2FA` là một chú thích).
   */
  bao?: ts.Node;
};

/**
 * ★★★★ Pha 7 / review TOÀN NHÁNH **I-2** — **BẰNG CHỨNG ĐỌC TRÊN CÂY, KHÔNG TRÊN VĂN BẢN.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO ĐỔI: bản trước hỏi `d.than.includes(\`${b}(\`)` ⇒ **một CHÚ THÍCH tính là bằng chứng**.
 * Đo được: đột biến ở `server/_core/oauth.ts` **gỡ hẳn** lời gọi thật `kiemVe2FA(req, …)` (thay
 * bằng `{ hopLe: true }`) và gỡ `tieuVe2FA(req, res)`, **giữ nguyên tên trong chú thích** ⇒ lưới
 * này vẫn **9/9 XANH** (trong khi lưới HÀNH VI `verify2faPasswordStep.test.ts` ĐỎ **9 ca** — tức
 * bản vá Critical của Task 6 đã bị gỡ thật).
 * Repo **đã biết** tính chất này theo chiều ngược: `server/_core/authService.ts:265-267` phải **cố
 * ý không viết** `capVe2FA(` trong một chú thích vì *"ô ấy ĐỎ"*. Một lưới bắt buộc người ta phải
 * né cách viết chú thích là một lưới đang canh **CHÍNH TẢ**, không canh **SỰ THẬT**.
 */
function goiTrong(n: ts.Node | undefined, ten: readonly string[]): boolean {
  if (!n) return false;
  let co = false;
  const di = (x: ts.Node): void => {
    if (co) return;
    if (ts.isCallExpression(x) && ten.includes(tenLoiGoi(x))) { co = true; return; }
    ts.forEachChild(x, di);
  };
  di(n);
  return co;
}

function laHamBao(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n)
  );
}

/** Tên hàm bao gần nhất (để thông báo lỗi chỉ đúng chỗ), hoặc `<ẩn danh>`. */
function tenHam(n: ts.Node): string {
  if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n)) && n.name) {
    return n.name.getText();
  }
  const cha = n.parent;
  if (cha && ts.isVariableDeclaration(cha) && cha.name) return cha.name.getText();
  return "<ẩn danh>";
}

/** Tên hàm được gọi ở một `CallExpression` (`a.b.c(…)` → `c`). */
function tenLoiGoi(n: ts.CallExpression): string {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
}

function quet(): { duc: DiemDuc[]; uyQuyen: DiemDuc[]; goiUyQuyen: DiemDuc[] } {
  const duc: DiemDuc[] = [];
  const uyQuyen: DiemDuc[] = [];
  const goiUyQuyen: DiemDuc[] = [];

  for (const f of SAN_XUAT) {
    const src = readFileSync(f.that, "utf8");
    if (
      !HINH_DANG_DUC.some((h) => src.includes(h)) &&
      !src.includes(HAM_UY_QUYEN) &&
      !src.includes("res.cookie")
    ) {
      continue;
    }
    const sf = ts.createSourceFile(f.that, src, ts.ScriptTarget.Latest, true);

    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const ten = tenLoiGoi(n);
        const laCookiePhien =
          ten === "cookie" && (n.arguments[0]?.getText() ?? "") === "COOKIE_NAME";
        const laDuc = (HINH_DANG_DUC as readonly string[]).includes(ten) || laCookiePhien;
        const laGoiUyQuyen = ten === HAM_UY_QUYEN;

        if (laDuc || laGoiUyQuyen) {
          let bao: ts.Node | undefined = n.parent;
          while (bao && !laHamBao(bao)) bao = bao.parent;
          const muc: DiemDuc = {
            duong: f.duong,
            dong: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
            ham: bao ? tenHam(bao) : "<đỉnh file>",
            than: bao ? bao.getText() : src,
            loai: laCookiePhien ? "res.cookie(COOKIE_NAME)" : ten,
            bao: bao ?? sf,
          };
          // Điểm đúc NẰM TRONG chính một hàm uỷ quyền ⇒ lượt đúc HỘ, không phải một đường mới.
          // ⚠ I-1: miễn trừ theo **ĐƯỜNG:HÀM** — cùng tên ở file khác KHÔNG được miễn hộ.
          if (laDuc && LA_HAM_UY_QUYEN(muc.duong, muc.ham)) uyQuyen.push(muc);
          else if (laGoiUyQuyen) goiUyQuyen.push(muc);
          else if (laDuc) duc.push(muc);
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return { duc, uyQuyen, goiUyQuyen };
}

const { duc, uyQuyen, goiUyQuyen } = quet();
const MOI_DUONG = [...duc, ...goiUyQuyen];
/** ★★★★ I-2 — bằng chứng là một **LỜI GỌI THẬT** trên cây, không phải một chuỗi trong văn bản. */
const coBangChung = (d: DiemDuc) => goiTrong(d.bao, BANG_CHUNG);

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ Task 6 §1 — cầu chì của lượng từ (không có nó thì ∀ thoả RỖNG)", () => {
  it("★★★ bộ suy quét được `server/**` và thấy đủ file", () => {
    expect(SAN_XUAT.length, "quét trúng quá ít file ⇒ mọi ca dưới là chân lý rỗng").toBeGreaterThan(200);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — phải THẬT SỰ tìm ra các đường cấp phiên", () => {
    expect(MOI_DUONG.length, "không thấy đường cấp phiên nào ⇒ bộ suy hỏng, không phải hệ sạch").toBeGreaterThanOrEqual(5);
    const file = [...new Set(MOI_DUONG.map((d) => d.duong))];
    expect(file.length, "bề mặt phải trải trên nhiều file — 1 file nghĩa là bộ suy hỏng").toBeGreaterThanOrEqual(3);
  });

  it(`★★★★ I-1 — ĐÚNG ${SO_HAM_UY_QUYEN} CẶP \`đường:hàm\` uỷ quyền (một cặp thứ tư đi vòng qua MỌI lượng từ dưới)`, () => {
    // ⚠⚠ So trên **CẶP**, không trên tập TÊN đã dedup: hai hàm cùng tên ở hai file làm tập không
    //    đổi ⇒ đúng cửa mà đột biến `__reviewProbeSession.ts` của reviewer đi qua (9/9 XANH).
    const cap = [...new Set(uyQuyen.map((d) => `${d.duong}:${d.ham}`))].sort();
    expect(
      cap.join("\n"),
      `cặp \`đường:hàm\` uỷ quyền đúc phiên đã đổi:\n${[...new Set(uyQuyen.map((d) => `${d.duong}:${d.dong} ${d.ham}`))].join("\n")}`,
    ).toBe(
      [...ANH_XA_UY_QUYEN].map(([d, h]) => `${d}:${h}`).sort().join("\n"),
    );
    expect(cap.length).toBe(SO_HAM_UY_QUYEN);
  });

  it("★★★★ I-1 / M3 — một `establishSession` **CÙNG TÊN ở FILE KHÁC** KHÔNG được miễn hộ", () => {
    /**
     * ⚠⚠⚠ Ca neo vào **cơ chế**, dựng lại nguyên văn đột biến của reviewer. Trước I-1 vị từ miễn
     * trừ chỉ hỏi TÊN ⇒ hàm này được xếp *"đúc HỘ"* và **rơi khỏi lượng từ**, cổng khai XANH 9/9
     * cho một tuyến cấp phiên **đầy đủ cho bất kỳ ai**.
     */
    for (const d of ["server/routers/__cuaHau.ts", "server/services/x/establish.ts", "server/_core/oauth.ts"]) {
      expect(
        LA_HAM_UY_QUYEN(d, "establishSession"),
        `${d}:establishSession KHÔNG được miễn — chỉ \`server/_core/authService.ts\` mới là chủ`,
      ).toBe(false);
      expect(LA_HAM_UY_QUYEN(d, "createSessionToken"), `${d}:createSessionToken KHÔNG được miễn`).toBe(false);
    }
    // ĐỐI CHỨNG DƯƠNG: ba cặp THẬT vẫn được miễn (nếu không, lưới bắt nhầm chính cửa đúc dùng chung).
    for (const [d, h] of ANH_XA_UY_QUYEN) expect(LA_HAM_UY_QUYEN(d, h), `${d}:${h} phải được miễn`).toBe(true);
  });

  it("★★★★ I-2 — bằng chứng đọc trên CÂY: một CHÚ THÍCH mang đúng tên KHÔNG phải bằng chứng", () => {
    /**
     * ⚠⚠⚠ Đột biến đo được: gỡ **lời gọi thật** `kiemVe2FA(req, Number(userId))` khỏi
     * `server/_core/oauth.ts` (thay bằng `{ hopLe: true }`), **giữ tên trong chú thích** ⇒ lưới này
     * vẫn 9/9 XANH, trong khi `verify2faPasswordStep.test.ts` ĐỎ 9 ca.
     */
    const chiChuThich = `
      async function capPhien(req: any, res: any) {
        // đã kiemVe2FA(req, id) và tieuVe2FA(req, res) ở tầng trên
        /** verifyCredentials( — comparePasswordConstantTime( */
        const token = await sdk.createSessionToken(req.query.openId, { name: "" });
        res.cookie(COOKIE_NAME, token, {});
      }`;
    const sf = ts.createSourceFile("server/x/chuThich.ts", chiChuThich, ts.ScriptTarget.Latest, true);
    expect(
      goiTrong(sf, BANG_CHUNG),
      "một CHÚ THÍCH mang đúng tên được nhận làm bằng chứng ⇒ lưới đang canh CHÍNH TẢ, không canh sự thật",
    ).toBe(false);
    // ĐỐI CHỨNG DƯƠNG: một lời gọi THẬT thì phải thấy.
    const goiThat = `async function f(req: any) { const v = await kiemVe2FA(req, 1); return v; }`;
    expect(
      goiTrong(ts.createSourceFile("server/x/that.ts", goiThat, ts.ScriptTarget.Latest, true), BANG_CHUNG),
      "một lời gọi THẬT phải được nhận là bằng chứng",
    ).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ Task 6 §2 — ∀ đường cấp phiên: PHẢI có một BẰNG CHỨNG DANH TÍNH", () => {
  it("★★★ ∀ điểm đúc thẻ phiên trong `server/**`: hàm bao chứa ≥1 bằng chứng", () => {
    const pham = MOI_DUONG.filter((d) => !coBangChung(d)).map(
      (d) => `${d.duong}:${d.dong} (${d.loai}) trong \`${d.ham}\``,
    );
    expect(
      pham.join("\n"),
      `một đường cấp phiên KHÔNG đòi bằng chứng danh tính nào.\n` +
        `Bằng chứng được chấp nhận: ${BANG_CHUNG.join(" · ")}.\n` +
        `⚠ Đây CHÍNH là lỗ Pha 7 Task 6 (\`verify-2fa\` cấp phiên không cần mật khẩu) tái sinh ở một đường khác.`,
    ).toBe("");
  });

  it("★★★★ I-2 — ĐỐI CHỨNG DƯƠNG `verify-2fa`: kiểm vé + tiêu vé là LỜI GỌI THẬT trên CÂY", () => {
    /**
     * ⚠⚠⚠ Bản trước cắt một **LÁT VĂN BẢN** của `oauth.ts` rồi `toContain("kiemVe2FA(")` ⇒ chú
     * thích thoả ô này. Nay: tìm **đúng lời gọi `app.post("/api/auth/verify-2fa", handler)`** trên
     * cây, rồi hỏi thân handler có `CallExpression` tới `kiemVe2FA`/`tieuVe2FA` hay không.
     */
    const duong = join(GOC_REPO, "server", "_core", "oauth.ts");
    const sf = ts.createSourceFile(duong, readFileSync(duong, "utf8"), ts.ScriptTarget.Latest, true);
    let handler: ts.Node | undefined;
    const di = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ["post", "get", "put", "all"].includes(tenLoiGoi(n)) &&
        n.arguments.length >= 2 &&
        ts.isStringLiteralLike(n.arguments[0]!) &&
        n.arguments[0]!.getText(sf).includes("/api/auth/verify-2fa")
      ) {
        handler = n.arguments[n.arguments.length - 1];
      }
      ts.forEachChild(n, di);
    };
    ts.forEachChild(sf, di);
    expect(handler, "không thấy tuyến `/api/auth/verify-2fa` trên CÂY — nó đã đổi hình dạng?").toBeTruthy();
    expect(goiTrong(handler, ["kiemVe2FA"]), "`verify-2fa` mất LỜI GỌI kiểm vé ⇒ lỗ gốc Task 6 mở lại").toBe(true);
    expect(goiTrong(handler, ["tieuVe2FA"]), "`verify-2fa` mất LỜI GỌI tiêu vé ⇒ vé thôi là MỘT-LẦN").toBe(true);
    // …và nó vẫn phải cấp phiên qua đường dùng chung, không tự đúc.
    expect(goiTrong(handler, [HAM_UY_QUYEN]), "handler `verify-2fa` phải cấp phiên qua `establishSession`").toBe(true);
  });

  it("★★★ ∀ đường `login` cấp vé: CẢ HAI đường (tRPC và express) — bỏ sót một đường ⇒ luồng đúng của đường ấy vỡ", () => {
    const nguoiCap = SAN_XUAT.filter((f) => readFileSync(f.that, "utf8").includes("capVe2FA(")).map((f) => f.duong);
    expect(
      nguoiCap.sort().join(" · "),
      "vé phải được cấp ở CẢ hai nhánh `requires2FA` (`server/routers.ts` = tRPC, `server/_core/oauth.ts` = express) và KHÔNG ở đâu khác",
    ).toBe("server/_core/oauth.ts · server/_core/pendingTwoFactor.ts · server/routers.ts");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ Task 6 §3 — nửa THỨ HAI: đường mật khẩu cục bộ phải hỏi 2FA, hoặc KHAI vùng mù", () => {
  /**
   * Đường cấp phiên bằng **mật khẩu cục bộ** = có bằng chứng mật khẩu trong hàm bao.
   * ⚠ I-2: hỏi trên **CÂY** — một chú thích nhắc `verifyCredentials(` không được kéo một đường vào
   *   (hay đẩy một đường ra khỏi) lượng từ này.
   */
  const duongMatKhau = MOI_DUONG.filter((d) =>
    goiTrong(d.bao, ["verifyCredentials", "comparePasswordConstantTime"]),
  );

  it("★★★ cầu chì — phải có ít nhất hai đường mật khẩu cục bộ", () => {
    expect(duongMatKhau.length, "không thấy đường mật khẩu nào ⇒ ca dưới thoả rỗng").toBeGreaterThanOrEqual(2);
  });

  it("★★★ ∀ đường mật khẩu cục bộ: hỏi `get2FAStatus`, HOẶC khai vùng mù bằng dấu tại chỗ", () => {
    // ⚠ I-2: *"có hỏi 2FA không"* đọc trên **CÂY** (một lời gọi thật); còn dấu khai vùng mù thì
    //   **đúng là** một chú thích, nên nó — và chỉ nó — vẫn hỏi trên văn bản.
    const im = duongMatKhau
      .filter((d) => !goiTrong(d.bao, ["get2FAStatus"]) && !d.than.includes(DAU_KHONG_CONG_2FA))
      .map((d) => `${d.duong}:${d.dong} trong \`${d.ham}\``);
    expect(
      im.join("\n"),
      `một đường cấp phiên bằng mật khẩu KHÔNG hỏi 2FA và KHÔNG khai vùng mù.\n` +
        `⇒ tài khoản đã bật 2FA vẫn lấy được phiên CHỈ bằng mật khẩu, im lặng.\n` +
        `Sửa: thêm cổng 2FA, hoặc khai \`${DAU_KHONG_CONG_2FA}\` ngay tại chỗ và cập nhật SO_VUNG_MU_2FA.`,
    ).toBe("");
  });

  it(`★★★ SỐ vùng mù 2FA được khai phải ĐÚNG ${SO_VUNG_MU_2FA} — cái thứ hai phải NÓI RA`, () => {
    const khai = SAN_XUAT.filter((f) => readFileSync(f.that, "utf8").includes(DAU_KHONG_CONG_2FA)).map(
      (f) => f.duong,
    );
    expect(
      khai.sort().join(" · "),
      `vùng mù 2FA đã đổi. Hôm nay được duyệt đúng MỘT: \`server/_core/index.ts\` ` +
        `(\`POST /api/external/auth/login\` — API hướng ra ngoài, đã tài liệu hoá, có client thật ` +
        `\`FactoryAlertSystem\`; sửa nó là quyết định của CHỦ DỰ ÁN, không phải một lượt vá lặng lẽ).`,
    ).toBe("server/_core/index.ts");
    expect(khai.length).toBe(SO_VUNG_MU_2FA);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★★ 2026-08-11 · **SIẾT FAIL-OPEN** — nửa THỨ BA của cùng một câu.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO §4 PHẢI SỐNG CÙNG NHÀ VỚI §2/§3 — VÀ DÙNG CHUNG **ĐÚNG MỘT** BỘ SUY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `chanNeuPhienDaThuHoi` nay **từ chối** mọi vé không có hàng `user_sessions`. Bất biến mới:
 *
 *   ***∀ điểm đúc thẻ phiên trong mã sản xuất `server/**`: hàm bao quanh nó phải **GHI SỔ** —
 *   trực tiếp (`ghiSoPhien` / `ghiSoPhienChoOpenId` / `createUserSession`) hoặc qua hàm uỷ quyền
 *   `establishSession`.***
 *
 * Phép đếm **TRƯỚC** lượt siết (bộ suy của chính file này): **5** điểm gọi `createSessionToken`,
 * chỉ **1** ghi sổ. Bốn điểm còn lại — hai callback OAuth, ACS của SAML, `/api/external/auth/login`
 * — đúc vé rồi không ghi gì; sau lượt siết mỗi điểm ấy là một **nhà tù im lặng** (302 về `/` rồi
 * 403 mọi thứ), và `/api/external/auth/login` còn đứt hẳn một client thật trong repo.
 *
 * ⚠⚠ **KHÔNG viết bộ suy thứ HAI.** §4 dùng lại nguyên `quet()`, `goiTrong()`, `MOI_DUONG` của
 *    §2/§3 — đúng bài học **C-2** (*"hai bộ suy độc lập canh hai nửa một câu ở hai phạm vi thì cái
 *    yếu canh nửa nguy hiểm hơn"*). Một điểm đúc **thứ SÁU** ở một file chưa tồn tại tự vào **cả
 *    ba** lượng từ cùng lúc.
 * ⚠ Và `establishSession` được nhận là ghi sổ vì **nó thật sự ghi** — ca hiệu chuẩn dưới đọc lại
 *   thân nó trên CÂY thay vì tin cái tên (I-2).
 */
const GHI_SO = [
  "ghiSoPhien", // chủ của lượt ghi (`server/_core/authService.ts`)
  "ghiSoPhienChoOpenId", // ghi sổ khi chỉ cầm `openId` (OAuth/SAML)
  "createUserSession", // người ghi DUY NHẤT ở tầng db
  HAM_UY_QUYEN, // `establishSession` — đúc HỘ thì cũng ghi HỘ
] as const;

describe("★★★★ SIẾT FAIL-OPEN §4 — ∀ đường cấp phiên: PHẢI GHI SỔ `user_sessions`", () => {
  it("★★★★ ĐỐI CHỨNG TỔNG HỢP — vị từ xếp đúng cảnh HỞ và cảnh KÍN (đáp số biết trước)", () => {
    const ho = `async function capPhien(req: any, res: any) {
        const u = await verifyCredentials(req.body);
        // đã ghiSoPhien(...) ở tầng trên — CHÚ THÍCH, không phải lời gọi
        const token = await sdk.createSessionToken(u.openId, { name: "" });
        res.cookie(COOKIE_NAME, token, {});
      }`;
    expect(
      goiTrong(ts.createSourceFile("server/x/ho.ts", ho, ts.ScriptTarget.Latest, true), GHI_SO),
      "một CHÚ THÍCH mang tên phép ghi sổ được nhận là ghi sổ ⇒ §4 đang canh CHÍNH TẢ",
    ).toBe(false);

    const kin = `async function capPhien(req: any, res: any) {
        const u = await verifyCredentials(req.body);
        const token = await sdk.createSessionToken(u.openId, { name: "" });
        await ghiSoPhienChoOpenId(u.openId, token, req, 1000);
        res.cookie(COOKIE_NAME, token, {});
      }`;
    expect(
      goiTrong(ts.createSourceFile("server/x/kin.ts", kin, ts.ScriptTarget.Latest, true), GHI_SO),
      "một lời gọi ghi sổ THẬT phải được nhận",
    ).toBe(true);
  });

  it("★★★★ ĐỐI CHỨNG DƯƠNG — `establishSession` được nhận là ghi sổ vì THÂN nó thật sự ghi", () => {
    // ⚠ I-2: không tin cái TÊN trong `GHI_SO`; đọc lại thân hàm uỷ quyền trên CÂY.
    const duong = join(GOC_REPO, "server", "_core", "authService.ts");
    const sf = ts.createSourceFile(duong, readFileSync(duong, "utf8"), ts.ScriptTarget.Latest, true);
    let than: ts.Node | undefined;
    const di = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name?.getText() === HAM_UY_QUYEN) than = n;
      ts.forEachChild(n, di);
    };
    ts.forEachChild(sf, di);
    expect(than, `không thấy \`${HAM_UY_QUYEN}\` trong authService.ts — nó đã đổi hình dạng?`).toBeTruthy();
    expect(
      goiTrong(than, ["ghiSoPhien", "createUserSession"]),
      `\`${HAM_UY_QUYEN}\` thôi ghi sổ ⇒ mọi đường uỷ quyền cho nó cấp ra vé CHẾT NGAY (fail-closed).`,
    ).toBe(true);
  });

  it("★★★★ ∀ điểm đúc thẻ phiên trong `server/**`: hàm bao có ≥1 lượt GHI SỔ", () => {
    const pham = MOI_DUONG.filter((d) => !goiTrong(d.bao, GHI_SO)).map(
      (d) => `${d.duong}:${d.dong} (${d.loai}) trong \`${d.ham}\``,
    );
    expect(
      pham.join("\n"),
      `một đường cấp phiên đúc vé mà KHÔNG ghi hàng \`user_sessions\`.\n` +
        `Từ lượt siết 2026-08-11, \`chanNeuPhienDaThuHoi\` TỪ CHỐI vé không có hàng ⇒ đường này\n` +
        `cấp ra một vé **chết ngay ở yêu cầu đầu tiên**: người dùng đăng nhập "thành công" rồi\n` +
        `403 mọi thứ — một NHÀ TÙ IM LẶNG (Pha 7 đã ship đúng lớp ấy ra 4/4 tài khoản).\n` +
        `Phép ghi được chấp nhận: ${GHI_SO.join(" · ")}.`,
    ).toBe("");
  });
});
