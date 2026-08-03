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

/**
 * ★★ Pha 1.5 Task 8 (C-1) — SỔ CỬA SỔ ĐO ĐANG MỞ. Đọc trước khi sửa `commitMeasured()`.
 *
 * LỖI ĐANG VÁ: `beforeUsed` (`:168`) và `after.usedBytes` (`:241`) đều đọc `used` **TOÀN THIẾT
 * BỊ**, không phải phần của riêng giấy phép này. Nên MỌI lượt cấp phát rơi vào khoảng
 * `before→after` của một giấy phép đều bị quy TRỌN VẸN cho giấy phép đó. Hai cửa sổ chồng nhau
 * ⇒ **cùng một khối byte vào sổ HAI LẦN**. Tái hiện được với broker + wiring THẬT:
 * `thiết bị = 5.000 MiB · Σ actualBytes = 8.000 MiB [A=4000, B=4000]`; khớp ca LIVE
 * `thiết bị 8.445 < đã commit 9.797`.
 *
 * ĐẾN ĐƯỢC THẬT, KHÔNG PHẢI GIẢ ĐỊNH: `GGUF_MAX_CONCURRENCY=4` (.env) + 6 nơi gọi
 * `generateEmbedding(s)` do HTTP điều khiển; `aiGgufEngine.ts:2756-2762` đã ĐO đúng ca này
 * ("4 lượt tuần tự 654 MiB; đồng thời 2.430 MiB"); `wiring.backend.test.ts:198` chạy đúng
 * `Promise.all([loadGgufModel(A), loadGgufModel(B)])`.
 *
 * VÌ SAO CHẶN PHA 2: Pha 2 từ chối/thu hồi trên `headroom = trần − reserve − Σ leaseBytes`, mà
 * `leaseBytes()` trả `actualBytes` sau commit ⇒ **từ chối nạp và ĐUỔI MODEL ĐANG CHẠY trên byte
 * ma**. Tệ hơn: bản lỗi còn gọi `estimator.recordActual()` với con số nhân đôi ⇒ nấc "learned"
 * đóng đinh nó cho MỌI lượt sau, tới hết đời tiến trình.
 *
 * ⚠⚠ VÌ SAO CHỌN (c) "PHÁT HIỆN CHỒNG LẤN ⇒ markMeasureFailed()", KHÔNG CHỌN (a) "TUẦN TỰ HOÁ
 * PHÉP ĐO" — ba lý do ĐO ĐƯỢC trong chính repo này, không phải sở thích:
 *
 *   1. **Cửa sổ đo CHÍNH LÀ lượt cấp phát.** `beginVramAllocation()` đứng NGAY TRƯỚC
 *      `llama.loadModel()`/`createContext()`/`spawn()` và `commitMeasured()` NGAY SAU. Tuần tự
 *      hoá phép đo = tuần tự hoá đường cấp phát. Telemetry lúc đó không còn QUAN SÁT nữa mà bắt
 *      đầu QUYẾT ĐỊNH thứ tự — đúng ranh giới Pha 1/1.5 tự cấm mình vượt (xem đầu file).
 *   2. **BA nơi CỐ Ý không bao giờ gọi `commitMeasured()`** — `kbSyncScheduler` (2 điểm),
 *      `localSidecarTrainer`, `aiLlmFinetuneSidecar` (đều `external-process`, lý do ghi ngay ở
 *      docstring `beginTrainerVram()`: "khi tiến trình con thoát, VRAM của nó đã được OS thu hồi
 *      từ lâu"). Một khoá mở ở `begin` và trả ở `commit` sẽ **không bao giờ được trả** ở ba chỗ
 *      đó; trả ở `release()` thay thì khoá bị giữ suốt CẢ JOB HUẤN LUYỆN (`ttlMs =
 *      sidecarTimeoutMs()`), chặn mọi lượt nạp model của cả tiến trình. Không tự lành.
 *   3. **KHOÁ CHÉO với `withGgufSlot` là có thật.** `getOrLoadModel()`/`ensureTextContext()` cấp
 *      phát NGOÀI slot (aiGgufEngine.ts:1550, :1561) còn `getEmbeddingContext()` cấp phát TRONG
 *      slot (:2699, :2734 → :2783). Thêm một khoá thứ hai được giữ ở CẢ HAI phía một semaphore
 *      4 chỗ là đưa vào một thứ tự khoá không nhất quán — thứ Pha 1.5 không có cách nào chứng
 *      minh là an toàn bằng test.
 *
 * ⇒ Không nối tiếp gì cả. Chỉ GHI LẠI cửa sổ nào đang mở, và khi hai cửa sổ chạm nhau thì
 * **khai `measureFailed`** — cùng ngữ nghĩa, cùng đường tự lành mà I-2/Task 3 đã dựng cho
 * `delta âm` và `đầu dò null`. KHÔNG chia tỉ lệ, KHÔNG ước lượng bù:
 * *một ước lượng sai ĐƯỢC GẮN CỜ rẻ hơn một ước lượng sai ĐƯỢC TIN.*
 *
 * ⚠ PHẠM VI — nói đúng, đừng nói rộng hơn:
 *   PHỦ: mọi hộ tiêu thụ đi qua `beginVramAllocation()` (12 điểm gọi trong repo), kể cả các hộ
 *        NGOÀI tiến trình đã KHAI BÁO bằng giấy phép (`sidecar:vision`, `cron:kb-sync`,
 *        `sidecar:local-trainer`, `sidecar:llm-finetune`) — cửa sổ của chúng mở từ `begin` tới
 *        `commitMeasured()`/`release()`, nên một lượt nạp model chồng lên lượt spawn của chúng
 *        BỊ BẮT.
 *   KHÔNG PHỦ: bất kỳ hộ tiêu thụ nào KHÔNG khai báo giấy phép — tiến trình khác của máy, phần
 *        nền desktop, hoặc một tiến trình con cấp phát mà không đi qua `beginVramAllocation()`.
 *        Sổ này chỉ thấy thứ nằm TRONG sổ; phần còn lại là việc của `vramReconciler` (lệch DƯƠNG
 *        = "kẻ cấp phát chui") và của nền đo được (`captureVramBaseline`).
 *
 * ⚠ CÁI GIÁ PHẢI TRẢ, ĐÃ CÂN NHẮC — KHÔNG NÉ: ba hộ NGOÀI tiến trình không bao giờ commit nên
 * cửa sổ của chúng mở tới tận `release()`, tức tới lúc tiến trình con THOÁT. Suốt một job huấn
 * luyện (`sidecar:local-trainer`, hàng chục phút), MỌI lượt nạp model trong tiến trình sẽ bị gắn
 * `measureFailed` — kể cả những lượt mà tiến trình con đã cấp phát xong từ lâu và VRAM của nó
 * đang đứng yên (báo sai HƯỚNG AN TOÀN). Chấp nhận, vì vế đối lập là: một lượt nạp chồng lên
 * lượt SPAWN của tiến trình con sẽ nuốt trọn 6-7,8 GB của nó vào `actualBytes` **và**
 * `recordActual()` đóng đinh con số đó vào nấc "learned" — biến thể mà brief gọi là "tệ hơn và
 * KHÔNG tự lành" (con thoát, thiết bị tụt, sổ không tụt). Giữa "gắn cờ thừa, hết job là hết" và
 * "tin một con số sai tới hết đời tiến trình", chọn vế đầu — nhất quán với tiền lệ I-2/Task 3.
 */
interface OpenMeasureWindow {
  owner: string;
  /** Owner của những cửa sổ đã CHỒNG lên cửa sổ này. Rỗng = phép đo cô lập được. */
  overlappedBy: string[];
}

const openMeasureWindows = new Map<number, OpenMeasureWindow>();
let measureWindowSeq = 0;

/**
 * Mở một cửa sổ đo và ĐÁNH DẤU HAI CHIỀU với mọi cửa sổ đang mở: cửa sổ mới bị các cửa sổ cũ làm
 * bẩn (byte của chúng còn đang lên trong khoảng đo của nó), và các cửa sổ cũ cũng bị cửa sổ mới
 * làm bẩn (byte của nó sẽ lên trước khi chúng đọc đầu đo "sau"). Đánh dấu một chiều thôi là bỏ
 * sót đúng một nửa số ca. KHÔNG BAO GIỜ ném (chỉ thao tác Map trong bộ nhớ).
 */
function openMeasureWindow(owner: string): number {
  const id = ++measureWindowSeq;
  const self: OpenMeasureWindow = { owner, overlappedBy: [] };
  for (const other of openMeasureWindows.values()) {
    if (!other.overlappedBy.includes(owner)) other.overlappedBy.push(owner);
    if (!self.overlappedBy.includes(other.owner)) self.overlappedBy.push(other.owner);
  }
  openMeasureWindows.set(id, self);
  return id;
}

/** Đóng cửa sổ. Trả bản ghi để người gọi đọc `overlappedBy`; `null` nếu đã đóng rồi. */
function closeMeasureWindow(id: number): OpenMeasureWindow | null {
  const w = openMeasureWindows.get(id);
  if (!w) return null;
  openMeasureWindows.delete(id);
  return w;
}

/** Chỉ dùng trong test/chẩn đoán — số cửa sổ đo đang mở của tiến trình này. */
export function __openMeasureWindowCount(): number {
  return openMeasureWindows.size;
}

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

    /**
     * ★★ Task 8 (C-1) — MỞ CỬA SỔ ĐO. Xem khối docstring `OpenMeasureWindow` ở đầu file.
     *
     * ⚠ MỞ CẢ KHI `beforeUsed === null`. Giấy phép này KHÔNG đo được gì cho CHÍNH nó, nhưng nó
     * VẪN SẮP CẤP PHÁT — và lượt cấp phát đó rơi vào cửa sổ của người khác. Không mở ở đây là bỏ
     * lọt đúng ca "đầu dò chập chờn lúc GPU đang bận", tức đúng lúc dễ chồng lấn nhất.
     *
     * ⚠ ĐẶT SAU `if (!lease) return NOOP_TICKET` (bên trên): đường NOOP không cấp phát gì qua sổ
     * này nên không có cửa sổ nào để mở — mở rồi không ai đóng là rò vĩnh viễn.
     *
     * ⚠ Giữa dòng này và `return { … }` bên dưới KHÔNG ĐƯỢC có mã nào ném được (hiện chỉ còn một
     * khai báo hàm). `catch` ngoài cùng của `beginVramAllocation()` trả `NOOP_TICKET` — nếu có gì
     * ném ở giữa, cửa sổ này sẽ KHÔNG BAO GIỜ được đóng và mọi phép đo sau đó của tiến trình đều
     * bị gắn cờ sai, vĩnh viễn. Người sau thêm mã vào đoạn này: đóng cửa sổ trong `catch` đó.
     */
    const windowId = openMeasureWindow(opts.owner);
    let windowOpen = true;
    /** Đóng cửa sổ đúng MỘT lần, ở BẤT KỲ nhánh thoát nào. KHÔNG BAO GIỜ ném. */
    const closeWindow = (): OpenMeasureWindow | null => {
      if (!windowOpen) return null;
      windowOpen = false;
      return closeMeasureWindow(windowId);
    };

    /**
     * Pha 1.5 Task 3, review vòng 1 (Important-1) — "CỬA THỨ TƯ/NĂM" của `commitMeasured()`.
     *
     * Reviewer đọc lại toàn bộ hàm và tìm ra HAI nhánh return CÂM khác bên dưới (`beforeUsed
     * === null` và `!after`), CẢ HAI đều là "đầu dò không trả được số dùng được" — cùng lớp
     * lỗi với "cửa thứ ba" (I-2, nhánh `actual < 0` bên dưới) mà bản vá TRƯỚC đã đóng. Khác
     * với delta<0 (đo được số, chỉ là số đó VÔ NGHĨA), ở đây ta CHƯA TỪNG có đủ hai đầu đo để
     * tính delta — nhưng ngữ nghĩa `measureFailed` vẫn khớp: "đã THỬ đo, không ra số dùng
     * được", KHÔNG PHẢI "đang chờ". `commitMeasured()` không được gọi lại cho CÙNG một ticket
     * (mỗi điểm cấp phát chỉ `await` nó đúng MỘT lần), nên trước bản vá này, lease rơi vào hai
     * nhánh trên đứng CÂM `actualBytes:null, measureFailed:false` tới khi có `release()` THẬT
     * (model unload/evict) — lâu hơn RẤT NHIỀU so với cửa delta<0 (tự lành ngay trong CHÍNH
     * lượt gọi `commitMeasured()` đang chạy).
     *
     * ⚠ ĐÁNH ĐỔI ĐÃ CÂN NHẮC, KHÔNG NÉ: gắn `measureFailed=true` ở đây có thể khiến một lease
     * THẬT SỰ đang tải dở (VRAM vật lý còn tăng) bị loại khỏi `pendingBytes` (vramReconciler.ts)
     * chỉ vì MỘT lượt đọc thiết bị hỏng THOÁNG QUA — băng dung sai phía ÂM co lại đúng lúc đó,
     * có thể sinh một lượt báo động ở nhịp `reconcileOnce()` kế tiếp nếu vật lý chưa kịp lên
     * đủ. Đây là đánh đổi CÓ CHỦ Ý: (a) báo động đó KHÔNG sai lệch — nó đúng sự thật "ước
     * lượng của lease này không xác minh được", và câu cảnh báo I-2 sẵn có đã phân biệt rõ
     * "đo hỏng" với "cấp phát chui"; (b) đối lập với nó là một LỖ CÂM có thể kéo dài tới lúc
     * unload/evict — hàng phút/giờ trên một model ít khi bị đuổi khỏi cache — đúng lớp lỗi mà
     * I-2 sinh ra để diệt. Giữa "một lượt báo động giải thích được" và "một lỗ câm không biết
     * đang câm", Pha 1.5 chọn vế đầu, nhất quán với tiền lệ I-2.
     *
     * ⚠ CATCH-ALL BÊN NGOÀI (`catch {}` cuối hàm) CỐ Ý KHÔNG sửa theo cùng cách: nó bọc CẢ
     * `broker.commit()`/`estimator.recordActual()`/`logVramEvent()` PHÍA SAU lượt commit thật.
     * Nếu `commit()` đã chạy xong rồi một trong hai lời gọi sau mới ném, gọi `markMeasureFailed`
     * ở catch-all sẽ gắn cờ SAI cho một lease ĐÃ commit đúng (`actualBytes` là số thật nhưng
     * `measureFailed=true` khiến câu cảnh báo I-2 gọi nhầm lease THÀNH CÔNG là "đo hỏng"). Rủi
     * ro gắn cờ sai lớn hơn lợi ích (ba hàm đó đều đồng bộ/không I/O, catch-all gần như không
     * bao giờ chạm) nên KHÔNG mở rộng sang nhánh này.
     */
    const markProbeFailed = (reason: "before-probe-null" | "after-probe-null", extraDetail: Record<string, unknown>) => {
      broker.markMeasureFailed(lease);
      logVramEvent({
        event: "measure_failed",
        owner: opts.owner,
        leaseKind: opts.kind,
        priority: opts.priority,
        estimatedBytes: est.bytes,
        estimateSource: est.source,
        detail: {
          reason,
          ...extraDetail,
          note:
            "đầu dò trả null/lỗi ⇒ không đủ hai đầu đo để tính delta. Giấy phép GIỮ NGUYÊN " +
            "ước lượng và sẽ KHÔNG BAO GIỜ được xác minh (commitMeasured() không gọi lại cho " +
            "cùng ticket) — đánh dấu ngay để không câm tới lúc release().",
        },
      });
    };

    let released = false;
    return {
      async commitMeasured() {
        try {
          if (released) return;
          if (beforeUsed === null) {
            closeWindow();
            markProbeFailed("before-probe-null", {});
            return;
          }
          const after = await probe.readDeviceVramUncached();
          if (!after) {
            closeWindow();
            markProbeFailed("after-probe-null", { beforeUsedBytes: beforeUsed });
            return;
          }

          // ★★ Task 8 (C-1) — cửa sổ đo ĐÓNG NGAY SAU đầu đo "sau", không muộn hơn. Từ điểm này
          // giấy phép đã ổn định trên thiết bị: nó không còn làm bẩn phép đo của ai nữa, và giữ
          // cửa sổ mở thêm chỉ đẻ ra báo động giả cho lượt cấp phát kế tiếp.
          const win = closeWindow();
          const actual = after.usedBytes - beforeUsed;

          /**
           * ★★ Task 8 (C-1) — "CỬA THỨ SÁU": phép đo KHÔNG CÔ LẬP ĐƯỢC.
           *
           * ⚠ ĐẶT TRƯỚC nhánh `actual < 0` CÓ CHỦ Ý: một cửa sổ chồng lấn cũng sinh ra delta âm
           * (người kia nhả chỗ giữa hai đầu đo của mình), và khi cả hai cùng đúng thì chồng lấn
           * mới là NGUYÊN NHÂN GỐC. Để nhánh delta-âm bắt trước sẽ ghi vào nhật ký câu chẩn đoán
           * "có lượt nhả/evict xen giữa" — đúng lớp "chỉ người trực đi sai hướng" mà I-2 sinh ra
           * để diệt.
           *
           * ⚠ KHÔNG CHIA TỈ LỆ, KHÔNG ƯỚC LƯỢNG BÙ. Ở đây ta biết ĐÚNG một điều: `actual` chứa
           * byte của ít nhất một giấy phép khác, và KHÔNG có thông tin nào trong tiến trình tách
           * được phần nào của ai (hai đầu đo đều là `used` toàn thiết bị). Mọi phép chia đều là
           * bịa. Giấy phép giữ nguyên ƯỚC LƯỢNG và nói ra rằng nó chưa được xác minh.
           */
          if (win && win.overlappedBy.length > 0) {
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
                reason: "overlapping-measure-window",
                overlappedBy: win.overlappedBy,
                discardedDeltaBytes: actual,
                beforeUsedBytes: beforeUsed,
                afterUsedBytes: after.usedBytes,
                note:
                  "cửa sổ đo của giấy phép này CHỒNG với cửa sổ của giấy phép khác ⇒ delta " +
                  "`after − before` (cả hai đầu đo là `used` TOÀN THIẾT BỊ) gồm cả byte của họ. " +
                  "Commit số này là ghi CÙNG MỘT KHỐI BYTE hai lần vào sổ, và Pha 2 sẽ từ chối " +
                  "nạp/đuổi model trên phần byte ma đó. KHÔNG chia tỉ lệ để bù: không có thông " +
                  "tin nào trong tiến trình tách được phần của ai. Giấy phép giữ ƯỚC LƯỢNG.",
              },
            });
            return;
          }

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
          // ★★ Task 8 (C-1) — đầu dò "sau" NÉM ⇒ cửa sổ vẫn phải đóng. Bỏ sót nhánh này là rò
          // một cửa sổ mở vĩnh viễn: mọi phép đo sau đó của tiến trình bị gắn cờ sai và KHÔNG
          // tự lành cho tới khi khởi động lại. Idempotent — gọi lại sau closeWindow() ở trên là
          // no-op.
          closeWindow();
          /* telemetry hỏng KHÔNG được làm hỏng lượt cấp phát */
        }
      },
      release() {
        try {
          if (released) return;
          released = true;
          // ★★ Task 8 (C-1) — LỐI ĐÓNG THỨ HAI, bắt buộc. BA điểm gọi trong repo CỐ Ý không bao
          // giờ gọi `commitMeasured()` (`kbSyncScheduler` ×2, `localSidecarTrainer`,
          // `aiLlmFinetuneSidecar` — xem docstring `beginTrainerVram()`), và MỌI đường lỗi của
          // bảy hộ trong tiến trình cũng `release()` thay vì commit. Không đóng ở đây thì cửa sổ
          // của chúng mở tới hết đời tiến trình ⇒ gắn cờ SAI cho tất cả, không tự lành. Đây đúng
          // là câu hỏi "nhánh mới kích hoạt SAI thì bao lâu tự lành?" — câu trả lời phải là
          // "ngay khi giấy phép kia rời sổ", không phải "khi restart".
          closeWindow();
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
