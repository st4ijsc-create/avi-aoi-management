/**
 * Factory Alert System - Connection Banner (Wave 3D)
 *
 * Persistent, full-width high-attention banner pinned under the header on live
 * screens whenever MQTT is disconnected/errored. Reuses CONNECTION_STATUS_CONFIG
 * for colour/icon and the bilingual (VI/EN/ZH) label. Renders nothing while
 * connected/connecting.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { useConnectionStore, selectConnectionStatus } from '../store';
import { useSettingsStore, selectLanguage } from '../store';
import { CONNECTION_STATUS_CONFIG } from '../utils/constants';
import { useTheme, Theme } from '../context/ThemeContext';

const ConnectionBanner: React.FC = () => {
  const status = useConnectionStore(selectConnectionStatus);
  const language = useSettingsStore(selectLanguage);
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Only surface the hard-down states — connecting has its own animated dots.
  if (status !== 'disconnected' && status !== 'error') {
    return null;
  }

  const config = CONNECTION_STATUS_CONFIG[status];
  const label =
    language === 'vi' ? config.label : language === 'zh' ? config.labelZh : config.labelEn;

  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOutUp.duration(160)}
      style={[styles.banner, { backgroundColor: config.color }]}
    >
      <Icon name={config.icon} size={18} color="#FFFFFF" />
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.pulseDot} />
    </Animated.View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    text: {
      color: '#FFFFFF',
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.bold,
      letterSpacing: 0.3,
    },
    pulseDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: 'rgba(255,255,255,0.85)',
    },
  });

export default ConnectionBanner;
