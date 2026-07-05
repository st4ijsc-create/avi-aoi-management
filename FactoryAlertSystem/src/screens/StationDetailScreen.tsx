/**
 * Factory Alert System - Station Detail Screen v2
 * Redesigned: dark industrial theme, PCB heatmap canvas,
 * animated floating detail panel, sparkline SVG trend
 *
 * MB11 (doc 27 §7 / doc 29 W8-D) — DECOMPOSED: this file is now the route entry that
 * composes the extracted modules under ./stationDetail/:
 *   - components/PcbCanvas        — PCB canvas + heatmap/markers/alert bubbles (seam 1)
 *   - components/FloatingPanel    — floating detail panel (+ panelParts building blocks) (seam 2)
 *   - components/pickers          — station picker + product/workstation selectors (seam 3)
 *   - components/{gallery, SettingsDialog, ImageViewerModal, FullReportModal, CorrelateModal, overlays}
 *   - hooks/useStationData        — data-fetch orchestration (A6/A7/A10, C2–C7, polling) (seam 5)
 *   - utils/{format, timeRange, apiMappers, pointMapping} — pure helpers (unit-tested)
 *   - palette / translations / types / styles — shared constants, i18n, local types, style cache
 * Seam 4 (KPI header/NG bubbles) lives on as KPICard/StationInfoCard (panelParts) + NgRateBubble in PcbCanvas.
 * Server-URL access already goes through services/serverConfig (MB4) — no literals here.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Image,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Platform,
  UIManager,
  PanResponder,
  BackHandler,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTheme } from '../context';
import {
  useStationInspectionStore,
  selectActiveStation,
  selectActiveStationPoints,
  selectStationKPI,
  selectAvailableStations,
  selectPointCounts,
  selectAlertedPointIds,
  selectLatestNgRateAlert,
  selectStationAlerts,
  selectNewlyAlertedPointIds,
  selectApiStationId,
} from '../store/stationInspectionStore';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore, selectLanguage } from '../store';
import { useConnectionStore, selectConnectionStatus } from '../store/connectionStore';
import type { CanvasImageMode, AlertAnimationType, Language } from '../types';
import { mqttService } from '../services/mqttService';
import { soundService } from '../services/soundService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debugLogger } from '../utils/debugLogger';
import DebugLogPanel from '../components/DebugLogPanel';
import type { ProductImageItem, ProductCatalogItem, WorkstationInfo } from '../services/stationService';
import {
  RootStackParamList,
  InspectionPoint,
  InspectionPointStatus,
  Alert,
} from '../types';
import { DK, LK } from './stationDetail/palette';
import { STATION_T } from './stationDetail/translations';
import type { AlertBubbleInfo, ViewerImageData } from './stationDetail/types';
import { getS } from './stationDetail/styles';
import { PcbCanvas } from './stationDetail/components/PcbCanvas';
import { StationInfoCard } from './stationDetail/components/panelParts';
import { FloatingPanel } from './stationDetail/components/FloatingPanel';
import { StationPickerModal, ProductSelector, WorkstationSelector } from './stationDetail/components/pickers';
import { ImageGallery } from './stationDetail/components/gallery';
import { StationDetailSettingsDialog } from './stationDetail/components/SettingsDialog';
import { ImageViewerModal } from './stationDetail/components/ImageViewerModal';
import { FullReportModal } from './stationDetail/components/FullReportModal';
import { CorrelateModal } from './stationDetail/components/CorrelateModal';
import { MqttAlertAnimationOverlay, NgRateExplosionOverlay } from './stationDetail/components/overlays';
import { ScreenHeader } from './stationDetail/components/ScreenHeader';
import { ReconnectBanner } from './stationDetail/components/ReconnectBanner';
import { LeftColumn } from './stationDetail/components/LeftColumn';
import { useStationData } from './stationDetail/hooks/useStationData';
import {
  computeAlertedProductPointIds, computeHasLatestAlert, filterEffectiveAlertedPointIds,
  buildAlertBubbleData, computeNewlyAlertedProductPointIds, buildProductPoints,
} from './stationDetail/utils/pointMapping';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const EMPTY_PDM: Record<string, import('../types').PointAccumulatedData> = {};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type StationDetailRouteProp = RouteProp<RootStackParamList, 'StationDetail'>;


const COL1_STORAGE_KEY = '@factory_col1_state';


// ============================================
// MAIN SCREEN
// ============================================
const StationDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<StationDetailRouteProp>();
  const { theme } = useTheme();
  const C = theme.isDark ? DK : LK;
  const { s } = getS(theme.isDark);
  const lang = useSettingsStore(selectLanguage) as Language;
  const t = STATION_T[lang];

  // Store
  const activeStation = useStationInspectionStore(selectActiveStation);
  const points = useStationInspectionStore(selectActiveStationPoints);
  const kpi = useStationInspectionStore(selectStationKPI);
  const availableStationIds = useStationInspectionStore(selectAvailableStations);
  const stationNames = useStationInspectionStore(
    useShallow((s) => {
      const map: Record<string, string> = {};
      for (const id of s.availableStationIds) {
        map[id] = s.stations[id]?.config?.stationName || id;
      }
      return map;
    }),
  );
  const pointCounts = useStationInspectionStore(selectPointCounts);
  const activeStationId = useStationInspectionStore((s) => s.activeStationId);
  const apiStationId = useStationInspectionStore(selectApiStationId);
  const isLoading = useStationInspectionStore((s) => s.isLoading);
  const setActiveStation = useStationInspectionStore((s) => s.setActiveStation);
  const setSelectedPoint = useStationInspectionStore((s) => s.setSelectedPoint);
  const initFromMqttTopics = useStationInspectionStore((s) => s.initFromMqttTopics);
  const fetchStationNames = useStationInspectionStore((s) => s.fetchStationNames);
  const storeError = useStationInspectionStore((s) => s.error);
  const alertedPointIds = useStationInspectionStore(selectAlertedPointIds);
  const latestNgRateAlert = useStationInspectionStore(selectLatestNgRateAlert);
  const stationAlerts = useStationInspectionStore(selectStationAlerts);
  const clearNgRateAlert = useStationInspectionStore((s) => s.clearNgRateAlert);
  const pointDataMap = useStationInspectionStore(useShallow((s) =>
    activeStationId ? s.pointDataMap[activeStationId] || EMPTY_PDM : EMPTY_PDM,
  ));
  const newlyAlertedMap = useStationInspectionStore(selectNewlyAlertedPointIds);
  const clearExpiredNewlyAlerted = useStationInspectionStore((s) => s.clearExpiredNewlyAlerted);
  const ngFlashDurationMs = useSettingsStore((s) => s.settings.app.ngFlashDurationMs || 5000);
  const ngBubbleDismissSec = useSettingsStore((s) => s.settings.app.ngBubbleDismissSec ?? 0);
  const ngExplosionDismissSec = useSettingsStore((s) => s.settings.app.ngExplosionDismissSec ?? 5);
  const ngAutoClearColor = useSettingsStore((s) => s.settings.app.ngAutoClearColor ?? false);
  const ngMarkerScale = useSettingsStore((s) => s.settings.app.ngMarkerScale ?? 1.5);
  // Unified NG timing: bubble dismiss follows ngFlashDurationMs (converted to seconds)
  const unifiedNgDismissSec = Math.round(ngFlashDurationMs / 1000);
  const alertAnimationEnabled = useSettingsStore((s) => s.settings.app.alertAnimationEnabled ?? true);
  const alertAnimationType = useSettingsStore((s) => s.settings.app.alertAnimationType ?? 'bomb') as AlertAnimationType;
  const alertAnimationDurationSec = useSettingsStore((s) => s.settings.app.alertAnimationDurationSec ?? 3);
  const proactivePollingEnabled = useSettingsStore((s) => s.settings.app.proactivePollingEnabled ?? false);
  const proactivePollingIntervalSec = useSettingsStore((s) => s.settings.app.proactivePollingIntervalSec ?? 60);
  const canvasImageMode = useSettingsStore((s) => s.settings.app.canvasImageMode ?? 'fit') as CanvasImageMode;
  const debugMode = useSettingsStore((s) => s.settings.app.debugMode ?? false);
  const filterPointsByWorkstation = useSettingsStore((s) => s.settings.app.filterPointsByWorkstation ?? false);
  const slowNetworkMode = useSettingsStore((s) => s.settings.app.slowNetworkMode ?? false);
  const workstationId = useSettingsStore((s) => s.settings.app.workstationId);
  const updateAppSettings = useSettingsStore((s) => s.updateAppSettings);


  // MQTT connection status
  const mqttStatus = useConnectionStore(selectConnectionStatus);
  const reconnectAttempts = useConnectionStore((s) => s.reconnectAttempts);
  const allRetriesFailed = useConnectionStore((s) => s.allRetriesFailed);
  const showMqttDisconnectDialog = useConnectionStore((s) => s.showMqttDisconnectDialog);
  const setShowMqttDisconnectDialog = useConnectionStore((s) => s.setShowMqttDisconnectDialog);

  // Local state
  const [activeFilter, setActiveFilter] = useState<InspectionPointStatus | 'all'>('all');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [settingsDialogVisible, setSettingsDialogVisible] = useState(false);
  const [isFullScreen, setIsFullScreenLocal] = useState(false);
  const setStationFullScreen = useStationInspectionStore((s) => s.setStationFullScreen);


  // Sync fullscreen state to global store so TabNavigator can hide the tab bar
  const setIsFullScreen = useCallback((value: boolean) => {
    setIsFullScreenLocal(value);
    setStationFullScreen(value);
  }, [setStationFullScreen]);

  // Restore tab bar when unmounting
  useEffect(() => {
    return () => {
      setStationFullScreen(false);
    };
  }, [setStationFullScreen]);

  // Exit fullscreen on hardware back press
  useEffect(() => {
    const onBackPress = () => {
      if (isFullScreen) {
        setIsFullScreen(false);
        return true; // prevent default back navigation
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [isFullScreen, setIsFullScreen]);

  // Exit fullscreen when navigating away
  useEffect(() => {
    const unsubBlur = navigation.addListener('blur', () => {
      if (isFullScreen) {
        setIsFullScreen(false);
      }
    });
    return unsubBlur;
  }, [navigation, isFullScreen, setIsFullScreen]);

  const [retrying, setRetrying] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showCol1, setShowCol1] = useState(true);
  const [col1Pct, setCol1Pct] = useState(0.4);
  const row2WidthRef = useRef(0);
  const col1PctRef = useRef(0.4);
  const dragStartRef = useRef(0.4);
  col1PctRef.current = col1Pct;
  const dragResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2,
    onPanResponderGrant: () => { dragStartRef.current = col1PctRef.current; },
    onPanResponderMove: (_, g) => {
      if (row2WidthRef.current <= 0) return;
      const next = Math.min(0.5, Math.max(0.1, dragStartRef.current + g.dx / row2WidthRef.current));
      setCol1Pct(+(next.toFixed(3)));
    },
  })).current;


  const handleSelectWorkstation = useCallback((ws: WorkstationInfo) => {
    updateAppSettings({ workstationId: ws.id });
  }, [updateAppSettings]);

  // Load persisted col1 state on mount
  useEffect(() => {
    AsyncStorage.getItem(COL1_STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (typeof saved.showCol1 === 'boolean') setShowCol1(saved.showCol1);
        if (typeof saved.col1Pct === 'number') {
          setCol1Pct(saved.col1Pct);
          col1PctRef.current = saved.col1Pct;
        }
      } catch {}
    });
  }, []);

  // Save col1 state when changed (debounced)
  const col1SaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (col1SaveTimer.current) clearTimeout(col1SaveTimer.current);
    col1SaveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(COL1_STORAGE_KEY, JSON.stringify({ showCol1, col1Pct }));
    }, 500);
    return () => { if (col1SaveTimer.current) clearTimeout(col1SaveTimer.current); };
  }, [showCol1, col1Pct]);

  // ─── Data-fetch orchestration (MB11 seam 5) — extracted to stationDetail/hooks/useStationData ───
  const {
    products, selectedProduct, setSelectedProduct, productsLoading,
    productImages, imagesLoading, productMeasurementPoints, productPresignedImageUrl,
    workstationList, wsLoading,
    mpStatistics, mpStatsLoading,
    pointImages, pointImagesLoading, pointImagesTotal, pointImagesFilter, setPointImagesFilter,
    visibleImageCount, defectPareto, defectParetoLoading,
    panelMeasurements, panelMeasurementsLoading,
    panelEvents, panelEventsLoading,
    panelDiagnosticMsg, panelTimeRange, setPanelTimeRange,
    lastPollTime, pollCountdown,
    panelVisible, refreshing, localSelectedPoint,
    handlePointPress, handleClosePanel, handleRefresh, handleLoadMoreImages,
  } = useStationData();


  const [viewerImage, setViewerImage] = useState<ViewerImageData | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [fullReportVisible, setFullReportVisible] = useState(false);
  const [correlateVisible, setCorrelateVisible] = useState(false);
  const [ngExplosionVisible, setNgExplosionVisible] = useState(false);
  const [ngExplosionAlert, setNgExplosionAlert] = useState<Alert | null>(null);
  const [alertAnimVisible, setAlertAnimVisible] = useState(false);
  const [alertAnimNgCount, setAlertAnimNgCount] = useState(0);
  const [alertAnimTriggerCount, setAlertAnimTriggerCount] = useState(0);
  const alertAnimPrevAlertCountRef = useRef(0);
  const [debugLogVisible, setDebugLogVisible] = useState(false);
  // Auto-detected image dimensions (from Image.getSize when API doesn't provide them)
  const [detectedImgW, setDetectedImgW] = useState<number | undefined>(undefined);
  const [detectedImgH, setDetectedImgH] = useState<number | undefined>(undefined);


  // NG Rate Bubble: top 2 points with highest NG Rate
  const [topNgPoints, setTopNgPoints] = useState<Array<{ id: string; name: string; ngRate: number }>>([]);


  useEffect(() => {
    if (route.params?.stationId) {
      setActiveStation(route.params.stationId);
    } else if (!activeStationId && availableStationIds.length > 0) {
      setActiveStation(availableStationIds[0]);
    }
  }, [route.params?.stationId, availableStationIds, activeStationId, setActiveStation]);


  // NG Rate alert detection & top NG points
  useEffect(() => {
    if (latestNgRateAlert) {
      setNgExplosionAlert(latestNgRateAlert);
      setNgExplosionVisible(true);
      soundService.playAlertSound('critical');

      // Tìm 2 điểm đo có NG Rate cao nhất
      if (pointDataMap) {
        const arr = Object.entries(pointDataMap)
          .map(([id, data]) => {
            // id is a productScopedKey like "GB300::123" — strip prefix for point lookup
            const bareId = id.includes('::') ? id.split('::')[1] : id;
            // Search product measurement points first (loaded via getProductFullData),
            // then fall back to MQTT store points
            const pmp = productMeasurementPoints.find(m => String(m.id) === bareId);
            const pt = pmp ? null : points.find(p => p.id === bareId);
            const name = pmp?.name || pmp?.code || pt?.name || pt?.code || bareId;
            return { id, name, ngRate: data.defectRate || 0 };
          })
          .sort((a, b) => b.ngRate - a.ngRate)
          .slice(0, 2);
        setTopNgPoints(arr);
      }
    } else {
      setTopNgPoints([]);
    }
  }, [latestNgRateAlert, pointDataMap, points, productMeasurementPoints]);

  const handleDismissExplosion = useCallback(() => {
    setNgExplosionVisible(false);
    setNgExplosionAlert(null);
    if (activeStationId) clearNgRateAlert(activeStationId);
  }, [activeStationId, clearNgRateAlert]);

  // --- MQTT Alert Animation: trigger on new station alert ---
  const handleDismissAlertAnim = useCallback(() => {
    setAlertAnimVisible(false);
    if (debugMode) console.log('[AlertAnim] Dismissed (onDismiss called)');
  }, [debugMode]);

  // Track latest alert identity to detect new alerts even when array length stays same (capped at 20)
  const alertAnimLastAlertIdRef = useRef<string>('');

  useEffect(() => {
    if (!alertAnimationEnabled) return;
    const count = stationAlerts.length;
    // Build a fingerprint from latest alert to detect new alerts when length is capped
    const latestAlert = stationAlerts[0];
    const latestId = latestAlert
      ? `${latestAlert.timestamp || ''}_${latestAlert.product?.serialNumber || latestAlert.product?.id || ''}_${latestAlert.error?.type || ''}`
      : '';
    const isNewAlert = count > 0 && (
      count > alertAnimPrevAlertCountRef.current || // array grew
      (count === alertAnimPrevAlertCountRef.current && latestId !== alertAnimLastAlertIdRef.current) // same length, different alert
    );

    if (debugMode) {
      console.log(`[AlertAnim] useEffect: count=${count}, prevCount=${alertAnimPrevAlertCountRef.current}, isNewAlert=${isNewAlert}, visible=${alertAnimVisible}, triggerCount=${alertAnimTriggerCount}, latestId=${latestId}, prevLatestId=${alertAnimLastAlertIdRef.current}`);
    }

    if (isNewAlert) {
      // When workstation filter is active, only trigger animation if the alert has
      // NG points belonging to the selected workstation
      const wsFilterActive = filterPointsByWorkstation && workstationId != null;
      // Total NG count for the board (fallback when no workstation filter)
      const totalNgPtCount = latestAlert?.ngPoints?.filter((p: any) => p.result === 'NG').length
        ?? latestAlert?.totalNG
        ?? 1;

      if (wsFilterActive && latestAlert?.ngPoints) {
        const wsId = Number(workstationId);
        // Use inclusive filter matching canvas logic: include points with null workstationId
        // (unassigned points are visible to all workstations)
        const relevantNgPoints = latestAlert.ngPoints.filter(
          (p: any) => p.result === 'NG' && (p.workstationId == null || Number(p.workstationId) === wsId),
        );
        if (relevantNgPoints.length === 0) {
          if (debugMode) {
            console.log(`[AlertAnim] SKIPPED: workstation filter active (wsId=${wsId}), no NG points match`);
          }
          alertAnimPrevAlertCountRef.current = count;
          alertAnimLastAlertIdRef.current = latestId;
          return;
        }
        // Display filtered NG count for this workstation
        setAlertAnimNgCount(relevantNgPoints.length);
      } else {
        setAlertAnimNgCount(totalNgPtCount);
      }
      setAlertAnimTriggerCount((c) => c + 1);
      setAlertAnimVisible(true);
      if (debugMode) {
        console.log(`[AlertAnim] TRIGGERED: newTriggerCount=${alertAnimTriggerCount + 1}`);
      }
    }
    alertAnimPrevAlertCountRef.current = count;
    alertAnimLastAlertIdRef.current = latestId;
  }, [stationAlerts, alertAnimationEnabled, newlyAlertedMap, debugMode, filterPointsByWorkstation, workstationId]);

  // Auto-clear expired newly-alerted points based on flash duration setting
  // Use stable boolean dep instead of newlyAlertedMap object ref — prevents
  // the interval from being reset every time a new alert adds entries,
  // which previously starved the cleanup timer when alerts arrived < 1s apart.
  const hasNewlyAlerted = Object.keys(newlyAlertedMap).length > 0;
  useEffect(() => {
    if (!hasNewlyAlerted || !activeStationId) return;
    const timer = setInterval(() => {
      clearExpiredNewlyAlerted(activeStationId, ngFlashDurationMs, ngAutoClearColor);
    }, 1000);
    return () => clearInterval(timer);
  }, [activeStationId, hasNewlyAlerted, ngFlashDurationMs, ngAutoClearColor, clearExpiredNewlyAlerted]);

  // Handlers


  const handleProductSelect = useCallback((product: ProductCatalogItem) => {
    debugLogger.action('handleProductSelect', `Product: ${product.name} (${product.code})`, { id: product.id });
    // Close floating panel when switching products — measurement point IDs are product-specific
    if (panelVisible) {
      handleClosePanel();
    }
    setSelectedProduct(product);
    setImageError(false);
  }, [panelVisible, handleClosePanel]);

  const handleImagePress = useCallback((img: ProductImageItem) => {
    debugLogger.action('handleImagePress', `Image: ${img.label || img.pointName || img.id}`, { type: img.type, isNG: img.type === 'fail' });
    const base = (useSettingsStore.getState().settings.app.apiBaseUrl || '').replace(/\/+$/, '');
    setViewerImage({
      imageUrl: img.imageUrl,
      label: img.label || img.pointName || img.id,
      pointName: img.pointName,
      type: img.type,
      isNG: img.type === 'fail',
      supportsResize: !!base && img.imageUrl.startsWith(base),
    });
    setViewerVisible(true);
  }, []);

  const handlePointImagePress = useCallback((imageUrl: string, label?: string, isNG?: boolean) => {
    const base = (useSettingsStore.getState().settings.app.apiBaseUrl || '').replace(/\/+$/, '');
    setViewerImage({ imageUrl, label, isNG, supportsResize: !!base && imageUrl.startsWith(base) });
    setViewerVisible(true);
  }, []);


  const handleViewFullReport = useCallback(() => {
    debugLogger.action('handleViewFullReport', 'Open full report modal');
    setFullReportVisible(true);
  }, []);

  const handleCorrelate = useCallback(() => {
    debugLogger.action('handleCorrelate', 'Open correlate modal');
    setCorrelateVisible(true);
  }, []);

  // Prefer presigned product image from tRPC API, fall back to product referenceImageUrl, then station MQTT image
  const productRefImage = productPresignedImageUrl
    || (selectedProduct?.referenceImageUrl
        ? (selectedProduct.referenceImageUrl.startsWith('http') || selectedProduct.referenceImageUrl.startsWith('data:')
            ? selectedProduct.referenceImageUrl
            : `${useSettingsStore.getState().settings.app.apiBaseUrl}${selectedProduct.referenceImageUrl}`)
        : null);
  const referenceImageUri = productRefImage || activeStation?.referenceImageUrl;

  // ALWAYS detect actual image dimensions so PcbCanvas contain-mode layout matches the real image.
  // API-provided imageWidth/imageHeight may differ from the real image (e.g. editor viewport vs natural resolution)
  // which causes a systematic position offset for all measurement point markers.
  useEffect(() => {
    if (referenceImageUri && !referenceImageUri.startsWith('data:')) {
      Image.getSize(
        referenceImageUri,
        (w, h) => {
          console.log('[StationDetail] Detected actual image size:', w, 'x', h,
            '| API dims:', selectedProduct?.imageWidth, 'x', selectedProduct?.imageHeight);
          setDetectedImgW(w);
          setDetectedImgH(h);
        },
        () => {
          setDetectedImgW(undefined);
          setDetectedImgH(undefined);
        },
      );
    } else {
      setDetectedImgW(undefined);
      setDetectedImgH(undefined);
    }
  }, [referenceImageUri, selectedProduct?.imageWidth, selectedProduct?.imageHeight]);

  // UNIFIED dimensions: use the SAME values for both coordinate normalization and PcbCanvas layout.
  // Prefer actual detected image dimensions (Image.getSize), fall back to API dims.
  // This guarantees normalization and contain-mode layout are always consistent.
  const resolvedImgW = detectedImgW || selectedProduct?.imageWidth;
  const resolvedImgH = detectedImgH || selectedProduct?.imageHeight;

  // Canvas layout uses the same dimensions as normalization for consistency
  const canvasImgW = resolvedImgW;
  const canvasImgH = resolvedImgH;

  // Match incoming MQTT alert ngPoints against product measurement points for accurate highlighting
  const alertedProductPointIds = useMemo(
    () => computeAlertedProductPointIds(productMeasurementPoints, stationAlerts, selectedProduct?.code),
    [productMeasurementPoints, stationAlerts, selectedProduct?.code]);

  // Track whether a latest alert exists for the selected product
  // When true, non-alerted points should show 'pass' (not defectRate-based status)
  const hasLatestAlert = useMemo(
    () => computeHasLatestAlert(stationAlerts, selectedProduct?.code),
    [stationAlerts, selectedProduct?.code]);

  // When ngAutoClearColor is ON, filter alertedProductPointIds to respect auto-dismiss state.
  // clearExpiredNewlyAlerted clears alertedPointIds (store), but alertedProductPointIds is derived
  // from stationAlerts (never cleared by timer). This ensures dismissed points stop showing red.
  const effectiveAlertedProductPointIds = useMemo(
    () => filterEffectiveAlertedPointIds({ ngAutoClearColor, alertedProductPointIds, alertedPointIds, productMeasurementPoints }),
    [alertedProductPointIds, alertedPointIds, productMeasurementPoints, ngAutoClearColor]);

  // Build alert bubble data for each NG point (for speech bubble callouts on PCB)
  const alertBubbleDataRaw = useMemo(
    () => buildAlertBubbleData(productMeasurementPoints, stationAlerts, selectedProduct?.code),
    [productMeasurementPoints, stationAlerts, selectedProduct?.code]);

  // Auto-dismiss timer for alert bubbles — unified with ngFlashDurationMs
  const [alertBubbleDismissed, setAlertBubbleDismissed] = useState(false);
  const alertBubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAlertBubbleKeysRef = useRef<string>('');
  const prevAlertBubbleAlertCountRef = useRef(0);

  useEffect(() => {
    // Serialize map keys to detect content changes (not just size)
    const currentKeys = alertBubbleDataRaw.size > 0 
      ? Array.from(alertBubbleDataRaw.keys()).sort().join(',') 
      : '';
    const currentAlertCount = stationAlerts.length;
    
    // When alert bubble content changes OR new alerts arrive with same keys, reset dismissed state and start timer
    const keysChanged = currentKeys && currentKeys !== prevAlertBubbleKeysRef.current;
    const sameKeysNewAlert = currentKeys && currentAlertCount > prevAlertBubbleAlertCountRef.current;
    
    if (keysChanged || sameKeysNewAlert) {
      setAlertBubbleDismissed(false);
      if (alertBubbleTimerRef.current) clearTimeout(alertBubbleTimerRef.current);
      // Unified: bubble dismiss follows ngFlashDurationMs (same as red blink)
      if (unifiedNgDismissSec > 0) {
        alertBubbleTimerRef.current = setTimeout(() => {
          setAlertBubbleDismissed(true);
        }, unifiedNgDismissSec * 1000);
      }
    }
    prevAlertBubbleKeysRef.current = currentKeys;
    prevAlertBubbleAlertCountRef.current = currentAlertCount;
    return () => {
      if (alertBubbleTimerRef.current) clearTimeout(alertBubbleTimerRef.current);
    };
  }, [alertBubbleDataRaw, unifiedNgDismissSec, stationAlerts.length]);

  const alertBubbleData = alertBubbleDismissed ? new Map<string, AlertBubbleInfo>() : alertBubbleDataRaw;

  // Compute which product points are newly-alerted (within flash duration)
  const newlyAlertedProductPointIds = useMemo(
    () => computeNewlyAlertedProductPointIds(newlyAlertedMap, productMeasurementPoints, selectedProduct?.code),
    [newlyAlertedMap, productMeasurementPoints, selectedProduct?.code]);

  // Map product measurement points to InspectionPoint format for PCB canvas
  // positionX/Y might be: pixel coordinates, percentages (0-100), or already normalized (0-1)
  // Auto-detect coordinate system based on value ranges
  const productPoints: InspectionPoint[] = useMemo(
    () => buildProductPoints({
      productMeasurementPoints, resolvedImgW, resolvedImgH,
      effectiveAlertedProductPointIds, hasLatestAlert, pointDataMap,
      selectedProductCode: selectedProduct?.code, filterPointsByWorkstation, workstationId,
    }),
    [productMeasurementPoints, resolvedImgW, resolvedImgH, effectiveAlertedProductPointIds, hasLatestAlert, pointDataMap, selectedProduct?.code, filterPointsByWorkstation, workstationId]);

  // When product measurement points are available, use ONLY product-scoped alertedProductPointIds
  // to prevent cross-product false highlights (bare alertedPointIds may contain IDs from other products)
  const mergedAlertedPointIds = useMemo(() => {
    if (productMeasurementPoints.length > 0) {
      // Product points mode — use effective (auto-dismiss-aware) product-scoped alerts
      return effectiveAlertedProductPointIds;
    }
    // MQTT points mode (no product data) — use store-level alertedPointIds
    return alertedPointIds;
  }, [alertedPointIds, effectiveAlertedProductPointIds, productMeasurementPoints.length]);

  // Use product measurement points if available, otherwise fall back to MQTT points
  // When workstation filter is ON and we have product data, don't fall back to unfiltered MQTT points
  const displayPoints = productPoints.length > 0
    ? productPoints
    : (filterPointsByWorkstation && workstationId != null && productMeasurementPoints.length > 0)
      ? [] // All points filtered out by workstation — show empty instead of unfiltered MQTT fallback
      : points;

  // Keep FloatingPanel point data fresh when pointDataMap updates via MQTT
  const currentSelectedPoint = useMemo(() => {
    if (!localSelectedPoint) return null;
    return displayPoints.find((p) => p.id === localSelectedPoint.id) || localSelectedPoint;
  }, [displayPoints, localSelectedPoint]);

  // Filter points — use displayPoints (product points when available, otherwise MQTT points)
  const filteredPoints = useMemo(() => {
    if (activeFilter === 'all') return displayPoints;
    return displayPoints.filter((p) => p.status === activeFilter);
  }, [displayPoints, activeFilter]);

  return (
    <SafeAreaView style={s.container}>
      {/* NG Rate Bubble is now rendered inside PcbCanvas near the measurement points */}

      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} hidden={isFullScreen} />

      {/* ─── Header ─── */}
      {!isFullScreen && (
      <ScreenHeader
        t={t}
        lang={lang}
        activeStation={activeStation}
        mqttStatus={mqttStatus}
        fetchStationNames={fetchStationNames}
        onBack={() => navigation.goBack()}
        onOpenPicker={() => setPickerVisible(true)}
        onEnterFullScreen={() => setIsFullScreen(true)}
        onOpenSettings={() => setSettingsDialogVisible(true)}
      />
      )}

      {/* ─── Fullscreen exit button (floating) ─── */}
      {isFullScreen && (
        <TouchableOpacity
          onPress={() => setIsFullScreen(false)}
          style={s.fullScreenExitBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <Icon name="fullscreen-exit" size={20} color="#FFF" />
        </TouchableOpacity>
      )}

      {/* ─── MQTT Reconnecting Banner ─── */}
      <ReconnectBanner mqttStatus={mqttStatus} reconnectAttempts={reconnectAttempts} allRetriesFailed={allRetriesFailed} t={t} />

      {/* ─── Body ─── */}
      {availableStationIds.length === 0 ? (
        <View style={s.empty}>
          <Icon name={storeError ? 'cloud-off-outline' : 'access-point-off'} size={64} color={storeError ? '#EF4444' : C.textMuted} />
          <Text style={s.emptyTitle}>{storeError ? t.connectionError : t.noStations}</Text>
          {storeError ? (
            <>
              <Text style={[s.emptyHint, { color: '#EF4444', marginBottom: 8 }]}>{storeError}</Text>
              <View style={{ backgroundColor: `${C.surfaceRaised}80`, borderRadius: 8, padding: 12, marginTop: 4, width: '100%', maxWidth: 320 }}>
                <Text style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>
                  {t.serverUrl}: <Text style={{ color: C.text, fontWeight: '600' }}>{useSettingsStore.getState().settings.app.apiBaseUrl}</Text>
                </Text>
                <Text style={{ fontSize: 12, color: C.textSecondary }}>
                  {t.apiKeyStatus}: <Text style={{ color: useSettingsStore.getState().settings.app.apiKey ? '#22C55E' : '#EF4444', fontWeight: '600' }}>
                    {useSettingsStore.getState().settings.app.apiKey ? t.configured : t.notConfigured}
                  </Text>
                </Text>
              </View>
              <Text style={[s.emptyHint, { marginTop: 8 }]}>{t.checkSettings}</Text>
            </>
          ) : (
            <Text style={s.emptyHint}>{t.noStationsHint}</Text>
          )}
          <TouchableOpacity
            onPress={async () => {
              setRetrying(true);
              try { await fetchStationNames(); } finally { setRetrying(false); }
            }}
            disabled={retrying}
            style={{ marginTop: 20, backgroundColor: C.accent, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, opacity: retrying ? 0.6 : 1 }}
            activeOpacity={0.7}
          >
            {retrying ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 14 }}>{t.retryConnect}</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : isLoading && !activeStation ? (
        <View style={s.loading}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollInner}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[C.accent]} />}
        >
          {/* ═══ Row 1: Product Selector + Station Info Cards ═══ */}
          <View style={s.productInfoRow}>
            <ProductSelector
              products={products}
              selectedId={selectedProduct?.id != null ? String(selectedProduct.id) : null}
              loading={productsLoading}
              onSelect={handleProductSelect}
              t={t}
            />
            <WorkstationSelector
              workstations={workstationList}
              selectedId={workstationId ?? null}
              loading={wsLoading}
              onSelect={handleSelectWorkstation}
              t={t}
            />
            <StationInfoCard
              label={t.board}
              value={selectedProduct?.name || activeStation?.config.boardName || '—'}
              icon="developer-board"
              color={C.accent}
            />
            <StationInfoCard
              label={t.totalPoints}
              value={String(productMeasurementPoints.length || activeStation?.config.totalPoints || points.length)}
              icon="target"
              color="#8B5CF6"
            />
          </View>

          {/* ═══ Row 2: Two-column layout ═══ */}
          <View style={s.row2Container} onLayout={(e) => { row2WidthRef.current = e.nativeEvent.layout.width; }}>
            {/* ─── Column 1: KPI Strip + Inspection Points ─── */}
            {showCol1 ? (
            <LeftColumn
              t={t}
              lang={lang}
              col1Pct={col1Pct}
              onCollapse={() => setShowCol1(false)}
              proactivePollingEnabled={proactivePollingEnabled}
              lastPollTime={lastPollTime}
              pollCountdown={pollCountdown}
              kpi={kpi}
              displayPoints={displayPoints}
              pointDataMap={pointDataMap}
              selectedProductCode={selectedProduct?.code}
              selectedPointId={localSelectedPoint?.id ?? null}
              onPointPress={handlePointPress}
            />
            ) : (
            <View style={s.col1Collapsed}>
              <TouchableOpacity
                style={s.col1ExpandBtn}
                onPress={() => setShowCol1(true)}
                activeOpacity={0.6}
              >
                <Icon name="chevron-right" size={14} color={C.accent} />
              </TouchableOpacity>
            </View>
            )}

            {/* Draggable separator */}
            {showCol1 && (
              <View style={s.dragSeparator} {...dragResponder.panHandlers}>
                <View style={s.dragLine} />
                <View style={s.dragDots}>
                  <View style={s.dragDot} />
                  <View style={s.dragDot} />
                  <View style={s.dragDot} />
                </View>
                <View style={s.dragLine} />
              </View>
            )}

            {/* ─── Column 2: PCB Canvas + Image Gallery ─── */}
            <View style={[s.col2, { flex: 1 }]}>
              {/* PCB Canvas */}
              <View style={s.canvasSection}>
                <View style={s.canvasHeader}>
                  <Text style={s.secTitle}>{t.pcbBoard}</Text>
                  <View style={s.toggleRow}>
                    <TouchableOpacity
                      style={[s.toggleBtn, showHeatmap && s.toggleActive]}
                      onPress={() => setShowHeatmap((v) => !v)}
                    >
                      <Icon name="blur-radial" size={14} color={showHeatmap ? '#FFF' : C.textMuted} />
                      <Text style={[s.toggleText, showHeatmap && { color: '#FFF' }]}>{t.heatmap}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.toggleBtn, showMarkers && s.toggleActive]}
                      onPress={() => setShowMarkers((v) => !v)}
                    >
                      <Icon name="map-marker" size={14} color={showMarkers ? '#FFF' : C.textMuted} />
                      <Text style={[s.toggleText, showMarkers && { color: '#FFF' }]}>{t.markers}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <PcbCanvas
                  imageUri={referenceImageUri || null}
                  points={displayPoints}
                  selectedId={localSelectedPoint?.id || null}
                  showHeatmap={showHeatmap}
                  showMarkers={showMarkers}
                  onPointPress={handlePointPress}
                  imageError={imageError}
                  onImageError={() => setImageError(true)}
                  onImageRetry={() => setImageError(false)}
                  alertedPointIds={mergedAlertedPointIds}
                  newlyAlertedPointIds={newlyAlertedProductPointIds}
                  t={t}
                  imageWidth={canvasImgW}
                  imageHeight={canvasImgH}
                  alertBubbleData={alertBubbleData}
                  topNgPoints={topNgPoints}
                  ngBubbleDismissSec={unifiedNgDismissSec}
                  canvasImageMode={canvasImageMode}
                  ngMarkerScale={ngMarkerScale}
                />
              </View>

              {/* Product Image Gallery */}
              <ImageGallery
                images={productImages}
                loading={imagesLoading}
                onImagePress={handleImagePress}
                t={t}
              />
            </View>
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* Floating Detail Panel */}
      <FloatingPanel
        point={currentSelectedPoint}
        visible={panelVisible}
        onClose={handleClosePanel}
        onImagePress={handlePointImagePress}
        onViewFullReport={handleViewFullReport}
        onCorrelate={handleCorrelate}
        t={t}
        language={lang}
        apiBaseUrl={useSettingsStore.getState().settings.app.apiBaseUrl}
        panelSections={useSettingsStore.getState().settings.notifications.floatingPanelSections}
        mpStatistics={mpStatistics}
        mpStatsLoading={mpStatsLoading}
        pointImages={pointImages}
        pointImagesLoading={pointImagesLoading}
        pointImagesTotal={pointImagesTotal}
        pointImagesFilter={pointImagesFilter}
        onPointImagesFilterChange={setPointImagesFilter}
        visibleImageCount={visibleImageCount}
        onLoadMoreImages={handleLoadMoreImages}
        defectPareto={defectPareto}
        defectParetoLoading={defectParetoLoading}
        panelTimeRange={panelTimeRange}
        onTimeRangeChange={setPanelTimeRange}
        panelMeasurements={panelMeasurements}
        panelMeasurementsLoading={panelMeasurementsLoading}
        panelEvents={panelEvents}
        panelEventsLoading={panelEventsLoading}
        selectedProductCode={selectedProduct?.code ?? null}
        resolvedApiStationId={apiStationId ?? null}
        productsLoading={productsLoading}
        panelDiagnosticMsg={panelDiagnosticMsg}
      />

      {/* Station Picker */}
      <StationPickerModal
        visible={pickerVisible}
        stations={availableStationIds}
        stationNames={stationNames}
        activeId={activeStationId}
        onSelect={setActiveStation}
        onClose={() => setPickerVisible(false)}
        t={t}
        language={lang}
      />

      {/* Image Viewer */}
      <ImageViewerModal
        visible={viewerVisible}
        image={viewerImage}
        onClose={() => setViewerVisible(false)}
        t={t}
      />

      {/* Full Report */}
      <FullReportModal
        visible={fullReportVisible}
        onClose={() => setFullReportVisible(false)}
        point={currentSelectedPoint}
        t={t}
        language={lang}
        mpStatistics={mpStatistics}
        pointImages={pointImages}
        apiBaseUrl={useSettingsStore.getState().settings.app.apiBaseUrl}
        stationId={apiStationId ?? null}
        onImagePress={handlePointImagePress}
      />

      {/* Correlate */}
      <CorrelateModal
        visible={correlateVisible}
        onClose={() => setCorrelateVisible(false)}
        point={currentSelectedPoint}
        allPoints={displayPoints}
        t={t}
        language={lang}
      />

      {/* MQTT Alert Animation */}
      <MqttAlertAnimationOverlay
        visible={alertAnimVisible}
        animationType={alertAnimationType}
        ngPointCount={alertAnimNgCount}
        onDismiss={handleDismissAlertAnim}
        dismissMs={alertAnimationDurationSec * 1000}
        triggerCount={alertAnimTriggerCount}
        t={t}
      />

      {/* NG Rate Explosion */}
      <NgRateExplosionOverlay
        visible={ngExplosionVisible}
        alert={ngExplosionAlert}
        onDismiss={handleDismissExplosion}
        dismissMs={ngExplosionDismissSec * 1000}
        t={t}
      />

      {/* Settings Dialog */}
      <StationDetailSettingsDialog
        visible={settingsDialogVisible}
        onClose={() => setSettingsDialogVisible(false)}
        t={t}
      />

      {/* MQTT Disconnect Dialog */}
      <Modal
        visible={showMqttDisconnectDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMqttDisconnectDialog(false)}
      >
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 24, width: '80%', maxWidth: 340, alignItems: 'center', elevation: 10 }}>
            <Icon name="server-network-off" size={48} color="#EF4444" />
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '700', marginTop: 12, textAlign: 'center' }}>
              {t.mqttDisconnectDialogTitle}
            </Text>
            <Text style={{ color: C.textSecondary, fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
              {t.mqttDisconnectDialogMsg}
            </Text>
            <TouchableOpacity
              onPress={async () => {
                setShowMqttDisconnectDialog(false);
                try {
                  await mqttService.connect();
                } catch (e) {
                  console.warn('[StationDetail] MQTT retry from dialog failed:', e);
                }
              }}
              style={{ marginTop: 20, backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 32, paddingVertical: 12 }}
              activeOpacity={0.7}
            >
              <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700' }}>{t.mqttDisconnectRetry}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Debug Log */}
      {debugMode && (
        <>
          <TouchableOpacity
            onPress={() => setDebugLogVisible(true)}
            style={{
              position: 'absolute',
              bottom: 80,
              right: 8,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(59,130,246,0.85)',
              justifyContent: 'center',
              alignItems: 'center',
              elevation: 6,
              zIndex: 999,
            }}
            activeOpacity={0.7}
          >
            <Icon name="bug-outline" size={18} color="#FFF" />
          </TouchableOpacity>
          <DebugLogPanel visible={debugLogVisible} onClose={() => setDebugLogVisible(false)} />
        </>
      )}
    </SafeAreaView>
  );
};


export default StationDetailScreen;
