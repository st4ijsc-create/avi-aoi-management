/**
 * StationDetail — fullscreen image viewer with pinch-zoom / pan / double-tap gestures
 * and progressive (thumb → display) loading with retry.
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx.
 */
import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, Image, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { useTheme } from '../../../context';
import { DK, LK } from '../palette';
import { STATION_T } from '../translations';
import type { ViewerImageData } from '../types';
import { getS } from '../styles';
import { MAX_IMAGE_RETRY, RETRY_DELAYS } from './panelParts';

// ============================================
// IMAGE VIEWER MODAL (fullscreen with zoom/pan)
// ============================================

const ImageViewerModal: React.FC<{
  visible: boolean;
  image: ViewerImageData | null;
  onClose: () => void;
  t: typeof STATION_T.vi;
}> = ({ visible, image, onClose, t }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { ivS } = getS(theme.isDark);

  // Reanimated shared values for smooth gesture-driven transforms
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translationX = useSharedValue(0);
  const translationY = useSharedValue(0);
  const savedTranslationX = useSharedValue(0);
  const savedTranslationY = useSharedValue(0);

  // Reset on open/close
  useEffect(() => {
    if (visible) {
      scale.value = 1;
      savedScale.value = 1;
      translationX.value = 0;
      translationY.value = 0;
      savedTranslationX.value = 0;
      savedTranslationY.value = 0;
    }
  }, [visible, scale, savedScale, translationX, translationY, savedTranslationX, savedTranslationY]);

  // Double-tap: toggle between 1x and 2.5x zoom
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      'worklet';
      if (scale.value > 1.1) {
        // Zoomed in → reset to 1x
        scale.value = withSpring(1, { damping: 15 });
        savedScale.value = 1;
        translationX.value = withSpring(0, { damping: 15 });
        translationY.value = withSpring(0, { damping: 15 });
        savedTranslationX.value = 0;
        savedTranslationY.value = 0;
      } else {
        // At 1x → zoom to 2.5x
        scale.value = withSpring(2.5, { damping: 15 });
        savedScale.value = 2.5;
      }
    });

  // Pinch-to-zoom (0.5x – 5x)
  const pinch = Gesture.Pinch()
    .onStart(() => {
      'worklet';
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      'worklet';
      scale.value = Math.max(0.5, Math.min(5, savedScale.value * e.scale));
    })
    .onEnd(() => {
      'worklet';
      if (scale.value < 1) {
        scale.value = withSpring(1, { damping: 15 });
        savedScale.value = 1;
        translationX.value = withSpring(0, { damping: 15 });
        translationY.value = withSpring(0, { damping: 15 });
        savedTranslationX.value = 0;
        savedTranslationY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  // Pan (drag) — always active with activation threshold to prevent accidental
  // swipes at 1x from conflicting with system back gesture.
  // Translation is gated by scale in the worklet (pure UI thread, no JS delay).
  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .activeOffsetX([-15, 15])
    .activeOffsetY([-15, 15])
    .onStart(() => {
      'worklet';
      savedTranslationX.value = translationX.value;
      savedTranslationY.value = translationY.value;
    })
    .onUpdate((e) => {
      'worklet';
      if (scale.value > 1.05) {
        translationX.value = savedTranslationX.value + e.translationX;
        translationY.value = savedTranslationY.value + e.translationY;
      }
    })
    .onEnd(() => {
      'worklet';
      if (scale.value <= 1.05) {
        translationX.value = withSpring(0, { damping: 15 });
        translationY.value = withSpring(0, { damping: 15 });
        savedTranslationX.value = 0;
        savedTranslationY.value = 0;
      } else {
        savedTranslationX.value = translationX.value;
        savedTranslationY.value = translationY.value;
      }
    });

  // Combine: pinch + pan simultaneous, double-tap exclusive (priority)
  const composed = Gesture.Simultaneous(pinch, pan);
  const gesture = Gesture.Exclusive(doubleTap, composed);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateX: translationX.value },
      { translateY: translationY.value },
    ],
  }));

  const displayLabel = image?.pointName || image?.label || '';
  const badgeType = image?.type;
  const isNG = image?.isNG ?? (badgeType === 'fail');
  const [imgLoading, setImgLoading] = React.useState(true);
  const [imgError, setImgError] = React.useState(false);
  const [imgRetryKey, setImgRetryKey] = React.useState(0);
  const imgRetryCountRef = React.useRef(0);
  const imgRetryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build progressive URLs: low-res placeholder loads fast, medium-res for display
  // Only apply for server-hosted images that support ?w=&q= resize
  const { thumbUrl, displayUrl } = React.useMemo(() => {
    const raw = image?.imageUrl || '';
    if (!raw) return { thumbUrl: '', displayUrl: '' };
    if (!image?.supportsResize) return { thumbUrl: '', displayUrl: raw };
    const sep = raw.includes('?') ? '&' : '?';
    return {
      thumbUrl: `${raw}${sep}w=400&q=50`,
      displayUrl: `${raw}${sep}w=1280&q=85`,
    };
  }, [image?.imageUrl, image?.supportsResize]);
  const [displayLoaded, setDisplayLoaded] = React.useState(false);

  // Reset loading state when image changes
  React.useEffect(() => {
    setImgLoading(true);
    setDisplayLoaded(false);
    setImgError(false);
    imgRetryCountRef.current = 0;
    setImgRetryKey(0);
    return () => { if (imgRetryTimerRef.current) clearTimeout(imgRetryTimerRef.current); };
  }, [image?.imageUrl]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => { if (imgRetryTimerRef.current) clearTimeout(imgRetryTimerRef.current); };
  }, []);

  const handleViewerError = React.useCallback(() => {
    const attempt = imgRetryCountRef.current;
    if (attempt < MAX_IMAGE_RETRY) {
      console.log(`[ImageViewerModal] Retry ${attempt + 1}/${MAX_IMAGE_RETRY}:`, displayUrl);
      imgRetryCountRef.current = attempt + 1;
      imgRetryTimerRef.current = setTimeout(() => {
        setImgRetryKey(prev => prev + 1);
      }, RETRY_DELAYS[attempt] || 3000);
    } else {
      console.warn('[ImageViewerModal] Image load failed after retries:', displayUrl);
      setImgError(true);
      setImgLoading(false);
    }
  }, [displayUrl]);

  const handleViewerManualRetry = React.useCallback(() => {
    imgRetryCountRef.current = 0;
    setImgError(false);
    setImgLoading(true);
    setDisplayLoaded(false);
    setImgRetryKey(prev => prev + 1);
  }, []);

  return (
  <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <View style={ivS.backdrop}>
      <View style={ivS.header}>
        <View style={{ flex: 1 }}>
          {displayLabel ? <Text style={ivS.title}>{displayLabel}</Text> : null}
          {image && (
            <View style={[ivS.badge, { backgroundColor: isNG ? `${C.fail}30` : `${C.pass}30` }]}>
              <Text style={[ivS.badgeText, { color: isNG ? C.fail : C.pass }]}>
                {badgeType === 'fail' ? 'NG' : badgeType === 'reference' ? 'REF' : badgeType === 'sample' ? 'SAMPLE' : isNG ? 'NG' : 'OK'}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={onClose} style={ivS.closeBtn}>
          <Icon name="close" size={24} color={C.text} />
        </TouchableOpacity>
      </View>
      {image && (
        <GestureDetector gesture={gesture}>
          <Reanimated.View style={[{ flex: 1, overflow: 'visible' }, animatedStyle]}>
            {!imgError ? (
              <>
                {/* Low-res placeholder — loads fast, shown while medium-res loads (server images only) */}
                {!displayLoaded && !!thumbUrl && (
                  <Image
                    key={`viewer-thumb-${imgRetryKey}`}
                    source={{ uri: thumbUrl }}
                    style={[ivS.image, { position: 'absolute' }]}
                    resizeMode="contain"
                    resizeMethod="resize"
                    progressiveRenderingEnabled={true}
                    onLoadEnd={() => setImgLoading(false)}
                  />
                )}
                {/* Display image — medium-res for server, original for external */}
                <Image
                  key={`viewer-display-${imgRetryKey}`}
                  source={{ uri: displayUrl }}
                  style={ivS.image}
                  resizeMode="contain"
                  resizeMethod="resize"
                  progressiveRenderingEnabled={true}
                  onLoadEnd={() => { setDisplayLoaded(true); setImgLoading(false); }}
                  onError={handleViewerError}
                />
              </>
            ) : (
              <TouchableOpacity onPress={handleViewerManualRetry} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }} activeOpacity={0.7}>
                <Icon name="image-broken-variant" size={64} color="#666" />
                <Text style={{ color: '#999', fontSize: 14, marginTop: 12 }}>Tải ảnh thất bại</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }}>
                  <Icon name="refresh" size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 14, marginLeft: 6 }}>Thử lại</Text>
                </View>
              </TouchableOpacity>
            )}
            {imgLoading && !imgError && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#fff" />
              </View>
            )}
          </Reanimated.View>
        </GestureDetector>
      )}
      <View style={ivS.zoomHint}>
        <Icon name="gesture-pinch" size={14} color={C.textMuted} />
        <Text style={ivS.zoomHintText}>{t.pinchToZoom}</Text>
        <Text style={ivS.zoomHintText}>  ·  </Text>
        <Icon name="gesture-double-tap" size={14} color={C.textMuted} />
        <Text style={ivS.zoomHintText}>{t.doubleTapReset}</Text>
      </View>
    </View>
    </GestureHandlerRootView>
  </Modal>
  );
};

export { ImageViewerModal };
