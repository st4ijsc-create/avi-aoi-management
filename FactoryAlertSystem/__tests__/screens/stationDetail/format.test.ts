/**
 * Unit tests for stationDetail/utils/format — pure formatters & heatmap scale helpers
 * extracted from StationDetailScreen.tsx (MB11 / W8-D decomposition).
 */
import { formatPercent, formatTimeAgo, heatColor, heatRadius } from '../../../src/screens/stationDetail/utils/format';

describe('formatPercent', () => {
  it('formats with one decimal and % suffix', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(12.34)).toBe('12.3%');
    expect(formatPercent(99.99)).toBe('100.0%');
  });
});

describe('heatColor', () => {
  it('maps defect rate bands to the documented colors', () => {
    expect(heatColor(0)).toBe('#22C55E');    // < 15
    expect(heatColor(14.9)).toBe('#22C55E');
    expect(heatColor(15)).toBe('#F59E0B');   // 15–35
    expect(heatColor(34.9)).toBe('#F59E0B');
    expect(heatColor(35)).toBe('#F97316');   // 35–60
    expect(heatColor(59.9)).toBe('#F97316');
    expect(heatColor(60)).toBe('#EF4444');   // >= 60
    expect(heatColor(100)).toBe('#EF4444');
  });
});

describe('heatRadius', () => {
  it('grows linearly from 18 and caps the rate at 100', () => {
    expect(heatRadius(0)).toBe(18);
    expect(heatRadius(50)).toBe(18 + 50 * 0.35);
    expect(heatRadius(100)).toBe(18 + 100 * 0.35);
    expect(heatRadius(250)).toBe(18 + 100 * 0.35); // capped
  });
});

describe('formatTimeAgo', () => {
  const NOW = new Date('2026-07-04T12:00:00.000Z').getTime();
  beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(NOW); });
  afterEach(() => { (Date.now as jest.Mock).mockRestore(); });

  it('returns "just now" strings under a minute, per language', () => {
    const iso = new Date(NOW - 30 * 1000).toISOString();
    expect(formatTimeAgo(iso, 'vi')).toBe('Vừa xong');
    expect(formatTimeAgo(iso, 'zh')).toBe('刚刚');
    expect(formatTimeAgo(iso, 'en')).toBe('Just now');
  });

  it('returns minutes under an hour', () => {
    const iso = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(formatTimeAgo(iso, 'vi')).toBe('5 phút trước');
    expect(formatTimeAgo(iso, 'en')).toBe('5 min ago');
    expect(formatTimeAgo(iso, 'zh')).toBe('5 分钟前');
  });

  it('returns hours from 60 minutes up', () => {
    const iso = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(iso, 'vi')).toBe('3 giờ trước');
    expect(formatTimeAgo(iso, 'en')).toBe('3 hr ago');
  });
});
