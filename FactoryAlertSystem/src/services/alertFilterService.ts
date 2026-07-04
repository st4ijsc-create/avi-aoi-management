/**
 * Factory Alert System - Alert Filter Service
 * Kiểm tra và lọc alerts theo cài đặt
 */

import { Alert, NotificationConfig, AlertSeverity } from '../types';

class AlertFilterService {
  private static instance: AlertFilterService;

  private constructor() {}

  public static getInstance(): AlertFilterService {
    if (!AlertFilterService.instance) {
      AlertFilterService.instance = new AlertFilterService();
    }
    return AlertFilterService.instance;
  }

  /**
   * Kiểm tra alert có được phép hiển thị notification không
   */
  public shouldShowNotification(alert: Alert, config: NotificationConfig): boolean {
    console.log('[AlertFilter] Checking alert:', alert.alertId);
    console.log('[AlertFilter] Config:', JSON.stringify(config, null, 2));

    // 1. Check if notifications are enabled
    if (!config.enabled) {
      console.log('[AlertFilter] Notifications disabled');
      return false;
    }

    // 2. Check severity filter
    if (!this.matchesSeverity(alert.severity, config.severityFilter)) {
      console.log('[AlertFilter] Severity not in filter:', alert.severity);
      return false;
    }

    // 3. Check station filter
    if (config.stationFilterEnabled && config.stationFilters.length > 0) {
      if (!this.matchesStation(alert.station.id, config.stationFilters)) {
        console.log('[AlertFilter] Station not in filter:', alert.station.id);
        return false;
      }
    }

    // 4. Check quiet hours
    if (config.quietHoursEnabled) {
      if (this.isInQuietHours(config.quietHoursStart, config.quietHoursEnd)) {
        console.log('[AlertFilter] In quiet hours');
        return false;
      }
    }

    console.log('[AlertFilter] Alert passed all filters');
    return true;
  }

  /**
   * Check if severity matches filter
   */
  private matchesSeverity(severity: AlertSeverity, filter: AlertSeverity[]): boolean {
    if (!filter || filter.length === 0) {
      return true; // No filter = show all
    }
    return filter.includes(severity);
  }

  /**
   * Check if station matches filter
   * Supports partial matching (e.g., 'ST-A' matches 'ST-A-001', 'ST-A-002')
   */
  private matchesStation(stationId: string, filters: string[]): boolean {
    if (!filters || filters.length === 0) {
      return true; // No filter = show all
    }

    const normalizedStationId = stationId.toUpperCase().trim();
    
    return filters.some(filter => {
      const normalizedFilter = filter.toUpperCase().trim();
      
      // Exact match
      if (normalizedStationId === normalizedFilter) {
        return true;
      }
      
      // Partial match (prefix)
      if (normalizedStationId.startsWith(normalizedFilter)) {
        return true;
      }
      
      // Partial match (contains)
      if (normalizedStationId.includes(normalizedFilter)) {
        return true;
      }
      
      return false;
    });
  }

  /**
   * Check if current time is in quiet hours
   */
  private isInQuietHours(start: string, end: string): boolean {
    try {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const [startHour, startMin] = start.split(':').map(Number);
      const [endHour, endMin] = end.split(':').map(Number);

      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      // Handle overnight quiet hours (e.g., 22:00 - 06:00)
      if (startMinutes > endMinutes) {
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
      }

      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } catch (error) {
      console.error('[AlertFilter] Error checking quiet hours:', error);
      return false;
    }
  }

  /**
   * Filter alerts array based on config
   */
  public filterAlerts(alerts: Alert[], config: NotificationConfig): Alert[] {
    return alerts.filter(alert => this.shouldShowNotification(alert, config));
  }

  /**
   * Validate station code format
   */
  public isValidStationCode(code: string): boolean {
    if (!code || code.trim().length === 0) {
      return false;
    }
    // Allow alphanumeric with hyphens, at least 2 characters
    const pattern = /^[A-Za-z0-9][-A-Za-z0-9]*$/;
    return pattern.test(code.trim()) && code.trim().length >= 2;
  }

  /**
   * Normalize station code
   */
  public normalizeStationCode(code: string): string {
    return code.toUpperCase().trim();
  }
}

export const alertFilterService = AlertFilterService.getInstance();
export default alertFilterService;
