import { snapshot, leaseBytes } from "./vramBroker";
import { readDeviceVram } from "./vramProbe";
import { logVramEvent } from "./vramEventLog";
import type { VramLease } from "./types";
import type { GpuHolderCensus } from "./vramGpuHolders";
import type { HeadroomTickFields } from "./vramHeadroom";
import {
  __resetDecisionTickForTests, decisionTickFailureStreak, noteDecisionTickFailure, publishDecisionTick,
} from "./vramTickCell";
/**
 * ★★★ Pha 3 Task 3 (N-WB-1) — SỔ CHUNG. Nhập TĨNH được vì `vramSharedLedger` là **module LÁ**:
 * nó chỉ `import type`, không I/O, không kéo theo `vramBroker`/DB (xem docstring ở đó). Đây cũng
 * là lý do nửa ĐỒNG BỘ của sổ chung phải nằm ở một file riêng với nửa I/O.
 */
import {
  enqueueSharedLedgerWrite, loaiHangDaChungMinhLaMa, publishOwnSharedBaseline, readSharedBaseline,
  readSharedLedgerReplica, sharedLedgerFact, sharedLedgerSelfKey,
} from "./vramSharedLedger";
import type { SharedBaselineRecord, SharedLeaseRow } from "./vramSharedLedger";
/**
 * ★★★ Pha 3 Task 4 (§6) — nhận nuôi/thu hồi. Nhập TĨNH được vì `vramAdoption` là **module LÁ**
 * (chỉ `import type` + một hằng chuỗi từ `vramSharedLedger`, không I/O, thuần).
 */
import {
  hangNenChoKeHoach, lapKeHoachNhanNuoi, moTaSidecarNhanNuoi, ownerNhanNuoi,
} from "./vramAdoption";
import type { ProcTableRow } from "./vramGpuHolders";

/**
 * Pha 2B Task 1 — quét danh tính hộ đang giữ GPU, KHÔNG BAO GIỜ ném, KHÔNG BAO GIỜ chặn đường boot.
 *
 * ⚠ `await import()` (không phải import tĩnh) CÓ CHỦ ĐÍCH, và đây là bài học đã trả giá ở
 * `vramReconciler.ts` dòng ~576: nhiều file test thay CẢ module `./vramProcessProbe` bằng bản giả
 * chỉ khai đúng những export chúng cần. `vramGpuHolders` import `collectDescendants` từ đó, nên
 * một import TĨNH ở đây sẽ làm mọi file test như thế vỡ ngay lúc nạp module ("No export is
 * defined"), với lỗi chẳng liên quan gì tới thứ chúng đang kiểm. Nhập động + `catch` biến ca đó
 * thành ĐÚNG ngữ nghĩa ta muốn: KHÔNG QUÉT ĐƯỢC ⇒ `null` ⇒ nền CHƯA XÁC MINH ⇒ cưỡng chế chạy mù.
 */
async function readGpuHoldersSafe(): Promise<GpuHolderCensus | null> {
  try {
    const { readGpuHolders } = await import("./vramGpuHolders");
    return await readGpuHolders([process.pid]);
  } catch {
    return null;
  }
}

/**
 * ★ Pha 3 Task 4 — bảng tiến trình, cùng kỷ luật `readGpuHoldersSafe()`: nhập ĐỘNG + nuốt lỗi.
 * `null` = **KHÔNG CÓ BẰNG CHỨNG** (nền tảng khác Windows · powershell hỏng · **file test thay cả
 * module `./vramGpuHolders` bằng bản giả không khai `readProcTable`**) ⇒ lượt nhận nuôi/thu hồi
 * KHÔNG làm gì. Đó là chiều đúng: không có bằng chứng thì không xoá hàng của ai, và cũng không
 * đứng tên hộ của ai.
 */
async function readProcTableSafe(): Promise<readonly ProcTableRow[] | null> {
  try {
    const mod = await import("./vramGpuHolders");
    if (typeof mod.readProcTable !== "function") return null;
    return await mod.readProcTable();
  } catch {
    return null;
  }
}

const DRIFT_THRESHOLD_BYTES = Number(process.env.VRAM_DRIFT_THRESHOLD_MB ?? 512) * 1024 * 1024;
const INTERVAL_MS = Number(process.env.VRAM_RECONCILE_INTERVAL_MS ?? 60_000);

/**
 * ★ Pha 4 Task 1 — NHỊP LÀM MỚI, ĐỌC ĐƯỢC TỪ NGOÀI. **MỘT hằng số, hai người đọc**
 * (`startVramReconciler()` và mặt đọc của Agent).
 *
 * ⚠⚠ CON SỐ NÀY LÀ **ĐỘ TRỄ CƯỠNG CHẾ THẬT XUYÊN TIẾN TRÌNH**, không phải một chi tiết vận hành:
 * bản sao đọc sổ chung được làm mới theo đúng nhịp này, nên một giấy phép 17 GB vừa mở ở tiến
 * trình anh em **có thể mất tới trọn một chu kỳ** mới hiện ra. Mặt đọc của Agent **phải khai nó**
 * — nếu không, một Agent thấy `foreignBytes: 0` sẽ tưởng card trống trong đúng cửa sổ nguy hiểm
 * nhất. Chép lại `Number(process.env.VRAM_RECONCILE_INTERVAL_MS ?? 60_000)` ở nơi khác là dựng
 * bản sao thứ hai của cùng một cấu hình (ràng buộc 12).
 */
export function reconcileIntervalMs(): number {
  return INTERVAL_MS;
}
/**
 * Pha 1.5 Task 7 (T5-1) — sau BAO LÂU thì "hoãn chụp nền" phải thành BÁO ĐỘNG.
 *
 * ⚠ VÌ SAO BẮT BUỘC: `captureVramBaseline()` nay HOÃN khi còn giấy phép đang nạp (xem docstring
 * ở đó). Hoãn nghĩa là `baselineUsedBytes === null`, mà `reconcileOnce()` trả `alarm: false` cho
 * trạng thái đó — tức IM LẶNG. Im lặng NGẮN là đúng (đợi vài giây cho lượt nạp xong); im lặng
 * KÉO DÀI mà không ai biết đang im lặng là ĐÚNG LỚP LỖI EXP-1 mà bộ ngắt mạch ở trên sinh ra để
 * diệt. Quá mốc này thì lượt đối chiếu KHÔNG chụp được nền phải KÊU — nội dung nói rõ đây là
 * "không đo được nền", KHÔNG PHẢI "cấp phát chui" (hai nguyên nhân, hai hành động sửa khác nhau).
 *
 * ⚠ 5 PHÚT là số CÓ NGUỒN, không phải tiện tay — nó phải LỚN HƠN mọi cửa sổ nạp HỢP LỆ đo được
 * và NHỎ HƠN mọi vòng đời hộ "cố ý không commit":
 *   • nạp 30B: 11-43 s (Pha 1 §3.5) · sidecar thị giác: ≤ `READY_TIMEOUT_MS` 120 s rồi commit
 *   • `cron:kb-eval-gate` 10 phút · `cron:kb-sync` 30 phút · `sidecar:local-trainer` 2 GIỜ
 *     — ba hộ này KHÔNG BAO GIỜ gọi `commitMeasured()` (đo ở mã, xem docstring hàm chụp nền)
 * ⇒ một lượt nạp bình thường KHÔNG kích hoạt nhánh này; một hộ ngoài tiến trình sống lâu thì CÓ,
 * và đó chính là điều người trực cần biết: phép đối chiếu đang mù, và mù VÌ AI.
 */
const BASELINE_BLOCKED_ALARM_MS = Number(process.env.VRAM_BASELINE_BLOCKED_ALARM_MS ?? 300_000);

/**
 * Pha 1.5 Task 7 (T5-1) — "giấy phép ĐANG NẠP", theo nghĩa **byte thật sắp tới, sổ chưa theo kịp**.
 *
 * Dùng ở HAI chỗ: `pendingBytes` (băng dung sai âm, Task 3) và danh sách "ứng viên số một" trong
 * câu cảnh báo lệch âm (I-2). Hai chỗ đó BẮT BUỘC cùng một tập — cả hai đều trả lời câu hỏi
 * *"khoản thiếu hụt này có TỰ LÀNH không?"*, và câu trả lời cho `measureFailed` là KHÔNG.
 *
 * ⚠ LOẠI `measureFailed === true` (lý do đầy đủ ở docstring `pendingBytes` trong `reconcileOnce`):
 * cờ đó nghĩa là phép đo ĐÃ CHẠY XONG và cho số vô nghĩa ⇒ lease KHÔNG BAO GIỜ commit; nới băng
 * dung sai theo nó là nới VĨNH VIỄN, tự tay bịt miệng chuông mà `measure_failed` cố ý để lại dấu.
 *
 * ⚠⚠ KHÔNG DÙNG CHO LÁ CHẮN HOÃN CHỤP NỀN — xem `holdsUncommittedBytes()` ngay dưới. Bản trước
 * dùng CHUNG một vị từ cho cả ba hộ tiêu thụ và đó chính là lỗ hổng mà review TOÀN NHÁNH bắt được:
 * hai câu hỏi KHÁC NHAU ("có tự lành không?" vs "nó có giữ byte mà sổ commit không thấy không?")
 * bị ép trả lời bằng CÙNG một tập.
 */
function isLoadingLease(l: VramLease): boolean {
  return l.actualBytes === null && !l.measureFailed;
}

/**
 * ★★ VÁ SAU REVIEW TOÀN NHÁNH (C-1 × T5-1) — vị từ của LÁ CHẮN HOÃN chụp nền, TÁCH khỏi
 * `isLoadingLease()`. Tiêu chí đúng là **"giữ byte THẬT trên thiết bị mà đóng góp 0 vào
 * `committedBytes`"** = `actualBytes === null`, **BẤT KỂ `measureFailed`**.
 *
 * ⚠ VÌ SAO PHẢI TÁCH: Task 8 (C-1) gắn `markMeasureFailed()` cho MỌI giấy phép có cửa sổ đo CHỒNG
 * lấn. Cờ đó vì thế không còn chỉ đậu trên reranker 606 MiB vô hại — một model 30B **17 GB** cũng
 * mang nó, `actualBytes` đứng `null` VĨNH VIỄN, mà **byte thật của nó ĐANG NẰM TRÊN THIẾT BỊ**.
 * Với vị từ cũ, lease đó rơi khỏi lá chắn HOÃN **và** đóng góp 0 vào `committedBytes`, nên
 * `nền = raw − committedBytes` NUỐT TRỌN nó rồi `baselineCaptured` bật ⇒ drift **−17 GB**, alarm
 * 100 % mọi nhịp, **chỉ restart mới gỡ** — ĐÚNG chữ ký T5-1 mà Task 7 vừa vá, sống lại qua cửa sau.
 *
 * ⚠ LẬP LUẬN CŨ ("byte của nó đã ỔN ĐỊNH — nó KHÔNG còn đang nạp") ĐÚNG VỀ TRẠNG THÁI nhưng SAI
 * VỀ ĐIỀU LÁ CHẮN CẦN CANH: lá chắn không canh "đang nạp", nó canh "phép trừ `raw − committedBytes`
 * có bỏ sót byte nào không". Ổn định hay đang lên, byte bỏ sót đầu độc nền y như nhau — và ổn định
 * thì còn TỆ HƠN, vì nó không tự biến mất sau vài giây.
 *
 * ⚠ LÝ DO GỐC LOẠI `measureFailed` (sợ khoá nền VĨNH VIỄN) NAY ĐÃ THỪA: chính Task 7 đã dựng
 * `BASELINE_BLOCKED_ALARM_MS` (khai báo ở trên) để biến "im lặng vĩnh viễn" thành "báo động có tên
 * thủ phạm", và mốc hoãn bị XOÁ ở lượt chụp thành công đầu tiên. Đánh đổi đã cân: **chuông kêu
 * đúng chỗ, đọc được, tự lành** — đổi lấy việc KHÔNG BAO GIỜ ghim một con số nền đã nhiễm 17 GB
 * cho suốt vòng đời tiến trình. Số liệu của đánh đổi này ở báo cáo §11.
 */
/*
 * ⚠⚠ Pha 2A Task 4 (T5-15) — DÂN SỐ CỦA VỊ TỪ NÀY ĐÃ ĐỔI, và đó là mục đích của Task 4.
 * `commitFallback()` (vramBroker) điền `actualBytes` bằng một ƯỚC LƯỢNG DỰ PHÒNG cho những khối
 * byte mà điểm gọi CHẮC CHẮN là đang tồn tại (hôm nay: backend CUDA). Những giấy phép đó vì thế
 * rơi KHỎI vị từ này — và phải rơi: byte của chúng nay CÓ mặt trong `committedBytes`, nên phép trừ
 * `raw − committedBytes` không còn nuốt chúng vào nền. Đây là lối thoát DUY NHẤT cho lớp giấy phép
 * KHÔNG có đường `release()` ở nhánh thành công (`gguf-backend`), thứ trước Task 4 khoá nền VĨNH
 * VIỄN và chỉ khởi động lại tiến trình mới gỡ.
 * ⚠ Điều KHÔNG đổi: lease đo hỏng mà KHÔNG khai dự phòng (mọi `gguf-model`/`onnx-session`/…) vẫn ở
 * lại vị từ này và vẫn (đúng) chặn nền — nới cho chúng là nuốt 17 GB vào nền, tức tái sinh T5-1.
 */
function holdsUncommittedBytes(l: VramLease): boolean {
  return l.actualBytes === null;
}
/**
 * Pha 1.5 Task 1, review vòng 1 (EXP-1) — BỘ NGẮT MẠCH cho thước dao động.
 *
 * ⚠ VÌ SAO BẮT BUỘC: cơ chế "đổi thước thì huỷ nền và chụp lại" đúng cho MỘT lần đổi thước, nhưng
 * nếu thước DAO ĐỘNG (vd. handle native chập chờn, hoặc hai tiến trình cạnh tranh gắn handle),
 * MỌI nhịp đều rơi vào nhánh resample — không nhịp nào đối chiếu được. Một khoản cấp phát chui
 * tồn tại xuyên suốt sẽ KHÔNG BAO GIỜ bị phát hiện: chuông CÂM VĨNH VIỄN, và tệ hơn báo động giả
 * — không ai biết nó đang câm. Quá `SOURCE_UNSTABLE_THRESHOLD` lần resample LIÊN TIẾP thì NGỪNG
 * resample và báo động về chính sự BẤT ỔN của thước (nội dung khác hẳn "cấp phát chui" — người
 * trực phải đi sửa đầu dò/handle, không phải đi tìm hộ tiêu thụ chui).
 */
const SOURCE_UNSTABLE_THRESHOLD = Number(process.env.VRAM_SOURCE_UNSTABLE_THRESHOLD ?? 3);

/**
 * ⚠ I-4 (review Task 2) — MỌI TRƯỜNG `readonly`, và đó KHÔNG phải trang trí kiểu.
 * `readLastReconcileTick()` phát ra tham chiếu tới CHÍNH đối tượng này cho đường cưỡng chế; một
 * người tiêu thụ sửa `result.attributableBytes` tại chỗ sẽ đầu độc **mọi** lượt quyết định cho
 * tới nhịp kế. Trước bản này, kỷ luật đó chỉ nằm trong một câu comment — và chính module này đã
 * tự dạy: *"một kỷ luật chỉ tồn tại trong comment thì lần sau lại có comment thứ ba"*
 * (`vramWiring.ts`). Nay `tsc` chặn.
 */
export interface VramReconcileResult {
  readonly driftBytes: number | null;
  readonly alarm: boolean;
  readonly ledgerTotalBytes: number;
  readonly deviceUsedBytes: number | null;
  /** Nền thiết bị đã TRỪ khỏi phép so (null = chưa chụp / máy không GPU). */
  readonly baselineUsedBytes: number | null;
  /**
   * Pha 1.5 Task 1 — true KHI VÀ CHỈ KHI lượt gọi này phát hiện đổi thước đo (native ⇄ smi) và
   * đã HUỶ nền cũ để chụp lại. Lượt đó KHÔNG báo động, dù drift trông thế nào — số vừa bị huỷ
   * không đáng tin để so.
   */
  readonly baselineResampled: boolean;
  /**
   * Pha 1.5 Task 1, review vòng 1 (EXP-1) — true KHI VÀ CHỈ KHI bộ ngắt mạch vừa TRIP: thước đã
   * đổi ≥ `SOURCE_UNSTABLE_THRESHOLD` lần liên tiếp, lượt này KHÔNG resample nữa mà báo động về
   * sự bất ổn của thước. `alarm` cũng = true ở lượt này (đây là báo động THẬT, không phải im
   * lặng) nhưng nguyên nhân KHÁC "cấp phát chui" — đọc `sourceUnstable` để phân biệt.
   */
  readonly sourceUnstable: boolean;
  /**
   * Pha 1.5 Task 3 — tổng ƯỚC LƯỢNG của các giấy phép ĐÃ XIN nhưng CHƯA cấp phát xong
   * (`actualBytes === null`), TRỪ những giấy phép ĐÃ ĐO HỎNG (`measureFailed === true` — xem
   * ghi chú dài ở chỗ tính `pendingBytes` trong `reconcileOnce()` để biết vì sao loại chúng ra
   * là BẮT BUỘC, không phải tuỳ chọn). Đây là phần băng dung sai được nới ở PHÍA ÂM của `alarm`.
   */
  readonly pendingBytes: number;
  /**
   * Pha 1.5 Task 7 (T5-1) — true KHI VÀ CHỈ KHI lượt này KHÔNG đối chiếu được vì nền vẫn CHƯA
   * chụp được, và tình trạng đó đã kéo dài quá `BASELINE_BLOCKED_ALARM_MS`. `alarm` cũng = true
   * ở lượt này (báo động THẬT — phép đối chiếu đang MÙ), nhưng nguyên nhân KHÁC HẲN "cấp phát
   * chui": người trực phải đi xem giấy phép nào đang treo ở trạng thái đang-nạp, không phải đi
   * tìm hộ tiêu thụ lạ. Cùng khuôn với `sourceUnstable`.
   */
  readonly baselineBlocked: boolean;
  /**
   * ★★★ Pha 2B Task 1 — SỐ CHỊU LỰC của mô hình cưỡng chế §5.6c
   * (`headroom = trần − max(ledgerTotalBytes, attributableBytes)`), và là số DUY NHẤT nhìn thấy
   * những khoản cấp phát CHƯA ĐƯỢC LIỆT KÊ (89/157 điểm chưa nối; bản tự khai chỉ là CẬN DƯỚI).
   *
   * `null` ⇔ **KHÔNG TÍNH ĐƯỢC** ⇒ người tiêu thụ rơi về chỉ-sổ và PHẢI ghi rõ **đang chạy mù**
   * (ràng buộc toàn cục 10). Hai lối vào `null`, và **chỉ hai**:
   *   1. chưa có nền (`baselineUsedBytes === null` — chưa chụp được / đầu dò hỏng);
   *   2. lượt RESAMPLE hoặc ngắt mạch (nền vừa bị huỷ, hoặc thước đang dao động ⇒ lượt đó CỐ Ý
   *      không đối chiếu).
   *
   * ⚠⚠ `baselineVerified === false` **KHÔNG** nằm trong danh sách trên — và đó là điểm sửa của
   * review vòng 1 (I-1). Lý do là số học, không phải khẩu vị: vì `max(L, A) ≥ L`, headroom tính
   * từ **bất kỳ** `A` nào cũng **≤** headroom chỉ-sổ. Một nền NHIỄM (nuốt mất X byte của kẻ khác)
   * cho `A` hụt X, tức vẫn **CHẶT HƠN** `null`. Trả `null` ở đó là **tự nới dư địa đúng lúc phát
   * hiện nguy hiểm** — nghiêm khắc bằng 0 thay vì nghiêm khắc hơn.
   * ⇒ Trạng thái "chưa xác minh" đi ra bằng cờ `baselineVerified`, KHÔNG bằng cách xoá con số.
   *
   * ⚠ KHÁC `detail.attributableBytes` của sự kiện `drift` ở CHỖ NÀO: số đó luôn tồn tại (chuông
   * Pha 1 chấp nhận nền = 0 cho người gọi trực tiếp); số ở đây `null` khi không có nền. Đừng "dọn
   * dẹp" hai chỗ đó thành một.
   */
  readonly attributableBytes: number | null;
  /**
   * ★★ Pha 2B Task 1 — nền hiện tại đã được XÁC MINH là không có tàn dư nào của lượt chạy trước
   * đang giữ GPU hay chưa. `false` khi chưa chụp nền, khi KHÔNG quét được danh sách hộ giữ GPU
   * (`readGpuHolders()` trả `null`), hoặc khi quét được và THẤY mồ côi.
   *
   * ⚠ `false` KHÔNG có nghĩa "bẩn" và KHÔNG có nghĩa "vô dụng" — nó có nghĩa **KHÔNG BIẾT nền có
   * nuốt byte của kẻ khác hay không**. `attributableBytes` vẫn dùng được (xem trên); cờ này là
   * ĐẦU VÀO để Task 2/5 chạy **CHẶT HƠN** (đệm an toàn lớn hơn / từ chối lượt xin lớn), TUYỆT ĐỐI
   * không phải cái cớ để nới.
   *
   * ⚠⚠⚠ N2-4 (re-review vòng 2) — **CHƯA CÓ NGƯỜI TIÊU THỤ NÀO NGOÀI `server/services/vram/**`.**
   * Đo được bằng `git grep baselineVerified`: mọi lượt đọc đều nằm trong chính module này và bộ
   * test của nó. Nghĩa là **toàn bộ giá trị của cổng Task 1 hiện ở dạng TIỀM NĂNG**: nó phát hiện
   * đúng, ghi sổ đúng, kêu đúng — nhưng chưa có ai ĐỔI QUYẾT ĐỊNH vì nó.
   * ⇒ **MỤC CHUYỂN TIẾP CỨNG cho Task 2/5:** `computeHeadroom()` phải nhận cờ này và làm hệ chặt
   * hơn (ứng viên: tăng `safetyReserveBytes`, hoặc từ chối lượt xin vượt một tỉ lệ dư địa). Nếu
   * Task 5 đóng lại mà cờ vẫn không ai đọc, thì Task 1 đã chỉ dựng một cái đồng hồ không kim —
   * và điều kiện ra số 1 của Pha 2B ("nền từ chối tuyên bố sạch khi có PID lạ") coi như CHƯA ĐẠT
   * về mặt hiệu lực, dù đạt về mặt phát hiện.
   */
  readonly baselineVerified: boolean;
  /**
   * ★★★ Pha 3 Task 3, QUYẾT ĐỊNH 2 — **VÌ SAO cờ trên TẮT.** Rỗng ⇔ `baselineVerified === true`.
   *
   * ⚠⚠ TỒN TẠI VÌ MỘT LÝ DO CỤ THỂ, KHÔNG PHẢI ĐỂ TRANG TRÍ: trước bản này, cờ tắt kèm **một khoản
   * trừ 1.024 MiB** mà **không ai giải thích được** — người trực thấy dư địa hụt đúng một đơn vị và
   * không có cách nào biết nó tắt vì tàn dư, vì không quét được, hay vì anh em chưa được tính. Một
   * khoản phạt MỒ CÔI là thứ tệ nhất: mất dư địa **và** mất thông tin. Danh sách này là cái giá phải
   * trả để cờ đó thôi mồ côi.
   * ⚠ **Đây KHÔNG phải `VramDegradationReason`** và không được đưa vào từ vựng đó: `applyEnforcement`
   * vẫn chỉ thấy MỘT lý do (`"unverified-baseline"`, 1 đơn vị). Danh sách này là **chẩn đoán**, đi ra
   * ở kết quả + nhật ký; nó KHÔNG đổi một byte nào của phép tính.
   */
  readonly baselineUnverifiedReasons: readonly VramBaselineDistrustReason[];
  /**
   * ★★★ Pha 3 Task 3 (N-WB-1) — **NỀN NÀY ĐÃ TRỪ BYTE CỦA ANH EM CHƯA, VÀ BẰNG CÁCH NÀO.**
   *
   * ⚠⚠ ĐÂY LÀ Ô GHÉP HAI VẾ LẠI VỚI NHAU, và nó tồn tại vì **sửa một vế là tạo ra một lỗi mới cùng
   * độ lớn, ngược dấu** (bàn giao cứng của Task 2):
   *   • `"local"`    — nền chụp theo công thức Pha 2B (`raw − committedLocal`), tức **ĐÃ NUỐT** byte
   *     anh em ⇒ vế SỔ **KHÔNG ĐƯỢC** cộng `foreignBytes` (cộng vào là **TRỪ HAI LẦN**, lệch âm giả
   *     đúng bằng khối anh em đang giữ — đo được ~17 GB).
   *   • `"captured"` — chính tiến trình này chụp, đã trừ `foreignBytes` ⇒ vế SỔ **PHẢI** cộng.
   *   • `"adopted"`  — đọc nền của người chụp (cũng đã trừ) ⇒ vế SỔ **PHẢI** cộng.
   *
   * ⇒ **MỘT biến, MỘT người ghi (`captureVramBaseline`), HAI người đọc** (công thức nền và công thức
   * lệch) — đúng khuôn `MocCaiChet` của Task 1. Không có ô này thì hai vế là hai bản sao của cùng
   * một giả định và chúng sẽ trôi khỏi nhau (ràng buộc 12).
   */
  readonly baselineOrigin: BaselineOrigin;
  /**
   * Byte anh em ĐÃ THẬT SỰ được cộng vào vế SỔ ở lượt này. `0` khi `baselineOrigin === "local"`
   * (cố ý — xem trên); `null` khi nền đã trừ anh em mà sổ chung **không đọc được** ⇒ lượt này
   * KHÔNG so được, `driftBytes` cũng `null`. Ghi ra để đọc kết quả là dựng lại được phép tính.
   */
  readonly foreignLedgerBytes: number | null;
}

/** Xem `VramReconcileResult.baselineOrigin`. */
export type BaselineOrigin = "local" | "captured" | "adopted";

/**
 * ★★★ Pha 3 Task 3, QUYẾT ĐỊNH 2 — VÌ SAO NỀN KHÔNG ĐÁNG TIN. Xem
 * `VramReconcileResult.baselineUnverifiedReasons` và `lyDoNenKhongTin()`.
 */
export type VramBaselineDistrustReason =
  /** Chưa có lượt chụp/nhận nào trong tiến trình này — KHÔNG phải "nền sạch". */
  | "chua-chup-nen"
  /** Không liệt kê được tiến trình đang giữ GPU ⇒ **không biết** có tàn dư hay không. */
  | "khong-quet-duoc-ho-giu-gpu"
  /** Có TÀN DƯ của lượt chạy trước giữ GPU — byte của nó không quy trách nhiệm được cho ai. */
  | "co-tan-du-giu-gpu"
  /**
   * ★★★ VỊ TỪ THAY CHO VẾ `peers` CŨ. Có vai trò ANH EM trên card **mà byte của họ CHƯA được tính**
   * — tức sổ chung không đọc được (`baselineOrigin === "local"`, không ai thắng bầu) **hoặc** sổ
   * chung đọc được nhưng **KHÔNG có một hàng nào của ai khác** (anh em đang giữ card mà im lặng).
   *
   * ⚠⚠ VÌ SAO VẾ `peers` CŨ PHẢI CHẾT: nó hạ cờ **chỉ vì có anh em**, và lý do của nó là *"nền đã
   * NUỐT byte của họ"* — mà **chính Task 3 vừa xoá bỏ tình trạng đó** (nền do MỘT tiến trình chụp,
   * byte anh em nằm ở `attributable`; nghiệm thu sống: nền **1.234.386.944** thay vì
   * **9.444.524.032**, `drift = 0`). Giữ nguyên vế cũ trong topo `api`+`worker` là biến cờ thành
   * **hằng số `false`** kèm **1.024 MiB phạt thường trực** — mất dư địa VÀ mất thông tin, đúng lớp
   * lỗi I-3 mà Task 2 đã phải sửa một lần cho `shared-ledger-unsynced`.
   *
   * ⚠ VÀ VÌ SAO KHÔNG **BỎ HẲN** VẾ ĐÓ: `census.peers` vẫn là câu trả lời DUY NHẤT cho *"có ai khác
   * của hệ đang ở trên card không"*. Cái đổi là **câu hỏi thứ hai** — *"byte của họ đã được tính
   * chưa"* — và câu đó nay **có nguồn** (sổ chung). Hai câu, hai nguồn, không nguồn nào đoán byte
   * (`nvidia-smi` trả `used_memory=[N/A]`, ràng buộc không đổi).
   */
  | "anh-em-tren-card-chua-duoc-tinh"
  /** Nền ĐỌC ĐƯỢC của người khác đã cũ hơn một chu kỳ làm mới bản sao. */
  | "nen-nhan-nuoi-qua-cu"
  /** Người chụp tự khai nền của họ CHƯA xác minh — người đọc KHÔNG được nâng cấp lời khai đó. */
  | "nguoi-chup-khai-chua-xac-minh";

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
 * ⚠ CÔNG THỨC (review vòng 2, NEW-1) — nền KHÔNG phải là "VRAM lúc chụp":
 *
 *     baseline = deviceUsed_lúc_chụp − ledgerTotal_lúc_chụp
 *
 * VÌ SAO KHÔNG DÙNG THẲNG `deviceUsed`: có ÍT NHẤT HAI đường warm model, và đường sớm hơn
 * KHÔNG nằm dưới quyền `startBackgroundSchedulers()`:
 *   `index.ts:4931` → `registerAiLocalKnowledgeRoutes` → `warmUpOllamaModels`
 *   (`aiLocalKnowledgeService.ts:2391`) → `setTimeout(**2000 ms**)` → `warmModel(GGUF_DEFAULT_MODEL)`
 *   = nạp 30B **~17 GB THẬT**, rồi nạp tiếp embedder.
 * Đồng hồ 2 giây đó lên ~273 dòng boot TRƯỚC `startBackgroundSchedulers()` (`:5204`) và NGẮN
 * HƠN đồng hồ 3 giây của `initDeepModelWarmup()`. Ở giữa còn `initializeLicenseSystem()`,
 * `initializeRuntimeSecurity()` (băm file), `initializeSocket()`, `startStreamProcessor()`,
 * `await import("../api/v1/router")`. Boot chậm hơn 2 giây ⇒ 17 GB bị nuốt vào nền; nuốt MỘT
 * PHẦN thì tệ hơn nữa — nền BẤT ĐỊNH giữa các lần boot. `warmUpOllamaModels` cũng KHÔNG có
 * cổng `GGUF_WARM_DEEP_MODEL_ON_BOOT` (chỉ gác `USE_LEGACY_OLLAMA`, mặc định false ⇒ warm CHẠY).
 *
 * ⚠ ĐỪNG SỬA BẰNG CÁCH ĐUA VỚI ĐỒNG HỒ. Chuyển lời gọi lên sớm hơn chỉ đổi cuộc đua này lấy
 * cuộc đua khác, và đường warm THỨ BA sau này lại làm hỏng. Task 5 đã nối `loadGgufModel` vào
 * `reserve()`, nên MỌI thứ do CHÍNH TA cấp phát đều đã nằm trong SỔ tại thời điểm chụp — trừ
 * phần đó ra là xong, ĐÚNG với mọi thứ tự boot.
 *
 * ⚠⚠ CHỈ TRỪ PHẦN **ĐÃ COMMIT** (review vòng 3) — trừ CẢ SỔ là SAI và từng làm nền bị ĐẦU ĐỘC
 * VĨNH VIỄN. Cửa sổ "đã xin, chưa cấp phát xong" CÓ THẬT: `beginVram()` gọi `reserve()` ở
 * `aiGgufEngine.ts:737` (cộng ƯỚC LƯỢNG vào sổ) TRƯỚC `llama.loadModel()` ở `:747`, còn
 * `commitMeasured()` mãi `:802` — với model 30B ~17 GB khoảng đó dài NHIỀU GIÂY (cùng khuôn ở
 * `:927`/`:938` cho context lười). Lượt chụp rơi vào đó thì:
 *     nền = max(0, 941 − 17.000) = 0   ← kẹp, rồi GHIM VĨNH VIỄN
 *     vài giây sau: 17.941 − 0 = 17.941 ⇒ drift = 941 ⇒ BÁO ĐỘNG mỗi 60 giây, MÃI MÃI.
 * Tức là lỗi I-1 sống lại qua cửa sau, chỉ khác là hỏng theo XÁC SUẤT thời điểm boot.
 *
 * Giấy phép ĐÃ commit thì CHẮC CHẮN đã nằm trong `deviceUsed` — chính `commit()` đo từ thiết
 * bị mà ra.
 *
 * ⚠⚠⚠ RÚT LẠI (Pha 1.5 Task 7 / T5-1) — HAI CÂU CỦA VÒNG 3 ĐÃ BỊ SỐ LIỆU BÁC BỎ. Nguyên văn
 * hai câu đó là: *"giấy phép CHƯA commit nghĩa là 'đã xin nhưng chưa cấp phát xong' ⇒ nó CHƯA
 * nằm trong `deviceUsed` ⇒ trừ nó đi là trừ một thứ CHƯA TỒN TẠI"* và *"chỉ trừ phần đã commit
 * thì cửa sổ đua biến mất về mặt CẤU TRÚC, không phải nhờ may"*. **CẢ HAI ĐỀU SAI.**
 *
 * Task 5 đo `nvidia-smi = 18.115 MiB` **khi giấy phép 30B vẫn `pending`** (báo cáo §5.2):
 * `llama.loadModel()` đẩy trọng số lên GPU **DẦN DẦN**, nên *"chưa commit"* chỉ nói **SỔ CHƯA
 * THEO KỊP**, KHÔNG nói thiết bị còn trống. Và cửa sổ đua **không biến mất — nó ĐỔI DẤU**:
 *   • `raw − ledgerTotal` (vòng 2): chụp trúng cửa sổ ⇒ nền bị **kẹp về 0**, lệch **+941 MiB**.
 *   • `raw − Σ actualBytes` (vòng 3): chụp trúng cửa sổ ⇒ nền **nuốt trọn model**, lệch
 *     **−16.700 MiB**, báo động **100 % mọi nhịp**, và `baselineCaptured = true` khiến nó
 *     **KHÔNG BAO GIỜ tự lành** (đo được: `vram_events.id=83`, nền 978 → **17.891 MiB**).
 * Hướng hỏng mới **TỆ HƠN** hướng cũ đúng 17 lần về độ lớn và vô hạn về thời gian.
 *
 * ⚠⚠ VÌ SAO KHÔNG CÓ CÔNG THỨC NÀO ĐÚNG TRONG CỬA SỔ ĐÓ: byte thật của một lease đang nạp nằm
 * ĐÂU ĐÓ giữa `0` và `estimatedBytes`, và **một lượt đọc thiết bị không nói được nó ở đâu**.
 * Trừ 0 thì thừa nền; trừ cả ước lượng thì thiếu nền. ⇒ Lời giải KHÔNG PHẢI một công thức thứ
 * ba mà là **TỪ CHỐI KẾT LUẬN**: còn giấy phép đang nạp thì **HOÃN**, trả `null`, thử lại ở
 * nhịp sau — ĐÚNG khuôn của lá chắn `if (raw < committedBytes)` ngay bên dưới và của ca đầu dò
 * `null` (NEW-2). Vì lá chắn nằm **BÊN TRONG hàm này**, nó phủ **CẢ HAI đường gọi** theo CẤU
 * TRÚC: lượt chụp ĐẦU ở `startVramReconciler()` (đường a) và nhánh RESAMPLE ở `reconcileOnce()`
 * (đường b). Vá riêng một đường là để nguyên đường kia với **cùng hậu quả, cùng độ lớn**.
 *
 * ⚠⚠ "NẾU LUÔN CÓ LEASE PENDING THÌ NỀN KHÔNG BAO GIỜ CHỤP ĐƯỢC?" — câu hỏi đúng, và câu trả
 * lời phải ĐO, không suy đoán. Đọc toàn bộ **14** điểm `beginVramAllocation()` trong repo.
 *
 * ⚠ CON SỐ NÀY ĐÃ SAI HAI LẦN LIÊN TIẾP, và bảng này **chống lưng cho ngưỡng 5 phút của Task 7**
 * nên nó sai ngay ở chỗ chịu lực. Lần một: ghi "12", thiếu `aiLlmFinetuneSidecar` — đúng hộ có
 * TRẦN LỚN NHẤT (4 giờ). Lần hai: sửa thành "13" nhưng **quên đếm điểm mà CHÍNH lượt vá đó thêm**
 * (`cuda-backend:reranker`, I-1) — trong khi các dòng bảng bên dưới đã cộng ra 14.
 * ⇒ **Người sau sửa bảng: ĐẾM LẠI BẰNG `git grep beginVramAllocation`, đừng cộng dồn con số cũ.**
 * `aiGgufEngine` ×4 · `aiReranker` ×2 · `kbSyncScheduler` ×2 · `ocrService`/`aiImageEmbedding`/
 * `aiInferenceEngine`/`llamaVisionSidecar`/`localSidecarTrainer`/`aiLlmFinetuneSidecar` ×1 = **14**.
 *
 * | Lớp giấy phép | `commitMeasured()`? | Trần cửa sổ pending |
 * |---|---|---|
 * | `gguf-backend/-model/-context/-embed-context` (`aiGgufEngine` ×4) | CÓ | 11-43 s (nạp 30B) |
 * | `gguf-backend` `cuda-backend:reranker` (`aiReranker`, I-1) | CÓ | vài giây |
 * | `gguf-model` `reranker:*` (`aiReranker`) | CÓ | vài giây |
 * | `onnx-session` (`aiInferenceEngine`/`aiImageEmbedding`/`ocrService` ×3) | CÓ | vài giây |
 * | `external-process` `sidecar:vision` (`llamaVisionSidecar`) | **CÓ** (sau healthcheck) | ≤ `READY_TIMEOUT_MS` = 120 s |
 * | `external-process` `cron:kb-eval-gate` (`kbSyncScheduler`) | **KHÔNG, CỐ Ý** | ≤ `evalTimeoutMs()` = 10 phút |
 * | `external-process` `cron:kb-sync` (`kbSyncScheduler`) | **KHÔNG, CỐ Ý** | ≤ `TIMEOUT_MS` = 30 phút |
 * | `external-process` `sidecar:local-trainer` (`localSidecarTrainer`) | **KHÔNG, CỐ Ý** | ≤ `sidecarTimeoutMs()` = 2 GIỜ |
 * | `external-process` `sidecar:llm-finetune` (`aiLlmFinetuneSidecar`) | **KHÔNG, CỐ Ý** | ≤ `finetuneTimeoutMs()` = **4 GIỜ** |
 *
 * ⇒ **KHÔNG có lớp nào pending VĨNH VIỄN theo thiết kế.** BỐN hộ "cố ý không commit" vẫn `release()`
 * ở nhánh `"exit"`/`"error"` của tiến trình con, và khi chúng nhả thì byte của chúng cũng đã rời
 * thiết bị ⇒ lượt chụp SAU đó là lượt chụp ĐÚNG. Hoãn ở đây **không vô ích, nó chỉ chờ đúng lúc**.
 * ⇒ **KHÔNG thu hẹp theo `kind`**: `external-process` chứa CẢ hộ commit (`sidecar:vision`, 7,8 GB
 * — hộ lớn nhất hệ) LẪN bốn hộ không commit, nên lọc theo `kind` sẽ để lọt đúng hộ lớn nhất.
 * ⇒ **KHÔNG thu hẹp theo `measureFailed`** (review TOÀN NHÁNH đã BÁC bản trước — xem
 * `holdsUncommittedBytes()`): sau Task 8 thì `measureFailed` đậu lên cả model 17 GB đang giữ byte
 * thật, nên thu hẹp theo nó là mở lại đúng cửa T5-1. **KHÔNG THU HẸP GÌ CẢ**: `actualBytes === null`.
 * ⇒ Ca "pending tới lúc restart" CÒN LẠI hai: **tiến trình chết hẳn giữa `reserve()` và
 * `commitMeasured()`** (kill -9 — đường 3 trong docstring `pendingBytes` bên dưới) và **lease
 * `measureFailed` sống tới lúc unload/evict**.
 * ⚠ Pha 2A Task 4 (T5-15) đã CẮT ca thứ hai ở đúng chỗ nó KHÔNG có unload: `gguf-backend` không có
 * đường `release()` ở nhánh thành công, nên "tới lúc unload/evict" ở đó nghĩa là "tới lúc khởi
 * động lại tiến trình". Nay điểm gọi khai `fallbackBytes` và `commitFallback()` chốt sổ bằng ước
 * lượng dự phòng ⇒ lease đó rời khỏi `holdsUncommittedBytes()` ngay trong chính lượt
 * `commitMeasured()` đang chạy. Các lease đo-hỏng KHÁC (không khai dự phòng) vẫn giữ nguyên hành
 * vi cũ — và vẫn phải giữ, xem docstring `holdsUncommittedBytes()`.
 * Cả hai ca còn lại KHÔNG được im lặng:
 * `BASELINE_BLOCKED_ALARM_MS` biến chúng thành BÁO ĐỘNG có tên thủ phạm, và đó là ĐÁNH ĐỔI ĐÃ
 * CHỌN — chuông kêu đọc được và tự lành, thay cho một con số nền nhiễm 17 GB ghim vĩnh viễn.
 *
 * ⚠ Lượt HOÃN vẫn GHI SỔ (`event: "baseline_deferred"`). Bắt buộc, vì ở nhánh resample nền CŨ
 * đã bị huỷ TRƯỚC lời gọi này — không ghi thì lưới pháp y EXP-2 (nền cũ + `driftIfNotResampled`)
 * biến mất đúng trong kịch bản phổ biến nhất, và đường (a) vốn đã không có dòng nào để truy ngược.
 *
 * ⚠ GIỚI HẠN ĐÃ BIẾT, CHẤP NHẬN Ở PHA 1 — PHẢI ĐỌC TRƯỚC KHI TIN CON SỐ NÀY:
 * nếu server khởi động lại **trong khi một tiến trình con vẫn đang sống** (điển hình: sidecar
 * thị giác 7,8 GB của Đợt 0), thì 7,8 GB đó bị **NUỐT VÀO NỀN** và ta sẽ **KHÔNG BAO GIỜ THẤY
 * NÓ** — đúng cái mà module này sinh ra để bắt. Sidecar chạy tiến trình RIÊNG nên nó KHÔNG có
 * trong sổ, phép trừ trên không cứu được ca này. Đây là ca "giấy phép mồ côi" mà spec §6 giao
 * cho **Pha 3 (nhận nuôi)**: Pha 3 phải liệt kê tiến trình đang giữ VRAM rồi NHẬN NUÔI chúng
 * vào sổ thay vì gộp mù vào nền. Pha 1 chấp nhận đánh đổi này một cách TƯỜNG MINH — thà bỏ sót
 * một ca hiếm còn hơn hỏng cái chuông trong mọi ca thường.
 *
 * Sự kiện `baseline` ghi CẢ `deviceUsedRawBytes` LẪN `ledgerTotalBytes`: đọc nhật ký là dựng
 * lại được phép tính. KHÔNG trừ âm thầm — một phép trừ vô hình chỉ là một giả định vô hình khác.
 */
let baselineUsedBytes: number | null = null;
let baselineCaptured = false;
/**
 * Pha 1.5 Task 1 — MỘT THƯỚC DUY NHẤT. Thước (native ⇄ smi) đã dùng để chụp nền hiện tại.
 *
 * ⚠ VÌ SAO BẮT BUỘC: `startVramReconciler()` chụp nền TRƯỚC khi `getLlama()` gắn handle
 * (`aiGgufEngine.ts:359-360`) ⇒ lượt chụp đầu tiên gần như chắc chắn đo bằng `nvidia-smi`, còn
 * mọi phép so SAU ĐÓ (một khi handle đã gắn) dùng `getVramState` NATIVE. Hai thước lệch
 * 165-178 MiB — đủ MỘT MÌNH đẩy lệch qua ngưỡng 512 MiB và làm chuông kêu MÃI MÃI, dù không ai
 * cấp phát chui cả. Đây là LỖI ĐO (so hai thước với nhau), không phải lỗi hệ.
 *
 * SỬA BẰNG CẤU TRÚC, KHÔNG ĐUA THỨ TỰ BOOT: ghi nhớ thước đã dùng để chụp nền; `reconcileOnce()`
 * thấy số đến từ THƯỚC KHÁC thì HUỶ nền cũ và chụp lại — KHÔNG báo động lượt đó. Đường warm thứ
 * ba xuất hiện sau này (đổi thước một lần nữa) vẫn vô hại vì cùng cơ chế này áp dụng lại.
 */
let baselineSource: "native" | "smi" | null = null;
/**
 * Pha 1.5 Task 1, review vòng 1 (EXP-1) — số lượt resample LIÊN TIẾP (chưa xen kẽ một nhịp đối
 * chiếu BÌNH THƯỜNG nào). Đạt `SOURCE_UNSTABLE_THRESHOLD` thì bộ ngắt mạch TRIP ở lượt kế —
 * lượt trip đó KHÔNG resample nên KHÔNG cộng thêm vào bộ đếm này (nó ở nhánh riêng). Bộ đếm chỉ
 * reset về 0 khi có một nhịp đối chiếu BÌNH THƯỜNG (không mismatch) — dao động một đợt rồi ổn
 * định lại không bị coi là "hỏng vĩnh viễn", nhưng một lượt trip đơn lẻ cũng không tự "chữa" nó.
 */
let consecutiveResampleCount = 0;
/**
 * Pha 1.5 Task 1, review vòng 2 (MỚI-1) — thước đọc được ở lượt `reconcileOnce()` TRƯỚC (không
 * phải thước đóng băng của nền!) và số nhịp LIÊN TIẾP đọc CÙNG một giá trị.
 *
 * ⚠ VÌ SAO BẮT BUỘC: bộ ngắt mạch (EXP-1) đóng lại theo `device.source === baselineSource` —
 * so với thước ĐÓNG BĂNG lúc trip. Nếu thước ổn định lại ở một giá trị KHÁC thước đóng băng
 * (vd. hai tiến trình cạnh tranh gắn handle, chốt ở nhánh nào cũng 50/50), điều kiện đó KHÔNG
 * BAO GIỜ đúng nữa ⇒ ngắt mạch KẸT VĨNH VIỄN: mù drift + báo động treo mãi, tệ hơn cả chuông câm
 * mà nó thay thế (review vòng 2, MỚI-1). Ổn định phải được đo bằng CHÍNH NÓ — nhịp này có giống
 * nhịp trước không — không phải so với một giá trị đóng băng từ quá khứ.
 */
let lastObservedSource: "native" | "smi" | null = null;
let sameSourceStreak = 0;
/**
 * Bật khi `startVramReconciler()` đã chạy. Lúc đó "chưa biết nền" phải nghĩa là IM LẶNG, KHÔNG
 * phải nền = 0 (NEW-2). Khi cờ này TẮT — tức có người gọi `reconcileOnce()` trực tiếp (Task 7,
 * test, công cụ chẩn đoán) — ta giữ nguyên ngữ nghĩa "không trừ gì", vì người gọi đó tự biết họ
 * đang so số thô.
 */
let baselineRequired = false;
/**
 * ★★ Pha 2B Task 2 (I-1) — CÓ ĐƯỢC TUYÊN BỐ BÁO ĐỘNG KHÔNG. Xem docstring `startVramReconciler()`
 * để biết vì sao cờ này phải TÁCH khỏi việc chạy nhịp.
 *
 * ⚠ Mặc định **true** ⇒ mọi đường gọi cũ (kể cả `reconcileOnce()` trực tiếp trong test và công cụ
 * chẩn đoán) giữ nguyên hành vi. Chỉ `startVramReconciler({ ring: false })` mới tắt.
 * ⚠ Nó KHÔNG che giấu gì: `alarm`, `driftBytes`, `sourceUnstable`, `baselineBlocked` vẫn nằm
 * nguyên trong `VramReconcileResult` và vẫn vào ô tick. Tắt là tắt **CÂU NÓI**, không phải phép đo.
 *
 * ⚠⚠ N-4 (re-review) — ĐÂY LÀ MỘT VỊ TỪ DÙNG CHUNG Ở MỨC **TIẾN TRÌNH**, không phải một tuỳ chọn
 * của riêng bộ đếm giờ. Một khi `startVramReconciler({ ring: false })` đã chạy, **MỌI** lượt gọi
 * `reconcileOnce()` trong tiến trình đó đều câm — kể cả lượt gọi TRỰC TIẾP của một công cụ chẩn
 * đoán hay của người trực đang đi tìm sự cố, và họ **không có cách nào biết** mình đang xem một
 * hàm bị bịt miệng ngoài việc đọc dòng log lúc boot. Đánh đổi chấp nhận ở Pha 2B (một cờ mức tiến
 * trình đúng với đúng một quyết định vận hành: vai trò này có được TUYÊN BỐ hay không), nhưng nếu
 * sau này có người cần chẩn đoán ồn trong một tiến trình câm, lối đúng là **tham số cho từng lượt
 * gọi** (`reconcileOnce({ ring: true })`), KHÔNG phải lật cờ toàn cục rồi quên lật lại.
 */
let ringEnabled = true;
/**
 * Pha 1.5 Task 7 (T5-1) — mốc thời gian lượt HOÃN chụp nền ĐẦU TIÊN của đợt hoãn hiện tại
 * (`null` = không đang hoãn). Đặt khi `captureVramBaseline()` từ chối vì còn giấy phép đang nạp,
 * XOÁ ngay khi chụp được. `reconcileOnce()` đọc nó để biết đã mù bao lâu.
 *
 * ⚠ ĐO BẰNG ĐỒNG HỒ TƯỜNG chứ KHÔNG đếm số nhịp: `VRAM_RECONCILE_INTERVAL_MS` chỉnh được (Pha 1
 * §4.1 từng đề xuất hạ xuống 10 s), nên "N nhịp" là một khoảng thời gian TRÔI theo cấu hình —
 * hạ nhịp sẽ khiến ngưỡng trip tụt xuống dưới cửa sổ nạp 43 s và sinh báo động giả cho MỌI lượt
 * nạp model. Ngưỡng phải neo vào thứ nó đang so sánh (thời lượng nạp thật), không vào nhịp đo.
 */
let baselineBlockedSinceMs: number | null = null;
/**
 * Pha 1.5 Task 7 (T5-1), nghiệm thu LIVE — VÌ SAO nền chưa chụp được, để câu báo động nói đúng
 * chỗ cần sửa.
 *
 * ⚠ PHÁT HIỆN CỦA LƯỢT NGHIỆM THU LIVE, KHÔNG PHẢI SUY ĐOÁN: sau khi lá chắn HOÃN chặn lượt
 * chụp đầu, mọi lượt chụp SAU bị lá chắn CŨ `raw < committedBytes` chặn tiếp —
 * `thiết bị 8445 MiB < tổng đã commit 9797 MiB`, LẶP LẠI ở MỌI nhịp suốt cả lượt chạy. Đó là lỗi
 * CÓ TRƯỚC (sổ commit cộng dồn NHIỀU HƠN thứ đang thật sự nằm trên thiết bị), nhưng trước Task 7
 * nó bị CHE: lượt chụp đầu luôn "thành công" (với một con số đã nhiễm) nên `baselineCaptured`
 * bật và lá chắn kia không bao giờ chạy. Task 7 gỡ tấm che đó ra ⇒ nếu KHÔNG tính nhánh này vào
 * đồng hồ chặn thì đổi "nền nhiễm vĩnh viễn" lấy "IM LẶNG vĩnh viễn" — vẫn là hỏng im lặng, đúng
 * lớp lỗi EXP-1. Cả HAI lối từ chối vì thế cùng lên MỘT đồng hồ.
 */
let baselineBlockedReason:
  | "loading-lease"
  | "device-below-committed"
  /**
   * ★ Pha 3 Task 3 — lối từ chối THỨ BA: `thiết bị < đã commit + byte anh em`. Phải TÁCH khỏi
   * `"device-below-committed"` vì HÀNH ĐỘNG SỬA khác hẳn: ở đây sổ CỤC BỘ có thể hoàn toàn đúng,
   * thứ sai là **con số anh em công bố** (một hàng MA của tiến trình đã chết, hoặc một bản sao cũ
   * bắt kịp muộn). Gộp hai lối vào một câu là bắt người trực đi soi `commitMeasured()` của chính
   * mình cho một khoản do tiến trình khác gây ra.
   */
  | "device-below-shared"
  | null = null;
/**
 * ★★★ Pha 2B Task 1 — NỀN NÀY ĐÃ ĐƯỢC XÁC MINH CHƯA (xem `VramReconcileResult.baselineVerified`).
 *
 * ⚠ VÌ SAO PHẢI LÀ MỘT Ô RIÊNG, KHÔNG GỘP VÀO `baselineCaptured`: hai câu hỏi khác nhau và có
 * hai người tiêu thụ khác nhau. `baselineCaptured` trả lời *"có số để TRỪ chưa?"* — cái chuông
 * Pha 1 cần đúng thứ đó và tha thứ được cho sai số. `baselineVerified` trả lời *"số đó có đáng
 * để QUYẾT ĐỊNH CẤP PHÁT không?"* — cưỡng chế Pha 2B cần đúng thứ này và KHÔNG tha thứ được:
 * một nền nuốt mất 7,8 GB sidecar mồ côi làm dư địa phóng đại đúng 7,8 GB.
 * Gộp hai ô lại là ép một trong hai người tiêu thụ nhận câu trả lời của người kia.
 */
/**
 * ★★★ Pha 3 Task 3, QUYẾT ĐỊNH 2 — **MỘT BIẾN, MỘT NGƯỜI GHI, HAI KIỂU ĐỌC** (khuôn `MocCaiChet`
 * của Task 1). Trước bản này có **một cờ boolean**; nay là **danh sách lý do**, và cờ được DẪN
 * XUẤT (`nenDaXacMinh()`). Giữ hai ô song song (một cờ + một danh sách) là đẻ đúng bản sao vị từ mà
 * ràng buộc 12 cấm — chúng sẽ trôi khỏi nhau ở lượt sửa thứ hai.
 * ⚠ Giá trị KHỞI TẠO KHÔNG rỗng: trước lượt chụp đầu tiên thì **chưa có nền nào**, và "chưa có nền"
 * TUYỆT ĐỐI không được đọc thành "nền sạch".
 */
let lyDoNenKhongTinHienTai: readonly VramBaselineDistrustReason[] = Object.freeze(["chua-chup-nen" as const]);

/**
 * ★★★ **VỊ TỪ DÙNG CHUNG** — `computeHeadroom()` đọc nó qua `VramReconcileResult.baselineVerified`
 * rồi đẩy `"unverified-baseline"` vào `degradedReasons`, và `applyEnforcement()` biến lý do đó
 * thành **1.024 MiB**. Bảng đầy đủ SÁU nơi tiêu thụ nằm ở §2.5 báo cáo Task 3; sửa một nơi mà quên
 * nơi kia là đúng lớp lỗi đã tái diễn BA lần ở Pha 1.5 và BA lần nữa ở Pha 2B.
 */
function nenDaXacMinh(): boolean {
  return lyDoNenKhongTinHienTai.length === 0;
}

/**
 * ★★★ NGUỒN của nền hiện tại — kiểu HỢP DISCRIMINATED để `tsc` bắt người sau quên một nhánh.
 * Hai nguồn có **hai bộ bằng chứng khác nhau**, nên ép chúng qua cùng một danh sách tham số
 * optional là mở đúng cửa "một `undefined` viết nhầm không ai bắt".
 */
type NguonNen =
  | {
      readonly loai: "tu-chup";
      readonly census: GpuHolderCensus | null;
      /** `true` ⇔ sổ chung ĐỌC ĐƯỢC ở lượt chụp ⇒ byte anh em ĐÃ bị trừ khỏi nền. */
      readonly cheDoChung: boolean;
      /** Số HÀNG (không phải byte) trong sổ chung KHÔNG thuộc tiến trình này. */
      readonly soHangAnhEm: number;
      /**
       * ★★★ Pha 3 Task 4 — PID trong `census.orphans` mà **byte của nó ĐÃ ĐƯỢC TÍNH** (ta nhận
       * nuôi, hoặc một tiến trình anh em CÒN SỐNG đứng tên trong sổ chung). Ô BẮT BUỘC (không
       * `?`): thêm nó vào hợp discriminated ⇒ `tsc` bắt mọi điểm gọi quên trả lời câu hỏi này,
       * thay vì để một `undefined` âm thầm biến thành "chưa ai đứng tên".
       */
      readonly tanDuDaCoChu: ReadonlySet<number>;
    }
  | {
      readonly loai: "nhan-nuoi";
      readonly tuoiMs: number;
      readonly nguoiChupKhai: boolean;
    };

/**
 * ★★★ BẢN CÀI ĐẶT DUY NHẤT của vị từ *"nền này có đáng để QUYẾT ĐỊNH CẤP PHÁT không"*. Thuần,
 * đồng bộ. Cả HAI người ghi (`captureVramBaseline` và `nhanNenDungChung`) gọi đúng hàm này.
 *
 * ⚠ NHÁNH `"nhan-nuoi"` **KHÔNG quét lại hộ giữ GPU**, và đó là chủ ý: người chụp ĐÃ quét và đã
 * đóng lời khai của mình vào `verified` của hàng nền. Quét lại là trả thêm ~380 ms
 * (`nvidia-smi` + `powershell`) cho một câu trả lời ta đã có — và tệ hơn, là đẻ ra **người đọc thứ
 * hai** của cùng một vị từ, lệch nhau theo thời điểm (đúng bẫy T4 mà Task 1 đã gọi tên).
 * ⚠ Người đọc chỉ được **LÀM YẾU** lời khai của người chụp, không bao giờ nâng cấp.
 */
function lyDoNenKhongTin(nguon: NguonNen): readonly VramBaselineDistrustReason[] {
  const ly: VramBaselineDistrustReason[] = [];
  if (nguon.loai === "nhan-nuoi") {
    if (!nguon.nguoiChupKhai) ly.push("nguoi-chup-khai-chua-xac-minh");
    // Tuổi âm/không hữu hạn ⇒ KHÔNG đọc được ⇒ chiều CHẶT (cùng kỷ luật `bienTheoTuoi`).
    if (!Number.isFinite(nguon.tuoiMs) || nguon.tuoiMs < 0 || nguon.tuoiMs > sharedBaselineStaleMs()) {
      ly.push("nen-nhan-nuoi-qua-cu");
    }
    return Object.freeze(ly);
  }
  if (nguon.census === null) {
    // Không quét được ⇒ KHÔNG BIẾT có tàn dư/anh em hay không. Hai vế dưới không hỏi được nữa.
    ly.push("khong-quet-duoc-ho-giu-gpu");
    return Object.freeze(ly);
  }
  /**
   * ★★★ Pha 3 Task 4 — **VẾ NÀY NAY HỎI CÂU THỨ HAI**, đúng khuôn Quyết định 2 đã làm cho `peers`.
   *
   * ⚠⚠ VÌ SAO VẾ CŨ (`orphans.length > 0` trần trụi) PHẢI ĐỔI: Quyết định 2 gỡ được hằng số
   * `baselineVerified` cho topo `api`+`worker` **KHÔNG sidecar**, nhưng topo **CÓ sidecar** thì cờ
   * **vẫn `false` thường trực** — vì `llama-server` của một tiến trình anh em (hoặc của chính lượt
   * chạy trước) nằm ở `orphans`, và `orphans` hạ cờ VÔ ĐIỀU KIỆN. Một cờ luôn tắt là một cờ không
   * còn thông tin, kèm **1.024 MiB phạt thường trực** — đúng lớp lỗi I-3 mà Task 2 đã phải sửa một
   * lần cho `shared-ledger-unsynced`.
   *
   * ⚠ CÂU HỎI THỨ HAI CÓ NGUỒN, KHÔNG PHẢI ĐOÁN: một hộ mồ côi **ĐÃ CÓ CHỦ** khi (a) chính tiến
   * trình này vừa NHẬN NUÔI nó (giấy phép có thật trong sổ cục bộ, `actualBytes` đã chốt), hoặc
   * (b) một tiến trình anh em **CÒN SỐNG** đứng tên nó trong sổ chung (`ownerNhanNuoi()`). Cả hai
   * đều nghĩa là khối byte đó **đã nằm trong một vế SỔ nào đó** ⇒ nền không còn nuốt nó.
   * ⚠ Hộ mồ côi mà **KHÔNG ai đứng tên** (trainer lạc, sidecar không khớp cổng, `ollama.exe`…) vẫn
   * hạ cờ như cũ — dân số đó KHÔNG đổi, và ca `D-5(a)`/`D-7` khoá nó.
   */
  const tanDuVoChu = nguon.census.orphans.filter((h) => !nguon.tanDuDaCoChu.has(h.pid));
  if (tanDuVoChu.length > 0) ly.push("co-tan-du-giu-gpu");
  /**
   * ★★★ ĐÂY LÀ CHỖ VẾ `peers` CŨ ĐƯỢC **THAY**, KHÔNG PHẢI BỎ. Có anh em trên card thì phải hỏi
   * tiếp: *"byte của họ đã được tính chưa?"* — và chỉ khi câu trả lời là KHÔNG thì cờ mới hạ.
   *   • `!cheDoChung`      — không có sổ chung ⇒ không ai thắng bầu ⇒ nền ta chụp ĐÃ NUỐT byte họ;
   *   • `soHangAnhEm === 0` — sổ chung đọc được nhưng KHÔNG một hàng nào của ai khác ⇒ anh em đang
   *     giữ card mà **im lặng** (tiến trình cấp phát VRAM nhưng không bật đối chiếu — ràng buộc M-7
   *     của Task 2). Đếm **HÀNG**, không đếm BYTE: một `gguf-backend` ước lượng **0 byte** vẫn là
   *     một hàng, và nó vẫn là bằng chứng anh em đang công bố.
   * ⚠ KHÔNG có anh em ⇒ KHÔNG hỏi câu này. Nhờ vậy cài đặt MỘT TIẾN TRÌNH (không sổ chung, không
   * anh em) giữ nguyên `verified: true` — bản trước của chính bản vá này đã suýt phạt cả dân số đó.
   */
  if (nguon.census.peers.length > 0 && (!nguon.cheDoChung || nguon.soHangAnhEm === 0)) {
    ly.push("anh-em-tren-card-chua-duoc-tinh");
  }
  return Object.freeze(ly);
}

/** Pha 2B Task 1 — đã cảnh báo "nền chưa xác minh ⇒ chạy mù" chưa (một lần/vòng đời tiến trình). */
let warnedUnverifiedBaseline = false;

/** Xem `VramReconcileResult.baselineOrigin`. Người ghi DUY NHẤT: `captureVramBaseline()`. */
let baselineOrigin: BaselineOrigin = "local";
/** Danh tính người chụp mà ta đã ĐỌC gần nhất — để không in một dòng nhận nền ở MỌI nhịp. */
let lastAdoptedFrom: string | null = null;
/** Đã kêu "không có sổ chung ⇒ nền chụp CỤC BỘ" chưa (một lần mỗi quãng, xoá khi lên được chế độ chung). */
let warnedLocalBaseline = false;
/** Đã kêu "nền đã trừ anh em nhưng sổ chung không đọc được ⇒ KHÔNG so được" chưa. */
let warnedUnpairedDrift = false;

/**
 * ★★★ Pha 3 Task 4 — GIẤY PHÉP DO **TIẾN TRÌNH NÀY** NHẬN NUÔI, khoá theo PID của hộ mồ côi.
 *
 * ⚠⚠ `ctime` PHẢI ĐƯỢC LƯU LẠI, và đó là toàn bộ lý do ô này không phải một `Set<number>`: PID
 * được HĐH **cấp lại**. Không có mốc tạo thì một `notepad.exe` vừa nhận đúng số PID của sidecar đã
 * chết sẽ **kế thừa giấy phép 7,8 GB** — cùng lớp lỗi mà `bootMs` chống ở phía sổ chung, ở phía
 * bên kia của cùng một cây cầu. Ca `D-3` khoá.
 */
const leaseNhanNuoi = new Map<number, { readonly lease: VramLease; readonly ctime: number }>();

/**
 * ★★★ Pha 3 Task 4 — PID trong `orphans` mà byte ĐÃ ĐƯỢC TÍNH. **MỘT biến, MỘT người ghi**
 * (`chayLuotNhanNuoi`), MỘT người đọc (`captureVramBaseline` → `lyDoNenKhongTin`).
 *
 * ⚠ Rỗng = *"lượt quét gần nhất không tìm thấy ai đứng tên"*, và nó **cũng là giá trị lúc chưa
 * quét lần nào** — hai thứ đó cho CÙNG một hành động (hạ cờ), tức chiều CHẶT. Không tách hai
 * trạng thái ở đây là có chủ ý: một `null` thứ ba chỉ đẻ thêm một nhánh không ai đọc khác đi.
 */
let pidTanDuDaCoChu: ReadonlySet<number> = new Set<number>();

/**
 * ★★★ VỊ TỪ DÙNG CHUNG CỦA HAI VẾ. **Đọc kỹ trước khi đụng vào một trong hai công thức.**
 *
 * `true` ⇒ nền hiện tại đã **loại** byte anh em ⇒ vế SỔ phải **cộng** `foreignBytes`.
 * `false` ⇒ nền đã **nuốt** byte anh em ⇒ vế SỔ **không được** cộng.
 * Một bản cài đặt duy nhất, hai người đọc: lượt chụp (quyết định có trừ hay không) và lượt đối
 * chiếu (quyết định có cộng hay không). Viết lại nó inline ở một trong hai chỗ là dựng bản sao thứ
 * hai của cùng một giả định — đúng lớp lỗi đã trả giá SÁU lần ở Pha 1.5/2B.
 */
function nenDaTruAnhEm(): boolean {
  return baselineOrigin !== "local";
}

/**
 * ★★★ DUNG SAI CHO BẢN SAO CŨ. **60 s là con số CÓ NGUỒN, không phải tiện tay**: bản sao đọc sổ
 * chung được làm mới **theo nhịp reconciler** (`__runReconcileTick` → `syncSharedLedger`, mặc định
 * 60 s), nên một hàng nền vừa được chủ nhân làm mới có thể tới tay ta **muộn tới trọn một chu kỳ**.
 * Trong dải đó, "cũ" KHÔNG phải bằng chứng của bất cứ điều gì.
 *
 * ⚠ `?? mặc_định` LÀ MỘT DÂY, VÀ NÓ CÓ LƯỚI (ràng buộc 11): số rác/âm ⇒ về mặc định, KHÔNG thành
 * một dung sai bằng 0 (mọi nền đọc được lập tức thành "cũ" ⇒ cờ xác minh tắt vĩnh viễn) và cũng
 * không thành vô hạn. Ca `B-6` khoá cả hai mép.
 * ⚠ Đọc `.env` MỖI lượt — cùng khuôn `syncTimeoutMs()`.
 */
export function sharedBaselineStaleMs(): number {
  const n = Number(process.env.VRAM_SHARED_BASELINE_STALE_MS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 60_000;
}

/**
 * Quá mốc này thì **CHỦ NHÂN COI NHƯ ĐÃ CHẾT** và hàng nền hết hiệu lực — tiến trình khác được
 * quyền chụp lại. `3 × dung sai` = một chu kỳ tới tay ta + một nhịp lỡ của chủ nhân + một biên.
 * ⚠ Hai mốc PHẢI dẫn xuất từ MỘT nguồn: hai hằng số độc lập sẽ trôi khỏi nhau và sinh ra dải
 * "không ai đọc, cũng không ai chụp" — tức MÙ, tức nhánh RỘNG NHẤT.
 */
export function sharedBaselineTtlMs(): number {
  return sharedBaselineStaleMs() * 3;
}

/**
 * ★★★ CUỘC BẦU — **AI ĐƯỢC CÔNG BỐ NỀN.** Thuần, đồng bộ, tất định: cùng một bản sao ⇒ mọi tiến
 * trình cho **cùng một câu trả lời**, nên không cần khoá phân tán và không có ping-pong.
 *
 * Ứng viên = { chính ta } ∪ { mọi `processKey` đang có giấy phép trong sổ chung } ∪ { chủ nhân hàng
 * nền, nếu hàng còn hiệu lực }. Người thắng = `processKey` **nhỏ nhất theo thứ tự chuỗi**.
 *
 * ⚠ VÌ SAO VẾ THỨ BA BẮT BUỘC: một tiến trình KHÔNG giữ giấy phép nào thì **vô hình** trong sổ
 * chung (không có hàng nào) — trừ khi nó đang là người chụp. Không tính hàng nền vào tập ứng viên
 * thì người chụp không-giấy-phép biến mất khỏi mắt anh em, anh em bầu người khác, và **hai người
 * cùng công bố** — đúng triệu chứng N-WB-1, chỉ đổi cửa vào.
 *
 * ⚠ ĐIỀU NÀY **KHÔNG** QUYẾT ĐỊNH "AI ĐƯỢC CÓ NỀN". Ai không thắng mà **cũng không có nền để đọc**
 * thì VẪN chụp cho riêng mình (xem `captureVramBaseline`) — vì không có nền nghĩa là
 * `attributableBytes === null`, tức `max(L,A) → L`, tức **nhánh RỘNG NHẤT**. Cuộc bầu chỉ quyết
 * định **ai được GHI hàng dùng chung**.
 */
function nguoiChupNen(selfKey: string, nowMs: number): string {
  const banSao = readSharedLedgerReplica();
  if (banSao === null) return selfKey;
  const ungVien = new Set<string>([selfKey]);
  for (const r of banSao.foreignLeases) if (r.processKey) ungVien.add(r.processKey);
  const nen = banSao.baseline;
  if (nen !== null && nowMs - nen.atMs <= sharedBaselineTtlMs()) ungVien.add(nen.processKey);
  return [...ungVien].sort()[0] ?? selfKey;
}

/**
 * Chụp nền. Thành công MỘT LẦN rồi thôi — nếu không, một lượt `stop()`/`start()` lại sẽ nuốt
 * mọi thứ đã nạp vào nền và làm mù luôn sổ.
 *
 * ⚠ NEW-2 — CHỈ ghim khi ĐỌC ĐƯỢC SỐ THẬT. Bản trước đặt `baselineCaptured = true` TRƯỚC
 * `await`, nên một lượt `nvidia-smi` chạm trần `timeout: 3000` lúc boot, hay NVML đang khởi
 * tạo, hay `execFile` lỗi thoáng qua, đều bị ghim VĨNH VIỄN thành `null` — rồi `null` bị coi là
 * 0 và toàn bộ nền bị báo là "cấp phát KHÔNG XIN PHÉP", mỗi 60 giây, mãi mãi, KHÔNG TỰ LÀNH.
 * Nay hỏng thì để nguyên trạng "chưa biết" và THỬ LẠI ở nhịp đối chiếu sau.
 *
 * KHÔNG BAO GIỜ ném: máy không GPU ⇒ trả `null` mãi, hệ chạy tiếp im lặng.
 *
 * @param priorBaseline Pha 1.5 Task 1, review vòng 1 (EXP-2) — CHỈ truyền khi hàm này được gọi
 *   từ nhánh RESAMPLE của `reconcileOnce()` (đổi thước). Đây là nền VỪA BỊ HUỶ (giá trị + thước
 *   cũ), dùng để tính "drift NẾU KHÔNG huỷ" và ghi vào sự kiện `baseline` — xem lý do bắt buộc ở
 *   khối comment "GIỚI HẠN ĐÃ BIẾT" cạnh nhánh resample trong `reconcileOnce()`.
 */
export async function captureVramBaseline(
  priorBaseline?: { usedBytes: number; source: "native" | "smi" } | null,
  censusSanCo?: GpuHolderCensus | null,
): Promise<number | null> {
  /**
   * ★★ Pha 2B Task 1, review vòng 1 (I-1) — LỐI THOÁT KHỎI MỘT NỀN ĐÃ NHIỄM.
   *
   * Nền chốt trong khi có tiến trình mồ côi giữ GPU thì **nhiễm đúng bằng khối byte của nó**, và
   * `baselineCaptured` vốn là cờ MỘT CHIỀU ⇒ không có dòng này thì con số nhiễm ở lại VĨNH VIỄN,
   * kể cả sau khi mồ côi đã chết. Hậu quả đo được: khi nó chết, `attributable = thiết bị − nền`
   * tụt xuống ÂM đúng bằng khối đó ⇒ `drift` âm sâu ⇒ **chuông kêu mỗi 60 giây, mãi mãi** — đúng
   * cái mà Pha 1 dựng nền để tránh.
   *
   * ⇒ Nền CHƯA XÁC MINH thì mỗi nhịp quét LẠI; hết mồ côi thì **huỷ nền nhiễm và chụp lại**.
   * Nền ĐÃ xác minh thì thoát ngay ở dòng đầu như cũ (không tốn lượt quét nào).
   */
  /**
   * ★★★ Pha 3 Task 3 (N-WB-1) — **NGƯỜI ĐỌC NỀN. ĐẶT TRƯỚC MỌI THỨ, KỂ CẢ LỐI THOÁT NHANH I-1.**
   *
   * Triệu chứng gốc: `api` và `worker` **cùng chụp nền trên MỘT thiết bị** ⇒ nền của `api` nuốt
   * trọn 17 GB của anh em. Không vá được bằng số (`nvidia-smi` trả `used_memory=[N/A]`), cũng không
   * vá được bằng cách bỏ nền (`max(L,A) ≥ L` ⇒ `attributable = null` là **CHẶN TRÊN**). Lời giải là
   * **sổ chung**: nền chỉ được chụp bởi MỘT tiến trình, các tiến trình khác ĐỌC nó.
   *
   * ⚠ ĐẶT TRƯỚC lối thoát `baselineCaptured && baselineVerified` vì một tiến trình đã tự chụp
   * (chế độ `"local"`, hợp lệ lúc chưa có sổ chung) phải **nhường** ngay khi người chụp thật xuất
   * hiện — nếu không, hai con số nền cùng sống trên một thiết bị và không con số nào biết con số kia.
   * ⚠ Lượt đọc này ĐỒNG BỘ và MIỄN PHÍ (một ô trong bộ nhớ), nên nó không đánh đổi gì với chi phí
   * `nvidia-smi`/`powershell` mà lối thoát nhanh sinh ra để tiết kiệm.
   */
  const selfKey = sharedLedgerSelfKey();
  const nenChung = readSharedBaseline();
  const bayGio = Date.now();
  if (nenChung !== null && nenChung.processKey !== selfKey) {
    const tuoi = bayGio - nenChung.atMs;
    if (tuoi >= 0 && tuoi <= sharedBaselineTtlMs()) {
      nhanNenDungChung(nenChung, tuoi);
      return baselineUsedBytes;
    }
    // Quá hạn ⇒ chủ nhân coi như đã chết. KHÔNG đọc con số của một tiến trình không còn tồn tại;
    // rơi xuống dưới và tự chụp (cuộc bầu ở cuối hàm quyết ai được ghi lại hàng dùng chung).
  }

  /**
   * ★ LỐI THOÁT NHANH, nay có thêm MỘT lối vào: nền đang ở chế độ `"local"` (đã nuốt byte anh em)
   * mà sổ chung **nay đã đọc được** ⇒ phải chụp LẠI đúng một lần để lên chế độ `"captured"`.
   * ⚠ Sau lượt nâng cấp đó `baselineOrigin !== "local"` ⇒ điều kiện tắt ⇒ **KHÔNG** chụp lại mỗi
   * nhịp. Đó là ràng buộc SỐNG CÒN, không phải tối ưu: chụp lại mỗi nhịp thì mọi khoản cấp phát
   * chui bị hấp thụ vào nền ngay nhịp kế và `drift` **mất hẳn khả năng phát hiện** — đúng lớp
   * "cơ chế phòng vệ mới vô hiệu hoá cơ chế cũ" đã tái diễn ba lần.
   */
  const canNangCapNen = baselineCaptured && baselineOrigin === "local" && readSharedLedgerReplica() !== null;
  if (baselineCaptured && nenDaXacMinh() && !canNangCapNen) return baselineUsedBytes;

  /**
   * ★★ QUÉT TRƯỚC, ĐỌC THIẾT BỊ SAU — THỨ TỰ NÀY LÀ MỘT LƯỚI, KHÔNG PHẢI SỞ THÍCH.
   *
   * ⚠ PHÁT HIỆN CỦA NGHIỆM THU SỐNG (không phải suy đoán): với thứ tự ngược lại (đọc thiết bị →
   * quét), một tàn dư chết ĐÚNG GIỮA hai bước sẽ cho: con số thiết bị **vẫn chứa** byte của nó,
   * còn lượt quét **báo sạch** ⇒ ta ghim một nền NHIỄM và đóng dấu `verified: true` lên nó — một
   * con số sai được TIN, tệ hơn hẳn một con số sai bị gắn cờ.
   * Đảo thứ tự thì cửa sổ đua đổi sang chiều AN TOÀN: quét thấy tàn dư (T₀) rồi nó chết (T₀+ε) ⇒
   * ta đánh dấu `unverified` cho một con số thật ra đã sạch — bi quan, và tự lành ở nhịp sau.
   *
   * ⚠ GIÁ PHẢI TRẢ, nói rõ (m-3 — số ĐO LẠI, số cũ ở đây SAI): lượt quét nay chạy TRƯỚC cả hai lá
   * chắn hoãn, nên những nhịp bị hoãn (đang nạp model / sổ cộng dư) vẫn tốn `nvidia-smi`
   * **56-62 ms** + `powershell.exe` **316-341 ms** ≈ **380-400 ms**, và lượt PowerShell là **LUÔN
   * LUÔN** trên máy có desktop (15 hộ), không phải "đôi khi". Chỉ tới khi nền được XÁC MINH thì
   * dòng `return` ngay trên mới cắt sạch chi phí đó.
   *
   * ⚠ CÒN MỘT NGUỒN CŨ HƠN, ĐÃ KIỂM: `readDeviceVram()` có ĐỆM `VRAM_PROBE_CACHE_MS` (5 s). Trong
   * sản xuất nó KHÔNG chạm được ca này — nhịp đối chiếu cách nhau 60 s và `__runReconcileTick()`
   * gọi hàm này TRƯỚC `reconcileOnce()`, nên lượt đọc ở đây luôn là lượt đọc NGUỘI. Chỉ một người
   * gọi `captureVramBaseline()` hai lần trong 5 giây mới thấy số cũ (đúng cái kịch bản nghiệm thu
   * sống đã dựng). KHÔNG "sửa" bằng `__clearProbeCache()` — đó là xoá đệm DÙNG CHUNG của người
   * khác, đúng lỗi I-3 mà `vramProbe.ts` đã phải tách hàm để diệt.
   */
  /**
   * ★ Pha 3 Task 4 — DÙNG LẠI LƯỢT QUÉT CỦA NHỊP, KHÔNG QUÉT LẦN THỨ HAI.
   *
   * ⚠ `__runReconcileTick()` nay quét MỘT lần rồi đưa kết quả cho cả lượt nhận nuôi lẫn lượt chụp
   * này. Không có tham số đó thì mỗi nhịp trả **hai** lượt `nvidia-smi` + `powershell` (đo được
   * ~380-400 ms mỗi lượt) cho đúng một câu hỏi. `undefined` (mọi lời gọi trực tiếp: test, công cụ
   * chẩn đoán, `startVramReconciler`) giữ nguyên hành vi cũ — tự quét.
   */
  const census = censusSanCo !== undefined ? censusSanCo : await readGpuHoldersSafe();
  /**
   * ★★ N-1 (re-review vòng 1) — GIỮ NỀN CŨ CHO TỚI KHI THẬT SỰ CÓ NỀN MỚI.
   *
   * ⚠ LỖI CỦA CHÍNH BẢN VÁ I-1, DO RE-REVIEW BẮT: bản trước **vứt nền ngay tại đây** (`baselineCaptured
   * = false; baselineUsedBytes = null`) rồi mới đi qua hai lá chắn hoãn. Ba lối `return null` phía
   * sau (đầu dò hỏng · còn giấy phép đang nạp · thiết bị < đã commit) để lại `baselineUsedBytes ===
   * null` ⇒ `attributableBytes` thành `null` ⇒ **rơi thẳng về chỉ-sổ, tức CHẶN TRÊN** — đúng thứ
   * I-1 vừa sửa để tránh, chỉ khác đường vào. Chạm được thật: tàn dư chết đúng lúc đang nạp model,
   * hoặc khi còn một lease `sidecar:local-trainer` (ttl **2 giờ**) ở trạng thái đang-nạp.
   *
   * ⇒ Nay chỉ ghi cờ Ý ĐỊNH; nền cũ **không bị chạm** cho tới dòng gán ở cuối hàm (nơi đã chắc chắn
   * có số mới). Ba lối `return` kia trả về **nền CŨ**, không trả `null`.
   */
  const recapturing = baselineCaptured;
  if (recapturing) {
    /**
     * ★ Pha 3 Task 3 — CỬA THỨ HAI của lượt chụp lại. Cửa CŨ (Pha 2B, I-1) hỏi *"thiết bị đã sạch
     * mã của hệ chưa"*; cửa MỚI hỏi *"nền hiện tại có đang ở chế độ SAI không"*. Hai câu hỏi khác
     * nhau nên hai cửa — gộp lại thì cửa cũ (đòi `peers.length === 0`) sẽ **khoá vĩnh viễn** lượt
     * nâng cấp trong đúng topology `api`+`worker` mà task này sinh ra để phục vụ: ở đó `peers`
     * KHÔNG BAO GIỜ rỗng, nên nền `"local"` sẽ nuốt 17 GB của anh em cho tới lúc khởi động lại.
     * ⚠ Cửa mới chạy ĐÚNG MỘT LẦN cho mỗi vòng đời nền (`baselineOrigin` rời `"local"` sau đó).
     */
    if (!canNangCapNen) {
      // Đã chốt nhưng CHƯA XÁC MINH. Còn mù / còn tàn dư / còn vai trò anh em ⇒ giữ nguyên con số
      // hiện có (vẫn chặt hơn chỉ-sổ — I-1). Sạch hẳn rồi mới chụp lại.
      if (census === null || census.orphans.length > 0 || census.peers.length > 0) return baselineUsedBytes;
      console.log("[vram] mã của hệ đã rời GPU ⇒ chụp LẠI nền chưa xác minh (Pha 2B Task 1, I-1).");
    } else {
      console.log(
        "[vram] SỔ CHUNG đã đọc được ⇒ chụp LẠI nền để TRỪ byte anh em (Pha 3 Task 3, N-WB-1). " +
          "Nền cũ chụp theo công thức Pha 2B nên đã NUỐT byte của tiến trình anh em.",
      );
    }
  }

  let device: { usedBytes: number; source: "native" | "smi" } | null = null;
  try {
    device = await readDeviceVram();
  } catch {
    device = null;
  }
  // Chưa đọc được ⇒ KHÔNG ghim, KHÔNG kết luận. Nhịp sau thử lại.
  // ⚠ N-1: đang chụp LẠI thì trả nền CŨ, KHÔNG trả `null` — `null` là chỉ-sổ, tức chặn trên.
  if (!device) return recapturing ? baselineUsedBytes : null;

  const snap = snapshot();
  const ledgerTotal = snap.totalReservedBytes;
  const raw = device.usedBytes;

  // ⚠ CỐ Ý KHÔNG dùng `leaseBytes()` (Task 4 xuất) ở đây, dù nó trông "gọn hơn".
  // `leaseBytes()` trả `actualBytes ?? estimatedBytes` — nó CỐ TÌNH XOÁ NHOÀ ranh giới giữa
  // "đã đo thật" và "mới ước lượng", đúng thứ mà mọi chỗ KHÁC cần. Ở ĐÂY thì ngược lại: ta
  // phải PHÂN BIỆT hai thứ đó, vì chỉ phần ĐÃ COMMIT mới chắc chắn nằm trong `deviceUsed`.
  // ⚠ Người sau: đừng "dọn dẹp" dòng này thành `leaseBytes()` — làm vậy là tái tạo đúng lỗi
  // đã mô tả ở docstring trên (nền bị đầu độc vĩnh viễn khi chụp trúng cửa sổ chưa-commit).
  //
  // ⚠⚠ Pha 2A Task 4 (T5-15) — TỪ ĐÂY, TỔNG NÀY CÓ THỂ CHỨA MỘT ƯỚC LƯỢNG. `commitFallback()`
  // điền `actualBytes` bằng số dự phòng cho những khối byte mà điểm gọi CHẮC CHẮN đang tồn tại,
  // nên "đã commit" ở đây phải đọc là **"sổ khẳng định khối byte này đang nằm trên thiết bị"**,
  // không phải "đã đo được". Đó là ĐÚNG thứ phép trừ này cần (nó hỏi byte có tồn tại không, không
  // hỏi ai đo), nhưng nó KÉO THEO một ràng buộc: sai số của con số dự phòng đi THẲNG vào nền và
  // ở lại đó suốt vòng đời tiến trình. Vì vậy `fallbackBytes` chỉ được khai cho khối byte có kích
  // thước là HẰNG SỐ ĐO ĐƯỢC LẶP LẠI (backend CUDA: 5/5 tiến trình, hai thước độc lập) — xem
  // `VramAllocationOptions.fallbackBytes`. KHÔNG nới điều kiện đó ở đây bằng cách sửa dòng dưới.
  const committedBytes = snap.leases.reduce((sum, l) => sum + (l.actualBytes ?? 0), 0);

  // ⚠⚠ Pha 1.5 Task 7 (T5-1) — LÁ CHẮN CỬA SỔ ĐANG NẠP. Lý do đầy đủ + bảng ĐO 12 điểm cấp phát
  // nằm ở docstring phía trên; tóm tắt: byte của một lease đang nạp ĐÃ nằm trong `raw` nhưng
  // đóng góp 0 vào `committedBytes`, nên `raw − committedBytes` NUỐT TRỌN model (đo được nền
  // 978 → 17.891 MiB, drift −16.700 MiB, KHÔNG BAO GIỜ tự lành). Không có công thức nào đúng
  // trong cửa sổ đó ⇒ HOÃN. Đặt TRƯỚC lá chắn `raw < committedBytes` vì đây là chẩn đoán CỤ THỂ
  // hơn (biết ĐÍCH DANH ai đang nạp), và vì trong cửa sổ này `committedBytes` thấp giả tạo nên
  // lá chắn kia gần như không bao giờ chạm.
  // ⚠⚠ VÁ SAU REVIEW TOÀN NHÁNH (C-1 × T5-1) — vị từ ở đây là `holdsUncommittedBytes()`, KHÔNG
  // phải `isLoadingLease()`. Lý do đầy đủ ở docstring hàm đó; tóm tắt: lease `measureFailed` cũng
  // giữ byte thật mà đóng góp 0 vào `committedBytes`, và Task 8 vừa đưa cả model 17 GB vào lớp đó.
  const loading = snap.leases.filter(holdsUncommittedBytes);
  if (loading.length > 0) {
    const blockingOwners = loading.map((l) => l.request.owner);
    // ⚠ N-1: đồng hồ này đo "đã BAO LÂU không có nền". Đang chụp lại (nền cũ còn nguyên) thì ta
    // KHÔNG mù, nên không được bấm giờ — bấm là gieo một báo động sai cho tương lai.
    const firstOfStreak = !recapturing && baselineBlockedSinceMs === null;
    if (firstOfStreak) baselineBlockedSinceMs = Date.now();
    if (!recapturing) baselineBlockedReason = "loading-lease";
    console.warn(
      `[vram] HOÃN lượt chụp nền: còn ${loading.length} giấy phép ĐANG NẠP (${blockingOwners.join(", ")}) — ` +
        `byte của chúng đã lên thiết bị nhưng CHƯA vào sổ, chụp lúc này là nuốt trọn chúng vào nền ` +
        `VĨNH VIỄN. Sẽ thử lại ở nhịp sau. Đây là lỗi ĐO (sổ chưa theo kịp), KHÔNG PHẢI hộ tiêu thụ lạ.`,
    );
    // Ghi sổ ở lượt ĐẦU của đợt hoãn (đủ để truy ngược, không làm phình DB mỗi nhịp) và LUÔN
    // ghi khi đây là lượt RESAMPLE — ở đó nền CŨ vừa bị huỷ, nếu không ghi thì dấu vết EXP-2
    // (nền cũ + drift-nếu-không-huỷ) mất hẳn, đúng kịch bản phổ biến nhất của resample.
    if (firstOfStreak || priorBaseline) {
      logVramEvent({
        event: "baseline_deferred",
        owner: "reconciler",
        leaseKind: "external-process",
        priority: "background",
        deviceUsedBytes: raw,
        ledgerTotalBytes: ledgerTotal,
        detail: {
          deviceUsedRawBytes: raw,
          committedBytes,
          ledgerTotalBytes: ledgerTotal,
          blockingOwners,
          // Nền SẼ LÀ bao nhiêu nếu ta cứ chụp bừa — con số này là bằng chứng của chính lỗi
          // T5-1 khi đọc lại nhật ký, không phải một giá trị được dùng vào việc gì.
          baselineIfCapturedAnyway: raw - committedBytes,
          ...(priorBaseline
            ? {
                priorBaselineUsedBytes: priorBaseline.usedBytes,
                priorSource: priorBaseline.source,
                newSource: device.source,
                driftIfNotResampled: raw - priorBaseline.usedBytes - ledgerTotal,
              }
            : {}),
          note:
            "HOÃN chụp nền vì còn giấy phép đang nạp: byte của chúng đã nằm trong deviceUsed " +
            "nhưng chưa vào committedBytes ⇒ mọi công thức đều sai trong cửa sổ này (T5-1). " +
            "Thử lại ở nhịp sau; quá VRAM_BASELINE_BLOCKED_ALARM_MS thì lượt đối chiếu sẽ BÁO ĐỘNG.",
        },
      });
    }
    // ⚠ N-1: đang chụp LẠI thì trả nền CŨ, KHÔNG trả `null` — `null` là chỉ-sổ, tức chặn trên.
    return recapturing ? baselineUsedBytes : null;
  }

  // Trạng thái MÂU THUẪN: thiết bị đang giữ ÍT HƠN tổng ta đã ĐO ĐƯỢC trên chính nó. Không thể
  // xảy ra nếu số liệu đúng ⇒ lượt chụp này VÔ LÝ. Không ghim, không kết luận, thử lại nhịp sau
  // (cùng nguyên tắc với ca đầu dò `null` ở NEW-2): một phép chụp cho ra kết quả vô lý TUYỆT ĐỐI
  // không được phép trở thành hằng số cho suốt vòng đời tiến trình.
  /**
   * ★★★ Pha 3 Task 3 (N-WB-1) — **VẾ NỀN.** Byte của anh em phải bị TRỪ ở đây, nếu không nền nuốt
   * trọn chúng và mọi phép so sau đó quy trách nhiệm cho một hộ hợp lệ.
   *
   * ⚠⚠ **NGUỒN DUY NHẤT của vị từ "byte của anh em" là SỔ CHUNG (`foreignBytes`)**, KHÔNG PHẢI
   * `census.peers` — và đây là một lựa chọn bắt buộc, không phải sở thích (ràng buộc 12: hai bản
   * sao của một vị từ thì không viết ra được). Lý do vật lý: `nvidia-smi` trả `used_memory=[N/A]`
   * trên WDDM ⇒ `census.peers` biết **AI** mà **không bao giờ biết BAO NHIÊU**. Nó giữ nguyên vai
   * trò cũ — một tín hiệu **CÓ MẶT** để hạ `baselineVerified` — và **tuyệt đối không được** dùng
   * để suy ra một con số byte.
   *
   * ⚠ `sharedLedgerFact() === null` ⇒ **KHÔNG CÓ SỔ CHUNG** (chưa lượt đồng bộ nào chạy / không DB).
   * Đó là nhánh `"local"`: ta chụp theo đúng công thức Pha 2B và **KHAI RA**, chứ không giả vờ rằng
   * `foreignBytes = 0` là một phép đo. Xem `baselineOrigin`.
   */
  const soChungLucChup = sharedLedgerFact(Date.now());
  const byteAnhEm = soChungLucChup === null ? 0 : Math.max(0, soChungLucChup.foreignBytes);
  const cheDoChung = soChungLucChup !== null;

  /**
   * ★ Task 3 — LÁ CHẮN THỨ BA. Cùng khuôn `raw < committedBytes` ngay dưới, nhưng nguyên nhân KHÁC
   * (xem `baselineBlockedReason`): sổ chung khai NHIỀU HƠN thứ đang nằm trên thiết bị — điển hình
   * một **hàng MA** của tiến trình bị `kill -9` (nợ đã bàn giao cho Task 4). Chụp bừa ở đây cho ra
   * **nền ÂM**, và một nền âm làm `attributable` phồng lên đúng bằng khoản ma đó ⇒ báo động "cấp
   * phát chui" mỗi nhịp cho một khối byte KHÔNG TỒN TẠI.
   */
  if (cheDoChung && raw >= committedBytes && raw < committedBytes + byteAnhEm) {
    console.warn(
      `[vram] BỎ QUA lượt chụp nền: thiết bị ${Math.round(raw / 1024 / 1024)} MiB < đã commit ` +
        `${Math.round(committedBytes / 1024 / 1024)} + sổ chung khai ${Math.round(byteAnhEm / 1024 / 1024)} MiB. ` +
        `Sổ CHUNG đang khai nhiều hơn thực tế (hàng MA của một tiến trình đã chết?), KHÔNG phải sổ cục bộ ` +
        `của tiến trình này. Sẽ thử lại ở nhịp sau.`,
    );
    if (!recapturing && baselineBlockedSinceMs === null) baselineBlockedSinceMs = Date.now();
    if (!recapturing) baselineBlockedReason = "device-below-shared";
    return recapturing ? baselineUsedBytes : null;
  }

  if (raw < committedBytes) {
    console.warn(
      `[vram] BỎ QUA lượt chụp nền: thiết bị ${Math.round(raw / 1024 / 1024)} MiB < tổng đã commit ` +
        `${Math.round(committedBytes / 1024 / 1024)} MiB — số liệu mâu thuẫn, sẽ thử lại ở nhịp sau.`,
    );
    // Pha 1.5 Task 7 — LÊN CÙNG MỘT ĐỒNG HỒ với lối từ chối vì lease đang nạp (lý do đầy đủ ở
    // khai báo `baselineBlockedReason`). Nghiệm thu LIVE bắt được nhánh này lặp ở MỌI nhịp suốt
    // cả lượt chạy; nếu nó không kêu thì reconciler mù VĨNH VIỄN mà không ai biết.
    if (!recapturing && baselineBlockedSinceMs === null) baselineBlockedSinceMs = Date.now();
    if (!recapturing) baselineBlockedReason = "device-below-committed";
    // ⚠ N-1: cùng lý do — nền cũ vẫn chặt hơn chỉ-sổ.
    return recapturing ? baselineUsedBytes : null;
  }

  /**
   * ★★★ Pha 2B Task 1 — CỔNG: nền KHÔNG được TUYÊN BỐ SẠCH khi còn tàn dư của lượt chạy trước.
   *
   * Đây là bản vá cho khối "GIỚI HẠN ĐÃ BIẾT" ở docstring phía trên (nguyên văn: *"nếu server khởi
   * động lại trong khi một tiến trình con vẫn đang sống — điển hình sidecar thị giác 7,8 GB — thì
   * 7,8 GB đó bị NUỐT VÀO NỀN và ta sẽ KHÔNG BAO GIỜ THẤY NÓ"*).
   *
   * ⚠⚠ HÀNH ĐỘNG CỦA CỔNG ĐÃ ĐỔI Ở REVIEW VÒNG 1 (I-1) — ĐỌC TRƯỚC KHI "SỬA LẠI CHO NGHIÊM".
   * Bản đầu **TỪ CHỐI chốt nền** khi thấy mồ côi. Sai, và sai theo đúng hướng nó định chống:
   *   `headroom = trần − max(ledgerTotal, attributable)`, mà `max(L, A) ≥ L` ⇒ **mọi** headroom
   *   tính từ một `attributable` bất kỳ đều **≤** headroom chỉ-sổ. Nói cách khác:
   *     • từ chối  ⇒ `attributable = null` ⇒ `trần − L` — **CHẶN TRÊN**, lỏng nhất có thể;
   *     • chốt nền NHIỄM X ⇒ `A` hụt X ⇒ `trần − max(L, A)` — **luôn ≤** con số trên.
   *   ⇒ Một nền nhiễm vẫn **CHẶT HƠN** chỉ-sổ. Vứt nó đi là tự nới dư địa đúng lúc phát hiện nguy
   *   hiểm. Vậy nên cổng giữ **TẦM NHÌN** (nêu đích danh, ghi sổ, đánh dấu `unverified`) và **giữ
   *   luôn CON SỐ**. `unverified` là ĐẦU VÀO cho Task 2/5, nơi nó phải làm hệ CHẶT HƠN.
   *
   * ⚠ ĐẶT SAU HAI LÁ CHẮN CŨ: lượt quét tốn một `nvidia-smi` (~70 ms) + một `powershell.exe`
   * (~200 ms). Hai lá chắn trên đã `return` ở đúng những nhịp ta CHẮC CHẮN không chốt nền.
   *
   * ⚠ KHÔNG ĐOÁN BYTE — ràng buộc này KHÔNG đổi. `nvidia-smi` trả `used_memory = [N/A]` cho MỌI
   * hộ, nên ta biết **AI** mà không biết **BAO NHIÊU**. Ta chỉ thôi biến "không biết bao nhiêu"
   * thành "coi như không có gì"; không có phép trừ nào mang số của hộ mồ côi.
   *
   * ⚠ "Mồ côi" hẹp hơn "không phải PID của ta", và còn phải loại **anh em ĐANG SỐNG** (C-1). Lý do
   * đầy đủ + phần lỗ CÒN LẠI nằm ở docstring `vramGpuHolders.ts`. Đọc trước khi nới/siết vị từ.
   */
  const orphans = census?.orphans ?? [];
  const peers = census?.peers ?? [];
  const nameOf = (h: { pid: number; name: string }) => `${h.name} (pid ${h.pid})`;

  // ★★★ Task 3 — VẾ NỀN, dòng chịu lực. `byteAnhEm` là 0 ở chế độ `"local"` (không có sổ chung),
  // và **đúng bằng 0 đó** là lý do `baselineOrigin` phải đi kèm: vế SỔ ở `reconcileOnce()` đọc nó
  // để biết được phép cộng `foreignBytes` hay không.
  baselineUsedBytes = raw - committedBytes - byteAnhEm;
  baselineCaptured = true;
  baselineSource = device.source;
  baselineOrigin = cheDoChung ? "captured" : "local";
  /**
   * ★★★ Pha 3 Task 3, QUYẾT ĐỊNH 2 — **VỊ TỪ ĐÃ ĐỔI. ĐỌC `lyDoNenKhongTin()` TRƯỚC KHI "SỬA LẠI".**
   *
   * Bản Pha 2B ở đây là `census !== null && orphans.length === 0 && peers.length === 0`, với lý lẽ:
   * *"byte của anh em nằm NGOÀI sổ của tiến trình này ⇒ nền đã nuốt chúng"*. **Chính Task 3 vừa xoá
   * bỏ tình trạng đó** (nền do MỘT tiến trình chụp; byte anh em nằm ở `attributable` — nghiệm thu
   * sống: nền 1.234.386.944 thay vì 9.444.524.032, `drift = 0`). ⇒ Vế `peers` trần trụi nay là **DI
   * SẢN**: nó phạt một tình trạng ĐÃ ĐƯỢC SỬA, và trong topo `api`+`worker` nó biến cờ thành **hằng
   * số `false`** kèm **1.024 MiB phạt thường trực** — mất dư địa VÀ mất thông tin.
   *
   * ⚠ NÓ ĐƯỢC **THAY**, KHÔNG BỎ: `census.peers` vẫn trả lời *"có anh em trên card không"*, và câu
   * hỏi thứ hai — *"byte của họ đã được tính chưa"* — nay có nguồn (sổ chung). Chỉ khi câu thứ hai
   * là KHÔNG thì cờ mới hạ (`"anh-em-tren-card-chua-duoc-tinh"`).
   *
   * ⚠⚠ LO NGẠI CỦA RE-REVIEW VÒNG 1 VẪN ĐƯỢC TRẢ, chỉ khác đường: *"một lần phân loại nhầm 'tàn dư
   * → anh em' là đủ đóng dấu TIN lên một nền nhiễm"*. Nay một hộ bị xếp nhầm sang `peers` vẫn hạ cờ
   * **trừ khi** sổ chung có hàng của một tiến trình khác — tức trừ khi khối byte đó **đã được một
   * tiến trình khác đứng tên**. Đó chính là điều kiện làm cho phân loại nhầm trở nên vô hại.
   *
   * ⚠ `unverified` KHÔNG có nghĩa "bẩn", nó có nghĩa **KHÔNG BIẾT** — và không được suy ra một
   * con số nào từ nó.
   */
  const banSaoLucChup = readSharedLedgerReplica();
  lyDoNenKhongTinHienTai = lyDoNenKhongTin({
    loai: "tu-chup",
    census,
    cheDoChung,
    // Số HÀNG của anh em: giấy phép của họ + hàng NỀN nếu nó đang thuộc về một tiến trình khác.
    soHangAnhEm:
      (banSaoLucChup?.foreignLeases.length ?? 0) +
      (banSaoLucChup?.baseline != null && banSaoLucChup.baseline.processKey !== selfKey ? 1 : 0),
    // ★ Pha 3 Task 4 — kết quả lượt nhận nuôi của CHÍNH nhịp này (nó chạy TRƯỚC lượt chụp).
    tanDuDaCoChu: pidTanDuDaCoChu,
  });

  if (orphans.length > 0 || peers.length > 0) {
    const mibNow = Math.round(baselineUsedBytes / 1024 / 1024);
    // Hai CÂU khác nhau vì hai HÀNH ĐỘNG khác nhau. Gộp một câu là hoặc bỏ sót lời khuyên đúng,
    // hoặc khuyên tắt một tiến trình đang phục vụ.
    /**
     * ★★★ Pha 3 Task 4 — CÂU NÀY PHẢI TÁCH **TÀN DƯ VÔ CHỦ** KHỎI **TÀN DƯ ĐÃ NHẬN NUÔI**.
     *
     * ⚠ Nghiệm thu sống bắt được đúng lỗi câu chữ này: bản trước in *"1 TÀN DƯ … tắt chúng THEO
     * ĐÚNG PID"* NGAY CẠNH *"Nền vẫn XÁC MINH ĐƯỢC"* — hai vế mâu thuẫn trong một dòng. Một hộ đã
     * có chủ thì byte của nó **đang nằm trong một cuốn sổ**, và người trực không cần làm gì cả.
     * Cùng kỷ luật với câu `peerSentence` (*"ĐỪNG TẮT"*): hai HÀNH ĐỘNG khác nhau ⇒ hai CÂU khác nhau.
     */
    const tanDuVoChu = orphans.filter((h) => !pidTanDuDaCoChu.has(h.pid));
    const tanDuCoChu = orphans.filter((h) => pidTanDuDaCoChu.has(h.pid));
    const orphanSentence =
      (tanDuVoChu.length > 0
        ? `${tanDuVoChu.length} TÀN DƯ VÔ CHỦ của lượt chạy trước (${tanDuVoChu.map(nameOf).join(", ")}) — ` +
          `tắt chúng THEO ĐÚNG PID; nền sẽ tự chụp lại ngay khi chúng rời GPU. `
        : "") +
      (tanDuCoChu.length > 0
        ? `${tanDuCoChu.length} hộ ngoài cây đã ĐƯỢC ĐỨNG TÊN (${tanDuCoChu.map(nameOf).join(", ")}) — byte của ` +
          `chúng ĐÃ nằm trong sổ (nhận nuôi, Pha 3 Task 4), KHÔNG cần làm gì. `
        : "");
    const peerSentence =
      peers.length > 0
        ? `${peers.length} VAI TRÒ ANH EM đang phục vụ (${peers.map(nameOf).join(", ")}) — ĐỪNG TẮT: mỗi vai ` +
          `trò giữ sổ RIÊNG, sổ chung là Pha 3. `
        : "";
    /**
     * ★ Pha 3 Task 3, QUYẾT ĐỊNH 2 — CÂU NÀY PHẢI NÓI CỜ ĐANG **BẬT HAY TẮT**, và **VÌ SAO**.
     * Từ nay "có anh em trên card" KHÔNG còn đồng nghĩa "nền chưa xác minh": nếu byte của họ đã
     * được tính qua sổ chung thì nền **ĐÃ XÁC MINH**, và một câu cảnh báo khẳng định ngược lại sẽ
     * mời người trực đi tìm một khoản phạt không tồn tại.
     */
    const daXacMinh = nenDaXacMinh();
    console.warn(
      `[vram] nền vừa chốt (${mibNow} MiB) — có mã của hệ đang giữ GPU ngoài cây tiến trình này. ` +
        `${orphanSentence}${peerSentence}` +
        (daXacMinh
          ? `Nền vẫn **XÁC MINH ĐƯỢC**: byte của anh em đã được tính qua sổ chung (Pha 3 Task 3), ` +
            `nên sự có mặt của họ KHÔNG còn hạ cờ.`
          : `Nền **CHƯA XÁC MINH** — lý do: ${lyDoNenKhongTinHienTai.join(", ")}. Con số nền VẪN ĐƯỢC ` +
            `DÙNG (nền nhiễm luôn chặt hơn chỉ-sổ), nhưng cưỡng chế sẽ chạy CHẶT HƠN đúng MỘT đơn vị.`) +
        ` ⚠ KHÔNG biết chúng giữ bao nhiêu (nvidia-smi trả [N/A]) nên KHÔNG trừ và KHÔNG đoán.` +
        describeTopologyHint(),
    );
    logVramEvent({
      event: "baseline_foreign_pid",
      owner: "reconciler",
      leaseKind: "external-process",
      priority: "background",
      deviceUsedBytes: raw,
      ledgerTotalBytes: ledgerTotal,
      detail: {
        deviceUsedRawBytes: raw,
        committedBytes,
        ledgerTotalBytes: ledgerTotal,
        // Nền ĐÃ chốt (có thể đã nhiễm) — ghi ra để đọc lại nhật ký là dựng lại được phép tính.
        // ⚠ KHÔNG trường nào mang byte của hộ ngoài cây: ta không biết, và không đoán.
        baselineUsedBytes,
        orphanHolders: orphans.map((h) => ({ pid: h.pid, name: h.name })),
        peerHolders: peers.map((h) => ({ pid: h.pid, name: h.name })),
        thirdPartyHolders: (census?.thirdParty ?? []).map((h) => ({ pid: h.pid, name: h.name })),
        ourHolders: (census?.ours ?? []).map((h) => ({ pid: h.pid, name: h.name })),
        note:
          "Nền CHỐT nhưng CHƯA XÁC MINH: có mã của hệ đang giữ GPU ngoài cây tiến trình này — " +
          "`orphanHolders` = tàn dư (tắt được), `peerHolders` = vai trò anh em đang phục vụ (ĐỪNG " +
          "tắt, sổ riêng, Pha 3). Nền vẫn được chốt vì một nền NHIỄM luôn CHẶT HƠN chỉ-sổ " +
          "(max(L,A) ≥ L) — vứt nó đi là tự nới dư địa. KHÔNG biết chúng giữ bao nhiêu " +
          "(used_memory = [N/A]) nên KHÔNG trừ, KHÔNG đoán.",
      },
    });
  } else if (!nenDaXacMinh() && !warnedUnverifiedBaseline) {
    warnedUnverifiedBaseline = true;
    console.warn(
      "[vram] nền vừa chốt CHƯA XÁC MINH ĐƯỢC (không liệt kê được tiến trình đang giữ GPU) — nó CÓ THỂ " +
        "đã nuốt byte của một tàn dư mà ta không thấy. Con số vẫn được dùng (nền nhiễm vẫn chặt hơn " +
        "chỉ-sổ), nhưng Task 2/5 phải coi đây là trạng thái CHẶT HƠN. Đây là mất phép ĐO, KHÔNG phải " +
        "bằng chứng rằng thiết bị sạch.",
    );
  }
  // Pha 1.5 Task 7 (T5-1) — chụp được thì đợt hoãn kết thúc. Đây là lối thoát DUY NHẤT của
  // nhánh báo động "không chụp được nền", và nó đóng NGAY ở lượt chụp thành công đầu tiên.
  baselineBlockedSinceMs = null;
  baselineBlockedReason = null;

  const mib = (b: number) => Math.round(b / 1024 / 1024);

  /**
   * ★★★ Pha 3 Task 3 — CUỘC BẦU: ta có được **CÔNG BỐ** nền cho anh em đọc không.
   *
   * ⚠⚠ **ĐIỀU GÌ XẢY RA KHI KHÔNG AI THẮNG** — brief đòi ghi rõ, và câu trả lời là chỗ dễ hỏng nhất
   * của cả task: **KHÔNG AI THẮNG ⇔ không có sổ chung** (`sharedLedgerFact() === null`: DB chưa
   * lên, `getDb()` trả `null`, cài đặt không DB, hoặc `startVramReconciler()` chưa bật đồng bộ).
   * Ở trạng thái đó:
   *   • **KHÔNG** rơi về `attributableBytes === null`. Đó mới là "âm thầm về nhánh RỘNG NHẤT":
   *     `max(L,A) ≥ L` ⇒ bỏ nền là **NỚI** dư địa đúng bằng khối anh em đang giữ. Ta VẪN chụp, vẫn
   *     có số, chỉ là số đó ở chế độ `"local"`.
   *   • **KHÔNG công bố** con số đó ra sổ chung: nền `"local"` đã nuốt byte anh em, đưa nó cho anh
   *     em đọc là phát tán một con số nhiễm ra cả cụm.
   *   • **KÊU**, và câu kêu nói đúng hai việc người trực phải làm (kiểm DB / bảng `vram_leases`).
   *   • Cờ `baselineVerified` giữ nguyên cơ chế Pha 2B: thấy `peers` ⇒ TẮT ⇒ cưỡng chế chặt hơn.
   *
   * ⚠ Người thắng bầu mà đang ở chế độ `"local"` cũng KHÔNG công bố — điều kiện là `cheDoChung`,
   * không phải chỉ "thắng".
   */
  const nguoiChup = nguoiChupNen(selfKey, Date.now());
  const taLaNguoiChup = cheDoChung && nguoiChup === selfKey;
  if (taLaNguoiChup) {
    publishOwnSharedBaseline({
      processKey: selfKey,
      pid: process.pid,
      bytes: baselineUsedBytes,
      source: device.source,
      verified: nenDaXacMinh(),
      atMs: Date.now(),
    });
    lastAdoptedFrom = null;
  } else {
    // Thua bầu (hoặc không có bầu) ⇒ THÔI công bố. Không xoá hàng của người khác: xoá một hàng
    // dùng chung mà ta không sở hữu là đúng lớp lỗi "hàng MA" mà C-4 của Task 2 sinh ra để chống.
    publishOwnSharedBaseline(null);
  }
  if (!cheDoChung) {
    if (!warnedLocalBaseline) {
      warnedLocalBaseline = true;
      console.warn(
        `[vram] SỔ CHUNG CHƯA ĐỌC ĐƯỢC ⇒ nền ${mib(baselineUsedBytes)} MiB chụp theo công thức CỤC BỘ ` +
          `(Pha 2B): nó ĐÃ NUỐT byte của mọi tiến trình anh em đang giữ GPU, và lượt đối chiếu vì thế ` +
          `KHÔNG cộng byte anh em vào sổ (cộng vào là TRỪ HAI LẦN). Đây KHÔNG phải trạng thái an toàn — ` +
          `nó chỉ là trạng thái CŨ. Kiểm DB và bảng \`vram_leases\` (migration 0312); nền dùng chung tự ` +
          `bật lại ở nhịp đầu tiên đọc được sổ chung.`,
      );
    }
  } else {
    warnedLocalBaseline = false;
    if (!taLaNguoiChup) {
      console.log(
        `[vram] nền vừa chụp CỤC BỘ (${mib(baselineUsedBytes)} MiB, đã trừ ${mib(byteAnhEm)} MiB của anh em) ` +
          `nhưng KHÔNG công bố: cuộc bầu chọn "${nguoiChup}". Ta vẫn có số để quyết định (không có nền = ` +
          `nhánh rộng nhất), và sẽ ĐỌC nền của người chụp ngay khi hàng của họ tới bản sao.`,
      );
    }
  }
  console.log(
    `[vram] nền thiết bị: ${mib(baselineUsedBytes)} MiB ` +
      `(thiết bị ${mib(raw)} − đã commit ${mib(committedBytes)} − anh em ${mib(byteAnhEm)}, thước ` +
      `"${device.source}", chế độ "${baselineOrigin}") — không phải của tiến trình này lẫn anh em, ` +
      `sẽ TRỪ khỏi mọi phép so sổ.`,
  );
  logVramEvent({
    event: "baseline",
    owner: "reconciler",
    leaseKind: "external-process",
    priority: "background",
    deviceUsedBytes: raw,
    ledgerTotalBytes: ledgerTotal,
    detail: {
      deviceUsedRawBytes: raw,
      // Phần THỰC SỰ bị trừ.
      // ⚠ N-3 (review cổng cuối) — bản trước viết tiếp: *"chênh lệch giữa hai số này cho biết lúc
      // chụp có bao nhiêu lượt cấp phát đang dở dang"*. Câu đó **nay LUÔN SAI**: sau lá chắn HOÃN
      // (C-1 × T5-1), lượt chụp chỉ THÀNH CÔNG khi mọi lease đã có `actualBytes`, mà
      // `totalReservedBytes = Σ (actualBytes ?? estimatedBytes)` (vramBroker) ⇒ tại sự kiện
      // `baseline` hai số này **ĐỒNG NHẤT theo cấu trúc, chênh lệch luôn 0**. Đã chứng minh bằng
      // đột biến: hoán hai biến ở ĐÂY cho **0 test đỏ** (đột biến vô nghĩa), hoán ở
      // `baseline_deferred` cho **1 đỏ**. ⇒ Muốn biết "bao nhiêu lượt cấp phát đang dở dang" thì
      // đọc sự kiện **`baseline_deferred`** (`blockingOwners`), KHÔNG phải sự kiện này.
      // Giữ cả hai trường vì chúng vẫn là bằng chứng dựng lại được phép tính — chỉ bỏ câu diễn
      // giải đã hết đúng, đúng khuôn M-2 vừa gỡ cách đây vài dòng.
      committedBytes,
      ledgerTotalBytes: ledgerTotal,
      baselineUsedBytes,
      /**
       * ★★★ Pha 3 Task 3 — BA Ô LÀM PHÉP TRỪ MỚI DỰNG LẠI ĐƯỢC TỪ NHẬT KÝ. Không có chúng thì
       * `baselineUsedBytes` đổi 17 GB giữa hai lượt boot mà không ai truy được vì sao.
       */
      foreignLedgerBytes: byteAnhEm,
      baselineOrigin,
      baselineOwnerProcessKey: taLaNguoiChup ? selfKey : nguoiChup,
      // Pha 1.5 Task 1 — thước đã dùng để chụp nền này. `reconcileOnce()` so nó với thước của
      // lượt đối chiếu; khác nhau thì huỷ nền và chụp lại thay vì so hai thước với nhau.
      source: device.source,
      // Pha 1.5 Task 1, review vòng 1 (EXP-2) — CHỈ có khi lượt chụp này là RESAMPLE (đổi
      // thước), KHÔNG bịa ra cho lượt chụp đầu tiên (không có nền cũ để so). Đây là dấu vết
      // DUY NHẤT còn lại của một kẻ chui grab ĐÚNG LÚC đổi thước: lượt phát hiện đổi thước cố ý
      // KHÔNG báo động (số vừa huỷ không đáng tin để so trực tiếp — quyết định ĐÃ DUYỆT), nhưng
      // nếu không ghi lại gì thì kẻ chui đó biến mất VĨNH VIỄN không cách nào truy ngược.
      ...(priorBaseline
        ? {
            priorBaselineUsedBytes: priorBaseline.usedBytes,
            priorSource: priorBaseline.source,
            newSource: device.source,
            // "Nếu KHÔNG huỷ nền cũ mà so trực tiếp nền CŨ với số liệu MỚI, drift sẽ là bao
            // nhiêu?" — CHÍNH XÁC phép so hai thước mà Task 1 sinh ra để TRÁNH khi so LIVE, nhưng
            // ở đây chỉ dùng để GHI SỔ, không dùng để báo động.
            driftIfNotResampled: raw - priorBaseline.usedBytes - ledgerTotal,
          }
        : {}),
      // ⚠ Minor-2 (review TOÀN NHÁNH): bản trước ghi nguyên văn tiền đề ĐÃ BỊ RÚT LẠI — "giấy
      // phép chưa commit là 'đã xin, chưa cấp phát xong' nên trừ nó là trừ thứ chưa tồn tại".
      // Câu đó SAI (đo được `nvidia-smi = 18.115 MiB` khi lease 30B vẫn pending) và nó đi thẳng
      // vào bảng `vram_events` ở MỌI lượt chụp — đúng nghĩa "mìn cho người sau".
      /**
       * ★ Pha 2B Task 1 — nền này có bằng chứng hay không, và bằng chứng đó là GÌ.
       *
       * ⚠ m-1 (re-review vòng 1) — bản trước của chính dòng này còn viết *"`baselineVerified:
       * false` ⇒ `attributableBytes` của mọi nhịp sau là `null`"*. Câu đó **ĐÃ BỊ I-1 BÁC BỎ** và
       * nay khẳng định NGƯỢC với mã: `attributableBytes` KHÔNG phụ thuộc `baselineVerified` nữa
       * (vì `max(L, A) ≥ L`, vứt một nền nhiễm là NỚI dư địa). Cờ này là ĐẦU VÀO để Task 2/5 chạy
       * CHẶT HƠN — nó không xoá con số nào cả.
       *
       * `gpuHolders` là **DỮ LIỆU CHO LƯỢT SAU**, không phải trang trí: nó là thứ duy nhất trả
       * lời được câu "893 MiB nền kia gồm những ai" khi có người hỏi lại. Và nếu một ngày danh
       * sách này xuất hiện một hộ CUDA lạ cỡ lớn (`ollama.exe`…), đây là chỗ nó lộ ra —
       * cổng hiện tại KHÔNG bắt ca đó (xem docstring `vramGpuHolders.ts`).
       */
      baselineVerified: nenDaXacMinh(),
      baselineUnverifiedReasons: lyDoNenKhongTinHienTai,
      gpuHolders: census
        ? {
            ours: census.ours.map((h) => ({ pid: h.pid, name: h.name })),
            // C-1 — vai trò ANH EM đang phục vụ (api ⇄ worker ⇄ edge). Ghi riêng khỏi `thirdParty`:
            // byte của chúng là của HỆ NÀY (chỉ nằm ở sổ khác), nên người đọc nhật ký không được
            // gộp chúng vào "nền của máy" khi đi truy một khoản lệch.
            peers: census.peers.map((h) => ({ pid: h.pid, name: h.name })),
            orphans: census.orphans.map((h) => ({ pid: h.pid, name: h.name })),
            thirdParty: census.thirdParty.map((h) => ({ pid: h.pid, name: h.name })),
          }
        : null,
      note:
        "nền = thiết bị − tổng giấy phép ĐÃ CHỐT SỔ (số ĐO, hoặc ước lượng dự phòng T5-15 cho " +
        "khối byte chắc chắn tồn tại), và lượt chụp này chỉ chạy khi KHÔNG còn giấy " +
        "phép nào `actualBytes === null` (lá chắn HOÃN, T5-1) — vì byte của một giấy phép chưa " +
        "commit CÓ THỂ đã nằm trong deviceUsed mà đóng góp 0 vào committedBytes, và không công " +
        "thức nào đúng trong cửa sổ đó. ⚠ Sidecar chạy tiến trình RIÊNG thì KHÔNG có trong sổ ⇒ " +
        "vẫn bị nuốt vào đây (spec §6 — Pha 3 nhận nuôi).",
    },
  });
  return baselineUsedBytes;
}

/**
 * ★★★ Pha 3 Task 3 — **NHẬN NỀN CỦA NGƯỜI CHỤP.** Một người ghi, gọi từ đúng một chỗ.
 *
 * ⚠⚠ CỜ `baselineVerified` KHÔNG BAO GIỜ ĐƯỢC NÂNG CẤP Ở ĐÂY. Nó là **VỊ TỪ DÙNG CHUNG với
 * `applyEnforcement()`** (`vramEnforcement.DISTRUST_UNITS["unverified-baseline"]`) và với
 * `computeHeadroom()` (`degradedReasons`), nên một lượt "làm tròn lên" ở đây là **nới dư địa ở hai
 * người tiêu thụ khác** — đúng lớp lỗi đã tái diễn ba lần. Người đọc chỉ được LÀM YẾU cờ:
 *   • người chụp khai `verified: false` ⇒ ta cũng `false`;
 *   • hàng nền cũ hơn **dung sai một chu kỳ đồng bộ** ⇒ `false` dù người chụp khai `true`.
 *
 * ⚠ **DUNG SAI cho bản sao cũ tới 60 s là bắt buộc, không phải rộng rãi**: bản sao đọc chỉ được làm
 * mới theo nhịp reconciler, nên MỌI hàng nền đọc được đều "cũ" theo nghĩa đó. Không có dung sai thì
 * cờ tắt vĩnh viễn ở mọi tiến trình đọc — một cờ luôn bật là một cờ không còn thông tin (bài học
 * I-3 của Task 2).
 *
 * ⚠ THƯỚC: ta nhận luôn thước của người chụp (`baselineSource`), và `reconcileOnce()` **KHÔNG** đưa
 * nền đã nhận vào nhánh resample (xem điều kiện ở đó) — một người đọc không có gì để chụp lại, nên
 * resample chỉ dẫn tới bộ ngắt mạch trip rồi `attributableBytes: null`, tức nhánh RỘNG NHẤT.
 */
function nhanNenDungChung(nen: SharedBaselineRecord, tuoiMs: number): void {
  const doiChu = lastAdoptedFrom !== nen.processKey;
  baselineUsedBytes = nen.bytes;
  baselineCaptured = true;
  baselineSource = nen.source;
  baselineOrigin = "adopted";
  lyDoNenKhongTinHienTai = lyDoNenKhongTin({ loai: "nhan-nuoi", tuoiMs, nguoiChupKhai: nen.verified });
  // Ta là NGƯỜI ĐỌC ⇒ thôi công bố. Hai người cùng công bố là đúng triệu chứng N-WB-1.
  publishOwnSharedBaseline(null);
  // Có nền rồi ⇒ đợt "không chụp được nền" kết thúc (cùng lối thoát với lượt chụp thành công).
  baselineBlockedSinceMs = null;
  baselineBlockedReason = null;
  warnedLocalBaseline = false;
  if (doiChu) {
    lastAdoptedFrom = nen.processKey;
    console.log(
      `[vram] ĐỌC nền dùng chung ${Math.round(nen.bytes / 1024 / 1024)} MiB do "${nen.processKey}" chụp ` +
        `(thước "${nen.source}", người chụp khai xác minh: ${nen.verified}, bản sao cũ ${Math.round(tuoiMs / 1000)} s) ` +
        `— tiến trình này KHÔNG tự chụp nền nữa, nên nó KHÔNG nuốt byte của anh em.`,
    );
  }
}

/**
 * ★★★ Pha 3 Task 4 (§6) — **MỘT LƯỢT NHẬN NUÔI / THU HỒI.** Chạy đúng một lần mỗi nhịp, TRƯỚC
 * `captureVramBaseline()` (nó ghi `pidTanDuDaCoChu`, thứ lượt chụp đọc).
 *
 * ⚠⚠ RANH GIỚI VỚI `MocCaiChet` (Task 1) — CHỖ NGUY HIỂM NHẤT CỦA CẢ PHA, đọc trước khi sửa:
 * hàm này là **NGƯỜI ĐỌC THỨ HAI** của vị từ *"còn sống"*, và nó lệch **543 ms** so với người đọc
 * thứ nhất trên chính hộ 7,8 GB (Task 1 đo: mã thoát ~16 ms · `nvidia-smi` ≤33 ms · `"exit"`
 * ~560 ms). Ranh giới được giữ bằng **CẤU TRÚC**, không bằng kỷ luật:
 *   • giấy phép của sidecar do CHÍNH tiến trình này sinh ra mang `owner === "sidecar:vision"` ⇒
 *     `pidTuOwnerNhanNuoi()` trả `null` ⇒ nó **không nằm trong `leaseNhanNuoi`** ⇒ hàm này không
 *     có đường nào chạm tới nó. Nó chết theo `proc.on("exit")` như cũ.
 *   • chỉ hộ **mồ côi thật** (không có `proc` vì tiến trình sinh ra nó đã chết) mới đi qua phép
 *     dò PID ở đây.
 *
 * ⚠ `census === undefined` ⇒ nhịp này KHÔNG quét (xem cổng ở `__runReconcileTick`) ⇒ **không làm
 * gì**, và `pidTanDuDaCoChu` GIỮ NGUYÊN: một lượt xoá nó ở đây sẽ làm cờ nền nhấp nháy theo cổng
 * tiết kiệm chi phí, tức một cơ chế mới vô hiệu hoá một cơ chế cũ (đã tái diễn ba lần).
 *
 * KHÔNG BAO GIỜ ném: một lỗi kế toán không được đánh hỏng nhịp đối chiếu.
 */
async function chayLuotNhanNuoi(census: GpuHolderCensus | null | undefined): Promise<void> {
  // ⚠ `null` (quét HỎNG) KHÁC `undefined` (nhịp này CỐ Ý không quét): quét hỏng thì ta không biết
  // hộ mồ côi nào, nhưng vẫn có thể đọc bảng tiến trình để dọn HÀNG MA — hai câu hỏi độc lập.
  if (census === undefined) return;
  const procs = await readProcTableSafe();
  const selfKey = sharedLedgerSelfKey();

  /**
   * ⚠ NGƯỢC TRƯỚC, XUÔI SAU. Lượt THU HỒI chạy trước lượt NHẬN NUÔI để một PID vừa được cấp lại
   * nhả giấy phép cũ **trong cùng nhịp** mà nó có thể được nhận nuôi lại — nếu không, `pidDaNhanNuoi`
   * còn mang số cũ và hộ mới sẽ bị coi là "đã có chủ" đúng một nhịp.
   */
  for (const [pid, muc] of [...leaseNhanNuoi]) {
    const hienTai = procs === null ? undefined : procs.find((p) => p.pid === pid);
    // Không đọc được bảng ⇒ KHÔNG kết luận (giữ giấy phép). Đây là chiều CHẶT: giữ một khối byte
    // đã nhả chỉ làm hệ dè dặt; nhả một khối byte còn sống là NỚI đúng 7,8 GB.
    if (procs === null) continue;
    const conSong = hienTai !== undefined && hienTai.ctime === muc.ctime;
    if (conSong) continue;
    leaseNhanNuoi.delete(pid);
    try {
      const { release } = await import("./vramBroker");
      release(muc.lease);
    } catch {
      /* sổ hỏng KHÔNG được đánh hỏng nhịp; nhịp sau thử lại (mục đã rời `leaseNhanNuoi`) */
    }
    console.warn(
      `[vram] THU HỒI giấy phép nhận nuôi của pid ${pid} (${Math.round((muc.lease.actualBytes ?? 0) / 1024 / 1024)} MiB): ` +
        `${hienTai === undefined ? "tiến trình đã BIẾN MẤT khỏi bảng tiến trình" : "PID đã được CẤP LẠI cho một tiến trình KHÁC (CreationDate đổi)"}. ` +
        `Byte của nó đã được HĐH thu hồi ⇒ giữ trong sổ là trừ dư địa cho một khối KHÔNG TỒN TẠI.`,
    );
  }

  const banSao = readSharedLedgerReplica();
  /**
   * Hàng đưa vào kế hoạch = giấy phép của anh em **+ hàng NỀN nếu nó thuộc về ai đó khác**.
   * ⚠ Hàng nền BẮT BUỘC có mặt: nó là dân số 2 (nợ Task 3 — hàng của tiến trình đã chết nằm lại
   * tới 180 s), và bản sao đọc đã TÁCH nó khỏi `foreignLeases` nên không có dòng này thì nó
   * **không có đường vào** kế hoạch.
   */
  const rows: SharedLeaseRow[] = banSao === null ? [] : [...banSao.foreignLeases];
  if (banSao?.baseline != null && banSao.baseline.processKey !== selfKey) {
    rows.push(hangNenChoKeHoach(banSao.baseline.processKey, banSao.baseline.bytes));
  }

  const ke = lapKeHoachNhanNuoi({
    selfKey,
    rows,
    procs,
    orphans: census?.orphans ?? [],
    pidDaNhanNuoi: [...leaseNhanNuoi.keys()],
    sidecar: moTaSidecarNhanNuoi(),
  });
  pidTanDuDaCoChu = ke.pidTanDuDaCoChu;

  /**
   * ★★★ VỨT HÀNG MA KHỎI BẢN SAO **NGAY TRONG NHỊP NÀY**, trước khi lượt chụp nền và lượt đối
   * chiếu đọc nó. Xem docstring `loaiHangDaChungMinhLaMa()` — số đo của nghiệm thu sống cho thấy
   * không có dòng này thì chính nhịp vừa chứng minh hàng là MA vẫn báo động cho 17.000 MiB ma đó,
   * và vẫn nhận nuôi nền của một tiến trình đã chết.
   */
  if (ke.xoaHangMa.length > 0) loaiHangDaChungMinhLaMa(ke.xoaHangMa.map((m) => m.leaseKey));

  for (const ma of ke.xoaHangMa) {
    // ⚠ Đi qua ĐÚNG hàng đợi mà `release()` dùng — một lượt xoá thẳng vào DB ở đây sẽ bỏ qua cơ
    // chế thử-lại + cờ `unsyncedWrites` mà Task 2 dựng, và một lượt xoá hỏng sẽ im lặng.
    enqueueSharedLedgerWrite({ op: "delete", leaseKey: ma.leaseKey });
    console.warn(
      `[vram] DỌN HÀNG MA khỏi sổ chung: "${ma.leaseKey}" (${Math.round(ma.bytes / 1024 / 1024)} MiB) — tiến trình ` +
        `"${ma.processKey}" đã CHẾT (vắng khỏi bảng tiến trình, hoặc PID đã được cấp lại: CreationDate > bootMs). ` +
        `Hàng này đang làm MỌI tiến trình anh em trừ dư địa cho một khối byte KHÔNG TỒN TẠI.`,
    );
  }

  for (const ho of ke.nhanNuoi) {
    const row = procs === null ? undefined : procs.find((p) => p.pid === ho.pid);
    if (row === undefined) continue;
    try {
      const { adoptLease } = await import("./vramBroker");
      const lease = adoptLease(
        {
          owner: ownerNhanNuoi(ho.pid),
          kind: "external-process",
          estimatedBytes: ho.bytes,
          priority: "interactive",
          estimateSource: "config-default",
          ttlMs: sidecarTtlMs(),
          /**
           * ★★★ Pha 3 Task 5 (A) — **NỢ TRỰC TIẾP CỦA TASK 4 ĐƯỢC TRẢ Ở ĐÚNG Ô NÀY.**
           *
           * Task 4 để trống `reclaimer` và ghi rõ vì sao: khai `"vision-sidecar"` là **HỨA NGƯỢC**
           * (`stopSidecar()` chỉ giết được `proc` của chính tiến trình này). Hệ quả là hộ **lớn
           * nhất hệ** (7,8 GB) nằm trong sổ mà `coThiHanhThuHoi()` trả `false` ⇒ nó **vắng mặt**
           * khỏi `preemptPlan()`, khỏi "tổng nhường được", và khỏi mọi lượt `preempt()`.
           *
           * Nay ô này khai `"orphan-pid"`, và **cùng một vị từ** (`nguoiThiHanhThuHoi`) lái cả bốn
           * người tiêu thụ: `reclaimable` trong câu từ chối · `preemptableBytes` · `preemptPlan()`
           * · `NGUOI_THI_HANH` ở `vramPreempt`. Người thi hành ấy TỒN TẠI và ĐƯỢC XÁC MINH BẰNG
           * THIẾT BỊ (`thuHoiHoNhanNuoi` ngay dưới) — không còn là một cái nhãn.
           */
          reclaimer: "orphan-pid",
        },
        ho.bytes,
        `nhan-nuoi-mo-coi:pid=${ho.pid}`,
      );
      leaseNhanNuoi.set(ho.pid, { lease, ctime: row.ctime });
      // Hộ vừa có chủ ⇒ nó thôi là "tàn dư vô chủ" NGAY trong nhịp này, không phải nhịp sau.
      pidTanDuDaCoChu = new Set([...pidTanDuDaCoChu, ho.pid]);
      console.warn(
        `[vram] NHẬN NUÔI hộ mồ côi ${ho.name} (pid ${ho.pid}, ${Math.round(ho.bytes / 1024 / 1024)} MiB): tiến trình ` +
          `sinh ra nó đã chết (server khởi động lại?) nhưng byte của nó VẪN NẰM TRÊN CARD — spec §6. ` +
          `Giấy phép đã được DỰNG LẠI và công bố ra sổ chung để anh em thấy. ` +
          `Hộ này NHÀN RỖI và CÓ người thi hành thu hồi ("orphan-pid", Pha 3 Task 5): một lượt ` +
          `preempt() chỉ tắt pid ${ho.pid} khi mốc tạo của nó VẪN KHỚP mốc ghi kèm ở đây — cùng số ` +
          `PID mà CreationDate đổi ⇒ TỪ CHỐI, không tắt (C-1) — và chỉ khai thành công khi ` +
          `nvidia-smi xác nhận byte đã nhả.`,
      );
    } catch {
      /* sổ hỏng KHÔNG được đánh hỏng nhịp đối chiếu */
    }
  }
}

/** Chỉ dùng trong test/chẩn đoán — PID mà tiến trình này đang đứng tên. */
export function __pidDangNhanNuoi(): number[] {
  return [...leaseNhanNuoi.keys()];
}

/**
 * ★ Pha 3 Task 5 (D) — `VRAM_SIDECAR_TTL_MS`, **MỘT NGƯỜI ĐỌC DUY NHẤT.**
 *
 * ⚠ `?? 900_000` LÀ MỘT DÂY VÀ NÓ PHẢI CÓ LƯỚI (ràng buộc 11): bản Task 4 viết
 * `Number(process.env.VRAM_SIDECAR_TTL_MS ?? 900_000)` **inline** — nghĩa là `VRAM_SIDECAR_TTL_MS=`
 * (đặt rồi để trống) cho `Number("")` = **0** ⇒ giấy phép nhận nuôi khai TTL **0 ms**, tức tự khai
 * là quá hạn ngay lúc sinh; và `VRAM_SIDECAR_TTL_MS=abc` cho `NaN` ⇒ một `NaN` đi thẳng vào ô
 * `ttlMs` của giấy phép rồi vào ống dẫn sự kiện (ràng buộc 9: cột `bigint` ⇒ **mất cả lô**).
 * Cả hai hình dạng đều KHÔNG có ca nào canh. Nay có một hàm, một lưới, hai mép.
 */
export function sidecarTtlMs(): number {
  const raw = process.env.VRAM_SIDECAR_TTL_MS;
  if (raw === undefined) return 900_000;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 900_000;
}

/** Cửa I/O của lượt thu hồi hộ ngoài tiến trình — tách ra để ca test đi qua ĐÚNG hàm sản xuất. */
export interface CuaThuHoiNgoaiTienTrinh {
  /** Gửi tín hiệu chấm dứt tới PID. Ném ⇒ coi như "không gửi được" (có thể nó đã chết). */
  readonly giet: (pid: number) => void;
  /** PID đang giữ GPU theo THIẾT BỊ. `null` = KHÔNG ĐỌC ĐƯỢC ⇒ không có bằng chứng. */
  readonly docPidGiuGpu: () => Promise<readonly number[] | null>;
  readonly nghi: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** Hạn chờ bằng chứng "byte đã nhả". ⚠ Cùng khuôn dây-có-lưới với `sidecarTtlMs()`. */
export function reclaimWaitMs(): number {
  const raw = process.env.VRAM_RECLAIM_WAIT_MS;
  if (raw === undefined) return 8_000;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8_000;
}

/**
 * ★★★ Pha 3 Task 5 (A) — **NGƯỜI THI HÀNH THU HỒI XUYÊN TIẾN TRÌNH.** Đây là thứ Task 4 khai
 * thiếu và CỐ Ý không hứa.
 *
 * ⚠⚠ ĐIỀU KIỆN RA SỐ 1 CỦA PHA 3, NGUYÊN VĂN: *"chỉ khai thành công khi byte THẬT SỰ đã nhả"*.
 * Nên thứ tự ở đây **không đổi được**:
 *   1. hộ phải nằm trong `leaseNhanNuoi` — tức nó là một hộ **MỒ CÔI ĐÃ NHẬN NUÔI**, không phải
 *      sidecar của chính ta (ranh giới cấu trúc của Task 4) và không phải hàng của anh em;
 *   2. gửi tín hiệu chấm dứt tới ĐÚNG PID (không quét mù theo tên — bài học Task 1);
 *   3. **CHỜ BẰNG CHỨNG THIẾT BỊ**: PID biến mất khỏi `nvidia-smi --query-compute-apps`. Đây là
 *      câu trả lời TRỰC TIẾP cho *"byte đã nhả chưa"*; bảng tiến trình trả lời một câu KHÁC và
 *      lệch 543 ms (xem `readComputeApps`);
 *   4. **chỉ khi có bằng chứng** mới nhả giấy phép và trả `true`.
 *
 * ⚠⚠ HẾT HẠN CHỜ ⇒ `false` VÀ **GIỮ NGUYÊN GIẤY PHÉP**. Đó là kỷ luật C-2 của Task 1: khai
 * `reclaimed` với `freedBytes = 0` khiến người gọi xin lại NGAY và **hỏng lần hai** — sau khi đã
 * giết một hộ 7,8 GB. Một lời từ chối trung thực rẻ hơn nhiều.
 * ⚠ `docPidGiuGpu()` trả `null` (tắt quét / `nvidia-smi` vắng) ⇒ **KHÔNG có bằng chứng** ⇒ `false`.
 * Không được đọc `null` thành "danh sách rỗng ⇒ nó chết rồi" — đúng lớp lỗi cả module tồn tại để diệt.
 *
 * KHÔNG BAO GIỜ ném.
 */
/**
 * ★ SEAM CHO NGHIỆM THU THEO **ĐƯỜNG THOÁT** (ràng buộc 10). `preempt()` gọi hàm dưới đây **không
 * tham số** (nó chỉ có `owner` để dịch ra PID), nên nếu cửa I/O chỉ nhận được qua tham số thì
 * chuỗi thật `preempt() → NGUOI_THI_HANH["orphan-pid"] → thuHoiHoNhanNuoi()` **không có lưới nào**
 * và ta lại đi kiểm từng mảnh rời — đúng lớp lỗi "lưới theo FILE" đã tái diễn mười một lần.
 */
let cuaThuHoiCuaTest: Partial<CuaThuHoiNgoaiTienTrinh> | null = null;
export function __setCuaThuHoiForTests(cua: Partial<CuaThuHoiNgoaiTienTrinh> | null): void {
  cuaThuHoiCuaTest = cua;
}

export async function thuHoiHoNhanNuoi(
  pid: number,
  cuaVao?: Partial<CuaThuHoiNgoaiTienTrinh>,
): Promise<boolean> {
  const muc = leaseNhanNuoi.get(pid);
  if (muc === undefined) return false;

  /**
   * ★★★ C-1 (review TOÀN NHÁNH) — **ĐỌC MỐC TẠO TRƯỚC KHI GIẾT.** Đây là dòng phân biệt
   * *"tắt ĐÚNG pid N"* với *"tắt cái tiến trình đang MANG số N hôm nay"*.
   *
   * `leaseNhanNuoi` lưu `ctime` đúng vì lý do PID-CẤP-LẠI (docstring của nó gọi tên `notepad.exe`),
   * nhưng trước bản vá `ctime` **chỉ được đọc ở nhịp 60 s** (`chayLuotNhanNuoi`) — đường PHÁ HUỶ
   * này chỉ kiểm `leaseNhanNuoi.get(pid)` CÓ MẶT. Ba sự thật cộng lại thành một lượt giết nhầm:
   *   1. hộ nhận nuôi có `refCount = 0` **VĨNH VIỄN** ⇒ `coTheNhuong()` cho **MỌI** mức người xin
   *      ⇒ **mọi** `reserve()` bị từ chối đều lên kế hoạch giết nó;
   *   2. cửa sổ **rộng hơn 60 s**: nhịp bỏ qua khi bảng tiến trình không đọc được, và Task 4 đo
   *      được `readProcTable()` trả `null` **4 lượt liên tiếp** dưới tải;
   *   3. sau lượt giết, phép kiểm bằng chứng thoả **RỖNG TUẾCH** — tiến trình mới không phải
   *      compute-app ⇒ `!pids.includes(pid)` đúng NGAY lượt đầu ⇒ `return true` + một dòng log
   *      *"nvidia-smi XÁC NHẬN"*. Sai **và** tự khai là đúng: hình dạng tệ nhất có thể.
   *
   * ⚠ `procs === null` ⇒ **KHÔNG CÓ BẰNG CHỨNG** ⇒ `false`, cùng kỷ luật đã áp cho `docPidGiuGpu()`
   * ngay dưới. *"Không kiểm được"* không được đọc thành *"được phép"* — đó đúng lớp lỗi cả module
   * này tồn tại để diệt, chỉ khác chỗ hậu quả ở đây là một `process.kill()` vào PID tuỳ ý.
   * ⚠ KHÔNG nhả giấy phép ở nhánh này dù ta vừa biết tiến trình cũ đã chết: người dọn `leaseNhanNuoi`
   * theo mốc tạo là nhịp đối chiếu (`:1441-1455`), và giữ thêm một nhịp là chiều CHẶT.
   */
  const bang = await readProcTableSafe();
  const hienTai = bang === null ? undefined : bang.find((p) => p.pid === pid);
  if (bang === null || hienTai === undefined || hienTai.ctime !== muc.ctime) {
    console.error(
      `[vram] KHÔNG THU HỒI pid ${pid}: ` +
        (bang === null
          ? "KHÔNG ĐỌC ĐƯỢC bảng tiến trình ⇒ không có bằng chứng nó vẫn là tiến trình ta đứng tên"
          : hienTai === undefined
            ? "PID đã BIẾN MẤT khỏi bảng tiến trình ⇒ không còn gì để tắt"
            : "PID đã được CẤP LẠI cho một tiến trình KHÁC (CreationDate đổi) ⇒ tắt nó là giết một tiến trình VÔ CAN") +
        `. Giữ nguyên giấy phép và khai THẤT BẠI; nhịp đối chiếu là người dọn bảng nhận nuôi.`,
    );
    return false;
  }

  const cua: Partial<CuaThuHoiNgoaiTienTrinh> | undefined =
    cuaVao ?? cuaThuHoiCuaTest ?? undefined;

  const giet =
    cua?.giet ??
    ((p: number) => {
      process.kill(p, "SIGTERM");
    });
  const docPidGiuGpu =
    cua?.docPidGiuGpu ??
    (async () => {
      const { readComputeApps } = await import("./vramGpuHolders");
      const hs = await readComputeApps();
      return hs === null ? null : hs.map((h) => h.pid);
    });
  const nghi = cua?.nghi ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()));
  const now = cua?.now ?? Date.now;

  try {
    giet(pid);
  } catch {
    // ESRCH (đã chết) hoặc EPERM (không đủ quyền) — cả hai đều KHÔNG phải bằng chứng. Đi tiếp
    // xuống lượt hỏi thiết bị: nó là thứ DUY NHẤT được phép kết luận.
  }

  const hanChot = now() + reclaimWaitMs();
  for (;;) {
    let pids: readonly number[] | null;
    try {
      pids = await docPidGiuGpu();
    } catch {
      pids = null;
    }
    if (pids !== null && !pids.includes(pid)) {
      // ⚠ HAI NGƯỜI GHI cho `leaseNhanNuoi`, và **cả hai nằm trong file này** (chỗ kia:
      // `chayLuotNhanNuoi` :1443, lượt dọn theo mốc tạo). Ý vẫn đúng — `vramPreempt` KHÔNG tự ghi,
      // nó gọi sang đây — nhưng câu chữ cũ ("MỘT NGƯỜI GHI") dựng một giả định sai cho người sau
      // (m-5, review TOÀN NHÁNH). Gỡ khỏi bảng TRƯỚC khi nhả sổ, để một nhịp đối chiếu chen vào
      // giữa không thấy một mục trỏ tới giấy phép đã nhả.
      leaseNhanNuoi.delete(pid);
      const bytes = muc.lease.actualBytes ?? 0;
      try {
        const { release } = await import("./vramBroker");
        release(muc.lease);
      } catch {
        /* sổ hỏng KHÔNG được biến một lượt thu hồi THÀNH CÔNG thành một lời khai thất bại */
      }
      console.warn(
        `[vram] THU HỒI XUYÊN TIẾN TRÌNH: đã tắt pid ${pid} và nvidia-smi XÁC NHẬN nó không còn giữ ` +
          `GPU ⇒ nhả ${Math.round(bytes / 1024 / 1024)} MiB khỏi sổ. Đây là hộ NGOÀI tiến trình này ` +
          `(sidecar mồ côi đã nhận nuôi — Pha 3 Task 4).`,
      );
      return true;
    }
    if (now() >= hanChot) {
      console.error(
        `[vram] THU HỒI HỎNG: đã gửi tín hiệu tắt tới pid ${pid} nhưng ${pids === null ? "KHÔNG ĐỌC ĐƯỢC" : "vẫn thấy"} ` +
          `nó trong danh sách compute-app sau ${reclaimWaitMs()} ms ⇒ KHÔNG có bằng chứng byte đã nhả ⇒ ` +
          `GIỮ NGUYÊN giấy phép. Khai "đã thu hồi" ở đây là nói dối đúng chiều OOM.`,
      );
      return false;
    }
    await nghi(200);
  }
}

/**
 * ★★★ Pha 2B Task 2 — Ô LƯU KẾT QUẢ NHỊP GẦN NHẤT. Đây là NGUỒN SỐ của `computeHeadroom()`
 * (`vramHeadroom.ts`, §5.6c), và lý do nó phải tồn tại là một ràng buộc CẤU TRÚC, không phải tiện lợi:
 *
 * `reserve()` là **ĐỒNG BỘ**, và tính đồng bộ đó **LÀ** lá chắn từ Pha 1 — không có `await` thì
 * không có cửa sổ để hai lượt xin chen nhau giữa lúc đọc số và lúc ghi sổ. Đường cưỡng chế vì thế
 * **không được `await` đầu dò**; nó đọc con số của nhịp gần nhất đã lưu sẵn ở đây.
 *
 * ⚠ CÁI GIÁ, ĐÃ KHAI Ở SPEC §5.6c: **60 s là ĐỘ TRỄ CƯỠNG CHẾ THẬT.** Một hộ lạ xuất hiện ngay
 * sau một nhịp sẽ vô hình với cổng tới trọn một nhịp. Vì vậy ô này mang theo `atMs` — "tick cũ bao
 * lâu thì hết đáng tin" là chính sách của Task 5, và nó cần con số để quyết.
 *
 * ⚠⚠ ĐÂY KHÔNG PHẢI MỘT BỘ ĐỆM ĐẦU DÒ. Không ai được "làm mới" nó bằng cách gọi lại đầu dò từ
 * đường đọc — làm vậy là đưa I/O trở lại đúng chỗ Pha 1 đã dọn đi.
 */
export interface VramTickRecord {
  readonly result: VramReconcileResult;
  /** `Date.now()` lúc nhịp KẾT THÚC (không phải lúc bắt đầu) — con số dùng để đo độ cũ. */
  readonly atMs: number;
  /**
   * ★ M-5 (review Task 2) — SỐ NHỊP HỎNG LIÊN TIẾP kể từ lượt thành công gần nhất.
   *
   * ⚠ VÌ SAO CẦN: khi một nhịp NÉM, `lastTick` giữ nguyên bản cũ và `atMs` ĐỨNG YÊN. Task 5 đo được
   * TUỔI, nhưng "nhịp chưa tới hạn" và "nhịp đã hỏng 5 lần liên tiếp" có **tuổi giống nhau** mà mức
   * đáng tin khác hẳn: cái đầu sẽ tự lành, cái sau thì không. Không có ô này thì hai thứ đó không
   * phân biệt được — đúng lớp lỗi "hỏng im lặng" mà cả module tồn tại để diệt.
   * `0` = nhịp gần nhất chạy trót lọt.
   */
  readonly consecutiveFailures: number;
}
let lastTick: { readonly result: VramReconcileResult; readonly atMs: number } | null = null;

/**
 * ★ M-4 (review Task 2) — NEO BIÊN DỊCH cho lời hứa "khớp theo cấu trúc".
 *
 * `vramHeadroom.ts` CỐ Ý không `import type` từ file này (không kéo một module có I/O + trạng thái
 * toàn cục vào đường quyết định), nên nó chỉ *mô tả* hình dạng nó cần (`HeadroomTickFields`). Nếu
 * không có dòng dưới đây, một lượt đổi tên/đổi kiểu `attributableBytes` hay `baselineVerified` ở
 * file này sẽ **build XANH** và chỉ file test đỏ — đúng lớp "lời hứa chỉ nằm trong comment".
 * Neo đặt ở ĐÂY vì đây là phía **được phép** import cả hai. Thuần kiểu: `import type` bị xoá sạch
 * lúc biên dịch, không thêm một byte runtime nào.
 */
type __TickFieldsAnchor = VramReconcileResult extends HeadroomTickFields ? true : never;
const __tickFieldsAnchor: __TickFieldsAnchor = true;
void __tickFieldsAnchor;

/**
 * Đọc kết quả nhịp gần nhất. **ĐỒNG BỘ, không I/O, không tác dụng phụ** — gọi được từ trong
 * `reserve()`.
 *
 * `null` = **CHƯA có nhịp nào chạy trong tiến trình này** ⇒ người đọc PHẢI hiểu là **ĐANG MÙ**
 * (`"no-tick"`), TUYỆT ĐỐI không phải "thiết bị trống". Sau I-1 ca này còn đúng hai cửa: khoảng
 * thời gian ngắn giữa `startVramReconciler()` và lúc nhịp NGAY hoàn tất, và một tiến trình không
 * gọi `startVramReconciler()` bao giờ.
 *
 * ⚠ Trả về một BẢN GHI MỚI mỗi lượt, nhưng `result` bên trong là **cùng một tham chiếu** với ô đã
 * lưu. `VramReconcileResult` nay `readonly` toàn bộ (I-4) nên `tsc` chặn việc sửa tại chỗ — trước
 * đó kỷ luật này chỉ nằm trong comment, và "một kỷ luật chỉ tồn tại trong comment thì lần sau lại
 * có comment thứ ba" (`vramWiring.ts`).
 */
export function readLastReconcileTick(): VramTickRecord | null {
  if (lastTick === null) return null;
  // ⚠ Chuỗi hỏng đọc từ `vramTickCell` — MỘT bộ đếm duy nhất cho CÙNG một sự thật. Giữ một bản
  // thứ hai ở file này thì hai con số sẽ trôi khỏi nhau, và đường quyết định (đọc ô lá) sẽ tin
  // một con số khác với con số mà chẩn đoán in ra.
  return { result: lastTick.result, atMs: lastTick.atMs, consecutiveFailures: decisionTickFailureStreak() };
}

/**
 * Đúng một nhịp của bộ đếm giờ: THỬ LẠI lượt chụp nền (no-op khi đã có) rồi đối chiếu.
 * Tách ra để test canh được hành vi thử-lại mà không phải giả lập đồng hồ.
 *
 * ⚠⚠ Pha 2B Task 2 — CHỈ ĐƯỜNG NÀY XUẤT BẢN VÀO Ô TICK, **KHÔNG PHẢI `reconcileOnce()`**. Lý do
 * là ngữ nghĩa, không phải gọn gàng: `reconcileOnce()` gọi TRỰC TIẾP (test, công cụ chẩn đoán,
 * Task 7 của Pha 1.5) chạy với `baselineRequired === false` ⇒ nền = 0 ⇒ nó CỐ Ý so **số THÔ**, và
 * `attributable` của nó là "cả tấm card kể cả desktop". Xuất bản con số đó vào ô quyết định là để
 * một công cụ chẩn đoán LÁI đường cưỡng chế của sản xuất. Có ca test khoá việc này.
 *
 * ⚠ M-5 — nhịp NÉM thì **KHÔNG đè lên ô tick** (số cũ vẫn là số tốt nhất ta có) nhưng phải ĐẾM và
 * ném tiếp cho người gọi. Bộ đếm giờ tự nuốt (đã đếm rồi); người gọi trong test thấy nguyên lỗi.
 */
export async function __runReconcileTick(): Promise<VramReconcileResult> {
  try {
    /**
     * ★★★ Pha 3 Task 4 — **MỘT LƯỢT QUÉT CHO CẢ NHỊP**, và một CỔNG CHI PHÍ trước nó.
     *
     * ⚠ CHI PHÍ THẬT (đo ở Pha 2B, m-3): `nvidia-smi` **56-62 ms** + `powershell.exe`
     * (Win32_Process) **316-341 ms** ⇒ **≈380-400 ms** mỗi lượt quét, và lượt nhận nuôi cần THÊM
     * một bảng tiến trình (`readProcTable`, **316-341 ms**). Docstring `readGpuHolders()` hứa
     * *"chi phí này chỉ trả cho tới khi nền được XÁC MINH"* — cổng dưới đây là thứ giữ lời hứa đó:
     *   • nền CHƯA xác minh ⇒ đằng nào `captureVramBaseline()` cũng quét ⇒ **không thêm lượt nào**,
     *     chỉ chuyển chủ sở hữu lượt quét (nó nhận lại qua tham số);
     *   • ta ĐANG ĐỨNG TÊN một hộ mồ côi ⇒ **BẮT BUỘC** quét: đây là người canh cái chết duy nhất
     *     của hộ đó (nó không có `proc`, nên không có `"exit"` nào tới);
     *   • sổ chung có hàng của ai khác ⇒ có thể có **hàng MA** cần dọn;
     *   • còn lại (một tiến trình, nền đã xác minh, sổ chung im) ⇒ **KHÔNG quét** — chi phí y hệt
     *     trước Task 4.
     */
    const banSaoTruocNhip = readSharedLedgerReplica();
    const canQuet =
      !nenDaXacMinh() ||
      leaseNhanNuoi.size > 0 ||
      (banSaoTruocNhip !== null &&
        (banSaoTruocNhip.foreignLeases.length > 0 || banSaoTruocNhip.baseline !== null));
    const censusNhip = canQuet ? await readGpuHoldersSafe() : undefined;
    await chayLuotNhanNuoi(censusNhip);
    await captureVramBaseline(undefined, censusNhip);
    const result = await reconcileOnce();
    const atMs = Date.now();
    lastTick = { result, atMs };
    /**
     * ★★ Pha 2B Task 5 — XUẤT BẢN SANG Ô LÁ (`vramTickCell`). Đây là con đường DUY NHẤT mà một con
     * số của reconciler tới được đường cưỡng chế: `vramBroker`/`vramWiring` KHÔNG nhập file này
     * (vòng nhập + bề mặt mock — xem docstring `vramTickCell.ts`).
     * ⚠ Hai lệnh gán nằm CẠNH NHAU có chủ ý: chúng khai CÙNG một sự thật, và một ca test khoá việc
     * hai bên luôn khớp sau mỗi nhịp.
     */
    publishDecisionTick(result, atMs);
    return result;
  } catch (err) {
    const tickFailureStreak = noteDecisionTickFailure();
    console.warn(
      `[vram] NHỊP ĐỐI CHIẾU HỎNG (lần thứ ${tickFailureStreak} liên tiếp): ${(err as Error)?.message ?? String(err)}. ` +
        `Ô quyết định giữ số CŨ — tuổi của nó KHÔNG tăng theo nhịp hỏng, nên đọc \`consecutiveFailures\` ` +
        `chứ đừng chỉ nhìn \`atMs\`.`,
    );
    throw err;
  } finally {
    /**
     * ★★★ Pha 3 Task 2 — LÀM MỚI BẢN SAO ĐỌC CỦA SỔ CHUNG. Nhịp này là nguồn nuôi DUY NHẤT của
     * tuổi bản sao (**60 s = ĐỘ TRỄ CƯỠNG CHẾ THẬT xuyên tiến trình**).
     *
     * ⚠⚠ VỊ TRÍ LÀ MỘT ĐIỀU KIỆN, VÀ NÓ ĐƯỢC ĐO CHỨ KHÔNG PHẢI ĐOÁN. Bản đầu đặt lượt đồng bộ
     * **ĐẦU** hàm, và hậu quả xuất hiện ngay trong bộ test (2/3 lượt shuffle ĐỎ ở
     * `startVramReconciler — nhịp NGAY`): `syncSharedLedger()` phải `await getDb()`, tức **một
     * lượt mở kết nối Postgres đứng CHẶN TRƯỚC lượt chụp nền và đối chiếu**. Đó không phải một
     * trục trặc của test mà là một **liên đới có thật**: DB chậm/chết ⇒ nhịp đối chiếu chậm theo
     * ⇒ ô tick già đi ⇒ cưỡng chế tự chặt lại **vì một lý do chẳng liên quan gì tới VRAM**. Đúng
     * lớp lỗi "một cơ chế phòng vệ mới vô hiệu hoá cơ chế cũ" đã tái diễn ba lần ở Pha 1.5.
     *
     * ⇒ Đặt trong `finally` (chạy kể cả nhịp NÉM) và **KHÔNG `await`**: nhịp đối chiếu bắn lượt
     * đồng bộ rồi đi tiếp. Bản thứ hai vẫn `await` trong `finally`, và **vẫn chưa đủ** — đo được
     * 4/8 lượt shuffle ĐỎ ở `vramHeadroom.test.ts`: chừng nào lời hứa của nhịp còn treo theo một
     * vòng đi DB thì **thời lượng nhịp vẫn buộc vào độ trễ DB**, chỉ là buộc muộn hơn. Bắn-rồi-đi
     * cắt hẳn sợi dây đó: thời lượng `__runReconcileTick()` nay **độc lập tuyệt đối** với DB.
     *
     * ⚠ KHÔNG dồn đống: `syncSharedLedger()` có khoá chống chạy chồng (một lời hứa dùng chung), nên
     * một lượt đồng bộ chậm hơn 60 s chỉ làm nhịp sau **bỏ qua**, không xếp hàng.
     * ⚠ `syncSharedLedger()` **KHÔNG BAO GIỜ NÉM** (tự đếm + tự kêu); `.catch()` ở đây canh lượt
     * NHẬP module — một lời hứa bị bỏ rơi là `unhandledRejection`, giết tiến trình dưới
     * `--unhandled-rejections=strict`.
     * ⚠ Hệ quả cho người viết test: bản sao đọc được làm mới **BẤT ĐỒNG BỘ SAU** nhịp ⇒ đọc nó
     * ngay sau `await __runReconcileTick()` là một cuộc đua. Dùng `vi.waitFor` (ca W-5).
     */
    void import("./vramSharedLedgerStore")
      .then((m) => m.syncSharedLedger())
      .catch(() => {
        /* một lỗi sổ chung không được thay thế (hay đánh hỏng) kết quả của nhịp đối chiếu */
      });
  }
}

/** Chỉ dùng trong test. */
export function __resetVramBaselineForTests(): void {
  baselineUsedBytes = null;
  baselineCaptured = false;
  baselineRequired = false;
  // Pha 1.5 Task 1 — KHÔNG reset thì test sau KẾ THỪA thước của test trước, và một lượt chụp
  // nền mới (thước A) có thể bị hiểu nhầm là "đổi thước" ngay từ lượt đối chiếu đầu tiên.
  baselineSource = null;
  // Pha 1.5 Task 1, review vòng 1 (EXP-1) — cùng lý do: không reset thì test sau KẾ THỪA số lượt
  // resample liên tiếp của test trước, và bộ ngắt mạch có thể trip SAI ngay từ mismatch đầu tiên.
  consecutiveResampleCount = 0;
  // Pha 1.5 Task 1, review vòng 2 (MỚI-1) — cùng lý do: không reset thì test sau KẾ THỪA
  // `sameSourceStreak`/`lastObservedSource`, và lối thoát ngắt mạch có thể kích hoạt SAI (hoặc
  // trễ hơn thật) ngay từ những nhịp đầu của test kế tiếp.
  lastObservedSource = null;
  sameSourceStreak = 0;
  // Pha 1.5 Task 7 (T5-1) — cùng lý do: không reset thì test sau KẾ THỪA mốc hoãn của test
  // trước và nhánh báo động "không chụp được nền" có thể trip SAI ngay từ lượt hoãn đầu tiên.
  baselineBlockedSinceMs = null;
  baselineBlockedReason = null;
  // Pha 2B Task 1 — cùng lý do: không reset thì test sau KẾ THỪA "nền đã xác minh" của test trước,
  // và `attributableBytes` sẽ có số ở đúng những ca sinh ra để chứng minh nó KHÔNG được có số.
  lyDoNenKhongTinHienTai = Object.freeze(["chua-chup-nen" as const]);
  warnedUnverifiedBaseline = false;
  // Pha 2B Task 2 — cùng lý do, và ở đây hậu quả NẶNG HƠN: không xoá thì test sau thừa kế một
  // QUYẾT ĐỊNH CẤP PHÁT của test trước (dư địa tính từ một tick không còn liên quan gì).
  lastTick = null;
  // Pha 2B Task 5 — ô lá là NGUỒN của đường quyết định: không xoá thì test sau thừa kế một quyết
  // định cấp phát của test trước (dư địa tính từ một tick không còn liên quan gì).
  __resetDecisionTickForTests();
  // Pha 2B Task 2 (I-1) — cờ CHUÔNG cũng phải về mặc định: không reset thì một test bật
  // `ring: false` sẽ làm mọi test SAU nó mất hết sự kiện `drift`, và triệu chứng sẽ hiện ở một
  // file khác hẳn.
  ringEnabled = true;
  // Pha 3 Task 3 — cùng lý do, và ở đây hậu quả là NGƯỢC DẤU: ca sau thừa kế `baselineOrigin` của
  // ca trước ⇒ vế SỔ cộng (hoặc không cộng) `foreignBytes` theo một quyết định của ca khác ⇒ lệch
  // đúng bằng khối anh em, và triệu chứng hiện ra ở một phép so chẳng liên quan.
  baselineOrigin = "local";
  lastAdoptedFrom = null;
  warnedLocalBaseline = false;
  warnedUnpairedDrift = false;
  // Pha 3 Task 4 — cùng lý do, và ở đây hậu quả là một GIẤY PHÉP: ca sau thừa kế "ta đang đứng
  // tên pid X" của ca trước ⇒ hoặc nó thu hồi một giấy phép của ca khác, hoặc nó im lặng bỏ qua
  // đúng hộ mà ca đang kiểm. ⚠ KHÔNG `release()` ở đây — `__resetBrokerForTests()` dọn sổ, và một
  // lượt ghi sổ chung phát ra từ hàm reset là đúng thứ làm ca sau kế thừa một lệnh xoá lạ.
  leaseNhanNuoi.clear();
  pidTanDuDaCoChu = new Set<number>();
  // Pha 3 Task 5 — seam cửa thu hồi: để sót thì ca sau "thu hồi được" bằng cửa giả của ca trước.
  cuaThuHoiCuaTest = null;
  // ⚠ Ô "ta là người chụp nền" nằm ở module LÁ (`vramSharedLedger`) và có hàm reset RIÊNG
  // (`__resetSharedLedgerForTests`). KHÔNG gọi nó từ đây: file này không được kéo một lượt dọn
  // trạng thái của module khác vào, và bộ ca sổ chung đã gọi đúng hàm của nó.
}

/**
 * ★★ I-4 (review vòng 1, Pha 2A) — TÁCH TỔNG SỔ THEO THƯỚC ĐÃ ĐẺ RA TỪNG CON SỐ.
 *
 * VẤN ĐỀ NẰM Ở MỨC TỔNG HỢP, không ở từng điểm gọi: từ Pha 2A, `Σ leaseBytes` là một PHÉP CỘNG
 * TRỘN — vài giấy phép mang chênh lệch đo bằng **bộ đếm theo tiến trình**, vài giấy phép mang
 * **ước lượng**, và bản ghi cũ mang chênh lệch đo bằng **thiết bị**. `reconcileOnce()` đem tổng
 * đó so với **số TUYỆT ĐỐI của `nvidia-smi`**, dưới ngưỡng 512 MiB — **cùng bậc độ lớn** với
 * khoản lệch +505…+511 MiB giữa hai thước (Đ4). Trước hàm này không ai trả lời được câu "bao
 * nhiêu phần của sổ đến từ thước nào", nên khoản trộn là VÔ HÌNH.
 *
 * ⚠ HÀM NÀY KHÔNG SỬA GÌ và KHÔNG được dùng để sửa: Pha 2A KHÔNG đổi ngưỡng 512, KHÔNG đổi nhịp
 * 60 s, KHÔNG đổi công thức `drift` (ràng buộc toàn cục 3). Nó chỉ làm khoản trộn **ĐO ĐƯỢC** để
 * lượt sau có SỐ mà quyết thay vì đoán.
 *
 * ⚠ ĐẶT Ở ĐÂY, KHÔNG Ở `vramBroker`, CÓ LÝ DO CỤ THỂ: 43 bản giả `./vramBroker` trong
 * `vramReconciler.test.ts` chỉ khai đúng những export mà reconciler thật sự chạm. Thêm một export
 * MỚI vào broker rồi gọi nó vô điều kiện ở đây làm CẢ 43 bản giả vỡ ("No export is defined"),
 * tức bắt người sau phải sửa 43 chỗ mỗi lần reconciler cần thêm một hàm broker. Đặt ở đây và dựng
 * TRÊN `leaseBytes()` đã import: **không nhân bản công thức** (đúng cảnh báo M-1 của Task 4 —
 * hai bản cài đặt song song của cùng một công thức là lớp lỗi đã khiến `bench.mjs` sai bốn lần),
 * mà cũng không đẻ thêm bề mặt mock.
 *
 * Ba nhóm là một PHÂN HOẠCH: cộng lại đúng bằng `snapshot().totalReservedBytes`.
 */
export function splitLedgerByMeasureSource(leases: readonly VramLease[]): {
  processDeltaBytes: number;
  deviceDeltaBytes: number;
  estimatedBytes: number;
  totalBytes: number;
} {
  let processDeltaBytes = 0;
  let deviceDeltaBytes = 0;
  let estimatedBytes = 0;
  for (const l of leases) {
    const bytes = leaseBytes(l);
    // `actualBytes === null` ⇒ con số trong sổ là ƯỚC LƯỢNG, không thuộc thước nào.
    //
    // ⚠⚠ Pha 2A Task 4 (T5-15) — VẾ THỨ HAI LÀ BẮT BUỘC, KHÔNG PHẢI CHO ĐỦ: `commitFallback()`
    // điền `actualBytes` bằng một ƯỚC LƯỢNG DỰ PHÒNG (kèm `measureSource: "none"`), nên từ Task 4
    // trở đi "có số" KHÔNG còn đồng nghĩa "đo được". Phân loại chỉ theo `actualBytes` sẽ ném con
    // số đó vào nhánh `else` cuối và khai nó là **deviceDelta** — tức khai một ước lượng thành
    // "đo bằng nvidia-smi", đúng kiểu TRỘN THƯỚC mà Đ4/I-4 sinh ra để làm cho NHÌN THẤY ĐƯỢC.
    // Ba nhóm vẫn là một PHÂN HOẠCH (cộng lại đúng `totalReservedBytes`), chỉ ranh giới đổi.
    if (l.actualBytes === null || l.measureSource === "none") estimatedBytes += bytes;
    else if (l.measureSource === "process-delta") processDeltaBytes += bytes;
    else deviceDeltaBytes += bytes; // gồm cả bản ghi CŨ không khai nguồn (mặc định của commit())
  }
  return {
    processDeltaBytes,
    deviceDeltaBytes,
    estimatedBytes,
    totalBytes: processDeltaBytes + deviceDeltaBytes + estimatedBytes,
  };
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
  /**
   * Pha 1.5 Task 3 — CỬA SỔ CHƯA-COMMIT. Tính NGAY ở đầu hàm (không phụ thuộc device) vì
   * MỌI nhánh return bên dưới đều cần trả `pendingBytes` cho người gọi.
   *
   * ⚠⚠ LOẠI `measureFailed === true` — KHÔNG PHẢI tuỳ chọn:
   * `actualBytes === null` gộp CHUNG hai trạng thái trái ngược nhau (xem docstring
   * `VramLease.measureFailed`, types.ts): "đang cấp phát dở, số thật sắp tới" (tự lành trong
   * vài giây — ĐÂY mới là thứ Task 3 nới dung sai cho) và "đã ĐO, delta ÂM, ước lượng đứng
   * MÃI MÃI" (measureFailed=true — KHÔNG tự lành, đây chính là lệch ÂM DAI DẲNG mà nhánh cảnh
   * báo bên dưới sinh ra để BẮT). Gộp cả hai vào `pendingBytes` sẽ nới băng dung sai VĨNH VIỄN
   * theo đúng phần ước lượng đã bị đóng băng của lease đo-hỏng đó — tự tay bịt miệng chuông mà
   * `measure_failed` (vramWiring.ts) đã cố tình để lại dấu vết. `wiring.negativeDelta.test.ts`
   * ca 4 canh chính xác việc này: reranker ước lượng 606 MiB / thật 18 MiB, measureFailed=true
   * ⇒ PHẢI báo động "đo hỏng" — pendingBytes gộp lease đó sẽ tắt tiếng SAI ca đó.
   *
   * ⚠ "Lease không bao giờ commit thì băng dung sai treo bao lâu?" — review vòng 1 (Important-1)
   * chỉ ra CÂU TRẢ LỜI VÒNG ĐẦU thiếu một đường: `commitMeasured()` (vramWiring.ts) có BA
   * nhánh KHÔNG BAO GIỜ ghi `actualBytes`, không phải hai:
   *
   *   1. **Đo hỏng** (`actual < 0`) — `markMeasureFailed()` chạy NGAY LẬP TỨC, TRONG CÙNG lượt
   *      gọi phát hiện delta âm. Lease rơi khỏi `pendingBytes` chậm nhất ở nhịp
   *      `reconcileOnce()` KẾ TIẾP (≤ `INTERVAL_MS`, mặc định 60 giây).
   *   2. **Đầu dò trả `null`** (`beforeUsed === null` lúc tạo ticket, hoặc `after === null` lúc
   *      commit — dễ xảy ra nhất ĐÚNG LÚC GPU đang bận nạp model: `nvidia-smi` timeout 3s hoặc
   *      handle native chập chờn). Review vòng 1 phát hiện bản vá GỐC của Task 3 bỏ sót đường
   *      này — `vramWiring.ts` từng `return` CÂM ở cả hai nhánh, không gọi `markMeasureFailed()`.
   *      Đã vá: giờ cả hai nhánh cũng đánh dấu `measureFailed=true` NGAY LẬP TỨC, cùng tốc độ
   *      tự lành như đường 1 (≤ một nhịp `reconcileOnce()`), KHÔNG còn phải chờ tới `release()`.
   *      Xem `wiring.probeNull.test.ts` (4 test + đột biến) và docstring tại nhánh đó trong
   *      `vramWiring.ts` để biết ĐÁNH ĐỔI đã cân nhắc (báo động có thể giải thích được, đổi lấy
   *      không còn lỗ câm tới lúc unload/evict).
   *   3. **Tiến trình CHẾT HẲN trước khi `commitMeasured()` kịp chạy** (kill -9, mất điện) —
   *      KHÔNG đường nào trong hai đường trên chạm tới, vì không có code nào của TA được thực
   *      thi để đặt bất kỳ cờ nào. Lease đó vẫn `actualBytes: null, measureFailed: false`
   *      VĨNH VIỄN cho tới khi có người khởi động lại tiến trình (xoá sạch ledger trong bộ
   *      nhớ). `gguf-model` KHÔNG có `ttlMs`/reap như `external-process` (types.ts) nên Task 3
   *      KHÔNG tự chữa được ca này — nó thừa hưởng đúng rủi ro "giấy phép treo" đã biết, chỉ
   *      khác hệ quả cụ thể: băng dung sai phía ÂM nới rộng thêm đúng ước lượng của lease treo
   *      đó cho tới khi người vận hành can thiệp thủ công (hoặc một task tương lai thêm TTL
   *      cho kind `gguf-model`).
   *
   * Sau bản vá vòng 1, CHỈ CÒN đường 3 là "treo tới restart" — đường 1 và 2 đều tự lành trong
   * ≤ một nhịp `reconcileOnce()`.
   */
  // ⚠ Pha 1.5 Task 7 — vị từ nằm ở `isLoadingLease()` (đầu file), DÙNG CHUNG với lá chắn HOÃN
  // chụp nền. Đừng viết lại inline: hai tập đó phải luôn bằng nhau (lý do ở docstring hàm đó).
  const pendingBytes = snap.leases.filter(isLoadingLease).reduce((s, l) => s + l.request.estimatedBytes, 0);
  // ⚠ M-2 (review round 1, SỬA LẠI ở review TOÀN NHÁNH): lấy mẫu KHÔNG NGUYÊN TỬ.
  // `snapshot()` tức thời, còn `readDeviceVram()` thì KHÔNG — nhưng nguyên nhân đã bị ghi
  // SAI ở bản trước, sai cả hướng lẫn HAI BẬC ĐỘ LỚN:
  //
  //   • Bản trước viết "`readDeviceVram()` mất tới ~3 s". SAI: `~3 s` là **trần
  //     `timeout: 3000`** của `execFile`, không phải chi phí thường. Chính `vramProbe.ts:9-17`
  //     — file được trích dẫn — đã RÚT LẠI đúng câu đó: đo được **72-80 ms** (báo cáo §4:
  //     p50 **62,9 ms**), và khi `setLlamaInstanceHandle()` đã nối thì là `getVramState()`
  //     native ~0 ms. Trích dẫn một file để chống lưng cho điều mà chính file đó đã bác bỏ là
  //     cách nhanh nhất biến comment thành mìn.
  //   • CỬA SỔ LỆCH ÂM THẬT không phải ~3 s mà là **THỜI LƯỢNG NẠP MODEL: 11-43 s** (báo cáo
  //     §3.5). `reserve()` cộng `estimatedBytes` vào sổ ở `aiGgufEngine.ts:737`, còn
  //     `commitMeasured()` mãi `:802` — cả `llama.loadModel()` nằm giữa. Bất kỳ nhịp đối chiếu
  //     nào rơi vào khoảng đó đều thấy lệch ÂM tới hàng chục GiB (đo được **−16.335 MiB**).
  //     Nó tự lành ở nhịp kế, nhưng xác suất trúng không nhỏ như con số "3 s" gợi ý.
  //
  // Đây là TÍNH CHẤT THIẾT KẾ CỐ HỮU của phép so sổ-vs-thiết bị, không phải bug của đầu dò —
  // người trực đọc một `drift` âm lớn ngay sau một lượt nạp model nên nghi bóng ma TRƯỚC.
  // ⚠ Lệch âm DAI DẲNG (không tự lành sau một nhịp) thì NGƯỢC LẠI: đó là giấy phép "đo hỏng"
  // (I-2, xem nhánh cảnh báo bên dưới) hoặc giấy phép treo — hai thứ đó phải điều tra thật.
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
      baselineResampled: false,
      sourceUnstable: false,
      pendingBytes,
      baselineBlocked: false,
      // Không đọc được thiết bị ⇒ không có số tuyệt đối ⇒ không có `attributable`. Cưỡng chế
      // rơi về chỉ-sổ (ràng buộc 10), KHÔNG được coi thiết bị là trống.
      attributableBytes: null,
      baselineVerified: nenDaXacMinh(),
      baselineUnverifiedReasons: lyDoNenKhongTinHienTai,
      baselineOrigin,
      foreignLedgerBytes: null,
    };
  }

  // Pha 1.5 Task 1, review vòng 2 (MỚI-1) — cập nhật TRẠNG THÁI ỔN ĐỊNH TỰ THÂN của thước, MỖI
  // NHỊP, TRƯỚC mọi so sánh với `baselineSource`. Đây là dữ liệu duy nhất cho phép bộ ngắt mạch
  // thoát trạng thái "bất ổn" khi thước ổn định lại ở một giá trị KHÁC thước đã đóng băng lúc
  // trip — so với chính nhịp trước, không so với quá khứ đã đóng băng.
  if (device.source === lastObservedSource) {
    sameSourceStreak += 1;
  } else {
    sameSourceStreak = 1;
    lastObservedSource = device.source;
  }

  // Pha 1.5 Task 1 — MỘT THƯỚC DUY NHẤT. Nền được chụp bằng một thước (native ⇄ smi); nếu lượt
  // đối chiếu NÀY đến từ thước KHÁC, so trực tiếp là so hai thước với nhau — hai thước lệch
  // 165-178 MiB (báo cáo Pha 1 §3.4), ĐỦ MỘT MÌNH đẩy lệch qua ngưỡng 512 MiB và làm chuông kêu
  // MÃI MÃI dù không ai cấp phát chui. ĐỪNG cố "chụp nền muộn hơn cho tới khi handle gắn xong"
  // — đó là đua với thứ tự boot (đã tốn ba vòng sửa vì đúng lỗi này ở NEW-1/NEW-2 trên). Sửa
  // bằng cấu trúc: huỷ nền cũ, chụp lại bằng thước MỚI, và KHÔNG báo động ở lượt phát hiện — số
  // vừa bị huỷ không đáng tin để so.
  /**
   * ⚠⚠ Pha 3 Task 3 — **NỀN ĐÃ NHẬN (`"adopted"`) KHÔNG ĐI VÀO NHÁNH RESAMPLE.** Người ĐỌC không có
   * gì để chụp lại: `captureVramBaseline()` sẽ nhận lại đúng con số ấy với đúng thước ấy ⇒ mismatch
   * lặp ở MỌI nhịp ⇒ bộ ngắt mạch EXP-1 trip sau `SOURCE_UNSTABLE_THRESHOLD` lượt ⇒
   * `attributableBytes: null` **vĩnh viễn** = nhánh RỘNG NHẤT, vì một lý do (hai vai trò gắn handle
   * khác nhau) chẳng liên quan gì tới sự bất ổn của thước.
   * ⇒ Người đọc chịu đúng khoản lệch giữa hai thước (**165-178 MiB**, Pha 1 §3.4) và khai nó bằng
   * `baselineVerified: false` ở `nhanNenDungChung()`. Đánh đổi đã cân: 165-178 MiB có tên, đổi lấy
   * việc KHÔNG mở lại cửa 17 GB mà cả task này sinh ra để đóng.
   */
  if (baselineCaptured && baselineOrigin !== "adopted" && baselineSource !== null && device.source !== baselineSource) {
    // Pha 1.5 Task 1, review vòng 1 (EXP-1) — BỘ NGẮT MẠCH. Nếu thước DAO ĐỘNG (đổi liên tục mỗi
    // nhịp), nhánh resample phía dưới sẽ chạy MÃI — mọi nhịp huỷ nền rồi chụp lại, KHÔNG nhịp
    // nào từng đối chiếu được, và một khoản cấp phát chui tồn tại xuyên suốt sẽ KHÔNG BAO GIỜ lộ
    // ra: chuông CÂM VĨNH VIỄN mà không ai biết nó đang câm — tệ hơn một báo động giả. Quá
    // `SOURCE_UNSTABLE_THRESHOLD` lần resample LIÊN TIẾP thì NGỪNG resample, ĐÓNG BĂNG nền hiện
    // tại, và báo động về chính sự BẤT ỔN của thước — nội dung PHẢI khác "cấp phát chui" vì
    // nguyên nhân và hành động sửa hoàn toàn khác nhau (đi sửa đầu dò/handle, không phải đi tìm
    // hộ tiêu thụ).
    if (consecutiveResampleCount >= SOURCE_UNSTABLE_THRESHOLD) {
      // Pha 1.5 Task 1, review vòng 2 (MỚI-1) — LỐI THOÁT KHỎI NGẮT MẠCH.
      //
      // ⚠ VÌ SAO BẮT BUỘC: nhánh TRIP phía dưới đóng băng `baselineSource` và chỉ tự thoát khi
      // `device.source === baselineSource` (điều kiện đó nằm ở đầu khối `if` bao ngoài — xem
      // dòng so sánh mismatch). Nếu thước ổn định lại ở một giá trị KHÁC thước đóng băng (ca B,
      // vd. hai tiến trình cạnh tranh gắn handle rồi CHỐT ở nhánh thua — 50/50 nó khác thước đã
      // đóng băng), điều kiện đó KHÔNG BAO GIỜ đúng nữa ⇒ TRIP VĨNH VIỄN: `sourceUnstable=true,
      // driftBytes=null` mọi nhịp, dù thước đã hết dao động hoàn toàn từ lâu. Đây là hỏng im lặng
      // Y HỆT lớp lỗi mà bộ ngắt mạch sinh ra để diệt (EXP-1) — chỉ khác là ồn ào vô dụng thay vì
      // câm lặng.
      //
      // SỬA: đo ổn định bằng `sameSourceStreak` (thước không đổi qua ĐỦ SỐ NHỊP LIÊN TIẾP, tự so
      // với chính nó — xem khai báo ở đầu file), KHÔNG so với `baselineSource` đã đóng băng. Đạt
      // ngưỡng thì đây là BẰNG CHỨNG THẬT (không phải may mắn trùng một lượt đọc) rằng thước đã
      // định hình — RESAMPLE theo thước MỚI đó (dù khác thước đóng băng) rồi thoát ngắt mạch,
      // đúng cơ chế "một thước duy nhất" gốc của Task 1: không đối chiếu tiếp cho tới khi nền và
      // số liệu CÙNG một thước.
      if (sameSourceStreak >= SOURCE_UNSTABLE_THRESHOLD) {
        console.warn(
          `[vram] THƯỚC ĐÃ ỔN ĐỊNH LẠI ở "${device.source}" (khác thước đóng băng "${baselineSource}") ` +
            `sau ${sameSourceStreak} nhịp liên tiếp cùng giá trị — thoát ngắt mạch, chụp lại nền theo thước mới.`,
        );
        const priorSourceSnapshot = baselineSource;
        const priorUsedBytesSnapshot = baselineUsedBytes;
        baselineCaptured = false;
        baselineUsedBytes = null;
        baselineSource = null;
        await captureVramBaseline(
          priorUsedBytesSnapshot !== null && priorSourceSnapshot !== null
            ? { usedBytes: priorUsedBytesSnapshot, source: priorSourceSnapshot }
            : null,
        );
        consecutiveResampleCount = 0;
        return {
          driftBytes: null,
          alarm: false,
          ledgerTotalBytes: snap.totalReservedBytes,
          deviceUsedBytes: device.usedBytes,
          baselineUsedBytes,
          baselineResampled: true,
          sourceUnstable: false,
          pendingBytes,
          baselineBlocked: false,
          // Lượt RESAMPLE CỐ Ý không đối chiếu (số vừa bị huỷ không đáng tin để so) ⇒ cũng không
          // được xuất bản một `attributable` để ai đó đem đi quyết định cấp phát.
          attributableBytes: null,
          baselineVerified: nenDaXacMinh(),
          baselineUnverifiedReasons: lyDoNenKhongTinHienTai,
          baselineOrigin,
          foreignLedgerBytes: null,
        };
      }

      // I-1 — CHUÔNG, không phải phép đo: `sourceUnstable: true` vẫn được trả về bên dưới dù
      // `ring: false`. Xem docstring `startVramReconciler()`.
      if (ringEnabled) {
      console.warn(
        `[vram] THƯỚC ĐO KHÔNG ỔN ĐỊNH — đã đổi thước ≥ ${SOURCE_UNSTABLE_THRESHOLD} lần liên tiếp ` +
          `(nền đang đóng băng ở thước "${baselineSource}", lượt này đọc được "${device.source}"). ` +
          `DỪNG chụp lại để tránh im lặng vĩnh viễn — số so sánh KHÔNG ĐÁNG TIN cho tới khi thước ổn định. ` +
          `Đây là lỗi ĐO (đầu dò/handle chập chờn), KHÔNG PHẢI cấp phát chui.`,
      );
      logVramEvent({
        event: "source_unstable",
        owner: "reconciler",
        leaseKind: "external-process",
        priority: "background",
        deviceUsedBytes: device.usedBytes,
        ledgerTotalBytes: snap.totalReservedBytes,
        detail: {
          frozenSource: baselineSource,
          attemptedSource: device.source,
          consecutiveResampleCount,
          threshold: SOURCE_UNSTABLE_THRESHOLD,
          note:
            "Thước dao động liên tục ⇒ bộ ngắt mạch dừng resample để tránh chuông câm vĩnh viễn " +
            "(EXP-1). Số so sánh hiện KHÔNG đáng tin — điều tra đầu dò/handle, không phải đi tìm " +
            "hộ tiêu thụ chui.",
        },
      });
      }
      return {
        driftBytes: null,
        alarm: true,
        ledgerTotalBytes: snap.totalReservedBytes,
        deviceUsedBytes: device.usedBytes,
        baselineUsedBytes,
        baselineResampled: false,
        sourceUnstable: true,
        pendingBytes,
        baselineBlocked: false,
        // Thước dao động ⇒ số so sánh KHÔNG đáng tin (chính câu cảnh báo ngay trên nói vậy) ⇒
        // càng không được đem đi quyết định cấp phát.
        attributableBytes: null,
        baselineVerified: nenDaXacMinh(),
        baselineUnverifiedReasons: lyDoNenKhongTinHienTai,
        baselineOrigin,
        foreignLedgerBytes: null,
      };
    }

    console.warn(
      `[vram] ĐỔI THƯỚC ${baselineSource} → ${device.source} — huỷ nền cũ và chụp lại, ` +
        `không so hai thước với nhau.`,
    );
    // Pha 1.5 Task 1, review vòng 1 (EXP-2) — GIỚI HẠN ĐÃ BIẾT, CHẤP NHẬN Ở PHA 1.5, cùng lớp
    // với ca "sidecar sống khi restart" đã ghi ở `captureVramBaseline()` phía trên: một cấp phát
    // chui xuất hiện ĐÚNG LÚC đổi thước sẽ bị NUỐT VÀO NỀN MỚI và KHÔNG nhịp nào sau bắt được —
    // `alarm: false` ở lượt phát hiện đổi thước là ĐÚNG THIẾT KẾ (số vừa huỷ không đáng tin để so
    // trực tiếp), nhưng hệ quả là kẻ chui đó biến mất vào nền như thể nó luôn ở đó. Cửa sổ rủi ro
    // này NHÂN ĐÔI so với ca sidecar-restart (vốn chỉ một lần lúc boot): nay còn mở lại mỗi lần
    // đổi thước. Pha 1.5 CHẤP NHẬN đánh đổi này một cách TƯỜNG MINH — không có cách nào phân biệt
    // "đổi thước sạch" với "đổi thước đúng lúc có kẻ chui" chỉ từ MỘT lượt đọc — nhưng KHÔNG được
    // để dấu vết biến mất: nền CŨ + "drift nếu không huỷ" được ghi vào sự kiện `baseline` bên
    // dưới, để điều tra SAU vẫn còn dữ liệu để truy ngược (không sống lại được nền đã mất, nhưng
    // ít nhất biết ĐÃ MẤT gì).
    const priorSourceSnapshot = baselineSource;
    const priorUsedBytesSnapshot = baselineUsedBytes;
    baselineCaptured = false;
    baselineUsedBytes = null;
    baselineSource = null;
    await captureVramBaseline(
      priorUsedBytesSnapshot !== null && priorSourceSnapshot !== null
        ? { usedBytes: priorUsedBytesSnapshot, source: priorSourceSnapshot }
        : null,
    );
    consecutiveResampleCount += 1;
    return {
      driftBytes: null,
      alarm: false,
      ledgerTotalBytes: snap.totalReservedBytes,
      deviceUsedBytes: device.usedBytes,
      baselineUsedBytes,
      baselineResampled: true,
      sourceUnstable: false,
      pendingBytes,
      baselineBlocked: false,
      // Cùng lý do với nhánh resample ở trên: lượt này CỐ Ý không đối chiếu.
      attributableBytes: null,
      baselineVerified: nenDaXacMinh(),
      baselineUnverifiedReasons: lyDoNenKhongTinHienTai,
      baselineOrigin,
      foreignLedgerBytes: null,
    };
  }

  // Pha 1.5 Task 1, review vòng 1 (EXP-1) — nhịp này KHÔNG mismatch (đối chiếu bình thường) ⇒
  // thước đã ỔN ĐỊNH lại. Reset bộ đếm resample-liên-tiếp — một đợt dao động rồi ổn định lại
  // không được coi là "hỏng vĩnh viễn". (Lượt ngắt mạch TRIP ở nhánh trên KHÔNG chạy tới đây vì
  // nó `return` sớm — count chỉ reset khi thước THẬT SỰ ổn định, không phải mỗi khi ngừng resample.)
  consecutiveResampleCount = 0;

  // NEW-2 — reconciler ĐANG CHẠY mà CHƯA BIẾT nền ⇒ IM LẶNG. "Chưa biết" TUYỆT ĐỐI không được
  // hiểu thành "nền = 0": hiểu vậy thì toàn bộ ~1 GB nền của máy bị báo là cấp phát chui, mỗi
  // 60 giây. Thà không báo còn hơn báo sai. Trạng thái này là TẠM — `__runReconcileTick()` thử
  // chụp lại ở mỗi nhịp, nên đầu dò hồi phục là nền tự lành.
  if (baselineRequired && baselineUsedBytes === null) {
    /**
     * ⚠⚠ Pha 1.5 Task 7 (T5-1) — IM LẶNG PHẢI CÓ HẠN. Trạng thái này trả `alarm: false` (đúng:
     * thà không báo còn hơn báo sai), nhưng "tạm thời" ở trên là một GIẢ ĐỊNH, và Task 7 vừa
     * thêm một nguồn hoãn MỚI (còn giấy phép đang nạp ⇒ `captureVramBaseline()` từ chối). Nếu
     * nguồn hoãn đó không bao giờ hết — ca "tiến trình chết hẳn giữa reserve() và
     * commitMeasured()", đường 3 ở docstring `pendingBytes` — thì đây là chuông CÂM VĨNH VIỄN mà
     * KHÔNG AI BIẾT nó đang câm: ĐÚNG lớp lỗi EXP-1 đã phải dựng ngắt mạch để diệt, và đúng lỗi
     * mà chính bản vá này sinh ra ở hệ quả của nó nếu không đóng lại ở đây.
     *
     * ⇒ Quá `BASELINE_BLOCKED_ALARM_MS` (mặc định 5 phút — dài hơn MỌI cửa sổ nạp hợp lệ đo
     * được, xem khai báo) thì KÊU, và câu cảnh báo phải chỉ ĐÍCH DANH giấy phép đang chặn. Câu
     * này CỐ Ý không dùng chữ "cấp phát KHÔNG XIN PHÉP": nguyên nhân là sổ/đo, hành động sửa là
     * đi xem giấy phép treo — không phải đi tìm hộ tiêu thụ lạ.
     *
     * ⚠ "Nhánh mới này kích hoạt SAI thì bao lâu tự lành?" — ĐÚNG MỘT NHỊP: mốc hoãn bị xoá
     * ngay tại lượt `captureVramBaseline()` thành công đầu tiên, và `__runReconcileTick()` thử
     * chụp lại ở MỌI nhịp. Không có trạng thái đóng băng nào ở đây (khác `baselineCaptured`).
     */
    const blockedForMs = baselineBlockedSinceMs === null ? 0 : Date.now() - baselineBlockedSinceMs;
    const blocked = baselineBlockedSinceMs !== null && blockedForMs >= BASELINE_BLOCKED_ALARM_MS;
    // I-1 — CHUÔNG. `baselineBlocked` vẫn đi ra trong kết quả khi `ring: false`.
    if (blocked && ringEnabled) {
      // ⚠ CÙNG vị từ với lá chắn HOÃN (`holdsUncommittedBytes`), KHÔNG phải `isLoadingLease` —
      // nếu lệch, câu báo động sẽ liệt kê một danh sách KHÁC với tập đang thật sự chặn, và người
      // trực đi tìm đúng cái tên KHÔNG có trong đó (ca điển hình: lease đo-hỏng đang chặn).
      const blockingOwners = snap.leases.filter(holdsUncommittedBytes).map((l) => l.request.owner);
      // Hai NGUYÊN NHÂN, hai HÀNH ĐỘNG SỬA khác nhau — gộp một câu là bắt người trực đoán.
      // ⚠ Pha 2B Task 1, review vòng 1 (I-1): tàn dư giữ GPU KHÔNG còn là một lối vào nhánh này —
      // nó không chặn nền nữa mà chỉ đánh dấu `unverified`. Cả hai nguyên nhân còn lại đều là lỗi
      // SỔ/ĐO, nên câu kết dùng chung vẫn đúng.
      const why =
        baselineBlockedReason === "device-below-committed"
          ? `Sổ CỤC BỘ đang cộng dồn NHIỀU HƠN thứ thật sự nằm trên thiết bị (lá chắn "thiết bị < đã commit" ` +
            `chặn mọi lượt chụp) — đi soi các số commitMeasured() gần đây, chúng đang cộng trùng.`
          : // ★ Task 3 — lối thứ BA phải có CÂU RIÊNG: thủ phạm nằm ở tiến trình KHÁC, nên câu của
            // `device-below-committed` sẽ chỉ người trực đi soi nhầm cuốn sổ.
            baselineBlockedReason === "device-below-shared"
            ? `SỔ CHUNG (\`vram_leases\`) đang khai NHIỀU HƠN thứ nằm trên thiết bị — sổ cục bộ của tiến trình ` +
              `này có thể hoàn toàn đúng. Điển hình: HÀNG MA của một tiến trình bị kill -9. Soi bảng ` +
              `\`vram_leases\` theo \`processKey\`/\`updatedAt\`, KHÔNG soi commitMeasured() của tiến trình này.`
            : `Giấy phép ở trạng thái ĐANG NẠP quá lâu (${blockingOwners.join(", ") || "(không rõ)"}) = tiến trình ` +
              `chết giữa chừng hoặc commit không bao giờ tới — đi xem giấy phép treo.`;
      console.warn(
        `[vram] KHÔNG CHỤP ĐƯỢC NỀN suốt ${Math.round(blockedForMs / 1000)} giây — phép đối chiếu đang MÙ ` +
          `(không có nền thì mọi con số lệch đều vô nghĩa). ${why} ` +
          `Đây là lỗi SỔ/ĐO, KHÔNG PHẢI đi tìm hộ tiêu thụ lạ.`,
      );
      logVramEvent({
        event: "baseline_blocked",
        owner: "reconciler",
        leaseKind: "external-process",
        priority: "background",
        deviceUsedBytes: device.usedBytes,
        ledgerTotalBytes: snap.totalReservedBytes,
        detail: {
          blockedForMs,
          thresholdMs: BASELINE_BLOCKED_ALARM_MS,
          reason: baselineBlockedReason,
          blockingOwners,
          pendingBytes,
          note:
            "Nền chưa chụp được quá lâu (T5-1) ⇒ reconciler MÙ. Nguyên nhân nằm ở giấy phép kẹt " +
            "trạng thái đang-nạp, KHÔNG phải cấp phát chui. Tự lành ngay ở lượt chụp nền thành công.",
        },
      });
    }
    return {
      driftBytes: null,
      alarm: blocked,
      ledgerTotalBytes: snap.totalReservedBytes,
      deviceUsedBytes: device.usedBytes,
      baselineUsedBytes: null,
      baselineResampled: false,
      sourceUnstable: false,
      pendingBytes,
      baselineBlocked: blocked,
      // Chưa có nền ⇒ KHÔNG tính được `attributable`. Đây là nhánh "đang chạy mù" tường minh nhất
      // của cả hàm (ràng buộc 10).
      attributableBytes: null,
      baselineVerified: nenDaXacMinh(),
      baselineUnverifiedReasons: lyDoNenKhongTinHienTai,
      baselineOrigin,
      foreignLedgerBytes: null,
    };
  }

  // I-1 — TRỪ NỀN. `attributable` = phần VRAM QUY ĐƯỢC cho tiến trình này; chỉ phần đó mới có
  // quyền được đem so với sổ. Người gọi `reconcileOnce()` TRỰC TIẾP mà chưa chụp nền (Task 7,
  // test, công cụ chẩn đoán) ⇒ nền = 0 ⇒ so số THÔ, đúng như họ yêu cầu.
  const baseline = baselineUsedBytes ?? 0;
  const attributable = device.usedBytes - baseline;

  /**
   * ★★★ Pha 3 Task 3 (N-WB-1) — **VẾ SỔ. ĐỌC CÙNG LÚC VỚI VẾ NỀN Ở `captureVramBaseline()`.**
   *
   * Task 2 CỐ Ý không cộng `foreignBytes` ở đây, và lý do của nó vẫn nguyên giá trị: nền hôm đó ĐÃ
   * NUỐT byte anh em, nên cộng thêm là **TRỪ HAI LẦN** (lệch âm giả ~17 GB). Task 3 sửa vế NỀN, nên
   * vế SỔ phải đổi **TRONG CÙNG MỘT LƯỢT** — hai vế được ghép bằng `nenDaTruAnhEm()`, một vị từ,
   * một bản cài đặt:
   *
   *     nền `"local"`               ⇒ cộng 0        ⇒ y hệt Pha 2B (đúng, vì nền đã nuốt)
   *     nền `"captured"`/`"adopted"` ⇒ cộng foreign  ⇒ drift ≈ 0 ở trạng thái ổn định
   *
   * ⚠⚠ **`?? 0` LÀ MỘT DÂY, VÀ ĐÂY LÀ LƯỚI CỦA NÓ**: nếu nền đã trừ anh em mà sổ chung KHÔNG đọc
   * được, một `?? 0` im lặng sẽ cho `drift = +foreignBytes` ≈ **+17 GB**, và nhánh `drift > 0` gọi
   * đó là *"cấp phát KHÔNG XIN PHÉP"* — tức **quy trách nhiệm SAI cho một hộ hợp lệ**, đúng nợ mà
   * task này trả. ⇒ Trạng thái đó KHÔNG được đoán: lượt này **không so được**, `driftBytes: null`,
   * `alarm: false`, và **CÓ TIẾNG**. (`attributableBytes` vẫn được xuất bản: cưỡng chế có đường xử
   * lý riêng cho sổ chung vắng mặt — `"shared-ledger-unasked"`, 2 đơn vị.)
   */
  const soChung = sharedLedgerFact(Date.now());
  const byteAnhEmSo: number | null = nenDaTruAnhEm() ? (soChung === null ? null : soChung.foreignBytes) : 0;
  if (byteAnhEmSo === null) {
    if (!warnedUnpairedDrift) {
      warnedUnpairedDrift = true;
      console.warn(
        `[vram] KHÔNG SO ĐƯỢC SỔ VỚI THIẾT BỊ ở lượt này: nền hiện tại (chế độ "${baselineOrigin}") đã TRỪ ` +
          `byte của anh em, nhưng bản sao sổ chung đang KHÔNG đọc được ⇒ vế sổ thiếu đúng khối đó. So bừa ` +
          `sẽ cho một khoản LỆCH DƯƠNG bằng cả khối anh em và đổ oan cho "cấp phát chui". Bỏ qua lượt đối ` +
          `chiếu này (KHÔNG bỏ qua cưỡng chế — nó có đường xử lý riêng). Kiểm DB và bảng \`vram_leases\`.`,
      );
    }
    return {
      driftBytes: null,
      alarm: false,
      ledgerTotalBytes: snap.totalReservedBytes,
      deviceUsedBytes: device.usedBytes,
      baselineUsedBytes,
      baselineResampled: false,
      sourceUnstable: false,
      pendingBytes,
      baselineBlocked: false,
      attributableBytes: baselineUsedBytes !== null ? attributable : null,
      baselineVerified: nenDaXacMinh(),
      baselineUnverifiedReasons: lyDoNenKhongTinHienTai,
      baselineOrigin,
      foreignLedgerBytes: null,
    };
  }
  warnedUnpairedDrift = false;
  const drift = attributable - (snap.totalReservedBytes + byteAnhEmSo);
  /**
   * Pha 1.5 Task 3 — BĂNG DUNG SAI CHỈ MỘT PHÍA (ÂM). `snap.totalReservedBytes` đã cộng ƯỚC
   * LƯỢNG của MỌI giấy phép pending ngay từ `reserve()` (`vramBroker.leaseBytes`), nên trong
   * suốt cửa sổ nạp model, `drift` càng ÂM SÂU khi vật lý càng chưa theo kịp sổ — đúng nguồn
   * −16.335 MiB đo được ở Pha 1. `pendingBytes` (tính ở đầu hàm) là phần được PHÉP thiếu hụt
   * chính đáng đó, nên chỉ nới NGƯỠNG PHÍA ÂM (`drift < -(NGƯỠNG + pendingBytes)`).
   *
   * PHÍA DƯƠNG GIỮ NGUYÊN NGƯỠNG CHẶT — đây KHÔNG phải bỏ sót mà là CHỦ Ý: sổ đã "đặt cọc"
   * TOÀN BỘ ước lượng của lease pending rồi, nên vật lý của CHÍNH lease đó không bao giờ vượt
   * quá phần đã đặt cọc (trừ khi ước lượng sai — chuyện khác, Pha 2 xử). Bất kỳ phần dương nào
   * vượt `snap.totalReservedBytes + NGƯỠNG` — bất kể lease pending đã lên VRAM được bao nhiêu
   * phần trăm — CHỈ có thể đến từ một nguồn KHÔNG nằm trong sổ, tức kẻ cấp phát chui. Nới nốt
   * phía dương (đổi thành `drift > NGƯỠNG + pendingBytes`) sẽ cho một kẻ chui xuất hiện ĐÚNG
   * LÚC hệ đang nạp model — tức đúng lúc `pendingBytes` lớn nhất — chỗ ẩn nấp rộng nhất trong
   * toàn hệ, đúng cái mà module này sinh ra để bắt.
   */
  const alarm = drift > DRIFT_THRESHOLD_BYTES || drift < -(DRIFT_THRESHOLD_BYTES + pendingBytes);

  // I-1 — CHUÔNG. `alarm`/`driftBytes` vẫn đi ra trong kết quả (và vào ô tick) khi `ring: false`;
  // chỉ CÂU NÓI bị tắt, vì một tiến trình có sổ RIÊNG không đủ dữ kiện để nói đúng.
  if (alarm && ringEnabled) {
    const mib = (b: number) => Math.round(b / 1024 / 1024);
    const holders = () => snap.leases.map((l) => `${l.request.owner}=${mib(leaseBytes(l))}`).join(", ") || "(sổ rỗng)";
    // Luôn nói rõ đã trừ bao nhiêu — người trực phải kiểm chứng được con số, không phải tin.
    const baseNote = baseline > 0 ? ` (đã trừ nền ${mib(baseline)} MiB)` : "";
    /**
     * ★★★ Pha 3 Task 3 — CÂU NÀY QUYẾT ĐỊNH NGƯỜI TRỰC ĐI TÌM AI, nên nó phải khai chế độ nền.
     * Ở chế độ `"local"` khoản lệch dương **vẫn có thể là của anh em**; ở chế độ chung thì byte anh
     * em đã nằm trong vế sổ, nên lệch dương mới thật sự là "ngoài mọi cuốn sổ".
     */
    const soNote =
      byteAnhEmSo > 0
        ? ` (đã cộng ${mib(byteAnhEmSo)} MiB của anh em từ sổ chung)`
        : nenDaTruAnhEm()
          ? " (sổ chung đọc được, anh em đang giữ 0)"
          : " (⚠ CHƯA có sổ chung: nền đã nuốt byte anh em ⇒ khoản lệch này VẪN có thể là của họ)";

    if (drift > 0) {
      console.warn(
        `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}${soNote}, thiết bị ${mib(attributable)}${baseNote}. ` +
          `${nenDaTruAnhEm() ? "Byte của tiến trình anh em ĐÃ được tính vào vế sổ ⇒ khoản này nằm NGOÀI mọi cuốn sổ: h" : "H"}` +
          `ộ tiêu thụ cấp phát KHÔNG XIN PHÉP (sidecar? tiến trình con? thư viện khác?). ` +
          `Đang giữ: ${holders()}${describeTopologyHint()}`,
      );
    } else {
      // ⚠ I-2 — TÁCH HAI NHÓM. Trước đây cả hai bị gộp vào "chưa commit", và người trực ngồi
      // đợi một lượt commit KHÔNG BAO GIỜ TỚI cho nhóm thứ hai.
      //   • "chưa commit"  = đang cấp phát dở. TỰ LÀNH sau vài giây → chờ một nhịp là đúng.
      //   • "ĐO HỎNG"      = đã đo, delta âm, ước lượng đứng MÃI MÃI. KHÔNG tự lành → phải sửa
      //                      (bỏ nạp lại hộ đó, hoặc đợi Pha 2 dùng Σ actualBytes).
      const pending = snap.leases.filter(isLoadingLease).map((l) => l.request.owner);
      const failed = snap.leases.filter((l) => l.measureFailed).map((l) => l.request.owner);
      const failedNote = failed.length
        ? `⚠ ĐO HỎNG (ước lượng KHÔNG xác minh được, KHÔNG tự lành): ${failed.join(", ")}. `
        : "";
      console.warn(
        `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}${soNote}, thiết bị ${mib(attributable)}${baseNote}. ` +
          `Sổ đang giữ NHIỀU HƠN thực tế — giấy phép treo, đo hỏng, hoặc số commit sai, KHÔNG PHẢI cấp phát chui. ` +
          `${byteAnhEmSo > 0 ? "⚠ Một phần vế sổ là của ANH EM: hàng MA của một tiến trình đã chết cũng cho đúng hình dạng này. " : ""}` +
          `${failedNote}Ứng viên số một (chưa commit): ${pending.join(", ") || "(không có)"}. Đang giữ: ${holders()}`,
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
        // ★★★ Task 3 — HAI Ô DỰNG LẠI ĐƯỢC PHÉP SO: vế sổ nay là `ledgerTotalBytes + foreignLedgerBytes`.
        // Thiếu chúng thì `driftBytes` không kiểm chứng được từ nhật ký, và một lượt đọc lại sẽ tính
        // ra một con số khác rồi kết luận mã sai.
        foreignLedgerBytes: byteAnhEmSo,
        baselineOrigin,
        // Pha 1.5 Task 3 — phần băng dung sai ÂM đã được nới cho lượt này; đọc nhật ký là biết
        // NGAY ngưỡng thực tế đã áp dụng là bao nhiêu, không phải đoán từ danh sách leases.
        pendingBytes,
        /**
         * ★★ I-4 (review vòng 1, Pha 2A) — TRỘN THƯỚC Ở MỨC TỔNG HỢP, nay ĐO ĐƯỢC.
         *
         * `driftBytes` so `ledgerTotalBytes` (một phép cộng TRỘN: chênh lệch từ bộ đếm theo tiến
         * trình + chênh lệch từ thiết bị ở bản ghi cũ + ước lượng) với `deviceUsedBytes` (số
         * TUYỆT ĐỐI của `nvidia-smi`/`getVramState`), dưới ngưỡng 512 MiB — CÙNG BẬC ĐỘ LỚN với
         * khoản lệch +505…+511 MiB giữa hai thước. Trước trường này, không cách nào biết bao
         * nhiêu phần của sổ đến từ thước nào.
         *
         * ⚠ KHÔNG đổi ngưỡng, KHÔNG đổi nhịp, KHÔNG đổi công thức `drift` (ràng buộc toàn cục 3;
         * Pha 2A không đổi hành vi). Đây THUẦN TUÝ là dữ liệu để lượt sau có số mà quyết. Ba
         * nhóm cộng lại đúng bằng `ledgerTotalBytes` — lệch là có người đổi `leaseBytes()`.
         */
        measureSourceSplit: splitLedgerByMeasureSource(snap.leases),
        leases: snap.leases.map((l) => ({
          owner: l.request.owner,
          kind: l.request.kind,
          priority: l.request.priority,
          bytes: leaseBytes(l),
          committed: l.actualBytes !== null,
          // ⚠ Pha 2A Task 4 (T5-15) — `committed: true` KHÔNG còn đủ để kết luận "đã đo được":
          // một ước lượng dự phòng cũng điền `actualBytes`. Trường này là thứ phân biệt được hai
          // thứ đó khi đọc lại nhật ký, thay vì phải suy từ `measureSource` (dễ đọc nhầm là
          // "chưa khai nguồn"). `null` = KHÔNG phải dự phòng — đúng cho mọi bản ghi trước Task 4.
          // Ghi thẳng LÝ DO (không phải một cờ boolean): cùng độ dễ truy vấn
          // (`detail->'leases' @> '[{"fallbackReason":"measure-target-absent"}]'`) nhưng nói được
          // NHÁNH nào đã đẻ ra nó — dữ liệu Task 5/Pha 2B cần để biết cửa nào đang mở rộng nhất.
          fallbackReason: l.fallbackReason ?? null,
          // I-2 — "chưa commit" và "đo hỏng" trông giống nhau trong ảnh chụp nếu chỉ có cờ
          // `committed`. Ghi riêng để đọc lại nhật ký là phân biệt được tạm thời vs vĩnh viễn.
          measureFailed: l.measureFailed === true,
          // I-4 — THƯỚC của từng con số, không chỉ của tổng: có nó mới truy được giấy phép NÀO
          // đang đóng góp phần lệch giữa hai thước, thay vì chỉ biết "tổng có trộn".
          measureSource: l.measureSource ?? null,
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
    baselineResampled: false,
    sourceUnstable: false,
    pendingBytes,
    baselineBlocked: false,
    /**
     * ★★★ Pha 2B Task 1 — CHỖ DUY NHẤT `attributable` ĐƯỢC XUẤT BẢN CHO NGƯỜI QUYẾT ĐỊNH.
     *
     * MỘT điều kiện duy nhất: **có nền thật để trừ**. (`baseline = ?? 0` ở trên là ngữ nghĩa của
     * người gọi TRỰC TIẾP muốn so số THÔ; nó KHÔNG được biến thành một `attributable` hợp lệ, vì
     * "nền = 0" là một GIẢ ĐỊNH chứ không phải một phép đo.)
     *
     * ⚠⚠ KHÔNG thêm `&& baselineVerified` vào đây — bản đầu của task này đã làm vậy và review
     * vòng 1 (I-1) bác bỏ bằng số học: `max(L, A) ≥ L` ⇒ `null` (chỉ-sổ) là **CHẶN TRÊN** của mọi
     * headroom, nên vứt một `A` nhiễm đi là **NỚI** dư địa đúng lúc ta vừa phát hiện có kẻ lạ.
     * Trạng thái chưa xác minh đi ra bằng cờ `baselineVerified` ngay dưới.
     */
    attributableBytes: baselineUsedBytes !== null ? attributable : null,
    baselineVerified: nenDaXacMinh(),
    baselineUnverifiedReasons: lyDoNenKhongTinHienTai,
    baselineOrigin,
    // ★ Task 3 — con số ĐÃ THẬT SỰ cộng vào vế sổ ở lượt này. `0` ở chế độ `"local"` là CỐ Ý (nền
    // đã nuốt byte anh em), KHÔNG phải "anh em không giữ gì" — `baselineOrigin` ngay trên phân biệt.
    foreignLedgerBytes: byteAnhEmSo,
  };
}

/**
 * ★★ I-1 (review Task 2) — BẬT ĐỐI CHIẾU. Nay có HAI công tắc, và **tách chúng ra là mấu chốt**.
 *
 * @param opts.ring — có ĐÁNH CHUÔNG không (`console.warn` + sự kiện `drift`/`baseline_blocked`/
 *   `source_unstable`). Mặc định **true** = hành vi cũ y nguyên.
 *
 * ⚠⚠ VÌ SAO PHẢI TÁCH "CHẠY NHỊP" KHỎI "ĐÁNH CHUÔNG": lý do cấm chạy đối chiếu ở `api`
 * (`index.ts`, Pha 1.5 Task 4) nguyên văn là *"hai tiến trình cùng đối chiếu trên MỘT thiết bị sẽ
 * thấy nhau là cấp phát chui — biến chuông thành nhiễu"*. Lý do đó nói về **CHUÔNG**, mà §5.6c
 * **cấm thừa kế tham số chuông** (ràng buộc 8) và tiêu thụ `attributable` như một **SỐ**. ⇒ Phản
 * đối cũ **không áp** cho đường quyết định. Gộp hai cờ lại thì hoặc `api` mù vĩnh viễn (cưỡng chế
 * chạy trên nhánh RỘNG NHẤT ở đúng tiến trình có mọi điểm cấp phát), hoặc chuông kêu oan mỗi 60 s
 * ở cả hai tiến trình. Tách ra thì được cả hai.
 * ⚠ `ring: false` KHÔNG tắt phát hiện: `alarm`/`driftBytes` vẫn nằm nguyên trong kết quả và vẫn
 * vào ô tick. Nó chỉ tắt phần **TUYÊN BỐ** — thứ mà một tiến trình có sổ RIÊNG không đủ dữ kiện để
 * nói đúng (sổ chung là Pha 3).
 *
 * ⚠⚠ CHẠY MỘT NHỊP NGAY, không chỉ `setInterval`: bản trước chỉ đặt bộ đếm giờ ⇒ nhịp đầu rơi vào
 * **T+60 s** ⇒ `readLastReconcileTick()` trả `null` suốt 60 giây đầu ở **MỌI vai trò**, mà 60 giây
 * đó là đúng lúc `warmUpOllamaModels()` và model 30B **17 GB** lên card. Cửa sổ mù phủ trọn **đợt
 * cấp phát lớn nhất của cả vòng đời tiến trình**. Nhịp NGAY rút cửa sổ đó xuống còn đúng thời gian
 * chụp nền + một lượt đọc đầu dò.
 */
export function startVramReconciler(opts: { ring?: boolean } = {}): void {
  if (timer) return;
  ringEnabled = opts.ring !== false;
  /**
   * ★★ Pha 3 Task 2 — BẬT lượt đồng bộ sổ chung TỰ ĐỘNG (nhịp hẹn sau mỗi lượt ghi cục bộ). Đặt ở
   * đây vì đây là **đường boot của sản xuất** (`server/_core/index.ts`, TRƯỚC nhánh rẽ `ROLE` ⇒
   * mọi vai trò đều bật). Không có nó thì mọi file test chạm `reserve()` sẽ đẻ một bộ đếm giờ tự
   * đi mở kết nối DB test — GOTCHA `aiGateway` đã đo được ở Đợt trước.
   * ⚠ Nhập MUỘN + nuốt lỗi: một module sổ chung hỏng không được chặn lượt bật đối chiếu.
   */
  void import("./vramSharedLedgerStore")
    .then((m) => m.enableSharedLedgerSync(true))
    .catch(() => {});
  // Từ đây trở đi, "chưa biết nền" nghĩa là IM LẶNG chứ không phải nền = 0 (NEW-2).
  baselineRequired = true;
  // Chụp nền NGAY **và đối chiếu NGAY**. Không `await` (hàm này đồng bộ, nằm trên đường boot).
  // Không kịp / đầu dò hỏng cũng không sao: mỗi nhịp `__runReconcileTick()` đều THỬ LẠI, và công
  // thức `nền = thiết bị − sổ` khiến lượt chụp muộn vẫn cho ra ĐÚNG con số (NEW-1).
  // ⚠ `.catch()` chứ không `void`: `__runReconcileTick()` nay NÉM tiếp sau khi đếm (M-5), và một
  // promise bị bỏ rơi ở đây là `unhandledRejection` giết tiến trình dưới `--unhandled-rejections=strict`.
  void __runReconcileTick().catch(() => {
    /* đã đếm + đã cảnh báo trong `__runReconcileTick()`; nhịp sau thử lại */
  });
  timer = setInterval(() => {
    void __runReconcileTick().catch(() => {});
  }, INTERVAL_MS);
  timer.unref?.();
}

export function stopVramReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  // Pha 3 Task 2 — tắt luôn nhịp hẹn của sổ chung: một bộ đếm giờ sống sót sau khi đối chiếu đã
  // dừng là đúng thứ `__setVramLogTimerEnabled()` đã phải sửa một lần rồi.
  void import("./vramSharedLedgerStore").then((m) => m.enableSharedLedgerSync(false)).catch(() => {});
}

export function __hasReconcilerTimer(): boolean { return timer !== null; }

/**
 * Pha 1.5 Task 4 — nhãn cho biết hệ có đang chạy nhiều tiến trình giữ VRAM
 * không (báo cáo Pha 1 §9). Đọc `process.env.ROLE` TRỰC TIẾP (không cache ở
 * module-load) vì test đổi `ROLE` giữa các case bằng `vi.resetModules()` +
 * import lại — cache tĩnh sẽ đọc trúng giá trị của lượt import TRƯỚC.
 *
 * ⚠ CHỈ nối vào nhánh LỆCH DƯƠNG (`drift > 0`, "cấp phát không xin phép") của
 * cảnh báo ở `reconcileOnce()`. KHÔNG nối vào nhánh âm — lệch âm là giấy phép
 * treo/đo hỏng CỦA CHÍNH tiến trình này (xem chú thích I-2 phía trên), gợi ý
 * "tiến trình anh em" ở đó là sai hướng và làm người trực đi tìm nhầm chỗ.
 *
 * ⚠⚠ I-4 (review TOÀN NHÁNH) — ĐÍNH CHÍNH: câu cũ ở đây viết *"tiến trình `api`
 * … KHÔNG BAO GIỜ tự đối chiếu (`startVramReconciler()` chỉ chạy ở vai trò chạy
 * scheduler)"*. Task 2 (I-1) đã nhấc lượt bật lên `server/_core/index.ts`
 * **TRƯỚC** nhánh rẽ `ROLE` ⇒ `api` **CÓ đối chiếu**, chỉ là `ring: false` nên
 * nó **không ĐÁNH CHUÔNG**. Vế còn lại giữ nguyên và vẫn là lý do tồn tại của
 * hint này: chuông chỉ reo ở tiến trình có `ring` (worker/all-in-one), nên khi
 * một khoản lệch DƯƠNG hiện ra ở đó, thủ phạm rất có thể là tiến trình anh em —
 * hint này giúp người trực không đổ oan cho "kẻ lạ".
 */
export function describeTopologyHint(): string {
  const role = process.env.ROLE ?? "";
  if (role !== "api" && role !== "worker") return "";
  /**
   * ★★★ Pha 3 Task 2 — CÂU NÀY ĐÃ ĐỔI, và lời đổi là một lời KHAI, không phải một lời quảng cáo.
   * Sổ chung (`vram_leases`) nay có thật, nhưng nó được đọc qua một **BẢN SAO** làm mới mỗi 60 s —
   * nên trong tối đa một chu kỳ, một giấy phép vừa mở ở tiến trình anh em vẫn **vô hình** ở đây.
   * Người trực đọc câu này phải biết cả hai nửa, nếu không họ sẽ tin sổ chung nhiều hơn nó đáng.
   */
  /**
   * ⚠⚠ M-5 (review vòng 1) đã đòi câu này thôi khẳng định *"hai bên dùng SỔ CHUNG"* khi con số lệch
   * còn tính trên sổ CỤC BỘ. **Pha 3 Task 3 nay đã nối cả hai vế**, nên câu đổi lần nữa — và nó
   * phải nói đúng cái CÒN LẠI, không phải quảng cáo cái vừa xong:
   *   • byte anh em nay CÓ trong vế sổ (`foreignLedgerBytes` của kết quả), và nền KHÔNG còn nuốt
   *     chúng — nhưng chỉ khi `baselineOrigin !== "local"`; chế độ `"local"` vẫn tồn tại và câu
   *     cảnh báo LỆCH in kèm nó ở `soNote`.
   *   • cái CÒN LẠI là **ĐỘ TRỄ 60 s**: một giấy phép vừa mở ở anh em có thể chưa tới bản sao đọc.
   */
  return (
    " ⚠ Hệ đang tách vai trò api/worker. Từ Pha 3 Task 3 cả HAI vế đã nối vào SỔ CHUNG " +
    "(`vram_leases`): nền do MỘT tiến trình chụp (không còn nuốt byte anh em) và vế sổ đã cộng " +
    "`foreignLedgerBytes`. CÒN LẠI là ĐỘ TRỄ: bản sao đọc làm mới theo nhịp 60 s, nên một giấy phép " +
    "vừa mở ở tiến trình anh em có thể chưa có mặt trong con số trên."
  );
}
