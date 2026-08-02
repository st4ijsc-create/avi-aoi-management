import { snapshot, leaseBytes } from "./vramBroker";
import { readDeviceVram } from "./vramProbe";
import { logVramEvent } from "./vramEventLog";

const DRIFT_THRESHOLD_BYTES = Number(process.env.VRAM_DRIFT_THRESHOLD_MB ?? 512) * 1024 * 1024;
const INTERVAL_MS = Number(process.env.VRAM_RECONCILE_INTERVAL_MS ?? 60_000);

export interface VramReconcileResult {
  driftBytes: number | null;
  alarm: boolean;
  ledgerTotalBytes: number;
  deviceUsedBytes: number | null;
}

let timer: NodeJS.Timeout | null = null;

/**
 * So sổ với thiết bị. Lệch quá ngưỡng ⇒ có sự cố cần điều tra:
 * - Lệch DƯƠNG (thiết bị > sổ): có hộ tiêu thụ cấp phát KHÔNG XIN PHÉP.
 * - Lệch ÂM (sổ > thiết bị): giấy phép TREO (tiến trình chết) hoặc commit() ghi số SAI —
 *   KHÔNG phải cấp phát chui. Xem I-2 (review round 1) — câu cảnh báo phải chẩn đoán đúng
 *   hướng, không được gắn cố định một nguyên nhân cho cả hai dấu.
 *
 * Đây là phần giá trị nhất của Pha 1: sidecar 7,8 GB (Đợt 0), ONNX +339 và
 * cron +1.251 (Đợt 2) — cả ba từng cần một lượt review TOÀN NHÁNH mới lộ ra.
 * Với hàm này chúng lộ trong vài phút.
 */
export async function reconcileOnce(): Promise<VramReconcileResult> {
  const snap = snapshot();
  // ⚠ M-2 (review round 1): lấy mẫu KHÔNG NGUYÊN TỬ. `snapshot()` tức thời, còn
  // `readDeviceVram()` mất tới ~3 s (vramProbe.ts). `reserve()` đồng bộ cộng
  // `estimatedBytes` vào sổ TRƯỚC KHI VRAM vật lý kịp tăng ⇒ một lượt reconcile rơi
  // đúng giữa cửa sổ nạp model lớn có thể thấy lệch ÂM THOÁNG QUA (tự lành ở lượt kế
  // 60 s sau). Đây là TÍNH CHẤT THIẾT KẾ CỐ HỮU, không phải bug — Task 7 và người trực
  // đọc một `drift` âm gần thời điểm nạp model lớn nên nghi bóng ma trước, không phải
  // sự cố thật.
  const device = await readDeviceVram();

  // Đầu dò hỏng hoặc máy không GPU ⇒ IM LẶNG bỏ qua.
  // KHÔNG được biến máy không-GPU thành máy báo động liên tục (spec §11).
  if (!device) {
    return { driftBytes: null, alarm: false, ledgerTotalBytes: snap.totalReservedBytes, deviceUsedBytes: null };
  }

  const drift = device.usedBytes - snap.totalReservedBytes;
  const alarm = Math.abs(drift) > DRIFT_THRESHOLD_BYTES;

  if (alarm) {
    const mib = (b: number) => Math.round(b / 1024 / 1024);
    const holders = () => snap.leases.map((l) => `${l.request.owner}=${mib(leaseBytes(l))}`).join(", ") || "(sổ rỗng)";

    if (drift > 0) {
      console.warn(
        `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}, thiết bị ${mib(device.usedBytes)}. ` +
          `Có hộ tiêu thụ cấp phát KHÔNG XIN PHÉP (sidecar? tiến trình con? thư viện khác?). ` +
          `Đang giữ: ${holders()}`,
      );
    } else {
      const pending = snap.leases.filter((l) => l.actualBytes === null).map((l) => l.request.owner);
      console.warn(
        `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}, thiết bị ${mib(device.usedBytes)}. ` +
          `Sổ đang giữ NHIỀU HƠN thực tế — giấy phép treo hoặc số commit sai, KHÔNG PHẢI cấp phát chui. ` +
          `Ứng viên số một (chưa commit): ${pending.join(", ") || "(không có)"}. Đang giữ: ${holders()}`,
      );
    }
    logVramEvent({
      event: "drift",
      owner: "reconciler",
      leaseKind: "external-process",
      priority: "background",
      deviceUsedBytes: device.usedBytes,
      ledgerTotalBytes: snap.totalReservedBytes,
      driftBytes: drift,
      // Ảnh chụp TOÀN BỘ sổ lúc lệch — đây là dữ liệu Ư7 cần.
      detail: {
        leases: snap.leases.map((l) => ({
          owner: l.request.owner,
          kind: l.request.kind,
          priority: l.request.priority,
          bytes: leaseBytes(l),
          committed: l.actualBytes !== null,
        })),
      },
    });
  }

  return { driftBytes: drift, alarm, ledgerTotalBytes: snap.totalReservedBytes, deviceUsedBytes: device.usedBytes };
}

export function startVramReconciler(): void {
  if (timer) return;
  timer = setInterval(() => { void reconcileOnce(); }, INTERVAL_MS);
  timer.unref?.();
}

export function stopVramReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function __hasReconcilerTimer(): boolean { return timer !== null; }
