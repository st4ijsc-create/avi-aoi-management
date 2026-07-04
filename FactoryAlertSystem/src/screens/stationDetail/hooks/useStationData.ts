/**
 * StationDetail — data-fetch orchestration hook (MB11 seam 5 — useStationData).
 * Owns: products/catalog loading (A6/C7), product full data (images + measurement
 * points), workstation list, server-time sync, KPI (A7) + per-point stats (A10),
 * floating-panel data (C2/C3/C4/C5/C6), proactive polling and pull-to-refresh.
 * All state, effects and handlers were moved verbatim from StationDetailScreen.tsx;
 * only the store/settings selectors at the top and the return object are new glue.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useStationInspectionStore, selectApiStationId } from '../../../store/stationInspectionStore';
import { useSettingsStore } from '../../../store';
import { useConnectionStore, selectConnectionStatus } from '../../../store/connectionStore';
import { stationService, getServerNow } from '../../../services/stationService';
import { getServerBaseUrl } from '../../../services/serverConfig';
import { debugLogger } from '../../../utils/debugLogger';
import type {
  ProductImageItem, ProductCatalogItem, ApiMeasurementPoint, MpStatisticsItem,
  PointImageItem, DefectParetoItem, WorkstationInfo,
} from '../../../services/stationService';
import type { InspectionPoint, InspectionMeasurement, InspectionEvent } from '../../../types';
import type { PanelTimeRange } from '../types';
import { getTimeRangeDates } from '../utils/timeRange';
import { sortProductsCatalog, mapMeasurementsFromApi, mapEventsFromApi, applyA10PointData } from '../utils/apiMappers';

export function useStationData() {
  // ── Store & settings selectors (same selectors as the screen — values identical) ──
  const activeStationId = useStationInspectionStore((s) => s.activeStationId);
  const apiStationId = useStationInspectionStore(selectApiStationId);
  const setActiveStation = useStationInspectionStore((s) => s.setActiveStation);
  const setSelectedPoint = useStationInspectionStore((s) => s.setSelectedPoint);
  const initFromMqttTopics = useStationInspectionStore((s) => s.initFromMqttTopics);
  const fetchStationNames = useStationInspectionStore((s) => s.fetchStationNames);
  const mqttStatus = useConnectionStore(selectConnectionStatus);
  const proactivePollingEnabled = useSettingsStore((s) => s.settings.app.proactivePollingEnabled ?? false);
  const proactivePollingIntervalSec = useSettingsStore((s) => s.settings.app.proactivePollingIntervalSec ?? 60);

  // Workstation list
  const [workstationList, setWorkstationList] = useState<WorkstationInfo[]>([]);
  const [wsLoading, setWsLoading] = useState(false);

  // Floating panel visibility + pull-to-refresh state
  const [panelVisible, setPanelVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch workstation list on mount
  useEffect(() => {
    let cancelled = false;
    setWsLoading(true);
    stationService.getWorkstations().then((list) => {
      if (!cancelled) setWorkstationList(list);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setWsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Re-fetch station & workstation data when MQTT reconnects
  const prevMqttStatusRef = useRef<string>(mqttStatus);
  useEffect(() => {
    const prev = prevMqttStatusRef.current;
    prevMqttStatusRef.current = mqttStatus;

    // Only act when transitioning TO 'connected' from a non-connected state
    if (mqttStatus === 'connected' && prev !== 'connected') {
      console.log('[StationDetail] MQTT reconnected (was:', prev, ') — re-fetching data');

      // Re-fetch station names from API
      fetchStationNames();

      // Re-fetch workstation list
      setWsLoading(true);
      stationService.getWorkstations().then((list) => {
        setWorkstationList(list);
      }).catch((e) => {
        console.warn('[StationDetail] Workstation re-fetch after reconnect failed:', e instanceof Error ? e.message : e);
      }).finally(() => {
        setWsLoading(false);
      });

      // Re-sync server time
      stationService.syncServerTime().then(() => {
        console.log('[StationDetail] Server time re-synced after reconnect');
      }).catch((e) => {
        console.warn('[StationDetail] Server time re-sync after reconnect failed:', e instanceof Error ? e.message : e);
      });
    }
  }, [mqttStatus, fetchStationNames]);

  // Server time sync state — prevents KPI fetching with wrong dates before sync completes
  const [serverTimeSynced, setServerTimeSynced] = useState(false);

  // Product & Images state
  const [products, setProducts] = useState<ProductCatalogItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductCatalogItem | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productImages, setProductImages] = useState<ProductImageItem[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [productMeasurementPoints, setProductMeasurementPoints] = useState<ApiMeasurementPoint[]>([]);
  const [productPresignedImageUrl, setProductPresignedImageUrl] = useState<string | null>(null);

  // Measurement point statistics from external API
  const [mpStatistics, setMpStatistics] = useState<MpStatisticsItem | null>(null);
  const [mpStatsLoading, setMpStatsLoading] = useState(false);

  // Point images from API (publicProductApi.getPointImagesByStation)
  const [pointImages, setPointImages] = useState<PointImageItem[]>([]);
  const [pointImagesLoading, setPointImagesLoading] = useState(false);
  const [pointImagesTotal, setPointImagesTotal] = useState(0);
  const [pointImagesFilter, setPointImagesFilter] = useState<'ALL' | 'OK' | 'NG' | 'NTF' | 'NG_NTF'>('NG');

  // Visible image count for load-more in floating panel (hero=1 + initially 4 grid = 5)
  const [visibleImageCount, setVisibleImageCount] = useState(5);
  const slowLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Defect Pareto from external API
  const [defectPareto, setDefectPareto] = useState<DefectParetoItem[]>([]);
  const [defectParetoLoading, setDefectParetoLoading] = useState(false);

  // Measurement results from C5 API (getInspectionMeasurements)
  const [panelMeasurements, setPanelMeasurements] = useState<InspectionMeasurement[]>([]);
  const [panelMeasurementsLoading, setPanelMeasurementsLoading] = useState(false);

  // Events from C6 API (getInspectionEvents)
  const [panelEvents, setPanelEvents] = useState<InspectionEvent[]>([]);
  const [panelEventsLoading, setPanelEventsLoading] = useState(false);

  // Diagnostic message for FloatingPanel (shown when data can't load)
  const [panelDiagnosticMsg, setPanelDiagnosticMsg] = useState<string | null>(null);

  // Time range for panel data
  const [panelTimeRange, setPanelTimeRange] = useState<PanelTimeRange>('today');

  // Polling countdown state
  const [lastPollTime, setLastPollTime] = useState(0);
  const [pollCountdown, setPollCountdown] = useState(0);

  // Ref to guard against race conditions: tracks the currently selected point ID
  // so stale API responses from a previously selected point are discarded.
  const handlePointPressIdRef = useRef<string | null>(null);

  /**
   * Fetch inspection images for a measurement point using C4 Inspection Images API.
   * C4 supports result filter (OK/NG/ALL) + pointDefId, unlike A10 which only has NG errorImages.
   * Falls back to A10 (point-detail) for NG if C4 fails.
   */
  const fetchMergedPointImages = useCallback(async (params: {
    stationId: string | number;
    pointDefId: string | number;
    productCode?: string;
    result: 'ALL' | 'OK' | 'NG' | 'NTF' | 'NG_NTF';
    startDate: string;
    endDate: string;
    limit?: number;
  }): Promise<{ images: PointImageItem[]; total: number }> => {
    const { stationId, pointDefId, productCode, result, startDate, endDate, limit = 50 } = params;

    // Use C4 API which supports all result filters + pointDefId
    try {
      const c4Resp = await stationService.getInspectionImages({
        stationId,
        pointDefId,
        productCode,
        productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
        result: (result === 'NTF' || result === 'NG_NTF') ? 'ALL' : result, // C4 may not support NTF/NG_NTF directly, use ALL and filter client-side
        startDate,
        endDate,
        limit,
        offset: 0,
      });

      if (c4Resp?.data?.images && c4Resp.data.images.length > 0) {
        let rawImages = c4Resp.data.images;
        // Client-side filter: NTF = exclude OK & NG, NG_NTF = exclude OK only
        if (result === 'NG_NTF') {
          rawImages = rawImages.filter((img) => img.result !== 'OK');
        } else if (result === 'NTF') {
          rawImages = rawImages.filter((img) => img.result !== 'OK' && img.result !== 'NG');
        }
        const images: PointImageItem[] = rawImages.map((img) => ({
          id: String(img.measurementResultId),
          imageUrl: img.imageUrl,
          result: (img.result === 'OK' || img.result === 'NG' || img.result === 'NTF') ? img.result : 'NG' as const,
          inspectedAt: img.inspectionTime || '',
          serialNumber: img.serialNumber,
          pointCode: img.pointCode,
          pointName: img.pointName,
          productCode: img.productCode,
        }));
        // When client-side filtering (NG_NTF/NTF), use filtered count since API total reflects ALL results
        const total = (result === 'NG_NTF' || result === 'NTF') ? images.length : (c4Resp.data.pagination?.total ?? images.length);
        return { images, total };
      }
    } catch (err) {
      console.warn('[StationDetail] C4 getInspectionImages failed, falling back to A10:', err instanceof Error ? err.message : err);
    }

    // Fallback to A10 for NG images only (A10 only has errorImages)
    if (result === 'OK' || result === 'NTF') {
      return { images: [], total: 0 };
    }
    // NG_NTF and NG both proceed — A10 provides NG errorImages

    const resp = await stationService.getStationPointDetail(stationId, {
      startDate,
      endDate,
      productCode,
      productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
      pointDefId,
      imageLimit: limit,
    });

    if (!resp?.data?.points?.length) {
      return { images: [], total: 0 };
    }

    const point = resp.data.points[0];
    const images: PointImageItem[] = (point.errorImages ?? []).map((img) => ({
      id: String(img.id),
      imageUrl: img.imageUrl,
      result: 'NG' as const,
      inspectedAt: img.inspectionTime,
      serialNumber: img.serialNumber,
      pointCode: point.code,
      pointName: point.name,
    }));

    return { images, total: images.length };
  }, [selectedProduct?.id]);

  // Init
  useEffect(() => {
    const debugMode = useSettingsStore.getState().settings.app.debugMode ?? false;
    debugLogger.setEnabled(debugMode);
    if (debugMode) {
      debugLogger.system('StationDetail', 'Screen mounted');
    }
    // Sync clock offset with server before fetching any date-dependent data
    stationService.syncServerTime().then(() => {
      console.log('[StationDetail] Server time synced, serverNow:', getServerNow().toISOString(), 'phoneNow:', new Date().toISOString());
      setServerTimeSynced(true);
    }).catch((e) => {
      console.warn('[StationDetail] Server time sync failed, using phone clock:', e instanceof Error ? e.message : e);
      setServerTimeSynced(true); // proceed with phone clock
    });

    const mqttTopics = useSettingsStore.getState().settings.mqtt.topics;
    if (mqttTopics && mqttTopics.length > 0) {
      initFromMqttTopics(mqttTopics);
    } else {
      // No MQTT topics — fetch stations from REST API directly
      fetchStationNames();
    }
  }, [initFromMqttTopics, fetchStationNames]);

  // Reusable product loading function — returns loaded list (or [])
  const doLoadProducts = useCallback(async (stationId: string | null): Promise<ProductCatalogItem[]> => {
    const currentSettings = useSettingsStore.getState().settings;
    const apiUrl = currentSettings.app.apiBaseUrl;
    const hasKey = !!currentSettings.app.apiKey;
    console.log('[StationDetail] doLoadProducts, station:', stationId, 'apiBaseUrl:', apiUrl);

    const mapStationProducts = (items: import('../../../services/stationService').StationProductItem[]): ProductCatalogItem[] =>
      items.map((p) => ({
        id: String(p.id),
        name: p.name,
        code: p.code,
        description: p.description,
        category: p.category,
        lifecycleStatus: p.lifecycleStatus,
        imageWidth: p.imageWidth,
        imageHeight: p.imageHeight,
        targetYieldRate: p.targetYieldRate,
        minYieldRate: p.minYieldRate,
      }));

    // Try A6 station-specific products first
    if (stationId) {
      try {
        const resp = await stationService.getStationProducts(stationId);
        console.log('[StationDetail] A6 resp:', resp ? `success=${resp.success}, products=${resp.data?.products?.length ?? 'N/A'}` : 'null');
        if (resp?.success && resp.data?.products?.length > 0) {
          return mapStationProducts(resp.data.products);
        }
      } catch (e) {
        console.warn('[StationDetail] A6 getStationProducts failed, fallback to C7:', e instanceof Error ? e.message : e);
      }
    }

    // Fallback to C7 global product list
    try {
      const list = await stationService.getProductList();
      console.log('[StationDetail] C7 fallback products:', list.length);
      if (list.length === 0) {
        console.warn('[StationDetail] Product list is EMPTY — apiBaseUrl:', apiUrl, 'apiKey present:', hasKey);
      }
      return list;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[StationDetail] getProductList error:', msg);
      return [];
    }
  }, []);

  // Fetch products for this station (A6), fallback to global C7, with auto-retry
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setProductsLoading(true);

    const run = async (attempt: number) => {
      const list = await doLoadProducts(apiStationId);
      if (cancelled) return;

      if (list.length > 0) {
        const sorted = sortProductsCatalog(list);
        setProducts(sorted);
        // Keep current selection if it exists in the new list; otherwise pick first non-parent
        const prevCode = selectedProduct?.code;
        const kept = prevCode ? sorted.find(p => p.code === prevCode) : null;
        setSelectedProduct(kept || sorted[0]);
        console.log('[StationDetail] Products loaded:', sorted.length, 'selected:', (kept || sorted[0])?.code,
          'order:', sorted.map(p => p.code).join(', '));
        setProductsLoading(false);
        return;
      }

      // Auto-retry up to 2 extra attempts with increasing delay
      if (attempt < 3) {
        const delay = attempt === 1 ? 3000 : 6000;
        console.log(`[StationDetail] Products empty, retry #${attempt} in ${delay}ms...`);
        retryTimer = setTimeout(() => { if (!cancelled) run(attempt + 1); }, delay);
      } else {
        console.warn('[StationDetail] Products still empty after retries');
        setProducts([]);
        setSelectedProduct(null);
        setProductsLoading(false);
      }
    };

    run(1);
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiStationId, doLoadProducts]);

  // Fetch product detail + measurement points + images via getProductByCode + getProductImage + getPointImage
  useEffect(() => {
    if (!selectedProduct) {
      setProductImages([]);
      setProductMeasurementPoints([]);
      setProductPresignedImageUrl(null);
      return;
    }
    let cancelled = false;
    setImagesLoading(true);

    // Wrap getProductFullData with 30s overall timeout to prevent indefinite hang
    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        console.warn('[StationDetail] getProductFullData timed out after 30s for', selectedProduct.code);
        setImagesLoading(false);
      }
    }, 30000);

    stationService.getProductFullData(selectedProduct.code).then((data) => {
      clearTimeout(timeoutId);
      if (cancelled) return;
      if (data) {
        setProductPresignedImageUrl(data.productImageUrl);
        setProductImages(data.images);
        setProductMeasurementPoints(data.measurementPoints);
        // Update selectedProduct with fresh imageWidth/imageHeight from getProductByCode
        if (data.product.imageWidth || data.product.imageHeight) {
          setSelectedProduct((prev) => prev ? {
            ...prev,
            imageWidth: data.product.imageWidth ?? prev.imageWidth,
            imageHeight: data.product.imageHeight ?? prev.imageHeight,
          } : prev);
        }
      } else {
        setProductPresignedImageUrl(null);
        setProductImages([]);
        setProductMeasurementPoints([]);
      }
      setImagesLoading(false);
    }).catch((err) => {
      clearTimeout(timeoutId);
      if (cancelled) return;
      console.warn('[StationDetail] getProductFullData error:', err);
      setImagesLoading(false);
    });
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [selectedProduct?.code]);

  // Track selected point locally — Zustand selectSelectedPoint only searches
  // MQTT station.points, but productPoints are generated locally and never stored there.
  const [localSelectedPoint, setLocalSelectedPoint] = useState<InspectionPoint | null>(null);

  // Re-fetch point images when filter changes while panel is open
  const pointImagesFilterRef = useRef(pointImagesFilter);
  useEffect(() => {
    // Skip on initial mount — only trigger on actual filter change
    if (pointImagesFilterRef.current === pointImagesFilter) return;
    pointImagesFilterRef.current = pointImagesFilter;

    if (!panelVisible || !localSelectedPoint || !apiStationId) return;
    const pointCode = localSelectedPoint.code || localSelectedPoint.name || localSelectedPoint.id;
    if (!pointCode) return;
    let cancelled = false;

    setPointImagesLoading(true);
    const { startDate, endDate } = getTimeRangeDates(panelTimeRange);
    fetchMergedPointImages({
      stationId: apiStationId,
      pointDefId: localSelectedPoint.id,
      productCode: selectedProduct?.code,
      result: pointImagesFilter,
      startDate,
      endDate,
    }).then(({ images, total }) => {
      if (cancelled) return;
      setPointImages(images);
      setPointImagesTotal(total);
    }).catch(() => {
      if (cancelled) return;
      setPointImages([]);
      setPointImagesTotal(0);
    }).finally(() => { if (!cancelled) setPointImagesLoading(false); });

    return () => { cancelled = true; };
  }, [pointImagesFilter, panelVisible, localSelectedPoint, selectedProduct?.code, apiStationId, panelTimeRange, fetchMergedPointImages]);

  // Re-fetch stats + defect pareto when time range changes while panel is open
  const panelTimeRangeRef = useRef(panelTimeRange);
  useEffect(() => {
    console.log('[StationDetail] panelTimeRange effect: current=', panelTimeRange,
      'prev=', panelTimeRangeRef.current,
      'panelVisible=', panelVisible,
      'point=', localSelectedPoint?.id,
      'product=', selectedProduct?.code,
      'station=', activeStationId, '→ apiId:', apiStationId);
    if (panelTimeRangeRef.current === panelTimeRange) return;
    panelTimeRangeRef.current = panelTimeRange;
    if (!panelVisible || !localSelectedPoint || !apiStationId) return;
    let cancelled = false;

    const { startDate, endDate } = getTimeRangeDates(panelTimeRange);
    console.log('[StationDetail] panelTimeRange refetch: range=', panelTimeRange, startDate, '→', endDate);
    const _sections = useSettingsStore.getState().settings.notifications.floatingPanelSections;

    // Re-fetch measurement point statistics with new date range (using pointDefId)
    if (_sections.statistics || _sections.trend) {
    setMpStatsLoading(true);
    stationService.getMeasurementPointStatistics({
      productCode: selectedProduct?.code,
      productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
      pointDefId: localSelectedPoint.id,
      stationId: apiStationId ?? undefined,
      startDate,
      endDate,
    }).then((resp) => {
      if (cancelled) return;
      console.log('[StationDetail] panelTimeRange stats resp:',
        resp ? `success=${resp.success}, count=${resp.data?.statistics?.length ?? 0}` : 'NULL');
      if (resp?.data?.statistics && resp.data.statistics.length > 0) {
        const found = resp.data.statistics[0];
        found.measurementPointId = found.measurementPointId || Number(localSelectedPoint.id) || 0;
        found.measurementPointCode = found.measurementPointCode || localSelectedPoint.code || '';
        found.measurementPointName = found.measurementPointName || localSelectedPoint.name || '';
        setMpStatistics(found);
      } else {
        setMpStatistics(null);
      }
    }).catch((err) => {
      if (cancelled) return;
      console.warn('[StationDetail] panelTimeRange stats error:', err instanceof Error ? err.message : err);
      setMpStatistics(null);
    }).finally(() => { if (!cancelled) setMpStatsLoading(false); });
    }

    // Re-fetch defect pareto with new date range
    if (_sections.defects) {
    setDefectParetoLoading(true);
    stationService.getDefectPareto({
      stationId: apiStationId,
      productCode: selectedProduct?.code,
      productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
      startDate,
      endDate,
      limit: 10,
    }).then((resp) => {
      if (cancelled) return;
      console.log('[StationDetail] panelTimeRange pareto resp:',
        resp ? `success=${resp.success}, items=${resp.data?.items?.length ?? 0}` : 'NULL');
      if (resp?.data?.items) {
        setDefectPareto(resp.data.items);
      } else {
        setDefectPareto([]);
      }
    }).catch((err) => {
      if (cancelled) return;
      console.warn('[StationDetail] panelTimeRange pareto error:', err instanceof Error ? err.message : err);
      setDefectPareto([]);
    }).finally(() => { if (!cancelled) setDefectParetoLoading(false); });
    }

    // Re-fetch images with new date range (C4 + A9 merged)
    if (_sections.captures) {
    setPointImagesLoading(true);
    fetchMergedPointImages({
      stationId: apiStationId,
      pointDefId: localSelectedPoint.id,
      productCode: selectedProduct?.code,
      result: pointImagesFilter,
      startDate,
      endDate,
    }).then(({ images, total }) => {
      if (cancelled) return;
      setPointImages(images);
      setPointImagesTotal(total);
    }).catch(() => {
      if (cancelled) return;
      setPointImages([]);
      setPointImagesTotal(0);
    }).finally(() => { if (!cancelled) setPointImagesLoading(false); });
    }

    // Re-fetch measurements with new date range — using shared mapper
    if (_sections.measurements) {
    setPanelMeasurementsLoading(true);
    stationService.getInspectionMeasurements({
      pointDefId: localSelectedPoint.id,
      stationId: apiStationId ?? undefined,
      productCode: selectedProduct?.code,
      productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
      startDate,
      endDate,
      limit: 30,
    }).then((resp) => {
      if (cancelled) return;
      const mapped = mapMeasurementsFromApi(resp, localSelectedPoint.name || '');
      setPanelMeasurements(mapped);
    }).catch(() => {
      if (cancelled) return;
      setPanelMeasurements([]);
    }).finally(() => { if (!cancelled) setPanelMeasurementsLoading(false); });
    }

    // Re-fetch events with new date range (C6 API — station-level, no pointDefId filter)
    if (_sections.events) {
    setPanelEventsLoading(true);
    stationService.getInspectionEvents({
      stationId: apiStationId,
      startDate,
      endDate,
      limit: 50,
    }).then((resp) => {
      if (cancelled) return;
      const mapped = mapEventsFromApi(resp);
      setPanelEvents(mapped);
    }).catch(() => {
      if (cancelled) return;
      setPanelEvents([]);
    }).finally(() => { if (!cancelled) setPanelEventsLoading(false); });
    }

    return () => { cancelled = true; };
  }, [panelTimeRange, panelVisible, localSelectedPoint, selectedProduct?.code, selectedProduct?.id, apiStationId, pointImagesFilter, fetchMergedPointImages]);

  const handlePointPress = useCallback(
    async (point: InspectionPoint) => {
      debugLogger.action('handlePointPress', `Point: ${point.name} (${point.id})`, { code: point.code, status: point.status });
      console.log('[StationDetail] handlePointPress:', point.id, point.name, point.code);
      handlePointPressIdRef.current = point.id;
      setLocalSelectedPoint(point);
      setSelectedPoint(point.id);
      setPanelVisible(true);
      setPanelDiagnosticMsg(null);
      const { startDate, endDate } = getTimeRangeDates(panelTimeRange);
      const pressedPointId = point.id;
      const _sections = useSettingsStore.getState().settings.notifications.floatingPanelSections;
      const _slowMode = useSettingsStore.getState().settings.app.slowNetworkMode;

      // ── C6 Events — station-level, does NOT require selectedProduct ──
      let _eventsP: Promise<any> = Promise.resolve();
      if (apiStationId && _sections.events) {
        setPanelEvents([]);
        setPanelEventsLoading(true);
        console.log('[StationDetail] Fetching events: station:', apiStationId,
          'range:', startDate, '→', endDate);
        _eventsP = stationService.getInspectionEvents({
          stationId: apiStationId,
          startDate,
          endDate,
          limit: 50,
        }).then((resp) => {
          if (handlePointPressIdRef.current !== pressedPointId) return; // stale
          console.log('[StationDetail] getInspectionEvents response:',
            resp ? `success=${resp.success}, events=${resp.data?.events?.length ?? 0}` : 'NULL');
          const mapped = mapEventsFromApi(resp);
          setPanelEvents(mapped);
        }).catch((err) => {
          if (handlePointPressIdRef.current !== pressedPointId) return; // stale
          console.warn('[StationDetail] getInspectionEvents error:', err instanceof Error ? err.message : err);
          setPanelEvents([]);
        }).finally(() => {
          if (handlePointPressIdRef.current === pressedPointId) setPanelEventsLoading(false);
        });
      }

      // ── C2, C3, C4, C5 — station + point scoped (product filter optional) ──
      if (apiStationId) {
        let _statsP: Promise<any> = Promise.resolve();
        if (_sections.statistics || _sections.trend) {
        setMpStatistics(null);
        setMpStatsLoading(true);
        console.log('[StationDetail] Fetching stats for product:', selectedProduct?.code || '(none)',
          'point:', point.id, point.code, point.name,
          'station:', activeStationId, '→ apiId:', apiStationId,
          'range:', startDate, '→', endDate);
        _statsP = stationService.getMeasurementPointStatistics({
          productCode: selectedProduct?.code,
          productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
          pointDefId: point.id,
          stationId: apiStationId ?? undefined,
          startDate,
          endDate,
        }).then((resp) => {
          if (handlePointPressIdRef.current !== pressedPointId) return; // stale
          console.log('[StationDetail] getMpStatistics response:',
            resp ? `success=${resp.success}, statsCount=${resp.data?.statistics?.length ?? 0}` : 'NULL');
          if (resp?.data?.statistics && resp.data.statistics.length > 0) {
            // Trend API returns aggregated stats directly for the requested pointDefId
            const found = resp.data.statistics[0];
            // Stamp point info onto the stat item
            found.measurementPointId = found.measurementPointId || Number(point.id) || 0;
            found.measurementPointCode = found.measurementPointCode || point.code || '';
            found.measurementPointName = found.measurementPointName || point.name || '';
            console.log('[StationDetail] Stat for point:', found.measurementPointCode,
              'total:', found.totalCount, 'ng:', found.ngCount);
            setMpStatistics(found);
          } else {
            console.log('[StationDetail] No statistics data in response');
            setMpStatistics(null);
          }
        }).catch((err) => {
          if (handlePointPressIdRef.current !== pressedPointId) return; // stale
          console.warn('[StationDetail] getMpStatistics error:', err instanceof Error ? err.message : err);
          setMpStatistics(null);
        }).finally(() => {
          if (handlePointPressIdRef.current === pressedPointId) setMpStatsLoading(false);
        });
        }

        // Slow mode: wait for Stack 1 (stats + events) before next batch
        if (_slowMode) {
          await Promise.allSettled([_statsP, _eventsP]);
          if (handlePointPressIdRef.current !== pressedPointId) return;
        }

        // Fetch defect Pareto data
        let _paretoP: Promise<any> = Promise.resolve();
        if (apiStationId && _sections.defects) {
          setDefectPareto([]);
          setDefectParetoLoading(true);
          console.log('[StationDetail] Fetching defect pareto: station:', apiStationId,
            'product:', selectedProduct?.code || '(none)', 'range:', startDate, '→', endDate);
          _paretoP = stationService.getDefectPareto({
            stationId: apiStationId,
            productCode: selectedProduct?.code,
            productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
            startDate,
            endDate,
            limit: 10,
          }).then((resp) => {
            if (handlePointPressIdRef.current !== pressedPointId) return; // stale
            console.log('[StationDetail] getDefectPareto response:',
              resp ? `success=${resp.success}, items=${resp.data?.items?.length ?? 0}` : 'NULL');
            if (resp?.data?.items) {
              setDefectPareto(resp.data.items);
            } else {
              setDefectPareto([]);
            }
          }).catch((err) => {
            if (handlePointPressIdRef.current !== pressedPointId) return; // stale
            console.warn('[StationDetail] getDefectPareto error:', err instanceof Error ? err.message : err);
            setDefectPareto([]);
          }).finally(() => {
            if (handlePointPressIdRef.current === pressedPointId) setDefectParetoLoading(false);
          });
        }

        // Fetch measurement results from C5 API
        let _measP: Promise<any> = Promise.resolve();
        if (_sections.measurements) {
          setPanelMeasurements([]);
          setPanelMeasurementsLoading(true);
          console.log('[StationDetail] Fetching measurements: pointDefId:', point.id,
            'station:', apiStationId, 'product:', selectedProduct?.code || '(none)');
          _measP = stationService.getInspectionMeasurements({
            pointDefId: point.id,
            stationId: apiStationId ?? undefined,
            productCode: selectedProduct?.code,
            productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
            startDate,
            endDate,
            limit: 30,
          }).then((resp) => {
            if (handlePointPressIdRef.current !== pressedPointId) return; // stale
            console.log('[StationDetail] getInspectionMeasurements response:',
              resp ? `success=${resp.success}, items=${resp.data?.measurements?.length ?? 0}` : 'NULL');
            const mapped = mapMeasurementsFromApi(resp, point.name || '');
            setPanelMeasurements(mapped);
          }).catch((err) => {
            if (handlePointPressIdRef.current !== pressedPointId) return; // stale
            console.warn('[StationDetail] getInspectionMeasurements error:', err instanceof Error ? err.message : err);
            setPanelMeasurements([]);
          }).finally(() => {
            if (handlePointPressIdRef.current === pressedPointId) setPanelMeasurementsLoading(false);
          });
        }

        // Slow mode: wait for Stack 2 (pareto + measurements) before images
        if (_slowMode) {
          await Promise.allSettled([_paretoP, _measP]);
          if (handlePointPressIdRef.current !== pressedPointId) return;
        }

        // Fetch point images from A10 fail-history (matching time range)
        const pointCode = point.code || point.name || point.id;
        if (apiStationId && pointCode && _sections.captures) {
          // Clear any pending slow-load timer from previous point
          if (slowLoadTimerRef.current) { clearTimeout(slowLoadTimerRef.current); slowLoadTimerRef.current = null; }
          setPointImages([]);
          setPointImagesLoading(true);
          setPointImagesTotal(0);
          setVisibleImageCount(_slowMode ? 1 : 5);
          console.log('[StationDetail] Fetching merged point images: station:', apiStationId,
            'point:', pointCode, 'product:', selectedProduct?.code || '(none)', 'range:', startDate, '→', endDate);
          fetchMergedPointImages({
            stationId: apiStationId,
            pointDefId: point.id,
            productCode: selectedProduct?.code,
            result: pointImagesFilter,
            startDate,
            endDate,
            limit: 50,
          }).then(({ images, total }) => {
            if (handlePointPressIdRef.current !== pressedPointId) return; // stale
            console.log('[StationDetail] fetchMergedPointImages OK:', images.length,
              'images, total:', total);
            setPointImages(images);
            setPointImagesTotal(total);
          }).catch((err) => {
            if (handlePointPressIdRef.current !== pressedPointId) return; // stale
            console.warn('[StationDetail] fetchMergedPointImages error:', err instanceof Error ? err.message : err);
            setPointImages([]);
            setPointImagesTotal(0);
          }).finally(() => {
            if (handlePointPressIdRef.current === pressedPointId) setPointImagesLoading(false);
          });
        }
      } else {
        // Station ID not resolved — cannot call station-scoped external APIs
        // MB4 (doc 27): no hardcoded fallback IP — show the real (possibly missing) config
        const baseUrl = getServerBaseUrl() || '(chưa cấu hình / not configured)';
        const diagParts: string[] = [];
        if (!apiStationId) {
          diagParts.push('apiStationId = null — chưa phân giải station ID.');
        } else if (isNaN(Number(apiStationId))) {
          diagParts.push(`apiStationId = "${apiStationId}" — không phải số, API sẽ trả 400.`);
        }
        diagParts.push(`apiBaseUrl: ${baseUrl}`);
        const diagMsg = diagParts.join('\n');
        console.warn('[StationDetail] handlePointPress SKIPPED — invalid apiStationId.', diagMsg);
        setPanelDiagnosticMsg(diagMsg);
        // Clear panel data when station ID is invalid
        setMpStatistics(null);
        setMpStatsLoading(false);
        setPointImages([]);
        setPointImagesLoading(false);
        setDefectPareto([]);
        setDefectParetoLoading(false);
        setPanelMeasurements([]);
        setPanelMeasurementsLoading(false);
      }
    },
    [setSelectedPoint, selectedProduct?.code, selectedProduct?.id, activeStationId, apiStationId, pointImagesFilter, panelTimeRange, fetchMergedPointImages],
  );

  const handleClosePanel = useCallback(() => {
    setPanelVisible(false);
    // Clear slow-load timer if running
    if (slowLoadTimerRef.current) { clearTimeout(slowLoadTimerRef.current); slowLoadTimerRef.current = null; }
    // Reset all data
    setMpStatistics(null);
    setPointImages([]);
    setPointImagesTotal(0);
    setVisibleImageCount(5);
    setDefectPareto([]);
    setPanelMeasurements([]);
    setPanelEvents([]);
    // Reset all loading flags
    setMpStatsLoading(false);
    setPointImagesLoading(false);
    setDefectParetoLoading(false);
    setPanelMeasurementsLoading(false);
    setPanelEventsLoading(false);
    // Reset diagnostic message
    setPanelDiagnosticMsg(null);
    // Reset filters to defaults
    setPointImagesFilter('NG_NTF');
    setPanelTimeRange('today');
    setTimeout(() => {
      setLocalSelectedPoint(null);
      setSelectedPoint(null);
    }, 300);
  }, [setSelectedPoint]);

  // Proactive polling: when enabled + panel is open, periodically re-fetch stats, pareto, and images
  useEffect(() => {
    if (!proactivePollingEnabled || !panelVisible || !localSelectedPoint || !apiStationId) return;
    const intervalMs = Math.max(15, proactivePollingIntervalSec) * 1000;
    let cancelled = false;
    const pollingPointId = localSelectedPoint.id;

    const fetchLatestData = () => {
      if (cancelled || handlePointPressIdRef.current !== pollingPointId) return;
      const { startDate, endDate } = getTimeRangeDates(panelTimeRange);
      const _sections = useSettingsStore.getState().settings.notifications.floatingPanelSections;

      // Re-fetch stats
      if (_sections.statistics || _sections.trend)
      stationService.getMeasurementPointStatistics({
        productCode: selectedProduct?.code,
        productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
        pointDefId: localSelectedPoint.id,
        stationId: apiStationId ?? undefined,
        startDate,
        endDate,
      }).then((resp) => {
        if (cancelled || handlePointPressIdRef.current !== pollingPointId) return;
        if (resp?.data?.statistics && resp.data.statistics.length > 0) {
          const found = resp.data.statistics[0];
          found.measurementPointId = found.measurementPointId || Number(localSelectedPoint.id) || 0;
          found.measurementPointCode = found.measurementPointCode || localSelectedPoint.code || '';
          found.measurementPointName = found.measurementPointName || localSelectedPoint.name || '';
          setMpStatistics(found);
        }
      }).catch((err) => { console.warn('[Polling] stats error:', err instanceof Error ? err.message : err); });

      // Re-fetch defect pareto (station-level — API does not support pointDefId filter)
      if (_sections.defects)
      stationService.getDefectPareto({
        stationId: apiStationId,
        productCode: selectedProduct?.code,
        productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
        startDate,
        endDate,
        limit: 10,
      }).then((resp) => {
        if (cancelled || handlePointPressIdRef.current !== pollingPointId) return;
        if (resp?.data?.items) {
          setDefectPareto(resp.data.items);
        }
      }).catch((err) => { console.warn('[Polling] pareto error:', err instanceof Error ? err.message : err); });

      // Re-fetch images with same date range as stats/pareto
      if (_sections.captures)
      fetchMergedPointImages({
        stationId: apiStationId,
        pointDefId: localSelectedPoint.id,
        productCode: selectedProduct?.code,
        result: pointImagesFilter,
        startDate,
        endDate,
        limit: 50,
      }).then(({ images, total }) => {
        if (cancelled || handlePointPressIdRef.current !== pollingPointId) return;
        setPointImages(images);
        setPointImagesTotal(total);
      }).catch((err) => { console.warn('[Polling] images error:', err instanceof Error ? err.message : err); });

      // Re-fetch measurements (C5 API) — using shared mapper
      if (_sections.measurements)
      stationService.getInspectionMeasurements({
        pointDefId: localSelectedPoint.id,
        stationId: apiStationId ?? undefined,
        productCode: selectedProduct?.code,
        productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
        startDate,
        endDate,
        limit: 30,
      }).then((resp) => {
        if (cancelled || handlePointPressIdRef.current !== pollingPointId) return;
        const mapped = mapMeasurementsFromApi(resp, localSelectedPoint.name || '');
        if (mapped.length > 0) setPanelMeasurements(mapped);
      }).catch((err) => { console.warn('[Polling] measurements error:', err instanceof Error ? err.message : err); });

      // Re-fetch events (C6 API — station-level, no pointDefId filter available)
      if (_sections.events)
      stationService.getInspectionEvents({
        stationId: apiStationId,
        startDate,
        endDate,
        limit: 50,
      }).then((resp) => {
        if (cancelled || handlePointPressIdRef.current !== pollingPointId) return;
        const mapped = mapEventsFromApi(resp);
        if (mapped.length > 0) setPanelEvents(mapped);
      }).catch((err) => { console.warn('[Polling] events error:', err instanceof Error ? err.message : err); });
    };

    const timer = setInterval(fetchLatestData, intervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [proactivePollingEnabled, proactivePollingIntervalSec, panelVisible, localSelectedPoint, selectedProduct?.code, selectedProduct?.id, apiStationId, panelTimeRange, pointImagesFilter, fetchMergedPointImages]);

  // Initial KPI + Inspection Points data fetch (runs once when deps are ready)
  // Also re-fetches when selectedProduct changes to keep KPI strip in sync
  useEffect(() => {
    if (!serverTimeSynced || !activeStationId || !apiStationId || !selectedProduct) return;
    let cancelled = false;
    const { startDate, endDate } = getTimeRangeDates('today');
    const sid = activeStationId;
    const apiSid = apiStationId;

    console.log('[StationDetail] KPI fetch (today):', 'station:', sid, '→ apiId:', apiSid, 'product:', selectedProduct?.code, 'id:', selectedProduct?.id, 'range:', startDate, '→', endDate);

    // Helper: reset KPI to zeros (used when API returns empty or fails)
    const resetKpi = () => {
      useStationInspectionStore.getState().updateStationData(sid, {
        kpi: { firstPassYield: 0, finalYield: 0, output: 0, retestRate: 0, yieldDelta: undefined },
      });
    };

    // 1. Fetch KPI via A7
    const a7Params = { startDate, endDate, productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined, productCode: selectedProduct?.code };
    console.log('[StationDetail] A7 REQUEST params:', JSON.stringify(a7Params));
    stationService.getStationStatistics(apiSid, a7Params).then((res) => {
      if (cancelled) return;
      if (res?.success && res.data) {
        const d = res.data;
        console.log('[StationDetail] A7 KPI OK:', JSON.stringify({
          totalInspections: d.totalInspections, firstPassYield: d.firstPassYield,
          finalYield: d.finalYield, retestRate: d.retestRate, yieldChange: d.yieldChange,
        }));
        useStationInspectionStore.getState().updateStationData(sid, {
          kpi: {
            firstPassYield: d.firstPassYield ?? 0,
            finalYield: d.finalYield ?? 0,
            output: d.totalInspections ?? 0,
            retestRate: d.retestRate ?? 0,
            yieldDelta: d.yieldChange,
          },
        });
      } else {
        console.warn('[StationDetail] A7 KPI response empty or failed: success=', res?.success, 'hasData=', !!res?.data);
        resetKpi();
      }
    }).catch((e) => {
      if (cancelled) return;
      console.error('[StationDetail] A7 KPI error:', e instanceof Error ? e.message : e);
      resetKpi();
    });

    // 2. Fetch per-point stats via A10 (imageLimit:1 — station overview only needs 1 thumbnail)
    const a10Params = {
      startDate,
      endDate,
      productCode: selectedProduct?.code,
      productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
      imageLimit: 1,
    };
    console.log('[StationDetail] A10 REQUEST params:', JSON.stringify(a10Params));
    stationService.getStationPointDetail(apiSid, a10Params).then((resp) => {
      if (cancelled) return;
      if (resp?.success && resp.data?.points) {
        console.log('[StationDetail] A10 OK:', resp.data.points.length, 'points →',
          resp.data.points.map(p => ({ id: p.id, code: p.code, total: p.totalInspected, ng: p.ngCount })));
        applyA10PointData(sid, selectedProduct?.code, resp.data.points);
      } else if (resp?.success) {
        // API succeeded but returned no points — pass empty array to reset stale data
        console.warn('[StationDetail] A10 response empty: success=', resp?.success, 'points=', resp?.data?.points?.length ?? 0);
        applyA10PointData(sid, selectedProduct?.code, []);
      } else {
        // API failed — pass null to preserve existing MQTT data
        console.warn('[StationDetail] A10 response failed: success=', resp?.success);
        applyA10PointData(sid, selectedProduct?.code, null);
      }
    }).catch((e) => {
      if (cancelled) return;
      console.error('[StationDetail] A10 error:', e instanceof Error ? e.message : e);
      // API error — pass null to preserve existing MQTT data
      applyA10PointData(sid, selectedProduct?.code, null);
    });

    return () => { cancelled = true; };
  }, [serverTimeSynced, activeStationId, apiStationId, selectedProduct?.id, selectedProduct?.code]);

  // Station-level proactive polling: periodically refresh KPI (A7) + per-point stats (A10)
  // Runs even when floating panel is closed, updating inspection point cards on the main panel
  useEffect(() => {
    if (!proactivePollingEnabled || !serverTimeSynced || !activeStationId || !apiStationId || !selectedProduct) return;
    let cancelled = false;
    const intervalMs = Math.max(15, proactivePollingIntervalSec) * 1000;
    const sid = activeStationId;
    const apiSid = apiStationId;

    const fetchStationData = () => {
      if (cancelled) return;
      setLastPollTime(Date.now());
      const { startDate: sStartDate, endDate: sEndDate } = getTimeRangeDates('today');

      console.log('[StationDetail] Polling fetch (today):', 'station=', sid, '→ apiId:', apiSid, 'product=', selectedProduct?.code,
        'productModelId=', selectedProduct?.id, 'range=', sStartDate, '→', sEndDate);

      // 1. Fetch station KPI via A7 (production output, FPY, finalYield, retestRate, yieldChange)
      stationService.getStationStatistics(apiSid, { startDate: sStartDate, endDate: sEndDate, productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined, productCode: selectedProduct?.code }).then((res) => {
        if (cancelled) return;
        if (res?.success && res.data) {
          const d = res.data;
          console.log('[StationDetail] Station polling A7: output=', d.totalInspections,
            'FPY=', d.firstPassYield, 'finalYield=', d.finalYield, 'retest=', d.retestRate);
          useStationInspectionStore.getState().updateStationData(sid, {
            kpi: {
              firstPassYield: d.firstPassYield ?? 0,
              finalYield: d.finalYield ?? 0,
              output: d.totalInspections ?? 0,
              retestRate: d.retestRate ?? 0,
              yieldDelta: d.yieldChange,
            },
          });
        } else {
          console.warn('[StationDetail] Station polling A7 — no data: success=', res?.success, 'hasData=', !!res?.data);
        }
      }).catch((e) => {
        if (cancelled) return;
        console.error('[StationDetail] Station polling A7 ERROR:', e instanceof Error ? e.message : e);
      });

      // 2. Fetch per-point stats via A10 (point-detail) → update pointDataMap (imageLimit:1 for overview)
      stationService.getStationPointDetail(apiSid, {
        startDate: sStartDate,
        endDate: sEndDate,
        productCode: selectedProduct?.code,
        productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined,
        imageLimit: 1,
      }).then((resp) => {
        if (cancelled) return;
        if (resp?.success && resp.data?.points && resp.data.points.length > 0) {
          console.log('[StationDetail] Station polling A10: points=', resp.data.points.length);
          applyA10PointData(sid, selectedProduct?.code, resp.data.points);
        } else if (resp?.success) {
          console.warn('[StationDetail] Station polling A10 — no points: success=', resp?.success, 'pointsLen=', resp?.data?.points?.length ?? 0);
          applyA10PointData(sid, selectedProduct?.code, []);
        } else {
          console.warn('[StationDetail] Station polling A10 — failed: success=', resp?.success);
          applyA10PointData(sid, selectedProduct?.code, null);
        }
      }).catch((e) => {
        if (cancelled) return;
        console.error('[StationDetail] Station polling A10 ERROR:', e instanceof Error ? e.message : e);
        applyA10PointData(sid, selectedProduct?.code, null);
      });
    };

    // Sync countdown immediately — the KPI effect already handles the initial A7+A10 fetch,
    // so we only need to set lastPollTime so the countdown ticker starts right away.
    setLastPollTime(Date.now());

    // Single interval timer for subsequent polls — no setTimeout to avoid double-firing
    const timer = setInterval(fetchStationData, intervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [proactivePollingEnabled, proactivePollingIntervalSec, serverTimeSynced, activeStationId, apiStationId, selectedProduct?.code, selectedProduct?.id]);

  // Polling countdown ticker: 1-second interval that computes remaining time
  useEffect(() => {
    if (!proactivePollingEnabled || lastPollTime === 0) {
      setPollCountdown(0);
      return;
    }
    const intervalSec = Math.max(15, proactivePollingIntervalSec);
    // Set initial value immediately
    const elapsed = Math.floor((Date.now() - lastPollTime) / 1000);
    setPollCountdown(Math.max(0, intervalSec - elapsed));
    const tick = setInterval(() => {
      const el = Math.floor((Date.now() - lastPollTime) / 1000);
      setPollCountdown(Math.max(0, intervalSec - el));
    }, 1000);
    return () => clearInterval(tick);
  }, [proactivePollingEnabled, lastPollTime, proactivePollingIntervalSec]);

  const handleRefresh = useCallback(async () => {
    if (!activeStationId || !apiStationId) return;
    debugLogger.action('handleRefresh', `Refresh station: ${activeStationId}`, { apiStationId, product: selectedProduct?.code });
    setRefreshing(true);
    setActiveStation(activeStationId);
    const sid = activeStationId;
    const apiSid = apiStationId;
    // Reload products on refresh — preserve current selection if available
    const productsPromise = doLoadProducts(apiSid).then((list) => {
      if (list.length > 0) {
        const sorted = sortProductsCatalog(list);
        setProducts(sorted);
        // Keep current selection if possible
        const prevCode = selectedProduct?.code;
        const kept = prevCode ? sorted.find(p => p.code === prevCode) : null;
        if (!kept) setSelectedProduct(sorted[0]);
      }
    }).catch((e) => { console.warn('[StationDetail] handleRefresh doLoadProducts error:', e); });
    // Fetch KPI from A7 station statistics API
    const { startDate: rStartDate, endDate: rEndDate } = getTimeRangeDates('today');
    const a7Promise = stationService.getStationStatistics(apiSid, { startDate: rStartDate, endDate: rEndDate, productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined, productCode: selectedProduct?.code }).then((res) => {
      if (res?.success && res.data) {
        const d = res.data;
        useStationInspectionStore.getState().updateStationData(sid, {
          kpi: {
            firstPassYield: d.firstPassYield ?? 0,
            finalYield: d.finalYield ?? 0,
            output: d.totalInspections ?? 0,
            retestRate: d.retestRate ?? 0,
            yieldDelta: d.yieldChange,
          },
        });
      } else {
        console.warn('[StationDetail] handleRefresh A7 — no data');
      }
    }).catch((e) => { console.warn('[StationDetail] handleRefresh A7 error:', e); });
    // Also refresh per-point stats (A10 point-detail)
    const a10Promise = stationService.getStationPointDetail(apiSid, { startDate: rStartDate, endDate: rEndDate, productCode: selectedProduct?.code, productModelId: selectedProduct?.id ? Number(selectedProduct.id) : undefined, imageLimit: 1 }).then((resp) => {
      if (resp?.success && resp.data?.points) {
        applyA10PointData(sid, selectedProduct?.code, resp.data.points);
      } else if (resp?.success) {
        console.warn('[StationDetail] handleRefresh A10 — no points');
        applyA10PointData(sid, selectedProduct?.code, []);
      } else {
        console.warn('[StationDetail] handleRefresh A10 — failed');
        applyA10PointData(sid, selectedProduct?.code, null);
      }
    }).catch((e) => {
      console.warn('[StationDetail] handleRefresh A10 error:', e);
      applyA10PointData(sid, selectedProduct?.code, null);
    });
    // Wait for all promises before clearing refresh indicator
    Promise.allSettled([productsPromise, a7Promise, a10Promise]).then(() => setRefreshing(false));
  }, [activeStationId, apiStationId, setActiveStation, selectedProduct?.code, selectedProduct?.id, doLoadProducts]);

  const handleLoadMoreImages = useCallback(() => {
    const _slowMode = useSettingsStore.getState().settings.app.slowNetworkMode;
    if (_slowMode) {
      // Slow mode: load 4 images one by one with 1.5s gap
      if (slowLoadTimerRef.current) return;
      let added = 0;
      const loadOne = () => {
        added++;
        setVisibleImageCount((prev) => prev + 1);
        if (added < 4) {
          slowLoadTimerRef.current = setTimeout(loadOne, 1500);
        } else {
          slowLoadTimerRef.current = null;
        }
      };
      loadOne();
    } else {
      setVisibleImageCount((prev) => prev + 4);
    }
  }, []);

  return {
    // product catalog & product-scoped data
    products, selectedProduct, setSelectedProduct, productsLoading,
    productImages, imagesLoading, productMeasurementPoints, productPresignedImageUrl,
    // workstations
    workstationList, wsLoading,
    // floating-panel data (C2..C6)
    mpStatistics, mpStatsLoading,
    pointImages, pointImagesLoading, pointImagesTotal, pointImagesFilter, setPointImagesFilter,
    visibleImageCount, defectPareto, defectParetoLoading,
    panelMeasurements, panelMeasurementsLoading,
    panelEvents, panelEventsLoading,
    panelDiagnosticMsg, panelTimeRange, setPanelTimeRange,
    // polling countdown
    lastPollTime, pollCountdown,
    // panel visibility / selection / refresh
    panelVisible, refreshing, localSelectedPoint,
    // handlers
    handlePointPress, handleClosePanel, handleRefresh, handleLoadMoreImages,
  };
}
