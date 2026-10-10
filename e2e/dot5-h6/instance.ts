/**
 * doc 81 Đợt 5 H6 — instance ĐO RIÊNG cho e2e: server TỪ MÃ NGUỒN (tsx) + Vite dev, CỔNG RIÊNG (mặc định 3046 / 5206,
 * đổi bằng H6_SERVER_PORT / H6_VITE_PORT), DB `aoi_management_test`, KHÔNG nạp .env (DOTENV_CONFIG_PATH trỏ tệp không tồn
 * tại). Hồ sơ env chép từ thiết bị đo bố cục (scripts/ui-metrics/engineeringLayout.mjs#serverEnv: mọi tích hợp ngoài TẮT)
 * + những gì đường DỪNG OT cần, CHỈ trên tiến trình này: FOE_ENABLED, OT_GATEWAY_ENABLED (driver `stub` trong tiến trình),
 * OT_CONTROL_ENABLED (đường ghi thật ⇒ preflight an toàn chạy ⇒ từ chối). Không bao giờ :3000, không bao giờ dev DB.
 * ⚠ OT_GATEWAY nạp MỌI adapter đang bật của `_test` — tập này TRÔI (test khác thêm adapter). H fix 1 (review I2): hàng rào là
 *   BẤT BIẾN đọc từ CSDL ngay trước khi dựng, không phải danh sách cổng: MỌI adapter đang bật (kể cả endpoint dự phòng HA
 *   `connectionOptions.ha.secondaryEndpoint`) phải là `stub` (driver trong tiến trình) HOẶC trỏ loopback (127.0.0.1 /
 *   localhost / ::1) tới một cổng KHÔNG có ai nghe; endpoint không đọc được / host khác / cổng đang nghe ⇒ TỪ CHỐI dựng.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { testDatabaseUrl } from "./fixtures";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(REPO, "package.json"));

export const SERVER_PORT = Number(process.env.H6_SERVER_PORT || 3046);
export const VITE_PORT = Number(process.env.H6_VITE_PORT || 5206);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** host:port của một endpoint OT (`opc.tcp://h:p`, `tcp://h:p`, `h:p`); null = không đọc được (⇒ từ chối). */
export function endpointHostPort(endpoint: string): { host: string; port: number } | null {
  const raw = String(endpoint ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
    const port = Number(u.port);
    if (!u.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return { host: u.hostname.toLowerCase(), port };
  } catch {
    return null;
  }
}

export interface AdapterSafetyReport { checked: number; stub: number; loopbackFree: Array<{ id: number; endpoint: string }>; refused: Array<{ id: number; protocol: string; endpoint: string; why: string }> }

/**
 * BẤT BIẾN trước khi bật OT_GATEWAY + OT_CONTROL trên instance: mọi adapter đang bật của `_test` là `stub` hoặc trỏ loopback tới
 * cổng không ai nghe (không bao giờ nối thiết bị / simulator thật với quyền ghi).
 */
export async function assertEnabledAdaptersSafe(
  rows: Array<{ id: number; protocol: string; endpoint: string; connectionOptions: unknown }>,
): Promise<AdapterSafetyReport> {
  const report: AdapterSafetyReport = { checked: rows.length, stub: 0, loopbackFree: [], refused: [] };
  for (const r of rows) {
    if (r.protocol === "stub") { report.stub++; continue; }
    const ha = (r.connectionOptions as { ha?: { secondaryEndpoint?: unknown } } | null)?.ha;
    const endpoints = [r.endpoint, ...(typeof ha?.secondaryEndpoint === "string" && ha.secondaryEndpoint.trim() ? [ha.secondaryEndpoint] : [])];
    for (const ep of endpoints) {
      const hp = endpointHostPort(ep);
      if (!hp) { report.refused.push({ id: r.id, protocol: r.protocol, endpoint: ep, why: "endpoint không đọc được" }); continue; }
      if (!LOOPBACK.has(hp.host)) { report.refused.push({ id: r.id, protocol: r.protocol, endpoint: ep, why: "host không phải loopback" }); continue; }
      if (await portBusy(hp.port)) { report.refused.push({ id: r.id, protocol: r.protocol, endpoint: ep, why: `cổng ${hp.port} đang có tiến trình nghe` }); continue; }
      report.loopbackFree.push({ id: r.id, endpoint: ep });
    }
  }
  if (report.refused.length) {
    throw Object.assign(new Error(`H6: refusing to enable OT control — enabled adapter(s) not provably inert: ${JSON.stringify(report.refused)}`), { report });
  }
  return report;
}

export function portBusy(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(true));
    s.once("listening", () => s.close(() => resolve(false)));
    s.listen(port, "0.0.0.0");
  }).then((busy) =>
    busy ||
    new Promise<boolean>((resolve) => {
      const c = net.connect({ port, host: "127.0.0.1" });
      c.once("connect", () => { c.destroy(); resolve(true); });
      c.once("error", () => resolve(false));
      c.setTimeout(1000, () => { c.destroy(); resolve(false); });
    }),
  );
}

const ALWAYS_OFF: Record<string, string> = {
  DPC_DEPLOY_ENABLED: "false", SAFETY_PLC_ADAPTER_ENABLED: "false", ALERT_EVALUATOR_ENABLED: "false", AI_ORCHESTRATION_ENABLED: "false", AI_ORCHESTRATION_ADVISOR_ENABLED: "false",
  MQTT_ENABLED: "false", MQTT_PORT: "51883", MQTT_WS_PORT: "51884", EXTERNAL_MQTT_ENABLED: "false",
  UNS_BRIDGE_ENABLED: "false", UNS_SPARKPLUG_ENABLED: "false", UNS_BROKER_URL: "mqtt://127.0.0.1:9", SPARKPLUG_COMMAND_ENABLED: "false", UNS_TOPIC_V2_ENABLED: "false",
  OT_STORE_FORWARD_ENABLED: "false", OT_CONN_HA_ENABLED: "false", ROBOT_GATEWAY_ENABLED: "false", ROBOT_CONTROL_ENABLED: "false", OPCUA_GATEWAY_ENABLED: "false", ROS2_BRIDGE_ENABLED: "false",
  SIM_OT_TELEMETRY_ENABLED: "false", SIM_KINEMATIC_ENABLED: "false", EDGE_RUNTIME_ENABLED: "false", SECS_GEM_ENABLED: "false", MTCONNECT_ENABLED: "false", VDA5050_ENABLED: "false",
  LLAMA_SERVER_ENABLED: "false", ENABLE_GPU: "false", GGUF_WARM_DEEP_MODEL_ON_BOOT: "false", PROG_KB_ENABLED: "false", KB_AUTOSYNC_ENABLED: "false", HOT_FOLDER_INGEST_ENABLED: "false",
  WEBHOOKS_ENABLED: "false", OTEL_ENABLED: "false", TWIN_LIVE_ENABLED: "false", TWIN_STREAM_ENABLED: "false", STREAM_TELEMETRY_TAP_ENABLED: "false", OPENAI_GATEWAY_ENABLED: "false",
  OLLAMA_BASE_URL: "http://127.0.0.1:9",
};

function serverEnv(logDir: string): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "HOME"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] != null) env[k] = process.env[k];
  Object.assign(env, {
    DOTENV_CONFIG_PATH: path.join(logDir, "khong-ton-tai.env"),
    DATABASE_URL: testDatabaseUrl(),
    PORT: String(SERVER_PORT), ROLE: "api", NODE_ENV: "development",
    JWT_SECRET: "h6-" + crypto.randomBytes(32).toString("hex"),
    LICENSE_BYPASS: "true", AUTH_2FA_BAT_BUOC: "0", VITE_APP_ID: "ui-metrics",
  }, ALWAYS_OFF, {
    FOE_ENABLED: "true",
    OT_GATEWAY_ENABLED: "true",
    OT_CONTROL_ENABLED: "true",
  });
  return env;
}

export interface RunningInstance { child: ChildProcess; vite: { close: () => Promise<void> }; logDir: string }

export async function startInstance(logDir: string, adapters: Parameters<typeof assertEnabledAdaptersSafe>[0]): Promise<RunningInstance & { adapterSafety: AdapterSafetyReport }> {
  for (const p of [SERVER_PORT, VITE_PORT]) if (await portBusy(p)) throw new Error(`H6: port ${p} busy — refusing`);
  const adapterSafety = await assertEnabledAdaptersSafe(adapters);
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "server.log");
  const log = fs.openSync(logFile, "w");
  const child = spawn(process.execPath, [path.join(REPO, "node_modules/tsx/dist/cli.mjs"), "server/_core/index.ts"], {
    cwd: REPO, env: serverEnv(logDir), stdio: ["ignore", log, log], windowsHide: true,
  });
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`H6: server exited ${child.exitCode} — see ${logFile}`);
    const m = /Server running on https?:\/\/localhost:(\d+)/.exec(fs.readFileSync(logFile, "utf8"));
    if (m) {
      if (Number(m[1]) !== SERVER_PORT) { killTree(child.pid); throw new Error(`H6: server on ${m[1]}, not ${SERVER_PORT}`); }
      break;
    }
    if (Date.now() - t0 > 240_000) { killTree(child.pid); throw new Error("H6: server not up after 240 s"); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const { createServer } = (await import(pathToFileURL(require.resolve("vite")).href)) as typeof import("vite");
  const cacheDir = path.join(os.tmpdir(), "aoi-h6-vite-cache");
  const target = `http://127.0.0.1:${SERVER_PORT}`;
  const vite = await createServer({
    configFile: path.join(REPO, "vite.config.ts"), cacheDir, logLevel: "warn", clearScreen: false,
    server: { port: VITE_PORT, strictPort: true, host: "127.0.0.1", hmr: false, fs: { strict: true, allow: [REPO, cacheDir] },
      proxy: { "/api": { target, ws: true, changeOrigin: false }, "/uploads": { target } } },
  });
  await vite.listen();
  return { child, vite, logDir, adapterSafety };
}

export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch { /* already gone */ }
}
