import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import speakeasy from "speakeasy";
// ★★★ Pha 6 Task 6 — MỌI lượt xác minh TOTP đi qua sổ mã đã tiêu (chống phát lại). `speakeasy`
// ở file này nay **chỉ** còn dùng để **SINH** secret (`generateSecret`), không để verify.
import { verifyTotpOnce } from "../_core/totpOnce";
import QRCode from "qrcode";
import { getDb, get2FAStatus, setup2FA, disable2FA, xoaMoiMaDuPhong, quayVongMaDuPhong, getUserById, layBiMatNguoiDung } from "../db";
// ★ Pha 8 — siết `disable` cho khớp tuyến song song `user.disable2FA`: đòi MẬT KHẨU + một yếu tố
//   2FA. Cùng vị từ, cùng NGƯỜI ĐỌC bí mật với tuyến kia (xem khối lý lẽ ở `disable`).
import bcrypt from "bcryptjs";
import { laXacThucNoiBo } from "@shared/xacThucNoiBo";
import { users, backupCodes } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
// ★★★ Pha 7 Task 9 (9c) — hạt giống TOTP đã rời `users` sang `user_secrets`. Router này KHÔNG
// truy vấn bảng bí mật trực tiếp: nó gọi `db.get2FAStatus` / `db.setup2FA` — **người đọc/người
// ghi DUY NHẤT**. Trước Task 9, năm chỗ trong chính file này tự viết `select({twoFactorSecret})`;
// năm bản sao của một vị từ là năm chỗ luật có thể trôi khỏi nhau.
// ★★★ Pha 7 Task 8a — sinh/băm/đối chiếu mã dự phòng có **MỘT chủ**. Ba hàm cục bộ ở đây trước
// bản vá là ba bản sao của ba vị từ đã có chủ; bản sao thứ hai của một vị từ là chỗ luật trôi đi.
import { sinhMaDuPhong, bamMaDuPhong, khopMaDuPhong } from "../_core/backupCodeSecret";
import type { KhongMangBiMat } from "../_core/publicUser";

export const twoFactorRouter = router({
  // Get 2FA status for current user
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
    }

    const user = await db
      .select({
        twoFactorEnabled: users.twoFactorEnabled,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user[0]) {
      throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, "User not found");
    }

    // Count remaining backup codes
    const codes = await db
      .select()
      .from(backupCodes)
      .where(
        and(
          eq(backupCodes.userId, ctx.user.id),
          eq(backupCodes.isUsed, false)
        )
      );

    return {
      enabled: user[0].twoFactorEnabled,
      backupCodesRemaining: codes.length,
    };
  }),

  // Generate TOTP secret and QR code for setup
  generateSecret: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
    }

    // Check if 2FA is already enabled
    const user = await db
      .select({
        twoFactorEnabled: users.twoFactorEnabled,
        email: users.email,
        name: users.name,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user[0]) {
      throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, "User not found");
    }

    if (user[0].twoFactorEnabled) {
      throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "regenerateTwoFactorSecret" }, "2FA is already enabled. Disable it first to regenerate.");
    }

    // Generate new TOTP secret
    const secret = speakeasy.generateSecret({
      name: `SYNAPSE:${user[0].email || user[0].name || ctx.user.openId}`,
      issuer: "SYNAPSE",
      length: 32,
    });

    // Store the secret temporarily (not enabled yet) — `user_secrets` (Pha 7 Task 9).
    await setup2FA(ctx.user.id, secret.base32);

    // Generate QR code
    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url || "");

    return {
      secret: secret.base32,
      qrCode: qrCodeDataUrl,
      otpauthUrl: secret.otpauth_url,
    };
  }),

  // Verify TOTP code and enable 2FA
  enable: protectedProcedure
    .input(z.object({ code: z.string().length(6) }))
    .mutation(async ({ ctx, input }): Promise<KhongMangBiMat<{ success: boolean; backupCodes: string[]; message: string }>> => {
      const db = await getDb();
      if (!db) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      // Get user's secret — qua NGƯỜI ĐỌC DUY NHẤT (Pha 7 Task 9).
      const user = [await get2FAStatus(ctx.user.id)];

      if (!user[0]) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, "User not found");
      }

      if (user[0].twoFactorEnabled) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "enableTwoFactor" }, "2FA is already enabled");
      }

      if (!user[0].twoFactorSecret) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "enableTwoFactor" }, "Please generate a secret first");
      }

      // Verify the TOTP code — MỘT LẦN (Pha 6 Task 6: mã tiêu rồi thì không dùng lại được).
      const verified = (await verifyTotpOnce({
        userId: ctx.user.id,
        secret: user[0].twoFactorSecret,
        token: input.code,
      })).hopLe;

      if (!verified) {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "twoFactorCode" }, "Invalid verification code. Please try again.");
      }

      // ★ Pha 9 A4 — qua NGƯỜI CẤP DUY NHẤT (`db.quayVongMaDuPhong`): sinh + dọn bộ cũ + băm + ghi.
      const plainBackupCodes = await quayVongMaDuPhong(ctx.user.id);

      // Enable 2FA
      await db
        .update(users)
        .set({ twoFactorEnabled: true })
        .where(eq(users.id, ctx.user.id));

      return {
        success: true,
        backupCodes: plainBackupCodes, // Return plain codes only once
        message: "2FA enabled successfully. Save your backup codes securely!",
      };
    }),

  /**
   * ★★★ Pha 8 — **SIẾT CHO KHỚP TUYẾN CHẶT** (chủ dự án duyệt 2026-08-10).
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ BẤT ĐỒNG ĐO ĐƯỢC: HAI TUYẾN SONG SONG, KẺ TẤN CÔNG CHỌN TUYẾN LỎNG
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Trước bản vá, tuyến này đòi **một** yếu tố (TOTP *hoặc* mã dự phòng) để tắt 2FA, trong khi
   * tuyến song song `user.disable2FA` (`server/routers/userRouters.ts:341`) đòi **mật khẩu + TOTP**.
   * Hai màn client dùng hai họ tuyến khác nhau nên **cả hai đều sống** ⇒ ai cầm được phiên đã đăng
   * nhập (cookie trộm / máy bỏ ngỏ) mà **không** biết mật khẩu vẫn tắt được 2FA qua đúng tuyến này.
   * `hoTuyenSongSong.test.ts` khai đây là *"bất đồng NGUY HIỂM CHƯA VÁ"* và chờ chủ dự án vì vá là
   * **đổi hợp đồng API**.
   *
   * ⚠ **GIỮ ĐƯỜNG MÃ DỰ PHÒNG — CHỦ DỰ ÁN CHỌN *SIẾT*, KHÔNG CHỌN *XOÁ TUYẾN*.** Người mất điện
   *   thoại vẫn phải tắt được 2FA bằng mã dự phòng; nay kèm mật khẩu. Đổi `input.code` thành
   *   `z.string().length(6)` (chỉ TOTP) là **KHOÁ NGƯỜI DÙNG RA NGOÀI** — đúng lớp lỗi đã đẻ ra
   *   nhà tù 4/4 tài khoản ở Pha 7. Sau bản vá, người **đang có** 2FA và **biết** mật khẩu tắt được
   *   bằng **CẢ HAI** loại mã.
   *
   * ⚠ Vị từ mật khẩu chép **đúng** hình dạng của tuyến song song (`laXacThucNoiBo(loginMethod) ∧
   *   passwordHash`), không chặt hơn: tài khoản SSO không có hash cục bộ nên đòi mật khẩu ở đó
   *   cũng là một cánh cửa khoá chết.
   */
  disable: protectedProcedure
    .input(z.object({
      code: z.string(), // Can be TOTP or backup code — ⚠ GIỮ NGUYÊN, xem khối trên.
      password: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }): Promise<KhongMangBiMat<{ success: boolean; message: string }>> => {
      const db = await getDb();
      if (!db) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      // Get user's secret — qua NGƯỜI ĐỌC DUY NHẤT (Pha 7 Task 9).
      const user = [await get2FAStatus(ctx.user.id)];

      if (!user[0]) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, "User not found");
      }

      // ★ Mật khẩu — hash ở `user_secrets` (Pha 7 Task 9), cùng NGƯỜI ĐỌC với tuyến song song.
      const hoSo = await getUserById(ctx.user.id);
      if (!hoSo) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, "User not found");
      }
      const biMat = await layBiMatNguoiDung(ctx.user.id);
      /**
       * ⚠⚠ **HỆ QUẢ ĐƯỢC NÓI RA** (review TOÀN NHÁNH Pha 8 · M-3): với tài khoản **KHÔNG** xác thực
       * nội bộ (SSO/OIDC — không có hash cục bộ), vế mật khẩu này **KHÔNG chạy**, nên lượt tắt 2FA
       * chỉ cần **MỘT** yếu tố (mã TOTP/dự phòng), trong khi `z.string().min(1)` ở `input` làm hợp
       * đồng API **trông như** đòi hai.
       * ⚠ Vị từ vẫn ĐÚNG theo chủ ý đã khai — **chống NHÀ TÙ**: đòi một mật khẩu mà tài khoản ấy
       *   không có là khoá vĩnh viễn người dùng SSO khỏi tuyến này (Pha 7 đã ship một lần ra nhà tù
       *   thật 4/4 tài khoản). ⇒ **Không siết ở đây.** Lối siết đúng là **bước-up SSO** (re-auth
       *   OIDC) thay cho mật khẩu — một quyết định sản phẩm, cần chủ dự án.
       * ⚠ Về mặt lưới: hai tuyến (`twoFactor.disable` ≡ `user.disable2FA`) **KHỚP nhau** nên
       *   `hoTuyenSongSong` xanh — một ví dụ sạch của *"khớp TẬP mà cả hai cùng hở"*. Cặp ấy chỉ so
       *   **A với B**, không so **A với một chuẩn**; đừng đọc màu xanh của nó thành "đã đủ yếu tố".
       */
      if (laXacThucNoiBo(hoSo.loginMethod) && biMat.passwordHash) {
        const dungMatKhau = await bcrypt.compare(input.password, biMat.passwordHash);
        if (!dungMatKhau) {
          throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "password" }, "Incorrect password");
        }
      }

      if (!user[0].twoFactorEnabled) {
        throw appError("BAD_REQUEST", "TWO_FACTOR_NOT_SET_UP", undefined, "2FA is not enabled");
      }

      // Try to verify as TOTP first — MỘT LẦN (Pha 6 Task 6).
      // ⚠ Phát lại rơi xuống nhánh mã dự phòng bên dưới và **hỏng ở đó** (mã 6 số không khớp một
      //   backup code nào) ⇒ fail-closed, đúng chiều.
      let verified = false;
      if (input.code.length === 6 && /^\d+$/.test(input.code)) {
        verified = (await verifyTotpOnce({
          userId: ctx.user.id,
          secret: user[0].twoFactorSecret || "",
          token: input.code,
        })).hopLe;
      }

      // If not TOTP, try backup code
      if (!verified) {
        const codes = await db
          .select()
          .from(backupCodes)
          .where(
            and(
              eq(backupCodes.userId, ctx.user.id),
              eq(backupCodes.isUsed, false)
            )
          );

        for (const backupCode of codes) {
          if (await khopMaDuPhong(input.code.toUpperCase(), backupCode.code)) {
            verified = true;
            // Mark backup code as used
            await db
              .update(backupCodes)
              .set({ isUsed: true, usedAt: new Date() })
              .where(eq(backupCodes.id, backupCode.id));
            break;
          }
        }
      }

      if (!verified) {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "twoFactorCode" }, "Invalid code. Please enter a valid TOTP or backup code.");
      }

      // Disable 2FA and clear secret — MỘT giao dịch, hai bảng (Pha 7 Task 9).
      await disable2FA(ctx.user.id);

      // Delete all backup codes — ★ Pha 8 Task 5: qua NGƯỜI DỌN DUY NHẤT, để tuyến song song
      // `user.disable2FA` và tuyến này không còn hai bản sao của cùng một lượt dọn.
      await xoaMoiMaDuPhong(ctx.user.id);

      return {
        success: true,
        message: "2FA has been disabled",
      };
    }),

  // Verify TOTP code (for login)
  verify: protectedProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ ctx, input }): Promise<KhongMangBiMat<{ success: boolean; message: string }>> => {
      const db = await getDb();
      if (!db) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      // Qua NGƯỜI ĐỌC DUY NHẤT (Pha 7 Task 9 — hạt giống TOTP ở `user_secrets`).
      const user = [await get2FAStatus(ctx.user.id)];

      if (!user[0]) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, "User not found");
      }

      if (!user[0].twoFactorEnabled || !user[0].twoFactorSecret) {
        // Review round 1 (M-5) — verify(): người dùng đang CỐ XÁC THỰC 2FA, cần được
        // chỉ đường đi thiết lập (KHÁC disable() bên trên — giữ câu trần ở đó).
        throw appError("BAD_REQUEST", "TWO_FACTOR_NOT_SET_UP", { reason: "setUpInSecuritySettings" }, "2FA is not enabled for this account");
      }

      // Try TOTP first — MỘT LẦN (Pha 6 Task 6).
      let verified = false;
      if (input.code.length === 6 && /^\d+$/.test(input.code)) {
        verified = (await verifyTotpOnce({
          userId: ctx.user.id,
          secret: user[0].twoFactorSecret,
          token: input.code,
        })).hopLe;
      }

      // Try backup code
      if (!verified) {
        const codes = await db
          .select()
          .from(backupCodes)
          .where(
            and(
              eq(backupCodes.userId, ctx.user.id),
              eq(backupCodes.isUsed, false)
            )
          );

        for (const backupCode of codes) {
          if (await khopMaDuPhong(input.code.toUpperCase(), backupCode.code)) {
            verified = true;
            // Mark backup code as used
            await db
              .update(backupCodes)
              .set({ isUsed: true, usedAt: new Date() })
              .where(eq(backupCodes.id, backupCode.id));
            break;
          }
        }
      }

      if (!verified) {
        throw appError("UNAUTHORIZED", "INVALID_VALUE", { field: "twoFactorCode" }, "Invalid verification code");
      }

      return {
        success: true,
        message: "Verification successful",
      };
    }),

  // Regenerate backup codes
  regenerateBackupCodes: protectedProcedure
    .input(z.object({ code: z.string().length(6) })) // Require TOTP to regenerate
    .mutation(async ({ ctx, input }): Promise<KhongMangBiMat<{ success: boolean; backupCodes: string[]; message: string }>> => {
      const db = await getDb();
      if (!db) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      // Qua NGƯỜI ĐỌC DUY NHẤT (Pha 7 Task 9 — hạt giống TOTP ở `user_secrets`).
      const user = [await get2FAStatus(ctx.user.id)];

      if (!user[0]) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, "User not found");
      }

      if (!user[0].twoFactorEnabled || !user[0].twoFactorSecret) {
        // Review round 1 (M-5) — regenerateBackupCodes(): cần 2FA đã bật để tiếp tục,
        // chỉ đường đi thiết lập đúng ý định (KHÁC disable()).
        throw appError("BAD_REQUEST", "TWO_FACTOR_NOT_SET_UP", { reason: "setUpInSecuritySettings" }, "2FA is not enabled");
      }

      // Verify TOTP — MỘT LẦN (Pha 6 Task 6). Đường này sinh lại **10 mã dự phòng**: một mã OTP
      // trộm được mà tiêu lại được ở đây là một cửa hậu vĩnh viễn.
      const verified = (await verifyTotpOnce({
        userId: ctx.user.id,
        secret: user[0].twoFactorSecret,
        token: input.code,
      })).hopLe;

      if (!verified) {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "twoFactorCode" }, "Invalid verification code");
      }

      // ★ Pha 9 A4 — qua NGƯỜI CẤP DUY NHẤT (cùng chủ với `enable` và `user.verify2FA`).
      const plainBackupCodes = await quayVongMaDuPhong(ctx.user.id);

      return {
        success: true,
        backupCodes: plainBackupCodes,
        message: "Backup codes regenerated successfully",
      };
    }),
});

export default twoFactorRouter;
