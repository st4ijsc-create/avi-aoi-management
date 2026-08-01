/**
 * Factory Alert System - Bulletin Overlay Dialog
 * Modal dialog hiển thị bản tin định kỳ đè lên toàn màn hình — giống kiểu AlertOverlayDialog
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
  Image,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';

import { PeriodicBulletin } from '../types';
import { useTheme, Theme } from '../context/ThemeContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Header gradient — calm blue/teal for bulletin
const BULLETIN_GRADIENT: string[] = ['#0EA5E9', '#0284C7'];

interface BulletinOverlayDialogProps {
  visible: boolean;
  bulletin: PeriodicBulletin | null;
  onMarkRead: () => void;
  onDismiss: () => void;
  onViewDetail?: () => void;
  language?: 'vi' | 'en' | 'zh';
}

/**
 * Yield gauge — circular gauge hiển thị tỷ lệ yield
 */
const YieldGauge: React.FC<{ value: number }> = ({ value }) => {
  const color =
    value >= 95 ? '#22C55E' : value >= 85 ? '#F59E0B' : '#DC2626';

  return (
    <View style={gaugeStyles.container}>
      <View style={[gaugeStyles.ring, { borderColor: color + '30' }]}>
        <View style={[gaugeStyles.inner, { backgroundColor: color + '12' }]}>
          <Text style={[gaugeStyles.value, { color }]}>{value.toFixed(1)}</Text>
          <Text style={[gaugeStyles.unit, { color }]}>%</Text>
        </View>
      </View>
    </View>
  );
};

const gaugeStyles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  value: { fontSize: 18, fontWeight: '900' },
  unit: { fontSize: 10, fontWeight: '700', marginTop: -2 },
});

const BulletinOverlayDialog: React.FC<BulletinOverlayDialogProps> = ({
  visible,
  bulletin,
  onMarkRead,
  onDismiss,
  onViewDetail,
  language = 'vi',
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const headerGlowAnim = useRef(new Animated.Value(0)).current;

  // Translations
  const t = useMemo(
    () => ({
      title: language === 'vi' ? 'BẢN TIN ĐỊNH KỲ' : language === 'zh' ? '定期报告' : 'PERIODIC BULLETIN',
      station: language === 'vi' ? 'Trạm' : language === 'zh' ? '工站' : 'Station',
      factory: language === 'vi' ? 'Nhà máy' : language === 'zh' ? '工厂' : 'Factory',
      workshop: language === 'vi' ? 'Xưởng' : language === 'zh' ? '车间' : 'Workshop',
      line: language === 'vi' ? 'Chuyền' : language === 'zh' ? '产线' : 'Line',
      period: language === 'vi' ? 'Chu kỳ' : language === 'zh' ? '周期时间' : 'Period',
      interval: language === 'vi' ? 'Khoảng thời gian' : language === 'zh' ? '时间间隔' : 'Interval',
      minutes: language === 'vi' ? 'phút' : language === 'zh' ? '分钟' : 'min',
      statistics: language === 'vi' ? 'Thống kê sản xuất' : language === 'zh' ? '生产统计' : 'Production Statistics',
      total: language === 'vi' ? 'Tổng' : language === 'zh' ? '总计' : 'Total',
      ok: 'OK',
      ng: 'NG',
      ntf: 'NTF',
      yieldRate: language === 'vi' ? 'Tỷ lệ đạt' : language === 'zh' ? '合格率' : 'Yield Rate',
      cycleTime: language === 'vi' ? 'Cycle Time TB' : language === 'zh' ? '平均周期时间' : 'Avg Cycle Time',
      seconds: 's',
      failPoints: language === 'vi' ? 'Điểm lỗi hàng đầu' : language === 'zh' ? '主要缺陷' : 'Top Fail Points',
      machines: language === 'vi' ? 'Máy kiểm tra' : language === 'zh' ? '检测机' : 'Machines',
      noFailPoints: language === 'vi' ? 'Không có điểm lỗi' : language === 'zh' ? '无缺陷点' : 'No fail points',
      dismiss: language === 'vi' ? 'Bỏ qua' : language === 'zh' ? '忽略' : 'Dismiss',
      markRead: language === 'vi' ? 'ĐÃ XEM' : language === 'zh' ? '标为已读' : 'MARK READ',
      viewDetail: language === 'vi' ? 'XEM CHI TIẾT' : language === 'zh' ? '查看详情' : 'VIEW DETAIL',
      received: language === 'vi' ? 'Nhận lúc' : language === 'zh' ? '接收时间' : 'Received',
      bulletinId: 'ID',
      items: language === 'vi' ? 'sản phẩm' : language === 'zh' ? '产品' : 'items',
    }),
    [language],
  );

  useEffect(() => {
    if (visible && bulletin) {
      // Reset
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
      slideAnim.setValue(40);
      headerGlowAnim.setValue(0);

      // Animate in
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 7,
          tension: 50,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();

      // Soft glow animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(headerGlowAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(headerGlowAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      Animated.parallel([
        Animated.timing(scaleAnim, { toValue: 0.85, duration: 150, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 40, duration: 150, useNativeDriver: true }),
      ]).start();
      headerGlowAnim.setValue(0);
    }
  }, [visible, bulletin]);

  if (!bulletin) return null;

  // Defensive defaults — prevent crash if server sends partial data
  const stats = bulletin.statistics || {
    totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0,
    yieldRate: 0, avgCycleTime: 0,
  };
  const period = bulletin.period || {
    start: bulletin.timestamp || new Date().toISOString(),
    end: bulletin.timestamp || new Date().toISOString(),
    intervalMinutes: 0,
  };
  const failPoints = Array.isArray(bulletin.failPoints) ? bulletin.failPoints : [];
  const machines = Array.isArray(bulletin.machines) ? bulletin.machines : [];
  const yieldColor =
    stats.yieldRate >= 95 ? '#22C55E' : stats.yieldRate >= 85 ? '#F59E0B' : '#DC2626';

  // Format time
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} — ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.dialogContainer,
            {
              opacity: opacityAnim,
              transform: [
                { scale: scaleAnim },
                { translateY: slideAnim },
              ],
            },
          ]}
        >
          {/* ═══════ GRADIENT HEADER ═══════ */}
          <LinearGradient
            colors={BULLETIN_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <Animated.View style={[styles.headerGlow, { opacity: headerGlowAnim }]} />

            <View style={styles.headerTop}>
              <View style={styles.headerIconCircle}>
                <Icon name="chart-bar" size={30} color="#FFFFFF" />
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={onDismiss}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Icon name="close" size={22} color="rgba(255,255,255,0.9)" />
              </TouchableOpacity>
            </View>

            <Text style={styles.headerLabel}>{t.title}</Text>
            <Text style={styles.headerStationName} numberOfLines={1}>
              {bulletin.stationName}
            </Text>

            <View style={styles.headerMeta}>
              <View style={styles.headerMetaChip}>
                <Icon name="clock-outline" size={12} color="rgba(255,255,255,0.85)" />
                <Text style={styles.headerMetaText}>
                  {fmtTime(period.start)} → {fmtTime(period.end)}
                </Text>
              </View>
              <View style={styles.headerMetaChip}>
                <Icon name="timer-sand" size={12} color="rgba(255,255,255,0.85)" />
                <Text style={styles.headerMetaText}>
                  {period.intervalMinutes} {t.minutes}
                </Text>
              </View>
              <View style={styles.headerMetaChip}>
                <Icon name="arrow-right-bold" size={12} color="rgba(255,255,255,0.85)" />
                <Text style={styles.headerMetaText}>{bulletin.lineName}</Text>
              </View>
            </View>
          </LinearGradient>

          {/* ═══════ SCROLLABLE CONTENT ═══════ */}
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* ── Yield Gauge + Quick Stats ── */}
            <View style={styles.yieldSection}>
              <YieldGauge value={stats.yieldRate} />
              <View style={styles.yieldInfo}>
                <Text style={styles.yieldLabel}>{t.yieldRate}</Text>
                <Text style={[styles.yieldValue, { color: yieldColor }]}>
                  {stats.yieldRate.toFixed(1)}%
                </Text>
                <View style={styles.yieldSubRow}>
                  <Icon name="speedometer" size={13} color="#64748B" />
                  <Text style={styles.yieldSubText}>
                    {t.cycleTime}: {stats.avgCycleTime.toFixed(1)}{t.seconds}
                  </Text>
                </View>
              </View>
            </View>

            {/* ── Statistics Grid ── */}
            <View style={styles.statsGrid}>
              <View style={[styles.statCell, { backgroundColor: '#EFF6FF' }]}>
                <Icon name="package-variant" size={20} color="#3B82F6" />
                <Text style={styles.statValue}>{stats.totalCount}</Text>
                <Text style={styles.statLabel}>{t.total}</Text>
              </View>
              <View style={[styles.statCell, { backgroundColor: '#F0FDF4' }]}>
                <Icon name="check-circle" size={20} color="#22C55E" />
                <Text style={[styles.statValue, { color: '#22C55E' }]}>{stats.okCount}</Text>
                <Text style={styles.statLabel}>{t.ok}</Text>
              </View>
              <View style={[styles.statCell, { backgroundColor: '#FEF2F2' }]}>
                <Icon name="close-circle" size={20} color="#DC2626" />
                <Text style={[styles.statValue, { color: '#DC2626' }]}>{stats.ngCount}</Text>
                <Text style={styles.statLabel}>{t.ng}</Text>
              </View>
              <View style={[styles.statCell, { backgroundColor: '#FFFBEB' }]}>
                <Icon name="help-circle" size={20} color="#F59E0B" />
                <Text style={[styles.statValue, { color: '#F59E0B' }]}>{stats.ntfCount}</Text>
                <Text style={styles.statLabel}>{t.ntf}</Text>
              </View>
            </View>

            {/* ── Location Info ── */}
            <View style={styles.card}>
              <View style={styles.detailRow}>
                <Icon name="factory" size={18} color="#3B82F6" />
                <Text style={styles.detailLabel}>{t.factory}</Text>
                <Text style={styles.detailValue}>{bulletin.factoryName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Icon name="warehouse" size={18} color="#8B5CF6" />
                <Text style={styles.detailLabel}>{t.workshop}</Text>
                <Text style={styles.detailValue}>{bulletin.workshopName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Icon name="arrow-right-bold" size={18} color="#10B981" />
                <Text style={styles.detailLabel}>{t.line}</Text>
                <Text style={styles.detailValue}>{bulletin.lineName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Icon name="monitor-dashboard" size={18} color="#0EA5E9" />
                <Text style={styles.detailLabel}>{t.station}</Text>
                <Text style={styles.detailValue}>{bulletin.stationName}</Text>
                <Text style={styles.detailSub}>ID: {bulletin.stationId}</Text>
              </View>
              <View style={styles.detailRow}>
                <Icon name="calendar-clock" size={18} color="#64748B" />
                <Text style={styles.detailLabel}>{t.received}</Text>
                <Text style={styles.detailValue}>
                  {fmtDateTime(bulletin.receivedAt || bulletin.timestamp)}
                </Text>
              </View>
              <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
                <Icon name="identifier" size={18} color="#94A3B8" />
                <Text style={styles.detailLabel}>{t.bulletinId}</Text>
                <Text style={[styles.detailValue, styles.monoText]}>
                  {bulletin.bulletinId}
                </Text>
              </View>
            </View>

            {/* ── Top Fail Points ── */}
            {failPoints.length > 0 && (
              <View style={styles.failSection}>
                <View style={styles.failSectionHeader}>
                  <View style={styles.failTitleRow}>
                    <Icon name="alert-octagon" size={18} color={theme.colors.error} />
                    <Text style={styles.failSectionTitle}>{t.failPoints}</Text>
                  </View>
                  <View style={styles.failCountBadge}>
                    <Text style={styles.failCountText}>
                      {failPoints.length}
                    </Text>
                  </View>
                </View>

                {failPoints.slice(0, 5).map((fp, index) => (
                  <View key={`fp-${fp.pointId}-${index}`} style={styles.failPointCard}>
                    <View style={styles.failPointTop}>
                      <View style={styles.failPointRank}>
                        <Text style={styles.failPointRankText}>#{index + 1}</Text>
                      </View>
                      <View style={styles.failPointInfo}>
                        <Text style={styles.failPointName} numberOfLines={1}>
                          {fp.pointName}
                        </Text>
                        <Text style={styles.failPointCode}>{fp.pointCode}</Text>
                      </View>
                      <View style={styles.failPointStats}>
                        <Text style={styles.failPointNgCount}>{fp.ngCount}</Text>
                        <Text style={styles.failPointNgLabel}>NG</Text>
                      </View>
                    </View>

                    {/* Percentage bar */}
                    <View style={styles.failBarContainer}>
                      <View
                        style={[
                          styles.failBar,
                          {
                            width: `${Math.min(fp.percentage, 100)}%`,
                            backgroundColor:
                              fp.percentage >= 30
                                ? '#DC2626'
                                : fp.percentage >= 15
                                ? '#F59E0B'
                                : '#3B82F6',
                          },
                        ]}
                      />
                      <Text style={styles.failBarPercent}>
                        {fp.percentage.toFixed(1)}%
                      </Text>
                    </View>

                    {/* Latest serial + image */}
                    <View style={styles.failPointMeta}>
                      <Text style={styles.failPointSerial}>
                        S/N: {fp.latestSerialNumber}
                      </Text>
                      {fp.imageUrl && (
                        <View style={styles.failImageBadge}>
                          <Icon name="camera" size={11} color="#64748B" />
                        </View>
                      )}
                    </View>
                  </View>
                ))}

                {failPoints.length > 5 && (
                  <Text style={styles.moreText}>
                    +{failPoints.length - 5}{' '}
                    {language === 'vi' ? 'điểm lỗi khác…' : language === 'zh' ? '个其他缺陷点…' : 'more fail points…'}
                  </Text>
                )}
              </View>
            )}

            {/* ── Machines ── */}
            {machines.length > 0 && (
              <View style={styles.machineSection}>
                <View style={styles.machineSectionHeader}>
                  <Icon name="robot-industrial" size={18} color="#6366F1" />
                  <Text style={styles.machineSectionTitle}>{t.machines}</Text>
                </View>

                {machines.map((m, index) => (
                  <View key={`mc-${m.machineId}-${index}`} style={styles.machineRow}>
                    <View style={styles.machineIconCircle}>
                      <Icon name="cog" size={14} color="#6366F1" />
                    </View>
                    <View style={styles.machineInfo}>
                      <Text style={styles.machineName}>{m.machineName}</Text>
                      <Text style={styles.machineCode}>{m.machineCode}</Text>
                    </View>
                    <View style={styles.machineStats}>
                      <Text style={styles.machineTotal}>{m.totalCount}</Text>
                      <Text style={styles.machineTotalLabel}>{t.items}</Text>
                    </View>
                    <View
                      style={[
                        styles.machineNgBadge,
                        { backgroundColor: m.ngCount > 0 ? '#FEE2E2' : '#DCFCE7' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.machineNgText,
                          { color: m.ngCount > 0 ? '#DC2626' : '#16A34A' },
                        ]}
                      >
                        {m.ngCount} NG
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          {/* ═══════ ACTIONS ═══════ */}
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={styles.dismissButton}
              onPress={onDismiss}
              activeOpacity={0.7}
            >
              <Icon name="close-circle-outline" size={20} color={theme.colors.textSecondary} />
              <Text style={styles.dismissButtonText}>{t.dismiss}</Text>
            </TouchableOpacity>

            {onViewDetail && (
              <TouchableOpacity
                style={styles.viewDetailButton}
                onPress={onViewDetail}
                activeOpacity={0.7}
              >
                <Icon name="arrow-right-circle-outline" size={20} color="#0EA5E9" />
                <Text style={styles.viewDetailButtonText}>{t.viewDetail}</Text>
              </TouchableOpacity>
            )}

            <LinearGradient
              colors={BULLETIN_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.markReadGradient}
            >
              <TouchableOpacity
                style={styles.markReadButton}
                onPress={onMarkRead}
                activeOpacity={0.8}
              >
                <Icon name="check-bold" size={22} color="#FFFFFF" />
                <Text style={styles.markReadButtonText}>{t.markRead}</Text>
              </TouchableOpacity>
            </LinearGradient>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const createStyles = (theme: Theme) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialogContainer: {
    width: SCREEN_WIDTH - 32,
    maxWidth: 420,
    maxHeight: SCREEN_HEIGHT * 0.88,
    backgroundColor: '#F8FAFC',
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
  },

  /* ── Header ── */
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
  },
  headerGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  headerStationName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 26,
    marginBottom: 12,
  },
  headerMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  headerMetaText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },

  /* ── Content ── */
  content: {
    maxHeight: SCREEN_HEIGHT * 0.52,
  },
  contentInner: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },

  /* ── Yield Section ── */
  yieldSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  yieldInfo: {
    flex: 1,
  },
  yieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  yieldValue: {
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 4,
  },
  yieldSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  yieldSubText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },

  /* ── Stats Grid ── */
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statCell: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#1E293B',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  /* ── Card ── */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },

  /* ── Detail Rows ── */
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 10,
  },
  detailLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
    width: 65,
  },
  detailValue: {
    fontSize: 13,
    color: '#1E293B',
    fontWeight: '600',
    flex: 1,
  },
  detailSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginLeft: 4,
  },
  monoText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
  },

  /* ── Fail Points ── */
  failSection: {
    backgroundColor: '#FEF2F2',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  failSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  failTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  failSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.error,
  },
  failCountBadge: {
    backgroundColor: theme.colors.error,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  failCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  failPointCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  failPointTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  failPointRank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  failPointRankText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DC2626',
  },
  failPointInfo: {
    flex: 1,
  },
  failPointName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  failPointCode: {
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  failPointStats: {
    alignItems: 'center',
  },
  failPointNgCount: {
    fontSize: 16,
    fontWeight: '900',
    color: '#DC2626',
  },
  failPointNgLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#DC2626',
  },
  failBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  failBar: {
    height: 6,
    borderRadius: 3,
    minWidth: 4,
  },
  failBarPercent: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  failPointMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  failPointSerial: {
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  failImageBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
    fontStyle: 'italic',
  },

  /* ── Machines ── */
  machineSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  machineSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  machineSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6366F1',
  },
  machineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 8,
  },
  machineIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  machineInfo: {
    flex: 1,
  },
  machineName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  machineCode: {
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  machineStats: {
    alignItems: 'center',
    marginRight: 8,
  },
  machineTotal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E293B',
  },
  machineTotalLabel: {
    fontSize: 8,
    fontWeight: '600',
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  machineNgBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  machineNgText: {
    fontSize: 11,
    fontWeight: '800',
  },

  /* ── Actions ── */
  actionsContainer: {
    flexDirection: 'row',
    padding: 14,
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  dismissButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    gap: 5,
  },
  dismissButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  viewDetailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0EA5E9',
    gap: 5,
  },
  viewDetailButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0EA5E9',
  },
  markReadGradient: {
    flex: 1,
    borderRadius: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  markReadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    gap: 8,
  },
  markReadButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});

export default BulletinOverlayDialog;
