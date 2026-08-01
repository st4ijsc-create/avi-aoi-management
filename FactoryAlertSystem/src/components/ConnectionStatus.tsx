/**
 * Factory Alert System - Connection Status Component
 * Hiển thị trạng thái kết nối MQTT
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useConnectionStore, selectConnectionStatus } from '../store';
import { useSettingsStore, selectLanguage } from '../store';
import { CONNECTION_STATUS_CONFIG } from '../utils/constants';
import { useTheme, Theme } from '../context/ThemeContext';
import { ConnectionStatus as ConnectionStatusType } from '../types';

/**
 * 3D: real "connecting…" animation. Each dot loops opacity + scale on a staggered
 * delay (native-driver). Replaces the previous 3 fake-static dots.
 */
const ConnectingDot: React.FC<{ color: string; delay: number }> = ({ color, delay }) => {
  const progress = useSharedValue(0.3);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 400, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.7 + progress.value * 0.5 }],
  }));

  return (
    <Animated.View
      style={[{ width: 4, height: 4, borderRadius: 2, marginHorizontal: 1, backgroundColor: color }, animatedStyle]}
    />
  );
};

const ConnectingDots: React.FC<{ color: string }> = ({ color }) => (
  <View style={{ flexDirection: 'row', marginLeft: 4, alignItems: 'center' }}>
    <ConnectingDot color={color} delay={0} />
    <ConnectingDot color={color} delay={150} />
    <ConnectingDot color={color} delay={300} />
  </View>
);

interface ConnectionStatusProps {
  onPress?: () => void;
  showLabel?: boolean;
  size?: 'small' | 'medium' | 'large';
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  onPress,
  showLabel = true,
  size = 'medium',
}) => {
  const { theme } = useTheme();
  const status = useConnectionStore(selectConnectionStatus);
  const language = useSettingsStore(selectLanguage);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const config = CONNECTION_STATUS_CONFIG[status];

  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          iconSize: 16,
          fontSize: 12,
          dotSize: 8,
          padding: 4,
        };
      case 'large':
        return {
          iconSize: 24,
          fontSize: 16,
          dotSize: 12,
          padding: 12,
        };
      default:
        return {
          iconSize: 20,
          fontSize: 14,
          dotSize: 10,
          padding: 8,
        };
    }
  };

  const sizeStyles = getSizeStyles();
  const label = language === 'vi' ? config.label : language === 'zh' ? config.labelZh : config.labelEn;

  const renderContent = () => (
    <View style={[styles.container, { padding: sizeStyles.padding }]}>
      {/* Status dot */}
      <View
        style={[
          styles.statusDot,
          {
            backgroundColor: config.color,
            width: sizeStyles.dotSize,
            height: sizeStyles.dotSize,
            borderRadius: sizeStyles.dotSize / 2,
          },
        ]}
      />

      {/* Icon */}
      <Icon
        name={config.icon}
        size={sizeStyles.iconSize}
        color={config.color}
        style={styles.icon}
      />

      {/* Label */}
      {showLabel && (
        <Text
          style={[
            styles.label,
            {
              color: config.color,
              fontSize: sizeStyles.fontSize,
            },
          ]}
        >
          {label}
        </Text>
      )}

      {/* Connecting animation (3D: real native-driver reanimated loop) */}
      {status === 'connecting' && <ConnectingDots color={config.color} />}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {renderContent()}
      </TouchableOpacity>
    );
  }

  return renderContent();
};

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: theme.borderRadius.lg,
  },
  statusDot: {
    marginRight: 6,
  },
  icon: {
    marginRight: 4,
  },
  label: {
    fontWeight: theme.fontWeight.semibold,
  },
});

export default ConnectionStatus;
