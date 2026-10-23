/**
 * Đợt 9 — instance ĐO RIÊNG cho e2e Flow Studio: server TỪ MÃ NGUỒN (tsx) + Vite dev, CỔNG RIÊNG (3047 / 5207, đổi bằng
 * FS_SERVER_PORT / FS_VITE_PORT), DB `aoi_management_test`, KHÔNG nạp .env. Mọi tích hợp ngoài TẮT (ALWAYS_OFF của H6);
 * KHÔNG bật FOE / OT_GATEWAY / OT_CONTROL / AI_OT_CONTROL / LLAMA — Luồng AI ở đây không có đường tới thiết bị hay GPU.
 * `ACTUATION_STEPUP_2FA=true` để đường bật luồng hạng `ot` (deployProcedure) đòi OTP tươi thật. Không bao giờ :3000, không dev DB.
 */
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALWAYS_OFF, killTree, portBusy } from "../dot5-h6/instance";
import { testDatabaseUrl } from "./fixtures";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(REPO, "package.json"));

export const SERVER_PORT = Number(process.env.FS_SERVER_PORT || 3047);
export const VITE_PORT = Number(process.env.FS_VITE_PORT || 5207);
export { killTree, portBusy };

function serverEnv(logDir: string): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "HOME"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] != null) env[k] = process.env[k];
  Object.assign(env, {
    DOTENV_CONFIG_PATH: path.join(logDir, "khong-ton-tai.env"),
    DATABASE_URL: testDatabaseUrl(),
    PORT: String(SERVER_PORT), ROLE: "api", NODE_ENV: "development",
    JWT_SECRET: "fs-" + crypto.randomBytes(32).toString("hex"),
    LICENSE_BYPASS: "true", AUTH_2FA_BAT_BUOC: "0", VITE_APP_ID: "ui-metrics",
    // Quét lệch nhà máy edge × quản trị viên: ở CSDL _test đông đúc mỗi lần khởi động tạo hàng triệu truy vấn/hàng thông báo, làm instance e2e nghẽn pool (đăng nhập treo 40–60 s).
    EDGE_FACTORY_DRIFT_ALERT: "off",
    ACTUATION_STEPUP_2FA: "true",
  }, ALWAYS_OFF, { FOE_ENABLED: "false", OT_GATEWAY_ENABLED: "false", OT_CONTROL_ENABLED: "false", AI_OT_CONTROL_ENABLED: "false", AI_FLOW_ENABLED: "false" });
  return env;
}

export interface RunningInstance { child: ChildProcess; vite: { close: () => Promise<void> }; logDir: string }

export async function startInstance(logDir: string): Promise<RunningInstance> {
  for (const p of [SERVER_PORT, VITE_PORT]) if (await portBusy(p)) throw new Error(`FS: port ${p} busy — refusing`);
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "server.log");
  const log = fs.openSync(logFile, "w");
  const child = spawn(process.execPath, [path.join(REPO, "node_modules/tsx/dist/cli.mjs"), "server/_core/index.ts"], {
    cwd: REPO, env: serverEnv(logDir), stdio: ["ignore", log, log], windowsHide: true,
  });
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`FS: server exited ${child.exitCode} — see ${logFile}`);
    const m = /Server running on https?:\/\/localhost:(\d+)/.exec(fs.readFileSync(logFile, "utf8"));
    if (m) {
      if (Number(m[1]) !== SERVER_PORT) { killTree(child.pid); throw new Error(`FS: server on ${m[1]}, not ${SERVER_PORT}`); }
      break;
    }
    if (Date.now() - t0 > 240_000) { killTree(child.pid); throw new Error("FS: server not up after 240 s"); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const { createServer } = (await import(pathToFileURL(require.resolve("vite")).href)) as typeof import("vite");
  const cacheDir = path.join(os.tmpdir(), "aoi-fs-vite-cache");
  const target = `http://127.0.0.1:${SERVER_PORT}`;
  const vite = await createServer({
    configFile: path.join(REPO, "vite.config.ts"), cacheDir, logLevel: "warn", clearScreen: false,
    server: { port: VITE_PORT, strictPort: true, host: "127.0.0.1", hmr: false, fs: { strict: true, allow: [REPO, cacheDir] },
      proxy: { "/api": { target, ws: true, changeOrigin: false }, "/uploads": { target } } },
  });
  await vite.listen();
  return { child, vite, logDir };
}
