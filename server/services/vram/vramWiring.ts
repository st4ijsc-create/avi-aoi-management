import type { VramLease, VramLeaseKind, VramMeasureSource, VramPriority, VramReclaimerId } from "./types";
/**
 * ★★ Pha 2B Task 3 — BA CỬA `await import()` CỦA `beginVramAllocation()` ĐÃ THÀNH IMPORT TĨNH.
 *
 * Bàn giao của Task 2 (S2/§6.2) viết: *"ba cửa ấy nay CÓ TIẾNG, KHÔNG phải ĐÃ ĐÓNG"* — một lỗi
 * nạp `./vramBroker` | `./vramEstimator` | `./vramEventLog` vẫn rơi vào `catch` cuối hàm và biến
 * thành `NOOP_TICKET`, tức **cưỡng chế tắt + sổ hụt**, lẫn lộn với mọi lỗi khác của cùng cái `try`.
 *
 * VÌ SAO ĐỔI SANG TĨNH ĐÓNG ĐƯỢC **NỬA IM LẶNG** (và chỉ nửa đó — xem cảnh báo cuối khối):
 *   1. **Tách hai lớp lỗi từng dùng chung MỘT cửa.** Trước: "module telemetry không nạp được" và
 *      "`broker.reserve()` ném" cho ra CÙNG một dòng `console.warn`, cùng một `NOOP_TICKET` —
 *      người trực không có cách nào biết mình đang gặp cái nào. Nay lỗi nạp module nổ khi
 *      `vramWiring` được ĐÁNH GIÁ, ở một chỗ khác hẳn, với một câu khác hẳn.
 *   2. **Một cửa thay vì ba**, và nó là cửa mà `aiGgufEngine.beginVram()` đã bọc sẵn — nơi Task 3
 *      vừa thêm tiếng (`catch` đó trước đây RỖNG TUYỆT ĐỐI).
 *   3. Bốn module này ở CÙNG thư mục, chỉ `import type` lẫn nhau (`vramBroker`/`vramEstimator`/
 *      `vramEventLog` đều chỉ import `./types`) ⇒ **không có vòng import** để lo.
 *
 * ⚠⚠ **KHÔNG ĐÓNG ĐƯỢC** phần "sổ hụt + cưỡng chế tắt": muốn đóng thì `beginVramAllocation()` phải
 * **TỪ CHỐI** lượt cấp phát khi sổ hỏng thay vì cho qua — mà đó đúng là cái công tắc cưỡng chế,
 * **quyết định của Task 5**, và file này có chính sách ngược lại từ Pha 1 (*"telemetry chết thì hệ
 * vẫn phải nạp được model"*). Task 3 chỉ được phép làm cho nó KHÔNG CÂM.
 */
import * as broker from "./vramBroker";
import * as estimator from "./vramEstimator";
import { logVramEvent } from "./vramEventLog";
/**
 * ★★★ Pha 2B Task 5 — HAI CỬA CUỐI CỦA ĐƯỜNG CƯỠNG CHẾ, cả hai đều là import TĨNH và cả hai đều là
 * **module LÁ** (không I/O, không trạng thái ngoài một ô nhớ):
 *   • `vramTickCell` — ô tick, nguồn số của quyết định. ⚠ CỐ Ý **không** nhập `./vramReconciler`:
 *     nó nhập TĨNH `./vramBroker` (vòng nhập), và nó kéo theo I/O + đồng hồ vào đường nhập của mọi
 *     file test đang thay `./vramBroker` bằng bản giả.
 *   • `vramRefusal` — lớp lỗi `VramRefusedError`. Từ task này nó **ĐƯỢC NÉM THẬT**.
 */
import { readDecisionTick } from "./vramTickCell";
import { VramRefusedError } from "./vramRefusal";

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
 * **không một lời gọi `.release()` nào lên một `ort.InferenceSession` CÓ KHẢ NĂNG GPU.**
 *
 * ⚠⚠ I-2 (review TOÀN NHÁNH) — CÂU NÀY TRƯỚC ĐÂY VIẾT RỘNG HƠN SỰ THẬT ("reviewer grep toàn repo:
 * KHÔNG MỘT lời gọi `.release()` nào lên `ort.InferenceSession`") và ĐÍNH CHÍNH lại nằm ở một FILE
 * KHÁC (`vramAllocationSites.ts`), nơi người đọc dòng này không bao giờ tới. Sự thật:
 * `server/services/aiLocalTraining.ts` có **NĂM** lời gọi (`:332`, `:504`, `:765`, `:889`, `:954`).
 * Kết luận `releaseProof: "unverified"` **KHÔNG ĐỔI** — cả bốn session của file đó ghim
 * `executionProviders: ["cpu"]` nên chúng không phải hộ VRAM, và đường ONNX GPU (`aiInferenceEngine`
 * / `aiImageEmbedding` / `ocrService`) vẫn không có lời gọi nào. Nhưng một lập luận chống lưng
 * bằng một câu SAI thì vẫn là lập luận hỏng, và đây đúng lớp lỗi mà pha này tự đặt ra để diệt.
 *
 * Đuổi khỏi cache chỉ gỡ tham chiếu JS; bộ nhớ native của onnxruntime chỉ chắc chắn được trả khi
 * `session.release()` chạy. Thêm lời gọi đó Ở ĐÂY sẽ giải phóng bộ nhớ native NGAY DƯỚI CHÂN một
 * `session.run` đang bay: `getSession()` KHÔNG có khoá in-flight (aiInferenceEngine.ts:245-251) và
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
  /**
   * ★★★ Pha 2B Task 5 (§5.2) — KHAI SỐ NGƯỜI ĐANG DÙNG khối byte này. `0` = **NHÀN RỖI** ⇒ giấy
   * phép trở thành ứng viên nhường chỗ. KHÔNG BAO GIỜ ném.
   *
   * ⚠ Mặc định của một giấy phép mới là **ĐANG DÙNG** (`refCount = 1`), nên KHÔNG gọi hàm này là
   * một câu trả lời hợp lệ và AN TOÀN: không ai thu hồi được nó. Hôm nay có đúng MỘT hộ tiêu thụ
   * gọi tới — `aiGgufEngine` đồng bộ `LoadedModel.refCount` (đúng bộ đếm mà `evictLRU()` cũ dùng
   * làm điều kiện đuổi) — nên **cơ chế nhường chỗ chỉ THẬT SỰ có ứng viên ở đường GGUF**. Mọi hộ
   * khác (ONNX, sidecar, trainer) sẽ luôn hiện ra là "đang dùng", tức lượt xin bị TỪ CHỐI thay vì
   * lấy chỗ của chúng. Đó là chiều an toàn, và nó được khai thẳng ở đây thay vì để người sau đọc
   * mã mới biết.
   */
  noteRefCount(refCount: number): void;
}

/** Giấy phép "rỗng" khi telemetry hỏng — mọi lời gọi đều là no-op. */
const NOOP_TICKET: VramTicket = {
  commitMeasured: async () => {},
  release: () => {},
  noteRefCount: () => {},
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
 *   PHỦ: mọi hộ tiêu thụ đi qua `beginVramAllocation()` (**14** điểm gọi trong repo — con số này
 *        đã sai HAI lần: "12" (thiếu `aiLlmFinetuneSidecar`) rồi "13" (thiếu `cuda-backend:reranker`
 *        do chính lượt vá I-1 thêm). **ĐẾM LẠI bằng `git grep beginVramAllocation`, đừng cộng dồn
 *        con số cũ**; bảng đầy đủ ở docstring `captureVramBaseline()` trong `vramReconciler.ts`),
 *        kể cả các hộ
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
/**
 * ★★★ PHA 2A TASK 3 — HAI THAY ĐỔI ĐỐI VỚI KHỐI TRÊN. Đọc trước khi sửa bất cứ dòng nào dưới đây.
 *
 * ĐIỀU GÌ ĐÃ ĐỔI: `actualBytes` KHÔNG còn đo bằng `used` TOÀN THIẾT BỊ nữa. Hai đầu đo nay đọc bộ
 * đếm `\GPU Process Memory` THEO TIẾN TRÌNH (`vramProcessProbe.readProcessVram`). Vì bộ đếm trả số
 * RIÊNG cho từng PID, hai lượt cấp phát ở HAI TIẾN TRÌNH khác nhau KHÔNG còn làm bẩn phép đo của
 * nhau — đó chính là cổng T5-11 mà Pha 1.5 không gỡ được. Lý do (c) ở khối docstring bên trên
 * ("không tách được phần nào của ai") ĐÚNG với thước cũ và HẾT ĐÚNG với thước mới, nhưng CHỈ khi
 * hai cửa sổ nằm ở hai PHẠM VI ĐO khác nhau.
 *
 * PHẠM VI ĐO (`VramMeasureScope`) — hai giá trị, KHÔNG phải ba, và ranh giới là ranh giới VẬT LÝ
 * của bộ đếm:
 *   • `"self"`        — `byPid[process.pid]`: byte của CHÍNH tiến trình này, KHÔNG gồm tiến trình
 *                       con. Dùng cho mọi hộ TRONG tiến trình (gguf-*, onnx-session).
 *   • `"descendants"` — `totalBytes − byPid[process.pid]` trên cây gốc `process.pid`: byte của
 *                       TOÀN BỘ tiến trình con/cháu, KHÔNG gồm tiến trình này. Dùng cho hộ NGOÀI
 *                       tiến trình (`external-process`). Cộng theo CÂY là bắt buộc (Đ2): với
 *                       `spawn(..., { shell: true })` kẻ cấp phát thật là tiến trình CHÁU.
 *
 * Hai phạm vi này RỜI NHAU theo cấu trúc (một PID chỉ thuộc đúng một bên), nên:
 *   1. một cửa sổ `self` và một cửa sổ `descendants` chồng nhau về THỜI GIAN vẫn cho HAI con số
 *      đúng — vì thế `overlappedBy` chỉ ghi nhận các cửa sổ CÙNG PHẠM VI;
 *   2. chỉ phạm vi `self` mới cần NỐI TIẾP HOÁ (`withMeasureWindow`, điều kiện Đ1): bộ đếm trả
 *      MỘT số cho `process.pid` nên hai lượt nạp trong tiến trình này không tách được.
 *
 * ⚠⚠ VÌ SAO `descendants` **KHÔNG** LẤY KHOÁ NỐI TIẾP — lý do (2) của khối docstring bên trên vẫn
 * còn nguyên giá trị và nay được TÔN TRỌNG thay vì bị bỏ qua: BA điểm gọi (`kbSyncScheduler` ×2,
 * `localSidecarTrainer`, `aiLlmFinetuneSidecar`) CỐ Ý không bao giờ gọi `commitMeasured()`, nên
 * cửa sổ của chúng mở tới tận `release()` — tức tới lúc JOB HUẤN LUYỆN kết thúc, hàng chục phút.
 * Cho chúng giữ khoá nối tiếp là để MỌI lượt nạp model của cả tiến trình phải chờ hết ngân sách
 * (180 s) rồi mới chạy, SUỐT cả job. Đó là đổi hành vi cấp phát — thứ Pha 2A tự cấm mình làm.
 * Đổi lại, hai cửa sổ `descendants` chồng nhau (vd. sidecar thị giác spawn giữa lúc cron kb-sync
 * đang chạy) vẫn bị BẮT bằng `overlappedBy` và khai `measureFailed` — tức phạm vi này có LƯỚI
 * PHÁT HIỆN nhưng không có LƯỚI NỐI TIẾP. Nói đúng như vậy, đừng nói rộng hơn.
 *
 * ⚠ HỆ QUẢ CHO SỔ NÀY (câu hỏi mà Task 2 giao lại cho Task 3): với phạm vi `self`, nối tiếp hoá
 * khiến hai cửa sổ KHÔNG BAO GIỜ chồng nhau ⇒ `overlappedBy` LUÔN RỖNG. Sổ này vì thế trở thành
 * ĐỐI CHỨNG ĐỘC LẬP với khoá — nó nổ đúng khi nối tiếp hoá bị bỏ qua (hết ngân sách chờ ⇒
 * `measurable === false`, hoặc ai đó gọi thẳng đường đo không qua khoá). **KHÔNG XOÁ nó**: một
 * lưới không bao giờ nổ và một lưới đã hỏng trông giống hệt nhau, nên `wiring.processProbe.test.ts`
 * có ca cố ý bỏ qua nối tiếp hoá và đòi sổ này VẪN NỔ.
 */
type VramMeasureScope = "self" | "descendants";

/**
 * ★★★ C-1 (review TOÀN NHÁNH) — LƯỢT **NHẢ** XEN GIỮA HAI ĐẦU ĐO. Đọc trước khi sửa `release()`.
 *
 * LỖI ĐANG VÁ, và nó ở ĐÚNG CHIỀU NGUY HIỂM: khoá `withMeasureWindow` nối tiếp hoá các lượt
 * **CẤP PHÁT** đi qua `beginVramAllocation()`. Nó **KHÔNG** nối tiếp hoá các lượt **NHẢ**.
 * `ticket.release()` không lấy khoá, không mở cửa sổ. Ba đường nhả chạy hoàn toàn ngoài khoá:
 *   1. `ensureCapacity()` chạy **TRƯỚC** `beginVram()` (`aiGgufEngine.ts:844` so với `:851`) ⇒ lượt
 *      nạp model B gọi `evictLRU()` → `unloadGgufModel(A)` → `dispose()` **trước khi** B xếp hàng
 *      vào khoá, tức B có thể giải phóng 17 GB NGAY GIỮA hai đầu đo của C;
 *   2. `unloadGgufModel()` qua HTTP (`server/routers/aiGgufRouter.ts:73`), bất kỳ lúc nào;
 *   3. `while (await evictLRU())` của nhánh OOM-retry (`aiGgufEngine.ts:885`), nằm TRONG chính
 *      cửa sổ của nó.
 *
 * Hậu quả: `actual = after − beforeUsed` bị **TRỪ ĐI** phần vừa được nhả.
 *   • nhả **NHIỀU HƠN** cấp ⇒ delta ÂM ⇒ nhánh `actual < 0` BẮT ĐƯỢC;
 *   • nhả **ÍT HƠN** cấp ⇒ delta **DƯƠNG-NHƯNG-HỤT** ⇒ trước bản vá này **KHÔNG lưới nào bắt**:
 *     `overlappedBy` rỗng (nhả không mở cửa sổ), `measurable === true` (bộ đếm của khoá chỉ đếm
 *     lượt BỎ CUỘC, `vramMeasureLock.ts` — không đếm lượt nhả), `seen === true`, `actual > 0`.
 *     Hệ `commit()` + `recordActual()` một con số HỤT và khai `measureSource: "process-delta"`,
 *     `measureFailed: false` — **một phép đo hỏng TỰ KHAI LÀ THÀNH CÔNG**.
 * ĐO ĐƯỢC 3/3 trên mã sản xuất (reviewer): cấp 4 GiB + nhả 1 GiB ⇒ sổ ghi 3 GiB, `measureFailed`
 * falsy, và `estimateBytesFor()` trả `{ bytes: 3 GiB, source: "learned" }` — nấc `learned` bị
 * **đóng đinh HỤT tới hết đời tiến trình**. Ở Pha 2B, `learned` hụt ⇒ `headroom` phóng đại ⇒
 * KHÔNG BAO GIỜ từ chối ⇒ OOM. Nhánh delta-âm chỉ phủ NỬA lớp lỗi này.
 *
 * ⚠⚠ BẢN VÁ **KHÔNG CHẶN** LƯỢT NHẢ — điều lệ Pha 2A cấm đổi hành vi cấp phát/nhả, và chặn một
 * lượt `evictLRU()` để giữ một phép đo là đánh đổi sai (đúng lý lẽ đã ghi ở khối `OpenMeasureWindow`
 * bên trên cho phương án (a)). Nó chỉ làm phép đo **TRUNG THỰC**: một lượt nhả xảy ra TRONG khi
 * một cửa sổ CÙNG PHẠM VI còn mở ⇒ cửa sổ đó `markMeasureFailed()` và thoát **TRƯỚC**
 * `broker.commit()`/`estimator.recordActual()` — đúng khuôn các nhánh thoát đo-hỏng đã có.
 * Đổi "sai LẶNG LẼ" thành "hỏng TRUNG THỰC".
 *
 * ⚠ DÙNG LẠI `openMeasureWindows`, KHÔNG dựng sổ thứ ba: cùng vòng đời, cùng `closeWindow()`,
 * cùng bảy nhánh thoát. Một sổ thứ ba là một dân số nữa phải kiểm lại ở mọi vị từ dùng chung —
 * đúng lớp lỗi đã đẻ ba Critical liên tiếp ở Pha 1.5.
 *
 * ⚠ CHỈ CÙNG PHẠM VI, cùng lý lẽ với `overlappedBy`: `self` và `descendants` đọc hai tập PID RỜI
 * NHAU, nên byte một tiến trình con vừa trả lại KHÔNG THỂ xuất hiện trong hiệu số của `self`.
 *
 * ★★ RÀNG BUỘC TOÀN CỤC 6 — BẢN VÁ NÀY ĐỔI **DÂN SỐ** CỦA `measureFailed`, nên MỌI vị từ dùng
 * chung phải được kiểm lại (lớp lỗi này đã đẻ BA Critical liên tiếp ở Pha 1.5 và tái diễn một lần
 * trong chính Pha 2A). Đã kiểm TỪNG nơi tiêu thụ, 2026-08-04:
 *
 * | Vị từ / ô | Dân số có đổi? | Kết luận |
 * |---|---|---|
 * | `isLoadingLease()` = `actualBytes===null && !measureFailed` (`pendingBytes` · "ứng viên số một" của cảnh báo lệch ÂM) | **KHÔNG** | trước bản vá lease này rời vị từ vì `actualBytes` được điền; nay rời vì `measureFailed` — vào/ra y hệt. |
 * | `holdsUncommittedBytes()` = `actualBytes===null` (lá chắn HOÃN chụp nền · `blockingOwners`) | **CÓ — TĂNG** | và phải tăng: giấy phép này ĐANG giữ byte thật mà đóng góp 0 vào `committedBytes`. Tự lành đúng như nhánh `overlappedBy` của Task 8: `gguf-model`/`onnx-session` rời sổ ở `release()`; `gguf-backend` (không có đường release) rời vị từ nhờ `chotSoBangDuPhong()` — vì thế nhánh mới BẮT BUỘC gọi nó. `BASELINE_BLOCKED_ALARM_MS` (Task 7) là lưới đã dựng sẵn cho đúng ca này. |
 * | `leaseBytes()` = `actualBytes ?? estimatedBytes` | **CÓ** — nay trả ƯỚC LƯỢNG thay cho một số đo HỤT | đúng hướng: một ước lượng ĐƯỢC GẮN CỜ rẻ hơn một số đo sai ĐƯỢC TIN. Cùng đánh đổi đã cân ở năm nhánh đo-hỏng trước. |
 * | `splitLedgerByMeasureSource()` | **CÓ** — chuyển từ nhóm `processDelta` sang `estimated` | `vramReconciler.ts:605` đã có nhánh `measureSource === "none"` từ Task 4; ba nhóm vẫn là một PHÂN HOẠCH. |
 * | `measureFailed` (hàng rào của `commitFallback()`) | **CÓ — TĂNG** | hàng rào đòi `measureFailed === true`; nhánh mới gọi `markMeasureFailed()` TRƯỚC `chotSoBangDuPhong()` ⇒ thoả. Ca 7 của `wiring.releaseWindow.test.ts` canh. |
 * | `fallbackReason` | **CÓ** — thêm giá trị `"release-during-measure-window"` | vòng đời KÍN, vẫn ĐÚNG 2 writer (`commitFallback` đặt, `commit` xoá). |
 * | `measurable` (bộ đếm của `vramMeasureLock`) | **KHÔNG** | bản vá KHÔNG chạm khoá; nó CỐ Ý dùng một sổ khác, vì `measurable` đo "có lượt CẤP PHÁT không-đo chạy xen", không đo lượt nhả. |
 * | `seen` (`ScopeReading`) | **KHÔNG** | không đường nào ở đây chạm đầu dò. |
 * | `openMeasureWindows` (`overlappedBy`) | **KHÔNG** | trường mới `releasedDuring` nằm CẠNH, cùng vòng đời, cùng `closeWindow()`. |
 */
interface OpenMeasureWindow {
  owner: string;
  /** Phạm vi đo của cửa sổ — chỉ cửa sổ CÙNG phạm vi mới làm bẩn được nhau (xem khối trên). */
  scope: VramMeasureScope;
  /** Owner của những cửa sổ đã CHỒNG lên cửa sổ này. Rỗng = phép đo cô lập được. */
  overlappedBy: string[];
  /**
   * C-1 — owner của những giấy phép đã gọi `release()` TRONG LÚC cửa sổ này còn mở. Rỗng = không
   * có byte nào rời thiết bị giữa hai đầu đo. Không rỗng ⇒ `after − beforeUsed` HỤT một lượng
   * KHÔNG tách được ⇒ `measureFailed`, không commit.
   */
  releasedDuring: string[];
}

const openMeasureWindows = new Map<number, OpenMeasureWindow>();
let measureWindowSeq = 0;

/**
 * Mở một cửa sổ đo và ĐÁNH DẤU HAI CHIỀU với mọi cửa sổ CÙNG PHẠM VI đang mở: cửa sổ mới bị các
 * cửa sổ cũ làm bẩn (byte của chúng còn đang lên trong khoảng đo của nó), và các cửa sổ cũ cũng bị
 * cửa sổ mới làm bẩn (byte của nó sẽ lên trước khi chúng đọc đầu đo "sau"). Đánh dấu một chiều
 * thôi là bỏ sót đúng một nửa số ca. KHÔNG BAO GIỜ ném (chỉ thao tác Map trong bộ nhớ).
 *
 * ⚠ `other.scope !== scope ⇒ BỎ QUA` là thay đổi Pha 2A, không phải nới lỏng tuỳ tiện: hai phạm
 * vi đọc hai tập PID RỜI NHAU trên cùng một bộ đếm, nên byte của bên này KHÔNG THỂ xuất hiện
 * trong hiệu số của bên kia. Giữ đánh dấu chéo phạm vi là tự tay làm mù đúng phép đo mà Pha 2A
 * vừa dựng ra (ca: sidecar thị giác 7,8 GB spawn giữa lúc nạp model 17 GB — trước Pha 2A cả hai
 * mất số, sau Pha 2A cả hai có số riêng).
 */
function openMeasureWindow(owner: string, scope: VramMeasureScope): number {
  const id = ++measureWindowSeq;
  const self: OpenMeasureWindow = { owner, scope, overlappedBy: [], releasedDuring: [] };
  for (const other of openMeasureWindows.values()) {
    if (other.scope !== scope) continue;
    if (!other.overlappedBy.includes(owner)) other.overlappedBy.push(owner);
    if (!self.overlappedBy.includes(other.owner)) self.overlappedBy.push(other.owner);
  }
  openMeasureWindows.set(id, self);
  return id;
}

/**
 * ★★★ C-1 (review TOÀN NHÁNH) — GHI NHẬN một lượt NHẢ vào MỌI cửa sổ CÙNG PHẠM VI đang mở.
 * KHÔNG BAO GIỜ ném (chỉ thao tác Map trong bộ nhớ). Xem khối docstring `OpenMeasureWindow`.
 *
 * ⚠ ĐÁNH DẤU MỘT CHIỀU LÀ ĐÚNG Ở ĐÂY (khác `openMeasureWindow`, nơi đánh dấu HAI chiều là bắt
 * buộc): một lượt nhả không có "cửa sổ của chính nó" cần được ai làm bẩn — nó chỉ LÀM BẨN người
 * khác. Chiều ngược lại không tồn tại.
 *
 * ⚠ KHÔNG loại trừ cửa sổ của CHÍNH giấy phép đang nhả, và đó là CÓ CHỦ Ý: nếu `release()` chạy
 * trong lúc `commitMeasured()` của cùng giấy phép còn đang bay (cửa sổ chưa đóng), thì byte của
 * chính nó vừa rời thiết bị ⇒ hiệu số của nó cũng vô nghĩa. Đây là lối đóng của M-3 (review TOÀN
 * NHÁNH) bằng CẤU TRÚC thay vì bằng một hàng rào riêng.
 */
function noteReleaseDuringOpenWindows(owner: string, scope: VramMeasureScope): void {
  for (const w of openMeasureWindows.values()) {
    if (w.scope !== scope) continue;
    if (!w.releasedDuring.includes(owner)) w.releasedDuring.push(owner);
  }
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

/**
 * ★★★ I-1 (review vòng 1) — MỘT ĐẦU ĐO GỒM HAI THÔNG TIN, KHÔNG PHẢI MỘT.
 *
 * `bytes` là con số; `seen` trả lời câu hỏi KHÁC HẲN: **bộ đếm có nhìn thấy cây tiến trình của ta
 * hay không.** Gộp hai thứ đó vào một số (`byPid.get(self) ?? 0`) là để "bộ đếm vắng mặt / regex
 * không khớp / mẫu không có khoá của ta" và "thật sự 0 byte" cho **cùng một kết quả** — rồi commit
 * `0` kèm `measureSource: "process-delta"`, tức KHAI LÀ ĐO ĐƯỢC, rồi `recordActual(owner, 0)`
 * **đóng đinh nấc `learned` = 0 tới hết đời tiến trình**. Ở Pha 2B, ước lượng 0 nghĩa là dư địa
 * VÔ HẠN ⇒ broker không bao giờ từ chối ⇒ OOM. Chiều lỗi này là chiều nguy hiểm.
 *
 * ⚠ `parseProcessCounters` CỐ Ý trả mẫu HỢP LỆ khi không PID nào khớp (`vramProcessProbe.ts`) —
 * đó là hợp đồng đúng cho hàm đó (nó không biết người gọi mong đợi gì), nên chỗ phải phân biệt
 * chính là ĐÂY, phía gọi.
 *
 * ⚠⚠ I-5 (re-review vòng 1) — `seen` ĐO SỰ TỒN TẠI CỦA KHOÁ, KHÔNG ĐO ĐỘ TƯƠI. Đọc kỹ trước khi
 * tin nó là lưới chống mọi kiểu "bộ đếm không nói thật":
 *   • Sau khi `cuda-backend` hình thành, khoá của tiến trình này **luôn** tồn tại ⇒ `!seen` gần
 *     như BẤT KHẢ ĐẠT ⇒ lưới I-1 trên thực tế chỉ còn phủ ca "bộ đếm mù TOÀN MÁY".
 *   • Bộ đếm TRỄ thì cửa sổ **BỊ DỊCH** chứ không co: mất phần cấp phát rơi vào khoảng trễ cuối.
 *     Trễ hoàn toàn ⇒ hai lượt đọc GIỐNG HỆT nhau ⇒ `actual === 0` với `seen === true` ⇒ commit 0
 *     + `recordActual(0)` — tái tạo nguyên vẹn nấc `learned = 0` mà I-1 sinh ra để chặn.
 *   • **★ TASK 6 KHÔNG ĐÓNG LỖ NÀY** — nó chỉ làm biên chờ thành CỦA TA. Câu trả lời của phép đo
 *     KHÁC với dự đoán của I-5. Trước Task 6, lỗ chưa
 *     mở là nhờ một thứ KHÔNG AI THIẾT KẾ: `-SampleInterval` mặc định của `Get-Counter` tạo biên
 *     lắng ~1,2 s trong `PS_SCRIPT`. I-5 kết luận biên đó "ĐANG LÀ ĐIỀU KIỆN ĐÚNG ĐẮN CỦA PHÉP
 *     ĐO". **Đo trực tiếp (8/8 lượt) BÁC BỎ vế đó:** bộ đếm phản ánh ĐỦ lượt cấp phát **TRƯỚC**
 *     khi lượt nạp trả về (đi trước 429–7.140 ms), nên yêu cầu thật là **0 ms** và 1,2 giây kia
 *     luôn là chi phí thuần. Điều I-5 nói ĐÚNG là phần còn lại: cửa sổ đo đang tựa vào một biên
 *     KHÔNG THUỘC VỀ TA. Nay biên đó là `VRAM_MEASURE_SETTLE_MS` (`vramProcessProbe.ts`), được
 *     `await` ngay trước đầu đo SAU trong `commitMeasured()` và có ca đỏ canh
 *     (`wiring.settle.test.ts`). ⚠ `seen` VẪN chỉ đo sự tồn tại của khoá — Task 6 KHÔNG thêm tín
 *     hiệu ĐỘ TƯƠI; nó chỉ làm cho khoảng chờ trở thành của ta, đo được và test được.
 *   • **⚠⚠ CẢNH BÁO CHO NGƯỜI SẼ VÁ (I-2, review Task 6) — ĐỪNG TIN DẤU THỜI GIAN PDH LÀ LỜI GIẢI.**
 *     Lối vá "hiển nhiên" là đưa `$_.Timestamp` của mẫu PDH vào `VramProcessSample.sampledAtMs`
 *     (hôm nay trường đó là `Date.now()` LÚC PARSE, và **không nơi nào đọc nó** — mã chết) rồi từ
 *     chối mẫu quá cũ. **Việc đó KHÔNG đóng được lỗ này.** Dấu thời gian PDH đo tuổi của **MẪU**,
 *     không đo tuổi của **GIÁ TRỊ**: một bộ đếm trễ trao một giá trị CŨ kèm một dấu thời gian MỚI
 *     TINH, hàng rào đi qua, lỗ còn nguyên. Nó chỉ bắt được đúng một lớp khác — **mẫu ôi** (đầu dò
 *     bị treo/xếp hàng, `powershell.exe` chậm, kết quả về muộn) — và lớp đó có thật, đáng bắt, chỉ
 *     là KHÔNG PHẢI lớp mà `seen` đang bỏ sót. Đặt tên đúng cho nó rồi hãy làm; đừng gọi nó là
 *     "vá I-5".
 *   • **RÀNG BUỘC ĐẦY ĐỦ:** tính an toàn của ca "bộ đếm có-mà-mù" phụ thuộc vào **nhánh delta-âm
 *     CŨNG gắn cờ** (`actual < 0` ⇒ `markMeasureFailed`). Nếu một bản sửa tương lai bỏ nhánh đó
 *     (hoặc đổi nó thành `commit(0)`), ca "trước thấy X, sau mù ⇒ 0 − X < 0" sẽ rơi thẳng vào
 *     `commit` thay vì bị chặn. Hai nhánh đó là MỘT lưới, đừng gỡ riêng một cái.
 */
interface ScopeReading {
  readonly bytes: number;
  /** Bộ đếm CÓ thấy cây của ta ở lượt đọc này không. `false` ⇒ `bytes` là 0 SUY RA, không phải 0 ĐO ĐƯỢC. */
  readonly seen: boolean;
}

/**
 * Pha 2A Task 3 — MỘT ĐẦU ĐO của phạm vi `scope`, tính bằng bộ đếm THEO TIẾN TRÌNH.
 *
 * ⚠⚠ Đ4 — ĐÂY LÀ TOÀN BỘ ĐƯỜNG SỐ CỦA `actualBytes`, VÀ NÓ KHÔNG CHẠM `vramProbe`. Không dòng
 * nào trong hàm này (hay trong `commitMeasured()` bên dưới) so sánh/cộng/trừ số của bộ đếm với
 * số của `nvidia-smi`/`getVramState`. Reconciler và nền (`captureVramBaseline`) vẫn dùng NGUYÊN
 * đầu dò toàn thiết bị — hai thước chạy song song, không có điểm giao.
 *
 * ⚠⚠ PID WINDOWS TÁI DỤNG — KHỐI PHÂN TÍCH NÀY TỪNG **THIẾU MỘT CHIỀU**, và bản vá dưới đây bổ
 * sung chiều đó (Pha 2B Task 1, re-review vòng 2 / N2-2). Bản cũ chỉ xét **PID CON** bị cấp lại và
 * kết luận "không cần cơ chế riêng". Kết luận đó ĐÚNG cho chiều nó xét và **SAI cho chiều kia**:
 *   • phạm vi `self`: gốc là `process.pid` — PID của CHÍNH tiến trình đang chạy. Hệ điều hành
 *     không thể cấp lại PID đó cho ai khác khi tiến trình còn sống, mà nếu nó chết thì không còn
 *     ai đọc phép đo này nữa. Bất khả đạt theo cấu trúc, không phải "xác suất thấp".
 *   • phạm vi `descendants`, **chiều PID CON** (bản cũ): `readProcessVram()` đọc LẠI
 *     `Win32_Process` mỗi lượt và dựng lại cây, nên PID đã chết rơi khỏi tập ngay ở đầu đo kế
 *     tiếp; PID cấp lại cho tiến trình LẠ nằm ngoài cây ⇒ bị loại. Ca còn lại (cấp lại cho một
 *     tiến trình con KHÁC CỦA TA) vẫn thuộc phạm vi ⇒ hiệu số vẫn đúng nghĩa; quy sai giấy phép
 *     nào thì đúng là ca chồng lấn, đã có `overlappedBy` bắt.
 *   • ★★ phạm vi `descendants`, **chiều PID CHA — CHIỀU BỊ BỎ SÓT**: `PS_SCRIPT` **không đọc
 *     `CreationDate`**, nên `collectDescendants()` tin `ppid` theo mệnh giá. Một **tàn dư đang giữ
 *     GPU có cha đã chết** (đó chính là ĐỊNH NGHĨA của tàn dư), rồi PID người cha đó được cấp cho
 *     một tiến trình con của TA ⇒ tàn dư bị hút vào cây và bị tính là "của ta". Hai điều kiện này
 *     **TƯƠNG QUAN MẠNH**, không độc lập — vòng lặp kill→restart sinh ra cả hai cùng lúc.
 *     Hậu quả NẶNG HƠN ca ở reconciler: byte của tàn dư có mặt ở CẢ hai đầu đo nên **triệt tiêu
 *     trong `after − before`**, nhưng `seen` thì KHÔNG triệt tiêu (`descendantKeys > 0`) ⇒
 *     `seen = true` ⇒ **vô hiệu hoá đúng lá chắn `actual === 0 && !seen`** ⇒ `commit(0)` +
 *     `recordActual(0)` ⇒ nấc `learned = 0` sống hết đời tiến trình.
 *
 * ⇒ **CỐ Ý MANG SANG (nợ đã ghi, không vá ở Task 1), và đây là lý do ĐẦY ĐỦ — đừng bắt người sau
 * tự suy lại:** dưới §5.6c, `headroom = trần − max(ledgerTotalBytes, attributableBytes)`. Một
 * `learned = 0` chỉ đầu độc **vế `ledgerTotal`**; vế `attributable` vẫn nhìn mức dùng THẬT của
 * thiết bị (thước `nvidia-smi`/`getVramState`, đường hoàn toàn khác), và `max()` lấy vế LỚN HƠN.
 * ⇒ Rủi ro OOM ở đây bị **`max()` chặn**, KHÔNG phải bị lá chắn `seen` chặn. Nói cách khác: lá
 * chắn `seen` mất tác dụng trong ca này, nhưng nó không phải lớp phòng thủ cuối.
 * ⚠ Hệ quả nếu ai đó đổi §5.6c thành `ledgerTotal` đơn thuần (bỏ `max`): lỗ này **lập tức thành
 * đường OOM**. Đóng nó rẻ: thêm `CreationDate` vào `PS_SCRIPT` rồi dùng lại
 * `vramGpuHolders.pruneUnprovenParentLinks()` — cơ chế đã có sẵn, chỉ chưa nối vào đường đo.
 *
 * ⚠ HÀM NÀY CÓ THỂ NÉM (đúng như `readDeviceVramUncached()` mà nó thay thế): `readProcessVram()`
 * tự nuốt lỗi thành `null`, nhưng lời gọi `execFile` vẫn có thể ném đồng bộ. Hai điểm gọi xử lý
 * khác nhau CÓ CHỦ Ý — `begin` bọc try/catch (ném ⇒ `beforeUsed = null` ⇒ nhánh
 * `before-probe-null`), còn `commitMeasured()` để nó rơi vào `catch` ngoài cùng, nơi cửa sổ và
 * khoá được đóng. Bọc thêm một `catch` ở ĐÂY sẽ làm nhánh "đầu dò SAU NÉM" (nhánh thoát thứ NĂM)
 * trở thành mã chết mà không ai thấy.
 *
 * ⚠ `seen === false ⇒ bytes === 0` ở CẢ HAI phạm vi (không có khoá ⇒ `?? 0`; không có PID con ⇒
 * `totalBytes − own` = 0). Tính chất đó là thứ làm ca "mù" an toàn theo CẤU TRÚC: một đầu đo mù
 * chỉ có thể kéo delta xuống 0 hoặc xuống ÂM, không bao giờ đẩy nó lên. Hai nhánh chặn tương ứng
 * (`actual === 0 && !seen` và `actual < 0`) vì thế phủ kín; xem I-5 ở docstring `ScopeReading`.
 */
async function readScopeBytes(scope: VramMeasureScope): Promise<ScopeReading | null> {
  const { readProcessVram } = await import("./vramProcessProbe");
  const sample = await readProcessVram([process.pid]);
  if (!sample) return null;
  const own = sample.byPid.get(process.pid) ?? 0;
  if (scope === "self") return { bytes: own, seen: sample.byPid.has(process.pid) };
  // Cây trừ CHÍNH ta = tổng của con/cháu. `Math.max(0, …)` vì hai số này đến từ CÙNG một lượt
  // đọc nên về lý thuyết không âm được; nếu âm thì đó là dữ liệu hỏng, không phải số đo.
  // `seen` ở phạm vi này = có ÍT NHẤT MỘT PID con/cháu trong bộ đếm (khoá của chính ta không
  // tính): chỉ khi đó con số "cây con chiếm bao nhiêu" mới là số ĐO ĐƯỢC.
  const hasSelf = sample.byPid.has(process.pid);
  const descendantKeys = sample.byPid.size - (hasSelf ? 1 : 0);
  return { bytes: Math.max(0, sample.totalBytes - own), seen: descendantKeys > 0 };
}

/**
 * Pha 2A Task 6 — CHỜ BIÊN LẮNG của bộ đếm. Import động cùng khuôn với `readScopeBytes()` ở trên.
 *
 * ⚠ HÀM NÀY CÓ THỂ NÉM (và phải được để cho ném): nếu một bộ test giả `./vramProcessProbe` mà
 * QUÊN khai `awaitCounterSettle`, lời gọi này ném ⇒ `commitMeasured()` rơi vào `catch` ngoài cùng
 * ⇒ KHÔNG commit. Đó là hướng đúng: thà mất một phép đo còn hơn commit một hiệu số đọc trước khi
 * bộ đếm kịp phản ánh. Nuốt lỗi ở đây sẽ biến "quên biên lắng" thành im lặng — đúng lớp lỗi Task 6
 * sinh ra để đóng.
 */
async function awaitMeasureSettle(): Promise<void> {
  const { awaitCounterSettle } = await import("./vramProcessProbe");
  await awaitCounterSettle();
}

/**
 * Ngân sách chờ khoá nối tiếp. Mặc định = mặc định của `withMeasureWindow` (180 s = 1,5× lượt nạp
 * dài nhất quan sát được). Cho phép ép bằng biến môi trường vì đây là số DUY NHẤT trong đường này
 * quyết định "chờ bao lâu trước khi chạy tiếp mà mất phép đo" — người vận hành phải hạ được nó
 * mà không cần build lại. `0` = không chờ (chạy ngay, mất phép đo nếu có người đang giữ).
 */
function measureWaitBudgetMs(): number | undefined {
  const raw = Number(process.env.VRAM_MEASURE_WAIT_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
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
  /**
   * ★★★ Pha 2A Task 4 (T5-15) — ƯỚC LƯỢNG DỰ PHÒNG để CHỐT SỔ khi phép đo hỏng.
   *
   * Không truyền (mặc định) ⇒ hành vi y hệt trước Task 4: đo hỏng thì giấy phép giữ ước lượng,
   * `actualBytes` đứng `null`. Truyền ⇒ MỌI nhánh đo-hỏng của `commitMeasured()` sẽ chốt sổ bằng
   * con số này thay vì để ô số trống vĩnh viễn.
   *
   * ⚠⚠ CHỈ TRUYỀN KHI HAI ĐIỀU KIỆN CÙNG ĐÚNG — đây không phải "ước lượng dự phòng cho tiện":
   *   1. khối byte **CHẮC CHẮN đang tồn tại** tại thời điểm `commitMeasured()` (lượt cấp phát đã
   *      chạy xong, không có đường nhả nào ở giữa);
   *   2. kích thước của nó là **HẰNG SỐ ĐO ĐƯỢC LẶP LẠI**, không phụ thuộc dữ liệu đầu vào.
   *
   * ⚠ VÌ SAO OPT-IN THEO ĐIỂM GỌI, KHÔNG THEO `kind` (hai ca ĐỐI NGHỊCH, cùng chứng minh một điều):
   *   • theo `kind: "gguf-backend"` ⇒ `cuda-backend:reranker` chạy `getLlama({gpu:false})` (mặc
   *     định `.env` hôm nay) chiếm ĐÚNG 0 byte, sẽ bị bơm 431,6 MiB MA vào sổ;
   *   • nới cho `gguf-model` ⇒ một model 17 GB đo hỏng sẽ được chốt bằng ước lượng theo KÍCH THƯỚC
   *     FILE và nuốt vào nền, tức tái sinh T5-1 mà Task 7 vừa vá.
   *   ⇒ chỉ điểm gọi mới biết "có chắc chắn không, và bằng bao nhiêu". `0` là giá trị HỢP LỆ.
   */
  fallbackBytes?: number;
  /**
   * ★★★ Pha 2B Task 7 (§8) — **AI ĐI LẤY LẠI ĐƯỢC KHỐI BYTE NÀY** (`types.VramReclaimerId`).
   *
   * Không khai ⇒ hộ này **KHÔNG BAO GIỜ** được cộng vào "tổng nhường được" của một câu từ chối, và
   * `preempt()` không bao giờ chạm tới nó. Mặc định AN TOÀN theo chiều **câu chữ**: không hứa.
   *
   * ⚠ CỐ Ý opt-in theo ĐIỂM GỌI, y như `fallbackBytes` ngay trên, và vì đúng một lý do đã đo được:
   * `aiReranker` xin `kind: "gguf-model"` cho một model nạp qua **backend riêng của nó**, vắng mặt
   * khỏi `loadedModels` ⇒ `unloadGgufModel()` không với tới. Suy theo `kind` là hứa hộ về một khối
   * byte không ai lấy lại được.
   */
  reclaimer?: VramReclaimerId;
}

/**
 * ★ Pha 2A Task 4 (T5-15) — VRAM của backend CUDA (`getLlama({gpu:"auto"})`, CHƯA nạp model nào).
 *
 * **452.595.712 byte = 431,6 MiB**, và đây là con số ĐO ĐƯỢC, không phải hằng số cấu hình:
 *   • bộ đếm PDH `\GPU Process Memory` (T5-11): **byte-y-hệt ở 5/5 tiến trình**;
 *   • `nvidia-smi`/`getVramState` ở Pha 1 (thước ĐỘC LẬP): +431/+430/+431 MiB, 3 lượt.
 * Hai thước khác nhau, hai lượt khảo sát khác nhau, cùng một con số ⇒ đây là lớp cấp phát DUY NHẤT
 * trong hệ hôm nay đủ điều kiện để chốt sổ bằng ước lượng khi phép đo hỏng.
 *
 * ⚠ Đơn vị là BYTE (ràng buộc toàn cục: đơn vị nội bộ luôn là byte). ⚠ Số này chỉ đúng khi backend
 * thật sự lên GPU — `gpu: false` (hoặc máy không GPU) ⇒ dự phòng đúng phải là **0**, và đó là việc
 * của điểm gọi, không phải của hằng số này.
 */
export const CUDA_BACKEND_FALLBACK_BYTES = 452_595_712;

/** Pha 2B Task 3 — đếm lượt `beginVramAllocation()` rơi vào `catch` cuối hàm (xem `vramBeginFailureState`). */
let soLuotBeginHong = 0;
let lyDoBeginHongCuoi: string | null = null;
/** ★ C-1 (review vòng 1) — TỔNG BYTE mà sổ đang HỤT vì những lượt hỏng đó. Xem `vramBeginFailureState`. */
let byteNgoaiSo = 0;
/** ★ C-1 — số lượt hỏng mà ngay cả BYTE cũng không ước được. TÁCH khỏi tổng, không cộng 0 giả. */
let soLuotBeginHongKhongBietByte = 0;

/**
 * ★ C-1 (review vòng 1) — ƯỚC LƯỢNG SỐ BYTE của một lượt cấp phát ĐÃ RƠI RA NGOÀI SỔ.
 *
 * ⚠ KHÔNG gọi `vramEstimator`: ta đang ở trong `catch`, và `estimateBytesFor()` **chính là** thứ có
 * thể vừa ném. Chỉ dùng những gì điểm gọi đã cầm sẵn trên tay + kích thước file NẾU lượt `statSync`
 * bên trong `try` đã kịp chạy xong (`byteDaBiet`). Thứ tự: chắc chắn nhất trước.
 *
 * ⚠ `null` nghĩa là **"KHÔNG CÓ CĂN CỨ NÀO"**, KHÔNG phải "không tốn byte nào" — hai thứ đó khác
 * hẳn nhau và gộp lại chính là cách một cuốn sổ hụt tự khai là đủ. Điểm gọi ghi ra ô riêng
 * (`unledgeredBytesUnknown`) thay vì cộng một số 0 giả vào tổng.
 */
function byteUocCuaLuotHong(opts: VramAllocationOptions, byteDaBiet: number | undefined): number | null {
  for (const v of [byteDaBiet, opts.fileBytes, opts.fallbackBytes, opts.configDefaultBytes]) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  return null;
}

export async function beginVramAllocation(opts: VramAllocationOptions): Promise<VramTicket> {
  /**
   * ★★ Pha 2A Task 3 — LỐI THOÁT KHẨN CỦA KHOÁ NỐI TIẾP. Khai NGOÀI `try` có chủ ý.
   *
   * Từ lúc khoá được giữ tới lúc `return { … }` bên dưới, BẤT KỲ ngoại lệ nào cũng rơi vào
   * `catch` cuối hàm và trả `NOOP_TICKET` — người gọi khi đó KHÔNG BAO GIỜ gọi `commitMeasured()`
   * hay `release()` của ticket này nữa, nên không còn ai nhả khoá. Một khoá nối tiếp rò là
   * TOÀN BỘ tiến trình đứng chờ 180 s ở MỖI lượt nạp, tới khi khởi động lại. `catch` cuối hàm
   * gọi biến này.
   */
  let nhaKhoaKhanCap: (() => void) | null = null;
  /**
   * ★ C-1 (review vòng 1) — khai NGOÀI `try` để `catch` cuối hàm đọc được. Đây là con số DUY NHẤT
   * mà lượt hỏng còn cầm trên tay để nói ra sổ đang hụt BAO NHIÊU (xem `byteUocCuaLuotHong`).
   */
  let byteDaBiet: number | undefined;
  try {
    // Pha 2B Task 3 — `broker`/`estimator`/`logVramEvent` nay là import TĨNH ở đầu file
    // (xem khối docstring ở đó). Ba lệnh `await import()` từng đứng ở đây không còn ném được
    // BÊN TRONG `try` này nữa, nên `catch` cuối hàm nay chỉ còn nói về MỘT lớp lỗi.
    let fileBytes = opts.fileBytes;
    if (fileBytes === undefined && opts.filePath) {
      try {
        const fs = await import("node:fs");
        fileBytes = fs.statSync(opts.filePath).size;
      } catch {
        /* không đọc được kích thước — tụt xuống nấc ước lượng thấp hơn, không phải lỗi */
      }
    }
    byteDaBiet = fileBytes;

    // ⚠ `estimateBytesFor()` là ASYNC; `await` nó XONG Ở ĐÂY rồi mới truyền số vào `reserve()`.
    // `reserve()` ĐỒNG BỘ và TUYỆT ĐỐI không được `await` gì bên trong — chữ ký đồng bộ đó
    // chính là lá chắn cấu trúc giữ đường quyết định sạch I/O (vramBroker.ts:36-42).
    const est = await estimator.estimateBytesFor(opts.owner, {
      fileBytes,
      configDefaultBytes: opts.configDefaultBytes,
    });

    /**
     * ★★★ Pha 2B Task 5 — BỘ BA ĐẦU VÀO QUYẾT ĐỊNH, và đây là chỗ DUY NHẤT trong repo dựng nó.
     *
     * Cả ba đều là **bàn giao cứng** của ba task trước, và cả ba trước dòng này **chưa có người
     * tiêu thụ nào trên đường sản xuất** — đúng hình dạng "số đã tới cửa, cửa chưa mở":
     *   • `tick` (Task 1 + 2) mang `attributableBytes` **và** `baselineVerified`;
     *   • `unledgered` (Task 3) mang byte đã chạy NGOÀI SỔ + số lượt không ước được byte;
     *   • `nowMs` để tuổi tick là một con số, không phải một lượt `Date.now()` ẩn.
     *
     * ⚠ `readDecisionTick()` trả `null` ở tiến trình `api` **vĩnh viễn** (`startVramReconciler`
     * không chạy ở vai trò đó — `backgroundJobs.ts`). Đó là câu trả lời ĐÚNG theo thiết kế, không
     * phải lỗi chờ sửa: `null` ⇒ `"no-tick"` ⇒ chính sách CHẶT HƠN, chứ tuyệt đối KHÔNG phải
     * "coi như thiết bị trống".
     */
    const yeuCau = {
      owner: opts.owner,
      kind: opts.kind,
      estimatedBytes: est.bytes,
      priority: opts.priority,
      estimateSource: est.source,
      ttlMs: opts.ttlMs,
      // ★ Task 7 — AI đi lấy lại được khối byte này (types.ts `VramReclaimerId`). Khai theo ĐIỂM
      // GỌI, không suy theo `kind` — xem khối docstring ở đó để biết vì sao (model của
      // `aiReranker` cũng là `kind: "gguf-model"` nhưng KHÔNG ai thu hồi được).
      reclaimer: opts.reclaimer,
    };
    let res = broker.reserve(
      yeuCau,
      { tick: readDecisionTick(), unledgered: vramUnledgeredFact(), nowMs: Date.now() },
    );

    logVramEvent({
      event: "reserve",
      owner: opts.owner,
      leaseKind: opts.kind,
      priority: opts.priority,
      estimatedBytes: est.bytes,
      estimateSource: est.source,
      wouldRefuse: res.wouldRefuse,
      detail: {
        wouldPreempt: res.wouldPreempt,
        slotsNeeded: res.decision.slotsNeeded,
        // ★ Task 5 — SỐ LIỆU của lượt quyết định. Không có nó thì một lượt từ chối trong nhật ký
        // không dựng lại được phép tính, và câu hỏi "vì sao lượt này bị chặn" chỉ trả lời được
        // bằng cách đoán. ⚠ `-Infinity` được `logVramEvent` thay + GHI TÊN (hàng rào Task 3).
        headroomBytes: res.decision.headroomBytes,
        effectiveHeadroomBytes: res.decision.effectiveHeadroomBytes,
        usedBytes: res.decision.usedBytes,
        basis: res.decision.basis,
        blind: res.decision.blind,
        baselineVerified: res.decision.baselineVerified,
        trusted: res.decision.trusted,
        degradedReasons: [...res.decision.reasons],
        staleMarginBytes: res.decision.staleMarginBytes,
        unledgeredChargeBytes: res.decision.unledgeredChargeBytes,
        distrustChargeBytes: res.decision.distrustChargeBytes,
      },
    });

    /**
     * ★★★ Pha 2B Task 7 (§8) — **THU HỒI RỒI XIN LẠI ĐÚNG MỘT LƯỢT.**
     *
     * ⚠⚠ ĐÂY LÀ CHỖ `ensureCapacity()` ĐƯỢC HẤP THỤ, và đọc kỹ vì sao nó phải nằm **ở đây** chứ
     * không nằm trong `reserve()`: `reserve()` **ĐỒNG BỘ** (ràng buộc 1, lá chắn cấu trúc giữ
     * đường quyết định sạch I/O), còn nhả một khối VRAM thật là **BẤT ĐỒNG BỘ**
     * (`model.dispose()`, giết tiến trình con). Broker **liệt kê**; `beginVramAllocation` — vốn
     * đã `async` — **thi hành**.
     *
     * ⚠ VỊ TRÍ CŨNG QUAN TRỌNG: khối này nằm **TRƯỚC** lượt mở cửa sổ đo (`withMeasureWindow` bên
     * dưới), y như `ensureCapacity()` cũ chạy TRƯỚC `beginVram()`. Nhờ vậy lượt dispose không rơi
     * vào giữa hai đầu đo của chính lượt này — đúng "tác dụng phụ có lợi" mà Task 3 đã ghi.
     *
     * ⚠ ĐÚNG MỘT LƯỢT, không vòng lặp: `preemptPlan()` đã dọn ĐỦ theo cả hai thước ngay từ đầu.
     * Một vòng lặp ở đây là cách biến một lượt xin quá lớn thành một cuộc dọn sạch cả hệ.
     */
    if (!res.lease) {
      const canByte = Math.max(0, est.bytes - res.decision.effectiveHeadroomBytes);
      const { preempt } = await import("./vramPreempt");
      const thuHoi = await preempt(opts.priority, canByte, res.decision.slotsNeeded);
      if (thuHoi.reclaimed.length > 0) {
        res = broker.reserve(
          yeuCau,
          { tick: readDecisionTick(), unledgered: vramUnledgeredFact(), nowMs: Date.now() },
        );
        logVramEvent({
          event: "reserve",
          owner: opts.owner,
          leaseKind: opts.kind,
          priority: opts.priority,
          estimatedBytes: est.bytes,
          estimateSource: est.source,
          wouldRefuse: res.wouldRefuse,
          detail: {
            afterPreempt: true,
            reclaimed: [...thuHoi.reclaimed],
            failed: [...thuHoi.failed],
            freedBytes: thuHoi.freedBytes,
            slotsNeeded: res.decision.slotsNeeded,
            effectiveHeadroomBytes: res.decision.effectiveHeadroomBytes,
          },
        });
      }
    }

    const lease: VramLease | null = res.lease;
    /**
     * ★★★ ĐÂY LÀ CÔNG TẮC CƯỠNG CHẾ. Trước Task 5 nhánh này `return NOOP_TICKET` — tức "không có
     * giấy phép thì cứ cấp phát đi", đúng lớp TRÀN IM LẶNG mà cả spec này tồn
     * tại để diệt, chỉ khác chỗ đứng.
     *
     * ⚠⚠ VÌ SAO **NÉM** CHỨ KHÔNG TRẢ MỘT TICKET RỖNG: một ticket rỗng là một câu trả lời mà người
     * gọi **không phân biệt được** với "đã cấp" — họ nạp model xong mới biết. Ném là cách DUY NHẤT
     * làm lượt cấp phát KHÔNG XẢY RA. Bù lại, mọi điểm gọi phải **thả** `VramRefusedError` đi qua
     * `catch` của nó (bảng "vị từ dùng chung" trong báo cáo Task 5) — 11 điểm, đã kiểm từng điểm.
     *
     * ⚠ `res.refusal` KHÔNG BAO GIỜ `null` khi `lease === null` (bất biến của `reserve()`), nhưng
     * `??` ở đây KHÔNG phải một cái DÂY: nó là một lối thoát để `tsc` không phải tin một bất biến
     * runtime, và nếu nó chạy thì câu lỗi vẫn nói đúng "không cấp được", chỉ nghèo hơn.
     */
    if (!lease) {
      const facts = res.refusal;
      if (facts) throw new VramRefusedError(facts);
      throw new Error(
        `[vram] TỪ CHỐI cấp phát cho "${opts.owner}" (${opts.kind}, mức ${opts.priority}) — ` +
          `xin ${Math.round(est.bytes / 1024 / 1024)} MiB, dư địa hiệu lực ` +
          `${Math.round(res.decision.effectiveHeadroomBytes / 1024 / 1024)} MiB. ` +
          `⚠ Sự thật chi tiết KHÔNG dựng được (refusal rỗng) — đây là lỗi nội bộ của broker.`,
      );
    }

    /**
     * ★★★ Pha 2A Task 3 — PHẠM VI ĐO + KHOÁ NỐI TIẾP (điều kiện Đ1). Xem khối `VramMeasureScope`
     * ở đầu file để biết vì sao chỉ phạm vi `self` lấy khoá.
     *
     * ⚠ THỨ TỰ BẮT BUỘC: lấy khoá TRƯỚC, đọc đầu đo "trước" SAU. Đảo lại là đọc `before` trong
     * lúc người khác còn đang cấp phát ⇒ hiệu số nuốt phần đuôi của họ, đúng lớp lỗi cộng-trùng
     * mà khoá sinh ra để diệt.
     *
     * ⚠ HÌNH DẠNG "MỞ/ĐÓNG" TRÊN MỘT API "BỌC HÀM": `withMeasureWindow(fn)` giữ khoá trong SUỐT
     * `fn()`. Cửa sổ đo ở đây trải từ `beginVramAllocation()` tới `commitMeasured()`/`release()` —
     * hai lời gọi RIÊNG của người dùng — nên `fn` chỉ làm một việc: chờ một lời hứa mà
     * `commitMeasured()`/`release()` sẽ giải. `moCua` báo cho `begin` biết đã vào được bên trong
     * (hoặc đã bỏ cuộc vì hết ngân sách — `withMeasureWindow` vẫn CHẠY `fn` ở nhánh đó, nên
     * `begin` KHÔNG BAO GIỜ treo quá `waitBudgetMs`).
     *
     * ⚠⚠ I-3 (review TOÀN NHÁNH) — **ĐẢO NGƯỢC ƯU TIÊN CÓ THẬT VÀ ĐANG CHẠY HÔM NAY**, không phải
     * một rủi ro của Pha 2B. Broker biết ưu tiên (`PRIORITY_RANK`, `vramBroker.ts`); **khoá đo thì
     * KHÔNG**: lời gọi dưới đây truyền đúng `(fn, budget, owner)` — `opts.priority` dừng lại ở
     * `reserve()` và ở nhật ký, không đi tiếp vào `withMeasureWindow`, mà hàng chờ của khoá là
     * FIFO thuần (`vramMeasureLock.ts`). Hệ quả trên đường sản xuất:
     *   • một lượt kiểm AOI mức `production` (`aiInferenceEngine.ts`, `priority: "production"`)
     *     trượt cache phiên có thể xếp **SAU** một `gguf-embed-ctx`/`reranker` mức `background`,
     *     hoặc sau một lượt nạp 30B mức `interactive` (cửa sổ của nó trải qua `loadModel()`
     *     11–43 s **+** `createContext()` + biên lắng + 2 đầu dò);
     *   • `VRAM_MEASURE_WAIT_MS` KHÔNG đặt trong `.env` ⇒ ngân sách chờ là **180 s**.
     * ⚠ **KHÔNG hạ `VRAM_MEASURE_WAIT_MS` để chặn đảo ngược** — `vramMeasureLock.ts` khai rằng
     * nhánh hết-giờ đang âm thầm gánh vai LƯỚI CHỐNG BẾ TẮC (thứ tự khoá với `withGgufSlot` không
     * nhất quán giữa các đường gọi). Hạ nó là đổi "mất phép đo" lấy "treo cứng".
     * ⇒ Lối vá đúng (khoá biết ưu tiên, hoặc `production` có đường không-đo-mà-không-chờ) là NỘI
     * DUNG PHA 2B và đã nằm trong danh sách điều kiện vào cưỡng chế. Ở đây chỉ ghi cho đúng.
     */
    const scope: VramMeasureScope = opts.kind === "external-process" ? "descendants" : "self";
    let nhaCua: (() => void) | null = null;
    let ketQuaCuaSo: Promise<{ measurable: boolean }> | null = null;
    if (scope === "self") {
      const { withMeasureWindow } = await import("./vramMeasureLock");
      let baoDaVao!: () => void;
      const daVao = new Promise<void>((r) => { baoDaVao = r; });
      const giuToiKhiDong = new Promise<void>((r) => { nhaCua = r; });
      nhaKhoaKhanCap = () => nhaCua?.();
      ketQuaCuaSo = withMeasureWindow(
        async () => { baoDaVao(); await giuToiKhiDong; },
        measureWaitBudgetMs(),
        opts.owner,
        // ★★ Pha 2B Task 5 (cổng 2) — MỨC ƯU TIÊN NAY ĐI TIẾP VÀO HÀNG CHỜ CỦA KHOÁ. Trước dòng
        // này `opts.priority` dừng lại ở `reserve()` và ở nhật ký, nên một lượt kiểm AOI mức
        // `production` xếp sau việc nền tối đa 180 s — đảo ngược ưu tiên ĐANG CHẠY, không phải
        // một rủi ro tương lai (I-3, review TOÀN NHÁNH).
        opts.priority,
      ).catch(() => ({ measurable: false }));
      await daVao;
    }

    // Đo NGAY TRƯỚC lượt cấp phát, BÊN TRONG cửa sổ nối tiếp. Đặt sau `reserve()` để phép đo sát
    // lượt cấp phát nhất.
    //
    // ⚠ Pha 2A: `readScopeBytes()` (bộ đếm THEO TIẾN TRÌNH) chứ KHÔNG còn `readDeviceVramUncached()`.
    // Đây là toàn bộ nội dung của "chỉ `actualBytes` đổi nguồn": `vramReconciler`/`captureVramBaseline`
    // vẫn đọc `vramProbe` y nguyên, và KHÔNG có điểm nào hai số gặp nhau (Đ4).
    //
    // Chi phí: một lượt `powershell.exe` (~760 ms trên máy này) cho MỖI đầu đo — đắt hơn hẳn
    // `getVramState()` native (~0 ms) mà nó thay thế. Chấp nhận được vì mỗi hộ tiêu thụ chỉ trả
    // chi phí này ở lượt cấp phát THẬT (model/session đều được cache), không phải mỗi request, và
    // lượt cấp phát thật tính bằng giây tới phút.
    let before: ScopeReading | null = null;
    try {
      before = await readScopeBytes(scope);
    } catch {
      /* không đo được ⇒ bỏ qua phần commit, giấy phép vẫn giữ ước lượng */
    }
    const beforeUsed: number | null = before === null ? null : before.bytes;

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
     * bị gắn cờ sai, vĩnh viễn. Người sau thêm mã vào đoạn này: đóng cửa sổ trong `catch` đó
     * (Pha 2A: `catch` đó nay còn phải nhả CẢ khoá nối tiếp — `nhaKhoaKhanCap`).
     */
    const windowId = openMeasureWindow(opts.owner, scope);
    let windowOpen = true;
    /**
     * Đóng cửa sổ đúng MỘT lần, ở BẤT KỲ nhánh thoát nào, và NHẢ KHOÁ nối tiếp ngay trong cùng
     * lời gọi ĐỒNG BỘ. KHÔNG BAO GIỜ ném.
     *
     * ⚠ Nhả khoá phải nằm ở ĐÂY chứ không phải ở từng nhánh: MỌI nhánh thoát (commit thành công ·
     * `release()` · đầu dò trước null · đầu dò sau null · đầu dò NÉM · và mọi nhánh
     * `measure_failed`, nay gồm cả `release-during-measure-window` của C-1) đều đi qua hàm này.
     * Bỏ sót một nhánh = khoá rò = cả tiến trình chờ 180 s mỗi lượt nạp cho tới lúc khởi động lại.
     */
    const closeWindow = (): OpenMeasureWindow | null => {
      if (!windowOpen) return null;
      windowOpen = false;
      const w = closeMeasureWindow(windowId);
      try { nhaCua?.(); } catch { /* nhả khoá KHÔNG được làm hỏng đường thoát */ }
      return w;
    };

    /**
     * Phép đo này có CÔ LẬP được không (Task 2). `true` khi không có lượt "chạy-không-đo" nào
     * chồng lên cửa sổ; `false` khi hết ngân sách chờ hoặc có kẻ bỏ cuộc chạy xen.
     * ⚠ Phạm vi `descendants` KHÔNG lấy khoá ⇒ không có phán quyết nào để đọc; ở đó việc phát
     * hiện chồng lấn do `overlappedBy` đảm nhiệm (xem khối `VramMeasureScope`).
     */
    const doDuocKhong = async (): Promise<boolean> => {
      if (!ketQuaCuaSo) return true;
      try { return (await ketQuaCuaSo).measurable; } catch { return false; }
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
    /**
     * ★★★ Pha 2A Task 4 (T5-15) — CHỐT SỔ BẰNG ƯỚC LƯỢNG DỰ PHÒNG. Gọi ở CUỐI **MỌI** nhánh
     * đo-hỏng, ngay sau sự kiện `measure_failed` của nhánh đó.
     *
     * ⚠⚠ NGƯỜI SAU THÊM NHÁNH ĐO-HỎNG THỨ TÁM: **phải gọi hàm này ở nhánh đó**. Bỏ sót một nhánh
     * là T5-15 sống lại qua đúng cửa đó, IM LẶNG. BẢY nhánh hiện có, mỗi nhánh có ĐÚNG một ca
     * canh riêng trong `wiring.backendStuck.test.ts` (I-1 review vòng 1 — trước đó nhánh
     * `measure-window-not-exclusive` KHÔNG có ca nào: xoá lời gọi của nó, cả 209 ca vẫn xanh):
     *   `before-probe-null` (ca 8a) · `after-probe-null` (8b) · `measure-target-absent` (8c) ·
     *   `delta < 0` (8d) · `overlapping-measure-window` (ca 9) · `measure-window-not-exclusive`
     *   (ca 9b — cửa sổ KHÔNG độc quyền, dựng bằng móc `beforeRead`) · `release-during-measure-window`
     *   (ca 8e — C-1 review TOÀN NHÁNH).
     *
     * ⚠ VÌ SAO `release-during-measure-window` ĐƯỢC PHÉP CHỐT SỔ BẰNG DỰ PHÒNG (câu hỏi đúng phải
     * hỏi, vì hàng rào của `fallbackBytes` đòi "khối byte CHẮC CHẮN đang tồn tại"): lượt nhả là
     * của NGƯỜI KHÁC (hoặc của chính giấy phép này khi nó đã `released` — lúc đó `commitFallback`
     * tự từ chối vì lease đã rời sổ). Byte của CHÍNH giấy phép này vẫn nằm nguyên trên thiết bị;
     * thứ hỏng là phép TRỪ, không phải sự tồn tại của khối byte. Điều kiện của `fallbackBytes`
     * giữ nguyên hiệu lực.
     *
     * ⚠ THỨ TỰ: sau `logVramEvent({event:"measure_failed"})`, không phải trước — đọc nhật ký phải
     * thấy "đo hỏng" RỒI mới thấy "chốt bằng ước lượng", không thể ngược lại.
     *
     * ⚠ M-2 (review vòng 1) — NHÁNH THỨ BẢY (`catch` cuối `commitMeasured()`) HÀM NÀY **KHÔNG**
     * CỨU ĐƯỢC, và đó là sự thật phải nói ra thay vì để người sau tự phát hiện: ở đó lease đứng
     * `actualBytes: null, measureFailed: false` (catch-all CỐ Ý không gắn cờ — xem docstring
     * `markProbeFailed`), mà hàng rào của `commitFallback()` đòi `measureFailed === true`. Ca đó
     * gần như bất khả đạt (`vramProcessProbe.readProcessVram()` **resolve `null`** chứ không
     * reject, kể cả khi `execFile` lỗi/timeout), nên KHÔNG nới hàng rào để với tới nó — nới hàng
     * rào là mở đường chốt sổ cho một lease có thể vẫn đang nạp dở. Nếu một ngày nhánh đó chạm
     * được thật, lối vá đúng là gắn cờ ở catch-all TRƯỚC, không phải bỏ hàng rào ở đây.
     *
     * ⚠ Đây KHÔNG phải "cứu" phép đo: `measureFailed` ở lại `true`, `measureSource` ở lại `"none"`.
     * Nó chỉ trả lời một câu hỏi KHÁC: *"sổ có được phép nói rằng khối byte này đang tồn tại
     * không?"* — và với backend CUDA thì có, vì hai thước độc lập đã đo nó ra cùng một số.
     */
    const chotSoBangDuPhong = (reason: string) => {
      if (opts.fallbackBytes === undefined) return;
      if (!broker.commitFallback(lease.id, opts.fallbackBytes, reason)) return;
      const mib = Math.round(opts.fallbackBytes / 1024 / 1024);
      console.warn(
        `[vram] "${opts.owner}" đo hỏng (${reason}) ⇒ chốt sổ bằng ƯỚC LƯỢNG DỰ PHÒNG ${mib} MiB. ` +
          `ĐÂY LÀ SỐ ƯỚC LƯỢNG, KHÔNG PHẢI SỐ ĐO — khối byte này chắc chắn đang nằm trên thiết bị ` +
          `nên sổ phải nói ra, nhưng con số thì không có thước nào xác nhận (measureSource=none).`,
      );
      logVramEvent({
        event: "commit_fallback",
        owner: opts.owner,
        leaseKind: opts.kind,
        priority: opts.priority,
        estimatedBytes: est.bytes,
        actualBytes: opts.fallbackBytes,
        estimateSource: "fallback-after-measure-failure",
        detail: {
          reason,
          measureSource: "none" satisfies VramMeasureSource,
          measureScope: scope,
          /** Trường đọc-được-bằng-SQL để không ai phải đọc `note` mới biết đây không phải số đo. */
          measured: false,
          note:
            "phép đo hỏng nhưng khối byte CHẮC CHẮN đang tồn tại ⇒ chốt sổ bằng ƯỚC LƯỢNG DỰ PHÒNG " +
            "do điểm gọi khai (VramAllocationOptions.fallbackBytes). Đây KHÔNG phải số đo: " +
            "measureFailed vẫn true, measureSource vẫn 'none', và recordActual() KHÔNG chạy (không " +
            "được đầu độc nấc learned). Mục đích DUY NHẤT: giấy phép không còn `actualBytes === null` " +
            "vĩnh viễn, nên nó thôi chặn captureVramBaseline() (T5-15).",
        },
      });
    };

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
          measureSource: "none" satisfies VramMeasureSource,
          measureScope: scope,
          ...extraDetail,
          note:
            "đầu dò trả null/lỗi ⇒ không đủ hai đầu đo để tính delta. Giấy phép GIỮ NGUYÊN " +
            "ước lượng và sẽ KHÔNG BAO GIỜ được xác minh (commitMeasured() không gọi lại cho " +
            "cùng ticket) — đánh dấu ngay để không câm tới lúc release().",
        },
      });
      chotSoBangDuPhong(reason);
    };

    let released = false;
    /**
     * ★★ I-4 / T3-M6 (review TOÀN NHÁNH) — BẤT BIẾN "MỖI TICKET CHỈ ĐO ĐÚNG MỘT LẦN", NAY ĐƯỢC
     * MÃ CƯỠNG CHẾ thay vì chỉ được chú thích khẳng định.
     *
     * `vramWiring.ts` (khối `markProbeFailed` bên dưới) phát biểu "mỗi điểm cấp phát chỉ `await`
     * nó đúng MỘT lần" như một SỰ THẬT, và toàn bộ lý lẽ gắn `measureFailed` sớm dựa vào đó —
     * nhưng trước bản vá này chỉ có cờ `released`, không có cờ nào cưỡng chế điều đang được khẳng
     * định. Lời gọi thứ HAI sẽ chạy lại biên lắng + đầu đo SAU rồi `commit(after₂ − beforeUsed₁)`
     * — một hiệu số tính từ đầu đo TRƯỚC đã cũ hàng giây tới hàng phút, tức **một con số bịa** —
     * rồi `recordActual()` nó vào nấc `learned`. Cùng gốc với C-1: sai mà tự khai là thành công.
     *
     * Đặt cờ NGAY ĐẦU (trước mọi `await`) chứ không ở cuối: hai lời gọi ĐỒNG THỜI cũng phải bị
     * chặn, không chỉ hai lời gọi tuần tự. Lời gọi thứ hai là **no-op có tiếng** — không ném, vì
     * `commitMeasured()` đã hứa "KHÔNG BAO GIỜ ném" và telemetry không được làm hỏng đường cấp
     * phát; nhưng cũng không im, vì im lặng chính là thứ đã để lỗ này sống.
     */
    let measured = false;
    return {
      /**
       * ★★★ Pha 2B Task 5 (§5.2) — KHAI "còn ai đang dùng khối byte này không". Xem
       * `VramTicket.noteRefCount()` để biết vì sao đây là cửa DUY NHẤT mở đường thu hồi, và vì sao
       * nó nhận một SỐ chứ không phải một cờ.
       */
      noteRefCount(n: number) {
        try {
          if (released) return;
          broker.setLeaseRefCount(lease.id, n);
        } catch {
          /* telemetry KHÔNG BAO GIỜ được làm hỏng đường cấp phát — và một lượt khai hỏng chỉ có
             nghĩa "giấy phép này vẫn coi như ĐANG DÙNG", tức chiều AN TOÀN. */
        }
      },
      async commitMeasured() {
        try {
          if (released) return;
          if (measured) {
            console.warn(
              `[vram] "${opts.owner}" gọi commitMeasured() LẦN THỨ HAI trên cùng một giấy phép — ` +
                `BỎ QUA. Đầu đo TRƯỚC đã cũ, mọi hiệu số tính từ nó là số bịa; đo lại đúng cách ` +
                `là mở một giấy phép MỚI quanh lượt cấp phát mới.`,
            );
            return;
          }
          measured = true;
          if (beforeUsed === null) {
            closeWindow();
            markProbeFailed("before-probe-null", {});
            return;
          }
          /**
           * ★★★ PHA 2A TASK 6 — BIÊN LẮNG **CỦA TA**, ĐẶT ĐÚNG Ở ĐÂY. Đọc `VRAM_MEASURE_SETTLE_MS`
           * trong `vramProcessProbe.ts` để biết số đo chống lưng cho nó.
           *
           * ⚠ VÌ SAO TRƯỚC ĐẦU ĐO SAU, KHÔNG PHẢI TRƯỚC ĐẦU ĐO TRƯỚC: đầu đo TRƯỚC đọc một trạng
           * thái đã đứng yên (khoá nối tiếp đang giữ, chưa ai cấp phát gì); đầu đo SAU là đầu duy
           * nhất phải đuổi theo một lượt cấp phát VỪA XONG. Chờ ở đầu kia là trả tiền mà không mua
           * được gì.
           *
           * ⚠ VÌ SAO **BÊN TRONG** CỬA SỔ (`closeWindow()` nằm dưới, không phải trên): trong khoảng
           * chờ này giấy phép vẫn giữ khoá nối tiếp. Chờ ở NGOÀI cửa sổ mở đúng bằng ngần ấy thời
           * gian cho một lượt cấp phát khác chen vào giữa hai đầu đo — tức tự tay tái tạo lớp lỗi
           * cộng-trùng mà `withMeasureWindow` sinh ra để diệt.
           *
           * ⚠⚠ NGƯỜI SAU ĐỌC ĐẾN ĐÂY VÌ ĐANG TỐI ƯU CHI PHÍ ĐƯỜNG ĐO: `Get-Counter` trong
           * `PS_SCRIPT` có một biên ~1,2 s ĐI KÈM (mặc định `-SampleInterval 1`). Đó là **tác dụng
           * phụ**, không phải thiết kế, và Task 6 tồn tại chính vì nó. Gỡ/hạ nó thì được — nhưng
           * dòng `await` NÀY phải ở lại, vì nó là biên duy nhất còn thuộc về ta và là biên duy nhất
           * có ca test canh (`wiring.settle.test.ts`).
           */
          await awaitMeasureSettle();

          const afterReading = await readScopeBytes(scope);
          if (afterReading === null) {
            closeWindow();
            markProbeFailed("after-probe-null", { beforeUsedBytes: beforeUsed });
            return;
          }
          const after = afterReading.bytes;

          // ★★ Task 8 (C-1) — cửa sổ đo ĐÓNG NGAY SAU đầu đo "sau", không muộn hơn. Từ điểm này
          // giấy phép đã ổn định trên thiết bị: nó không còn làm bẩn phép đo của ai nữa, và giữ
          // cửa sổ mở thêm chỉ đẻ ra báo động giả cho lượt cấp phát kế tiếp.
          // Pha 2A: lời gọi này cũng NHẢ KHOÁ nối tiếp (xem `closeWindow`), nên người đang xếp
          // hàng vào được ngay — không phải đợi tới hết `commitMeasured()`.
          const win = closeWindow();
          const measurable = await doDuocKhong();
          const actual = after - beforeUsed;

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
           * được phần nào của ai (hai đầu đo cùng đọc MỘT tập PID). Mọi phép chia đều là bịa.
           * Giấy phép giữ nguyên ƯỚC LƯỢNG và nói ra rằng nó chưa được xác minh.
           *
           * ⚠ Pha 2A — nhánh này nay CHỈ nổ khi hai cửa sổ CÙNG PHẠM VI chồng nhau
           * (`openMeasureWindow`). Với phạm vi `self` điều đó đòi nối tiếp hoá phải bị bỏ qua
           * (hết ngân sách chờ); với phạm vi `descendants` nó là lưới DUY NHẤT (không có khoá).
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
              detail: {
                reason: "overlapping-measure-window",
                measureSource: "none" satisfies VramMeasureSource,
                measureScope: scope,
                measurable,
                overlappedBy: win.overlappedBy,
                discardedDeltaBytes: actual,
                beforeUsedBytes: beforeUsed,
                afterUsedBytes: after,
                note:
                  "cửa sổ đo của giấy phép này CHỒNG với cửa sổ CÙNG PHẠM VI của giấy phép khác " +
                  "⇒ delta `after − before` (hai đầu đo cùng đọc một tập PID) gồm cả byte của họ. " +
                  "Commit số này là ghi CÙNG MỘT KHỐI BYTE hai lần vào sổ, và Pha 2 sẽ từ chối " +
                  "nạp/đuổi model trên phần byte ma đó. KHÔNG chia tỉ lệ để bù: không có thông " +
                  "tin nào trong tiến trình tách được phần của ai. Giấy phép giữ ƯỚC LƯỢNG.",
              },
            });
            chotSoBangDuPhong("overlapping-measure-window");
            return;
          }

          /**
           * ★★★ Pha 2A Task 3 — "CỬA THỨ BẢY": KHOÁ NỐI TIẾP KHÔNG GIỮ ĐƯỢC CỬA SỔ NÀY.
           *
           * `measurable === false` nghĩa là một trong hai điều, và cả hai đều làm hiệu số vô
           * nghĩa theo đúng một kiểu (Task 2, C-1): (a) chính cửa sổ này hết ngân sách chờ nên
           * chạy NGOÀI khoá — nó cấp phát trong lúc người khác đang đo; (b) cửa sổ này giữ khoá
           * thật, nhưng có một lượt BỎ CUỘC chạy xen vào giữa hai đầu đo của nó.
           *
           * ⚠ ĐẶT SAU nhánh `overlappedBy` CÓ CHỦ Ý: khi cả hai cùng nổ, `overlappedBy` nói được
           * ĐÍCH DANH ai đã chồng lên, còn nhánh này chỉ nói "có ai đó" — câu chẩn đoán cụ thể
           * hơn phải thắng, đúng tiền lệ I-2 (đừng chỉ người trực đi sai hướng).
           *
           * ⚠ ĐẶT TRƯỚC nhánh `actual < 0`: một cửa sổ không cô lập được cũng đẻ ra delta âm khi
           * người kia nhả chỗ xen giữa, và khi cả hai cùng đúng thì mất-cô-lập mới là nguyên nhân
           * GỐC — cùng lý do đã ghi cho nhánh `overlappedBy` ở trên.
           *
           * ⚠ KHÔNG commit, KHÔNG `recordActual()`. Đây là điểm dễ sai nhất: một con số nuốt
           * thêm byte của người khác mà được `recordActual()` sẽ đóng đinh vào nấc "learned" và
           * sống tới hết đời tiến trình — biến thể "tệ hơn và KHÔNG tự lành" (xem `OpenMeasureWindow`).
           */
          if (!measurable) {
            broker.markMeasureFailed(lease);
            logVramEvent({
              event: "measure_failed",
              owner: opts.owner,
              leaseKind: opts.kind,
              priority: opts.priority,
              estimatedBytes: est.bytes,
              estimateSource: est.source,
              detail: {
                reason: "measure-window-not-exclusive",
                measureSource: "none" satisfies VramMeasureSource,
                measureScope: scope,
                discardedDeltaBytes: actual,
                beforeUsedBytes: beforeUsed,
                afterUsedBytes: after,
                note:
                  "khoá nối tiếp KHÔNG bảo đảm được tính độc chiếm cho cửa sổ này (hết ngân sách " +
                  "chờ, hoặc có lượt chạy-không-đo xen vào giữa hai đầu đo). Bộ đếm trả MỘT số " +
                  "cho mỗi PID nên hiệu số ở đây gồm cả byte của lượt kia. Giấy phép GIỮ ƯỚC " +
                  "LƯỢNG; hạ VRAM_MEASURE_WAIT_MS hay nạp bớt song song sẽ làm nhánh này thưa đi.",
              },
            });
            chotSoBangDuPhong("measure-window-not-exclusive");
            return;
          }

          /**
           * ★★★ C-1 (review TOÀN NHÁNH) — "CỬA THỨ TÁM": CÓ LƯỢT **NHẢ** XEN GIỮA HAI ĐẦU ĐO.
           * Lý do đầy đủ + đường đi + số đo 3/3 ở khối docstring `OpenMeasureWindow` đầu file.
           *
           * ⚠ ĐẶT **TRƯỚC** nhánh `actual < 0` — đây là điểm cốt lõi, không phải sở thích thứ tự:
           * nhánh delta-âm chỉ **SUY RA** rằng "có lượt nhả/evict xen giữa" từ dấu của hiệu số, và
           * vì thế nó chỉ phủ được NỬA lớp (nhả nhiều hơn cấp). Nhánh này **BIẾT** lượt nhả đã xảy
           * ra và biết ĐÍCH DANH ai nhả, nên nó phủ CẢ nửa còn lại — biến thể **một phần**
           * (nhả ÍT hơn cấp ⇒ delta dương-nhưng-hụt) mà trước bản vá này đi thẳng vào `commit()`
           * + `recordActual()` và tự khai là đo được. Để delta-âm bắt trước sẽ ghi vào nhật ký một
           * chẩn đoán NGHÈO HƠN cho đúng cùng một nguyên nhân gốc.
           *
           * ⚠ ĐẶT **SAU** `overlappedBy`/`!measurable`: hai nhánh đó nói về lượt CẤP PHÁT của
           * người khác chồng lên cửa sổ này (hiệu số bị CỘNG THÊM); nhánh này nói về lượt NHẢ
           * (hiệu số bị TRỪ BỚT). Khi cả hai cùng đúng, mất-cô-lập là điều kiện rộng hơn và đã có
           * câu chẩn đoán riêng — giữ nguyên thứ tự đã lập ở Task 3/Task 8, không đảo.
           *
           * ⚠ KHÔNG CỘNG BÙ phần vừa nhả, dù `releasedDuring` có tên chủ nhân: sổ biết AI nhả,
           * KHÔNG biết BAO NHIÊU byte đã thật sự rời thiết bị tại thời điểm nào (`leaseBytes()`
           * của họ có thể chính là một ước lượng chưa xác minh, và `dispose()` của llama.cpp
           * không trả byte tức thời). Mọi phép cộng bù ở đây là bịa — cùng lý lẽ với "KHÔNG chia
           * tỉ lệ" của nhánh `overlappedBy`.
           */
          if (win && win.releasedDuring.length > 0) {
            broker.markMeasureFailed(lease);
            logVramEvent({
              event: "measure_failed",
              owner: opts.owner,
              leaseKind: opts.kind,
              priority: opts.priority,
              estimatedBytes: est.bytes,
              estimateSource: est.source,
              detail: {
                reason: "release-during-measure-window",
                measureSource: "none" satisfies VramMeasureSource,
                measureScope: scope,
                measurable,
                releasedDuring: win.releasedDuring,
                discardedDeltaBytes: actual,
                beforeUsedBytes: beforeUsed,
                afterUsedBytes: after,
                note:
                  "một giấy phép CÙNG PHẠM VI đã gọi release() TRONG cửa sổ đo này ⇒ hiệu số " +
                  "`after − before` bị TRỪ ĐI phần vừa rời thiết bị, tức HỤT một lượng không tách " +
                  "được. Khoá nối tiếp CHỈ bao lượt CẤP PHÁT, KHÔNG bao lượt NHẢ (ensureCapacity() " +
                  "chạy TRƯỚC beginVram(); unloadGgufModel() gọi được qua HTTP bất cứ lúc nào), nên " +
                  "`measurable` vẫn true và `overlappedBy` vẫn rỗng — trước bản vá C-1 con số HỤT " +
                  "này được commit + recordActual() và khai là ĐO ĐƯỢC. Giấy phép GIỮ ƯỚC LƯỢNG; " +
                  "KHÔNG cộng bù phần đã nhả (sổ biết AI nhả, không biết BAO NHIÊU byte đã rời).",
              },
            });
            chotSoBangDuPhong("release-during-measure-window");
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
          // Đường sinh delta âm có THẬT và dài NHIỀU GIÂY: `aiGgufEngine.ts:885`
          // `while (await evictLRU())` chạy GIỮA `beforeUsed` (mở ở `:851`) và `commitMeasured()`
          // (`:916`) — đuổi 17 GB rồi nạp 4 GB. (M-2 review TOÀN NHÁNH — ba số dòng cũ `:771/:737/
          // :802` đã mục; kiểm lại bằng máy 2026-08-04.)
          //
          // ⚠⚠ C-1 (review TOÀN NHÁNH) — NHÁNH NÀY CHỈ PHỦ **NỬA** LỚP LỖI "có lượt nhả xen giữa",
          // và phải nói ra: nó bắt được ca nhả NHIỀU HƠN cấp (delta đổi dấu). Ca nhả **ÍT HƠN**
          // cấp cho delta DƯƠNG-nhưng-HỤT và đi lọt hoàn toàn qua đây — nửa đó nay do nhánh
          // `release-during-measure-window` NGAY TRÊN bắt, bằng SỰ KIỆN nhả chứ không bằng dấu của
          // hiệu số. Hai nhánh là MỘT lưới; gỡ nhánh trên thì nửa "hụt im lặng" sống lại nguyên vẹn.
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
              detail: {
                measuredDeltaBytes: actual,
                measureSource: "none" satisfies VramMeasureSource,
                measureScope: scope,
                beforeUsedBytes: beforeUsed,
                afterUsedBytes: after,
                note:
                  "delta ÂM ⇒ phép đo vô nghĩa (có lượt nhả/evict xen giữa hai đầu đo). Giấy phép " +
                  "GIỮ NGUYÊN ước lượng và sẽ KHÔNG BAO GIỜ được xác minh — đây là nguồn lệch ÂM " +
                  "dai dẳng, KHÔNG phải 'đang cấp phát dở'. KHÔNG thử lại: beforeUsed đã cũ, " +
                  "thử lại chỉ tạo ra một số sai trông như số thật.",
              },
            });
            chotSoBangDuPhong("negative-delta");
            return;
          }

          /**
           * ★★★ I-1 (review vòng 1) — "CỬA THỨ TÁM": DELTA 0 MÀ BỘ ĐẾM CHƯA TỪNG THẤY TA.
           *
           * `0` ở đây có thể là HAI thứ khác hẳn nhau, và trước bản vá này chúng cho cùng một kết
           * quả: (a) hộ tiêu thụ THẬT SỰ chiếm 0 byte VRAM (reranker chạy CPU) — số liệu THẬT,
           * PHẢI ghi; (b) bộ đếm KHÔNG THẤY cây tiến trình của ta (bộ đếm vắng, regex không khớp,
           * mẫu hợp lệ nhưng không có khoá của ta) — KHÔNG có phép đo nào cả.
           *
           * Ghi (b) như thể là (a) là điều nguy hiểm nhất mà đường này làm được: `commit(0)` kèm
           * `measureSource: "process-delta"` + `measureFailed: false` = **khai là đo được**, rồi
           * `recordActual(owner, 0)` **đóng đinh nấc `learned` = 0 tới hết đời tiến trình**. Ở
           * Pha 2B, ước lượng 0 nghĩa là dư địa VÔ HẠN ⇒ broker KHÔNG BAO GIỜ từ chối ⇒ OOM.
           * Một phép đo hỏng tự khai là thành công tệ hơn hẳn một phép đo tự khai là hỏng.
           *
           * ⚠ CHỈ CHẶN KHI `actual === 0` VÀ đầu đo SAU không thấy ta — KHÔNG chặn theo đầu đo
           * TRƯỚC, và đây là chỗ dễ sai nhất:
           *   • "trước không thấy, sau thấy" là ca BÌNH THƯỜNG và BẮT BUỘC phải commit — đó chính
           *     là lượt cấp phát ĐẦU TIÊN của cả tiến trình (`cuda-backend`): trước `getLlama()`
           *     tiến trình chưa có một byte VRAM nào nên không có thể hiện bộ đếm nào mang PID của
           *     nó. Chặn theo đầu đo trước = `gguf-backend` LUÔN `measureFailed` = tái sinh đúng
           *     T5-15 (giấy phép backend đo hỏng chặn nền VĨNH VIỄN) mà Task 4 sinh ra để đóng.
           *   • "trước thấy (>0), sau không thấy" ⇒ delta ÂM ⇒ đã bị nhánh trên bắt.
           *   • "cả hai đều thấy, delta = 0" ⇒ số liệu THẬT của hộ chạy CPU ⇒ vẫn commit, giữ
           *     nguyên hành vi mà I-2/Task 5 đã cố ý dựng (`>= 0`, `??` chứ không `||`).
           */
          if (actual === 0 && !afterReading.seen) {
            broker.markMeasureFailed(lease);
            logVramEvent({
              event: "measure_failed",
              owner: opts.owner,
              leaseKind: opts.kind,
              priority: opts.priority,
              estimatedBytes: est.bytes,
              estimateSource: est.source,
              detail: {
                reason: "measure-target-absent",
                measureSource: "none" satisfies VramMeasureSource,
                measureScope: scope,
                beforeUsedBytes: beforeUsed,
                afterUsedBytes: after,
                note:
                  "delta = 0 NHƯNG bộ đếm không có khoá nào cho cây tiến trình này ở đầu đo SAU ⇒ " +
                  "không phân biệt được 'thật sự 0 byte' với 'bộ đếm không thấy ta'. Ghi 0 ở đây là " +
                  "khai một phép đo KHÔNG TỒN TẠI là thành công, và recordActual(0) sẽ đóng đinh nấc " +
                  "learned = 0 tới hết đời tiến trình — ở Pha 2B nghĩa là dư địa VÔ HẠN, tức OOM. " +
                  "Giấy phép GIỮ ƯỚC LƯỢNG.",
              },
            });
            // ★ N-2 (Pha 2A Task 4) — CỬA MÀ CHÍNH TASK 3 VỪA MỞ. Trước Task 3, "bộ đếm có mà mù"
            // đi thẳng vào `commit(0)`; nay nó là một nhánh đo-hỏng, nên với `gguf-backend` (không
            // có đường release) nó cũng dẫn tới `actualBytes === null` VĨNH VIỄN. Đánh đổi của
            // Task 3 đúng, nhưng nó biến T5-15 từ HIẾM thành THƯỜNG GẶP — phải chốt sổ ở đây.
            chotSoBangDuPhong("measure-target-absent");
            return;
          }

          // Pha 2A — SỐ NÀY ĐẾN TỪ BỘ ĐẾM THEO TIẾN TRÌNH. `measureSource` phải đi CÙNG con số,
          // không phải suy ra theo ngày commit: đó là thứ duy nhất giữ cho Đ4 kiểm được bằng dữ
          // liệu (types.ts `VramMeasureSource`).
          broker.commit(lease, actual, "process-delta");
          /**
           * ⚠ M-3 (review TOÀN NHÁNH) — HÀNG RÀO `released` LÀ CỦA `recordActual()`, KHÔNG PHẢI
           * của `commit()`. `broker.commit()` tự kiểm `live.released` và là **no-op** trên một
           * giấy phép đã rời sổ (`vramBroker.ts`); `estimator.recordActual()` **không kiểm gì**.
           * Không có dòng này, một lượt `release()` chen vào giữa `commitMeasured()` đang bay để
           * lại sổ ĐÚNG (không ghi gì) nhưng nấc `learned` VẪN bị đóng đinh bằng con số của một
           * cửa sổ đã hỏng — và `learned` sống tới hết đời tiến trình, còn sổ thì không.
           * ⚠ Đây là lưới THỨ HAI, không phải lưới duy nhất: ca đó thường đã bị nhánh
           * `release-during-measure-window` (C-1) bắt trước, vì `release()` ghi vào cửa sổ TRƯỚC
           * khi đóng nó. Giữ cả hai — hai lưới cho một lớp lỗi "tự khai là thành công" là đúng giá.
           */
          if (!released) estimator.recordActual(opts.owner, actual);
          logVramEvent({
            event: "commit",
            owner: opts.owner,
            leaseKind: opts.kind,
            priority: opts.priority,
            estimatedBytes: est.bytes,
            actualBytes: actual,
            estimateSource: est.source,
            // ⚠ Đ4 — KHÔNG ghi `deviceUsedBytes` ở đây nữa. Trường đó mang số của thước KIA
            // (`nvidia-smi`/`getVramState`); để nó nằm cạnh một `actualBytes` của bộ đếm là mời
            // người đọc sau trừ hai số lệch nhau +505…+511 MiB. Ai cần số thiết bị đọc sự kiện
            // `drift` của `vramReconciler` — nơi cả hai đầu đều là thước thiết bị.
            detail: {
              measureSource: "process-delta" satisfies VramMeasureSource,
              measureScope: scope,
              beforeUsedBytes: beforeUsed,
              afterUsedBytes: after,
            },
          });
        } catch {
          // ★★ Task 8 (C-1) — đầu dò "sau" NÉM ⇒ cửa sổ vẫn phải đóng. Bỏ sót nhánh này là rò
          // một cửa sổ mở vĩnh viễn: mọi phép đo sau đó của tiến trình bị gắn cờ sai và KHÔNG
          // tự lành cho tới khi khởi động lại. Idempotent — gọi lại sau closeWindow() ở trên là
          // no-op. Pha 2A: nó cũng là nơi DUY NHẤT nhả khoá nối tiếp ở nhánh này.
          closeWindow();
          /* telemetry hỏng KHÔNG được làm hỏng lượt cấp phát */
        }
      },
      release() {
        try {
          if (released) return;
          released = true;
          /**
           * ★★★ C-1 (review TOÀN NHÁNH) — KHAI BÁO LƯỢT NHẢ CHO MỌI CỬA SỔ ĐANG MỞ. Lý do đầy đủ
           * ở khối docstring `OpenMeasureWindow` đầu file.
           *
           * ⚠ PHẢI ĐỨNG **TRƯỚC** `closeWindow()`, và đó là điều kiện chứ không phải phong cách:
           *   • đứng trước ⇒ cửa sổ của CHÍNH giấy phép này (nếu `commitMeasured()` còn đang bay)
           *     cũng được đánh dấu — byte của nó vừa rời thiết bị nên hiệu số của nó cũng hỏng
           *     (đây là lối đóng của M-3 bằng cấu trúc);
           *   • đứng sau ⇒ đường "commit xong RỒI mới release" (đường THƯỜNG) không đổi gì cả, vì
           *     cửa sổ đã đóng từ `commitMeasured()`. Nghĩa là dòng này KHÔNG gắn cờ oan cho lượt
           *     nhả bình thường; nó chỉ nổ khi có người KHÁC đang đo.
           *
           * ⚠ KHÔNG lấy khoá, KHÔNG chờ, KHÔNG chặn: điều lệ Pha 2A cấm đổi hành vi nhả. Đây là
           * một lời ghi chú ĐỒNG BỘ vào Map trong bộ nhớ — chi phí O(số cửa sổ đang mở), thực tế 0
           * hoặc 1.
           */
          noteReleaseDuringOpenWindows(opts.owner, scope);
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
            /**
             * ⚠ I-2 (review vòng 1, Task 4) — ĐỌC TỪ GIẤY PHÉP, KHÔNG DÙNG BIẾN CỤC BỘ CŨ.
             * `est.source` được chốt ở `beginVramAllocation()` và KHÔNG bao giờ đổi nữa; mọi thứ
             * xảy ra với giấy phép sau đó (kể cả chốt sổ bằng dự phòng) đều vô hình với nó. Dòng
             * `release` vì thế từng ghi một `actualBytes` ƯỚC LƯỢNG cạnh một `estimateSource` của
             * lượt reserve — hai nửa nói hai chuyện, và người đọc nhật ký (lẫn Pha 2B) không có
             * cách nào biết đó là số đo hay số ước lượng.
             *
             * ⚠ HẠ GIỌNG (re-review vòng 1) — DÒNG NÀY HÔM NAY LÀ MÃ TRƠ, đừng tin nó làm việc.
             * Sau khi M-3 gỡ lời ghi đè, KHÔNG còn writer nào chạm `request.estimateSource`, mà
             * `reserve()` luôn được gọi với đúng `estimateSource: est.source` ⇒ hai vế LUÔN BẰNG
             * NHAU. Chứng minh bằng đột biến: trả dòng này về `est.source` thì 212/212 VẪN XANH —
             * tức ca 15 KHÔNG phải lưới cho dòng này.
             * Giữ lại vì đọc từ sổ SỐNG là hướng đúng khi có thêm writer, NHƯNG:
             * thứ thật sự phân biệt số đo với số ước lượng là `detail.measured`, KHÔNG phải ô này.
             */
            estimateSource: lease.request.estimateSource ?? est.source,
            // I-1 — bằng chứng thiết bị đã nhả (bảng bốn điểm nhả ở đầu file). Truy vấn được:
            //   SELECT owner, count(*) FROM vram_events
            //   WHERE event='release' AND detail->>'releaseProof'='unverified' GROUP BY 1;
            detail: {
              releaseProof: opts.releaseProof ?? "device-disposed",
              /**
               * I-2 × T5-15 — HAI trường trả lời dứt điểm câu "`actualBytes` ở dòng này là SỐ ĐO
               * hay ƯỚC LƯỢNG?". Truy vấn được, không cần migration (jsonb):
               *   SELECT owner, detail->>'fallbackReason' FROM vram_events
               *   WHERE event='release' AND detail->>'measured'='false';
               */
              measured: lease.actualBytes !== null && lease.fallbackReason === undefined,
              fallbackReason: lease.fallbackReason ?? null,
            },
          });
        } catch {
          /* telemetry hỏng KHÔNG được làm hỏng lượt nhả tài nguyên */
        }
      },
    };
  } catch (err) {
    // Sổ cái/nhật ký/đầu dò hỏng ở BẤT KỲ khâu nào ⇒ hệ chạy như chưa từng có module này.
    // ⚠ Pha 2A — NHẢ KHOÁ trước khi bỏ đi: từ đây không còn ticket nào để gọi `closeWindow()`.
    try { nhaKhoaKhanCap?.(); } catch { /* không có gì cứu được nữa, nhưng KHÔNG được ném */ }
    /**
     * ★★★ Pha 2B Task 5 — MỘT LỜI TỪ CHỐI **KHÔNG PHẢI** MỘT LỖI TELEMETRY. ĐỌC TRƯỚC KHI SỬA.
     *
     * `catch` này có một chính sách từ Pha 1: *"telemetry chết thì hệ vẫn phải nạp được model"* ⇒
     * nuốt lỗi, trả `NOOP_TICKET`, lượt cấp phát chạy tiếp NGOÀI SỔ. Chính sách đó vẫn đúng cho
     * cái nó sinh ra để xử: sổ hỏng, nhật ký hỏng, đầu dò hỏng.
     *
     * ⚠⚠ Nhưng `VramRefusedError` đi qua ĐÚNG cái `catch` này, và nuốt nó ở đây thì **toàn bộ pha
     * cưỡng chế thành vô hiệu trong đúng một dòng**: broker từ chối → wiring nuốt → trả ticket
     * rỗng → model vẫn nạp → OOM. Ném lại TRƯỚC MỌI THỨ KHÁC, và cố ý đặt ngay dưới lượt nhả khoá
     * (một lượt từ chối cũng phải nhả khoá nối tiếp — nếu không, cả tiến trình chờ 180 s ở lượt
     * nạp sau).
     *
     * ⚠ Và KHÔNG đếm nó vào `vramBeginFailureState()`: ô đó đo **sổ đang HỤT bao nhiêu byte**. Một
     * lượt bị từ chối KHÔNG cấp phát byte nào ⇒ sổ không hụt gì cả. Cộng nó vào là tự trừ dư địa
     * của mình hai lần cho một khối byte chưa bao giờ tồn tại.
     */
    if (err instanceof VramRefusedError) throw err;
    /**
     * ★★ Pha 2B Task 2 (C-1) — NUỐT LỖI THÌ ĐƯỢC, NUỐT **IM LẶNG** THÌ KHÔNG.
     *
     * Bản trước `catch { … }` không ghi lấy một chữ. Hậu quả đo được bằng lập luận, không phải giả
     * định: từ Pha 2B, `beginVramAllocation()` là nơi cổng cưỡng chế đứng, nên một lỗi ở bất kỳ
     * khâu nào trong `try` biến thành `NOOP_TICKET` — tức **cưỡng chế tắt VÀ khối byte không vào
     * sổ**, không một dòng nào để lần ra. Đó đúng lớp lỗi ràng buộc 9 cấm.
     *
     * ⚠ Pha 2B Task 3 — **PHẠM VI CỦA `catch` NÀY ĐÃ HẸP LẠI**: ba lệnh `await import()` từng đứng
     * đầu `try` nay là import TĨNH (khối docstring đầu file). Câu cũ *"cả `await
     * import("./vramBroker")` lẫn `broker.reserve()` đều nằm trong cùng cái `try` này"* KHÔNG CÒN
     * ĐÚNG và đã bị gỡ — lỗi nạp module nay nổ ở nơi khác, với câu khác.
     * ⚠ VẪN KHÔNG NÉM: telemetry chết thì hệ vẫn phải nạp được model (chính sách của file này, giữ
     * nguyên). Đóng nốt phần "sổ hụt" = TỪ CHỐI lượt cấp phát = công tắc cưỡng chế = **Task 5**.
     */
    soLuotBeginHong++;
    lyDoBeginHongCuoi = (err as Error)?.message ?? String(err);
    /**
     * ★ C-1 (review vòng 1) — SỔ PHẢI TỰ KHAI PHẦN HỤT BẰNG **BYTE**, KHÔNG PHẢI BẰNG **LƯỢT**.
     *
     * Reviewer bác đúng một nửa lập luận của vòng trước: thiệt hại tồn dư có HAI thành phần —
     * (i) **cưỡng chế mù** cho khối byte đó, (ii) **sổ hụt** đúng khối byte đó. Đóng (i) bắt buộc
     * phải TỪ CHỐI ⇒ công tắc cưỡng chế ⇒ Task 5, và Task 3 không được làm. Nhưng (ii) **không
     * cần từ chối ai cả**: đó là KẾ TOÁN, không phải chính sách. Và **một cái đếm KHÔNG BAO GIỜ
     * đổi ngược lại thành byte được** — Task 5 sẽ cần *"sổ đang hụt BAO NHIÊU"*, không phải
     * *"hụt mấy lượt"*.
     */
    const byteHut = byteUocCuaLuotHong(opts, byteDaBiet);
    if (byteHut !== null) byteNgoaiSo += byteHut;
    else soLuotBeginHongKhongBietByte++;
    console.warn(
      `[vram] beginVramAllocation("${opts.owner}") HỎNG ⇒ chạy như chưa từng có sổ cái ` +
        `(KHÔNG có giấy phép cho lượt cấp phát này, nên sổ HỤT ` +
        `${byteHut === null ? "MỘT LƯỢNG KHÔNG BIẾT ĐƯỢC" : `~${Math.round(byteHut / 1024 / 1024)} MiB`}` +
        `; lượt hỏng thứ ${soLuotBeginHong}, tổng hụt ~${Math.round(byteNgoaiSo / 1024 / 1024)} MiB ` +
        `của tiến trình): ${lyDoBeginHongCuoi}`,
    );
    /**
     * Sự kiện — KHÔNG chỉ một dòng console. `logVramEvent()` là import TĨNH nên nếu nó nạp được
     * thì nó luôn gọi được; nếu nó KHÔNG nạp được thì cả module này cũng không, và ta không ở đây.
     * ⚠ Bọc `try`: một `catch` chống-im-lặng mà tự nó ném là biến một lỗi telemetry thành một lỗi
     * cấp phát — đúng thứ chính sách của file này cấm.
     */
    try {
      logVramEvent({
        event: "refuse",
        owner: opts.owner,
        leaseKind: opts.kind,
        priority: opts.priority,
        detail: {
          reason: "begin-allocation-failed",
          failureCount: soLuotBeginHong,
          /** ★ C-1 — byte của LƯỢT NÀY và TỔNG tích luỹ. `null` = không có căn cứ nào để ước. */
          unledgeredBytes: byteHut,
          unledgeredBytesTotal: byteNgoaiSo,
          unledgeredBytesUnknown: byteHut === null,
          error: lyDoBeginHongCuoi,
          note:
            "beginVramAllocation() hỏng ⇒ trả NOOP_TICKET ⇒ lượt cấp phát này chạy NGOÀI SỔ: " +
            "cưỡng chế mù cho khối byte đó VÀ dư địa bị phóng đại đúng bằng nó. Đây KHÔNG phải " +
            "một lượt từ chối — không ai bị chặn cả; tên `refuse` dùng lại từ vựng §5.3 để câu " +
            "truy vấn của Task 7 không phải biết thêm một loại. Phân biệt bằng detail.reason.",
        },
      });
    } catch {
      /* đã có console.warn ở trên — không còn gì cứu được, nhưng KHÔNG được ném */
    }
    return NOOP_TICKET;
  }
}

/**
 * ★ Pha 2B Task 3 — TRẠNG THÁI HỎNG CỦA `beginVramAllocation()`, ĐỌC ĐƯỢC BẰNG MÃ.
 *
 * Task 2 để lại một `console.warn`. Một dòng console KHÔNG PHẢI một cơ chế: không ai `grep` được
 * nó từ trong tiến trình, và Task 5 (cưỡng chế) lẫn Task 7 (đọc sổ) đều cần biết *"sổ này có đang
 * hụt không, và hụt bao nhiêu lượt"* để không quyết định trên một con số đã biết là thiếu.
 *
 * ⚠ Hôm nay HÀM NÀY CHƯA CÓ NGƯỜI ĐỌC ngoài bộ test — nói thẳng ra thay vì để người sau tưởng nó
 * đang canh gì đó (cùng hình dạng "sổ đã tới cửa, cửa chưa mở" mà Task 2 bàn giao cho Task 5).
 *
 * ★ C-1 (review vòng 1) — `unledgeredBytes` là ô mà **Task 5 thật sự cần**: cưỡng chế quyết định
 * trên BYTE, và **một cái đếm không đổi ngược thành byte được**. `unknownCount` là số lượt hỏng mà
 * ngay cả byte cũng không ước được — nó phải TÁCH khỏi `unledgeredBytes`, vì cộng 0 cho một lượt
 * "không biết" là để cuốn sổ hụt tự khai là đủ.
 */
export function vramBeginFailureState(): {
  readonly count: number;
  readonly lastReason: string | null;
  readonly unledgeredBytes: number;
  readonly unknownCount: number;
} {
  return {
    count: soLuotBeginHong,
    lastReason: lyDoBeginHongCuoi,
    unledgeredBytes: byteNgoaiSo,
    unknownCount: soLuotBeginHongKhongBietByte,
  };
}

/**
 * ★ Pha 2B Task 5 — cùng sự thật, đúng hình dạng mà đường QUYẾT ĐỊNH đòi (`VramUnledgeredFact`).
 *
 * ⚠ VÌ SAO KHÔNG BAO GIỜ TRẢ `null` Ở ĐÂY: `null` nghĩa **"CHƯA HỎI"**, và trên đường sản xuất thì
 * ta LUÔN hỏi — hàm này chính là lượt hỏi. `null` được giữ trong kiểu cho những người gọi KHÁC
 * (test, và bất kỳ điểm quyết định tương lai nào không đọc được ô này), và nó có phụ phí riêng
 * (`"unledgered-unasked"`) đúng vì "chưa hỏi" ≠ "đã kiểm và không có gì".
 *
 * ⚠ Hai ô đổi tên có chủ ý: `unledgeredBytes` (ngôn ngữ của người ĐO) → `bytes` (ngôn ngữ của người
 * QUYẾT ĐỊNH). Đây là chỗ DUY NHẤT dịch giữa hai từ vựng đó.
 */
export function vramUnledgeredFact(): { readonly bytes: number; readonly unknownCount: number } {
  const s = vramBeginFailureState();
  return { bytes: s.unledgeredBytes, unknownCount: s.unknownCount };
}

/** Chỉ dùng trong test. */
export function __resetVramBeginFailureState(): void {
  soLuotBeginHong = 0;
  lyDoBeginHongCuoi = null;
  byteNgoaiSo = 0;
  soLuotBeginHongKhongBietByte = 0;
}
