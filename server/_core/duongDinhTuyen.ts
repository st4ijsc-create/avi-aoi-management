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
 * fall back to a string cut at `?`/`#`. The result is never decoded and dot segments are never resolved — like Express.
 *
 * doc 81 Đợt 5 final wave F6 (G re-review 3) — FAIL CLOSED: parseurl is resolved ONCE at module load (outside any
 * per-request catch) and a failure is logged loudly; while it is unavailable — or if it throws / answers no pathname for a
 * request — the helper answers DUONG_KHONG_XAC_DINH, a protected API path that matches no exemption and no ingest /
 * bootstrap tier (origin check enforced, general browser rate tier). Never the raw string cut for a real request: that cut
 * keeps `http://x/api/…` and `//a@b/api/…#x` OUT of every API classification.
 */
import { createRequire } from "node:module";

export interface YeuCauCoDuong {
  originalUrl?: string;
  url?: string;
  path?: string;
}

type ParseUrl = { original(req: unknown): { pathname?: string | null } | undefined };

/** F6 — the fail-closed answer: a protected API path (lower-case) that no exemption, ingest or bootstrap list contains. */
export const DUONG_KHONG_XAC_DINH = "/api/__route-path-unavailable__";

// parseurl is a dependency OF EXPRESS (not of this project): resolve it relative to express/package.json so the router
// and this helper always run the same code. F6 — resolved ONCE, at module load; a failure is kept (fail closed), not retried.
function napParseurlMacDinh(): ParseUrl {
  const rootRequire = createRequire(import.meta.url);
  const expressRequire = createRequire(rootRequire.resolve("express"));
  return expressRequire("parseurl") as ParseUrl;
}
let parseurlCache: ParseUrl | null = null;
function napParseurl(loader: () => ParseUrl): void {
  try {
    const p = loader();
    if (!p || typeof p.original !== "function") throw new Error("parseurl.original is not a function");
    parseurlCache = p;
  } catch (err) {
    parseurlCache = null;
    console.error(
      `[duongDinhTuyen] parseurl (Express's own URL parser) could not be loaded — every request path is classified as a protected API path until restart (fail closed): ${(err as Error)?.message ?? err}`,
    );
  }
}
napParseurl(napParseurlMacDinh);

/** Test seam (F6) — reload with `loader` (null ⇒ the real one). */
export function __napParseurlChoTest(loader: (() => ParseUrl) | null): void {
  napParseurl(loader ?? napParseurlMacDinh);
}

function catChuoi(raw: string): string {
  const cut = raw.search(/[?#]/);
  return cut === -1 ? raw : raw.slice(0, cut);
}

/** The path Express routes this request on (no query, no fragment, no scheme/authority), as given — case kept. */
export function duongDinhTuyenGoc(req: YeuCauCoDuong): string {
  if (typeof req.originalUrl === "string" || typeof req.url === "string") {
    if (!parseurlCache) return DUONG_KHONG_XAC_DINH; // F6 — parser unavailable ⇒ fail closed
    try {
      // parseurl memoises on the object (`_parsedOriginalUrl`), exactly as Express does on a real request.
      const pathname = parseurlCache.original(req)?.pathname;
      if (typeof pathname === "string") return pathname;
    } catch {
      /* Express cannot route what parseurl cannot parse — classified fail-closed below */
    }
    return DUONG_KHONG_XAC_DINH; // F6 — never the raw cut for a real request
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
