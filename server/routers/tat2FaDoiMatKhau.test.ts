/**
 * ★★★ Pha 8 — **HÀNH VI: TẮT 2FA LUÔN ĐÒI MẬT KHẨU, VÀ ĐƯỜNG MÃ DỰ PHÒNG VẪN SỐNG.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 *   ***∀ tuyến tắt 2FA: mật khẩu SAI ⇒ 2FA vẫn BẬT. Mật khẩu ĐÚNG + một yếu tố 2FA hợp lệ
 *   (TOTP **HOẶC** mã dự phòng) ⇒ 2FA TẮT.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO PHẢI CÓ LƯỚI **HÀNH VI** BÊN CẠNH `hoTuyenSongSong.test.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `hoTuyenSongSong.test.ts` là lưới **HÌNH DẠNG**: nó **đọc** mã và trả lời *"hai tuyến có MANG
 * cùng bộ phép kiểm không"*. Nó **không** trả lời *"phép kiểm ấy có THẬT SỰ chối trên mọi nhánh
 * không"*. `if (true) return …` đã **ship được** qua một lưới quét mã đầy đủ ở pha trước. Ô §1–§2
 * dưới đây **gọi thật** `twoFactor.disable` và đọc trạng thái `users.two_factor_enabled` sau đó.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ §3 LÀ Ô CHỐNG **NHÀ TÙ** — VÀ NÓ QUAN TRỌNG NGANG Ô CHỐNG KẺ TẤN CÔNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chủ dự án chọn **SIẾT**, **không** chọn **XOÁ TUYẾN**. Cách vá "tiện tay" — đổi `code` thành
 * `z.string().length(6)` cho khớp `user.disable2FA` — sẽ làm cổng hình dạng XANH **và khoá vĩnh
 * viễn người mất điện thoại ra ngoài**: họ không còn đường nào tắt 2FA. Pha 7 đã deploy đúng lớp
 * lỗi ấy ra **nhà tù thật 4/4 tài khoản**. §3 gọi `disable` bằng **mã dự phòng** + mật khẩu đúng và
 * đòi 2FA TẮT ⇒ một lượt "siết" quá tay làm ô này ĐỎ ngay.
 *
 * ⚠ THỨ TỰ PHÉP KIỂM CŨNG LÀ MỘT BẤT BIẾN (§2): mật khẩu được đối chiếu **TRƯỚC** khi mã 2FA bị
 *   tiêu. Nếu đảo lại, một lượt gõ sai mật khẩu vẫn **đốt mất** mã TOTP/mã dự phòng của người dùng
 *   (sổ chống phát lại của Pha 6 Task 6 đánh dấu mã đã tiêu) — kẻ tấn công không cần đúng mật khẩu
 *   vẫn bào mòn được vật liệu xác thực của nạn nhân.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import speakeasy from "speakeasy";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import type { User } from "../../drizzle/schema";
import { backupCodes } from "../../drizzle/schema";
import { bamMaDuPhong } from "../_core/backupCodeSecret";
import * as db from "../db";

/** Mật khẩu THẬT của người dùng dựng riêng cho lưới này (không phải tài khoản nào đang chạy). */
const MAT_KHAU = "MatKhauDungCuaLuoi#8";
const MAT_KHAU_SAI = "MatKhauSaiHoanToan#9";
/** Mã dự phòng thô — ⚠ chữ HOA, vì `disable` chuẩn hoá bằng `.toUpperCase()`. */
const MA_DU_PHONG = "ZQ7T4M2K";

/** Một người dùng dùng-một-lần: 2FA đã BẬT, có hạt giống thật và 1 mã dự phòng còn sống. */
async function dungNguoiDung(hau: string): Promise<{ uid: number; secret: string }> {
  const bcrypt = await import("bcryptjs");
  const r = await db.createLocalUser({
    username: `pha8_tat2fa_${hau}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    passwordHash: await bcrypt.hash(MAT_KHAU, 10),
    name: "Pha 8 — tắt 2FA đòi mật khẩu",
    role: "user",
  });
  const secret = speakeasy.generateSecret({ length: 32 }).base32;
  await db.setup2FA(r.id, secret);
  await db.enable2FA(r.id);

  const conn = await db.getDb();
  if (!conn) throw new Error("cầu chì: không có DB — mọi ô dưới sẽ là chân lý rỗng");
  await conn.insert(backupCodes).values({
    userId: r.id,
    code: await bamMaDuPhong(MA_DU_PHONG),
    isUsed: false,
  });
  return { uid: r.id, secret };
}

async function ctxCua(uid: number): Promise<TrpcContext> {
  const hang = await db.getUserById(uid);
  return {
    user: hang as unknown as User,
    sessionToken: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  };
}

const donDep: number[] = [];
afterAll(async () => {
  for (const uid of donDep) await db.deleteUser(uid);
});

describe("★★★ Pha 5/8 — HÀNH VI: `twoFactor.disable` đòi MẬT KHẨU + một yếu tố 2FA", () => {
  let neo = 0;

  beforeAll(async () => {
    const { uid } = await dungNguoiDung("cauchi");
    neo = uid;
    donDep.push(uid);
  });

  it("★★★ cầu chì — người dùng dựng được, 2FA ĐANG BẬT, mã dự phòng còn sống", async () => {
    expect(neo, "không dựng được người dùng ⇒ mọi ô dưới là chân lý rỗng").toBeGreaterThan(0);
    const st = await db.get2FAStatus(neo);
    expect(st?.twoFactorEnabled, "cầu chì: 2FA phải ĐANG BẬT trước khi đo lượt tắt").toBe(true);
    expect(st?.twoFactorSecret, "cầu chì: phải có hạt giống thật").toBeTruthy();
    expect(Number(await db.getUnusedBackupCodesCount(neo)), "cầu chì: phải còn đúng 1 mã dự phòng").toBe(1);
  }, 30_000);

  it("★★★★ §1 — MẬT KHẨU SAI + TOTP ĐÚNG ⇒ CHỐI, và 2FA vẫn BẬT", async () => {
    const { uid, secret } = await dungNguoiDung("saimk");
    donDep.push(uid);
    const token = speakeasy.totp({ secret, encoding: "base32" });

    await expect(
      appRouter.createCaller(await ctxCua(uid)).twoFactor.disable({ code: token, password: MAT_KHAU_SAI }),
      "MẬT KHẨU SAI mà 2FA vẫn tắt được ⇒ ai cầm phiên đã đăng nhập (cookie trộm / máy bỏ ngỏ) hạ\n" +
        "được yếu tố thứ hai mà không cần biết mật khẩu. Đây chính là tuyến LỎNG của cặp song song.",
    ).rejects.toThrow(TRPCError);

    const st = await db.get2FAStatus(uid);
    expect(st?.twoFactorEnabled, "2FA phải VẪN BẬT sau một lượt sai mật khẩu").toBe(true);
  }, 30_000);

  it("★★★★ §2 — mật khẩu sai KHÔNG được đốt mã 2FA (mật khẩu phải kiểm TRƯỚC)", async () => {
    const { uid, secret } = await dungNguoiDung("thutu");
    donDep.push(uid);
    const token = speakeasy.totp({ secret, encoding: "base32" });

    // Lượt 1: sai mật khẩu, ĐÚNG mã TOTP.
    await expect(
      appRouter.createCaller(await ctxCua(uid)).twoFactor.disable({ code: token, password: MAT_KHAU_SAI }),
    ).rejects.toThrow(TRPCError);

    // Lượt 2: ĐÚNG mật khẩu, **cùng mã TOTP ấy**. Nếu lượt 1 đã tiêu mã, lượt này chối ⇒ ĐỎ.
    await appRouter.createCaller(await ctxCua(uid)).twoFactor.disable({ code: token, password: MAT_KHAU });

    const st = await db.get2FAStatus(uid);
    expect(
      st?.twoFactorEnabled,
      "một lượt gõ SAI MẬT KHẨU đã ĐỐT mất mã 2FA của người dùng ⇒ kẻ tấn công không cần đúng mật\n" +
        "khẩu vẫn bào mòn được vật liệu xác thực của nạn nhân. Kiểm mật khẩu phải đứng TRƯỚC.",
    ).toBe(false);
  }, 30_000);

  it("★★★★ §3 — CHỐNG NHÀ TÙ: mật khẩu ĐÚNG + MÃ DỰ PHÒNG ⇒ 2FA TẮT", async () => {
    const { uid } = await dungNguoiDung("maduphong");
    donDep.push(uid);

    await appRouter.createCaller(await ctxCua(uid)).twoFactor.disable({
      code: MA_DU_PHONG,
      password: MAT_KHAU,
    });

    const st = await db.get2FAStatus(uid);
    expect(
      st?.twoFactorEnabled,
      "NGƯỜI MẤT ĐIỆN THOẠI KHÔNG CÒN ĐƯỜNG TẮT 2FA.\n" +
        "⚠ Chủ dự án chọn SIẾT, KHÔNG chọn XOÁ TUYẾN. Nếu ô này đỏ vì `input.code` đã bị siết\n" +
        "  thành `z.string().length(6)`, thì bản vá vừa dựng một NHÀ TÙ — đúng lớp lỗi đã deploy\n" +
        "  ra 4/4 tài khoản ở Pha 7.",
    ).toBe(false);
    expect(Number(await db.getUnusedBackupCodesCount(uid)), "lượt tắt phải DỌN sạch mã dự phòng").toBe(0);
  }, 30_000);

  it("★★★ §4 — ĐỐI CHỨNG DƯƠNG: mật khẩu ĐÚNG + TOTP ⇒ 2FA TẮT", async () => {
    const { uid, secret } = await dungNguoiDung("totp");
    donDep.push(uid);
    const token = speakeasy.totp({ secret, encoding: "base32" });

    await appRouter.createCaller(await ctxCua(uid)).twoFactor.disable({ code: token, password: MAT_KHAU });

    const st = await db.get2FAStatus(uid);
    expect(st?.twoFactorEnabled, "đường hợp lệ nhất của tuyến này phải đi được").toBe(false);
    expect(st?.twoFactorSecret, "hạt giống phải bị xoá cùng lượt").toBeFalsy();
  }, 30_000);

  it("★★★★ §5 — hợp đồng: THIẾU `password` ⇒ chối ở tầng `input`, không lọt vào thân", async () => {
    const { uid, secret } = await dungNguoiDung("thieumk");
    donDep.push(uid);
    const token = speakeasy.totp({ secret, encoding: "base32" });

    await expect(
      // @ts-expect-error — CỐ Ý: hợp đồng cũ (chỉ `code`) phải KHÔNG còn biên dịch được.
      appRouter.createCaller(await ctxCua(uid)).twoFactor.disable({ code: token }),
      "hợp đồng cũ vẫn gọi được ⇒ `password` là tuỳ chọn trên thực tế, và tuyến lỏng vẫn sống",
    ).rejects.toThrow();

    const st = await db.get2FAStatus(uid);
    expect(st?.twoFactorEnabled, "2FA phải VẪN BẬT sau một lượt thiếu mật khẩu").toBe(true);
  }, 30_000);
});
