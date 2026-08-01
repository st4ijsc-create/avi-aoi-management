/**
 * Factory Alert System - Station Inspection Store
 * Zustand store quản lý dữ liệu trạm kiểm tra AOI
 * Dữ liệu được cập nhật real-time từ MQTT và kết hợp với API server
 */

import { create } from 'zustand';
import {
  StationInspectionData,
  StationInspectionStoreState,
  StationInspectionStoreActions,
  InspectionPoint,
  StationConfig,
  StationKPI,
  Alert,
  PeriodicBulletin,
  PointAccumulatedData,
  InspectionDefect,
  InspectionMeasurement,
  InspectionEvent,
} from '../types';
import { stationService } from '../services/stationService';
import { imageService } from '../services/imageService';
import { hierarchyService, HierarchyFactory } from '../services/hierarchyService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STATION_STORAGE_KEY = '@factory_station_inspection';

// Stable empty references — reused by selectors to avoid creating new objects on every call,
// which would bypass Zustand's Object.is() equality and trigger unnecessary re-renders.
const EMPTY_SET = new Set<string>();
const EMPTY_ARRAY: readonly any[] = [];
const EMPTY_RECORD: Readonly<Record<string, number>> = {};
const EMPTY_COUNTS = { all: 0, fail: 0, warn: 0, pass: 0 } as const;
const EMPTY_POINT_DATA: Readonly<Record<string, PointAccumulatedData>> = {};

// Debounce save to avoid excessive writes
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(saveFn: () => Promise<void>, delay = 2000) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => { saveFn(); }, delay);
}

// Defect type colors for accumulated data
const DEFECT_COLORS: Record<string, string> = {
  'Solder Bridge': '#EF4444',
  'Missing Component': '#F97316',
  'Tombstone': '#F59E0B',
  'Offset': '#8B5CF6',
  'Short Circuit': '#DC2626',
  'Cold Solder': '#EA580C',
  'Lifted Lead': '#D97706',
  'Insufficient Solder': '#CA8A04',
};
const DEFAULT_DEFECT_COLOR = '#6B7280';

/**
 * Extract trailing numeric ID from a station key/code.
 * e.g., "AVI-05" → "5", "Station-3" → "3", "ST03" → "3", "5" → "5"
 */
function extractNumericId(key: string): string | null {
  const match = key.match(/(\d+)\s*$/);
  return match ? String(parseInt(match[1], 10)) : null;
}

/**
 * Find an existing station key that matches a numeric stationId by trailing-number extraction.
 * Used to link topic-parsed keys (e.g., "AVI-05") with database numeric IDs (e.g., "5").
 */
function findStationKeyByNumericId(
  stations: Record<string, any>,
  numericId: string,
  excludeKey?: string,
): string | null {
  for (const key of Object.keys(stations)) {
    if (key === excludeKey || key === numericId) continue;
    if (extractNumericId(key) === numericId) return key;
  }
  return null;
}

function createDefaultPointData(): PointAccumulatedData {
  return {
    totalInspections: 0,
    ngCount: 0,
    defectRate: 0,
    defects: [],
    measurements: [],
    events: [],
    trend: [],
    errorImageUrls: [],
    referenceImageUrls: [],
    lastAlertTime: '',
  };
}

type StationInspectionStore = StationInspectionStoreState & StationInspectionStoreActions & {
  /** Point IDs flagged by MQTT alerts (for triangle markers) */
  alertedPointIds: Record<string, Set<string>>;
  /** Latest NG Rate alert per station (for explosion animation) */
  latestNgRateAlert: Record<string, Alert>;
  /** Recent alerts per station (for flexible product-point matching in StationDetailScreen) */
  stationAlerts: Record<string, Alert[]>;
  /** Accumulated real-time data per point: Record<stationId, Record<pointId, PointAccumulatedData>> */
  pointDataMap: Record<string, Record<string, PointAccumulatedData>>;
  /** Newly-alerted point IDs with arrival timestamp for timed flash: Record<stationId, Record<pointId, timestamp>> */
  newlyAlertedPointIds: Record<string, Record<string, number>>;
  /** Process incoming MQTT alert: update points + flag alertedPointIds */
  processAlert: (alert: Alert) => void;
  /** Process incoming MQTT bulletin: update KPI */
  processBulletin: (bulletin: PeriodicBulletin) => void;
  /** Clear alerted point flags for a station */
  clearAlertedPoints: (stationId: string) => void;
  /** Clear latest NG Rate alert for a station */
  clearNgRateAlert: (stationId: string) => void;
  /** Clear recent alerts for a station */
  clearStationAlerts: (stationId: string) => void;
  /** Clear newly-alerted point IDs for a station */
  clearNewlyAlertedPoints: (stationId: string) => void;
  /** Clear expired newly-alerted points older than durationMs. clearAlertedPoints=true also removes from alertedPointIds */
  clearExpiredNewlyAlerted: (stationId: string, durationMs: number, clearAlertedPoints?: boolean) => void;
  /** Whether station screen is in fullscreen mode (hides tab bar) */
  isStationFullScreen: boolean;
  /** Set station fullscreen mode */
  setStationFullScreen: (value: boolean) => void;
  /** Save station inspection data to AsyncStorage */
  saveStationData: () => Promise<void>;
  /** Load station inspection data from AsyncStorage */
  loadStationData: () => Promise<void>;
  /** Fetch real station names from API and update station configs */
  fetchStationNames: () => Promise<void>;
  /** Populate stations directly from hierarchy tree data */
  populateFromHierarchy: (factories: HierarchyFactory[]) => void;
};

/**
 * Tạo dữ liệu trạm mặc định
 */
function createDefaultStationData(stationId: string): StationInspectionData {
  return {
    config: {
      stationId,
      stationName: stationId,
      category: '',
      totalPoints: 0,
      totalMeasurements: 0,
      boardName: '',
    },
    kpi: {
      firstPassYield: 0,
      finalYield: 0,
      output: 0,
      retestRate: 0,
    },
    points: [],
    isLive: false,
    lastUpdated: new Date().toISOString(),
  };
}

export const useStationInspectionStore = create<StationInspectionStore>((set, get) => ({
  // Initial state
  stations: {},
  activeStationId: null,
  selectedPointId: null,
  availableStationIds: [],
  isLoading: false,
  error: null,
  alertedPointIds: {},
  latestNgRateAlert: {},
  stationAlerts: {},
  pointDataMap: {},
  newlyAlertedPointIds: {},
  isStationFullScreen: false,

  setStationFullScreen: (value: boolean) => {
    set({ isStationFullScreen: value });
  },

  /**
   * Chuyển trạm active
   */
  setActiveStation: (stationId: string) => {
    set((state) => ({
      activeStationId: stationId,
      selectedPointId: null,
      availableStationIds: state.availableStationIds.includes(stationId)
        ? state.availableStationIds
        : [...state.availableStationIds, stationId],
    }));

    // Nếu trạm chưa có dữ liệu, tải từ API
    const state = get();
    if (!state.stations[stationId]) {
      set((s) => ({
        stations: {
          ...s.stations,
          [stationId]: createDefaultStationData(stationId),
        },
      }));

      // Tải dữ liệu từ API
      get().setLoading(true);
      stationService.getFullStationData(stationId).then((apiData) => {
        if (apiData) {
          get().updateStationData(stationId, apiData);
        }
        get().setLoading(false);
      });
    }
  },

  /**
   * Chọn điểm kiểm tra
   */
  setSelectedPoint: (pointId: string | null) => {
    set({ selectedPointId: pointId });
  },

  /**
   * Cập nhật dữ liệu trạm (merge partial)
   */
  updateStationData: (stationId: string, data: Partial<StationInspectionData>) => {
    set((state) => {
      const existing = state.stations[stationId] || createDefaultStationData(stationId);
      return {
        stations: {
          ...state.stations,
          [stationId]: {
            ...existing,
            ...data,
            config: data.config ? { ...existing.config, ...data.config } : existing.config,
            kpi: data.kpi ? { ...existing.kpi, ...data.kpi } : existing.kpi,
            points: data.points ?? existing.points,
            lastUpdated: new Date().toISOString(),
          },
        },
      };
    });
  },

  /**
   * Cập nhật 1 inspection point cụ thể
   */
  updateInspectionPoint: (stationId: string, pointId: string, pointUpdate: Partial<InspectionPoint>) => {
    set((state) => {
      const station = state.stations[stationId];
      if (!station) return state;

      const updatedPoints = station.points.map((p) =>
        p.id === pointId ? { ...p, ...pointUpdate } : p,
      );

      return {
        stations: {
          ...state.stations,
          [stationId]: {
            ...station,
            points: updatedPoints,
            lastUpdated: new Date().toISOString(),
          },
        },
      };
    });
  },

  /**
   * Thêm trạm mới
   */
  addStation: (stationId: string, data: StationInspectionData) => {
    set((state) => ({
      stations: { ...state.stations, [stationId]: data },
      availableStationIds: state.availableStationIds.includes(stationId)
        ? state.availableStationIds
        : [...state.availableStationIds, stationId],
    }));
  },

  /**
   * Xóa trạm
   */
  removeStation: (stationId: string) => {
    set((state) => {
      const { [stationId]: _, ...rest } = state.stations;
      return {
        stations: rest,
        availableStationIds: state.availableStationIds.filter((id) => id !== stationId),
        activeStationId: state.activeStationId === stationId ? null : state.activeStationId,
      };
    });
  },

  setLoading: (loading: boolean) => set({ isLoading: loading }),
  setError: (error: string | null) => set({ error }),

  /**
   * Khởi tạo danh sách trạm từ MQTT topics đã cài đặt
   * Parse station ID từ topic patterns
   */
  initFromMqttTopics: (topics: string[]) => {
    const stationIds = new Set<string>();

    topics.forEach((topic) => {
      const parsed = stationService.parseStationFromTopic(topic);
      if (parsed && parsed.stationId !== '+') {
        stationIds.add(parsed.stationId);
      }
    });

    const ids = Array.from(stationIds);
    if (ids.length > 0) {
      set({ availableStationIds: ids });

      // Tạo dữ liệu default cho mỗi trạm
      const stations: Record<string, StationInspectionData> = {};
      ids.forEach((id) => {
        stations[id] = createDefaultStationData(id);
      });

      set((state) => ({
        stations: { ...stations, ...state.stations },
      }));
    }

    // Always fetch station list from API (handles wildcard topics where no
    // explicit station IDs are parsed, e.g. avi/factory/+/workshop/+/station/+/...)
    get().fetchStationNames();

    // Resolve hierarchy info for each concrete topic via resolve-topic API
    const concreteTopics = topics.filter((t) => {
      const p = stationService.parseStationFromTopic(t);
      return p && p.stationId !== '+';
    });
    // Deduplicate by stationId to avoid redundant API calls
    const seen = new Set<string>();
    const uniqueTopics = concreteTopics.filter((t) => {
      const p = stationService.parseStationFromTopic(t);
      if (!p || seen.has(p.stationId)) return false;
      seen.add(p.stationId);
      return true;
    });
    // Batch all resolve-topic API calls and apply results in a single set()
    // to avoid N individual re-renders.
    Promise.allSettled(
      uniqueTopics.map((topic) => stationService.resolveStationFromTopic(topic)),
    ).then((results) => {
      const updates: Array<{ sid: string; station: any; line: any; workshop: any; factory: any }> = [];
      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value?.data) {
          updates.push({ sid: String(r.value.data.station.id), ...r.value.data });
        }
      });
      if (updates.length === 0) return;
      set((state) => {
        const newStations = { ...state.stations };
        for (const { sid, station, line, workshop, factory } of updates) {
          // Direct key match first, then try numeric ID fuzzy match
          const key = newStations[sid] ? sid : findStationKeyByNumericId(newStations, sid);
          if (!key) continue;
          const existing = newStations[key];
          newStations[key] = {
            ...existing,
            config: {
              ...existing.config,
              stationName: station.name || existing.config.stationName,
              category: existing.config.category || station.description || '',
              boardName: existing.config.boardName || station.code || '',
              factoryId: String(factory.id),
              workshopId: String(workshop.id),
              lineId: String(line.id),
            },
          };
        }
        return { stations: newStations };
      });
    });
  },

  /**
   * Xử lý Alert từ MQTT: cập nhật inspection points + flag alertedPointIds
   */
  processAlert: (alert: Alert) => {
    const stationId = alert.station?.id;
    if (!stationId) return;

    const state = get();

    // Ensure station exists (auto-create if needed so alerts aren't lost)
    let station = state.stations[stationId];
    if (!station) {
      // Before creating a new station, check if an existing station already has
      // the same name — this happens when initFromMqttTopics creates a station
      // keyed by the topic-parsed name (e.g. "Trạm Kiểm tra AVI 03")
      // but the real alert arrives with the database ID (e.g. "ST-3").
      const alertName = alert.station?.name;
      let existingKey: string | null = null;
      if (alertName) {
        for (const [key, s] of Object.entries(state.stations)) {
          if (key !== stationId && (key === alertName || s.config.stationName === alertName)) {
            existingKey = key;
            break;
          }
        }
      }
      // Fallback: match by numeric ID extraction from existing station keys
      // e.g., topic created "AVI-05", alert stationId is "5" → extract trailing digits → match
      if (!existingKey) {
        existingKey = findStationKeyByNumericId(state.stations, stationId);
      }

      if (existingKey) {
        // Migrate the existing station from topic-parsed key to the real station ID
        const oldStation = state.stations[existingKey];
        station = {
          ...oldStation,
          config: { ...oldStation.config, stationId: stationId },
        };
        if (alertName && alertName !== 'Unknown') {
          station = { ...station, config: { ...station.config, stationName: alertName } };
        }
        const migrateKey = existingKey; // capture for closure
        set((s) => {
          const { [migrateKey]: _removed, ...restStations } = s.stations;
          // Helper to move data from old key to new key in any Record
          const migrate = <T>(rec: Record<string, T>): Record<string, T> => {
            if (!(migrateKey in rec)) return rec;
            const { [migrateKey]: val, ...rest } = rec;
            return { ...rest, [stationId]: val };
          };

          return {
            stations: { ...restStations, [stationId]: station },
            availableStationIds: s.availableStationIds.map((id) => id === migrateKey ? stationId : id),
            activeStationId: s.activeStationId === migrateKey ? stationId : s.activeStationId,
            alertedPointIds: migrate(s.alertedPointIds),
            pointDataMap: migrate(s.pointDataMap),
            stationAlerts: migrate(s.stationAlerts),
            newlyAlertedPointIds: migrate(s.newlyAlertedPointIds),
            latestNgRateAlert: migrate(s.latestNgRateAlert),
          };
        });
        console.log(`[StationInspectionStore] Migrated station "${migrateKey}" → "${stationId}"`);
      } else {
        station = createDefaultStationData(stationId);
        if (alertName && alertName !== 'Unknown') {
          station.config.stationName = alertName;
        }
        set((s) => ({
          stations: { ...s.stations, [stationId]: station },
          availableStationIds: s.availableStationIds.includes(stationId)
            ? s.availableStationIds
            : [...s.availableStationIds, stationId],
        }));
      }
    } else {
      if (!state.availableStationIds.includes(stationId)) {
        set((s) => ({
          availableStationIds: [...s.availableStationIds, stationId],
        }));
      }
      // Always update station name from alert if current name is just the ID
      const currentName = station.config.stationName;
      const alertName = alert.station?.name;
      if (alertName && alertName !== 'Unknown' && alertName !== stationId &&
          (currentName === stationId || currentName === `Station ${stationId}` ||
           extractNumericId(currentName) === stationId)) {
        station = { ...station, config: { ...station.config, stationName: alertName } };
        set((s) => ({
          stations: { ...s.stations, [stationId]: station },
        }));
      }
    }

    // Store the raw alert for flexible product-point matching in StationDetailScreen
    set((s) => {
      const existing = s.stationAlerts[stationId] || [];
      const updated = [alert, ...existing].slice(0, 20); // keep max 20
      return { stationAlerts: { ...s.stationAlerts, [stationId]: updated } };
    });

    // Nếu là NG_RATE_THRESHOLD alert → lưu để trigger explosion animation
    if (alert.alertType === 'NG_RATE_THRESHOLD' && alert.ngRate) {
      set((s) => ({
        latestNgRateAlert: { ...s.latestNgRateAlert, [stationId]: alert },
      }));
    }

    // Cập nhật inspection points từ ngPoints
    if (alert.ngPoints && alert.ngPoints.length > 0) {
      // Reset alertedPointIds each time — only current alert's NG points should be marked
      const newAlertedIds = new Set<string>();
      const now = new Date();
      const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

      // 1. Match against MQTT station.points (existing logic)
      const updatedPoints = station.points.map((p) => {
        const matchNg = alert.ngPoints!.find(
          (ng) => ng.pointName === p.id || ng.pointName === p.name || String(ng.pointId) === p.id,
        );
        if (matchNg && matchNg.result === 'NG') {
          newAlertedIds.add(p.id);
          return {
            ...p,
            status: 'fail' as const,
            events: [
              { time: timeStr, desc: `Alert: ${alert.error?.description || 'NG'}`, type: 'fail' as const },
              ...p.events.slice(0, 9),
            ],
          };
        }
        // Reset previously-fail points back to 'pass' when they're OK in latest alert
        return p.status === 'fail' ? { ...p, status: 'pass' as const } : p;
      });

      // 2. Also add ngPoint numeric IDs directly (for matching product measurement point IDs)
      alert.ngPoints.forEach((ng) => {
        if (ng.result === 'NG') {
          if (ng.pointId != null) newAlertedIds.add(String(ng.pointId));
          if (ng.pointName) newAlertedIds.add(ng.pointName);
        }
      });

      // 3. Accumulate per-point real data into pointDataMap
      // Key includes productCode to isolate data per product
      const currentPointDataMap = { ...state.pointDataMap };
      if (!currentPointDataMap[stationId]) {
        currentPointDataMap[stationId] = {};
      }
      const stationPointMap = { ...currentPointDataMap[stationId] };
      const productCode = alert.productModel?.code || '';

      alert.ngPoints.forEach((ng) => {
        const basePointKey = ng.pointId != null ? String(ng.pointId) : ng.pointName;
        if (!basePointKey) return;
        // Use product-scoped key to isolate data per product
        const pointKey = productCode ? `${productCode}::${basePointKey}` : basePointKey;

        const pd = stationPointMap[pointKey]
          ? { ...stationPointMap[pointKey] }
          : createDefaultPointData();

        // Only increment ngCount from MQTT — totalInspections comes from A8/A10 API polling
        // MQTT only notifies about NG events, incrementing totalInspections here would make it equal to ngCount
        if (ng.result === 'NG') {
          pd.ngCount += 1;
        } else if (ng.result === 'NTF') {
          pd.ntfCount = (pd.ntfCount || 0) + 1;
        }
        // Ensure totalInspections is at least ngCount (corrected by next API poll)
        if (pd.ngCount > pd.totalInspections) {
          pd.totalInspections = pd.ngCount;
        }
        pd.defectRate = pd.totalInspections > 0
          ? (pd.ngCount / pd.totalInspections) * 100
          : 0;
        pd.lastAlertTime = alert.timestamp || now.toISOString();

        // Accumulate defect info from error description
        if (ng.result === 'NG' && alert.error?.description) {
          const defectName = alert.error.type || alert.error.description;
          const existingDefect = pd.defects.find((d) => d.name === defectName);
          if (existingDefect) {
            const updated = pd.defects.map((d) =>
              d.name === defectName
                ? { ...d, count: d.count + 1, pct: 0 }
                : d,
            );
            pd.defects = updated;
          } else {
            pd.defects = [...pd.defects, {
              name: defectName,
              count: 1,
              pct: 0,
              color: DEFECT_COLORS[defectName] || DEFAULT_DEFECT_COLOR,
            }];
          }
          // Recalculate pct
          const totalDefectCount = pd.defects.reduce((s, d) => s + d.count, 0);
          if (totalDefectCount > 0) {
            pd.defects = pd.defects.map((d) => ({
              ...d,
              pct: Math.round((d.count / totalDefectCount) * 100),
            }));
          }
        }

        // Accumulate measurement if available
        if (ng.actualValue != null && ng.expectedValue != null) {
          const measureParam = ng.pointName || `Point ${pointKey}`;
          pd.measurements = [
            {
              param: measureParam,
              val: String(ng.actualValue),
              spec: String(ng.expectedValue),
              status: ng.result === 'NG' ? 'ng' as const : 'ok' as const,
            },
            ...pd.measurements.slice(0, 19), // keep max 20
          ];
        }

        // Accumulate event
        pd.events = [
          {
            time: timeStr,
            desc: `${ng.result}: ${alert.error?.description || ng.pointName || 'Inspection'}`,
            type: ng.result === 'NG' ? 'fail' as const : 'pass' as const,
          },
          ...pd.events.slice(0, 19), // keep max 20
        ];

        // Update trend (defect rate over time, max 20 data points)
        pd.trend = [...pd.trend.slice(-19), pd.defectRate];

        // Collect error image URLs (convert relative → absolute)
        const fullImageUrl = ng.imageUrl ? imageService.buildImageUrl(ng.imageUrl) : '';
        if (fullImageUrl && !pd.errorImageUrls.includes(fullImageUrl)) {
          pd.errorImageUrls = [...pd.errorImageUrls.slice(-19), fullImageUrl]; // max 20
        }
        const fullRefUrl = ng.referenceImageUrl ? imageService.buildImageUrl(ng.referenceImageUrl) : '';
        if (fullRefUrl && !pd.referenceImageUrls.includes(fullRefUrl)) {
          pd.referenceImageUrls = [...pd.referenceImageUrls.slice(-9), fullRefUrl]; // max 10
        }

        stationPointMap[pointKey] = pd;
      });

      currentPointDataMap[stationId] = stationPointMap;

      // Track newly-alerted NG point IDs with timestamp for timed flash animation
      // Store both bare keys (legacy) AND product-scoped keys for accurate cross-product isolation
      const now2 = Date.now();
      const existingNewly = { ...(state.newlyAlertedPointIds[stationId] || {}) };
      alert.ngPoints.forEach((ng) => {
        if (ng.result !== 'NG') return;
        if (ng.pointId != null) {
          existingNewly[String(ng.pointId)] = now2;
          if (productCode) existingNewly[`${productCode}::${ng.pointId}`] = now2;
        }
        if (ng.pointName) {
          existingNewly[ng.pointName] = now2;
          if (productCode) existingNewly[`${productCode}::${ng.pointName}`] = now2;
        }
      });

      set((s) => ({
        stations: {
          ...s.stations,
          [stationId]: {
            ...station,
            points: updatedPoints,
            lastUpdated: new Date().toISOString(),
          },
        },
        alertedPointIds: { ...s.alertedPointIds, [stationId]: newAlertedIds },
        pointDataMap: currentPointDataMap,
        newlyAlertedPointIds: { ...s.newlyAlertedPointIds, [stationId]: existingNewly },
      }));

      // Debounced persist
      debouncedSave(() => get().saveStationData());
    } else {
      // Handle alerts without ngPoints (generic Error messages)
      // Still create events in pointDataMap so they show up in StationDetail
      const now = new Date();
      const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

      const currentPointDataMap = { ...state.pointDataMap };
      if (!currentPointDataMap[stationId]) {
        currentPointDataMap[stationId] = {};
      }
      const stationPointMap = { ...currentPointDataMap[stationId] };

      if (alert.measurementPoint?.id != null) {
        // Alert has measurementPoint — create point-specific event
        const productCode = alert.productModel?.code || '';
        const basePointKey = String(alert.measurementPoint.id);
        const pointKey = productCode ? `${productCode}::${basePointKey}` : basePointKey;
        const pd = stationPointMap[pointKey]
          ? { ...stationPointMap[pointKey] }
          : createDefaultPointData();

        pd.totalInspections += 1;
        pd.ngCount += 1;
        pd.defectRate = pd.totalInspections > 0
          ? (pd.ngCount / pd.totalInspections) * 100
          : 0;
        pd.lastAlertTime = alert.timestamp || now.toISOString();

        pd.events = [
          {
            time: timeStr,
            desc: `${alert.error?.type || 'Error'}: ${alert.error?.description || 'Unknown'}`,
            type: 'fail' as const,
          },
          ...pd.events.slice(0, 19),
        ];

        // Defects
        const defectName = alert.error?.type || alert.error?.description || 'Error';
        const existingDefect = pd.defects.find((d) => d.name === defectName);
        if (existingDefect) {
          pd.defects = pd.defects.map((d) =>
            d.name === defectName ? { ...d, count: d.count + 1, pct: 0 } : d,
          );
        } else {
          pd.defects = [...pd.defects, {
            name: defectName,
            count: 1,
            pct: 0,
            color: DEFECT_COLORS[defectName] || DEFAULT_DEFECT_COLOR,
          }];
        }
        const totalDefectCount = pd.defects.reduce((s, d) => s + d.count, 0);
        if (totalDefectCount > 0) {
          pd.defects = pd.defects.map((d) => ({
            ...d,
            pct: Math.round((d.count / totalDefectCount) * 100),
          }));
        }

        pd.trend = [...pd.trend.slice(-19), pd.defectRate];
        stationPointMap[pointKey] = pd;

        // Flag as alerted
        const newAlertedIds = new Set<string>(state.alertedPointIds[stationId] || []);
        newAlertedIds.add(pointKey);
        if (alert.measurementPoint.code) newAlertedIds.add(alert.measurementPoint.code);
        if (alert.measurementPoint.name) newAlertedIds.add(alert.measurementPoint.name);

        // Track newly-alerted for flash (both bare keys and product-scoped keys)
        const existingNewly = { ...(state.newlyAlertedPointIds[stationId] || {}) };
        const now2 = Date.now();
        existingNewly[pointKey] = now2;
        if (alert.measurementPoint.code) {
          existingNewly[alert.measurementPoint.code] = now2;
          if (productCode) existingNewly[`${productCode}::${alert.measurementPoint.code}`] = now2;
        }
        if (alert.measurementPoint.name) {
          existingNewly[alert.measurementPoint.name] = now2;
          if (productCode) existingNewly[`${productCode}::${alert.measurementPoint.name}`] = now2;
        }

        currentPointDataMap[stationId] = stationPointMap;

        set((s) => ({
          alertedPointIds: { ...s.alertedPointIds, [stationId]: newAlertedIds },
          pointDataMap: currentPointDataMap,
          newlyAlertedPointIds: { ...s.newlyAlertedPointIds, [stationId]: existingNewly },
        }));
      } else {
        // No measurementPoint — create station-level event
        const pointKey = '__station__';
        const pd = stationPointMap[pointKey]
          ? { ...stationPointMap[pointKey] }
          : createDefaultPointData();

        pd.totalInspections += 1;
        pd.ngCount += 1;
        pd.defectRate = pd.totalInspections > 0
          ? (pd.ngCount / pd.totalInspections) * 100
          : 0;
        pd.lastAlertTime = alert.timestamp || now.toISOString();

        pd.events = [
          {
            time: timeStr,
            desc: `${alert.error?.type || 'Error'}: ${alert.error?.description || 'Unknown'}`,
            type: 'fail' as const,
          },
          ...pd.events.slice(0, 19),
        ];

        stationPointMap[pointKey] = pd;
        currentPointDataMap[stationId] = stationPointMap;

        set((s) => ({
          pointDataMap: currentPointDataMap,
        }));
      }

      debouncedSave(() => get().saveStationData());
    }
  },

  /**
   * Xử lý Bulletin từ MQTT: cập nhật KPI cards
   */
  processBulletin: (bulletin: PeriodicBulletin) => {
    const stationId = String(bulletin.stationId);
    if (!stationId) return;

    const state = get();

    // Auto-create station if it doesn't exist (bulletin shouldn't be lost)
    let station = state.stations[stationId];
    if (!station) {
      // Check if an existing station matches by name (same dedup logic as processAlert)
      const bulletinName = bulletin.stationName;
      let existingKey: string | null = null;
      if (bulletinName) {
        for (const [key, s] of Object.entries(state.stations)) {
          if (key !== stationId && (key === bulletinName || s.config.stationName === bulletinName)) {
            existingKey = key;
            break;
          }
        }
      }
      // Fallback: match by numeric ID extraction from existing station keys
      // e.g., topic created "AVI-05", bulletin stationId is "5" → match by trailing digits
      if (!existingKey) {
        existingKey = findStationKeyByNumericId(state.stations, stationId);
      }

      if (existingKey) {
        const oldStation = state.stations[existingKey];
        station = {
          ...oldStation,
          config: { ...oldStation.config, stationId: stationId },
        };
        if (bulletinName && bulletinName !== 'Unknown') {
          station = { ...station, config: { ...station.config, stationName: bulletinName } };
        }
        const migrateKey = existingKey;
        set((s) => {
          const { [migrateKey]: _removed, ...restStations } = s.stations;
          const migrate = <T>(rec: Record<string, T>): Record<string, T> => {
            if (!(migrateKey in rec)) return rec;
            const { [migrateKey]: val, ...rest } = rec;
            return { ...rest, [stationId]: val };
          };
          return {
            stations: { ...restStations, [stationId]: station },
            availableStationIds: s.availableStationIds.map((id) => id === migrateKey ? stationId : id),
            activeStationId: s.activeStationId === migrateKey ? stationId : s.activeStationId,
            alertedPointIds: migrate(s.alertedPointIds),
            pointDataMap: migrate(s.pointDataMap),
            stationAlerts: migrate(s.stationAlerts),
            newlyAlertedPointIds: migrate(s.newlyAlertedPointIds),
            latestNgRateAlert: migrate(s.latestNgRateAlert),
          };
        });
        console.log(`[StationInspectionStore] Bulletin: Migrated station "${migrateKey}" → "${stationId}"`);
      } else {
        station = createDefaultStationData(stationId);
        station.config.stationName = bulletinName || stationId;
        set((s) => ({
          stations: { ...s.stations, [stationId]: station },
          availableStationIds: s.availableStationIds.includes(stationId)
            ? s.availableStationIds
            : [...s.availableStationIds, stationId],
        }));
      }
    } else {
      // Always update station name from bulletin if current name is just the ID
      const currentName = station.config.stationName;
      const bulletinName = bulletin.stationName;
      if (bulletinName && bulletinName !== stationId &&
          (currentName === stationId || currentName === `Station ${stationId}` ||
           extractNumericId(currentName) === stationId)) {
        station = { ...station, config: { ...station.config, stationName: bulletinName } };
        set((s) => ({
          stations: { ...s.stations, [stationId]: station },
        }));
      }
    }

    const stats = bulletin.statistics;
    if (!stats) return;

    // Map bulletin statistics → StationKPI
    const prevYield = station.kpi.firstPassYield;
    const newKpi: Partial<StationKPI> = {
      firstPassYield: stats.yieldRate,
      finalYield: stats.yieldRate, // finalYield ≈ yieldRate from bulletin
      output: stats.totalCount,
      retestRate: stats.totalCount > 0 ? ((stats.ngCount / stats.totalCount) * 100) : 0,
      yieldDelta: prevYield > 0 ? (stats.yieldRate - prevYield) : undefined,
    };

    // Also flag fail points from bulletin if available
    const newAlertedIds = new Set<string>(state.alertedPointIds[stationId] || []);
    // Update pointDataMap from bulletin failPoints for per-point statistics
    const existingPointData = { ...(state.pointDataMap[stationId] || {}) };
    if (bulletin.failPoints && bulletin.failPoints.length > 0) {
      const stationTotal = stats.totalCount || 0;
      bulletin.failPoints.forEach((fp) => {
        if (fp.pointId != null) newAlertedIds.add(String(fp.pointId));
        if (fp.pointName) newAlertedIds.add(fp.pointName);
        if (fp.pointCode) newAlertedIds.add(fp.pointCode);

        // Update per-point accumulated data from bulletin
        const pointKey = fp.pointId != null ? String(fp.pointId) : (fp.pointCode || fp.pointName);
        if (pointKey) {
          const prev = existingPointData[pointKey] || createDefaultPointData();
          existingPointData[pointKey] = {
            ...prev,
            totalInspections: stationTotal,
            ngCount: fp.ngCount ?? prev.ngCount,
            defectRate: fp.percentage ?? (stationTotal > 0 ? ((fp.ngCount || 0) / stationTotal * 100) : prev.defectRate),
            lastAlertTime: bulletin.timestamp || prev.lastAlertTime,
            errorImageUrls: (() => {
              const fullUrl = fp.imageUrl ? imageService.buildImageUrl(fp.imageUrl) : '';
              return fullUrl && !prev.errorImageUrls.includes(fullUrl)
                ? [...prev.errorImageUrls, fullUrl] : prev.errorImageUrls;
            })(),
            referenceImageUrls: (() => {
              const fullUrl = fp.referenceImageUrl ? imageService.buildImageUrl(fp.referenceImageUrl) : '';
              return fullUrl && !prev.referenceImageUrls.includes(fullUrl)
                ? [...prev.referenceImageUrls, fullUrl] : prev.referenceImageUrls;
            })(),
          };
        }
      });
    }

    // Track newly-alerted NG point IDs with timestamp for timed flash animation
    // (same pattern as processAlert — ensures NG effects auto-dismiss on restored bulletins)
    const nowBulletin = Date.now();
    const existingNewlyBulletin = { ...(state.newlyAlertedPointIds[stationId] || {}) };
    if (bulletin.failPoints && bulletin.failPoints.length > 0) {
      bulletin.failPoints.forEach((fp) => {
        if (fp.pointId != null) existingNewlyBulletin[String(fp.pointId)] = nowBulletin;
        if (fp.pointName) existingNewlyBulletin[fp.pointName] = nowBulletin;
        if (fp.pointCode) existingNewlyBulletin[fp.pointCode] = nowBulletin;
      });
    }

    set((s) => ({
      stations: {
        ...s.stations,
        [stationId]: {
          ...station,
          kpi: { ...station.kpi, ...newKpi },
          lastUpdated: new Date().toISOString(),
          isLive: true,
        },
      },
      alertedPointIds: { ...s.alertedPointIds, [stationId]: newAlertedIds },
      pointDataMap: { ...s.pointDataMap, [stationId]: existingPointData },
      newlyAlertedPointIds: { ...s.newlyAlertedPointIds, [stationId]: existingNewlyBulletin },
    }));

    // Debounced persist
    debouncedSave(() => get().saveStationData());
  },
  saveStationData: async () => {
    try {
      const { stations, stationAlerts, pointDataMap, availableStationIds, alertedPointIds, latestNgRateAlert } = get();
      // Convert Set<string> to string[] for serialization
      const serializedAlertedIds: Record<string, string[]> = {};
      for (const [sid, idSet] of Object.entries(alertedPointIds)) {
        serializedAlertedIds[sid] = Array.from(idSet);
      }
      const data = {
        stations,
        stationAlerts,
        pointDataMap,
        availableStationIds,
        alertedPointIds: serializedAlertedIds,
        latestNgRateAlert,
        savedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STATION_STORAGE_KEY, JSON.stringify(data));
      console.log('[StationInspectionStore] Data saved');
    } catch (error) {
      console.error('[StationInspectionStore] Save error:', error);
    }
  },

  /**
   * Load station inspection data from AsyncStorage (auto-restore after crash)
   */
  loadStationData: async () => {
    try {
      const raw = await AsyncStorage.getItem(STATION_STORAGE_KEY);
      if (!raw) {
        console.log('[StationInspectionStore] No saved data found');
        return;
      }
      const data = JSON.parse(raw);

      // Check if data is from today (clear stale data from previous day)
      if (data.savedAt) {
        const savedDate = new Date(data.savedAt).toDateString();
        const today = new Date().toDateString();
        if (savedDate !== today) {
          console.log('[StationInspectionStore] Saved data is from', savedDate, '- clearing stale data');
          await AsyncStorage.removeItem(STATION_STORAGE_KEY);
          return;
        }
      }

      // Reconstruct Set<string> from string[]
      const restoredAlertedIds: Record<string, Set<string>> = {};
      if (data.alertedPointIds) {
        for (const [sid, arr] of Object.entries(data.alertedPointIds)) {
          restoredAlertedIds[sid] = new Set(arr as string[]);
        }
      }

      // Ensure availableStationIds includes all keys from stations map
      // (fixes cases where stations were created by processAlert but IDs weren't persisted)
      const savedIds: string[] = data.availableStationIds || [];
      const stationsObj = data.stations || {};
      const allStationKeys = Object.keys(stationsObj);
      const mergedIds = Array.from(new Set([...savedIds, ...allStationKeys]));

      // Populate newlyAlertedPointIds with current timestamps for restored alerted points
      // so NG effects (flash, bubble, explosion) auto-dismiss after ngFlashDurationMs
      const nowRestore = Date.now();
      const restoredNewlyAlerted: Record<string, Record<string, number>> = {};
      for (const [sid, idSet] of Object.entries(restoredAlertedIds)) {
        const newlyMap: Record<string, number> = {};
        idSet.forEach((pointKey) => { newlyMap[pointKey] = nowRestore; });
        restoredNewlyAlerted[sid] = newlyMap;
      }

      set({
        stations: stationsObj,
        stationAlerts: data.stationAlerts || {},
        pointDataMap: data.pointDataMap || {},
        availableStationIds: mergedIds,
        alertedPointIds: restoredAlertedIds,
        newlyAlertedPointIds: restoredNewlyAlerted,
        latestNgRateAlert: data.latestNgRateAlert || {},
      });
      console.log('[StationInspectionStore] Data restored from AsyncStorage');
    } catch (error) {
      console.error('[StationInspectionStore] Load error:', error);
    }
  },

  /**
   * Xóa flag alerted points cho station
   */
  clearAlertedPoints: (stationId: string) => {
    set((s) => {
      const updated = { ...s.alertedPointIds };
      delete updated[stationId];
      return { alertedPointIds: updated };
    });
  },

  /**
   * Xóa latest NG Rate alert cho station
   */
  clearNgRateAlert: (stationId: string) => {
    set((s) => {
      const updated = { ...s.latestNgRateAlert };
      delete updated[stationId];
      return { latestNgRateAlert: updated };
    });
  },

  /**
   * Xóa recent alerts cho station
   */
  clearStationAlerts: (stationId: string) => {
    set((s) => {
      const updated = { ...s.stationAlerts };
      delete updated[stationId];
      return { stationAlerts: updated };
    });
  },

  clearNewlyAlertedPoints: (stationId: string) => {
    set((s) => {
      const updated = { ...s.newlyAlertedPointIds };
      delete updated[stationId];
      return { newlyAlertedPointIds: updated };
    });
  },

  clearExpiredNewlyAlerted: (stationId: string, durationMs: number, clearAlertedPoints?: boolean) => {
    const current = get().newlyAlertedPointIds[stationId];
    if (!current) return;
    const now = Date.now();
    const remaining: Record<string, number> = {};
    const expiredKeys = new Set<string>();
    let changed = false;
    for (const [key, ts] of Object.entries(current)) {
      if (now - ts < durationMs) {
        remaining[key] = ts;
      } else {
        changed = true;
        expiredKeys.add(key);
      }
    }
    if (changed) {
      // When clearAlertedPoints=true, also remove expired points from alertedPointIds
      // so they revert to normal green (not just stop blinking)
      const currentAlerted = get().alertedPointIds[stationId];
      let newAlerted = currentAlerted;
      if (clearAlertedPoints && currentAlerted && expiredKeys.size > 0) {
        newAlerted = new Set(currentAlerted);
        for (const key of expiredKeys) {
          const bareKey = key.includes('::') ? key.split('::')[1] : key;
          newAlerted.delete(key);
          newAlerted.delete(bareKey);
        }
      }
      set((s) => ({
        newlyAlertedPointIds: {
          ...s.newlyAlertedPointIds,
          [stationId]: remaining,
        },
        ...(clearAlertedPoints ? {
          alertedPointIds: {
            ...s.alertedPointIds,
            [stationId]: newAlerted ?? new Set<string>(),
          },
        } : {}),
      }));
    }
  },

  fetchStationNames: async () => {
    try {
      set({ error: null });
      // Try REST endpoint first, fallback to hierarchy API
      let stationList = await stationService.getStationList();
      if (stationList.length === 0) {
        stationList = await stationService.getStationListFromHierarchy();
      }

      // Third fallback: use hierarchy cache (populated by App.tsx init)
      if (stationList.length === 0) {
        const cachedFactories = hierarchyService.getCachedTree();
        if (cachedFactories.length > 0) {
          console.log('[StationInspectionStore] Using cached hierarchy tree as fallback');
          get().populateFromHierarchy(cachedFactories);
          return;
        }
      }

      if (stationList.length === 0) return;

      set((s) => {
        const updatedStations = { ...s.stations };
        const updatedIds = [...s.availableStationIds];
        let idsChanged = false;

        for (const cfg of stationList) {
          const sid = cfg.stationId;
          if (updatedStations[sid]) {
            const current = updatedStations[sid];
            // Only update if current name is still the raw ID
            if (current.config.stationName === sid || current.config.stationName === `Station ${sid}`) {
              updatedStations[sid] = {
                ...current,
                config: { ...current.config, stationName: cfg.stationName || sid },
              };
            }
          } else {
            // Try matching existing station by numeric ID extraction
            // e.g., API returns stationId "5", store has "AVI-05"
            const matchedKey = findStationKeyByNumericId(updatedStations, sid);
            if (matchedKey) {
              const current = updatedStations[matchedKey];
              const curName = current.config.stationName;
              if (curName === matchedKey || curName === `Station ${matchedKey}` ||
                  extractNumericId(curName) === sid) {
                updatedStations[matchedKey] = {
                  ...current,
                  config: { ...current.config, stationName: cfg.stationName || matchedKey, apiStationId: sid },
                };
              } else {
                // Name already set but store the numeric API ID mapping
                updatedStations[matchedKey] = {
                  ...current,
                  config: { ...current.config, apiStationId: sid },
                };
              }
            } else {
              // Station not in store yet — create default data with API name
              const newStation = createDefaultStationData(sid);
              newStation.config.stationName = cfg.stationName || sid;
              if (cfg.factoryId) newStation.config.factoryId = cfg.factoryId;
              if (cfg.workshopId) newStation.config.workshopId = cfg.workshopId;
              if (cfg.lineId) newStation.config.lineId = cfg.lineId;
              updatedStations[sid] = newStation;
              if (!updatedIds.includes(sid)) {
                updatedIds.push(sid);
                idsChanged = true;
              }
            }
          }
        }

        return {
          stations: updatedStations,
          ...(idsChanged ? { availableStationIds: updatedIds } : {}),
        };
      });
      console.log(`[StationInspectionStore] Station names updated from API (${stationList.length} stations)`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[StationInspectionStore] Failed to fetch station names:', msg);
      // Only set error if we still have no stations (don't overwrite a working state)
      if (get().availableStationIds.length === 0) {
        set({ error: msg });
      }
    }
  },

  populateFromHierarchy: (factories: HierarchyFactory[]) => {
    const stationConfigs: Array<{
      stationId: string; stationName: string;
      factoryId: string; workshopId: string; lineId: string;
    }> = [];

    for (const factory of factories) {
      for (const ws of factory.workshops ?? []) {
        for (const line of ws.lines ?? []) {
          for (const st of line.stations ?? []) {
            stationConfigs.push({
              stationId: String(st.id),
              stationName: st.name || st.code || String(st.id),
              factoryId: String(factory.id),
              workshopId: String(ws.id),
              lineId: String(line.id),
            });
          }
        }
      }
    }

    if (stationConfigs.length === 0) return;

    set((s) => {
      const updatedStations = { ...s.stations };
      const updatedIds = [...s.availableStationIds];
      let idsChanged = false;

      for (const cfg of stationConfigs) {
        const sid = cfg.stationId;
        if (!updatedStations[sid]) {
          const newStation = createDefaultStationData(sid);
          newStation.config.stationName = cfg.stationName;
          newStation.config.factoryId = cfg.factoryId;
          newStation.config.workshopId = cfg.workshopId;
          newStation.config.lineId = cfg.lineId;
          updatedStations[sid] = newStation;
          if (!updatedIds.includes(sid)) {
            updatedIds.push(sid);
            idsChanged = true;
          }
        }
      }

      return {
        stations: updatedStations,
        ...(idsChanged ? { availableStationIds: updatedIds } : {}),
      };
    });
    console.log(`[StationInspectionStore] Populated ${stationConfigs.length} stations from hierarchy`);
  },
}));

// ============================================
// SELECTORS
// ============================================

export const selectActiveStation = (state: StationInspectionStore) => {
  if (!state.activeStationId) return null;
  return state.stations[state.activeStationId] || null;
};

export const selectActiveStationPoints = (state: StationInspectionStore) => {
  const station = selectActiveStation(state);
  return station?.points || (EMPTY_ARRAY as InspectionPoint[]);
};

export const selectAlertedPointIds = (state: StationInspectionStore) => {
  if (!state.activeStationId) return EMPTY_SET;
  return state.alertedPointIds[state.activeStationId] || EMPTY_SET;
};

export const selectLatestNgRateAlert = (state: StationInspectionStore) => {
  if (!state.activeStationId) return null;
  return state.latestNgRateAlert[state.activeStationId] || null;
};

export const selectStationAlerts = (state: StationInspectionStore) => {
  if (!state.activeStationId) return EMPTY_ARRAY as Alert[];
  return state.stationAlerts[state.activeStationId] || (EMPTY_ARRAY as Alert[]);
};

export const selectNewlyAlertedPointIds = (state: StationInspectionStore) => {
  if (!state.activeStationId) return EMPTY_RECORD as Record<string, number>;
  return state.newlyAlertedPointIds[state.activeStationId] || (EMPTY_RECORD as Record<string, number>);
};

export const selectSelectedPoint = (state: StationInspectionStore) => {
  const station = selectActiveStation(state);
  if (!station || !state.selectedPointId) return null;
  return station.points.find((p) => p.id === state.selectedPointId) || null;
};

export const selectStationKPI = (state: StationInspectionStore) => {
  const station = selectActiveStation(state);
  return station?.kpi || null;
};

export const selectAvailableStations = (state: StationInspectionStore) =>
  state.availableStationIds;

const normalizeApiStationId = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10));
  const m = trimmed.match(/\d+/);
  return m ? String(parseInt(m[0], 10)) : null;
};

/** Resolve activeStationId to numeric API ID (e.g., "AVI-01" → "1") */
export const selectApiStationId = (state: StationInspectionStore): string | null => {
  if (!state.activeStationId) return null;
  const station = state.stations[state.activeStationId];
  return normalizeApiStationId(station?.config?.apiStationId || state.activeStationId);
};

export const selectPointCounts = (state: StationInspectionStore) => {
  const station = selectActiveStation(state);
  if (!station) return EMPTY_COUNTS;
  const points = station.points;
  if (points.length === 0) return EMPTY_COUNTS;
  return {
    all: points.length,
    fail: points.filter((p) => p.status === 'fail').length,
    warn: points.filter((p) => p.status === 'warn').length,
    pass: points.filter((p) => p.status === 'pass').length,
  };
};

export default useStationInspectionStore;
