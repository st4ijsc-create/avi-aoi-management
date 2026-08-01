/**
 * Factory Alert System - Alert Overlay Dialog (Enhanced)
 * Modal dialog hiển thị cảnh báo đè lên toàn màn hình — thiết kế đẹp, nhiều thông tin hơn
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  Vibration,
  Platform,
  Image,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';

import { Alert, AlertSeverity } from '../types';
import { SEVERITY_CONFIG } from '../utils/constants';
import { formatRelativeTime, getSeverityLabel, getSeverityIcon } from '../utils/helpers';
import { useTheme, Theme } from '../context/ThemeContext';

// Severity gradient colors
const SEVERITY_GRADIENTS: Record<AlertSeverity, string[]> = {
  critical: ['#DC2626', '#991B1B'],
  high: ['#EA580C', '#C2410C'],
  medium: ['#F59E0B', '#D97706'],
  low: ['#3B82F6', '#2563EB'],
  info: ['#6366F1', '#4F46E5'],
};

interface AlertOverlayDialogProps {
  visible: boolean;
  alert: Alert | null;
  onAcknowledge: () => void;
  onDismiss: () => void;
  onClose: () => void;
  language?: 'vi' | 'en' | 'zh';
}

/**
 * Elapsed timer — hiển thị thời gian đã trôi qua kể từ khi alert xảy ra
 */
const ElapsedTimer: React.FC<{ timestamp: string; color: string }> = ({ timestamp, color }) => {
  const { theme } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme, screenWidth, screenHeight), [theme, screenWidth, screenHeight]);
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, Date.now() - new Date(timestamp).getTime());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setElapsed(
        h > 0
          ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
          : `${m}m ${String(s).padStart(2, '0')}s`
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timestamp]);

  return (
    <View style={[styles.timerBadge, { backgroundColor: color + '25' }]}>
      <Icon name="timer-outline" size={13} color={color} />
      <Text style={[styles.timerText, { color }]}>{elapsed}</Text>
    </View>
  );
};

const AlertOverlayDialog: React.FC<AlertOverlayDialogProps> = ({
  visible,
  alert,
  onAcknowledge,
  onDismiss,
  onClose,
  language = 'vi',
}) => {
  const { theme } = useTheme();
  // Wave 4A: live window dimensions so the dialog + fullscreen NG image re-size on rotation.
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme, screenWidth, screenHeight), [theme, screenWidth, screenHeight]);
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const headerGlowAnim = useRef(new Animated.Value(0)).current;
  const [selectedNgImage, setSelectedNgImage] = useState<string | null>(null);

  // Translations
  const t = useMemo(() => ({
    errorImage: language === 'vi' ? 'Hình ảnh lỗi' : language === 'zh' ? '错误图片' : 'Error Image',
    station: language === 'vi' ? 'Trạm' : language === 'zh' ? '工站' : 'Station',
    line: language === 'vi' ? 'Chuyền' : language === 'zh' ? '产线' : 'Line',
    area: language === 'vi' ? 'Khu vực' : language === 'zh' ? '区域' : 'Area',
    product: language === 'vi' ? 'Sản phẩm' : language === 'zh' ? '产品' : 'Product',
    serialNumber: 'S/N',
    model: language === 'vi' ? 'Model' : language === 'zh' ? '型号' : 'Model',
    customer: language === 'vi' ? 'Khách hàng' : language === 'zh' ? '客户' : 'Customer',
    machine: language === 'vi' ? 'Máy kiểm tra' : language === 'zh' ? '检测机' : 'Machine',
    inspectionId: language === 'vi' ? 'Mã kiểm tra' : language === 'zh' ? '检测ID' : 'Inspection ID',
    alertId: 'Alert ID',
    receivedAt: language === 'vi' ? 'Nhận lúc' : language === 'zh' ? '接收时间' : 'Received at',
    occurredAt: language === 'vi' ? 'Xảy ra lúc' : language === 'zh' ? '发生时间' : 'Occurred at',
    elapsedTime: language === 'vi' ? 'Đã trôi qua' : language === 'zh' ? '已过时间' : 'Elapsed',
    dismiss: language === 'vi' ? 'Bỏ qua' : language === 'zh' ? '忽略' : 'Dismiss',
    acknowledge: language === 'vi' ? 'XÁC NHẬN' : language === 'zh' ? '确认' : 'ACKNOWLEDGE',
    ngPoints: language === 'vi' ? 'Điểm NG' : language === 'zh' ? 'NG点' : 'NG Points',
    ngPointImage: language === 'vi' ? 'Ảnh điểm lỗi' : language === 'zh' ? 'NG点图片' : 'NG Point Image',
    noValue: 'N/A',
    more: language === 'vi' ? 'thêm' : language === 'zh' ? '更多' : 'more',
    closeImage: language === 'vi' ? 'Đóng ảnh' : language === 'zh' ? '关闭图片' : 'Close image',
  }), [language]);

  useEffect(() => {
    if (visible && alert) {
      // Reset animations
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
      slideAnim.setValue(30);
      headerGlowAnim.setValue(0);

      // Animate in — smooth spring + slide up
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

      // Glow animation for header
      Animated.loop(
        Animated.sequence([
          Animated.timing(headerGlowAnim, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(headerGlowAnim, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Pulse for critical/high
      if (alert.severity === 'critical' || alert.severity === 'high') {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.03,
              duration: 600,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 600,
              useNativeDriver: true,
            }),
          ])
        ).start();

        if (alert.severity === 'critical') {
          Vibration.vibrate([0, 500, 200, 500, 200, 500], true);
        }
      }
    } else {
      Animated.parallel([
        Animated.timing(scaleAnim, { toValue: 0.85, duration: 150, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 30, duration: 150, useNativeDriver: true }),
      ]).start();
      pulseAnim.setValue(1);
      headerGlowAnim.setValue(0);
      Vibration.cancel();
      setSelectedNgImage(null);
    }

    return () => { Vibration.cancel(); };
  }, [visible, alert]);

  if (!alert) return null;

  const severityConfig = SEVERITY_CONFIG[alert.severity];
  const severityLabel = getSeverityLabel(alert.severity, language);
  const severityIcon = getSeverityIcon(alert.severity);
  const gradient = SEVERITY_GRADIENTS[alert.severity];
  const hasImage = !!(alert.imageUrl || alert.error.imageUrl);

  // Format absolute time
  const formatAbsoluteTime = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} — ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.dialogContainer,
            {
              opacity: opacityAnim,
              transform: [
                { scale: scaleAnim },
                { scale: pulseAnim },
                { translateY: slideAnim },
              ],
            },
          ]}
        >
          {/* ═══════ GRADIENT HEADER ═══════ */}
          <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
            {/* Animated glow overlay */}
            <Animated.View style={[styles.headerGlow, { opacity: headerGlowAnim }]} />

            <View style={styles.headerTop}>
              <View style={styles.severityIconCircle}>
                <Icon name={severityIcon} size={32} color="#FFFFFF" />
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Icon name="close" size={22} color="rgba(255,255,255,0.9)" />
              </TouchableOpacity>
            </View>

            <Text style={styles.severityLabel}>{severityLabel}</Text>
            <Text style={styles.errorTypeHeader} numberOfLines={2}>{alert.error.type}</Text>

            <View style={styles.headerMeta}>
              <View style={styles.headerMetaChip}>
                <Icon name="clock-outline" size={12} color="rgba(255,255,255,0.85)" />
                <Text style={styles.headerMetaText}>{formatRelativeTime(alert.timestamp)}</Text>
              </View>
              <ElapsedTimer timestamp={alert.timestamp} color="#FFFFFF" />
              {alert.station.line && (
                <View style={styles.headerMetaChip}>
                  <Icon name="arrow-right-bold" size={12} color="rgba(255,255,255,0.85)" />
                  <Text style={styles.headerMetaText}>{alert.station.line}</Text>
                </View>
              )}
            </View>
          </LinearGradient>

          {/* ═══════ SCROLLABLE CONTENT ═══════ */}
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >

            {/* ── Error Image ── */}
            {hasImage && (
              <View style={styles.imageContainer}>
                <Image
                  source={{ uri: alert.imageUrl || alert.error.imageUrl }}
                  style={styles.errorImage}
                  resizeMode="contain"
                />
                <View style={styles.imageBadge}>
                  <Icon name="camera" size={11} color="#FFFFFF" />
                  <Text style={styles.imageBadgeText}>{t.errorImage}</Text>
                </View>
              </View>
            )}

            {/* ── Error description card ── */}
            {/* 3A: severity SURFACE colour (.bgColor) drives the accent border + badge tint
                + saturated icon/text. `.color` is the on-badge text colour and would make
                the border/badge invisible (white on white) or a black block. */}
            <View style={[styles.card, styles.errorCard, { borderLeftColor: severityConfig.bgColor }]}>
              <View style={styles.errorCodeRow}>
                <View style={[styles.errorCodeBadge, { backgroundColor: severityConfig.bgColor + '18' }]}>
                  <Icon name="code-tags" size={13} color={severityConfig.bgColor} />
                  <Text style={[styles.errorCode, { color: severityConfig.bgColor }]}>{alert.error.code}</Text>
                </View>
                {alert.inspectionId != null && (
                  <View style={styles.inspectionBadge}>
                    <Icon name="pound" size={12} color={theme.colors.textSecondary} />
                    <Text style={styles.inspectionText}>{t.inspectionId}: {alert.inspectionId}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.errorDescription}>{alert.error.description}</Text>
            </View>

            {/* ── Info Grid — Station + Product ── */}
            <View style={styles.infoGrid}>
              {/* Station */}
              <View style={[styles.infoGridCell, { flex: 1 }]}>
                <View style={[styles.infoIconCircle, { backgroundColor: '#3B82F620' }]}>
                  <Icon name="factory" size={18} color="#3B82F6" />
                </View>
                <Text style={styles.infoLabel}>{t.station}</Text>
                <Text style={styles.infoValue} numberOfLines={2}>{alert.station.name}</Text>
                <Text style={styles.infoSub}>{alert.station.id}</Text>
                {alert.station.area && (
                  <Text style={styles.infoSub}>{t.area}: {alert.station.area}</Text>
                )}
              </View>

              {/* Product */}
              <View style={[styles.infoGridCell, { flex: 1 }]}>
                <View style={[styles.infoIconCircle, { backgroundColor: '#8B5CF620' }]}>
                  <Icon name="cube-outline" size={18} color="#8B5CF6" />
                </View>
                <Text style={styles.infoLabel}>{t.product}</Text>
                <Text style={styles.infoValue} numberOfLines={2}>{alert.product.name}</Text>
                <Text style={styles.infoSub}>{alert.product.id}</Text>
                {alert.product.model && (
                  <Text style={styles.infoSub}>{t.model}: {alert.product.model}</Text>
                )}
              </View>
            </View>

            {/* ── Detail rows ── */}
            <View style={styles.card}>
              {/* Serial Number */}
              {alert.product.serialNumber && (
                <View style={styles.detailRow}>
                  <Icon name="barcode" size={18} color="#10B981" />
                  <Text style={styles.detailLabel}>{t.serialNumber}</Text>
                  <Text style={styles.detailValue}>{alert.product.serialNumber}</Text>
                </View>
              )}

              {/* Customer */}
              {alert.product.customer && (
                <View style={styles.detailRow}>
                  <Icon name="domain" size={18} color="#F59E0B" />
                  <Text style={styles.detailLabel}>{t.customer}</Text>
                  <Text style={styles.detailValue}>{alert.product.customer}</Text>
                </View>
              )}

              {/* Machine */}
              {alert.machine && (
                <View style={styles.detailRow}>
                  <Icon name="robot-industrial" size={18} color="#6366F1" />
                  <Text style={styles.detailLabel}>{t.machine}</Text>
                  <Text style={styles.detailValue}>{alert.machine.name}</Text>
                  <Text style={styles.detailSub}>{alert.machine.code}</Text>
                </View>
              )}

              {/* Timestamps */}
              <View style={styles.detailRow}>
                <Icon name="calendar-clock" size={18} color="#64748B" />
                <Text style={styles.detailLabel}>{t.occurredAt}</Text>
                <Text style={styles.detailValue}>{formatAbsoluteTime(alert.timestamp)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Icon name="cellphone-arrow-down" size={18} color="#64748B" />
                <Text style={styles.detailLabel}>{t.receivedAt}</Text>
                <Text style={styles.detailValue}>{formatAbsoluteTime(alert.receivedAt)}</Text>
              </View>

              {/* Alert ID */}
              <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
                <Icon name="identifier" size={18} color="#94A3B8" />
                <Text style={styles.detailLabel}>{t.alertId}</Text>
                <Text style={[styles.detailValue, styles.monoText]}>{alert.alertId}</Text>
              </View>
            </View>

            {/* ── NG Points ── */}
            {alert.ngPoints && alert.ngPoints.length > 0 && (
              <View style={styles.ngSection}>
                <View style={styles.ngSectionHeader}>
                  <View style={styles.ngTitleRow}>
                    <Icon name="alert-octagon" size={18} color={theme.colors.error} />
                    <Text style={styles.ngSectionTitle}>
                      {alert.totalNG || alert.ngPoints.length} {t.ngPoints}
                    </Text>
                  </View>
                  <View style={styles.ngCountBadge}>
                    <Text style={styles.ngCountText}>{alert.ngPoints.filter(p => p.result === 'NG').length} NG</Text>
                  </View>
                </View>

                {alert.ngPoints.slice(0, 5).map((point, index) => {
                  const isNG = point.result === 'NG';
                  return (
                    <View key={`ng-${point.pointId}-${index}`} style={styles.ngPointCard}>
                      <View style={styles.ngPointTop}>
                        <View style={[styles.ngResultDot, { backgroundColor: isNG ? theme.colors.error : theme.colors.success }]} />
                        <Text style={styles.ngPointName}>{point.pointName}</Text>
                        <View style={[styles.ngResultBadge, { backgroundColor: (isNG ? theme.colors.error : theme.colors.success) + '22' }]}>
                          <Text style={[styles.ngResultText, { color: isNG ? theme.colors.error : theme.colors.success }]}>
                            {point.result}
                          </Text>
                        </View>
                      </View>
                      {point.actualValue && (
                        <View style={styles.ngPointDetail}>
                          <Text style={styles.ngActualLabel}>
                            {language === 'vi' ? 'Giá trị:' : language === 'zh' ? '值:' : 'Value:'}
                          </Text>
                          <Text style={styles.ngActualValue}>{point.actualValue}</Text>
                        </View>
                      )}
                      {/* NG point image thumbnail */}
                      {point.imageUrl && (
                        <TouchableOpacity
                          style={styles.ngImageThumbnail}
                          onPress={() => setSelectedNgImage(point.imageUrl!)}
                          activeOpacity={0.7}
                        >
                          <Image source={{ uri: point.imageUrl }} style={styles.ngImageThumb} resizeMode="cover" />
                          <View style={styles.ngImageOverlay}>
                            <Icon name="magnify-plus-outline" size={16} color="#FFFFFF" />
                          </View>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}

                {alert.ngPoints.length > 5 && (
                  <Text style={styles.ngMoreText}>
                    +{alert.ngPoints.length - 5} {t.more}…
                  </Text>
                )}
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

            <LinearGradient
              colors={gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.acknowledgeGradient}
            >
              <TouchableOpacity
                style={styles.acknowledgeButton}
                onPress={onAcknowledge}
                activeOpacity={0.8}
              >
                <Icon name="check-bold" size={22} color="#FFFFFF" />
                <Text style={styles.acknowledgeButtonText}>{t.acknowledge}</Text>
              </TouchableOpacity>
            </LinearGradient>
          </View>
        </Animated.View>

        {/* ═══════ NG IMAGE FULLSCREEN VIEWER ═══════ */}
        {selectedNgImage && (
          <View style={styles.ngImageFullOverlay}>
            <TouchableOpacity style={styles.ngImageFullClose} onPress={() => setSelectedNgImage(null)}>
              <Icon name="close-circle" size={32} color="#FFFFFF" />
            </TouchableOpacity>
            <Image source={{ uri: selectedNgImage }} style={styles.ngImageFull} resizeMode="contain" />
            <Text style={styles.ngImageFullLabel}>{t.ngPointImage}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
};

const createStyles = (theme: Theme, SCREEN_WIDTH: number, SCREEN_HEIGHT: number) => StyleSheet.create({
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
    // 3C: theme-aware surface (was hardcoded light #F8FAFC — broke in dark mode).
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.xl,
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
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  severityIconCircle: {
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
  severityLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  errorTypeHeader: {
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
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  timerText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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

  /* ── Image ── */
  imageContainer: {
    marginBottom: 14,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceVariant,
  },
  errorImage: {
    width: '100%',
    height: 190,
  },
  imageBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  imageBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },

  /* ── Cards ── */
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    elevation: theme.elevation.sm,
  },
  errorCard: {
    borderLeftWidth: 4,
  },
  errorCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 8,
  },
  errorCodeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 5,
  },
  errorCode: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  inspectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  inspectionText: {
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  errorDescription: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 21,
  },

  /* ── Info Grid ── */
  infoGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  infoGridCell: {
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    elevation: theme.elevation.sm,
  },
  infoIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 2,
  },
  infoSub: {
    fontSize: 10,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },

  /* ── Detail Rows ── */
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: 10,
  },
  detailLabel: {
    fontSize: 11,
    color: theme.colors.textMuted,
    fontWeight: '600',
    width: 72,
  },
  detailValue: {
    fontSize: 13,
    color: theme.colors.text,
    fontWeight: '600',
    flex: 1,
  },
  detailSub: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginLeft: 4,
  },
  monoText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
  },

  /* ── NG Points ── */
  ngSection: {
    // 3C: theme-aware error tint (was hardcoded light #FEF2F2).
    backgroundColor: theme.colors.error + (theme.isDark ? '1F' : '12'),
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.error + '33',
  },
  ngSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  ngTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ngSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.error,
  },
  ngCountBadge: {
    backgroundColor: theme.colors.error,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  ngCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  ngPointCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.error + '22',
  },
  ngPointTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ngResultDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  ngPointName: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text,
    flex: 1,
  },
  ngResultBadge: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ngResultText: {
    fontSize: 11,
    fontWeight: '800',
  },
  ngPointDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginLeft: 16,
    gap: 4,
  },
  ngActualLabel: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  ngActualValue: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.error,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  ngImageThumbnail: {
    marginTop: 8,
    marginLeft: 16,
    width: 80,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceVariant,
  },
  ngImageThumb: {
    width: '100%',
    height: '100%',
  },
  ngImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ngMoreText: {
    fontSize: 12,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    fontStyle: 'italic',
  },

  /* ── NG Image Fullscreen ── */
  ngImageFullOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  ngImageFullClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 101,
  },
  ngImageFull: {
    width: SCREEN_WIDTH - 40,
    height: SCREEN_HEIGHT * 0.55,
  },
  ngImageFullLabel: {
    marginTop: 12,
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
  },

  /* ── Actions ── */
  actionsContainer: {
    flexDirection: 'row',
    padding: 14,
    gap: 10,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  dismissButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceVariant,
    gap: 6,
  },
  dismissButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  acknowledgeGradient: {
    flex: 1,
    borderRadius: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  acknowledgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    gap: 8,
  },
  acknowledgeButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});

export default AlertOverlayDialog;
