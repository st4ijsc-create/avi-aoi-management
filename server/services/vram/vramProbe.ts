import { getLlamaInstanceIfReady } from "./llamaHandle";

const CACHE_MS = Number(process.env.VRAM_PROBE_CACHE_MS ?? 5000);
let cached: { at: number; value: { usedBytes: number; totalBytes: number } | null } | null = null;

/**
 * Sự thật thiết bị. ⚠ CHỈ gọi từ reconciler NỀN — KHÔNG BAO GIỜ từ đường cấp phát.
 * `nvidia-smi` mất tới ~3 s; comment aiGgufEngine.ts:372 ghi rằng bản ĐỒNG BỘ
 * từng ĐÓNG BĂNG toàn bộ xử lý request.
 */
export async function readDeviceVram(): Promise<{ usedBytes: number; totalBytes: number } | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const llama = getLlamaInstanceIfReady();
  if (llama && typeof llama.getVramState === "function") {
    try {
      const v = await llama.getVramState();
      if (v && v.total > 0) {
        cached = { at: Date.now(), value: { usedBytes: v.used, totalBytes: v.total } };
        return cached.value;
      }
    } catch { /* lùi về nvidia-smi */ }
  }

  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const { stdout } = await promisify(execFile)(
      "nvidia-smi",
      ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 3000, windowsHide: true },
    );
    const line = String(stdout).split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
    const [used, total] = line.split(",").map((s) => parseInt(s.trim(), 10));
    if (Number.isFinite(used) && Number.isFinite(total) && total > 0) {
      cached = { at: Date.now(), value: { usedBytes: used * 1024 * 1024, totalBytes: total * 1024 * 1024 } };
      return cached.value;
    }
  } catch { /* máy không có GPU — telemetry vắng, KHÔNG phải lỗi */ }

  cached = { at: Date.now(), value: null };
  return null;
}

export function __clearProbeCache(): void { cached = null; }
