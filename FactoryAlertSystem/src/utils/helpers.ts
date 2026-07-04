/**
 * Factory Alert System - Helper Functions
 * Các hàm tiện ích dùng chung trong app
 */

import { Alert, AlertSeverity, AlertStatus, Language } from '../types';
import { SEVERITY_CONFIG, TRANSLATIONS } from './constants';

// ============================================
// UUID GENERATION
// ============================================

/**
 * Tạo UUID v4
 */
export const generateUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Tạo Alert ID theo format: ALT-YYYY-XXXXXX
 */
export const generateAlertId = (): string => {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, '0');
  return `ALT-${year}-${random}`;
};

// ============================================
// DATE/TIME FORMATTING
// ============================================

/**
 * Format ISO datetime thành relative time
 * @param isoString ISO datetime string
 * @param lang Language code
 * @returns Relative time string (VD: "2 phút trước")
 */
export const formatRelativeTime = (isoString: string, lang: Language = 'vi'): string => {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  const t = TRANSLATIONS[lang];

  if (diffSeconds < 60) {
    return t.justNow;
  } else if (diffMinutes < 60) {
    return `${diffMinutes} ${t.minutesAgo}`;
  } else if (diffHours < 24) {
    return `${diffHours} ${t.hoursAgo}`;
  } else {
    return `${diffDays} ${t.daysAgo}`;
  }
};

/**
 * Format ISO datetime thành datetime đầy đủ
 * @param isoString ISO datetime string
 * @param lang Language code
 * @returns Formatted datetime (VD: "17/01/2026 14:30:15")
 */
export const formatDateTime = (isoString: string, lang: Language = 'vi'): string => {
  const date = new Date(isoString);
  
  if (lang === 'vi') {
    return date.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  if (lang === 'zh') {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
  
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
};

/**
 * Format time only (HH:mm:ss)
 */
export const formatTime = (isoString: string): string => {
  const date = new Date(isoString);
  return date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

/**
 * Format date only (DD/MM/YYYY)
 */
export const formatDate = (isoString: string, lang: Language = 'vi'): string => {
  const date = new Date(isoString);
  
  if (lang === 'vi') {
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  if (lang === 'zh') {
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

/**
 * Kiểm tra có đang trong quiet hours không
 */
export const isQuietHours = (startTime: string, endTime: string): boolean => {
  const now = new Date();
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  const currentTotalMinutes = currentHours * 60 + currentMinutes;

  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [endHours, endMinutes] = endTime.split(':').map(Number);
  
  const startTotalMinutes = startHours * 60 + startMinutes;
  const endTotalMinutes = endHours * 60 + endMinutes;

  // Handle overnight quiet hours (e.g., 22:00 - 06:00)
  if (startTotalMinutes > endTotalMinutes) {
    return currentTotalMinutes >= startTotalMinutes || currentTotalMinutes < endTotalMinutes;
  }

  return currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes;
};

// ============================================
// SEVERITY HELPERS
// ============================================

/**
 * Lấy config của severity
 */
export const getSeverityConfig = (severity: AlertSeverity) => {
  return SEVERITY_CONFIG[severity];
};

/**
 * Lấy màu theo severity
 */
export const getSeverityColor = (severity: AlertSeverity): string => {
  return SEVERITY_CONFIG[severity].bgColor;
};

/**
 * Lấy icon theo severity
 */
export const getSeverityIcon = (severity: AlertSeverity): string => {
  return SEVERITY_CONFIG[severity].icon;
};

/**
 * Lấy label theo severity và ngôn ngữ
 */
export const getSeverityLabel = (severity: AlertSeverity, lang: Language = 'vi'): string => {
  const config = SEVERITY_CONFIG[severity];
  return lang === 'vi' ? config.label : lang === 'zh' ? config.labelZh : config.labelEn;
};

/**
 * Wave 3C: single source of truth for the bulletin yield-rate colour.
 * Uses explicit 5-tier LITERAL thresholds so BulletinCard and BulletinDetailScreen
 * agree — previously the card collapsed tiers because it fell back to
 * `theme.colors.success` (always defined) for both the 98%+ and 95%+ bands.
 *   ≥98 excellent · ≥95 good · ≥90 fair · ≥85 warn · <85 bad
 */
export const getYieldColor = (rate: number): string => {
  if (rate >= 98) return '#16A34A'; // green-600 (excellent)
  if (rate >= 95) return '#84CC16'; // lime-500  (good)
  if (rate >= 90) return '#EAB308'; // amber-500 (fair)
  if (rate >= 85) return '#F97316'; // orange-500 (warn)
  return '#EF4444'; // red-500 (bad)
};

/**
 * So sánh priority của severity
 */
export const compareSeverity = (a: AlertSeverity, b: AlertSeverity): number => {
  return SEVERITY_CONFIG[b].priority - SEVERITY_CONFIG[a].priority;
};

/**
 * Lấy danh sách severity theo thứ tự priority giảm dần
 */
export const getSeveritiesByPriority = (): AlertSeverity[] => {
  return ['critical', 'high', 'medium', 'low', 'info'];
};

// ============================================
// STATUS HELPERS
// ============================================

/**
 * Lấy màu theo status
 */
export const getStatusColor = (status: AlertStatus): string => {
  const statusColors: Record<AlertStatus, string> = {
    pending: '#EAB308',
    acknowledged: '#3B82F6',
    resolved: '#22C55E',
  };
  return statusColors[status];
};

/**
 * Lấy label theo status và ngôn ngữ
 */
export const getStatusLabel = (status: AlertStatus, lang: Language = 'vi'): string => {
  const t = TRANSLATIONS[lang];
  const statusLabels: Record<AlertStatus, string> = {
    pending: t.pending,
    acknowledged: t.acknowledged,
    resolved: t.resolved,
  };
  return statusLabels[status];
};

// ============================================
// ALERT HELPERS
// ============================================

/**
 * Sắp xếp alerts theo severity và timestamp
 */
export const sortAlerts = (
  alerts: Alert[],
  sortBy: 'severity' | 'timestamp' = 'timestamp',
  order: 'asc' | 'desc' = 'desc'
): Alert[] => {
  return [...alerts].sort((a, b) => {
    if (sortBy === 'severity') {
      const severityDiff = compareSeverity(a.severity, b.severity);
      if (severityDiff !== 0) return order === 'desc' ? severityDiff : -severityDiff;
      // Same severity, sort by timestamp
      const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      return order === 'desc' ? timeDiff : -timeDiff;
    }
    
    const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    return order === 'desc' ? timeDiff : -timeDiff;
  });
};

/**
 * Lọc alerts
 */
export const filterAlerts = (
  alerts: Alert[],
  filters: {
    severity?: AlertSeverity[];
    status?: AlertStatus[];
    station?: string;
    line?: string;
    searchText?: string;
  }
): Alert[] => {
  return alerts.filter((alert) => {
    // Filter by severity
    if (filters.severity && filters.severity.length > 0) {
      if (!filters.severity.includes(alert.severity)) return false;
    }

    // Filter by status
    if (filters.status && filters.status.length > 0) {
      if (!filters.status.includes(alert.status)) return false;
    }

    // Filter by station
    if (filters.station) {
      if (alert.station.id !== filters.station) return false;
    }

    // Filter by line
    if (filters.line) {
      if (alert.station.line !== filters.line) return false;
    }

    // Filter by search text
    if (filters.searchText) {
      const searchLower = filters.searchText.toLowerCase();
      const searchFields = [
        alert.alertId,
        alert.station.id,
        alert.station.name,
        alert.station.line,
        alert.product.id,
        alert.product.name,
        alert.error.code,
        alert.error.type,
        alert.error.description,
      ];
      const matchFound = searchFields.some(
        (field) => field && field.toLowerCase().includes(searchLower)
      );
      if (!matchFound) return false;
    }

    return true;
  });
};

/**
 * Đếm alerts theo severity
 */
export const countAlertsBySeverity = (alerts: Alert[]): Record<AlertSeverity, number> => {
  const counts: Record<AlertSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  alerts.forEach((alert) => {
    counts[alert.severity]++;
  });

  return counts;
};

/**
 * Đếm alerts pending
 */
export const countPendingAlerts = (alerts: Alert[]): number => {
  return alerts.filter((alert) => alert.status === 'pending').length;
};

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Validate MQTT broker address
 */
export const isValidBrokerAddress = (address: string): boolean => {
  if (!address || address.trim() === '') return false;
  
  // Check for IP address
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipRegex.test(address)) {
    const parts = address.split('.').map(Number);
    return parts.every((part) => part >= 0 && part <= 255);
  }

  // Check for hostname
  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
  return hostnameRegex.test(address);
};

/**
 * Validate port number
 */
export const isValidPort = (port: number): boolean => {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
};

/**
 * Validate MQTT topic
 */
export const isValidMqttTopic = (topic: string): boolean => {
  if (!topic || topic.trim() === '') return false;
  // Basic MQTT topic validation
  return /^[a-zA-Z0-9_/+#-]+$/.test(topic);
};

/**
 * Validate time format (HH:mm)
 */
export const isValidTimeFormat = (time: string): boolean => {
  const regex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
  return regex.test(time);
};

/**
 * Validate alert payload từ MQTT
 * Hỗ trợ nhiều format khác nhau:
 * - Format chuẩn app: { alertId, timestamp, station, product, error, severity }
 * - Format hệ thống MES: { message, error, status, stationId, ... }
 * - Format đơn giản: { type, message, ... }
 */
export const isValidAlertPayload = (payload: any): boolean => {
  if (!payload || typeof payload !== 'object') return false;

  // Format 0: NG rate threshold alert
  if (payload.alertType === 'NG_RATE_THRESHOLD' && payload.ngRate) {
    return true;
  }

  // Format 1: Chuẩn app (full format)
  if (payload.alertId && payload.station && payload.error) {
    if (typeof payload.alertId !== 'string') return false;
    if (!payload.station.id || !payload.station.name) return false;
    if (!payload.error.code || !payload.error.description) return false;
    return true;
  }

  // Format 2: Hệ thống MES (có message hoặc error string)
  if (payload.message || payload.error || payload.errorMessage) {
    return true;
  }

  // Format 3: Có type và một số trường cơ bản
  if (payload.type && (payload.stationId || payload.station)) {
    return true;
  }

  // Format 3b: NG inspection alert từ hệ thống AOI (type = NG_ALERT)
  // Ví dụ payload:
  // { type: 'NG_ALERT', inspectionId, serialNumber, productName, machineName, stationName, timestamp, ngPoints, totalNG }
  if (
    payload.type === 'NG_ALERT' &&
    (payload.stationName || payload.machineName || (Array.isArray(payload.ngPoints) && payload.ngPoints.length > 0))
  ) {
    return true;
  }

  // Format 4: Alert đơn giản (có severity hoặc level)
  if (payload.severity || payload.level || payload.alertType) {
    return true;
  }

  return false;
};

/**
 * Normalize payload từ nhiều format khác nhau thành format chuẩn
 */
export const normalizeAlertPayload = (payload: any, topic: string): any => {
  // Nếu đã đúng format chuẩn - vẫn cần đảm bảo giữ các fields mới
  if (payload.alertId && payload.station && payload.error) {
    // Đảm bảo product có đầy đủ thông tin mới
    if (payload.product) {
      payload.product = {
        ...payload.product,
        serialNumber: payload.product.serialNumber,
        model: payload.product.model,
      };
    }
    return payload;
  }

  // Extract stationId từ topic nếu có: avi/.../station/{stationId}/...
  const topicParts = topic.split('/');
  const stationIndex = topicParts.indexOf('station');
  const extractedStationId = stationIndex >= 0 ? topicParts[stationIndex + 1] : null;

  const toNumber = (value: any, fallback: number = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  // Special handling: NG rate vượt ngưỡng
  if (payload.alertType === 'NG_RATE_THRESHOLD') {
    const currentRate = toNumber(payload.ngRate?.current);
    const thresholdRate = toNumber(payload.ngRate?.threshold);
    const warningThreshold = toNumber(payload.thresholdConfig?.warningThreshold);
    const criticalThreshold = toNumber(payload.thresholdConfig?.criticalThreshold);

    const stationId =
      payload.station?.id ??
      payload.stationId ??
      extractedStationId ??
      'unknown';

    const measurementPoint = payload.measurementPoint
      ? {
          id: toNumber(payload.measurementPoint.id),
          code: String(payload.measurementPoint.code ?? 'N/A'),
          name: String(payload.measurementPoint.name ?? 'N/A'),
          referenceImageUrl: payload.measurementPoint.referenceImageUrl
            ? String(payload.measurementPoint.referenceImageUrl)
            : undefined,
        }
      : null;

    const productModel = payload.productModel
      ? {
          id: toNumber(payload.productModel.id),
          code: String(payload.productModel.code ?? 'N/A'),
          name: String(payload.productModel.name ?? 'N/A'),
        }
      : null;

    const generatedMessage =
      payload.message ||
      `[CẢNH BÁO] NG Rate ${currentRate.toFixed(2)}% vượt ngưỡng ${thresholdRate.toFixed(2)}%`;

    const stationName =
      payload.station?.name ||
      payload.stationName ||
      (typeof stationId === 'string' || typeof stationId === 'number'
        ? `Station ${stationId}`
        : 'Unknown Station');

    return {
      alertId: payload.alertId || `NGRATE-${Date.now()}`,
      // Capture server ack/resolve target id if the live payload carries one.
      serverAlertId: payload.serverAlertId || undefined,
      alertType: 'NG_RATE_THRESHOLD',
      timestamp: payload.timestamp || new Date().toISOString(),
      station: {
        id: String(stationId),
        name: stationName,
        line: payload.station?.line || payload.station?.workshop || payload.workshop || 'N/A',
        area: payload.station?.factory,
      },
      product: {
        id: productModel?.code || String(productModel?.id || 'N/A'),
        name: productModel?.name || 'N/A',
        model: productModel?.code,
      },
      error: {
        code: measurementPoint?.code ? `NGRATE-${measurementPoint.code}` : 'NGRATE-THRESHOLD',
        type: 'NG_RATE_THRESHOLD',
        description: generatedMessage,
      },
      severity: normalizeSeverity(payload.severity || 'warning'),
      message: generatedMessage,
      machine: payload.machine
        ? {
            id: toNumber(payload.machine.id),
            name: String(payload.machine.name || 'N/A'),
            code: String(payload.machine.code || 'N/A'),
          }
        : undefined,
      measurementPoint,
      productModel,
      ngRate: {
        current: currentRate,
        threshold: thresholdRate,
        totalInspections: toNumber(payload.ngRate?.totalInspections),
        ngCount: toNumber(payload.ngRate?.ngCount),
      },
      thresholdConfig: payload.thresholdConfig
        ? {
            id: toNumber(payload.thresholdConfig.id),
            name: String(payload.thresholdConfig.name || 'N/A'),
            warningThreshold,
            criticalThreshold,
            minSampleSize: toNumber(payload.thresholdConfig.minSampleSize),
          }
        : undefined,
      period: payload.period
        ? {
            date: String(payload.period.date || ''),
            from: String(payload.period.from || ''),
            to: String(payload.period.to || ''),
          }
        : undefined,
    };
  }

   // Special handling: NG inspection alert (NG_ALERT) từ hệ thống AOI
   if (payload.type === 'NG_ALERT') {
     const firstNgPoint = Array.isArray(payload.ngPoints) && payload.ngPoints.length > 0
       ? payload.ngPoints[0]
       : null;

     const totalNG = typeof payload.totalNG === 'number' ? payload.totalNG : 1;

     return {
       alertId:
         payload.alertId ||
         payload.id ||
         (payload.inspectionId ? `NG-${payload.inspectionId}` : `NG-${Date.now()}`),
       // Capture server ack/resolve target id if the live payload carries one.
       serverAlertId: payload.serverAlertId || undefined,
       timestamp: payload.timestamp || new Date().toISOString(),
       station: {
         id: extractedStationId || payload.stationId || 'unknown',
         name:
           payload.stationName ||
           payload.station?.name ||
           `Station ${payload.stationId || extractedStationId || 'Unknown'}`,
         line: payload.lineId || payload.line || payload.machineName || '',
       },
       product: {
         id: payload.serialNumber || payload.productId || 'N/A',
         name:
           payload.productName ||
           payload.product?.name ||
           payload.serialNumber ||
           'N/A',
         model: payload.productModel?.code || payload.productCode || payload.modelCode || undefined,
       },
       error: {
         code:
           (firstNgPoint && firstNgPoint.pointId != null
             ? `NG-${firstNgPoint.pointId}`
             : 'NG'),
         type: payload.type || 'NG_ALERT',
         description:
           firstNgPoint
             ? `NG tại ${firstNgPoint.pointName}: ${firstNgPoint.actualValue} (total NG: ${totalNG})`
             : `NG alert (total NG: ${totalNG})`,
       },
       // NG alert mặc định severity cao để dễ thấy trên dashboard
       severity: 'high' as AlertSeverity,
       // Preserve ngPoints with referenceImageUrl for detail screen
       ngPoints: Array.isArray(payload.ngPoints) ? payload.ngPoints.map((p: any) => ({
         pointId: p.pointId ?? 0,
         pointName: p.pointName || 'Unknown',
         result: p.result || 'NG',
         actualValue: p.actualValue != null ? String(p.actualValue) : undefined,
         expectedValue: p.expectedValue != null ? String(p.expectedValue) : undefined,
         imageUrl: p.imageUrl || undefined,
         referenceImageUrl: p.referenceImageUrl || undefined,
         workstationId: p.workstationId,
         normalizedX: p.normalizedX != null ? Number(p.normalizedX) : undefined,
         normalizedY: p.normalizedY != null ? Number(p.normalizedY) : undefined,
         normalizedRadius: p.normalizedRadius != null ? Number(p.normalizedRadius) : undefined,
       })) : undefined,
       totalNG: payload.totalNG,
       inspectionId: payload.inspectionId,
       imageUrl: payload.imageUrl,
       machine: payload.machine,
       // Preserve productModel for product-based filtering (avoid cross-product contamination)
       productModel: payload.productModel
         ? {
             id: Number(payload.productModel.id) || 0,
             code: String(payload.productModel.code || ''),
             name: String(payload.productModel.name || ''),
           }
         : (payload.productCode || payload.modelCode)
           ? {
               id: 0,
               code: String(payload.productCode || payload.modelCode || ''),
               name: String(payload.productName || payload.productCode || payload.modelCode || ''),
             }
           : undefined,
     };
   }

  // Normalize từ format khác — preserve additional fields if present
  return {
    alertId: payload.alertId || payload.id || `ALT-${Date.now()}`,
    // Capture server ack/resolve target id if the live payload carries one.
    serverAlertId: payload.serverAlertId || undefined,
    alertType: payload.alertType || undefined,
    timestamp: payload.timestamp || payload.time || payload.createdAt || new Date().toISOString(),
    station: payload.station || {
      id: payload.stationId || extractedStationId || 'unknown',
      name: payload.stationName || payload.station_name || `Station ${payload.stationId || extractedStationId || 'Unknown'}`,
      line: payload.lineId || payload.line || '',
    },
    product: payload.product || {
      id: payload.productId || payload.product_id || 'N/A',
      name: payload.productName || payload.product_name || 'N/A',
    },
    error: payload.error && typeof payload.error === 'object' ? payload.error : {
      code: payload.errorCode || payload.error_code || payload.code || 'ERR-001',
      type: payload.errorType || payload.error_type || payload.type || 'Error',
      description: payload.error || payload.message || payload.errorMessage || payload.description || 'Unknown error',
    },
    severity: normalizeSeverity(payload.severity || payload.level || payload.priority || 'medium'),
    // Preserve ngPoints if available in raw payload
    ngPoints: Array.isArray(payload.ngPoints) ? payload.ngPoints.map((p: any) => ({
      pointId: p.pointId ?? 0,
      pointName: p.pointName || 'Unknown',
      result: p.result || 'NG',
      actualValue: p.actualValue != null ? String(p.actualValue) : undefined,
      expectedValue: p.expectedValue != null ? String(p.expectedValue) : undefined,
      imageUrl: p.imageUrl || undefined,
      referenceImageUrl: p.referenceImageUrl || undefined,
      workstationId: p.workstationId,
      normalizedX: p.normalizedX != null ? Number(p.normalizedX) : undefined,
      normalizedY: p.normalizedY != null ? Number(p.normalizedY) : undefined,
      normalizedRadius: p.normalizedRadius != null ? Number(p.normalizedRadius) : undefined,
    })) : undefined,
    totalNG: payload.totalNG,
    inspectionId: payload.inspectionId,
    message: payload.message || payload.errorMessage || undefined,
    measurementPoint: payload.measurementPoint || undefined,
    productModel: payload.productModel || undefined,
    machine: payload.machine || undefined,
  };
};

/**
 * Normalize severity string to valid value
 */
const normalizeSeverity = (severity: string): AlertSeverity => {
  const s = String(severity).toLowerCase();
  if (['critical', 'fatal', 'emergency'].includes(s)) return 'critical';
  if (['high', 'error', 'severe'].includes(s)) return 'high';
  if (['medium', 'warning', 'warn'].includes(s)) return 'medium';
  if (['low', 'minor'].includes(s)) return 'low';
  if (['info', 'information', 'notice'].includes(s)) return 'info';
  return 'medium';
};

// ============================================
// STRING HELPERS
// ============================================

/**
 * Truncate text
 */
export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
};

/**
 * Capitalize first letter
 */
export const capitalizeFirst = (text: string): string => {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

// ============================================
// TRANSLATION HELPER
// ============================================

/**
 * Get translation function
 */
export const getTranslation = (lang: Language) => {
  return TRANSLATIONS[lang];
};

/**
 * Translate key
 */
export const t = (key: keyof typeof TRANSLATIONS.vi, lang: Language = 'vi'): string => {
  return TRANSLATIONS[lang][key] || key;
};
