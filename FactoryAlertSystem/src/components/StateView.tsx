/**
 * Factory Alert System - StateView (Wave 3G)
 *
 * Shared loading / empty / error surface for live screens. The `empty` variant
 * reuses <EmptyState>; `error` adds an optional retry action; `loading` shows a
 * lightweight opacity-pulse skeleton (native-driver only — safe on the low-end
 * factory tablets). Set `fill={false}` to render inline inside a section instead
 * of filling the screen.
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, Pressable } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';

import { useTheme, Theme } from '../context/ThemeContext';
import EmptyState from './EmptyState';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Opacity-pulse skeleton block. Animates opacity ONLY (native-driver), so it is
 * cheap to run on old Android GPUs — never animate width/height/colour here.
 */
export const Skeleton: React.FC<SkeletonProps> = ({ width = '100%', height = 16, radius, style }) => {
  const { theme } = useTheme();
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 650, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.4, { duration: 650, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.borderRadius.sm,
          backgroundColor: theme.colors.surfaceVariant,
        },
        animatedStyle,
        style,
      ]}
    />
  );
};

export type StateVariant = 'loading' | 'empty' | 'error';

interface StateViewProps {
  variant: StateVariant;
  title?: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  /** Fill the available space (default true). Set false to render inline. */
  fill?: boolean;
  /** error variant: optional retry action. */
  onRetry?: () => void;
  retryLabel?: string;
}

const StateView: React.FC<StateViewProps> = ({
  variant,
  title,
  description,
  icon,
  iconColor,
  fill = true,
  onRetry,
  retryLabel,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (variant === 'empty') {
    return (
      <View style={fill ? styles.fill : styles.inline}>
        <EmptyState
          icon={icon}
          title={title ?? ''}
          description={description}
          iconColor={iconColor}
        />
      </View>
    );
  }

  if (variant === 'loading') {
    return (
      <View style={[fill ? styles.fill : styles.inline, styles.loadingWrap]}>
        <Skeleton width="70%" height={18} />
        <Skeleton width="100%" height={14} style={styles.skelGap} />
        <Skeleton width="88%" height={14} style={styles.skelGap} />
        {title ? <Text style={styles.loadingText}>{title}</Text> : null}
      </View>
    );
  }

  // error
  return (
    <View style={[fill ? styles.fill : styles.inline, styles.errorWrap]}>
      <View style={[styles.errorIconCircle, { backgroundColor: `${iconColor ?? theme.colors.error}15` }]}>
        <Icon name={icon ?? 'alert-circle-outline'} size={40} color={iconColor ?? theme.colors.error} />
      </View>
      {title ? <Text style={styles.errorTitle}>{title}</Text> : null}
      {description ? <Text style={styles.errorDescription}>{description}</Text> : null}
      {onRetry && (
        <Pressable
          onPress={onRetry}
          android_ripple={{ color: `${theme.colors.primary}33`, borderless: false }}
          hitSlop={8}
          style={styles.retryButton}
        >
          <Icon name="reload" size={18} color={theme.colors.primary} />
          <Text style={styles.retryText}>{retryLabel ?? 'Retry'}</Text>
        </Pressable>
      )}
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    fill: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: theme.spacing.lg,
    },
    inline: {
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
    },
    loadingWrap: {
      alignItems: 'stretch',
      justifyContent: 'center',
      gap: 0,
    },
    skelGap: {
      marginTop: theme.spacing.sm,
    },
    loadingText: {
      marginTop: theme.spacing.md,
      fontSize: theme.fontSize.sm,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    errorWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorIconCircle: {
      width: 88,
      height: 88,
      borderRadius: theme.borderRadius.pill,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    errorTitle: {
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.bold,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: theme.spacing.xs,
    },
    errorDescription: {
      fontSize: theme.fontSize.md,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: theme.spacing.md,
    },
    retryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
      backgroundColor: `${theme.colors.primary}15`,
      gap: 6,
    },
    retryText: {
      fontSize: theme.fontSize.md,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.primary,
    },
  });

export default StateView;
