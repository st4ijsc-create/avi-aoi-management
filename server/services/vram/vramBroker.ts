import type {
  VramLease, VramMeasureSource, VramReserveRequest, VramReserveResult, VramSnapshot, VramPriority,
} from "./types";
import type { HeadroomInput, HeadroomResult } from "./vramHeadroom";
import type { VramHolderFact, VramRefusalFacts, VramUnledgeredFact } from "./vramRefusal";
import { buildVramRefusal } from "./vramRefusal";

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
 * ★ I-4 (review vòng 1) — MỘT bản cài đặt duy nhất của phép ánh xạ giấy phép → hộ, và của vị từ
 * `measured`. Bản trước chép nguyên khối này ở HAI chỗ (`ledgerHolders` và `preemptCandidates`)
 * — ngay bên dưới một chú thích viện dẫn *"hai bản cài đặt song song của CÙNG một công thức là
 * đúng lớp lỗi khiến `bench.mjs` sai bốn lần"*. Bản sao thứ hai lại **không ca nào chạm tới**,
 * nên một đột biến ở đó **sống**.
 *
 * ⚠ `measured` đọc bằng `measureSource`, KHÔNG suy ra từ `actualBytes !== null`: từ T5-15,
 * `commitFallback()` cũng điền `actualBytes` bằng một **ước lượng dự phòng** (types.ts
 * `VramLease.actualBytes` — ba nhóm, đọc bằng HAI trường).
 */
function holderFactFromLease(l: VramLease): VramHolderFact {
  return {
    owner: l.request.owner,
    kind: l.request.kind,
    bytes: leaseBytes(l),
    priority: l.request.priority,
    measured: l.actualBytes !== null && l.measureSource !== undefined && l.measureSource !== "none",
  };
}

/**
 * ★ Pha 2B Task 4 — "AI ĐANG GIỮ GÌ" (§5.3, vế thứ ba của bốn).
 *
 * ⚠⚠ PHẠM VI CHÍNH XÁC, và đây là chỗ dễ nói quá nhất trong cả task: hàm này trả về **những hộ
 * ĐÃ NỐI SỔ**, KHÔNG phải "những tiến trình đang giữ GPU". Sổ hôm nay nối **15 điểm cấp phát trên
 * 160 dòng** đã liệt kê, và bản liệt kê ấy **tự khai là CẬN DƯỚI** (§5.6b). Mọi câu chữ dựng từ
 * danh sách này **bắt buộc** đi kèm phần "KHÔNG quy trách nhiệm được" — xem `vramRefusal.ts`.
 *
 * `measured` khai con số là SỐ ĐO hay ƯỚC LƯỢNG — xem `holderFactFromLease()`.
 */
export function ledgerHolders(): VramHolderFact[] {
  return [...ledger.values()].map(holderFactFromLease);
}

/**
 * ★ Pha 2B Task 4 — "AI CÓ THỂ NHƯỜNG" (§5.3, vế thứ tư). **Chỉ liệt kê, KHÔNG thu hồi gì** —
 * việc thu hồi là của Task 5.
 *
 * Quy tắc §5.2: chỉ nhường được mức **THẤP HƠN** mức đang xin. Cũ trước, mới sau (`acquiredAt`),
 * và dừng khi đã đủ bù `deficitBytes`.
 *
 * ⚠ `deficitBytes` KHÔNG hữu hạn (`headroom = -Infinity` ⇒ thiếu `+Infinity`; hoặc `NaN` từ một ô
 * bẩn) ⇒ liệt kê **TOÀN BỘ** ứng viên mức thấp hơn. Cắt danh sách khi không biết mình thiếu bao
 * nhiêu là để người trực nhường xong vẫn không đủ mà không hiểu vì sao.
 *
 * ⚠ KHÔNG lọc theo trạng thái commit — một giấy phép "chưa commit" (đang cấp phát dở) VẪN được
 * liệt kê nếu rank thấp hơn. Đây là danh sách ỨNG VIÊN để NÓI RA, không phải lệnh thu hồi; câu
 * hỏi "có được thu hồi một giấy phép đang cấp phát giữa chừng không" (và §5.2 `refCount === 0`)
 * là QUYẾT ĐỊNH TƯỜNG MINH của Task 5, không phải mặc định của một hàm liệt kê.
 */
export function preemptCandidates(priority: VramPriority, deficitBytes: number): VramHolderFact[] {
  const rank = PRIORITY_RANK[priority];
  const candidates = [...ledger.values()]
    .filter((l) => PRIORITY_RANK[l.request.priority] < rank)
    .sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime());
  const enough = Number.isFinite(deficitBytes) ? deficitBytes : Number.POSITIVE_INFINITY;
  const out: VramHolderFact[] = [];
  let freed = 0;
  for (const c of candidates) {
    if (freed >= enough) break;
    out.push(holderFactFromLease(c));
    freed += leaseBytes(c);
  }
  return out;
}

/**
 * ★ Pha 2B Task 4 — ghép **sổ SỐNG** với **kết quả headroom** thành sự thật của một lời từ chối.
 * Task này KHÔNG ném gì; Task 5 mới dựng `VramRefusedError` từ kết quả này.
 *
 * ⚠⚠ VÌ SAO NHẬN CẢ `headroomInput` LẪN `headroom`, thay vì tự đọc lại sổ: `unattributedBytes`
 * là hiệu `usedBytes − ledgerTotalBytes`, và HAI vế đó **phải đến từ CÙNG một lượt đọc sổ**. Tự
 * đọc lại `totalReserved()` ở đây là lấy một vế ở thời điểm khác — đúng lớp lỗi "hai bản cài đặt
 * song song trôi khỏi nhau". `headroomInput.ledgerTotalBytes` chính là vế đã sinh ra
 * `headroom.usedBytes`.
 *
 * ⚠⚠ `unledgered` là trường **BẮT BUỘC** (`… | null`, không optional): `null` = **CHƯA HỎI**
 * `vramWiring.vramBeginFailureState()`. Một `?? { bytes: 0, unknownCount: 0 }` ở đây sẽ biến câu
 * "tôi không biết" thành "tôi đã kiểm và không có gì" — quy tắc "mỗi `??` là một DÂY" của Task 3.
 * ⚠ Broker KHÔNG tự gọi `vramBeginFailureState()`: `vramWiring` nhập `vramBroker`, chiều ngược
 * lại là một vòng nhập — nên người gọi (Task 5) truyền vào.
 */
export function refusalFactsFor(args: {
  readonly request: VramReserveRequest;
  readonly headroomInput: HeadroomInput;
  readonly headroom: HeadroomResult;
  readonly unledgered: VramUnledgeredFact;
}): VramRefusalFacts {
  const { request, headroomInput, headroom, unledgered } = args;
  return buildVramRefusal({
    requestedBytes: request.estimatedBytes,
    owner: request.owner,
    priority: request.priority,
    headroomBytes: headroom.headroomBytes,
    degradedReasons: headroom.degradedReasons,
    blind: headroom.blind,
    ledgerTotalBytes: headroomInput.ledgerTotalBytes,
    usedBytes: headroom.usedBytes,
    holders: ledgerHolders(),
    preemptable: preemptCandidates(request.priority, request.estimatedBytes - headroom.headroomBytes),
    unledgered,
  });
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

  // Pha 2B Task 4 — MỘT bản cài đặt duy nhất cho "ai có thể nhường". Trước đây phép chọn này nằm
  // ngay tại đây; câu từ chối (§5.3) cần đúng phép chọn ấy, và hai bản cài đặt song song của CÙNG
  // một công thức là đúng lớp lỗi đã khiến `bench.mjs` sai bốn lần.
  const wouldPreempt: string[] = wouldRefuse
    ? preemptCandidates(request.priority, request.estimatedBytes - headroom).map((h) => h.owner)
    : [];

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
  // Pha 2A Task 4 (T5-15) — cùng lý do với dòng trên, chỉ khác cái ô: một con số ĐO vừa về thì
  // dấu "đây là ước lượng dự phòng" PHẢI biến mất, nếu không nhật ký sẽ gọi một số thật là ước
  // lượng. (Hôm nay không đường nào commit() sau commitFallback() — `commitMeasured()` chỉ chạy
  // một lần cho mỗi ticket — nhưng bất biến "hai ô luôn khớp `actualBytes`" phải đúng tại chỗ.)
  live.fallbackReason = undefined;
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
 * ★★★ Pha 2A Task 4 (T5-15) — CHỐT SỔ BẰNG ƯỚC LƯỢNG DỰ PHÒNG sau khi phép đo đã hỏng.
 *
 * ⚠ VÌ SAO PHẢI CÓ, và vì sao nó KHÔNG phải là "commit() bản lỏng tay": `gguf-backend` KHÔNG có
 * đường `release()` ở nhánh THÀNH CÔNG (đúng thiết kế — backend CUDA sống suốt đời tiến trình).
 * Nên một lượt `markMeasureFailed()` trên giấy phép đó ghim `actualBytes = null` VĨNH VIỄN, mà
 * `holdsUncommittedBytes()` (vramReconciler) = `actualBytes === null` **bất kể `measureFailed`**
 * ⇒ lá chắn HOÃN chụp nền đóng VĨNH VIỄN ⇒ quá `BASELINE_BLOCKED_ALARM_MS` là báo động KHÔNG BAO
 * GIỜ TỰ LÀNH. Xấu nhất không phải "nên khởi động lại" mà là **"BẮT BUỘC khởi động lại"**.
 *
 * ⚠⚠ BA KHÁC BIỆT VỚI `commit()` — cả ba đều là ĐIỀU KIỆN, không phải chi tiết:
 *   1. **KHÔNG xoá `measureFailed`.** Phép đo THẬT SỰ đã hỏng; xoá cờ là khai một con số ước
 *      lượng thành "đã đo được" — đúng chiều lỗi nguy hiểm mà I-1 (Task 3) đã dựng lưới để chặn.
 *   2. **`measureSource` giữ nguyên `"none"`.** Không thước nào đẻ ra con số này. Đây là thứ duy
 *      nhất phân biệt được "ước lượng dự phòng" với "số đo" khi đọc lại sổ (types.ts
 *      `VramLease.actualBytes`), và `splitLedgerByMeasureSource()` đọc đúng nó.
 *   3. **KHÔNG gọi `estimator.recordActual()`** — và điều đó được bảo đảm bằng CẤU TRÚC: module
 *      này KHÔNG import `vramEstimator` một dòng nào. Một ước lượng dự phòng lọt vào nấc
 *      `learned` sẽ tự khai là "đã đo thật lượt trước" cho MỌI lượt `reserve()` sau, tới hết đời
 *      tiến trình — đúng lý do C-1 (Pha 1.5) đã phải TÁCH `commit()` khỏi `recordActual()`.
 *
 * ⚠⚠ M-3 (review vòng 1) — **KHÔNG ĐỘNG VÀO `live.request`**. Bản đầu ghi
 * `request.estimateSource = "fallback-after-measure-failure"` và làm hai việc sai cùng lúc: XOÁ
 * xuất xứ ước lượng GỐC (thứ Task 7 đọc), và MUTATE object của người gọi — `reserve()` lưu
 * `request` theo THAM CHIẾU (`:123`), nên lời gọi đó sửa cả object nằm ngoài sổ. Dấu "đây là dự
 * phòng" nay nằm ở ô RIÊNG `lease.fallbackReason` (types.ts).
 *
 * ⚠ HÀNG RÀO (`false` = KHÔNG làm gì): chỉ chạy khi phép đo ĐÃ HỎNG và ô số còn TRỐNG. Thiếu hàng
 * rào này thì đây là cửa sau để ghi một con số bịa đè lên số ĐO của một giấy phép đang đo tốt.
 *
 * ⚠ NGƯỜI GỌI phải chắc chắn khối byte ĐANG TỒN TẠI và biết kích thước của nó (xem
 * `VramAllocationOptions.fallbackBytes` — CỐ Ý opt-in theo ĐIỂM GỌI, không theo `kind`). `0` là
 * một giá trị HỢP LỆ và có nghĩa: backend chạy CPU chiếm đúng 0 byte VRAM.
 *
 * @returns `true` nếu sổ vừa được chốt bằng ước lượng; `false` nếu không đủ điều kiện.
 */
export function commitFallback(leaseId: string, bytes: number, reason: string): boolean {
  const live = ledger.get(leaseId);
  if (!live || live.released) return false;
  // Đã có số (đo thật HOẶC đã chốt dự phòng lượt trước) ⇒ không đè.
  if (live.actualBytes !== null) return false;
  // Chưa hỏng ⇒ số THẬT vẫn đang trên đường tới; chốt bây giờ là cướp chỗ của nó.
  if (live.measureFailed !== true) return false;
  if (!Number.isFinite(bytes) || bytes < 0) return false;
  live.actualBytes = bytes;
  live.measureSource = "none";
  // I-2 (review vòng 1) — `reason` PHẢI ở lại sổ SỐNG, không được bốc hơi sau lời gọi: sự kiện
  // `release` đọc `lease.actualBytes` và nếu không có ô này thì nó ghi một con số ƯỚC LƯỢNG mà
  // không có cách nào nói ra rằng đó là ước lượng. Một dòng nhật ký tự mâu thuẫn còn tệ hơn một
  // dòng thiếu thông tin.
  live.fallbackReason = reason;
  live.lastHeartbeatAt = new Date();
  return true;
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
