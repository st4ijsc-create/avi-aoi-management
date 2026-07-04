import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

interface NgRateBubbleProps {
  ngRate: number;
  label?: string;
  style?: any;
  size?: number;
  dismissAfterSec?: number; // 0 or undefined = no auto-dismiss
}

/** Tạo polygon starburst/explosion shape */
function starburstPoints(cx: number, cy: number, outerR: number, innerR: number, spikes: number): string {
  const pts: string[] = [];
  const total = spikes * 2;
  for (let i = 0; i < total; i++) {
    const angle = (Math.PI * i) / spikes - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

const NgRateBubble: React.FC<NgRateBubbleProps> = ({ ngRate, label = 'NG RATE', style, size = 96, dismissAfterSec }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Pop-in animation
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 160,
      useNativeDriver: true,
    }).start();
    // Pulse loop
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [scaleAnim, pulseAnim]);

  // Auto-dismiss
  useEffect(() => {
    if (!dismissAfterSec || dismissAfterSec <= 0) return;
    setDismissed(false);
    opacityAnim.setValue(1);
    const timer = setTimeout(() => {
      Animated.timing(opacityAnim, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setDismissed(true));
    }, dismissAfterSec * 1000);
    return () => clearTimeout(timer);
  }, [dismissAfterSec, ngRate, label]);

  if (dismissed) return null;

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2;
  const innerR = size * 0.34;
  const spikes = 14;
  const pts = starburstPoints(cx, cy, outerR, innerR, spikes);

  return (
    <Animated.View
      style={[
        styles.container,
        { width: size, height: size, opacity: opacityAnim, transform: [{ scale: Animated.multiply(scaleAnim, pulseAnim) }] },
        style,
      ]}
    >
      {/* Starburst SVG background */}
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFill}>
        <Polygon points={pts} fill="#D32F2F" stroke="#B71C1C" strokeWidth={1.5} />
      </Svg>
      {/* Text overlay */}
      <View style={styles.textOverlay}>
        <Text style={[styles.label, { fontSize: size * 0.13 }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.value, { fontSize: size * 0.22 }]}>
          {ngRate.toFixed(1)}%
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#B71C1C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
  },
  textOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  label: {
    color: '#FFFFFF',
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  value: {
    color: '#FFD600',
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 1,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});

export default NgRateBubble;
