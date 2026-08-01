/**
 * WS-G2 — Local llama.cpp multimodal (mtmd) sidecar manager.
 *
 * node-llama-cpp 3.18.1 does NOT bind llama.cpp's multimodal (mtmd) projector to JS
 * (vision is roadmap v4.0.0, unreleased). To get REAL, 100%-offline vision today we
 * spawn a local `llama-server` process (built with mtmd support) bound to 127.0.0.1
 * and talk to it over HTTP via its OpenAI-compatible /v1/chat/completions endpoint.
 *
 * No outbound network calls are ever made — the sidecar listens only on localhost.
 *
 * API format verified against llama.cpp `tools/server/README.md` (mtmd / multimodal):
 *   - Multimodal is exposed on the OAI-compatible chat endpoint.
 *   - Images are sent as an `image_url` content part whose `url` is a
 *     `data:image/<mime>;base64,<...>` data URI (base64 input supported).
 *   - Clients should check `/v1/models` (or `/health`) for readiness/capability.
 *   Source: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
 *
 * Environment configuration:
 *   - LLAMA_SERVER_BIN    : absolute path to the `llama-server` binary (with mtmd support)
 *   - GGUF_MODELS_DIR     : directory holding the GGUF model files (shared with aiGgufEngine)
 *   - GGUF_VISION_MODEL   : vision model filename / path (e.g. Qwen2-VL-7B-Instruct-Q4_K_M.gguf)
 *   - GGUF_VISION_MMPROJ  : matching mmproj filename / path (e.g. mmproj-Qwen2-VL-7B-f16.gguf)
 *   - LLAMA_VISION_HOST   : bind host (default 127.0.0.1)
 *   - LLAMA_VISION_PORT   : bind port (default 8081)
 *   - LLAMA_VISION_READY_TIMEOUT_MS : healthcheck timeout (default 120000)
 *   - LLAMA_VISION_IDLE_TIMEOUT_MS  : kill sidecar after this idle period (default 600000 = 10 min)
 *   - LLAMA_VISION_GPU_LAYERS       : -ngl value passed to llama-server (default 999 = all)
 */

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

import type { GgufGenerateResult } from "./aiGgufEngine";
import { validateGgufFile } from "./aiGgufEngine";

// ─── Config ────────────────────────────────────────────────────

function getModelsDir(): string {
  return process.env.GGUF_MODELS_DIR
    ? path.resolve(process.env.GGUF_MODELS_DIR)
    : path.join(process.cwd(), "uploads", "gguf-models");
}

/** Resolve a model filename/path relative to GGUF_MODELS_DIR (or absolute). Does NOT require existence. */
function resolveVisionFile(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.join(getModelsDir(), p);
}

const VISION_HOST = process.env.LLAMA_VISION_HOST || "127.0.0.1";
const VISION_PORT = (() => {
  const n = parseInt(process.env.LLAMA_VISION_PORT || "8081", 10);
  return Number.isFinite(n) && n > 0 ? n : 8081;
})();
const READY_TIMEOUT_MS = (() => {
  const n = parseInt(process.env.LLAMA_VISION_READY_TIMEOUT_MS || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
})();
const IDLE_TIMEOUT_MS = (() => {
  const n = parseInt(process.env.LLAMA_VISION_IDLE_TIMEOUT_MS || "600000", 10);
  return Number.isFinite(n) && n > 0 ? n : 600000;
})();
const GPU_LAYERS = (() => {
  const n = parseInt(process.env.LLAMA_VISION_GPU_LAYERS || "999", 10);
  return Number.isFinite(n) ? n : 999;
})();
/** Context size (-c) for the vision sidecar. Default 8192. Qwen2.5-VL/Qwen3-VL's native 128k+ ctx
 *  would otherwise allocate several GB of KV-cache per process — wasteful for single-image
 *  describe/QA. B0.2: enforce a sane upper cap (LLAMA_VISION_CTX_MAX, default 16384) so a
 *  misconfigured value can't blow the VRAM budget; default 8192 stays well within it. */
const VISION_CTX_MAX = (() => {
  const n = parseInt(process.env.LLAMA_VISION_CTX_MAX || "16384", 10);
  return Number.isFinite(n) && n > 0 ? n : 16384;
})();
const VISION_CTX = (() => {
  const n = parseInt(process.env.LLAMA_VISION_CTX || "8192", 10);
  const v = Number.isFinite(n) && n > 0 ? n : 8192;
  if (v > VISION_CTX_MAX) {
    console.warn(`[llamaVisionSidecar] LLAMA_VISION_CTX=${v} exceeds cap ${VISION_CTX_MAX}; clamping to ${VISION_CTX_MAX}.`);
    return VISION_CTX_MAX;
  }
  return v;
})();
/** Đợt 1 Task 3 — llama-server mặc định n_parallel=4 khi thiếu -np. Giả thuyết ban đầu (Đợt 0):
 *  LLAMA_VISION_CTX × 4 khe = 32.768 token ⇒ phần lớn 7.821 MiB đo được là do nhân bốn.
 *  ĐO LẠI TRỰC TIẾP (Task 3, llama-server.exe build 2026-06-26): giả thuyết đó KHÔNG đúng cho
 *  build này — log khởi động in "kv_unified = true" ngay cả ở n_parallel=4 mặc định, nghĩa là
 *  KV-cache là MỘT khối dùng chung cỡ đúng bằng -c (8192), không nhân theo số khe. Đo trước/sau
 *  -np xác nhận: VRAM gần như không đổi (~7.827 MiB cả hai phía, lệch trong nhiễu đo). Vẫn giữ
 *  -np=1 vì: (a) hệ chỉ gửi 1 ảnh/lượt nên 4 khe là thừa về mặt logic dù không tốn VRAM thêm,
 *  (b) phòng hờ build llama-server tương lai đổi mặc định kv_unified. Xem báo cáo §3 để biết
 *  chi tiết đo đạc — ĐỪNG coi -np là đã "giành lại" VRAM, số đo thật nói khác. */
const VISION_PARALLEL = (() => {
  const n = parseInt(process.env.LLAMA_VISION_PARALLEL || "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
})();

function baseUrl(): string {
  return `http://${VISION_HOST}:${VISION_PORT}`;
}

// ─── Availability ──────────────────────────────────────────────

export interface VisionSidecarConfig {
  binPath: string;
  modelPath: string;
  mmprojPath: string;
  host: string;
  port: number;
}

/**
 * Resolve the configured sidecar paths from env. Returns null if any of the three
 * required env vars (binary, model, mmproj) is unset.
 */
export function getVisionSidecarConfig(): VisionSidecarConfig | null {
  const bin = process.env.LLAMA_SERVER_BIN;
  const model = process.env.GGUF_VISION_MODEL;
  const mmproj = process.env.GGUF_VISION_MMPROJ;
  if (!bin || !model || !mmproj) return null;
  return {
    binPath: bin,
    modelPath: resolveVisionFile(model),
    mmprojPath: resolveVisionFile(mmproj),
    host: VISION_HOST,
    port: VISION_PORT,
  };
}

/**
 * True only when the llama-server binary + vision model + mmproj all exist on disk.
 * Used by callers to decide whether to attempt real vision or degrade honestly.
 */
export function isVisionSidecarAvailable(): boolean {
  const cfg = getVisionSidecarConfig();
  if (!cfg) return false;
  try {
    return (
      fs.existsSync(cfg.binPath) &&
      fs.existsSync(cfg.modelPath) &&
      fs.existsSync(cfg.mmprojPath)
    );
  } catch {
    return false;
  }
}

// ─── Process lifecycle (singleton) ─────────────────────────────

interface SidecarState {
  proc: ChildProcess;
  config: VisionSidecarConfig;
  startedAt: number;
}

let sidecar: SidecarState | null = null;
let startPromise: Promise<void> | null = null;
let lastUsedAt = 0;
let idleTimer: NodeJS.Timeout | null = null;

function touchIdle(): void {
  lastUsedAt = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (sidecar && Date.now() - lastUsedAt >= IDLE_TIMEOUT_MS - 1000) {
      console.log("[llamaVisionSidecar] idle timeout reached — stopping sidecar");
      void stopSidecar();
    }
  }, IDLE_TIMEOUT_MS);
  // Don't keep the event loop alive purely for the idle timer.
  if (typeof idleTimer.unref === "function") idleTimer.unref();
}

async function probeHealth(): Promise<boolean> {
  // Prefer /health (returns 200 with {"status":"ok"} when the model is fully loaded).
  // Fall back to /v1/models if /health is unavailable on the build.
  for (const ep of ["/health", "/v1/models"]) {
    try {
      const res = await fetch(`${baseUrl()}${ep}`, { method: "GET" });
      if (res.ok) {
        if (ep === "/health") {
          const body = (await res.json().catch(() => ({}))) as any;
          // llama-server reports "ok" when ready; "loading model" while warming up.
          if (body && typeof body.status === "string" && body.status !== "ok") continue;
        }
        return true;
      }
    } catch {
      // not up yet
    }
  }
  return false;
}

/**
 * Lazily spawn the llama-server mtmd sidecar and wait until it reports healthy.
 * Singleton: concurrent callers share one process and one start promise.
 */
export async function ensureSidecar(): Promise<void> {
  if (sidecar && !sidecar.proc.killed) {
    touchIdle();
    return;
  }
  if (startPromise) return startPromise;

  const cfg = getVisionSidecarConfig();
  if (!cfg) {
    throw new Error(
      "VISION_NOT_AVAILABLE: llama vision sidecar not configured (set LLAMA_SERVER_BIN, GGUF_VISION_MODEL, GGUF_VISION_MMPROJ).",
    );
  }
  if (!fs.existsSync(cfg.binPath)) {
    throw new Error(`VISION_NOT_AVAILABLE: llama-server binary not found at ${cfg.binPath}`);
  }
  // Validate the model + mmproj files are real GGUF (catches the corrupt 70MB LLaVA file).
  validateGgufFile(cfg.modelPath);
  validateGgufFile(cfg.mmprojPath);

  startPromise = (async () => {
    const args = [
      "-m", cfg.modelPath,
      "--mmproj", cfg.mmprojPath,
      "--host", cfg.host,
      "--port", String(cfg.port),
      "-ngl", String(GPU_LAYERS),
      "-c", String(VISION_CTX),
      "-np", String(VISION_PARALLEL),
      // Qwen3-VL (and modern VLMs) need the jinja chat template for correct multimodal formatting.
      "--jinja",
    ];
    console.log(`[llamaVisionSidecar] spawning: ${cfg.binPath} ${args.join(" ")}`);

    const proc = spawn(cfg.binPath, args, {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (d) => {
      const s = String(d).trim();
      if (s) console.log(`[llama-server] ${s}`);
    });
    proc.stderr?.on("data", (d) => {
      const s = String(d).trim();
      if (s) console.log(`[llama-server] ${s}`);
    });

    let exited = false;
    let exitInfo = "";
    proc.on("exit", (code, signal) => {
      exited = true;
      exitInfo = `code=${code} signal=${signal}`;
      console.log(`[llamaVisionSidecar] llama-server exited (${exitInfo})`);
      if (sidecar?.proc === proc) {
        sidecar = null;
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      }
    });

    sidecar = { proc, config: cfg, startedAt: Date.now() };

    // Poll healthcheck until ready or timeout.
    const deadline = Date.now() + READY_TIMEOUT_MS;
    const pollMs = 500;
    // small initial delay before first probe
    while (Date.now() < deadline) {
      if (exited) {
        sidecar = null;
        throw new Error(`VISION_NOT_AVAILABLE: llama-server exited during startup (${exitInfo})`);
      }
      if (await probeHealth()) {
        touchIdle();
        console.log("[llamaVisionSidecar] sidecar ready");
        return;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    // timed out
    await stopSidecar();
    throw new Error(
      `VISION_NOT_AVAILABLE: llama-server did not become healthy within ${READY_TIMEOUT_MS}ms at ${baseUrl()}`,
    );
  })();

  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
}

/** Stop the sidecar process and clear timers. Safe to call when nothing is running. */
export async function stopSidecar(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const current = sidecar;
  sidecar = null;
  if (!current) return;
  try {
    if (!current.proc.killed) {
      current.proc.kill("SIGTERM");
      // Force-kill if it lingers.
      const proc = current.proc;
      const t = setTimeout(() => {
        if (!proc.killed) {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }
      }, 5000);
      if (typeof t.unref === "function") t.unref();
    }
  } catch (err) {
    console.warn("[llamaVisionSidecar] stopSidecar error:", (err as any)?.message ?? err);
  }
}

// ─── Inference ─────────────────────────────────────────────────

export interface SidecarDescribeOptions {
  /** One image (most mtmd models / single-image prompts). */
  image?: Buffer;
  /** Multiple images (e.g. compareImages). Sent as multiple image_url parts. */
  images?: Buffer[];
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  language?: "en" | "vi";
}

function detectMime(buf: Buffer): string {
  if (buf.length >= 4) {
    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
    // JPEG
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    // WEBP ("RIFF"...."WEBP")
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "image/webp";
    // GIF
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  }
  return "image/png";
}

function toDataUrl(buf: Buffer): string {
  return `data:${detectMime(buf)};base64,${buf.toString("base64")}`;
}

/**
 * Run a multimodal chat completion against the local llama-server sidecar.
 * Returns the same shape as aiGgufEngine.describeImage (GgufGenerateResult) so the
 * provider router and call sites need no signature changes.
 */
export async function describeImageViaSidecar(
  opts: SidecarDescribeOptions,
): Promise<GgufGenerateResult> {
  const startTime = Date.now();
  await ensureSidecar();
  touchIdle();

  const cfg = sidecar?.config ?? getVisionSidecarConfig();
  const modelId = cfg ? path.basename(cfg.modelPath, ".gguf") : "vision";

  const buffers: Buffer[] = opts.images && opts.images.length > 0
    ? opts.images
    : opts.image
      ? [opts.image]
      : [];
  if (buffers.length === 0) {
    throw new Error("describeImageViaSidecar: no image provided");
  }

  const langHint = opts.language === "vi" ? " (Trả lời bằng tiếng Việt.)" : "";
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: opts.prompt + langHint },
  ];
  for (const buf of buffers) {
    content.push({ type: "image_url", image_url: { url: toDataUrl(buf) } });
  }

  const messages: Array<Record<string, unknown>> = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content });

  const reqBody = {
    model: modelId,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 512,
    stream: false,
  };

  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`llama-server /v1/chat/completions HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };

  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) {
    throw new Error("llama-server returned an empty completion");
  }

  const totalTimeMs = Date.now() - startTime;
  const tokensGenerated = data.usage?.completion_tokens ?? 0;
  const tokensPrompt = data.usage?.prompt_tokens ?? 0;

  return {
    text,
    tokensGenerated,
    tokensPrompt,
    totalTimeMs,
    tokensPerSecond: totalTimeMs > 0 && tokensGenerated > 0
      ? Number(((tokensGenerated / totalTimeMs) * 1000).toFixed(1))
      : 0,
    modelId: data.model || modelId,
  };
}
