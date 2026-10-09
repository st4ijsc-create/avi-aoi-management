import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";
import { adminProcedure } from "./_shared";
import { safeInternalPath } from "@shared/internalPath";

// ============= NOTIFICATION ROUTER =============
export const notificationRouter = router({
  list: protectedProcedure
    .input(z.object({
      type: z.enum(['ALERT', 'REPORT', 'SYSTEM', 'INFO', 'WARNING', 'SUCCESS']).optional(),
      isRead: z.boolean().optional(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      // doc 81 Đợt 3b Task 3 (Review Focus #2) — chỉ đường NỘI BỘ tương đối mới tới client; còn lại ⇒ null
      // (hàng cũ / ghi thẳng vào bảng không qua sendNotification). Client lọc lần nữa trước khi điều hướng.
      const rows = await db.getNotifications(ctx.user.id, input);
      // final wave: `actionUrlBlocked` — hàng CÓ link nhưng server đã chặn ⇒ chuông báo "liên kết không hợp lệ" (trước: link
      // về null, client không phân biệt được với hàng không có link ⇒ bấm là im lặng).
      return rows.map((n) => {
        const actionUrl = safeInternalPath(n.actionUrl);
        return { ...n, actionUrl, actionUrlBlocked: n.actionUrl != null && n.actionUrl !== "" && actionUrl == null };
      });
    }),

  // doc 81 Đợt 3c Task 1 (R-3c-a) — `priority` TUỲ CHỌN: chuông lúc "tạm tắt" chỉ đếm mục KHẨN (URGENT). Không truyền ⇒ như cũ.
  unreadCount: protectedProcedure
    .input(z.object({ priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return db.getUnreadNotificationCount(ctx.user.id, input?.priority);
    }),

  markAsRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.markNotificationAsRead(input.id, ctx.user.id);
      const { emitNotificationRead } = await import('../services/notificationService');
      emitNotificationRead(ctx.user.id, input.id);
      return { success: true };
    }),

  markAllAsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      await db.markAllNotificationsAsRead(ctx.user.id);
      const { emitAllNotificationsRead } = await import('../services/notificationService');
      emitAllNotificationsRead(ctx.user.id);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteNotification(input.id, ctx.user.id);
      return { success: true };
    }),

  deleteOld: protectedProcedure
    .input(z.object({ daysOld: z.number().min(1).max(365).optional() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteOldNotifications(ctx.user.id, input?.daysOld || 30);
      return { success: true };
    }),

  // Notification preferences
  getPreferences: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getUserNotificationPreferences(ctx.user.id);
    }),

  updatePreferences: protectedProcedure
    .input(z.object({
      emailEnabled: z.boolean().optional(),
      emailAlerts: z.boolean().optional(),
      emailReports: z.boolean().optional(),
      emailSystem: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      pushAlerts: z.boolean().optional(),
      pushReports: z.boolean().optional(),
      pushSystem: z.boolean().optional(),
      inAppEnabled: z.boolean().optional(),
      inAppAlerts: z.boolean().optional(),
      inAppReports: z.boolean().optional(),
      inAppSystem: z.boolean().optional(),
      soundEnabled: z.boolean().optional(),
      quietHoursEnabled: z.boolean().optional(),
      quietHoursStart: z.string().optional(),
      quietHoursEnd: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.upsertUserNotificationPreferences(ctx.user.id, input);
      return { success: true };
    }),

  // Admin: send notification to user
  sendToUser: adminProcedure
    .input(z.object({
      userId: z.number(),
      type: z.enum(['ALERT', 'REPORT', 'SYSTEM', 'INFO', 'WARNING', 'SUCCESS']),
      title: z.string(),
      message: z.string(),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
    }))
    .mutation(async ({ input }) => {
      const { sendNotification } = await import('../services/notificationService');
      return sendNotification(input.userId, {
        type: input.type,
        title: input.title,
        message: input.message,
        priority: input.priority,
      });
    }),

  // Admin: broadcast notification to all users
  broadcast: adminProcedure
    .input(z.object({
      type: z.enum(['ALERT', 'REPORT', 'SYSTEM', 'INFO', 'WARNING', 'SUCCESS']),
      title: z.string(),
      message: z.string(),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
    }))
    .mutation(async ({ input }) => {
      const users = await db.getUsers();
      const userIds = users.map(u => u.id);
      const { sendBroadcastNotification } = await import('../services/notificationService');
      return sendBroadcastNotification(userIds, {
        type: input.type,
        title: input.title,
        message: input.message,
        priority: input.priority,
      });
    }),
});
