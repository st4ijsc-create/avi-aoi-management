/**
 * ★★★ Pha 6 Task 1b — **SIẾT NỐT: MỌI thủ tục `deployProcedure` phải mang OTP của CHÍNH lượt ấy.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI — MỘT LÝ DO HOÃN **SAI SỰ THẬT** ĐÃ ĐỂ LỖ M-4 SỐNG THÊM MỘT TASK
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 1 (`ffa1d76a`) siết `requirePerCallFreshTotp` cho **hai** lệnh phá huỷ VRAM và **hoãn** năm
 * thủ tục còn lại, biện hộ bằng: *"`deployToFleet` chạy 200 máy, `deployBuild` gọi tuần tự từng máy
 * ⇒ siết toàn cục sẽ gãy giữa chừng"*. Lượt review Task 1 **bác bỏ** luận cứ ấy bằng phép đọc mã:
 * vòng lặp fleet nằm **TRONG MÁY CHỦ, trong MỘT request tRPC** (`fleetRollout.ts` →
 * `programmingService` — **lời gọi hàm**, không qua middleware), client gọi **đúng một lần**, và
 * **5/5** điểm gọi client đã bọc `stepUp.guard` + đã gửi `totpCode`. Rào cản **KHÔNG TỒN TẠI**.
 *
 * Hậu quả **đo được** của việc hoãn: một lượt VRAM có OTP **hâm nóng cache dùng chung**
 * (`stepUpVerifiedUntil`, 10 phút/`sessionToken`), nên ngay sau `vram.preempt` thì
 * `programming.deployBuild` chạy **10 phút không hỏi mã** — và ngược lại. Đóng hai đầu mà để hở
 * năm đầu kia thì cache vẫn là **một cửa chung**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐẢO LƯỢNG TỪ — PHÉP SIẾT NẰM Ở **GỐC**, KHÔNG PHẢI Ở BẢY CHỖ CHAIN TAY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bất biến của task này **không** liệt kê năm cái tên. Nó nói:
 *
 *   ***∀ thủ tục có chuỗi bắt nguồn từ `deployProcedure` (`server/_core/trpc.ts`): MỌI lượt gọi
 *   PHẢI mang một `totpCode` verify được TẠI THỜI ĐIỂM ẤY. Không lượt nào qua được bằng trạng
 *   thái mà một lượt KHÁC để lại.***
 *
 * Cách duy nhất làm câu ấy đúng **theo CẤU TẠO** (chứ không theo trí nhớ của người sửa sau) là
 * chain `requirePerCallFreshTotp` vào **chính `deployProcedure`**. Chain tay ở bảy điểm gọi là một
 * **DANH SÁCH**, và lớp lỗi *"danh sách nào cũng có phần tử thứ N+1"* đã tái diễn **13** lần trong
 * dự án này (riêng Pha 6 thêm **ba**). Xem `task-1b-report.md` Bước 6.
 *
 * ⇒ Vì phép siết ở gốc, **phép thử M3** (*"thủ tục MỚI, chain `deployProcedure`, trong FILE MỚI"*)
 *   không cần ai nhớ cập nhật gì: `deployMoi` bên dưới **là** một thủ tục như thế, khai báo ngay
 *   trong file test này, và nó bị chặn **không cần một dòng cấu hình nào**.
 *
 * ⚠⚠ **LƯỚI ĐI THEO ĐƯỜNG THOÁT, KHÔNG THEO FILE.** Không ca nào giả `requireFreshTotp`,
 * `requirePerCallFreshTotp`, `requirePermission` hay `speakeasy`. Năm thủ tục được gọi qua
 * **`createCaller` của CHÍNH `programmingRouter` / `orchestrationRouter` sản xuất**, cache được hâm
 * bằng một lượt gọi **THẬT** với OTP **THẬT** sinh bằng `speakeasy` trên một secret **THẬT** trong
 * bảng `users`.
 *
 * ⚠ **ĐỐI CHỨNG DƯƠNG là điều kiện tồn tại của lưới này**: không có nó thì một bản vá **chặn hết**
 * cũng xanh — lớp lỗi đã để `215/215` xanh suốt thời gian một tool luôn `PERMISSION_DENIED`.
 * ⚠ **KHÔNG BẮT NHẦM**: `actuationProcedure` (sàn **không** phải deploy) phải **KHÔNG** bị kéo vào
 * cổng OTP — phép siết chỉ thu hẹp đúng nhánh `deployProcedure`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import speakeasy from "speakeasy";
import { z } from "zod";

// Middleware kiểm toán ghi DB fire-and-forget cho MỌI mutation — tắt trước khi `trpc.ts` nạp.
// `LICENSE_MODULE_GATE_ENABLED=false`: cổng license chạy SAU cổng OTP nhưng TRƯỚC `requirePermission`;
// bật nó thì một ca "bị chặn" có thể xanh vì **lý do sai**.
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { router, deployProcedure, actuationProcedure } from "../_core/trpc";
import { programmingRouter } from "./programmingRouter";
import { orchestrationRouter } from "./orchestrationRouter";
import { permissions, users } from "../../drizzle/schema";
import { readAppErrorMeta } from "../_core/appError";

const SUP_ID = 4242;
const supervisor = { id: SUP_ID, role: "supervisor", name: "Sup", twoFactorEnabled: true };

/** Secret 2FA THẬT — `verifyFreshTotp` chạy `speakeasy.totp.verify` nguyên bản trên nó. */
const SECRET_2FA = "K52U24CYJRNTQSKMG47FKUSHKFKUQW2D";
/** OTP **của lượt gọi này**. Sinh mới mỗi lần để không ô nào phụ thuộc một chuỗi cứng. */
const otp = (): string => speakeasy.totp({ secret: SECRET_2FA, encoding: "base32" });

/**
 * ⚠ `FakeDb.select(projection)` **bỏ qua** projection và trả **hàng thô**, nên hàng phải mang CẢ
 * hai hình dạng: bí danh mà `verifyFreshTotp` đọc (`secret`/`enabled`) và tên thuộc tính schema.
 * Đổi bí danh ở `_core/trpc.ts` mà quên chỗ này ⇒ verify trả `false` ⇒ **đối chứng dương ĐỎ**
 * (hỏng theo chiều AN TOÀN, không im lặng).
 */
function seedNguoiDung2FA(): void {
  fake.seed(users, [
    { id: SUP_ID, secret: SECRET_2FA, enabled: true, twoFactorSecret: SECRET_2FA, twoFactorEnabled: true },
  ]);
}

/**
 * Cấp đúng bit mà cả 5 thủ tục đòi (`machine_control/canCreate`). ⚠ Cần thiết cho **đối chứng
 * dương**: `requirePermission` chạy **SAU** cổng OTP, nên thiếu bit thì một lượt có OTP đúng sẽ
 * dừng ở `PERMISSION_DENIED` và ta không phân biệt được "qua cổng OTP" với "chưa tới cổng OTP".
 */
function capQuyen(): void {
  fake.seed(permissions, [
    {
      id: 900,
      userId: SUP_ID,
      category: "machine_control",
      moduleName: "machine_control",
      canView: true,
      canCreate: true,
      canEdit: false,
      canDelete: false,
      canExport: false,
      expiresAt: null,
    },
  ]);
}

/**
 * ⚠ MỖI ca một `sessionToken` RIÊNG. `stepUpVerifiedUntil` là một `Map` cấp module **không có
 * đường xoá** — dùng chung một khoá thì ca sau thừa hưởng cache của ca trước và mọi khẳng định
 * "cache nguội" thành vô nghĩa.
 */
let demPhien = 0;
const phienMoi = (): string => `pha6-task1b-sess-${++demPhien}`;
const ctxCua = (phien: string, user: unknown = supervisor) =>
  ({ user, req: { ip: "127.0.0.1", headers: {} }, res: {}, sessionToken: phien }) as never;

/**
 * **THỦ TỤC MỚI, CHAIN `deployProcedure`, TRONG MỘT FILE MỚI** — đây chính là **phép thử M3** của
 * kế hoạch, và nó cũng là **cái bơm** hâm nóng cache phiên. Nó dùng **chính** `deployProcedure`
 * export từ `_core/trpc.ts`, nên nó chia sẻ **đúng** middleware và **đúng** `Map` cache của mã
 * sản xuất. Không một dòng cấu hình nào ở đây khai nó với phép siết — nếu phép siết nằm ở gốc thì
 * nó **tự** được che.
 */
const routerMoi = router({
  deployMoi: deployProcedure
    .input(z.object({ totpCode: z.string().max(16).optional() }))
    .mutation(() => ({ ok: true as const })),
  /**
   * KHÔNG BẮT NHẦM — cùng file, cùng sàn quyền, nhưng đứng trên `actuationProcedure` (**không**
   * phải `deployProcedure`). Nó phải **giữ nguyên** hành vi cũ: không đòi OTP.
   */
  actuationKhac: actuationProcedure
    .input(z.object({ totpCode: z.string().max(16).optional() }))
    .mutation(() => ({ ok: true as const })),
});

const moi = (phien: string) => routerMoi.createCaller(ctxCua(phien));

/** Lỗi của một lượt gọi, hoặc `null` nếu nó **không** ném. */
async function loiCua(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

/** Lượt gọi có bị chặn ở **đúng cổng OTP** không (chứ không phải ở license/quyền/zod)? */
function chanBoiCongOtp(e: unknown): boolean {
  const m = readAppErrorMeta(e) as { appCode?: string; appParams?: { field?: string } } | null;
  return m?.appCode === "INVALID_VALUE" && m?.appParams?.field === "twoFactorCode";
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẬP BỊ CANH — SUY RA TỪ MÃ NGUỒN, KHÔNG CHÉP TAY
//
// ***∀ thủ tục trong `server/routers/**` mà chuỗi của nó bắt nguồn (trực tiếp hay qua biến trung
//   gian) từ `deployProcedure` nhập từ `_core/trpc`.***
//
// ⚠ Bộ suy này **không** hỏi thủ tục có chain `requirePerCallFreshTotp` hay không — hỏi thế là
//   quay lại canh một danh sách. Nó chỉ hỏi *"có bắt nguồn từ `deployProcedure` không"*, rồi phần
//   hành vi bên dưới **gọi thật** từng cái để chứng minh cổng OTP đóng.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/routers
const CORE_TRPC = join(TEST_DIR, "..", "_core", "trpc.ts");
/** Tên phép siết per-call (`_core/trpc.ts`) — thứ mà **gốc** `deployProcedure` phải chain. */
const TEN_PHEP_SIET = "requirePerCallFreshTotp";
/** Tên thủ tục gốc mà `_core/trpc.ts` export. */
const TEN_SAN_DEPLOY = "deployProcedure";

/** Định danh TRÁI NHẤT của một chuỗi truy cập (`a.use(x).input(y)` → `a`). */
function gocChuoi(n: ts.Node | undefined): string | null {
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

interface ThuTucDeploy {
  /** Tên file router (vd `programmingRouter.ts`). */
  readonly file: string;
  /** Tên thủ tục trong `router({ … })`. */
  readonly ten: string;
}

/**
 * Quét MỘT file router: trả các thủ tục có chuỗi bắt nguồn từ `deployProcedure` của `_core/trpc`.
 * ⚠ Bí danh nhập (`deployProcedure as deployBase`) được theo dõi bằng **tên cục bộ**, nên đổi tên
 * khi nhập không làm thủ tục rơi khỏi lượng từ.
 */
function thuTucDeployCuaFile(ten: string, ma: string): { ra: ThuTucDeploy[]; mu: string[] } {
  const sf = ts.createSourceFile(ten, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const mu: string[] = [];

  /** Tên CỤC BỘ đang trỏ tới `deployProcedure` của `_core/trpc` (kể cả bí danh). */
  const goc = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!/_core\/trpc$/.test(st.moduleSpecifier.text)) continue;
    const nb = st.importClause?.namedBindings;
    if (nb === undefined || !ts.isNamedImports(nb)) continue;
    for (const el of nb.elements) {
      const tenXuat = el.propertyName?.text ?? el.name.text;
      if (tenXuat === TEN_SAN_DEPLOY) goc.add(el.name.text);
    }
  }
  if (goc.size === 0) return { ra: [], mu };

  /** `const X = <expr>` ở cấp file → gốc chuỗi của `<expr>`. */
  const bien = new Map<string, string | null>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
      bien.set(d.name.text, gocChuoi(d.initializer));
    }
  }

  /** Leo ngược chuỗi biến cho tới khi chạm một tên trong `goc`, hoặc hết đường. */
  const batNguonTuDeploy = (bd: string | null): boolean => {
    let cur = bd;
    for (let i = 0; i < 16 && cur !== null; i++) {
      if (goc.has(cur)) return true;
      if (!bien.has(cur)) return false;
      cur = bien.get(cur) ?? null;
    }
    return false;
  };

  const ra: ThuTucDeploy[] = [];
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
          mu.push(`${ten}:${dong} — ô của router KHÔNG phải \`tên: <chuỗi thủ tục>\``);
          continue;
        }
        if (batNguonTuDeploy(gocChuoi(p.initializer))) ra.push({ file: ten, ten: p.name.text });
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { ra, mu };
}

/** MỌI file router sản xuất (không phải test, không phải helper `__*`). */
const FILE_ROUTER = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("__"))
  .sort();

const QUET = FILE_ROUTER.map((f) => thuTucDeployCuaFile(f, readFileSync(join(TEST_DIR, f), "utf8")));
const O_MU = QUET.flatMap((q) => q.mu);
const DEPLOY_THU_TUC: readonly ThuTucDeploy[] = QUET.flatMap((q) => q.ra);

/**
 * Router mà lưới này **nạp được** và gọi thật. ⚠ Đây là một sự thật của **bộ đồ nghề test** (file
 * nào import được), **không** phải một danh sách thủ tục — thêm một thủ tục deploy vào hai file
 * này thì nó **tự** vào lượng từ hành vi bên dưới.
 */
const CALLER: Record<string, (phien: string) => Record<string, (i: unknown) => Promise<unknown>>> = {
  "programmingRouter.ts": (phien) =>
    programmingRouter.createCaller(ctxCua(phien)) as unknown as Record<string, (i: unknown) => Promise<unknown>>,
  "orchestrationRouter.ts": (phien) =>
    orchestrationRouter.createCaller(ctxCua(phien)) as unknown as Record<string, (i: unknown) => Promise<unknown>>,
};

/**
 * File router có thủ tục deploy nhưng được **một lưới KHÁC** chứng minh về hành vi. ⚠ Không phải
 * một cửa miễn trừ: ca `★★★ mọi file có thủ tục deploy đều được MỘT lưới nào đó phủ` bắt buộc file
 * lưới ấy **tồn tại trên đĩa** và **gọi đích danh** từng thủ tục.
 */
const PHU_O_LUOI_KHAC: Record<string, string> = {
  "vramRouter.ts": "vramStepUpFreshness.test.ts",
};

/** Các thủ tục deploy mà lưới NÀY gọi thật. */
const GOI_DUOC = DEPLOY_THU_TUC.filter((t) => t.file in CALLER);

/** Gọi một thủ tục deploy **theo tên**, trên đúng router của nó. */
function goi(phien: string, t: ThuTucDeploy, input: unknown): Promise<unknown> {
  const c = CALLER[t.file];
  if (c === undefined) return Promise.reject(new Error(`không có caller cho ${t.file}`));
  const f = c(phien)[t.ten];
  if (typeof f !== "function") return Promise.reject(new Error(`${t.file} không có mutation \`${t.ten}\``));
  return f(input);
}

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  seedNguoiDung2FA();
  capQuyen();
  process.env.ACTUATION_STEPUP_2FA = "true";
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 0. CẦU CHÌ — một tập rỗng làm MỌI khẳng định dưới thành chân lý rỗng
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Pha 6 Task 1b — cầu chì của lượng từ", () => {
  it("★★★ bộ suy đọc được mọi router: 0 ô mù, và tập thủ tục deploy KHÔNG rỗng", () => {
    expect(O_MU.join("\n"), "một ô không phân giải được là một ô KHÔNG AI CANH").toBe("");
    expect(FILE_ROUTER.length, "không đọc được file router nào — bộ quét hỏng").toBeGreaterThanOrEqual(20);
    // ⚠ GHIM SỐ: 5 (programming ×4 + orchestration ×1) + 2 (vram) = 7. Một thủ tục deploy thứ 8
    //   **được che tự động** (phép siết ở gốc), nhưng con số này ĐỎ ⇒ nó là một **quyết định phải
    //   nói ra**, không phải một lượt trôi im lặng.
    expect(
      DEPLOY_THU_TUC.map((t) => `${t.file}#${t.ten}`).sort().join(" · "),
      "danh sách thủ tục đứng trên `deployProcedure` đã đổi",
    ).toBe(
      [
        "orchestrationRouter.ts#deployWorkflow",
        "programmingRouter.ts#approveDeployment",
        "programmingRouter.ts#deployBuild",
        "programmingRouter.ts#deployToFleet",
        "programmingRouter.ts#rollbackDeployment",
        "vramRouter.ts#preempt",
        "vramRouter.ts#releaseStale",
      ].join(" · "),
    );
    expect(GOI_DUOC.length, "lưới này phải gọi THẬT được 5 thủ tục — 0 ⇒ mọi ca ∀ là chân lý rỗng").toBe(5);
  });

  it("★★★ mọi file có thủ tục deploy đều được MỘT lưới nào đó phủ về HÀNH VI", () => {
    for (const t of DEPLOY_THU_TUC) {
      const luoiKhac = PHU_O_LUOI_KHAC[t.file];
      if (t.file in CALLER) continue;
      expect(luoiKhac, `\`${t.file}#${t.ten}\` không được lưới nào gọi thật`).toBeDefined();
      const p = join(TEST_DIR, luoiKhac as string);
      expect(existsSync(p), `lưới phủ \`${t.file}\` phải TỒN TẠI: ${luoiKhac}`).toBe(true);
      // …và nó phải gọi ĐÍCH DANH thủ tục ấy, không chỉ tồn tại.
      expect(readFileSync(p, "utf8"), `${luoiKhac} phải nhắc đích danh \`${t.ten}\``).toContain(t.ten);
    }
  });

  it("★★★ cầu chì — cờ `ACTUATION_STEPUP_2FA` ĐANG BẬT và OTP thật verify được qua ĐƯỜNG THẬT", async () => {
    await expect(moi(phienMoi()).deployMoi({ totpCode: otp() })).resolves.toEqual({ ok: true });
    const e = await loiCua(moi(phienMoi()).deployMoi({}));
    expect(chanBoiCongOtp(e), "phiên nguội + không OTP ⇒ phải bị chặn ở cổng OTP").toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. BẤT BIẾN CHÍNH — ∀ thủ tục deploy: OTP của một lượt KHÁC KHÔNG mở được cửa
//
// ⚠ **NĂM CA ĐỎ RIÊNG, KHÔNG PHẢI MỘT.** `it.each` để mỗi thủ tục **tự chứng minh** nó đóng; một
//   ca gộp `for` sẽ dừng ở cái đầu tiên đỏ và bốn cái sau không ai biết trạng thái.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Task 1b — cache phiên ĐÃ ẤM ⇒ thủ tục deploy KHÔNG OTP vẫn phải BỊ CHẶN", () => {
  it.each(GOI_DUOC.map((t) => [`${t.file}#${t.ten}`, t] as const))(
    "★★★ %s — step-up ở một thủ tục `deployProcedure` KHÁC ⇒ lượt này KHÔNG `totpCode` phải bị chặn ở cổng OTP",
    async (_nhan, t) => {
      const phien = phienMoi();
      // Nhịp 1 — một lượt step-up HỢP LỆ ở một thủ tục `deployProcedure` KHÁC, CÙNG phiên.
      //   ⚠ Đây là cái **hâm nóng `stepUpVerifiedUntil`** — đúng cơ chế đã đo được ở nghiệm thu sống.
      await expect(moi(phien).deployMoi({ totpCode: otp() })).resolves.toEqual({ ok: true });

      // Nhịp 2 — CÙNG phiên, trong 10 phút, thủ tục deploy **không** kèm OTP.
      const e = await loiCua(goi(phien, t, {}));
      expect(
        chanBoiCongOtp(e),
        `\`${t.ten}\` qua được step-up bằng OTP của một lượt KHÁC — M-4 còn sống ở thủ tục này`,
      ).toBe(true);
    },
  );

  it("★★★ hai lượt deploy liên tiếp: OTP của lượt THỨ NHẤT không mở cửa cho lượt THỨ HAI", async () => {
    const phien = phienMoi();
    await expect(moi(phien).deployMoi({ totpCode: otp() })).resolves.toEqual({ ok: true });
    const e = await loiCua(moi(phien).deployMoi({}));
    expect(chanBoiCongOtp(e)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. ĐỐI CHỨNG DƯƠNG — "chặn hết" cũng là xanh nếu không có mục này
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ ĐỐI CHỨNG DƯƠNG — lượt CÓ OTP hợp lệ VẪN QUA cổng OTP", () => {
  it.each(GOI_DUOC.map((t) => [`${t.file}#${t.ten}`, t] as const))(
    "★★★ %s — OTP tươi của CHÍNH lượt ấy ⇒ đi QUA cổng OTP (dừng ở zod, KHÔNG ở `twoFactorCode`)",
    async (_nhan, t) => {
      const e = await loiCua(goi(phienMoi(), t, { totpCode: otp() }));
      expect(e, "`{totpCode}` thiếu mọi trường bắt buộc ⇒ phải dừng ở zod, không được thành công").not.toBeNull();
      expect(
        chanBoiCongOtp(e),
        `\`${t.ten}\` bị chặn ở cổng OTP dù OTP hợp lệ — phép siết đang CHẶN HẾT`,
      ).toBe(false);
      expect((e as { code?: string })?.code, `\`${t.ten}\` với OTP hợp lệ phải qua hết middleware`).toBe("BAD_REQUEST");
    },
  );

  it("★★ OTP SAI vẫn bị từ chối (phép siết không biến cổng thành 'có ô totpCode là qua')", async () => {
    const e = await loiCua(moi(phienMoi()).deployMoi({ totpCode: "000000" }));
    expect(chanBoiCongOtp(e)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. PHÉP THỬ M3 + KHÔNG BẮT NHẦM
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ M3 — thủ tục MỚI chain `deployProcedure` trong FILE MỚI: được che TỰ ĐỘNG", () => {
  it("★★★ `deployMoi` (khai ngay trong file test này, 0 dòng cấu hình) — cache ấm ⇒ vẫn bị chặn", async () => {
    /**
     * ⚠⚠⚠ Đây là ô mà **chain tay 7 chỗ** sẽ trượt: một thủ tục deploy mới ở file thứ tám không có
     * ai nhớ thêm `.use(requirePerCallFreshTotp)` cho nó. Vì phép siết nằm ở **gốc**
     * (`deployProcedure` trong `_core/trpc.ts`), ô này xanh **theo cấu tạo**.
     */
    const phien = phienMoi();
    await expect(moi(phien).deployMoi({ totpCode: otp() })).resolves.toEqual({ ok: true });
    expect(chanBoiCongOtp(await loiCua(moi(phien).deployMoi({}))), "thủ tục deploy MỚI phải tự được che").toBe(true);
  });

  it("★★★ BẤT BIẾN CẤU TRÚC — `deployProcedure` ở `_core/trpc.ts` PHẢI chain `requirePerCallFreshTotp`", () => {
    /**
     * ⚠ Ca hành vi ở trên chứng minh *"hôm nay nó đóng"*; ca này neo **cơ chế**: phép siết phải nằm
     * trên **chính khai báo gốc**, không phải rải ở các router. Gỡ nó ra ⇒ ĐỎ ngay cả khi ai đó
     * kịp chain tay đủ 7 chỗ (vì lúc ấy thủ tục thứ 8 lại hở).
     */
    const ma = readFileSync(CORE_TRPC, "utf8");
    const sf = ts.createSourceFile("trpc.ts", ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let chuoi: string | null = null;
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === TEN_SAN_DEPLOY && d.initializer !== undefined) {
          chuoi = d.initializer.getText(sf);
        }
      }
    }
    expect(chuoi, `không tìm thấy khai báo \`${TEN_SAN_DEPLOY}\` ở _core/trpc.ts`).not.toBeNull();
    expect(chuoi as string, `\`${TEN_SAN_DEPLOY}\` phải chain \`${TEN_PHEP_SIET}\` ngay tại GỐC`).toContain(
      TEN_PHEP_SIET,
    );
  });
});

describe("★★★ KHÔNG BẮT NHẦM — phép siết chỉ chạm nhánh `deployProcedure`", () => {
  it("★★★ `actuationProcedure` (KHÔNG phải deploy) giữ NGUYÊN hành vi: không đòi OTP", async () => {
    await expect(moi(phienMoi()).actuationKhac({}), "actuation không phải deploy ⇒ không cổng OTP").resolves.toEqual({
      ok: true,
    });
  });

  it("★★ cờ TẮT ⇒ pass-through hoàn toàn (phép siết KHÔNG tự bật step-up ở deployment chưa bật cờ)", async () => {
    const truoc = process.env.ACTUATION_STEPUP_2FA;
    process.env.ACTUATION_STEPUP_2FA = "false";
    try {
      await expect(moi(phienMoi()).deployMoi({})).resolves.toEqual({ ok: true });
    } finally {
      if (truoc === undefined) delete process.env.ACTUATION_STEPUP_2FA;
      else process.env.ACTUATION_STEPUP_2FA = truoc;
    }
  });

  it("★★ mặt ĐỌC (`query`) của cùng router không bị kéo vào cổng OTP", async () => {
    // `listProjects` là `query` — middleware step-up bỏ qua mọi `type !== "mutation"`.
    const e = await loiCua(
      (programmingRouter.createCaller(ctxCua(phienMoi())) as unknown as Record<string, (i: unknown) => Promise<unknown>>)
        .listProjects?.({}) ?? Promise.resolve(null),
    );
    expect(chanBoiCongOtp(e), "một `query` không được đòi OTP tươi").toBe(false);
  });
});
