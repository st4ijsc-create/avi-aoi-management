/**
 * Factory Alert System - KPI Card Component
 * Card hiển thị thống kê KPI
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme, Theme } from '../context/ThemeContext';

interface KPICardProps {
  title: string;
  value: number | string;
  icon: string;
  iconColor?: string;
  backgroundColor?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  onPress?: () => void;
  size?: 'small' | 'medium' | 'large';
}

const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  icon,
  iconColor: iconColorProp,
  backgroundColor: backgroundColorProp,
  trend,
  trendValue,
  onPress,
  size = 'medium',
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const iconColor = iconColorProp ?? theme.colors.primary;
  const backgroundColor = backgroundColorProp ?? theme.colors.surface;

  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          padding: theme.spacing.sm,
          iconSize: 24,
          valueSize: theme.fontSize.xl,
          titleSize: theme.fontSize.xs,
        };
      case 'large':
        return {
          padding: theme.spacing.lg,
          iconSize: 40,
          valueSize: theme.fontSize.xxxl,
          titleSize: theme.fontSize.md,
        };
      default:
        return {
          padding: theme.spacing.md,
          iconSize: 32,
          valueSize: theme.fontSize.xxl,
          titleSize: theme.fontSize.sm,
        };
    }
  };

  const sizeStyles = getSizeStyles();

  const getTrendIcon = () => {
    switch (trend) {
      case 'up':
        return 'trending-up';
      case 'down':
        return 'trending-down';
      default:
        return 'trending-neutral';
    }
  };

  const getTrendColor = () => {
    switch (trend) {
      case 'up':
        return theme.colors.error;
      case 'down':
        return theme.colors.success;
      default:
        return theme.colors.textMuted;
    }
  };

  const CardContent = () => (
    <View
      style={[
        styles.card,
        {
          backgroundColor,
          padding: sizeStyles.padding,
        },
      ]}
    >
      {/* Icon */}
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: `${iconColor}15` },
        ]}
      >
        <Icon name={icon} size={sizeStyles.iconSize} color={iconColor} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text
          style={[
            styles.value,
            { fontSize: sizeStyles.valueSize },
          ]}
        >
          {value}
        </Text>
        <Text
          style={[
            styles.title,
            { fontSize: sizeStyles.titleSize },
          ]}
        >
          {title}
        </Text>
      </View>

      {/* Trend */}
      {trend && (
        <View style={styles.trendContainer}>
          <Icon
            name={getTrendIcon()}
            size={16}
            color={getTrendColor()}
          />
          {trendValue && (
            <Text
              style={[
                styles.trendValue,
                { color: getTrendColor() },
              ]}
            >
              {trendValue}
            </Text>
          )}
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        <CardContent />
      </TouchableOpacity>
    );
  }

  return <CardContent />;
};

const createStyles = (theme: Theme) => StyleSheet.create({
  card: {
    borderRadius: theme.borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    // Wave 3B: cheap "shadow" = hairline border + low elevation token (was a
    // blurred shadow + elevation 3, expensive per-card on old GPUs).
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    elevation: theme.elevation.sm,
  },
  iconContainer: {
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    marginRight: theme.spacing.md,
  },
  content: {
    flex: 1,
  },
  value: {
    fontWeight: theme.fontWeight.heavy,
    color: theme.colors.text,
  },
  title: {
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontWeight: theme.fontWeight.medium,
  },
  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    marginLeft: 4,
  },
});

export default KPICard;
