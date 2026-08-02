import { getLlamaInstanceIfReady } from "./llamaHandle";

const CACHE_MS = Number(process.env.VRAM_PROBE_CACHE_MS ?? 5000);
let cached: { at: number; value: { usedBytes: number; totalBytes: number } | null } | null = null;

/**
 * Sự thật thiết bị, CÓ ĐỆM — dùng cho đối chiếu NỀN (`vramReconciler`, mỗi 60 s).
 *
 * ⚠ BẢN TRƯỚC CỦA DOCSTRING NÀY VIẾT SAI VÀ ĐÃ BỊ CHÍNH MÃ VI PHẠM (Task 5 review vòng 1, I-3).
 * Nó viết "CHỈ gọi từ reconciler NỀN — KHÔNG BAO GIỜ từ đường cấp phát" và "mất tới ~3 s".
 * Sự thật đo được:
 *   • `~3 s` là **trần `timeout: 3000`** của `execFile` bên dưới, KHÔNG phải chi phí thường.
 *     Đo 5 lượt trên máy này: **72 / 80 / 74 / 75 / 78 ms**.
 *   • Vụ "đóng băng toàn bộ xử lý request" trong lịch sử là do bản **ĐỒNG BỘ** (`execFileSync`),
 *     đã bỏ từ lâu — không phải do bản bất đồng bộ này.
 *   • Khi `setLlamaInstanceHandle()` đã nối (aiGgufEngine.getLlama), đường đi là
 *     `llamaInstance.getVramState()` **native, ~0 ms** — `nvidia-smi` chỉ là lối lùi.
 *
 * HAI ĐƯỜNG GỌI HỢP LỆ, cả hai đều có chủ đích:
 *   1. **Reconciler nền** (`vramReconciler.reconcileOnce`) — dùng `readDeviceVram()` CÓ ĐỆM.
 *   2. **Đo delta lúc cấp phát** (`vramWiring.beginVramAllocation`) — dùng
 *      `readDeviceVramUncached()`, hai lượt/một lần cấp phát (~150 ms tổng, chỉ ở lượt cấp
 *      phát THẬT; model/session đều được cache nên không phải mỗi request).
 *
 * ⚠ Để nguyên một điều cấm mà chính mã vi phạm là mìn cho người sau. Nếu ai đó lại thấy hàm
 * này quá đắt cho một đường gọi mới, hãy ĐO rồi sửa docstring — đừng viết một điều cấm mới.
 */
export async function readDeviceVram(): Promise<{ usedBytes: number; totalBytes: number } | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const fresh = await probeOnce();
  cached = { at: Date.now(), value: fresh };
  return fresh;
}

/**
 * Đọc TƯƠI, KHÔNG đọc đệm và KHÔNG ghi đệm.
 *
 * ⚠ VÌ SAO PHẢI TÁCH RA (I-3, lỗi thật reviewer chỉ ra): bản đầu của `vramWiring` gọi
 * `__clearProbeCache()` rồi `readDeviceVram()` để ép đọc tươi — nhưng `__clearProbeCache()`
 * **xoá luôn đệm mà reconciler nền dùng chung**, tức là đường cấp phát tự tiện vô hiệu hoá lớp
 * bảo vệ của một người dùng khác. Hàm này giải quyết tận gốc: đường cấp phát có số tươi mà
 * KHÔNG đụng vào trạng thái dùng chung, và `__clearProbeCache()` quay về đúng vai trò của nó —
 * một tiện ích CHỈ DÀNH CHO TEST.
 */
export async function readDeviceVramUncached(): Promise<{ usedBytes: number; totalBytes: number } | null> {
  return probeOnce();
}

/**
 * I-3 (review TOÀN NHÁNH) — báo trần THẬT vừa đọc được cho sổ cái.
 *
 * ⚠ Bản trước `probeOnce()` đọc `totalBytes` ở đúng dòng dưới rồi **VỨT ĐI**, trong khi
 * `vramBroker` tính `headroom` bằng một HẰNG SỐ = dung lượng RTX 5090 của MỘT máy. Số đo thật
 * nằm ngay trong tay mà không ai dùng. Ghi ngược lên broker ở đây (chứ không để broker tự đọc)
 * giữ nguyên lá chắn cấu trúc: `reserve()` vẫn ĐỒNG BỘ và không chạm I/O.
 *
 * KHÔNG BAO GIỜ ném — đầu dò là telemetry, không được làm hỏng đường gọi.
 */
async function noteTotal(totalBytes: number): Promise<void> {
  try {
    const { noteDeviceTotalBytes } = await import("./vramBroker");
    noteDeviceTotalBytes(totalBytes);
  } catch {
    /* sổ cái hỏng ⇒ giữ trần dự phòng, không làm hỏng lượt đo */
  }
}

/** Một lượt đọc thiết bị, không dính gì tới đệm. NEVER throws. */
async function probeOnce(): Promise<{ usedBytes: number; totalBytes: number } | null> {
  const llama = getLlamaInstanceIfReady();
  if (llama && typeof llama.getVramState === "function") {
    try {
      const v = await llama.getVramState();
      if (v && v.total > 0) {
        await noteTotal(v.total);
        return { usedBytes: v.used, totalBytes: v.total };
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
      await noteTotal(total * 1024 * 1024);
      return { usedBytes: used * 1024 * 1024, totalBytes: total * 1024 * 1024 };
    }
  } catch { /* máy không có GPU — telemetry vắng, KHÔNG phải lỗi */ }

  return null;
}

/**
 * CHỈ DÙNG TRONG TEST. ⚠ Đường cấp phát KHÔNG được gọi hàm này — nó xoá đệm DÙNG CHUNG với
 * reconciler nền. Cần số tươi thì gọi `readDeviceVramUncached()` (xem I-3 ở docstring trên).
 */
export function __clearProbeCache(): void { cached = null; }
