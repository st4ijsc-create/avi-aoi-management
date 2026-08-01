/**
 * Factory Alert System - Enhanced Notification Service
 * Quản lý local push notifications với hỗ trợ background và full-screen alerts
 */

import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AndroidCategory,
  AndroidStyle,
  EventType,
  Event,
  AuthorizationStatus,
} from '@notifee/react-native';
import { Platform, Vibration, AppState, AppStateStatus } from 'react-native';
import { Alert, AlertSeverity, NotificationConfig } from '../types';
import { 
  DEFAULT_NOTIFICATION_CONFIG, 
  SEVERITY_CONFIG, 
  STORAGE_KEYS 
} from '../utils/constants';
import { isQuietHours, getSeverityLabel } from '../utils/helpers';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Notification Channel IDs
const CHANNEL_IDS = {
  CRITICAL: 'factory_critical',
  HIGH: 'factory_high',
  MEDIUM: 'factory_medium',
  LOW: 'factory_low',
  INFO: 'factory_info',
  FOREGROUND: 'factory_foreground_service',
} as const;

// Callback types
type NotificationPressCallback = (alertId: string) => void;
type NotificationActionCallback = (alertId: string, action: 'acknowledge' | 'dismiss') => void;

/**
 * Enhanced Notification Service Class
 */
class NotificationService {
  private static instance: NotificationService;
  private config: NotificationConfig = DEFAULT_NOTIFICATION_CONFIG;
  private isInitialized: boolean = false;
  private onNotificationPress: NotificationPressCallback | null = null;
  private onNotificationAction: NotificationActionCallback | null = null;
  private appState: AppStateStatus = 'active';

  private constructor() {
    // Listen to app state changes
    AppState.addEventListener('change', this.handleAppStateChange);
  }

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    console.log('[Notification] App state:', this.appState, '->', nextAppState);
    this.appState = nextAppState;
  };

  /**
   * Initialize notification service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('[Notification] Initializing...');

      // Request permissions
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        console.warn('[Notification] Permission not granted!');
      }

      // Create channels
      await this.createChannels();

      // Setup handlers
      this.setupEventHandlers();
      this.registerBackgroundHandler();

      // Load config
      await this.loadConfig();

      this.isInitialized = true;
      console.log('[Notification] Service initialized ✓');

    } catch (error) {
      console.error('[Notification] Init error:', error);
      throw error;
    }
  }

  /**
   * Request notification permissions
   */
  private async requestPermissions(): Promise<boolean> {
    try {
      const settings = await notifee.getNotificationSettings();
      
      if (settings.authorizationStatus === AuthorizationStatus.AUTHORIZED) {
        console.log('[Notification] Already authorized');
        return true;
      }

      const newSettings = await notifee.requestPermission();
      return newSettings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
    } catch (error) {
      console.error('[Notification] Permission error:', error);
      return false;
    }
  }

  /**
   * Check permission status
   */
  public async hasPermission(): Promise<boolean> {
    try {
      const settings = await notifee.getNotificationSettings();
      return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
    } catch {
      return false;
    }
  }

  /**
   * Open notification settings
   */
  public async openSettings(): Promise<void> {
    await notifee.openNotificationSettings();
  }

  /**
   * Create notification channels
   */
  private async createChannels(): Promise<void> {
    if (Platform.OS !== 'android') return;

    try {
      // Critical - Bypass DND
      await notifee.createChannel({
        id: CHANNEL_IDS.CRITICAL,
        name: 'Cảnh báo Nghiêm trọng',
        description: 'Cảnh báo khẩn cấp - Máy dừng',
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        sound: 'default',
        vibration: true,
        vibrationPattern: [500, 200, 500, 200],
        lights: true,
        lightColor: '#DC2626',
        badge: true,
        bypassDnd: true,
      });

      // High
      await notifee.createChannel({
        id: CHANNEL_IDS.HIGH,
        name: 'Cảnh báo Cao',
        description: 'Cảnh báo ưu tiên cao',
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        sound: 'default',
        vibration: true,
        vibrationPattern: [400, 200, 400, 200],
        lights: true,
        lightColor: '#EA580C',
        badge: true,
      });

      // Medium
      await notifee.createChannel({
        id: CHANNEL_IDS.MEDIUM,
        name: 'Cảnh báo Trung bình',
        importance: AndroidImportance.DEFAULT,
        visibility: AndroidVisibility.PUBLIC,
        sound: 'default',
        vibration: true,
        badge: true,
      });

      // Low
      await notifee.createChannel({
        id: CHANNEL_IDS.LOW,
        name: 'Cảnh báo Thấp',
        importance: AndroidImportance.LOW,
        visibility: AndroidVisibility.PUBLIC,
        badge: true,
      });

      // Info
      await notifee.createChannel({
        id: CHANNEL_IDS.INFO,
        name: 'Thông tin',
        importance: AndroidImportance.MIN,
      });

      // Foreground service
      await notifee.createChannel({
        id: CHANNEL_IDS.FOREGROUND,
        name: 'Dịch vụ Giám sát',
        importance: AndroidImportance.LOW,
      });

      console.log('[Notification] Channels created');
    } catch (error) {
      console.error('[Notification] Channel error:', error);
    }
  }

  /**
   * Setup foreground event handlers
   */
  private setupEventHandlers(): void {
    notifee.onForegroundEvent(({ type, detail }: Event) => {
      this.handleEvent(type, detail);
    });
  }

  /**
   * Register background handler
   */
  private registerBackgroundHandler(): void {
    notifee.onBackgroundEvent(async ({ type, detail }: Event) => {
      console.log('[Notification] Background event:', EventType[type]);
      
      if (type === EventType.ACTION_PRESS) {
        const actionId = detail.pressAction?.id;
        if (actionId === 'dismiss' && detail.notification?.id) {
          await notifee.cancelNotification(detail.notification.id);
        }
      }
    });
  }

  /**
   * Handle notification events
   */
  private handleEvent(type: EventType, detail: any): void {
    const { notification, pressAction } = detail;

    switch (type) {
      case EventType.PRESS:
        if (this.onNotificationPress && notification?.data?.alertId) {
          this.onNotificationPress(notification.data.alertId as string);
        }
        break;

      case EventType.ACTION_PRESS:
        const alertId = notification?.data?.alertId as string;
        const actionId = pressAction?.id as 'acknowledge' | 'dismiss';
        if (this.onNotificationAction && alertId && actionId) {
          this.onNotificationAction(alertId, actionId);
        }
        break;
    }
  }

  public setOnNotificationPress(callback: NotificationPressCallback): void {
    this.onNotificationPress = callback;
  }

  public setOnNotificationAction(callback: NotificationActionCallback): void {
    this.onNotificationAction = callback;
  }

  public configure(config: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): NotificationConfig {
    return { ...this.config };
  }

  /**
   * Check if should show notification
   */
  private shouldShow(severity: AlertSeverity): boolean {
    if (!this.config.enabled) return false;
    if (!this.config.severityFilter.includes(severity)) return false;

    if (this.config.quietHoursEnabled) {
      if (isQuietHours(this.config.quietHoursStart, this.config.quietHoursEnd)) {
        if (severity !== 'critical') return false;
      }
    }

    return true;
  }

  private getChannelId(severity: AlertSeverity): string {
    const map: Record<AlertSeverity, string> = {
      critical: CHANNEL_IDS.CRITICAL,
      high: CHANNEL_IDS.HIGH,
      medium: CHANNEL_IDS.MEDIUM,
      low: CHANNEL_IDS.LOW,
      info: CHANNEL_IDS.INFO,
    };
    return map[severity];
  }

  /**
   * Show alert notification (MAIN METHOD)
   */
  public async showAlert(alert: Alert): Promise<string | null> {
    if (!this.shouldShow(alert.severity)) {
      console.log('[Notification] Skipped:', alert.alertId);
      return null;
    }

    try {
      const severityConfig = SEVERITY_CONFIG[alert.severity];
      const severityLabel = getSeverityLabel(alert.severity, 'vi');

      // Customize title/body for NG Rate alerts
      const isNgRate = alert.alertType === 'NG_RATE_THRESHOLD' && alert.ngRate;
      
      const title = isNgRate
        ? `🚨 ${severityLabel}: NG Rate ${alert.ngRate!.current.toFixed(2)}% vượt ngưỡng ${alert.ngRate!.threshold.toFixed(2)}%`
        : `🚨 ${severityLabel}: ${alert.error.type}`;
      
      const body = isNgRate
        ? `${alert.station.name} - ${alert.measurementPoint?.name || ''} - ${alert.error.description}`
        : `${alert.station.name} - ${alert.error.description}`;
      
      const bigTextLines = isNgRate
        ? [
            `📍 Trạm: ${alert.station.name} (${alert.station.line})`,
            `📊 NG Rate: ${alert.ngRate!.current.toFixed(2)}% / Ngưỡng: ${alert.ngRate!.threshold.toFixed(2)}%`,
            `🔢 Tổng kiểm tra: ${alert.ngRate!.totalInspections} | NG: ${alert.ngRate!.ngCount}`,
            alert.measurementPoint ? `📐 Điểm đo: ${alert.measurementPoint.name} (${alert.measurementPoint.code})` : '',
            alert.productModel ? `📦 Model: ${alert.productModel.name}` : '',
            `📝 ${alert.error.description}`,
          ].filter(Boolean)
        : [
            `📍 Trạm: ${alert.station.name} (${alert.station.line})`,
            `📦 Sản phẩm: ${alert.product.name}`,
            `🔧 Mã lỗi: ${alert.error.code}`,
            `📝 ${alert.error.description}`,
          ];
      
      const bigText = bigTextLines.join('\n');

      const options: any = {
        id: alert.id,
        title,
        body,
        data: {
          alertId: alert.id,
          severity: alert.severity,
        },
        android: {
          channelId: this.getChannelId(alert.severity),
          smallIcon: 'ic_notification',
          color: severityConfig.color,
          importance: AndroidImportance.HIGH,
          category: AndroidCategory.ALARM,
          visibility: AndroidVisibility.PUBLIC,
          autoCancel: true,
          showTimestamp: true,
          timestamp: new Date(alert.timestamp).getTime(),
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
          actions: [
            { title: '✓ Xác nhận', pressAction: { id: 'acknowledge' } },
            { title: '✕ Bỏ qua', pressAction: { id: 'dismiss' } },
          ],
          style: {
            type: AndroidStyle.BIGTEXT,
            text: bigText,
          },
        },
        ios: {
          sound: this.config.sound ? 'default' : undefined,
          critical: alert.severity === 'critical',
          foregroundPresentationOptions: {
            alert: true,
            badge: true,
            sound: this.config.sound,
            banner: true,
            list: true,
          },
        },
      };

      // Full-screen intent for critical alerts in background
      if (alert.severity === 'critical' && this.appState !== 'active') {
        options.android.fullScreenAction = {
          id: 'default',
          launchActivity: 'default',
        };
      }

      const notificationId = await notifee.displayNotification(options);

      // Vibrate
      if (this.config.vibration) {
        this.vibrate(alert.severity);
      }

      console.log('[Notification] Displayed:', notificationId);
      return notificationId;

    } catch (error) {
      console.error('[Notification] Display error:', error);
      return null;
    }
  }

  private vibrate(severity: AlertSeverity): void {
    const patterns: Record<AlertSeverity, number[]> = {
      critical: [0, 500, 200, 500, 200, 500],
      high: [0, 400, 200, 400],
      medium: [0, 300],
      low: [0, 200],
      info: [0, 100],
    };
    Vibration.vibrate(patterns[severity]);
  }

  /**
   * Start foreground service (MB2, doc 27 Đợt 6).
   *
   * Lifecycle is driven by services/backgroundReliability.ts (AppState →
   * background starts it, → active stops it) so MQTT survives screen-off/Doze.
   *
   * Android 14 (targetSdk 34) FGS type: notifee 7.9 does not expose a JS-side
   * `foregroundServiceTypes` option — the type comes from the manifest
   * declaration of io.invertase.notifee.ForegroundService, which is set to
   * foregroundServiceType="dataSync" (permission FOREGROUND_SERVICE_DATA_SYNC
   * is declared). "dataSync" fits: the service maintains an MQTT connection to
   * sync factory alert data. On API 34, startForeground() without an explicit
   * type uses the manifest-declared type, so this compiles and runs on
   * targetSdk 34 without a Notifee upgrade.
   *
   * Requires notifee.registerForegroundService(...) to have been registered at
   * app entry (index.js → registerForegroundServiceRunner()).
   */
  public async startForegroundService(): Promise<void> {
    if (Platform.OS !== 'android') return;

    try {
      await notifee.displayNotification({
        id: 'foreground-service',
        title: 'Factory Alert System',
        body: 'Đang giám sát cảnh báo nhà máy',
        android: {
          channelId: CHANNEL_IDS.FOREGROUND,
          smallIcon: 'ic_notification',
          ongoing: true,
          asForegroundService: true,
          pressAction: { id: 'default', launchActivity: 'default' },
        },
      });
      console.log('[Notification] Foreground service started');
    } catch (error) {
      console.error('[Notification] Foreground service error:', error);
    }
  }

  public async stopForegroundService(): Promise<void> {
    try {
      await notifee.stopForegroundService();
      await notifee.cancelNotification('foreground-service');
    } catch (error) {
      console.error('[Notification] Stop service error:', error);
    }
  }

  public async cancel(id: string): Promise<void> {
    await notifee.cancelNotification(id);
  }

  public async cancelAll(): Promise<void> {
    await notifee.cancelAllNotifications();
  }

  public async setBadgeCount(count: number): Promise<void> {
    await notifee.setBadgeCount(count);
  }

  /**
   * Test notification
   */
  public async showTestNotification(): Promise<string | null> {
    const testAlert: Alert = {
      id: `test-${Date.now()}`,
      alertId: `ALT-TEST-${Date.now()}`,
      timestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      station: { id: 'ST-TEST', name: 'Test Station', line: 'Test Line', area: 'Test' },
      product: { id: 'PRD-TEST', name: 'Test Product', customer: 'Test' },
      error: { code: 'E-TEST', type: 'Test Error', description: 'This is a test notification.' },
      severity: 'high',
      status: 'pending',
    };
    return this.showAlert(testAlert);
  }

  public async loadConfig(): Promise<void> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (data) {
        const settings = JSON.parse(data);
        if (settings.notification) {
          this.configure(settings.notification);
        }
      }
    } catch (error) {
      console.error('[Notification] Load config error:', error);
    }
  }

  public async saveConfig(): Promise<void> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      const settings = data ? JSON.parse(data) : {};
      settings.notification = this.config;
      await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (error) {
      console.error('[Notification] Save config error:', error);
    }
  }
}

export const notificationService = NotificationService.getInstance();
export default notificationService;
