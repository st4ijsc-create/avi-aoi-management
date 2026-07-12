// scripts/sim-factory/lib/env.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Nạp profile .env.sim (KHÔNG BAO GIỜ nạp .env production).
//
// Mọi tiến trình sim (seed / simulator / scenario) import module này ĐẦU TIÊN.
// Mặc định đọc file '.env.sim' ở gốc repo; override bằng SIM_ENV_FILE=<path>.
// dotenv KHÔNG override biến process.env đã set sẵn (inline env vẫn thắng).
// ─────────────────────────────────────────────────────────────────────────────
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = process.env.SIM_ENV_FILE || ".env.sim";
const abs = resolve(process.cwd(), envFile);

if (existsSync(abs)) {
  dotenv.config({ path: abs });
  // eslint-disable-next-line no-console
  console.log(`[sim/env] loaded profile: ${envFile}`);
} else {
  // eslint-disable-next-line no-console
  console.warn(
    `[sim/env] KHÔNG tìm thấy ${envFile}. Tạo nó (xem scripts/sim-factory/README.md) ` +
      `hoặc set biến môi trường thủ công. KHÔNG tự nạp .env production.`,
  );
}

export const SIM_ENV_FILE = envFile;
