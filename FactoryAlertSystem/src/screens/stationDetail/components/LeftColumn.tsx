/**
 * StationDetail — left column: column toolbar (collapse + poll countdown),
 * KPI strip, inspection-points table.
 * MB11 decomposition (seam 4 — KPI header): moved verbatim from StationDetailScreen.tsx.
 */
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '../../../context';
import type { InspectionPoint, Language, StationKPI, PointAccumulatedData } from '../../../types';
import { DK, LK } from '../palette';
import { STATION_T } from '../translations';
import { formatPercent } from '../utils/format';
import { getS } from '../styles';
import { KPICard } from './panelParts';

const LeftColumn: React.FC<{
  t: typeof STATION_T.vi;
  lang: Language;
  col1Pct: number;
  onCollapse: () => void;
  proactivePollingEnabled: boolean;
  lastPollTime: number;
  pollCountdown: number;
  kpi: StationKPI | null;
  displayPoints: InspectionPoint[];
  pointDataMap: Record<string, PointAccumulatedData>;
  selectedProductCode: string | undefined;
  selectedPointId: string | null;
  onPointPress: (p: InspectionPoint) => void;
}> = ({ t, lang, col1Pct, onCollapse, proactivePollingEnabled, lastPollTime, pollCountdown, kpi, displayPoints, pointDataMap, selectedProductCode, selectedPointId, onPointPress }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { s } = getS(theme.isDark);

  return (
    <View style={[s.col1, { flex: col1Pct / (1 - col1Pct) }]}>
      {/* Column toolbar */}
      <View style={s.colResizeBar}>
        <TouchableOpacity
          style={s.colResizeBtn}
          onPress={onCollapse}
          activeOpacity={0.6}
        >
          <Icon name="chevron-left" size={14} color={C.accent} />
        </TouchableOpacity>
        <Text style={s.colResizeLabel}>{Math.round(col1Pct * 100)}%</Text>
        {proactivePollingEnabled && lastPollTime > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 2 }}>
            <Icon
              name={pollCountdown <= 0 ? 'sync' : 'timer-outline'}
              size={11}
              color={pollCountdown <= 3 ? C.accent : C.textMuted}
            />
            <Text style={{ fontSize: 10, color: pollCountdown <= 3 ? C.accent : C.textMuted, fontWeight: '600' }}>
              {pollCountdown <= 0 ? '...' : `${pollCountdown}s`}
            </Text>
          </View>
        )}
      </View>

      {/* KPI Strip */}
      {kpi && (
        <View style={s.kpiSection}>
          <View style={s.kpiHeader}>
            <Text style={s.kpiHeaderTitle}>KPI</Text>
          </View>
          <View style={s.kpiStrip}>
            <KPICard label={t.firstPassYield} value={formatPercent(kpi.firstPassYield)} icon="trophy-outline" color={C.pass} delta={kpi.yieldDelta} />
            <KPICard label={t.finalYield} value={formatPercent(kpi.finalYield)} icon="check-decagram-outline" color={C.accent} />
            <KPICard label={t.output} value={String(kpi.output)} icon="package-variant-closed" color="#8B5CF6" />
            <KPICard label={t.retestRate} value={formatPercent(kpi.retestRate)} icon="refresh" color={C.warn} />
          </View>
        </View>
      )}

      {/* Inspection Points Table */}
      <View style={s.pointsSection}>
        <View style={s.pointsHeader}>
          <Text style={s.secTitle}>{t.inspectionPoints}</Text>
          <Text style={s.pointsCount}>{displayPoints.length} {lang === 'vi' ? 'điểm' : 'pts'}</Text>
        </View>
        {/* Table Header */}
        <View style={s.tableHeader}>
          <Text style={[s.tableHCell, { width: 18 }]}> </Text>
          <Text style={[s.tableHCell, s.tColPoint]}>Point</Text>
          <Text style={[s.tableHCell, s.tColNum]}>TTs</Text>
          <Text style={[s.tableHCell, s.tColNum]}>NG%</Text>
          <Text style={[s.tableHCell, s.tColNum]}>NTF%</Text>
        </View>
        {displayPoints.length === 0 ? (
          <View style={s.noPts}>
            <Icon name="magnify-close" size={36} color={C.textMuted} />
            <Text style={s.noPtsText}>{t.noPoints}</Text>
            <Text style={s.noPtsHint}>{t.noPointsHint}</Text>
          </View>
        ) : (
          <ScrollView
            style={s.pointsScroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            persistentScrollbar
          >
            {displayPoints.map((pt, idx) => {
              const key = selectedProductCode ? `${selectedProductCode}::${pt.id}` : '';
              const pd = key ? pointDataMap[key] : pointDataMap[pt.id];
              const totals = pd?.totalInspections || 0;
              const ng = pd?.ngCount || 0;
              const ngPct = totals > 0 ? Math.round((ng / totals) * 1000) / 10 : 0;
              const ntf = pd?.ntfCount || 0;
              const ntfPct = totals > 0 ? Math.round((ntf / totals) * 1000) / 10 : 0;
              // Use pt.status from productPoints useMemo (includes hasLatestAlert + MQTT priority)
              // to keep table status dot consistent with canvas marker color
              const statusColor = pt.status === 'fail' ? C.fail : pt.status === 'warn' ? C.warn : totals > 0 ? C.pass : C.textMuted;
              return (
                <TouchableOpacity
                  key={pt.id}
                  style={[s.tableRow, idx % 2 === 1 && s.tableRowAlt, pt.id === selectedPointId && s.tableRowSel]}
                  onPress={() => onPointPress(pt)}
                  activeOpacity={0.7}
                >
                  <View style={{ width: 18, justifyContent: 'center', alignItems: 'center' }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor }} />
                  </View>
                  <Text style={[s.tableCell, s.tColPoint]} numberOfLines={1}>{pt.code || pt.id}</Text>
                  <Text style={[s.tableCell, s.tColNum, { color: '#8B5CF6' }]}>{totals}</Text>
                  <Text style={[s.tableCell, s.tColNum, { color: ngPct > 0 ? C.fail : C.textMuted }]}>{ngPct}%</Text>
                  <Text style={[s.tableCell, s.tColNum, { color: ntfPct > 0 ? C.warn : C.textMuted }]}>{ntfPct}%</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
};

export { LeftColumn };
