/**
 * Unit tests for stationDetail/utils/apiMappers — API response mapping helpers
 * extracted from StationDetailScreen.tsx (MB11 / W8-D decomposition).
 */
import {
  sortProductsCatalog,
  mapMeasurementsFromApi,
  mapEventsFromApi,
} from '../../../src/screens/stationDetail/utils/apiMappers';
import type { ProductCatalogItem } from '../../../src/services/stationService';

const prod = (id: string, code: string): ProductCatalogItem =>
  ({ id, code, name: code } as unknown as ProductCatalogItem);

describe('sortProductsCatalog', () => {
  it('pushes "parent" products (code is a prefix of another) to the end', () => {
    const sorted = sortProductsCatalog([
      prod('1', 'GB300'),
      prod('2', 'GB300-BOARD-01'),
      prod('3', 'XA100'),
    ]);
    expect(sorted.map((p) => p.code)).toEqual(['GB300-BOARD-01', 'XA100', 'GB300']);
  });

  it('preserves original API order among non-parents', () => {
    const sorted = sortProductsCatalog([prod('1', 'B2'), prod('2', 'A1'), prod('3', 'C3')]);
    expect(sorted.map((p) => p.code)).toEqual(['B2', 'A1', 'C3']);
  });

  it('handles empty list', () => {
    expect(sortProductsCatalog([])).toEqual([]);
  });
});

describe('mapMeasurementsFromApi', () => {
  it('returns [] when response has no measurements', () => {
    expect(mapMeasurementsFromApi(null, 'fb')).toEqual([]);
    expect(mapMeasurementsFromApi({ data: { measurements: [] } }, 'fb')).toEqual([]);
  });

  it('maps values, spec string from pointDef, and NG status', () => {
    const resp = {
      data: {
        measurements: [
          { serialNumber: 'SN-1', measuredValue: 1.23, result: 'OK' },
          { measuredValueText: 'txt', result: 'NG' },
        ],
        pointDef: { name: 'P1', nominalValue: 1.2, lowerLimit: 1.0, upperLimit: 1.4, unit: 'mm' },
      },
    };
    const out = mapMeasurementsFromApi(resp, 'fallback');
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ param: 'SN-1', val: '1.23', spec: 'Nom:1.2 1~1.4 mm', status: 'ok' });
    // second row: no serialNumber → pointDef.name; text value; NG result
    expect(out[1].param).toBe('P1');
    expect(out[1].val).toBe('txt');
    expect(out[1].status).toBe('ng');
  });

  it('falls back to the provided name and "-" value when fields are missing', () => {
    const out = mapMeasurementsFromApi({ data: { measurements: [{ result: 'OK' }] } }, 'FB-NAME');
    expect(out[0].param).toBe('FB-NAME');
    expect(out[0].val).toBe('-');
    expect(out[0].spec).toBe('');
  });
});

describe('mapEventsFromApi', () => {
  it('returns [] for empty/missing events', () => {
    expect(mapEventsFromApi(null)).toEqual([]);
    expect(mapEventsFromApi({ data: { events: [] } })).toEqual([]);
  });

  it('maps level → type (error/critical=fail, warning=warn, else pass) and message fallback', () => {
    const out = mapEventsFromApi({
      data: {
        events: [
          { createdAt: '2026-07-04T08:15:00Z', message: 'boom', level: 'error' },
          { createdAt: '2026-07-04T08:16:00Z', event: 'evt-name', level: 'warning' },
          { message: 'info msg', level: 'info' },
          { message: 'crit', level: 'critical' },
        ],
      },
    });
    expect(out.map((e) => e.type)).toEqual(['fail', 'warn', 'pass', 'fail']);
    expect(out[0].desc).toBe('boom');
    expect(out[1].desc).toBe('evt-name');
    expect(out[0].time).toMatch(/\d{2}:\d{2}/); // localized HH:mm
    expect(out[2].time).toBe(''); // no createdAt
  });
});
