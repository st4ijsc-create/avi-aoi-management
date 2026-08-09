import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import * as db from "../db";
// ★★★ Pha 7 Task 7 — chủ DUY NHẤT của "cột nào của `users` được rời máy chủ".
// ⚠ Bốn thủ tục dưới đây từng là **thứ nguy hơn `auth.me`**: `list` và
//   `userAssignment.getAllUserAssignments` trả hàng thô của **MỌI** người dùng ⇒ một tài khoản
//   admin bị chiếm lấy được **hạt giống 2FA của tất cả**, kể cả các admin khác. `getById`/`search`
//   dùng **danh sách CẤM một phần tử** (`const { passwordHash, ...safeUser }`) nên
//   **`twoFactorSecret` vẫn ra** — đúng lớp *"phần tử thứ N+1"*.
import { toPublicUser, toPublicUsers, type KhongMangBiMat } from "../_core/publicUser";
// ★★★ Pha 8 Task 5 — chủ DUY NHẤT của "cột nào của `user_sessions` được rời máy chủ".
import { toPublicSessions, type PublicSession } from "../_core/publicSession";
// ★★★ Pha 7 / vá NHÀ TÙ I-4 — chủ DUY NHẤT của khái niệm "tài khoản xác thực nội bộ".
// ⚠ Ba điểm gọi dưới đây từng mỗi chỗ tự so `loginMethod !== 'local'`, trong khi dữ liệu THẬT mang
//   `'password'` ⇒ 4/4 tài khoản không-admin đang hoạt động bị khoá ra ngoài. Xem `shared/xacThucNoiBo.ts`.
import { laXacThucNoiBo } from "@shared/xacThucNoiBo";

// ============ USER ROUTER ============
export const userRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== 'admin') {
      throw appError('FORBIDDEN', 'PERMISSION_DENIED', { action: 'listUsers' }, 'Admin only');
    }
    return toPublicUsers(await db.getAllUsers());
  }),

  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const user = await db.getUserById(input.id);
      if (!user) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'Không tìm thấy người dùng');
      }
      return toPublicUser(user);
    }),

  search: adminProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      const users = await db.searchUsers(input.query);
      return toPublicUsers(users);
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
        throw appError('CONFLICT', 'ENTITY_DUPLICATE', { entity: 'user' }, 'Tên đăng nhập đã tồn tại');
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
      
      // Chỉ tài khoản xác thực NỘI BỘ mới có mật khẩu để đặt lại — hỏi chủ duy nhất, KHÔNG so chuỗi.
      if (!laXacThucNoiBo(user.loginMethod)) {
        throw appError('BAD_REQUEST', 'OPERATION_FAILED', { operation: 'resetUserPassword' }, 'Chỉ có thể đổi mật khẩu cho tài khoản nội bộ');
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
        throw appError('FORBIDDEN', 'PERMISSION_DENIED', { action: 'changeUserRole' }, 'Admin only');
      }
      if (input.userId === ctx.user.id) {
        throw appError('BAD_REQUEST', 'PERMISSION_DENIED', { action: 'changeOwnRole' }, 'Cannot change your own role');
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
        throw appError('FORBIDDEN', 'PERMISSION_DENIED', { action: 'deleteUser' }, 'Admin only');
      }
      if (input.userId === ctx.user.id) {
        throw appError('BAD_REQUEST', 'PERMISSION_DENIED', { action: 'deleteOwnAccount' }, 'Cannot delete yourself');
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
    .mutation(async ({ ctx, input }): Promise<KhongMangBiMat<{ success: boolean }>> => {
      const user = await db.getUserById(ctx.user.id);
      if (!user) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'Không tìm thấy người dùng');
      }
      
      // ★★★ Pha 7 Task 9 (9c) — hash nay ở `user_secrets`, đọc qua CỬA DUY NHẤT.
      const biMat = await db.layBiMatNguoiDung(user.id);

      // ★★★ Vá NHÀ TÙ I-4 — ĐÂY là cửa đã nhốt 4/4 tài khoản không-admin. Hỏi chủ duy nhất.
      if (!laXacThucNoiBo(user.loginMethod) || !biMat.passwordHash) {
        throw appError('BAD_REQUEST', 'OPERATION_FAILED', { operation: 'changeOwnPassword' }, 'Chỉ tài khoản nội bộ mới có thể đổi mật khẩu');
      }

      // Verify current password
      const bcrypt = await import('bcryptjs');
      const isValid = await bcrypt.compare(input.currentPassword, biMat.passwordHash);
      if (!isValid) {
        throw appError('BAD_REQUEST', 'INVALID_VALUE', { field: 'currentPassword' }, 'Mật khẩu hiện tại không đúng');
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
      /**
       * ★★★ Pha 7 / review TOÀN NHÁNH **C-1** — HÀNG RÀO BẮT BUỘC TRƯỚC MỌI LƯỢT GHI HẠT GIỐNG.
       *
       * ⚠⚠⚠ Thủ tục này là `protectedProcedure` ⇒ nó chỉ đòi **một phiên hợp lệ**. Không mật khẩu,
       * không OTP, không `requirePerCallFreshTotp`. Trước hàng rào này nó **ghi đè**
       * `user_secrets.twoFactorSecret` **và trả secret mới về cho người gọi**, trong khi cờ
       * `users.two_factor_enabled` **giữ nguyên `true`**. Đo được (đột biến review):
       *   `2FA đang bật=true · secret ĐỔI=true · cờ 2FA sau=true`
       *   `mã do KẺ TẤN CÔNG sinh qua verifyTotpOnce: hopLe=true`
       * ⇒ **một phiên bị chiếm là đủ để tự cấp hạt giống mới**, rồi tự sinh mã hợp lệ cho MỌI cổng
       *   step-up của Pha 4–7 (`requirePerCallFreshTotp` · vé một-lần · sổ `totp_consumed` ·
       *   `vram.preempt`/`releaseStale`). Kẻ tấn công **không cần ĐỌC** bí mật — nó **GHI**.
       *
       * ⚠ Đây **KHÔNG** phải một luật mới: tuyến SONG SONG `twoFactor.generateSecret`
       *   (`server/routers/twoFactorRouter.ts:80-82`) đã có đúng hàng rào này từ trước. Cặp tuyến
       *   song song thứ BA (`twoFactor.generateSecret` ≡ `user.setup2FA`) là cặp mà phép đếm ở
       *   `server/_core/totpOnce.ts:20-24` **SÓT**, và nó chính là cặp **hai bản sao BẤT ĐỒNG**.
       * ⚠ Lượng từ cưỡng chế câu này nằm ở `server/routers/totpSeedWriteScan.test.ts` — **∀ điểm
       *   ghi hạt giống TOTP trong `server/**` phải có hàng rào**, để cặp song song thứ TƯ không
       *   sinh ra im lặng.
       *
       * ⚠⚠ Hàng rào **chỉ chặn người ĐÃ BẬT**: người chưa bật 2FA vẫn đăng ký được (đúng nghĩa
       *    "thu hẹp"), và người đã bật **giữ nguyên hạt giống đang dùng** — đường đổi hợp lệ là
       *    `user.disable2FA` (đòi **mật khẩu + OTP**) rồi thiết lập lại.
       */
      if (user?.twoFactorEnabled) {
        throw appError(
          'BAD_REQUEST',
          'OPERATION_FAILED',
          { operation: 'regenerateTwoFactorSecret' },
          '2FA đã được bật. Hãy tắt 2FA trước khi tạo lại hạt giống.',
        );
      }
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
    .mutation(async ({ ctx, input }): Promise<KhongMangBiMat<{ success: boolean }>> => {
      // ★★★ Pha 6 Task 6 — MỌI lượt xác minh TOTP đi qua sổ mã đã tiêu (chống phát lại).
      const { verifyTotpOnce } = await import('../_core/totpOnce');

      // Get user's 2FA secret
      const status = await db.get2FAStatus(ctx.user.id);
      if (!status?.twoFactorSecret) {
        // Review round 1 (M-5) — verify2FA(): người dùng đang CỐ BẬT 2FA, cần chỉ
        // đường đi thiết lập (KHÁC disable2FA() bên dưới — giữ câu trần ở đó, vì
        // "đi thiết lập" ngược ý định khi người dùng đang TẮT 2FA).
        throw appError('BAD_REQUEST', 'TWO_FACTOR_NOT_SET_UP', { reason: 'setUpInSecuritySettings' }, 'Chưa thiết lập 2FA. Vui lòng thiết lập trước.');
      }

      // Verify token (base32 encoding, ±1 step for clock drift) — và TIÊU MÃ (Pha 6 Task 6).
      const valid = (await verifyTotpOnce({
        userId: ctx.user.id,
        secret: status.twoFactorSecret,
        token: input.token,
      })).hopLe;

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
    .mutation(async ({ ctx, input }): Promise<KhongMangBiMat<{ success: boolean }>> => {
      // ★★★ Pha 6 Task 6 — MỌI lượt xác minh TOTP đi qua sổ mã đã tiêu (chống phát lại).
      const { verifyTotpOnce } = await import('../_core/totpOnce');
      const bcrypt = await import('bcryptjs');

      // Get user
      const user = await db.getUserById(ctx.user.id);
      if (!user) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'Không tìm thấy người dùng');
      }

      // Verify password for local users — hash ở `user_secrets` (Pha 7 Task 9).
      // ⚠ Vá NHÀ TÙ I-4 khép luôn một lỗ theo chiều MỞ ở đây: với `loginMethod = 'password'` (4 tài
      //   khoản đang chạy) vị từ cũ cho `false` ⇒ lượt tắt 2FA **bỏ qua** phép kiểm mật khẩu hoàn
      //   toàn. Nay cùng một chủ trả lời ⇒ có hash thì PHẢI đúng mật khẩu mới tắt được 2FA.
      const biMat = await db.layBiMatNguoiDung(user.id);
      if (laXacThucNoiBo(user.loginMethod) && biMat.passwordHash) {
        const isValidPassword = await bcrypt.compare(input.password, biMat.passwordHash);
        if (!isValidPassword) {
          throw appError('BAD_REQUEST', 'INVALID_VALUE', { field: 'password' }, 'Mật khẩu không đúng');
        }
      }

      // Get 2FA status
      const status = await db.get2FAStatus(ctx.user.id);
      if (!status?.twoFactorEnabled || !status.twoFactorSecret) {
        throw appError('BAD_REQUEST', 'TWO_FACTOR_NOT_SET_UP', undefined, '2FA chưa được bật');
      }

      // Verify token — và TIÊU MÃ (Pha 6 Task 6).
      const valid = (await verifyTotpOnce({
        userId: ctx.user.id,
        secret: status.twoFactorSecret,
        token: input.token,
      })).hopLe;

      if (!valid) {
        throw appError('BAD_REQUEST', 'INVALID_VALUE', { field: 'twoFactorCode' }, 'Mã xác thực không hợp lệ');
      }

      // Disable 2FA
      await db.disable2FA(ctx.user.id);

      /**
       * ★★★ Pha 8 Task 5 — **LƯỢT DỌN BỊ THIẾU Ở ĐÚNG BÊN NÀY CỦA CẶP SONG SONG.**
       *
       * ⚠⚠⚠ Trước bản vá, tuyến này tắt 2FA rồi **DỪNG**, trong khi tuyến SONG SONG
       * `twoFactor.disable` (`server/routers/twoFactorRouter.ts:238-241`) còn `DELETE backup_codes`.
       * Hệ quả đo được: **10 mã dự phòng vẫn SỐNG** sau khi người dùng "đã tắt 2FA" — và mã dự
       * phòng là **vật liệu xác minh ĐỘC LẬP với hạt giống TOTP**, nên chúng vẫn tiêu được ở
       * `twoFactor.verify` và ở `POST /api/auth/verify-2fa`, **kể cả sau khi người dùng bật lại 2FA
       * bằng một hạt giống HOÀN TOÀN MỚI**. Một tờ giấy mã dự phòng bị lộ không có cách nào thu hồi
       * qua đường này.
       * ⚠ `disable2FA()` **KHÔNG** làm hộ: nó chỉ chạm `users.two_factor_enabled` và
       *   `user_secrets.twoFactorSecret` (xem `server/db/auth.ts`).
       */
      await db.xoaMoiMaDuPhong(ctx.user.id);

      return { success: true };
    }),

  // Get 2FA status
  /**
   * ★★★ Pha 7 / review TOÀN NHÁNH **C-2** — **CỔNG KIỂU trên `user_secrets`.**
   *
   * ⚠⚠⚠ Kiểu trả về được **KHAI TƯỜNG MINH** `KhongMangBiMat<…>`, và đó là cả điểm: đây **chính
   * là** thủ tục mà đột biến của lượt review dùng để chứng minh lỗ —
   *     `twoFactorSecret: status?.twoFactorSecret ?? null`  ⇒ `npm run check` SẠCH, 58/58 XANH.
   * Sau khi có phần giao `{ [K in ServerOnlyUserSecretField]?: never }`, đúng dòng ấy là một **LỖI
   * BIÊN DỊCH**. Cổng ấy **SUY RA** từ `USER_SECRETS_FIELD_VISIBILITY`, nên một cột bí mật **thứ
   * BA** thêm vào `user_secrets` ngày mai tự vào cổng — không cần ai nhớ sửa file này.
   * ⚠ `hasSecret` là ô **SUY RA** (`!!`), không phải cột được mở — đúng khuôn `mustChangePassword`
   *   của QĐ-1: client biết *"đã có hạt giống chưa"* mà **không** cần thấy hạt giống.
   */
  get2FAStatus: protectedProcedure
    .query(async ({ ctx }): Promise<KhongMangBiMat<{ enabled: boolean; hasSecret: boolean }>> => {
      const status = await db.get2FAStatus(ctx.user.id);
      return {
        enabled: status?.twoFactorEnabled || false,
        hasSecret: !!status?.twoFactorSecret,
      };
    }),

  // ★★★ Pha 7 Task 8a — `user.generateBackupCodes` ĐÃ BỊ XOÁ (đường ghi PLAINTEXT, và **không**
  // đòi TOTP, nên nó còn là đường vòng qua phép step-up của `twoFactor.regenerateBackupCodes`).
  // Đường ghi mã dự phòng **duy nhất** nay là `twoFactor.enable` / `twoFactor.regenerateBackupCodes`.
  // Client: `client/src/components/TwoFactorSetup.tsx`.

  // Get backup codes status
  getBackupCodesStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const count = await db.getUnusedBackupCodesCount(ctx.user.id);
      return { unusedCount: count };
    }),

  /**
   * ★★★ Pha 8 Task 5 — **CẶP SONG SONG THỨ TƯ, và bên này là bên HỞ.**
   *
   * ⚠⚠⚠ Trước bản vá, thân thủ tục là `return db.getUserSessions(ctx.user.id);` — một `db.select()`
   * **không phép chiếu** ⇒ **NGUYÊN HÀNG** `user_sessions` rời máy chủ, **kể cả `sessionToken`**.
   * Cột ấy là **khoá phiên**: `db.getSessionByToken` tra bằng nó, `_core/sdk.ts` đọc cookie ra nó để
   * dựng danh tính. Ai đọc được response này **là** người dùng ấy, **trên mọi thiết bị** — không
   * chỉ thiết bị đang mở. Và thủ tục đang được client gọi thật
   * (`client/src/pages/SessionManagement.tsx:63`).
   *
   * ⚠ Tuyến **SONG SONG** `session.list` (`server/routers/sessionRouter.ts:22`) chiếu **tường minh**
   *   và **không** trả token — tức luật đã đúng ở một bên và sai ở bên kia, **không ai canh**. Đây
   *   chính là hình dạng mà lượng từ §4 của `server/routers/hoTuyenSongSong.test.ts` sinh ra để bắt:
   *   ***∀ đơn vị xử lý trả kết quả một phép đọc THÔ trên bảng tài nguyên xác thực ⇒ VI PHẠM.***
   *
   * ⚠⚠ Bản vá đi qua **chủ duy nhất** `_core/publicSession.ts` (allow-list + cổng KIỂU), không phải
   *    một `delete row.sessionToken` tại chỗ: một cột nhạy cảm **thứ hai** thêm vào bảng ngày mai
   *    phải **không ra được**, chứ không phải chờ ai đó nhớ xoá nó.
   */
  getSessions: protectedProcedure
    .query(async ({ ctx }): Promise<PublicSession[]> => {
      return toPublicSessions(await db.getUserSessions(ctx.user.id), ctx.sessionToken);
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
        result.push({ user: toPublicUser(user), corporates, factories });
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
