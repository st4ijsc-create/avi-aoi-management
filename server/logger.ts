import pino from "pino";
import pinoPretty from "pino-pretty";
import { getCorrelationId } from "./services/observability/correlation";

// LOG_JSON=1 buộc xuất JSON structured ngay cả ở môi trường dev (đồng bộ aggregator).
const forceJson = process.env.LOG_JSON === "1" || process.env.LOG_JSON === "true";

/**
 * ★★★ Chẩn đoán 2026-10-23 (docs/superpowers/audits/2026-10-23-server-dev-chet-im-lang.md) — LOGGER DEV KHÔNG ĐƯỢC CHẠY TRONG WORKER THREAD.
 *
 * `transport: { target: "pino-pretty" }` dựng một `worker_thread` (thread-stream) ngay lúc import logger. Trong tiến trình dev (tsx + nhiều addon native) đó là
 * nguồn của lỗi HEAP CORRUPTION lúc khởi động: server chết im lặng với mã thoát 3221226356 (0xC0000374) / 3221226505 (0xC0000409), ~6–13 %/lần khởi động
 * (bộ khuếch đại `process.report` đẩy lên 40 %). Đo: dev+worker 12/30 · dev+`LOG_JSON=1` 0/60 + 0/30 · dev+pino-pretty ĐỒNG BỘ 0/30 · production 0/80 (không worker).
 * ⇒ dev dùng `pino-pretty` làm stream ĐỒNG BỘ ngay trong tiến trình chính (cùng định dạng: màu, giờ địa phương, bỏ pid/hostname). Production giữ JSON như cũ.
 * `LOG_PRETTY_WORKER=1` quay lại transport (worker) CŨ — CHỈ để đối chứng/chẩn đoán; đừng bật ở nơi cần ổn định.
 */
export type CheDoLogger = "json" | "pretty-dong-bo" | "pretty-worker";
export function chonCheDoLogger(env: NodeJS.ProcessEnv = process.env): CheDoLogger {
  const prod = env.NODE_ENV === "production";
  const json = env.LOG_JSON === "1" || env.LOG_JSON === "true";
  if (prod || json) return "json";
  return env.LOG_PRETTY_WORKER === "1" ? "pretty-worker" : "pretty-dong-bo";
}

const PRETTY_OPTS = { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } as const;
/** Tuỳ chọn của stream pretty ĐỒNG BỘ (sonic-boom `sync: true` — ghi ngay trong tiến trình chính, không hàng đợi bất đồng bộ). Xuất để test khoá. */
export const PRETTY_DONG_BO = { ...PRETTY_OPTS, sync: true } as const;

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

/** Dựng logger theo chế độ `chonCheDoLogger(env)`; `destination` chỉ để test bắt đầu ra (mặc định stdout). */
export function taoLogger(env: NodeJS.ProcessEnv = process.env, destination?: NodeJS.WritableStream): pino.Logger {
  const cheDo = chonCheDoLogger(env);
  const opts: pino.LoggerOptions = {
    level: env.LOG_LEVEL || (env.NODE_ENV === "production" ? "info" : "debug"),
    mixin: correlationMixin,
  };
  if (cheDo === "pretty-worker") {
    return pino({ ...opts, transport: { target: "pino-pretty", options: { ...PRETTY_OPTS } } });
  }
  if (cheDo === "pretty-dong-bo") {
    return pino(opts, pinoPretty({ ...PRETTY_DONG_BO, ...(destination ? { destination } : {}) }));
  }
  return destination ? pino(opts, destination) : pino(opts);
}

export const logger = taoLogger();

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

