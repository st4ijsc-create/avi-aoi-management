import type { VramLease, VramLeaseKind, VramPriority } from "./types";

/**
 * Pha 1 Task 5 — DÂY NỐI dùng chung cho BẢY hộ tiêu thụ VRAM trong tiến trình.
 * (Sáu theo brief + hộ thứ BẢY `aiImageEmbedding` do review vòng 1 I-2 phát hiện.)
 *
 * VÌ SAO MỘT MODULE RIÊNG (brief chỉ liệt kê 4 file sản xuất): bảy điểm cấp phát nằm ở năm
 * file, trong đó `aiGgufEngine.ts` dài 2.712 dòng và phục vụ MỌI lượt suy luận. Dán inline
 * ~35 dòng telemetry vào mỗi điểm là ~245 dòng lặp lại trong đường cấp phát nóng nhất của hệ —
 * và Task 5 phải CHỨNG MINH bằng diff rằng nó không đổi hành vi. Gom vào đây giữ diff ở mỗi
 * điểm còn 3-4 dòng (đọc được trong một màn hình), và quan trọng hơn: kỷ luật "telemetry KHÔNG
 * BAO GIỜ được ném" chỉ phải đúng ở MỘT chỗ thay vì sáu.
 *
 * BA LỜI GỌI QUANH MỖI ĐIỂM CẤP PHÁT:
 *   1. `beginVramAllocation()` — ước lượng (async) → `reserve()` (ĐỒNG BỘ) → ghi nhật ký
 *      → đo VRAM thiết bị NGAY TRƯỚC lượt cấp phát.
 *   2. `ticket.commitMeasured()` — đo lại NGAY SAU, `commit()` số THẬT + `recordActual()`.
 *   3. `ticket.release()` — khi hộ tiêu thụ nhả tài nguyên (unload/evict/dispose).
 *
 * ⚠ KHÔNG ĐỔI MỘT HÀNH VI NÀO. `enforceVramGuard()`/`ensureCapacity()`/`evictLRU()` của
 * `aiGgufEngine.ts` vẫn chạy y nguyên; module này chỉ QUAN SÁT và ghi sổ.
 *
 * ⚠ MỌI thứ ở đây nuốt lỗi. Pha 1 tuyệt đối không được làm hỏng đường cấp phát đang chạy tốt:
 * telemetry chết thì hệ vẫn phải nạp được model. Đó là lý do `beginVramAllocation()` trả về
 * `NOOP_TICKET` thay vì ném khi bất cứ khâu nào hỏng.
 */
export interface VramTicket {
  /**
   * Ghi số THẬT = VRAM thiết bị SAU trừ TRƯỚC. KHÔNG BAO GIỜ ném.
   * Gọi NGAY SAU khi lượt cấp phát hoàn tất (đã có trọng số + context).
   */
  commitMeasured(): Promise<void>;
  /** Trả chỗ trong sổ. KHÔNG BAO GIỜ ném. Gọi nhiều lần là vô hại. */
  release(): void;
}

/** Giấy phép "rỗng" khi telemetry hỏng — mọi lời gọi đều là no-op. */
const NOOP_TICKET: VramTicket = {
  commitMeasured: async () => {},
  release: () => {},
};

export interface VramAllocationOptions {
  owner: string;
  kind: VramLeaseKind;
  priority: VramPriority;
  /** Đường dẫn file trọng số — helper tự `statSync` trong try/catch để lấy nấc "file-size". */
  filePath?: string;
  /** Đã biết sẵn kích thước thì truyền thẳng (ưu tiên hơn `filePath`). */
  fileBytes?: number;
  /** ⚠ Nấc "config-default" — hằng số. Chỉ truyền khi THẬT SỰ có hằng số cấu hình. */
  configDefaultBytes?: number;
  /**
   * Pha 1 Task 6 — bắt buộc CHỈ cho hộ NGOÀI tiến trình (`kind: "external-process"`): không có
   * nhịp commit/heartbeat tự nhiên như một lượt cấp phát trong tiến trình, nên reconciler cần
   * biết TRẦN thời lượng hợp lệ của giấy phép để phát hiện tiến trình con đã chết mà không ai
   * trả chỗ (types.ts `VramReserveRequest.ttlMs` — "thiếu nhịp quá hạn thì reconciler xác minh
   * rồi thu hồi", cơ chế đó là việc của Pha 2/3, CHƯA cài ở Pha 1). Bảy hộ TRONG tiến trình của
   * Task 5 không truyền trường này — mặc định `undefined`, hành vi bảy hộ đó không đổi.
   */
  ttlMs?: number;
}

export async function beginVramAllocation(opts: VramAllocationOptions): Promise<VramTicket> {
  try {
    const broker = await import("./vramBroker");
    const estimator = await import("./vramEstimator");
    const { logVramEvent } = await import("./vramEventLog");
    const probe = await import("./vramProbe");

    let fileBytes = opts.fileBytes;
    if (fileBytes === undefined && opts.filePath) {
      try {
        const fs = await import("node:fs");
        fileBytes = fs.statSync(opts.filePath).size;
      } catch {
        /* không đọc được kích thước — tụt xuống nấc ước lượng thấp hơn, không phải lỗi */
      }
    }

    // ⚠ `estimateBytesFor()` là ASYNC; `await` nó XONG Ở ĐÂY rồi mới truyền số vào `reserve()`.
    // `reserve()` ĐỒNG BỘ và TUYỆT ĐỐI không được `await` gì bên trong — chữ ký đồng bộ đó
    // chính là lá chắn cấu trúc giữ đường quyết định sạch I/O (vramBroker.ts:36-42).
    const est = await estimator.estimateBytesFor(opts.owner, {
      fileBytes,
      configDefaultBytes: opts.configDefaultBytes,
    });

    const res = broker.reserve({
      owner: opts.owner,
      kind: opts.kind,
      estimatedBytes: est.bytes,
      priority: opts.priority,
      estimateSource: est.source,
      ttlMs: opts.ttlMs,
    });

    logVramEvent({
      event: "reserve",
      owner: opts.owner,
      leaseKind: opts.kind,
      priority: opts.priority,
      estimatedBytes: est.bytes,
      estimateSource: est.source,
      wouldRefuse: res.wouldRefuse,
      detail: { wouldPreempt: res.wouldPreempt },
    });

    const lease: VramLease | null = res.lease;
    // Pha 1 KHÔNG BAO GIỜ từ chối (vramBroker.ts:32) — nhánh này dành cho Pha 2.
    if (!lease) return NOOP_TICKET;

    // Đo NGAY TRƯỚC lượt cấp phát. Đặt sau `reserve()` để phép đo sát lượt cấp phát nhất.
    //
    // ⚠ `readDeviceVramUncached()` chứ KHÔNG phải `__clearProbeCache()` + `readDeviceVram()`
    // (I-3, review vòng 1): bản trước xoá đệm DÙNG CHUNG với reconciler nền — đường cấp phát
    // tự tiện vô hiệu hoá lớp bảo vệ của người dùng khác. Bản uncached cho số tươi mà không
    // đụng vào trạng thái dùng chung.
    //
    // Chi phí: `llamaInstance.getVramState()` (native, ~0 ms) khi đã nối `setLlamaInstanceHandle()`;
    // chỉ khi CHƯA nối mới lùi về `nvidia-smi` — đo 5 lượt trên máy này: 72/80/74/75/78 ms.
    // Mỗi hộ tiêu thụ chỉ trả chi phí này ở lượt cấp phát THẬT (session/model đều được cache),
    // không phải mỗi request.
    let beforeUsed: number | null = null;
    try {
      beforeUsed = (await probe.readDeviceVramUncached())?.usedBytes ?? null;
    } catch {
      /* không đo được thiết bị ⇒ bỏ qua phần commit, giấy phép vẫn giữ ước lượng */
    }

    let released = false;
    return {
      async commitMeasured() {
        try {
          if (released || beforeUsed === null) return;
          const after = await probe.readDeviceVramUncached();
          if (!after) return;

          const actual = after.usedBytes - beforeUsed;
          // ⚠ Delta ÂM = phép đo bị nhiễu (một hộ khác vừa nhả chỗ giữa hai lượt đo, hoặc
          // đường OOM-retry vừa `evictLRU()` xong). Ghi số âm vào sổ còn tệ hơn không ghi.
          // Delta BẰNG 0 thì NGƯỢC LẠI: đó là số liệu THẬT và phải được ghi — hộ tiêu thụ
          // chạy CPU (vd. reranker khi RAG_RERANKER_GPU=false) đúng là chiếm 0 byte VRAM.
          // Không ghi 0 thì giấy phép giữ nguyên ước lượng theo kích thước FILE và sổ phình
          // lên hàng trăm MiB ảo ⇒ reconciler báo lệch ÂM giả. `recordActual()` (vramEstimator
          // .ts:7-11) và `leaseBytes()` (vramBroker.ts:21, dùng `??` chứ không `||`) đều đã
          // cố ý coi 0 là số liệu hợp lệ — đây là nơi khai thác điều đó.
          if (actual < 0) return;

          broker.commit(lease, actual);
          estimator.recordActual(opts.owner, actual);
          logVramEvent({
            event: "commit",
            owner: opts.owner,
            leaseKind: opts.kind,
            priority: opts.priority,
            estimatedBytes: est.bytes,
            actualBytes: actual,
            estimateSource: est.source,
            deviceUsedBytes: after.usedBytes,
          });
        } catch {
          /* telemetry hỏng KHÔNG được làm hỏng lượt cấp phát */
        }
      },
      release() {
        try {
          if (released) return;
          released = true;
          broker.release(lease);
          logVramEvent({
            event: "release",
            owner: opts.owner,
            leaseKind: opts.kind,
            priority: opts.priority,
            estimatedBytes: est.bytes,
            actualBytes: lease.actualBytes ?? undefined,
            estimateSource: est.source,
          });
        } catch {
          /* telemetry hỏng KHÔNG được làm hỏng lượt nhả tài nguyên */
        }
      },
    };
  } catch {
    // Sổ cái/nhật ký/đầu dò hỏng ở BẤT KỲ khâu nào ⇒ hệ chạy như chưa từng có module này.
    return NOOP_TICKET;
  }
}
