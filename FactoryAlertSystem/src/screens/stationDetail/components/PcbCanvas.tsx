/**
 * StationDetail — PCB canvas: heatmap blobs, point markers, NG alert bubbles, scan bar.
 * MB11 decomposition (seam 1 — PcbCanvas): moved verbatim from StationDetailScreen.tsx.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Animated, Easing } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';

import NgRateBubble from '../../../components/NgRateBubble';
import { useTheme } from '../../../context';
import type { InspectionPoint, CanvasImageMode } from '../../../types';
import { DK, LK, MARKER_HALF, MARKER_HIT_SLOP, PCB_HEIGHT, SCREEN_WIDTH, STATUS_COLORS } from '../palette';
import { STATION_T } from '../translations';
import type { ImageLayout, AlertBubbleInfo } from '../types';
import { heatColor, heatRadius } from '../utils/format';
import { getS } from '../styles';

// ============================================
// PCB CANVAS WITH HEATMAP
// ============================================
/** Animated scanning bar */
const ScanBar: React.FC<{ height?: number }> = ({ height }) => {
  const { pcbS } = getS(useTheme().theme.isDark);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, height ?? PCB_HEIGHT] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[pcbS.scanBar, { transform: [{ translateY }] }]}
    >
      <LinearGradient
        colors={['transparent', 'rgba(59,130,246,0.25)', 'transparent']}
        style={{ height: 3, width: '100%' }}
      />
    </Animated.View>
  );
};


/** Speech bubble callout showing NG alert info, pointing to an alerted point on PCB */
const AlertBubble: React.FC<{
  point: InspectionPoint;
  info: AlertBubbleInfo;
  imgLayout: ImageLayout;
  valueLabel?: string;
}> = React.memo(({ point, info, imgLayout, valueLabel = 'Value' }) => {
  const px = point.x * imgLayout.renderW + imgLayout.offsetX;
  const py = point.y * imgLayout.renderH + imgLayout.offsetY;
  const BUBBLE_W = 120;
  const ARROW_H = 8;
  const MARKER_R = 16;
  // Show bubble above unless point is near top edge
  const showAbove = py > 90;
  // Clamp horizontal position to stay within canvas
  const clampedLeft = Math.max(4, Math.min(px - BUBBLE_W / 2, imgLayout.renderW + imgLayout.offsetX * 2 - BUBBLE_W - 4));

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: clampedLeft,
        ...(showAbove
          ? { bottom: imgLayout.canvasH - py + MARKER_R }
          : { top: py + MARKER_R + ARROW_H }),
        width: BUBBLE_W,
        alignItems: 'center',
        zIndex: 100,
      }}
    >
      {/* Arrow pointing up (when bubble is below the point) */}
      {!showAbove && (
        <View style={{
          width: 0, height: 0,
          borderLeftWidth: 7, borderRightWidth: 7,
          borderBottomWidth: ARROW_H,
          borderLeftColor: 'transparent', borderRightColor: 'transparent',
          borderBottomColor: '#FACC15',
          marginLeft: px - clampedLeft - 7,
          alignSelf: 'flex-start',
        }} />
      )}
      {/* Bubble container */}
      <View style={{
        backgroundColor: '#FACC15',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
        width: '100%',
        borderWidth: 2,
        borderColor: '#DC2626',
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.5,
        shadowRadius: 5,
      }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
          <Text style={{ color: '#DC2626', fontSize: 11, marginRight: 3 }}>⚠</Text>
          <Text style={{ color: '#1E293B', fontSize: 10, fontWeight: '800', flex: 1 }} numberOfLines={1}>
            {info.pointName}
          </Text>
          <View style={{
            backgroundColor: '#DC2626',
            borderRadius: 4,
            paddingHorizontal: 5,
            paddingVertical: 1,
          }}>
            <Text style={{ color: '#FFF', fontSize: 8, fontWeight: '900' }}>NG</Text>
          </View>
        </View>
        {/* Measured value with label */}
        {info.actualValue != null && (
          <Text style={{ color: '#DC2626', fontSize: 10, fontWeight: '700', marginTop: 2 }}>{valueLabel}: {info.actualValue}</Text>
        )}
      </View>
      {/* Arrow pointing down (when bubble is above the point) */}
      {showAbove && (
        <View style={{
          width: 0, height: 0,
          borderLeftWidth: 7, borderRightWidth: 7,
          borderTopWidth: ARROW_H,
          borderLeftColor: 'transparent', borderRightColor: 'transparent',
          borderTopColor: '#FACC15',
          marginLeft: px - clampedLeft - 7,
          alignSelf: 'flex-start',
        }} />
      )}
    </View>
  );
});

/** Single heatmap blob (radial-gradient-like) */
const HeatBlob: React.FC<{ x: number; y: number; rate: number; imgLayout: ImageLayout }> = React.memo(
  ({ x, y, rate, imgLayout }) => {
    const r = heatRadius(rate);
    const c = heatColor(rate);
    const px = x * imgLayout.renderW + imgLayout.offsetX;
    const py = y * imgLayout.renderH + imgLayout.offsetY;
    return (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: px - r,
          top: py - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: `${c}30`,
          borderWidth: 1,
          borderColor: `${c}15`,
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: r * 0.35,
            top: r * 0.35,
            width: r * 1.3,
            height: r * 1.3,
            borderRadius: r * 0.65,
            backgroundColor: `${c}50`,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: r * 0.65,
            top: r * 0.65,
            width: r * 0.7,
            height: r * 0.7,
            borderRadius: r * 0.35,
            backgroundColor: `${c}80`,
          }}
        />
      </View>
    );
  },
);

/** Point marker on PCB canvas */
const PCBMarker: React.FC<{
  point: InspectionPoint;
  pointIndex: number;
  imgLayout: ImageLayout;
  isSelected: boolean;
  isAlerted: boolean;
  isNewlyAlerted: boolean;
  ngMarkerScale: number;
  onPress: (p: InspectionPoint) => void;
}> = React.memo(({ point, pointIndex, imgLayout, isSelected, isAlerted, isNewlyAlerted, ngMarkerScale, onPress }) => {
  const { pcbS } = getS(useTheme().theme.isDark);
  const sc = STATUS_COLORS[point.status];
  const px = point.x * imgLayout.renderW + imgLayout.offsetX;
  const py = point.y * imgLayout.renderH + imgLayout.offsetY;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const alertFlash = useRef(new Animated.Value(0)).current;
  const ngFlashAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (point.status === 'fail') {
      pulseAnim.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => { loop.stop(); pulseAnim.setValue(0); };
    } else {
      pulseAnim.setValue(0);
    }
  }, [point.status, pulseAnim]);

  // Alert triangle flash animation
  useEffect(() => {
    if (isAlerted) {
      alertFlash.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(alertFlash, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(alertFlash, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => { loop.stop(); alertFlash.setValue(0); };
    } else {
      alertFlash.setValue(0);
    }
  }, [isAlerted, alertFlash]);

  // Newly-alerted NG flash: enlarged + rapid red opacity flash
  useEffect(() => {
    if (isNewlyAlerted) {
      ngFlashAnim.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(ngFlashAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(ngFlashAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => { loop.stop(); ngFlashAnim.setValue(0); };
    } else {
      ngFlashAnim.setValue(0);
    }
  }, [isNewlyAlerted, ngFlashAnim]);

  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  const ngFlashScale = ngFlashAnim.interpolate({ inputRange: [0, 1], outputRange: [ngMarkerScale, ngMarkerScale + 0.4] });
  const ngFlashOpacity = ngFlashAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });

  return (
    <TouchableOpacity
      style={[pcbS.marker, { left: px - MARKER_HALF, top: py - MARKER_HALF }]}
      onPress={() => onPress(point)}
      hitSlop={{ top: MARKER_HIT_SLOP, bottom: MARKER_HIT_SLOP, left: MARKER_HIT_SLOP, right: MARKER_HIT_SLOP }}
      activeOpacity={0.8}
    >
      {/* Newly-alerted NG flash ring — enlarged red pulse */}
      {isNewlyAlerted && (
        <Animated.View
          pointerEvents="none"
          style={[
            pcbS.pulse,
            {
              backgroundColor: '#EF4444',
              transform: [{ scale: ngFlashScale }],
              opacity: ngFlashOpacity,
            },
          ]}
        />
      )}
      {point.status === 'fail' && !isNewlyAlerted && (
        <Animated.View
          pointerEvents="none"
          style={[
            pcbS.pulse,
            {
              backgroundColor: isAlerted ? '#EF4444' : sc,
              transform: [{ scale: pulseScale }],
              opacity: pulseOpacity,
            },
          ]}
        />
      )}
      <View
        style={[
          pcbS.markerDot,
          { backgroundColor: isNewlyAlerted ? '#EF4444' : (isAlerted ? STATUS_COLORS.fail : sc), borderColor: isSelected ? '#FFF' : isNewlyAlerted ? '#EF444480' : (isAlerted ? `${STATUS_COLORS.fail}80` : `${sc}80`) },
          isSelected && { borderWidth: 2.5 },
          isNewlyAlerted && { transform: [{ scale: ngMarkerScale }] },
          isAlerted && !isNewlyAlerted && { transform: [{ scale: ngMarkerScale }] },
        ]}
      >
        <Text style={pcbS.markerLabel} numberOfLines={1}>{point.orderIndex ?? point.id}</Text>
      </View>
      {/* Red triangle + yellow exclamation for alerted NG points */}
      {isAlerted && (
        <Animated.View style={[pcbS.alertTriangle, { opacity: alertFlash }]}>
          <Text style={pcbS.alertTriangleIcon}>▲</Text>
          <Text style={pcbS.alertExclamation}>!</Text>
        </Animated.View>
      )}
    </TouchableOpacity>
  );
});

const PcbCanvas: React.FC<{
  imageUri: string | null;
  points: InspectionPoint[];
  selectedId: string | null;
  alertedPointIds: Set<string>;
  newlyAlertedPointIds: Set<string>;
  showHeatmap: boolean;
  showMarkers: boolean;
  onPointPress: (p: InspectionPoint) => void;
  imageError: boolean;
  onImageError: () => void;
  onImageRetry: () => void;
  t: typeof STATION_T.vi;
  imageWidth?: number;
  imageHeight?: number;
  alertBubbleData?: Map<string, AlertBubbleInfo>;
  topNgPoints?: Array<{ id: string; name: string; ngRate: number }>;
  ngBubbleDismissSec?: number;
  canvasImageMode?: CanvasImageMode;
  ngMarkerScale?: number;
}> = ({ imageUri, points, selectedId, alertedPointIds, newlyAlertedPointIds, showHeatmap, showMarkers, onPointPress, imageError, onImageError, onImageRetry, t, imageWidth, imageHeight, alertBubbleData, topNgPoints, ngBubbleDismissSec, canvasImageMode = 'fit', ngMarkerScale = 1.5 }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { pcbS } = getS(theme.isDark);
  const [containerW, setContainerW] = useState(SCREEN_WIDTH - 32);
  const [containerH, setContainerH] = useState(PCB_HEIGHT - 2);

  // Calculate actual rendered image rect within canvas based on canvasImageMode
  const imgLayout: ImageLayout = useMemo(() => {
    if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) {
      return { renderW: containerW, renderH: containerH, offsetX: 0, offsetY: 0, canvasH: containerH };
    }
    const imgAspect = imageWidth / imageHeight;
    const canvasAspect = containerW / containerH;

    if (canvasImageMode === 'fill') {
      // Stretch to fill — no letterboxing, image distorted to fill
      return { renderW: containerW, renderH: containerH, offsetX: 0, offsetY: 0, canvasH: containerH };
    }

    if (canvasImageMode === 'cover') {
      // Cover — scale to fill without distortion, crop overflow
      if (imgAspect > canvasAspect) {
        const renderH = containerH;
        const renderW = containerH * imgAspect;
        return { renderW, renderH, offsetX: (containerW - renderW) / 2, offsetY: 0, canvasH: containerH };
      } else {
        const renderW = containerW;
        const renderH = containerW / imgAspect;
        return { renderW, renderH, offsetX: 0, offsetY: (containerH - renderH) / 2, canvasH: containerH };
      }
    }

    // Default: fit (contain) — scale to fit, letterbox
    if (imgAspect > canvasAspect) {
      const renderW = containerW;
      const renderH = containerW / imgAspect;
      return { renderW, renderH, offsetX: 0, offsetY: (containerH - renderH) / 2, canvasH: containerH };
    } else {
      const renderH = containerH;
      const renderW = containerH * imgAspect;
      return { renderW, renderH, offsetX: (containerW - renderW) / 2, offsetY: 0, canvasH: containerH };
    }
  }, [containerW, containerH, imageWidth, imageHeight, canvasImageMode]);

  return (
    <View style={pcbS.canvas}>
      <View
        style={pcbS.canvasInner}
        onLayout={(e) => {
          setContainerW(e.nativeEvent.layout.width);
          setContainerH(e.nativeEvent.layout.height);
        }}
      >
      {/* Background */}
      {imageUri && !imageError ? (
        <Image source={{ uri: imageUri }} style={pcbS.image} resizeMode={canvasImageMode === 'fill' ? 'stretch' : canvasImageMode === 'cover' ? 'cover' : 'contain'} resizeMethod="resize" progressiveRenderingEnabled={true} onError={onImageError} />
      ) : imageUri && imageError ? (
        <TouchableOpacity style={pcbS.errWrap} onPress={onImageRetry}>
          <Icon name="image-broken-variant" size={36} color={C.textMuted} />
          <Text style={pcbS.errText}>{t.tapToReload}</Text>
        </TouchableOpacity>
      ) : (
        <View style={pcbS.placeholder}>
          <Icon name="developer-board" size={48} color={C.textMuted} />
          <Text style={pcbS.placeholderText}>{t.pcbBoard}</Text>
        </View>
      )}

      {/* Dark overlay for contrast */}
      <View style={pcbS.overlay} pointerEvents="none" />

      {/* Heatmap blobs */}
      {showHeatmap && points.map((p) => (
        <HeatBlob key={`h-${p.id}`} x={p.x} y={p.y} rate={p.defectRate} imgLayout={imgLayout} />
      ))}

      {/* Point markers */}
      {showMarkers && points.map((p, i) => (
        <PCBMarker
          key={`m-${p.id}`}
          point={p}
          pointIndex={i}
          imgLayout={imgLayout}
          isSelected={p.id === selectedId}
          isAlerted={alertedPointIds.has(p.id)}
          isNewlyAlerted={newlyAlertedPointIds.has(p.id)}
          ngMarkerScale={ngMarkerScale}
          onPress={onPointPress}
        />
      ))}

      {/* NG Alert bubbles — speech bubble callouts pointing to alerted points */}
      {alertBubbleData && alertBubbleData.size > 0 && points.map((p) => {
        const info = alertBubbleData.get(p.id);
        if (!info) return null;
        return (
          <AlertBubble
            key={`b-${p.id}`}
            point={p}
            info={info}
            imgLayout={imgLayout}
            valueLabel={t.value}
          />
        );
      })}

      {/* NG Rate Bubbles — positioned near their measurement points */}
      {topNgPoints && topNgPoints.length > 0 && topNgPoints.map((ng) => {
        const pt = points.find((p) => p.id === ng.id);
        if (!pt) return null;
        const px = pt.x * imgLayout.renderW + imgLayout.offsetX;
        const py = pt.y * imgLayout.renderH + imgLayout.offsetY;
        const NGBUBBLE_SIZE = 72;
        // Position bubble to the right of the point; if too close to right edge, put it left
        const rightSpace = imgLayout.renderW + imgLayout.offsetX - px;
        const placeRight = rightSpace > NGBUBBLE_SIZE + 20;
        const bubbleLeft = placeRight ? px + 18 : px - NGBUBBLE_SIZE - 18;
        const bubbleTop = Math.max(2, py - NGBUBBLE_SIZE / 2);
        return (
          <View key={`ng-${ng.id}`} pointerEvents="none" style={{ position: 'absolute', left: Math.max(2, bubbleLeft), top: bubbleTop, zIndex: 110 }}>
            <NgRateBubble ngRate={ng.ngRate} label={ng.name} size={NGBUBBLE_SIZE} dismissAfterSec={ngBubbleDismissSec || undefined} />
          </View>
        );
      })}

      {/* Scan bar */}
      <ScanBar height={containerH} />

      {/* Heatmap legend */}
      {showHeatmap && (
        <View style={pcbS.legend}>
          <Text style={pcbS.legendTitle}>{t.defectRateHeatmap}</Text>
          <View style={pcbS.legendRow}>
            {[
              { c: C.pass, l: '<15%' },
              { c: '#F59E0B', l: '15-35%' },
              { c: '#F97316', l: '35-60%' },
              { c: C.fail, l: '>60%' },
            ].map((item) => (
              <View key={item.l} style={pcbS.legendItem}>
                <View style={[pcbS.legendDot, { backgroundColor: item.c }]} />
                <Text style={pcbS.legendText}>{item.l}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      </View>
    </View>
  );
};

export { PcbCanvas };
