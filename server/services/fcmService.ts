/**
 * Firebase Cloud Messaging Service
 * Gửi push notification cho các client offline khi có NG alert
 */

import { ENV } from '../_core/env';
import * as db from '../db';

// FCM Server Key từ Firebase Console
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY || '';
const FCM_API_URL = 'https://fcm.googleapis.com/fcm/send';

interface FCMMessage {
  to?: string;
  registration_ids?: string[];
  notification: {
    title: string;
    body: string;
    icon?: string;
    click_action?: string;
    sound?: string;
  };
  data?: Record<string, string>;
  priority?: 'high' | 'normal';
  time_to_live?: number;
}

interface FCMResponse {
  multicast_id: number;
  success: number;
  failure: number;
  results: Array<{
    message_id?: string;
    error?: string;
  }>;
}

/**
 * Gửi push notification qua FCM
 */
async function sendFCMNotification(message: FCMMessage): Promise<FCMResponse | null> {
  if (!FCM_SERVER_KEY) {
    console.log('[FCM] Server key not configured, skipping push notification');
    return null;
  }

  try {
    const response = await fetch(FCM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${FCM_SERVER_KEY}`,
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.error('[FCM] Failed to send notification:', response.status, response.statusText);
      return null;
    }

    const result = await response.json() as FCMResponse;
    console.log('[FCM] Notification sent:', result);
    return result;
  } catch (error) {
    console.error('[FCM] Error sending notification:', error);
    return null;
  }
}

/**
 * Gửi NG Alert push notification cho các client offline
 */
export async function sendNGAlertPushNotification(data: {
  stationId: number;
  stationName?: string;
  machineId?: number;
  machineName?: string;
  productCode?: string;
  ngCount: number;
  measurementResults: Array<{
    pointName: string;
    result: string;
    measuredValue?: number;
  }>;
  inspectionId?: number;
  imageUrl?: string;
}): Promise<{ sent: number; failed: number }> {
  // Lấy danh sách offline clients có FCM token và đã đăng ký nhận NG alerts
  const offlineClients = await db.getOfflineMqttClientsWithFcmToken(data.stationId);
  
  if (offlineClients.length === 0) {
    console.log('[FCM] No offline clients with FCM token for station:', data.stationId);
    return { sent: 0, failed: 0 };
  }

  // Lấy danh sách FCM tokens
  const tokens = offlineClients
    .map(c => c.fcmToken)
    .filter((token): token is string => !!token);

  if (tokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  // Tạo notification message
  const ngPoints = data.measurementResults
    .filter(r => r.result === 'NG')
    .map(r => r.pointName)
    .slice(0, 3)
    .join(', ');

  const message: FCMMessage = {
    registration_ids: tokens,
    notification: {
      title: `⚠️ NG Alert - ${data.stationName || `Station ${data.stationId}`}`,
      body: `${data.ngCount} điểm NG phát hiện: ${ngPoints}${data.measurementResults.filter(r => r.result === 'NG').length > 3 ? '...' : ''}`,
      icon: '/icon-192.png',
      click_action: data.inspectionId ? `/inspection/${data.inspectionId}` : '/dashboard',
      sound: 'default',
    },
    data: {
      type: 'NG_ALERT',
      stationId: String(data.stationId),
      inspectionId: data.inspectionId ? String(data.inspectionId) : '',
      machineId: data.machineId ? String(data.machineId) : '',
      productCode: data.productCode || '',
      ngCount: String(data.ngCount),
      imageUrl: data.imageUrl || '',
      timestamp: new Date().toISOString(),
    },
    priority: 'high',
    time_to_live: 3600, // 1 hour
  };

  const result = await sendFCMNotification(message);
  
  if (result) {
    return {
      sent: result.success,
      failed: result.failure,
    };
  }

  return { sent: 0, failed: tokens.length };
}

/**
 * Gửi Daily/Weekly Summary push notification
 */
export async function sendSummaryPushNotification(data: {
  type: 'DAILY' | 'WEEKLY';
  stationId: number;
  stationName?: string;
  totalInspections: number;
  totalNG: number;
  ngRate: number;
  topNGPoints: Array<{ pointName: string; count: number }>;
}): Promise<{ sent: number; failed: number }> {
  // Lấy danh sách offline clients có FCM token
  const offlineClients = await db.getOfflineMqttClientsWithFcmToken(data.stationId);
  
  // Filter theo loại summary
  const eligibleClients = offlineClients.filter(c => 
    data.type === 'DAILY' ? c.receiveDailySummary : c.receiveWeeklySummary
  );

  if (eligibleClients.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const tokens = eligibleClients
    .map(c => c.fcmToken)
    .filter((token): token is string => !!token);

  if (tokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const periodLabel = data.type === 'DAILY' ? 'Hôm nay' : 'Tuần này';
  const topPoint = data.topNGPoints[0];

  const message: FCMMessage = {
    registration_ids: tokens,
    notification: {
      title: `📊 Báo cáo ${data.type === 'DAILY' ? 'ngày' : 'tuần'} - ${data.stationName || `Station ${data.stationId}`}`,
      body: `${periodLabel}: ${data.totalInspections} kiểm tra, ${data.totalNG} NG (${data.ngRate.toFixed(1)}%)${topPoint ? `. Top NG: ${topPoint.pointName}` : ''}`,
      icon: '/icon-192.png',
      click_action: '/reports',
      sound: 'default',
    },
    data: {
      type: `${data.type}_SUMMARY`,
      stationId: String(data.stationId),
      totalInspections: String(data.totalInspections),
      totalNG: String(data.totalNG),
      ngRate: String(data.ngRate),
      timestamp: new Date().toISOString(),
    },
    priority: 'normal',
    time_to_live: 86400, // 24 hours
  };

  const result = await sendFCMNotification(message);
  
  if (result) {
    return {
      sent: result.success,
      failed: result.failure,
    };
  }

  return { sent: 0, failed: tokens.length };
}

/**
 * Gửi custom push notification
 */
export async function sendCustomPushNotification(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ sent: number; failed: number }> {
  if (tokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const message: FCMMessage = {
    registration_ids: tokens,
    notification: {
      title,
      body,
      icon: '/icon-192.png',
      sound: 'default',
    },
    data: {
      ...data,
      timestamp: new Date().toISOString(),
    },
    priority: 'high',
  };

  const result = await sendFCMNotification(message);
  
  if (result) {
    return {
      sent: result.success,
      failed: result.failure,
    };
  }

  return { sent: 0, failed: tokens.length };
}

/**
 * Kiểm tra FCM configuration
 */
export function isFCMConfigured(): boolean {
  return !!FCM_SERVER_KEY;
}
