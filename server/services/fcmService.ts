/**
 * Firebase Cloud Messaging Service (HTTP v1 API)
 * Gửi push notification cho các client offline khi có NG alert
 * 
 * Sử dụng FCM HTTP v1 API thay vì Legacy API đã deprecated
 * https://firebase.google.com/docs/cloud-messaging/migrate-v1
 */

import crypto from 'crypto';
import { ENV } from '../_core/env';
import * as db from '../db';

// Firebase Service Account JSON (base64 encoded hoặc JSON string)
const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';

// FCM HTTP v1 API endpoint
const FCM_V1_API_URL = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;

// Cache access token
let accessToken: string | null = null;
let tokenExpiry: number = 0;

interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

interface FCMv1Message {
  message: {
    token?: string;
    topic?: string;
    notification?: {
      title: string;
      body: string;
      image?: string;
    };
    android?: {
      priority?: 'HIGH' | 'NORMAL';
      notification?: {
        icon?: string;
        color?: string;
        sound?: string;
        click_action?: string;
        channel_id?: string;
      };
      ttl?: string;
    };
    apns?: {
      payload?: {
        aps?: {
          alert?: {
            title?: string;
            body?: string;
          };
          sound?: string;
          badge?: number;
        };
      };
    };
    data?: Record<string, string>;
  };
}

interface FCMv1Response {
  name?: string;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

/**
 * Parse Service Account credentials
 */
function getServiceAccountCredentials(): ServiceAccountCredentials | null {
  if (!FIREBASE_SERVICE_ACCOUNT) {
    return null;
  }

  try {
    // Try parsing as JSON first
    if (FIREBASE_SERVICE_ACCOUNT.startsWith('{')) {
      return JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    }
    // Try base64 decode
    const decoded = Buffer.from(FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error('[FCM] Failed to parse service account credentials:', error);
    return null;
  }
}

/**
 * Generate JWT for Google OAuth2
 */
function generateJWT(credentials: ServiceAccountCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: expiry,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  };

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signatureInput = `${base64Header}.${base64Payload}`;

  // Sign with RSA-SHA256
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(credentials.private_key, 'base64url');

  return `${signatureInput}.${signature}`;
}

/**
 * Get OAuth2 access token for FCM
 */
async function getAccessToken(): Promise<string | null> {
  // Return cached token if still valid
  if (accessToken && Date.now() < tokenExpiry - 60000) {
    return accessToken;
  }

  const credentials = getServiceAccountCredentials();
  if (!credentials) {
    console.log('[FCM] Service account not configured');
    return null;
  }

  try {
    const jwt = generateJWT(credentials);

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[FCM] Failed to get access token:', error);
      return null;
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);

    console.log('[FCM] Access token obtained, expires in:', data.expires_in, 'seconds');
    return accessToken;
  } catch (error) {
    console.error('[FCM] Error getting access token:', error);
    return null;
  }
}

/**
 * Gửi push notification qua FCM HTTP v1 API
 */
async function sendFCMv1Notification(token: string, notification: {
  title: string;
  body: string;
  image?: string;
}, data?: Record<string, string>): Promise<boolean> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return false;
  }

  const credentials = getServiceAccountCredentials();
  if (!credentials) {
    return false;
  }

  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${credentials.project_id}/messages:send`;

  const message: FCMv1Message = {
    message: {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
        image: notification.image,
      },
      android: {
        priority: 'HIGH',
        notification: {
          icon: 'ic_notification',
          color: '#3b82f6',
          sound: 'default',
          channel_id: 'ng_alerts',
        },
        ttl: '3600s',
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: notification.title,
              body: notification.body,
            },
            sound: 'default',
          },
        },
      },
      data: data ? Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ) : undefined,
    },
  };

  try {
    const response = await fetch(fcmUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(message),
    });

    const result = await response.json() as FCMv1Response;

    if (!response.ok || result.error) {
      console.error('[FCM] Failed to send notification:', result.error?.message || response.statusText);
      return false;
    }

    console.log('[FCM] Notification sent successfully:', result.name);
    return true;
  } catch (error) {
    console.error('[FCM] Error sending notification:', error);
    return false;
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

  const notification = {
    title: `⚠️ NG Alert - ${data.stationName || `Station ${data.stationId}`}`,
    body: `${data.ngCount} điểm NG phát hiện: ${ngPoints}${data.measurementResults.filter(r => r.result === 'NG').length > 3 ? '...' : ''}`,
    image: data.imageUrl,
  };

  const messageData = {
    type: 'NG_ALERT',
    stationId: String(data.stationId),
    inspectionId: data.inspectionId ? String(data.inspectionId) : '',
    machineId: data.machineId ? String(data.machineId) : '',
    productCode: data.productCode || '',
    ngCount: String(data.ngCount),
    imageUrl: data.imageUrl || '',
    timestamp: new Date().toISOString(),
  };

  // Send to each token individually (FCM v1 doesn't support batch to multiple tokens)
  let sent = 0;
  let failed = 0;

  for (const token of tokens) {
    const success = await sendFCMv1Notification(token, notification, messageData);
    if (success) {
      sent++;
    } else {
      failed++;
    }
  }

  console.log(`[FCM] NG Alert sent: ${sent} success, ${failed} failed`);
  return { sent, failed };
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

  const notification = {
    title: `📊 Báo cáo ${data.type === 'DAILY' ? 'ngày' : 'tuần'} - ${data.stationName || `Station ${data.stationId}`}`,
    body: `${periodLabel}: ${data.totalInspections} kiểm tra, ${data.totalNG} NG (${data.ngRate.toFixed(1)}%)${topPoint ? `. Top NG: ${topPoint.pointName}` : ''}`,
  };

  const messageData = {
    type: `${data.type}_SUMMARY`,
    stationId: String(data.stationId),
    totalInspections: String(data.totalInspections),
    totalNG: String(data.totalNG),
    ngRate: String(data.ngRate),
    timestamp: new Date().toISOString(),
  };

  let sent = 0;
  let failed = 0;

  for (const token of tokens) {
    const success = await sendFCMv1Notification(token, notification, messageData);
    if (success) {
      sent++;
    } else {
      failed++;
    }
  }

  console.log(`[FCM] Summary sent: ${sent} success, ${failed} failed`);
  return { sent, failed };
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

  let sent = 0;
  let failed = 0;

  for (const token of tokens) {
    const success = await sendFCMv1Notification(token, { title, body }, {
      ...data,
      timestamp: new Date().toISOString(),
    });
    if (success) {
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Kiểm tra FCM configuration
 */
export function isFCMConfigured(): boolean {
  return !!FIREBASE_SERVICE_ACCOUNT || !!getServiceAccountCredentials();
}

/**
 * Test FCM connection
 */
export async function testFCMConnection(): Promise<{ success: boolean; message: string }> {
  const credentials = getServiceAccountCredentials();
  if (!credentials) {
    return { success: false, message: 'Service account not configured' };
  }

  const token = await getAccessToken();
  if (!token) {
    return { success: false, message: 'Failed to get access token' };
  }

  return { success: true, message: `Connected to project: ${credentials.project_id}` };
}
