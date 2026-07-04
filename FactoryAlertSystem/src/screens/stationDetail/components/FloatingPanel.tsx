/**
 * StationDetail — floating detail panel (slide from right): statistics, trend,
 * defect pareto, fail images, measurements, recent events, action buttons.
 * MB11 decomposition (seam 2 — FloatingPanel): moved verbatim from StationDetailScreen.tsx.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Animated, Easing, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';

import { useTheme } from '../../../context';
import type { InspectionPoint, InspectionPointStatus, InspectionMeasurement, InspectionEvent, Language, FloatingPanelSections } from '../../../types';
import type { MpStatisticsItem, PointImageItem, DefectParetoItem } from '../../../services/stationService';
import { DK, LK, PANEL_WIDTH, STATUS_COLORS, STATUS_ICONS, STATUS_LABELS_VI, STATUS_LABELS_EN, STATUS_LABELS_ZH } from '../palette';
import { STATION_T } from '../translations';
import type { PanelTimeRange } from '../types';
import { formatPercent } from '../utils/format';
import { getS } from '../styles';
import { TimeRangeDropdown, EventRow, GradientSparkline, RealCaptureCard, ParetoChartSvg } from './panelParts';

// ============================================
// FLOATING DETAIL PANEL (slide from right) — Enhanced
// ============================================

const DEFAULT_PANEL_SECTIONS: FloatingPanelSections = {
  statistics: true,
  trend: true,
  defects: true,
  captures: true,
  measurements: true,
  events: true,
};

const FloatingPanel: React.FC<{
  point: InspectionPoint | null;
  visible: boolean;
  onClose: () => void;
  t: typeof STATION_T.vi;
  language: Language;
  apiBaseUrl?: string;
  panelSections?: FloatingPanelSections;
  mpStatistics?: MpStatisticsItem | null;
  mpStatsLoading?: boolean;
  pointImages?: PointImageItem[];
  pointImagesLoading?: boolean;
  pointImagesTotal?: number;
  pointImagesFilter?: 'ALL' | 'OK' | 'NG' | 'NTF' | 'NG_NTF';
  onPointImagesFilterChange?: (filter: 'ALL' | 'OK' | 'NG' | 'NTF' | 'NG_NTF') => void;
  onImagePress?: (imageUrl: string, label?: string, isNG?: boolean) => void;
  visibleImageCount?: number;
  onLoadMoreImages?: () => void;
  onViewFullReport?: () => void;
  onCorrelate?: () => void;
  defectPareto?: DefectParetoItem[];
  defectParetoLoading?: boolean;
  panelTimeRange?: PanelTimeRange;
  onTimeRangeChange?: (range: PanelTimeRange) => void;
  panelMeasurements?: InspectionMeasurement[];
  panelMeasurementsLoading?: boolean;
  panelEvents?: InspectionEvent[];
  panelEventsLoading?: boolean;
  // Diagnostic props
  selectedProductCode?: string | null;
  resolvedApiStationId?: string | null;
  productsLoading?: boolean;
  panelDiagnosticMsg?: string | null;
}> = ({ point, visible, onClose, t, language, apiBaseUrl = '', panelSections = DEFAULT_PANEL_SECTIONS, mpStatistics = null, mpStatsLoading = false, pointImages = [], pointImagesLoading = false, pointImagesTotal = 0, pointImagesFilter = 'ALL', onPointImagesFilterChange, onImagePress, visibleImageCount = 5, onLoadMoreImages, onViewFullReport, onCorrelate, defectPareto = [], defectParetoLoading = false, panelTimeRange = 'today', onTimeRangeChange, panelMeasurements = [], panelMeasurementsLoading = false, panelEvents = [], panelEventsLoading = false, selectedProductCode = null, resolvedApiStationId = null, productsLoading = false, panelDiagnosticMsg = null }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { fpS } = getS(theme.isDark);
  const slideAnim = useRef(new Animated.Value(PANEL_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && point) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 350,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: PANEL_WIDTH,
          duration: 280,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, point, slideAnim, fadeAnim]);

  if (!point) return null;

  // ─── Status priority: C2 API (mpStatistics) → point.status (MQTT/A10 fallback) ───
  // point.status is pre-computed in productPoints useMemo with priority:
  //   MQTT alert NG → 'fail' | A10 apiStatus | defectRate thresholds | 'pass'
  const effectiveDefectRate = mpStatistics ? mpStatistics.ngRate : (point.defectRate || 0);
  const effectiveStatus: InspectionPointStatus = mpStatistics
    ? (mpStatistics.ngRate > 5 ? 'fail' : mpStatistics.ngRate > 2 ? 'warn' : 'pass')
    : (point.status || 'pass');
  const sc = STATUS_COLORS[effectiveStatus];
  const statusLabel = language === 'vi' ? STATUS_LABELS_VI[effectiveStatus] : language === 'zh' ? STATUS_LABELS_ZH[effectiveStatus] : STATUS_LABELS_EN[effectiveStatus];

  // Measurements: API only (C5)
  const effectiveMeasurements = panelMeasurements;
  const failedParams = effectiveMeasurements.filter((m) => m.status === 'ng').length;

  // Trend: API only (C2 trendPeriods from mpStatistics)
  const effectiveTrend = mpStatistics?.trendPeriods ?? [];
  const trendDirection = effectiveTrend.length >= 2
    ? effectiveTrend[effectiveTrend.length - 1] - effectiveTrend[effectiveTrend.length - 2]
    : 0;
  const trendLabel = trendDirection > 0
    ? (language === 'vi' ? 'Tăng' : language === 'zh' ? '上升' : 'Rising')
    : trendDirection < 0
      ? (language === 'vi' ? 'Giảm' : language === 'zh' ? '下降' : 'Falling')
      : (language === 'vi' ? 'Ổn định' : language === 'zh' ? '稳定' : 'Stable');

  const sections = panelSections;

  return (
    <>
      {/* Backdrop */}
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[fpS.backdrop, { opacity: fadeAnim }]}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      </Animated.View>

      {/* Panel */}
      <Animated.View
        style={[fpS.panel, { transform: [{ translateX: slideAnim }] }]}
      >
        {/* ─── Header: Point ID, Name, Type badge, Status badge, Defect Rate ─── */}
        <LinearGradient colors={[`${sc}20`, C.surface]} style={fpS.header}>
          <View style={fpS.headerTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <View style={[fpS.statusBadge, { backgroundColor: `${sc}25` }]}>
                <Icon name={STATUS_ICONS[effectiveStatus]} size={12} color={sc} />
                <Text style={[fpS.statusText, { color: sc }]}>
                  {effectiveStatus === 'fail' ? 'FAIL' : effectiveStatus === 'warn' ? 'WARN' : 'PASS'}
                </Text>
              </View>
              <View style={fpS.typeBadgeLarge}>
                <Text style={fpS.typeBadgeText}>{point.type}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={fpS.closeBtn}>
              <Icon name="close" size={20} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={fpS.headerInfo}>
            <Text style={fpS.pointId}>{point.code || `Point ${point.id}`}</Text>
            <Text style={fpS.pointName} numberOfLines={2}>{point.name}</Text>
          </View>
          <View style={fpS.headerDefectRow}>
            <View style={[fpS.defRatePill, { backgroundColor: `${sc}15`, borderColor: `${sc}40` }]}>
              <Icon name="chart-arc" size={13} color={sc} />
              <Text style={[fpS.defRateVal, { color: sc }]}>{formatPercent(effectiveDefectRate)}</Text>
            </View>
            <Text style={fpS.headerStatusLabel}>{statusLabel}</Text>
          </View>
        </LinearGradient>

        <ScrollView style={fpS.body} showsVerticalScrollIndicator={false}>
          {/* ─── Time Range Selector ─── */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 12, marginTop: 4 }}>
            <TimeRangeDropdown value={panelTimeRange} onChange={(r) => onTimeRangeChange?.(r)} language={language} />
          </View>
          {/* ─── Diagnostic Banner — shown when data cannot be loaded ─── */}
          {panelDiagnosticMsg ? (
            <View style={{ backgroundColor: '#FEF3C7', borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#F59E0B' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Icon name="alert-circle-outline" size={16} color="#D97706" />
                <Text style={{ color: '#92400E', fontSize: 12, fontWeight: '700' }}>
                  {language === 'vi' ? 'Chẩn đoán' : language === 'zh' ? '诊断' : 'Diagnostics'}
                </Text>
              </View>
              <Text style={{ color: '#92400E', fontSize: 11, lineHeight: 16 }}>{panelDiagnosticMsg}</Text>
              <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F59E0B40' }}>
                <Text style={{ color: '#92400E', fontSize: 10, fontFamily: 'monospace' }}>
                  product: {selectedProductCode ?? 'NULL'} | stationId: {resolvedApiStationId ?? 'NULL'} | api: {apiBaseUrl || 'DEFAULT'}
                </Text>
              </View>
            </View>
          ) : (!selectedProductCode && !productsLoading && !mpStatsLoading) ? (
            <View style={{ backgroundColor: '#FEF3C7', borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#F59E0B' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Icon name="package-variant" size={16} color="#D97706" />
                <Text style={{ color: '#92400E', fontSize: 12, fontWeight: '700' }}>
                  {language === 'vi' ? 'Chưa có sản phẩm' : language === 'zh' ? '未加载产品' : 'No product loaded'}
                </Text>
              </View>
              <Text style={{ color: '#92400E', fontSize: 11, lineHeight: 16 }}>
                {language === 'vi'
                  ? 'Không thể tải dữ liệu panel vì chưa có sản phẩm nào được chọn. Kiểm tra kết nối API và apiBaseUrl trong Cài đặt.'
                  : language === 'zh'
                    ? '由于未选择产品，无法加载面板数据。请检查API连接和设置中的apiBaseUrl。'
                    : 'Panel data cannot be loaded because no product is selected. Check API connectivity and apiBaseUrl in Settings.'}
              </Text>
              <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F59E0B40' }}>
                <Text style={{ color: '#92400E', fontSize: 10, fontFamily: 'monospace' }}>
                  stationId: {resolvedApiStationId ?? 'NULL'} | api: {apiBaseUrl || 'DEFAULT'}
                </Text>
              </View>
            </View>
          ) : null}
          {/* ─── Statistics — API data when available, fallback to local data ─── */}
          {sections.statistics && (
          <View style={fpS.section}>
            <View style={fpS.secHeader}>
              <Icon name="chart-box-outline" size={14} color={C.accent} />
              <Text style={fpS.secTitle}>{t.statistics}</Text>
              {mpStatsLoading && <ActivityIndicator size="small" color={C.accent} />}
              {mpStatistics && <Text style={fpS.secSub}>{language === 'vi' ? 'Từ API' : language === 'zh' ? '来自API' : 'From API'}</Text>}
            </View>
            {mpStatistics ? (
              <View style={fpS.statsGrid}>
                <View style={[fpS.statBox, { borderLeftColor: C.accent, borderLeftWidth: 3 }]}>
                  <Icon name="counter" size={16} color={C.accent} style={{ marginBottom: 4 }} />
                  <Text style={[fpS.statVal, { color: C.accent }]}>{mpStatistics.totalCount}</Text>
                  <Text style={fpS.statLabel}>{language === 'vi' ? 'Tổng kiểm' : language === 'zh' ? '总检' : 'Total'}</Text>
                </View>
                <View style={[fpS.statBox, { borderLeftColor: C.pass, borderLeftWidth: 3 }]}>
                  <Icon name="check-circle-outline" size={16} color={C.pass} style={{ marginBottom: 4 }} />
                  <Text style={[fpS.statVal, { color: C.pass }]}>{mpStatistics.okCount}</Text>
                  <Text style={fpS.statLabel}>OK</Text>
                </View>
                <View style={[fpS.statBox, { borderLeftColor: C.fail, borderLeftWidth: 3 }]}>
                  <Icon name="close-circle-outline" size={16} color={C.fail} style={{ marginBottom: 4 }} />
                  <Text style={[fpS.statVal, { color: C.fail }]}>{mpStatistics.ngCount}</Text>
                  <Text style={fpS.statLabel}>NG</Text>
                </View>
                <View style={[fpS.statBox, { borderLeftColor: mpStatistics.ngRate > 5 ? C.fail : C.pass, borderLeftWidth: 3 }]}>
                  <Icon name="chart-arc" size={16} color={mpStatistics.ngRate > 5 ? C.fail : C.pass} style={{ marginBottom: 4 }} />
                  <Text style={[fpS.statVal, { color: mpStatistics.ngRate > 5 ? C.fail : C.pass }]}>{formatPercent(mpStatistics.ngRate)}</Text>
                  <Text style={fpS.statLabel}>{language === 'vi' ? 'Tỷ lệ NG' : language === 'zh' ? 'NG率' : 'NG Rate'}</Text>
                </View>
                {mpStatistics.minValue != null && (
                  <View style={[fpS.statBox, { borderLeftColor: '#6366F1', borderLeftWidth: 3 }]}>
                    <Icon name="arrow-collapse-down" size={16} color="#6366F1" style={{ marginBottom: 4 }} />
                    <Text style={[fpS.statVal, { color: '#6366F1', fontSize: 12 }]}>{Number(mpStatistics.minValue).toFixed(2)}</Text>
                    <Text style={fpS.statLabel}>Min</Text>
                  </View>
                )}
                {mpStatistics.maxValue != null && (
                  <View style={[fpS.statBox, { borderLeftColor: '#F97316', borderLeftWidth: 3 }]}>
                    <Icon name="arrow-collapse-up" size={16} color="#F97316" style={{ marginBottom: 4 }} />
                    <Text style={[fpS.statVal, { color: '#F97316', fontSize: 12 }]}>{Number(mpStatistics.maxValue).toFixed(2)}</Text>
                    <Text style={fpS.statLabel}>Max</Text>
                  </View>
                )}
                {mpStatistics.avgValue != null && (
                  <View style={[fpS.statBox, { borderLeftColor: '#14B8A6', borderLeftWidth: 3 }]}>
                    <Icon name="approximately-equal" size={16} color="#14B8A6" style={{ marginBottom: 4 }} />
                    <Text style={[fpS.statVal, { color: '#14B8A6', fontSize: 12 }]}>{Number(mpStatistics.avgValue).toFixed(2)}</Text>
                    <Text style={fpS.statLabel}>Avg</Text>
                  </View>
                )}
                {mpStatistics.stdDev != null && (
                  <View style={[fpS.statBox, { borderLeftColor: '#A855F7', borderLeftWidth: 3 }]}>
                    <Icon name="sigma" size={16} color="#A855F7" style={{ marginBottom: 4 }} />
                    <Text style={[fpS.statVal, { color: '#A855F7', fontSize: 12 }]}>{Number(mpStatistics.stdDev).toFixed(3)}</Text>
                    <Text style={fpS.statLabel}>{language === 'vi' ? 'Độ lệch' : language === 'zh' ? '标准差' : 'Std Dev'}</Text>
                  </View>
                )}
              </View>
            ) : mpStatsLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <ActivityIndicator size="small" color={C.accent} />
                <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 6 }}>
                  {language === 'vi' ? 'Đang tải thống kê...' : language === 'zh' ? '正在加载统计...' : 'Loading statistics...'}
                </Text>
              </View>
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                <Icon name="chart-box-outline" size={28} color={C.textMuted} />
                <Text style={{ color: C.textMuted, fontSize: 12, marginTop: 6 }}>
                  {language === 'vi' ? 'Chưa có dữ liệu thống kê' : language === 'zh' ? '暂无统计数据' : 'No statistics data available'}
                </Text>
              </View>
            )}
          </View>
          )}

          {/* ─── Trend Chart — sparkline from API (C2 trendPeriods) ─── */}
          {sections.trend && effectiveTrend.length >= 2 && (
            <View style={fpS.section}>
              <View style={fpS.secHeader}>
                <Icon name="chart-timeline-variant" size={14} color={C.accent} />
                <Text style={fpS.secTitle}>{t.trend}</Text>
                <Text style={fpS.secSub}>{language === 'vi' ? `${effectiveTrend.length} ca sản xuất` : language === 'zh' ? `${effectiveTrend.length} 个班次` : `${effectiveTrend.length} shifts`}</Text>
              </View>
              <View style={fpS.trendWrap}>
                <GradientSparkline data={effectiveTrend} color={sc} />
              </View>
            </View>
          )}

          {/* ─── Defect Pareto Chart — from API ─── */}
          {sections.defects && (
            <View style={fpS.section}>
              <View style={fpS.secHeader}>
                <Icon name="chart-waterfall" size={14} color={C.accent} />
                <Text style={fpS.secTitle}>{language === 'vi' ? 'Pareto lỗi' : language === 'zh' ? '缺陷帕累托' : 'Defect Pareto'}</Text>
                {defectParetoLoading && <ActivityIndicator size="small" color={C.accent} />}
                {!defectParetoLoading && defectPareto.length > 0 && (
                  <Text style={fpS.secSub}>Top {defectPareto.length}</Text>
                )}
              </View>
              {defectParetoLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <ActivityIndicator size="small" color={C.accent} />
                </View>
              ) : defectPareto.length > 0 ? (
                <ParetoChartSvg items={defectPareto} C={C} language={language} />
              ) : (
                <Text style={{ color: C.textSecondary, fontSize: 12, textAlign: 'center', paddingVertical: 12 }}>
                  {language === 'vi' ? 'Không có dữ liệu pareto' : language === 'zh' ? '无帕累托数据' : 'No pareto data'}
                </Text>
              )}
            </View>
          )}

          {/* ─── Fail Images — NG inspection images with hero + grid layout ─── */}
          {sections.captures && (
          <View style={fpS.section}>
            <View style={fpS.secHeader}>
              <Icon name="image-multiple-outline" size={14} color={C.fail} />
              <Text style={fpS.secTitle}>{language === 'vi' ? 'Ảnh lỗi (NG)' : language === 'zh' ? '失败图片' : 'Fail Images'}</Text>
              <Text style={fpS.secSub}>
                {pointImagesLoading ? '...' : `${pointImages.length}${pointImagesTotal > pointImages.length ? `/${pointImagesTotal}` : ''}`} {language === 'vi' ? 'ảnh' : language === 'zh' ? '张' : 'imgs'}
              </Text>
            </View>
            {pointImagesLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <ActivityIndicator size="small" color={C.accent} />
                <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 6 }}>
                  {language === 'vi' ? 'Đang tải ảnh...' : language === 'zh' ? '正在加载图片...' : 'Loading images...'}
                </Text>
              </View>
            ) : pointImages.length > 0 ? (
              <>
                {/* Hero image — latest fail image, large */}
                <RealCaptureCard
                  key={`hero-${pointImages[0].id}`}
                  imageUrl={pointImages[0].imageUrl}
                  apiBaseUrl={apiBaseUrl}
                  index={0}
                  isNG={true}
                  useThumbnail
                  cardStyle={{ width: '100%', marginBottom: 8 }}
                  imgWrapStyle={{ aspectRatio: 16 / 10 }}
                  onPress={() => onImagePress?.(pointImages[0].imageUrl, pointImages[0].pointName || '#1', true)}
                />
                {/* 2x2 grid — next images as thumbnails */}
                {pointImages.length > 1 && (
                  <View style={fpS.capturesGrid}>
                    {pointImages.slice(1, visibleImageCount).map((img, i) => (
                      <RealCaptureCard
                        key={`pi-${img.id}-${i + 1}`}
                        imageUrl={img.imageUrl}
                        apiBaseUrl={apiBaseUrl}
                        index={i + 1}
                        isNG={img.result === 'NG'}
                        useThumbnail
                        onPress={() => onImagePress?.(img.imageUrl, img.pointName || `#${i + 2}`, img.result === 'NG')}
                      />
                    ))}
                  </View>
                )}
                {/* Load more button */}
                {visibleImageCount < pointImages.length && (
                  <TouchableOpacity
                    style={{ alignItems: 'center', paddingVertical: 10, marginTop: 4, backgroundColor: `${C.accent}15`, borderRadius: 8 }}
                    activeOpacity={0.7}
                    onPress={onLoadMoreImages}
                  >
                    <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700' }}>
                      {language === 'vi'
                        ? `Xem thêm (${pointImages.length - visibleImageCount} ảnh còn lại)`
                        : language === 'zh'
                          ? `加载更多 (剩余 ${pointImages.length - visibleImageCount} 张)`
                          : `Load more (${pointImages.length - visibleImageCount} remaining)`}
                    </Text>
                  </TouchableOpacity>
                )}
                {/* Showing count */}
                <Text style={{ color: C.textMuted, fontSize: 10, textAlign: 'center', marginTop: 4 }}>
                  {language === 'vi'
                    ? `Hiển thị ${Math.min(visibleImageCount, pointImages.length)}/${pointImages.length} ảnh`
                    : language === 'zh'
                      ? `显示 ${Math.min(visibleImageCount, pointImages.length)}/${pointImages.length} 张`
                      : `Showing ${Math.min(visibleImageCount, pointImages.length)} of ${pointImages.length}`}
                </Text>
              </>
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                <Icon name="camera-off-outline" size={32} color={C.textMuted} />
                <Text style={{ color: C.textMuted, fontSize: 12, marginTop: 6 }}>
                  {language === 'vi' ? 'Chưa có ảnh lỗi trong ngày' : language === 'zh' ? '今天暂无失败图片' : 'No fail images today'}
                </Text>
              </View>
            )}
          </View>
          )}

          {/* ─── Measurements — table with param / value / spec / status ─── */}
          {sections.measurements && (effectiveMeasurements.length > 0 || panelMeasurementsLoading) && (
            <View style={fpS.section}>
              <View style={fpS.secHeader}>
                <Icon name="ruler-square" size={14} color={C.accent} />
                <Text style={fpS.secTitle}>{t.measurements}</Text>
              </View>
              {panelMeasurementsLoading ? (
                <ActivityIndicator size="small" color={C.accent} style={{ marginVertical: 12 }} />
              ) : (
                <>
              {/* Table header */}
              <View style={fpS.measHeader}>
                <Text style={[fpS.measCol, { flex: 2 }]}>{t.param}</Text>
                <Text style={[fpS.measCol, { flex: 1.5, textAlign: 'center' }]}>{t.value}</Text>
                <Text style={[fpS.measCol, { flex: 1.5, textAlign: 'center' }]}>{t.spec}</Text>
                <Text style={[fpS.measCol, { width: 36, textAlign: 'center' }]}>{language === 'vi' ? 'KQ' : language === 'zh' ? '结果' : 'Res'}</Text>
              </View>
              {effectiveMeasurements.map((m, i) => {
                const mc = m.status === 'ok' ? C.pass : m.status === 'ng' ? C.fail : C.warn;
                const mLabel = m.status === 'ok' ? 'OK' : m.status === 'ng' ? 'NG' : 'WARN';
                return (
                  <View key={i} style={[fpS.measRow, i % 2 === 0 && { backgroundColor: `${C.surfaceRaised}80` }]}>
                    <Text style={[fpS.measParam, { flex: 2 }]}>{m.param}</Text>
                    <Text style={[fpS.measVal, { flex: 1.5, color: mc }]}>{m.val}</Text>
                    <Text style={[fpS.measSpec, { flex: 1.5 }]}>{m.spec}</Text>
                    <View style={[fpS.measBadge, { backgroundColor: `${mc}20`, width: 36 }]}>
                      <Text style={[fpS.measBadgeText, { color: mc }]}>{mLabel}</Text>
                    </View>
                  </View>
                );
              })}
                </>
              )}
            </View>
          )}

          {/* ─── Recent Events — from API (C6) ─── */}
          {sections.events && (panelEvents.length > 0 || panelEventsLoading) && (
            <View style={fpS.section}>
              <View style={fpS.secHeader}>
                <Icon name="timeline-clock-outline" size={14} color={C.accent} />
                <Text style={fpS.secTitle}>{t.recentEvents}</Text>
                {panelEventsLoading && <ActivityIndicator size="small" color={C.accent} />}
              </View>
              {panelEventsLoading ? (
                <ActivityIndicator size="small" color={C.accent} style={{ marginVertical: 12 }} />
              ) : (
                panelEvents.map((evt, i) => (
                  <EventRow key={i} evt={evt} />
                ))
              )}
            </View>
          )}

          {/* ─── Action Buttons — View Full Report & Correlate ─── */}
          <View style={fpS.actionRow}>
            <TouchableOpacity style={fpS.actionBtn} activeOpacity={0.7} onPress={onViewFullReport}>
              <LinearGradient
                colors={[C.accent, C.accentDark]}
                style={fpS.actionGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Icon name="file-document-outline" size={16} color="#FFF" />
                <Text style={fpS.actionText}>{t.viewFullReport}</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={fpS.actionBtnOutline} activeOpacity={0.7} onPress={onCorrelate}>
              <Icon name="link-variant" size={16} color={C.accent} />
              <Text style={fpS.actionTextOutline}>{t.correlate}</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    </>
  );
};

export { FloatingPanel };
