/**
 * StationDetail — product reference-image gallery (horizontal scroll) with per-thumb retry.
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '../../../context';
import type { ProductImageItem } from '../../../services/stationService';
import { DK, LK } from '../palette';
import { STATION_T } from '../translations';
import { getS } from '../styles';
import { MAX_IMAGE_RETRY, RETRY_DELAYS } from './panelParts';

// ============================================
// GALLERY THUMBNAIL (with retry per image)
// ============================================
const GalleryThumb: React.FC<{
  img: ProductImageItem;
  galS: any;
  C: any;
  onImagePress: (img: ProductImageItem) => void;
}> = ({ img, galS, C, onImagePress }) => {
  const [error, setError] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);
  const retryCountRef = React.useRef(0);
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);

  const thumbUri = React.useMemo(() => {
    const raw = img.imageUrl || '';
    if (!raw || !img.supportsResize) return raw;
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}w=200&q=60`;
  }, [img.imageUrl, img.supportsResize]);

  const handleError = React.useCallback(() => {
    const attempt = retryCountRef.current;
    if (attempt < MAX_IMAGE_RETRY) {
      retryCountRef.current = attempt + 1;
      retryTimerRef.current = setTimeout(() => setRetryKey(p => p + 1), RETRY_DELAYS[attempt] || 3000);
    } else {
      setError(true);
    }
  }, []);

  const handleManualRetry = React.useCallback(() => {
    retryCountRef.current = 0;
    setError(false);
    setRetryKey(p => p + 1);
  }, []);

  return (
    <TouchableOpacity style={galS.card} onPress={() => error ? handleManualRetry() : onImagePress(img)} activeOpacity={0.8}>
      {!error ? (
        <Image
          key={`gal-${retryKey}`}
          source={{ uri: thumbUri }}
          style={galS.thumb}
          resizeMode="cover"
          resizeMethod="resize"
          progressiveRenderingEnabled={true}
          onError={handleError}
        />
      ) : (
        <View style={[galS.thumb, { justifyContent: 'center', alignItems: 'center', backgroundColor: C.surfaceRaised }]}>
          <Icon name="image-broken-variant" size={24} color={C.textMuted} />
          <Icon name="refresh" size={14} color={C.accent} style={{ marginTop: 4 }} />
        </View>
      )}
      <View style={galS.cardOverlay}>
        <View style={[galS.typeBadge, { backgroundColor: `${C.pass}30` }]}>
          <Text style={[galS.typeText, { color: C.pass }]}>REF</Text>
        </View>
      </View>
      {img.pointName && (
        <Text style={galS.cardLabel} numberOfLines={1}>{img.pointName}</Text>
      )}
    </TouchableOpacity>
  );
};

// ============================================
// IMAGE GALLERY (horizontal scroll with tabs)
// ============================================
const ImageGallery: React.FC<{
  images: ProductImageItem[];
  loading: boolean;
  onImagePress: (img: ProductImageItem) => void;
  t: typeof STATION_T.vi;
}> = ({ images, loading, onImagePress, t }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { galS } = getS(theme.isDark);

  if (images.length === 0 && !loading) return null;

  return (
    <View style={galS.wrap}>
      <View style={galS.header}>
        <Icon name="image-multiple" size={14} color={C.accent} />
        <Text style={galS.title}>{t.downloadImages}</Text>
        <Text style={galS.count}>{images.length} {t.imageCount}</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={C.accent} style={{ paddingVertical: 20 }} />
      ) : images.length === 0 ? (
        <Text style={galS.empty}>{t.noImages}</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={galS.scroll}>
          {images.map((img) => (
            <GalleryThumb key={img.id} img={img} galS={galS} C={C} onImagePress={onImagePress} />
          ))}
        </ScrollView>
      )}
    </View>
  );
};

export { ImageGallery };
