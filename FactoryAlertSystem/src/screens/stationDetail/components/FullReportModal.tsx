/**
 * StationDetail — full report modal (point info, MP statistics, trend, defects,
 * measurements, events, result images).
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Linking, Share, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Polyline } from 'react-native-svg';

import { useTheme } from '../../../context';
import type { InspectionPoint, Language } from '../../../types';
import type { MpStatisticsItem, PointImageItem } from '../../../services/stationService';
import { getServerBaseUrl } from '../../../services/serverConfig';
import { buildStationWebReportUrl } from '../../../services/webReportLink';
import { DK, LK, STATUS_COLORS, STATUS_LABELS_VI, STATUS_LABELS_EN, STATUS_LABELS_ZH } from '../palette';
import { STATION_T } from '../translations';
import { RealCaptureCard } from './panelParts';

// ============================================
// FULL REPORT MODAL
// ============================================
const FullReportModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  point: InspectionPoint | null;
  t: typeof STATION_T.vi;
  language: Language;
  mpStatistics: MpStatisticsItem | null;
  pointImages: PointImageItem[];
  apiBaseUrl: string;
  /** Numeric server station id (selectApiStationId) — targets the web report deep-link. */
  stationId?: string | null;
  onImagePress?: (imageUrl: string, label?: string, isNG?: boolean) => void;
}> = ({ visible, onClose, point, t, language, mpStatistics, pointImages, apiBaseUrl, stationId, onImagePress }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;

  // R3 (doc 32, decision #5): mobile stays light — no server-render file
  // download. Instead deep-link into the full WEB report (all charts + tables),
  // which the device browser renders with its own login/session. `datePreset:
  // 'today'` scopes it to the current/live station view shown in this modal.
  const buildWebReportUrl = React.useCallback(
    () => buildStationWebReportUrl({ baseUrl: getServerBaseUrl(), stationId: stationId ?? null, datePreset: 'today' }),
    [stationId],
  );

  const handleOpenWebReport = React.useCallback(async () => {
    const url = buildWebReportUrl();
    if (!url) {
      Alert.alert(t.fullReport, t.webReportError);
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t.fullReport, t.webReportError);
    }
  }, [buildWebReportUrl, t]);

  const handleShareReportLink = React.useCallback(async () => {
    const url = buildWebReportUrl();
    if (!url) {
      Alert.alert(t.fullReport, t.webReportError);
      return;
    }
    try {
      await Share.share({ message: url, title: t.fullReport });
    } catch {
      /* user cancelled the share sheet — ignore */
    }
  }, [buildWebReportUrl, t]);

  if (!point) return null;

  const sc = STATUS_COLORS[point.status];
  const statusLabel = language === 'vi' ? STATUS_LABELS_VI[point.status] : language === 'zh' ? STATUS_LABELS_ZH[point.status] : STATUS_LABELS_EN[point.status];
  const totalDefects = point.defects.reduce((sum, d) => sum + d.count, 0);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View style={{ flex: 1, marginTop: 40, backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Icon name="file-document-outline" size={20} color={C.accent} />
            <Text style={{ fontSize: 16, fontWeight: '800', color: C.text, flex: 1, marginLeft: 8 }}>{t.fullReport}</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 6, backgroundColor: C.surfaceRaised, borderRadius: 8 }}>
              <Icon name="close" size={20} color={C.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }} showsVerticalScrollIndicator={false}>
            {/* R3 (doc 32, decision #5): open the full WEB report in the browser
                (view-in-place stays intact below) + share the report link. */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <TouchableOpacity
                onPress={handleOpenWebReport}
                activeOpacity={0.85}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accent, paddingVertical: 11, borderRadius: 10 }}
              >
                <Icon name="open-in-new" size={16} color="#ffffff" />
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#ffffff' }}>{t.openWebReport}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleShareReportLink}
                activeOpacity={0.85}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}
              >
                <Icon name="share-variant" size={16} color={C.accent} />
                <Text style={{ fontSize: 12, fontWeight: '800', color: C.accent }}>{t.shareReportLink}</Text>
              </TouchableOpacity>
            </View>

            {/* Point Info */}
            <View style={{ backgroundColor: C.surfaceRaised, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 4 }}>{point.name}</Text>
              {point.code && <Text style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>ID: {point.code || point.id}</Text>}
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${sc}20`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sc }} />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: sc }}>{statusLabel}</Text>
                </View>
                <View style={{ backgroundColor: `${C.accent}18`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: C.accent }}>{point.type.toUpperCase()}</Text>
                </View>
                <View style={{ backgroundColor: `${point.defectRate > 5 ? C.fail : C.pass}18`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: point.defectRate > 5 ? C.fail : C.pass }}>
                    {t.defectRate}: {point.defectRate.toFixed(1)}%
                  </Text>
                </View>
              </View>
            </View>

            {/* MP Statistics */}
            {mpStatistics && (
              <View style={{ backgroundColor: C.surfaceRaised, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <Icon name="chart-box-outline" size={14} color={C.accent} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>{t.statistics}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { label: language === 'vi' ? 'Tổng kiểm tra' : language === 'zh' ? '总检查' : 'Total', val: mpStatistics.totalCount },
                    { label: 'OK', val: mpStatistics.okCount, color: C.pass },
                    { label: 'NG', val: mpStatistics.ngCount, color: C.fail },
                    { label: t.ngRate, val: `${mpStatistics.ngRate.toFixed(2)}%`, color: mpStatistics.ngRate > 5 ? C.fail : C.pass },
                    { label: 'Min', val: mpStatistics.minValue?.toFixed(3) ?? '-' },
                    { label: 'Max', val: mpStatistics.maxValue?.toFixed(3) ?? '-' },
                    { label: 'Avg', val: mpStatistics.avgValue?.toFixed(3) ?? '-' },
                    { label: 'StdDev', val: mpStatistics.stdDev?.toFixed(4) ?? '-' },
                  ].map((s, i) => (
                    <View key={i} style={{ width: '47%' as any, backgroundColor: C.surface, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                      <Text style={{ fontSize: 17, fontWeight: '800', color: s.color || C.text }}>{s.val}</Text>
                      <Text style={{ fontSize: 9, color: C.textMuted, marginTop: 3 }}>{s.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Trend */}
            {point.trend.length > 0 && (
              <View style={{ backgroundColor: C.surfaceRaised, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <Icon name="trending-up" size={14} color={C.accent} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>{t.trend}</Text>
                </View>
                <View style={{ height: 60 }}>
                  <Svg width="100%" height={60}>
                    <Polyline
                      points={point.trend.map((v, i) => `${(i / Math.max(point.trend.length - 1, 1)) * 280 + 10},${55 - (v / Math.max(...point.trend, 1)) * 50}`).join(' ')}
                      fill="none"
                      stroke={C.accent}
                      strokeWidth={2}
                    />
                  </Svg>
                </View>
              </View>
            )}

            {/* Defect Breakdown */}
            {point.defects.length > 0 && (
              <View style={{ backgroundColor: C.surfaceRaised, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <Icon name="chart-bar" size={14} color={C.accent} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text, flex: 1 }}>{t.defectBreakdown}</Text>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>{totalDefects} pcs</Text>
                </View>
                {point.defects.map((d, i) => {
                  const maxPct = Math.max(...point.defects.map((dd) => dd.pct), 1);
                  const barW = (d.pct / maxPct) * 100;
                  return (
                    <View key={i} style={{ marginBottom: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                        <Text style={{ fontSize: 11, color: C.text, fontWeight: '600' }}>{d.name}</Text>
                        <Text style={{ fontSize: 11, color: C.fail, fontWeight: '700' }}>{d.count} ({d.pct.toFixed(1)}%)</Text>
                      </View>
                      <View style={{ height: 6, backgroundColor: `${C.fail}20`, borderRadius: 3 }}>
                        <View style={{ width: `${barW}%` as any, height: 6, backgroundColor: C.fail, borderRadius: 3 }} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Measurements */}
            {point.measurements.length > 0 && (
              <View style={{ backgroundColor: C.surfaceRaised, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <Icon name="ruler-square" size={14} color={C.accent} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>{t.measurements}</Text>
                </View>
                {/* Header */}
                <View style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border }}>
                  <Text style={{ flex: 2, fontSize: 9, fontWeight: '700', color: C.textMuted }}>{t.param}</Text>
                  <Text style={{ flex: 1.5, fontSize: 9, fontWeight: '700', color: C.textMuted, textAlign: 'center' }}>{t.value}</Text>
                  <Text style={{ flex: 1.5, fontSize: 9, fontWeight: '700', color: C.textMuted, textAlign: 'center' }}>{t.spec}</Text>
                  <Text style={{ width: 40, fontSize: 9, fontWeight: '700', color: C.textMuted, textAlign: 'center' }}>{language === 'vi' ? 'KQ' : language === 'zh' ? '结果' : 'Res'}</Text>
                </View>
                {point.measurements.map((m, i) => {
                  const mc = m.status === 'ok' ? C.pass : m.status === 'ng' ? C.fail : C.warn;
                  return (
                    <View key={i} style={{ flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 2, backgroundColor: i % 2 === 0 ? `${C.surfaceRaised}80` : 'transparent', borderRadius: 4 }}>
                      <Text style={{ flex: 2, fontSize: 11, fontWeight: '600', color: C.text }}>{m.param}</Text>
                      <Text style={{ flex: 1.5, fontSize: 11, fontWeight: '700', color: mc, textAlign: 'center' }}>{m.val}</Text>
                      <Text style={{ flex: 1.5, fontSize: 10, color: C.textMuted, textAlign: 'center' }}>{m.spec}</Text>
                      <View style={{ width: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: `${mc}20`, borderRadius: 4 }}>
                        <Text style={{ fontSize: 8, fontWeight: '900', color: mc }}>{m.status === 'ok' ? 'OK' : m.status === 'ng' ? 'NG' : 'WARN'}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Events */}
            {point.events.length > 0 && (
              <View style={{ backgroundColor: C.surfaceRaised, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <Icon name="timeline-clock-outline" size={14} color={C.accent} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>{t.recentEvents}</Text>
                </View>
                {point.events.map((evt, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8, paddingLeft: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent, marginTop: 5 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: C.text }}>{evt.desc}</Text>
                      <Text style={{ fontSize: 10, color: C.textMuted }}>{evt.time}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Images */}
            {pointImages.length > 0 && (
              <View style={{ backgroundColor: C.surfaceRaised, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <Icon name="image-multiple-outline" size={14} color={C.accent} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text, flex: 1 }}>
                    {language === 'vi' ? 'Ảnh kết quả' : language === 'zh' ? '结果图片' : 'Result Images'}
                  </Text>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>{pointImages.length} {t.imageCount}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {pointImages.slice(0, 30).map((img, i) => (
                    <RealCaptureCard
                      key={`rpt-${img.id}-${i}`}
                      imageUrl={img.imageUrl}
                      apiBaseUrl={apiBaseUrl}
                      index={i}
                      isNG={img.result === 'NG'}
                      // Wave 2F: these are grid thumbnails — load the resized
                      // variant (?w=200&q=60), not the full-res original. Full
                      // resolution is fetched only when a card opens the viewer.
                      useThumbnail
                      onPress={() => onImagePress?.(img.imageUrl, img.pointName || `#${i + 1}`, img.result === 'NG')}
                    />
                  ))}
                </View>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export { FullReportModal };
