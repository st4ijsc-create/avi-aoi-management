/**
 * Unit tests for stationDetail/utils/timeRange — server-clock based panel date ranges
 * extracted from StationDetailScreen.tsx (MB11 / W8-D decomposition).
 */
jest.mock('../../../src/services/stationService', () => ({
  // timeRange.ts only imports getServerNow from this module
  getServerNow: jest.fn(() => new Date(2026, 6, 4, 10, 30, 0)), // 2026-07-04 10:30 local
}));

import {
  TIME_RANGE_OPTIONS,
  formatLocalDate,
  fmtDM,
  fmtDMY,
  getTimeRangeDates,
  getTimeRangeLabel,
  getTimeRangeSubtitle,
} from '../../../src/screens/stationDetail/utils/timeRange';

describe('formatLocalDate / fmtDM / fmtDMY', () => {
  const d = new Date(2026, 0, 5); // 05 Jan 2026
  it('formats YYYY-MM-DD with zero padding', () => {
    expect(formatLocalDate(d)).toBe('2026-01-05');
  });
  it('formats DD/MM and DD/MM/YYYY', () => {
    expect(fmtDM(d)).toBe('05/01');
    expect(fmtDMY(d)).toBe('05/01/2026');
  });
});

describe('getTimeRangeDates (server now = 2026-07-04)', () => {
  it('today: full local day without Z suffix', () => {
    expect(getTimeRangeDates('today')).toEqual({
      startDate: '2026-07-04T00:00:00.000',
      endDate: '2026-07-04T23:59:59.999',
    });
  });
  it('yesterday: the previous local day', () => {
    expect(getTimeRangeDates('yesterday')).toEqual({
      startDate: '2026-07-03T00:00:00.000',
      endDate: '2026-07-03T23:59:59.999',
    });
  });
  it('week: 7 days back through today', () => {
    expect(getTimeRangeDates('week')).toEqual({
      startDate: '2026-06-27T00:00:00.000',
      endDate: '2026-07-04T23:59:59.999',
    });
  });
  it('month: 30 days back through today', () => {
    expect(getTimeRangeDates('month')).toEqual({
      startDate: '2026-06-04T00:00:00.000',
      endDate: '2026-07-04T23:59:59.999',
    });
  });
});

describe('getTimeRangeLabel', () => {
  it('compact labels use DD/MM', () => {
    expect(getTimeRangeLabel('today', true)).toBe('04/07');
    expect(getTimeRangeLabel('yesterday', true)).toBe('03/07');
    expect(getTimeRangeLabel('week', true)).toBe('27/06 - 04/07');
    expect(getTimeRangeLabel('month', true)).toBe('04/06 - 04/07');
  });
  it('full labels use DD/MM/YYYY', () => {
    expect(getTimeRangeLabel('today', false)).toBe('04/07/2026');
    expect(getTimeRangeLabel('week', false)).toBe('27/06/2026 → 04/07/2026');
  });
});

describe('getTimeRangeSubtitle', () => {
  it('localizes every option', () => {
    expect(TIME_RANGE_OPTIONS).toEqual(['today', 'yesterday', 'week', 'month']);
    expect(getTimeRangeSubtitle('today', 'vi')).toBe('Hôm nay');
    expect(getTimeRangeSubtitle('today', 'zh')).toBe('今天');
    expect(getTimeRangeSubtitle('today', 'en')).toBe('Today');
    expect(getTimeRangeSubtitle('week', 'vi')).toBe('7 ngày');
    expect(getTimeRangeSubtitle('month', 'en')).toBe('30 Days');
  });
});
