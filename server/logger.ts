import pino from "pino";
import { getCorrelationId } from "./services/observability/correlation";

const isProduction = process.env.NODE_ENV === "production";
// LOG_JSON=1 buộc xuất JSON structured ngay cả ở môi trường dev (đồng bộ aggregator).
const forceJson = process.env.LOG_JSON === "1" || process.env.LOG_JSON === "true";
const usePretty = !isProduction && !forceJson;

/**
 * G5.17 (doc 44 W6-4) — pino mixin đọc correlation_id từ AsyncLocalStorage backbone
 * (server/services/observability/correlation.ts). Khi request/lệnh đang chạy trong một
 * withCorrelation(...) context, MỌI log line tự động mang `correlation_id` → nối được
 * "nút bấm → lệnh → máy" qua log. Ngoài context ⇒ trả {} (không thêm field, an toàn).
 * Cheap + đồng bộ; không cờ (chỉ enrich log).
 */
export function correlationMixin(): Record<string, string> {
  const cid = getCorrelationId();
  return cid ? { correlation_id: cid } : {};
}

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  mixin: correlationMixin,
  ...(usePretty
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});

/**
 * Cầu nối console.* → pino (opt-in).
 * Bật khi LOG_JSON=1 hoặc LOG_BRIDGE_CONSOLE=1 để chuẩn hoá toàn bộ log hiện hữu
 * (console.log/info/warn/error) sang structured logging mà không cần sửa từng call site.
 * Idempotent: chỉ cài 1 lần.
 */
let consoleBridged = false;
export function installConsoleBridge(): boolean {
  const enabled =
    forceJson ||
    process.env.LOG_BRIDGE_CONSOLE === "1" ||
    process.env.LOG_BRIDGE_CONSOLE === "true";
  if (!enabled || consoleBridged) return consoleBridged;
  consoleBridged = true;

  const fmt = (args: unknown[]): { msg: string; meta?: unknown } => {
    if (args.length === 1 && typeof args[0] === "string") return { msg: args[0] };
    const [first, ...rest] = args;
    return {
      msg: typeof first === "string" ? first : JSON.stringify(first),
      meta: rest.length ? rest : undefined,
    };
  };

  console.log = (...args: unknown[]) => { const { msg, meta } = fmt(args); logger.info(meta ?? {}, msg); };
  console.info = (...args: unknown[]) => { const { msg, meta } = fmt(args); logger.info(meta ?? {}, msg); };
  console.warn = (...args: unknown[]) => { const { msg, meta } = fmt(args); logger.warn(meta ?? {}, msg); };
  console.error = (...args: unknown[]) => { const { msg, meta } = fmt(args); logger.error(meta ?? {}, msg); };
  console.debug = (...args: unknown[]) => { const { msg, meta } = fmt(args); logger.debug(meta ?? {}, msg); };

  logger.info({ forceJson }, "[logger] console bridge installed");
  return true;
}

export default logger;

