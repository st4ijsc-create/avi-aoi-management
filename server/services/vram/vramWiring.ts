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
/**
 * ★ KỶ LUẬT DUY NHẤT VỀ THỨ TỰ NHẢ (review TOÀN NHÁNH, I-1) — đọc trước khi thêm bất kỳ điểm
 * `release()` mới nào.
 *
 *   > **Sổ chỉ được nhả SAU khi thiết bị đã nhả. Nơi nào KHÔNG CHỨNG MINH ĐƯỢC thiết bị đã nhả,
 *   > phải NÓI RA bằng `releaseProof`, không được im lặng nhả sổ như thể đã có bằng chứng.**
 *
 * Vì sao phải viết thành kỷ luật thay vì để mỗi chỗ tự quyết: reviewer tìm thấy hai task đi HAI
 * HƯỚNG NGƯỢC NHAU với hai comment CÙNG TỰ TIN (`aiGgufEngine.ts:987` nhả SAU dispose và ghi rõ
 * lý do; `llamaVisionSidecar.ts:393` nhả TRƯỚC kill và cũng ghi rõ lý do). Một kỷ luật chỉ tồn
 * tại trong comment thì lần sau lại có comment thứ ba.
 *
 * BỐN ĐIỂM NHẢ TRONG TOÀN REPO, sau lượt vá này:
 *
 * | # | Điểm | Bằng chứng thiết bị đã nhả | `releaseProof` |
 * |---|---|---|---|
 * | 1 | `aiGgufEngine.unloadGgufModel` (`:987`) | `await context.dispose()` + `await model.dispose()` XONG rồi mới nhả sổ | `device-disposed` |
 * | 2 | `llamaVisionSidecar` `proc.on("exit"/"error")` | tiến trình con đã CHẾT — VRAM của nó do OS thu hồi | `process-exit` |
 * | 3 | `aiInferenceEngine.LruSessionCache.set/delete` (đuổi LRU) | **KHÔNG CÓ** | `unverified` |
 * | 4 | `aiImageEmbedding.evictEmbeddingSessionCache` | **KHÔNG CÓ** | `unverified` |
 *
 * ⚠ VÌ SAO #3/#4 KHÔNG SỬA ĐƯỢC Ở PHA 1 (và vì sao đánh dấu là câu trả lời ĐÚNG, không phải né):
 * reviewer grep toàn repo — **không MỘT lời gọi `.release()` nào lên `ort.InferenceSession`**.
 * Đuổi khỏi cache chỉ gỡ tham chiếu JS; bộ nhớ native của onnxruntime chỉ chắc chắn được trả khi
 * `session.release()` chạy. Thêm lời gọi đó Ở ĐÂY sẽ giải phóng bộ nhớ native NGAY DƯỚI CHÂN một
 * `session.run` đang bay: `getSession()` KHÔNG có khoá in-flight (aiInferenceEngine.ts:192) và
 * `gpuSessionSemaphore` cho phép 2 lượt `run` song song ⇒ một lượt đuổi đúng lúc là **abort ở
 * tầng native, không phải một exception bắt được**. Sửa đúng cần đếm tham chiếu — ĐỔI HÀNH VI
 * trong đường suy luận nóng nhất, thứ Pha 1 tự cấm mình làm. Nên Pha 1 làm việc Pha 1 làm được:
 * ghi `releaseProof: "unverified"` vào nhật ký để lượt nhả này **truy vấn được** thay vì phải đọc
 * comment mà tin. Việc sửa gốc nằm ở báo cáo §10 (Pha 2).
 */
export type VramReleaseProof = "device-disposed" | "process-exit" | "unverified";

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
  /**
   * I-1 — bằng chứng nào chứng minh THIẾT BỊ đã nhả tại thời điểm `release()` được gọi.
   * Xem bảng bốn điểm nhả ở đầu file. Ghi vào sự kiện `release` để truy vấn được
   * (`detail.releaseProof`), thay vì phải đọc comment mà tin.
   * Không truyền ⇒ `"device-disposed"`: mọi hộ TRONG tiến trình của Task 5 đều nhả sau một
   * `dispose()` đã `await` xong, trừ hai ca ONNX đã đánh dấu tường minh là `"unverified"`.
   */
  releaseProof?: VramReleaseProof;
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
          //
          // ⚠⚠ I-2 (review TOÀN NHÁNH) — "CỬA THỨ BA". Bản trước `return` ở đây IM LẶNG TUYỆT
          // ĐỐI: không sự kiện, không dấu vết, không gì. Hậu quả nặng nhất KHÔNG phải đầu độc
          // nền (nền chụp một lần lúc boot, sổ còn rỗng — xác suất thấp) mà là: **giấy phép giữ
          // ước lượng theo kích thước FILE VĨNH VIỄN**. Với `reranker:` file 606 MiB / thật
          // 14-18 MiB ⇒ sổ thừa ~590 MiB ⇒ lệch ÂM vượt ngưỡng 512 **mỗi 60 giây, mãi mãi** —
          // đúng nhánh mà Task 5 đã phải đổi `> 0` thành `>= 0` để tránh, sống lại qua cửa `< 0`.
          // Đường sinh delta âm có THẬT và dài NHIỀU GIÂY: `aiGgufEngine.ts:771`
          // `while (await evictLRU())` chạy GIỮA `beforeUsed` (`:737`) và `commitMeasured()`
          // (`:802`) — đuổi 17 GB rồi nạp 4 GB.
          //
          // ⚠ VÌ SAO KHÔNG CHỌN "THỬ LẠI Ở NHỊP ĐỐI CHIẾU" (phương án A): `beforeUsed` được chụp
          // TRƯỚC lượt cấp phát. Một lượt thử lại ở thời điểm t₂ chỉ tính được
          // `after(t₂) − beforeUsed(t₀)`, mà giữa t₀ và t₂ đã có mọi lượt cấp phát/nhả của mọi
          // hộ khác ⇒ số thu được KHÔNG phải VRAM của giấy phép này, và nó sẽ được `commit()`
          // NHƯ THỂ là số thật. Thử lại làm phép đo SAI HƠN, không đúng hơn. Chọn phương án B:
          // ĐÁNH DẤU "đo hỏng" + ghi một sự kiện `measure_failed` — sổ nói thẳng rằng con số nó
          // đang giữ là ước lượng KHÔNG xác minh được, thay vì giả vờ "đang chờ commit".
          if (actual < 0) {
            broker.markMeasureFailed(lease);
            logVramEvent({
              event: "measure_failed",
              owner: opts.owner,
              leaseKind: opts.kind,
              priority: opts.priority,
              estimatedBytes: est.bytes,
              estimateSource: est.source,
              deviceUsedBytes: after.usedBytes,
              detail: {
                measuredDeltaBytes: actual,
                beforeUsedBytes: beforeUsed,
                afterUsedBytes: after.usedBytes,
                note:
                  "delta ÂM ⇒ phép đo vô nghĩa (có lượt nhả/evict xen giữa hai đầu đo). Giấy phép " +
                  "GIỮ NGUYÊN ước lượng và sẽ KHÔNG BAO GIỜ được xác minh — đây là nguồn lệch ÂM " +
                  "dai dẳng, KHÔNG phải 'đang cấp phát dở'. KHÔNG thử lại: beforeUsed đã cũ, " +
                  "thử lại chỉ tạo ra một số sai trông như số thật.",
              },
            });
            return;
          }

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
            // I-1 — bằng chứng thiết bị đã nhả (bảng bốn điểm nhả ở đầu file). Truy vấn được:
            //   SELECT owner, count(*) FROM vram_events
            //   WHERE event='release' AND detail->>'releaseProof'='unverified' GROUP BY 1;
            detail: { releaseProof: opts.releaseProof ?? "device-disposed" },
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
