/**
 * StationDetail — shared API-response mapping helpers (product sort, C5/C6 mappers, A10 overlay).
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx.
 */
import { useStationInspectionStore } from '../../../store/stationInspectionStore';
import { useSettingsStore } from '../../../store';
import type { ProductCatalogItem } from '../../../services/stationService';
import type { InspectionMeasurement, InspectionEvent } from '../../../types';

// ─── Shared product sort helper (used in products useEffect + handleRefresh) ───
// Push "parent" products (whose code is a prefix of another product) to the end
// e.g., "GB300" is a prefix of "GB300-BOARD-01" → goes last so specific products are selected first
const sortProductsCatalog = (list: ProductCatalogItem[]): ProductCatalogItem[] => {
  const indexed = list.map((item, idx) => ({ item, idx }));
  indexed.sort((a, b) => {
    const aIsParent = list.some(p => p.code !== a.item.code && p.code.startsWith(a.item.code));
    const bIsParent = list.some(p => p.code !== b.item.code && p.code.startsWith(b.item.code));
    if (aIsParent && !bIsParent) return 1;
    if (!aIsParent && bIsParent) return -1;
    return a.idx - b.idx; // preserve original API response order instead of alphabetical
  });
  return indexed.map(i => i.item);
};

// ─── Shared API response mapping helpers (used in handlePointPress, polling, timeRange effects) ───
const mapMeasurementsFromApi = (
  resp: { data?: { measurements?: Array<{ serialNumber?: string; measuredValue?: string | number; measuredValueText?: string; result?: string }>; pointDef?: { name?: string; nominalValue?: number; lowerLimit?: number; upperLimit?: number; unit?: string } } } | null,
  fallbackName: string,
): InspectionMeasurement[] => {
  if (!resp?.data?.measurements || resp.data.measurements.length === 0) return [];
  const pointDef = resp.data.pointDef;
  const specStr = pointDef
    ? [
        pointDef.nominalValue != null ? `Nom:${pointDef.nominalValue}` : '',
        pointDef.lowerLimit != null || pointDef.upperLimit != null
          ? `${pointDef.lowerLimit ?? ''}~${pointDef.upperLimit ?? ''}`
          : '',
        pointDef.unit || '',
      ].filter(Boolean).join(' ')
    : '';
  return resp.data.measurements.map((m) => ({
    param: m.serialNumber || pointDef?.name || fallbackName || '',
    val: String(m.measuredValue ?? m.measuredValueText ?? '-'),
    spec: specStr,
    status: m.result === 'NG' ? 'ng' as const : 'ok' as const,
  }));
};

const mapEventsFromApi = (
  resp: { data?: { events?: Array<{ createdAt?: string; message?: string; event?: string; level?: string }> } } | null,
): InspectionEvent[] => {
  if (!resp?.data?.events || resp.data.events.length === 0) return [];
  return resp.data.events.map((e) => ({
    time: e.createdAt ? new Date(e.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '',
    desc: e.message || e.event || '',
    type: e.level === 'error' || e.level === 'critical' ? 'fail' as const
      : e.level === 'warning' ? 'warn' as const
      : 'pass' as const,
  }));
};

// ─── Shared helper: apply A10 point-detail data to pointDataMap ───
// Resets A10-sourced fields for current product prefix, then overlays new data.
// Used by initial fetch, proactive polling, and handleRefresh to avoid stale data.
type A10PointItem = {
  id: number | string; code: string; name: string;
  totalInspected: number; ngCount: number; ntfCount?: number;
  defectRate?: number; status?: string; workstationId?: number | null;
  errorImages?: Array<{ id: number; imageUrl: string; inspectionTime?: string; serialNumber?: string }>;
};
const applyA10PointData = (
  stationId: string,
  productCode: string | undefined,
  pts: A10PointItem[] | null,
) => {
  // When A10 call fails (pts === null), preserve existing MQTT-sourced data
  // Only reset when we get a successful response (pts is an array, even if empty)
  if (pts === null) {
    console.log('[StationDetail] applyA10PointData: pts is null (API failed), skipping reset to preserve MQTT data');
    return;
  }

  const store = useStationInspectionStore.getState();
  const currentMap = { ...store.pointDataMap };
  if (!currentMap[stationId]) currentMap[stationId] = {};
  const stationMap = { ...currentMap[stationId] };

  // Reset A10-sourced fields for all existing entries matching current product prefix
  // This ensures points not returned by A10 for the new time range show zeros instead of stale data
  const prefix = productCode ? `${productCode}::` : null;
  Object.keys(stationMap).forEach(k => {
    if (prefix ? k.startsWith(prefix) : true) {
      // Preserve MQTT-accumulated ngCount/defectRate — only reset totalInspections and apiStatus
      // A10 will overlay correct totalInspections and defectRate for points it returns
      const existing = stationMap[k];
      stationMap[k] = {
        ...existing,
        totalInspections: 0,
        ngCount: 0,
        defectRate: 0,
        ntfCount: 0,
        apiStatus: undefined,
        errorImageUrls: [],
      };
    }
  });

  // Apply new A10 data
  if (pts && pts.length > 0) {
    const wsFilter = useSettingsStore.getState().settings.app.workstationId;
    const filteredPts = wsFilter != null
      ? pts.filter(p => p.workstationId == null || p.workstationId === wsFilter)
      : pts;
    console.log('[StationDetail] applyA10PointData:', filteredPts.length, '/', pts.length, 'points (wsFilter=', wsFilter, ')',
      'station=', stationId, 'product=', productCode);
    // If wsFilter caused all points to be filtered out, restore the pre-reset map to avoid false zeros
    if (filteredPts.length === 0 && pts.length > 0) {
      console.warn('[StationDetail] applyA10PointData: wsFilter removed all', pts.length, 'points — skipping reset to preserve data');
      currentMap[stationId] = { ...store.pointDataMap[stationId] || {} };
      return;
    }
    filteredPts.forEach((pt) => {
      const pointKey = productCode ? `${productCode}::${pt.id}` : String(pt.id);
      const existing = stationMap[pointKey];
      const pd = existing ? { ...existing } : {
        totalInspections: 0, ngCount: 0, defectRate: 0, defects: [], measurements: [],
        events: [], trend: [], errorImageUrls: [], referenceImageUrls: [], lastAlertTime: '',
      };
      pd.totalInspections = pt.totalInspected;
      pd.ngCount = pt.ngCount;
      pd.defectRate = pt.defectRate ?? (pt.totalInspected > 0 ? (pt.ngCount / pt.totalInspected) * 100 : 0);
      pd.apiStatus = pt.status as 'fail' | 'warn' | 'pass' | undefined;
      pd.ntfCount = pt.ntfCount ?? 0;
      if (pt.errorImages && pt.errorImages.length > 0) {
        pd.errorImageUrls = pt.errorImages.map(img => img.imageUrl);
      }
      stationMap[pointKey] = pd;
    });
  }

  currentMap[stationId] = stationMap;
  useStationInspectionStore.setState({ pointDataMap: currentMap });
};

export { sortProductsCatalog, mapMeasurementsFromApi, mapEventsFromApi, applyA10PointData };
export type { A10PointItem };
