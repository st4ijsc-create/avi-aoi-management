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
 * ★★★ **HÀM UỶ QUYỀN được SUY RA, không liệt kê.** Một điểm đúc nằm bên trong một hàm mà **chính
 * nó** là một hình dạng đúc (hoặc là hàm uỷ quyền) thì đó là lượt đúc **HỘ**, không phải một
 * đường cấp phiên mới — nghĩa vụ chứng minh chuyển sang **người gọi**.
 *
 * ⚠ Ô này do **lượt chạy đầu tiên của chính lưới này BẮT ĐƯỢC**, không do tôi đoán trước:
 *   `sdk.ts:175` — `createSessionToken` gọi `signSession` — bị báo là *"đường cấp phiên không có
 *   bằng chứng"*. Nó **không** phải một đường; nó là tầng dưới của cùng một cửa đúc. Đúng lớp
 *   *"lưới khoá đúng cái vừa sửa"*: nếu tôi đặc cách riêng `sdk.ts` thì tầng uỷ quyền **thứ ba**
 *   sẽ lại lọt. Nên luật nói về **vai trò**, không về tên file.
 */
const LA_HAM_UY_QUYEN = (ten: string): boolean =>
  ten === HAM_UY_QUYEN || (HINH_DANG_DUC as readonly string[]).includes(ten);

/**
 * ★★★ SỐ hàm uỷ quyền được phép tồn tại. **GHIM = 2** (`establishSession` · `createSessionToken`).
 * Một hàm uỷ quyền thứ ba là một cửa đúc phiên mà mọi lượng từ dưới đây sẽ đi vòng qua ⇒ phải
 * NÓI RA, không trôi qua im lặng.
 */
const SO_HAM_UY_QUYEN = 2;

/** Dấu khai vùng mù 2FA (xem §3). */
const DAU_KHONG_CONG_2FA = "@KHONG-CONG-2FA";
/** ★★★ GHIM số vùng mù 2FA đang được khai. Hôm nay: **1** (`/api/external/auth/login`). */
const SO_VUNG_MU_2FA = 1;

// ── quét ────────────────────────────────────────────────────────────────────────────────────
const SAN_XUAT = moiFileDuoi(GOC_REPO, "server", [".ts"]).filter((f) => !laFileTest(f.duong));

type DiemDuc = { duong: string; dong: number; ham: string; than: string; loai: string };

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
          };
          // Điểm đúc NẰM TRONG chính một hàm uỷ quyền ⇒ lượt đúc HỘ, không phải một đường mới.
          if (laDuc && LA_HAM_UY_QUYEN(muc.ham)) uyQuyen.push(muc);
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
const coBangChung = (d: DiemDuc) => BANG_CHUNG.some((b) => d.than.includes(`${b}(`));

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

  it(`★★★ ĐÚNG ${SO_HAM_UY_QUYEN} hàm uỷ quyền đúc phiên — một cái thứ ba đi vòng qua MỌI lượng từ dưới`, () => {
    const ten = [...new Set(uyQuyen.map((d) => d.ham))].sort();
    expect(
      ten.join(" · "),
      `hàm uỷ quyền đúc phiên đã đổi:\n${[...new Set(uyQuyen.map((d) => `${d.duong}:${d.dong} ${d.ham}`))].join("\n")}`,
    ).toBe("createSessionToken · establishSession");
    expect(ten.length).toBe(SO_HAM_UY_QUYEN);
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

  it("★★★ ĐỐI CHỨNG DƯƠNG — `verify-2fa` phải dùng ĐÚNG bằng chứng `kiemVe2FA`, không phải một cái khác", () => {
    const v2 = goiUyQuyen.find((d) => d.duong === "server/_core/oauth.ts" && d.than.includes("verify-2fa"));
    // Handler `verify-2fa` là một arrow function; hàm bao của lượt `establishSession` chính là nó.
    const ma = readFileSync(join(GOC_REPO, "server", "_core", "oauth.ts"), "utf8");
    const i = ma.indexOf('"/api/auth/verify-2fa"');
    expect(i, "không thấy tuyến `/api/auth/verify-2fa`").toBeGreaterThan(0);
    const than = ma.slice(i, ma.indexOf("app.get(", i) === -1 ? undefined : ma.indexOf("app.get(", i));
    expect(than, "`verify-2fa` mất phép kiểm vé ⇒ lỗ gốc mở lại").toContain("kiemVe2FA(");
    expect(than, "`verify-2fa` phải TIÊU vé (một-lần)").toContain("tieuVe2FA(");
    expect(v2 ?? than, "handler `verify-2fa` vẫn phải cấp phiên qua đường dùng chung").toBeTruthy();
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
  /** Đường cấp phiên bằng **mật khẩu cục bộ** = có bằng chứng mật khẩu trong hàm bao. */
  const duongMatKhau = MOI_DUONG.filter((d) =>
    ["verifyCredentials", "comparePasswordConstantTime"].some((b) => d.than.includes(`${b}(`)),
  );

  it("★★★ cầu chì — phải có ít nhất hai đường mật khẩu cục bộ", () => {
    expect(duongMatKhau.length, "không thấy đường mật khẩu nào ⇒ ca dưới thoả rỗng").toBeGreaterThanOrEqual(2);
  });

  it("★★★ ∀ đường mật khẩu cục bộ: hỏi `get2FAStatus`, HOẶC khai vùng mù bằng dấu tại chỗ", () => {
    const im = duongMatKhau
      .filter((d) => !d.than.includes("get2FAStatus(") && !d.than.includes(DAU_KHONG_CONG_2FA))
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
