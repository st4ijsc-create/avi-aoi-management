/**
 * StationDetail — pure point-mapping / alert-matching calculators.
 * MB11 decomposition: memo bodies moved verbatim from StationDetailScreen.tsx
 * (closed-over `selectedProduct?.code` became the `selectedProductCode` parameter).
 * The screen's useMemo wrappers call these with unchanged dependency arrays.
 */
import type {
  Alert, InspectionPoint, InspectionPointStatus, InspectionPointType,
  InspectionDefect, InspectionMeasurement, InspectionEvent, PointAccumulatedData,
} from '../../../types';
import type { ApiMeasurementPoint } from '../../../services/stationService';
import type { AlertBubbleInfo } from '../types';

/** Match incoming MQTT alert ngPoints against product measurement points for accurate highlighting */
export function computeAlertedProductPointIds(
  productMeasurementPoints: ApiMeasurementPoint[],
  stationAlerts: Alert[],
  selectedProductCode: string | undefined,
): Set<string> {
  const matched = new Set<string>();
  if (productMeasurementPoints.length === 0 || stationAlerts.length === 0) return matched;

  // Only consider the LATEST alert for the EXACT selected product (strict matching)
  // Require alert to identify the product — prevent cross-product contamination
  const latestAlert = selectedProductCode
    ? stationAlerts.find((a) => a.ngPoints && (
        a.productModel?.code === selectedProductCode ||
        a.product?.model === selectedProductCode
      ))
    : stationAlerts.find((a) => a.ngPoints);

  if (!latestAlert?.ngPoints) return matched;

  for (const ng of latestAlert.ngPoints) {
    if (ng.result !== 'NG') continue;
    for (const mp of productMeasurementPoints) {
      const mpId = String(mp.id);
      if (
        (ng.pointId != null && String(ng.pointId) === mpId) ||
        (ng.pointName && (ng.pointName === mp.code || ng.pointName === mp.name))
      ) {
        matched.add(mpId);
      }
    }
  }
  return matched;
}

/**
 * Track whether a latest alert exists for the selected product.
 * When true, non-alerted points should show 'pass' (not defectRate-based status).
 */
export function computeHasLatestAlert(
  stationAlerts: Alert[],
  selectedProductCode: string | undefined,
): boolean {
  if (stationAlerts.length === 0) return false;
  const latestAlert = selectedProductCode
    ? stationAlerts.find((a) => a.ngPoints && (
        a.productModel?.code === selectedProductCode ||
        a.product?.model === selectedProductCode
      ))
    : stationAlerts.find((a) => a.ngPoints);
  return !!latestAlert;
}

/**
 * When ngAutoClearColor is ON, filter alertedProductPointIds to respect auto-dismiss state.
 * clearExpiredNewlyAlerted clears alertedPointIds (store), but alertedProductPointIds is derived
 * from stationAlerts (never cleared by timer). This ensures dismissed points stop showing red.
 */
export function filterEffectiveAlertedPointIds(params: {
  ngAutoClearColor: boolean;
  alertedProductPointIds: Set<string>;
  alertedPointIds: Set<string>;
  productMeasurementPoints: ApiMeasurementPoint[];
}): Set<string> {
  const { ngAutoClearColor, alertedProductPointIds, alertedPointIds, productMeasurementPoints } = params;
  if (!ngAutoClearColor || alertedProductPointIds.size === 0) return alertedProductPointIds;
  // Fast path: all points dismissed
  if (alertedPointIds.size === 0) return new Set<string>();

  const filtered = new Set<string>();
  for (const mpId of alertedProductPointIds) {
    // alertedPointIds may store numeric ID, point code, or point name — check all forms
    if (alertedPointIds.has(mpId)) {
      filtered.add(mpId);
      continue;
    }
    const mp = productMeasurementPoints.find(m => String(m.id) === mpId);
    if (mp && (
      (mp.code && alertedPointIds.has(mp.code)) ||
      (mp.name && alertedPointIds.has(mp.name))
    )) {
      filtered.add(mpId);
    }
  }
  return filtered;
}

/** Build alert bubble data for each NG point (for speech bubble callouts on PCB) */
export function buildAlertBubbleData(
  productMeasurementPoints: ApiMeasurementPoint[],
  stationAlerts: Alert[],
  selectedProductCode: string | undefined,
): Map<string, AlertBubbleInfo> {
  const map = new Map<string, AlertBubbleInfo>();
  if (stationAlerts.length === 0 || productMeasurementPoints.length === 0) return map;
  const latestAlert = selectedProductCode
    ? stationAlerts.find((a) => a.ngPoints && (
        a.productModel?.code === selectedProductCode ||
        a.product?.model === selectedProductCode
      ))
    : stationAlerts.find((a) => a.ngPoints);
  if (!latestAlert?.ngPoints) return map;
  const errorDesc = latestAlert.error?.description || latestAlert.error?.type || 'NG';
  for (const ng of latestAlert.ngPoints) {
    if (ng.result !== 'NG') continue;
    for (const mp of productMeasurementPoints) {
      const mpId = String(mp.id);
      if (
        (ng.pointId != null && String(ng.pointId) === mpId) ||
        (ng.pointName && (ng.pointName === mp.code || ng.pointName === mp.name))
      ) {
        map.set(mpId, {
          pointName: ng.pointName || mp.name || mp.code || mpId,
          result: ng.result,
          errorDesc,
          actualValue: ng.actualValue,
          expectedValue: ng.expectedValue,
        });
      }
    }
  }
  return map;
}

/** Compute which product points are newly-alerted (within flash duration) */
export function computeNewlyAlertedProductPointIds(
  newlyAlertedMap: Record<string, number>,
  productMeasurementPoints: ApiMeasurementPoint[],
  selectedProductCode: string | undefined,
): Set<string> {
  const matched = new Set<string>();
  const keys = Object.keys(newlyAlertedMap);
  if (keys.length === 0 || productMeasurementPoints.length === 0) return matched;
  const prodCode = selectedProductCode;
  for (const mp of productMeasurementPoints) {
    const mpId = String(mp.id);
    // Prefer product-scoped keys to prevent cross-product flash animation leaking
    if (prodCode) {
      const scopedId = `${prodCode}::${mpId}`;
      const scopedCode = mp.code ? `${prodCode}::${mp.code}` : '';
      const scopedName = mp.name ? `${prodCode}::${mp.name}` : '';
      if (newlyAlertedMap[scopedId] || (scopedCode && newlyAlertedMap[scopedCode]) || (scopedName && newlyAlertedMap[scopedName])) {
        matched.add(mpId);
      }
    } else {
      // No product selected — fall back to bare key matching
      for (const key of keys) {
        if (key === mpId || key === mp.code || key === mp.name) {
          matched.add(mpId);
          break;
        }
      }
    }
  }
  return matched;
}

/**
 * Map product measurement points to InspectionPoint format for PCB canvas.
 * positionX/Y might be: pixel coordinates, percentages (0-100), or already normalized (0-1).
 * Auto-detect coordinate system based on value ranges.
 */
export function buildProductPoints(params: {
  productMeasurementPoints: ApiMeasurementPoint[];
  resolvedImgW: number | undefined;
  resolvedImgH: number | undefined;
  effectiveAlertedProductPointIds: Set<string>;
  hasLatestAlert: boolean;
  pointDataMap: Record<string, PointAccumulatedData>;
  selectedProductCode: string | undefined;
  filterPointsByWorkstation: boolean;
  workstationId: number | null | undefined;
}): InspectionPoint[] {
  const {
    productMeasurementPoints, resolvedImgW, resolvedImgH,
    effectiveAlertedProductPointIds, hasLatestAlert, pointDataMap,
    selectedProductCode, filterPointsByWorkstation, workstationId,
  } = params;
  if (productMeasurementPoints.length === 0) return [];

  // Apply workstation filter if enabled
  const wsFilterEnabled = filterPointsByWorkstation && workstationId != null;
  const wsId = workstationId;
  const filteredMPs = wsFilterEnabled
    ? productMeasurementPoints.filter((mp) => {
        // Match workstationId (number) from API against workstationId setting (number)
        const mpWsId = mp.workstationId;
        if (mpWsId == null) return false; // Exclude points without workstation info
        return Number(mpWsId) === Number(wsId);
      })
    : productMeasurementPoints;
  if (filteredMPs.length === 0) return [];

  // Use resolved dimensions (API → auto-detected → fallback)
  const imgW = resolvedImgW || 800;
  const imgH = resolvedImgH || 600;

  // Check if API provides normalizedX/Y (API v2.0) — prefer these over positionX/Y
  const hasNormalizedCoords = filteredMPs.some(
    (mp) => mp.normalizedX != null && mp.normalizedY != null,
  );

  // Separate points WITH and WITHOUT usable coordinates
  // Points without coordinates still appear in Left Panel table but auto-positioned on canvas
  const pointsWithCoords = filteredMPs.filter((mp) =>
    (mp.normalizedX != null && mp.normalizedY != null) ||
    (mp.positionX != null && mp.positionY != null),
  );
  const pointsWithoutCoords = filteredMPs.filter((mp) =>
    (mp.normalizedX == null || mp.normalizedY == null) &&
    (mp.positionX == null || mp.positionY == null),
  );

  // Fallback coordinate system detection (only used when normalizedX/Y not available
  // AND per-point imageWidth/imageHeight not available)
  let coordSystem = 'api-normalized';
  let isNormalized = false;
  let isPercentage = false;
  // Check if per-point imageWidth/imageHeight are available (stamped by getProductFullData / machineApi)
  const hasPerPointDims = pointsWithCoords.some((mp) => mp.imageWidth && mp.imageHeight);

  if (!hasNormalizedCoords) {
    const posPoints = pointsWithCoords.filter((mp) => mp.positionX != null && mp.positionY != null);
    const allX = posPoints.map((mp) => mp.positionX!);
    const allY = posPoints.map((mp) => mp.positionY!);
    const maxX = allX.length > 0 ? Math.max(...allX) : 0;
    const maxY = allY.length > 0 ? Math.max(...allY) : 0;
    const minX = allX.length > 0 ? Math.min(...allX) : 0;
    const minY = allY.length > 0 ? Math.min(...allY) : 0;

    // Determine coordinate system:
    //   - Per-point imageWidth/imageHeight available → use per-point pixel division
    //   - All values in [0, 1] → already normalized
    //   - All values in (1, 100] with image > 200px → likely percentages
    //   - Otherwise → pixel coordinates, divide by image dimensions
    if (hasPerPointDims) {
      coordSystem = 'per-point-pixel';
    } else {
      isNormalized = posPoints.length > 0 && maxX <= 1.0 && maxY <= 1.0 && minX >= 0 && minY >= 0;
      isPercentage = !isNormalized && posPoints.length > 0
        && maxX > 1 && maxX <= 100 && maxY > 1 && maxY <= 100
        && imgW > 200;
      coordSystem = isNormalized ? 'normalized' : isPercentage ? 'percentage' : 'pixel';
    }

  }

  // Map ALL measurement points (not just those with coordinates)
  // Points without coordinates are auto-positioned in a grid at the bottom of the image
  const totalNoCoords = pointsWithoutCoords.length;
  const gridCols = Math.max(1, Math.ceil(Math.sqrt(totalNoCoords)));
  let noCoordIdx = 0;

  const result = filteredMPs.map((mp) => {
      let nx: number;
      let ny: number;

      const hasCoords = (mp.normalizedX != null && mp.normalizedY != null) ||
        (mp.positionX != null && mp.positionY != null);

      if (hasCoords) {
        // PREFER normalizedX/Y from API v2.0 when available
        if (mp.normalizedX != null && mp.normalizedY != null) {
          nx = typeof mp.normalizedX === 'string' ? parseFloat(mp.normalizedX) : mp.normalizedX;
          ny = typeof mp.normalizedY === 'string' ? parseFloat(mp.normalizedY) : mp.normalizedY;
          // Safety: if "normalized" values > 1, they're likely pixel coords mislabeled
          if (nx > 1 || ny > 1) {
            const normW = mp.imageWidth || imgW;
            const normH = mp.imageHeight || imgH;
            if (nx > 1) nx = nx / normW;
            if (ny > 1) ny = ny / normH;
          }
        } else if (mp.imageWidth && mp.imageHeight && mp.positionX != null && mp.positionY != null) {
          nx = mp.positionX / mp.imageWidth;
          ny = mp.positionY / mp.imageHeight;
        } else if (isNormalized) {
          nx = mp.positionX!;
          ny = mp.positionY!;
        } else if (isPercentage) {
          nx = mp.positionX! / 100;
          ny = mp.positionY! / 100;
        } else {
          nx = mp.positionX! / imgW;
          ny = mp.positionY! / imgH;
        }
      } else {
        // Auto-position: distribute coordinate-less points in a grid at bottom of canvas
        const col = noCoordIdx % gridCols;
        const row = Math.floor(noCoordIdx / gridCols);
        nx = 0.05 + (col / Math.max(1, gridCols)) * 0.9;
        ny = 0.85 + (row * 0.05);
        noCoordIdx++;
      }

      // Clamp to valid range [0, 1]
      nx = Math.max(0, Math.min(1, nx));
      ny = Math.max(0, Math.min(1, ny));

      const mpId = String(mp.id);
      const isAlerted = effectiveAlertedProductPointIds.has(mpId);

      // Use accumulated real-time data from pointDataMap if available
      // Only use product-scoped key to prevent cross-product data leaking
      const productScopedKey = selectedProductCode ? `${selectedProductCode}::${mpId}` : mpId;
      const pd = pointDataMap[productScopedKey];
      const hasRealData = pd && pd.totalInspections > 0;

      const defectRate = hasRealData ? Math.round(pd.defectRate * 10) / 10 : 0;
      // Status priority:
      //   1. MQTT alert NG → 'fail'
      //   2. MQTT latest alert exists but point not NG → 'pass'
      //   3. A10 API-provided status (server-calculated thresholds) — most accurate for polling
      //   4. Fallback: defectRate-based thresholds (30%/15%)
      const status: InspectionPointStatus = isAlerted
        ? 'fail'
        : hasLatestAlert
          ? 'pass'
          : pd?.apiStatus
            ? (pd.apiStatus as InspectionPointStatus)
            : hasRealData
              ? (defectRate > 30 ? 'fail' : defectRate > 15 ? 'warn' : 'pass')
              : 'pass';
      const trend = hasRealData && pd.trend.length >= 2 ? pd.trend : [];
      const defects: InspectionDefect[] = hasRealData && pd.defects.length > 0
        ? pd.defects
        : [];
      const measurements: InspectionMeasurement[] = hasRealData && pd.measurements.length > 0
        ? pd.measurements
        : [];
      const events: InspectionEvent[] = hasRealData && pd.events.length > 0
        ? pd.events
        : [];

      // orderIndex: server trả về 0-based, cần +1 để hiển thị 1-based giống web
      const fullIdx = productMeasurementPoints.indexOf(mp);
      const oi = mp.orderIndex != null ? mp.orderIndex + 1 : (fullIdx >= 0 ? fullIdx + 1 : undefined);

      return {
        id: mpId,
        code: mp.code,
        name: mp.name || mp.code,
        type: (mp.measurementType as InspectionPointType) || 'Visual',
        status,
        defectRate,
        x: nx,
        y: ny,
        defects,
        measurements,
        trend,
        events,
        orderIndex: oi,
      };
    });

  // Diagnostic: summarize key matching for product points
  const withData = result.filter(p => p.defectRate > 0 || p.status !== 'pass');
  const pdmKeys = Object.keys(pointDataMap);
  console.log('[StationDetail] productPoints useMemo:',
    'mpCount=', filteredMPs.length,
    'withCoords=', pointsWithCoords.length,
    'withoutCoords=', pointsWithoutCoords.length,
    'resultPts=', result.length,
    'withData=', withData.length,
    'pdmKeys=', pdmKeys.length,
    'productCode=', selectedProductCode,
    'samplePDMKeys=', pdmKeys.slice(0, 5),
    'coordSystem=', coordSystem);
  return result;
}
