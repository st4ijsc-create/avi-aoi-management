import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import * as db from "../db";

// ============ USER ROUTER ============
export const userRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
    }
    return db.getAllUsers();
  }),

  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const user = await db.getUserById(input.id);
      if (!user) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'Không tìm thấy người dùng');
      }
      // Don't return passwordHash
      const { passwordHash, ...safeUser } = user;
      return safeUser;
    }),

  search: adminProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      const users = await db.searchUsers(input.query);
      return users.map(u => {
        const { passwordHash, ...safeUser } = u;
        return safeUser;
      });
    }),

  create: adminProcedure
    .input(z.object({
      username: z.string().min(3).max(100),
      password: z.string().min(6).max(100),
      name: z.string().min(1).max(255),
      email: z.string().email().optional(),
      phone: z.string().max(20).optional(),
      department: z.string().max(100).optional(),
      position: z.string().max(100).optional(),
      role: z.enum(['user', 'admin']).default('user'),
    }))
    .mutation(async ({ input }) => {
      // Check if username already exists
      const existing = await db.getUserByUsername(input.username);
      if (existing) {
        throw appError('CONFLICT', 'ENTITY_DUPLICATE', { entity: 'user', field: 'username' }, 'Tên đăng nhập đã tồn tại');
      }
      
      // Hash password
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(input.password, 10);
      
      const { password, ...userData } = input;
      const result = await db.createLocalUser({
        ...userData,
        passwordHash,
      });
      
      await db.createAuditLog({ action: 'user_create', entityType: 'user', entityId: result.id, entityName: input.username, details: { role: input.role } }).catch(() => {});
      return { success: true, id: result.id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      email: z.string().email().optional().nullable(),
      phone: z.string().max(20).optional().nullable(),
      department: z.string().max(100).optional().nullable(),
      position: z.string().max(100).optional().nullable(),
      role: z.enum(['user', 'admin']).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...inputData } = input;
      
      // Prevent admin from deactivating themselves
      if (id === ctx.user.id && inputData.isActive === false) {
        throw appError('BAD_REQUEST', 'PERMISSION_DENIED', { action: 'disableOwnAccount' }, 'Không thể vô hiệu hóa tài khoản của chính mình');
      }
      
      // Prevent admin from changing their own role
      if (id === ctx.user.id && inputData.role && inputData.role !== ctx.user.role) {
        throw appError('BAD_REQUEST', 'PERMISSION_DENIED', { action: 'changeOwnRole' }, 'Không thể thay đổi vai trò của chính mình');
      }
      
      // Convert null to undefined for db.updateUser
      const data: Parameters<typeof db.updateUser>[1] = {
        name: inputData.name,
        email: inputData.email ?? undefined,
        phone: inputData.phone ?? undefined,
        department: inputData.department ?? undefined,
        position: inputData.position ?? undefined,
        role: inputData.role,
        isActive: inputData.isActive,
      };
      
      await db.updateUser(id, data);
      await db.createAuditLog({ userId: ctx.user.id, userName: ctx.user.name, action: 'user_update', entityType: 'user', entityId: id, details: { fields: Object.keys(inputData).filter(k => (inputData as Record<string,unknown>)[k] !== undefined) } }).catch(() => {});
      return { success: true };
    }),

  updatePassword: adminProcedure
    .input(z.object({
      id: z.number(),
      newPassword: z.string().min(6).max(100),
    }))
    .mutation(async ({ input }) => {
      const user = await db.getUserById(input.id);
      if (!user) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'Không tìm thấy người dùng');
      }
      
      // Only local users can have password changed
      if (user.loginMethod !== 'local') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ có thể đổi mật khẩu cho tài khoản nội bộ' });
      }
      
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(input.newPassword, 10);
      await db.updateUserPassword(input.id, passwordHash);
      
      return { success: true };
    }),

  updateRole: protectedProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(['user', 'admin']),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
      }
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot change your own role' });
      }
      await db.updateUserRole(input.userId, input.role);
      await db.createAuditLog({ userId: ctx.user.id, userName: ctx.user.name, action: 'user_update_role', entityType: 'user', entityId: input.userId, details: { newRole: input.role } }).catch(() => {});
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({
      userId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
      }
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete yourself' });
      }
      await db.deleteUser(input.userId);
      await db.createAuditLog({ userId: ctx.user.id, userName: ctx.user.name, action: 'user_delete', entityType: 'user', entityId: input.userId }).catch(() => {});
      return { success: true };
    }),

  // User self-service: update own profile
  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255).optional(),
      email: z.string().email().optional(),
      phone: z.string().max(20).optional(),
      department: z.string().max(100).optional(),
      position: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.updateUser(ctx.user.id, input);
      return { success: true };
    }),

  // User self-service: change own password
  changePassword: protectedProcedure
    .input(z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(6).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.getUserById(ctx.user.id);
      if (!user) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'Không tìm thấy người dùng');
      }
      
      // Only local users can change password
      if (user.loginMethod !== 'local' || !user.passwordHash) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ tài khoản nội bộ mới có thể đổi mật khẩu' });
      }
      
      // Verify current password
      const bcrypt = await import('bcryptjs');
      const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!isValid) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mật khẩu hiện tại không đúng' });
      }
      
      // Hash and save new password
      const newPasswordHash = await bcrypt.hash(input.newPassword, 10);
      await db.updateUserPassword(ctx.user.id, newPasswordHash);
      
      return { success: true };
    }),

  // 2FA Setup - Generate secret and QR code
  // Standardised on speakeasy (audit A bug #2): the whole codebase now uses ONE
  // TOTP library. otplib's generateSecret() also emitted base32, so the secret
  // ENCODING is identical — users enrolled under the old otplib path keep
  // working when verified by speakeasy with { encoding: 'base32' }.
  setup2FA: protectedProcedure
    .mutation(async ({ ctx }) => {
      const speakeasy = (await import('speakeasy')).default;
      const QRCode = await import('qrcode');

      // Generate base32 secret (same encoding the old otplib path produced).
      const user = await db.getUserById(ctx.user.id);
      const appName = 'SYNAPSE';
      const accountName = user?.username || user?.email || `user_${ctx.user.id}`;
      const generated = speakeasy.generateSecret({
        name: `${appName}:${accountName}`,
        issuer: appName,
        length: 32,
      });
      const secret = generated.base32;

      // Save secret to database (not enabled yet)
      await db.setup2FA(ctx.user.id, secret);

      const otpauth = generated.otpauth_url || '';
      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

      return {
        secret,
        qrCode: qrCodeDataUrl,
        otpauth,
      };
    }),

  // 2FA Verify and Enable
  verify2FA: protectedProcedure
    .input(z.object({
      token: z.string().length(6),
    }))
    .mutation(async ({ ctx, input }) => {
      const speakeasy = (await import('speakeasy')).default;

      // Get user's 2FA secret
      const status = await db.get2FAStatus(ctx.user.id);
      if (!status?.twoFactorSecret) {
        throw appError('BAD_REQUEST', 'TWO_FACTOR_NOT_SET_UP', undefined, 'Chưa thiết lập 2FA. Vui lòng thiết lập trước.');
      }

      // Verify token (base32 encoding, ±1 step for clock drift)
      const valid = speakeasy.totp.verify({
        secret: status.twoFactorSecret,
        encoding: 'base32',
        token: input.token,
        window: 1,
      });

      if (!valid) {
        throw appError('BAD_REQUEST', 'INVALID_VALUE', { field: 'twoFactorCode' }, 'Mã xác thực không hợp lệ');
      }

      // Enable 2FA
      await db.enable2FA(ctx.user.id);

      return { success: true };
    }),

  // 2FA Disable
  disable2FA: protectedProcedure
    .input(z.object({
      token: z.string().length(6),
      password: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const speakeasy = (await import('speakeasy')).default;
      const bcrypt = await import('bcryptjs');

      // Get user
      const user = await db.getUserById(ctx.user.id);
      if (!user) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'Không tìm thấy người dùng');
      }

      // Verify password for local users
      if (user.loginMethod === 'local' && user.passwordHash) {
        const isValidPassword = await bcrypt.compare(input.password, user.passwordHash);
        if (!isValidPassword) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mật khẩu không đúng' });
        }
      }

      // Get 2FA status
      const status = await db.get2FAStatus(ctx.user.id);
      if (!status?.twoFactorEnabled || !status.twoFactorSecret) {
        throw appError('BAD_REQUEST', 'TWO_FACTOR_NOT_SET_UP', undefined, '2FA chưa được bật');
      }

      // Verify token
      const valid = speakeasy.totp.verify({
        secret: status.twoFactorSecret,
        encoding: 'base32',
        token: input.token,
        window: 1,
      });

      if (!valid) {
        throw appError('BAD_REQUEST', 'INVALID_VALUE', { field: 'twoFactorCode' }, 'Mã xác thực không hợp lệ');
      }

      // Disable 2FA
      await db.disable2FA(ctx.user.id);

      return { success: true };
    }),

  // Get 2FA status
  get2FAStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const status = await db.get2FAStatus(ctx.user.id);
      return {
        enabled: status?.twoFactorEnabled || false,
        hasSecret: !!status?.twoFactorSecret,
      };
    }),

  // Generate backup codes
  generateBackupCodes: protectedProcedure
    .mutation(async ({ ctx }) => {
      const crypto = await import('crypto');
      
      // Generate 10 backup codes
      const codes: string[] = [];
      for (let i = 0; i < 10; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        codes.push(code);
      }
      
      await db.generateBackupCodes(ctx.user.id, codes);
      
      return { codes };
    }),

  // Get backup codes status
  getBackupCodesStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const count = await db.getUnusedBackupCodesCount(ctx.user.id);
      return { unusedCount: count };
    }),

  // Get user sessions
  getSessions: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getUserSessions(ctx.user.id);
    }),

  // Revoke a session
  revokeSession: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.revokeSession(input.sessionId, ctx.user.id);
      return { success: true };
    }),

  // Revoke all other sessions. The caller's current session is resolved
  // server-side from ctx.sessionToken (canonical), so revoking never logs the
  // caller out of their own session (audit A bug #3). Delegates to the same
  // db helpers as sessionRouter.
  revokeAllSessions: protectedProcedure
    .mutation(async ({ ctx }) => {
      let currentSessionId: number | undefined;
      if (ctx.sessionToken) {
        const current = await db.getSessionByToken(ctx.sessionToken);
        if (current && current.userId === ctx.user.id) {
          currentSessionId = current.id;
        }
      }
      await db.revokeAllSessions(ctx.user.id, currentSessionId);
      return { success: true };
    }),
});

// ============ USER ASSIGNMENT ROUTER ============
export const userAssignmentRouter = router({
  // Get current user's assignments
  getMyAssignments: protectedProcedure
    .query(async ({ ctx }) => {
      const corporates = await db.getUserCorporateAssignments(ctx.user.id);
      const factories = await db.getUserFactoryAssignments(ctx.user.id);
      return { corporates, factories };
    }),

  // Get all users with their assignments (admin only)
  getAllUserAssignments: adminProcedure
    .query(async () => {
      const users = await db.getUsers();
      const result = [];
      for (const user of users) {
        const corporates = await db.getUserCorporateAssignments(user.id);
        const factories = await db.getUserFactoryAssignments(user.id);
        result.push({ user, corporates, factories });
      }
      return result;
    }),

  // Assign user to corporate (admin only)
  assignCorporate: adminProcedure
    .input(z.object({
      userId: z.number(),
      corporateCode: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.createCorporateAssignment({
        userId: input.userId,
        corporateCode: input.corporateCode,
        assignedBy: ctx.user.id,
      });
    }),

  // Assign user to factory (admin only)
  assignFactory: adminProcedure
    .input(z.object({
      userId: z.number(),
      factoryCode: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.createFactoryAssignment({
        userId: input.userId,
        factoryCode: input.factoryCode,
        assignedBy: ctx.user.id,
      });
    }),

  // Remove corporate assignment (admin only)
  removeCorporateAssignment: adminProcedure
    .input(z.object({
      userId: z.number(),
      corporateCode: z.string(),
    }))
    .mutation(async ({ input }) => {
      return db.deleteCorporateAssignment(input.userId, input.corporateCode);
    }),

  // Remove factory assignment (admin only)
  removeFactoryAssignment: adminProcedure
    .input(z.object({
      userId: z.number(),
      factoryCode: z.string(),
    }))
    .mutation(async ({ input }) => {
      return db.deleteFactoryAssignment(input.userId, input.factoryCode);
    }),

  // Reassign corporate (admin only)
  reassignCorporate: adminProcedure
    .input(z.object({
      userId: z.number(),
      oldCorporateCode: z.string(),
      newCorporateCode: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.reassignCorporate(input.userId, input.oldCorporateCode, input.newCorporateCode, ctx.user.id);
    }),

  // Reassign factory (admin only)
  reassignFactory: adminProcedure
    .input(z.object({
      userId: z.number(),
      oldFactoryCode: z.string(),
      newFactoryCode: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.reassignFactory(input.userId, input.oldFactoryCode, input.newFactoryCode, ctx.user.id);
    }),
});

// ============ USER SETTINGS ROUTER ============
export const userSettingsRouter = router({
  get: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getUserSettings(ctx.user.id);
    }),

  update: protectedProcedure
    .input(z.object({
      language: z.string().optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
      timezone: z.string().optional(),
      dateFormat: z.string().optional(),
      timeFormat: z.string().optional(),
      numberFormat: z.string().optional(),
      defaultDashboardTab: z.string().optional(),
      sidebarCollapsed: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.upsertUserSettings(ctx.user.id, input);
      return { success: true };
    }),
});
