/**
 * Factory Alert System - Alert Card Component
 * Card hiển thị thông tin alert trong danh sách
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Alert } from '../types';
import { SEVERITY_CONFIG, TRANSLATIONS } from '../utils/constants';
import { formatRelativeTime, getSeverityColor } from '../utils/helpers';
import { useTheme, Theme } from '../context/ThemeContext';
import { useSettingsStore, selectLanguage } from '../store';
import SeverityBadge from './SeverityBadge';

interface AlertCardProps {
  alert: Alert;
  onPress?: (alert: Alert) => void;
  onAcknowledge?: (alert: Alert) => void;
  onDismiss?: (alert: Alert) => void;
  compact?: boolean;
}

const AlertCardComponent: React.FC<AlertCardProps> = ({
  alert,
  onPress,
  onAcknowledge,
  onDismiss,
  compact = false,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const language = useSettingsStore(selectLanguage);
  const severityConfig = SEVERITY_CONFIG[alert.severity];

  const handlePress = useCallback(() => {
    if (onPress) {
      onPress(alert);
    }
  }, [alert, onPress]);

  const handleAcknowledge = useCallback(() => {
    if (onAcknowledge) {
      onAcknowledge(alert);
    }
  }, [alert, onAcknowledge]);

  const handleDismiss = useCallback(() => {
    if (onDismiss) {
      onDismiss(alert);
    }
  }, [alert, onDismiss]);

  const relativeTime = formatRelativeTime(alert.timestamp, language);
  // 3C: critical/high read instantly via a faint severity wash + a thicker accent bar.
  const isUrgent = alert.severity === 'critical' || alert.severity === 'high';
  const urgentCardStyle = isUrgent
    ? {
        backgroundColor: severityConfig.bgColor + (theme.isDark ? '22' : '0D'),
        borderLeftWidth: 6,
      }
    : null;

  if (compact) {
    return (
      <TouchableOpacity
        style={[styles.compactCard, { borderLeftColor: severityConfig.bgColor }]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.compactContent}>
          <View style={styles.compactHeader}>
            <View style={styles.headerBadges}>
              <SeverityBadge severity={alert.severity} size="small" />
              {/* MB6: escalated indicator (compact) */}
              {alert.escalated && (
                <Icon name="arrow-up-bold-circle" size={14} color="#B91C1C" />
              )}
            </View>
            <Text style={styles.compactTime}>{relativeTime}</Text>
          </View>
          <Text style={styles.compactTitle} numberOfLines={1}>
            {alert.error.type}
          </Text>
          <Text style={styles.compactSubtitle} numberOfLines={1}>
            {alert.station.name}
          </Text>
        </View>
        <Icon
          name="chevron-right"
          size={20}
          color={theme.colors.textMuted}
        />
      </TouchableOpacity>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { borderLeftColor: severityConfig.bgColor },
        urgentCardStyle,
        pressed && styles.cardPressed,
      ]}
      onPress={handlePress}
      android_ripple={{ color: severityConfig.bgColor + '22' }}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerBadges}>
          <SeverityBadge severity={alert.severity} size="medium" />
          {/* MB6: escalated badge */}
          {alert.escalated && (
            <View style={styles.escalatedBadge}>
              <Icon name="arrow-up-bold-circle" size={12} color="#FFFFFF" />
              <Text style={styles.escalatedBadgeText}>
                {TRANSLATIONS[language].escalated}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.time}>{relativeTime}</Text>
      </View>

      {/* Error Info */}
      <View style={styles.errorSection}>
        <View style={styles.errorHeader}>
          <Icon
            name="alert-circle-outline"
            size={18}
            color={severityConfig.bgColor}
          />
          <Text style={styles.errorCode}>{alert.error.code}</Text>
        </View>
        <Text style={styles.errorType}>{alert.error.type}</Text>
        <Text style={styles.errorDescription} numberOfLines={2}>
          {alert.error.description}
        </Text>

        {/* NG Rate Badge for NG_RATE_THRESHOLD alerts */}
        {alert.alertType === 'NG_RATE_THRESHOLD' && alert.ngRate && (
          <View style={styles.ngRateRow}>
            <Icon name="chart-line" size={16} color={theme.colors.error} />
            <Text style={styles.ngRateText}>
              NG: {alert.ngRate.current.toFixed(2)}% / {alert.ngRate.threshold.toFixed(2)}%
            </Text>
            {alert.measurementPoint && (
              <Text style={styles.ngRateMeasurement} numberOfLines={1}>
                • {alert.measurementPoint.name}
              </Text>
            )}
          </View>
        )}
        
        {/* Error Image Indicator (on-demand, images loaded in AlertDetail) */}
        {alert.inspectionId && (
          <View style={styles.imageIndicator}>
            <Icon name="image-multiple-outline" size={16} color={theme.colors.primary} />
            <Text style={styles.imageIndicatorText}>
              {language === 'vi' ? 'Có ảnh kiểm tra' : language === 'zh' ? '有检查图片' : 'Images available'}
            </Text>
            <Icon name="chevron-right" size={14} color={theme.colors.textMuted} />
          </View>
        )}
      </View>

      {/* Station & Product Info */}
      <View style={styles.infoSection}>
        <View style={styles.infoRow}>
          <Icon
            name="factory"
            size={16}
            color={theme.colors.textSecondary}
          />
          <Text style={styles.infoText}>
            {alert.station.name} • {alert.station.line}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Icon
            name="package-variant"
            size={16}
            color={theme.colors.textSecondary}
          />
          <Text style={styles.infoText}>{alert.product.name}</Text>
        </View>
      </View>

      {/* Actions (only for pending alerts) */}
      {alert.status === 'pending' && (onAcknowledge || onDismiss) && (
        <View style={styles.actions}>
          {onAcknowledge && (
            <TouchableOpacity
              style={[styles.actionButton, styles.acknowledgeButton]}
              onPress={handleAcknowledge}
            >
              <Icon name="check" size={16} color={theme.colors.success} />
              <Text style={[styles.actionText, styles.acknowledgeText]}>
                {language === 'vi' ? 'Xác nhận' : language === 'zh' ? '确认' : 'Acknowledge'}
              </Text>
            </TouchableOpacity>
          )}
          {onDismiss && (
            <TouchableOpacity
              style={[styles.actionButton, styles.dismissButton]}
              onPress={handleDismiss}
            >
              <Icon name="close" size={16} color={theme.colors.error} />
              <Text style={[styles.actionText, styles.dismissText]}>
                {language === 'vi' ? 'Bỏ qua' : language === 'zh' ? '忽略' : 'Dismiss'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Status indicator for non-pending alerts */}
      {alert.status !== 'pending' && (
        <View style={styles.statusIndicator}>
          <Icon
            name={alert.status === 'acknowledged' ? 'eye-check' : 'check-circle'}
            size={14}
            color={
              alert.status === 'acknowledged'
                ? theme.colors.info
                : theme.colors.success
            }
          />
          <Text
            style={[
              styles.statusText,
              {
                color:
                  alert.status === 'acknowledged'
                    ? theme.colors.info
                    : theme.colors.success,
              },
            ]}
          >
            {alert.status === 'acknowledged'
              ? language === 'vi'
                ? 'Đã xác nhận'
                : language === 'zh'
                ? '已确认'
                : 'Acknowledged'
              : language === 'vi'
              ? 'Đã xử lý'
              : language === 'zh'
              ? '已解决'
              : 'Resolved'}
          </Text>
        </View>
      )}
    </Pressable>
  );
};

const createStyles = (theme: Theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    // Wave 3B: cheap "shadow" = hairline border (iOS separation) + very low
    // elevation token (Android). The severity borderLeft supplies the accent.
    borderLeftWidth: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    elevation: theme.elevation.sm,
  },
  cardPressed: {
    opacity: 0.85,
  },
  compactCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    borderLeftWidth: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: theme.elevation.sm,
  },
  compactContent: {
    flex: 1,
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  compactTime: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  compactTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 2,
  },
  compactSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  headerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  escalatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#B91C1C', // deep red — distinct from severity colors
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 3,
  },
  escalatedBadgeText: {
    color: '#FFFFFF',
    fontSize: theme.fontSize.xs,
    fontWeight: '700',
  },
  time: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  errorSection: {
    marginBottom: theme.spacing.sm,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  errorCode: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginLeft: 6,
    fontFamily: 'monospace',
  },
  errorType: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.heavy,
    color: theme.colors.text,
    marginBottom: 4,
  },
  errorDescription: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
  imageIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: theme.colors.primary + '10',
    borderRadius: theme.borderRadius.sm,
  },
  imageIndicatorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    marginLeft: 6,
    flex: 1,
    fontWeight: '500',
  },
  infoSection: {
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  infoText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginLeft: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    marginLeft: theme.spacing.sm,
  },
  acknowledgeButton: {
    backgroundColor: `${theme.colors.success}15`,
  },
  dismissButton: {
    backgroundColor: `${theme.colors.error}15`,
  },
  actionText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    marginLeft: 4,
  },
  acknowledgeText: {
    color: theme.colors.success,
  },
  dismissText: {
    color: theme.colors.error,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  statusText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '500',
    marginLeft: 6,
  },
  // NG Rate styles for AlertCard
  ngRateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    paddingBottom: 2,
    borderTopWidth: 1,
    borderTopColor: theme.colors.error + '20',
    backgroundColor: theme.colors.error + '08',
    marginHorizontal: -theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
  },
  ngRateText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
    color: theme.colors.error,
    marginLeft: 6,
    fontFamily: 'monospace',
  },
  ngRateMeasurement: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginLeft: 6,
    flex: 1,
  },
});

/**
 * Wave 2E: memoize so a re-render of the list parent (search typing, dashboard
 * toggle, unrelated store updates) does not re-render every card. Compare only
 * the fields that actually drive this card's output; the callbacks are stable
 * (useCallback in the screen). Theme/language changes still re-render via hooks.
 */
const areEqual = (prev: AlertCardProps, next: AlertCardProps): boolean =>
  prev.alert.id === next.alert.id &&
  prev.alert.status === next.alert.status &&
  prev.alert.severity === next.alert.severity &&
  prev.alert.escalated === next.alert.escalated &&
  prev.compact === next.compact &&
  prev.onPress === next.onPress &&
  prev.onAcknowledge === next.onAcknowledge &&
  prev.onDismiss === next.onDismiss;

const AlertCard = React.memo(AlertCardComponent, areEqual);

export default AlertCard;
