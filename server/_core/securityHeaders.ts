/**
 * W0-I (doc 44 G5.7a) — Content-Security-Policy + safe security headers.
 *
 * Trước đây helmet chạy với `contentSecurityPolicy: false` (SPA + inline script)
 * → hoàn toàn không có CSP. Module này thêm CSP theo 3 chế độ qua env
 * `SEC_CSP_MODE`:
 *
 *   off         (DEFAULT) — hành vi hiện tại, không phát header CSP nào.
 *   report-only           — phát `Content-Security-Policy-Report-Only` + report-uri
 *                           /api/csp-report. KHÔNG chặn gì — chỉ thu thập vi phạm
 *                           để tinh chỉnh policy trước khi enforce.
 *   enforce               — phát `Content-Security-Policy` thật.
 *
 * Policy được xây cho đúng app này (đã kiểm chứng bằng grep/đọc mã):
 *   - client/index.html CÓ 1 inline <script> (suppress lỗi extension) → script-src
 *     cần 'unsafe-inline' (Vite build giữ nguyên inline script trong index.html).
 *   - Rapier physics / twin 3D dùng WASM → 'wasm-unsafe-eval'.
 *   - Google Fonts (Geist) được load từ fonts.googleapis.com / fonts.gstatic.com
 *     (client/index.html) → style-src + font-src whitelist 2 host đó.
 *   - socket.io + tRPC + RUM + Vite HMR → connect-src 'self' ws: wss:.
 *   - React inline styles / tailwind style attribute → style-src 'unsafe-inline'.
 *   - Ảnh inspection base64/blob (AOI viewer, twin) → img-src 'self' data: blob:.
 *   - Worker từ blob (three.js loaders có thể spawn) → worker-src 'self' blob:.
 *
 * Header an toàn bổ sung (luôn phát, không phụ thuộc SEC_CSP_MODE — zero-risk,
 * đã kiểm tra không phá tính năng nào):
 *   - Permissions-Policy: geolocation=() — app KHÔNG dùng geolocation.
 *     LƯU Ý: KHÔNG khoá camera/microphone — MachineQuickScan dùng getUserMedia
 *     (camera) và AILocalChatBubble/QuickIssueReport dùng SpeechRecognition (mic).
 *   - Referrer-Policy / X-Content-Type-Options: chỉ set khi CHƯA có (helmet mặc
 *     định đã set `Referrer-Policy: no-referrer` + `X-Content-Type-Options:
 *     nosniff` — không ghi đè giá trị chặt hơn của helmet).
 *
 * Endpoint POST /api/csp-report nhận violation report từ browser
 * (Content-Type: application/csp-report), log gọn (throttled) + đếm metric
 * `avi_aoi_security_events_total{type="csp_violation"}` khi METRICS_ENABLED.
 */

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { incSecurityEvent } from "./metrics";

export type CspMode = "off" | "report-only" | "enforce";

export const CSP_REPORT_PATH = "/api/csp-report";

export function getCspMode(env: NodeJS.ProcessEnv = process.env): CspMode {
  const raw = (env.SEC_CSP_MODE ?? "off").trim().toLowerCase();
  if (raw === "report-only" || raw === "enforce") return raw;
  if (raw && raw !== "off") {
    console.warn(`[Security] SEC_CSP_MODE="${raw}" không hợp lệ (off|report-only|enforce) — coi như "off"`);
  }
  return "off";
}

/**
 * CSP directives cho SPA Vite của app này. Trả về map để test được từng directive.
 * `reportUri: false` để bỏ report-uri (không dùng trong thực tế — cả report-only
 * lẫn enforce đều nên nhận report).
 */
export function buildCspDirectives(opts: { reportUri?: string | false } = {}): Record<string, string[]> {
  const reportUri = opts.reportUri === undefined ? CSP_REPORT_PATH : opts.reportUri;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    // index.html có inline script (extension-error suppressor) → 'unsafe-inline'.
    // 'wasm-unsafe-eval' cho Rapier physics (WebAssembly.instantiate).
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
    // React inline styles + Google Fonts stylesheet (client/index.html).
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:", "blob:"],
    "media-src": ["'self'", "blob:", "data:"],
    // socket.io + tRPC + RUM + Vite HMR. ws:/wss: mọi host vì app phục vụ LAN
    // qua IP máy chủ (socket có thể nối qua hostname/IP khác cổng).
    "connect-src": ["'self'", "ws:", "wss:"],
    "worker-src": ["'self'", "blob:"],
    // PDF/report preview có thể render qua blob: iframe.
    "frame-src": ["'self'", "blob:", "data:"],
    "frame-ancestors": ["'self'"],
    "form-action": ["'self'"],
  };
  if (reportUri) directives["report-uri"] = [reportUri];
  return directives;
}

export function buildCspHeaderValue(opts: { reportUri?: string | false } = {}): string {
  return Object.entries(buildCspDirectives(opts))
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

const PERMISSIONS_POLICY_VALUE = "geolocation=()";
const REFERRER_POLICY_FALLBACK = "strict-origin-when-cross-origin";

/**
 * Express middleware: phát CSP theo SEC_CSP_MODE + các header an toàn bổ sung.
 * Mount NGAY SAU helmet (để tôn trọng header helmet đã set — chỉ bổ sung khi thiếu).
 */
export function securityHeadersMiddleware(env: NodeJS.ProcessEnv = process.env) {
  const mode = getCspMode(env);
  const cspValue = mode === "off" ? null : buildCspHeaderValue();
  const cspHeaderName =
    mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

  if (mode !== "off") {
    console.log(`[Security] CSP bật ở chế độ "${mode}" (header: ${cspHeaderName}, report: ${CSP_REPORT_PATH})`);
  }

  return function securityHeaders(_req: Request, res: Response, next: NextFunction) {
    try {
      if (cspValue) res.setHeader(cspHeaderName, cspValue);
      // Zero-risk additions — chỉ set khi header CHƯA tồn tại (helmet đứng trước).
      if (!res.getHeader("Permissions-Policy")) {
        res.setHeader("Permissions-Policy", PERMISSIONS_POLICY_VALUE);
      }
      if (!res.getHeader("Referrer-Policy")) {
        res.setHeader("Referrer-Policy", REFERRER_POLICY_FALLBACK);
      }
      if (!res.getHeader("X-Content-Type-Options")) {
        res.setHeader("X-Content-Type-Options", "nosniff");
      }
    } catch {
      /* header đã gửi / lỗi bất kỳ — không được làm hỏng request */
    }
    next();
  };
}

// ─── CSP violation report endpoint ──────────────────────────────────────────

// Log throttle: tối đa N dòng log/phút để một trang lỗi không spam log server.
const LOG_WINDOW_MS = 60_000;
const LOG_MAX_PER_WINDOW = 5;
let logWindowStart = 0;
let logCountInWindow = 0;
let totalReports = 0;

/** Cho test/diagnostics — tổng số CSP report đã nhận từ khi process start. */
export function getCspReportCount(): number {
  return totalReports;
}

/** test-only: reset bộ đếm throttle/report. */
export function _resetCspReportCounters(): void {
  logWindowStart = 0;
  logCountInWindow = 0;
  totalReports = 0;
}

function shouldLogNow(now = Date.now()): boolean {
  if (now - logWindowStart > LOG_WINDOW_MS) {
    logWindowStart = now;
    logCountInWindow = 0;
  }
  return ++logCountInWindow <= LOG_MAX_PER_WINDOW;
}

/**
 * POST /api/csp-report — browser gửi Content-Type `application/csp-report`
 * (spec cũ, đi cùng report-uri) nên cần json parser với `type` mở rộng
 * (global express.json chỉ parse application/json). Body limit nhỏ.
 * Được rate-limit bởi apiLimiter chung (mount trên /api/ trước endpoint này).
 */
export function registerCspReportEndpoint(app: Express): void {
  const parser = express.json({
    type: ["application/csp-report", "application/reports+json", "application/json"],
    limit: "64kb",
  });
  app.post(CSP_REPORT_PATH, parser, (req: Request, res: Response) => {
    totalReports++;
    try {
      incSecurityEvent("csp_violation", getCspMode());
      // Report format: { "csp-report": { "violated-directive", "blocked-uri", "document-uri", ... } }
      const body: any = req.body ?? {};
      const r = body["csp-report"] ?? body;
      if (shouldLogNow()) {
        console.warn(
          `[Security] CSP violation: directive=${String(r["violated-directive"] ?? r["effective-directive"] ?? "?").slice(0, 120)} ` +
            `blocked=${String(r["blocked-uri"] ?? "?").slice(0, 200)} ` +
            `doc=${String(r["document-uri"] ?? "?").slice(0, 200)}`,
        );
      }
    } catch {
      /* report hỏng định dạng — bỏ qua, vẫn 204 */
    }
    res.status(204).end();
  });
}
