/**
 * Factory Alert System - Bulletin Detail Screen
 * Màn hình chi tiết bản tin định kỳ (Periodic Bulletin)
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  Image,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  useBulletinStore,
  selectBulletinById,
  useSettingsStore,
  selectLanguage,
  selectSettings,
} from '../store';
import {
  RootStackParamList,
  BulletinFailPoint,
  BulletinMachine,
  ImageLoadingState,
  InspectionImagesResponse,
} from '../types';
import { imageService } from '../services';
import { useTheme, Theme } from '../context/ThemeContext';
import { getYieldColor } from '../utils/helpers';
import { StateView } from '../components';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type BulletinDetailRouteProp = RouteProp<RootStackParamList, 'BulletinDetail'>;

const BulletinDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<BulletinDetailRouteProp>();
  const { bulletinId } = route.params;
  const language = useSettingsStore(selectLanguage);
  // 3C: this screen previously hardcoded hex and ignored the theme → broken in dark
  // mode. Convert to a createStyles(theme) factory (mirrors AlertDetailScreen).
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const bulletin = useBulletinStore(selectBulletinById(bulletinId));
  const markAsRead = useBulletinStore((state) => state.markAsRead);
  const settings = useSettingsStore(selectSettings);

  // On-demand image loading state per failPoint (keyed by latestInspectionId)
  const [fpImageStates, setFpImageStates] = useState<Record<number, ImageLoadingState>>({});
  const [fpImageData, setFpImageData] = useState<Record<number, InspectionImagesResponse>>({});
  const [fpImageErrors, setFpImageErrors] = useState<Record<number, string>>({});

  // Fullscreen image viewer
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  // Mark as read on mount
  React.useEffect(() => {
    if (bulletin && !bulletin.isRead) {
      markAsRead(bulletin.bulletinId);
    }
  }, [bulletin?.bulletinId]);

  // Set imageService base URL from settings
  React.useEffect(() => {
    if (settings?.app?.apiBaseUrl) {
      imageService.setBaseUrl(settings.app.apiBaseUrl);
      imageService.setApiKey(settings?.app?.apiKey || '');
    }
  }, [settings?.app?.apiBaseUrl, settings?.app?.apiKey]);

  /**
   * Load images on-demand for a specific fail point
   */
  const handleLoadFailPointImages = useCallback(async (inspectionId: number) => {
    if (!inspectionId || inspectionId <= 0) return;

    const apiBaseUrl = settings?.app?.apiBaseUrl;
    if (!apiBaseUrl || apiBaseUrl === 'http://localhost:3000') {
      setFpImageErrors(prev => ({
        ...prev,
        [inspectionId]: language === 'vi'
          ? 'Chưa cấu hình địa chỉ API Server. Vào Cài đặt để cập nhật.'
          : 'API Server URL not configured. Update in Settings.',
      }));
      setFpImageStates(prev => ({ ...prev, [inspectionId]: 'error' }));
      return;
    }

    setFpImageStates(prev => ({ ...prev, [inspectionId]: 'loading' }));
    setFpImageErrors(prev => ({ ...prev, [inspectionId]: '' }));

    try {
      const result = await imageService.fetchInspectionImages(inspectionId);
      setFpImageData(prev => ({ ...prev, [inspectionId]: result }));
      setFpImageStates(prev => ({ ...prev, [inspectionId]: 'loaded' }));
    } catch (error: any) {
      setFpImageErrors(prev => ({ ...prev, [inspectionId]: error.message || 'Lỗi tải ảnh' }));
      setFpImageStates(prev => ({ ...prev, [inspectionId]: 'error' }));
    }
  }, [settings?.app?.apiBaseUrl, language]);

  const t = useMemo(() => ({
    title: language === 'vi' ? 'Chi tiết bản tin' : 'Bulletin Detail',
    station: language === 'vi' ? 'Trạm' : 'Station',
    factory: language === 'vi' ? 'Nhà máy' : 'Factory',
    workshop: language === 'vi' ? 'Xưởng' : 'Workshop',
    line: language === 'vi' ? 'Chuyền' : 'Line',
    period: language === 'vi' ? 'Khoảng thời gian' : 'Period',
    interval: language === 'vi' ? 'Chu kỳ' : 'Interval',
    statistics: language === 'vi' ? 'Thống kê sản xuất' : 'Production Statistics',
    total: language === 'vi' ? 'Tổng' : 'Total',
    ok: 'OK',
    ng: 'NG',
    ntf: 'NTF',
    yield: 'Yield Rate',
    avgCycleTime: language === 'vi' ? 'Cycle Time TB' : 'Avg Cycle Time',
    failPoints: language === 'vi' ? 'Điểm lỗi hàng đầu' : 'Top Fail Points',
    machines: language === 'vi' ? 'Máy kiểm tra' : 'Machines',
    seconds: language === 'vi' ? 'giây' : 'sec',
    minutes: language === 'vi' ? 'phút' : 'min',
    bulletinId: language === 'vi' ? 'Mã bản tin' : 'Bulletin ID',
    receivedAt: language === 'vi' ? 'Thời gian nhận' : 'Received At',
    noData: language === 'vi' ? 'Không có dữ liệu' : 'No data',
    latestSerial: language === 'vi' ? 'SN gần nhất' : 'Latest SN',
    viewImages: language === 'vi' ? 'Xem ảnh lỗi' : 'View Error Images',
    loadingImages: language === 'vi' ? 'Đang tải ảnh...' : 'Loading images...',
    imageLoadError: language === 'vi' ? 'Lỗi tải ảnh' : 'Image load error',
    retryLoadImages: language === 'vi' ? 'Thử lại' : 'Retry',
    tapToViewImages: language === 'vi' ? 'Nhấn để tải ảnh từ server' : 'Tap to load images from server',
    imagesLoaded: language === 'vi' ? 'ảnh đã tải' : 'images loaded',
    closeImage: language === 'vi' ? 'Đóng' : 'Close',
    referenceImage: language === 'vi' ? 'Ảnh mẫu' : 'Reference',
    errorImage: language === 'vi' ? 'Ảnh lỗi' : 'Error',
    noReferenceImage: language === 'vi' ? 'Không có ảnh mẫu' : 'No reference',
    noErrorImage: language === 'vi' ? 'Không có ảnh lỗi' : 'No error image',
  }), [language]);

  if (!bulletin) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar
          barStyle={theme.isDark ? 'light-content' : 'dark-content'}
          backgroundColor={theme.colors.background}
        />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="arrow-left" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t.title}</Text>
          <View style={{ width: 40 }} />
        </View>
        {/* 3G: shared empty StateView */}
        <StateView variant="empty" icon="file-document-outline" title={t.noData} iconColor={theme.colors.textMuted} />
      </SafeAreaView>
    );
  }

  const { statistics, period, failPoints, machines } = bulletin;

  // 3C: shared 5-tier helper so the card and this screen agree.
  const yieldColor = getYieldColor(statistics.yieldRate);

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatTimeShort = (iso: string) => {
    return new Date(iso).toLocaleTimeString(language === 'vi' ? 'vi-VN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderFailPointImageSection = (fp: BulletinFailPoint) => {
    if (!fp.imageUrl && !fp.latestInspectionId) return null;

    const inspId = fp.latestInspectionId;
    const state = fpImageStates[inspId] || 'idle';
    const images = fpImageData[inspId];
    const error = fpImageErrors[inspId];

    switch (state) {
      case 'idle':
        return (
          <TouchableOpacity
            style={styles.fpImageButton}
            onPress={() => handleLoadFailPointImages(inspId)}
            activeOpacity={0.7}
          >
            <Icon name="camera-outline" size={16} color={theme.colors.primary} />
            <Text style={styles.fpImageButtonText}>{t.viewImages}</Text>
            <Icon name="chevron-right" size={14} color={theme.colors.textMuted} />
          </TouchableOpacity>
        );

      case 'loading':
        // 3G: shared skeleton StateView (native-driver opacity pulse)
        return <StateView variant="loading" fill={false} title={t.loadingImages} />;

      case 'error':
        return (
          <View style={styles.fpImageError}>
            <Icon name="alert-circle-outline" size={16} color={theme.colors.error} />
            <Text style={styles.fpImageErrorText} numberOfLines={2}>{error}</Text>
            <TouchableOpacity
              onPress={() => handleLoadFailPointImages(inspId)}
              style={styles.fpImageRetryBtn}
            >
              <Text style={styles.fpImageRetryText}>{t.retryLoadImages}</Text>
            </TouchableOpacity>
          </View>
        );

      case 'loaded':
        if (!images || images.pointsWithImages.length === 0) {
          return (
            <View style={styles.fpImageEmpty}>
              <Icon name="image-off-outline" size={16} color={theme.colors.textMuted} />
              <Text style={styles.fpImageEmptyText}>
                {language === 'vi' ? 'Không có ảnh' : 'No images'}
              </Text>
            </View>
          );
        }
        return (
          <View style={styles.fpImagesContainer}>
            <View style={styles.fpImagesSummary}>
              <Icon name="check-circle" size={14} color={theme.colors.success} />
              <Text style={styles.fpImagesSummaryText}>
                {images.pointsWithImages.length} {t.imagesLoaded}
              </Text>
              {images.serialNumber && (
                <Text style={styles.fpImagesSN}>SN: {images.serialNumber}</Text>
              )}
            </View>
            {images.pointsWithImages.map((img, imgIdx) => (
              <TouchableOpacity
                key={`img-${inspId}-${imgIdx}`}
                onPress={() => setFullscreenImage(img.imageUrl)}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: img.imageUrl }}
                  style={styles.fpLoadedImage}
                  resizeMode="cover"
                />
                <View style={styles.fpImageLabel}>
                  <Text style={styles.fpImageLabelText} numberOfLines={1}>
                    {img.pointName} ({img.pointCode})
                  </Text>
                  <Text style={[
                    styles.fpImageResultBadge,
                    { color: img.result === 'NG' ? theme.colors.error : theme.colors.success },
                  ]}>
                    {img.result}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        );

      default:
        return null;
    }
  };

  const renderFailPoint = (fp: BulletinFailPoint, index: number) => (
    <View key={fp.pointId} style={styles.failPointItem}>
      <View style={styles.failPointRank}>
        <Text style={styles.failPointRankText}>#{index + 1}</Text>
      </View>
      <View style={styles.failPointContent}>
        <View style={styles.failPointHeader}>
          <Text style={styles.failPointName} numberOfLines={1}>{fp.pointName}</Text>
          <Text style={styles.failPointCode}>{fp.pointCode}</Text>
        </View>
        <View style={styles.failPointStats}>
          <Text style={styles.failPointNg}>
            NG: <Text style={{ fontWeight: '700', color: theme.colors.error }}>{fp.ngCount}</Text>
          </Text>
          <Text style={styles.failPointPercent}>
            {fp.percentage}%
          </Text>
        </View>
        {/* Progress bar */}
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${Math.min(fp.percentage, 100)}%` }]} />
        </View>
        <Text style={styles.failPointSerial}>
          {t.latestSerial}: {fp.latestSerialNumber}
        </Text>
        {/* Reference vs Error Image Comparison */}
        {(fp.referenceImageUrl || fp.imageUrl) && settings?.app?.apiBaseUrl && settings.app.apiBaseUrl !== 'http://localhost:3000' && (
          <View style={styles.imageComparisonContainer}>
            <View style={styles.imageComparisonRow}>
              {/* Reference Image */}
              <View style={styles.comparisonImageWrapper}>
                <View style={styles.comparisonRefLabelRow}>
                  <Icon name="image-check-outline" size={12} color={theme.colors.success} />
                  <Text style={styles.comparisonRefLabelText}>{t.referenceImage}</Text>
                </View>
                {fp.referenceImageUrl ? (
                  <TouchableOpacity
                    onPress={() => setFullscreenImage(`${settings.app.apiBaseUrl}${fp.referenceImageUrl}`)}
                    activeOpacity={0.8}
                  >
                    <Image
                      source={{ uri: `${settings.app.apiBaseUrl}${fp.referenceImageUrl}` }}
                      style={styles.comparisonImage}
                      resizeMode="cover"
                    />
                    <View style={styles.comparisonImageOverlay}>
                      <Icon name="magnify-plus-outline" size={14} color="#FFFFFF" />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.comparisonPlaceholder}>
                    <Icon name="image-off-outline" size={20} color={theme.colors.textMuted} />
                    <Text style={styles.comparisonPlaceholderText}>{t.noReferenceImage}</Text>
                  </View>
                )}
              </View>

              {/* Error Image */}
              <View style={styles.comparisonImageWrapper}>
                <View style={styles.comparisonErrLabelRow}>
                  <Icon name="image-broken-variant" size={12} color={theme.colors.error} />
                  <Text style={styles.comparisonErrLabelText}>{t.errorImage}</Text>
                </View>
                {fp.imageUrl ? (
                  <TouchableOpacity
                    onPress={() => setFullscreenImage(`${settings.app.apiBaseUrl}${fp.imageUrl}`)}
                    activeOpacity={0.8}
                  >
                    <Image
                      source={{ uri: `${settings.app.apiBaseUrl}${fp.imageUrl}` }}
                      style={styles.comparisonImage}
                      resizeMode="cover"
                    />
                    <View style={styles.comparisonImageOverlay}>
                      <Icon name="magnify-plus-outline" size={14} color="#FFFFFF" />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.comparisonPlaceholder}>
                    <Icon name="image-off-outline" size={20} color={theme.colors.textMuted} />
                    <Text style={styles.comparisonPlaceholderText}>{t.noErrorImage}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}
        {/* On-demand image loading */}
        {renderFailPointImageSection(fp)}
      </View>
    </View>
  );

  const renderMachine = (machine: BulletinMachine) => {
    const machineNgRate = machine.totalCount > 0
      ? ((machine.ngCount / machine.totalCount) * 100).toFixed(1)
      : '0';
    return (
      <View key={machine.machineId} style={styles.machineItem}>
        <View style={styles.machineIcon}>
          <Icon name="robot-industrial" size={20} color={theme.colors.primary} />
        </View>
        <View style={styles.machineContent}>
          <Text style={styles.machineName}>{machine.machineName}</Text>
          <Text style={styles.machineCode}>{machine.machineCode}</Text>
        </View>
        <View style={styles.machineStats}>
          <Text style={styles.machineTotal}>{machine.totalCount}</Text>
          <Text style={styles.machineNg}>
            NG: {machine.ngCount} ({machineNgRate}%)
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
      />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-left" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Bulletin ID & Timestamp */}
        <View style={styles.section}>
          <View style={styles.bulletinIdRow}>
            <View style={styles.bulletinBadge}>
              <Icon name="chart-bar" size={14} color="#FFFFFF" />
              <Text style={styles.bulletinBadgeText}>PERIODIC BULLETIN</Text>
            </View>
          </View>
          <Text style={styles.bulletinIdText}>{bulletin.bulletinId}</Text>
          <Text style={styles.timestampText}>
            {t.receivedAt}: {formatTime(bulletin.timestamp)}
          </Text>
        </View>

        {/* Station Info */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Icon name="factory" size={20} color={theme.colors.primary} />
            <Text style={styles.sectionTitle}>{t.station}</Text>
          </View>
          <View style={styles.infoGrid}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>{t.station}</Text>
              <Text style={styles.infoValue}>{bulletin.stationName}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>{t.factory}</Text>
              <Text style={styles.infoValue}>{bulletin.factoryName}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>{t.workshop}</Text>
              <Text style={styles.infoValue}>{bulletin.workshopName}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>{t.line}</Text>
              <Text style={styles.infoValue}>{bulletin.lineName}</Text>
            </View>
          </View>
        </View>

        {/* Period */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Icon name="clock-outline" size={20} color={theme.colors.primary} />
            <Text style={styles.sectionTitle}>{t.period}</Text>
          </View>
          <View style={styles.periodCard}>
            <Text style={styles.periodTime}>
              {formatTimeShort(period.start)} → {formatTimeShort(period.end)}
            </Text>
            <Text style={styles.periodInterval}>
              {t.interval}: {period.intervalMinutes} {t.minutes}
            </Text>
          </View>
        </View>

        {/* Statistics */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Icon name="chart-box" size={20} color={theme.colors.primary} />
            <Text style={styles.sectionTitle}>{t.statistics}</Text>
          </View>

          {/* Main stats grid */}
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statCardValue}>{statistics.totalCount}</Text>
              <Text style={styles.statCardLabel}>{t.total}</Text>
            </View>
            <View style={[styles.statCard, { borderColor: theme.colors.success }]}>
              <Text style={[styles.statCardValue, { color: theme.colors.success }]}>
                {statistics.okCount}
              </Text>
              <Text style={styles.statCardLabel}>{t.ok}</Text>
            </View>
            <View style={[styles.statCard, { borderColor: theme.colors.error }]}>
              <Text style={[styles.statCardValue, { color: theme.colors.error }]}>
                {statistics.ngCount}
              </Text>
              <Text style={styles.statCardLabel}>{t.ng}</Text>
            </View>
            <View style={[styles.statCard, { borderColor: theme.colors.warning }]}>
              <Text style={[styles.statCardValue, { color: theme.colors.warning }]}>
                {statistics.ntfCount}
              </Text>
              <Text style={styles.statCardLabel}>{t.ntf}</Text>
            </View>
          </View>

          {/* Yield & Cycle Time */}
          <View style={styles.yieldRow}>
            <View style={styles.yieldCard}>
              <Text style={styles.yieldLabel}>{t.yield}</Text>
              <Text style={[styles.yieldValue, { color: yieldColor }]}>
                {statistics.yieldRate}%
              </Text>
            </View>
            <View style={styles.yieldCard}>
              <Text style={styles.yieldLabel}>{t.avgCycleTime}</Text>
              <Text style={styles.cycleTimeValue}>
                {statistics.avgCycleTime} {t.seconds}
              </Text>
            </View>
          </View>
        </View>

        {/* Fail Points */}
        {failPoints.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Icon name="alert-circle" size={20} color={theme.colors.error} />
              <Text style={styles.sectionTitle}>
                {t.failPoints} ({failPoints.length})
              </Text>
            </View>
            {failPoints.map((fp, index) => renderFailPoint(fp, index))}
          </View>
        )}

        {/* Machines */}
        {machines.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Icon name="robot-industrial" size={20} color={theme.colors.primary} />
              <Text style={styles.sectionTitle}>
                {t.machines} ({machines.length})
              </Text>
            </View>
            {machines.map((machine) => renderMachine(machine))}
          </View>
        )}

        {/* Bottom spacing */}
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Fullscreen Image Viewer */}
      <Modal
        visible={!!fullscreenImage}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreenImage(null)}
      >
        <View style={styles.fullscreenOverlay}>
          <TouchableOpacity
            style={styles.fullscreenClose}
            onPress={() => setFullscreenImage(null)}
          >
            <Icon name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          {fullscreenImage && (
            <Image
              source={{ uri: fullscreenImage }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  scrollView: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.textMuted,
    marginTop: 12,
  },
  section: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: theme.borderRadius.lg,
    padding: 16,
    // Wave 3B: hairline border + low elevation token (was a blurred shadow).
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    elevation: theme.elevation.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  bulletinIdRow: {
    marginBottom: 8,
  },
  bulletinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
    alignSelf: 'flex-start',
  },
  bulletinBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bulletinIdText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    fontFamily: 'monospace',
  },
  timestampText: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 4,
  },
  infoGrid: {
    gap: 8,
  },
  infoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: 13,
    color: theme.colors.textMuted,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
    marginLeft: 16,
  },
  periodCard: {
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  periodTime: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 4,
  },
  periodInterval: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    minWidth: '22%',
    backgroundColor: theme.colors.background,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statCardValue: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.colors.text,
  },
  statCardLabel: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
    fontWeight: '600',
  },
  yieldRow: {
    flexDirection: 'row',
    gap: 8,
  },
  yieldCard: {
    flex: 1,
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  yieldLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 4,
    fontWeight: '500',
  },
  yieldValue: {
    fontSize: 28,
    fontWeight: '800',
  },
  cycleTimeValue: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  failPointItem: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceVariant,
  },
  failPointRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.error + '22',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  failPointRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.error,
  },
  failPointContent: {
    flex: 1,
  },
  failPointHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  failPointName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    flex: 1,
    marginRight: 8,
  },
  failPointCode: {
    fontSize: 11,
    color: theme.colors.textMuted,
    fontFamily: 'monospace',
    backgroundColor: theme.colors.surfaceVariant,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  failPointStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 6,
  },
  failPointNg: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  failPointPercent: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.error,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    marginBottom: 4,
  },
  progressBarFill: {
    height: 4,
    backgroundColor: theme.colors.error,
    borderRadius: 2,
  },
  failPointSerial: {
    fontSize: 11,
    color: theme.colors.textMuted,
    fontFamily: 'monospace',
  },
  fpImageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.primary + '12',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary + '55',
    borderStyle: 'dashed',
  },
  fpImageButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.primary,
    flex: 1,
  },
  fpImageLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.background,
    borderRadius: 8,
  },
  fpImageLoadingText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  fpImageError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.error + '12',
    borderRadius: 8,
    flexWrap: 'wrap',
  },
  fpImageErrorText: {
    fontSize: 12,
    color: theme.colors.error,
    flex: 1,
  },
  fpImageRetryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: theme.colors.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  fpImageRetryText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.error,
  },
  fpImageEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.background,
    borderRadius: 8,
  },
  fpImageEmptyText: {
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  fpImagesContainer: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.success + '12',
    overflow: 'hidden',
  },
  fpImagesSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.colors.success + '22',
  },
  fpImagesSummaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.success,
  },
  fpImagesSN: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: 'monospace',
    marginLeft: 'auto',
  },
  fpLoadedImage: {
    width: '100%',
    height: 140,
    backgroundColor: theme.colors.surfaceVariant,
  },
  fpImageLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  fpImageLabelText: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    flex: 1,
    marginRight: 8,
  },
  fpImageResultBadge: {
    fontSize: 11,
    fontWeight: '700',
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenClose: {
    position: 'absolute',
    top: 48,
    right: 20,
    zIndex: 10,
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
  },
  fullscreenImage: {
    width: '92%',
    height: '75%',
  },
  machineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceVariant,
  },
  machineIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primary + '12',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  machineContent: {
    flex: 1,
  },
  machineName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  machineCode: {
    fontSize: 12,
    color: theme.colors.textMuted,
    fontFamily: 'monospace',
  },
  machineStats: {
    alignItems: 'flex-end',
  },
  machineTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  machineNg: {
    fontSize: 12,
    color: theme.colors.error,
    fontWeight: '500',
  },
  // Image Comparison styles (side-by-side)
  imageComparisonContainer: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 8,
  },
  imageComparisonRow: {
    flexDirection: 'row',
    gap: 6,
  },
  comparisonImageWrapper: {
    flex: 1,
  },
  comparisonRefLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#22C55E15',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 3,
    alignSelf: 'flex-start',
  },
  comparisonRefLabelText: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.colors.success,
    marginLeft: 3,
  },
  comparisonErrLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EF444415',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 3,
    alignSelf: 'flex-start',
  },
  comparisonErrLabelText: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.colors.error,
    marginLeft: 3,
  },
  comparisonImage: {
    width: '100%',
    height: 100,
    borderRadius: 6,
    backgroundColor: theme.colors.surfaceVariant,
  },
  comparisonImageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderTopLeftRadius: 6,
    borderBottomRightRadius: 6,
    padding: 3,
  },
  comparisonPlaceholder: {
    height: 100,
    borderRadius: 6,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
  },
  comparisonPlaceholderText: {
    fontSize: 10,
    color: theme.colors.textMuted,
    marginTop: 3,
    textAlign: 'center',
  },
});

export default BulletinDetailScreen;
