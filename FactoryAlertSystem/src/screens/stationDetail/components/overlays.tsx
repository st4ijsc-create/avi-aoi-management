/**
 * StationDetail — fullscreen alert animation overlays:
 * MQTT alert animation (bomb / alarm / triangle) + NG-rate explosion.
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Animated, Easing, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Polyline, Circle as SvgCircle, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';

import { useTheme } from '../../../context';
import type { Alert, AlertAnimationType } from '../../../types';
import { DK, LK } from '../palette';
import { STATION_T } from '../translations';
import { getS } from '../styles';

// ============================================
// MQTT Alert Animation Overlay
// ============================================
const ALERT_ANIM_PARTICLE_COUNT = 16;

const MqttAlertAnimationOverlay: React.FC<{
  visible: boolean;
  animationType: AlertAnimationType;
  ngPointCount: number;
  onDismiss: () => void;
  dismissMs?: number;
  triggerCount?: number;
  t: typeof STATION_T['vi'];
}> = ({ visible, animationType, ngPointCount, onDismiss, dismissMs = 3000, triggerCount = 0, t }) => {
  const isDk = useTheme().theme.isDark;
  const C = isDk ? DK : LK;

  // Shared animations
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  // Bomb particles
  const particleAnims = useRef(
    Array.from({ length: ALERT_ANIM_PARTICLE_COUNT }, () => ({
      translate: new Animated.ValueXY({ x: 0, y: 0 }),
      opacity: new Animated.Value(1),
      scale: new Animated.Value(0),
    })),
  ).current;

  // Alarm color toggle (state-based to avoid mixing native/JS drivers)
  const [alarmColorIdx, setAlarmColorIdx] = useState(0);
  const alarmColorTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Stop all running animations first
    scaleAnim.stopAnimation();
    opacityAnim.stopAnimation();
    shakeAnim.stopAnimation();
    flashAnim.stopAnimation();
    pulseAnim.stopAnimation();
    rotateAnim.stopAnimation();
    particleAnims.forEach((p) => {
      p.translate.stopAnimation();
      p.opacity.stopAnimation();
      p.scale.stopAnimation();
    });
    if (alarmColorTimer.current) {
      clearInterval(alarmColorTimer.current);
      alarmColorTimer.current = null;
    }

    if (!visible) {
      scaleAnim.setValue(0);
      opacityAnim.setValue(0);
      shakeAnim.setValue(0);
      flashAnim.setValue(0);
      pulseAnim.setValue(1);
      rotateAnim.setValue(0);
      setAlarmColorIdx(0);
      particleAnims.forEach((p) => {
        p.translate.setValue({ x: 0, y: 0 });
        p.opacity.setValue(1);
        p.scale.setValue(0);
      });
      return;
    }

    // Common flash background
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0.3, duration: 150, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0.8, duration: 100, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0.4, duration: 200, useNativeDriver: true }),
    ]).start();

    if (animationType === 'bomb') {
      // Bomb explosion: scale in + shake + particles
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(100),
          Animated.sequence(
            Array.from({ length: 8 }, () => [
              Animated.timing(shakeAnim, { toValue: 12, duration: 35, useNativeDriver: true }),
              Animated.timing(shakeAnim, { toValue: -12, duration: 35, useNativeDriver: true }),
            ]).flat(),
          ),
          Animated.timing(shakeAnim, { toValue: 0, duration: 40, useNativeDriver: true }),
        ]),
      ]).start();

      // Particle burst
      const pAnims = particleAnims.map((p, i) => {
        const angle = (i / ALERT_ANIM_PARTICLE_COUNT) * 2 * Math.PI;
        const dist = 90 + Math.random() * 70;
        return Animated.parallel([
          Animated.timing(p.scale, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(p.translate, {
            toValue: { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist },
            duration: 700,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(350),
            Animated.timing(p.opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
          ]),
        ]);
      });
      Animated.stagger(25, pAnims).start();
    } else if (animationType === 'alarm') {
      // Alarm light: scale in + rotating pulse + color cycling
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, friction: 5, tension: 50, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      // Pulsing
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 300, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.9, duration: 300, useNativeDriver: true }),
        ]),
      ).start();

      // Rotating beacon
      Animated.loop(
        Animated.timing(rotateAnim, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
      ).start();

      // Color cycling (state-based to avoid native driver conflict)
      alarmColorTimer.current = setInterval(() => {
        setAlarmColorIdx((prev) => (prev === 0 ? 1 : 0));
      }, 500);
    } else {
      // Triangle: scale in + pulse
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 400, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]),
      ).start();

      // Gentle shake
      Animated.loop(
        Animated.sequence([
          Animated.timing(shakeAnim, { toValue: 4, duration: 100, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -4, duration: 100, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
          Animated.delay(600),
        ]),
      ).start();
    }

    // Auto dismiss
    const timer = setTimeout(onDismiss, dismissMs);
    return () => {
      clearTimeout(timer);
      if (alarmColorTimer.current) {
        clearInterval(alarmColorTimer.current);
        alarmColorTimer.current = null;
      }
    };
  }, [visible, animationType, triggerCount]);

  if (!visible) return null;

  const flashColor = animationType === 'alarm' ? C.warn : C.fail;

  const rotateInterpolation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const alarmBgColor = alarmColorIdx === 0 ? C.fail : C.warn;

  const renderIcon = () => {
    if (animationType === 'bomb') {
      return (
        <View style={_mqttAnimS.iconCircle}>
          <Icon name="bomb" size={56} color={C.fail} />
        </View>
      );
    }
    if (animationType === 'alarm') {
      return (
        <Animated.View style={[
          _mqttAnimS.alarmCircle,
          {
            backgroundColor: alarmBgColor,
            transform: [{ scale: pulseAnim }, { rotate: rotateInterpolation }],
          },
        ]}>
          <Icon name="alarm-light" size={52} color="#FFF" />
        </Animated.View>
      );
    }
    // triangle
    return (
      <Animated.View style={[_mqttAnimS.triangleContainer, { transform: [{ scale: pulseAnim }] }]}>
        <Svg width={100} height={90} viewBox="0 0 100 90">
          <Defs>
            <RadialGradient id="triGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={C.fail} stopOpacity="0.3" />
              <Stop offset="100%" stopColor={C.fail} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          {/* Glow */}
          <SvgCircle cx="50" cy="50" r="48" fill="url(#triGlow)" />
          {/* Red triangle */}
          <Polyline
            points="50,5 95,85 5,85 50,5"
            fill={C.fail}
            stroke="#FF0000"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {/* Yellow exclamation mark */}
          <Rect x="45" y="30" width="10" height="30" rx="3" fill="#FFD600" />
          <SvgCircle cx="50" cy="70" r="5" fill="#FFD600" />
        </Svg>
      </Animated.View>
    );
  };

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onDismiss}>
      <TouchableOpacity style={_mqttAnimS.backdrop} activeOpacity={1} onPress={onDismiss}>
        {/* Flash overlay */}
        <Animated.View
          style={[
            _mqttAnimS.flash,
            {
              backgroundColor: flashColor,
              opacity: flashAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }),
            },
          ]}
        />

        {/* Center content */}
        <Animated.View
          style={[
            _mqttAnimS.center,
            {
              opacity: opacityAnim,
              transform: [
                { scale: scaleAnim },
                { translateX: shakeAnim },
              ],
            },
          ]}
        >
          {/* Bomb particles */}
          {animationType === 'bomb' && particleAnims.map((p, i) => (
            <Animated.View
              key={i}
              style={[
                _mqttAnimS.particle,
                {
                  backgroundColor: i % 4 === 0 ? C.fail : i % 4 === 1 ? C.warn : i % 4 === 2 ? '#FF6B00' : '#FF3D00',
                  opacity: p.opacity,
                  transform: [
                    { translateX: p.translate.x },
                    { translateY: p.translate.y },
                    { scale: p.scale },
                  ],
                },
              ]}
            />
          ))}

          {renderIcon()}

          {/* Info box */}
          <View style={[_mqttAnimS.infoBox, { borderColor: animationType === 'alarm' ? C.warn : C.fail, backgroundColor: C.surfaceRaised }]}>
            <Text style={[_mqttAnimS.title, { color: C.fail }]}>⚠ {t.mqttAlertWarning}</Text>
            <Text style={[_mqttAnimS.subtitle, { color: C.text }]}>{t.mqttAlertNgDetected}</Text>
            {ngPointCount > 0 && (
              <Text style={[_mqttAnimS.countText, { color: C.warn }]}>
                {ngPointCount} {t.mqttAlertPointCount}
              </Text>
            )}
            <Text style={[_mqttAnimS.dismiss, { color: C.textMuted }]}>{t.tapDismiss}</Text>
          </View>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
};

const _mqttAnimS = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  iconCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 3,
    borderColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  alarmCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    elevation: 8,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
  },
  triangleContainer: {
    width: 110,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  infoBox: {
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 20,
    borderWidth: 1,
    minWidth: 240,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  countText: {
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 4,
  },
  dismiss: {
    fontSize: 11,
    marginTop: 12,
    fontStyle: 'italic',
  },
});

// ============================================
// NG Rate Explosion Overlay
// ============================================
const PARTICLE_COUNT = 12;

const NgRateExplosionOverlay: React.FC<{
  visible: boolean;
  alert: Alert | null;
  onDismiss: () => void;
  dismissMs?: number;
  t: typeof STATION_T['vi'];
}> = ({ visible, alert, onDismiss, dismissMs = 4500, t }) => {
  const isDk = useTheme().theme.isDark;
  const C = isDk ? DK : LK;
  const { expS } = getS(isDk);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const particleAnims = useRef(
    Array.from({ length: PARTICLE_COUNT }, () => ({
      translate: new Animated.ValueXY({ x: 0, y: 0 }),
      opacity: new Animated.Value(1),
      scale: new Animated.Value(0),
    })),
  ).current;

  useEffect(() => {
    if (!visible) {
      scaleAnim.setValue(0);
      opacityAnim.setValue(0);
      shakeAnim.setValue(0);
      flashAnim.setValue(0);
      particleAnims.forEach((p) => {
        p.translate.setValue({ x: 0, y: 0 });
        p.opacity.setValue(1);
        p.scale.setValue(0);
      });
      return;
    }

    // Flash background
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0.3, duration: 150, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0.8, duration: 100, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0.5, duration: 200, useNativeDriver: true }),
    ]).start();

    // Scale in + shake
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(100),
        Animated.sequence(
          Array.from({ length: 6 }, () => [
            Animated.timing(shakeAnim, { toValue: 10, duration: 40, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: -10, duration: 40, useNativeDriver: true }),
          ]).flat(),
        ),
        Animated.timing(shakeAnim, { toValue: 0, duration: 40, useNativeDriver: true }),
      ]),
    ]).start();

    // Particle burst
    const particleAnimations = particleAnims.map((p, i) => {
      const angle = (i / PARTICLE_COUNT) * 2 * Math.PI;
      const dist = 80 + Math.random() * 60;
      return Animated.parallel([
        Animated.timing(p.scale, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(p.translate, {
          toValue: { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist },
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(300),
          Animated.timing(p.opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]),
      ]);
    });
    Animated.stagger(30, particleAnimations).start();

    // Auto dismiss
    const timer = setTimeout(onDismiss, dismissMs);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  const ngRate = alert?.ngRate;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onDismiss}>
      <TouchableOpacity
        style={expS.backdrop}
        activeOpacity={1}
        onPress={onDismiss}
      >
        {/* Flash overlay */}
        <Animated.View
          style={[
            expS.flash,
            {
              opacity: flashAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.35],
              }),
            },
          ]}
        />

        {/* Center content */}
        <Animated.View
          style={[
            expS.center,
            {
              opacity: opacityAnim,
              transform: [
                { scale: scaleAnim },
                { translateX: shakeAnim },
              ],
            },
          ]}
        >
          {/* Particles */}
          {particleAnims.map((p, i) => (
            <Animated.View
              key={i}
              style={[
                expS.particle,
                {
                  backgroundColor: i % 3 === 0 ? C.fail : i % 3 === 1 ? C.warn : '#FF6B00',
                  opacity: p.opacity,
                  transform: [
                    { translateX: p.translate.x },
                    { translateY: p.translate.y },
                    { scale: p.scale },
                  ],
                },
              ]}
            />
          ))}

          {/* Explosion icon */}
          <View style={expS.iconCircle}>
            <Icon name="alert-octagon" size={52} color={C.fail} />
          </View>

          {/* NG Rate info */}
          <View style={expS.infoBox}>
            <Text style={expS.title}>⚠ NG RATE ALERT</Text>
            {ngRate && (
              <>
                <Text style={expS.rateText}>
                  {t.ngRate || 'NG Rate'}: <Text style={expS.rateValue}>{ngRate.current?.toFixed(1)}%</Text>
                </Text>
                <Text style={expS.threshText}>
                  {t.threshold || 'Threshold'}: {ngRate.threshold?.toFixed(1)}%
                </Text>
                <Text style={expS.statsText}>
                  NG: {ngRate.ngCount} / {ngRate.totalInspections}
                </Text>
              </>
            )}
            <Text style={expS.dismiss}>{t.tapDismiss || 'Tap to dismiss'}</Text>
          </View>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
};

export { MqttAlertAnimationOverlay, NgRateExplosionOverlay };
