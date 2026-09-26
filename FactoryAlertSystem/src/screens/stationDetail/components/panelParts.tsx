/**
 * StationDetail — floating-panel building blocks: time-range dropdown, KPI/info cards,
 * filter tabs, point/measurement/event rows, sparklines, capture cards, Pareto chart.
 * MB11 decomposition (seam 2 — FloatingPanel parts): moved verbatim from StationDetailScreen.tsx.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Image, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Polyline, Circle as SvgCircle, Defs, RadialGradient, Stop, Rect, Text as SvgText, Line as SvgLine } from 'react-native-svg';

import { useTheme } from '../../../context';
import type { InspectionPoint, InspectionPointStatus, InspectionDefect, InspectionMeasurement, InspectionEvent, Language } from '../../../types';
import type { DefectParetoItem } from '../../../services/stationService';
import { DK, LK, PANEL_WIDTH, STATUS_COLORS, STATUS_ICONS } from '../palette';
import type { CP } from '../palette';
import { STATION_T } from '../translations';
import type { PanelTimeRange } from '../types';
import { formatPercent } from '../utils/format';
import { TIME_RANGE_OPTIONS, getTimeRangeLabel, getTimeRangeSubtitle } from '../utils/timeRange';
import { getS } from '../styles';
import { nguonAnh } from '../../../services/imageService';


/**
 * TimeRangeDropdown — compact dropdown button for time range selection
 */

const TimeRangeDropdown: React.FC<{
  value: PanelTimeRange;
  onChange: (range: PanelTimeRange) => void;
  language: string;
  compact?: boolean;
}> = ({ value, onChange, language, compact }) => {
  const [open, setOpen] = useState(false);
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;

  return (
    <View style={{ position: 'relative', zIndex: 999, flex: 1 }}>
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
          paddingHorizontal: compact ? 8 : 10, paddingVertical: 4,
          borderRadius: 12,
          backgroundColor: `${C.accent}18`,
          borderWidth: 1, borderColor: C.accent,
        }}
      >
        <Icon name="calendar-range" size={13} color={C.accent} />
        <Text style={{ fontSize: 11, fontWeight: '700', color: C.accent }}>{getTimeRangeLabel(value, !!compact)}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} color={C.accent} />
      </TouchableOpacity>

      {open && (
        <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setOpen(false)}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)' }}>
              <View style={{
                backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
                paddingVertical: 6, minWidth: 150, elevation: 8,
                shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
              }}>
                {TIME_RANGE_OPTIONS.map((r) => {
                  const active = value === r;
                  return (
                    <TouchableOpacity
                      key={r}
                      onPress={() => { onChange(r); setOpen(false); }}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 8,
                        paddingHorizontal: 14, paddingVertical: 10,
                        backgroundColor: active ? `${C.accent}15` : 'transparent',
                      }}
                    >
                      <Icon
                        name={active ? 'radiobox-marked' : 'radiobox-blank'}
                        size={16}
                        color={active ? C.accent : C.textMuted}
                      />
                      <View>
                        <Text style={{
                          fontSize: 13, fontWeight: active ? '700' : '400',
                          color: active ? C.accent : C.text,
                        }}>{getTimeRangeLabel(r, false)}</Text>
                        <Text style={{
                          fontSize: 10, color: active ? C.accent : C.textMuted, marginTop: 1,
                        }}>{getTimeRangeSubtitle(r, language)}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
};

/**
 * KPI Card — compact dark glassy style
 */
const KPICard: React.FC<{
  label: string;
  value: string;
  icon: string;
  color: string;
  delta?: number;
}> = ({ label, value, icon, color, delta }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { kpiS } = getS(theme.isDark);
  return (
  <View style={kpiS.card}>
    <LinearGradient
      colors={[`${color}15`, `${color}08`]}
      style={kpiS.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <View style={kpiS.row}>
        <View style={[kpiS.iconWrap, { backgroundColor: `${color}25` }]}>
          <Icon name={icon} size={11} color={color} />
        </View>
        <Text style={kpiS.label}>{label}</Text>
        <Text style={[kpiS.value, { color }]}>{value}</Text>
        {delta !== undefined && delta !== 0 && (
          <View style={[kpiS.delta, { backgroundColor: delta > 0 ? '#22C55E18' : '#EF444418' }]}>
            <Icon name={delta > 0 ? 'trending-up' : 'trending-down'} size={10} color={delta > 0 ? C.pass : C.fail} />
            <Text style={{ color: delta > 0 ? C.pass : C.fail, fontSize: 9, fontWeight: '700' }}>
              {Math.abs(delta).toFixed(1)}%
            </Text>
          </View>
        )}
      </View>
    </LinearGradient>
  </View>
  );
};


/**
 * Station Info Card (same design as KPICard, compact size)
 */
const StationInfoCard: React.FC<{
  label: string;
  value: string;
  icon: string;
  color: string;
}> = ({ label, value, icon, color }) => {
  const { sicS } = getS(useTheme().theme.isDark);
  return (
  <View style={sicS.card}>
    <LinearGradient
      colors={[`${color}15`, `${color}08`]}
      style={sicS.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <View style={sicS.row}>
        <View style={[sicS.iconWrap, { backgroundColor: `${color}25` }]}>
          <Icon name={icon} size={13} color={color} />
        </View>
        <View style={sicS.texts}>
          <Text style={sicS.label} numberOfLines={1}>{label}</Text>
          <Text style={[sicS.value, { color }]} numberOfLines={1}>{value}</Text>
        </View>
      </View>
    </LinearGradient>
  </View>
  );
};


/**
 * Filter Tab (All/Fail/Warn/Pass)
 */
const FilterTabs: React.FC<{
  activeFilter: InspectionPointStatus | 'all';
  counts: { all: number; fail: number; warn: number; pass: number };
  onSelect: (f: InspectionPointStatus | 'all') => void;
  t: typeof STATION_T.vi;
}> = ({ activeFilter, counts, onSelect, t }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { filterS } = getS(theme.isDark);
  const tabs: { key: InspectionPointStatus | 'all'; label: string; count: number; color?: string }[] = [
    { key: 'all', label: t.all, count: counts.all },
    { key: 'fail', label: t.fail, count: counts.fail, color: C.fail },
    { key: 'warn', label: t.warn, count: counts.warn, color: C.warn },
    { key: 'pass', label: t.pass, count: counts.pass, color: C.pass },
  ];

  return (
    <View style={filterS.row}>
      {tabs.map((tab) => {
        const active = activeFilter === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[
              filterS.tab,
              active && { backgroundColor: C.accent, borderColor: C.accent },
            ]}
            onPress={() => onSelect(tab.key)}
            activeOpacity={0.7}
          >
            {tab.color && !active && <View style={[filterS.dot, { backgroundColor: tab.color }]} />}
            <Text style={[filterS.text, active && { color: '#FFF' }]}>{tab.label}</Text>
            <Text style={[filterS.count, active && { color: 'rgba(255,255,255,0.7)' }]}>{tab.count}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};


/**
 * Inspection Point Row — dark theme with glow accent
 */
const PointRow: React.FC<{
  point: InspectionPoint;
  isSelected: boolean;
  onPress: (point: InspectionPoint) => void;
}> = React.memo(({ point, isSelected, onPress }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { ptS } = getS(theme.isDark);
  const sc = STATUS_COLORS[point.status];
  return (
    <TouchableOpacity
      style={[
        ptS.row,
        { borderLeftColor: sc },
        isSelected && { backgroundColor: C.surfaceHover, borderLeftColor: C.accent },
      ]}
      onPress={() => onPress(point)}
      activeOpacity={0.7}
    >
      <View style={ptS.left}>
        <Icon name={STATUS_ICONS[point.status]} size={18} color={sc} />
        <View style={ptS.info}>
          <Text style={ptS.id}>{point.code || point.id}</Text>
          <Text style={ptS.name} numberOfLines={1}>{point.name}</Text>
        </View>
      </View>
      <View style={ptS.right}>
        <View style={ptS.typeBadge}>
          <Text style={ptS.typeText}>{point.type}</Text>
        </View>
        <Text style={[ptS.rate, { color: sc }]}>{formatPercent(point.defectRate)}</Text>
        <Icon name="chevron-right" size={16} color={C.textMuted} />
      </View>
    </TouchableOpacity>
  );
});


/**
 * SVG Sparkline Trend
 */
const SparklineTrend: React.FC<{ data: number[]; color: string; width?: number; height?: number }> = ({
  data,
  color,
  width: w = PANEL_WIDTH - 48,
  height: h = 50,
}) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const stepX = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * stepX},${h - (v / max) * (h - 8)}`).join(' ');
  const last = data[data.length - 1];
  const lx = (data.length - 1) * stepX;
  const ly = h - (last / max) * (h - 8);

  return (
    <Svg width={w} height={h + 4} viewBox={`0 0 ${w} ${h + 4}`}>
      <Polyline points={pts} fill="none" stroke={`${color}50`} strokeWidth={2} strokeLinejoin="round" />
      <Polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <SvgCircle cx={lx} cy={ly} r={4} fill={color} />
      <SvgCircle cx={lx} cy={ly} r={7} fill={`${color}30`} />
    </Svg>
  );
};

/**
 * Defect Breakdown Bar
 */
const DefectBar: React.FC<{ defect: InspectionDefect; maxPct: number }> = ({ defect, maxPct }) => {
  const { dbS } = getS(useTheme().theme.isDark);
  const barW = maxPct > 0 ? (defect.pct / maxPct) * 100 : 0;
  return (
    <View style={dbS.row}>
      <View style={dbS.labelRow}>
        <View style={[dbS.dot, { backgroundColor: defect.color }]} />
        <Text style={dbS.name} numberOfLines={1}>{defect.name}</Text>
        <Text style={dbS.pct}>{defect.pct}% ({defect.count})</Text>
      </View>
      <View style={dbS.barBg}>
        <View style={[dbS.barFill, { width: `${barW}%`, backgroundColor: defect.color }]} />
      </View>
    </View>
  );
};


/**
 * Measurement Row
 */
const MeasRow: React.FC<{ m: InspectionMeasurement }> = ({ m }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { meS } = getS(theme.isDark);
  const sc = m.status === 'ok' ? C.pass : m.status === 'ng' ? C.fail : C.warn;
  return (
    <View style={meS.row}>
      <Text style={meS.param}>{m.param}</Text>
      <Text style={[meS.val, { color: sc }]}>{m.val}</Text>
      <Text style={meS.spec}>{m.spec}</Text>
      <Icon name={m.status === 'ok' ? 'check-circle' : m.status === 'ng' ? 'close-circle' : 'alert-circle'} size={14} color={sc} />
    </View>
  );
};


/**
 * Event Timeline Row
 */
const EventRow: React.FC<{ evt: InspectionEvent }> = ({ evt }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { evS } = getS(theme.isDark);
  const ec = STATUS_COLORS[evt.type] || C.textMuted;
  return (
    <View style={evS.row}>
      <Text style={evS.time}>{evt.time}</Text>
      <View style={evS.line}>
        <View style={[evS.dot, { backgroundColor: ec }]} />
        <View style={[evS.stem, { backgroundColor: `${ec}30` }]} />
      </View>
      <Text style={evS.desc}>{evt.desc}</Text>
    </View>
  );
};


// ============================================
// GRADIENT SPARKLINE TREND (with area fill + last value label)
// ============================================
const GradientSparkline: React.FC<{ data: number[]; color: string; width?: number; height?: number }> = ({
  data,
  color,
  width: w = PANEL_WIDTH - 48,
  height: h = 64,
}) => {
  const C = useTheme().theme.isDark ? DK : LK;
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const padding = 8;
  const stepX = (w - padding * 2) / (data.length - 1);
  const pts = data.map((v, i) => `${padding + i * stepX},${h - padding - (v / max) * (h - padding * 2)}`).join(' ');
  const last = data[data.length - 1];
  const lx = padding + (data.length - 1) * stepX;
  const ly = h - padding - (last / max) * (h - padding * 2);
  // Area polygon: line points + bottom-right + bottom-left
  const areaPts = `${pts} ${padding + (data.length - 1) * stepX},${h - padding} ${padding},${h - padding}`;

  return (
    <View>
      <Svg width={w} height={h + 20} viewBox={`0 0 ${w} ${h + 20}`}>
        <Defs>
          <RadialGradient id="sparkGrad" cx="50%" cy="0%" rx="60%" ry="100%">
            <Stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <Stop offset="100%" stopColor={color} stopOpacity="0.03" />
          </RadialGradient>
        </Defs>
        {/* Gradient area fill */}
        <Polyline points={areaPts} fill={`${color}18`} stroke="none" />
        {/* Line */}
        <Polyline points={pts} fill="none" stroke={`${color}40`} strokeWidth={1.5} strokeLinejoin="round" />
        <Polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {/* Data dots */}
        {data.map((v, i) => {
          const cx = padding + i * stepX;
          const cy = h - padding - (v / max) * (h - padding * 2);
          return (
            <SvgCircle key={i} cx={cx} cy={cy} r={i === data.length - 1 ? 4.5 : 2} fill={i === data.length - 1 ? color : `${color}60`} />
          );
        })}
        {/* Glow dot on last value */}
        <SvgCircle cx={lx} cy={ly} r={8} fill={`${color}20`} />
        <SvgCircle cx={lx} cy={ly} r={4.5} fill={color} />
      </Svg>
      {/* Last value label */}
      <View style={{ position: 'absolute', right: 4, top: 0, backgroundColor: `${color}25`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
        <Text style={{ fontSize: 10, fontWeight: '800', color }}>{last.toFixed(1)}%</Text>
      </View>
      {/* Shift labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: padding, marginTop: -14 }}>
        {data.map((_, i) => (
          <Text key={i} style={{ fontSize: 7, color: C.textMuted, width: 16, textAlign: 'center' }}>
            {i === 0 ? 'S1' : i === data.length - 1 ? `S${data.length}` : ''}
          </Text>
        ))}
      </View>
    </View>
  );
};

// ============================================
// REAL CAPTURE CARD (actual error images from API)
// ============================================
const MAX_IMAGE_RETRY = 3;
const RETRY_DELAYS = [1500, 3000, 6000]; // exponential backoff ms

const RealCaptureCard: React.FC<{ imageUrl: string; index: number; isNG: boolean; apiBaseUrl: string; onPress?: () => void; useThumbnail?: boolean; cardStyle?: any; imgWrapStyle?: any }> = React.memo(({ imageUrl, index, isNG, apiBaseUrl, onPress, useThumbnail, cardStyle, imgWrapStyle }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { capS } = getS(theme.isDark);
  const badgeColor = isNG ? C.fail : C.pass;
  const badgeLabel = isNG ? 'NG' : 'OK';
  const [loadError, setLoadError] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const retryCountRef = React.useRef(0);
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryKey, setRetryKey] = React.useState(0); // force re-render on retry

  // Build full URL from relative path, optionally append thumbnail params
  const fullUrl = React.useMemo(() => {
    if (!imageUrl) return '';
    let url: string;
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      url = imageUrl;
    } else {
      const base = (apiBaseUrl || '').replace(/\/+$/, '');
      const path = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
      url = `${base}${path}`;
    }
    if (useThumbnail && !url.includes('?w=')) {
      url += (url.includes('?') ? '&' : '?') + 'w=200&q=60';
    }
    return url;
  }, [imageUrl, apiBaseUrl, useThumbnail]);

  // Reset state when URL changes
  React.useEffect(() => {
    setLoadError(false);
    setIsLoading(true);
    retryCountRef.current = 0;
    setRetryKey(0);
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, [fullUrl]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);

  const handleImageError = React.useCallback((e: any) => {
    const attempt = retryCountRef.current;
    if (attempt < MAX_IMAGE_RETRY) {
      // Auto-retry with exponential backoff
      console.log(`[RealCaptureCard] Retry ${attempt + 1}/${MAX_IMAGE_RETRY}:`, fullUrl);
      retryCountRef.current = attempt + 1;
      retryTimerRef.current = setTimeout(() => {
        setRetryKey(prev => prev + 1);
      }, RETRY_DELAYS[attempt] || 3000);
    } else {
      console.warn('[RealCaptureCard] Image load failed after retries:', fullUrl, e.nativeEvent?.error);
      setLoadError(true);
      setIsLoading(false);
    }
  }, [fullUrl]);

  const handleManualRetry = React.useCallback(() => {
    retryCountRef.current = 0;
    setLoadError(false);
    setIsLoading(true);
    setRetryKey(prev => prev + 1);
  }, []);

  return (
    <TouchableOpacity style={[capS.card, cardStyle]} activeOpacity={onPress ? 0.7 : 1} onPress={loadError ? handleManualRetry : onPress}>
      <View style={[capS.imgWrap, imgWrapStyle]}>
        {fullUrl && !loadError ? (
          <>
            <Image
              key={`img-${retryKey}`}
              source={nguonAnh(fullUrl)}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
              resizeMethod="resize"
              onLoadStart={() => setIsLoading(true)}
              onLoadEnd={() => setIsLoading(false)}
              onError={handleImageError}
              progressiveRenderingEnabled={true}
            />
            {isLoading && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: `${C.surface}99` }}>
                <ActivityIndicator size="small" color={C.accent} />
                {retryCountRef.current > 0 && (
                  <Text style={{ color: C.textMuted, fontSize: 9, marginTop: 4 }}>Retry {retryCountRef.current}/{MAX_IMAGE_RETRY}</Text>
                )}
              </View>
            )}
          </>
        ) : (
          <LinearGradient
            colors={[C.surfaceRaised, `${C.surface}CC`]}
            style={capS.imgPlaceholder}
          >
            <Icon name="image-off-outline" size={18} color={C.textMuted} />
            <Text style={capS.imgLabel}>#{index + 1}</Text>
            <Text style={{ color: C.accent, fontSize: 9, marginTop: 2 }}>Tap to retry</Text>
          </LinearGradient>
        )}
        {isNG && (
          <View style={capS.ngRegion}>
            <View style={capS.ngBorder} />
          </View>
        )}
        <View style={[capS.badge, { backgroundColor: badgeColor }]}>
          <Text style={capS.badgeText}>{badgeLabel}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ─── Pareto Chart SVG Component ───
const PARETO_COLORS = ['#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#14B8A6', '#06B6D4', '#3B82F6', '#8B5CF6'];
const ParetoChartSvg: React.FC<{
  items: DefectParetoItem[];
  C: CP;
  language: Language;
}> = ({ items, C, language }) => {
  if (items.length === 0) return null;
  const chartW = PANEL_WIDTH - 40;
  const barAreaH = 140;
  const labelH = 40;
  const svgH = barAreaH + labelH + 10;
  const maxCount = Math.max(...items.map((i) => i.ngCount), 1);
  const barW = Math.max(Math.floor((chartW - 30) / items.length) - 4, 12);
  const totalCount = items.reduce((s, i) => s + i.ngCount, 0);
  let cumPct = 0;

  return (
    <View style={{ marginTop: 4 }}>
      <Svg width={chartW} height={svgH}>
        {/* Bars + cumulative line points */}
        {items.map((item, idx) => {
          const barH = (item.ngCount / maxCount) * (barAreaH - 20);
          const x = 20 + idx * (barW + 4);
          const y = barAreaH - barH;
          cumPct += totalCount > 0 ? (item.ngCount / totalCount) * 100 : 0;
          const lineY = barAreaH - (cumPct / 100) * (barAreaH - 20);
          return (
            <React.Fragment key={idx}>
              <Rect x={x} y={y} width={barW} height={barH} rx={3} fill={PARETO_COLORS[idx % PARETO_COLORS.length]} opacity={0.85} />
              <SvgText x={x + barW / 2} y={y - 3} fontSize={9} fill={C.text} textAnchor="middle" fontWeight="600">
                {item.ngCount}
              </SvgText>
              {idx > 0 && (
                <SvgLine
                  x1={20 + (idx - 1) * (barW + 4) + barW / 2}
                  y1={barAreaH - ((cumPct - (item.ngCount / totalCount) * 100) / 100) * (barAreaH - 20)}
                  x2={x + barW / 2}
                  y2={lineY}
                  stroke={C.accent}
                  strokeWidth={1.5}
                  strokeDasharray="4,2"
                />
              )}
              <SvgCircle cx={x + barW / 2} cy={lineY} r={3} fill={C.accent} />
              <SvgText x={x + barW / 2} y={lineY - 6} fontSize={8} fill={C.accent} textAnchor="middle" fontWeight="600">
                {cumPct.toFixed(0)}%
              </SvgText>
              <SvgText
                x={x + barW / 2}
                y={barAreaH + 12}
                fontSize={8}
                fill={C.textSecondary}
                textAnchor="middle"
                fontWeight="500"
              >
                {(item.pointCode || '').length > 6 ? (item.pointCode || '').slice(0, 5) + '…' : (item.pointCode || '')}
              </SvgText>
            </React.Fragment>
          );
        })}
        {/* Y-axis label */}
        <SvgText x={2} y={12} fontSize={8} fill={C.textMuted} fontWeight="500">
          {language === 'vi' ? 'SL' : language === 'zh' ? '数量' : 'Qty'}
        </SvgText>
      </Svg>
      {/* Legend below chart */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
        {items.slice(0, 5).map((item, idx) => (
          <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingRight: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: PARETO_COLORS[idx % PARETO_COLORS.length] }} />
            <Text style={{ fontSize: 9, color: C.textSecondary }} numberOfLines={1}>
              {item.pointCode}{item.pointName ? ` - ${item.pointName}` : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

export {
  TimeRangeDropdown, KPICard, StationInfoCard, FilterTabs, PointRow,
  SparklineTrend, DefectBar, MeasRow, EventRow, GradientSparkline,
  RealCaptureCard, ParetoChartSvg, MAX_IMAGE_RETRY, RETRY_DELAYS,
};
