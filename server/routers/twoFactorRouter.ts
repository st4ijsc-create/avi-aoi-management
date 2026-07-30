import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getDb } from "../db";
import { users, backupCodes } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

// Generate a random backup code
function generateBackupCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// Hash a backup code for storage
async function hashBackupCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

// Verify a backup code
async function verifyBackupCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

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
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "2FA is already enabled. Disable it first to regenerate.",
      });
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "2FA is already enabled",
        });
      }

      if (!user[0].twoFactorSecret) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Please generate a secret first",
        });
      }

      // Verify the TOTP code
      const verified = speakeasy.totp.verify({
        secret: user[0].twoFactorSecret,
        encoding: "base32",
        token: input.code,
        window: 1, // Allow 1 step before/after for clock drift
      });

      if (!verified) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid verification code. Please try again.",
        });
      }

      // Generate backup codes
      const plainBackupCodes: string[] = [];
      for (let i = 0; i < 10; i++) {
        plainBackupCodes.push(generateBackupCode());
      }

      // Delete any existing backup codes
      await db
        .delete(backupCodes)
        .where(eq(backupCodes.userId, ctx.user.id));

      // Store hashed backup codes
      for (const code of plainBackupCodes) {
        const hashedCode = await hashBackupCode(code);
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "2FA is not enabled",
        });
      }

      // Try to verify as TOTP first
      let verified = false;
      if (input.code.length === 6 && /^\d+$/.test(input.code)) {
        verified = speakeasy.totp.verify({
          secret: user[0].twoFactorSecret || "",
          encoding: "base32",
          token: input.code,
          window: 1,
        });
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
          if (await verifyBackupCode(input.code.toUpperCase(), backupCode.code)) {
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid code. Please enter a valid TOTP or backup code.",
        });
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "2FA is not enabled for this account",
        });
      }

      // Try TOTP first
      let verified = false;
      if (input.code.length === 6 && /^\d+$/.test(input.code)) {
        verified = speakeasy.totp.verify({
          secret: user[0].twoFactorSecret,
          encoding: "base32",
          token: input.code,
          window: 1,
        });
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
          if (await verifyBackupCode(input.code.toUpperCase(), backupCode.code)) {
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
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid verification code",
        });
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "2FA is not enabled",
        });
      }

      // Verify TOTP
      const verified = speakeasy.totp.verify({
        secret: user[0].twoFactorSecret,
        encoding: "base32",
        token: input.code,
        window: 1,
      });

      if (!verified) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid verification code",
        });
      }

      // Generate new backup codes
      const plainBackupCodes: string[] = [];
      for (let i = 0; i < 10; i++) {
        plainBackupCodes.push(generateBackupCode());
      }

      // Delete existing backup codes
      await db
        .delete(backupCodes)
        .where(eq(backupCodes.userId, ctx.user.id));

      // Store new hashed backup codes
      for (const code of plainBackupCodes) {
        const hashedCode = await hashBackupCode(code);
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
