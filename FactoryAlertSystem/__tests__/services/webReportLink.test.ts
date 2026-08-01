/**
 * Unit Tests — Web Report Link helper (doc 32, Wave R3, decision #5)
 * Verifies the station/date scope maps to the correct web-report URL built from
 * the configured server base (serverConfig.getServerBaseUrl()).
 */

import { buildStationWebReportUrl } from '../../src/services/webReportLink';

describe('buildStationWebReportUrl', () => {
  it('returns null when the server is not configured', () => {
    expect(buildStationWebReportUrl({ baseUrl: null, stationId: '1' })).toBeNull();
    expect(buildStationWebReportUrl({ baseUrl: undefined, stationId: '1' })).toBeNull();
    expect(buildStationWebReportUrl({ baseUrl: '   ', stationId: '1' })).toBeNull();
  });

  it('builds a station-analysis URL from base + station id', () => {
    expect(buildStationWebReportUrl({ baseUrl: 'http://10.0.0.5:8080', stationId: '3' })).toBe(
      'http://10.0.0.5:8080/station-analysis/3',
    );
  });

  it('accepts a numeric station id', () => {
    expect(buildStationWebReportUrl({ baseUrl: 'http://host', stationId: 7 })).toBe(
      'http://host/station-analysis/7',
    );
  });

  it('strips trailing slashes from the base URL', () => {
    expect(buildStationWebReportUrl({ baseUrl: 'http://host//', stationId: '2' })).toBe(
      'http://host/station-analysis/2',
    );
  });

  it('adds a date-preset query param', () => {
    expect(
      buildStationWebReportUrl({ baseUrl: 'http://host', stationId: '2', datePreset: 'today' }),
    ).toBe('http://host/station-analysis/2?dp=today');
  });

  it('adds a custom date window when both from & to are given', () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-07-05T00:00:00.000Z');
    const url = buildStationWebReportUrl({ baseUrl: 'http://host', stationId: '2', from, to });
    expect(url).toContain('/station-analysis/2?');
    expect(url).toContain('dp=custom');
    expect(url).toContain(`from=${encodeURIComponent(from.toISOString())}`);
    expect(url).toContain(`to=${encodeURIComponent(to.toISOString())}`);
  });

  it('prefers an explicit from/to window over datePreset', () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-07-05T00:00:00.000Z');
    const url = buildStationWebReportUrl({
      baseUrl: 'http://host',
      stationId: '2',
      from,
      to,
      datePreset: 'today',
    });
    expect(url).toContain('dp=custom');
    expect(url).not.toContain('dp=today');
  });

  it('falls back to /reports when no station id is available', () => {
    expect(
      buildStationWebReportUrl({ baseUrl: 'http://host', stationId: null, datePreset: '1w' }),
    ).toBe('http://host/reports?dp=1w');
  });

  it('ignores an invalid date and emits no query', () => {
    expect(
      buildStationWebReportUrl({
        baseUrl: 'http://host',
        stationId: '2',
        from: 'not-a-date',
        to: 'nope',
      }),
    ).toBe('http://host/station-analysis/2');
  });
});
