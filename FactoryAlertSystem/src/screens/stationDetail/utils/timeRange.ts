/**
 * StationDetail — panel time-range date helpers (server-clock based).
 * MB11 decomposition: moved verbatim from StationDetailScreen.tsx.
 */
import { getServerNow } from '../../../services/stationService';
import type { PanelTimeRange } from '../types';

/** Calculate start/end dates for a given panel time range (full ISO with time) */
function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getTimeRangeDates(range: PanelTimeRange): { startDate: string; endDate: string } {
  const now = getServerNow();
  const todayStr = formatLocalDate(now);
  // Use local time (no Z suffix) — the server interprets dates in its own timezone
  // Using Z would cause the range to be offset by the timezone difference (e.g., +8h for UTC+8)
  const startSuffix = 'T00:00:00.000';
  const endSuffix = 'T23:59:59.999';
  switch (range) {
    case 'today': return { startDate: todayStr + startSuffix, endDate: todayStr + endSuffix };
    case 'yesterday': {
      const yd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return { startDate: formatLocalDate(yd) + startSuffix, endDate: formatLocalDate(yd) + endSuffix };
    }
    case 'week': {
      const wd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      return { startDate: formatLocalDate(wd) + startSuffix, endDate: todayStr + endSuffix };
    }
    case 'month': {
      const md = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      return { startDate: formatLocalDate(md) + startSuffix, endDate: todayStr + endSuffix };
    }
  }
}

const TIME_RANGE_OPTIONS: PanelTimeRange[] = ['today', 'yesterday', 'week', 'month'];

/** Format a Date as DD/MM */
const fmtDM = (d: Date): string => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
/** Format a Date as DD/MM/YYYY */
const fmtDMY = (d: Date): string => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

/** Build compact label showing actual date for a time range */
function getTimeRangeLabel(range: PanelTimeRange, compact: boolean): string {
  const now = getServerNow();
  switch (range) {
    case 'today': {
      return compact ? fmtDM(now) : fmtDMY(now);
    }
    case 'yesterday': {
      const yd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return compact ? fmtDM(yd) : fmtDMY(yd);
    }
    case 'week': {
      const wd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      return compact ? `${fmtDM(wd)} - ${fmtDM(now)}` : `${fmtDMY(wd)} → ${fmtDMY(now)}`;
    }
    case 'month': {
      const md = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      return compact ? `${fmtDM(md)} - ${fmtDM(now)}` : `${fmtDMY(md)} → ${fmtDMY(now)}`;
    }
  }
}

/** Subtitle showing the range type */
function getTimeRangeSubtitle(range: PanelTimeRange, language: string): string {
  const map: Record<PanelTimeRange, string> = {
    today: language === 'vi' ? 'Hôm nay' : language === 'zh' ? '今天' : 'Today',
    yesterday: language === 'vi' ? 'Hôm qua' : language === 'zh' ? '昨天' : 'Yesterday',
    week: language === 'vi' ? '7 ngày' : language === 'zh' ? '7天' : '7 Days',
    month: language === 'vi' ? '30 ngày' : language === 'zh' ? '30天' : '30 Days',
  };
  return map[range];
}

export { TIME_RANGE_OPTIONS, formatLocalDate, fmtDM, fmtDMY, getTimeRangeDates, getTimeRangeLabel, getTimeRangeSubtitle };
