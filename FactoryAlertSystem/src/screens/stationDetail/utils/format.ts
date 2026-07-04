/**
 * StationDetail — pure formatters & heatmap scale helpers.
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx.
 */
import type { Language } from '../../../types';

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatTimeAgo(isoString: string, language: Language): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return language === 'vi' ? 'Vừa xong' : language === 'zh' ? '刚刚' : 'Just now';
  if (minutes < 60) return `${minutes} ${language === 'vi' ? 'phút trước' : language === 'zh' ? '分钟前' : 'min ago'}`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${language === 'vi' ? 'giờ trước' : language === 'zh' ? '小时前' : 'hr ago'}`;
}

/** Map defect rate (0-100) → color */
function heatColor(rate: number): string {
  if (rate >= 60) return '#EF4444';
  if (rate >= 35) return '#F97316';
  if (rate >= 15) return '#F59E0B';
  return '#22C55E';
}

/** Heatmap blob radius based on defect rate */
function heatRadius(rate: number): number {
  return 18 + Math.min(rate, 100) * 0.35;
}

export { formatPercent, formatTimeAgo, heatColor, heatRadius };
