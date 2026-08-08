/**
 * ★★★ Pha 6 Task 6 — **CHỐNG PHÁT LẠI mã OTP.** (Lưới này đóng nợ Pha 5/Pha 6 nên nó tự khai
 * `Pha 5` để `vramPha5Gate.test.ts` kéo nó vào lượng từ *"mọi lưới Pha 5 phải được §Cổng kiểm
 * chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 1/1b siết cửa sổ step-up **10 phút → ~90 s** (6,7×) bằng `requirePerCallFreshTotp`. Nhưng
 * `speakeasy.totp.verify` chạy với `window: 1` (nhận cả nhịp trước, bù lệch đồng hồ) ⇒ **CÙNG một
 * mã** vẫn verify được trong ~90 s. Ai đọc trộm được mã (nhìn màn hình · log · chụp gói tin) có
 * ~90 giây để tiêu nó **trên một lệnh khác**. Cửa sổ hẹp hơn **không phải** chống phát lại — nó
 * cần một cơ chế KHÁC: **một cuốn sổ mã đã tiêu**.
 *
 *   ***∀ lượt xác minh TOTP của một người dùng: một mã tiêu được ĐÚNG MỘT LẦN. Lượt thứ hai với
 *   CÙNG mã ⇒ TỪ CHỐI, kể cả khi mã ấy vẫn còn trong cửa sổ hợp lệ.***
 *
 * ⚠⚠ **ĐỐI CHỨNG DƯƠNG LÀ ĐIỀU KIỆN TỒN TẠI CỦA LƯỚI NÀY.** Không có nó thì một bản vá **chặn
 * hết** cũng xanh — đúng lớp lỗi đã để `215/215` xanh suốt thời gian một tool luôn
 * `PERMISSION_DENIED`. Mọi khối dưới đây đều có ít nhất một ô *"mã MỚI ⇒ VẪN QUA"*.
 *
 * ⚠⚠⚠ **RÀNG BUỘC ĐÃ LẬT HÌNH DẠNG (phép đếm Bước 2):** một lượt gọi `deployProcedure` xác minh
 * **CÙNG một mã 2–3 lần** — chuỗi thật là `requireFreshTotp` → `requirePerCallFreshTotp` (GỐC) →
 * `requirePermission` → `requirePerCallFreshTotp` (lần hai, `vramRouter.ts`); xem khối I-4 ở
 * `_core/trpc.ts`. Một cuốn sổ *"tiêu mã khi verify thành công"* viết ngây thơ sẽ **TỰ CHẶN MÌNH**
 * và giết **100 %** lệnh VRAM/deploy. ⇒ Sổ phải phân biệt *"lượt verify thứ N của CÙNG một lượt
 * gọi"* với *"một lượt gọi KHÁC"*. Ô §3 dưới đây là lưới canh đúng chuyện đó.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import speakeasy from "speakeasy";
import { z } from "zod";

// Cùng tư thế môi trường với `vramStepUpFreshness.test.ts`: middleware kiểm toán ghi DB
// fire-and-forget cho MỌI mutation — tắt trước khi `trpc.ts` nạp. `LICENSE_MODULE_GATE_ENABLED
// =false`: cổng license chạy TRƯỚC cổng quyền; bật nó thì một ca "bị chặn" có thể xanh vì LÝ DO SAI.
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

/** Người thi hành LÁ của hộ `vision-sidecar` — mắt xích DUY NHẤT chạm tiến trình thật. */
const sidecar = vi.hoisted(() => ({ stop: null as null | (() => Promise<boolean>) }));
vi.mock("../services/llamaVisionSidecar", () => ({
  stopSidecar: async () => (sidecar.stop === null ? false : sidecar.stop()),
  isVisionSidecarAvailable: () => false,
  getVisionSidecarConfig: () => null,
}));
vi.mock("../services/vram/vramGpuHolders", () => ({
  readProcTable: async () => null,
  readGpuHolders: async () => null,
  readComputeApps: async () => null,
}));
vi.mock("../services/vram/vramEventLog", () => ({
  logVramEvent: () => {},
  flushVramEvents: async () => 0,
  sanitizeVramEvent: (e: unknown) => e,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
  __vramDroppedEventCount: () => 0,
}));

import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});
/**
 * ★★★ Pha 7 Task 5 (A) — sổ mã đã tiêu đi xuống **DB THẬT**; phần còn lại giữ `FakeDb`.
 * Phép định tuyến sống ở `./__totpDbHybrid` (một bản, ba file dùng) — xem docstring ở đó.
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

import { vramRouter } from "./vramRouter";
import { router, deployProcedure } from "../_core/trpc";
import { permissions, users } from "../../drizzle/schema";
import { readAppErrorMeta } from "../_core/appError";
import * as broker from "../services/vram/vramBroker";
import { __resetSharedLedgerForTests } from "../services/vram/vramSharedLedger";
import { __resetDecisionTickForTests } from "../services/vram/vramTickCell";
import { __resetVramDeferForTests } from "../services/vram/vramDefer";
import { VRAM_CONTROL_MODULE } from "@shared/permissions";
import {
  verifyTotpOnce,
  __resetSoTotpChoTest,
  __soTotpSize,
  TOTP_HAN_SO_MS,
} from "../_core/totpOnce";

const MIB = 1024 * 1024;
const SUP_ID = 42;
const SUP2_ID = 43;
const supervisor = { id: SUP_ID, role: "supervisor", name: "Sup", twoFactorEnabled: true };
const supervisor2 = { id: SUP2_ID, role: "supervisor", name: "Sup2", twoFactorEnabled: true };

/** Secret 2FA THẬT — đường verify chạy `speakeasy.totp.verify` nguyên bản trên nó. */
const SECRET_2FA = "K52U24CYJRNTQSKMG47FKUSHKFKUQW2D";
/** Secret của một người dùng KHÁC — nền của ca "không bắt nhầm người". */
const SECRET_2FA_B = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** OTP **của lượt gọi này**. Sinh mới mỗi lần để không ô nào phụ thuộc một chuỗi cứng. */
const otp = (secret = SECRET_2FA): string => speakeasy.totp({ secret, encoding: "base32" });
/** OTP của một **thời điểm** cho trước (giây epoch) — cần cho các ca về hạn của sổ. */
const otpLuc = (giay: number, secret = SECRET_2FA): string =>
  speakeasy.totp({ secret, encoding: "base32", time: giay });

function seedNguoiDung2FA(): void {
  fake.seed(users, [
    { id: SUP_ID, secret: SECRET_2FA, enabled: true, twoFactorSecret: SECRET_2FA, twoFactorEnabled: true },
    { id: SUP2_ID, secret: SECRET_2FA_B, enabled: true, twoFactorSecret: SECRET_2FA_B, twoFactorEnabled: true },
  ]);
}

type HanhQuyen = {
  userId: number;
  module: string;
  canView?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
};

/**
 * ⚠ `FakeDb.seed()` **THAY THẾ** cả bảng, không nối thêm. Gọi nó hai lần (một lần cho mỗi người
 * dùng) thì lượt sau **xoá sạch** quyền của lượt trước, và ca hỏng ở cổng `PERMISSION_DENIED`
 * thay vì cổng OTP — tức xanh/đỏ vì **LÝ DO SAI**. Vật chất hoá **một lượt duy nhất**.
 */
function capQuyen(rows: HanhQuyen[]): void {
  fake.seed(
    permissions,
    rows.map((r, i) => ({
      id: 900 + i,
      userId: r.userId,
      category: "machine_control",
      moduleName: r.module,
      canView: r.canView === true,
      canCreate: r.canCreate === true,
      canEdit: r.canEdit === true,
      canDelete: r.canDelete === true,
      canExport: false,
      expiresAt: null,
    })),
  );
}

/**
 * ⚠ MỖI ca một `sessionToken` RIÊNG — `stepUpVerifiedUntil` là `Map` cấp module không có đường
 * xoá. Dùng chung một khoá thì ca sau thừa hưởng cache của ca trước.
 */
let demPhien = 0;
const phienMoi = (): string => `pha6-task6-sess-${++demPhien}`;
const ctxCua = (phien: string, user: unknown = supervisor) =>
  ({ user, req: { ip: "127.0.0.1", headers: {} }, res: {}, sessionToken: phien }) as never;

/** **MỘT thủ tục `deployProcedure` THẬT** — dùng chính export của `_core/trpc.ts`. */
const routerKhac = router({
  deployKhac: deployProcedure
    .input(z.object({ totpCode: z.string().max(16) }))
    .mutation(() => ({ ok: true as const })),
});

function tuDay<T>(v: T): T & { totpCode: string } {
  return v as T & { totpCode: string };
}

const vram = (phien: string, user: unknown = supervisor) => vramRouter.createCaller(ctxCua(phien, user));
const khac = (phien: string, user: unknown = supervisor) => routerKhac.createCaller(ctxCua(phien, user));

async function loiCua(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

/** Đi qua ĐÚNG đường thoát: một lượt `reserve()` thật ghi vào sổ cục bộ. */
function xinThat(owner: string, bytes: number) {
  const out = broker.reserve(
    { owner, kind: "external-process", estimatedBytes: bytes, priority: "interactive", reclaimer: "vision-sidecar" },
    { tick: null, unledgered: null, sharedLedger: null, nowMs: Date.now() },
  );
  if (out.lease === null) throw new Error("ca này cần một giấy phép ĐƯỢC CẤP");
  broker.setLeaseRefCount(out.lease.id, 0);
  return out.lease;
}

beforeEach(async () => {
  fake.store.clear();
  resetSeq();
  sidecar.stop = null;
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
  await __resetSoTotpChoTest([SUP_ID, SUP2_ID]);
  seedNguoiDung2FA();
  capQuyen([
    { userId: SUP_ID, module: VRAM_CONTROL_MODULE, canDelete: true, canCreate: true },
    { userId: SUP2_ID, module: VRAM_CONTROL_MODULE, canDelete: true, canCreate: true },
  ]);
  process.env.ACTUATION_STEPUP_2FA = "true";
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 0. CẦU CHÌ — đường thật phải ĐANG chạy, nếu không mọi ca dưới là chân lý rỗng
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Pha 6 Task 6 — cầu chì", async () => {
  it("★★★ cờ `ACTUATION_STEPUP_2FA` BẬT và middleware ĐANG chạy (phiên nguội, không mã ⇒ chặn)", async () => {
    const e = await loiCua(khac(phienMoi()).deployKhac(tuDay({})));
    expect(readAppErrorMeta(e)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG gốc — một mã MỚI, hợp lệ, đi qua đường THẬT (`speakeasy` + bảng `users`)", async () => {
    await expect(khac(phienMoi()).deployKhac({ totpCode: otp() })).resolves.toEqual({ ok: true });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. BẤT BIẾN CHÍNH — MỘT MÃ TIÊU ĐƯỢC ĐÚNG MỘT LẦN
//
// ⚠ Đây là **CA ĐO** của Bước 1: trước bản vá, cả hai lượt đều QUA (`window: 1` ⇒ ~90 s).
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Task 6 — một mã OTP tiêu được ĐÚNG MỘT LẦN", async () => {
  it("★★★ CA ĐO (Bước 1): cùng một mã, hai lượt gọi liên tiếp trong cửa sổ hợp lệ ⇒ lượt THỨ HAI bị từ chối", async () => {
    const ma = otp();
    // Nhịp 1 — mã mới ⇒ QUA.
    await expect(khac(phienMoi()).deployKhac({ totpCode: ma })).resolves.toEqual({ ok: true });
    // Nhịp 2 — **CÙNG mã**, phiên KHÁC (không dính cache 10 phút) ⇒ PHẢI bị chặn.
    const e = await loiCua(khac(phienMoi()).deployKhac({ totpCode: ma }));
    expect(e, "mã đã tiêu mà vẫn qua ⇒ phát lại còn sống").not.toBeNull();
    expect(readAppErrorMeta(e)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG: sau lượt tiêu, một mã MỚI hợp lệ ⇒ VẪN QUA", async () => {
    const ma = otp();
    await expect(khac(phienMoi()).deployKhac({ totpCode: ma })).resolves.toEqual({ ok: true });
    await expect(khac(phienMoi()).deployKhac({ totpCode: ma })).rejects.toThrow();
    /**
     * ⚠ Mã "mới" phải THẬT SỰ khác chuỗi — cùng nhịp 30 s thì `speakeasy.totp()` trả **đúng chuỗi
     * cũ**, và ca sẽ đỏ vì lý do SAI. Lấy mã của nhịp KẾ TIẾP để độc lập với thời điểm chạy lưới.
     */
    const maMoi = otpLuc(Math.floor(Date.now() / 1000) + 30);
    expect(maMoi, "cầu chì: mã của nhịp kế tiếp phải khác mã vừa tiêu").not.toBe(ma);
    await expect(khac(phienMoi()).deployKhac({ totpCode: maMoi })).resolves.toEqual({ ok: true });
  });

  it("★★★ mã trộm dùng ở một PHIÊN khác / một lệnh khác (đúng kịch bản hỏng) ⇒ bị từ chối", async () => {
    const ma = otp();
    // Nạn nhân bấm một lệnh deploy hợp lệ.
    await expect(khac(phienMoi()).deployKhac({ totpCode: ma })).resolves.toEqual({ ok: true });
    // Kẻ tấn công đọc trộm mã, dùng nó cho một LỆNH PHÁ HUỶ ở phiên của MÌNH, trong ~90 s.
    const lease = xinThat("sidecar:vision", 7_825 * MIB);
    sidecar.stop = async () => {
      broker.release(lease);
      return true;
    };
    const truoc = broker.snapshot().totalReservedBytes;
    const e = await loiCua(vram(phienMoi()).preempt({ owner: "sidecar:vision", totpCode: ma }));
    expect(e, "mã đã tiêu ở lượt khác PHẢI không mở được cửa giết tiến trình").not.toBeNull();
    expect(readAppErrorMeta(e)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
    // ⚠ Câu từ chối chưa đủ — phải chứng minh KHÔNG MỘT BYTE nào bị đụng.
    expect(broker.snapshot().totalReservedBytes, "bị chặn ⇒ chưa ai bị thu hồi").toBe(truoc);
    expect(broker.snapshot().leases.some((l) => l.id === lease.id), "giấy phép phải còn nguyên").toBe(true);
  });

  it("★★★ KHÔNG BẮT NHẦM NGƯỜI — người dùng B tiêu mã CỦA B, không dính sổ của A", async () => {
    /**
     * ⚠ Sổ khoá theo `(userId, mã)`. Không có ca này thì một bản vá khoá theo **mã** thôi (bỏ
     * `userId`) cũng xanh — và nó sẽ chặn nhầm người khác khi hai secret tình cờ sinh cùng 6 số.
     */
    const maA = otp(SECRET_2FA);
    await expect(khac(phienMoi(), supervisor).deployKhac({ totpCode: maA })).resolves.toEqual({ ok: true });
    const maB = otp(SECRET_2FA_B);
    await expect(khac(phienMoi(), supervisor2).deployKhac({ totpCode: maB })).resolves.toEqual({ ok: true });
  });

  it("★★★ KHÓA SỔ PHẢI CHỨA `userId` — CÙNG một chuỗi mã, HAI người dùng ⇒ cả hai QUA", async () => {
    /**
     * ⚠⚠⚠ **CA NÀY TỒN TẠI VÌ MỘT ĐỘT BIẾN ĐÃ SỐNG SÓT.** Ô "không bắt nhầm người" ở trên dùng hai
     * secret KHÁC nhau, nên hai người sinh ra hai chuỗi 6 số khác nhau và khoá sổ **có hay không
     * có `userId` cũng xanh như nhau** — nó bắt trúng chỉ **nhờ may**. Đo được: gỡ `userId` khỏi
     * khoá ⇒ **78/78 vẫn XANH**. Đúng lớp *"hàng rào không ai canh"*.
     *
     * ⇒ Ô này ép **đúng cái điều kiện** ấy: **CÙNG một chuỗi mã** (dùng chung một secret cho hai
     * `userId`) — thứ có thể xảy ra ngoài đời khi hai secret khác nhau tình cờ sinh cùng 6 số.
     * Khoá có `userId` ⇒ hai mục riêng ⇒ cả hai QUA. Khoá thiếu `userId` ⇒ người thứ hai bị
     * **chặn oan**, và ca này ĐỎ.
     */
    const t = Math.floor(Date.now() / 1000);
    const ma = otpLuc(t);
    const a = await verifyTotpOnce({ userId: SUP_ID, secret: SECRET_2FA, token: ma, nowMs: t * 1000 });
    expect(a.hopLe, "người thứ nhất tiêu mã của mình").toBe(true);
    const b = await verifyTotpOnce({ userId: SUP2_ID, secret: SECRET_2FA, token: ma, nowMs: t * 1000 });
    expect(b.hopLe, "người thứ HAI dùng CÙNG chuỗi mã ⇒ vẫn phải QUA (khoá sổ thiếu `userId`)").toBe(true);
    expect(b.phatLai, "và tuyệt đối không được bị khai là PHÁT LẠI").toBe(false);
    // …còn CÙNG người + CÙNG mã thì vẫn là phát lại (đối chứng ngược, để ô này không xanh vì bản
    // vá đã bỏ sổ hoàn toàn).
    const lai = await verifyTotpOnce({ userId: SUP_ID, secret: SECRET_2FA, token: ma, nowMs: t * 1000 });
    expect(lai.phatLai, "cùng người + cùng mã vẫn PHẢI là phát lại").toBe(true);
  });

  it("★★★ KHÔNG BẮT NHẦM ĐƯỜNG — mã SAI vẫn hỏng vì SAI, và KHÔNG chiếm chỗ trong sổ", async () => {
    const truoc = await __soTotpSize();
    const e = await loiCua(khac(phienMoi()).deployKhac({ totpCode: "000000" }));
    expect(readAppErrorMeta(e)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
    expect(await __soTotpSize(), "mã KHÔNG verify được thì KHÔNG được ghi vào sổ (nếu không, sổ thành bề mặt DoS)").toBe(truoc);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. ★★★ SỔ PHẢI TỰ DỌN — nếu không nó phình vô hạn
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Task 6 — sổ mã đã tiêu TỰ DỌN", async () => {
  it("★★★ mục quá hạn bị xoá ở lượt ghi kế tiếp ⇒ số mục KHÔNG tăng theo thời gian", async () => {
    const t0 = Math.floor(Date.now() / 1000);
    expect(await __soTotpSize()).toBe(0);
    for (let i = 0; i < 5; i++) {
      const giay = t0 + i * 30;
      const kq = await verifyTotpOnce({ userId: SUP_ID, secret: SECRET_2FA, token: otpLuc(giay), nowMs: giay * 1000 });
      expect(kq.hopLe, `mã của nhịp ${i} phải verify được`).toBe(true);
    }
    const dinh = await __soTotpSize();
    expect(dinh, "5 mã liên tiếp ⇒ sổ phải có mục").toBeGreaterThan(0);

    // Nhảy qua HẠN của sổ rồi ghi thêm MỘT mục ⇒ mọi mục cũ phải biến mất.
    const sau = t0 + Math.ceil(TOTP_HAN_SO_MS / 1000) + 300;
    const kq = await verifyTotpOnce({ userId: SUP_ID, secret: SECRET_2FA, token: otpLuc(sau), nowMs: sau * 1000 });
    expect(kq.hopLe, "đối chứng dương: mã mới ở thời điểm mới vẫn phải QUA").toBe(true);
    expect(await __soTotpSize(), `sổ phải tự dọn: còn ĐÚNG 1 mục (đỉnh trước đó ${dinh})`).toBe(1);
  });

  it("★★★ ĐỐI CHỨNG — hết hạn KHÔNG có nghĩa là mở lại cửa cho mã cũ (mã cũ cũng hết hiệu lực)", async () => {
    const t0 = Math.floor(Date.now() / 1000);
    const ma = otpLuc(t0);
    expect((await verifyTotpOnce({ userId: SUP_ID, secret: SECRET_2FA, token: ma, nowMs: t0 * 1000 })).hopLe).toBe(true);
    const sau = t0 + Math.ceil(TOTP_HAN_SO_MS / 1000) + 300;
    const kq = await verifyTotpOnce({ userId: SUP_ID, secret: SECRET_2FA, token: ma, nowMs: sau * 1000 });
    expect(kq.hopLe, "mục sổ hết hạn rồi, nhưng CHÍNH MÃ cũng đã ra ngoài cửa sổ TOTP ⇒ vẫn từ chối").toBe(false);
    expect(kq.phatLai, "từ chối này là do MÃ HẾT HẠN, không phải do sổ").toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. ★★★ RÀNG BUỘC ĐÃ LẬT HÌNH DẠNG — MỘT LƯỢT GỌI XÁC MINH CÙNG MÃ 2–3 LẦN
//
// ⚠⚠⚠ Không có khối này thì bản vá "tiêu mã khi verify thành công" sẽ **giết 100 % lệnh
// VRAM/deploy** và không ca nào ở §1 phát hiện được — mọi ca §1 chỉ khẳng định chuyện BỊ CHẶN.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("★★★ Task 6 — sổ KHÔNG được tự chặn mình trong CÙNG một lượt gọi", async () => {
  it("★★★ `vram.preempt` (chuỗi 3 lượt verify cùng mã) với mã MỚI ⇒ VẪN QUA và byte RỜI SỔ THẬT", async () => {
    const lease = xinThat("sidecar:vision", 7_825 * MIB);
    let daGoi = false;
    sidecar.stop = async () => {
      daGoi = true;
      broker.release(lease);
      return true;
    };
    const truoc = broker.snapshot().totalReservedBytes;
    await expect(vram(phienMoi()).preempt({ owner: "sidecar:vision", totpCode: otp() })).resolves.toBeDefined();
    expect(daGoi, "lượt thu hồi THẬT phải chạy — nếu không, ô này không chứng minh gì").toBe(true);
    expect(broker.snapshot().totalReservedBytes, "byte phải rời sổ thật").toBeLessThan(truoc);
  });

  it("★★★ cầu chì của ô trên — chuỗi ấy THẬT SỰ verify nhiều hơn MỘT lần cho một lượt gọi", async () => {
    /**
     * ⚠ Nếu chuỗi chỉ verify **một** lần thì ô trên là chân lý rỗng và ràng buộc "cùng lượt gọi"
     * không được canh bởi bất cứ gì. Con số dưới đây suy từ **cùng một lượt claim**: ba lượt gọi
     * `verifyTotpOnce` với **cùng `luot`** phải cùng qua; đổi `luot` ⇒ lượt sau là PHÁT LẠI.
     */
    const t = Math.floor(Date.now() / 1000);
    const ma = otpLuc(t);
    const chung = { userId: SUP_ID, secret: SECRET_2FA, token: ma, nowMs: t * 1000 };
    expect((await verifyTotpOnce({ ...chung, luot: "L1" })).hopLe, "lượt verify #1 của lượt gọi L1").toBe(true);
    expect((await verifyTotpOnce({ ...chung, luot: "L1" })).hopLe, "lượt verify #2 của CÙNG lượt gọi L1").toBe(true);
    expect((await verifyTotpOnce({ ...chung, luot: "L1" })).hopLe, "lượt verify #3 của CÙNG lượt gọi L1").toBe(true);
    const khacLuot = await verifyTotpOnce({ ...chung, luot: "L2" });
    expect(khacLuot.hopLe, "một lượt gọi KHÁC với cùng mã ⇒ PHÁT LẠI").toBe(false);
    expect(khacLuot.phatLai, "và nó phải tự khai là phát lại, không im lặng").toBe(true);
  });

  it("★★★ hai lượt `preempt` liên tiếp, mỗi lượt MỘT mã MỚI ⇒ cả hai QUA (không chặn oan)", async () => {
    const l1 = xinThat("sidecar:vision", 1_000 * MIB);
    sidecar.stop = async () => {
      broker.release(l1);
      return true;
    };
    await expect(vram(phienMoi()).preempt({ owner: "sidecar:vision", totpCode: otp() })).resolves.toBeDefined();
    const l2 = xinThat("sidecar:vision", 1_000 * MIB);
    sidecar.stop = async () => {
      broker.release(l2);
      return true;
    };
    const maMoi = otpLuc(Math.floor(Date.now() / 1000) + 30);
    await expect(vram(phienMoi()).preempt({ owner: "sidecar:vision", totpCode: maMoi })).resolves.toBeDefined();
  });
});
