import type {
  VramLease, VramMeasureSource, VramReserveRequest, VramReserveResult, VramSnapshot, VramPriority,
} from "./types";

/**
 * Trần thiết bị và dự trữ an toàn (spec §5.1). Đọc một lần, không I/O trên đường quyết định.
 *
 * ⚠ I-3 (review TOÀN NHÁNH) — BA NGUỒN, theo thứ tự ưu tiên, KHÔNG phải một hằng số:
 *   1. `VRAM_DEVICE_TOTAL_MB` — người vận hành ép tay. Luôn thắng (kể cả khi số đo có sẵn):
 *      một lệnh ép tay mà bị số đo ghi đè âm thầm là thứ không ai gỡ được lúc 3 giờ sáng.
 *   2. **SỐ ĐO THẬT của thiết bị** — `vramProbe.probeOnce()` đọc `totalBytes` ngay ở lượt đo
 *      đầu tiên và gọi `noteDeviceTotalBytes()` bên dưới.
 *   3. `32607` MiB — DỰ PHÒNG cuối cùng, và đó là dung lượng RTX 5090 của MỘT máy (máy phát
 *      triển). Bản trước để đúng con số này làm **mặc định toàn đội**: mọi máy khác — 4090
 *      24 GB, A2000 12 GB, laptop 8 GB — đều tính `headroom` theo trần của một card không
 *      phải của nó. Pha 1 chỉ méo dữ liệu bóng; **Pha 2 sẽ TỪ CHỐI/THU HỒI trên con số này**.
 */
const DEVICE_TOTAL_ENV_MB = Number(process.env.VRAM_DEVICE_TOTAL_MB);
const DEVICE_TOTAL_ENV_BYTES =
  Number.isFinite(DEVICE_TOTAL_ENV_MB) && DEVICE_TOTAL_ENV_MB > 0 ? DEVICE_TOTAL_ENV_MB * 1024 * 1024 : null;
const DEVICE_TOTAL_FALLBACK_BYTES = 32607 * 1024 * 1024;
let measuredDeviceTotalBytes: number | null = null;

/**
 * ⚠ `SAFETY_RESERVE` KHÔNG PHẢI là "nền desktop" — quan hệ giữa hai thứ này phải nói rõ, vì
 * đọc nhầm là tính thừa hoặc tính thiếu cả GiB (I-3):
 *
 *     headroom = trần_thiết_bị − SAFETY_RESERVE − Σ giấy_phép_trong_sổ
 *
 * `Σ giấy phép` chỉ gồm thứ CHÍNH TA xin. NỀN THIẾT BỊ (desktop compositor, trình duyệt, tiến
 * trình khác của máy — đo được **996–2.112 MiB** trên chính máy này, reviewer đo lúc review:
 * **2.112**) **KHÔNG NẰM TRONG SỔ**, và cũng KHÔNG bị trừ ở đây ⇒ `headroom` **lạc quan có hệ
 * thống** đúng bằng lượng nền đó. `SAFETY_RESERVE` mặc định 1.024 MiB là thứ DUY NHẤT đang
 * đứng thay chỗ nền, và nó NHỎ HƠN nền đo được.
 *
 * ⚠ CỐ Ý KHÔNG nâng mặc định lên 2.048: làm vậy chỉ là thay một hằng số của MỘT máy bằng một
 * hằng số khác của CÙNG máy đó — đúng cái sai mà I-3 đang bắt. `vramReconciler` đã ĐO được nền
 * thật (`captureVramBaseline()`); Pha 2 phải trừ SỐ ĐO ĐÓ khỏi `headroom` (báo cáo §10 mục 10),
 * lúc đó `SAFETY_RESERVE` mới quay về đúng vai trò của nó: biên an toàn cho phần phình LƯỜI mà
 * llama.cpp cấp phát ở lượt suy luận đầu, không phải chỗ đắp cho một phép đo còn thiếu.
 */
const SAFETY_RESERVE_BYTES = Number(process.env.VRAM_SAFETY_RESERVE_MB ?? 1024) * 1024 * 1024;

/**
 * Trần thiết bị đang dùng. ĐỒNG BỘ, không I/O — `reserve()` gọi được mà không phá lá chắn
 * cấu trúc "đường quyết định không chạm I/O" (xem docstring `reserve()`).
 */
export function deviceTotalBytes(): number {
  return DEVICE_TOTAL_ENV_BYTES ?? measuredDeviceTotalBytes ?? DEVICE_TOTAL_FALLBACK_BYTES;
}

/**
 * I-3 — ghi lại trần THẬT mà đầu dò vừa đọc được từ thiết bị. Gọi từ `vramProbe.probeOnce()`
 * (cả đường `llamaInstance.getVramState()` lẫn đường `nvidia-smi`), nên trần tự đúng trên MỌI
 * máy sau lượt đo đầu tiên mà không ai phải khai báo gì.
 *
 * KHÔNG BAO GIỜ ném; số vô lý bị bỏ qua (giữ nguyên giá trị cũ) thay vì ghi đè một trần sai.
 */
export function noteDeviceTotalBytes(total: number): void {
  if (Number.isFinite(total) && total > 0) measuredDeviceTotalBytes = total;
}

const PRIORITY_RANK: Record<VramPriority, number> = { production: 3, interactive: 2, background: 1 };

const ledger = new Map<string, VramLease>();
let seq = 0;

/**
 * Byte mà một giấy phép đang chiếm: số THẬT nếu đã commit, không thì ước lượng.
 * ⚠ EXPORT có chủ đích (review round 1, Task 4 — M-1): reconciler cần đúng công thức
 * này để dựng ảnh chụp sổ. Trước đây reconciler tự tính lại tại chỗ — hai bản cài đặt
 * song song của CÙNG một công thức là đúng lớp lỗi khiến `bench.mjs` từng sai bốn lần.
 * Một nguồn duy nhất, không cần test khoá hai công thức khớp nhau.
 */
export function leaseBytes(l: VramLease): number {
  return l.actualBytes ?? l.request.estimatedBytes;
}

function totalReserved(): number {
  let sum = 0;
  for (const l of ledger.values()) sum += leaseBytes(l);
  return sum;
}

/**
 * Xin chỗ. **Pha 1: KHÔNG BAO GIỜ từ chối** — luôn trả giấy phép.
 * `wouldRefuse`/`wouldPreempt` là phán quyết BÓNG của Pha 2, chỉ để ghi sổ.
 * ⚠ Hàm này KHÔNG được làm I/O: quyết định đọc sổ trong bộ nhớ.
 *
 * Bảo đảm CẤU TRÚC (mạnh hơn mọi test): hàm này ĐỒNG BỘ — trả thẳng `VramReserveResult`,
 * không phải `Promise`, và không `import` bất kỳ module I/O nào (fs/net/http/child_process).
 * Không `await` được gì bên trong một hàm không `async`. Test "reserve KHÔNG gọi đầu dò
 * thiết bị" chỉ canh MỘT trường hợp cụ thể (vramProbe); chính chữ ký đồng bộ này mới là
 * thứ chặn I/O nói chung. ⚠ Người sau: đừng đổi hàm này thành `async` mà không nhận ra
 * đang gỡ mất lá chắn cấu trúc đó.
 */
export function reserve(request: VramReserveRequest): VramReserveResult {
  const headroom = deviceTotalBytes() - SAFETY_RESERVE_BYTES - totalReserved();
  const wouldRefuse = request.estimatedBytes > headroom;

  const wouldPreempt: string[] = [];
  if (wouldRefuse) {
    // Chỉ nhường được: mức THẤP HƠN mức đang xin (so theo PRIORITY_RANK).
    // ⚠ KHÔNG lọc theo trạng thái commit — một giấy phép "chưa commit" (đang cấp phát dở,
    // actualBytes vẫn null) VẪN được liệt vào wouldPreempt nếu rank thấp hơn. Ở Pha 1 cửa sổ
    // đó chỉ vài mili-giây nên sai số dữ liệu bóng không đáng kể; KHÔNG tự thêm bộ lọc để
    // "sửa" — Pha 2 mới là nơi phải QUYẾT ĐỊNH TƯỜNG MINH có được thu hồi một giấy phép đang
    // cấp phát giữa chừng hay không (thu hồi lúc đó là chuyện nguy hiểm, không phải mặc định).
    const rank = PRIORITY_RANK[request.priority];
    const candidates = [...ledger.values()]
      .filter((l) => PRIORITY_RANK[l.request.priority] < rank)
      .sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime());
    let freed = 0;
    for (const c of candidates) {
      if (freed >= request.estimatedBytes - headroom) break;
      wouldPreempt.push(c.request.owner);
      freed += leaseBytes(c);
    }
  }

  const lease: VramLease = {
    id: `lease-${++seq}`,
    request,
    acquiredAt: new Date(),
    actualBytes: null,
    measureFailed: false,
    lastHeartbeatAt: new Date(),
    released: false,
  };
  ledger.set(lease.id, lease);
  return { lease, wouldRefuse, wouldPreempt };
}

/**
 * Ghi số THẬT sau khi cấp phát xong. Đây là nguồn của "harness tự sinh" (spec §7).
 *
 * Pha 2A Task 3 — `measureSource` khai THƯỚC nào đẻ ra con số này (types.ts `VramMeasureSource`).
 * ⚠ MẶC ĐỊNH `"device-delta"` CÓ CHỦ Ý, không phải cho tiện: mọi lời gọi CŨ (và mọi lời gọi
 * ngoài `vramWiring`) đo bằng `after − before` trên `used` TOÀN THIẾT BỊ. Mặc định `"unknown"`
 * hay `undefined` sẽ làm một con số device-delta trông như "không rõ nguồn" và mở đường cho
 * người sau đem nó so với một số của bộ đếm — đúng thứ Đ4 cấm. Ai đổi nguồn phải KHAI ra.
 */
export function commit(lease: VramLease, actualBytes: number, measureSource: VramMeasureSource = "device-delta"): void {
  const live = ledger.get(lease.id);
  if (!live || live.released) return;
  live.actualBytes = actualBytes;
  live.measureSource = measureSource;
  // Đo lại được sau một lượt hỏng thì cờ phải TẮT — nếu không "đo hỏng" thành vĩnh viễn ngay
  // cả khi số thật đã về, và câu chẩn đoán của reconciler lại chỉ sai hướng, chỉ theo chiều kia.
  live.measureFailed = false;
  live.lastHeartbeatAt = new Date();
}

/**
 * I-2 — phép đo đã CHẠY và cho kết quả VÔ NGHĨA (delta âm). Không ghi số hỏng vào sổ, nhưng
 * PHẢI ghi lại SỰ KIỆN rằng ước lượng của giấy phép này sẽ không bao giờ được xác minh.
 * Xem `VramLease.measureFailed` (types.ts) để biết vì sao không được gộp với `actualBytes===null`.
 */
export function markMeasureFailed(lease: VramLease): void {
  const live = ledger.get(lease.id);
  if (!live || live.released) return;
  live.measureFailed = true;
  // Pha 2A Task 3 — đo hỏng thì THƯỚC cũng phải nói "không có": để `measureSource` giữ giá trị
  // của một lượt commit trước sẽ khiến người đọc tưởng con số `null` này vừa được một thước nào
  // đó xác nhận.
  live.measureSource = "none";
  live.lastHeartbeatAt = new Date();
}

/**
 * Trả chỗ. **BẤT BIẾN khi gọi nhiều lần** — cờ `released` là thứ bảo đảm điều đó.
 * ⚠ Gỡ cờ này ra thì test "release HAI LẦN" phải ĐỎ. Nếu nó vẫn xanh, test là lưới giả.
 */
export function release(lease: VramLease): void {
  const live = ledger.get(lease.id);
  if (!live || live.released) return;
  live.released = true;
  ledger.delete(lease.id);
}

export function heartbeat(lease: VramLease): void {
  const live = ledger.get(lease.id);
  if (live && !live.released) live.lastHeartbeatAt = new Date();
}

export function snapshot(): VramSnapshot {
  return { totalReservedBytes: totalReserved(), leases: [...ledger.values()] };
}

/** Chỉ dùng trong test. */
export function __resetBrokerForTests(): void {
  ledger.clear();
  seq = 0;
  measuredDeviceTotalBytes = null;
}
