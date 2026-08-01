/**
 * W0-I (doc 44 G5.7b) — Origin-check chống CSRF cho các request đổi trạng thái.
 *
 * Bối cảnh bảo vệ sẵn có: session cookie đã là `httpOnly + sameSite=lax`
 * (server/_core/cookies.ts) — Lax chặn cookie trên cross-site POST, tức là
 * CSRF cổ điển (form auto-submit từ site lạ) đã bị vô hiệu ở đa số browser
 * hiện đại. Middleware này là lớp thứ 2 (defense-in-depth) cho:
 *   - browser cũ / cấu hình lạ không tôn trọng sameSite,
 *   - subdomain / origin "same-site nhưng khác origin" mà Lax vẫn cho qua,
 *   - GET-đổi-trạng-thái (không có ở đây, nhưng POST qua top-level navigation
 *     là điểm mù còn lại của Lax với 302).
 *
 * Cách hoạt động: với request POST/PUT/PATCH/DELETE vào /api/** hoặc /trpc/**,
 * so khớp header `Origin` (fallback `Referer`) với danh sách cho phép:
 *   - chính host của request (same-origin — so sánh host:port, bỏ qua scheme),
 *   - `ALLOWED_ORIGINS` (env CORS sẵn có — các origin browser đã được tin cậy),
 *   - `SEC_ALLOWED_ORIGINS` (CSV, dành riêng cho origin-check),
 *   - loopback (localhost/127.0.0.1/::1) khi NODE_ENV !== production (Vite dev).
 *
 * Đường máy-to-máy dùng API key / master key / token (không phải cookie) được
 * MIỄN kiểm tra theo prefix (xem ORIGIN_CHECK_EXEMPT_PREFIXES) — CSRF chỉ có ý
 * nghĩa với auth "ambient" (cookie); API key phải do caller chủ động đính kèm.
 *
 * Chế độ qua env `SEC_ORIGIN_CHECK_MODE`:
 *   off     (DEFAULT) — middleware pass-through, không log.
 *   log               — chỉ log (throttled) + đếm metric, KHÔNG chặn.
 *   enforce           — 403 JSON { reason_code: "ORIGIN_MISMATCH" }.
 *
 * Trade-off chuẩn (ghi rõ): request KHÔNG có cả Origin lẫn Referer (curl,
 * C# machine client, service nội bộ, một số same-origin fetch) được CHO QUA
 * ở mọi mode — browser hiện đại LUÔN gửi Origin với cross-site POST, nên
 * kẻ tấn công CSRF qua browser không thể "bỏ" header này.
 */

import type { NextFunction, Request, Response } from "express";
import { incSecurityEvent } from "./metrics";

export type OriginCheckMode = "off" | "log" | "enforce";

export function getOriginCheckMode(env: NodeJS.ProcessEnv = process.env): OriginCheckMode {
  const raw = (env.SEC_ORIGIN_CHECK_MODE ?? "off").trim().toLowerCase();
  if (raw === "log" || raw === "enforce") return raw;
  if (raw && raw !== "off") {
    console.warn(`[Security] SEC_ORIGIN_CHECK_MODE="${raw}" không hợp lệ (off|log|enforce) — coi như "off"`);
  }
  return "off";
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Prefix MIỄN origin-check — các đường máy-to-máy xác thực bằng API key /
 * master key / bearer token / download token (KHÔNG dựa cookie ambient):
 *   /api/v1/           — Unified Machine API, scoped API key (v1Guard)
 *   /api/external/     — external inspection API, master key + bearer
 *   /api/machine/      — machine REST proxy (x-api-key, C# AOI/AVI clients)
 *   /api/aoi/          — AOI package presign/commit/upload (machine clients)
 *   /api/factory-alert/— Android FactoryAlertSystem (master key / query token)
 *   /api/edge/         — edge node download (API key)
 *   /api/export/, /api/bi/ — BI/export feeds (API key)
 *   /api/csp-report    — CSP violation reports (không được phép rớt)
 * (/v1/* OpenAI gateway không nằm dưới /api|/trpc nên không bị chạm tới.)
 */
export const ORIGIN_CHECK_EXEMPT_PREFIXES: readonly string[] = [
  "/api/v1/",
  "/api/external/",
  "/api/machine/",
  "/api/aoi/",
  "/api/factory-alert/",
  "/api/edge/",
  "/api/export/",
  "/api/bi/",
  "/api/csp-report",
];

const PROTECTED_PREFIXES = ["/api/", "/trpc/"];

export interface OriginCheckConfig {
  mode: OriginCheckMode;
  /** Origin strings đã chuẩn hoá lowercase, không trailing slash. */
  allowedOrigins: Set<string>;
  allowDevLoopback: boolean;
}

function normalizeOrigin(o: string): string {
  return o.trim().toLowerCase().replace(/\/+$/, "");
}

export function buildOriginCheckConfig(env: NodeJS.ProcessEnv = process.env): OriginCheckConfig {
  const allowed = new Set<string>();
  for (const src of [env.ALLOWED_ORIGINS, env.SEC_ALLOWED_ORIGINS]) {
    for (const o of (src ?? "").split(",")) {
      const n = normalizeOrigin(o);
      if (n) allowed.add(n);
    }
  }
  return {
    mode: getOriginCheckMode(env),
    allowedOrigins: allowed,
    allowDevLoopback: env.NODE_ENV !== "production",
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type OriginVerdict =
  | { allowed: true; reason: "mode_off" | "safe_method" | "exempt_path" | "not_api_path" | "no_origin" | "same_origin" | "allowlisted" | "dev_loopback" }
  | { allowed: false; reason: "origin_mismatch"; origin: string };

/**
 * Pure decision — tách riêng để test không cần dựng express.
 * `req` chỉ cần { method, path, headers }.
 */
export function evaluateOrigin(
  req: Pick<Request, "method" | "path"> & { headers: Record<string, unknown> },
  cfg: OriginCheckConfig,
): OriginVerdict {
  if (cfg.mode === "off") return { allowed: true, reason: "mode_off" };
  if (!UNSAFE_METHODS.has(String(req.method).toUpperCase())) {
    return { allowed: true, reason: "safe_method" };
  }
  const p = req.path || "";
  if (!PROTECTED_PREFIXES.some((x) => p.startsWith(x))) {
    return { allowed: true, reason: "not_api_path" };
  }
  if (ORIGIN_CHECK_EXEMPT_PREFIXES.some((x) => p.startsWith(x))) {
    return { allowed: true, reason: "exempt_path" };
  }

  // Origin, fallback Referer (lấy origin của URL referer).
  const rawOrigin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  let origin = rawOrigin;
  if (!origin) {
    const referer = typeof req.headers.referer === "string" ? req.headers.referer : "";
    if (referer) {
      try {
        origin = new URL(referer).origin;
      } catch {
        origin = "";
      }
    }
  }
  // Không có cả Origin lẫn Referer → pass (trade-off chuẩn — xem header file).
  if (!origin || origin === "null") return { allowed: true, reason: "no_origin" };

  const normalized = normalizeOrigin(origin);

  // Same-origin: so host:port của Origin với Host header của request
  // (bỏ qua scheme — app có thể đứng sau TLS-terminating proxy).
  const reqHost = typeof req.headers.host === "string" ? req.headers.host.toLowerCase() : "";
  let originHost = "";
  try {
    originHost = new URL(normalized).host.toLowerCase();
  } catch {
    /* Origin hỏng định dạng — rơi xuống allowlist check */
  }
  if (reqHost && originHost && originHost === reqHost) {
    return { allowed: true, reason: "same_origin" };
  }
  if (cfg.allowedOrigins.has(normalized)) {
    return { allowed: true, reason: "allowlisted" };
  }
  if (cfg.allowDevLoopback && originHost) {
    const bare = originHost.replace(/:\d+$/, "");
    if (LOOPBACK_HOSTS.has(bare)) return { allowed: true, reason: "dev_loopback" };
  }
  return { allowed: false, reason: "origin_mismatch", origin: normalized };
}

// Log throttle (chung cho mọi request) — tối đa 10 dòng/phút.
const LOG_WINDOW_MS = 60_000;
const LOG_MAX_PER_WINDOW = 10;
let logWindowStart = 0;
let logCountInWindow = 0;
let violationCount = 0;

/** Cho test/diagnostics — tổng số vi phạm origin từ khi process start. */
export function getOriginViolationCount(): number {
  return violationCount;
}

/** test-only */
export function _resetOriginCheckCounters(): void {
  logWindowStart = 0;
  logCountInWindow = 0;
  violationCount = 0;
}

function shouldLogNow(now = Date.now()): boolean {
  if (now - logWindowStart > LOG_WINDOW_MS) {
    logWindowStart = now;
    logCountInWindow = 0;
  }
  return ++logCountInWindow <= LOG_MAX_PER_WINDOW;
}

/**
 * Express middleware. Mount SAU health/metrics + CSP-report endpoint,
 * TRƯỚC các route /api & tRPC. Đọc env MỘT LẦN lúc khởi tạo (đổi mode cần restart).
 */
export function originCheckMiddleware(env: NodeJS.ProcessEnv = process.env) {
  const cfg = buildOriginCheckConfig(env);
  if (cfg.mode !== "off") {
    console.log(
      `[Security] Origin-check bật ở chế độ "${cfg.mode}" — ` +
        `${cfg.allowedOrigins.size} origin allowlisted, ${ORIGIN_CHECK_EXEMPT_PREFIXES.length} prefix miễn kiểm tra`,
    );
  }

  return function originCheck(req: Request, res: Response, next: NextFunction) {
    if (cfg.mode === "off") return next();

    let verdict: OriginVerdict;
    try {
      verdict = evaluateOrigin(req as any, cfg);
    } catch {
      // Fail-open: lỗi bất ngờ trong lớp bảo vệ phụ không được làm sập request.
      return next();
    }
    if (verdict.allowed) return next();

    violationCount++;
    incSecurityEvent("origin_mismatch", cfg.mode);
    if (shouldLogNow()) {
      console.warn(
        `[Security] Origin mismatch (mode=${cfg.mode}): ${req.method} ${req.path} ` +
          `origin=${verdict.origin.slice(0, 200)} host=${String(req.headers.host ?? "?").slice(0, 100)}`,
      );
    }

    if (cfg.mode === "enforce") {
      return res.status(403).json({
        success: false,
        error: "Origin not allowed for state-changing request",
        reason_code: "ORIGIN_MISMATCH",
      });
    }
    next(); // mode log — chỉ quan sát
  };
}
