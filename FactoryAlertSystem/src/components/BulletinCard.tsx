/**
 * Factory Alert System - Bulletin Card Component
 * Card hiển thị thông tin periodic bulletin trong danh sách
 */

import React, { useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PeriodicBulletin } from '../types';
import { useSettingsStore, selectLanguage } from '../store';
import { formatRelativeTime, getYieldColor } from '../utils/helpers';

interface BulletinCardProps {
  bulletin: PeriodicBulletin;
  onPress?: (bulletin: PeriodicBulletin) => void;
  compact?: boolean;
}

const BulletinCardComponent: React.FC<BulletinCardProps> = ({ bulletin, onPress, compact = false }) => {
  const language = useSettingsStore(selectLanguage);
  const { statistics, period, failPoints } = bulletin;
  const { theme } = useTheme();
  const themedStyles = getThemedStyles(theme);

  const handlePress = useCallback(() => {
    if (onPress) {
      onPress(bulletin);
    }
  }, [bulletin, onPress]);

  const relativeTime = formatRelativeTime(bulletin.timestamp, language);

  // 3C: shared 5-tier helper so the card and BulletinDetailScreen agree (previously
  // this collapsed the top two tiers by falling back to theme.colors.success).
  const yieldColor = getYieldColor(statistics.yieldRate);
  const topFailPoint = failPoints.length > 0 ? failPoints[0] : null;

  if (compact) {
    return (
      <TouchableOpacity
        style={[themedStyles.compactCard, !bulletin.isRead && themedStyles.unreadCard]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={themedStyles.compactContent}>
          <View style={themedStyles.compactHeader}>
            <View style={themedStyles.bulletinBadge}>
              <Icon name="chart-bar" size={12} color={theme.colors.white || '#FFFFFF'} />
              <Text style={themedStyles.bulletinBadgeText}>
                {language === 'vi' ? 'Bản tin' : language === 'zh' ? '公告' : 'Bulletin'}
              </Text>
            </View>
            <Text style={themedStyles.compactTime}>{relativeTime}</Text>
          </View>
          <Text style={themedStyles.compactTitle} numberOfLines={1}>
            {bulletin.stationName} - {bulletin.lineName}
          </Text>
          <View style={themedStyles.compactStats}>
            <Text style={[themedStyles.yieldText, { color: yieldColor }]}> 
              Yield: {statistics.yieldRate}%
            </Text>
            <Text style={themedStyles.compactSubtitle}>
              NG: {statistics.ngCount}/{statistics.totalCount}
            </Text>
          </View>
        </View>
        {!bulletin.isRead && <View style={themedStyles.unreadDot} />}
        <Icon name="chevron-right" size={20} color={theme.colors.textMuted || theme.colors.secondary || '#94A3B8'} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[themedStyles.card, !bulletin.isRead && themedStyles.unreadCard]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {/* Header */}
      <View style={themedStyles.header}>
        <View style={themedStyles.headerLeft}>
          <View style={themedStyles.bulletinBadge}>
            <Icon name="chart-bar" size={14} color={theme.colors.white || '#FFFFFF'} />
            <Text style={themedStyles.bulletinBadgeText}>
              {language === 'vi' ? 'Bản tin định kỳ' : language === 'zh' ? '定期公告' : 'Periodic Bulletin'}
            </Text>
          </View>
          {!bulletin.isRead && <View style={themedStyles.unreadDot} />}
        </View>
        <Text style={themedStyles.timeText}>{relativeTime}</Text>
      </View>

      {/* Station Info */}
      <View style={themedStyles.stationInfo}>
        <Icon name="factory" size={16} color={theme.colors.textMuted || theme.colors.secondary || '#64748B'} />
        <Text style={themedStyles.stationText} numberOfLines={1}>
          {bulletin.stationName} • {bulletin.lineName}
        </Text>
      </View>
      <Text style={themedStyles.factoryText} numberOfLines={1}>
        {bulletin.factoryName} / {bulletin.workshopName}
      </Text>

      {/* Period */}
      <View style={themedStyles.periodRow}>
        <Icon name="clock-outline" size={14} color={theme.colors.textMuted || theme.colors.secondary || '#94A3B8'} />
        <Text style={themedStyles.periodText}>
          {new Date(period.start).toLocaleTimeString(language === 'vi' ? 'vi-VN' : language === 'zh' ? 'zh-CN' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          -{' '}
          {new Date(period.end).toLocaleTimeString(language === 'vi' ? 'vi-VN' : language === 'zh' ? 'zh-CN' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          ({period.intervalMinutes} {language === 'vi' ? 'phút' : language === 'zh' ? '分钟' : 'min'})
        </Text>
      </View>

      {/* Statistics */}
      <View style={themedStyles.statsContainer}>
        <View style={themedStyles.statItem}>
          <Text style={themedStyles.statValue}>{statistics.totalCount}</Text>
          <Text style={themedStyles.statLabel}>
            {language === 'vi' ? 'Tổng' : language === 'zh' ? '总计' : 'Total'}
          </Text>
        </View>
        <View style={themedStyles.statItem}>
          <Text style={[themedStyles.statValue, { color: theme.colors.success || '#22C55E' }]}> 
            {statistics.okCount}
          </Text>
          <Text style={themedStyles.statLabel}>OK</Text>
        </View>
        <View style={themedStyles.statItem}>
          <Text style={[themedStyles.statValue, { color: theme.colors.error || '#EF4444' }]}> 
            {statistics.ngCount}
          </Text>
          <Text style={themedStyles.statLabel}>NG</Text>
        </View>
        <View style={themedStyles.statItem}>
          <Text style={[themedStyles.statValue, { color: yieldColor, fontWeight: '800' }]}> 
            {statistics.yieldRate}%
          </Text>
          <Text style={themedStyles.statLabel}>Yield</Text>
        </View>
      </View>

      {/* Top fail point */}
      {topFailPoint && (
        <View style={themedStyles.topFailRow}>
          <Icon name="alert-circle" size={14} color={theme.colors.error || '#EF4444'} />
          <Text style={themedStyles.topFailText} numberOfLines={1}>
            Top NG: {topFailPoint.pointName} ({topFailPoint.ngCount} - {topFailPoint.percentage}%)
          </Text>
        </View>
      )}

      {/* Image availability indicator */}
      {failPoints.some(fp => fp.imageUrl || fp.latestInspectionId) && (
        <View style={themedStyles.imageIndicator}>
          <Icon name="camera-outline" size={13} color={theme.colors.primary || '#3B82F6'} />
          <Text style={themedStyles.imageIndicatorText}>
            {language === 'vi' ? 'Có ảnh kiểm tra' : language === 'zh' ? '有检查图片' : 'Inspection images available'}
          </Text>
          <Icon name="chevron-right" size={14} color={theme.colors.textMuted || theme.colors.secondary || '#94A3B8'} />
        </View>
      )}
    </TouchableOpacity>
  );
};


import { Theme } from '../context/ThemeContext';
function getThemedStyles(theme: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      padding: theme.spacing.md,
      marginHorizontal: theme.spacing.md,
      marginVertical: 6,
      // Wave 3B: hairline border + low elevation token (was a blurred shadow +
      // elevation 3, expensive per-row on old GPUs).
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      elevation: theme.elevation.sm,
      borderLeftWidth: 5,
      borderLeftColor: theme.colors.primary,
    },
    unreadCard: {
      borderLeftColor: theme.colors.primaryDark || theme.colors.primary,
      backgroundColor: theme.colors.surfaceVariant,
    },
    compactCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.sm,
      marginHorizontal: theme.spacing.md,
      marginVertical: 4,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      elevation: theme.elevation.sm,
      borderLeftWidth: 4,
      borderLeftColor: theme.colors.primary,
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
    compactTitle: {
      fontSize: theme.fontSize.md,
      fontWeight: theme.fontWeight.bold,
      color: theme.colors.text,
      marginBottom: 2,
    },
    compactSubtitle: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.textSecondary || theme.colors.text,
    },
    compactTime: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.textMuted || theme.colors.text,
    },
    compactStats: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    bulletinBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: theme.borderRadius.sm,
      gap: 4,
    },
    bulletinBadgeText: {
      fontSize: theme.fontSize.xs,
      fontWeight: theme.fontWeight.bold,
      color: theme.colors.white || '#FFFFFF',
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.error,
    },
    timeText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.textMuted || theme.colors.text,
    },
    stationInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 2,
    },
    stationText: {
      fontSize: theme.fontSize.md,
      fontWeight: theme.fontWeight.bold,
      color: theme.colors.text,
      flex: 1,
    },
    factoryText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.textSecondary || theme.colors.text,
      marginLeft: 22,
      marginBottom: 8,
    },
    periodRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 12,
      paddingHorizontal: 4,
    },
    periodText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.textMuted || theme.colors.text,
    },
    statsContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      backgroundColor: theme.colors.surfaceVariant || theme.colors.surface,
      borderRadius: theme.borderRadius.md,
      paddingVertical: 10,
      paddingHorizontal: 8,
      marginBottom: 8,
    },
    statItem: {
      alignItems: 'center',
    },
    statValue: {
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.heavy,
      color: theme.colors.text,
    },
    statLabel: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.textMuted || theme.colors.text,
      marginTop: 2,
      fontWeight: theme.fontWeight.medium,
    },
    yieldText: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.heavy,
    },
    topFailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingTop: 4,
    },
    topFailText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.textSecondary || theme.colors.text,
      flex: 1,
    },
    imageIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: theme.colors.surfaceVariant || theme.colors.surface,
      borderRadius: theme.borderRadius.sm,
    },
    imageIndicatorText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.primary,
      fontWeight: theme.fontWeight.medium,
      flex: 1,
    },
  });
}

/**
 * Wave 2E: memoize. Bulletins are immutable snapshots except for the isRead flag,
 * so re-render only when the id or read state changes (or the stable onPress /
 * compact props). Theme/language changes still re-render via hooks.
 */
const areEqual = (prev: BulletinCardProps, next: BulletinCardProps): boolean =>
  prev.bulletin.bulletinId === next.bulletin.bulletinId &&
  prev.bulletin.isRead === next.bulletin.isRead &&
  prev.compact === next.compact &&
  prev.onPress === next.onPress;

const BulletinCard = React.memo(BulletinCardComponent, areEqual);

export default BulletinCard;
