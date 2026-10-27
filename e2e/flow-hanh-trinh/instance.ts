/**
 * Cổng 8.3 — instance ĐO cho "hành trình 8 bước bằng kỹ sư không admin": BẢN DỰNG PRODUCTION (`dist/index.js`, NODE_ENV=production, client tĩnh từ dist/public)
 * trên CỔNG RIÊNG (FHT_PORT, mặc định 3049), DB `aoi_management_test` CHỈ, KHÔNG nạp .env. Bật AI_FLOW_ENABLED + worker trong API để lượt chạy thật.
 * KHÔNG llama/GPU/OT: node `ai.*` không có model ở đây — hành trình dùng mẫu "số liệu thuần" (không AI). Đây là e2e LUỒNG, không đo model.
 * Không bao giờ :3000 / :8091.
 */
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALWAYS_OFF, killTree, portBusy } from "../dot5-h6/instance";
import { testDatabaseUrl } from "../flow-studio/fixtures";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

export const PORT = Number(process.env.FHT_PORT || 3049);
export { killTree, portBusy };

function serverEnv(logDir: string): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "HOME"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] != null) env[k] = process.env[k];
  Object.assign(env, {
    DOTENV_CONFIG_PATH: path.join(logDir, "khong-ton-tai.env"),
    DATABASE_URL: testDatabaseUrl(),
    PORT: String(PORT), ROLE: "api", NODE_ENV: "production",
    JWT_SECRET: "fht-" + crypto.randomBytes(32).toString("hex"),
    LICENSE_BYPASS: "true", AUTH_2FA_BAT_BUOC: "0", VITE_APP_ID: "ui-metrics",
    EDGE_FACTORY_DRIFT_ALERT: "off",
  }, ALWAYS_OFF, { FOE_ENABLED: "false", OT_GATEWAY_ENABLED: "false", OT_CONTROL_ENABLED: "false", AI_OT_CONTROL_ENABLED: "false", AI_FLOW_ENABLED: "true", AI_FLOW_WORKER_TRONG_API: "true",
    // Đợt 10.4 — cờ toàn hệ BẬT cho e2e kiểm định ngoài; mỗi nhà máy vẫn MẶC ĐỊNH TẮT (`ai_ngoai_nha_may` vắng ⇒ tắt) nên spec khác không bị ảnh hưởng.
    AI_NGOAI_ENABLED: "true" });
  return env;
}

export interface RunningInstance { child: ChildProcess; logDir: string }

export async function startInstance(logDir: string): Promise<RunningInstance> {
  if (await portBusy(PORT)) throw new Error(`FHT: port ${PORT} busy — refusing`);
  const entry = path.join(REPO, "dist", "index.js");
  if (!fs.existsSync(entry)) throw new Error("FHT: chưa có bản dựng (npm run build) — dist/index.js không tồn tại");
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "server.log");
  const log = fs.openSync(logFile, "w");
  const child = spawn(process.execPath, [entry], { cwd: REPO, env: serverEnv(logDir), stdio: ["ignore", log, log], windowsHide: true });
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`FHT: server exited ${child.exitCode} — see ${logFile}`);
    const m = /Server running on https?:\/\/localhost:(\d+)/.exec(fs.readFileSync(logFile, "utf8"));
    if (m) {
      if (Number(m[1]) !== PORT) { killTree(child.pid); throw new Error(`FHT: server on ${m[1]}, not ${PORT}`); }
      break;
    }
    if (Date.now() - t0 > 240_000) { killTree(child.pid); throw new Error("FHT: server not up after 240 s"); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { child, logDir };
}
