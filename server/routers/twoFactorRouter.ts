import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import speakeasy from "speakeasy";
// ★★★ Pha 6 Task 6 — MỌI lượt xác minh TOTP đi qua sổ mã đã tiêu (chống phát lại). `speakeasy`
// ở file này nay **chỉ** còn dùng để **SINH** secret (`generateSecret`), không để verify.
import { verifyTotpOnce } from "../_core/totpOnce";
import QRCode from "qrcode";
import { getDb } from "../db";
import { users, backupCodes } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
// ★★★ Pha 7 Task 8a — sinh/băm/đối chiếu mã dự phòng có **MỘT chủ**. Ba hàm cục bộ ở đây trước
// bản vá là ba bản sao của ba vị từ đã có chủ; bản sao thứ hai của một vị từ là chỗ luật trôi đi.
import { sinhMaDuPhong, bamMaDuPhong, khopMaDuPhong } from "../_core/backupCodeSecret";

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

    // Store the secret temporarily (not enabled yet)
    await db
      .update(users)
      .set({ twoFactorSecret: secret.base32 })
      .where(eq(users.id, ctx.user.id));

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
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      // Get user's secret
      const user = await db
        .select({
          twoFactorSecret: users.twoFactorSecret,
          twoFactorEnabled: users.twoFactorEnabled,
        })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

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

      // Generate backup codes
      const plainBackupCodes: string[] = [];
      for (let i = 0; i < 10; i++) {
        plainBackupCodes.push(sinhMaDuPhong());
      }

      // Delete any existing backup codes
      await db
        .delete(backupCodes)
        .where(eq(backupCodes.userId, ctx.user.id));

      // Store hashed backup codes
      for (const code of plainBackupCodes) {
        const hashedCode = await bamMaDuPhong(code);
        await db.insert(backupCodes).values({
          userId: ctx.user.id,
          code: hashedCode,
          isUsed: false,
        });
      }

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

  // Disable 2FA
  disable: protectedProcedure
    .input(z.object({ code: z.string() })) // Can be TOTP or backup code
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      // Get user's secret
      const user = await db
        .select({
          twoFactorSecret: users.twoFactorSecret,
          twoFactorEnabled: users.twoFactorEnabled,
        })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user[0]) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, "User not found");
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

      // Disable 2FA and clear secret
      await db
        .update(users)
        .set({
          twoFactorEnabled: false,
          twoFactorSecret: null,
        })
        .where(eq(users.id, ctx.user.id));

      // Delete all backup codes
      await db
        .delete(backupCodes)
        .where(eq(backupCodes.userId, ctx.user.id));

      return {
        success: true,
        message: "2FA has been disabled",
      };
    }),

  // Verify TOTP code (for login)
  verify: protectedProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      const user = await db
        .select({
          twoFactorSecret: users.twoFactorSecret,
          twoFactorEnabled: users.twoFactorEnabled,
        })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

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
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      const user = await db
        .select({
          twoFactorSecret: users.twoFactorSecret,
          twoFactorEnabled: users.twoFactorEnabled,
        })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

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

      // Generate new backup codes
      const plainBackupCodes: string[] = [];
      for (let i = 0; i < 10; i++) {
        plainBackupCodes.push(sinhMaDuPhong());
      }

      // Delete existing backup codes
      await db
        .delete(backupCodes)
        .where(eq(backupCodes.userId, ctx.user.id));

      // Store new hashed backup codes
      for (const code of plainBackupCodes) {
        const hashedCode = await bamMaDuPhong(code);
        await db.insert(backupCodes).values({
          userId: ctx.user.id,
          code: hashedCode,
          isUsed: false,
        });
      }

      return {
        success: true,
        backupCodes: plainBackupCodes,
        message: "Backup codes regenerated successfully",
      };
    }),
});

export default twoFactorRouter;
