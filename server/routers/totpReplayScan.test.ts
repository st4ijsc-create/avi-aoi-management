/**
 * ★★★ Pha 6 Task 6 / Bước 7 — **ĐẢO LƯỢNG TỪ: "MỌI LƯỢT XÁC MINH TOTP ĐỀU ĐI QUA SỔ".**
 * (Lưới này đóng nợ Pha 5/Pha 6 nên nó tự khai `Pha 5` để `vramPha5Gate.test.ts` kéo nó vào lượng
 * từ *"mọi lưới Pha 5 phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG LIỆT KÊ 8 ĐIỂM GỌI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Phép đếm Bước 2 tìm được **8 điểm xác minh TOTP** ở **4 file**, trong đó **hai cặp tuyến SONG
 * SONG** làm cùng một việc (`twoFactor.enable` ≡ `user.verify2FA`; `twoFactor.disable` ≡
 * `user.disable2FA`). Một danh sách 8 tên là một danh sách **có phần tử thứ chín** — và phần tử
 * thứ chín ấy sẽ đứng **ngoài sổ**, im lặng, đúng lớp lỗi đã tái diễn chín lần ở Pha 5.
 *
 * ⇒ Bất biến được phát biểu ở dạng **∀ trên cấu trúc**, không trên tên:
 *
 *   ***∀ file SẢN XUẤT dưới `server/**` khác `server/_core/totpOnce.ts`: KHÔNG được chứa một lời
 *   gọi `<x>.totp.verify(…)` / `<x>.totp.verifyDelta(…)`.***
 *   ***∀ file `.ts` dưới `server/**` — KỂ CẢ `*.test.ts` (Pha 9 B3): KHÔNG được nhập `otplib`.***
 *
 * Một điểm xác minh thứ chín sinh ra ở **bất kỳ đâu** — file mới, thư mục mới, tên khác — đều tự
 * đưa mình vào lượng từ và làm ô này **ĐỎ**.
 *
 * ⚠⚠ **DÙNG LẠI BỘ SUY ĐÃ CÓ, KHÔNG VIẾT BỘ THỨ BA.** Phạm vi quét (`moiFileDuoi`), phép nhận diện
 * lưới (`laFileTest`), và phép phân giải đường nhập (`phanGiaiToi`) đều lấy từ
 * `deployProcedureScan.ts` — hạ tầng đã trả giá cho bài học **R1b** (quét đệ quy `server/**`, nhận
 * diện module bằng **phép nối đường dẫn** chứ không bằng chính tả chuỗi). Bài học **C-2** của
 * review toàn nhánh nói đúng chuyện này: *hai bộ suy độc lập canh hai nửa một câu ở hai phạm vi,
 * cái yếu canh nửa nguy hiểm hơn.*
 *
 * ⚠⚠ **CẦU CHÌ / ĐỐI CHỨNG DƯƠNG LÀ ĐIỀU KIỆN TỒN TẠI CỦA LƯỚI NÀY.** Xoá sạch mọi phép xác minh
 * TOTP khỏi repo cũng làm lượng từ trên **thoả rỗng**. Nên §0 khẳng định chiều ngược lại: sổ PHẢI
 * chứa đúng một lượt `speakeasy.totp.verify`, và số điểm gọi `verifyTotpOnce` phải **đúng bằng**
 * bề mặt đã đếm.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi, laFileTest, phanGiaiToi } from "./deployProcedureScan";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/routers
const GOC_REPO = join(TEST_DIR, "..", "..");
/** CHỦ DUY NHẤT của phép xác minh TOTP. */
const FILE_SO = join(GOC_REPO, "server", "_core", "totpOnce.ts");
const TEN_SO = "server/_core/totpOnce.ts";
/** Module tRPC — mốc nhận diện "bề mặt request" (xem §3). */
const CORE_TRPC = join(GOC_REPO, "server", "_core", "trpc.ts");

/**
 * ★★★ Con số GHIM của bề mặt xác minh. Đo được ở Bước 2: `_core/trpc.ts` (1, lõi step-up của cả 7
 * `deployProcedure`) · `_core/oauth.ts` (1, 2FA lúc ĐĂNG NHẬP) · `routers/twoFactorRouter.ts` (4:
 * `enable` · `disable` · `verify` · `regenerateBackupCodes`) · `routers/userRouters.ts` (2:
 * `verify2FA` · `disable2FA`).
 * ⚠ Ghim để một lượt **xoá** phép xác minh (bản vá "chặn hết") và một lượt **thêm** cửa mới đều
 * phải **NÓI RA**, thay vì trôi qua trong im lặng.
 */
const SO_DIEM_GOI_SO = 8;
/** Tên hàm cổng của sổ. */
const TEN_HAM_SO = "verifyTotpOnce";

interface FileNguon {
  readonly duong: string;
  readonly that: string;
  readonly ma: string;
  readonly sf: ts.SourceFile;
}

/** Đọc một file trên đĩa thành `FileNguon`. */
const docNguon = (f: { duong: string; that: string }): FileNguon => {
  const ma = readFileSync(f.that, "utf8");
  return { duong: f.duong, that: f.that, ma, sf: ts.createSourceFile(f.duong, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) };
};

/**
 * ★★★★ Pha 9 nhóm B · **B3 — MỌI file `.ts` dưới `server/**`, KỂ CẢ `*.test.ts`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO PHẢI CÓ TẬP RỘNG HƠN — LƯỚI CŨ MÙ ĐÚNG CHỖ CÓ VI PHẠM DUY NHẤT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ô *"KHÔNG nhập `otplib`"* dưới đây trước B3 chạy trên `SAN_XUAT` (đã lọc `laFileTest`). Đo được
 * ở Bước 1 của B3: **người nhập `otplib` DUY NHẤT trong toàn repo là một file TEST** —
 * `server/twoFactor.test.ts`, bốn ca `await import("otplib")`. Tức lượng từ được phát biểu trên
 * đúng cái tập **không chứa** vi phạm duy nhất đang tồn tại, và nó **XANH VĨNH VIỄN** vì thế.
 * Đây là lớp lỗi *"lưới theo FILE, không theo ĐƯỜNG THOÁT"* lần thứ **sáu** của chuỗi pha này.
 *
 * ⚠⚠ Vì sao một file TEST nhập `otplib` là chuyện thật, không phải chuyện hình thức: `otplib` vẫn
 *    nằm trong `package.json` (`^13.4.0`) — thư viện TOTP **thứ hai**, một đường xác minh hoàn
 *    toàn ngoài sổ `_core/totpOnce.ts`. Chừng nào còn một file trong repo dựng `new OTP(...)` và
 *    khẳng định nó chạy đúng, thì lượt sao-chép-dán tiếp theo có sẵn một khuôn mẫu **đã được một
 *    lưới xanh chứng thực** để bê vào mã sản xuất. Một *"ca test cho thư viện bị cấm"* là tài liệu
 *    sai đúng nghĩa đen.
 *
 * ⇒ B3 **xoá** `server/twoFactor.test.ts` (12 ca: 6 ô `expect(true).toBe(true)` + 4 ca cho chính
 *   thư viện bị cấm) và **nới lượng từ này ra cả `*.test.ts`** — MỘT chủ, không hai. Sau lượt xoá,
 *   số vi phạm là **0**, nên đây là một cổng thật chứ không phải một ảnh chụp.
 * ⚠ Chỉ ô `otplib` dùng tập rộng. Ô `.totp.verify` **giữ nguyên** `SAN_XUAT`: một lưới **được
 *   phép** gọi `speakeasy.totp.verify` để đúc mã hợp lệ làm vật liệu thử (`totpReplay.test.ts`
 *   làm đúng thế), nên nới ô ấy ra test là **bắt nhầm** — và một lưới bắt nhầm là một lưới sẽ bị
 *   người sau tắt đi.
 */
const MOI_FILE_SERVER: readonly FileNguon[] = moiFileDuoi(GOC_REPO, "server", [".ts"]).map(docNguon);

/**
 * ★★ Review TOÀN NHÁNH Pha 9 · **M-2 — LƯỢNG TỪ `otplib` PHỦ CẢ BỐN CÂY, KHÔNG CHỈ `server/`.**
 *
 * B3 nới lượng từ ra `*.test.ts` nhưng **giữ nguyên** phạm vi `server/**` ⇒ `client/`, `shared/`,
 * `scripts/` vẫn ngoài tầm. Với `otplib` còn ở **`dependencies`** (`^13.4.0` — tức **vẫn được cài
 * ở máy sản xuất**: `npm ci --omit=dev` giữ nó), một lượt nhập ở ba cây kia là đúng đường mà đường
 * xác minh TOTP thứ hai quay lại, và lưới **theo cấu tạo** không thấy.
 * ⚠ Đây là lớp lỗi *"lưới theo FILE/THƯ MỤC, không theo ĐƯỜNG THOÁT"* — cùng lớp mà chính B3 vừa
 *   vá **một nửa**, và cùng lớp với I-1 của lượt review này (thiết bị chống-N+1 tự nó là danh sách).
 * ⚠ NỢ CÒN LẠI, ĐƯỢC KHAI: `otplib` **vẫn ở `dependencies`** dù **0 người nhập** trên cả bốn cây.
 *   Chuyển nó sang `devDependencies` (hoặc gỡ hẳn) là một lượt đổi **bề mặt cài đặt sản xuất** +
 *   sinh lại `package-lock.json` ⇒ để chủ dự án quyết. Lượng từ dưới đây làm tính **không-với-tới**
 *   trở thành một bất biến, nên món nợ ấy nay là *"một thư viện có mặt mà không ai gọi được"*.
 */
const CAY_NGOAI: readonly string[] = ["client", "shared", "scripts"];
const MOI_FILE_BON_CAY: readonly FileNguon[] = [
  ...MOI_FILE_SERVER,
  ...CAY_NGOAI.flatMap((c) => moiFileDuoi(GOC_REPO, c, [".ts", ".tsx"]).map(docNguon)),
];

/** MỌI file **sản xuất** (`.ts`, không `*.test.ts`) dưới `server/**`. */
const SAN_XUAT: readonly FileNguon[] = MOI_FILE_SERVER.filter((f) => !laFileTest(f.duong));

/** Mọi lời gọi `<x>.totp.verify(…)` / `<x>.totp.verifyDelta(…)` trong một file, kèm số dòng. */
function loiGoiVerifyTotp(f: FileNguon): string[] {
  const ra: string[] = [];
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const ten = n.expression.name.text;
      const chu = n.expression.expression;
      if (
        (ten === "verify" || ten === "verifyDelta") &&
        ts.isPropertyAccessExpression(chu) &&
        chu.name.text === "totp"
      ) {
        ra.push(`${f.duong}:${f.sf.getLineAndCharacterOfPosition(n.getStart(f.sf)).line + 1}`);
      }
    }
    ts.forEachChild(n, di);
  };
  di(f.sf);
  return ra;
}

/** Mọi đường nhập (tĩnh · `export from` · `import()` động · `require`) của một file. */
function moiDuongNhap(f: FileNguon): string[] {
  const ra: string[] = [];
  const di = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
      ra.push(n.moduleSpecifier.text);
    }
    if (ts.isCallExpression(n)) {
      const goi = n.expression;
      const la =
        goi.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(goi) && goi.text === "require");
      const a0 = n.arguments[0];
      if (la && a0 !== undefined && ts.isStringLiteral(a0)) ra.push(a0.text);
    }
    ts.forEachChild(n, di);
  };
  di(f.sf);
  return ra;
}

/** Số lời gọi `verifyTotpOnce(…)` trong một file (**không** đếm lượt khai báo / lượt nhập). */
function loiGoiSo(f: FileNguon): string[] {
  const ra: string[] = [];
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === TEN_HAM_SO) {
      ra.push(`${f.duong}:${f.sf.getLineAndCharacterOfPosition(n.getStart(f.sf)).line + 1}`);
    }
    ts.forEachChild(n, di);
  };
  di(f.sf);
  return ra;
}

const SO = SAN_XUAT.find((f) => f.duong === TEN_SO);
const DIEM_GOI_SO = SAN_XUAT.filter((f) => f.duong !== TEN_SO).flatMap(loiGoiSo);
const FILE_GOI_SO = [...new Set(DIEM_GOI_SO.map((d) => d.split(":")[0] ?? ""))].sort();

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 0. CẦU CHÌ — một tập rỗng làm MỌI khẳng định dưới thành chân lý rỗng
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Task 6 — cầu chì của lượng từ", () => {
  it("★★★ bộ suy quét được `server/**` và THẤY file sổ", () => {
    expect(SAN_XUAT.length, "quét trúng quá ít file ⇒ mọi ca dưới là chân lý rỗng").toBeGreaterThan(200);
    expect(SO, `không thấy \`${TEN_SO}\` — bộ suy mất điểm neo`).toBeDefined();
    expect(readFileSync(FILE_SO, "utf8").length, "file sổ rỗng").toBeGreaterThan(100);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — file sổ PHẢI thật sự chạy `speakeasy.totp.verify` (nếu không, ∀ thoả RỖNG)", () => {
    /**
     * ⚠ Không có ô này thì một bản vá **xoá sạch phép xác minh TOTP** khỏi repo cũng làm ca §1
     * xanh — đúng lớp lỗi đã để `215/215` xanh suốt thời gian một tool luôn `PERMISSION_DENIED`.
     */
    const goi = SO === undefined ? [] : loiGoiVerifyTotp(SO);
    expect(goi.length, "file sổ phải chứa ĐÚNG một lượt `speakeasy.totp.verify`").toBe(1);
  });

  it(`★★★ CON SỐ GHIM — đúng ${SO_DIEM_GOI_SO} điểm gọi \`${TEN_HAM_SO}\` trong mã sản xuất`, () => {
    expect(
      DIEM_GOI_SO.length,
      `bề mặt xác minh TOTP ĐỔI SỐ (thấy: ${DIEM_GOI_SO.join(" · ")}). Thêm một cửa ⇒ khai ở đây; bớt một cửa ⇒ chứng minh nó không còn cần. Cả hai đều phải NÓI RA, không được trôi qua im lặng`,
    ).toBe(SO_DIEM_GOI_SO);
    expect(FILE_GOI_SO.length, "bề mặt phải trải trên nhiều file — 1 file nghĩa là bộ suy hỏng").toBeGreaterThanOrEqual(4);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. BẤT BIẾN CHÍNH — ∀ file sản xuất khác file sổ: KHÔNG được tự verify TOTP
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Task 6 — MỌI lượt xác minh TOTP đi qua sổ", () => {
  it("★★★ ∀ file sản xuất dưới `server/**` khác file sổ: KHÔNG có lời gọi `.totp.verify(…)`", () => {
    const pham = SAN_XUAT.filter((f) => f.duong !== TEN_SO).flatMap(loiGoiVerifyTotp);
    expect(
      pham.join(" · "),
      `một lượt \`.totp.verify\` NGOÀI \`${TEN_SO}\` là một mã OTP tiêu được nhiều lần — nó đứng ngoài sổ và không ai canh. Gọi \`${TEN_HAM_SO}()\` thay vì tự verify`,
    ).toBe("");
  });

  it("★★★★ B3 — ∀ file `.ts` dưới `server/**` **KỂ CẢ `*.test.ts`**: KHÔNG nhập `otplib` (thư viện TOTP THỨ HAI)", () => {
    /**
     * ⚠ `otplib` **vẫn nằm trong `package.json`** (`^13.4.0`). Nó là một đường xác minh TOTP song
     * song, hoàn toàn ngoài sổ — và `userRouters.ts:213-216` ghi rằng repo *"nay dùng MỘT thư
     * viện"*. Câu ấy là một **quan sát**; ô này biến nó thành một **bất biến**.
     * ⚠⚠ Phạm vi là `MOI_FILE_SERVER`, KHÔNG phải `SAN_XUAT` — xem khối lý lẽ ở chỗ khai
     *    `MOI_FILE_SERVER`: trước B3 vi phạm **duy nhất** của repo nằm trong một file test, tức
     *    đúng chỗ lượng từ cũ không với tới.
     */
    // ★★ M-2: phạm vi nay là **BỐN CÂY** (`server` · `client` · `shared` · `scripts`) — xem khối
    //    lý lẽ ở chỗ khai `MOI_FILE_BON_CAY`. Cầu chì: tập phải lớn hơn tập `server/**`, nếu không
    //    thì `moiFileDuoi` đã mù với ba cây kia và ô này rộng ra chỉ trên giấy.
    expect(
      MOI_FILE_BON_CAY.length,
      "tập bốn cây KHÔNG lớn hơn tập `server/**` ⇒ `moiFileDuoi` mù với `client`/`shared`/`scripts`",
    ).toBeGreaterThan(MOI_FILE_SERVER.length);
    const pham = MOI_FILE_BON_CAY.filter((f) =>
      moiDuongNhap(f).some((s) => s === "otplib" || s.startsWith("otplib/")),
    ).map((f) => f.duong);
    expect(
      pham.join(" · "),
      "một thư viện TOTP thứ hai trong `server`/`client`/`shared`/`scripts` ⇒ một đường xác minh NGOÀI sổ (mã sản xuất), hoặc\n" +
        "một khuôn mẫu dùng thư viện bị cấm ĐƯỢC MỘT LƯỚI XANH CHỨNG THỰC (mã test) — cả hai đều là\n" +
        "đường để đường xác minh thứ hai quay lại. Dùng `speakeasy` + `verifyTotpOnce`.",
    ).toBe("");
  });

  it("★★★ ∀ file gọi `verifyTotpOnce`: nó PHẢI nhập hàm ấy từ chính `_core/totpOnce`", () => {
    /**
     * ⚠ Không có ô này thì ai đó khai một hàm **trùng tên** ở file của mình là lách được cả hai ô
     * trên: `.totp.verify` không xuất hiện, `verifyTotpOnce(...)` có xuất hiện, và mã tiêu được
     * bao nhiêu lần cũng không ai biết. Phép nhận diện module dùng **phép nối đường dẫn** (bài học
     * R1b): `"./totpOnce"` và `"../_core/totpOnce"` là **một** module.
     */
    const thieu: string[] = [];
    for (const f of SAN_XUAT) {
      if (f.duong === TEN_SO || loiGoiSo(f).length === 0) continue;
      if (!moiDuongNhap(f).some((s) => phanGiaiToi(f.that, s, FILE_SO))) thieu.push(f.duong);
    }
    expect(thieu.join(" · "), "gọi `verifyTotpOnce` mà KHÔNG nhập nó từ `_core/totpOnce` ⇒ một hàm TRÙNG TÊN đang giả làm sổ").toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. ★★★ ĐIỀU KIỆN MÀ SỔ TRONG BỘ NHỚ ĐỨNG TRÊN — CANH THEO **AI GỌI**, KHÔNG THEO **AI NẠP**
//
// ⚠⚠⚠ ĐO ĐƯỢC, VÀ NÓ BÁC BỎ PHÉP CANH TRỰC GIÁC: bao đóng nhập (đệ quy, tĩnh + động) từ
// `server/worker.ts` gồm **520 file** và **CÓ** `server/_core/trpc.ts`. Tức luật *"module xác minh
// TOTP không với tới được từ worker"* **SAI SỰ THẬT** — worker **NẠP** `trpc.ts`, nó chỉ không bao
// giờ **KÍCH HOẠT** một middleware nào vì không request nào tới (`_core/index.ts:118-123` `return`
// trước mọi thiết lập express; `worker.ts` không dựng express).
//
// ⇒ Luật đúng đứng trên **BỀ MẶT REQUEST**: một lượt xác minh chỉ khởi động được từ một request.
//
//   ***∀ file sản xuất gọi `verifyTotpOnce`: nó phải là MỘT BỀ MẶT REQUEST — module tRPC
//   (`_core/trpc.ts` hoặc file nhập từ nó), hoặc một file đăng ký route express.***
//
// Một lượt gọi bò vào một dịch vụ nền / cron / worker ⇒ ĐỎ, vì lúc ấy sẽ có **HAI cuốn sổ** trong
// hai tiến trình và phép chống phát lại mất hiệu lực — âm thầm.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** File này có đăng ký route express không (`<x>.get/post/put/patch/delete("/…", …)`)? */
function dangKyRouteExpress(f: FileNguon): boolean {
  let co = false;
  const VERB = new Set(["get", "post", "put", "patch", "delete", "use", "all"]);
  const di = (n: ts.Node): void => {
    if (co) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && VERB.has(n.expression.name.text)) {
      const a0 = n.arguments[0];
      if (a0 !== undefined && ts.isStringLiteral(a0) && a0.text.startsWith("/") && n.arguments.length >= 2) co = true;
    }
    ts.forEachChild(n, di);
  };
  di(f.sf);
  return co;
}

describe("★★★ Task 6 — sổ trong bộ nhớ: điều kiện của nó ĐƯỢC CANH", () => {
  it("★★★ ∀ file gọi `verifyTotpOnce`: nó là một BỀ MẶT REQUEST (tRPC hoặc route express)", () => {
    const ngoai: string[] = [];
    for (const f of SAN_XUAT) {
      if (f.duong === TEN_SO || loiGoiSo(f).length === 0) continue;
      const laTrpc = f.that === CORE_TRPC || moiDuongNhap(f).some((s) => phanGiaiToi(f.that, s, CORE_TRPC));
      if (!laTrpc && !dangKyRouteExpress(f)) ngoai.push(f.duong);
    }
    expect(
      ngoai.join(" · "),
      "một lượt xác minh TOTP khởi động được NGOÀI đường request ⇒ nó chạy được ở tiến trình worker ⇒ HAI cuốn sổ ⇒ phát lại mở lại. Lời giải đúng lúc ấy: chuyển sổ xuống DB (cần DDL — hỏi chủ dự án)",
    ).toBe("");
  });

  it("★★★ file sổ tự khai điều kiện ấy TRONG MÃ, không chỉ trong tài liệu", () => {
    /**
     * ⚠ *"Hàng rào không ai canh"*: một lượt gọi ở tiến trình worker phải **fail-closed + kêu**,
     * không được im lặng mở một cuốn sổ thứ hai. Ô này canh chính cái chốt ấy còn sống.
     */
    const ma = readFileSync(FILE_SO, "utf8");
    expect(ma, "mất chốt `ROLE=worker` ⇒ điều kiện của sổ quay về một câu trong tài liệu").toContain('!== "worker"');
    expect(ma, "chốt phải đọc `process.env.ROLE`, không đọc một cờ khác").toContain("process.env.ROLE");
    expect(ma, "chốt phải KÊU, không im lặng").toContain("console.error");
  });
});
