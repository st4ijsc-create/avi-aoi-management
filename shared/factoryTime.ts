/**
 * doc 81 Đợt 3c fix 1 — phần THUẦN (Intl, không import, không `process`) của bộ giờ nhà máy, dùng chung server ⇄ client.
 *
 * `server/utils/factoryTime.ts` RE-EXPORT các hàm này (một bản cài đặt duy nhất) và giữ phần chỉ-server (múi giờ mặc định
 * từ env `FACTORY_TZ`, lịch chạy, đọc chuỗi giờ máy…). Client (bộ chọn ca `ProductionShifts.tsx`) import TỪ ĐÂY — không bao
 * giờ import runtime từ `server/` (một import tương lai của logger/db vào tệp server sẽ kéo mã node vào bundle trình duyệt).
 *
 * ⚠ Giữ tệp này KHÔNG có import nào và KHÔNG đụng `process` — nó chạy trong trình duyệt.
 */

/** True when `tz` is a valid IANA timezone identifier usable by Intl. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    // Throws RangeError for unknown timezone identifiers.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock components of an instant as seen in a given timezone. */
export interface WallClock {
  year: number;
  /** 1–12 (human month, NOT the JS 0-based month). */
  month: number;
  /** 1–31 */
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday (same convention as `scheduledReports.scheduleDayOfWeek`). */
  dayOfWeek: number;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23", // avoid the "24:00" quirk of hour12:false
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

/** The wall clock in `timeZone` (REQUIRED here — the server wrapper defaults it to the factory TZ) at instant `date`. */
export function wallClockInZone(date: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(date);
  const v: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") v[p.type] = Number(p.value);
  }
  const year = v.year;
  const month = v.month;
  const day = v.day;
  const hour = (v.hour ?? 0) % 24; // defensive vs engines emitting 24
  // Weekday of the wall-clock DATE (built purely from wall parts, so it is the
  // weekday the factory sees, independent of server TZ).
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute: v.minute ?? 0, second: v.second ?? 0, dayOfWeek };
}
