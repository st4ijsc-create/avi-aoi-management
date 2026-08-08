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
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import speakeasy from "speakeasy";
import { z } from "zod";
import {
  quetThuTucDeploy,
  moiFileDuoi,
  phanGiaiToi,
  gocChuoi,
  TEN_PHEP_SIET,
  TEN_SAN_DEPLOY,
  type ThuTucDeploy,
} from "./deployProcedureScan";

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
/**
 * ★★★ Pha 7 Task 5 (A) — sổ mã đã tiêu đi xuống **DB THẬT** (`totp_consumed`); mọi bảng
 * khác giữ `FakeDb`. Xem `./__totpDbHybrid` để biết vì sao KHÔNG dạy `FakeDb` làm bảng ấy.
 */
vi.mock("../db/connection", () => ({
  /**
   * ⚠⚠ **MỌI THỨ LÀM LƯỜI, KHÔNG LÀM Ở THÂN FACTORY.** `vi.mock` được HOIST lên đầu file; một
   * lượt `await orig()` **ngay trong factory** kéo `../db/connection` thật vào **trước khi**
   * `const fake = new FakeDb()` kịp chạy ⇒ `ReferenceError: Cannot access '__vi_import_N__'
   * before initialization`. Đẩy hết vào thân `getDb` (chỉ chạy khi có người gọi) là đúng khuôn
   * bản gốc, và là thứ giữ cho thứ tự nạp không thành một điều kiện ngầm.
   */
  getDb: vi.fn(async () => {
    const { soHonHop } = await import("./__totpDbHybrid");
    const that = await vi.importActual<typeof import("../db/connection")>("../db/connection");
    return soHonHop(fake, await that.getDb());
  }),
}));

/**
 * ★★★ Pha 6 Task 6 — sổ mã OTP đã tiêu; xem lý lẽ ở `beforeEach`.
 *
 * ⚠⚠ **NHẬP SAU KHỐI `vi.mock`, KHÔNG TRƯỚC.** Từ Pha 7, `_core/totpOnce` chạm
 * `../db/connection`; nhập nó ở **ĐẦU file** làm mock của `../db/connection` được dựng **trước
 * khi** `const fake = new FakeDb()` kịp chạy ⇒ `ReferenceError: Cannot access '__vi_import_N__'
 * before initialization`. Thứ tự nhập ở đây là một **ĐIỀU KIỆN**, không phải thẩm mỹ.
 */
import { __resetSoTotpChoTest } from "../_core/totpOnce";
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
  // ⚠ I-4: `totpCode` **BẮT BUỘC**, y hệt hình dạng sản xuất sau lượt vá — một phép thử M3 khai
  //   lỏng hơn cái nó mô phỏng thì nó thôi mô phỏng cái ấy.
  deployMoi: deployProcedure
    .input(z.object({ totpCode: z.string().max(16) }))
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

/**
 * Payload **thiếu `totpCode`** — hình dạng của một người gọi **TỪ DÂY** (HTTP/JSON), thứ `tsc`
 * không ràng buộc được. ⚠ I-4 (review Task 1b) làm `totpCode` **bắt buộc** ở **hợp đồng** zod, và
 * đó là chỗ `tsc` bắt được lượt gỡ mã khỏi một điểm gọi client. Nhưng cổng an ninh thật phải đứng
 * vững trước một payload **thô** — nên các ca dưới đây cố ý đi vòng qua kiểu, thay vì nới zod lại.
 */
function tuDay<T>(v: T): T & { totpCode: string } {
  return v as T & { totpCode: string };
}

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
// ***∀ thủ tục trong `server/**` (ĐỆ QUY) mà chuỗi của nó bắt nguồn (trực tiếp hay qua bao nhiêu
//   biến trung gian cũng được) từ `deployProcedure` của `server/_core/trpc.ts`.***
//
// ⚠ Bộ suy này **không** hỏi thủ tục có chain `requirePerCallFreshTotp` hay không — hỏi thế là
//   quay lại canh một danh sách. Nó chỉ hỏi *"có bắt nguồn từ `deployProcedure` không"*, rồi phần
//   hành vi bên dưới **gọi thật** từng cái để chứng minh cổng OTP đóng.
//
// ⚠⚠ I-2 (review Task 1b) — **BẢN ĐẦU CHẶN TRONG MỘT DANH SÁCH FILE.** Nó quét
// `readdirSync(server/routers)` (**không** đệ quy) và nhận module bằng regex `/_core\/trpc$/`.
// Đột biến **R1b**: cùng thủ tục ấy đặt ở `server/_core/systemRouter.ts` (ngoài `server/routers/`,
// nhập bằng `"./trpc"`) ⇒ **68/68 XANH HẾT**. Bộ suy nay ở `deployProcedureScan.ts`: duyệt **đệ
// quy** toàn `server/**` và hỏi module bằng **phép phân giải đường dẫn**, không bằng chính tả.
//
// ⚠ Lượt đệ quy ấy bắt thêm **hai** thủ tục mà bản cũ mù: `deployMoi` (ngay file này) và
//   `deployKhac` (`vramStepUpFreshness.test.ts`) — **phép thử M3 của chính hai lưới**, không phải
//   bề mặt sản phẩm. Bộ suy **tách hai tập** (`thuTuc` ↔ `thuTucTest`) thay vì bỏ im lặng, và cầu
//   chì (3) của nó giữ cho phép tách ấy đúng **theo cấu tạo**: một file sản xuất nhập được một
//   `*.test.ts` ⇒ ô mù ⇒ ĐỎ. Xem docstring §PHÂN ĐÔI của `deployProcedureScan.ts`.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/routers
const GOC_REPO = join(TEST_DIR, "..", "..");
const CORE_TRPC = join(GOC_REPO, "server", "_core", "trpc.ts");

const QUET = quetThuTucDeploy(GOC_REPO);
const O_MU: readonly string[] = QUET.mu;
/** Bề mặt **sản phẩm** — thủ tục deploy khai trong file KHÔNG phải `*.test.ts`. */
const DEPLOY_THU_TUC: readonly ThuTucDeploy[] = QUET.thuTuc;
/** Thủ tục deploy khai **trong một lưới** — phép thử M3; cầu chì, không phải bề mặt. */
const DEPLOY_TRONG_LUOI: readonly ThuTucDeploy[] = QUET.thuTucTest;

/**
 * Router mà lưới này **nạp được** và gọi thật. ⚠ Đây là một sự thật của **bộ đồ nghề test** (file
 * nào import được), **không** phải một danh sách thủ tục — thêm một thủ tục deploy vào hai file
 * này thì nó **tự** vào lượng từ hành vi bên dưới.
 */
const CALLER: Record<string, (phien: string) => Record<string, (i: unknown) => Promise<unknown>>> = {
  "server/routers/programmingRouter.ts": (phien) =>
    programmingRouter.createCaller(ctxCua(phien)) as unknown as Record<string, (i: unknown) => Promise<unknown>>,
  "server/routers/orchestrationRouter.ts": (phien) =>
    orchestrationRouter.createCaller(ctxCua(phien)) as unknown as Record<string, (i: unknown) => Promise<unknown>>,
};

/**
 * File router có thủ tục deploy nhưng được **một lưới KHÁC** chứng minh về hành vi. ⚠ Không phải
 * một cửa miễn trừ: ca `★★★ mọi file có thủ tục deploy đều được MỘT lưới nào đó phủ` bắt buộc file
 * lưới ấy **tồn tại trên đĩa** và **gọi đích danh** từng thủ tục.
 */
const PHU_O_LUOI_KHAC: Record<string, string> = {
  "server/routers/vramRouter.ts": "server/routers/vramStepUpFreshness.test.ts",
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

beforeEach(async () => {
  fake.store.clear();
  resetSeq();
  /**
   * ★★★ Pha 6 Task 6 — **CÁCH LY SỔ MÃ ĐÃ TIÊU.** `speakeasy.totp()` trả **CÙNG một chuỗi 6 số**
   * suốt một nhịp 30 s, nên nhiều ca của file này dùng **đúng một mã**. Sổ chống phát lại
   * (`_core/totpOnce.ts`) là một `Map` cấp module ⇒ không dọn thì ca thứ hai bị từ chối vì **ca
   * thứ nhất đã tiêu mã** — tức đỏ vì một **kịch bản khác**, không vì cái nó đang canh.
   */
  await __resetSoTotpChoTest([SUP_ID]);
  seedNguoiDung2FA();
  capQuyen();
  process.env.ACTUATION_STEPUP_2FA = "true";
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 0. CẦU CHÌ — một tập rỗng làm MỌI khẳng định dưới thành chân lý rỗng
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Pha 6 Task 1b — cầu chì của lượng từ", async () => {
  it("★★★ bộ suy đọc được TOÀN `server/**`: 0 ô mù, và tập thủ tục deploy KHÔNG rỗng", () => {
    expect(O_MU.join("\n"), "một ô không phân giải được là một ô KHÔNG AI CANH").toBe("");
    // ⚠ I-2/R1b — cầu chì VỊ TRÍ: bộ quét phải **đệ quy toàn `server/**`**, không dừng ở
    //   `server/routers/`. Con số này ĐỎ ngay lượt ai đó thu phạm vi quét về một thư mục.
    expect(QUET.soFileDuyet, "bộ quét chỉ thấy vài file — nó đã thôi đệ quy?").toBeGreaterThanOrEqual(1000);
    expect(QUET.ungVien.length, "0 file ứng viên ⇒ mọi khẳng định dưới là chân lý rỗng").toBeGreaterThanOrEqual(3);
    // ⚠ …và nó phải **thật sự** với tới ngoài `server/routers/`: `_core/trpc.ts` là điểm neo, nó
    //   nằm ở `server/_core/`. Nếu ứng viên chỉ toàn `server/routers/**` thì phạm vi đã co lại.
    expect(
      QUET.ungVien.some((f) => !f.startsWith("server/routers/")),
      "không ứng viên nào ngoài `server/routers/` ⇒ bộ quét đã thôi đệ quy (đúng lỗ R1b)",
    ).toBe(true);
    // ⚠ GHIM SỐ: 5 (programming ×4 + orchestration ×1) + 2 (vram) = 7. Một thủ tục deploy thứ 8
    //   **được che tự động** (phép siết ở gốc), nhưng con số này ĐỎ ⇒ nó là một **quyết định phải
    //   nói ra**, không phải một lượt trôi im lặng.
    expect(
      DEPLOY_THU_TUC.map((t) => `${t.file}#${t.ten}`).sort().join(" · "),
      "danh sách thủ tục đứng trên `deployProcedure` đã đổi",
    ).toBe(
      [
        "server/routers/orchestrationRouter.ts#deployWorkflow",
        "server/routers/programmingRouter.ts#approveDeployment",
        "server/routers/programmingRouter.ts#deployBuild",
        "server/routers/programmingRouter.ts#deployToFleet",
        "server/routers/programmingRouter.ts#rollbackDeployment",
        "server/routers/vramRouter.ts#preempt",
        "server/routers/vramRouter.ts#releaseStale",
      ].join(" · "),
    );
    expect(GOI_DUOC.length, "lưới này phải gọi THẬT được 5 thủ tục — 0 ⇒ mọi ca ∀ là chân lý rỗng").toBe(5);
  });

  it("★★★ cầu chì của PHÉP PHÂN ĐÔI — phép thử M3 của cả hai lưới còn SỐNG, và 0 lưới nào bị nhập vào sản xuất", () => {
    /**
     * ⚠⚠ Bộ suy **bỏ** các thủ tục khai trong `*.test.ts` khỏi con số ghim nói về sản phẩm. Phép bỏ
     * ấy chỉ lành khi **hai** điều cùng đúng, và cả hai được ĐO ở đây chứ không được giả định:
     *   (a) chúng vẫn **tồn tại** — nếu ai xoá `deployMoi` đi thì phép thử M3 biến mất, và không ô
     *       nào khác trong file này nói ra điều đó (`deployMoi` chỉ được gọi, không được đếm);
     *   (b) chúng **không với tới được từ dây** — cầu chì (3) của bộ suy (`mu`) canh điều này, và
     *       ô `O_MU` ở ca trên đã ép nó về rỗng.
     */
    expect(
      DEPLOY_TRONG_LUOI.map((t) => `${t.file}#${t.ten}`).sort(),
      "phép thử M3 khai trong lưới đã biến mất ⇒ 'thủ tục deploy MỚI được che tự động' thôi được chứng minh",
    ).toEqual([
      "server/routers/deployStepUpFreshness.test.ts#deployMoi",
      // ⚠ Pha 6 Task 6 — phép thử M3 **thứ ba**, trong lưới chống phát lại. Nó dùng đúng
      //   `deployProcedure` export của `_core/trpc.ts`, nên nó chia sẻ đúng middleware của mã sản
      //   xuất; và nó phải **NÓI RA** ở đây thay vì lặng lẽ nở con số ghim.
      "server/routers/totpReplay.test.ts#deployKhac",
      "server/routers/vramStepUpFreshness.test.ts#deployKhac",
    ]);
    // ⚠ Hai tập phải **rời nhau theo cấu tạo** — một thủ tục vừa là sản phẩm vừa là phép thử là
    //   dấu hiệu phép phân đôi đã hỏng.
    expect(DEPLOY_THU_TUC.filter((t) => DEPLOY_TRONG_LUOI.some((u) => u.file === t.file && u.ten === t.ten))).toEqual([]);
    // ⚠ I-4 — phép thử M3 phải **mô phỏng đúng hình dạng sản xuất**: `totpCode` khai và BẮT BUỘC.
    //   Một fixture khai lỏng hơn cái nó mô phỏng thì nó thôi mô phỏng cái ấy, và ca M3 sẽ chứng
    //   minh một bất biến của một thủ tục **không tồn tại**.
    expect(
      DEPLOY_TRONG_LUOI.filter((t) => !(t.khaiTotp && t.totpBatBuoc)).map((t) => `${t.file}#${t.ten}`).join(" · "),
      "fixture M3 khai `totpCode` LỎNG hơn mã sản xuất ⇒ nó thôi mô phỏng mã sản xuất",
    ).toBe("");
  });

  it("★★★ mọi file có thủ tục deploy đều được MỘT lưới nào đó phủ về HÀNH VI", () => {
    for (const t of DEPLOY_THU_TUC) {
      const luoiKhac = PHU_O_LUOI_KHAC[t.file];
      if (t.file in CALLER) continue;
      expect(luoiKhac, `\`${t.file}#${t.ten}\` không được lưới nào gọi thật`).toBeDefined();
      const p = join(GOC_REPO, luoiKhac as string);
      expect(existsSync(p), `lưới phủ \`${t.file}\` phải TỒN TẠI: ${luoiKhac}`).toBe(true);
      // …và nó phải gọi ĐÍCH DANH thủ tục ấy, không chỉ tồn tại.
      expect(readFileSync(p, "utf8"), `${luoiKhac} phải nhắc đích danh \`${t.ten}\``).toContain(t.ten);
    }
  });

  it("★★★ cầu chì — cờ `ACTUATION_STEPUP_2FA` ĐANG BẬT và OTP thật verify được qua ĐƯỜNG THẬT", async () => {
    await expect(moi(phienMoi()).deployMoi({ totpCode: otp() })).resolves.toEqual({ ok: true });
    const e = await loiCua(moi(phienMoi()).deployMoi(tuDay({})));
    expect(chanBoiCongOtp(e), "phiên nguội + không OTP ⇒ phải bị chặn ở cổng OTP").toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. BẤT BIẾN CHÍNH — ∀ thủ tục deploy: OTP của một lượt KHÁC KHÔNG mở được cửa
//
// ⚠ **NĂM CA ĐỎ RIÊNG, KHÔNG PHẢI MỘT.** `it.each` để mỗi thủ tục **tự chứng minh** nó đóng; một
//   ca gộp `for` sẽ dừng ở cái đầu tiên đỏ và bốn cái sau không ai biết trạng thái.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Task 1b — cache phiên ĐÃ ẤM ⇒ thủ tục deploy KHÔNG OTP vẫn phải BỊ CHẶN", async () => {
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
    const e = await loiCua(moi(phien).deployMoi(tuDay({})));
    expect(chanBoiCongOtp(e)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. ĐỐI CHỨNG DƯƠNG — "chặn hết" cũng là xanh nếu không có mục này
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ ĐỐI CHỨNG DƯƠNG — lượt CÓ OTP hợp lệ VẪN QUA cổng OTP", async () => {
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

describe("★★★ M3 — thủ tục MỚI chain `deployProcedure` trong FILE MỚI: được che TỰ ĐỘNG", async () => {
  it("★★★ `deployMoi` (khai ngay trong file test này, 0 dòng cấu hình) — cache ấm ⇒ vẫn bị chặn", async () => {
    /**
     * ⚠⚠⚠ Đây là ô mà **chain tay 7 chỗ** sẽ trượt: một thủ tục deploy mới ở file thứ tám không có
     * ai nhớ thêm `.use(requirePerCallFreshTotp)` cho nó. Vì phép siết nằm ở **gốc**
     * (`deployProcedure` trong `_core/trpc.ts`), ô này xanh **theo cấu tạo**.
     */
    const phien = phienMoi();
    await expect(moi(phien).deployMoi({ totpCode: otp() })).resolves.toEqual({ ok: true });
    expect(chanBoiCongOtp(await loiCua(moi(phien).deployMoi(tuDay({})))), "thủ tục deploy MỚI phải tự được che").toBe(true);
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ I-1 (review Task 1b) — `requireFreshTotp` LÀ MỘT HÀNG RÀO KHÔNG AI CANH
//
// ⚠⚠⚠ *"AI GỠ NÓ CŨNG KHÔNG THẤY CA NÀO ĐỎ"* **KHÔNG** LÀ LÝ DO ĐỂ KHÔNG CANH — NÓ **CHÍNH LÀ**
// LÝ DO PHẢI CANH. (Pha 5 gặp lớp này hai lần, Pha 6 thêm hai.)
//
// Sau Task 1b, `requireFreshTotp` (cache 10 phút theo `sessionToken`) vẫn **GHI cache mỗi lượt
// deploy thành công**, nhưng cache ấy **không mở được cửa cho ai** — vì điểm dùng **duy nhất** của
// nó là `deployProcedure`, và `deployProcedure` luôn chain `requirePerCallFreshTotp` **ngay sau**.
//
// ⚠ **Kịch bản hỏng, 0 ca đỏ:** ai đó dựng một sàn MỚI
// `adminActuationProcedure = xxx.use(requireFreshTotp)` (một lượt sửa trông hoàn toàn hợp lý — nó
// đang **thêm** một cổng OTP). Sàn ấy thừa hưởng một cache **đã được hâm nóng bởi MỌI lượt deploy
// của phiên** ⇒ **M-4 tái sinh nguyên vẹn ở một chỗ mới**. Docstring `_core/trpc.ts:407-410` cảnh
// báo đúng điều đó bằng **văn xuôi**; không một ca nào đọc câu ấy bằng máy.
//
// ⇒ Bất biến được phát biểu bằng **lượng từ trên TOÀN `server/**`**, không bằng một danh sách file:
//   ***∀ lời gọi `.use(x)` trong `server/**` mà `x` phân giải tới export `requireFreshTotp` của
//   `server/_core/trpc.ts`: CHỈ CÓ ĐÚNG MỘT, và nó nằm trong khai báo `deployProcedure`.***
// ══════════════════════════════════════════════════════════════════════════════════════════════

interface DiemDung {
  /** Đường tương đối gốc repo. */
  readonly file: string;
  readonly dong: number;
  /** Tên khai báo `const` cấp file bao quanh lời gọi `.use(...)`, hoặc `null`. */
  readonly trong: string | null;
}

/**
 * MỌI `.use(x)` trong `server/**` với `x` **là** `requireFreshTotp` của `_core/trpc.ts`.
 * ⚠ Hỏi trên **AST** + **phép phân giải đường dẫn**: một lượt nhập bí danh
 * (`import { requireFreshTotp as rft }`) hay một đường nhập viết khác chính tả (`"./trpc"` vs
 * `"../_core/trpc"`) đều **không** lách được; ngược lại một chuỗi trong **comment** không đếm.
 */
function diemDungCuaCache(goc: string): { diem: DiemDung[]; soFileDoc: number } {
  const CORE = join(goc, "server", "_core", "trpc.ts");
  const diem: DiemDung[] = [];
  const moi = moiFileDuoi(goc, "server", [".ts"]);
  let soFileDoc = 0;

  for (const { duong, that } of moi) {
    const ma = readFileSync(that, "utf8");
    if (!ma.includes("requireFreshTotp")) continue;
    soFileDoc++;
    const sf = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    /** Tên CỤC BỘ trỏ tới export `requireFreshTotp` (kể cả bí danh nhập). */
    const ten = new Set<string>();
    if (that === CORE) ten.add("requireFreshTotp");
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      if (!phanGiaiToi(that, st.moduleSpecifier.text, CORE)) continue;
      const nb = st.importClause?.namedBindings;
      if (nb === undefined || !ts.isNamedImports(nb)) continue;
      for (const el of nb.elements) {
        if ((el.propertyName?.text ?? el.name.text) === "requireFreshTotp") ten.add(el.name.text);
      }
    }
    if (ten.size === 0) continue;

    /** Khai báo `const X = …` cấp file nào bao quanh nút này? */
    const bao = (n: ts.Node): string | null => {
      let cur: ts.Node | undefined = n;
      while (cur !== undefined) {
        if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
        cur = cur.parent;
      }
      return null;
    };

    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "use") {
        const a0 = n.arguments[0];
        if (a0 !== undefined && ts.isIdentifier(a0) && ten.has(a0.text)) {
          diem.push({ file: duong, dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, trong: bao(n) });
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return { diem, soFileDoc };
}

describe("★★★ I-1 — `requireFreshTotp` (cache phiên) có ĐÚNG MỘT điểm dùng, và đó là `deployProcedure`", () => {
  const DUNG = diemDungCuaCache(GOC_REPO);

  it("★★★ cầu chì — bộ suy thật sự ĐỌC được nhiều file (0 file ⇒ 'đúng một điểm dùng' là chân lý rỗng)", () => {
    expect(DUNG.soFileDoc, "không file nào nhắc `requireFreshTotp` ⇒ bộ suy đã mù, không phải mã đã sạch").toBeGreaterThanOrEqual(5);
    expect(DUNG.diem.length, "không thấy lời gọi `.use(requireFreshTotp)` nào — hàng rào đã BIẾN MẤT?").toBeGreaterThan(0);
  });

  it("★★★ ĐÚNG MỘT `.use(requireFreshTotp)` trong toàn `server/**`, và nó nằm trong `deployProcedure`", () => {
    expect(
      DUNG.diem.map((d) => `${d.file}:${d.dong} trong \`${d.trong ?? "?"}\``).join(" · "),
      "một sàn thủ tục THỨ HAI đứng trên cache phiên ⇒ nó thừa hưởng cache đã hâm bởi MỌI lượt deploy ⇒ M-4 tái sinh",
    ).toBe(
      `server/_core/trpc.ts:${DUNG.diem[0]?.dong ?? 0} trong \`${TEN_SAN_DEPLOY}\``,
    );
    expect(DUNG.diem.length, "≠1 điểm dùng").toBe(1);
    expect(DUNG.diem[0]?.trong, "điểm dùng duy nhất phải là khai báo `deployProcedure`").toBe(TEN_SAN_DEPLOY);
  });

  it("★★★ …và chuỗi ấy phải kết thúc bằng `requirePerCallFreshTotp` — thứ tự, không chỉ sự hiện diện", () => {
    /**
     * ⚠ *"Có mặt cả hai"* **chưa đủ**: `actuationProcedure.use(requirePerCallFreshTotp).use(
     * requireFreshTotp)` cũng chứa cả hai tên, nhưng lúc ấy middleware CUỐI là cái **có cache** —
     * và một chuỗi middleware là **giao** của các cổng, nên thứ tự không đổi hành vi ở đây. Cái ca
     * này canh là **hình dạng người sau đọc thấy**: nấc ngoài cùng phải là nấc CHẶT NHẤT, để không
     * ai suy ra "sàn này dùng cache" từ nét chữ.
     */
    const ma = readFileSync(CORE_TRPC, "utf8");
    const sf = ts.createSourceFile("trpc.ts", ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let cuoi: string | null = null;
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== TEN_SAN_DEPLOY || d.initializer === undefined) continue;
        const init = d.initializer;
        if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression)) {
          const a0 = init.arguments[0];
          cuoi = a0 !== undefined ? (gocChuoi(a0) ?? null) : null;
        }
      }
    }
    expect(cuoi, `nấc \`.use()\` NGOÀI CÙNG của \`${TEN_SAN_DEPLOY}\` phải là \`${TEN_PHEP_SIET}\``).toBe(TEN_PHEP_SIET);
  });
});

describe("★★★ KHÔNG BẮT NHẦM — phép siết chỉ chạm nhánh `deployProcedure`", async () => {
  it("★★★ `actuationProcedure` (KHÔNG phải deploy) giữ NGUYÊN hành vi: không đòi OTP", async () => {
    await expect(moi(phienMoi()).actuationKhac({}), "actuation không phải deploy ⇒ không cổng OTP").resolves.toEqual({
      ok: true,
    });
  });

  it("★★ cờ TẮT ⇒ pass-through hoàn toàn (phép siết KHÔNG tự bật step-up ở deployment chưa bật cờ)", async () => {
    const truoc = process.env.ACTUATION_STEPUP_2FA;
    process.env.ACTUATION_STEPUP_2FA = "false";
    try {
      // ⚠ I-4: `totpCode` bắt buộc ở zod ⇒ phải gửi **một** chuỗi; gửi một mã **SAI** làm ca này
      //   MẠNH HƠN bản cũ: cờ TẮT thì cả mã sai cũng lọt, tức middleware thật sự pass-through.
      await expect(moi(phienMoi()).deployMoi({ totpCode: "000000" })).resolves.toEqual({ ok: true });
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
