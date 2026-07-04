/**
 * Factory Alert System - Overlay Alert Service
 * Hiển thị dialog cảnh báo đè lên tất cả các app khác
 * Yêu cầu: SYSTEM_ALERT_WINDOW permission
 */

import { NativeModules, Platform, Linking, Alert as RNAlert } from 'react-native';
import { Alert, AlertSeverity } from '../types';
import { getSeverityLabel } from '../utils/helpers';
import { SEVERITY_CONFIG } from '../utils/constants';

// Try to get native overlay module (if implemented)
const { OverlayModule } = NativeModules;

class OverlayAlertService {
  private static instance: OverlayAlertService;
  private hasOverlayPermission: boolean = false;
  private pendingOverlayAlerts: Alert[] = [];
  private isShowingOverlay: boolean = false;

  private constructor() {}

  public static getInstance(): OverlayAlertService {
    if (!OverlayAlertService.instance) {
      OverlayAlertService.instance = new OverlayAlertService();
    }
    return OverlayAlertService.instance;
  }

  /**
   * Check if overlay permission is granted
   */
  public async checkPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true; // iOS doesn't need this permission
    }

    try {
      if (OverlayModule && OverlayModule.checkPermission) {
        this.hasOverlayPermission = await OverlayModule.checkPermission();
        return this.hasOverlayPermission;
      }
      // If native module not available, assume we can use fallback
      return true;
    } catch (error) {
      console.error('[OverlayAlert] Permission check error:', error);
      return false;
    }
  }

  /**
   * Request overlay permission
   */
  public async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true;
    }

    try {
      if (OverlayModule && OverlayModule.requestPermission) {
        await OverlayModule.requestPermission();
        return this.checkPermission();
      }
      
      // Fallback: Open settings manually
      RNAlert.alert(
        'Cần cấp quyền hiển thị đè',
        'Để hiển thị cảnh báo khi app chạy nền, vui lòng cấp quyền "Hiển thị trên ứng dụng khác" trong Cài đặt.',
        [
          { text: 'Để sau', style: 'cancel' },
          { 
            text: 'Mở Cài đặt', 
            onPress: () => {
              Linking.openSettings();
            }
          },
        ]
      );
      return false;
    } catch (error) {
      console.error('[OverlayAlert] Request permission error:', error);
      return false;
    }
  }

  /**
   * Show overlay alert
   * This creates a floating window on top of other apps
   */
  public async showOverlayAlert(alert: Alert): Promise<void> {
    console.log('[OverlayAlert] Showing alert:', alert.alertId);

    try {
      if (OverlayModule && OverlayModule.showAlert) {
        // Use native overlay module if available
        const severityConfig = SEVERITY_CONFIG[alert.severity];
        await OverlayModule.showAlert({
          id: alert.id,
          title: `🚨 ${getSeverityLabel(alert.severity, 'vi')}`,
          message: alert.error.type,
          description: `${alert.station.name}\n${alert.error.description}`,
          color: severityConfig.color,
          severity: alert.severity,
        });
      } else {
        // Fallback: Queue for when app comes to foreground
        this.pendingOverlayAlerts.push(alert);
        console.log('[OverlayAlert] Native module not available, alert queued');
      }
    } catch (error) {
      console.error('[OverlayAlert] Show error:', error);
      this.pendingOverlayAlerts.push(alert);
    }
  }

  /**
   * Dismiss overlay alert
   */
  public async dismissOverlayAlert(alertId: string): Promise<void> {
    try {
      if (OverlayModule && OverlayModule.dismissAlert) {
        await OverlayModule.dismissAlert(alertId);
      }
      // Remove from pending queue
      this.pendingOverlayAlerts = this.pendingOverlayAlerts.filter(a => a.id !== alertId);
    } catch (error) {
      console.error('[OverlayAlert] Dismiss error:', error);
    }
  }

  /**
   * Dismiss all overlay alerts
   */
  public async dismissAllOverlayAlerts(): Promise<void> {
    try {
      if (OverlayModule && OverlayModule.dismissAll) {
        await OverlayModule.dismissAll();
      }
      this.pendingOverlayAlerts = [];
    } catch (error) {
      console.error('[OverlayAlert] Dismiss all error:', error);
    }
  }

  /**
   * Get pending overlay alerts (for fallback display)
   */
  public getPendingAlerts(): Alert[] {
    return [...this.pendingOverlayAlerts];
  }

  /**
   * Clear pending alerts
   */
  public clearPendingAlerts(): void {
    this.pendingOverlayAlerts = [];
  }

  /**
   * Show system alert dialog (fallback method)
   * This uses React Native Alert which works in foreground
   */
  public showSystemAlert(alert: Alert, onAcknowledge?: () => void, onDismiss?: () => void): void {
    const severityLabel = getSeverityLabel(alert.severity, 'vi');
    
    RNAlert.alert(
      `🚨 ${severityLabel}: ${alert.error.type}`,
      `📍 Trạm: ${alert.station.name}\n📦 Sản phẩm: ${alert.product.name}\n🔧 Mã lỗi: ${alert.error.code}\n\n${alert.error.description}`,
      [
        {
          text: '✕ Bỏ qua',
          style: 'cancel',
          onPress: onDismiss,
        },
        {
          text: '✓ Xác nhận',
          onPress: onAcknowledge,
        },
      ],
      { cancelable: false }
    );
  }
}

export const overlayAlertService = OverlayAlertService.getInstance();
export default overlayAlertService;
