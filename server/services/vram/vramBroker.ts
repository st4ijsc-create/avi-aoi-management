import type {
  VramLease, VramMeasureSource, VramReserveRequest, VramReserveResult, VramSnapshot, VramPriority,
} from "./types";
import type { HeadroomBasis, HeadroomInput, HeadroomResult } from "./vramHeadroom";
import { assertHeadroomPolicy, computeHeadroom, headroomInputFromTick } from "./vramHeadroom";
import type { VramDegradationReason, VramHolderFact, VramRefusalFacts, VramUnledgeredFact } from "./vramRefusal";
import { buildVramRefusal } from "./vramRefusal";
import { applyEnforcement } from "./vramEnforcement";
import type { VramDecisionTick } from "./vramTickCell";

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
    reclaimable: coThiHanhThuHoi(l),
  };
}

/**
 * ★★★ Pha 2B Task 5, review vòng 1 (C) — VỊ TỪ *"CÓ NGƯỜI THI HÀNH THU HỒI HỘ NÀY KHÔNG"*.
 *
 * ⚠ TÁCH HẲN khỏi `coTheNhuong()` (quyền — §5.2) vì đây là câu hỏi KHÁC: **khả năng**. Gộp hai câu
 * ấy là cách câu từ chối HỨA NGƯỢC — nêu tên một hộ có quyền nhường mà không cơ chế nào lấy lại
 * được khối byte của nó, rồi cộng nó vào một cái "tổng nhường được".
 *
 * Hôm nay người thi hành DUY NHẤT là `vramLoadOutcome.reclaim()` → `aiGgufEngine.evictLRU()`, và
 * nó chỉ với tới **model GGUF NHÀN RỖI** (`unloadGgufModel()` — dispose thật, rồi mới nhả sổ).
 *   • `gguf-backend` — KHÔNG: backend CUDA sống suốt đời tiến trình, không có đường nhả.
 *   • `onnx-session` — KHÔNG: `ort.InferenceSession` không có lời gọi `release()` nào trên đường GPU.
 *   • `external-process` (sidecar · trainer · cron) — KHÔNG: thu hồi xuyên tiến trình là Pha 3.
 * ⇒ Khi Task 7 hấp thụ `evictLRU()` thành `preempt()` thật, **mở rộng ĐÚNG hàm này** — đừng để câu
 * chữ và cơ chế trôi khỏi nhau lần nữa.
 */
function coThiHanhThuHoi(l: VramLease): boolean {
  return l.request.kind === "gguf-model" && l.refCount === 0;
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
 * ★★★ Pha 2B Task 5 (§5.2) — VỊ TỪ "CÓ ĐƯỢC THU HỒI GIẤY PHÉP NÀY KHÔNG". **MỘT bản cài đặt duy
 * nhất**, và mọi nơi hỏi câu đó đều phải đi qua đây (bảng "vị từ dùng chung" của báo cáo Task 5).
 *
 * §5.2 nguyên văn: *"Chỉ thu hồi được giấy phép **đang nhàn rỗi** (`refCount === 0`) **hoặc** mức
 * **thấp hơn** mức đang xin."* — và **`production` KHÔNG BAO GIỜ bị thu hồi** phủ lên trên cả hai
 * vế đó. Ba câu, thứ tự này, không đổi được:
 *
 *   1. `production` ⇒ **KHÔNG**, tuyệt đối, kể cả khi nhàn rỗi và kể cả khi người xin cũng là
 *      `production`. Đường kiểm tra AOI là thứ cả nhà máy đứng trên.
 *   2. nhàn rỗi (`refCount === 0`) ⇒ **CÓ**, kể cả CÙNG mức — đây đúng là việc `evictLRU()` cũ vẫn
 *      làm được (đuổi model GGUF rảnh để nạp model GGUF khác), và bỏ nó đi là đổi một vấn đề tràn
 *      lấy một vấn đề "không bao giờ nạp được model thứ hai".
 *   3. mức THẤP HƠN ⇒ **CÓ**, kể cả khi đang dùng — `background` (nạp tri thức, huấn luyện, cron)
 *      **nhường trước tiên**, đó là toàn bộ ý nghĩa của bậc thang ưu tiên.
 *
 * ⚠⚠ VÀ ĐÂY LÀ RANH GIỚI PHẢI ĐỌC KỸ: hàm này **CHỈ LIỆT KÊ**. Không một dòng nào trong file này
 * thu hồi gì cả, và điều đó là CỐ Ý: `reserve()` **ĐỒNG BỘ** (ràng buộc 1), trong khi nhả một khối
 * VRAM thật là việc **BẤT ĐỒNG BỘ** (`model.dispose()`, `session.release()`, giết tiến trình con).
 * Nhả giấy phép trong sổ mà thiết bị chưa nhả là **nói dối đúng chiều OOM** — sổ khai trống, card
 * vẫn giữ 17 GB, và lượt xin kế tiếp được cấp trên chỗ trống ma. ⇒ Người THI HÀNH là điểm gọi bất
 * đồng bộ (`vramLoadOutcome.reclaim` hôm nay), sau khi đọc danh sách này.
 */
function coTheNhuong(l: VramLease, rankNguoiXin: number): boolean {
  if (l.request.priority === "production") return false;
  return l.refCount === 0 || PRIORITY_RANK[l.request.priority] < rankNguoiXin;
}

/**
 * ★ Pha 2B Task 4 — "AI CÓ THỂ NHƯỜNG" (§5.3, vế thứ tư). **Chỉ liệt kê, KHÔNG thu hồi gì.**
 *
 * Thứ tự (Task 5): mức THẤP trước (`background` nhường trước tiên), rồi NHÀN RỖI trước, rồi CŨ
 * trước. Dừng khi đã đủ bù `deficitBytes`.
 *
 * ⚠ `deficitBytes` KHÔNG hữu hạn (`headroom = -Infinity` ⇒ thiếu `+Infinity`; hoặc `NaN` từ một ô
 * bẩn) ⇒ liệt kê **TOÀN BỘ** ứng viên mức thấp hơn. Cắt danh sách khi không biết mình thiếu bao
 * nhiêu là để người trực nhường xong vẫn không đủ mà không hiểu vì sao.
 *
 * ⚠ KHÔNG lọc theo trạng thái commit — một giấy phép "chưa commit" (đang cấp phát dở) VẪN được
 * liệt kê nếu `coTheNhuong()` cho phép. Đây là danh sách ỨNG VIÊN để NÓI RA và để người thi hành
 * bất đồng bộ đọc, không phải một lệnh thu hồi.
 */
export function preemptCandidates(priority: VramPriority, deficitBytes: number): VramHolderFact[] {
  const rank = PRIORITY_RANK[priority];
  const candidates = [...ledger.values()]
    .filter((l) => coTheNhuong(l, rank))
    .sort(
      (a, b) =>
        // 1) mức THẤP nhường TRƯỚC TIÊN (§5.2)
        PRIORITY_RANK[a.request.priority] - PRIORITY_RANK[b.request.priority] ||
        // 2) NHÀN RỖI trước kẻ đang dùng — nhường một thứ không ai dùng rẻ hơn hẳn
        (a.refCount === 0 ? 0 : 1) - (b.refCount === 0 ? 0 : 1) ||
        // 3) CŨ trước
        a.acquiredAt.getTime() - b.acquiredAt.getTime(),
    );
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
  /**
   * ★ Task 5 — con số mà cưỡng chế THẬT SỰ đã so với lượt xin, và danh sách lý do ĐẦY ĐỦ (gồm cả
   * lý do do chính sách sinh ra: `stale-tick`, `unledgered-unknown`, …).
   *
   * ⚠⚠ BẮT BUỘC CÓ MẶT, và **không** mặc định về `headroom.headroomBytes`: in dư địa THÔ trong một
   * câu từ chối được quyết định bằng dư địa HIỆU LỰC là nói một con số **không phải cơ sở của quyết
   * định** — người trực nhìn "còn 5.000 MiB" rồi không hiểu vì sao lượt xin 3.000 MiB bị chặn, và
   * đi tìm lỗi ở chỗ không có lỗi.
   */
  readonly effectiveHeadroomBytes: number;
  readonly degradedReasons: readonly VramDegradationReason[];
}): VramRefusalFacts {
  const { request, headroomInput, headroom, unledgered } = args;
  return buildVramRefusal({
    requestedBytes: request.estimatedBytes,
    owner: request.owner,
    priority: request.priority,
    headroomBytes: args.effectiveHeadroomBytes,
    degradedReasons: args.degradedReasons,
    blind: headroom.blind,
    ledgerTotalBytes: headroomInput.ledgerTotalBytes,
    usedBytes: headroom.usedBytes,
    holders: ledgerHolders(),
    preemptable: preemptCandidates(
      request.priority,
      request.estimatedBytes - args.effectiveHeadroomBytes,
    ),
    unledgered,
  });
}

/**
 * ★★★ Pha 2B Task 5 — ĐẦU VÀO QUYẾT ĐỊNH mà **chỉ người gọi biết**, và vì sao nó là tham số
 * BẮT BUỘC chứ không phải thứ broker tự đi lấy:
 *
 *   • `tick` — ô tick nằm ở `vramTickCell` (module lá). Broker CÓ THỂ tự đọc, nhưng đọc ở đây thì
 *     hai vế `L` và `A` của phép `max` đến từ HAI thời điểm khác nhau khi người gọi đã đọc trước;
 *     một tham số đóng cửa đó lại.
 *   • `unledgered` — `vramWiring.vramBeginFailureState()`. `vramWiring` nhập `vramBroker`, chiều
 *     ngược lại là **vòng nhập** (bàn giao Task 4).
 *   • `nowMs` — đồng hồ. Truyền vào để tuổi tick là một con số KIỂM ĐƯỢC, không phải một lượt gọi
 *     `Date.now()` ẩn giữa đường quyết định.
 *
 * ⚠ Cả ba đều **không optional**: `tsc` chặn người gọi quên (cùng cơ chế Task 2 dùng cho
 * `baselineVerified` và Task 4 cho `unledgered`). `tick: null` và `unledgered: null` là những câu
 * trả lời HỢP LỆ và có nghĩa riêng — "chưa có nhịp nào" và "chưa hỏi" — cả hai đều làm hệ CHẶT HƠN.
 */
export interface VramDecisionContext {
  readonly tick: VramDecisionTick | null;
  readonly unledgered: VramUnledgeredFact;
  readonly nowMs: number;
}

/** Số liệu của MỘT lượt quyết định — đi thẳng vào nhật ký để lượt từ chối dựng lại được phép tính. */
export interface VramReserveDecision {
  /** `computeHeadroom()` thô (§5.6c). */
  readonly headroomBytes: number;
  /** Sau chính sách suy giảm — **con số đã so với lượt xin**. Luôn ≤ `headroomBytes`. */
  readonly effectiveHeadroomBytes: number;
  readonly usedBytes: number;
  readonly basis: HeadroomBasis;
  readonly blind: boolean;
  readonly baselineVerified: boolean;
  readonly reasons: readonly VramDegradationReason[];
  readonly trusted: boolean;
  readonly staleMarginBytes: number;
  readonly unledgeredChargeBytes: number;
  readonly distrustChargeBytes: number;
  readonly ledgerTotalBytes: number;
  readonly ceilingBytes: number;
  readonly safetyReserveBytes: number;
}

export interface VramReserveOutcome extends VramReserveResult {
  /** `null` ⇔ được cấp. Khác `null` ⇔ `lease === null` (bất biến, có ca test khoá). */
  readonly refusal: VramRefusalFacts | null;
  readonly decision: VramReserveDecision;
}

/**
 * ★★★ Pha 2B Task 5 — XIN CHỖ, VÀ ĐÂY LÀ NƠI MỘT LƯỢT XIN CÓ THỂ BỊ **TỪ CHỐI**.
 *
 * Trước task này hàm luôn trả giấy phép và `wouldRefuse` chỉ là phán quyết BÓNG. Từ đây:
 *
 *     lease === null  ⇔  wouldRefuse === true  ⇔  refusal !== null
 *
 * và `vramWiring` dựng `VramRefusedError` từ `refusal` rồi **NÉM** — lượt cấp phát KHÔNG chạy.
 *
 * BỐN BƯỚC, không bước nào chạm I/O:
 *   1. `computeHeadroom()` (§5.6c) trên **sổ SỐNG** + ô tick người gọi đưa vào;
 *   2. `applyEnforcement()` — chính sách suy giảm: mỗi mức một phụ phí RIÊNG, **mọi mức CHẶT HƠN**;
 *   3. so `estimatedBytes` với dư địa **HIỆU LỰC** (bước 2), không phải dư địa thô;
 *   4. không đủ ⇒ dựng SỰ THẬT của lời từ chối (bốn thứ §5.3 + phần không quy trách nhiệm được).
 *
 * ⚠⚠ VÌ SAO KHÔNG CÓ NGOẠI LỆ CHO LƯỢT XIN **0 BYTE**: nghe thì "0 byte thì hại ai", nhưng nấc
 * `learned` **đang có đường sinh ra `0` cho một model 17 GB** (nợ N2-2 mang sang từ Pha 2A: PID
 * cấp lại ⇒ tập `seen` sai ⇒ `commit(0)` + `recordActual(0)`). Một cửa "0 byte luôn được cấp" là
 * cửa mà đúng khối 17 GB đó đi qua. Dư địa hiệu lực âm ⇒ **mọi** lượt xin bị từ chối, kể cả 0.
 *
 * ⚠ `estimatedBytes = NaN` ⇒ `NaN <= x` là `false` ⇒ **TỪ CHỐI**. Đúng chiều fail-closed, và đó là
 * lý do phép so viết theo chiều `<=` chứ không phải `!(... > ...)`.
 *
 * Bảo đảm CẤU TRÚC (mạnh hơn mọi test): hàm này ĐỒNG BỘ — trả thẳng kết quả, không phải `Promise`,
 * và không `import` module I/O nào (fs/net/http/child_process). Không `await` được gì bên trong một
 * hàm không `async`. ⚠ Người sau: đừng đổi hàm này thành `async` mà không nhận ra đang gỡ mất lá
 * chắn cấu trúc từ Pha 1 — nó là thứ giữ đường quyết định sạch I/O, không phải một tối ưu hiệu năng.
 */
export function reserve(request: VramReserveRequest, ctx: VramDecisionContext): VramReserveOutcome {
  const ceilingBytes = deviceTotalBytes();
  const ledgerTotalBytes = totalReserved();
  const headroomInput = headroomInputFromTick(ctx.tick, {
    ceilingBytes,
    safetyReserveBytes: SAFETY_RESERVE_BYTES,
    // ⚠ SỔ **SỐNG**, đọc ngay tại thời điểm quyết định — KHÔNG lấy `ledgerTotalBytes` của tick cũ:
    // mọi lượt `reserve()` xảy ra trong một nhịp sẽ vô hình, tức đúng cái cửa cưỡng chế sinh ra để
    // đóng (vramHeadroom.HeadroomPolicy).
    ledgerTotalBytes,
  });
  const headroom = computeHeadroom(headroomInput);
  const enf = applyEnforcement({
    headroom,
    // Tuổi tick: `null` khi CHƯA CÓ NHỊP NÀO (ca đó đã có lý do `"no-tick"` riêng).
    tickAgeMs: ctx.tick === null ? null : ctx.nowMs - ctx.tick.atMs,
    tickConsecutiveFailures: ctx.tick === null ? 0 : ctx.tick.consecutiveFailures,
    unledgered: ctx.unledgered,
  });

  const decision: VramReserveDecision = {
    headroomBytes: headroom.headroomBytes,
    effectiveHeadroomBytes: enf.effectiveHeadroomBytes,
    usedBytes: headroom.usedBytes,
    basis: headroom.basis,
    blind: headroom.blind,
    baselineVerified: headroom.baselineVerified,
    reasons: enf.reasons,
    trusted: enf.trusted,
    staleMarginBytes: enf.staleMarginBytes,
    unledgeredChargeBytes: enf.unledgeredChargeBytes,
    distrustChargeBytes: enf.distrustChargeBytes,
    ledgerTotalBytes,
    ceilingBytes,
    safetyReserveBytes: SAFETY_RESERVE_BYTES,
  };

  const vua = request.estimatedBytes <= enf.effectiveHeadroomBytes;
  if (!vua) {
    const refusal = refusalFactsFor({
      request,
      headroomInput,
      headroom,
      unledgered: ctx.unledgered,
      effectiveHeadroomBytes: enf.effectiveHeadroomBytes,
      degradedReasons: enf.reasons,
    });
    return {
      lease: null,
      wouldRefuse: true,
      // MỘT bản cài đặt duy nhất cho "ai có thể nhường" — cùng nguồn với câu từ chối, vì hai bản
      // song song của CÙNG một công thức là đúng lớp lỗi đã khiến `bench.mjs` sai bốn lần.
      wouldPreempt: refusal.preemptable.map((h) => h.owner),
      refusal,
      decision,
    };
  }

  const lease: VramLease = {
    id: `lease-${++seq}`,
    request,
    acquiredAt: new Date(),
    actualBytes: null,
    measureFailed: false,
    lastHeartbeatAt: new Date(),
    released: false,
    // ⚠ `1` = ĐANG DÙNG. Xem `VramLease.refCount` (types.ts) để biết vì sao mặc định KHÔNG phải 0.
    refCount: 1,
  };
  ledger.set(lease.id, lease);
  return { lease, wouldRefuse: false, wouldPreempt: [], refusal: null, decision };
}

/**
 * ★★★ Pha 2B Task 5 (§5.2) — KHAI "CÓ AI ĐANG DÙNG KHỐI BYTE NÀY KHÔNG".
 *
 * Đây là **cửa duy nhất** làm một giấy phép trở thành ứng viên nhường chỗ, và nó CỐ Ý bắt điểm gọi
 * khai bằng SỐ NGƯỜI DÙNG chứ không phải bằng một cờ `idle`: `aiGgufEngine` đã đếm sẵn
 * (`LoadedModel.refCount`, thứ `evictLRU()` cũ dùng làm điều kiện đuổi), và một cờ boolean sẽ buộc
 * nó phải tự dịch `n → boolean` — tức một bản cài đặt thứ hai của cùng một vị từ.
 *
 * ⚠ Số vô lý (âm/NaN) bị TỪ CHỐI (trả `false`, không ghi): một `NaN` lọt vào đây làm
 * `refCount === 0` thành `false` vĩnh viễn — nghe thì "an toàn" (không ai bị thu hồi) nhưng nó
 * **khoá cứng** cả cơ chế nhường chỗ mà không ai thấy. Từ chối ồn hơn là nuốt.
 *
 * @returns `true` nếu sổ vừa nhận số mới.
 */
export function setLeaseRefCount(leaseId: string, refCount: number): boolean {
  const live = ledger.get(leaseId);
  if (!live || live.released) return false;
  if (!Number.isFinite(refCount) || refCount < 0) return false;
  live.refCount = Math.floor(refCount);
  return true;
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

/**
 * ★★ Pha 2B Task 5 — CỔNG CẤU HÌNH LÚC BOOT, người tiêu thụ **đầu tiên** của
 * `vramHeadroom.assertHeadroomPolicy()` (Task 2 để lại nó KHÔNG AI GỌI, kèm một câu bàn giao thẳng:
 * *"lớp hỏng SỚM hiện KHÔNG đạt được ở đâu cả — mọi vị trí khả dĩ đều nằm trong try/catch"*).
 *
 * ⚠⚠ QUYẾT ĐỊNH VỊ TRÍ (và nó là một quyết định, không phải một chỗ tiện tay): lời gọi đặt ở
 * **mức module của điểm vào** (`server/_core/index.ts` và `server/worker.ts`) — chỗ DUY NHẤT trong
 * repo hôm nay nằm NGOÀI mọi `try`. Ba vị trí từng được đề xuất đều bị nuốt:
 *   • mức module `vramBroker` — điểm nhập của nó nằm trong `try` của `beginVramAllocation()`;
 *   • khối bật VRAM lúc boot — `try { … } catch { console.error(…) }`, cố ý từ Pha 1;
 *   • `startVramReconciler()` — cùng khối `try` đó.
 *
 * ⚠ Hàm này NÉM. Đó là toàn bộ mục đích: `.env` hỏng phải lộ ra **TO và SỚM**, chứ không phải hiện
 * thành "từ chối 100% lượt xin" ba giờ sau. Nó chỉ ném khi người vận hành ĐÃ ĐẶT một giá trị vô
 * nghĩa (`VRAM_DEVICE_TOTAL_MB=` để trống ⇒ `Number("") === 0`, `VRAM_SAFETY_RESERVE_MB=abc` ⇒
 * `NaN`); không đặt gì thì cả hai đều về mặc định hợp lệ và hàm im lặng.
 */
export function assertVramEnforcementPolicy(): void {
  /**
   * ★★★ Review vòng 1 (F) — KIỂM **CHUỖI THÔ CỦA `.env`**, KHÔNG KIỂM SỐ ĐÃ QUA LỌC.
   *
   * Reviewer đo bằng tiến trình thật: bản trước chỉ bắt **1/4** ca, và **cả ba ca lọt đều theo
   * chiều NỚI** — vì mỗi ô đều có một lượt lọc riêng ăn mất bằng chứng TRƯỚC khi lời kiểm nhìn thấy:
   *   • `VRAM_DEVICE_TOTAL_MB=` (để TRỐNG) ⇒ `Number("") === 0` ⇒ `deviceTotalBytes()` **tự bỏ qua**
   *     (chỉ nhận `> 0`) và lặng lẽ rơi về hằng số dự phòng 32.607 MiB — tức máy 8 GB chạy trên trần
   *     của một RTX 5090. Đây ĐÚNG ca mà docstring của lời kiểm nêu ĐẦU TIÊN, và nhánh kiểm trần khi
   *     đó là **MÃ CHẾT**.
   *   • `VRAM_SAFETY_RESERVE_MB=` ⇒ đệm **0** — hợp lệ về kiểu, nhưng xoá sạch biên an toàn.
   *   • `VRAM_DISTRUST_UNIT_MB=` ⇒ đơn vị **0** — **TẮT TOÀN BỘ chính sách suy giảm** (mù/nền chưa
   *     xác minh/tick cũ đều thành miễn phí) mà không một dòng nào kêu.
   *
   * ⇒ Quy tắc: **đặt một biến rồi để trống là một LỖI CẤU HÌNH, không phải một giá trị.** Không đặt
   * gì thì im lặng (mặc định hợp lệ); đặt `0` TƯỜNG MINH cho đệm/đơn vị vẫn hợp lệ (người vận hành
   * cố ý tắt), nhưng trần thì `0` không bao giờ hợp lệ.
   */
  kiemBienMoiTruong("VRAM_DEVICE_TOTAL_MB", { toiThieu: 0, chapNhanBang: false });
  kiemBienMoiTruong("VRAM_SAFETY_RESERVE_MB", { toiThieu: 0, chapNhanBang: true });
  kiemBienMoiTruong("VRAM_DISTRUST_UNIT_MB", { toiThieu: 0, chapNhanBang: true });
  assertHeadroomPolicy({ ceilingBytes: deviceTotalBytes(), safetyReserveBytes: SAFETY_RESERVE_BYTES });
}

/**
 * Một biến môi trường SỐ: **không đặt** thì im lặng, **đặt sai** thì chết ngay lúc boot với đúng
 * tên biến trong câu lỗi. `chapNhanBang: true` ⇒ đúng bằng `toiThieu` là hợp lệ (vd. `0` để tắt).
 */
function kiemBienMoiTruong(
  ten: string,
  opts: { readonly toiThieu: number; readonly chapNhanBang: boolean },
): void {
  const raw = process.env[ten];
  if (raw === undefined) return;
  const chuoi = raw.trim();
  if (chuoi === "") {
    throw new TypeError(
      `[vram] cấu hình cưỡng chế hỏng: ${ten} được ĐẶT nhưng để TRỐNG. \`Number("") === 0\`, và ` +
        `một số 0 lọt qua đây sẽ hoặc rơi về hằng số dự phòng của MỘT máy khác, hoặc xoá sạch biên ` +
        `an toàn/phụ phí mất-tin-cậy — cả hai đều IM LẶNG. Xoá hẳn dòng đó, hoặc ghi một số.`,
    );
  }
  const so = Number(chuoi);
  const hopLe = Number.isFinite(so) && (opts.chapNhanBang ? so >= opts.toiThieu : so > opts.toiThieu);
  if (!hopLe) {
    throw new TypeError(
      `[vram] cấu hình cưỡng chế hỏng: ${ten}="${raw}" không dùng được (phải là số hữu hạn ` +
        `${opts.chapNhanBang ? "≥" : ">"} ${opts.toiThieu}). Sửa cấu hình, đừng bắt đường nóng đoán.`,
    );
  }
}

/** Chỉ dùng trong test. */
export function __resetBrokerForTests(): void {
  ledger.clear();
  seq = 0;
  measuredDeviceTotalBytes = null;
}
