/**
 * Factory Alert System - Severity Badge Component
 * Badge hiển thị mức độ nghiêm trọng của alert
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AlertSeverity } from '../types';
import { SEVERITY_CONFIG } from '../utils/constants';
import { useTheme, Theme } from '../context/ThemeContext';
import { useSettingsStore, selectLanguage } from '../store';

interface SeverityBadgeProps {
  severity: AlertSeverity;
  size?: 'small' | 'medium' | 'large';
  showIcon?: boolean;
  showLabel?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const SeverityBadge: React.FC<SeverityBadgeProps> = ({
  severity,
  size = 'medium',
  showIcon = true,
  showLabel = true,
  style,
  textStyle,
}) => {
  const { theme } = useTheme();
  const language = useSettingsStore(selectLanguage);
  const config = SEVERITY_CONFIG[severity];
  const styles = useMemo(() => createStyles(theme), [theme]);

  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          paddingHorizontal: 8,
          paddingVertical: 3,
          fontSize: 11,
          iconSize: 13,
          borderRadius: theme.borderRadius.sm,
        };
      case 'large':
        return {
          paddingHorizontal: 14,
          paddingVertical: 8,
          fontSize: 17,
          iconSize: 22,
          borderRadius: theme.borderRadius.md,
        };
      default:
        return {
          paddingHorizontal: 10,
          paddingVertical: 5,
          fontSize: 13,
          iconSize: 16,
          borderRadius: theme.borderRadius.sm,
        };
    }
  };

  const sizeStyles = getSizeStyles();
  const label = language === 'vi' ? config.label : language === 'zh' ? config.labelZh : config.labelEn;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: config.bgColor,
          paddingHorizontal: sizeStyles.paddingHorizontal,
          paddingVertical: sizeStyles.paddingVertical,
          borderRadius: sizeStyles.borderRadius,
        },
        style,
      ]}
    >
      {showIcon && (
        <Icon
          name={config.icon}
          size={sizeStyles.iconSize}
          color={config.color}
          style={showLabel ? styles.icon : undefined}
        />
      )}
      {showLabel && (
        <Text
          style={[
            styles.label,
            {
              color: config.color,
              fontSize: sizeStyles.fontSize,
            },
            textStyle,
          ]}
        >
          {label}
        </Text>
      )}
    </View>
  );
};

const createStyles = (theme: Theme) => StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: 4,
  },
  label: {
    fontWeight: theme.fontWeight.heavy,
    letterSpacing: 0.5,
  },
});

export default SeverityBadge;
