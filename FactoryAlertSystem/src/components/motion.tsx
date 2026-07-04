/**
 * Factory Alert System - Shared motion primitives (Wave 3F)
 *
 * Reanimated helpers used across the redesign. Everything here animates
 * transform/opacity ONLY (native-driver), so it stays cheap on the low-end
 * factory tablets. Never animate height/shadow/colour here.
 */

import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface PulseViewProps {
  /** When true, run a subtle scale/opacity pulse loop; when false, rest at 1. */
  active?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Peak scale of the pulse (default 1.14). */
  peak?: number;
}

/**
 * Wraps children in a looping scale+opacity pulse (native-driver). Use to draw
 * the eye to a live critical/pending badge without re-laying-out the row.
 */
export const PulseView: React.FC<PulseViewProps> = ({ active = true, children, style, peak = 1.14 }) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withSequence(
          withTiming(peak, { duration: 600, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 600, easing: Easing.in(Easing.ease) }),
        ),
        -1,
        false,
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 600 }),
          withTiming(1, { duration: 600 }),
        ),
        -1,
        false,
      );
    } else {
      scale.value = withTiming(1, { duration: 150 });
      opacity.value = withTiming(1, { duration: 150 });
    }
  }, [active, peak, scale, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
};

export default PulseView;
