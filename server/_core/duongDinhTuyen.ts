/**
 * doc 81 Đợt 5 G fix 2/3 (re-review N1, R2-1; ruling R-5-b) — the ONE place that answers "which path will Express route
 * this request to?", lower-cased, for every security classification in server/_core (originCheck, rateLimitConfig).
 *
 * G fix 3: the path comes from EXACTLY the parser Express's router uses — `parseurl` (Express 4 router:
 * `parseUrl(req).pathname`), resolved FROM Express's own install so it is the very same module and version, and
 * `parseurl.original(req)` so it reads `originalUrl` (the full target) whatever mount point a middleware runs under.
 * A hand-written mirror (fix 2) disagreed with it: parseurl hands any target containing `#` to `url.parse`, which treats
 * a leading `//userinfo@host` as an authority — `POST //a@b/api/ot/ingest#x` is routed to `/api/ot/ingest` while the
 * mirror saw `//a@b/api/ot/ingest`. Only for plain objects without `originalUrl`/`url` (unit tests) does the helper
 * fall back to a string cut at `?`/`#`. If parseurl throws (Express would fail the request itself), the same fallback
 * is used. The result is never decoded and dot segments are never resolved — like Express.
 */
import { createRequire } from "node:module";

export interface YeuCauCoDuong {
  originalUrl?: string;
  url?: string;
  path?: string;
}

type ParseUrl = { original(req: unknown): { pathname?: string | null } | undefined };

// parseurl is a dependency OF EXPRESS (not of this project): resolve it relative to express/package.json so the router
// and this helper always run the same code. Lazy, once.
let parseurlCache: ParseUrl | null = null;
function parseurl(): ParseUrl {
  if (!parseurlCache) {
    const rootRequire = createRequire(import.meta.url);
    const expressRequire = createRequire(rootRequire.resolve("express"));
    parseurlCache = expressRequire("parseurl") as ParseUrl;
  }
  return parseurlCache;
}

function catChuoi(raw: string): string {
  const cut = raw.search(/[?#]/);
  return cut === -1 ? raw : raw.slice(0, cut);
}

/** The path Express routes this request on (no query, no fragment, no scheme/authority), as given — case kept. */
export function duongDinhTuyenGoc(req: YeuCauCoDuong): string {
  if (typeof req.originalUrl === "string" || typeof req.url === "string") {
    try {
      // parseurl memoises on the object (`_parsedOriginalUrl`), exactly as Express does on a real request.
      const pathname = parseurl().original(req)?.pathname;
      if (typeof pathname === "string") return pathname;
    } catch {
      /* fall through — Express cannot route what parseurl cannot parse */
    }
    return catChuoi(String(req.originalUrl ?? req.url ?? ""));
  }
  return catChuoi(String(req.path ?? ""));
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
