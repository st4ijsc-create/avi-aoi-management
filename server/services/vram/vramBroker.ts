import type {
  VramLease, VramReserveRequest, VramReserveResult, VramSnapshot, VramPriority,
} from "./types";

/** Trần thiết bị và dự trữ an toàn (spec §5.1). Đọc một lần, không I/O trên đường quyết định. */
const DEVICE_TOTAL_BYTES = Number(process.env.VRAM_DEVICE_TOTAL_MB ?? 32607) * 1024 * 1024;
const SAFETY_RESERVE_BYTES = Number(process.env.VRAM_SAFETY_RESERVE_MB ?? 1024) * 1024 * 1024;

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
  const headroom = DEVICE_TOTAL_BYTES - SAFETY_RESERVE_BYTES - totalReserved();
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
    lastHeartbeatAt: new Date(),
    released: false,
  };
  ledger.set(lease.id, lease);
  return { lease, wouldRefuse, wouldPreempt };
}

/** Ghi số THẬT sau khi cấp phát xong. Đây là nguồn của "harness tự sinh" (spec §7). */
export function commit(lease: VramLease, actualBytes: number): void {
  const live = ledger.get(lease.id);
  if (!live || live.released) return;
  live.actualBytes = actualBytes;
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
}
