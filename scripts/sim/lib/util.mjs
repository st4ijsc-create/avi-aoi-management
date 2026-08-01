/**
 * Shared helpers cho bộ simulator thiết bị ảo (scripts/sim).
 *
 * MỤC TIÊU: các tiện ích nhỏ, KHÔNG phụ thuộc — parse tham số CLI/env, logger có
 * tiền tố tên thiết bị, sinh nhiễu (noise) + tín hiệu có xu hướng (trend) cho các
 * generator. Không thêm dependency; chỉ dùng Node core.
 *
 * Dùng chung cho cả file .mjs (chạy `node`) lẫn .ts (chạy qua `tsx`).
 */

/**
 * Parse `argv` kiểu `--key value` / `--flag` thành object. Giá trị số được ép về
 * number khi hợp lệ. Ví dụ: `--port 4840 --verbose` → { port: 4840, verbose: true }.
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true; // boolean flag
    } else {
      const n = Number(next);
      out[key] = next !== "" && Number.isFinite(n) ? n : next;
      i++;
    }
  }
  return out;
}

/** Đọc option theo thứ tự ưu tiên: CLI arg > env SIM_<UPPER> > default. */
export function opt(args, key, envName, def) {
  if (args[key] !== undefined) return args[key];
  const env = process.env[envName ?? `SIM_${key.toUpperCase()}`];
  if (env !== undefined && env !== "") {
    const n = Number(env);
    return Number.isFinite(n) && env.trim() !== "" && /^-?\d/.test(env) ? n : env;
  }
  return def;
}

/**
 * Logger nhỏ có tiền tố [name] + timestamp ISO ngắn.
 * Trả về HÀM gọi được (log("…") = info) kèm .info/.warn/.error để dùng cả 2 kiểu.
 */
export function makeLogger(name) {
  const stamp = () => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const fmt = (lvl, msg) => `${stamp()} [${name}] ${lvl}${msg}`;
  const log = (m) => console.log(fmt("", m));
  log.info = log;
  log.warn = (m) => console.warn(fmt("WARN ", m));
  log.error = (m) => console.error(fmt("ERROR ", m));
  return log;
}

/** Nhiễu Gaussian ~N(0, sigma) (Box–Muller) — cho tín hiệu sensor thực tế hơn. */
export function gaussian(sigma = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Kẹp giá trị vào [lo, hi]. */
export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Đăng ký shutdown sạch: gọi `onStop` MỘT lần khi nhận SIGINT/SIGTERM hoặc khi
 * process kết thúc. `onStop` có thể async; ta chờ tối đa `graceMs` rồi thoát.
 */
export function onShutdown(onStop, graceMs = 3000) {
  let stopped = false;
  const run = async (signal) => {
    if (stopped) return;
    stopped = true;
    const timer = setTimeout(() => process.exit(0), graceMs);
    timer.unref?.();
    try {
      await onStop(signal);
    } catch {
      /* fail-safe: đang tear-down */
    }
    clearTimeout(timer);
    process.exit(0);
  };
  process.on("SIGINT", () => void run("SIGINT"));
  process.on("SIGTERM", () => void run("SIGTERM"));
}

/** true nếu file này được chạy trực tiếp (không phải import). */
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    const invoked = new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const self = new URL(importMetaUrl).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    return invoked.toLowerCase().endsWith(self.split("/").pop().toLowerCase());
  } catch {
    return false;
  }
}
