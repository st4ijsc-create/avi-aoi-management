/**
 * Factory Alert System — Web Report Link helper (doc 32, Wave R3, decision #5)
 *
 * Decision #5 keeps mobile LIGHT: instead of server-rendering and downloading a
 * report FILE on the phone, the app deep-links into the full WEB report so the
 * device browser (which already handles login/session) renders every chart and
 * table. FullReportModal calls this to build the "Mở báo cáo web" / "Open web
 * report" target and the shareable link.
 *
 * Pure URL builder — no React Native imports — so it unit-tests in isolation.
 * The web SPA is served at the same origin as the API base URL, so the report
 * routes ("/station-analysis/:id", "/reports") live under `getServerBaseUrl()`.
 */

export interface StationWebReportParams {
  /** API/web origin (e.g. getServerBaseUrl()); the web SPA is served at this root. */
  baseUrl: string | null | undefined;
  /** Numeric server station id (selectApiStationId → "1"); falls back to /reports when absent. */
  stationId?: string | number | null;
  /** Optional explicit date window; when both `from` and `to` are set → dp=custom. */
  from?: Date | string | null;
  to?: Date | string | null;
  /** Web date-preset token (today | yesterday | 1w | 1m | year). Ignored when from&to are set. */
  datePreset?: string | null;
}

/** Web SPA route that renders the full per-station analysis report (all charts + tables). */
const STATION_ANALYSIS_ROUTE = '/station-analysis';
/** Generic reports page used when no station id is resolvable. */
const REPORTS_FALLBACK_ROUTE = '/reports';

function toIso(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Build the full web-report URL for the station shown in FullReportModal.
 *
 * - Returns `null` when the server is not configured (empty base URL) — the
 *   caller shows a "configure server" alert instead of opening a bad link.
 * - Points at `/station-analysis/:id` when a station id is available (the web
 *   route that mirrors the mobile in-place report, with every chart), else the
 *   generic `/reports` page.
 * - Encodes an optional date scope the web route understands (`dp`/`from`/`to`).
 */
export function buildStationWebReportUrl(params: StationWebReportParams): string | null {
  const base = String(params.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) return null;

  const sid = params.stationId == null ? '' : String(params.stationId).trim();
  const path = sid
    ? `${STATION_ANALYSIS_ROUTE}/${encodeURIComponent(sid)}`
    : REPORTS_FALLBACK_ROUTE;

  const qs: string[] = [];
  const fromIso = params.from != null ? toIso(params.from) : null;
  const toIso2 = params.to != null ? toIso(params.to) : null;
  if (fromIso && toIso2) {
    qs.push('dp=custom');
    qs.push(`from=${encodeURIComponent(fromIso)}`);
    qs.push(`to=${encodeURIComponent(toIso2)}`);
  } else if (params.datePreset) {
    qs.push(`dp=${encodeURIComponent(params.datePreset)}`);
  }

  return qs.length ? `${base}${path}?${qs.join('&')}` : `${base}${path}`;
}
