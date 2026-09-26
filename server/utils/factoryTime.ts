/**
 * factoryTime — central factory-timezone helpers.
 *
 * Doc 27 §6 gap A1 (P0) / §11 item 1.3: every scheduled job (cron, next-run
 * computation, day bucketing) must be anchored to the FACTORY timezone — env
 * `FACTORY_TZ`, default `Asia/Ho_Chi_Minh` — never the server/OS timezone.
 *
 * Historical incident this guards against (doc 27 §6 A1): scheduled-report
 * crons fired in the server's local TZ while data was interpreted as
 * factory-local, which shifted reports/data by hours in production and had to
 * be patched by hand (a one-off `UPDATE product_inspections SET
 * "inspectionTime" = "inspectionTime" + INTERVAL '7 hours'`). The one-off
 * patch/diagnosis SQL files were removed from the repo root in the Đợt-4
 * cleanup after the fix was verified green (doc 27 Đợt 1.3 / B11); the
 * code-level fix is to route ALL schedule math through this module.
 *
 * Implementation notes:
 * - Pure Intl APIs (no new dependencies; `date-fns-tz`/`@date-fns/tz` are not
 *   direct deps of this repo).
 * - DST-safe: wall-clock → UTC conversion uses the standard two-pass offset
 *   fix-up. Vietnam has no DST, but the helpers stay correct for any IANA TZ.
 */

export const DEFAULT_FACTORY_TZ = "Asia/Ho_Chi_Minh";

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

let warnedInvalidTz: string | null = null;

/**
 * The factory timezone: env `FACTORY_TZ` (validated), default Asia/Ho_Chi_Minh.
 * Read at call time (not import time) so tests / runtime reconfiguration work.
 */
export function getFactoryTimezone(): string {
  const raw = (process.env.FACTORY_TZ ?? "").trim();
  if (!raw) return DEFAULT_FACTORY_TZ;
  if (isValidTimeZone(raw)) return raw;
  if (warnedInvalidTz !== raw) {
    warnedInvalidTz = raw;
    console.warn(
      `[factoryTime] Invalid FACTORY_TZ '${raw}' — falling back to ${DEFAULT_FACTORY_TZ}`,
    );
  }
  return DEFAULT_FACTORY_TZ;
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

export interface WallClockInput {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
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

/** The wall clock in `timeZone` (default: factory TZ) at instant `date`. */
export function wallClockInZone(date: Date, timeZone: string = getFactoryTimezone()): WallClock {
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

/**
 * UTC offset of `timeZone` at instant `date`, in milliseconds.
 * Asia/Ho_Chi_Minh → 25_200_000 (+07:00) for any date (no DST).
 */
export function zoneOffsetMs(date: Date, timeZone: string = getFactoryTimezone()): number {
  const wc = wallClockInZone(date, timeZone);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  // Intl drops sub-second precision → compare at whole-second resolution.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Convert a wall-clock time expressed in `timeZone` to the real UTC instant.
 * DST-safe via the standard two-pass offset fix-up; for local times that do
 * not exist (spring-forward gap) the result is deterministic and lands on one
 * side of the gap.
 *
 * Example: { 2026-07-05 06:00 } in Asia/Ho_Chi_Minh → 2026-07-04T23:00:00Z.
 */
export function wallClockToUtc(
  input: WallClockInput,
  timeZone: string = getFactoryTimezone(),
): Date {
  const naive = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour ?? 0,
    input.minute ?? 0,
    input.second ?? 0,
  );
  let ts = naive - zoneOffsetMs(new Date(naive), timeZone);
  ts = naive - zoneOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** Parse "HH:mm" (e.g. scheduledReports.scheduleTime); invalid → `fallback`. */
export function parseHHmm(
  time: string | null | undefined,
  fallback = "08:00",
): { hour: number; minute: number } {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(time ?? "").trim());
  if (m) return { hour: Number(m[1]), minute: Number(m[2]) };
  const f = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(fallback);
  return f ? { hour: Number(f[1]), minute: Number(f[2]) } : { hour: 8, minute: 0 };
}

function daysInMonth(year: number, month: number): number {
  // month is 1-12; day 0 of the NEXT month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addWallDays(
  y: number,
  m: number,
  d: number,
  n: number,
): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export type ScheduleFrequency = "daily" | "weekly" | "monthly";

export interface NextRunOptions {
  frequency: ScheduleFrequency;
  /** Wall-clock fire time "HH:mm" in the target timezone. */
  time: string;
  /** Weekly only: 0 (Sunday) – 6. Default: the weekday of `after` in the zone. */
  dayOfWeek?: number | null;
  /** Monthly only: 1–31, clamped to the target month's length. Default: day of `after` in the zone. */
  dayOfMonth?: number | null;
  /** IANA timezone. Default: getFactoryTimezone(). */
  timeZone?: string;
  /** Reference instant; the result is strictly AFTER this. Default: now. */
  after?: Date;
}

/**
 * Next occurrence of a daily / weekly / monthly schedule, evaluated on the
 * wall clock of `timeZone` and returned as the real UTC instant.
 *
 * A "06:00 daily" schedule means 06:00 in the factory timezone regardless of
 * the server's OS timezone (doc 27 A1).
 */
export function nextRunInZone(opts: NextRunOptions): Date {
  const timeZone = opts.timeZone ?? getFactoryTimezone();
  const after = opts.after ?? new Date();
  const { hour, minute } = parseHHmm(opts.time);
  const now = wallClockInZone(after, timeZone);

  const candidateOn = (y: number, m: number, d: number): Date =>
    wallClockToUtc({ year: y, month: m, day: d, hour, minute }, timeZone);

  switch (opts.frequency) {
    case "daily": {
      let c = candidateOn(now.year, now.month, now.day);
      if (c.getTime() <= after.getTime()) {
        const n = addWallDays(now.year, now.month, now.day, 1);
        c = candidateOn(n.year, n.month, n.day);
      }
      return c;
    }
    case "weekly": {
      const rawTarget = opts.dayOfWeek ?? now.dayOfWeek;
      const target = ((Math.trunc(rawTarget) % 7) + 7) % 7;
      const delta = (target - now.dayOfWeek + 7) % 7;
      let n = addWallDays(now.year, now.month, now.day, delta);
      let c = candidateOn(n.year, n.month, n.day);
      if (c.getTime() <= after.getTime()) {
        n = addWallDays(n.year, n.month, n.day, 7);
        c = candidateOn(n.year, n.month, n.day);
      }
      return c;
    }
    case "monthly": {
      const want = Math.trunc(opts.dayOfMonth ?? now.day);
      const clamp = (y: number, m: number) => Math.min(Math.max(1, want), daysInMonth(y, m));
      let y = now.year;
      let m = now.month;
      let c = candidateOn(y, m, clamp(y, m));
      if (c.getTime() <= after.getTime()) {
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
        c = candidateOn(y, m, clamp(y, m));
      }
      return c;
    }
  }
}

/** UTC instant of local midnight (00:00) in `timeZone` for the wall-date of `date`. */
export function startOfDayInZone(date: Date, timeZone: string = getFactoryTimezone()): Date {
  const wc = wallClockInZone(date, timeZone);
  return wallClockToUtc({ year: wc.year, month: wc.month, day: wc.day }, timeZone);
}

/** "YYYY-MM-DD" day key of `date` as seen in `timeZone` (for day bucketing). */
export function dayKeyInZone(date: Date, timeZone: string = getFactoryTimezone()): string {
  const wc = wallClockInZone(date, timeZone);
  const mm = String(wc.month).padStart(2, "0");
  const dd = String(wc.day).padStart(2, "0");
  return `${wc.year}-${mm}-${dd}`;
}

/**
 * BG-96 (spec Khối C QĐ-1) — đọc một chuỗi ngày/giờ NGƯỜI DÙNG gõ (giờ tường
 * nhà máy) thành instant UTC THẬT, thay cho phép dịch fake-UTC cũ
 * (`d.getTime() - d.getTimezoneOffset()*60000` — phụ thuộc TZ của PROCESS, không
 * phải của nhà máy). Chuỗi có 'Z'/offset rõ ràng đi thẳng `new Date` (người gọi
 * đã nói rõ hệ quy chiếu).
 */
export function docGioTuongNhaMay(dateStr: string, endOfDay = false): Date | undefined {
  const s = String(dateStr).trim();
  if (s === "") return undefined;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) { const d = new Date(s); return isNaN(d.getTime()) ? undefined : d; }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(s);
  if (!m) { const d = new Date(s); return isNaN(d.getTime()) ? undefined : d; }
  const coGio = m[4] !== undefined;
  const utc = wallClockToUtc({
    year: +m[1], month: +m[2], day: +m[3],
    hour: coGio ? +m[4] : endOfDay ? 23 : 0,
    minute: coGio ? +m[5] : endOfDay ? 59 : 0,
    second: coGio ? +(m[6] ?? 0) : endOfDay ? 59 : 0,
  }, getFactoryTimezone());
  const ms = coGio ? +(m[7]?.padEnd(3, "0") ?? 0) : endOfDay ? 999 : 0;
  return new Date(utc.getTime() + ms);
}

/** Chuỗi thời gian có mang múi giờ (`Z`, `+07:00`, `-0500`) hay không — dùng bởi `docGioMay`. */
const CO_MUI_GIO_MAY = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * ★★★ BG-99 (Khối C, ruling controller 2026-09-03, Task 5) — đọc một chuỗi thời gian
 * do MÁY AOI/AVI khai trên đường ingest (`completedAt`/`startedAt`/`inspectionTime` của
 * `machineDataContractV2`/v1.x) thành một instant UTC thật. Di trú nguyên luật từ
 * `mocDoTuChuoi` (BG-97, `server/services/gioiHanLucDoCayV2.ts`, đã XOÁ ở Task 5 vì hết
 * caller sản xuất) lên đây — chỗ dùng CHUNG cho MỌI điểm đọc chuỗi thời gian máy, không
 * riêng spec-gate.
 *
 * ⚠⚠⚠ ĐỪNG NHẦM VỚI `docGioTuongNhaMay` Ở TRÊN — HAI HÀM, HAI LUẬT, HAI NGUỒN CHUỖI
 * KHÁC NHAU:
 *   · `docGioTuongNhaMay` đọc chuỗi NGƯỜI VẬN HÀNH GÕ (bộ lọc ngày trên UI báo cáo) —
 *     chuỗi TRẦN được hiểu là giờ tường **NHÀ MÁY** (`FACTORY_TZ`), đúng trực giác người
 *     dùng ("tôi lọc theo ngày 03/09 giờ nhà máy tôi").
 *   · `docGioMay` (hàm NÀY) đọc chuỗi MÁY AOI/AVI TỰ GỬI trong payload ingest — chuỗi
 *     TRẦN được hiểu là giờ tường **UTC**, KHÔNG phải factory TZ, KHÔNG phải TZ hệ điều
 *     hành server. Lý do (BG-96/BG-97/BG-99, xem báo cáo Task 5):
 *       1. Đây CHÍNH LÀ luật mà drizzle áp cho cột `timestamp` KHÔNG múi giờ khi đọc về
 *          (`measurement_point_versions.changedAt`, `product_inspections.inspectionTime`
 *          — nối "+0000"). Đưa chuỗi máy khai về CÙNG hệ quy chiếu với các cột đó là điều
 *          kiện để mọi phép so ("bo được đo lúc nào so với lượt sửa giới hạn nào", "header
 *          lệch cây bao nhiêu") không phụ thuộc TZ của tiến trình đọc/ghi.
 *       2. Máy gửi giờ ĐỊA PHƯƠNG mà không kèm múi giờ sẽ hiện ra thành SKEW ĐO ĐƯỢC qua
 *          `assessClockSkew` (`machineApiRouters.ts`) thay vì bị TZ hệ điều hành server
 *          âm thầm nuốt (đổi TZ server = đổi kết quả đọc, không tiếng động — bẫy BG-96).
 * Gọi NHẦM hàm ở một trong hai chỗ là lỗi IM LẶNG (lệch một offset, không ném lỗi nào).
 *
 * Chuỗi CÓ múi giờ ('Z', '+07:00', '-0500') được tôn trọng NGUYÊN VĂN. `null`/`undefined`/
 * rỗng/không parse được ⇒ `null` — người gọi tự quyết định lối thoát (KHÔNG bịa
 * `new Date()` ở đây; xem các nơi gọi để biết mỗi đường xử lý `null` thế nào).
 */
export function docGioMay(s: string | null | undefined): Date | null {
  const t = typeof s === "string" ? s.trim() : "";
  if (t.length === 0) return null;
  const d = new Date(CO_MUI_GIO_MAY.test(t) ? t : `${t}Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}
