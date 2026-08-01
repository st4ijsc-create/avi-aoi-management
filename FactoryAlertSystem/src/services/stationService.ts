/**
 * Factory Alert System - Station Inspection Service
 * Service để lấy dữ liệu trạm kiểm tra từ API server
 * Bao gồm: ảnh tham chiếu, cấu hình điểm đo, thông tin trạm
 *
 * Product API: tRPC endpoints at /api/trpc/publicProductApi.*
 * Machine API: tRPC endpoints at /api/trpc/machineApi.*
 * Auth: apiKey parameter inside tRPC input JSON
 */

import { useSettingsStore } from '../store/settingsStore';
import {
  StationConfig,
  InspectionPoint,
  StationInspectionData,
  StationKPI,
  Product,
  ProductModel,
  StationKPIParams,
  StationKPIDetailResponse,
  TrendDataParams,
  TrendDataResponse,
} from '../types';
import { authService } from './authService';
import { hierarchyService, HierarchyFactory } from './hierarchyService';
import { debugLogger } from '../utils/debugLogger';
import { requireServerBaseUrl } from './serverConfig';

/**
 * Raw station item from API: GET /api/external/stations
 */
interface ApiStation {
  id: number;
  code: string;
  name: string;
  description?: string;
  location?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Response từ API: GET /api/external/stations
 */
interface StationListResponse {
  success: boolean;
  data: ApiStation[];
}

/**
 * Response từ API: GET /api/external/stations/:id/reference-image
 */
interface ReferenceImageResponse {
  success: boolean;
  data: {
    stationId: number;
    referenceImage: {
      imageUrl: string;
      width?: number;
      height?: number;
    };
  };
}

/**
 * Raw inspection point item from API: GET /api/external/stations/:id/inspection-points
 */
interface ApiStationInspectionPoint {
  id: number;
  code: string;
  name: string;
  description?: string;
  measurementType?: string;
  unit?: string;
  lowerLimit?: number | null;
  upperLimit?: number | null;
  nominalValue?: number | null;
  referenceImageUrl?: string;
  machineId?: number;
  machineCode?: string;
  machineName?: string;
  positionX?: number;
  positionY?: number;
  radius?: number;
  normalizedX?: number;
  normalizedY?: number;
  normalizedRadius?: number;
  imageWidth?: number;
  imageHeight?: number;
  cropWidth?: number;
  cropHeight?: number;
  workstationId?: number;
  productModelId?: number;
  imageDisplayMode?: string;
}

/**
 * Response từ API: GET /api/external/stations/:id/inspection-points
 */
interface InspectionPointsResponse {
  success: boolean;
  total?: number;
  data: ApiStationInspectionPoint[];
}

// ============================================
// tRPC Public Product API types (/api/trpc/publicProductApi.*)
// ============================================

/** Product item from tRPC publicProductApi.listProducts */
interface ApiProduct {
  id: number;
  code: string;
  name: string;
  description?: string;
  category?: string;
  productLine?: string;
  variant?: string;
  lifecycleStatus?: string;
  referenceImageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  targetYieldRate?: string | number;
  minYieldRate?: string | number;
}

/** Measurement point from tRPC publicProductApi.getMeasurementPoints */
export interface ApiMeasurementPoint {
  id: number;
  code: string;
  name: string;
  description?: string;
  measurementType?: string;
  unit?: string;
  lowerLimit?: string | number | null;
  upperLimit?: string | number | null;
  nominalValue?: string | number | null;
  positionX?: number;
  positionY?: number;
  radius?: number;
  /** Normalized X coordinate (0.0–1.0) = positionX / imageWidth */
  normalizedX?: number | string;
  /** Normalized Y coordinate (0.0–1.0) = positionY / imageHeight */
  normalizedY?: number | string;
  /** Normalized radius (0.0–1.0) */
  normalizedRadius?: number | string;
  referenceImageUrl?: string;
  cropWidth?: number;
  cropHeight?: number;
  /** Image width the coordinates are defined against (from machineApi.getPoints model or API) */
  imageWidth?: number;
  /** Image height the coordinates are defined against (from machineApi.getPoints model or API) */
  imageHeight?: number;
  orderIndex?: number;
  lastModifiedAt?: string;
  imageHash?: string;
  isActive?: boolean;
  workstationId?: number | null;
  workstationCode?: string;
}

/** Product detail from tRPC publicProductApi.getProductByCode / getProductById */
interface ApiProductDetail {
  product: ApiProduct;
  measurementPoints: ApiMeasurementPoint[];
}

/**
 * Product catalog item — extends Product to add API-specific fields
 */
export interface ProductCatalogItem extends Product {
  code: string;
  description?: string;
  category?: string;
  lifecycleStatus?: string;
  referenceImageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  targetYieldRate?: number;
  minYieldRate?: number;
}

/**
 * Ảnh sản phẩm (reference + fail)
 */
export interface ProductImageItem {
  id: string;
  pointId?: string;
  pointName?: string;
  type: 'reference' | 'fail' | 'sample';
  imageUrl: string;
  label?: string;
  supportsResize?: boolean;
}

// React Native (Hermes) defines URLSearchParams.set but throws
// "not implemented" when called.  Detect this at runtime with a
// try/catch instead of a simple existence check.
if (typeof URLSearchParams !== 'undefined') {
  try {
    const _testQ = new URLSearchParams();
    _testQ.set('_polyfill_test', '1');
    // If we get here, .set() works natively — no polyfill needed.
  } catch {
    // .set() exists but throws → replace with .append()-based shim.
    // Our usage always creates a fresh instance and sets each key once,
    // so .append() is functionally equivalent.
    URLSearchParams.prototype.set = function (name: string, value: string) {
      this.append(name, value);
    };
    console.log('[Polyfill] URLSearchParams.set replaced with append-based shim');
  }
}

/**
 * Lấy base URL từ settings.
 * MB4 (doc 27): no hardcoded fallback IP — throws when unconfigured so every
 * fetch in this service rejects (all call sites already handle rejection)
 * instead of silently calling a stranger's LAN address.
 */
function getBaseUrl(): string {
  return requireServerBaseUrl();
}

function getApiKey(): string {
  const settings = useSettingsStore.getState().settings;
  return settings.app.apiKey || '';
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = getApiKey();
  const authHeaders = authService.getAuthHeaders(apiKey);
  console.log('[StationService] buildHeaders — apiKey:', apiKey ? `${apiKey.substring(0, 12)}... (len=${apiKey.length})` : 'EMPTY', ', authHeaders keys:', Object.keys(authHeaders));
  Object.assign(headers, authHeaders);
  return headers;
}

/**
 * Build headers for /api/external/* endpoints.
 * Only sends x-master-key and x-api-key — avoids stale Bearer/Cookie
 * that could cause server to reject before checking the API key.
 */
function buildExternalHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['x-master-key'] = apiKey;
    headers['x-api-key'] = apiKey;
  }
  return headers;
}

/**
 * Server time offset (ms): serverTime - phoneTime.
 * Add this to Date.now() to get a date aligned with the server clock.
 * Updated once via fetchServerTimeOffset(), then reused for all date computations.
 */
let _serverTimeOffsetMs = 0;
let _serverTimeOffsetFetched = false;

/** Return a Date object representing "now" according to the server clock */
export function getServerNow(): Date {
  return new Date(Date.now() + _serverTimeOffsetMs);
}

/** Fetch server time and compute offset. Called once at app init. */
async function fetchServerTimeOffset(): Promise<void> {
  if (_serverTimeOffsetFetched) return;
  try {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const t0 = Date.now();
    const resp = await fetch(`${baseUrl}/api/external/server-time`, { method: 'GET', headers: buildExternalHeaders() });
    const t1 = Date.now();
    if (!resp.ok) {
      console.warn('[StationService] fetchServerTimeOffset HTTP', resp.status);
      return;
    }
    const body = await resp.json();
    if (body?.serverTime) {
      const serverMs = new Date(body.serverTime).getTime();
      const rtt = t1 - t0;
      _serverTimeOffsetMs = serverMs - (t0 + rtt / 2);
      _serverTimeOffsetFetched = true;
      console.log('[StationService] Server time offset:', Math.round(_serverTimeOffsetMs / 1000), 'seconds',
        '(server:', body.serverTime, ', phone:', new Date().toISOString(), ')');
    }
  } catch (e) {
    console.warn('[StationService] fetchServerTimeOffset error:', e instanceof Error ? e.message : e);
  }
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * Extract image dimensions from a base64 data URI (PNG or JPEG).
 * Returns { width, height } or null if unable to parse.
 */
function extractImageDimensions(dataUri: string): { width: number; height: number } | null {
  try {
    if (!dataUri.startsWith('data:image/')) return null;
    const base64Data = dataUri.split(',')[1];
    if (!base64Data) return null;

    // Decode first 32 bytes — enough for PNG IHDR or JPEG SOF
    const raw = atob(base64Data.substring(0, 64)); // ~48 decoded bytes
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    // PNG: bytes 0-7 = signature, 8-15 = IHDR chunk, 16-19 = width, 20-23 = height
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      if (width > 0 && height > 0) return { width, height };
    }

    // JPEG: scan for SOF0 (0xFF 0xC0) marker — height at offset+5, width at offset+7
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      // Need more data for JPEG — decode up to 64KB to find SOF marker
      const jpegRaw = atob(base64Data.substring(0, 87400)); // ~65KB decoded
      const jpegBytes = new Uint8Array(jpegRaw.length);
      for (let i = 0; i < jpegRaw.length; i++) jpegBytes[i] = jpegRaw.charCodeAt(i);
      for (let i = 0; i < jpegBytes.length - 9; i++) {
        if (jpegBytes[i] === 0xFF && (jpegBytes[i + 1] === 0xC0 || jpegBytes[i + 1] === 0xC2)) {
          const height = (jpegBytes[i + 5] << 8) | jpegBytes[i + 6];
          const width = (jpegBytes[i + 7] << 8) | jpegBytes[i + 8];
          if (width > 0 && height > 0) return { width, height };
        }
      }
    }
  } catch (e) {
    console.warn('[StationService] extractImageDimensions error:', e);
  }
  return null;
}

// ============================================
// External Statistics API types
// GET /api/external/statistics/measurement-points
// ============================================

// ============================================
// External Inspection API types
// GET /api/external/inspections/*
// ============================================

export interface InspectionSummaryParams {
  stationId?: number | string;
  productModelId?: number | string;
  productCode?: string;
  startDate: string;
  endDate: string;
}

export interface InspectionSummaryDetail {
  machineId: number;
  machineCode: string;
  machineName: string;
  stationId: number;
  stationCode: string;
  stationName: string;
  productModelId: number;
  productCode: string;
  productName: string;
  totalInspections: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  yieldRate: number;
  firstInspection?: string;
  lastInspection?: string;
  avgCycleTime?: number;
}

export interface InspectionSummaryData {
  dateRange: { startDate: string; endDate: string };
  totals: {
    totalInspections: number;
    okCount: number;
    ngCount: number;
    ntfCount: number;
    yieldRate: number;
  };
  details: InspectionSummaryDetail[];
}

export interface InspectionSummaryResponse {
  success: boolean;
  data: InspectionSummaryData;
}

export interface InspectionTrendParams {
  stationId?: number | string;
  productModelId?: number | string;
  productCode?: string;
  startDate: string;
  endDate: string;
  groupBy?: 'hour' | 'day' | 'week';
  pointDefId?: number | string;
}

export interface InspectionTrendDataPoint {
  period: string;
  totalInspections?: number;
  totalCount?: number;
  okCount: number;
  ngCount: number;
  ntfCount?: number;
  yieldRate?: number;
  ngRate?: number;
  avgValue?: number;
  minValue?: number;
  maxValue?: number;
}

export interface InspectionTrendResponse {
  success: boolean;
  data: {
    groupBy: string;
    dateRange: { startDate: string; endDate: string };
    pointDefId?: number;
    trend: InspectionTrendDataPoint[];
  };
}

export interface DefectParetoParams {
  stationId?: number | string;
  productModelId?: number | string;
  productCode?: string;
  startDate: string;
  endDate: string;
  limit?: number;
}

export interface DefectParetoItem {
  pointDefId: number;
  pointCode: string;
  pointName: string;
  measurementType: string;
  ngCount: number;
  totalCount: number;
  ngRate: number;
  percentage: number;
  cumulativePercentage: number;
}

export interface DefectParetoResponse {
  success: boolean;
  data: {
    dateRange: { startDate: string; endDate: string };
    totalNGCount: number;
    items: DefectParetoItem[];
  };
}

export interface InspectionImagesParams {
  stationId?: number | string;
  productModelId?: number | string;
  productCode?: string;
  pointDefId?: number | string;
  result?: 'OK' | 'NG' | 'NTF' | 'ALL';
  startDate: string;
  endDate: string;
  limit?: number;
  offset?: number;
}

export interface InspectionImageItem {
  measurementResultId: number;
  pointDefId: number;
  pointCode: string;
  pointName: string;
  result: 'OK' | 'NG';
  measuredValue?: string;
  measuredValueText?: string;
  imageUrl: string;
  remark?: string;
  inspectionId: number;
  serialNumber?: string;
  inspectionResult?: string;
  inspectionTime?: string;
  productModelId?: number;
  productCode?: string;
  productName?: string;
  machineId?: number;
  machineCode?: string;
  stationId?: number;
  stationCode?: string;
  stationName?: string;
}

export interface InspectionImagesResponse {
  success: boolean;
  data: {
    dateRange: { startDate: string; endDate: string };
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    images: InspectionImageItem[];
  };
}

export interface InspectionEventsParams {
  stationId?: number | string;
  machineId?: number | string;
  packageId?: string;
  eventType?: string;
  startDate: string;
  endDate: string;
  limit?: number;
  offset?: number;
}

export interface InspectionEventItem {
  id: number;
  packageId?: string;
  machineId?: number;
  machineCode?: string;
  machineName?: string;
  stationId?: number;
  stationCode?: string;
  event: string;
  level?: string;
  message?: string;
  detail?: string;
  source?: string;
  fileSizeBytes?: number;
  createdAt: string;
}

export interface InspectionEventsResponse {
  success: boolean;
  data: {
    dateRange: { startDate: string; endDate: string };
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    events: InspectionEventItem[];
  };
}

export interface InspectionMeasurementsParams {
  pointDefId: number | string;
  stationId?: number | string;
  productModelId?: number | string;
  productCode?: string;
  startDate: string;
  endDate: string;
  limit?: number;
  offset?: number;
}

export interface InspectionMeasurementItem {
  measurementResultId: number;
  measuredValue?: string;
  measuredValueText?: string;
  result: 'OK' | 'NG';
  remark?: string;
  hasImage?: boolean;
  imageUrl?: string;
  inspectionId: number;
  serialNumber?: string;
  inspectionResult?: string;
  inspectionTime?: string;
  machineId?: number;
  machineCode?: string;
  stationId?: number;
  stationCode?: string;
}

export interface InspectionMeasurementsResponse {
  success: boolean;
  data: {
    pointDef: {
      id: number;
      code: string;
      name: string;
      measurementType: string;
      unit?: string;
      lowerLimit?: number;
      upperLimit?: number;
      nominalValue?: number;
    };
    dateRange: { startDate: string; endDate: string };
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    measurements: InspectionMeasurementItem[];
  };
}

// ============================================
// Sync API v2.0 types (machineApi mutations + queries)
// ============================================

/** Input point for syncMeasurementPoints */
export interface SyncPointInput {
  code: string;
  name: string;
  measurementType?: string;
  unit?: string;
  lowerLimit?: number | string | null;
  upperLimit?: number | string | null;
  nominalValue?: number | string | null;
  positionX?: number;
  positionY?: number;
  radius?: number;
  normalizedX?: number;
  normalizedY?: number;
  normalizedRadius?: number;
  imageBase64?: string;
}

/** Response from machineApi.syncMeasurementPoints */
export interface SyncMeasurementPointsResponse {
  pointsConfigVersion: number;
  total: number;
  created: number;
  updated: number;
  failed: number;
  coordTransformed: boolean;
  serverImageWidth: number;
  serverImageHeight: number;
  points: Array<{
    code: string;
    id: number;
    action: 'created' | 'updated' | 'skipped';
    coordTransformed?: boolean;
  }>;
  errors?: Array<{
    code: string;
    error: string;
  }>;
}

/** Response from machineApi.syncProductImage */
export interface SyncProductImageResponse {
  imageUrl?: string;
  imageKey?: string;
  imageHash: string;
  imageSkipped: boolean;
}

/** Response from machineApi.syncPointImage */
export interface SyncPointImageResponse {
  referenceImageUrl: string;
  referenceImageKey: string;
}

/** Response from machineApi.getSyncHistory */
export interface SyncHistoryLog {
  id: number;
  syncOperation: string;
  syncStatus: string;
  pointsSynced?: number;
  pointsCreated?: number;
  pointsUpdated?: number;
  durationMs?: number;
  createdAt: string;
}

/** Full result from getPointImageData including position data */
export interface PointImageData {
  url: string;
  position?: {
    x: number;
    y: number;
    radius: number;
    cropWidth?: number;
    cropHeight?: number;
  };
  productReferenceImageUrl?: string;
}

export interface MpStatisticsImage {
  id: string;
  url: string;
  type: 'OK' | 'NG';
  capturedAt: string;
  measurementPointId: number;
  measurementPointCode: string;
}

export interface MpStatisticsItem {
  measurementPointId: number;
  measurementPointCode: string;
  measurementPointName: string;
  totalCount: number;
  okCount: number;
  ngCount: number;
  ngRate: number;
  minValue: number | null;
  maxValue: number | null;
  avgValue: number | null;
  stdDev: number | null;
  images?: MpStatisticsImage[];
  /** Per-period NG rate values from C2 trend API (for sparkline chart) */
  trendPeriods?: number[];
}

export interface MpStatisticsResponse {
  success: boolean;
  data: {
    statistics: MpStatisticsItem[];
    summary: {
      totalMeasurementPoints: number;
      totalInspections: number;
      overallNgRate: number;
    };
    filters: {
      productCode?: string;
      productModelId?: number;
      startDate: string;
      endDate: string;
      includeImages: boolean;
    };
  };
}

export interface MpStatisticsParams {
  productCode?: string;
  productModelId?: number;
  pointDefId?: number | string;
  stationId?: number | string;
  startDate: string;
  endDate: string;
  includeImages?: boolean;
}

// ============================================
// Point Images API types (publicProductApi.getPointImagesByStation)
// ============================================

export interface PointImageItem {
  id: string;
  imageUrl: string;
  result: 'OK' | 'NG' | 'NTF';
  inspectedAt: string;
  serialNumber?: string;
  productCode?: string;
  pointCode?: string;
  pointName?: string;
}

export interface PointImagesByStationParams {
  stationId?: number | string;
  pointDefId?: number | string;
  productModelId?: number | string;
  productCode?: string;
  result?: 'OK' | 'NG' | 'NTF' | 'ALL';
  startDate: string;
  endDate: string;
  limit?: number;
  offset?: number;
}

export interface PointImagesByStationResponse {
  success: boolean;
  data: {
    images: PointImageItem[];
    pagination: {
      total: number;
      limit: number;
      offset: number;
    };
  };
}

/**
 * Response từ API: GET /api/external/stations/resolve-topic
 */
export interface ResolveTopicResponse {
  success: boolean;
  data: {
    station: { id: number; code: string; name: string; description?: string };
    line: { id: number; code: string; name: string };
    workshop: { id: number; code: string; name: string };
    factory: { id: number; code: string; name: string };
    mqttTopic: string;
    messageType: string;
  };
}

// ============================================
// A6. Station Products API types
// ============================================

export interface StationProductItem {
  id: number;
  code: string;
  name: string;
  description?: string;
  category?: string;
  lifecycleStatus?: string;
  hasReferenceImage?: boolean;
  imageWidth?: number;
  imageHeight?: number;
  targetYieldRate?: number;
  minYieldRate?: number;
  machines?: Array<{ id: number; code: string; name: string; priority?: number }>;
}

export interface StationProductsResponse {
  success: boolean;
  data: {
    station: { id: number; code: string; name: string };
    products: StationProductItem[];
    total: number;
  };
}

// ============================================
// A7. Station Statistics (KPI) API types
// ============================================

export interface StationStatisticsResponse {
  success: boolean;
  data: {
    station: { id: number; code: string; name: string };
    factory?: { id: number; code: string; name: string };
    workshop?: { id: number; code: string; name: string };
    line?: { id: number; code: string; name: string };
    dateRange: { startDate: string; endDate: string };
    machineCount?: number;
    totalInspections: number;
    okCount: number;
    ngCount: number;
    ntfCount: number;
    firstPassYield: number;
    finalYield: number;
    retestRate: number;
    yieldChange: number;
  };
}

// ============================================
// A8. Station Measurement Stats API types
// ============================================

export interface StationMeasurementStatPoint {
  pointDefId: number;
  pointCode: string;
  pointName: string;
  measurementType?: string;
  productModelId?: number;
  productCode?: string;
  productName?: string;
  totalChecks: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  ngRate: number;
  avgValue?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  ngImageCount?: number;
  trend?: Array<{
    period: string;
    totalChecks: number;
    okCount: number;
    ngCount: number;
    ngRate: number;
    avgValue?: number | null;
  }>;
}

export interface StationMeasurementStatsResponse {
  success: boolean;
  data: {
    dateRange: { startDate: string; endDate: string };
    station: { id: number; code: string; name: string };
    groupBy?: string;
    points: StationMeasurementStatPoint[];
  };
}

export interface StationMeasurementStatsParams {
  startDate: string;
  endDate: string;
  groupBy?: 'none' | 'hour' | 'day' | 'week';
  productModelId?: number | string;
  productCode?: string;
}

// ============================================
// A9. Station Fail History API types
// ============================================

export interface StationFailHistoryItem {
  inspectionId: number;
  barcode: string;
  inspectionTime: string;
  productModelId?: number;
  machineId?: number;
  machineCode?: string;
  machineName?: string;
  imageWidth?: number;
  imageHeight?: number;
  failedPoints: Array<{
    pointDefId: number;
    pointCode: string;
    pointName: string;
    measuredValue?: string;
    imageUrl?: string;
    positionX?: number;
    positionY?: number;
    radius?: number;
    normalizedX?: number;
    normalizedY?: number;
    normalizedRadius?: number;
    workstationId?: number;
  }>;
}

export interface StationFailHistoryResponse {
  success: boolean;
  data: {
    dateRange: { startDate: string; endDate: string };
    pagination: { total: number; limit: number; offset: number; hasMore?: boolean };
    inspections: StationFailHistoryItem[];
  };
}

export interface StationFailHistoryParams {
  startDate: string;
  endDate: string;
  limit?: number;
  offset?: number;
  productModelId?: number | string;
  productCode?: string;
}

// ============================================
// A10. Station Point Detail API types
// ============================================

export interface StationPointDetailErrorImage {
  id: number;
  imageUrl: string;
  measuredValue: string;
  result: string;
  inspectionTime: string;
  serialNumber: string;
}

export interface StationPointDetailPoint {
  id: number;
  code: string;
  name: string;
  type: string;
  workstationId?: number;
  positionX: number;
  positionY: number;
  radius: number;
  normalizedX?: number;
  normalizedY?: number;
  normalizedRadius?: number;
  imageWidth?: number;
  imageHeight?: number;
  cropWidth: number;
  cropHeight: number;
  status: 'fail' | 'warn' | 'pass';
  defectRate: number;
  totalInspected: number;
  ngCount: number;
  ntfCount?: number;
  ntfRate?: number;
  lowerLimit: number | null;
  upperLimit: number | null;
  nominalValue: number | null;
  unit: string | null;
  lastValue: string | null;
  lastResult: string | null;
  errorImages: StationPointDetailErrorImage[];
}

// ============================================
// A11. Workstation API types
// GET /api/external/workstations
// GET /api/external/workstations/:id
// ============================================

export interface WorkstationInfo {
  id: number;
  code: string;
  name: string;
  description?: string;
  processType?: string;
  orderIndex?: number;
  isActive?: boolean;
  lineId?: number;
  workshopId?: number;
  factoryId?: number;
  factoryName?: string;
  workshopName?: string;
  lineName?: string;
}

export interface WorkstationListResponse {
  success: boolean;
  data: WorkstationInfo[];
}

export interface WorkstationDetailResponse {
  success: boolean;
  data: WorkstationInfo;
}

export interface StationPointDetailResponse {
  success: boolean;
  data: {
    dateRange: { startDate: string; endDate: string };
    station: { id: number; code: string; name: string };
    productImage?: { url: string; width: number; height: number };
    boardInfo?: { model: string; code: string };
    points: StationPointDetailPoint[];
  };
}

export interface StationPointDetailParams {
  startDate: string;
  endDate: string;
  productModelId?: number;
  productCode?: string;
  pointDefId?: number | string;
  imageLimit?: number;
}

class StationService {
  private static instance: StationService;

  static getInstance(): StationService {
    if (!StationService.instance) {
      StationService.instance = new StationService();
    }
    return StationService.instance;
  }

  /** Sync clock offset with the server. Call once at app startup. */
  async syncServerTime(): Promise<void> {
    return fetchServerTimeOffset();
  }

  /**
   * Lấy danh sách trạm kiểm tra từ API
   */
  async getStationList(): Promise<StationConfig[]> {
    const { signal, clear } = createTimeoutSignal(10000);
    try {
      const baseUrl = getBaseUrl();
      const url = `${baseUrl}/api/external/stations`;
      console.log('[StationService] getStationList URL:', url);
      const response = await fetch(url, {
        method: 'GET',
        headers: buildExternalHeaders(),
        signal,
      });

      if (!response.ok) {
        console.warn('[StationService] API returned status:', response.status);
        return [];
      }

      const data: StationListResponse = await response.json();
      console.log('[StationService] getStationList result:', data ? `success=${data.success}, count=${data.data?.length}` : 'NULL');
      if (!data?.success || !data.data) return [];

      return data.data.map((s) => ({
        stationId: String(s.id),
        stationName: s.name || s.code || String(s.id),
        category: s.description || '',
        totalPoints: 0,
        totalMeasurements: 0,
        boardName: s.code || '',
      }));
    } catch (error) {
      console.warn('[StationService] Failed to fetch station list:', error);
      return [];
    } finally {
      clear();
    }
  }

  /**
   * Lấy danh sách trạm từ Hierarchy API (/api/external/hierarchy/tree).
   * Dùng làm fallback khi REST /api/stations không khả dụng.
   */
  async getStationListFromHierarchy(): Promise<StationConfig[]> {
    try {
      const baseUrl = getBaseUrl();
      const apiKey = getApiKey();
      const factories: HierarchyFactory[] = await hierarchyService.fetchTree(baseUrl, apiKey || undefined);
      const stations: StationConfig[] = [];
      for (const factory of factories) {
        for (const ws of factory.workshops ?? []) {
          for (const line of ws.lines ?? []) {
            for (const st of line.stations ?? []) {
              stations.push({
                stationId: String(st.id),
                stationName: st.name || st.code || String(st.id),
                category: '',
                totalPoints: 0,
                totalMeasurements: 0,
                boardName: '',
                factoryId: String(factory.id),
                workshopId: String(ws.id),
                lineId: String(line.id),
              });
            }
          }
        }
      }
      console.log(`[StationService] getStationListFromHierarchy: ${stations.length} stations`);
      return stations;
    } catch (error) {
      console.warn('[StationService] getStationListFromHierarchy failed:', error);
      return [];
    }
  }

  /**
   * Lấy ảnh tham chiếu (reference image) của board từ API
   */
  async getReferenceImage(stationId: string): Promise<string | null> {
    const { signal, clear } = createTimeoutSignal(10000);
    try {
      const baseUrl = getBaseUrl();
      const response = await fetch(
        `${baseUrl}/api/external/stations/${encodeURIComponent(stationId)}/reference-image`,
        {
          method: 'GET',
          headers: buildExternalHeaders(),
          signal,
        },
      );

      if (!response.ok) return null;

      const data: ReferenceImageResponse = await response.json();
      if (data.success && data.data?.referenceImage?.imageUrl) {
        const imgUrl = data.data.referenceImage.imageUrl;
        // Nếu URL relative, prepend baseUrl
        return imgUrl.startsWith('http')
          ? imgUrl
          : `${baseUrl}${imgUrl}`;
      }
      return null;
    } catch (error) {
      console.warn('[StationService] Failed to fetch reference image:', error);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * Lấy danh sách điểm kiểm tra (inspection points) từ API
   * Bao gồm tọa độ, thông số spec, ảnh mẫu, ...
   */
  async getInspectionPoints(stationId: string, productModelId?: number | string): Promise<InspectionPoint[]> {
    const { signal, clear } = createTimeoutSignal(10000);
    try {
      const baseUrl = getBaseUrl();
      let url = `${baseUrl}/api/external/stations/${encodeURIComponent(stationId)}/inspection-points`;
      if (productModelId != null && String(productModelId).length > 0) {
        url += `?productModelId=${encodeURIComponent(String(productModelId))}`;
      }
      const response = await fetch(
        url,
        {
          method: 'GET',
          headers: buildExternalHeaders(),
          signal,
        },
      );

      if (!response.ok) return [];

      const data: InspectionPointsResponse = await response.json();
      console.log('[StationService] getInspectionPoints result:', data ? `success=${data.success}, count=${data.data?.length}` : 'NULL');
      if (!data?.success || !data.data) return [];

      return data.data.map((p) => {
        // Map measurementType to InspectionPointType
        const typeMap: Record<string, string> = {
          MEASUREMENT: 'ASSY',
          VISUAL: 'Visual',
          ASSEMBLY: 'ASSY',
        };
        const pointType = (typeMap[p.measurementType?.toUpperCase() || ''] || 'Visual') as import('../types').InspectionPointType;

        // --- Coordinate normalization (prefer normalizedX/Y, fallback to pixel division) ---
        let nx = 0;
        let ny = 0;
        if (p.normalizedX != null && p.normalizedY != null) {
          nx = Number(p.normalizedX);
          ny = Number(p.normalizedY);
          // Safety: if > 1, these are pixel coords mislabeled as normalized
          if (nx > 1 && p.imageWidth && p.imageWidth > 0) nx = nx / p.imageWidth;
          if (ny > 1 && p.imageHeight && p.imageHeight > 0) ny = ny / p.imageHeight;
        } else if (p.positionX != null && p.positionY != null) {
          nx = Number(p.positionX);
          ny = Number(p.positionY);
          // If pixel coords (> 1), divide by image dimensions
          if (nx > 1 && p.imageWidth && p.imageWidth > 0) nx = nx / p.imageWidth;
          if (ny > 1 && p.imageHeight && p.imageHeight > 0) ny = ny / p.imageHeight;
        }
        // Clamp to [0, 1]
        nx = Math.max(0, Math.min(1, nx));
        ny = Math.max(0, Math.min(1, ny));

        return {
          id: String(p.id),
          code: p.code,
          name: p.name || p.code || String(p.id),
          type: pointType,
          status: 'pass' as import('../types').InspectionPointStatus,
          defectRate: 0,
          x: nx,
          y: ny,
          defects: [],
          measurements: [],
          trend: [],
          events: [],
          imageDisplayMode: p.imageDisplayMode,
        };
      });
    } catch (error) {
      console.warn('[StationService] Failed to fetch inspection points:', error);
      return [];
    } finally {
      clear();
    }
  }

  /**
   * Lấy đầy đủ dữ liệu trạm (config + reference image + points)
   */
  async getFullStationData(stationId: string, productModelId?: number | string): Promise<Partial<StationInspectionData> | null> {
    try {
      const [referenceImageUrl, points] = await Promise.all([
        this.getReferenceImage(stationId),
        this.getInspectionPoints(stationId, productModelId),
      ]);

      return {
        referenceImageUrl: referenceImageUrl ?? undefined,
        points: points.length > 0 ? points : undefined,
      };
    } catch (error) {
      console.warn('[StationService] Failed to fetch full station data:', error);
      return null;
    }
  }

  /**
   * Generic GET request to tRPC publicProductApi endpoint.
   * Format: GET /api/trpc/publicProductApi.{method}?input={URL-encoded SuperJSON}
   * Auth: apiKey inside the tRPC input JSON.
   * SuperJSON: input wrapped in { json: { apiKey, ...params } }
   * Response: { result: { data: { json: { success, data, ... } } } }
   */
  private async callTrpc<T>(method: string, input?: Record<string, unknown>): Promise<T | null> {
    let clear: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    try {
      const timeout = createTimeoutSignal(15000);
      signal = timeout.signal;
      clear = timeout.clear;
    } catch (e) {
      console.warn('[StationService] AbortController not available, proceeding without timeout');
    }
    try {
      const baseUrl = getBaseUrl().replace(/\/$/, '');
      const apiKey = getApiKey();
      // Build tRPC SuperJSON input: { json: { apiKey, ...params } }
      const trpcInput: Record<string, unknown> = { apiKey, ...(input || {}) };
      const superJsonWrapped = { json: trpcInput };
      const encodedInput = encodeURIComponent(JSON.stringify(superJsonWrapped));
      const fullUrl = `${baseUrl}/api/trpc/publicProductApi.${method}?input=${encodedInput}`;
      console.log(`[StationService] tRPC ${method} | apiKey=${apiKey ? apiKey.substring(0, 8) + '...' : 'NONE'}`);
      const authHeaders = authService.getAuthHeaders(apiKey);
      const fetchOpts: RequestInit = {
        method: 'GET',
        headers: { 'Accept': 'application/json', ...authHeaders },
      };
      if (signal) {
        fetchOpts.signal = signal;
      }
      const response = await fetch(fullUrl, fetchOpts);
      console.log(`[StationService] tRPC ${method} → HTTP ${response.status}`);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[StationService] tRPC ${method} HTTP ${response.status}`, text.substring(0, 200));
        return null;
      }
      const body = await response.json();
      // SuperJSON response: { result: { data: { json: { success, data, ... } } } }
      // Fallback for non-superjson: { result: { data: { success, data, ... } } }
      const inner = body?.result?.data?.json ?? body?.result?.data;
      if (!inner) {
        // tRPC error responses may have { error: { message, code, data } } at top level
        if (body?.error) {
          console.warn(`[StationService] tRPC ${method}: server error:`, JSON.stringify(body.error).substring(0, 300));
        } else {
          console.warn(`[StationService] tRPC ${method}: no result.data in response, body keys:`, Object.keys(body || {}));
        }
        return null;
      }
      if (inner.success === false) {
        console.warn(`[StationService] tRPC ${method} success=false:`, inner.error || inner.message);
        return null;
      }
      return inner as T;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[StationService] tRPC ${method} failed: ${msg}`);
      return null;
    } finally {
      if (clear) clear();
    }
  }

  /**
   * Generic GET request to tRPC machineApi endpoint.
   * Format: GET /api/trpc/machineApi.{method}?input={URL-encoded SuperJSON}
   * Auth: apiKey inside the tRPC input JSON.
   */
  private async callMachineApi<T>(method: string, input?: Record<string, unknown>): Promise<T | null> {
    let clear: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    try {
      const timeout = createTimeoutSignal(15000);
      signal = timeout.signal;
      clear = timeout.clear;
    } catch (e) {
      console.warn('[StationService] AbortController not available, proceeding without timeout');
    }
    try {
      const baseUrl = getBaseUrl().replace(/\/$/, '');
      const apiKey = getApiKey();
      const trpcInput: Record<string, unknown> = { apiKey, ...(input || {}) };
      const superJsonWrapped = { json: trpcInput };
      const encodedInput = encodeURIComponent(JSON.stringify(superJsonWrapped));
      const fullUrl = `${baseUrl}/api/trpc/machineApi.${method}?input=${encodedInput}`;
      console.log(`[StationService] machineApi.${method} | apiKey=${apiKey ? apiKey.substring(0, 8) + '...' : 'NONE'}`);
      const authHeaders = authService.getAuthHeaders(apiKey);
      const fetchOpts: RequestInit = {
        method: 'GET',
        headers: { 'Accept': 'application/json', ...authHeaders },
      };
      if (signal) {
        fetchOpts.signal = signal;
      }
      const response = await fetch(fullUrl, fetchOpts);
      console.log(`[StationService] machineApi.${method} → HTTP ${response.status}`);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[StationService] machineApi.${method} HTTP ${response.status}`, text.substring(0, 200));
        return null;
      }
      const body = await response.json();
      const inner = body?.result?.data?.json ?? body?.result?.data;
      if (!inner) {
        if (body?.error) {
          console.warn(`[StationService] machineApi.${method}: server error:`, JSON.stringify(body.error).substring(0, 300));
        } else {
          console.warn(`[StationService] machineApi.${method}: no result.data in response, body keys:`, Object.keys(body || {}));
        }
        return null;
      }
      if (inner.success === false) {
        console.warn(`[StationService] machineApi.${method} success=false:`, inner.error || inner.message);
        return null;
      }
      return inner as T;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[StationService] machineApi.${method} failed: ${msg}`);
      return null;
    } finally {
      if (clear) clear();
    }
  }

  /**
   * POST mutation to tRPC machineApi endpoint.
   * Format: POST /api/trpc/machineApi.{method} with body { json: { apiKey, ...input } }
   */
  private async callMachineApiMutation<T>(method: string, input?: Record<string, unknown>): Promise<T | null> {
    let clear: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    try {
      const timeout = createTimeoutSignal(15000);
      signal = timeout.signal;
      clear = timeout.clear;
    } catch (e) {
      console.warn('[StationService] AbortController not available, proceeding without timeout');
    }
    try {
      const baseUrl = getBaseUrl().replace(/\/$/, '');
      const apiKey = getApiKey();
      const trpcInput: Record<string, unknown> = { apiKey, ...(input || {}) };
      const fullUrl = `${baseUrl}/api/trpc/machineApi.${method}`;
      console.log(`[StationService] machineApi.${method} (mutation)`);
      const authHeaders = authService.getAuthHeaders(apiKey);
      const fetchOpts: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...authHeaders },
        body: JSON.stringify({ json: trpcInput }),
      };
      if (signal) {
        fetchOpts.signal = signal;
      }
      const response = await fetch(fullUrl, fetchOpts);
      console.log(`[StationService] machineApi.${method} (mutation) → HTTP ${response.status}`);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[StationService] machineApi.${method} (mutation) HTTP ${response.status}`, text.substring(0, 200));
        return null;
      }
      const body = await response.json();
      const inner = body?.result?.data?.json ?? body?.result?.data;
      if (!inner) return null;
      if (inner.success === false) {
        console.warn(`[StationService] machineApi.${method} (mutation) success=false:`, inner.error || inner.message);
        return null;
      }
      return inner as T;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[StationService] machineApi.${method} (mutation) failed: ${msg}`);
      return null;
    } finally {
      if (clear) clear();
    }
  }

  /**
   * Resolve full image URL (relative → absolute).
   * For API image endpoints that require auth, appends masterKey as query param
   * so <Image source={{ uri }}/> can load without custom headers.
   */
  private resolveImageUrl(url: string | undefined | null): string {
    if (!url) return '';
    // Already absolute HTTP(S) URL or data URI (base64) — return as-is
    if (url.startsWith('http') || url.startsWith('data:')) return url;
    const base = getBaseUrl();
    const fullUrl = `${base}${url}`;
    // If URL is an API endpoint that requires auth, append masterKey query param
    if (url.includes('/reference-image-file')) {
      const apiKey = getApiKey();
      if (apiKey) {
        return `${fullUrl}?masterKey=${encodeURIComponent(apiKey)}`;
      }
    }
    return fullUrl;
  }

  /**
   * Lấy danh sách toàn bộ sản phẩm qua REST GET /api/external/products (Master Key)
   */
  async getProductList(): Promise<ProductCatalogItem[]> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const apiKey = getApiKey();
    console.log('[StationService] getProductList — baseUrl:', baseUrl, 'apiKey:', apiKey ? `${apiKey.substring(0, 12)}...` : 'EMPTY');

    if (!apiKey) {
      console.warn('[StationService] getProductList — NO API KEY, cannot call external API');
      return [];
    }

    try {
      // Build query string manually (URLSearchParams may not be available on Hermes)
      const url = `${baseUrl}/api/external/products?lifecycleStatus=active&limit=200&offset=0`;

      // For external API, send ONLY x-master-key — do NOT send stale Bearer/Cookie
      // which could cause the server to reject the request before checking the API key
      const headers = buildExternalHeaders();
      console.log('[StationService] getProductList — url:', url);
      console.log('[StationService] getProductList — headers:', JSON.stringify(Object.keys(headers)));

      const response = await fetch(url, { method: 'GET', headers });
      console.log('[StationService] getProductList — HTTP status:', response.status);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.warn('[StationService] getProductList HTTP', response.status, errorBody.substring(0, 200));
        return [];
      }

      const text = await response.text();
      console.log('[StationService] getProductList — response length:', text.length, 'preview:', text.substring(0, 200));

      const result = JSON.parse(text) as {
        success: boolean;
        data: { pagination: { total: number; limit: number; offset: number; hasMore: boolean }; products: ApiProduct[] };
      };
      const products = result?.data?.products;
      console.log('[StationService] getProductList result: success=' + result?.success + ', products.length=' + (products?.length ?? 'undefined') + ', total=' + (result?.data?.pagination?.total ?? 'undefined'));

      if (!products) {
        console.warn('[StationService] getProductList — products is null/undefined. Full keys:', JSON.stringify(Object.keys(result?.data || {})));
        return [];
      }

      return products.map((p) => ({
        id: String(p.id),
        name: p.name,
        code: p.code,
        model: p.code,
        description: p.description,
        category: p.category,
        lifecycleStatus: p.lifecycleStatus,
        referenceImageUrl: p.referenceImageUrl,
        imageWidth: p.imageWidth,
        imageHeight: p.imageHeight,
        targetYieldRate: p.targetYieldRate != null ? Number(p.targetYieldRate) : undefined,
        minYieldRate: p.minYieldRate != null ? Number(p.minYieldRate) : undefined,
      }));
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
      console.warn('[StationService] getProductList error:', msg);
      return [];
    }
  }

  /**
   * Parse image result from response body regardless of shape
   */
  private parseImageResult(body: any): { url: string; imageWidth?: number; imageHeight?: number } | null {
    // tRPC SuperJSON: { result: { data: { json: { success, data: { imageUrl } } } } }
    // tRPC plain:     { result: { data: { success, data: { imageUrl } } } }
    const inner = body?.result?.data?.json ?? body?.result?.data;
    const data = inner?.data ?? inner;
    const url = data?.imageUrl;
    if (!url) return null;
    return {
      url: this.resolveImageUrl(url),
      imageWidth: data?.imageWidth ?? inner?.imageWidth,
      imageHeight: data?.imageHeight ?? inner?.imageHeight,
    };
  }

  /**
   * Lấy URL ảnh sản phẩm: GET /api/public/products/:code/image
   * Endpoint trả về binary image, nên URL chính là image URL.
   */
  async getProductImageUrl(productCode: string): Promise<{ url: string; imageWidth?: number; imageHeight?: number } | null> {
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl().replace(/\/$/, '');
      const url = `${baseUrl}/api/public/products/${encodeURIComponent(productCode)}/image`;
      // Verify image exists with HEAD request
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'HEAD', headers, signal });
      if (response.ok) {
        console.log('[StationService] getProductImageUrl OK via REST');
        return { url };
      }
    } catch (e) {
      console.warn('[StationService] getProductImageUrl error:', e);
    } finally {
      clear();
    }

    console.warn('[StationService] getProductImageUrl: failed for', productCode);
    return null;
  }

  /**
   * Lấy URL ảnh mẫu điểm đo.
   * REST: GET /api/public/measurement-points/:pointId/image
   * Endpoint trả về binary image — URL chính là image URL.
   */
  async getPointImageUrl(_productCode: string, _pointCode: string, pointId?: number | string): Promise<string | null> {
    if (pointId == null) {
      console.warn('[StationService] getPointImageUrl: pointId is required');
      return null;
    }
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl().replace(/\/$/, '');
      const url = `${baseUrl}/api/public/measurement-points/${encodeURIComponent(String(pointId))}/image`;
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'HEAD', headers, signal });
      if (response.ok) {
        console.log('[StationService] getPointImageUrl OK via REST');
        return url;
      }
    } catch (e) {
      console.warn('[StationService] getPointImageUrl error:', e);
    } finally {
      clear();
    }

    console.warn('[StationService] getPointImageUrl: failed for pointId', pointId);
    return null;
  }

  /**
   * Lấy dữ liệu ảnh điểm đo đầy đủ (URL + vị trí trên ảnh mẫu sản phẩm).
   * REST: GET /api/public/measurement-points/:pointId/image
   */
  async getPointImageData(_productCode: string, _pointCode: string, pointId?: number | string): Promise<PointImageData | null> {
    if (pointId == null) {
      console.warn('[StationService] getPointImageData: pointId is required');
      return null;
    }
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl().replace(/\/$/, '');
      const url = `${baseUrl}/api/public/measurement-points/${encodeURIComponent(String(pointId))}/image`;
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'HEAD', headers, signal });
      if (response.ok) {
        console.log('[StationService] getPointImageData OK via REST');
        return { url };
      }
    } catch (e) {
      console.warn('[StationService] getPointImageData error:', e);
    } finally {
      clear();
    }

    console.warn('[StationService] getPointImageData: failed for pointId', pointId);
    return null;
  }

  /**
   * Lấy danh sách measurement points.
   * Standardized: single tRPC publicProductApi.getMeasurementPoints endpoint
   */
  async getMeasurementPoints(productCode: string): Promise<ApiMeasurementPoint[]> {
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl().replace(/\/$/, '');
      const url = `${baseUrl}/api/public/products/${encodeURIComponent(productCode)}/measurement-points`;
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      if (!response.ok) {
        console.warn(`[StationService] getMeasurementPoints HTTP ${response.status}`);
        return [];
      }
      const result = await response.json();
      if (result?.data && result.data.length > 0) {
        // Stamp root-level imageWidth/imageHeight onto each point (B4 API response)
        const rootImgW = result.imageWidth;
        const rootImgH = result.imageHeight;
        if (rootImgW && rootImgH) {
          for (const pt of result.data) {
            if (!pt.imageWidth) pt.imageWidth = rootImgW;
            if (!pt.imageHeight) pt.imageHeight = rootImgH;
          }
        }
        console.log(`[StationService] getMeasurementPoints OK: ${result.data.length} points, rootDims: ${rootImgW ?? 'N/A'}x${rootImgH ?? 'N/A'}`);
        return result.data;
      }
    } catch (e) {
      console.warn('[StationService] getMeasurementPoints error:', e);
    } finally {
      clear();
    }

    return [];
  }

  /**
   * Lấy measurement points KÈM kích thước ảnh từ model (machineApi.getPoints).
   * machineApi.getPoints trả về imageWidth/imageHeight ở cấp product model,
   * đây là kích thước ảnh gốc mà tọa độ pixel positionX/Y được tính trên đó.
   * Phương thức này:
   *  1) Gọi getMeasurementPoints (đã có 3 fallback)
   *  2) Gọi thêm machineApi.getPoints để lấy imageWidth/imageHeight model-level
   *  3) Gán imageWidth/imageHeight vào từng point để coordinate normalization chính xác
   */
  async getMeasurementPointsWithDimensions(productCode: string): Promise<{
    points: ApiMeasurementPoint[];
    imageWidth?: number;
    imageHeight?: number;
  }> {
    // Parallel: get points + get model-level dimensions
    const [points, allModels] = await Promise.all([
      this.getMeasurementPoints(productCode),
      this.getAllProductPoints().catch(() => []),
    ]);

    // Find model matching this product for dimensions
    const matchedModel = allModels.find((m) => m.productModelCode === productCode);
    const modelImgW = matchedModel?.imageWidth;
    const modelImgH = matchedModel?.imageHeight;

    // If we got points from getMeasurementPoints but model has better points (with more data), prefer model
    if (points.length === 0 && matchedModel?.points && matchedModel.points.length > 0) {
      // Stamp model-level dims onto individual points
      for (const pt of matchedModel.points) {
        if (!pt.imageWidth && modelImgW) pt.imageWidth = modelImgW;
        if (!pt.imageHeight && modelImgH) pt.imageHeight = modelImgH;
      }
      console.log(`[StationService] getMeasurementPointsWithDimensions: using model points (${matchedModel.points.length}), dims: ${modelImgW}x${modelImgH}`);
      return { points: matchedModel.points, imageWidth: modelImgW, imageHeight: modelImgH };
    }

    // Stamp model-level dimensions onto individual points that lack them
    if (modelImgW && modelImgH) {
      for (const pt of points) {
        if (!pt.imageWidth) pt.imageWidth = modelImgW;
        if (!pt.imageHeight) pt.imageHeight = modelImgH;
      }
    }

    console.log(`[StationService] getMeasurementPointsWithDimensions: ${points.length} points, model dims: ${modelImgW ?? 'N/A'}x${modelImgH ?? 'N/A'}`);
    return { points, imageWidth: modelImgW, imageHeight: modelImgH };
  }

  /**
   * Lấy chi tiết sản phẩm (product + measurementPoints)
   * REST: GET /api/public/products/by-code/:code
   */
  async getProductDetail(productCode: string): Promise<ApiProductDetail | null> {
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const baseUrl = getBaseUrl().replace(/\/$/, '');
      const url = `${baseUrl}/api/public/products/by-code/${encodeURIComponent(productCode)}`;
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      if (!response.ok) {
        console.warn(`[StationService] getProductDetail HTTP ${response.status}`);
        return null;
      }
      const result = await response.json();
      return result?.data ?? null;
    } catch (e) {
      console.warn('[StationService] getProductDetail error:', e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * Lấy toàn bộ dữ liệu sản phẩm: gọi song song
   *   1. getProductByCode → product detail + measurement points
   *   2. getProductImage → presigned product image URL
   *   3. getMeasurementPointsWithDimensions → points + model-level image dimensions
   * Sau đó gọi getPointImage cho từng điểm đo có ảnh mẫu
   *
   * Dimension priority:
   *   presignedResult > machineApi model > product detail > base64 extraction
   * Point source priority:
   *   getProductDetail > getMeasurementPointsWithDimensions (machineApi.getPoints)
   */
  async getProductFullData(productCode: string): Promise<{
    product: ApiProduct;
    measurementPoints: ApiMeasurementPoint[];
    productImageUrl: string | null;
    images: ProductImageItem[];
  } | null> {
    // Parallel: product detail + presigned product image + measurement points with model dims
    const [detail, presignedResult, mpWithDims] = await Promise.all([
      this.getProductDetail(productCode).catch(() => null),
      this.getProductImageUrl(productCode).catch(() => null),
      this.getMeasurementPointsWithDimensions(productCode).catch(() => ({
        points: [] as ApiMeasurementPoint[],
        imageWidth: undefined as number | undefined,
        imageHeight: undefined as number | undefined,
      })),
    ]);
    if (!detail && mpWithDims.points.length === 0) return null;

    const product: ApiProduct = detail?.product ?? {
      id: 0,
      code: productCode,
      name: productCode,
    };

    // Measurement points: prefer detail (tRPC getProductByCode), fallback to machineApi.getPoints
    let measurementPoints = detail?.measurementPoints ?? [];
    if (measurementPoints.length === 0 && mpWithDims.points.length > 0) {
      measurementPoints = mpWithDims.points;
      console.log(`[StationService] getProductFullData: using machineApi points (${measurementPoints.length}) as fallback`);
    }

    // Product image: prefer referenceImageUrl (static file, loadable by <Image> without auth headers),
    // fall back to API endpoint URL (requires auth — usable for HEAD check but may fail in <Image>)
    const presignedProductUrl = presignedResult?.url ?? null;
    const referenceUrl = product.referenceImageUrl ? this.resolveImageUrl(product.referenceImageUrl) : null;
    const productImageUrl = referenceUrl || presignedProductUrl;

    console.log(`[StationService] getProductFullData imageUrl: refImg=${referenceUrl ? referenceUrl.substring(0, 120) : 'null'}, presigned=${presignedProductUrl ? 'yes' : 'null'}, final=${productImageUrl ? productImageUrl.substring(0, 120) : 'null'}`);

    // === Image dimensions: merge from all sources ===
    // Priority: presignedResult > machineApi model > product detail > base64 extraction
    if (presignedResult?.imageWidth) {
      product.imageWidth = presignedResult.imageWidth;
    }
    if (presignedResult?.imageHeight) {
      product.imageHeight = presignedResult.imageHeight;
    }

    // Supplement from machineApi model-level dimensions
    if (!product.imageWidth && mpWithDims.imageWidth) {
      product.imageWidth = mpWithDims.imageWidth;
      console.log(`[StationService] getProductFullData: using machineApi model imageWidth=${mpWithDims.imageWidth}`);
    }
    if (!product.imageHeight && mpWithDims.imageHeight) {
      product.imageHeight = mpWithDims.imageHeight;
      console.log(`[StationService] getProductFullData: using machineApi model imageHeight=${mpWithDims.imageHeight}`);
    }

    // If dimensions still null, try to extract from base64 data URI
    if (!product.imageWidth || !product.imageHeight) {
      const imgSrc = productImageUrl || product.referenceImageUrl;
      if (imgSrc?.startsWith('data:image/')) {
        const dims = extractImageDimensions(imgSrc);
        if (dims) {
          console.log(`[StationService] Extracted image dimensions from base64: ${dims.width}x${dims.height}`);
          product.imageWidth = dims.width;
          product.imageHeight = dims.height;
        }
      }
    }

    // Stamp product-level dimensions onto individual points for accurate coordinate normalization
    // Each point's imageWidth/imageHeight tells the screen what coordinate space positionX/Y are in
    const imgW = product.imageWidth;
    const imgH = product.imageHeight;
    if (imgW && imgH) {
      for (const mp of measurementPoints) {
        if (!mp.imageWidth) mp.imageWidth = imgW;
        if (!mp.imageHeight) mp.imageHeight = imgH;
      }
    }

    console.log(`[StationService] getProductFullData: ${measurementPoints.length} points, dims: ${imgW ?? 'N/A'}x${imgH ?? 'N/A'}, sources: presigned=${presignedResult?.imageWidth ? 'Y' : 'N'} model=${mpWithDims.imageWidth ? 'Y' : 'N'} detail=${detail?.product?.imageWidth ? 'Y' : 'N'}`);

    // Build gallery images
    const images: ProductImageItem[] = [];
    if (productImageUrl) {
      images.push({
        id: `product-ref-${product.code}`,
        type: 'reference',
        imageUrl: productImageUrl,
        label: product.code || product.name,
        pointName: product.name,
      });
    }

    // Fetch point images: prefer referenceImageUrl (static file, loadable by <Image> without auth headers),
    // fall back to B6 API endpoint URL only if referenceImageUrl unavailable
    const pointImagePromises = measurementPoints.map(async (mp) => {
      const refUrl = mp.referenceImageUrl ? this.resolveImageUrl(mp.referenceImageUrl) : '';
      // Only call B6 API if no static referenceImageUrl (API URL requires auth headers that <Image> can't send)
      const apiUrl = !refUrl ? await this.getPointImageUrl(productCode, mp.code, mp.id).catch(() => null) : null;
      const imgUrl = refUrl || apiUrl;
      if (imgUrl) {
        return {
          id: `point-${mp.id}`,
          pointId: String(mp.id),
          pointName: mp.name,
          type: 'reference' as const,
          imageUrl: imgUrl,
          label: `${mp.code} - ${mp.name}`,
        };
      }
      return null;
    });
    const pointImages = await Promise.all(pointImagePromises);
    for (const img of pointImages) {
      if (img) images.push(img);
    }

    return { product, measurementPoints, productImageUrl, images };
  }

  /**
   * Fetch measurement point statistics using C2 Inspection Trend API.
   * Endpoint: GET /api/external/inspections/trend?pointDefId=X
   * Aggregates per-period trend data into a single MpStatisticsItem.
   */
  async getMeasurementPointStatistics(params: MpStatisticsParams): Promise<MpStatisticsResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const query = new URLSearchParams();
    query.set('startDate', params.startDate);
    query.set('endDate', params.endDate);
    query.set('groupBy', 'day');
    if (params.pointDefId != null) query.set('pointDefId', String(params.pointDefId));
    if (params.stationId != null) query.set('stationId', String(params.stationId));
    if (params.productCode) query.set('productCode', params.productCode);
    if (params.productModelId != null) query.set('productModelId', String(params.productModelId));

    const headers = buildExternalHeaders();

    const endpoint = `${baseUrl}/api/external/inspections/trend`;
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const url = `${endpoint}?${query.toString()}`;
      console.log('[StationService] getMpStatistics (trend):', url);

      const response = await fetch(url, { method: 'GET', headers, signal });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[StationService] getMpStatistics HTTP ${response.status}`, text.substring(0, 200));
        return null;
      }

      const data: any = await response.json();
      const trend: any[] | undefined = data?.data?.trend ?? data?.trend;

      if (trend && trend.length > 0) {
        // Aggregate all period entries into a single statistics item
        let totalCount = 0, okCount = 0, ngCount = 0;
        let minVal: number | null = null, maxVal: number | null = null;
        let sumVal = 0, valCount = 0;

        for (const period of trend) {
          totalCount += period.totalCount ?? period.totalInspections ?? 0;
          okCount += period.okCount ?? 0;
          ngCount += period.ngCount ?? 0;
          if (period.minValue != null) {
            minVal = minVal == null ? period.minValue : Math.min(minVal, period.minValue);
          }
          if (period.maxValue != null) {
            maxVal = maxVal == null ? period.maxValue : Math.max(maxVal, period.maxValue);
          }
          if (period.avgValue != null) {
            sumVal += period.avgValue * (period.totalCount ?? period.totalInspections ?? 1);
            valCount += period.totalCount ?? period.totalInspections ?? 1;
          }
        }

        const ngRate = totalCount > 0 ? (ngCount / totalCount) * 100 : 0;
        const avgValue = valCount > 0 ? sumVal / valCount : null;

        const stat: MpStatisticsItem = {
          measurementPointId: params.pointDefId != null ? Number(params.pointDefId) : 0,
          measurementPointCode: '',
          measurementPointName: '',
          totalCount,
          okCount,
          ngCount,
          ngRate: Math.round(ngRate * 100) / 100,
          minValue: minVal,
          maxValue: maxVal,
          avgValue: avgValue != null ? Math.round(avgValue * 1000) / 1000 : null,
          stdDev: null,
          trendPeriods: trend.map((p: any) => {
            const pTotal = p.totalCount ?? p.totalInspections ?? 0;
            const pNg = p.ngCount ?? 0;
            return pTotal > 0 ? Math.round((pNg / pTotal) * 10000) / 100 : 0;
          }),
        };

        const normalized: MpStatisticsResponse = {
          success: true,
          data: {
            statistics: [stat],
            summary: {
              totalMeasurementPoints: 1,
              totalInspections: totalCount,
              overallNgRate: ngRate,
            },
            filters: {
              productCode: params.productCode,
              startDate: params.startDate,
              endDate: params.endDate,
              includeImages: false,
            },
          },
        };
        console.log('[StationService] getMpStatistics OK from trend, total:', totalCount, 'ng:', ngCount, 'ngRate:', ngRate.toFixed(1));
        return normalized;
      }

      console.log('[StationService] getMpStatistics: no trend data in response');
      return null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[StationService] getMpStatistics failed: ${msg}`);
      return null;
    } finally {
      clear();
    }
  }

  // ============================================
  // Machine API v2.0 — New capabilities
  // ============================================

  /**
   * Lấy tất cả products + points trong 1 cuộc gọi duy nhất qua machineApi.getPoints.
   * Hiệu quả hơn nhiều so với gọi getMeasurementPoints cho từng product riêng lẻ.
   * Returns: { productModels: [{ productModelCode, points, pointsConfigVersion, imageWidth, imageHeight }] }
   */
  async getAllProductPoints(): Promise<Array<{
    productModelCode: string;
    points: ApiMeasurementPoint[];
    pointsConfigVersion?: number;
    imageWidth?: number;
    imageHeight?: number;
  }>> {
    try {
      const result = await this.callMachineApi<{
        productModels: Array<{
          productModelCode: string;
          points: ApiMeasurementPoint[];
          pointsConfigVersion?: number;
          imageWidth?: number;
          imageHeight?: number;
        }>;
      }>('getPoints', {});
      if (result?.productModels) {
        console.log(`[StationService] getAllProductPoints OK: ${result.productModels.length} product models`);
        return result.productModels;
      }
    } catch (e) {
      console.warn('[StationService] getAllProductPoints failed:', e);
    }
    return [];
  }

  /**
   * Kiểm tra phiên bản cấu hình điểm đo qua machineApi.checkPointsVersion.
   * Dùng để so sánh với cached version, chỉ sync khi cần thiết.
   * Returns: { productModels: [{ productModelCode, pointsConfigVersion, imageWidth, imageHeight }] }
   */
  async checkPointsVersion(): Promise<Array<{
    productModelCode: string;
    pointsConfigVersion: number;
    imageWidth?: number;
    imageHeight?: number;
  }>> {
    try {
      const result = await this.callMachineApi<{
        productModels: Array<{
          productModelCode: string;
          pointsConfigVersion: number;
          imageWidth?: number;
          imageHeight?: number;
        }>;
      }>('checkPointsVersion', {});
      if (result?.productModels) {
        console.log(`[StationService] checkPointsVersion OK: ${result.productModels.length} product models`);
        return result.productModels;
      }
    } catch (e) {
      console.warn('[StationService] checkPointsVersion failed:', e);
    }
    return [];
  }

  /**
   * Delta sync: chỉ lấy các điểm đo thay đổi từ một phiên bản trở đi.
   * Tiết kiệm bandwidth khi số lượng điểm đo lớn.
   * machineApi.deltaSyncPoints
   */
  async deltaSyncPoints(productModelCode: string, sinceVersion: number): Promise<{
    hasChanges: boolean;
    currentVersion: number;
    sinceVersion: number;
    serverImageWidth?: number;
    serverImageHeight?: number;
    points: ApiMeasurementPoint[];
  } | null> {
    try {
      const result = await this.callMachineApi<{
        hasChanges: boolean;
        currentVersion: number;
        sinceVersion: number;
        serverImageWidth?: number;
        serverImageHeight?: number;
        points: ApiMeasurementPoint[];
      }>('deltaSyncPoints', { productModelCode, sinceVersion });
      if (result) {
        console.log(`[StationService] deltaSyncPoints OK: hasChanges=${result.hasChanges}, currentVersion=${result.currentVersion}, points=${result.points?.length ?? 0}`);
        return result;
      }
    } catch (e) {
      console.warn('[StationService] deltaSyncPoints failed:', e);
    }
    return null;
  }

  /**
   * Gửi heartbeat tới server qua machineApi.heartbeat (POST mutation).
   * Giúp server biết app đang online.
   * Returns: { success, machineId }
   */
  async sendHeartbeat(): Promise<{ success: boolean; machineId?: string } | null> {
    try {
      const result = await this.callMachineApiMutation<{ success: boolean; machineId?: string }>(
        'heartbeat',
        {},
      );
      if (result) {
        console.log(`[StationService] heartbeat OK: machineId=${result.machineId}`);
        return result;
      }
    } catch (e) {
      console.warn('[StationService] heartbeat failed:', e);
    }
    return null;
  }

  /**
   * Fetch all inspection result images for a measurement point at a station.
   * REST: GET /api/external/inspections/images (C4 endpoint)
   */
  async getPointImagesByStation(params: PointImagesByStationParams): Promise<PointImagesByStationResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const q = new URLSearchParams();
    q.set('startDate', params.startDate);
    q.set('endDate', params.endDate);
    if (params.stationId != null) q.set('stationId', String(params.stationId));
    if (params.pointDefId != null) q.set('pointDefId', String(params.pointDefId));
    if (params.productModelId != null) q.set('productModelId', String(params.productModelId));
    if (params.productCode) q.set('productCode', params.productCode);
    // C4 API only supports result filter: OK|NG|ALL — NTF must be filtered client-side
    const serverResult = params.result === 'NTF' ? 'ALL' : params.result;
    if (serverResult && serverResult !== 'ALL') q.set('result', serverResult);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));

    const url = `${baseUrl}/api/external/inspections/images?${q.toString()}`;
    const headers = buildExternalHeaders();

    const resolveImageUrls = (images: PointImageItem[]) => {
      for (const img of images) {
        if (img.imageUrl && !img.imageUrl.startsWith('http') && !img.imageUrl.startsWith('data:')) {
          img.imageUrl = `${baseUrl}${img.imageUrl.startsWith('/') ? '' : '/'}${img.imageUrl}`;
        }
      }
    };

    try {
      console.log('[StationService] getPointImagesByStation calling REST /api/external/inspections/images');
      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) {
        console.warn(`[StationService] getPointImagesByStation HTTP ${response.status}`);
        return null;
      }
      const result = await response.json();
      if (result) {
        const rawImages: any[] | undefined =
          result?.data?.images ?? result?.images;
        if (rawImages && rawImages.length >= 0) {
          // Map C4 API response fields to PointImageItem interface
          const images: PointImageItem[] = rawImages.map((img: any) => ({
            id: String(img.measurementResultId ?? img.id ?? ''),
            imageUrl: img.imageUrl ?? '',
            result: img.result ?? 'OK',
            inspectedAt: img.inspectionTime ?? img.inspectedAt ?? '',
            serialNumber: img.serialNumber,
            productCode: img.productCode,
            pointCode: img.pointCode,
            pointName: img.pointName,
          }));
          resolveImageUrls(images);
          // Client-side filter for NTF — C4 server doesn't support NTF as a result filter value
          const finalImages = params.result === 'NTF'
            ? images.filter(img => img.result === 'NTF')
            : images;
          const pagination = result?.data?.pagination ?? result?.pagination ?? { total: finalImages.length, limit: params.limit ?? 50, offset: params.offset ?? 0 };
          const adjustedPagination = params.result === 'NTF'
            ? { ...pagination, total: finalImages.length }
            : pagination;
          console.log(`[StationService] getPointImagesByStation OK: ${finalImages.length} images, total: ${adjustedPagination?.total ?? '?'}`);
          return {
            success: result.success ?? true,
            data: { images: finalImages, pagination: adjustedPagination },
          } as PointImagesByStationResponse;
        }
      }
    } catch (e) {
      console.warn('[StationService] getPointImagesByStation error:', e instanceof Error ? e.message : e);
    }

    console.warn('[StationService] getPointImagesByStation: failed');
    return null;
  }

  // ============================================
  // Sync API v2.0 — Write mutations
  // ============================================

  /**
   * Đồng bộ (tạo/cập nhật) measurement points lên server.
   * Server tự chuyển đổi tọa độ (normalized ↔ pixel) dựa trên sourceImageWidth/Height.
   *
   * tRPC: POST machineApi.syncMeasurementPoints
   * REST:  POST /api/machine/sync-points
   */
  async syncMeasurementPoints(
    productModelCode: string,
    sourceImageWidth: number,
    sourceImageHeight: number,
    points: SyncPointInput[],
    clientVersion?: number,
  ): Promise<SyncMeasurementPointsResponse | null> {
    try {
      const result = await this.callMachineApiMutation<SyncMeasurementPointsResponse>(
        'syncMeasurementPoints',
        {
          productModelCode,
          sourceImageWidth,
          sourceImageHeight,
          points,
          ...(clientVersion != null ? { clientVersion } : {}),
        },
      );
      if (result) {
        console.log(
          `[StationService] syncMeasurementPoints OK: version=${result.pointsConfigVersion}, ` +
          `created=${result.created}, updated=${result.updated}, failed=${result.failed}, ` +
          `coordTransformed=${result.coordTransformed}`,
        );
      }
      return result;
    } catch (e) {
      console.error('[StationService] syncMeasurementPoints error:', e);
      return null;
    }
  }

  /**
   * Upload / đồng bộ ảnh mẫu sản phẩm (reference image).
   * Server kiểm tra SHA-256 hash — nếu trùng sẽ bỏ qua (imageSkipped=true).
   *
   * tRPC: POST machineApi.syncProductImage
   * REST:  POST /api/machine/sync-product-image
   */
  async syncProductImage(
    productModelCode: string,
    image: { imageBase64?: string; imageUrl?: string },
    options?: { imageMimeType?: string; imageWidth?: number; imageHeight?: number },
  ): Promise<SyncProductImageResponse | null> {
    try {
      const result = await this.callMachineApiMutation<SyncProductImageResponse>(
        'syncProductImage',
        {
          productModelCode,
          ...image,
          ...options,
        },
      );
      if (result) {
        console.log(
          `[StationService] syncProductImage OK: hash=${result.imageHash}, skipped=${result.imageSkipped}`,
        );
      }
      return result;
    } catch (e) {
      console.error('[StationService] syncProductImage error:', e);
      return null;
    }
  }

  /**
   * Upload / đồng bộ ảnh mẫu điểm đo (point reference image).
   *
   * tRPC: POST machineApi.syncPointImage
   * REST:  POST /api/machine/sync-point-image
   */
  async syncPointImage(
    productModelCode: string,
    pointCode: string,
    image: { imageBase64?: string; imageUrl?: string },
    imageMimeType?: string,
  ): Promise<SyncPointImageResponse | null> {
    try {
      const result = await this.callMachineApiMutation<SyncPointImageResponse>(
        'syncPointImage',
        {
          productModelCode,
          pointCode,
          ...image,
          ...(imageMimeType ? { imageMimeType } : {}),
        },
      );
      if (result) {
        console.log(
          `[StationService] syncPointImage OK: ${result.referenceImageUrl}`,
        );
      }
      return result;
    } catch (e) {
      console.error('[StationService] syncPointImage error:', e);
      return null;
    }
  }

  /**
   * Lấy lịch sử đồng bộ (sync logs) — hỗ trợ phân trang.
   *
   * tRPC: GET machineApi.getSyncHistory
   * REST:  GET /api/machine/sync-history
   */
  async getSyncHistory(options?: {
    productModelCode?: string;
    syncOperation?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: SyncHistoryLog[]; total?: number } | null> {
    try {
      const result = await this.callMachineApi<{ logs: SyncHistoryLog[]; total?: number }>(
        'getSyncHistory',
        options ?? {},
      );
      if (result) {
        console.log(`[StationService] getSyncHistory OK: ${result.logs?.length ?? 0} logs`);
      }
      return result;
    } catch (e) {
      console.error('[StationService] getSyncHistory error:', e);
      return null;
    }
  }

  /**
   * Get KPI data for a specific station.
   * Uses GET /api/external/inspections/summary
   */
  async getStationKPI(stationId: string, params?: StationKPIParams): Promise<StationKPIDetailResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const queryParams = new URLSearchParams();
      if (params?.startDate) queryParams.set('startDate', params.startDate);
      if (params?.endDate) queryParams.set('endDate', params.endDate);
      if (params?.stationId != null) {
        queryParams.set('stationId', String(params.stationId));
      } else if (stationId) {
        queryParams.set('stationId', stationId);
      }
      if (params?.productModelId != null) queryParams.set('productModelId', String(params.productModelId));
      if (params?.productCode) queryParams.set('productCode', params.productCode);

      const url = `${baseUrl}/api/external/inspections/summary${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
      console.log('[StationService] getStationKPI:', url);

      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();

      if (!response.ok) {
        console.warn(`[StationService] getStationKPI HTTP ${response.status}`);
        return null;
      }

      const body = await response.json();
      console.log('[StationService] getStationKPI OK');
      return body as StationKPIDetailResponse;
    } catch (e) {
      console.warn('[StationService] getStationKPI error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * Get trending data for a specific measurement point.
   * Uses GET /api/external/inspections/trend
   */
  async getPointTrend(pointId: number | string, params: TrendDataParams): Promise<TrendDataResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('startDate', params.startDate);
      queryParams.set('endDate', params.endDate);
      if (params.pointDefId != null) {
        queryParams.set('pointDefId', String(params.pointDefId));
      } else if (pointId != null) {
        queryParams.set('pointDefId', String(pointId));
      }
      if (params.stationId != null) queryParams.set('stationId', String(params.stationId));
      if (params.productModelId != null) queryParams.set('productModelId', String(params.productModelId));
      if (params.productCode) queryParams.set('productCode', params.productCode);
      if (params.groupBy) queryParams.set('groupBy', params.groupBy);

      const url = `${baseUrl}/api/external/inspections/trend?${queryParams.toString()}`;
      console.log('[StationService] getPointTrend:', url);

      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();

      if (!response.ok) {
        console.warn(`[StationService] getPointTrend HTTP ${response.status}`);
        return null;
      }

      const body = await response.json();
      console.log(`[StationService] getPointTrend OK: ${body?.data?.trend?.length ?? '?'} data points`);
      return body as TrendDataResponse;
    } catch (e) {
      console.warn('[StationService] getPointTrend error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  // ============================================
  // External Inspection APIs
  // ============================================

  /**
   * GET /api/external/inspections/summary
   */
  async getInspectionSummary(params: InspectionSummaryParams): Promise<InspectionSummaryResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const q = new URLSearchParams();
      q.set('startDate', params.startDate);
      q.set('endDate', params.endDate);
      if (params.stationId != null) q.set('stationId', String(params.stationId));
      if (params.productModelId != null) q.set('productModelId', String(params.productModelId));
      if (params.productCode) q.set('productCode', params.productCode);

      const url = `${baseUrl}/api/external/inspections/summary?${q.toString()}`;
      console.log('[StationService] getInspectionSummary:', url);

      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getInspectionSummary HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      return body as InspectionSummaryResponse;
    } catch (e) {
      console.warn('[StationService] getInspectionSummary error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * GET /api/external/inspections/trend
   */
  async getInspectionTrend(params: InspectionTrendParams): Promise<InspectionTrendResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const q = new URLSearchParams();
      q.set('startDate', params.startDate);
      q.set('endDate', params.endDate);
      if (params.stationId != null) q.set('stationId', String(params.stationId));
      if (params.productModelId != null) q.set('productModelId', String(params.productModelId));
      if (params.productCode) q.set('productCode', params.productCode);
      if (params.pointDefId != null) q.set('pointDefId', String(params.pointDefId));
      if (params.groupBy) q.set('groupBy', params.groupBy);

      const url = `${baseUrl}/api/external/inspections/trend?${q.toString()}`;
      console.log('[StationService] getInspectionTrend:', url);

      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getInspectionTrend HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      return body as InspectionTrendResponse;
    } catch (e) {
      console.warn('[StationService] getInspectionTrend error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * GET /api/external/inspections/defect-pareto
   */
  async getDefectPareto(params: DefectParetoParams): Promise<DefectParetoResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const q = new URLSearchParams();
      q.set('startDate', params.startDate);
      q.set('endDate', params.endDate);
      if (params.stationId != null) q.set('stationId', String(params.stationId));
      if (params.productModelId != null) q.set('productModelId', String(params.productModelId));
      if (params.productCode) q.set('productCode', params.productCode);
      if (params.limit != null) q.set('limit', String(params.limit));

      const url = `${baseUrl}/api/external/inspections/defect-pareto?${q.toString()}`;
      console.log('[StationService] getDefectPareto:', url);

      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getDefectPareto HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      return body as DefectParetoResponse;
    } catch (e) {
      console.warn('[StationService] getDefectPareto error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * GET /api/external/inspections/images
   */
  async getInspectionImages(params: InspectionImagesParams): Promise<InspectionImagesResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(30000);
    try {
      const q = new URLSearchParams();
      q.set('startDate', params.startDate);
      q.set('endDate', params.endDate);
      if (params.stationId != null) q.set('stationId', String(params.stationId));
      if (params.pointDefId != null) q.set('pointDefId', String(params.pointDefId));
      if (params.productModelId != null) q.set('productModelId', String(params.productModelId));
      if (params.productCode) q.set('productCode', params.productCode);
      if (params.result) q.set('result', params.result);
      if (params.limit != null) q.set('limit', String(params.limit));
      if (params.offset != null) q.set('offset', String(params.offset));

      const url = `${baseUrl}/api/external/inspections/images?${q.toString()}`;
      console.log('[StationService] getInspectionImages:', url);

      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getInspectionImages HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      // Resolve relative image URLs
      if (body?.data?.images) {
        for (const img of body.data.images) {
          if (img.imageUrl && !img.imageUrl.startsWith('http') && !img.imageUrl.startsWith('data:')) {
            img.imageUrl = `${baseUrl}${img.imageUrl.startsWith('/') ? '' : '/'}${img.imageUrl}`;
          }
        }
      }
      return body as InspectionImagesResponse;
    } catch (e) {
      console.warn('[StationService] getInspectionImages error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * GET /api/external/inspections/events
   */
  async getInspectionEvents(params: InspectionEventsParams): Promise<InspectionEventsResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const q = new URLSearchParams();
      q.set('startDate', params.startDate);
      q.set('endDate', params.endDate);
      if (params.stationId != null) q.set('stationId', String(params.stationId));
      if (params.machineId != null) q.set('machineId', String(params.machineId));
      if (params.packageId) q.set('packageId', params.packageId);
      if (params.eventType) q.set('eventType', params.eventType);
      if (params.limit != null) q.set('limit', String(params.limit));
      if (params.offset != null) q.set('offset', String(params.offset));

      const url = `${baseUrl}/api/external/inspections/events?${q.toString()}`;
      console.log('[StationService] getInspectionEvents:', url);

      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getInspectionEvents HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      return body as InspectionEventsResponse;
    } catch (e) {
      console.warn('[StationService] getInspectionEvents error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * GET /api/external/inspections/measurements
   */
  async getInspectionMeasurements(params: InspectionMeasurementsParams): Promise<InspectionMeasurementsResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const q = new URLSearchParams();
      q.set('pointDefId', String(params.pointDefId));
      q.set('startDate', params.startDate);
      q.set('endDate', params.endDate);
      if (params.stationId != null) q.set('stationId', String(params.stationId));
      if (params.productModelId != null) q.set('productModelId', String(params.productModelId));
      if (params.productCode) q.set('productCode', params.productCode);
      if (params.limit != null) q.set('limit', String(params.limit));
      if (params.offset != null) q.set('offset', String(params.offset));

      const url = `${baseUrl}/api/external/inspections/measurements?${q.toString()}`;
      console.log('[StationService] getInspectionMeasurements:', url);

      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getInspectionMeasurements HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      return body as InspectionMeasurementsResponse;
    } catch (e) {
      console.warn('[StationService] getInspectionMeasurements error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * Resolve MQTT topic thành thông tin station kèm hierarchy (factory → workshop → line → station)
   * GET /api/external/stations/resolve-topic?topic={mqttTopic}
   */
  async resolveStationFromTopic(topic: string): Promise<ResolveTopicResponse | null> {
    const { signal, clear } = createTimeoutSignal(10000);
    try {
      const baseUrl = getBaseUrl();
      const url = `${baseUrl}/api/external/stations/resolve-topic?topic=${encodeURIComponent(topic)}`;
      console.log('[StationService] resolveStationFromTopic URL:', url);
      const response = await fetch(url, {
        method: 'GET',
        headers: buildExternalHeaders(),
        signal,
      });

      if (!response.ok) {
        console.warn(`[StationService] resolveStationFromTopic HTTP ${response.status}`);
        return null;
      }

      const body: ResolveTopicResponse = await response.json();
      if (!body?.success || !body.data) return null;
      return body;
    } catch (e) {
      console.warn('[StationService] resolveStationFromTopic error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * A6. Lấy danh sách sản phẩm theo station
   * GET /api/external/stations/:id/products
   */
  async getStationProducts(stationId: string | number): Promise<StationProductsResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const url = `${baseUrl}/api/external/stations/${stationId}/products`;
      console.log('[StationService] getStationProducts:', url);
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getStationProducts HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      console.log('[StationService] getStationProducts OK:', body?.data?.products?.length ?? 0, 'products');
      return body as StationProductsResponse;
    } catch (e) {
      console.warn('[StationService] getStationProducts error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * A7. Lấy thống kê KPI cho station (FPY, Final Yield, Retest Rate, Yield Change)
   * GET /api/external/stations/:id/statistics?startDate=...&endDate=...
   */
  async getStationStatistics(stationId: string | number, params: { startDate: string; endDate: string; productModelId?: number | string; productCode?: string }): Promise<StationStatisticsResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('startDate', params.startDate);
      queryParams.set('endDate', params.endDate);
      if (params.productModelId != null) queryParams.set('productModelId', String(params.productModelId));
      if (params.productCode) queryParams.set('productCode', params.productCode);
      const url = `${baseUrl}/api/external/stations/${stationId}/statistics?${queryParams.toString()}`;
      console.log('[StationService] getStationStatistics REQUEST:', {
        url,
        stationId,
        startDate: params.startDate,
        endDate: params.endDate,
        productModelId: params.productModelId,
        productCode: params.productCode,
      });
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getStationStatistics HTTP ${response.status}`, await response.text().catch(() => ''));
        return null;
      }
      const body = await response.json();
      console.log('[StationService] getStationStatistics RESPONSE:', JSON.stringify(body?.data ?? body, null, 2));
      return body as StationStatisticsResponse;
    } catch (e) {
      console.warn('[StationService] getStationStatistics error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * A8. Lấy thống kê chi tiết tất cả điểm đo của station
   * GET /api/external/stations/:id/measurement-stats?startDate=...&endDate=...&groupBy=...
   */
  async getStationMeasurementStats(stationId: string | number, params: StationMeasurementStatsParams): Promise<StationMeasurementStatsResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('startDate', params.startDate);
      queryParams.set('endDate', params.endDate);
      if (params.groupBy) queryParams.set('groupBy', params.groupBy);
      if (params.productModelId != null) queryParams.set('productModelId', String(params.productModelId));
      if (params.productCode) queryParams.set('productCode', params.productCode);
      const url = `${baseUrl}/api/external/stations/${stationId}/measurement-stats?${queryParams.toString()}`;
      console.log('[StationService] getStationMeasurementStats:', url);
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getStationMeasurementStats HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      console.log('[StationService] getStationMeasurementStats OK:', body?.data?.points?.length ?? 0, 'points');
      return body as StationMeasurementStatsResponse;
    } catch (e) {
      console.warn('[StationService] getStationMeasurementStats error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * A9. Lấy lịch sử lỗi NG của station
   * GET /api/external/stations/:id/fail-history?startDate=...&endDate=...&limit=...&offset=...
   */
  async getStationFailHistory(stationId: string | number, params: StationFailHistoryParams): Promise<StationFailHistoryResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('startDate', params.startDate);
      queryParams.set('endDate', params.endDate);
      if (params.limit != null) queryParams.set('limit', String(params.limit));
      if (params.offset != null) queryParams.set('offset', String(params.offset));
      if (params.productModelId != null) queryParams.set('productModelId', String(params.productModelId));
      if (params.productCode) queryParams.set('productCode', params.productCode);
      const url = `${baseUrl}/api/external/stations/${stationId}/fail-history?${queryParams.toString()}`;
      console.log('[StationService] getStationFailHistory:', url);
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getStationFailHistory HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      // Resolve relative imageUrls in failedPoints
      if (body?.data?.inspections) {
        for (const insp of body.data.inspections) {
          if (insp.failedPoints) {
            for (const fp of insp.failedPoints) {
              if (fp.imageUrl && !fp.imageUrl.startsWith('http') && !fp.imageUrl.startsWith('data:')) {
                fp.imageUrl = `${baseUrl}${fp.imageUrl.startsWith('/') ? '' : '/'}${fp.imageUrl}`;
              }
            }
          }
        }
      }
      console.log('[StationService] getStationFailHistory OK:', body?.data?.inspections?.length ?? 0, 'inspections');
      return body as StationFailHistoryResponse;
    } catch (e) {
      console.warn('[StationService] getStationFailHistory error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * A10. Lấy chi tiết điểm đo + ảnh lỗi
   * GET /api/external/stations/:id/point-detail?startDate=...&endDate=...
   * Kết hợp dữ liệu A8 (measurement-stats) + ảnh lỗi theo từng điểm đo
   */
  async getStationPointDetail(stationId: string | number, params: StationPointDetailParams): Promise<StationPointDetailResponse | null> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(15000);
    try {
      const q = new URLSearchParams();
      q.set('startDate', params.startDate);
      q.set('endDate', params.endDate);
      if (params.productModelId != null) q.set('productModelId', String(params.productModelId));
      if (params.productCode) q.set('productCode', params.productCode);
      if (params.pointDefId != null) q.set('pointDefId', String(params.pointDefId));
      if (params.imageLimit != null) q.set('imageLimit', String(params.imageLimit));
      const url = `${baseUrl}/api/external/stations/${stationId}/point-detail?${q.toString()}`;
      console.log('[StationService] getStationPointDetail REQUEST:', {
        url,
        stationId,
        startDate: params.startDate,
        endDate: params.endDate,
        productModelId: params.productModelId,
        productCode: params.productCode,
        pointDefId: params.pointDefId,
        imageLimit: params.imageLimit,
      });
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getStationPointDetail HTTP ${response.status}`, await response.text().catch(() => ''));
        return null;
      }
      const body = await response.json();
      // Resolve relative imageUrls in errorImages and productImage
      if (body?.data?.points) {
        for (const pt of body.data.points) {
          if (pt.errorImages) {
            for (const img of pt.errorImages) {
              if (img.imageUrl && !img.imageUrl.startsWith('http') && !img.imageUrl.startsWith('data:')) {
                img.imageUrl = `${baseUrl}${img.imageUrl.startsWith('/') ? '' : '/'}${img.imageUrl}`;
              }
            }
          }
        }
      }
      if (body?.data?.productImage?.url) {
        const pUrl = body.data.productImage.url;
        if (pUrl && !pUrl.startsWith('http') && !pUrl.startsWith('data:')) {
          body.data.productImage.url = `${baseUrl}${pUrl.startsWith('/') ? '' : '/'}${pUrl}`;
        }
      }
      console.log('[StationService] getStationPointDetail RESPONSE:', body?.data?.points?.length ?? 0, 'points',
        body?.data?.points?.map((p: any) => ({ id: p.pointDefId, code: p.code, total: p.totalInspections, pass: p.passCount, fail: p.failCount })));
      return body as StationPointDetailResponse;
    } catch (e) {
      console.warn('[StationService] getStationPointDetail error:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clear();
    }
  }

  /**
   * A11a. Lấy danh sách workstations
   * GET /api/external/workstations
   */
  async getWorkstations(params?: { factoryId?: number; workshopId?: number; lineId?: number }): Promise<WorkstationInfo[]> {
    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const { signal, clear } = createTimeoutSignal(10000);
    try {
      const q = new URLSearchParams();
      if (params?.factoryId != null) q.set('factoryId', String(params.factoryId));
      if (params?.workshopId != null) q.set('workshopId', String(params.workshopId));
      if (params?.lineId != null) q.set('lineId', String(params.lineId));
      const qs = q.toString();
      const url = `${baseUrl}/api/external/workstations${qs ? `?${qs}` : ''}`;
      console.log('[StationService] getWorkstations:', url);
      const headers = buildExternalHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      clear();
      if (!response.ok) {
        console.warn(`[StationService] getWorkstations HTTP ${response.status}`);
        return [];
      }
      const body: WorkstationListResponse = await response.json();
      console.log('[StationService] getWorkstations OK:', body.data?.length ?? 0, 'workstations');
      return body.data || [];
    } catch (e) {
      console.warn('[StationService] getWorkstations error:', e instanceof Error ? e.message : e);
      return [];
    } finally {
      clear();
    }
  }

  /**
   * Parse station ID từ MQTT topic
   * Topic format: avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/...
   */
  parseStationFromTopic(topic: string): { stationId: string; factoryId?: string; workshopId?: string } | null {
    // Format: avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/...
    const fullMatch = topic.match(
      /avi\/factory\/([^/]+)\/workshop\/([^/]+)\/station\/([^/]+)/,
    );
    if (fullMatch) {
      return {
        factoryId: fullMatch[1],
        workshopId: fullMatch[2],
        stationId: fullMatch[3],
      };
    }

    // Format: avi/{factoryId}/workshop/{workshopId}/station/{stationId}/...
    const shortMatch = topic.match(
      /avi\/([^/]+)\/workshop\/([^/]+)\/station\/([^/]+)/,
    );
    if (shortMatch) {
      return {
        factoryId: shortMatch[1],
        workshopId: shortMatch[2],
        stationId: shortMatch[3],
      };
    }

    return null;
  }
}

const _rawStationService = StationService.getInstance();

/**
 * Proxy wrapper around StationService that auto-logs all method calls
 * to debugLogger when debug mode is enabled.
 */
export const stationService = new Proxy(_rawStationService, {
  get(target, prop, receiver) {
    const val = Reflect.get(target, prop, receiver);
    if (typeof val !== 'function' || typeof prop !== 'string' || prop === 'constructor') {
      return val;
    }
    return function (this: any, ...args: any[]) {
      const tag = prop;
      // Summarize args for logging (strip large base64/image data)
      const logArgs = args.map((a) => {
        if (typeof a === 'string' && a.length > 200) return a.substring(0, 200) + '...';
        if (a && typeof a === 'object') {
          const clone = { ...a };
          for (const key of Object.keys(clone)) {
            if (typeof clone[key] === 'string' && clone[key].length > 200) {
              clone[key] = clone[key].substring(0, 100) + '...[truncated]';
            }
          }
          return clone;
        }
        return a;
      });
      debugLogger.apiRequest(tag, 'CALL', `stationService.${tag}`, logArgs.length > 0 ? logArgs : undefined);
      const t0 = Date.now();
      const result = val.apply(target, args);
      if (result && typeof result.then === 'function') {
        return result.then((res: any) => {
          debugLogger.apiResponse(tag, 200, res, Date.now() - t0);
          return res;
        }).catch((err: any) => {
          debugLogger.apiError(tag, err, Date.now() - t0);
          throw err;
        });
      }
      return result;
    };
  },
});
