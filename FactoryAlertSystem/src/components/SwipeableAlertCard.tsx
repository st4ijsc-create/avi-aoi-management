/**
 * Factory Alert System - Swipeable Alert Card
 * Alert card với swipe gestures để Acknowledge/Dismiss
 */

import React, { useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Swipeable, RectButton } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { Alert } from '../types';
import SeverityBadge from './SeverityBadge';
import { SEVERITY_CONFIG } from '../utils/constants';
import { formatRelativeTime } from '../utils/helpers';
import { useTheme, Theme } from '../context/ThemeContext';

interface SwipeableAlertCardProps {
  alert: Alert;
  onPress?: () => void;
  onAcknowledge?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

const SwipeableAlertCardComponent: React.FC<SwipeableAlertCardProps> = ({
  alert,
  onPress,
  onAcknowledge,
  onDismiss,
  compact = false,
}) => {
  const swipeableRef = useRef<Swipeable>(null);
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Wave 4A: derive the swipe threshold from live window width so it stays
  // correct across rotation (was a one-shot Dimensions.get at module scope).
  const { width: screenWidth } = useWindowDimensions();
  const swipeThreshold = screenWidth * 0.25;

  // 3A: use the SURFACE colour (.bgColor) for the severity strip — `.color` is the
  // on-badge text colour (#FFFFFF/#000000) and would render an invisible/black strip.
  const severityColor = SEVERITY_CONFIG[alert.severity]?.bgColor || theme.colors.textMuted;
  // 3C: critical/high wash so the row reads instantly on a busy list.
  const isUrgent = alert.severity === 'critical' || alert.severity === 'high';
  const urgentCardStyle = isUrgent
    ? { backgroundColor: severityColor + (theme.isDark ? '22' : '0D'), borderLeftWidth: 6 }
    : null;

  // Close swipeable programmatically
  const closeSwipeable = () => {
    swipeableRef.current?.close();
  };

  // Handle acknowledge action
  const handleAcknowledge = () => {
    closeSwipeable();
    onAcknowledge?.();
  };

  // Handle dismiss action
  const handleDismiss = () => {
    closeSwipeable();
    onDismiss?.();
  };

  // Render left actions (Acknowledge - swipe right)
  const renderLeftActions = (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [0, 80],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });

    const opacity = dragX.interpolate({
      inputRange: [0, 40, 80],
      outputRange: [0, 0.5, 1],
      extrapolate: 'clamp',
    });

    return (
      <RectButton style={styles.leftAction} onPress={handleAcknowledge}>
        <Animated.View style={[styles.actionContent, { opacity, transform: [{ scale }] }]}>
          <Icon name="check-circle" size={28} color="#FFFFFF" />
          <Text style={styles.actionText}>Xác nhận</Text>
        </Animated.View>
      </RectButton>
    );
  };

  // Render right actions (Dismiss - swipe left)
  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    });

    const opacity = dragX.interpolate({
      inputRange: [-80, -40, 0],
      outputRange: [1, 0.5, 0],
      extrapolate: 'clamp',
    });

    return (
      <RectButton style={styles.rightAction} onPress={handleDismiss}>
        <Animated.View style={[styles.actionContent, { opacity, transform: [{ scale }] }]}>
          <Icon name="close-circle" size={28} color="#FFFFFF" />
          <Text style={styles.actionText}>Bỏ qua</Text>
        </Animated.View>
      </RectButton>
    );
  };

  // Handle swipe complete
  const onSwipeableOpen = (direction: 'left' | 'right') => {
    if (direction === 'right') {
      handleAcknowledge();
    } else {
      handleDismiss();
    }
  };

  // Only show swipe actions for pending alerts
  const canSwipe = alert.status === 'pending';

  const cardContent = (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        compact && styles.cardCompact,
        { borderLeftColor: severityColor },
        urgentCardStyle,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
      android_ripple={{ color: severityColor + '22' }}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerBadges}>
          <SeverityBadge severity={alert.severity} size="small" />
          {/* MB6: escalated indicator */}
          {alert.escalated && (
            <Icon name="arrow-up-bold-circle" size={14} color="#B91C1C" />
          )}
        </View>
        <Text style={styles.time}>{formatRelativeTime(alert.timestamp)}</Text>
      </View>

      {/* Error Info */}
      <View style={styles.errorInfo}>
        <Text style={styles.errorCode}>
          <Icon name="code-tags" size={12} color={theme.colors.textSecondary} />
          {' '}{alert.error.code}
        </Text>
        <Text style={styles.errorType} numberOfLines={1}>
          {alert.error.type}
        </Text>
        {!compact && (
          <Text style={styles.errorDesc} numberOfLines={2}>
            {alert.error.description}
          </Text>
        )}
      </View>

      {/* Station & Product Info */}
      <View style={styles.infoRow}>
        <View style={styles.infoItem}>
          <Icon name="factory" size={14} color={theme.colors.textMuted} />
          <Text style={styles.infoText} numberOfLines={1}>
            {alert.station.name}
          </Text>
        </View>
        {!compact && (
          <View style={styles.infoItem}>
            <Icon name="cube-outline" size={14} color={theme.colors.textMuted} />
            <Text style={styles.infoText} numberOfLines={1}>
              {alert.product.name}
            </Text>
          </View>
        )}
      </View>

      {/* Status indicator for non-pending */}
      {alert.status !== 'pending' && (
        <View style={styles.statusBar}>
          <Icon
            name={alert.status === 'acknowledged' ? 'check' : 'check-all'}
            size={14}
            color={theme.colors.success}
          />
          <Text style={styles.statusText}>
            {alert.status === 'acknowledged' ? 'Đã xác nhận' : 'Đã xử lý'}
          </Text>
        </View>
      )}

      {/* Swipe hint for pending alerts */}
      {canSwipe && (
        <View style={styles.swipeHint}>
          <Icon name="gesture-swipe-horizontal" size={12} color={theme.colors.textMuted} />
          <Text style={styles.swipeHintText}>Vuốt để xử lý</Text>
        </View>
      )}
    </Pressable>
  );

  if (!canSwipe) {
    return cardContent;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      friction={2}
      leftThreshold={swipeThreshold}
      rightThreshold={swipeThreshold}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      onSwipeableOpen={onSwipeableOpen}
      overshootLeft={false}
      overshootRight={false}
    >
      {cardContent}
    </Swipeable>
  );
};

/**
 * Wave 2E: memoize. Compare only render-driving fields; callbacks are stable
 * (useCallback at call sites). Theme changes still re-render via useTheme.
 */
const areEqual = (prev: SwipeableAlertCardProps, next: SwipeableAlertCardProps): boolean =>
  prev.alert.id === next.alert.id &&
  prev.alert.status === next.alert.status &&
  prev.alert.severity === next.alert.severity &&
  prev.alert.escalated === next.alert.escalated &&
  prev.compact === next.compact &&
  prev.onPress === next.onPress &&
  prev.onAcknowledge === next.onAcknowledge &&
  prev.onDismiss === next.onDismiss;

export const SwipeableAlertCard = React.memo(SwipeableAlertCardComponent, areEqual);

const createStyles = (theme: Theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    // Wave 3B: hairline border + low elevation token (cheap "shadow" on old GPUs);
    // the severity borderLeft supplies the accent.
    borderLeftWidth: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    elevation: theme.elevation.sm,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardCompact: {
    padding: theme.spacing.sm,
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
  time: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  errorInfo: {
    marginBottom: theme.spacing.sm,
  },
  errorCode: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  errorType: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.heavy,
    color: theme.colors.text,
    marginBottom: 4,
  },
  errorDesc: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },
  infoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
    maxWidth: 120,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 4,
  },
  statusText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.success,
    fontWeight: '600',
  },
  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.xs,
    gap: 4,
  },
  swipeHintText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  leftAction: {
    backgroundColor: theme.colors.success,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 20,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    marginRight: -theme.spacing.sm,
  },
  rightAction: {
    backgroundColor: theme.colors.error,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: 20,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    marginLeft: -theme.spacing.sm,
  },
  actionContent: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});

export default SwipeableAlertCard;
