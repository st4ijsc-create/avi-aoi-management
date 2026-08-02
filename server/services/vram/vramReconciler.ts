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
  /** Nền thiết bị đã TRỪ khỏi phép so (null = chưa chụp / máy không GPU). */
  baselineUsedBytes: number | null;
}

let timer: NodeJS.Timeout | null = null;

/**
 * NỀN THIẾT BỊ — VRAM đã bị chiếm bởi thứ KHÔNG PHẢI tiến trình này, đo MỘT LẦN lúc khởi động.
 *
 * ⚠ VÌ SAO BẮT BUỘC (Task 5 review vòng 1, I-1): đo trên máy sạch, app KHÔNG chạy, GPU đã dùng
 * **1.090 MiB** — desktop compositor và tiến trình khác của máy. Không trừ nền thì với sổ rỗng
 * ta có `drift = +1090 > 512` ⇒ báo động "cấp phát KHÔNG XIN PHÉP" + một dòng ghi DB **mỗi 60
 * giây, mãi mãi, trên MỌI máy, ngay từ giây thứ nhất**. Giá trị DUY NHẤT của Pha 1 là báo động
 * này CÓ NGHĨA; một cái chuông kêu liên tục là cái chuông không ai nghe.
 *
 * ⚠ GIỚI HẠN ĐÃ BIẾT, CHẤP NHẬN Ở PHA 1 — PHẢI ĐỌC TRƯỚC KHI TIN CON SỐ NÀY:
 * nếu server khởi động lại **trong khi một tiến trình con vẫn đang sống** (điển hình: sidecar
 * thị giác 7,8 GB của Đợt 0), thì 7,8 GB đó bị **NUỐT VÀO NỀN** và ta sẽ **KHÔNG BAO GIỜ THẤY
 * NÓ** — đúng cái mà module này sinh ra để bắt. Đây là ca "giấy phép mồ côi" mà spec §6 giao
 * cho **Pha 3 (nhận nuôi)**: Pha 3 phải liệt kê tiến trình đang giữ VRAM rồi NHẬN NUÔI chúng
 * vào sổ thay vì gộp mù vào nền. Pha 1 chấp nhận đánh đổi này một cách TƯỜNG MINH — thà bỏ sót
 * một ca hiếm còn hơn hỏng cái chuông trong mọi ca thường.
 *
 * Sự kiện `baseline` được GHI VÀO NHẬT KÝ kèm giá trị: đã trừ bao nhiêu thì Task 7 và người
 * trực phải đọc được. KHÔNG trừ âm thầm — một phép trừ vô hình chỉ là một giả định vô hình khác.
 */
let baselineUsedBytes: number | null = null;
let baselineCaptured = false;

/**
 * Chụp nền MỘT LẦN. Gọi lần thứ hai là no-op — nếu không, một lượt `stop()` rồi `start()` lại
 * sẽ NUỐT mọi thứ đã nạp từ đầu tới giờ vào nền và làm mù luôn sổ.
 * KHÔNG BAO GIỜ ném: máy không GPU ⇒ trả `null`, hệ chạy tiếp im lặng.
 */
export async function captureVramBaseline(): Promise<number | null> {
  if (baselineCaptured) return baselineUsedBytes;
  baselineCaptured = true;
  try {
    const device = await readDeviceVram();
    baselineUsedBytes = device ? device.usedBytes : null;
  } catch {
    baselineUsedBytes = null;
  }
  if (baselineUsedBytes !== null) {
    console.log(
      `[vram] nền thiết bị lúc khởi động: ${Math.round(baselineUsedBytes / 1024 / 1024)} MiB ` +
        `(không phải của tiến trình này) — sẽ TRỪ khỏi mọi phép so sổ.`,
    );
    logVramEvent({
      event: "baseline",
      owner: "reconciler",
      leaseKind: "external-process",
      priority: "background",
      deviceUsedBytes: baselineUsedBytes,
      detail: {
        baselineUsedBytes,
        note:
          "VRAM đã bị chiếm TRƯỚC khi tiến trình này cấp phát gì. Mọi drift sau đây đã trừ số này. " +
          "⚠ Nếu server restart khi sidecar còn sống, VRAM của sidecar bị nuốt vào đây (spec §6 — Pha 3 nhận nuôi).",
      },
    });
  }
  return baselineUsedBytes;
}

/** Chỉ dùng trong test. */
export function __resetVramBaselineForTests(): void {
  baselineUsedBytes = null;
  baselineCaptured = false;
}

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
    return {
      driftBytes: null,
      alarm: false,
      ledgerTotalBytes: snap.totalReservedBytes,
      deviceUsedBytes: null,
      baselineUsedBytes,
    };
  }

  // I-1 — TRỪ NỀN. `attributable` = phần VRAM QUY ĐƯỢC cho tiến trình này; chỉ phần đó mới có
  // quyền được đem so với sổ. Chưa chụp nền (gọi reconcileOnce() trực tiếp, vd. Task 7 hoặc
  // test) ⇒ nền = 0 ⇒ hành vi y như trước, không có phép trừ ẩn nào.
  const baseline = baselineUsedBytes ?? 0;
  const attributable = device.usedBytes - baseline;
  const drift = attributable - snap.totalReservedBytes;
  const alarm = Math.abs(drift) > DRIFT_THRESHOLD_BYTES;

  if (alarm) {
    const mib = (b: number) => Math.round(b / 1024 / 1024);
    const holders = () => snap.leases.map((l) => `${l.request.owner}=${mib(leaseBytes(l))}`).join(", ") || "(sổ rỗng)";
    // Luôn nói rõ đã trừ bao nhiêu — người trực phải kiểm chứng được con số, không phải tin.
    const baseNote = baseline > 0 ? ` (đã trừ nền ${mib(baseline)} MiB)` : "";

    if (drift > 0) {
      console.warn(
        `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}, thiết bị ${mib(attributable)}${baseNote}. ` +
          `Có hộ tiêu thụ cấp phát KHÔNG XIN PHÉP (sidecar? tiến trình con? thư viện khác?). ` +
          `Đang giữ: ${holders()}`,
      );
    } else {
      const pending = snap.leases.filter((l) => l.actualBytes === null).map((l) => l.request.owner);
      console.warn(
        `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}, thiết bị ${mib(attributable)}${baseNote}. ` +
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
        // I-1 — ghi CẢ số thô lẫn nền, để đọc lại nhật ký là dựng lại được phép tính, không
        // phải tin một con số đã bị trừ ở đâu đó.
        deviceUsedRawBytes: device.usedBytes,
        baselineUsedBytes: baseline,
        attributableBytes: attributable,
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

  return {
    driftBytes: drift,
    alarm,
    ledgerTotalBytes: snap.totalReservedBytes,
    deviceUsedBytes: device.usedBytes,
    baselineUsedBytes,
  };
}

export function startVramReconciler(): void {
  if (timer) return;
  // I-1 — chụp nền NGAY, trước lượt đối chiếu đầu tiên. Không `await` (hàm này đồng bộ và
  // được gọi trên đường boot); lượt reconcile đầu chỉ chạy sau INTERVAL_MS nên nền chắc chắn
  // đã có. Nếu nó lỡ chưa kịp, nền = 0 ⇒ chỉ mất một lượt, tự đúng ở lượt sau.
  void captureVramBaseline();
  timer = setInterval(() => { void reconcileOnce(); }, INTERVAL_MS);
  timer.unref?.();
}

export function stopVramReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function __hasReconcilerTimer(): boolean { return timer !== null; }
