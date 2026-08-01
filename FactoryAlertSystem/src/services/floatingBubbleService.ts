/**
 * Factory Alert System - Floating Bubble Service
 * Quản lý floating bubble (chat head) trên Android
 * Hiển thị icon nổi và popup alert khi app chạy nền
 */

import { NativeModules, NativeEventEmitter, Platform, Linking, Alert as RNAlert } from 'react-native';
import { Alert, AlertSeverity, PeriodicBulletin } from '../types';
import { getSeverityLabel } from '../utils/helpers';

const { FloatingBubbleModule } = NativeModules;

// Event emitter for native events
let eventEmitter: NativeEventEmitter | null = null;

// Callback types
type AlertActionCallback = (alertId: string, action: 'acknowledged' | 'dismissed') => void;
type BulletinActionCallback = (bulletinId: string, action: 'viewDetail' | 'dismissed') => void;

/**
 * Floating Bubble Service
 * Singleton pattern
 */
class FloatingBubbleService {
  private static instance: FloatingBubbleService;
  private isEnabled: boolean = false;
  private onAlertAction: AlertActionCallback | null = null;
  private onBulletinAction: BulletinActionCallback | null = null;
  private subscriptions: any[] = [];

  private constructor() {
    this.setupEventListeners();
  }

  public static getInstance(): FloatingBubbleService {
    if (!FloatingBubbleService.instance) {
      FloatingBubbleService.instance = new FloatingBubbleService();
    }
    return FloatingBubbleService.instance;
  }

  /**
   * Setup native event listeners
   */
  private setupEventListeners(): void {
    if (Platform.OS !== 'android' || !FloatingBubbleModule) {
      console.log('[FloatingBubble] Not available on this platform');
      return;
    }

    eventEmitter = new NativeEventEmitter(FloatingBubbleModule);

    // Listen for alert acknowledged
    const ackSub = eventEmitter.addListener('onAlertAcknowledged', (event) => {
      console.log('[FloatingBubble] Alert acknowledged:', event.alertId);
      if (this.onAlertAction) {
        this.onAlertAction(event.alertId, 'acknowledged');
      }
    });
    this.subscriptions.push(ackSub);

    // Listen for alert dismissed
    const dismissSub = eventEmitter.addListener('onAlertDismissed', (event) => {
      console.log('[FloatingBubble] Alert dismissed:', event.alertId);
      if (this.onAlertAction) {
        this.onAlertAction(event.alertId, 'dismissed');
      }
    });
    this.subscriptions.push(dismissSub);

    // Listen for bulletin view detail
    const bulletinDetailSub = eventEmitter.addListener('onBulletinViewDetail', (event) => {
      console.log('[FloatingBubble] Bulletin view detail:', event.bulletinId);
      if (this.onBulletinAction) {
        this.onBulletinAction(event.bulletinId, 'viewDetail');
      }
    });
    this.subscriptions.push(bulletinDetailSub);

    // Listen for bulletin dismissed
    const bulletinDismissSub = eventEmitter.addListener('onBulletinDismissed', (event) => {
      console.log('[FloatingBubble] Bulletin dismissed:', event.bulletinId);
      if (this.onBulletinAction) {
        this.onBulletinAction(event.bulletinId, 'dismissed');
      }
    });
    this.subscriptions.push(bulletinDismissSub);
  }

  /**
   * Set callback for alert actions from bubble
   */
  public setOnAlertAction(callback: AlertActionCallback): void {
    this.onAlertAction = callback;
  }

  /**
   * Set callback for bulletin actions from native overlay
   */
  public setOnBulletinAction(callback: BulletinActionCallback): void {
    this.onBulletinAction = callback;
  }

  /**
   * Check if floating bubble is available
   */
  public isAvailable(): boolean {
    return Platform.OS === 'android' && FloatingBubbleModule != null;
  }

  /**
   * Check if has overlay permission
   */
  public async checkPermission(): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      return await FloatingBubbleModule.checkPermission();
    } catch (error) {
      console.error('[FloatingBubble] Check permission error:', error);
      return false;
    }
  }

  /**
   * Request overlay permission
   */
  public async requestPermission(): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      const hasPermission = await this.checkPermission();
      if (hasPermission) return true;

      // Show dialog to user
      return new Promise((resolve) => {
        RNAlert.alert(
          'Cần cấp quyền hiển thị',
          'Để hiển thị cảnh báo nổi trên màn hình khi app chạy nền, vui lòng cấp quyền "Hiển thị trên ứng dụng khác".',
          [
            {
              text: 'Để sau',
              style: 'cancel',
              onPress: () => resolve(false),
            },
            {
              text: 'Mở Cài đặt',
              onPress: async () => {
                await FloatingBubbleModule.requestPermission();
                // Wait a bit then check again
                setTimeout(async () => {
                  const granted = await this.checkPermission();
                  resolve(granted);
                }, 1000);
              },
            },
          ]
        );
      });
    } catch (error) {
      console.error('[FloatingBubble] Request permission error:', error);
      return false;
    }
  }

  /**
   * Show floating bubble
   */
  public async show(): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      const hasPermission = await this.checkPermission();
      if (!hasPermission) {
        console.log('[FloatingBubble] No permission to show bubble');
        return false;
      }

      await FloatingBubbleModule.showBubble();
      this.isEnabled = true;
      console.log('[FloatingBubble] Bubble shown');
      return true;
    } catch (error) {
      console.error('[FloatingBubble] Show error:', error);
      return false;
    }
  }

  /**
   * Hide floating bubble
   */
  public async hide(): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      await FloatingBubbleModule.hideBubble();
      this.isEnabled = false;
      console.log('[FloatingBubble] Bubble hidden');
      return true;
    } catch (error) {
      console.error('[FloatingBubble] Hide error:', error);
      return false;
    }
  }

  /**
   * Update badge count on bubble
   */
  public async updateBadge(count: number): Promise<boolean> {
    if (!this.isAvailable() || !this.isEnabled) return false;

    try {
      await FloatingBubbleModule.updateBadge(count);
      return true;
    } catch (error) {
      console.error('[FloatingBubble] Update badge error:', error);
      return false;
    }
  }

  /**
   * Show alert popup from bubble
   */
  public async showAlert(alert: Alert, pendingCount: number = 1): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      const hasPermission = await this.checkPermission();
      if (!hasPermission) {
        console.log('[FloatingBubble] No permission');
        return false;
      }

      const severityLabel = getSeverityLabel(alert.severity, 'vi');
      
      await FloatingBubbleModule.showAlert({
        alertId: alert.id,
        title: `${severityLabel}: ${alert.error.type}`,
        message: `${alert.station.name}\n${alert.error.description}`,
        severity: alert.severity,
        pendingCount: pendingCount,
      });

      this.isEnabled = true;
      console.log('[FloatingBubble] Alert shown:', alert.alertId);
      return true;
    } catch (error) {
      console.error('[FloatingBubble] Show alert error:', error);
      return false;
    }
  }

  /**
   * Check if bubble is currently showing
   */
  public async isShowing(): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      return await FloatingBubbleModule.isShowing();
    } catch (error) {
      console.error('[FloatingBubble] isShowing error:', error);
      return false;
    }
  }

  /**
   * Show bulletin overlay (native overlay - works in background)
   */
  public async showBulletinOverlay(bulletin: PeriodicBulletin): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      const hasPermission = await this.checkPermission();
      if (!hasPermission) {
        console.log('[FloatingBubble] No permission for bulletin overlay');
        return false;
      }

      const stats = bulletin.statistics || {} as any;
      const period = bulletin.period || {} as any;

      await FloatingBubbleModule.showBulletinOverlay({
        bulletinId: bulletin.bulletinId || '',
        stationName: bulletin.stationName || 'N/A',
        lineName: bulletin.lineName || '',
        yieldRate: stats.yieldRate ?? 0,
        periodStart: period.start || '',
        periodEnd: period.end || '',
        totalOutput: stats.totalCount ?? 0,
        ngCount: stats.ngCount ?? 0,
        totalAlerts: stats.ngCount ?? 0,
      });

      console.log('[FloatingBubble] Bulletin overlay shown:', bulletin.bulletinId);
      return true;
    } catch (error) {
      console.error('[FloatingBubble] Show bulletin overlay error:', error);
      return false;
    }
  }

  /**
   * Hide bulletin overlay
   */
  public async hideBulletinOverlay(): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      await FloatingBubbleModule.hideBulletinOverlay();
      return true;
    } catch (error) {
      console.error('[FloatingBubble] Hide bulletin overlay error:', error);
      return false;
    }
  }

  /**
   * Show overlay alert dialog (native overlay - works in background)
   */
  public async showOverlayAlert(alert: Alert, displayDuration: number = 15000): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      const hasPermission = await this.checkPermission();
      if (!hasPermission) {
        console.log('[FloatingBubble] No permission for overlay alert');
        return false;
      }

      // Format timestamp
      let formattedTime = '';
      try {
        const date = new Date(alert.timestamp);
        formattedTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')} ${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
      } catch {
        formattedTime = alert.timestamp || '';
      }

      await FloatingBubbleModule.showOverlayAlert({
        alertId: alert.id || alert.alertId || '',
        alertType: alert.alertType || '',
        severity: alert.severity || 'high',
        stationName: alert.station?.name || 'N/A',
        stationLine: alert.station?.line || '',
        productName: alert.product?.name || 'N/A',
        productSerial: alert.product?.serialNumber || '',
        errorCode: alert.error?.code || '',
        errorType: alert.error?.type || '',
        errorDesc: alert.error?.description || '',
        machineName: alert.machine?.name || '',
        timestamp: formattedTime,
        ngPointCount: alert.ngPoints?.length || 0,
        totalNG: alert.totalNG || 0,
        inspectionId: alert.inspectionId || 0,
        displayDuration: displayDuration,
      });

      console.log('[FloatingBubble] Overlay alert shown:', alert.alertId);
      return true;
    } catch (error) {
      console.error('[FloatingBubble] Show overlay alert error:', error);
      return false;
    }
  }

  /**
   * Hide overlay alert dialog
   */
  public async hideOverlayAlert(): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      await FloatingBubbleModule.hideOverlayAlert();
      return true;
    } catch (error) {
      console.error('[FloatingBubble] Hide overlay alert error:', error);
      return false;
    }
  }

  /**
   * Toggle bubble visibility
   */
  public async toggle(): Promise<boolean> {
    const showing = await this.isShowing();
    if (showing) {
      return this.hide();
    } else {
      return this.show();
    }
  }

  /**
   * Set enabled state (will show/hide based on setting)
   */
  public async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.show();
    } else {
      await this.hide();
    }
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    this.subscriptions.forEach(sub => sub.remove());
    this.subscriptions = [];
    this.hide();
  }
}

export const floatingBubbleService = FloatingBubbleService.getInstance();
export default floatingBubbleService;
