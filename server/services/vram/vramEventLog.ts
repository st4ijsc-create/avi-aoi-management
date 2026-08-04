import type { VramEstimateSource, VramLeaseKind, VramPriority } from "./types";

/**
 * Nhật ký chỉ-ghi-thêm cho module điều phối VRAM (Pha 1 Task 2).
 * Sổ cái SỐNG nằm trong bộ nhớ (vramBroker.ts, Task 1) — module này chỉ GHI
 * LỊCH SỬ, không đọc lại, không quyết định gì. Nằm CẠNH đường cấp phát nên
 * `logVramEvent()` không bao giờ được chờ DB (xem test "KHÔNG chờ DB").
 */
export interface VramEventInput {
  /**
   * baseline | baseline_deferred | baseline_blocked | baseline_foreign_pid | reserve | commit |
   * commit_fallback | measure_failed | release | refuse | preempt | drift | adopt | defer |
   * defer_exceeded
   *
   * ⚠ `baseline_foreign_pid` (Pha 2B Task 1) = lượt chụp nền bị **TỪ CHỐI** vì có tiến trình chạy
   * ảnh thực thi CỦA HỆ nhưng NGOÀI cây tiến trình hiện tại (tàn dư sau khi server khởi động lại —
   * điển hình sidecar thị giác 7,8 GB). Chốt nền lúc đó là nuốt khối byte ấy vào nền vĩnh viễn và
   * phóng đại dư địa đúng bằng nó. Sự kiện mang `orphanHolders`/`thirdPartyHolders`/`ourHolders`
   * (pid + tên) và **KHÔNG mang byte của hộ mồ côi** — `nvidia-smi` trả `used_memory = [N/A]` trên
   * WDDM, nên ta biết AI mà không biết BAO NHIÊU. Ai đọc nhật ký thấy `baseline` biến mất một
   * quãng mà không biết sự kiện này sẽ tưởng reconciler đang chạy tốt trong khi nó đang MÙ.
   *
   * ⚠ `commit_fallback` (Pha 2A Task 4, T5-15) = giấy phép được chốt sổ bằng **ƯỚC LƯỢNG DỰ
   * PHÒNG** sau khi phép đo hỏng, cho khối byte mà điểm gọi chắc chắn đang tồn tại (backend
   * CUDA). Ai đọc nhật ký theo danh sách này mà thiếu nó sẽ thấy một `measure_failed` rồi KHÔNG
   * thấy `commit` nào và kết luận sai rằng giấy phép đó còn treo — trong khi sổ đã chốt. Đây là
   * sự kiện DUY NHẤT mang `estimateSource: "fallback-after-measure-failure"`, và con số
   * `actualBytes` của nó **KHÔNG PHẢI SỐ ĐO** (`detail.measured = false`).
   *
   * ⚠ `baseline_deferred` / `baseline_blocked` (Pha 1.5 Task 7 / T5-1) = lượt chụp nền bị HOÃN vì
   * còn giấy phép ĐANG NẠP (byte đã lên thiết bị, chưa vào sổ ⇒ mọi công thức đều sai trong cửa
   * sổ đó), và lượt đối chiếu phải BÁO ĐỘNG vì đã hoãn quá lâu. Ai đọc nhật ký thấy một khoảng
   * TRỐNG sự kiện `drift` mà không biết hai sự kiện này sẽ tưởng reconciler đang chạy tốt trong
   * khi nó đang MÙ. `baseline_deferred` của một lượt RESAMPLE mang theo nền CŨ + `driftIfNotResampled`
   * — dấu vết EXP-2 vẫn còn nguyên dù lượt chụp không thành.
   *
   * ⚠ `baseline` (Task 5 review vòng 2, NEW-4) = ảnh chụp NỀN THIẾT BỊ lúc khởi động
   * (`nền = thiết bị − sổ`, xem `vramReconciler.captureVramBaseline`). Ai đọc nhật ký theo danh
   * sách này mà thiếu `baseline` sẽ đọc `drift` mà không biết nó đã được trừ đi bao nhiêu.
   *
   * ⚠ `measure_failed` (review TOÀN NHÁNH, I-2) = delta đo được ÂM ⇒ phép đo vô nghĩa ⇒ giấy
   * phép giữ ƯỚC LƯỢNG **vĩnh viễn**. Trước lượt vá này nhánh đó `return` IM LẶNG tuyệt đối —
   * không sự kiện, không dấu vết — nên một nguồn lệch ÂM dai dẳng là VÔ HÌNH với Task 7.
   *
   * ★★ Pha 2B Task 3 — NĂM LOẠI MỚI, một loại cho MỖI bước của §5.5 (`vramLoadOutcome.ts`).
   * Ai đọc nhật ký mà không biết chúng sẽ thấy một `reserve` rồi KHÔNG thấy `commit` nào và
   * tưởng giấy phép còn treo — trong khi thật ra driver đã từ chối và sổ đã được trả chỗ:
   *   • `driver_refused` — **bước 1**: cổng sổ ĐÃ CHO QUA nhưng driver vẫn từ chối lượt cấp phát.
   *     Giấy phép được TRẢ NGAY trong cùng lời gọi (`detail.leaseReleased`), vì driver từ chối mà
   *     lease còn treo thì sổ cộng dư VĨNH VIỄN và lượt xin kế tiếp bị từ chối trên **byte ma**.
   *   • `retry` — **bước 2**: sắp thử lại sau `detail.delayMs`. Thử lại KHÔNG phải mê tín: trần
   *     đo được là KHÔNG TẤT ĐỊNH (3 OK / 9 hỏng trên cùng một khối 16.698,37 MiB, máy rảnh).
   *   • `degraded` — **bước 3**: nạp được nhưng ở mức THẤP HƠN yêu cầu. `detail.gpuLayers` là
   *     **số lớp THẬT đã nạp** đọc lại từ đối tượng model, KHÔNG phải số đã xin.
   *     `detail.cpuOnly = true` ⇒ 0 lớp trên GPU (chậm gấp bội) — đây chính là suy biến im lặng
   *     mà `gpuLayers: -1` từng tạo ra, nay có tiếng.
   *   • `refuse` — **bước 4**: từ chối trung thực, đã hết mọi nấc. (Đã có sẵn trong từ vựng §5.3.)
   *   • `warm_failed` — lượt warm lúc khởi động (`aiGgufEngine.warmModel`) trả `false` vì một
   *     THẤT BẠI THẬT (`generate-threw` — nhánh Ư0 cần — hoặc `availability-probe-threw`). Trước
   *     Pha 2B nhánh đó là `catch {}` NUỐT TRỌN: `0/24` log của Ư0 không có dấu vết nào của nó.
   *   • `warm_skipped` (M-5, review vòng 1) — `warmModel` trả `false` vì **KHÔNG CẤU HÌNH GGUF**
   *     (`gguf-unavailable`). ⚠ TÁCH khỏi `warm_failed` CÓ CHỦ Ý: một cài đặt cố ý không dùng GGUF
   *     ghi một dòng **mỗi lần khởi động**, và gộp nó vào "failed" là bắt Task 7 lọc rác trong
   *     chính bảng nó dùng để ĐẾM THẤT BẠI. Vẫn phải có sự kiện (người gọi vẫn nhận `false`, nên
   *     vẫn phải phân biệt được với hai nhánh kia) — chỉ khác TÊN.
   *
   * ★ I-1 (review vòng 1) — `driver_refused`/`refuse` cũng đến từ **NGOÀI** §5.5
   * (`vramLoadOutcome.noteVramAllocationFailure`), phân biệt bằng `detail.reason`:
   * `driver-refused-outside-load-outcomes` / `allocation-failed-not-vram`, kèm `detail.site` nói
   * đích danh đường nào (`loadGgufModel.createContext` · `ensureTextContext.createContext` ·
   * `getEmbeddingContext.createEmbeddingContext` · `loadGgufModel.fallbackNoRunner`). Bốn đường
   * này KHÔNG thử lại và KHÔNG hạ số lớp — ai đọc nhật ký đừng đi tìm một `retry` không bao giờ tới.
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
/** M-4 — số sự kiện bị VỨT vì hàng đợi đầy, chưa được khai vào sự kiện nào. */
let soSuKienBiVut = 0;

/**
 * ★★★ Pha 2B Task 3 (bàn giao N-2 của Task 2) — HAI BẪY IM LẶNG CỦA CHÍNH ỐNG DẪN NÀY.
 *
 * Task 2 chọn `-Infinity` làm giá trị fail-closed của `computeHeadroom()`. Kiểm trên schema THẬT
 * (`drizzle/schema/vram.ts:30-48`) cho ra hai đường mất dữ liệu, cả hai đều KHÔNG kêu:
 *
 *   1. **Năm cột byte là `bigint(mode:"number")`.** Một `-Infinity`/`NaN` đi tới đó thành chuỗi
 *      `"-Infinity"`/`"NaN"` trên dây, Postgres ném `22P02`. Vì `flushVramEvents()` ghi **MỘT LÔ
 *      nhiều dòng**, một sự kiện hỏng làm **MẤT TOÀN BỘ LÔ** — `catch` bên dưới nuốt và chỉ để
 *      lại một dòng `console.warn`. Đây ĐÚNG tiền lệ đã trả giá một lần rồi:
 *      `estimateSource` từng là `varchar(16)` trong khi `"fallback-after-measure-failure"` dài 30
 *      ⇒ `22001` ⇒ mất cả lô (migration 0311).
 *   2. **`detail` là `jsonb`.** `JSON.stringify(-Infinity)` cho `null` — con số **biến mất IM
 *      LẶNG**, dòng vẫn ghi thành công, và người đọc nhật ký thấy `null` thì tưởng "không có số".
 *
 * ⇒ Task 3 là task ghi nhiều sự kiện nhất từ trước tới nay (5 loại mới, mỗi bước một dòng). **Một
 * cơ chế chống-im-lặng mà tự nó im lặng thì tệ hơn không có.** Nên hàng rào đặt ở ĐÂY — cửa vào
 * DUY NHẤT của hàng đợi (`queue.push` chỉ xuất hiện trong `logVramEvent`) — chứ không ở từng điểm
 * sản xuất: 20 điểm gọi hôm nay, và mọi điểm gọi của Task 4/5/6/7 sau này, đều đi qua đây.
 *
 * ⚠ BỘ LÀM SẠCH KHÔNG VỨT SỰ KIỆN NÀO. (Câu này nói về BỘ LÀM SẠCH, không phải về cả hàm: cửa
 * `queue.length >= QUEUE_MAX` bên dưới **có** vứt — nay có đếm và có tiếng, xem M-4 tại chỗ.)
 * Giá trị không hữu hạn bị THAY, và chỗ nó từng ở được GHI TÊN
 * (`detail.nonFiniteFields` / `detail.truncatedFields`). Vứt dòng đi là đổi một lỗi im lặng lấy
 * một lỗi im lặng khác.
 * ⚠ Trong `detail`, giá trị thay thế là **CHUỖI** `"-Infinity"`/`"Infinity"`/`"NaN"` chứ không
 * phải `null`: `null` không phân biệt được với "không có số", mà phân biệt được chính là mục đích.
 */
const NUMERIC_COLUMNS = [
  "estimatedBytes", "actualBytes", "deviceUsedBytes", "ledgerTotalBytes", "driftBytes",
] as const;

/**
 * Độ rộng THẬT của các cột `varchar` trong `drizzle/schema/vram.ts`. Vượt ⇒ Postgres `22001` ⇒
 * MẤT CẢ LÔ, cùng một lớp lỗi với bẫy số. Ai đổi schema phải đổi bảng này (test canh hai bảng khớp).
 */
const VARCHAR_LIMITS: ReadonlyArray<readonly [keyof VramEventInput, number]> = [
  ["event", 24], ["owner", 160], ["leaseKind", 32], ["priority", 16], ["estimateSource", 48],
];

const MAX_DETAIL_DEPTH = 8;

function nonFiniteLabel(v: number): "NaN" | "Infinity" | "-Infinity" {
  return Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
}

/**
 * ⚠⚠ M-1 (review vòng 1) — `dangDi` LÀ TẬP **ĐƯỜNG ĐI**, KHÔNG PHẢI TẬP **ĐÃ THĂM**.
 *
 * Bản đầu dùng một visited-set và **không bao giờ xoá**. Hệ quả đo được: một object DÙNG CHUNG
 * (DAG — hai khoá cùng trỏ một object, **không hề có vòng**) bị bỏ qua ở lần gặp THỨ HAI ⇒
 * `-Infinity` ở nhánh đó **thành `null` im lặng VÀ không được ghi tên**:
 *
 *     detail = { x: shared, y: shared }, shared = { headroomBytes: -Infinity }
 *     ⇒ {"x":{"headroomBytes":"-Infinity"}, "y":{"headroomBytes":null}}   ← y MẤT SỐ, KHÔNG ai biết
 *
 * Tức chính bộ làm sạch chống-im-lặng tự đẻ ra một đường im lặng. Xoá khỏi tập sau khi đệ quy
 * xong biến nó thành path-set: **vòng** vẫn bị chặn (nút còn nằm trên đường đi hiện tại), **dùng
 * chung** thì được làm sạch đủ mọi lần.
 *
 * ⚠ M-2 — CHẠM TRẦN ĐỘ SÂU CŨNG PHẢI KÊU. Trần là đúng (chống nổ ngăn xếp), nhưng cắt mà không nói
 * thì lại đúng lớp lỗi đang diệt: `detail` lồng 11 tầng có `-Infinity` ở đáy từng cho
 * `nonFiniteFields === undefined` và một `null` không giải thích được trong jsonb.
 */
function scrubDetail(
  value: unknown, path: string, found: string[], depth: number, dangDi: Set<object>,
): unknown {
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    found.push(`detail.${path}=${nonFiniteLabel(value)}`);
    return nonFiniteLabel(value);
  }
  if (value === null || typeof value !== "object") return value;
  // Date/Map/Set/Buffer… — KHÔNG bóc: `Object.entries(new Date())` là `[]`, bóc ra là XOÁ dữ liệu.
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return value;
  if (dangDi.has(value as object)) {
    found.push(`detail.${path}=<vòng, không duyệt tiếp>`);
    return value;
  }
  if (depth >= MAX_DETAIL_DEPTH) {
    found.push(`detail.${path}=<sâu quá ${MAX_DETAIL_DEPTH} tầng, KHÔNG làm sạch>`);
    return value;
  }
  dangDi.add(value as object);
  try {
    if (Array.isArray(value)) {
      return value.map((v, i) => scrubDetail(v, `${path}[${i}]`, found, depth + 1, dangDi));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubDetail(v, path ? `${path}.${k}` : k, found, depth + 1, dangDi);
    }
    return out;
  } finally {
    dangDi.delete(value as object);
  }
}

/**
 * Làm sạch MỘT sự kiện trước khi vào hàng đợi. Thuần, không I/O, KHÔNG BAO GIỜ ném.
 * Export để test gọi thẳng (và để Task 4/5 dùng lại nếu cần ghi ra đường khác).
 */
export function sanitizeVramEvent(e: VramEventInput): VramEventInput {
  const nonFinite: string[] = [];
  const truncated: string[] = [];
  const out = { ...e } as Record<string, unknown>;

  for (const field of NUMERIC_COLUMNS) {
    const v = out[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      nonFinite.push(`${field}=${typeof v === "number" ? nonFiniteLabel(v) : String(v)}`);
      // `undefined` ⇒ `flushVramEvents()` ghi `null`: ô TRỐNG có lý do kèm bên `detail`,
      // thay vì một lô 5.000 dòng bốc hơi.
      out[field] = undefined;
    }
  }

  for (const [field, max] of VARCHAR_LIMITS) {
    const v = out[field as string];
    if (typeof v !== "string" || v.length <= max) continue;
    truncated.push(`${String(field)}: ${v.length}>${max}`);
    out[field as string] = v.slice(0, max);
  }

  let detail = e.detail;
  if (detail !== undefined && detail !== null) {
    detail = scrubDetail(detail, "", nonFinite, 0, new Set<object>()) as Record<string, unknown>;
  }
  if (nonFinite.length > 0 || truncated.length > 0) {
    detail = { ...(detail ?? {}) };
    if (nonFinite.length > 0) (detail as Record<string, unknown>).nonFiniteFields = nonFinite;
    if (truncated.length > 0) (detail as Record<string, unknown>).truncatedFields = truncated;
  }
  out.detail = detail;
  return out as unknown as VramEventInput;
}

/**
 * Xếp hàng rồi trả về NGAY — KHÔNG BAO GIỜ chờ DB. Hàm này nằm cạnh đường
 * cấp phát (reserve/commit/release của vramBroker); có test canh bằng mock
 * `insert` và assert chưa được gọi khi hàm này return.
 *
 * ⚠ Pha 2B Task 3 — CỬA VÀO DUY NHẤT của hàng đợi, nên cũng là chỗ duy nhất phải làm sạch
 * (xem khối `NUMERIC_COLUMNS` bên trên). Người sau thêm một đường `queue.push` thứ hai ở đâu đó
 * là mở lại cả hai bẫy.
 */
export function logVramEvent(e: VramEventInput): void {
  if (queue.length >= QUEUE_MAX) {
    /**
     * ⚠⚠ M-4 (review vòng 1) — CỬA VỨT SỰ KIỆN, VÀ NÓ TỪNG IM LẶNG TUYỆT ĐỐI.
     *
     * Có từ trước Task 3, nhưng Task 3 **nhân sản lượng sự kiện lên ~4 lần cho mỗi lượt nạp hỏng**
     * (`driver_refused` ×4 + `retry` ×2 + `refuse`), nên ngưỡng 5.000 gần hơn hẳn. Và docstring
     * của chính bản vá này viết *"KHÔNG VỨT SỰ KIỆN"* — câu đó **không đúng** cho đúng cửa này.
     *
     * KHÔNG nới `QUEUE_MAX` (thà mất telemetry còn hơn phình bộ nhớ khi DB gián đoạn kéo dài —
     * chính sách cũ, giữ nguyên). Chỉ ĐẾM, và số đó **đi theo sự kiện kế tiếp ghi được**
     * (`detail.droppedBeforeThis`) nên nó truy được bằng SQL, không phải chỉ nằm trong bộ nhớ.
     */
    soSuKienBiVut++;
    if (soSuKienBiVut === 1 || soSuKienBiVut % QUEUE_MAX === 0) {
      console.warn(
        `[vram] hàng đợi sự kiện ĐẦY (${QUEUE_MAX}) ⇒ đã VỨT ${soSuKienBiVut} sự kiện. ` +
          `Nhật ký VRAM đang THỦNG — mọi truy vấn của Task 7 trên quãng này đều thiếu.`,
      );
    }
    return;
  }
  let safe: VramEventInput;
  try {
    safe = sanitizeVramEvent(e);
  } catch {
    // Làm sạch hỏng thì vẫn phải giữ sự kiện — mất telemetry là thứ đang đi vá, không phải công cụ.
    safe = e;
  }
  if (soSuKienBiVut > 0) {
    // Đính vào sự kiện ĐẦU TIÊN ghi được sau quãng thủng, rồi đặt lại. Không có chỗ nào khác để
    // nói ra: các sự kiện bị vứt không tồn tại, nên chúng chỉ đếm được từ phía sự kiện còn sống.
    safe = { ...safe, detail: { ...(safe.detail ?? {}), droppedBeforeThis: soSuKienBiVut } };
    soSuKienBiVut = 0;
  }
  queue.push(safe);
}

/** M-4 — số sự kiện bị vứt kể từ lần cuối có sự kiện ghi được. Test canh trực tiếp. */
export function __vramDroppedEventCount(): number {
  return soSuKienBiVut;
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
