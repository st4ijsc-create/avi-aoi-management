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
// ★★★ Pha 2B Task 5 — vị từ "lỗi này có phải LỜI TỪ CHỐI không". Import TĨNH của một module
// LÁ (không import gì, không I/O): nó phải dùng được NGAY TRONG `catch` của một lượt
// `await import()` vừa hỏng. Xem `vramRefusalSignal.ts` để biết vì sao so TÊN, không `instanceof`.
import { isVramRefusal } from "./vram/vramRefusalSignal";
import path from "path";

import type { GgufGenerateResult } from "./aiGgufEngine";
import { validateGgufFile } from "./aiGgufEngine";
// Pha 1 Task 6 (điều phối VRAM) — `import type` bị xoá hoàn toàn lúc biên dịch; module telemetry
// chỉ được nạp bằng `import()` động tại đúng điểm xin phép, không nằm trên đường nạp file này.
import type { VramTicket } from "./vram/vramWiring";

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
// ⚠ Pha 1 Task 6 (review vòng 1, Minor) — `VRAM_SIDECAR_TTL_MS` (mặc định 900_000, xem
// beginVramAllocation() ở ensureSidecar()) là ĐỘC LẬP với IDLE_TIMEOUT_MS ở trên. Ý định là
// ttlMs > IDLE_TIMEOUT_MS (giấy phép phải sống lâu hơn sidecar tự tắt), nhưng KHÔNG có ràng buộc
// nào ép hai hằng số này đi cùng nhau — nâng LLAMA_VISION_IDLE_TIMEOUT_MS qua env mà quên nâng
// VRAM_SIDECAR_TTL_MS sẽ vi phạm NGẦM quan hệ đó. Vô hại ở Pha 1 (ttlMs chưa bị vramReconciler.ts
// tiêu thụ ở đâu cả — Pha 3 mới đọc), nhưng nếu Pha 3 bắt đầu dùng ttlMs để thu hồi giấy phép quá
// hạn, hai hằng số này cần được nâng CÙNG NHAU hoặc gộp về một nguồn.
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

/**
 * ★★★ Pha 2B Task 7 — **LƯỚI THEO ĐƯỜNG THOÁT cho chính lời khai của hộ này.**
 *
 * Đột biến *"gỡ `reclaimer` ở điểm gọi sản xuất"* **đã SỐNG SÓT 538/538** khi lời khai còn nằm
 * trực tiếp trong thân `ensureSidecar()`: mọi ca của Task 7 tự dựng hộ sidecar bằng tay nên
 * **không ca nào đọc cái mà đường sản xuất thật sự gửi đi**. Gỡ lời khai = hộ 7,8 GB biến khỏi
 * `preempt()` và khỏi "tổng nhường được" — IM LẶNG. Đúng lớp *"lưới đi theo FILE chứ không theo
 * ĐƯỜNG THOÁT"* (bài học Task 5, tái diễn ở Task 6, và tái diễn LẦN NỮA ở đây).
 *
 * ⇒ Tách thành MỘT hàm THUẦN: đường sản xuất truyền THẮNG kết quả của nó vào
 * `beginVramAllocation()`, và một ca test đọc ĐÚNG object ấy.
 * ⚠ Khoảng hở còn lại, khai thẳng: ai thôi dùng hàm này và viết lại object tại chỗ thì lưới lại mù.
 * Bề mặt đó nhỏ hơn hẳn một thân hàm 40 dòng, nhưng nó KHÔNG bằng không.
 */
export function visionSidecarVramRequest() {
  return {
      owner: "sidecar:vision",
      kind: "external-process",
      priority: "interactive",
      /**
       * ★★★ Pha 2B Task 7 (§8) — **HỘ NÀY THU HỒI ĐƯỢC, VÀ ĐÂY LÀ MỞ RỘNG DUY NHẤT CỦA
       * `preempt()` NGOÀI GGUF.**
       *
       * Lý do nó đủ điều kiện trong khi ONNX/trainer thì không:
       *   1. đường thu hồi ĐÃ TỒN TẠI và đã chạy hàng ngày — chính module này gọi `stopSidecar()`
       *      khi hết hạn nhàn rỗi (`LLAMA_VISION_IDLE_TIMEOUT_MS`);
       *   2. bằng chứng nhả là `"process-exit"` — **lớp mạnh nhất trong repo** (OS thu hồi VRAM khi
       *      tiến trình chết), khác hẳn `"unverified"` của ONNX (chỉ gỡ tham chiếu JS);
       *   3. nó là hộ tiêu thụ **LỚN NHẤT hệ** (7,8 GB đo được ở Đợt 0) — và từng vắng mặt khỏi MỌI
       *      phép cộng VRAM suốt ba đợt.
       * ⚠ `nguoiThiHanhThuHoi()` chỉ cho phép khi `refCount === 0` ⇒ không bao giờ giết ngang một
       * request thị giác đang bay. `noteRefCount()` dưới đây là thứ giữ lời hứa đó.
       */
      reclaimer: "vision-sidecar",
      // ⚠ 7825 là hằng số ĐO ĐƯỢC ở Đợt 2, dùng cho LƯỢT ĐẦU TIÊN thôi — sau lượt commit đầu
      // (xem `vramTicket.commitMeasured()` dưới), bộ ước lượng dùng số THẬT (nấc "learned").
      // Truyền qua `configDefaultBytes` (không hard-code thẳng vào estimatedBytes) để sự kiện
      // ghi `estimateSource: "config-default"` — dấu vết để Task 7 truy "chỗ nào còn dựa hằng số".
      configDefaultBytes: Number(process.env.VRAM_SIDECAR_ESTIMATE_MB ?? 7825) * 1024 * 1024,
      // Sidecar tự tắt sau IDLE_TIMEOUT_MS (mặc định 10 phút) nhàn rỗi — ttlMs PHẢI dài hơn,
      // nếu không reconciler tưởng nó chết trong khi nó đang sống khoẻ.
      ttlMs: Number(process.env.VRAM_SIDECAR_TTL_MS ?? 900_000),
      // I-1 — bằng chứng nhả: tiến trình con đã CHẾT (OS thu hồi VRAM). Xem bảng bốn điểm
      // nhả ở đầu `vram/vramWiring.ts` và ghi chú dài trong `stopSidecar()`.
      releaseProof: "process-exit",
  } as const;
}

// ─── Process lifecycle (singleton) ─────────────────────────────

interface SidecarState {
  proc: ChildProcess;
  config: VisionSidecarConfig;
  startedAt: number;
  /** Pha 1 Task 6 — giấy phép VRAM của LƯỢT khởi động này. `release()` (idempotent, không bao
   *  giờ ném) phải chạy ở MỌI nhánh thoát: `stopSidecar()` tường minh, `proc.on("exit")` (chết
   *  đột ngột), `proc.on("error")` (spawn lỗi) — thiếu một nhánh là giấy phép TREO vĩnh viễn. */
  vramTicket: VramTicket;
  /**
   * ★★★ C-2 (review TOÀN NHÁNH) — LỜI HỨA "TIẾN TRÌNH NÀY ĐÃ CHẾT", giải quyết ở ĐÚNG hai nhánh
   * trả giấy phép (`"exit"` và `"error"`). Đây là thứ làm `stopSidecar()` khai được sự thật thay
   * vì khai ý định: giữa `SIGTERM` và lúc OS thật sự thu hồi 7.825 MiB, **không ai được nói xong**.
   */
  daChet: MocCaiChet;
}

/**
 * ★★★ I-1 (review Pha 3 Task 1) — **VỊ TỪ "ĐÃ CHẾT", MỘT NGUỒN, HAI KIỂU ĐỌC.**
 *
 * Có đúng HAI nơi cần biết tiến trình đã chết chưa, và chúng cần hai HÌNH DẠNG khác nhau:
 *   • `stopSidecar()` chờ ⇒ cần một **lời hứa** (`xong`);
 *   • hẹn giờ cưỡng bức `SIGKILL` chạy trong một callback đồng bộ ⇒ cần một **câu trả lời NGAY**
 *     (`daXong()`).
 *
 * ⚠⚠ Chúng **KHÔNG được** là hai bản cài đặt (ràng buộc 12 — vị từ dùng chung). Cái bẫy vừa bị bắt
 * đúng là hậu quả của việc hẹn giờ tự chế một vị từ riêng bằng `proc.killed`: Node đặt cờ đó ĐỒNG
 * BỘ ngay khi `kill()` **gửi được tín hiệu**, nên nó khai *"đã gửi"* chứ không khai *"đã chết"* ⇒
 * điều kiện luôn sai ⇒ `SIGKILL` thành **mã chết**, và nhánh duy nhất còn nổ được là khi chính
 * `SIGTERM` thất bại — đúng ngược ý định.
 *
 * ⇒ MỘT người ghi (`danhDau`), hai người đọc, không có đường nào để hai người đọc lệch nhau.
 */
interface MocCaiChet {
  /** Lời hứa — giải quyết đúng một lần, gọi lại vô hại (Promise idempotent). */
  readonly xong: Promise<void>;
  /** Câu trả lời ĐỒNG BỘ cho đúng cùng một câu hỏi. Không phải bản sao: cùng một biến. */
  daXong(): boolean;
  /** Người ghi DUY NHẤT. Gọi nhiều lần vô hại — cùng lý do `ticket.release()` được phép. */
  danhDau(): void;
}

function moMocCaiChet(): MocCaiChet {
  let roi = false;
  let giaiQuyet: () => void = () => {};
  const xong = new Promise<void>((res) => {
    giaiQuyet = res;
  });
  return {
    xong,
    daXong: () => roi,
    danhDau: () => {
      roi = true;
      giaiQuyet();
    },
  };
}

let sidecar: SidecarState | null = null;
let startPromise: Promise<void> | null = null;
let lastUsedAt = 0;
let idleTimer: NodeJS.Timeout | null = null;
/**
 * ★★ Pha 2B Task 7 — SỐ REQUEST THỊ GIÁC ĐANG BAY, đồng bộ vào SỔ qua `noteRefCount()`.
 *
 * Đây là điều kiện làm `preempt()` **an toàn** cho hộ này: `nguoiThiHanhThuHoi()` chỉ trả tên
 * người thi hành khi `refCount === 0`. Thiếu bộ đếm này, giấy phép đứng nguyên `refCount = 1`
 * (mặc định an toàn của `reserve()`) ⇒ sidecar **không bao giờ** là ứng viên nhường chỗ, tức mở
 * rộng này là MÃ CHẾT — đúng hình dạng "lưới an toàn thứ 4 là mã chết" của Đợt 1.
 * ⚠ Đếm bằng `try/finally` quanh lượt gọi — một lượt ném mà không giảm là chốt kẹt VĨNH VIỄN
 * (đúng lớp lỗi C-1 mà Task 5 vừa vá ở `kbSyncScheduler`).
 */
let soRequestDangBay = 0;

function dongBoRefCountSidecar(): void {
  try {
    sidecar?.vramTicket.noteRefCount(soRequestDangBay);
  } catch {
    /* telemetry KHÔNG được làm hỏng đường thị giác */
  }
}

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

    // Pha 1 Task 6 — CHỈ KHAI BÁO. Ta KHÔNG sửa binary llama-server (không điều khiển được nó);
    // ta sửa THỨ KHỞI ĐỘNG nó. Người GIÁM SÁT (module này) xin giấy phép THAY CHO tiến trình con,
    // NGAY TRƯỚC khi spawn (spec §3.1) — đây là hộ tiêu thụ LỚN NHẤT hệ, vắng mặt khỏi MỌI phép
    // cộng VRAM suốt Đợt 0, chỉ bị bắt bởi một lượt review toàn nhánh (Đợt 2).
    let vramTicket: VramTicket = { commitMeasured: async () => {}, release: () => {}, noteRefCount: () => {} };
    try {
      const { beginVramAllocation } = await import("./vram/vramWiring");
      vramTicket = await beginVramAllocation(visionSidecarVramRequest());
    } catch (err) {
      // ★★★ Pha 2B Task 5 — TỪ CHỐI ≠ TELEMETRY HỎNG. Hộ này là hộ tiêu thụ LỚN NHẤT hệ (7,8 GB
      // đo được) và từng vắng mặt khỏi MỌI phép cộng VRAM suốt Đợt 0 — nuốt lời từ chối ở đúng
      // đây là để nó tiếp tục vô hình với cưỡng chế.
      if (isVramRefusal(err)) throw err;
      /* telemetry KHÔNG được làm hỏng đường khởi động sidecar */
    }

    // ⚠ Nhánh thoát THỨ TƯ (review vòng 1, Task 6) — `spawn()` có thể ném ĐỒNG BỘ (vd. EACCES,
    // thiếu quyền thực thi binary). Tại điểm này `vramTicket` đã `reserve()` xong (:246-260) NHƯNG
    // biến `sidecar` cấp module CHƯA được set (nó set SAU spawn(), :321) — nếu không bọc try/catch
    // ở đây, ngoại lệ văng thẳng ra khỏi `startPromise`, không nhánh `exit`/`error` nào kịp gắn để
    // trả chỗ, và KHÔNG CÒN CHỖ NÀO KHÁC có thể trả lease này nữa: treo tới khi restart tiến trình.
    // Cùng khuôn với `spawnKbSyncWithVram`/`catch` của `runKbSyncNow()` (kbSyncScheduler.ts).
    let proc: ChildProcess;
    try {
      proc = spawn(cfg.binPath, args, {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      try {
        vramTicket.release();
      } catch {
        /* telemetry KHÔNG được làm hỏng đường khởi động sidecar */
      }
      throw err;
    }

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
    /**
     * ★★★ C-2 — mốc "ĐÃ CHẾT". Dựng TRƯỚC khi gắn hai nhánh thoát để không có cửa sổ nào mà một
     * lượt `exit` sớm rơi vào hư không. `resolve` gọi nhiều lần là vô hại (Promise idempotent) —
     * cùng lý do `ticket.release()` được phép gọi từ cả hai nhánh.
     */
    const daChet = moMocCaiChet();
    // ⚠ release() PHẢI chạy ở MỌI nhánh thoát: "exit" (chết đột ngột — crash/kill/OOM, KHÔNG
    // qua stopSidecar()) VÀ "error" (spawn thất bại — ENOENT/EACCES; "exit" có thể KHÔNG BAO GIỜ
    // tới trong ca này). Thiếu một nhánh là giấy phép TREO vĩnh viễn — reconciler báo lệch ÂM
    // mãi mãi (Task 5 mất ba vòng sửa vì đúng họ lỗi này). `ticket.release()` idempotent nên gọi
    // từ nhiều nhánh (kể cả cùng với `stopSidecar()` tường minh) là vô hại.
    proc.on("exit", (code, signal) => {
      exited = true;
      exitInfo = `code=${code} signal=${signal}`;
      console.log(`[llamaVisionSidecar] llama-server exited (${exitInfo})`);
      try {
        vramTicket.release();
      } catch {
        /* telemetry KHÔNG được làm hỏng vòng đời sidecar */
      }
      // ⚠ C-2 — NGOÀI `try`: một `release()` ném không được phép nuốt mốc "đã chết", nếu không
      // `stopSidecar()` chờ hết hạn rồi khai `false` cho một tiến trình ĐÃ chết thật.
      daChet.danhDau();
      if (sidecar?.proc === proc) {
        sidecar = null;
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      }
    });
    proc.on("error", (err) => {
      exited = true;
      exitInfo = `spawn error: ${(err as Error)?.message ?? err}`;
      console.error(`[llamaVisionSidecar] llama-server process error: ${exitInfo}`);
      try {
        vramTicket.release();
      } catch {
        /* telemetry KHÔNG được làm hỏng vòng đời sidecar */
      }
      daChet.danhDau();
      if (sidecar?.proc === proc) {
        sidecar = null;
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      }
    });

    sidecar = { proc, config: cfg, startedAt: Date.now(), vramTicket, daChet };

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
        // Số THẬT sau khi mô hình đã nạp xong (trọng số + mmproj + KV-cache) — nuôi nấc
        // "learned" của bộ ước lượng cho lượt spawn KẾ TIẾP. `commitMeasured()` không bao giờ
        // ném (vramWiring.ts).
        await vramTicket.commitMeasured();
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

/**
 * Stop the sidecar process and clear timers. Safe to call when nothing is running.
 *
 * ★★★ C-2 (review TOÀN NHÁNH) — **TRẢ VỀ `true` CHỈ KHI TIẾN TRÌNH ĐÃ CHẾT THẬT.**
 *
 * Bản trước trả `void` sau khi gửi `SIGTERM` + hẹn `SIGKILL` 5.000 ms rồi **return ngay**, còn
 * người thi hành `vram/vramPreempt.ts` thì `return true` **vô điều kiện**. Hợp đồng ghi trong
 * chính file đó (*"trả `true` chỉ khi đã THẬT SỰ dispose/giết, KHÔNG phải khi đã gọi lệnh"*) bị
 * phá, và chuỗi thật là:
 *
 *   1. `preempt()` → `reclaimed = ["sidecar:vision"]`, `freedBytes = 0` (sổ chưa nhả);
 *   2. `vramWiring` thấy `reclaimed.length > 0` ⇒ **xin lại NGAY** (đúng một lượt, không vòng lặp);
 *   3. giấy phép 7,8 GB vẫn còn trong sổ ⇒ **TỪ CHỐI LẦN HAI**.
 *
 * ⇒ Giết hộ tiêu thụ LỚN NHẤT hệ (khởi động lại tốn tới `READY_TIMEOUT_MS` = 120 s) **và lượt xin
 * vẫn hỏng** — net-âm, tệ hơn không thu hồi.
 *
 * ⚠ CHỜ CÓ HẠN GIỜ, và hạn đó phải > mốc `SIGKILL` (5.000 ms) — chờ vô hạn ở đây là treo đường
 * `beginVramAllocation()` của một lượt nạp model. Hết hạn ⇒ **`false`** = *"tôi chưa quan sát được
 * cái chết"*, và người gọi **không** xin lại (`preempt()` xếp hộ này vào `failed`). Đó là câu trả
 * lời TRUNG THỰC: thiết bị THẬT SỰ còn giữ 7.825 MiB khi tiến trình chưa chết.
 * ⚠ `!current` ⇒ `false` chứ không phải `true`: "tôi không có tiến trình nào để giết" KHÔNG đồng
 * nghĩa "byte đã ra khỏi sổ" — ca giấy phép còn treo vì một lượt stop trước đó chưa chết được rơi
 * đúng vào đây, và khai `true` ở đó là dựng lại chính lỗi C-2.
 */
export async function stopSidecar(): Promise<boolean> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const current = sidecar;
  sidecar = null;
  if (!current) return false;
  // ★ I-1 (review TOÀN NHÁNH) — KHÔNG trả giấy phép ở đây. Kỷ luật DUY NHẤT về thứ tự nhả nằm
  // ở đầu `vram/vramWiring.ts`: **sổ chỉ nhả SAU khi thiết bị đã nhả**.
  //
  // Bản trước gọi `release()` NGAY TẠI ĐÂY, TRƯỚC `kill("SIGTERM")` bên dưới, với lý do "không
  // để giấy phép sống lâu hơn QUYẾT ĐỊNH tắt sidecar". Lý do đó nhầm chủ thể: sổ cái theo dõi
  // BỘ NHỚ THIẾT BỊ, không theo dõi ý định của ta. Giữa SIGTERM và lúc tiến trình thật sự chết
  // (SIGKILL cưỡng bức sau 5.000 ms bên dưới) thiết bị VẪN giữ **7.825 MiB** trong khi sổ đã về
  // 0 ⇒ một nhịp đối chiếu rơi vào cửa sổ đó in "LỆCH +7825 MiB … cấp phát KHÔNG XIN PHÉP".
  // Sidecar tự tắt sau MỖI 10 phút nhàn rỗi (`IDLE_TIMEOUT_MS`) ⇒ hàng chục cửa sổ như vậy mỗi
  // 24 h — module TỰ SINH ra đúng cái báo động giả nó được viết ra để bắt.
  //
  // Ai trả chỗ, nếu không phải ở đây: `proc.on("exit")` VÀ `proc.on("error")` gắn ngay sau
  // `spawn()` (xem `ensureSidecar`). Hai nhánh đó phủ MỌI đường chết — SIGTERM thành công,
  // SIGKILL cưỡng bức, crash, OOM — và chúng chạy khi tiến trình ĐÃ chết, tức khi OS đã thu hồi
  // VRAM của nó. `release()` idempotent nên gọi từ cả hai là vô hại.
  //
  // ⚠ Ca duy nhất còn giữ giấy phép: tiến trình không chết được cả sau SIGKILL — tức `TerminateProcess`
  // được gọi mà tiến trình vẫn không tháo dỡ xong (driver treo, I/O nhân không huỷ được). Khi đó
  // thiết bị THẬT SỰ vẫn giữ 7.825 MiB ⇒ giữ giấy phép là ĐÚNG, không phải rò rỉ. `ttlMs` là thứ
  // Pha 2/3 dùng để xác minh rồi thu hồi ca đó (spec §6).
  // ⚠⚠ I-1 (review Pha 3 Task 1) — CÂU TRÊN CHỈ ĐÚNG TỪ BẢN VÁ NÀY. Trước đó hẹn giờ cưỡng bức
  // canh cửa bằng `if (!proc.killed)`, mà Node đặt `killed = true` ĐỒNG BỘ ngay khi `kill()` GỬI
  // được tín hiệu ⇒ điều kiện luôn sai ⇒ **SIGKILL chưa bao giờ được gửi**, và trạng thái "không
  // chết cả sau SIGKILL" mà đoạn văn này mô tả là một trạng thái mã KHÔNG TẠO RA ĐƯỢC. Task 4 định
  // dựng `ttlMs` lên trên đúng câu đó.
  try {
    if (!current.proc.killed) {
      current.proc.kill("SIGTERM");
      // Force-kill if it lingers.
      const proc = current.proc;
      const moc = current.daChet;
      const t = setTimeout(() => {
        // ★★★ I-1 — VỊ TỪ ĐÚNG: "đã chết chưa", đọc từ CÙNG MỘT nguồn với `Promise.race` bên dưới
        // (`MocCaiChet`). KHÔNG dùng `proc.killed` — đó là "đã gửi tín hiệu chưa", một câu hỏi khác.
        if (!moc.daXong()) {
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

  // ★★★ C-2 — CHỜ CÁI CHẾT THẬT, có hạn giờ. `daChet` được giải quyết ở `proc.on("exit")` /
  // `proc.on("error")` — hai nhánh CŨNG là nơi `vramTicket.release()` chạy ⇒ khi lời hứa này về
  // thì SỔ đã nhả, không phải "sắp nhả".
  const daChetThat = await Promise.race([
    current.daChet.xong.then(() => true),
    hetGio(stopWaitMs()).then(() => false),
  ]);
  if (!daChetThat) {
    console.warn(
      `[llamaVisionSidecar] SIGTERM/SIGKILL đã gửi nhưng tiến trình CHƯA chết sau ${stopWaitMs()} ms — ` +
        `giấy phép VRAM (7.825 MiB) VẪN GIỮ vì thiết bị vẫn giữ. Lượt thu hồi khai THẤT BẠI, ` +
        `không xin lại (xem C-2 ở vram/vramPreempt.ts).`,
    );
  }
  return daChetThat;
}

/**
 * Hạn chờ cái chết của tiến trình con (ms). Mặc định **8.000** = mốc `SIGKILL` (5.000) + 3.000 ms
 * cho OS thu hồi. ⚠ Sàn 1 ms: `0`/rác biến lượt chờ thành một phép đo tức thời và dựng lại C-2.
 *
 * ★★★ Pha 3 Task 1 — **CON SỐ NÀY ĐÃ ĐƯỢC ĐO, KHÔNG CÒN LÀ MỘT PHỎNG ĐOÁN.** 5 lượt spawn→stop
 * trên sidecar THẬT (llama-server + Qwen3-VL-8B, 7.825–7.840 MiB đo bằng `nvidia-smi`):
 * **485,3 · 485,6 · 488,3 · 500,4 · 495,6 ms** (min 485,3 · trung vị 488,3 · max 500,4) ⇒ hạn 8.000
 * còn **≈16 lần** biên. Không lượt nào chạm hạn.
 *
 * ⚠⚠ CÓ MỘT CỬA SỔ, VÀ NGUYÊN NHÂN CỦA NÓ KHÔNG PHẢI THỨ AI CŨNG ĐOÁN ĐÚNG (I-3, review Task 1).
 * Đo tách các mốc trên cùng một lượt dừng, hai lượt độc lập:
 *   • `kill(pid,0)` → `ESRCH`: **10,9 ms** / **16,6 ms**
 *   • `nvidia-smi` đã về nền: trong **~150 ms** / ngay ở mẫu ĐẦU TIÊN **≤33 ms**
 *   • Node phát `"exit"`: **514,8 ms** / **559,9 ms** ⇒ chênh **503,8** / **543,3 ms**
 *
 * ⚠⚠ "ĐỘ TRỄ QUAN SÁT CỦA libuv" LÀ MỘT CHẨN ĐOÁN SAI — bản chứng: **CÙNG khuôn đo, CÙNG cấu hình
 * stdio, tiến trình con KHÔNG GPU** (`node -e "setInterval(…)"`) cho chênh **3,4–4,1 ms (5/5 lượt)**
 * và `ESRCH` ở **0,2–0,4 ms**. libuv giao `"exit"` trong vài mili giây; nó không chậm.
 *
 * ⇒ Sự thật là **ngữ nghĩa `TerminateProcess`**, và nó có hai nửa:
 *   1. **mã thoát được đóng dấu NGAY** ⇒ `GetExitCodeProcess` thôi trả `STILL_ACTIVE` ⇒ `kill(pid,0)`
 *      trả `ESRCH` **gần như tức thì**. Tức **`kill(pid,0)` KHÔNG PHẢI một quan sát cái chết** — nó
 *      SỚM GIẢ. Đừng dùng nó làm bằng chứng "đã nhả" ở bất cứ đâu trong Pha 3.
 *   2. **handle tiến trình chỉ BÁO HIỆU khi tháo dỡ xong** — với một tiến trình CUDA giữ 7,8 GB,
 *      việc đó tốn ~0,5 s. Đó mới là thứ `"exit"` (và lượt chờ này) đang đo. Nó ĐANG ĐO ĐÚNG THỨ
 *      CẦN ĐO; con số lớn là bản chất của hộ tiêu thụ, không phải khuyết tật của bộ đo.
 */
function stopWaitMs(): number {
  const n = Number(process.env.LLAMA_VISION_STOP_WAIT_MS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8000;
}

/**
 * ★★★ I-4 (review Pha 3 Task 1) — **HẬU QUẢ CỦA CỬA SỔ ~0,5 s, NÓI CHO ĐỦ.** Tách khỏi docstring
 * `stopWaitMs()` vì đây là điều Pha 3 phải đọc, không phải điều người chỉnh biến môi trường cần.
 *
 * Trong cửa sổ giữa "thiết bị đã nhả" (~33 ms) và "sổ nhả" (~0,5 s), **sổ khai THỪA 7,8 GB**.
 *
 * 1. **AN TOÀN — nhưng chỉ cho ĐÚNG MỘT người đọc.** Với **quyết định cấp phát**, khai thừa là
 *    chiều đúng: không ai được cấp trên chỗ trống ma. Câu "lệch về phía an toàn" **dừng ở đây**.
 *
 * 2. ⚠⚠ **KHÔNG IM LẶNG — NÓ CÓ CHUÔNG, VÀ CHUÔNG SẼ KÊU SAI.** `vramReconciler.reconcileOnce()`
 *    tính `alarm = drift > NGƯỠNG || drift < -(NGƯỠNG + pendingBytes)`. Trong cửa sổ này
 *    `drift ≈ −7.830 MiB` và `pendingBytes = 0` (giấy phép không còn ở trạng thái đang nạp), mà
 *    ngưỡng mặc định là **512 MiB** (`VRAM_DRIFT_THRESHOLD_MB`) ⇒ **vượt xa** ⇒ một nhịp đối chiếu
 *    rơi đúng vào cửa sổ sẽ in *"Sổ đang giữ NHIỀU HƠN thực tế — giấy phép treo, đo hỏng, hoặc số
 *    commit sai"*. **Cả ba lời quy trách đó đều SAI**: đây là một lượt dừng hoàn toàn bình thường.
 *    Xác suất mỗi lượt dừng ≈ 0,5 s / 60 s (`VRAM_RECONCILE_INTERVAL_MS`) ≈ **0,8%** — hiếm, nhưng
 *    sidecar tự tắt sau mỗi 10 phút nhàn rỗi nên nó **sẽ** xảy ra. Đây đúng hình dạng bài học I-1
 *    của Pha 1: *module TỰ SINH ra đúng cái báo động giả nó được viết ra để bắt*.
 *
 * 3. ⚠ **"Mọi cơ chế lấy `after − before` sẽ thấy 0" là ĐÚNG MỘT NỬA, và nửa sai gọi nhầm tên dụng
 *    cụ.** Phải hỏi *đọc cái gì*:
 *      • đọc **SỔ** trong cửa sổ ⇒ thấy **0 byte được nhả** ⇒ kết luận "thu hồi hỏng" (đúng lớp lỗi
 *        T5-11 của Pha 1.5);
 *      • đọc **THIẾT BỊ** trong cửa sổ ⇒ thấy **NGƯỢC LẠI**: toàn bộ 7,8 GB đã nhả từ ~33 ms.
 *    Hai thước cho hai câu trả lời trái nhau trong cùng 0,5 giây — và Đ4 đã cấm trộn chúng.
 *
 * 4. **`preempt()` hôm nay KHÔNG dính**, và lý do là cấu trúc chứ không phải may mắn: nó đọc sổ
 *    **SAU** `await NGUOI_THI_HANH[…]`, tức sau khi `stopSidecar()` đã thấy `"exit"` ⇒ sổ đã nhả ⇒
 *    `freedBytes` đúng. Nghiệm thu SỐNG lượt (b) đo được đúng `8.210.137.088` byte. Ai dời phép đo
 *    đó lên TRƯỚC lượt chờ sẽ dựng lại toàn bộ lớp lỗi này.
 */

/** Hẹn giờ KHÔNG giữ vòng lặp sự kiện sống (`unref`) — cùng kỷ luật với `idleTimer`. */
function hetGio(ms: number): Promise<void> {
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    if (typeof t.unref === "function") t.unref();
  });
}

/**
 * Chỉ dùng trong test (Task 6, `vram/wiring.outofprocess.test.ts`). KHÔNG có logic riêng — bí
 * danh của hàm CÔNG KHAI thật, không nhảy qua cổng nào (cùng lý do Task 5 chọn đường công khai
 * cho `aiReranker` thay vì phát minh một seam riêng: seam nhảy-qua-cổng-thật là thứ reviewer từ
 * chối). `ensureSidecar()` đòi hỏi cấu hình + file GGUF thật + healthcheck HTTP thật để tới được
 * điểm xin phép VRAM — test mock ba biên đó (fs, child_process, fetch), không mock chính hàm này.
 */
export const __startSidecarForTests = ensureSidecar;
export const __stopSidecarForTests = stopSidecar;

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
  // ★ Task 7 — từ đây tới `finally` cuối hàm, sổ khai hộ này ĐANG DÙNG ⇒ `preempt()` không chạm tới.
  soRequestDangBay += 1;
  dongBoRefCountSidecar();
  try {

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
  } finally {
    // ★ Task 7 — `finally`, KHÔNG phải cuối nhánh thành công: một lượt ném (HTTP lỗi, completion
    // rỗng) mà không giảm bộ đếm là chốt kẹt VĨNH VIỄN — sidecar 7,8 GB thành không bao giờ
    // nhường chỗ được nữa, và không ai thấy vì số đó không hiện ở đâu.
    soRequestDangBay = Math.max(0, soRequestDangBay - 1);
    dongBoRefCountSidecar();
  }
}
