/**
 * doc 81 Đợt 5 G fix 2 (re-review N1, ruling R-5-b) — the ONE place that answers "which path will Express route this
 * request to?", lower-cased, for every security classification in server/_core (originCheck, rateLimitConfig).
 *
 * Express routes on `parseurl(req).pathname` and matches case-insensitively (`caseSensitive: false`). Splitting the raw
 * request line on `?` only was not the same thing — Node also accepts:
 *   · absolute-form  `POST http://x/api/ot/ingest`  — the path is after the authority;
 *   · a fragment     `POST /api/ot/ingest#x`        — parseurl drops it, the router still matches `/api/ot/ingest`.
 * Those variants reached the handler while missing classification (fresh rate-limit bucket per random Bearer, guard
 * skipped, `/api/machine/claim#x` in the 60k tier). Both modules now call this helper, so they cannot diverge again.
 *
 * Mirrors parseurl's result without `url.parse` (deprecated, DEP0169): origin-form ⇒ cut at the first `?` or `#`;
 * absolute-form ⇒ drop `scheme://authority` first (empty path ⇒ "/"). Nothing is decoded and no dot segment is
 * resolved — exactly like Express, which does not route `/./api/…` or `/api%2Ftrpc` to `/api` handlers either.
 * Uses `originalUrl` (the full target, independent of the mount point a middleware runs under), then `url`, then
 * `path` (plain request objects in unit tests).
 */
export interface YeuCauCoDuong {
  originalUrl?: string;
  url?: string;
  path?: string;
}

const ABSOLUTE_FORM = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/** The path Express routes this request on (no query, no fragment, no scheme/authority), as given — case kept. */
export function duongDinhTuyenGoc(req: YeuCauCoDuong): string {
  let raw = String(req.originalUrl || req.url || req.path || "");
  const abs = raw.match(ABSOLUTE_FORM);
  if (abs) raw = raw.slice(abs[0].length) || "/";
  const cut = raw.search(/[?#]/);
  return cut === -1 ? raw : raw.slice(0, cut);
}

/** Same, lower-cased — what every prefix / exact-path security comparison must use. */
export function duongDinhTuyen(req: YeuCauCoDuong): string {
  return duongDinhTuyenGoc(req).toLowerCase();
}

/**
 * For EXACT-path comparisons: Express (`strict: false`) routes `/x/` to the handler of `/x`, but not `/x//` — drop ONE
 * trailing slash (never from "/" and never from a doubled one). Prefix comparisons do not need this.
 */
export function duongKhopChinhXac(pLower: string): string {
  return pLower.length > 1 && pLower.endsWith("/") && !pLower.endsWith("//") ? pLower.slice(0, -1) : pLower;
}
