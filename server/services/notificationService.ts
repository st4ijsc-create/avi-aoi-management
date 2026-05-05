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
 * Send notification to a specific user
 */
export async function sendNotification(userId: number, payload: NotificationPayload) {
  // Check user preferences
  const prefs = await getUserNotificationPreferences(userId);
  
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
  
  // Create notification in database
  const result = await createNotification({
    userId,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    entityType: payload.entityType,
    entityId: payload.entityId,
    actionUrl: payload.actionUrl,
    priority: payload.priority || 'NORMAL',
    metadata: payload.metadata,
  });
  
  if (!result) return null;
  
  // Send real-time notification via Socket.io
  if (io) {
    const notification = {
      id: result.id,
      ...payload,
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
}) {
  return sendNotification(userId, {
    type: 'SYSTEM',
    title: data.title,
    message: data.message,
    priority: data.priority || 'NORMAL',
  });
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
    });

    return response.text?.trim() || null;
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
    });

    const parsed = JSON.parse(response.text);
    if (parsed.title && parsed.message) {
      return { ...payload, title: parsed.title, message: parsed.message };
    }
    return payload;
  } catch {
    return payload;
  }
}
