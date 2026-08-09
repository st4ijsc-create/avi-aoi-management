/**
 * ★★★★ Pha 7 / review TOÀN NHÁNH **I-4** — lưới của **CỔNG BUỘC ĐỔI MẬT KHẨU, phía MÁY CHỦ**.
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐO ĐƯỢC TRƯỚC BẢN VÁ: cờ ĐƯỢC GHI, KHÔNG AI ĐỌC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 8 xoay bí mật thật trên **8/8** tài khoản (bí mật cũ đã lộ) và đặt cờ *"phải đổi mật khẩu"*.
 * Review TOÀN NHÁNH đếm: **0** người đọc trong `client/**`, **0** phép cưỡng chế máy chủ. Hệ mang
 * một lời hứa an ninh **không có thật**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỐN Ô, VÀ MỖI Ô ĐÓNG MỘT ĐƯỜNG THOÁT KHÁC NHAU
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   §1  **∀ CẤU TRÚC** — cổng nằm trong chuỗi middleware của **MỌI** thủ tục trên `appRouter`
 *       (2.2k+), không phải của "vài thủ tục nhạy cảm". Đây là ô duy nhất chứng minh được rằng
 *       một thủ tục **thứ N+1** sinh ra ở một file **chưa tồn tại** cũng bị chặn.
 *   §2  **LƯỚI HAI CHIỀU của tập CHO QUA** — chiều A: mọi đường trong tập **tồn tại thật** trên
 *       `appRouter` (đổi tên một thủ tục ⇒ ĐỎ, thay vì lặng lẽ nhốt người dùng lại); chiều B:
 *       tập ấy **tối thiểu** và mỗi phần tử có người dùng thật.
 *   §3  **HÀNH VI** — một lượt gọi thật bị từ chối thật, và cổng chạy **TRƯỚC** RBAC.
 *   §4  🔴 **MIỄN TRỪ CỐ Ý** — `admin` có cờ ⇒ **KHÔNG** bị chặn (quyết định chủ dự án 2026-08-09).
 *   §5  **KHÔNG KHOÁ AI RA NGOÀI** — đối chứng dương: đổi mật khẩu qua đúng cổng ⇒ cờ **tự hạ**.
 *
 * ⚠ §3–§5 chạy trên **DB test THẬT** (`aoi_management_test`): bất biến nói về **nguồn dữ liệu**
 *   (hai mốc đọc MỚI từ DB), nên một bảng giả trong bộ nhớ sẽ đo đúng thứ nó không được phép giả
 *   định. Lưới tự tạo tài khoản của mình và **chỉ xoá đúng những tài khoản ấy**.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "./context";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { readAppErrorMeta } from "./appError";
import { chanKhiPhaiDoiMatKhau, THU_TUC_CHO_QUA } from "./trpc";
import { redactServerOnlyUserFields } from "./publicUser";
import {
  VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU,
  biChanBoiCongDoiMatKhau,
  duocMienTruBuocDoiMatKhau,
} from "@shared/buocDoiMatKhau";

/** Mã lỗi mà cổng ném. Một hằng, để không có hai chính tả của cùng một sự thật trong file này. */
const MA = "MUST_CHANGE_PASSWORD";

/**
 * ★★★ Bảng thủ tục **thật** của `appRouter`, phẳng theo đường dấu-chấm (`"auth.me"`).
 * ⚠ Đọc từ chính router đang chạy — **không** chép lại một danh sách thứ hai vào lưới: một bản sao
 *   chỉ chứng minh bản sao ấy đúng, còn cái người ta thật sự phục vụ vẫn tự do lệch đi.
 */
const THU_TUC = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
  .procedures;

/**
 * Hàm middleware **thật** mà `.use()` đẩy vào chuỗi. `t.middleware(fn)` trả về một **builder**
 * (`{ _middlewares, unstable_pipe }`), còn `procedure._def.middlewares` giữ chính `fn` bên trong —
 * nên phép so sánh phải đi qua `_middlewares[0]`, không so với builder.
 * ⚠ So bằng **đồng nhất tham chiếu**, không bằng TÊN hàm: một hàm khác trùng tên sẽ qua được phép
 *   so theo tên, và lớp lỗi *"nhận diện bằng chính tả"* đã tốn hai lượt vá ở `vramPha5Gate.test.ts`.
 */
const HAM_CONG = (chanKhiPhaiDoiMatKhau as unknown as { _middlewares: unknown[] })._middlewares[0];

function chuoiCua(duong: string): unknown[] {
  const p = THU_TUC[duong] as { _def?: { middlewares?: unknown[] } } | undefined;
  return p?._def?.middlewares ?? [];
}

describe("★★★★ I-4 §1 — ∀ THỦ TỤC (không phải ∃ vài thủ tục nhạy cảm): cổng nằm trong MỌI chuỗi", () => {
  it("★★ cầu chì — bảng thủ tục đọc được và ĐỦ LỚN (bảng rỗng ⇒ mọi khẳng định dưới là chân lý rỗng)", () => {
    expect(
      Object.keys(THU_TUC).length,
      "không rút được thủ tục nào khỏi `appRouter._def.procedures` — hình dạng nội bộ tRPC đã đổi?",
    ).toBeGreaterThan(2000);
    expect(HAM_CONG, "không rút được hàm middleware khỏi `chanKhiPhaiDoiMatKhau`").toBeTruthy();
  });

  it("★★★★ ∀ — KHÔNG thủ tục nào thiếu cổng trong chuỗi middleware của nó", () => {
    /**
     * ⚠⚠⚠ ĐÂY LÀ Ô CHỦ của bản vá, và nó là một **∀**, không phải một **∃**.
     * Hệ có 2.2k thủ tục. Một danh sách *"thủ tục nhạy cảm cần chặn"* viết tay hôm nay sẽ thiếu
     * phần tử thứ N+1 — lớp lỗi ấy đã tái diễn **MƯỜI BẢY** lần trong chuỗi pha này. Ô này phát
     * biểu cái phải là: *cổng ở GỐC ⇒ mọi thủ tục, kể cả thủ tục sinh ra ngày mai trong một file
     * chưa tồn tại, đi qua nó theo cấu tạo.*
     *
     * ⚠ "Có mặt trong chuỗi" **là đủ** để kết luận *"lượt gọi không thể THÀNH CÔNG khi đang bị
     *   chặn"*: `next()` chỉ đi **tiếp** trong chuỗi, không có đường nào nhảy qua một middleware
     *   đứng sau. Một middleware đứng TRƯỚC mà ném thì lượt gọi cũng đã bị từ chối rồi.
     */
    const thieu = Object.keys(THU_TUC).filter((d) => !chuoiCua(d).includes(HAM_CONG));
    expect(
      thieu.slice(0, 20).join("\n") + (thieu.length > 20 ? `\n… và ${thieu.length - 20} thủ tục nữa` : ""),
      "thủ tục KHÔNG đi qua cổng buộc-đổi-mật-khẩu ⇒ nó được dựng từ một builder KHÔNG bắt nguồn " +
        "từ `thuTucGoc` (hoặc từ một `initTRPC` thứ hai). Sửa builder, đừng thêm tên vào một danh sách.",
    ).toBe("");
  });

  it("★★★ …và cổng là middleware ĐẦU TIÊN (chạy trước RBAC · trước 2FA · trước zod)", () => {
    /**
     * ⚠ Không bắt buộc cho tính ĐÚNG của phép chặn, nhưng bắt buộc cho **CÂU LỖI người dùng đọc
     *   được**: nếu RBAC chạy trước, một người bị buộc đổi mật khẩu sẽ nhận *"bạn không có quyền"*
     *   và đi xin quyền — **sai hướng hoàn toàn**, đúng lớp lỗi mà `ACCOUNT_DISABLED` đã phải tách
     *   khỏi `PERMISSION_DENIED` ở review cuối Sprint 5.
     */
    const khongDauTien = Object.keys(THU_TUC).filter((d) => chuoiCua(d)[0] !== HAM_CONG);
    expect(khongDauTien.slice(0, 20).join("\n"), "cổng không đứng đầu chuỗi ⇒ câu lỗi trả về sai lý do").toBe("");
  });
});

describe("★★★ I-4 §2 — tập CHO QUA: LƯỚI HAI CHIỀU (khuôn `publicUser.ts`)", () => {
  it("★★★ chiều A — MỌI đường trong tập TỒN TẠI trên `appRouter` (mục ma ⇒ nhốt người dùng lại)", () => {
    /**
     * ⚠⚠ Đây là chiều dễ mất nhất. Đổi tên `user.changePassword` thành `user.doiMatKhau` mà quên
     *    sửa tập cho qua ⇒ **không lỗi biên dịch, không ca nào đỏ**, và mọi người bị buộc đổi mật
     *    khẩu bị nhốt **vĩnh viễn**: họ không gọi được chính thủ tục dùng để tự gỡ. Cổng biến
     *    thành nhà tù, im lặng.
     */
    const ma = THU_TUC_CHO_QUA.filter((d) => !(d in THU_TUC));
    expect(
      ma.join(" · "),
      "đường trong tập CHO QUA không tồn tại trên appRouter ⇒ MỤC MA: người bị chặn mất đúng lối thoát",
    ).toBe("");
  });

  it("★★★ chiều B — tập TỐI THIỂU: đúng bốn đường của vòng đời tự-gỡ, không hơn", () => {
    /**
     * ⚠ Ghim **TẬP**, không ghim số: *"hoán vị hai phần tử giữ nguyên số lượng"* đã là một bài học
     *   phải trả giá của nhánh này. Thêm/bớt một đường ở đây là một **quyết định phải nói ra**, và
     *   nó hiện thành diff ngay tại ô này.
     */
    expect([...THU_TUC_CHO_QUA].sort()).toEqual(
      ["auth.login", "auth.logout", "auth.me", "user.changePassword"].sort(),
    );
  });

  it("★★★ …và MỌI đường cho qua thật sự KHÔNG bị cổng chặn (vị từ chỉ nhìn `path`)", () => {
    // Cổng quyết định theo `path` trước khi chạm DB ⇒ hành vi của bốn đường này là hệ quả trực
    // tiếp của tập trên. Ô hành vi sống nằm ở §3/§5.
    const CHO_QUA = new Set(THU_TUC_CHO_QUA);
    for (const d of ["auth.login", "auth.logout", "auth.me", "user.changePassword"]) {
      expect(CHO_QUA.has(d), `${d} phải được cho qua`).toBe(true);
    }
    // KHÔNG BẮT NHẦM — hai đường trông giống mà KHÔNG được cho qua.
    for (const d of ["auth.checkSetupRequired", "user.updateProfile", "user.list"]) {
      expect(CHO_QUA.has(d), `${d} KHÔNG được nằm trong tập cho qua`).toBe(false);
      expect(d in THU_TUC, `${d} phải tồn tại (nếu không, ca trên là chân lý rỗng)`).toBe(true);
    }
  });
});

describe("★★★ I-4 §0 — VỊ TỪ: bảng chân trị ĐẦY ĐỦ + tập miễn trừ", () => {
  it("★★★ bảng chân trị 2×2 của `biChanBoiCongDoiMatKhau`", () => {
    expect(biChanBoiCongDoiMatKhau("user", false)).toBe(false);
    expect(biChanBoiCongDoiMatKhau("user", true)).toBe(true);
    expect(biChanBoiCongDoiMatKhau("admin", false)).toBe(false);
    // 🔴 Ô MIỄN TRỪ — xem §4.
    expect(biChanBoiCongDoiMatKhau("admin", true)).toBe(false);
  });

  it("★★ vai không rõ (null/undefined/lạ) mà có cờ ⇒ VẪN BỊ CHẶN (hỏng theo chiều ĐÓNG)", () => {
    expect(biChanBoiCongDoiMatKhau(null, true)).toBe(true);
    expect(biChanBoiCongDoiMatKhau(undefined, true)).toBe(true);
    expect(biChanBoiCongDoiMatKhau("Admin", true), "so khớp vai phải PHÂN BIỆT hoa thường").toBe(true);
    expect(duocMienTruBuocDoiMatKhau(null)).toBe(false);
  });
});

/* ── §3 · §4 · §5: DB THẬT ───────────────────────────────────────────────────────────────────── */

const HASH_CU = "$2b$10$mYIpBDnkaP3c6VCDuxdEEe88zwP3d.NXN37VdbNmmtMlxBKQvEUUm"; // bcrypt("matkhaucu123", 10)
const MAT_KHAU_CU = "matkhaucu123";

let uidThuong = 0;

/**
 * Đặt hai mốc trên hàng `users`. ⚠ **MỖI ca tự đặt trạng thái nó cần**, không ca nào thừa hưởng
 * trạng thái của ca trước: cổng chung chạy kèm một lượt `--sequence.shuffle.tests`, và một lưới
 * phụ thuộc thứ tự sẽ đỏ **không tất định** ở đúng lượt ấy.
 */
async function datMoc(userId: number, doiLuc: Date | null, thuHoiLuc: Date | null): Promise<void> {
  const { getDb } = await import("../db/connection");
  const { eq } = await import("drizzle-orm");
  const { users } = await import("../../drizzle/schema");
  const d = await getDb();
  await d!
    .update(users)
    .set({ passwordChangedAt: doiLuc, passwordInvalidBefore: thuHoiLuc })
    .where(eq(users.id, userId));
}

/** Tài khoản **đang bị buộc đổi mật khẩu**: thu hồi SAU lượt đổi gần nhất. */
const datCoBuocDoi = (userId: number) => datMoc(userId, new Date(Date.now() - 60_000), new Date());
/** Tài khoản **KHÔNG** bị buộc đổi: chưa từng có lượt thu hồi nào. */
const xoaCoBuocDoi = (userId: number) => datMoc(userId, new Date(), null);

/** `ctx` như tầng xác thực THẬT dựng ra: hàng `users` **đã qua** `redactServerOnlyUserFields`. */
async function ctxNhuThat(userId: number): Promise<TrpcContext> {
  const hang = await db.getUserById(userId);
  const sach = redactServerOnlyUserFields(hang as unknown as Record<string, unknown>) as unknown as User;
  return {
    user: sach,
    sessionToken: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  };
}

/** Mã lỗi ứng dụng của lượt gọi, hoặc `null` nếu lượt gọi KHÔNG ném. */
async function maLoiCua(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (err) {
    return readAppErrorMeta(err)?.appCode ?? `KHÔNG-PHẢI-APP-ERROR: ${(err as Error)?.message}`;
  }
}

describe("★★★★ I-4 §3+§4+§5 — hành vi SỐNG trên DB thật", () => {
  beforeAll(async () => {
    uidThuong = (
      await db.createLocalUser({
        username: `__i4_thuong_${Date.now()}`,
        passwordHash: HASH_CU,
        name: "I-4 — bị buộc đổi mật khẩu",
        role: "user",
      })
    ).id;
  });

  afterAll(async () => {
    if (uidThuong) await db.deleteUser(uidThuong);
  });

  it("★★ cầu chì — ĐỐI CHỨNG ÂM: KHÔNG có cờ ⇒ thủ tục NGOÀI tập cho qua vẫn đi lọt", async () => {
    expect(uidThuong).toBeGreaterThan(0);
    await xoaCoBuocDoi(uidThuong);
    expect(await db.phaiDoiMatKhau(uidThuong)).toBe(false);
    // ⚠ Nếu ô này đỏ thì mọi ca "bị chặn" bên dưới có thể đang đỏ vì một lý do KHÁC HẲN (thiếu
    //   quyền · zod · DB) và cả lưới sẽ nói dối theo chiều "có vẻ đang cưỡng chế".
    const ctx = await ctxNhuThat(uidThuong);
    expect(await maLoiCua(() => appRouter.createCaller(ctx).auth.checkSetupRequired())).toBe(null);
  });

  it("★★★★ §3 — người bị buộc đổi mật khẩu gọi một thủ tục NGOÀI tập cho qua ⇒ TỪ CHỐI, đúng mã", async () => {
    await datCoBuocDoi(uidThuong);
    expect(await db.phaiDoiMatKhau(uidThuong), "cầu chì: cờ phải BẬT trước khi đo phép chặn").toBe(true);

    const ctx = await ctxNhuThat(uidThuong);
    // ⚠ `auth.checkSetupRequired` là `publicProcedure`, chỉ-đọc, không tham số — nên ô này đo
    //   ĐÚNG phép chặn, không đo kèm RBAC hay zod. Nó cũng chứng minh cổng phủ **cả** thủ tục công
    //   khai, không chỉ `protectedProcedure`.
    expect(await maLoiCua(() => appRouter.createCaller(ctx).auth.checkSetupRequired())).toBe(MA);
  });

  it("★★★★ §3b — ô SUY RA vẫn tới được: `auth.me` (cho qua) KHÔNG bị chặn và nói ĐÚNG SỰ THẬT", async () => {
    /**
     * ⚠⚠ Nếu `auth.me` bị chặn thì client mất đúng ô mà nó dùng để biết phải đi đâu ⇒ **trắng
     *    trang, không lối ra**. Đây là ô canh bất biến *"KHÔNG ĐƯỢC KHOÁ AI RA NGOÀI"* ở tầng đọc.
     */
    await datCoBuocDoi(uidThuong);
    const me = await appRouter.createCaller(await ctxNhuThat(uidThuong)).auth.me();
    expect(me, "`auth.me` bị chặn ⇒ client không có đường nào biết mình phải đổi mật khẩu").not.toBeNull();
    expect(me!.mustChangePassword).toBe(true);
  });

  it("★★★ §3c — cổng chạy TRƯỚC RBAC: thủ tục admin-only trả `MUST_CHANGE_PASSWORD`, KHÔNG phải `PERMISSION_DENIED`", async () => {
    /**
     * ⚠ `user.list` là `protectedProcedure` + hàng rào `role !== 'admin'` ⇒ với tài khoản `user`
     *   này, **hai** lý do từ chối cùng đúng. Câu người dùng đọc được phải là câu **họ tự gỡ
     *   được**; *"bạn không có quyền"* đẩy họ đi xin quyền — sai hướng hoàn toàn.
     */
    await datCoBuocDoi(uidThuong);
    const ctx = await ctxNhuThat(uidThuong);
    expect(await maLoiCua(() => appRouter.createCaller(ctx).user.list())).toBe(MA);
  });

  it("🔴🔴 §4 — MIỄN TRỪ CỐ Ý: `admin` CÓ CỜ mà **KHÔNG** bị chặn (quyết định chủ dự án 2026-08-09)", async () => {
    /**
     * ⚠⚠⚠ CA NÀY GHIM MỘT LỖ, KHÔNG PHẢI MỘT TÍNH NĂNG.
     * Rủi ro đã nêu với chủ dự án trước khi chọn: `admin` là vai nhiều quyền nhất và bí mật của họ
     * nằm trong **đúng 8 cái đã lộ** ở Task 8 ⇒ miễn trừ này tha đúng nhóm nguy hiểm nhất. Khuyến
     * nghị kỹ thuật là KHÔNG miễn trừ; chủ dự án đã cân nhắc và **vẫn chọn**.
     * ⇒ Ca này tồn tại để (a) người sau đọc mã **không tưởng** `admin` cũng được bảo vệ, và (b) ai
     *   muốn bỏ miễn trừ thì phải sửa `VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU` **và** ca này — tức bỏ **có
     *   chủ đích**, hiện thành diff trong review.
     *
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ⚠⚠ VÌ SAO **KHÔNG** DỰNG MỘT TÀI KHOẢN `admin` THẬT Ở ĐÂY — và vì sao cách này MẠNH HƠN
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * `server/auth.setupAdmin.test.ts` **XOÁ MỌI HÀNG `role="admin"`** trong `beforeEach` (đó là
     * tiền đề thật của `auth.setupAdmin`, đã thu hẹp ở I-3 — nợ CÓ TRƯỚC, không phải của lượt này).
     * Vitest chạy các file test **song song** ⇒ một tài khoản admin do file này dựng sẽ **biến mất
     * giữa chừng**, và ngược lại nó làm ca `admins.length === 1` bên kia ĐỎ. Đo được: chạy hai file
     * cùng lượt ⇒ **cả hai** đỏ, và nạn nhân đổi theo thứ tự chạy — đúng triệu chứng *"cổng đỏ
     * KHÔNG TẤT ĐỊNH"*.
     *
     * ⇒ Ca này dựng một **THÍ NGHIỆM MỘT BIẾN** thay vì hai tài khoản: **cùng** một người dùng,
     *   **cùng** một cờ đang bật thật trong DB, **cùng** một thủ tục — chỉ **`role` đổi**. Nó cô
     *   lập đúng biến mà miễn trừ phụ thuộc vào, chặt hơn phép so hai tài khoản (hai tài khoản
     *   khác nhau ở id · username · thời điểm tạo · hàng `user_secrets`).
     * ⚠ Mắt xích *"`ctx.user.role` ĐẾN TỪ hàng DB"* được canh ở ô ngay dưới (`role` là cột
     *   `"public"` nên `redactServerOnlyUserFields` không đụng tới nó — luật ấy có chủ ở
     *   `publicUser.ts` và lưới riêng ở `publicUser.test.ts`).
     */
    expect(VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU, "tập miễn trừ đã đổi — đây là một quyết định an ninh").toEqual([
      "admin",
    ]);

    await datCoBuocDoi(uidThuong);
    expect(await db.phaiDoiMatKhau(uidThuong), "cầu chì: cờ PHẢI đang bật, nếu không ca này rỗng nghĩa").toBe(true);

    const goc = await ctxNhuThat(uidThuong);
    // Đối chứng ÂM (cùng người, cùng cờ, vai KHÔNG miễn trừ) ⇒ BỊ CHẶN.
    expect(goc.user!.role, "cầu chì: `ctx.user.role` phải đến từ hàng DB, và hàng ấy là `user`").toBe("user");
    expect(await maLoiCua(() => appRouter.createCaller(goc).auth.checkSetupRequired())).toBe(MA);

    // …đổi ĐÚNG MỘT biến: vai.
    const mienTru: TrpcContext = { ...goc, user: { ...(goc.user as User), role: "admin" } as User };
    expect(
      await maLoiCua(() => appRouter.createCaller(mienTru).auth.checkSetupRequired()),
      "admin ĐANG bị buộc đổi mật khẩu mà cổng vẫn chặn ⇒ miễn trừ (quyết định chủ dự án) đã mất",
    ).toBe(null);
  });

  it("★★★★ §5 ĐỐI CHỨNG DƯƠNG — đổi mật khẩu QUA ĐÚNG CỔNG ⇒ cờ TỰ HẠ và lối đi mở lại", async () => {
    /**
     * ⚠⚠⚠ Bất biến sống-còn: ***KHÔNG ĐƯỢC KHOÁ AI RA NGOÀI.*** Ca này đi trọn vòng đời bằng
     * **chính các thủ tục thật** mà một người bị chặn dùng được:
     *   bị chặn → `user.changePassword` (trong tập cho qua) → `auth.me` nói cờ đã hạ → gọi lại
     *   thủ tục vừa bị chặn ⇒ QUA.
     * ⚠ Không ai phải nhớ **xoá cờ**: `updateUserPassword` ghi `passwordChangedAt = now()` trong
     *   cùng giao dịch, và `suyRaPhaiDoiMatKhau` tự tắt. Nếu ô này đỏ thì hoặc lượt ghi mốc đã
     *   mất, hoặc `user.changePassword` đã rơi khỏi tập cho qua — cả hai đều là **nhà tù**.
     */
    // ⚠ Tự dựng trạng thái đầu vào (kể cả hash mật khẩu) để ca này không thừa hưởng gì từ ca khác
    //   — bắt buộc, vì cổng chung chạy kèm một lượt `--sequence.shuffle.tests`.
    await db.updateUserPassword(uidThuong, HASH_CU);
    await datCoBuocDoi(uidThuong);
    const truoc = await ctxNhuThat(uidThuong);
    expect(await maLoiCua(() => appRouter.createCaller(truoc).auth.checkSetupRequired())).toBe(MA);

    await appRouter.createCaller(truoc).user.changePassword({
      currentPassword: MAT_KHAU_CU,
      newPassword: "matkhaumoi456",
    });

    const sau = await ctxNhuThat(uidThuong);
    expect(
      (await appRouter.createCaller(sau).auth.me())!.mustChangePassword,
      "đổi mật khẩu xong mà cờ vẫn bật ⇒ `updateUserPassword` quên ghi `passwordChangedAt`",
    ).toBe(false);
    expect(
      await maLoiCua(() => appRouter.createCaller(sau).auth.checkSetupRequired()),
      "đổi mật khẩu xong mà vẫn bị chặn ⇒ CỔNG LÀ MỘT NHÀ TÙ",
    ).toBe(null);
  });
});
