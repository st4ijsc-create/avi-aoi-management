import type { VramLeaseKind, VramPriority } from "./types";
import { beginVramAllocation, type VramReleaseProof, type VramTicket } from "./vramWiring";
import { logVramEvent, type VramEventInput } from "./vramEventLog";

/**
 * ★★★ Pha 2B Task 3 — BA KẾT CỤC CỦA §5.5, VÀ CÁI CHẾT CỦA SUY BIẾN IM LẶNG.
 *
 * ⚠ ĐỌC TRƯỚC KHI SỬA: task này **chưa** cưỡng chế (Task 5 mới bật cổng). Việc DUY NHẤT của nó là
 * làm cho **mọi** thất bại cấp phát **để lại vết**. Nếu bạn thấy một nhánh ở đây `return`/`throw`
 * mà không đi qua `ghiSuKien()`, đó là một lỗi, không phải một tối ưu.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẰNG CHỨNG ĐO ĐƯỢC (Ư0, 24 lượt): **`0/24` log chứa dòng lùi `gpuLayers:"auto"`.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Lớp phòng thủ cuối của `aiGgufEngine.loadGgufModel()` **chưa bao giờ chạy**. Hai nguyên nhân
 * ĐỘC LẬP — vá một cái là còn nguyên cái kia:
 *
 * **(1) `isOom` không khớp chuỗi mà llama.cpp THẬT SỰ ném.** Bản cũ tìm bốn chuỗi
 * `out of memory` / `cudamalloc` / `failed to allocate` / `unable to allocate`. Đọc mã THẬT trong
 * `node_modules/node-llama-cpp@3.19.0` (không đoán từ tên hàm — brief của controller đã sai bảy
 * lần trong chuỗi này vì khái quát từ một ca đã đo):
 *
 * | Nơi ném (đường dẫn thật) | Chuỗi thật | Bản `isOom` cũ khớp? |
 * |---|---|---|
 * | `dist/evaluator/LlamaModel/LlamaModel.js:593` | `Failed to load model` | **KHÔNG** |
 * | `dist/gguf/insights/utils/resolveModelGpuLayersOption.js:80,170` | `Not enough VRAM to fit the model with the specified settings` | **KHÔNG** |
 * | `dist/gguf/insights/utils/resolveContextContextSizeOption.js:36,119-127` | `A context size of N … is too large for the available VRAM` | **KHÔNG** |
 * | `dist/evaluator/LlamaContext/LlamaContext.js:710,770` | `Failed to create context` | **KHÔNG** |
 *
 * ⚠⚠ **Dòng `ggml_backend_cuda_buffer_type_alloc_buffer: … cudaMalloc failed: out of memory` mà
 * mọi báo cáo Đợt 1/Đợt 2 trích dẫn là dòng llama.cpp in ra STDERR, KHÔNG PHẢI `err.message`.**
 * `model._model.init()` (addon native) trả `false`, và JS ném đúng ba chữ `Failed to load model`.
 * Đây là lý do `isOom` cũ trượt 24/24: nó được viết theo cái NGƯỜI ĐỌC THẤY TRONG LOG, không theo
 * cái CHƯƠNG TRÌNH NHẬN ĐƯỢC. (Bốn chuỗi cũ vẫn giữ trong bảng dưới — chúng vô hại và có thể tới
 * từ một phiên bản/binding khác.)
 *
 * **(2) `warmModel()` có `catch` NUỐT TRỌN** (vá ở `aiGgufEngine.ts`, không ở file này).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ CẠM BẪY ĐÃ TRẢ GIÁ — `gpuLayers: -1` KHÔNG PHẢI "TẤT CẢ CÁC LỚP"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `resolveModelGpuLayersOption.js:23`:
 *
 *     const resolvedGpuLayers = typeof gpuLayers === "number"
 *         ? Math.max(0, Math.min(ggufInsights.totalLayers, gpuLayers))   // ← -1 ⇒ 0
 *         : ggufInsights.totalLayers;
 *
 * `Math.max(0, Math.min(totalLayers, -1)) === 0` ⇒ **nạp 0 lớp lên GPU, chạy CPU, chậm gấp bội,
 * và KHÔNG BÁO GÌ**. Đường vào có thật và mở cho người dùng: `server/routers/aiGgufRouter.ts:51`
 * khai `gpuLayers: z.number().min(-1).max(200).optional()` trên `adminProcedure`.
 *
 * Hai lá chắn ở đây, và **cả hai đều cần**:
 *   • **CẤM số âm đi tới node-llama-cpp** (`chuanHoaSoLop()`): số âm bị đổi thành `"auto"` kèm một
 *     sự kiện `degraded` mang tên `negative-gpu-layers` — người vận hành thấy ngay mình vừa xin
 *     một thứ không có nghĩa, thay vì thấy suy luận chậm gấp bội mà không hiểu vì sao.
 *   • **ĐỌC LẠI SỐ LỚP THẬT** sau MỌI lượt nạp thành công (`spec.resolvedGpuLayers`, đọc
 *     `LlamaModel.gpuLayers` — getter có thật, `LlamaModel.d.ts:189`). `0` lớp ⇒ sự kiện
 *     `degraded` + `cpuOnly: true`, **kể cả khi lượt nạp ĐÃ THÀNH CÔNG ở nấc đầu**. Đây là lá chắn
 *     mạnh hơn: nó không cần biết vì sao thành 0, chỉ cần thấy 0 là nói ra.
 *
 * ⚠ VÌ SAO NẤC LÙI LÀ `"auto"` CHỨ KHÔNG PHẢI MỘT SỐ TỰ CHỌN: yêu cầu "hạ số lớp TƯỜNG MINH" tồn
 * tại để chặn đúng bẫy `-1` ở trên — tức chặn một **con số ma thuật âm thầm có nghĩa 0**. `"auto"`
 * KHÔNG phải số ma thuật: nó là nhánh riêng của `resolveModelGpuLayersOption` (`:85` trở đi), tính
 * ra số lớp lớn nhất còn vừa VRAM trống và **không bao giờ đi qua phép `Math.max(0, …)** kia. Chọn
 * đại một con số (`n/2`, `20`, …) thì ta phải BIẾT `totalLayers`, mà muốn biết phải đọc metadata
 * GGUF — một lượt I/O nữa đúng lúc thiết bị đang hết chỗ. ⇒ Ta để node-llama-cpp chọn, rồi **ĐỌC
 * LẠI VÀ GHI SỐ THẬT** — con số trong sự kiện `degraded` là số lớp ĐÃ NẠP, không phải số đã xin.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỐN BƯỚC KHI DRIVER TỪ CHỐI **SAU KHI ĐÃ QUA CỔNG SỔ** (§5.5) — MỖI BƯỚC MỘT SỰ KIỆN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. **TRẢ GIẤY PHÉP NGAY** (`driver_refused`). Driver từ chối mà lease còn treo thì sổ **cộng dư
 *    VĨNH VIỄN** (không có `commit`, không có `release`, `leaseBytes()` vẫn tính ước lượng) và
 *    lượt xin kế tiếp bị từ chối trên **byte ma**. Trả chỗ nằm trong `finally` — sự kiện có thể
 *    hỏng, việc trả chỗ thì không.
 * 2. **THỬ LẠI 2 LẦN, CÁCH NHAU 5 s** (`retry`). Thử lại KHÔNG phải mê tín, nó có số chống lưng:
 *    trần **KHÔNG TẤT ĐỊNH** — đo được **3 OK / 9 hỏng trên CÙNG một khối 16.698,37 MiB**, trên
 *    máy rảnh (Ư7, Pha 1). Mỗi lượt thử lại mở một giấy phép **MỚI**: lượt cũ đã trả chỗ ở bước 1,
 *    nên sổ luôn nói đúng số giấy phép đang sống.
 * 3. **HẠ SỐ LỚP** (`degraded`) — xem khối `-1` bên trên.
 * 4. **TỪ CHỐI TRUNG THỰC** (`refuse`). Ném lại NGUYÊN lỗi cuối cùng: người gọi phải thấy đúng
 *    thứ driver nói, không phải một lỗi do ta bịa ra. Task 4 lo phần CÂU CHỮ; ở đây chỉ cần sự kiện.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ RÀNG BUỘC GIỮ NGUYÊN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • `reserve()` vẫn ĐỒNG BỘ — file này không chạm `vramBroker`, nó chỉ gọi `beginVramAllocation()`.
 *   • Đơn vị nội bộ luôn là **BYTE**.
 *   • Đ4 — file này KHÔNG đo gì cả, nên không có chỗ nào trộn hai thước.
 *   • **Telemetry KHÔNG BAO GIỜ được làm hỏng lượt nạp**: mọi lời gọi nhật ký/`reclaim` đều bọc
 *     `try`. Nhưng "nuốt lỗi thì được, nuốt IM LẶNG thì không" — mọi `catch` ở đây đều có tiếng.
 */

/** Bao nhiêu lượt THỬ LẠI (ngoài lượt đầu) trước khi hạ số lớp. Bước 2 của §5.5. */
export const VRAM_LOAD_RETRIES_DEFAULT = 2;
/** Khoảng cách giữa hai lượt thử. 5 s — xem "trần KHÔNG tất định" ở khối docstring đầu file. */
export const VRAM_LOAD_RETRY_DELAY_MS_DEFAULT = 5000;

/**
 * ⚠ Đọc env ở MỖI lượt gọi (không đóng băng lúc nạp module), cùng khuôn với
 * `vramWiring.measureWaitBudgetMs()`: người vận hành phải hạ được nó mà không build lại.
 * Giá trị vô lý (NaN/âm/không hữu hạn) ⇒ về mặc định, KHÔNG lan NaN xuống đường nóng.
 */
export function vramLoadRetries(): number {
  const raw = Number(process.env.VRAM_LOAD_RETRIES);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : VRAM_LOAD_RETRIES_DEFAULT;
}

export function vramLoadRetryDelayMs(): number {
  const raw = Number(process.env.VRAM_LOAD_RETRY_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : VRAM_LOAD_RETRY_DELAY_MS_DEFAULT;
}

/**
 * Bảng chuỗi lỗi ⇒ TÊN TÍN HIỆU. Đọc bằng chữ thường, so bằng `includes`.
 *
 * ⚠ Bốn dòng CUỐI là bản `isOom` CŨ. Giữ lại vì chúng vô hại (không chuỗi nào trong đó xuất hiện
 * ở một lỗi KHÔNG phải hết bộ nhớ) và vì một binding/phiên bản khác có thể ném chúng thật.
 * ⚠ Bốn dòng ĐẦU là thứ bản cũ THIẾU — chúng mới là cái llama.cpp 3.19.0 thật sự ném.
 * ⚠ THỨ TỰ CÓ NGHĨA: dòng khớp ĐẦU TIÊN quyết định `signal`, nên chuỗi CỤ THỂ phải đứng trước
 * chuỗi CHUNG (`insufficient memory` là câu mặc định của `InsufficientMemoryError`).
 */
export const VRAM_EXHAUSTION_SIGNALS: ReadonlyArray<readonly [pattern: string, signal: string]> = Object.freeze([
  ["failed to load model", "llama-model-init-false"],
  ["not enough vram", "insufficient-vram-preflight"],
  ["too large for the available vram", "insufficient-vram-context"],
  ["too large for the available ram", "insufficient-ram-context"],
  ["too large for the available resources", "insufficient-resources-context"],
  ["failed to create context", "llama-context-init-false"],
  ["insufficient memory", "insufficient-memory-generic"],
  ["out of memory", "cuda-oom"],
  ["cudamalloc", "cuda-malloc"],
  ["failed to allocate", "alloc-failed"],
  ["unable to allocate", "alloc-unable"],
] as const);

export interface VramExhaustionVerdict {
  /** Lỗi này CÓ PHẢI "thiết bị/driver không cấp được chỗ" không. */
  readonly exhausted: boolean;
  /** Tín hiệu nào đã khớp — đi thẳng vào `detail.signal` để truy được bằng SQL. */
  readonly signal: string | null;
}

/**
 * Thay cho `isOom` cũ. **KHÔNG BAO GIỜ ném** (nó nằm trên đường lỗi của người khác).
 *
 * ⚠ `InsufficientMemoryError` của node-llama-cpp KHÔNG đặt `this.name`, nên `err.name === "Error"`.
 * Nhận diện theo `constructor.name` là tín hiệu PHỤ (dist không bị minify), còn tín hiệu CHÍNH vẫn
 * là chuỗi — đúng thứ tự đó, để một lượt bundle/minify không âm thầm gỡ mất lá chắn.
 */
export function classifyLoadFailure(err: unknown): VramExhaustionVerdict {
  try {
    const anyErr = err as { message?: unknown; constructor?: { name?: string } } | null | undefined;
    const ctorName = anyErr?.constructor?.name;
    const msg = String(anyErr?.message ?? err ?? "").toLowerCase();
    for (const [pattern, signal] of VRAM_EXHAUSTION_SIGNALS) {
      if (msg.includes(pattern)) return { exhausted: true, signal };
    }
    if (ctorName === "InsufficientMemoryError") {
      return { exhausted: true, signal: "insufficient-memory-error-class" };
    }
    return { exhausted: false, signal: null };
  } catch {
    return { exhausted: false, signal: null };
  }
}

/** Giá trị `gpuLayers` được phép truyền cho node-llama-cpp. Số ÂM không nằm trong đây, có chủ ý. */
export type VramGpuLayerValue = "max" | "auto" | number;

export type VramLoadStep = "initial" | "retry" | "degrade";

export interface VramLoadPlan {
  /** Truyền THẲNG cho `llama.loadModel({gpuLayers})`. Bảo đảm: chưa bao giờ là số âm. */
  readonly gpuLayers: VramGpuLayerValue;
  readonly step: VramLoadStep;
  /** 1-based, đếm cả lượt đầu. */
  readonly attemptNo: number;
}

export type VramLoadOutcomeKind = "loaded" | "loaded-after-retry" | "degraded";

export interface VramLoadOutcome<T> {
  readonly value: T;
  /**
   * Giấy phép ĐANG MỞ của lượt nạp THÀNH CÔNG. Người gọi sở hữu nó từ đây: phải
   * `commitMeasured()` (đường thường) hoặc `release()` (đường lỗi phía sau).
   * ⚠ Mọi giấy phép của các lượt THẤT BẠI đã được trả chỗ bên trong, không rò ra ngoài.
   */
  readonly ticket: VramTicket;
  readonly outcome: VramLoadOutcomeKind;
  readonly plan: VramLoadPlan;
  /** Số lớp THẬT đọc lại từ model. `null` = người gọi không khai được cách đọc. */
  readonly resolvedGpuLayers: number | null;
  /** Tổng số lượt gọi `load()` đã chạy (kể cả các lượt hỏng). */
  readonly attempts: number;
}

export interface VramLoadOutcomeSpec<T> {
  owner: string;
  kind: VramLeaseKind;
  priority: VramPriority;
  filePath?: string;
  fileBytes?: number;
  configDefaultBytes?: number;
  fallbackBytes?: number;
  ttlMs?: number;
  releaseProof?: VramReleaseProof;
  /** Số lớp NGƯỜI GỌI xin. Mặc định `"max"`. Số âm bị chuẩn hoá — xem `chuanHoaSoLop()`. */
  requestedGpuLayers?: VramGpuLayerValue;
  /** MỘT lượt nạp. Ném ⇒ thất bại của lượt đó. */
  load: (plan: VramLoadPlan) => Promise<T>;
  /** Đọc số lớp THẬT từ đối tượng vừa nạp (`LlamaModel.gpuLayers`). KHÔNG được ném. */
  resolvedGpuLayers?: (value: T) => number | null;
  /** Giành lại chỗ trước mỗi lượt thử lại / lượt hạ cấp (`evictLRU` vòng lặp). Có thể ném. */
  reclaim?: () => Promise<void>;
  retries?: number;
  retryDelayMs?: number;
  /** Tiêm để test không phải chờ thật. Mặc định `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Tiêm để test không phải dựng cả `vramWiring`. Mặc định `beginVramAllocation`. */
  begin?: typeof beginVramAllocation;
  /** Tiêm để test đọc thẳng. Mặc định `logVramEvent`. */
  emit?: (e: VramEventInput) => void;
}

const NOOP_TICKET: VramTicket = {
  async commitMeasured() {},
  release() {},
};

export type VramNormalizeReason = "negative-gpu-layers" | "non-finite-gpu-layers";

export interface VramLayerNormalization {
  gpuLayers: VramGpuLayerValue;
  /** Giá trị NGUYÊN VĂN người gọi đưa vào, khi nó phải bị chuẩn hoá. `null` = không đụng gì. */
  normalizedFrom: unknown;
  reason: VramNormalizeReason | null;
}

/**
 * ⚠ CHẶN SỐ ÂM Ở CỬA — xem khối `-1` ở đầu file. Trả về cả LÝ DO để người gọi ghi sự kiện:
 * chuẩn hoá âm thầm cũng là một suy biến im lặng, chỉ khác chỗ đứng.
 *
 * ⚠ M-3 (review vòng 1) — NHÁNH `NaN`/`Infinity` TỪNG TRẢ `normalizedFrom: null`, tức **đổi ngầm
 * sang `"auto"` mà KHÔNG sinh sự kiện**, và bộ test còn **khoá hành vi im lặng đó thành hợp đồng**.
 * Xác suất tới được thấp (`z.number()` của router loại `NaN`), nhưng một nhánh im lặng được viết
 * vào hợp đồng NGAY TRONG task diệt im lặng là thứ không được để lại. Nay cả hai nhánh chuẩn hoá
 * đều có `reason` ⇒ đều có sự kiện.
 */
export function chuanHoaSoLop(requested: VramGpuLayerValue | undefined): VramLayerNormalization {
  if (requested === undefined || requested === null) return { gpuLayers: "max", normalizedFrom: null, reason: null };
  if (requested === "max" || requested === "auto") return { gpuLayers: requested, normalizedFrom: null, reason: null };
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return { gpuLayers: "auto", normalizedFrom: requested, reason: "non-finite-gpu-layers" };
  }
  if (requested < 0) return { gpuLayers: "auto", normalizedFrom: requested, reason: "negative-gpu-layers" };
  return { gpuLayers: Math.floor(requested), normalizedFrom: null, reason: null };
}

/**
 * ★★ I-1 (review vòng 1) — GHI MỘT SỰ KIỆN CHO LƯỢT CẤP PHÁT HỎNG **NGOÀI** `loadWithVramOutcomes()`.
 *
 * Reviewer chỉ ra một dấu tự tố đáng suy nghĩ hơn bản thân lỗi: bảng `VRAM_EXHAUSTION_SIGNALS` chứa
 * `"too large for the available vram"` và `"failed to create context"` — **hai câu CHỈ đến từ
 * `createContext()`**, tức từ những đường mà bộ bọc §5.5 **không bao giờ nhìn thấy**. Bảng được
 * dựng bằng cách **ĐỌC `dist`**, không bằng cách **LẦN xem `throw` nào tới được `spec.load`**. Bộ
 * phân loại biết những câu nó không thể gặp; những chỗ gặp được chúng thì không có bộ phân loại.
 *
 * ⚠ VÌ SAO KHÔNG KÉO BỐN ĐƯỜNG ĐÓ VÀO `loadWithVramOutcomes()`: bốn bước §5.5 (trả chỗ · thử lại ·
 * hạ số lớp) là chính sách của lượt nạp **TRỌNG SỐ**. `createContext()` là một lượt cấp phát KHÁC,
 * đã có cơ chế co lại RIÊNG của node-llama-cpp (`LlamaContext.failedCreationRemedy`), và ràng buộc
 * của task cấm viết lại `aiGgufEngine.ts` / đổi ngữ nghĩa `ensureTextContext`. Ở đây ta chỉ làm
 * đúng việc Task 3 tự nhận: **cho nó một cái miệng**, không đổi một nhánh điều khiển nào.
 *
 * KHÔNG BAO GIỜ ném. Trả phán quyết để điểm gọi dùng lại (vd. sửa câu lỗi cho đúng nguyên nhân).
 */
export function noteVramAllocationFailure(n: {
  owner: string;
  kind: VramLeaseKind;
  priority: VramPriority;
  /** Đường nào đã ném — đi thẳng vào `detail.site`, truy được bằng SQL. */
  site: string;
  err: unknown;
  detail?: Record<string, unknown>;
  emit?: (e: VramEventInput) => void;
}): VramExhaustionVerdict {
  const verdict = classifyLoadFailure(n.err);
  try {
    (n.emit ?? logVramEvent)({
      event: verdict.exhausted ? "driver_refused" : "refuse",
      owner: n.owner,
      leaseKind: n.kind,
      priority: n.priority,
      detail: {
        reason: verdict.exhausted ? "driver-refused-outside-load-outcomes" : "allocation-failed-not-vram",
        signal: verdict.signal,
        site: n.site,
        ...n.detail,
        error: (n.err as Error)?.message ?? String(n.err),
        note:
          "lượt cấp phát này KHÔNG đi qua bốn bước §5.5 (nó không phải lượt nạp trọng số): không " +
          "thử lại, không hạ số lớp. Sự kiện tồn tại để đường đó thôi IM LẶNG TUYỆT ĐỐI — trước " +
          "bản vá I-1, một lượt nạp 30B thành công phần trọng số rồi CHẾT Ở KV CACHE (hình dạng " +
          "hỏng dễ xảy ra nhất khi VRAM sát trần) để lại ĐÚNG 0 sự kiện.",
      },
    });
  } catch (err) {
    console.warn(
      `[vram] KHÔNG ghi được sự kiện cấp phát hỏng cho "${n.owner}" tại ${n.site}: ` +
        `${(err as Error)?.message ?? String(err)}`,
    );
  }
  return verdict;
}

/** Có nấc nào THẤP HƠN để lùi xuống không. `"auto"`/`0` đã ở đáy — không có gì để hạ nữa. */
function coNacLui(gpuLayers: VramGpuLayerValue): boolean {
  return gpuLayers !== "auto" && gpuLayers !== 0;
}

const nguChuan = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * ★★★ ĐIỂM VÀO. Chạy §5.5 cho MỘT lượt nạp. Ném khi mọi nấc đã hết (bước 4).
 *
 * BẤT BIẾN được cưỡng chế bởi cấu trúc, không bởi lời hứa:
 *   • mỗi lượt thử có ĐÚNG một giấy phép; lượt hỏng trả chỗ trong `finally` NGAY tại chỗ hỏng;
 *   • đúng MỘT giấy phép còn mở khi hàm trả về THÀNH CÔNG, và nó nằm trong `outcome.ticket`;
 *   • KHÔNG nhánh thoát nào (kể cả `throw`) không đi qua một `ghiSuKien()`.
 */
export async function loadWithVramOutcomes<T>(spec: VramLoadOutcomeSpec<T>): Promise<VramLoadOutcome<T>> {
  const emit = spec.emit ?? logVramEvent;
  /**
   * ⚠⚠ TÊN BIẾN NÀY LÀ MỘT RÀNG BUỘC, KHÔNG PHẢI SỞ THÍCH — phải là `beginVram`.
   *
   * `vramAllocationSites.ts` là bản liệt kê MÁY QUÉT ĐƯỢC của mọi điểm mở giấy phép, và mẫu quét
   * của nó là tên hàm (`/\bbeginVram\s*\(/`, `/\bbeginVramAllocation\s*\(/`). Docstring N-1 của
   * chính file đó đã ghi rằng **alias đánh bại mẫu tên-hàm** và reviewer từng khai thác đúng lỗ
   * ấy. Đặt tên biến là `begin`/`mo`/`fn` thì lời gọi bên dưới thành `begin(` — **vô hình với máy
   * quét**, và điểm cấp phát VRAM lớn nhất của hệ (model 30B) biến mất khỏi bản liệt kê. Giữ tên
   * `beginVram` là cách rẻ nhất để lời gọi tự khai báo mình với công cụ.
   */
  const beginVram = spec.begin ?? beginVramAllocation;
  const sleep = spec.sleep ?? nguChuan;
  const retries = spec.retries ?? vramLoadRetries();
  const retryDelayMs = spec.retryDelayMs ?? vramLoadRetryDelayMs();

  /** Nhật ký KHÔNG BAO GIỜ được làm hỏng lượt nạp — nhưng cũng KHÔNG được câm. */
  const ghiSuKien = (e: Omit<VramEventInput, "owner" | "leaseKind" | "priority">): void => {
    try {
      emit({ ...e, owner: spec.owner, leaseKind: spec.kind, priority: spec.priority });
    } catch (err) {
      console.warn(
        `[vram] KHÔNG ghi được sự kiện "${e.event}" cho "${spec.owner}" — bước này thành VÔ HÌNH ` +
          `với Task 7: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  };

  const traGiayPhep = (ticket: VramTicket): void => {
    try {
      ticket.release();
    } catch (err) {
      console.warn(
        `[vram] "${spec.owner}" KHÔNG trả được giấy phép sau khi driver từ chối — sổ sẽ CỘNG DƯ ` +
          `đúng khối byte đó cho tới khi khởi động lại: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  };

  const { gpuLayers: soLopGoc, normalizedFrom, reason: lyDoChuanHoa } = chuanHoaSoLop(spec.requestedGpuLayers);
  if (lyDoChuanHoa !== null) {
    // Không phải một lượt hạ cấp do thiếu VRAM, nhưng ĐÚNG là một lượt chạy khác thứ người gọi
    // xin — và trước bản vá này nó tuyệt đối im lặng (rồi nạp 0 lớp).
    ghiSuKien({
      event: "degraded",
      detail: {
        reason: lyDoChuanHoa,
        // ⚠ `String()`: `NaN`/`Infinity` đi thẳng vào `detail` (jsonb) sẽ thành `null` IM LẶNG.
        // Bộ làm sạch của `vramEventLog` cũng bắt, nhưng đừng dựa vào lưới của người khác cho một
        // giá trị mà ngay tại đây ta đã BIẾT là không hữu hạn.
        requestedGpuLayers: typeof normalizedFrom === "number" && !Number.isFinite(normalizedFrom)
          ? String(normalizedFrom)
          : normalizedFrom,
        appliedGpuLayers: "auto",
        note:
          "gpuLayers không dùng được bị chuẩn hoá thành \"auto\". node-llama-cpp 3.x tính " +
          "Math.max(0, Math.min(totalLayers, n)) nên MỌI số âm (kể cả -1, thứ llama.cpp CLI hiểu " +
          "là 'tất cả các lớp') nghĩa là 0 LỚP TRÊN GPU — chạy CPU, chậm gấp bội, không báo gì. " +
          "Đường vào: server/routers/aiGgufRouter.ts gpuLayers z.number().min(-1).",
      },
    });
  }

  /**
   * ⚠ M-6 (review vòng 1) — BỘ ĐỌC SỐ LỚP NÉM THÌ PHẢI KÊU. Trước bản vá, `catch` ở đây trả `null`
   * im lặng ⇒ `cpuOnly` thành `false` ⇒ lá chắn `zero-gpu-layers-on-success` (thứ mạnh nhất của
   * thiết kế này) **MÙ đúng lúc nó cần thấy nhất**: một lượt nạp thành công ở nấc đầu, không nhánh
   * nào khác sinh sự kiện, và ta vừa mất cách duy nhất để biết mình đang chạy CPU.
   */
  const ganNhan = (value: T): number | null => {
    if (!spec.resolvedGpuLayers) return null;
    try {
      const n = spec.resolvedGpuLayers(value);
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    } catch (err) {
      ghiSuKien({
        event: "measure_failed",
        detail: {
          reason: "resolve-gpu-layers-threw",
          error: (err as Error)?.message ?? String(err),
          note:
            "bộ đọc số lớp (spec.resolvedGpuLayers) NÉM ⇒ không biết model vừa nạp có bao nhiêu lớp " +
            "trên GPU ⇒ lá chắn zero-gpu-layers-on-success KHÔNG chạy được cho lượt này. Lượt nạp " +
            "vẫn thành công; thứ mất là khả năng phát hiện suy biến.",
        },
      });
      return null;
    }
  };

  /** Chỉ chạy trước một lượt THỬ LẠI / HẠ CẤP — không bao giờ trước lượt đầu. */
  const giangLaiCho = async (buoc: VramLoadStep, attemptNo: number): Promise<void> => {
    if (!spec.reclaim) return;
    try {
      await spec.reclaim();
    } catch (err) {
      ghiSuKien({
        event: "measure_failed",
        detail: {
          reason: "reclaim-failed",
          step: buoc,
          attemptNo,
          error: (err as Error)?.message ?? String(err),
          note:
            "lượt giành lại chỗ (evictLRU) NÉM trước một lượt thử lại. Lượt thử vẫn chạy, nhưng " +
            "nó chạy trên đúng lượng VRAM cũ ⇒ xác suất hỏng lại cao hơn hẳn. KHÔNG được câm: " +
            "đây là chênh lệch giữa 'trần không tất định' và 'ta chưa dọn được chỗ'.",
        },
      });
    }
  };

  let attemptNo = 0;
  let loiCuoi: unknown = new Error(`[vram] "${spec.owner}": không lượt nạp nào chạy`);
  let tinHieuCuoi: string | null = null;

  const chay = async (plan: VramLoadPlan): Promise<{ ok: true; value: T; ticket: VramTicket } | { ok: false }> => {
    let ticket: VramTicket = NOOP_TICKET;
    try {
      ticket = await beginVram({
        owner: spec.owner,
        kind: spec.kind,
        priority: spec.priority,
        filePath: spec.filePath,
        fileBytes: spec.fileBytes,
        configDefaultBytes: spec.configDefaultBytes,
        fallbackBytes: spec.fallbackBytes,
        ttlMs: spec.ttlMs,
        releaseProof: spec.releaseProof,
      });
    } catch (err) {
      // `beginVramAllocation()` HỨA không bao giờ ném; nếu lời hứa đó vỡ, lượt nạp vẫn phải chạy —
      // nhưng KHÔNG ĐƯỢC im lặng, vì từ đây khối byte sắp cấp phát KHÔNG có mặt trong sổ.
      console.warn(
        `[vram] beginVramAllocation("${spec.owner}") NÉM (lẽ ra không bao giờ) ⇒ lượt nạp này chạy ` +
          `NGOÀI SỔ, dư địa sẽ bị phóng đại đúng khối byte đó: ${(err as Error)?.message ?? String(err)}`,
      );
      ghiSuKien({
        event: "measure_failed",
        detail: { reason: "begin-allocation-threw", step: plan.step, attemptNo: plan.attemptNo,
          error: (err as Error)?.message ?? String(err) },
      });
      ticket = NOOP_TICKET;
    }

    try {
      const value = await spec.load(plan);
      return { ok: true, value, ticket };
    } catch (err) {
      loiCuoi = err;
      const verdict = classifyLoadFailure(err);
      tinHieuCuoi = verdict.signal;
      try {
        // BƯỚC 1. Sự kiện đi TRƯỚC lời gọi trả chỗ để nhật ký đọc thành một câu chuyện đúng thứ tự
        // (`reserve` → `driver_refused` → `release`); việc trả chỗ nằm trong `finally` nên nó xảy
        // ra dù sự kiện có hỏng hay không.
        ghiSuKien({
          event: verdict.exhausted ? "driver_refused" : "refuse",
          detail: {
            reason: verdict.exhausted ? "driver-refused-after-ledger-gate" : "load-failed-not-vram",
            signal: verdict.signal,
            step: plan.step,
            attemptNo: plan.attemptNo,
            gpuLayers: plan.gpuLayers,
            leaseReleased: true,
            error: (err as Error)?.message ?? String(err),
            note: verdict.exhausted
              ? "cổng sổ ĐÃ CHO QUA nhưng driver vẫn từ chối ⇒ giấy phép được TRẢ NGAY. Không trả " +
                "thì sổ cộng dư VĨNH VIỄN (không commit, không release) và lượt xin kế tiếp bị từ " +
                "chối trên BYTE MA."
              : "lượt nạp hỏng vì lý do KHÔNG PHẢI hết VRAM (file hỏng, đường dẫn sai, …) ⇒ KHÔNG " +
                "thử lại, KHÔNG hạ số lớp: thử lại một file hỏng chỉ tốn thời gian và làm nhật ký " +
                "nói sai nguyên nhân. Giấy phép vẫn được trả.",
          },
        });
      } finally {
        traGiayPhep(ticket);
      }
      return { ok: false };
    }
  };

  const ketThucThanhCong = (
    value: T, ticket: VramTicket, plan: VramLoadPlan,
  ): VramLoadOutcome<T> => {
    const resolved = ganNhan(value);
    const cpuOnly = resolved === 0;
    const outcome: VramLoadOutcomeKind =
      plan.step === "degrade" ? "degraded" : plan.step === "retry" ? "loaded-after-retry" : "loaded";

    // BƯỚC 3 — và cũng là lá chắn cho ca "thành công mà thật ra đã suy biến" (0 lớp ở nấc ĐẦU).
    if (plan.step === "degrade" || cpuOnly) {
      ghiSuKien({
        event: "degraded",
        detail: {
          reason: plan.step === "degrade" ? "gpu-layers-lowered" : "zero-gpu-layers-on-success",
          step: plan.step,
          attemptNo: plan.attemptNo,
          requestedGpuLayers: soLopGoc,
          appliedGpuLayers: plan.gpuLayers,
          /** SỐ LỚP THẬT ĐÃ NẠP — đọc lại từ model, KHÔNG phải số đã xin. */
          gpuLayers: resolved,
          layerCountUnknown: resolved === null,
          cpuOnly,
          signal: tinHieuCuoi,
          note:
            "model đã nạp nhưng ở mức THẤP HƠN mức xin. `gpuLayers` ở đây là số lớp ĐỌC LẠI từ " +
            "LlamaModel.gpuLayers. cpuOnly=true nghĩa là 0 lớp trên GPU: suy luận chạy CPU, chậm " +
            "gấp bội — đây chính là suy biến mà `gpuLayers:-1` từng gây ra trong im lặng.",
        },
      });
    }
    return { value, ticket, outcome, plan, resolvedGpuLayers: resolved, attempts: attemptNo };
  };

  // ── Lượt ĐẦU ────────────────────────────────────────────────────────────────────────────────
  {
    const plan: VramLoadPlan = { gpuLayers: soLopGoc, step: "initial", attemptNo: ++attemptNo };
    const r = await chay(plan);
    if (r.ok) return ketThucThanhCong(r.value, r.ticket, plan);
    if (!classifyLoadFailure(loiCuoi).exhausted) throw loiCuoi;
  }

  // ── BƯỚC 2: thử lại `retries` lần, cách nhau `retryDelayMs` ──────────────────────────────────
  for (let i = 0; i < retries; i++) {
    const plan: VramLoadPlan = { gpuLayers: soLopGoc, step: "retry", attemptNo: attemptNo + 1 };
    ghiSuKien({
      event: "retry",
      detail: {
        reason: "non-deterministic-ceiling",
        step: "retry",
        attemptNo: plan.attemptNo,
        retryIndex: i + 1,
        retriesTotal: retries,
        delayMs: retryDelayMs,
        gpuLayers: plan.gpuLayers,
        signal: tinHieuCuoi,
        note:
          "trần thiết bị KHÔNG TẤT ĐỊNH: đo được 3 OK / 9 hỏng trên CÙNG một khối 16.698,37 MiB " +
          "trên máy rảnh (Ư7). Thử lại có số chống lưng, không phải mê tín. Giấy phép của lượt " +
          "trước đã TRẢ; lượt này mở giấy phép MỚI.",
      },
    });
    await giangLaiCho("retry", plan.attemptNo);
    await sleep(retryDelayMs);
    attemptNo++;
    const r = await chay(plan);
    if (r.ok) return ketThucThanhCong(r.value, r.ticket, plan);
    if (!classifyLoadFailure(loiCuoi).exhausted) throw loiCuoi;
  }

  // ── BƯỚC 3: hạ số lớp ───────────────────────────────────────────────────────────────────────
  if (coNacLui(soLopGoc)) {
    const plan: VramLoadPlan = { gpuLayers: "auto", step: "degrade", attemptNo: ++attemptNo };
    await giangLaiCho("degrade", plan.attemptNo);
    const r = await chay(plan);
    if (r.ok) return ketThucThanhCong(r.value, r.ticket, plan);
  } else {
    ghiSuKien({
      event: "refuse",
      detail: {
        reason: "no-degrade-available",
        requestedGpuLayers: soLopGoc,
        attempts: attemptNo,
        signal: tinHieuCuoi,
        note:
          "đã ở nấc ĐÁY (gpuLayers 'auto' hoặc 0) nên không còn gì để hạ. Ghi ra để nhật ký không " +
          "có một khoảng trống giữa lượt thử cuối và lượt từ chối — khoảng trống đó là thứ khiến " +
          "người đọc tưởng đường lùi ĐÃ chạy.",
      },
    });
  }

  // ── BƯỚC 4: từ chối trung thực ──────────────────────────────────────────────────────────────
  ghiSuKien({
    event: "refuse",
    detail: {
      reason: "all-outcomes-exhausted",
      attempts: attemptNo,
      retries,
      retryDelayMs,
      requestedGpuLayers: soLopGoc,
      signal: tinHieuCuoi,
      error: (loiCuoi as Error)?.message ?? String(loiCuoi),
      note:
        "hết cả bốn bước của §5.5: đã trả chỗ, đã thử lại, đã hạ số lớp (hoặc không còn nấc nào). " +
        "Ném lại NGUYÊN lỗi cuối cùng của driver — người gọi phải thấy đúng thứ driver nói, không " +
        "phải một lỗi do lớp này bịa ra. Câu chữ cho người dùng là việc của Task 4 (§5.3).",
    },
  });
  throw loiCuoi;
}
