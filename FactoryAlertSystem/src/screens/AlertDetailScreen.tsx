/**
 * Factory Alert System - Alert Detail Screen
 * Màn hình chi tiết thông tin alert
 */

import React, { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Share,
  Alert as RNAlert,
  Image,
  Modal,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { SeverityBadge, AckCommentDialog, StateView } from '../components';
import {
  useAlertStore,
  selectAlertById,
  useSettingsStore,
  selectLanguage,
} from '../store';
import { RootStackParamList, ImageLoadingState, InspectionImagesResponse } from '../types';
import { TRANSLATIONS } from '../utils/constants';
import {
  formatDateTime,
  formatRelativeTime,
  getStatusColor,
  getStatusLabel,
} from '../utils/helpers';
import { imageService, nguonAnh } from '../services';
import { authService } from '../services/authService';
import { useTheme, Theme } from '../context/ThemeContext';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AlertDetail'>;
type AlertDetailRouteProp = RouteProp<RootStackParamList, 'AlertDetail'>;

const AlertDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<AlertDetailRouteProp>();
  const { alertId } = route.params;

  const { theme } = useTheme();
  const language = useSettingsStore(selectLanguage);
  const apiBaseUrl = useSettingsStore((state) => state.settings.app.apiBaseUrl);
  const hasValidApi = apiBaseUrl && apiBaseUrl !== 'http://localhost:3000';
  const t = TRANSLATIONS[language];
  // Wave 4A: live window dimensions so the fullscreen image viewer re-sizes on rotation.
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme, screenWidth, screenHeight), [theme, screenWidth, screenHeight]);

  // Image viewer state
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState<string>('');

  // On-demand image loading state
  const [imageLoadingState, setImageLoadingState] = useState<ImageLoadingState>('idle');
  const [inspectionImages, setInspectionImages] = useState<InspectionImagesResponse | null>(null);
  const [imageLoadError, setImageLoadError] = useState<string>('');

  // Handler to open image viewer
  const openImageViewer = (url: string) => {
    setCurrentImageUrl(url);
    setImageViewerVisible(true);
  };

  // Get alert from store
  const alert = useAlertStore(selectAlertById(alertId));
  const acknowledgeAlert = useAlertStore((state) => state.acknowledgeAlert);
  const resolveAlert = useAlertStore((state) => state.resolveAlert);
  const removeAlert = useAlertStore((state) => state.removeAlert);

  // Handler to load images on-demand via REST API
  const handleLoadImages = useCallback(async () => {
    if (!alert?.inspectionId) {
      setImageLoadError(
        language === 'vi' 
          ? 'Không có Inspection ID để tải ảnh' 
          : 'No Inspection ID to load images'
      );
      setImageLoadingState('error');
      return;
    }

    // Set base URL from settings
    const apiBaseUrl = useSettingsStore.getState().settings.app.apiBaseUrl;
    if (!apiBaseUrl || apiBaseUrl === 'http://localhost:3000') {
      setImageLoadError(t.imageNotConfigured);
      setImageLoadingState('error');
      return;
    }
    imageService.setBaseUrl(apiBaseUrl);
    imageService.setApiKey(useSettingsStore.getState().settings.app.apiKey || '');

    setImageLoadingState('loading');
    setImageLoadError('');

    try {
      const result = await imageService.fetchInspectionImages(alert.inspectionId);
      setInspectionImages(result);
      setImageLoadingState('loaded');
    } catch (error: any) {
      console.error('[AlertDetail] Image load error:', error);
      setImageLoadError(error.message || t.imageLoadError);
      setImageLoadingState('error');
    }
  }, [alert?.inspectionId, language, t]);

  // MB6: ack-comment dialog state
  const [ackDialogVisible, setAckDialogVisible] = useState(false);
  // MB5: client-side role gate (viewer = read-only, parity with web protectedProcedure)
  const canAck = authService.canAcknowledgeAlerts();
  const canResolve = authService.canResolveAlerts();

  // Handlers
  const handleAcknowledge = useCallback(() => {
    if (!alert) return;
    if (!canAck) {
      RNAlert.alert(t.appName, t.readOnlyRole);
      return;
    }
    // MB6: open the comment dialog (quick-reason chips + free text)
    setAckDialogVisible(true);
  }, [alert, canAck, t]);

  const handleAckConfirm = useCallback((comment?: string) => {
    setAckDialogVisible(false);
    if (alert) {
      acknowledgeAlert(alert.id, comment);
    }
  }, [alert, acknowledgeAlert]);

  const handleResolve = useCallback(() => {
    if (!alert) return;
    if (!canResolve) {
      RNAlert.alert(t.appName, t.readOnlyRole);
      return;
    }
    resolveAlert(alert.id);
    navigation.goBack();
  }, [alert, canResolve, resolveAlert, navigation, t]);

  const handleDismiss = useCallback(() => {
    RNAlert.alert(
      language === 'vi' ? 'Xác nhận' : 'Confirm',
      language === 'vi'
        ? 'Bạn có chắc muốn xóa cảnh báo này?'
        : 'Are you sure you want to dismiss this alert?',
      [
        {
          text: t.cancel,
          style: 'cancel',
        },
        {
          text: t.yes,
          style: 'destructive',
          onPress: () => {
            if (alert) {
              removeAlert(alert.id);
              navigation.goBack();
            }
          },
        },
      ]
    );
  }, [alert, removeAlert, navigation, language, t]);

  const handleShare = useCallback(async () => {
    if (!alert) return;

    const isNgRate = alert.alertType === 'NG_RATE_THRESHOLD' && alert.ngRate;

    const baseInfo = `
🚨 ${alert.error.type}

📍 Trạm: ${alert.station.name}
📦 Sản phẩm: ${alert.product.name}
🔴 Mức độ: ${alert.severity.toUpperCase()}
📅 Thời gian: ${formatDateTime(alert.timestamp, language)}

📝 Mô tả: ${alert.error.description}
    `.trim();

    const ngRateInfo = isNgRate ? `

📊 NG Rate: ${alert.ngRate!.current.toFixed(2)}% / Ngưỡng: ${alert.ngRate!.threshold.toFixed(2)}%
🔢 Tổng kiểm tra: ${alert.ngRate!.totalInspections} | NG: ${alert.ngRate!.ngCount}${alert.measurementPoint ? `\n📐 Điểm đo: ${alert.measurementPoint.name} (${alert.measurementPoint.code})` : ''}${alert.productModel ? `\n📦 Model: ${alert.productModel.name}` : ''}` : '';

    const footer = `

Mã lỗi: ${alert.error.code}
Alert ID: ${alert.alertId}`;

    const message = baseInfo + ngRateInfo + footer;

    try {
      await Share.share({
        message,
        title: `Alert: ${alert.error.type}`,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  }, [alert, language]);

  // If alert not found
  if (!alert) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Icon name="arrow-left" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t.alertDetail}</Text>
          <View style={{ width: 24 }} />
        </View>
        <StateView
          variant="error"
          icon="alert-circle-outline"
          iconColor={theme.colors.textMuted}
          title={language === 'vi' ? 'Không tìm thấy cảnh báo' : language === 'zh' ? '未找到警报' : 'Alert not found'}
        />
      </SafeAreaView>
    );
  }

  const statusColor = getStatusColor(alert.status);
  const statusLabel = getStatusLabel(alert.status, language);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Icon name="arrow-left" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.alertDetail}</Text>
        <TouchableOpacity onPress={handleShare} style={styles.headerButton}>
          <Icon name="share-variant" size={24} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Severity & Status Banner */}
        <View style={styles.banner}>
          <SeverityBadge severity={alert.severity} size="large" />
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {/* MB6: escalated badge */}
          {alert.escalated && (
            <View style={[styles.statusBadge, { backgroundColor: `${theme.colors.error}20` }]}>
              <Icon name="arrow-up-bold-circle" size={14} color={theme.colors.error} />
              <Text style={[styles.statusText, { color: theme.colors.error }]}>{t.escalated}</Text>
            </View>
          )}
        </View>

        {/* Alert ID & Time */}
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>{t.alertId}</Text>
            <Text style={styles.valueMonospace}>{alert.alertId}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.timestamp}</Text>
            <View style={styles.timeContainer}>
              <Text style={styles.value}>{formatDateTime(alert.timestamp, language)}</Text>
              <Text style={styles.relativeTime}>
                ({formatRelativeTime(alert.timestamp, language)})
              </Text>
            </View>
          </View>
        </View>

        {/* Error Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.error}</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Icon name="code-tags" size={20} color={theme.colors.primary} />
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t.errorCode}</Text>
                <Text style={styles.cardValueMonospace}>{alert.error.code}</Text>
              </View>
            </View>
            <View style={styles.cardRow}>
              <Icon name="alert-circle-outline" size={20} color={theme.colors.primary} />
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t.errorType}</Text>
                <Text style={styles.cardValue}>{alert.error.type}</Text>
              </View>
            </View>
            <View style={styles.cardRow}>
              <Icon name="text-box-outline" size={20} color={theme.colors.primary} />
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t.description}</Text>
                <Text style={styles.cardValueDescription}>{alert.error.description}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* On-Demand Image Loading Section */}
        {alert.inspectionId && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.inspectionImages}</Text>
            
            {/* Idle state - show "Xem ảnh" button */}
            {imageLoadingState === 'idle' && (
              <TouchableOpacity
                style={styles.loadImagesButton}
                onPress={handleLoadImages}
                activeOpacity={0.7}
              >
                <View style={styles.loadImagesContent}>
                  <Icon name="image-multiple-outline" size={32} color={theme.colors.primary} />
                  <Text style={styles.loadImagesTitle}>{t.viewImages}</Text>
                  <Text style={styles.loadImagesHint}>{t.tapToViewImages}</Text>
                </View>
                <Icon name="chevron-right" size={24} color={theme.colors.textMuted} />
              </TouchableOpacity>
            )}

            {/* Loading state (3G: shared skeleton StateView) */}
            {imageLoadingState === 'loading' && (
              <StateView variant="loading" fill={false} title={t.loadingImages} />
            )}

            {/* Error state */}
            {imageLoadingState === 'error' && (
              <View style={styles.loadImagesError}>
                <Icon name="alert-circle-outline" size={32} color={theme.colors.error} />
                <Text style={styles.loadImagesErrorText}>{imageLoadError}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={handleLoadImages}
                  activeOpacity={0.7}
                >
                  <Icon name="reload" size={18} color={theme.colors.primary} />
                  <Text style={styles.retryButtonText}>{t.retryLoadImages}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Loaded state - display images gallery */}
            {imageLoadingState === 'loaded' && inspectionImages && (
              <View>
                {/* Summary info */}
                <View style={styles.imagesSummary}>
                  <View style={styles.imagesSummaryRow}>
                    <Icon name="barcode" size={16} color={theme.colors.textSecondary} />
                    <Text style={styles.imagesSummaryText}>
                      SN: {inspectionImages.serialNumber}
                    </Text>
                  </View>
                  <View style={styles.imagesSummaryRow}>
                    <Icon name="image-multiple" size={16} color={theme.colors.primary} />
                    <Text style={styles.imagesSummaryText}>
                      {inspectionImages.pointsWithImages.length} {t.imageCount}
                    </Text>
                  </View>
                </View>

                {/* Image cards */}
                {inspectionImages.pointsWithImages.length === 0 ? (
                  <View style={styles.noImagesContainer}>
                    <Icon name="image-off-outline" size={40} color={theme.colors.textMuted} />
                    <Text style={styles.noImagesText}>{t.noImages}</Text>
                  </View>
                ) : (
                  inspectionImages.pointsWithImages.map((point, index) => (
                    <View key={`img-${point.pointDefId}-${index}`} style={styles.inspectionImageCard}>
                      <View style={styles.inspectionImageHeader}>
                        <View style={styles.inspectionImageInfo}>
                          <Icon name="crosshairs" size={16} color={theme.colors.primary} />
                          <Text style={styles.inspectionImageName}>
                            {point.pointName} ({point.pointCode})
                          </Text>
                        </View>
                        <View style={[
                          styles.ngResultBadge,
                          { backgroundColor: point.result === 'NG' ? theme.colors.error : theme.colors.success }
                        ]}>
                          <Text style={styles.ngResultText}>{point.result}</Text>
                        </View>
                      </View>
                      {point.measuredValue && (
                        <View style={styles.inspectionImageDetail}>
                          <Text style={styles.ngPointLabel}>{t.measuredValue}:</Text>
                          <Text style={styles.ngPointValue}>{point.measuredValue}</Text>
                        </View>
                      )}
                      <TouchableOpacity
                        style={styles.inspectionImageContainer}
                        onPress={() => openImageViewer(point.imageUrl)}
                        activeOpacity={0.8}
                      >
                        <Image
                          source={nguonAnh(point.imageUrl)}
                          style={styles.inspectionImage}
                          resizeMode="cover"
                        />
                        <View style={styles.ngPointImageOverlay}>
                          <Icon name="magnify-plus-outline" size={20} color="#FFFFFF" />
                        </View>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
        )}

        {/* Station Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.station}</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Icon name="identifier" size={20} color={theme.colors.info} />
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t.stationId}</Text>
                <Text style={styles.cardValueMonospace}>{alert.station.id}</Text>
              </View>
            </View>
            <View style={styles.cardRow}>
              <Icon name="factory" size={20} color={theme.colors.info} />
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t.stationName}</Text>
                <Text style={styles.cardValue}>{alert.station.name}</Text>
              </View>
            </View>
            <View style={styles.cardRow}>
              <Icon name="transit-connection-horizontal" size={20} color={theme.colors.info} />
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t.line}</Text>
                <Text style={styles.cardValue}>{alert.station.line}</Text>
              </View>
            </View>
            {alert.station.area && (
              <View style={styles.cardRow}>
                <Icon name="map-marker" size={20} color={theme.colors.info} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>Area</Text>
                  <Text style={styles.cardValue}>{alert.station.area}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Product Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.product}</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Icon name="identifier" size={20} color={theme.colors.warning} />
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t.productId}</Text>
                <Text style={styles.cardValueMonospace}>{alert.product.id}</Text>
              </View>
            </View>
            <View style={styles.cardRow}>
              <Icon name="package-variant" size={20} color={theme.colors.warning} />
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t.productName}</Text>
                <Text style={styles.cardValue}>{alert.product.name}</Text>
              </View>
            </View>
            {alert.product.serialNumber && (
              <View style={styles.cardRow}>
                <Icon name="barcode" size={20} color={theme.colors.warning} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>Serial Number</Text>
                  <Text style={styles.cardValueMonospace}>{alert.product.serialNumber}</Text>
                </View>
              </View>
            )}
            {alert.product.model && (
              <View style={styles.cardRow}>
                <Icon name="cube-outline" size={20} color={theme.colors.warning} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>Model</Text>
                  <Text style={styles.cardValue}>{alert.product.model}</Text>
                </View>
              </View>
            )}
            {alert.product.customer && (
              <View style={styles.cardRow}>
                <Icon name="domain" size={20} color={theme.colors.warning} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>Customer</Text>
                  <Text style={styles.cardValue}>{alert.product.customer}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Machine Information */}
        {alert.machine && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {language === 'vi' ? 'Thông tin máy' : 'Machine Info'}
            </Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Icon name="robot-industrial" size={20} color={theme.colors.success} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>
                    {language === 'vi' ? 'Tên máy' : 'Machine Name'}
                  </Text>
                  <Text style={styles.cardValue}>{alert.machine.name}</Text>
                </View>
              </View>
              <View style={styles.cardRow}>
                <Icon name="qrcode" size={20} color={theme.colors.success} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>
                    {language === 'vi' ? 'Mã máy' : 'Machine Code'}
                  </Text>
                  <Text style={styles.cardValueMonospace}>{alert.machine.code}</Text>
                </View>
              </View>
              {alert.inspectionId && (
                <View style={styles.cardRow}>
                  <Icon name="file-document-outline" size={20} color={theme.colors.success} />
                  <View style={styles.cardContent}>
                    <Text style={styles.cardLabel}>Inspection ID</Text>
                    <Text style={styles.cardValueMonospace}>#{alert.inspectionId}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        {/* NG Rate Alert Information */}
        {alert.alertType === 'NG_RATE_THRESHOLD' && alert.ngRate && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.ngRateInfo}</Text>
            <View style={styles.ngRateCard}>
              {/* NG Rate Gauge */}
              <View style={styles.ngRateGaugeContainer}>
                <View style={styles.ngRateGaugeRow}>
                  <View style={styles.ngRateGaugeItem}>
                    <Text style={styles.ngRateGaugeLabel}>{t.ngRateCurrent}</Text>
                    <Text style={[
                      styles.ngRateGaugeValue,
                      { color: alert.ngRate.current > alert.ngRate.threshold 
                        ? theme.colors.error 
                        : theme.colors.success 
                      }
                    ]}>
                      {alert.ngRate.current.toFixed(2)}%
                    </Text>
                  </View>
                  <View style={styles.ngRateGaugeDivider} />
                  <View style={styles.ngRateGaugeItem}>
                    <Text style={styles.ngRateGaugeLabel}>{t.ngRateThreshold}</Text>
                    <Text style={styles.ngRateGaugeThreshold}>
                      {alert.ngRate.threshold.toFixed(2)}%
                    </Text>
                  </View>
                </View>
                {/* Progress Bar */}
                <View style={styles.ngRateBarContainer}>
                  <View style={styles.ngRateBarBackground}>
                    <View style={[
                      styles.ngRateBarFill,
                      { 
                        width: `${Math.min((alert.ngRate.current / Math.max(alert.ngRate.threshold * 1.5, alert.ngRate.current * 1.2)) * 100, 100)}%`,
                        backgroundColor: alert.ngRate.current > alert.ngRate.threshold 
                          ? theme.colors.error 
                          : theme.colors.success 
                      }
                    ]} />
                    <View style={[
                      styles.ngRateBarThresholdLine,
                      { left: `${Math.min((alert.ngRate.threshold / Math.max(alert.ngRate.threshold * 1.5, alert.ngRate.current * 1.2)) * 100, 100)}%` }
                    ]} />
                  </View>
                </View>
                {alert.ngRate.current > alert.ngRate.threshold && (
                  <View style={styles.ngRateExceededBadge}>
                    <Icon name="alert-circle" size={14} color={theme.colors.error} />
                    <Text style={styles.ngRateExceededText}>
                      {t.ngRateExceeded}: +{(alert.ngRate.current - alert.ngRate.threshold).toFixed(2)}%
                    </Text>
                  </View>
                )}
              </View>
              {/* Inspection Stats */}
              <View style={styles.ngRateStatsRow}>
                <View style={styles.ngRateStatItem}>
                  <Icon name="clipboard-check-outline" size={18} color={theme.colors.info} />
                  <Text style={styles.ngRateStatLabel}>{t.totalInspections}</Text>
                  <Text style={styles.ngRateStatValue}>{alert.ngRate.totalInspections}</Text>
                </View>
                <View style={styles.ngRateStatItem}>
                  <Icon name="close-circle-outline" size={18} color={theme.colors.error} />
                  <Text style={styles.ngRateStatLabel}>{t.ngCount}</Text>
                  <Text style={styles.ngRateStatValue}>{alert.ngRate.ngCount}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Measurement Point Information */}
        {alert.alertType === 'NG_RATE_THRESHOLD' && alert.measurementPoint && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.measurementPoint}</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Icon name="identifier" size={20} color={theme.colors.primary} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>ID</Text>
                  <Text style={styles.cardValueMonospace}>{alert.measurementPoint.id}</Text>
                </View>
              </View>
              <View style={styles.cardRow}>
                <Icon name="code-tags" size={20} color={theme.colors.primary} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.measurementPointCode}</Text>
                  <Text style={styles.cardValueMonospace}>{alert.measurementPoint.code}</Text>
                </View>
              </View>
              <View style={styles.cardRow}>
                <Icon name="crosshairs-gps" size={20} color={theme.colors.primary} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.measurementPointName}</Text>
                  <Text style={styles.cardValue}>{alert.measurementPoint.name}</Text>
                </View>
              </View>
            </View>

            {/* Reference Image for Measurement Point */}
            {alert.measurementPoint.referenceImageUrl && hasValidApi && (
              <View style={styles.referenceImageSection}>
                <View style={styles.referenceImageLabelRow}>
                  <Icon name="image-check-outline" size={18} color={theme.colors.success} />
                  <Text style={styles.referenceImageLabel}>{t.referenceImage}</Text>
                </View>
                <TouchableOpacity
                  style={styles.singleReferenceImageContainer}
                  onPress={() => openImageViewer(`${apiBaseUrl}${alert.measurementPoint!.referenceImageUrl}`)}
                  activeOpacity={0.8}
                >
                  <Image
                    source={nguonAnh(`${apiBaseUrl}${alert.measurementPoint.referenceImageUrl}`)}
                    style={styles.singleReferenceImage}
                    resizeMode="cover"
                  />
                  <View style={styles.ngPointImageOverlay}>
                    <Icon name="magnify-plus-outline" size={20} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Product Model Information */}
        {alert.alertType === 'NG_RATE_THRESHOLD' && alert.productModel && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.productModelInfo}</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Icon name="identifier" size={20} color={theme.colors.warning} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>ID</Text>
                  <Text style={styles.cardValueMonospace}>{alert.productModel.id}</Text>
                </View>
              </View>
              <View style={styles.cardRow}>
                <Icon name="code-tags" size={20} color={theme.colors.warning} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.productModelCode}</Text>
                  <Text style={styles.cardValueMonospace}>{alert.productModel.code}</Text>
                </View>
              </View>
              <View style={styles.cardRow}>
                <Icon name="cube-outline" size={20} color={theme.colors.warning} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.productModelName}</Text>
                  <Text style={styles.cardValue}>{alert.productModel.name}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Threshold Config */}
        {alert.alertType === 'NG_RATE_THRESHOLD' && alert.thresholdConfig && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.thresholdConfigInfo}</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Icon name="tune-vertical" size={20} color={theme.colors.info} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.thresholdConfigName}</Text>
                  <Text style={styles.cardValue}>{alert.thresholdConfig.name}</Text>
                </View>
              </View>
              <View style={styles.cardRow}>
                <Icon name="alert-outline" size={20} color={theme.colors.warning} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.warningThreshold}</Text>
                  <Text style={styles.cardValue}>{alert.thresholdConfig.warningThreshold}%</Text>
                </View>
              </View>
              <View style={styles.cardRow}>
                <Icon name="alert-circle" size={20} color={theme.colors.error} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.criticalThreshold}</Text>
                  <Text style={styles.cardValue}>{alert.thresholdConfig.criticalThreshold}%</Text>
                </View>
              </View>
              <View style={styles.cardRow}>
                <Icon name="counter" size={20} color={theme.colors.info} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.minSampleSize}</Text>
                  <Text style={styles.cardValue}>{alert.thresholdConfig.minSampleSize}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Alert Period */}
        {alert.alertType === 'NG_RATE_THRESHOLD' && alert.period && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.alertPeriod}</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Icon name="calendar" size={20} color={theme.colors.primary} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.periodDate}</Text>
                  <Text style={styles.cardValue}>{alert.period.date}</Text>
                </View>
              </View>
              <View style={styles.cardRow}>
                <Icon name="clock-start" size={20} color={theme.colors.primary} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.periodFrom}</Text>
                  <Text style={styles.cardValue}>{alert.period.from}</Text>
                </View>
              </View>
              <View style={styles.cardRow}>
                <Icon name="clock-end" size={20} color={theme.colors.primary} />
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{t.periodTo}</Text>
                  <Text style={styles.cardValue}>{alert.period.to}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* NG Points Section */}
        {alert.ngPoints && alert.ngPoints.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {language === 'vi' ? 'Điểm kiểm tra NG' : 'NG Points'}
              </Text>
              {alert.totalNG !== undefined && (
                <View style={styles.ngBadge}>
                  <Text style={styles.ngBadgeText}>
                    {language === 'vi' ? `Tổng: ${alert.totalNG} NG` : `Total: ${alert.totalNG} NG`}
                  </Text>
                </View>
              )}
            </View>
            {alert.ngPoints.map((point, index) => (
              <View key={`ng-point-${point.pointId}-${index}`} style={styles.ngPointCard}>
                <View style={styles.ngPointHeader}>
                  <View style={styles.ngPointInfo}>
                    <Icon name="crosshairs" size={18} color={theme.colors.error} />
                    <Text style={styles.ngPointName}>{point.pointName}</Text>
                  </View>
                  <View style={[
                    styles.ngResultBadge,
                    { backgroundColor: point.result === 'NG' ? theme.colors.error : theme.colors.success }
                  ]}>
                    <Text style={styles.ngResultText}>{point.result}</Text>
                  </View>
                </View>
                {point.actualValue && (
                  <View style={styles.ngPointDetail}>
                    <Text style={styles.ngPointLabel}>
                      {language === 'vi' ? 'Giá trị đo:' : 'Actual Value:'}
                    </Text>
                    <Text style={styles.ngPointValue}>{point.actualValue}</Text>
                  </View>
                )}
                {point.expectedValue && (
                  <View style={styles.ngPointDetail}>
                    <Text style={styles.ngPointLabel}>{t.expectedValue}:</Text>
                    <Text style={styles.ngPointValue}>{point.expectedValue}</Text>
                  </View>
                )}

                {/* Image Comparison: Reference vs Error */}
                {(point.referenceImageUrl || point.imageUrl) && hasValidApi && (
                  <View style={styles.imageComparisonContainer}>
                    <View style={styles.imageComparisonRow}>
                      {/* Reference Image */}
                      <View style={styles.comparisonImageWrapper}>
                        <View style={styles.comparisonImageLabelRow}>
                          <Icon name="image-check-outline" size={14} color={theme.colors.success} />
                          <Text style={styles.comparisonImageLabelText}>{t.referenceImage}</Text>
                        </View>
                        {point.referenceImageUrl ? (
                          <TouchableOpacity
                            onPress={() => openImageViewer(`${apiBaseUrl}${point.referenceImageUrl}`)}
                            activeOpacity={0.8}
                          >
                            <Image
                              source={nguonAnh(`${apiBaseUrl}${point.referenceImageUrl}`)}
                              style={styles.comparisonImage}
                              resizeMode="cover"
                            />
                            <View style={styles.comparisonImageOverlay}>
                              <Icon name="magnify-plus-outline" size={16} color="#FFFFFF" />
                            </View>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.comparisonImagePlaceholder}>
                            <Icon name="image-off-outline" size={24} color={theme.colors.textMuted} />
                            <Text style={styles.comparisonNoImageText}>{t.noReferenceImage}</Text>
                          </View>
                        )}
                      </View>

                      {/* Error Image */}
                      <View style={styles.comparisonImageWrapper}>
                        <View style={[styles.comparisonImageLabelRow, { backgroundColor: theme.colors.error + '15' }]}>
                          <Icon name="image-broken-variant" size={14} color={theme.colors.error} />
                          <Text style={[styles.comparisonImageLabelText, { color: theme.colors.error }]}>{t.errorImage}</Text>
                        </View>
                        {point.imageUrl ? (
                          <TouchableOpacity
                            onPress={() => openImageViewer(`${apiBaseUrl}${point.imageUrl}`)}
                            activeOpacity={0.8}
                          >
                            <Image
                              source={nguonAnh(`${apiBaseUrl}${point.imageUrl}`)}
                              style={styles.comparisonImage}
                              resizeMode="cover"
                            />
                            <View style={styles.comparisonImageOverlay}>
                              <Icon name="magnify-plus-outline" size={16} color="#FFFFFF" />
                            </View>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.comparisonImagePlaceholder}>
                            <Icon name="image-off-outline" size={24} color={theme.colors.textMuted} />
                            <Text style={styles.comparisonNoImageText}>{t.noErrorImage}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Timeline */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          <View style={styles.timeline}>
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: theme.colors.error }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>
                  {language === 'vi' ? 'Lỗi xảy ra' : 'Error occurred'}
                </Text>
                <Text style={styles.timelineTime}>
                  {formatDateTime(alert.timestamp, language)}
                </Text>
              </View>
            </View>
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: theme.colors.info }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>
                  {language === 'vi' ? 'App nhận được' : 'Received by app'}
                </Text>
                <Text style={styles.timelineTime}>
                  {formatDateTime(alert.receivedAt, language)}
                </Text>
              </View>
            </View>
            {/* MB6: escalation timeline entry */}
            {alert.escalated && alert.escalatedAt && (
              <View style={styles.timelineItem}>
                <View style={[styles.timelineDot, { backgroundColor: theme.colors.error }]} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineTitle}>{t.escalatedAtLabel}</Text>
                  <Text style={styles.timelineTime}>
                    {formatDateTime(alert.escalatedAt, language)}
                  </Text>
                </View>
              </View>
            )}
            {alert.acknowledgedAt && (
              <View style={styles.timelineItem}>
                <View style={[styles.timelineDot, { backgroundColor: theme.colors.primary }]} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineTitle}>
                    {language === 'vi' ? 'Đã xác nhận' : 'Acknowledged'}
                  </Text>
                  <Text style={styles.timelineTime}>
                    {formatDateTime(alert.acknowledgedAt, language)}
                  </Text>
                  {/* MB6: ack comment */}
                  {alert.ackComment ? (
                    <Text style={styles.timelineNote}>{alert.ackComment}</Text>
                  ) : null}
                </View>
              </View>
            )}
            {alert.resolvedAt && (
              <View style={styles.timelineItem}>
                <View style={[styles.timelineDot, { backgroundColor: theme.colors.success }]} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineTitle}>
                    {language === 'vi' ? 'Đã xử lý' : 'Resolved'}
                  </Text>
                  <Text style={styles.timelineTime}>
                    {formatDateTime(alert.resolvedAt, language)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Action Buttons — MB5: disabled for read-only 'viewer' role */}
      {alert.status !== 'resolved' && (
        <View style={styles.actions}>
          {alert.status === 'pending' && (
            <TouchableOpacity
              style={[styles.actionButton, styles.acknowledgeButton, !canAck && styles.actionButtonDisabled]}
              onPress={handleAcknowledge}
              disabled={!canAck}
            >
              <Icon name="check" size={20} color={theme.colors.info} />
              <Text style={[styles.actionButtonText, styles.acknowledgeText]}>
                {t.acknowledge}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionButton, styles.resolveButton, !canResolve && styles.actionButtonDisabled]}
            onPress={handleResolve}
            disabled={!canResolve}
          >
            <Icon name="check-circle" size={20} color="#FFFFFF" />
            <Text style={[styles.actionButtonText, styles.resolveText]}>{t.resolve}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.dismissButton]}
            onPress={handleDismiss}
          >
            <Icon name="close" size={20} color={theme.colors.error} />
            <Text style={[styles.actionButtonText, styles.dismissText]}>{t.dismiss}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Fullscreen Image Viewer Modal */}
      <Modal
        visible={imageViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImageViewerVisible(false)}
      >
        <View style={styles.imageViewerContainer}>
          <TouchableOpacity
            style={styles.imageViewerCloseButton}
            onPress={() => setImageViewerVisible(false)}
          >
            <Icon name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          <Image
            source={nguonAnh(currentImageUrl)}
            style={styles.fullscreenImage}
            resizeMode="contain"
          />
          <View style={styles.imageViewerFooter}>
            <Text style={styles.imageViewerText}>
              {alert.error.type} - {alert.error.code}
            </Text>
          </View>
        </View>
      </Modal>

      {/* MB6: acknowledge-with-comment dialog */}
      <AckCommentDialog
        visible={ackDialogVisible}
        language={language}
        onConfirm={handleAckConfirm}
        onCancel={() => setAckDialogVisible(false)}
      />
    </SafeAreaView>
  );
};

const createStyles = (theme: Theme, SCREEN_WIDTH: number, SCREEN_HEIGHT: number) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: theme.spacing.md,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notFoundText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.md,
  },
  banner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  label: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
  },
  value: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
    marginLeft: theme.spacing.md,
  },
  valueMonospace: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    fontWeight: '600',
    fontFamily: 'monospace',
    textAlign: 'right',
  },
  timeContainer: {
    alignItems: 'flex-end',
  },
  relativeTime: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.sm,
  },
  cardContent: {
    flex: 1,
    marginLeft: theme.spacing.sm,
  },
  cardLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: 2,
  },
  cardValue: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    fontWeight: '500',
  },
  cardValueMonospace: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  cardValueDescription: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    lineHeight: 22,
  },
  timeline: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  timelineContent: {
    marginLeft: theme.spacing.sm,
    flex: 1,
  },
  timelineTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '500',
    color: theme.colors.text,
  },
  timelineTime: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  timelineNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  actions: {
    flexDirection: 'row',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginHorizontal: 4,
  },
  acknowledgeButton: {
    backgroundColor: `${theme.colors.info}15`,
  },
  resolveButton: {
    backgroundColor: theme.colors.success,
  },
  dismissButton: {
    backgroundColor: `${theme.colors.error}15`,
  },
  actionButtonText: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    marginLeft: 6,
  },
  acknowledgeText: {
    color: theme.colors.info,
  },
  resolveText: {
    color: '#FFFFFF',
  },
  dismissText: {
    color: theme.colors.error,
  },
  // Image styles
  imageCard: {
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceVariant,
  },
  errorImage: {
    width: '100%',
    height: 200,
    backgroundColor: theme.colors.surfaceVariant,
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  imageOverlayText: {
    color: '#FFFFFF',
    fontSize: theme.fontSize.sm,
    marginLeft: 8,
    fontWeight: '500',
  },
  // On-Demand Image Loading styles
  loadImagesButton: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.primary + '30',
    borderStyle: 'dashed',
  },
  loadImagesContent: {
    flex: 1,
    alignItems: 'flex-start',
  },
  loadImagesTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.primary,
    marginTop: theme.spacing.sm,
  },
  loadImagesHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  loadImagesLoading: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadImagesLoadingText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
  },
  loadImagesError: {
    backgroundColor: theme.colors.error + '10',
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.error + '30',
  },
  loadImagesErrorText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.error,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    lineHeight: 20,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.primary + '15',
  },
  retryButtonText: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.primary,
    marginLeft: 6,
  },
  imagesSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  imagesSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  imagesSummaryText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginLeft: 6,
    fontFamily: 'monospace',
  },
  noImagesContainer: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    alignItems: 'center',
  },
  noImagesText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.sm,
  },
  inspectionImageCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.primary + '20',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.primary,
  },
  inspectionImageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  inspectionImageInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  inspectionImageName: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginLeft: 6,
    flex: 1,
  },
  inspectionImageDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  inspectionImageContainer: {
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  inspectionImage: {
    width: '100%',
    height: 180,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
  },
  // Fullscreen image viewer
  imageViewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerCloseButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.7,
  },
  imageViewerFooter: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  imageViewerText: {
    color: '#FFFFFF',
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Section header with badge
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  // NG Badge
  ngBadge: {
    backgroundColor: theme.colors.error,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
  },
  ngBadgeText: {
    color: '#FFFFFF',
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
  },
  // NG Point Card
  ngPointCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.error + '30',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.error,
  },
  ngPointHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  ngPointInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  ngPointName: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
  },
  ngResultBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
  },
  ngResultText: {
    color: '#FFFFFF',
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  ngPointDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.xs,
  },
  ngPointLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginRight: theme.spacing.xs,
  },
  ngPointValue: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    fontFamily: 'monospace',
  },
  ngPointImageContainer: {
    marginTop: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  ngPointImage: {
    width: '100%',
    height: 120,
    borderRadius: theme.borderRadius.md,
  },
  ngPointImageOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: theme.borderRadius.md,
  },
  // NG Rate Alert styles
  ngRateCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.error + '30',
  },
  ngRateGaugeContainer: {
    marginBottom: theme.spacing.md,
  },
  ngRateGaugeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: theme.spacing.md,
  },
  ngRateGaugeItem: {
    alignItems: 'center',
    flex: 1,
  },
  ngRateGaugeDivider: {
    width: 1,
    height: 40,
    backgroundColor: theme.colors.border,
  },
  ngRateGaugeLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
  ngRateGaugeValue: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  ngRateGaugeThreshold: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: theme.colors.textSecondary,
  },
  ngRateBarContainer: {
    marginBottom: theme.spacing.sm,
  },
  ngRateBarBackground: {
    height: 8,
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: 4,
    overflow: 'visible',
    position: 'relative',
  },
  ngRateBarFill: {
    height: 8,
    borderRadius: 4,
  },
  ngRateBarThresholdLine: {
    position: 'absolute',
    top: -4,
    width: 2,
    height: 16,
    backgroundColor: theme.colors.text,
    borderRadius: 1,
  },
  ngRateExceededBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: theme.colors.error + '15',
    borderRadius: theme.borderRadius.sm,
    alignSelf: 'center',
  },
  ngRateExceededText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.error,
    marginLeft: 4,
  },
  ngRateStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  ngRateStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  ngRateStatLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  ngRateStatValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text,
    fontFamily: 'monospace',
  },
  // Reference Image styles
  referenceImageSection: {
    marginTop: theme.spacing.sm,
  },
  referenceImageLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  referenceImageLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.success,
    marginLeft: 6,
  },
  singleReferenceImageContainer: {
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  singleReferenceImage: {
    width: '100%',
    height: 180,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
  },
  // Image Comparison styles (side-by-side)
  imageComparisonContainer: {
    marginTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.sm,
  },
  imageComparisonRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  comparisonImageWrapper: {
    flex: 1,
  },
  comparisonImageLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.success + '15',
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 3,
    borderRadius: theme.borderRadius.sm,
    marginBottom: 4,
    alignSelf: 'flex-start',
  },
  comparisonImageLabelText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.success,
    marginLeft: 4,
  },
  comparisonImage: {
    width: '100%',
    height: 120,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
  },
  comparisonImageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderTopLeftRadius: theme.borderRadius.md,
    borderBottomRightRadius: theme.borderRadius.md,
    padding: 4,
  },
  comparisonImagePlaceholder: {
    height: 120,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
  },
  comparisonNoImageText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },
});

export default AlertDetailScreen;
