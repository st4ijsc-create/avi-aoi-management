import { snapshot } from "./vramBroker";
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
 * So sổ với thiết bị. Lệch quá ngưỡng ⇒ có kẻ cấp phát KHÔNG XIN PHÉP.
 *
 * Đây là phần giá trị nhất của Pha 1: sidecar 7,8 GB (Đợt 0), ONNX +339 và
 * cron +1.251 (Đợt 2) — cả ba từng cần một lượt review TOÀN NHÁNH mới lộ ra.
 * Với hàm này chúng lộ trong vài phút.
 */
export async function reconcileOnce(): Promise<VramReconcileResult> {
  const snap = snapshot();
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
    console.warn(
      `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}, thiết bị ${mib(device.usedBytes)}. ` +
        `Có hộ tiêu thụ cấp phát KHÔNG XIN PHÉP. Đang giữ: ` +
        (snap.leases.map((l) => `${l.request.owner}=${mib(l.actualBytes ?? l.request.estimatedBytes)}`).join(", ") || "(sổ rỗng)"),
    );
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
          bytes: l.actualBytes ?? l.request.estimatedBytes,
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
