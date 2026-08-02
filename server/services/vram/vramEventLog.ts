import type { VramEstimateSource, VramLeaseKind, VramPriority } from "./types";

/**
 * Nhật ký chỉ-ghi-thêm cho module điều phối VRAM (Pha 1 Task 2).
 * Sổ cái SỐNG nằm trong bộ nhớ (vramBroker.ts, Task 1) — module này chỉ GHI
 * LỊCH SỬ, không đọc lại, không quyết định gì. Nằm CẠNH đường cấp phát nên
 * `logVramEvent()` không bao giờ được chờ DB (xem test "KHÔNG chờ DB").
 */
export interface VramEventInput {
  /**
   * baseline | reserve | commit | measure_failed | release | refuse | preempt | drift | adopt |
   * defer | defer_exceeded
   *
   * ⚠ `baseline` (Task 5 review vòng 2, NEW-4) = ảnh chụp NỀN THIẾT BỊ lúc khởi động
   * (`nền = thiết bị − sổ`, xem `vramReconciler.captureVramBaseline`). Ai đọc nhật ký theo danh
   * sách này mà thiếu `baseline` sẽ đọc `drift` mà không biết nó đã được trừ đi bao nhiêu.
   *
   * ⚠ `measure_failed` (review TOÀN NHÁNH, I-2) = delta đo được ÂM ⇒ phép đo vô nghĩa ⇒ giấy
   * phép giữ ƯỚC LƯỢNG **vĩnh viễn**. Trước lượt vá này nhánh đó `return` IM LẶNG tuyệt đối —
   * không sự kiện, không dấu vết — nên một nguồn lệch ÂM dai dẳng là VÔ HÌNH với Task 7.
   */
  event: string;
  owner: string;
  leaseKind: VramLeaseKind;
  priority: VramPriority;
  estimatedBytes?: number;
  actualBytes?: number;
  estimateSource?: VramEstimateSource;
  deviceUsedBytes?: number;
  ledgerTotalBytes?: number;
  driftBytes?: number;
  /** Pha 1: phán quyết BÓNG của Pha 2 (reserve() không bao giờ từ chối ở pha này). */
  wouldRefuse?: boolean;
  detail?: Record<string, unknown>;
}

const FLUSH_MS = Number(process.env.VRAM_LOG_FLUSH_MS ?? 5000);
// Thà mất telemetry còn hơn phình bộ nhớ khi DB gián đoạn kéo dài.
const QUEUE_MAX = Number(process.env.VRAM_LOG_QUEUE_MAX ?? 5000);

let queue: VramEventInput[] = [];
let timer: NodeJS.Timeout | null = null;

/**
 * Xếp hàng rồi trả về NGAY — KHÔNG BAO GIỜ chờ DB. Hàm này nằm cạnh đường
 * cấp phát (reserve/commit/release của vramBroker); có test canh bằng mock
 * `insert` và assert chưa được gọi khi hàm này return.
 */
export function logVramEvent(e: VramEventInput): void {
  if (queue.length >= QUEUE_MAX) return;
  queue.push(e);
}

/** Ghi hết hàng đợi hiện tại thành MỘT lô (không phải một lượt insert mỗi sự kiện), rồi dọn. */
export async function flushVramEvents(): Promise<number> {
  if (queue.length === 0) return 0;
  const batch = queue;
  queue = [];
  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (!db) return 0; // không có DB (vd. test không cấu hình) → bỏ âm thầm
    const { vramEvents } = await import("../../../drizzle/schema/vram");
    await db.insert(vramEvents).values(
      batch.map((e) => ({
        event: e.event,
        owner: e.owner,
        leaseKind: e.leaseKind,
        priority: e.priority,
        estimatedBytes: e.estimatedBytes ?? null,
        actualBytes: e.actualBytes ?? null,
        estimateSource: e.estimateSource ?? null,
        deviceUsedBytes: e.deviceUsedBytes ?? null,
        ledgerTotalBytes: e.ledgerTotalBytes ?? null,
        driftBytes: e.driftBytes ?? null,
        wouldRefuse: e.wouldRefuse === undefined ? null : String(e.wouldRefuse),
        detail: e.detail ?? null,
      })),
    );
    return batch.length;
  } catch (err) {
    // Telemetry không bao giờ được làm ngã người gọi. Mất lô, đi tiếp.
    console.warn(`[vram] không ghi được ${batch.length} sự kiện: ${(err as Error)?.message ?? err}`);
    return 0;
  }
}

/**
 * ⚠ BÀI HỌC Đợt trước: `setInterval` unref'd của `aiGateway` RÒ vào bộ test,
 * tự bắn, tự kết nối và TỰ GHI VÀO DB TEST (đo được bằng probe: gọi hàm ghi,
 * không flush tay, chờ vài giây ⇒ một dòng THẬT xuất hiện). Bộ đếm giờ ở đây
 * phải TẮT ĐƯỢC tường minh và thật sự huỷ interval — không chỉ đặt cờ.
 */
export function __setVramLogTimerEnabled(on: boolean): void {
  if (on && !timer) {
    timer = setInterval(() => {
      void flushVramEvents();
    }, FLUSH_MS);
    timer.unref?.();
  } else if (!on && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Có timer nào đang sống không — test canh trực tiếp, không suy đoán qua tác dụng phụ. */
export function __hasVramLogTimer(): boolean {
  return timer !== null;
}
