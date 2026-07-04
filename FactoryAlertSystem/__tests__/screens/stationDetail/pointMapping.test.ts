/**
 * Unit tests for stationDetail/utils/pointMapping — pure alert-matching and
 * PCB point-mapping calculators extracted from StationDetailScreen.tsx (MB11 / W8-D).
 */
import {
  computeAlertedProductPointIds,
  computeHasLatestAlert,
  filterEffectiveAlertedPointIds,
  buildAlertBubbleData,
  computeNewlyAlertedProductPointIds,
  buildProductPoints,
} from '../../../src/screens/stationDetail/utils/pointMapping';
import type { ApiMeasurementPoint } from '../../../src/services/stationService';
import type { Alert, PointAccumulatedData } from '../../../src/types';

const mp = (id: number, code: string, extra: Partial<ApiMeasurementPoint> = {}): ApiMeasurementPoint =>
  ({ id, code, name: `Point ${code}`, ...extra } as ApiMeasurementPoint);

const alertWith = (ngPoints: any[], productCode?: string): Alert =>
  ({
    ngPoints,
    productModel: productCode ? { code: productCode } : undefined,
    error: { type: 'SolderBridge', description: 'Solder bridge detected' },
  } as unknown as Alert);

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterAll(() => { (console.log as jest.Mock).mockRestore(); });

describe('computeAlertedProductPointIds', () => {
  const points = [mp(1, 'MP-A'), mp(2, 'MP-B')];

  it('matches NG points by pointId and by pointName (code or name)', () => {
    const alerts = [alertWith([
      { result: 'NG', pointId: 1 },
      { result: 'NG', pointName: 'MP-B' },
      { result: 'OK', pointId: 2 },
    ], 'PRD')];
    const matched = computeAlertedProductPointIds(points, alerts, 'PRD');
    expect(matched).toEqual(new Set(['1', '2']));
  });

  it('requires the alert to identify the exact selected product', () => {
    const alerts = [alertWith([{ result: 'NG', pointId: 1 }], 'OTHER')];
    expect(computeAlertedProductPointIds(points, alerts, 'PRD').size).toBe(0);
  });

  it('returns empty when there are no points or no alerts', () => {
    expect(computeAlertedProductPointIds([], [alertWith([], 'PRD')], 'PRD').size).toBe(0);
    expect(computeAlertedProductPointIds(points, [], 'PRD').size).toBe(0);
  });
});

describe('computeHasLatestAlert', () => {
  it('is true only when an alert with ngPoints matches the product', () => {
    const alerts = [alertWith([{ result: 'NG', pointId: 1 }], 'PRD')];
    expect(computeHasLatestAlert(alerts, 'PRD')).toBe(true);
    expect(computeHasLatestAlert(alerts, 'OTHER')).toBe(false);
    expect(computeHasLatestAlert([], 'PRD')).toBe(false);
  });
});

describe('filterEffectiveAlertedPointIds', () => {
  const points = [mp(1, 'MP-A'), mp(2, 'MP-B')];

  it('passes through unchanged when ngAutoClearColor is off', () => {
    const ids = new Set(['1', '2']);
    const out = filterEffectiveAlertedPointIds({
      ngAutoClearColor: false, alertedProductPointIds: ids,
      alertedPointIds: new Set<string>(), productMeasurementPoints: points,
    });
    expect(out).toBe(ids);
  });

  it('clears everything when the store set is empty (all dismissed)', () => {
    const out = filterEffectiveAlertedPointIds({
      ngAutoClearColor: true, alertedProductPointIds: new Set(['1']),
      alertedPointIds: new Set<string>(), productMeasurementPoints: points,
    });
    expect(out.size).toBe(0);
  });

  it('keeps ids present in the store by id, code, or name', () => {
    const out = filterEffectiveAlertedPointIds({
      ngAutoClearColor: true,
      alertedProductPointIds: new Set(['1', '2']),
      alertedPointIds: new Set(['MP-B']), // code form only
      productMeasurementPoints: points,
    });
    expect(out).toEqual(new Set(['2']));
  });
});

describe('buildAlertBubbleData', () => {
  it('builds a bubble entry per matched NG point with error description and values', () => {
    const points = [mp(1, 'MP-A')];
    const alerts = [alertWith([
      { result: 'NG', pointId: 1, pointName: 'MP-A', actualValue: '1.9', expectedValue: '1.2' },
    ], 'PRD')];
    const map = buildAlertBubbleData(points, alerts, 'PRD');
    expect(map.size).toBe(1);
    expect(map.get('1')).toEqual({
      pointName: 'MP-A', result: 'NG', errorDesc: 'Solder bridge detected',
      actualValue: '1.9', expectedValue: '1.2',
    });
  });
});

describe('computeNewlyAlertedProductPointIds', () => {
  const points = [mp(1, 'MP-A'), mp(2, 'MP-B')];

  it('prefers product-scoped keys when a product is selected', () => {
    const out = computeNewlyAlertedProductPointIds(
      { 'PRD::1': Date.now(), '2': Date.now() }, points, 'PRD');
    expect(out).toEqual(new Set(['1'])); // bare "2" must NOT match when product selected
  });

  it('matches product-scoped code/name keys too', () => {
    const out = computeNewlyAlertedProductPointIds({ 'PRD::MP-B': Date.now() }, points, 'PRD');
    expect(out).toEqual(new Set(['2']));
  });

  it('falls back to bare id/code/name matching without a product', () => {
    const out = computeNewlyAlertedProductPointIds({ 'MP-A': Date.now() }, points, undefined);
    expect(out).toEqual(new Set(['1']));
  });
});

describe('buildProductPoints', () => {
  const pd = (over: Partial<PointAccumulatedData>): PointAccumulatedData =>
    ({
      totalInspections: 0, ngCount: 0, defectRate: 0, defects: [], measurements: [],
      events: [], trend: [], errorImageUrls: [], referenceImageUrls: [], lastAlertTime: '',
      ...over,
    } as PointAccumulatedData);

  const base = {
    resolvedImgW: 800,
    resolvedImgH: 600,
    effectiveAlertedProductPointIds: new Set<string>(),
    hasLatestAlert: false,
    pointDataMap: {} as Record<string, PointAccumulatedData>,
    selectedProductCode: 'PRD' as string | undefined,
    filterPointsByWorkstation: false,
    workstationId: null as number | null,
  };

  it('returns [] without measurement points', () => {
    expect(buildProductPoints({ ...base, productMeasurementPoints: [] })).toEqual([]);
  });

  it('prefers normalizedX/Y and clamps to [0,1]', () => {
    const out = buildProductPoints({
      ...base,
      productMeasurementPoints: [
        mp(1, 'A', { normalizedX: 0.25, normalizedY: '0.75' as any }),
        mp(2, 'B', { normalizedX: 1.5, normalizedY: -2, imageWidth: 800, imageHeight: 600 }),
      ],
    });
    expect(out[0].x).toBeCloseTo(0.25);
    expect(out[0].y).toBeCloseTo(0.75);
    // 1.5 > 1 → treated as pixels / imageWidth → 1.5/800; -2 clamps to 0
    expect(out[1].x).toBeCloseTo(1.5 / 800);
    expect(out[1].y).toBe(0);
  });

  it('divides pixel positions by image dimensions when not normalized', () => {
    const out = buildProductPoints({
      ...base,
      productMeasurementPoints: [mp(1, 'A', { positionX: 400, positionY: 300 })],
    });
    expect(out[0].x).toBeCloseTo(0.5);
    expect(out[0].y).toBeCloseTo(0.5);
  });

  it('uses product-scoped pointDataMap data and defect-rate thresholds for status', () => {
    const out = buildProductPoints({
      ...base,
      productMeasurementPoints: [mp(1, 'A', { normalizedX: 0.1, normalizedY: 0.1 })],
      pointDataMap: { 'PRD::1': pd({ totalInspections: 100, ngCount: 40, defectRate: 40 }) },
    });
    expect(out[0].defectRate).toBe(40);
    expect(out[0].status).toBe('fail'); // > 30%
  });

  it('alerted points are fail; with a latest alert others are pass', () => {
    const out = buildProductPoints({
      ...base,
      hasLatestAlert: true,
      effectiveAlertedProductPointIds: new Set(['1']),
      productMeasurementPoints: [
        mp(1, 'A', { normalizedX: 0.1, normalizedY: 0.1 }),
        mp(2, 'B', { normalizedX: 0.2, normalizedY: 0.2 }),
      ],
      pointDataMap: { 'PRD::2': pd({ totalInspections: 10, ngCount: 9, defectRate: 90 }) },
    });
    expect(out[0].status).toBe('fail');
    expect(out[1].status).toBe('pass'); // suppressed by hasLatestAlert
  });

  it('filters by workstation when enabled (points without ws excluded)', () => {
    const out = buildProductPoints({
      ...base,
      filterPointsByWorkstation: true,
      workstationId: 7,
      productMeasurementPoints: [
        mp(1, 'A', { normalizedX: 0.1, normalizedY: 0.1, workstationId: 7 } as any),
        mp(2, 'B', { normalizedX: 0.2, normalizedY: 0.2, workstationId: 8 } as any),
        mp(3, 'C', { normalizedX: 0.3, normalizedY: 0.3 }), // no ws → excluded
      ],
    });
    expect(out.map((p) => p.id)).toEqual(['1']);
  });

  it('auto-positions points without coordinates and 1-bases orderIndex', () => {
    const out = buildProductPoints({
      ...base,
      productMeasurementPoints: [mp(1, 'A', { orderIndex: 0 } as any)],
    });
    expect(out[0].y).toBeGreaterThanOrEqual(0.85); // bottom grid
    expect(out[0].orderIndex).toBe(1); // server 0-based → +1
  });
});
