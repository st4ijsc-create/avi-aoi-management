/**
 * Notification Service - Quản lý thông báo real-time qua Socket.io
 */

import { Server as SocketIOServer } from 'socket.io';
import {
  createNotification,
  broadcastNotification,
  getUserNotificationPreferences,
  getUnreadNotificationCount,
} from '../db';
// doc69 W1 "modelfix" — shared env→GGUF-basename resolver; the digest/personalization calls below
// must PIN a text model (un-pinned calls used to land on the 0.6B RAG embedder → repetition garbage).
import { resolveLogicalModel } from './ai/modelResolver';
// ★ G5-E — bộ cắt chuỗi suy luận (module LÁ, import TĨNH ⇒ hàng rào vô điều kiện theo cấu tạo).
import { stripThinking } from './ai/thinkingStrip';
// ★ doc 80 PLT-01 — phân quyền vào phòng socket (một nơi duy nhất, dùng chung với socket.ts).
import { duocVaoPhongNguoiDung, moTaSocket } from '../_core/socketPhongQuyen';
import { safeInternalPath } from '@shared/internalPath';

// Store Socket.io server instance
let io: SocketIOServer | null = null;

// Map userId to socket IDs
const userSockets = new Map<number, Set<string>>();

export function initNotificationService(socketServer: SocketIOServer) {
  io = socketServer;
  
  io.on('connection', (socket) => {
    // Handle user authentication
    socket.on('auth:user', (userId: number) => {
      if (!userId) return;
      // ★ doc 80 PLT-01 — trước bản vá MỌI socket (kể cả `machine` vô danh) tự khai userId bất kỳ
      // là vào `user:{id}` và đọc thông báo của người khác. Chỉ socket người dùng, chỉ phòng của mình.
      if (!duocVaoPhongNguoiDung(socket.data, userId)) {
        console.warn(`[Notification] ${socket.id} TU CHOI join user:${userId} - ${moTaSocket(socket.data)}`);
        return;
      }
      
      // Add socket to user's set
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId)?.add(socket.id);
      
      // Join user-specific room
      socket.join(`user:${userId}`);
      
      console.log(`[Notification] User ${userId} connected (socket: ${socket.id})`);
      
      // Send unread count on connect
      getUnreadNotificationCount(userId).then(count => {
        socket.emit('notification:unread_count', { count });
      });
    });
    
    socket.on('disconnect', () => {
      // Remove socket from all user sets
      for (const [userId, sockets] of Array.from(userSockets.entries())) {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            userSockets.delete(userId);
          }
          console.log(`[Notification] User ${userId} disconnected (socket: ${socket.id})`);
          break;
        }
      }
    });
  });
}

export interface NotificationPayload {
  type: 'ALERT' | 'REPORT' | 'SYSTEM' | 'INFO' | 'WARNING' | 'SUCCESS';
  title: string;
  message: string;
  entityType?: string;
  entityId?: number;
  actionUrl?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  metadata?: Record<string, any>;
}

/**
 * doc 81 Đợt 5 task F6 (item 33) — how a notification is delivered.
 * `safetyCritical: true` (exactly `true`) — a SAFETY-CRITICAL notice: delivered whatever the recipient's in-app opt-outs
 * (inAppEnabled / inAppAlerts / inAppReports / inAppSystem) and quiet hours say (quiet hours already let URGENT through;
 * a safety notice must not hinge on a personal preference). The preferences are not even read, so a failing preference
 * read cannot drop it. Only SERVER code sets this argument; it is never taken from the payload, and the stored
 * `metadata.safetyCritical` marker is written only here (a payload claiming it has the marker removed).
 * Callers — the ONLY ones (ruling R-5-f): commandDispatcher raiseStopUnverifiedAlarm (B3 "STOP not confirmed") and
 * orchestration rulesEngine onSafetyEvent for the explicit allow-list isSafetyCriticalSafetyEvent.
 * Fix 1 (R-5-f) + fix scan (R-5-h) — the BYPASS is throttled per recipient and `dedupKey` = the caller's OCCURRENCE
 * identity (type, machine, event / command id): at most once per SAFETY_CRITICAL_DEDUP_MS (60 s). A repeat of the SAME
 * occurrence inside the window is still delivered, as a NORMAL notice (the recipient's preferences apply) — never
 * dropped. Distinct occurrences (another type, another machine, a re-trip = a new event) never share a key. Without a
 * dedupKey there is no throttle (nothing is ever merged).
 */
export interface SendNotificationOptions {
  safetyCritical?: boolean;
  /** "(type, machine)" identity of a safety-critical notice for the bypass throttle. */
  dedupKey?: string;
}

export const SAFETY_CRITICAL_DEDUP_MS = 60_000;
const safetyCriticalLastBypass = new Map<string, number>();
/** true ⇔ this (recipient, key) may bypass now (and records it). */
export const SAFETY_CRITICAL_DEDUP_MAX = 5000;
/**
 * fix scan (R-5-h) — the throttle only ever DOWNGRADES (a repeat inside the window is delivered as a normal notice);
 * it never drops one. Any failure here ⇒ true (bypass, i.e. deliver). Bounded: entries older than the window are swept
 * when the map passes SAFETY_CRITICAL_DEDUP_MAX; if it is still full, it is cleared (fails toward delivering).
 */
function takeSafetyCriticalBypass(userId: number, key: string, now = Date.now()): boolean {
  try {
    const k = `${userId}|${key}`;
    const last = safetyCriticalLastBypass.get(k);
    if (last !== undefined && now - last >= 0 && now - last < SAFETY_CRITICAL_DEDUP_MS) return false;
    safetyCriticalLastBypass.set(k, now);
    if (safetyCriticalLastBypass.size > SAFETY_CRITICAL_DEDUP_MAX) {
      for (const [kk, t] of safetyCriticalLastBypass) if (now - t >= SAFETY_CRITICAL_DEDUP_MS) safetyCriticalLastBypass.delete(kk);
      if (safetyCriticalLastBypass.size > SAFETY_CRITICAL_DEDUP_MAX) safetyCriticalLastBypass.clear();
    }
    return true;
  } catch {
    return true;
  }
}
export function _safetyCriticalDedupSizeForTests(): number {
  return safetyCriticalLastBypass.size;
}
/** Test seam — forget every bypass timestamp. */
export function _resetSafetyCriticalDedupForTests(): void {
  safetyCriticalLastBypass.clear();
}

/**
 * Send notification to a specific user
 */
export async function sendNotification(userId: number, payload: NotificationPayload, opts: SendNotificationOptions = {}) {
  const safetyCritical =
    opts?.safetyCritical === true &&
    (typeof opts.dedupKey === "string" && opts.dedupKey ? takeSafetyCriticalBypass(userId, opts.dedupKey) : true);
  const { safetyCritical: _claimed, ...ownMetadata } = (payload.metadata ?? {}) as Record<string, any>;
  const metadata = safetyCritical ? { ...ownMetadata, safetyCritical: true } : payload.metadata ? ownMetadata : undefined;

  // Check user preferences (a safety-critical notice skips them — Đợt 5 F6)
  const prefs = safetyCritical ? null : await getUserNotificationPreferences(userId);
  
  // Check if in-app notifications are enabled
  if (prefs && !prefs.inAppEnabled) {
    return null;
  }
  
  // Check specific type preferences
  if (prefs) {
    if (payload.type === 'ALERT' && !prefs.inAppAlerts) return null;
    if (payload.type === 'REPORT' && !prefs.inAppReports) return null;
    if (payload.type === 'SYSTEM' && !prefs.inAppSystem) return null;
  }
  
  // Check quiet hours
  if (prefs?.quietHoursEnabled) {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const start = prefs.quietHoursStart || '22:00';
    const end = prefs.quietHoursEnd || '07:00';
    
    // Check if current time is within quiet hours
    if (start < end) {
      // Normal range (e.g., 08:00 - 18:00)
      if (currentTime >= start && currentTime < end) {
        // Only allow URGENT notifications during quiet hours
        if (payload.priority !== 'URGENT') return null;
      }
    } else {
      // Overnight range (e.g., 22:00 - 07:00)
      if (currentTime >= start || currentTime < end) {
        if (payload.priority !== 'URGENT') return null;
      }
    }
  }
  
  // doc 81 Đợt 3b Task 3 (Review Focus #2) — chỉ ghi đường NỘI BỘ tương đối; URL ngoài / "//" / scheme ⇒ null.
  const actionUrl = safeInternalPath(payload.actionUrl) ?? undefined;

  // Create notification in database
  const result = await createNotification({
    userId,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    entityType: payload.entityType,
    entityId: payload.entityId,
    actionUrl,
    priority: payload.priority || 'NORMAL',
    metadata,
  });
  
  if (!result) return null;
  
  // Send real-time notification via Socket.io
  if (io) {
    const notification = {
      id: result.id,
      ...payload,
      metadata,
      actionUrl,
      createdAt: new Date().toISOString(),
      isRead: false,
    };
    
    io.to(`user:${userId}`).emit('notification:new', notification);
    
    // Update unread count
    const count = await getUnreadNotificationCount(userId);
    io.to(`user:${userId}`).emit('notification:unread_count', { count });
  }
  
  return result;
}

/**
 * Send notification to multiple users
 */
export async function sendBroadcastNotification(userIds: number[], payload: NotificationPayload) {
  const results: number[] = [];
  
  for (const userId of userIds) {
    const result = await sendNotification(userId, payload);
    if (result) {
      results.push(result.id);
    }
  }
  
  return results;
}

/**
 * Send alert notification
 */
export async function sendAlertNotification(userId: number, data: {
  title: string;
  message: string;
  alertId?: number;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  actionUrl?: string;
}) {
  return sendNotification(userId, {
    type: 'ALERT',
    title: data.title,
    message: data.message,
    entityType: 'alert',
    entityId: data.alertId,
    priority: data.priority || 'HIGH',
    actionUrl: data.actionUrl || '/alerts',
  });
}

/**
 * Send report notification
 */
export async function sendReportNotification(userId: number, data: {
  title: string;
  message: string;
  reportId?: number;
  actionUrl?: string;
}) {
  return sendNotification(userId, {
    type: 'REPORT',
    title: data.title,
    message: data.message,
    entityType: 'report',
    entityId: data.reportId,
    priority: 'NORMAL',
    actionUrl: data.actionUrl || '/scheduled-reports',
  });
}

/**
 * Send system notification
 */
export async function sendSystemNotification(userId: number, data: {
  title: string;
  message: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}, opts: SendNotificationOptions = {}) {
  return sendNotification(userId, {
    type: 'SYSTEM',
    title: data.title,
    message: data.message,
    priority: data.priority || 'NORMAL',
  }, opts);
}

/**
 * Emit notification read event
 */
export function emitNotificationRead(userId: number, notificationId: number) {
  if (io) {
    io.to(`user:${userId}`).emit('notification:read', { id: notificationId });
    
    // Update unread count
    getUnreadNotificationCount(userId).then(count => {
      io?.to(`user:${userId}`).emit('notification:unread_count', { count });
    });
  }
}

/**
 * Emit all notifications read event
 */
export function emitAllNotificationsRead(userId: number) {
  if (io) {
    io.to(`user:${userId}`).emit('notification:all_read');
    io.to(`user:${userId}`).emit('notification:unread_count', { count: 0 });
  }
}

/**
 * Get online user count
 */
export function getOnlineUserCount(): number {
  return userSockets.size;
}

/**
 * Check if user is online
 */
export function isUserOnline(userId: number): boolean {
  return userSockets.has(userId) && (userSockets.get(userId)?.size || 0) > 0;
}

// ─── AI Notification Summary ────────────────────────────────────────────────

/**
 * Generate AI-powered summary for a batch of notifications.
 * Useful for daily digests or when a user has many unread notifications.
 * Non-blocking — returns null on any failure.
 */
export async function generateNotificationSummary(
  notifications: Array<{ type: string; title: string; message: string; priority?: string; createdAt?: string }>,
): Promise<string | null> {
  if (notifications.length === 0) return null;

  try {
    const { generateText } = await import('./aiGgufEngine');

    const notifList = notifications.slice(0, 20).map((n, i) =>
      `${i + 1}. [${n.type}${n.priority ? '/' + n.priority : ''}] ${n.title}: ${n.message}`
    ).join('\n');

    const response = await generateText({
      systemPrompt: `You are a factory notification assistant. Summarize a batch of notifications into a concise digest (2-4 sentences). Highlight urgent items first, then group related alerts. Use clear, actionable language.`,
      prompt: `Summarize these ${notifications.length} notifications:\n${notifList}`,
      maxTokens: 256,
      temperature: 0.5,
    }, resolveLogicalModel('chat'));

    // ★ G5-E — đây là THÂN THÔNG BÁO đẩy tới điện thoại / bảng Andon: bề mặt hiển thị dễ quên
    // nhất trong 12 chỗ, vì không ai gọi nó là "màn hình AI". Cắt chuỗi suy luận trước khi trả.
    return stripThinking(response.text ?? '').answer.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Personalize notification content based on user role.
 * Operators get actionable steps, supervisors get summary + impact, managers get KPI impact.
 * Non-blocking — returns original payload on failure.
 */
export async function personalizeNotificationForRole(
  payload: NotificationPayload,
  role: 'operator' | 'supervisor' | 'manager' | 'admin',
): Promise<NotificationPayload> {
  if (role === 'admin') return payload; // admins get raw data

  try {
    const { generateText } = await import('./aiGgufEngine');

    const response = await generateText({
      systemPrompt: `You are a factory notification system. Rewrite the notification message for a ${role}.
- Operator: focus on what to do RIGHT NOW, specific machine/station actions.
- Supervisor: focus on impact scope, which lines/machines affected, delegation.
- Manager: focus on KPI impact, trend context, strategic implications.
Reply in JSON: { "title": string, "message": string }`,
      prompt: `Original notification:\nType: ${payload.type}, Priority: ${payload.priority || 'NORMAL'}\nTitle: ${payload.title}\nMessage: ${payload.message}\n${payload.metadata ? 'Context: ' + JSON.stringify(payload.metadata).slice(0, 500) : ''}`,
      maxTokens: 200,
      temperature: 0.3,
      jsonMode: true,
    }, resolveLogicalModel('chat'));

    const parsed = JSON.parse(response.text);
    if (parsed.title && parsed.message) {
      return { ...payload, title: parsed.title, message: parsed.message };
    }
    return payload;
  } catch {
    return payload;
  }
}
