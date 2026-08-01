/**
 * Factory Alert System - Setting Item Component
 * Item trong màn hình cài đặt
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Switch } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme, Theme } from '../context/ThemeContext';

interface SettingItemProps {
  icon?: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  description?: string;
  value?: string;
  type?: 'navigate' | 'switch' | 'button' | 'info' | 'slider';
  switchValue?: boolean;
  onPress?: () => void;
  onSwitchChange?: (value: boolean) => void;
  disabled?: boolean;
  danger?: boolean;
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  sliderValue?: number;
  onSliderChange?: (value: number) => void;
  sliderSuffix?: string;
}

const SettingItem: React.FC<SettingItemProps> = ({
  icon,
  iconColor,
  title,
  subtitle,
  description,
  value,
  type = 'navigate',
  switchValue = false,
  onPress,
  onSwitchChange,
  disabled = false,
  danger = false,
  sliderMin = 0,
  sliderMax = 100,
  sliderStep = 1,
  sliderValue = 0,
  onSliderChange,
  sliderSuffix = '',
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const resolvedIconColor = iconColor || theme.colors.primary;

  const textColor = danger
    ? theme.colors.error
    : disabled
    ? theme.colors.textMuted
    : theme.colors.text;

  const renderRight = () => {
    switch (type) {
      case 'switch':
        return (
          <Switch
            value={switchValue}
            onValueChange={onSwitchChange}
            disabled={disabled}
            trackColor={{
              false: theme.colors.border,
              true: `${theme.colors.primary}80`,
            }}
            thumbColor={
              switchValue
                ? theme.colors.primary
                : theme.colors.surface
            }
          />
        );

      case 'navigate':
        return (
          <View style={styles.navigateContainer}>
            {value && <Text style={styles.value}>{value}</Text>}
            <Icon
              name="chevron-right"
              size={24}
              color={theme.colors.textMuted}
            />
          </View>
        );

      case 'info':
        return value ? <Text style={styles.value}>{value}</Text> : null;

      case 'button':
        return null;

      case 'slider':
        // 3F: 32dp steppers keep their compact look but get an 8dp hitSlop (→ ~48dp
        // effective) + ripple so gloved taps register on old Android.
        return (
          <View style={styles.stepperContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.stepperButton,
                sliderValue <= sliderMin && styles.stepperButtonDisabled,
                pressed && { opacity: 0.6 },
              ]}
              onPress={() => onSliderChange?.(Math.max(sliderMin, sliderValue - sliderStep))}
              disabled={disabled || sliderValue <= sliderMin}
              android_ripple={{ color: `${theme.colors.primary}33`, borderless: true }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="minus" size={18} color={sliderValue <= sliderMin ? theme.colors.textMuted : theme.colors.primary} />
            </Pressable>
            <Text style={styles.stepperValue}>
              {sliderValue}{sliderSuffix}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.stepperButton,
                sliderValue >= sliderMax && styles.stepperButtonDisabled,
                pressed && { opacity: 0.6 },
              ]}
              onPress={() => onSliderChange?.(Math.min(sliderMax, sliderValue + sliderStep))}
              disabled={disabled || sliderValue >= sliderMax}
              android_ripple={{ color: `${theme.colors.primary}33`, borderless: true }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="plus" size={18} color={sliderValue >= sliderMax ? theme.colors.textMuted : theme.colors.primary} />
            </Pressable>
          </View>
        );

      default:
        return null;
    }
  };

  const content = (
    <View style={[styles.container, disabled && styles.disabled]}>
      {icon && (
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: `${danger ? theme.colors.error : resolvedIconColor}15` },
          ]}
        >
          <Icon
            name={icon}
            size={20}
            color={danger ? theme.colors.error : resolvedIconColor}
          />
        </View>
      )}

      <View style={styles.content}>
        <Text style={[styles.title, { color: textColor }]}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        {description && <Text style={styles.description}>{description}</Text>}
      </View>

      {renderRight()}
    </View>
  );

  if (type === 'switch' || type === 'info' || type === 'slider') {
    return content;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      {content}
    </TouchableOpacity>
  );
};

interface SettingSectionProps {
  title: string;
  children: React.ReactNode;
}

export const SettingSection: React.FC<SettingSectionProps> = ({
  title,
  children,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
};

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  disabled: {
    opacity: 0.5,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing.md,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: '500',
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  value: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    marginRight: theme.spacing.sm,
  },
  navigateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  description: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.md,
    backgroundColor: `${theme.colors.primary}15`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperButtonDisabled: {
    opacity: 0.4,
  },
  stepperValue: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    minWidth: 44,
    textAlign: 'center',
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  sectionContent: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
  },
});

export default SettingItem;
