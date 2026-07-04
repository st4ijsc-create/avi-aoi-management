/**
 * Factory Alert System - Empty State Component
 * Hiển thị khi không có dữ liệu
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme, Theme } from '../context/ThemeContext';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  iconColor?: string;
  iconSize?: number;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'checkbox-marked-circle-outline',
  title,
  description,
  iconColor,
  iconSize = 64,
}) => {
  const { theme } = useTheme();
  const resolvedIconColor = iconColor ?? theme.colors.success;
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.container}>
      <View style={[styles.iconContainer, { backgroundColor: `${resolvedIconColor}15` }]}>
        <Icon name={icon} size={iconSize} color={resolvedIconColor} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
    </View>
  );
};

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: '600',
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  description: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default EmptyState;
