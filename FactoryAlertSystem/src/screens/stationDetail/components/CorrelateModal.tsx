/**
 * StationDetail — correlate modal: NG points sharing defect types / high NG-rate points.
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '../../../context';
import type { InspectionPoint, InspectionDefect, Language } from '../../../types';
import { DK, LK } from '../palette';
import { STATION_T } from '../translations';

// ============================================
// CORRELATE MODAL — shows correlated NG points
// ============================================
const CorrelateModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  point: InspectionPoint | null;
  allPoints: InspectionPoint[];
  t: typeof STATION_T.vi;
  language: Language;
}> = ({ visible, onClose, point, allPoints, t, language }) => {
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  if (!point) return null;

  // Find NG-related points: other points that share defect types or are also failing
  const currentDefectNames = new Set(point.defects.map((d) => d.name.toLowerCase()));
  const correlated = allPoints
    .filter((p) => p.id !== point.id && p.status === 'fail')
    .map((p) => {
      const sharedDefects = p.defects.filter((d) => currentDefectNames.has(d.name.toLowerCase()));
      const ngMeasurements = p.measurements.filter((m) => m.status === 'ng');
      return { point: p, sharedDefects, ngMeasurements, score: sharedDefects.length * 2 + (p.status === 'fail' ? 1 : 0) };
    })
    .filter((c) => c.score > 0 || c.ngMeasurements.length > 0)
    .sort((a, b) => b.score - a.score || b.point.defectRate - a.point.defectRate);

  // Also include high NG-rate points even without shared defects
  const highNgPoints = allPoints
    .filter((p) => p.id !== point.id && p.defectRate > 3 && !correlated.find((c) => c.point.id === p.id))
    .sort((a, b) => b.defectRate - a.defectRate)
    .slice(0, 5)
    .map((p) => ({ point: p, sharedDefects: [] as InspectionDefect[], ngMeasurements: p.measurements.filter((m) => m.status === 'ng'), score: 0 }));

  const allCorrelated = [...correlated, ...highNgPoints];
  const totalNG = allCorrelated.reduce((sum, c) => sum + c.point.defects.reduce((s, d) => s + d.count, 0), 0);
  const avgRate = allCorrelated.length > 0
    ? allCorrelated.reduce((sum, c) => sum + c.point.defectRate, 0) / allCorrelated.length
    : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View style={{ flex: 1, marginTop: 60, backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Icon name="link-variant" size={20} color={C.accent} />
            <Text style={{ fontSize: 16, fontWeight: '800', color: C.text, flex: 1, marginLeft: 8 }}>{t.correlateTitle}</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 6, backgroundColor: C.surfaceRaised, borderRadius: 8 }}>
              <Icon name="close" size={20} color={C.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }} showsVerticalScrollIndicator={false}>
            {/* Source point */}
            <View style={{ backgroundColor: `${C.accent}10`, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: `${C.accent}30` }}>
              <Text style={{ fontSize: 10, color: C.accent, fontWeight: '700', marginBottom: 4 }}>
                {language === 'vi' ? 'ĐIỂM ĐANG PHÂN TÍCH' : language === 'zh' ? '分析中的点' : 'ANALYZING POINT'}
              </Text>
              <Text style={{ fontSize: 15, fontWeight: '800', color: C.text }}>{point.name}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                <Text style={{ fontSize: 12, color: C.fail, fontWeight: '700' }}>
                  {t.defectRate}: {point.defectRate.toFixed(1)}%
                </Text>
                <Text style={{ fontSize: 12, color: C.textMuted }}>
                  {point.defects.length} {language === 'vi' ? 'loại lỗi' : language === 'zh' ? '种缺陷' : 'defect types'}
                </Text>
              </View>
              {point.defects.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                  {point.defects.map((d, i) => (
                    <View key={i} style={{ backgroundColor: `${C.fail}20`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: C.fail }}>{d.name} ({d.count})</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Summary */}
            {allCorrelated.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <View style={{ flex: 1, backgroundColor: C.surfaceRaised, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: C.fail }}>{allCorrelated.length}</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted }}>{language === 'vi' ? 'Điểm liên quan' : language === 'zh' ? '相关点' : 'Related Points'}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: C.surfaceRaised, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: C.fail }}>{totalNG}</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted }}>{t.totalNG}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: C.surfaceRaised, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: avgRate > 5 ? C.fail : C.warn }}>{avgRate.toFixed(1)}%</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted }}>{t.avgNgRate}</Text>
                </View>
              </View>
            )}

            {/* Correlated points */}
            {allCorrelated.length > 0 ? allCorrelated.map((c, idx) => (
              <View key={c.point.id} style={{ backgroundColor: C.surfaceRaised, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: `${C.fail}20`, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: C.fail }}>{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>{c.point.name}</Text>
                    {c.point.code && <Text style={{ fontSize: 10, color: C.textMuted }}>{c.point.code}</Text>}
                  </View>
                  <View style={{ backgroundColor: `${C.fail}20`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: C.fail }}>{c.point.defectRate.toFixed(1)}%</Text>
                  </View>
                </View>
                {c.sharedDefects.length > 0 && (
                  <View style={{ marginTop: 4 }}>
                    <Text style={{ fontSize: 10, color: C.accent, fontWeight: '600', marginBottom: 4 }}>
                      {language === 'vi' ? 'Lỗi chung:' : language === 'zh' ? '共同缺陷：' : 'Shared defects:'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      {c.sharedDefects.map((d, i) => (
                        <View key={i} style={{ backgroundColor: `${C.warn}20`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                          <Text style={{ fontSize: 9, fontWeight: '700', color: C.warn }}>{d.name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
                {c.ngMeasurements.length > 0 && (
                  <View style={{ marginTop: 6 }}>
                    <Text style={{ fontSize: 10, color: C.fail, fontWeight: '600', marginBottom: 2 }}>
                      {language === 'vi' ? 'Phép đo NG:' : language === 'zh' ? 'NG测量：' : 'NG Measurements:'}
                    </Text>
                    {c.ngMeasurements.slice(0, 3).map((m, i) => (
                      <Text key={i} style={{ fontSize: 10, color: C.textSecondary, marginLeft: 8 }}>
                        • {m.param}: {m.val} ({m.spec})
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )) : (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Icon name="check-circle-outline" size={48} color={C.pass} />
                <Text style={{ fontSize: 14, color: C.textSecondary, marginTop: 12, textAlign: 'center' }}>{t.noCorrelation}</Text>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export { CorrelateModal };
