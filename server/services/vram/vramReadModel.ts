/**
 * ★★★ PHA 4 TASK 1 — **MẶT ĐỌC CỦA AI AGENT.** Phơi trạng thái VRAM ra, **KHÔNG HỨA QUÁ**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ RÀNG BUỘC LỚN NHẤT CỦA CẢ FILE: **MỖI TRƯỜNG PHẢI NÓI ĐÚNG ĐỘ CHẮC CHẮN CỦA NÓ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Agent đọc API này để **QUYẾT ĐỊNH**. Một trường nói quá không dừng ở *"tài liệu sai"* — nó
 * thành **một hành động sai**. Lớp lỗi "hứa nhiều hơn dữ liệu" đã bị bắt **CHÍN lần** trong
 * chuỗi pha này. **BỐN** chỗ dễ nói quá nhất, cả bốn đều có SỐ, và cả bốn được xử bằng **KIỂU**:
 *
 *   1. **`unledgeredBytes` là ƯỚC LƯỢNG, không phải số đo.** GGUF 30B `fileBytes`
 *      **17.690.497.440 B** vs `actualBytes` đo được **17.511.354.368 B** ⇒ file **CAO HƠN
 *      170,8 MiB**; reranker thì **ngược 2,1 lần** ⇒ **KHÔNG có hệ số chung**. Và
 *      `unknownCount > 0` làm nó **MẤT TIN CẬY** chứ không phải "nhỏ đi": mọi hộ
 *      ONNX/sidecar/`gguf-context` đóng góp **0 byte** vào con số ấy và **chỉ** hiện ở
 *      `unknownCount`. ⇒ ô `estimateBytes` **không bao giờ** rời file này mà thiếu `unknownCount`
 *      + `estimateUsable` + nhãn `estimateKind: "estimate"`.
 *   2. **Danh sách "đang giữ" chỉ phủ hộ ĐÃ NỐI** — 15 điểm trên 159 dòng liệt kê, và bản liệt kê
 *      ấy **TỰ KHAI LÀ CẬN DƯỚI** (một đột biến chỉ đổi tên một biến đã đi lọt 10/10 xanh). ⇒ mọi
 *      ảnh chụp mang khối `unattributed` với `caveat` + `holderListIsLowerBound: true`. Không có
 *      nó, Agent đọc *"đang giữ: (không có)"* rồi kết luận **card trống**.
 *   3. **`attributable = null` là CHẶN TRÊN, không phải "không biết" trung tính.** Vì
 *      `max(L, A) ≥ L` với MỌI `A`, rơi về chỉ-sổ cho dư địa **LỚN NHẤT có thể** — trong khi sổ
 *      mới nối 15/159. ⇒ ô này là một **HỢP KIỂU CÓ NHÃN** (`known: false` +
 *      `meaning: "headroom-upper-bound"`), không phải một `number | null` để ai đó đọc thành
 *      "trạng thái an toàn".
 *   4. **`headroom.effective` là một ĐẠI LƯỢNG ĐANG CHẢY, không phải một bất biến.** Đo được ở
 *      nghiệm thu sống Pha 5: **trôi 426.640.456 B giữa hai lượt đọc cách nhau vài giây**, thuần
 *      theo tuổi bản sao đọc sổ chung (`foreign.ageMs`); chín lượt đọc trong 40 s, **không một
 *      lệnh nào** ở giữa, cho **hai** con số. ⇒ ô cũ `effectiveBytes: number | null` **KHÔNG CÒN
 *      TỒN TẠI**: con số nay đi **cùng mốc đọc của nó** trong `VramAgentEffectiveHeadroom`, nên
 *      câu *"số này không đổi giữa hai lượt đọc"* **không viết ra được nữa** (xem khối ở kiểu ấy).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ KHÔNG DỰNG ĐƯỜNG THỨ HAI (ràng buộc 2)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * File này **không tính lại gì cả**. Nó đọc đúng những hàm/ô mà đường quyết định đọc:
 *   • `vramBroker.decisionStateFor()` — **CÙNG** phép ghép mà `reserve()` chạy (trần · sổ cục bộ +
 *     chung · `computeHeadroom` · `applyEnforcement`). Router **không thể** khai một con số dư địa
 *     khác con số đang cưỡng chế; đó là bảo đảm CẤU TRÚC, không phải một ca test.
 *   • `vramRefusal.vramUnattributedFacts()` — **CÙNG** vị từ mà câu từ chối dùng cho phần KHÔNG
 *     quy trách nhiệm được.
 *   • `vramTickCell.readDecisionTick()` — **ĐÚNG ô mà `reserve()` đọc** (không phải bản ghi chẩn
 *     đoán của `vramReconciler`, thứ có thể lệch nhịp).
 *   • `vramDefer.docTrangThaiHoanVram()` + `kbSyncScheduler.getKbSyncSchedulerStatus().defer`.
 *   • `vramWiring.vramBeginFailureState()` · `vramEnforcement.reconcileIntervalMs()`.
 *
 * ⚠ **KHÔNG đụng tính ĐỒNG BỘ của `reserve()`.** File này `async` (nó đứng sau một lượt gọi tRPC),
 * nhưng nó **không** thêm một `await` nào vào đường quyết định: mọi hàm nó gọi đều đồng bộ và
 * `vramBroker.ts` vẫn **0 khớp `await`/`async` trong mã**.
 *
 * ⚠ **ĐƠN VỊ: BYTE.** MiB chỉ ở câu chữ (Đ4 — không trộn hai thước). Mọi ô thời gian là **ms**.
 */
/**
 * ⚠⚠ M-6 (review Task 1) — **KHÔNG NHẬP `./vramReconciler` Ở ĐÂY.** Bản đầu của Task 1 nhập nó
 * (cho `reconcileIntervalMs` + `readLastReconcileTick`), và vì `server/routers.ts` nhập file này,
 * `vramReconciler` (+ `vramProbe` ⇒ `child_process`) bị kéo lên **đồ thị nạp SỚM của mọi tiến
 * trình** — trước đó nó **chỉ** tới được qua `await import()`. `vramHeadroom.ts` đã ghi rõ repo này
 * **từng trả giá** vì *"một TAI NẠN THỨ TỰ IMPORT"* ở đúng module đó, và `vramTickCell.ts` tồn tại
 * **chỉ để** giữ nó khỏi những đồ thị nhập nhạy cảm. Nay: nhịp làm mới đọc từ `vramEnforcement`
 * (module lá), và hai ô chẩn đoán của nền đi **cùng ô tick** (xem `baseline`, sửa (D)).
 */
import type { BaselineOrigin, VramBaselineDistrustReason, VramPriority, VramReclaimerId } from "./types";
import type { VramLedgerHolderView, VramPreemptOwnerPlan } from "./vramBroker";
import type { HeadroomBasis } from "./vramHeadroom";
import type { VramDegradationReason, VramRefusalCaveat } from "./vramRefusal";
import { vramUnattributedFacts } from "./vramRefusal";
import * as broker from "./vramBroker";
import { readDecisionTick } from "./vramTickCell";
import { sharedLedgerFact, sharedLedgerSelfKey } from "./vramSharedLedger";
import type { SharedLeaseRow } from "./vramSharedLedger";
import { reconcileIntervalMs, SHARED_LEDGER_STALE_AFTER_MS, TICK_STALE_AFTER_MS } from "./vramEnforcement";
import { vramUnledgeredFact, vramBeginFailureState } from "./vramWiring";
import { docTrangThaiHoanVram, vramJobDeferBudgetMs, vramRequestDeferBudgetMs } from "./vramDefer";
import type { VramDeferState } from "./vramDefer";
import { getKbSyncSchedulerStatus } from "../kbSyncScheduler";
/** ★ N11 — **PHÉP CẮT DUY NHẤT của repo** (`shared/textSafety.ts`). Không hàm thứ hai ở đây. */
import { catChuoi } from "@shared/textSafety";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// KIỂU CỦA ẢNH CHỤP
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ Pha 5 Task 5 (N11) — **HAI BỀ MẶT, HAI LUẬT — VÀ ĐÂY LÀ BỀ MẶT *HIỂN THỊ*.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG CẮT MỌI CHUỖI: CẮT MỘT **DANH TÍNH** LÀ PHÁ ĐƯỜNG NỐI HAI MẶT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `owner` · `leaseKey` · `processKey` · `status.owner` · `retryReach.owner` là những chuỗi mà Agent
 * (và người trực) lấy từ **mặt đọc** rồi truyền **THẲNG** vào `vram.preempt` / `vram.releaseStale` /
 * `vram.retryDeferred`. Cắt chúng "cho an toàn" là biến một mặt đọc đúng thành một mặt đọc **không
 * ra lệnh được** — và hỏng theo chiều IM LẶNG (lệnh trả `owner-not-in-local-ledger`, không ai biết
 * vì sao). ⇒ **Chỉ** những ô *câu chữ cho người đọc* mới đi qua kiểu này.
 *
 * ⚠⚠ VÌ SAO LÀ MỘT **KIỂU** CHỨ KHÔNG PHẢI MỘT `string` + MỘT CỜ HÀNG XÓM: một cờ hàng xóm **tách
 * ra được** khỏi câu (người sau render `text` mà quên `truncated`), và tệ hơn, người đọc bị cám dỗ
 * **đo lại** `text.length === TRẦN` — một **bản sao thứ hai của vị từ**, và bản sao ấy còn SAI (câu
 * dài đúng bằng trần thì **không** bị cắt). `shared/textSafety.ts` đã viết đúng bài học đó. Ở đây cờ
 * **nằm trong cùng một giá trị** với câu, và cả hai sinh ra ở **đúng chỗ cắt**.
 *
 * ⚠ `rawLength` là độ dài **trước khi cắt**, đo tại chỗ cắt — để người đọc biết đã mất bao nhiêu
 * chứ không phải đoán. `truncated === false ⇒ rawLength === text.length`.
 */
export interface VramAgentDisplayText {
  readonly text: string;
  /** ★ **KHAI ĐÃ CẮT.** `true` ⇔ `text` **KHÔNG** phải toàn bộ câu. */
  readonly truncated: boolean;
  readonly rawLength: number;
}

/**
 * Trần MỘT ô câu chữ trên mặt đọc. **400 không phải một con số đẹp** — nó là **đúng trần
 * `CAU_TOI_DA` mà `vramPreempt.catCau()` / `vramDefer.catCau()` đã dùng** cho cùng loại câu (câu từ
 * chối). Lấy một con số khác là dựng **hai trần cho một bất biến**.
 */
const CAU_HIEN_THI_TOI_DA = 400;

/**
 * **CỬA DUY NHẤT** dựng một ô hiển thị. Gọi `catChuoi()` của `@shared/textSafety` — không một phép
 * `slice()` thứ hai nào trong file này.
 * ⚠ `null` vào ⇒ `null` ra: *"không có câu"* là một phạm trù RIÊNG, không phải một câu rỗng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ I-3 (review) — **CÁI ĐÃ MẤT Ở TẦNG DƯỚI VẪN LÀ CÁI ĐÃ MẤT.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu chỉ khai **lượt cắt của chính nó**, và một khối chú thích ở đây **ban phước** cho điều
 * đó (*"vô hiệu… và đó là ĐÚNG"*). Đo được: `vramDefer` cắt ở **đúng 400** ⇒ với **5/6 hộ**,
 * `catChuoi(≤400, 400).daCat` **luôn** `false`, trong khi một câu từ chối THẬT **không nối thêm gì**
 * đã **548** ký tự. ⇒ Hợp đồng ở `VramAgentDisplayText` (*"`true` ⇔ `text` KHÔNG phải toàn bộ
 * câu"*) **bị chính lời biện hộ ấy phản bội**, và ô `truncated` thành một **hằng số `false`** —
 * đồng hồ không kim đúng chỗ nó vừa được lắp vào.
 * ⇒ `nguon` là **sự thật của chỗ cắt ở tầng dưới** (`vramDefer.VramDeferRefusalText`). Hai lượt
 * cắt **cộng lại** thành một lời khai: `truncated` là **HOẶC** của hai, `rawLength` là độ dài
 * **NGUYÊN BẢN** — không phải độ dài của mảnh vừa tới tay.
 * ⚠ Không có `nguon` ⇒ chuỗi đến đây là **nguyên bản** (đường `vramWiring.lastReason`,
 * `kbSyncScheduler.note.message` — cả hai **không có trần**), và khi ấy `tho.length` **là** độ dài gốc.
 */
function cauHienThi(
  tho: string | null | undefined,
  nguon?: { readonly daCat: boolean; readonly doDaiGoc: number },
): VramAgentDisplayText | null {
  if (tho === null || tho === undefined) return null;
  const { cau, daCat } = catChuoi(tho, CAU_HIEN_THI_TOI_DA);
  return {
    text: cau,
    truncated: daCat || (nguon?.daCat ?? false),
    rawLength: nguon?.doDaiGoc ?? tho.length,
  };
}

/**
 * ★★★ Pha 4 Task 4 (I-3 + (D) của review Task 2) — **"LỆNH NÀO VỚI TỚI HỘ NÀY TỪ CHỖ ĐỨNG HIỆN
 * TẠI"**, thay cho ô `reclaimable: boolean` đã **BỊ XOÁ KHỎI KIỂU**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO ĐỔI KIỂU CHỨ KHÔNG THÊM MỘT CA TEST (ràng buộc 8)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ô `boolean` cũ khai `reclaimable: true` cho hộ của tiến trình **ANH EM** (nó chỉ hỏi *"chủ hộ đã
 * khai người thi hành chưa"*), trong khi `vram.preempt` **chỉ đọc sổ CỤC BỘ** ⇒ Agent đọc *"thu hồi
 * được"*, ra lệnh, và nhận `owner-not-in-local-ledger`. Một lượt quyết định tiêu vào hư không. Nay
 * lời khai ấy **KHÔNG VIẾT RA ĐƯỢC**: ba nhánh, ba nghĩa, `tsc` bắt mọi người đọc phân biệt.
 *
 * ⚠ `no-reclaimer.why` là **CHÍNH mã từ chối của `preemptStepForOwner()`** (lấy bằng `Extract<>` từ
 * kiểu của broker, không chép tay) ⇒ mặt ĐỌC và mặt LỆNH **không trôi khỏi nhau được**: thêm một
 * nhánh từ chối ở broker là một lỗi `tsc` ở đây, và mọi mã ấy đã có bản dịch (`errors.reason.*`).
 */
export type VramAgentHolderReclaim =
  /** `vram.preempt(owner)` **VỚI TỚI** hộ này từ tiến trình đang trả lời — `reclaimer` sẽ thi hành. */
  | { readonly kind: "reclaimable-here"; readonly reclaimer: VramReclaimerId }
  /**
   * Chủ hộ (tiến trình KHÁC) **đã khai** một người thi hành và hộ đang nhàn rỗi — nhưng **CHỈ TIẾN
   * TRÌNH ĐÓ** thu hồi được. Từ đây `vram.preempt` sẽ trả `owner-not-in-local-ledger`.
   * ⚠ *"đã khai"* KHÔNG phải *"sẽ thành công"*: chính sách nhường chỗ (`quyenNhuong`, §5.2 — vd
   * `production` KHÔNG BAO GIỜ) chỉ tiến trình chủ mới chạy được, ta không đánh giá thay nó.
   */
  | { readonly kind: "declared-by-owner-process"; readonly reclaimer: VramReclaimerId }
  /** **KHÔNG lệnh thu hồi nào** với tới hộ này từ đây. `why` = mã từ chối THẬT của lệnh. */
  | { readonly kind: "no-reclaimer"; readonly why: VramAgentNoReclaimWhy };

/** Lấy thẳng từ kiểu của `preemptStepForOwner()` — **không** một danh sách chép tay thứ hai. */
export type VramAgentNoReclaimWhy = Extract<VramPreemptOwnerPlan, { kind: "refused" }>["reason"];

/**
 * Một hộ đang giữ chỗ **TRONG SỔ**. ⚠ Không phải "một tiến trình đang giữ GPU" — xem
 * `unattributed.holderListIsLowerBound`.
 */
export interface VramAgentHolderView {
  readonly owner: string;
  readonly kind: string;
  /** Byte theo sổ. `null` ⇔ con số không hữu hạn (đã chặn, xem `nonFiniteFields`). */
  readonly bytes: number | null;
  readonly priority: VramPriority;
  /** `true` ⇔ con số do một THƯỚC đẻ ra; `false` ⇔ **ƯỚC LƯỢNG**. */
  readonly measured: boolean;
  /**
   * ★★★ **BÀN GIAO I-3 + (D) ĐÃ TRẢ (Task 4).** Ô `reclaimable: boolean` **KHÔNG CÒN TỒN TẠI** —
   * xem `VramAgentHolderReclaim`. Viết lại nó theo kiểu cũ là một lỗi biên dịch, không phải một
   * dòng chú thích bị bỏ qua.
   *
   * ⚠ Vị từ được HỎI THEO `owner`, đúng như lệnh: `vram.preempt` nhận `owner`, nên câu trả lời ở
   * đây là **kết quả của chính `preemptStepForOwner(owner)`**, không phải một phép so viết lại.
   */
  readonly reclaim: VramAgentHolderReclaim;
  /** `null` = hộ của **CHÍNH tiến trình này**; khác `null` = `${role}:${pid}:${bootMs}` của anh em. */
  readonly processKey: string | null;
  /**
   * ★★★ Pha 4 Task 4 — **TTL CỦA GIẤY PHÉP, VÀ NGƯỜI ĐỌC ĐẦU TIÊN CỦA NÓ.**
   * `null` ⇔ điểm gọi không khai TTL, **hoặc** đây là hộ của anh em (sổ chung không mang ô này).
   *
   * ⚠⚠ **KHÔNG CÓ NGƯỜI GẶT THEO TTL trong hệ.** `VRAM_SIDECAR_TTL_MS` → `sidecarTtlMs()` →
   * `adoptLease({ ttlMs })`, rồi **hết** — không một nhịp nào đọc lại nó. Ô này (và
   * `ttlExpired`) là **người đọc đầu tiên**: Agent thấy một hộ mồ côi đã quá hạn thì tự ra lệnh
   * `vram.preempt`. Đừng đọc `ttlExpired: true` thành *"hệ sắp tự dọn"* — sẽ không có ai dọn.
   */
  readonly ttlMs: number | null;
  /** `null` ⇔ không có TTL để so (xem `ttlMs`). `true` ⇔ tuổi giấy phép đã vượt TTL. */
  readonly ttlExpired: boolean | null;
  /**
   * ★ Pha 4 Task 2 — khoá hàng trong `vram_leases` (`${processKey}#${leaseId}`), tức **đầu vào của
   * lệnh `vram.releaseStale`**. `null` cho hộ CỤC BỘ, và đó KHÔNG phải một ô thiếu: sổ cục bộ là
   * chủ về giấy phép của tiến trình này (`release()` đã trả lời dứt khoát), nên `releaseStale`
   * **từ chối** mọi hàng của chính ta. Không có ô này thì lệnh có mà Agent không gọi được.
   */
  readonly leaseKey: string | null;
}

/**
 * ★★★ `attributable` — HỢP KIỂU CÓ NHÃN, CỐ Ý.
 * `known: false` **KHÔNG** trung tính: nó là **CHẶN TRÊN** của mọi dư địa (xem khối đầu file).
 */
export type VramAgentAttributable =
  | { readonly known: true; readonly bytes: number }
  | {
      readonly known: false;
      readonly meaning: "headroom-upper-bound";
      /** `no-tick` = CHƯA CÓ NHỊP NÀO (cấu trúc, không tự lành) · `probe-blind` = nhịp này không tính được. */
      readonly reason: "no-tick" | "probe-blind" | "invalid-input";
    };

/** ★★★ Sổ chung: **CHƯA LÀM MỚI LẦN NÀO** là một phạm trù RIÊNG, không phải `bytes: 0`. */
export type VramAgentForeignLedger =
  | {
      readonly known: true;
      readonly bytes: number | null;
      readonly holders: readonly VramAgentHolderView[];
      /** Tuổi bản sao đọc (ms). ⚠ So với `sharedRefreshIntervalMs` để biết nó có tươi không. */
      readonly ageMs: number | null;
      readonly stale: boolean;
      /** Lượt ghi CỦA TA chưa lên sổ chung ⇒ **anh em KHÔNG thấy ta**. */
      readonly unsyncedWrites: number | null;
      /** Lượt đồng bộ HỎNG LIÊN TIẾP. `≥ 1` ⇒ tuổi sẽ KHÔNG tự trẻ lại. */
      readonly consecutiveFailures: number | null;
      /**
       * ★★★ Pha 6 Task 5 (I-2, đầu THỨ BA) — Số hàng **CỦA TA** đang công bố dưới một **DANH TÍNH
       * CỤT** (`owner`/`leaseKey`/`processKey`/`role`/`leaseId` vượt bề rộng cột ⇒ bị cắt).
       *
       * ⚠⚠ **KHÔNG PHẢI `unsyncedWrites`**, và gộp hai ô là gộp hai sự cố có hai cách chữa khác
       * nhau: `unsyncedWrites > 0` = *"anh em CHƯA THẤY ta"* (đợi một nhịp đồng bộ là hết);
       * ô này = *"anh em ĐANG THẤY ta, dưới một cái tên KHÔNG PHẢI tên ta"* (không tự hết — phải
       * đổi thư mục model hoặc nới cột, và nới cột là một lượt DDL cần chủ dự án duyệt).
       * ⚠ Hệ quả đọc được của một danh tính cụt: nút *Thu hồi* gửi `preempt({owner})` với chuỗi
       *   **của mặt đọc**, còn sổ giữ chuỗi **đã cắt** ⇒ hai chuỗi không khớp nhau.
       * ⚠ `> 0` mà `holders[].owner` trông vẫn bình thường là **hành vi ĐÚNG**: đây là hàng của
       *   **TA**, còn `holders` là hàng của **ANH EM** — hai tập rời nhau (`dungBanSao()` lọc).
       */
      readonly truncatedIdentityWrites: number | null;
    }
  | {
      readonly known: false;
      /** ⚠ ĐANG MÙ về anh em — TUYỆT ĐỐI không phải "không tiến trình nào khác giữ gì". */
      readonly meaning: "never-refreshed-blind-to-siblings";
    };

/** Ô tick — ô mà `reserve()` THẬT SỰ đọc. */
export type VramAgentTick =
  | { readonly present: false; readonly meaning: "no-tick-blind" }
  | {
      readonly present: true;
      readonly ageMs: number | null;
      readonly staleAfterMs: number;
      readonly stale: boolean;
      /** `≥ 1` ⇒ nhịp đang hỏng liên tiếp: tuổi chỉ tăng, KHÔNG tự lành. */
      readonly consecutiveFailures: number | null;
    };

/**
 * ★★★ TRẠNG THÁI HOÃN CỦA MỘT HỘ — **KHÔNG CÓ PHẠM TRÙ `"idle"`, VÀ ĐÓ LÀ CHỦ ĐÍCH.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ C-1 (review Task 1) — KHỐI NÀY TỪNG KHAI MỘT TRẠNG THÁI NÓ **KHÔNG QUAN SÁT ĐƯỢC**.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cả hai nguồn — `vramDefer.oTrangThai` (Map mức module) và `kbSyncScheduler.deferStreak` — là ảnh
 * chụp **TRONG BỘ NHỚ CỦA TIẾN TRÌNH ĐANG TRẢ LỜI**. Nhưng cron `kb:sync` và hai sidecar job sống ở
 * tiến trình **`worker`** (`backgroundJobs.startBackgroundSchedulers`), còn `vram.state` được phục
 * vụ ở **`api`**. ⇒ Một `"idle"` phát ra từ `api` là một **LỜI KHẲNG ĐỊNH** (*"không có chuỗi hoãn
 * nào"*) về một thứ tiến trình này **không nhìn thấy** — trong khi `cron:kb-sync` có thể đã
 * `exceeded` nhiều giờ ở worker. Repo **đã viết đúng lời rào đón này** ở người tiêu thụ khác
 * (`aiLocalKnowledgeService.readVramDefer`) và bản đầu của Task 1 **không mang theo**.
 *
 * ⇒ Phạm trù `"idle"` bị **XOÁ KHỎI KIỂU**, thay bằng `"no-chain-in-this-process"`. Đó là ràng
 * buộc 8 (*"đổi KIỂU, đừng thêm ca"*): mọi người tiêu thụ từng đọc `"idle"` như một câu trả lời
 * TOÀN CỤC nay **gãy lúc biên dịch**, thay vì im lặng đọc sai. Và Task 2 (`retryDeferred`) đọc
 * thẳng khối này, nên một trường nói quá ở đây **đã là một hành động sai**.
 *
 * ⚠ Vết BỀN xuyên tiến trình đã có sẵn: `vram_events` (`defer` / `defer_exceeded`). Ai cần số
 * THẬT của cả cụm thì truy bảng đó, không phải ô này.
 */
export type VramAgentDeferStatus =
  | {
      /** Tiến trình này **KHÔNG quan sát được** hộ. `"no-chain-in-this-process"` KHÔNG áp dụng. */
      readonly kind: "not-observable-here";
      readonly meaning: "host-not-running-in-this-process" | "defer-state-unreadable";
    }
  | {
      /**
       * ⚠ **KHÔNG CÓ CHUỖI HOÃN NÀO TRONG TIẾN TRÌNH NÀY** — không phải "hộ này ổn". Xem
       * `hostedHere`: `null` ⇒ ta **không chứng minh được** hộ có chạy ở đây hay không.
       */
      readonly kind: "no-chain-in-this-process";
    }
  | {
      readonly kind: "deferring";
      /** ★ **DANH TÍNH** (owner THẬT của chuỗi đang sống) — **KHÔNG BAO GIỜ bị cắt**. */
      readonly owner: string;
      readonly attempts: number | null;
      readonly firstRefusedAt: string | null;
      readonly nextRetryAt: string | null;
      /** ★ N11 — **CÂU CHỮ**, không phải danh tính ⇒ cắt **và khai đã cắt**. */
      readonly lastRefusalMessage: VramAgentDisplayText | null;
      /** ★ M-7 — ngân sách **CHỐT LÚC BỊ TỪ CHỐI**, thứ điều khiển hạn chót đang chạy. */
      readonly chainBudgetMs: number | null;
    }
  | {
      readonly kind: "exceeded";
      /** ★ **DANH TÍNH** — xem nhánh `deferring`. */
      readonly owner: string;
      readonly attempts: number | null;
      readonly firstRefusedAt: string | null;
      readonly lastRefusalMessage: VramAgentDisplayText | null;
      readonly chainBudgetMs: number | null;
    };

/**
 * ★★★ MỘT HỘ `background`, VÀ **BA Ô KHÔNG ĐƯỢC GỘP**.
 *
 * ⚠⚠ `mechanism` trả lời *"hộ này CÓ ĐỢI không"*; `hostedHere` trả lời *"tiến trình này có nhìn
 * thấy hộ không"*; `status` trả lời *"nó CÓ ĐANG hoãn không, THEO CHỖ ĐỨNG NÀY"*.
 * **3/6 hộ có ngân sách 0** — chúng **KHÔNG chờ một mili giây nào**, chúng **suy giảm tại chỗ**
 * (`aiReranker.rerank()` trả về thứ tự cosine gốc; `getEmbeddingContext` ném một câu đã nói đúng
 * nguyên nhân). Với những hộ đó, `no-chain-in-this-process` **KHÔNG** nghĩa *"nó đã xin được
 * VRAM"* — nó nghĩa *"không có chuỗi hoãn, vì hộ này không bao giờ hoãn"*. Gộp ba ô lại là **nói
 * dối bằng cách im lặng**.
 */
/**
 * ★★★ Pha 5 Task 5 (N12) — **MỘT MẪU KHÔNG PHẢI MỘT DANH TÍNH, VÀ NAY NÓ KHÔNG CÒN *GIẢ VỜ* LÀ MỘT
 * CHUỖI ĐỂ AI ĐÓ TRUYỀN NHẦM VÀO LỆNH.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO ĐỔI KIỂU CHỨ KHÔNG THÊM MỘT CA TEST (ràng buộc 8)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `ownerPattern` là **câu chữ mô tả khuôn** (`"gguf-embed-ctx:<modelId>"`,
 * `"cuda-backend:reranker | reranker:<modelPath>"`). Khi nó là `string`, câu **SAI**
 * `retryDeferred.mutate({ owner: h.ownerPattern })` biên dịch **sạch** và chỉ hỏng lúc chạy
 * (`unknown-background-host`). Nay nó là một **OBJECT** ⇒ mọi chỗ đòi một `owner: string` **từ chối
 * nó lúc BIÊN DỊCH**, ở **mọi** điểm gọi, không chỉ ở điểm gọi mà một lưới nghĩ ra được.
 * ⚠ Đây là *"phát biểu cái nó PHẢI LÀ"*: danh tính nằm ở `retryReach.owner` (xem dưới) và **chỉ**
 * lấy được ở nhánh mà lệnh **thật sự với tới** — không có đường nào để đọc một danh tính từ một hộ
 * mà lệnh từ chối.
 */
export interface VramAgentOwnerPattern {
  /** Câu chữ **cho người đọc**. Không lệnh nào nhận nó. */
  readonly patternText: string;
}

export interface VramAgentDeferHostView {
  readonly host: string;
  /**
   * Khuôn `owner` mà hộ này sinh ra (một số hộ có `owner` ĐỘNG: đường dẫn model / id model).
   * ⚠ **MẪU, KHÔNG PHẢI DANH TÍNH** — xem `VramAgentOwnerPattern`.
   */
  readonly ownerPattern: VramAgentOwnerPattern;
  /**
   * Đáy hoãn (ms) theo **cấu hình HIỆN TẠI**, đọc từ đúng hàm ngân sách của điểm gọi. `0` = "đừng
   * đợi, kêu ngay". ⚠ M-7 — đây là ngân sách mà một chuỗi **MỚI** sẽ nhận, KHÔNG phải ngân sách
   * của chuỗi đang sống (ô đó là `status.chainBudgetMs`, chốt lúc bị từ chối).
   */
  readonly budgetMs: number | null;
  readonly mechanism: "waits-and-retries" | "no-wait-degrades-in-place";
  /**
   * ★★★ C-1 — **TIẾN TRÌNH NÀY CÓ CHỦ TRÌ HỘ KHÔNG.**
   * `true`/`false` = **chứng minh được** · `null` = **KHÔNG XÁC ĐỊNH ĐƯỢC** (không có cơ chế nào
   * trả lời câu đó cho hộ này) ⇒ `status` chỉ nói về **chỗ đứng này**, đừng đọc thành toàn cục.
   */
  readonly hostedHere: boolean | null;
  readonly status: VramAgentDeferStatus;
  /**
   * ★★★ Pha 4 Task 4 — NỬA SAU CỦA CÙNG MỘT BÀN GIAO ((D) của review Task 2): *"lệnh nào với tới
   * hộ này từ CHỖ ĐỨNG hiện tại"*. Cùng câu hỏi mà `VramAgentHolderReclaim` trả lời cho hộ giữ
   * chỗ — nên nó là **MỘT hạng mục**, không phải hai.
   */
  readonly retryReach: VramAgentDeferRetryReach;
}

/**
 * ★★★ (D) — **`vram.retryDeferred` CÓ VỚI TỚI HỘ NÀY KHÔNG.**
 *
 * ⚠⚠ Ở tiến trình `api`, lệnh **luôn** trả `host-not-running-in-this-process` cho `cron:kb-sync`
 * (cron sống ở `worker`) và `no-retry-mechanism-for-this-host` cho **cả 5 hộ còn lại** — tức
 * **6/6 hộ vô vọng ở `api`**, và Agent tiêu một lượt gọi cho mỗi hộ để biết. Mặt ĐỌC nói trước, và
 * nó nói bằng **cùng vị từ** (`kbSyncScheduler.coChuTriCronODay()` qua `hostedHere`) chứ không bằng
 * một phép so viết lại — nếu không, mặt đọc và lệnh sẽ trôi khỏi nhau đúng như C-1 đã cảnh báo.
 * ⚠ `unknown` là một phạm trù RIÊNG: ô trạng thái cron đọc không được ⇒ ta **không biết**, và
 * `false` ở đây sẽ là một lời khẳng định không có dữ liệu đỡ.
 */
export type VramAgentDeferRetryReach =
  | {
      readonly kind: "reachable-here";
      /**
       * ★★★ Pha 5 Task 5 (N12) — **DANH TÍNH THẬT ĐỂ RA LỆNH**, chốt cùng lời hứa *"với tới được"*.
       *
       * ⚠⚠ Trước bản này mặt đọc **không phát ra danh tính nào**, nên người gọi tự nặn lấy một cái:
       * `VramBrokerPanel.tsx` gửi `h.host` (TÊN HỘ). Đo được: `vramBackgroundHostForOwner(h.host)`
       * trả `null` cho **2/6** hộ (`reranker`, `gguf-embed-ctx` — hai hộ có `owner` ĐỘNG, tên hộ
       * **không tồn tại** như một owner) ⇒ lệnh trả `unknown-background-host`.
       * ⇒ Ô này là **chính chuỗi** mà `vram.retryDeferred` nhận, và bất biến *"nó phân giải NGƯỢC
       * về đúng hộ này"* có lưới (`vramReadModel.surface.test.ts`). Lời hứa và đầu vào của lời hứa
       * **đi cùng một nhánh**: ô `owner` **chỉ tồn tại** ở nhánh `reachable-here`.
       *
       * ⚠⚠ **ĐÍNH CHÍNH (I-1, review) — ĐỪNG ĐỌC CÂU TRÊN THÀNH MỘT ĐIỀU MẠNH HƠN SỰ THẬT.** Bản
       * đầu của khối này viết *"không có cách nào đọc được một danh tính từ một hộ không với tới"*
       * — **SAI**. Trên **cùng một đối tượng** còn `h.host` (một `string` trần, có ở **mọi** nhánh)
       * và `h.ownerPattern.patternText`; `input` của lệnh là `z.string()` nên **cả hai đều biên
       * dịch sạch**. Kiểu chỉ chặn được việc truyền **giá trị `ownerPattern`**. Thứ chặn hai đường
       * còn lại là một **LƯỚI AST** trên chính điểm gọi của panel
       * (`client/src/lib/vramCommandReach.unit.test.ts` — *"`owner` PHẢI LÀ `….retryReach.owner`"*),
       * **không** phải hệ kiểu. Chặn bằng kiểu đòi brand `input` của lệnh — nợ đã khai.
       */
      readonly owner: string;
    }
  | { readonly kind: "unreachable"; readonly why: VramDeferRetryUnreachable }
  | { readonly kind: "unknown"; readonly why: "defer-state-unreadable" };

/**
 * Hai mã DÙNG CHUNG với `VramRetryDeferredCommandReason` (`vramCommands.ts` nhập lại **chính kiểu
 * này**) — một định nghĩa, hai mặt. Cả hai đã có bản dịch trong không gian `errors.reason.*`.
 */
export type VramDeferRetryUnreachable =
  | "no-retry-mechanism-for-this-host"
  | "host-not-running-in-this-process";

/** Khối hoãn — mang **PHẠM VI** của chính nó, không để người đọc tự đoán. */
export interface VramAgentDeferView {
  /**
   * ★★★ C-1 — **PHẠM VI CỦA MỌI Ô TRONG `hosts`.** Không có ô này thì `hosts[].status` là một lời
   * khẳng định toàn cục mà dữ liệu không đỡ nổi.
   */
  readonly scope: "this-process-only";
  /** Ai đang quan sát — `${role}:${pid}:${bootMs}`. So với `hosts[].hostedHere` để đọc đúng. */
  readonly observedFromProcessKey: string;
  /** Vết BỀN, xuyên tiến trình, cho ai cần số THẬT của cả cụm. */
  readonly durableTrace: "vram_events(defer|defer_exceeded)";
  readonly hosts: readonly VramAgentDeferHostView[];
}

/**
 * ★★★ Pha 6 Task 2 — **DƯ ĐỊA HIỆU LỰC: MỘT ĐẠI LƯỢNG ĐANG CHẢY, VÀ NAY NÓ THÔI GIẢ VỜ LÀ MỘT CON
 * SỐ ĐỂ AI ĐÓ SO TRƯỚC/SAU.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO ĐỔI KIỂU CHỨ KHÔNG THÊM MỘT DÒNG CẢNH BÁO (ràng buộc 8)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **Pha 4 dùng chính ô này làm bằng chứng *"sổ không đổi"* — và TRÚNG NHỜ MAY.** Pha 5 đo được cả
 * hai chiều hỏng của nó, trên **cùng một ô**:
 *
 *   • **DƯƠNG TÍNH GIẢ** (nghiệm thu sống Pha 5, §5): `−426.640.456 B` giữa hai lượt đọc cách nhau
 *     vài giây **trong khi không một byte nào đổi** — `ledger.localBytes`, danh sách hộ và
 *     `nvidia-smi` giống hệt. Chứng cứ đối chứng: 9 lượt đọc/40 s, **không lệnh nào**, hai con số
 *     (`30.725.037.092` → `28.771.770.368`), thuần theo `foreign.ageMs` leo `59 → 5.088 ms`.
 *   • **ÂM TÍNH GIẢ** (nghiệm thu sống Pha 4, F4): **KHÔNG đổi một byte** (`23.470.170.112` ở cả
 *     hai đầu) sau một lượt thu hồi **THÀNH CÔNG 5.030 MiB** — vì `used = max(sổ, attributable)`
 *     bị **GHIM** bởi phép đo thiết bị của nhịp CŨ.
 *
 * ⇒ Một ô hỏng ở **cả hai chiều** thì thêm bao nhiêu ca test cũng không cứu: người sau vẫn viết
 * `expect(sau.headroom.effectiveBytes).toBe(truoc.headroom.effectiveBytes)` và **vẫn xanh khi may**.
 * Nên con số **đi cùng DẤU ĐỌC của nó, trong CÙNG MỘT GIÁ TRỊ**: hai lượt đọc cho hai giá trị
 * **KHÁC NHAU về cấu trúc** — kể cả khi số byte tình cờ trùng. Câu *"nó không đổi"* không còn phát
 * biểu được, đúng khuôn đã dùng bốn lần trong chuỗi pha này (`reclaimable` →
 * `VramAgentHolderReclaim`, `ownerPattern` → `VramAgentOwnerPattern`, …).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ #1 (review) — **BẢN ĐẦU DÙNG `Date.now()` LÀM MỐC, VÀ NÓ TRÙNG ĐƯỢC.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đo được: trên đồng hồ THẬT, **18/20** cặp lượt đọc liên tiếp có **cùng một mili giây** ⇒ hai ảnh
 * chụp `effective` **BẰNG NHAU TUYỆT ĐỐI** — và ca *"sổ không đổi"* xanh **dù 5,27 GB vừa rời sổ**.
 * Tức cổng ra **không đạt ở dạng mạnh**, và khối docstring cũ (*"KHÔNG BAO GIỜ bằng nhau"*) **BAN
 * PHƯỚC cho đúng cái lỗ ấy** — lớp lỗi *"docstring mâu thuẫn hợp đồng"* mà Pha 5 gặp **ba** lần.
 * ⇒ Mốc **không được là đồng hồ tường**. `readMark` là `${processKey}#${sốĐếmĐƠNĐIỆU}` — một dấu
 * **KHÔNG TRÙNG ĐƯỢC**: đơn điệu tăng trong một tiến trình, và `processKey` (`role:pid:bootMs`)
 * tách hai tiến trình. `readAtMs` **ở lại** vì nó trả lời *"bao giờ"*, nhưng nó **KHÔNG** còn là
 * thứ bảo đảm hai lượt đọc khác nhau.
 *
 * ⚠ **ĐƯỜNG KHÔNG CHỌN, VÀ VÌ SAO:** *gắn nhãn (brand) cho con số* (`number & {…}`) làm `tsc` đỏ ở
 * **mọi** điểm tiêu thụ — kể cả những phép so **HỢP LỆ CÙNG THỜI ĐIỂM** (`vramRouter.test.ts` so ô
 * này với `reserve().decision.effectiveHeadroomBytes` của **cùng một mốc**, một lưới có răng). Đó
 * là **BẮT NHẦM**, và chiều bắt nhầm bị bỏ qua thường xuyên hơn chiều bắt. Nên `bytesAtReadMs` vẫn
 * là một `number | null` trần: so **cùng mốc** vẫn viết được, so **khác mốc** thì phải tự tay bóc
 * con số ra khỏi mốc của nó — một hành động **nhìn thấy được** và bị lưới
 * `vramReadModel.drift.test.ts` cưỡng chế phân loại.
 *
 * ⚠ **HỆ KIỂU KHÔNG CẤM ĐƯỢC `a === b` GIỮA HAI SỐ** — khai thẳng giới hạn thay vì hứa quá (đúng
 * lỗi mà cả file này tồn tại để diệt). Thứ đóng phần còn lại là **PHÉP PHÂN LOẠI CÓ ĐO** ở
 * `vramReadModel.drift.test.ts`: *mọi* ô của ảnh chụp phải tự khai **ĐỔI-THEO-ĐỒNG-HỒ** hay
 * **KHÔNG-ĐỔI-THEO-ĐỒNG-HỒ**, và bản khai ấy bị **phép đo** chấm — không phải bị một docstring.
 */
export interface VramAgentEffectiveHeadroom {
  /**
   * Con số cưỡng chế **TẠI `readAtMs`, KHÔNG PHẢI MỘT LÚC NÀO KHÁC.** `null` ⇔ không hữu hạn (bị
   * chặn CÓ TÊN — xem `nonFiniteFields`, đường `headroom.effective.bytesAtReadMs`).
   */
  readonly bytesAtReadMs: number | null;
  /**
   * ★★★ **DẤU ĐỌC — THỨ LÀM HAI LƯỢT ĐỌC KHÔNG BAO GIỜ BẰNG NHAU.** `${processKey}#${seq}`.
   *
   * ⚠⚠ **VÌ SAO KHÔNG PHẢI ĐỒNG HỒ** (#1 của review, đo được): hai lượt đọc liên tiếp rơi vào
   * **cùng một mili giây** ở **18/20** cặp trên đồng hồ thật ⇒ một mốc `Date.now()` **trùng
   * được**, và khi nó trùng thì `toEqual(truoc, sau)` **xanh dù 5,27 GB vừa rời sổ**. `seq` là một
   * bộ đếm **ĐƠN ĐIỆU TĂNG** của tiến trình (không đọc đồng hồ, không phụ thuộc tải), còn
   * `processKey` = `role:pid:bootMs` tách hai tiến trình — **không có hai lượt đọc nào cùng dấu**.
   * ⚠ Nó ở **trong** giá trị chứ không nằm cạnh vì một ô hàng xóm **tách ra được**, còn cái này
   * thì không — đúng bài học của `VramAgentDisplayText`.
   */
  readonly readMark: string;
  /**
   * *"Bao giờ"* — mốc tường của lượt đọc. Luôn **đúng bằng** `atMs` của chính ảnh chụp (cùng một
   * hằng, một chỗ gán; có ca khoá).
   * ⚠⚠ **KHÔNG** phải thứ bảo đảm hai lượt đọc khác nhau — nó **TRÙNG ĐƯỢC** (xem `readMark`).
   */
  readonly readAtMs: number;
  /** ★ LUÔN `true`. Đọc thẳng: **ô này KHÔNG dùng được làm bất biến so-sánh-trước-sau.** */
  readonly notAnInvariant: true;
  /**
   * Những ô **ĐANG CHẢY** đã sinh ra con số trên — **con trỏ, KHÔNG phải bản sao** (ràng buộc
   * *"đừng dựng người ghi thứ hai cho một bất biến đã có chủ"*). Mỗi đường ở đây bị lưới chấm
   * bằng **phép đo**: nó phải thật sự đổi khi **chỉ đồng hồ** nhích.
   */
  readonly variesWith: typeof VRAM_EFFECTIVE_VARIES_WITH;
  /**
   * ★★★ **BẤT BIẾN ĐÚNG cho một phép so TRƯỚC/SAU — và nó là một PHÉP HỘI, không phải một danh
   * sách để chọn một món.**
   *
   * ⚠⚠ `headroom.rawBytes` **MỘT MÌNH KHÔNG ĐỦ**, và đây là số đo chứ không phải lo xa: ở ca F4 nó
   * **cũng đứng yên** khi 5.030 MiB rời sổ thật, vì `used = max(sổ, attributable)` bị ghim bởi
   * nhịp đo cũ. Thứ mang bằng chứng của một lượt đổi SỔ là `ledger.localBytes` + danh tính/byte của
   * hộ; thứ mang bằng chứng của một lượt đổi **THIẾT BỊ** là `nvidia-smi`. Bỏ một vế là mở lại đúng
   * cái bẫy vừa đóng.
   *
   * ⚠⚠⚠ **VÀ ĐÂY LÀ ĐÍNH CHÍNH CHO CHÍNH BẢN KHAI ẤY** (đo được ở `vramReadModel.drift.test.ts`
   * §5): *"danh sách hộ"* đọc **nguyên khối** thì **KHÔNG** bất biến theo đồng hồ —
   * `localHolders[].ttlExpired` lật `false → true` mà **không một byte nào đổi**. ⇒ vế thứ ba của
   * bằng chứng là **`owner` + `bytes` của hộ**, không phải cả đối tượng hộ. Một danh sách "bất
   * biến đúng" cũng có phần tử thứ N+1 của nó.
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ RR-A — **BA LƯỢT LIỆT KÊ LIÊN TIẾP, BA LẦN THIẾU MỘT VẾ KHÁC. THÔI LIỆT KÊ.**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Lịch sử của **chính ô này**, cả ba đều **ĐO ĐƯỢC**, không phải lo xa:
   *   • bản của **kế hoạch** (4 vế, sổ CỤC BỘ) ⇒ **1.572.864.000 B rời SỔ CHUNG** hoàn toàn vô
   *     hình (`rawBytes` `23.679.991.808` ở cả hai đầu — bị `attributable` ghim);
   *   • bản **9 vế** (thêm sổ chung) ⇒ vẫn mù **BA** lượt đổi thật: một hộ cục bộ đổi `priority`
   *     `background→production` **và** `ttlMs` `60.000→null` mà **giữ nguyên `owner`+`bytes`**
   *     (⇒ hộ vừa chuyển từ **thu hồi được** sang **KHÔNG**, và **0 byte rời card** nên
   *     `nvidia-smi` cũng mù); một hộ anh em **sang tiến trình khác**; một nhịp đo mới hạ
   *     `attributable` **1 GiB** trong khi **sổ đè** nên `usedBytes`/`rawBytes` không nhúc nhích.
   *   • Và **mỗi lần**, ô nói ra sự thật **ĐÃ NẰM SẴN** ở vế **KHÔNG-ĐỔI-THEO-ĐỒNG-HỒ** của phép
   *     phân loại — chỉ là bản khai không mời nó.
   *
   * ⇒ Lời giải **không phải vế thứ 10**, mà là **thôi liệt kê**: bằng chứng là **CẢ TẬP** ô đã
   * được **PHÉP ĐO** chứng minh là bất biến theo đồng hồ. Đó cũng đúng khuôn đã dùng cho #4 (vét
   * cạn theo **KIỂU**, không theo một cảnh dựng): **SUY RA, ĐỪNG LIỆT KÊ.**
   *
   * ⚠ Hệ quả phải biết: một ô **ĐỔI-THEO-ĐỒNG-HỒ** **không bao giờ** là bằng chứng được (nó nhúc
   * nhích khi chẳng có gì xảy ra), nên một lượt đổi chỉ chạm những ô ấy là **KHÔNG chứng minh
   * được bằng payload** — phải đo bằng `nvidia-smi` hoặc `vram_events`. Khai ra, không hứa quá.
   * ⚠ `vramReadModel.drift.test.ts` §7 giữ lượng từ trên **LƯỢT ĐỔI**: ***MỌI lượt đổi THẬT dựng
   * được PHẢI làm ÍT NHẤT MỘT ô của tập ấy nhúc nhích*** — một lượt đổi vô hình là ca ĐỎ **có tên**.
   */
  readonly beforeAfterEvidence: typeof VRAM_BEFORE_AFTER_EVIDENCE;
}

/**
 * ★★★ **MỘT BẢN DUY NHẤT** của hai câu khai trên — kiểu suy TỪ hằng, không viết hai lần.
 *
 * ⚠⚠ VÌ SAO: bản đầu chép chuỗi ở **hai chỗ** (khai trong `interface` và giá trị trong người dựng),
 * và trong chính lượt vá này chúng **ĐÃ TRÔI KHỎI NHAU** — sửa một chỗ, quên chỗ kia, `tsc` bắt
 * được nhưng **lưới chạy trước `tsc`** nên bộ ca đỏ với một lý do khó đọc. Đây đúng ràng buộc
 * *"đừng dựng bản sao thứ hai của một sự thật"*. Nay `typeof` ⇒ **không thể** lệch.
 */
export const VRAM_EFFECTIVE_VARIES_WITH = [
  "tick.ageMs",
  "ledger.foreign.ageMs",
  "headroom.charges.staleMarginBytes",
  "headroom.charges.sharedLedgerMarginBytes",
  "headroom.charges.distrustChargeBytes",
] as const;

/**
 * Xem `VramAgentEffectiveHeadroom.beforeAfterEvidence`. **MỘT LUẬT, KHÔNG PHẢI MỘT DANH SÁCH** —
 * và vì thế **không có con số "bao nhiêu vế"** ở đâu cả: số vế **suy ra** từ chính bản phân loại,
 * tại chỗ chấm. Ba lượt liệt kê trước đây, ba lần thiếu một vế khác (xem khối docstring ở kiểu).
 */
/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ Pha 7 Task 2 — **VÌ SAO CÂU NÀY NAY LÀ ASCII, VÀ ĐÓ KHÔNG PHẢI MỘT LƯỢT DỌN CHO GỌN.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản trước là một câu **tiếng Việt**. Đo được ở Pha 7: ô này có **0 người đọc** — và nó **KHÔNG
 * THỂ** có một người đọc thật chừng nào còn là tiếng Việt:
 *   • mặt **Agent** (`textSummary`) bị `vramPhrases.exhaustive.test.ts` §C cưỡng chế
 *     *"`lang=en` ⇒ KHÔNG một chữ cái phi-ASCII nào"* và *"`lang=zh` ⇒ KHÔNG một dấu tiếng Việt
 *     nào"* ⇒ in nguyên văn câu cũ vào bản tóm tắt là **hai ca ĐỎ**;
 *   • mặt **NGƯỜI** (panel) đi qua lớp dịch ba locale (Pha 7 Task 1) ⇒ render thẳng một câu tiếng
 *     Việt của máy chủ là **mở lại đúng lỗ i18n** mà Task 1 vừa đóng.
 * ⇒ Đây là một **NHÃN MÁY ĐỌC**, cùng hạng với `basis` / `caveat` / `estimateKind` / `durableTrace`
 * — những ô ASCII mà cả ba ngôn ngữ đã in **nguyên văn** từ Pha 4. Nội dung LUẬT không đổi một ly:
 * ba cái răng của nó (`RR-A`, `vramReadModel.drift.test.ts` §4) vẫn nguyên — **con trỏ tới bản
 * phân loại**, **bằng chứng NGOÀI payload** (`nvidia-smi`), và **CẢ TẬP chứ không vài ô được chọn**.
 */
export const VRAM_BEFORE_AFTER_EVIDENCE =
  "EVERY field declared CLOCK-INVARIANT (measured classification in " +
  "server/services/vram/vramReadModel.drift.test.ts) + nvidia-smi(memory.used) " +
  "- THE WHOLE SET, NOT A CHOSEN FEW";

export interface VramAgentState {
  readonly atMs: number;
  /** Danh tính của tiến trình đang trả lời — `${role}:${pid}:${bootMs}`. */
  readonly processKey: string;
  /**
   * ★★★ MỌI Ô SỐ BỊ CHẶN VÌ KHÔNG HỮU HẠN, **GỌI TÊN TỪNG ĐƯỜNG DẪN**.
   *
   * ⚠ `-Infinity` là giá trị fail-closed **HỢP LỆ** của `computeHeadroom()` (đầu vào vô nghĩa ⇒ từ
   * chối mọi lượt xin). Nó phải bị chặn TRƯỚC khi ra API — `bigint(mode:"number")` từ chối
   * `"-Infinity"` (mất **cả lô** sự kiện) và `JSON.stringify(-Infinity)` cho `null` **im lặng** —
   * nhưng chặn **CÓ TÊN**: ô bị thay bằng `null` và đường dẫn của nó nằm ở đây. Rỗng ⇔ không ô nào
   * bị chặn.
   */
  readonly nonFiniteFields: readonly { readonly path: string; readonly was: string }[];

  readonly ledger: {
    readonly localBytes: number | null;
    readonly localHolders: readonly VramAgentHolderView[];
    readonly foreign: VramAgentForeignLedger;
    /** `localBytes` + byte anh em — **con số đi vào `computeHeadroom()`**. */
    readonly totalBytes: number | null;
    /**
     * ⚠⚠ **ĐỘ TRỄ CƯỠNG CHẾ THẬT XUYÊN TIẾN TRÌNH.** Bản sao đọc sổ chung làm mới theo nhịp này
     * (mặc định 60.000 ms), nên một giấy phép 17 GB vừa mở ở tiến trình anh em có thể mất tới
     * **trọn một chu kỳ** mới hiện ra ở đây. Trong cửa sổ đó hai bên cùng tưởng card còn trống.
     */
    readonly sharedRefreshIntervalMs: number | null;
    readonly sharedStaleAfterMs: number | null;
  };

  readonly headroom: {
    /**
     * `computeHeadroom()` thô. `null` ⇔ không hữu hạn (xem `nonFiniteFields` + `degradedReasons`).
     * ⚠ **KHÔNG ĐỔI THEO ĐỒNG HỒ** (có lưới đo) ⇒ so được trước/sau — nhưng **chỉ CÙNG với**
     * `ledger.localBytes` + `localHolders` + `nvidia-smi`: xem `beforeAfterEvidence`.
     */
    readonly rawBytes: number | null;
    /**
     * Sau chính sách suy giảm — **con số THẬT SỰ được so với một lượt xin**, và là một **ĐẠI LƯỢNG
     * ĐANG CHẢY**: nó đi cùng mốc đọc của nó. Xem `VramAgentEffectiveHeadroom`.
     */
    readonly effective: VramAgentEffectiveHeadroom;
    /** Vế nào thắng `max(L, A)`. `"ledger-only"` ⇔ MÙ ⇒ CHẶN TRÊN. */
    readonly basis: HeadroomBasis;
    readonly blind: boolean;
    readonly trusted: boolean;
    readonly degradedReasons: readonly VramDegradationReason[];
    readonly usedBytes: number | null;
    readonly ceilingBytes: number | null;
    readonly safetyReserveBytes: number | null;
    /** Các khoản TRỪ của chính sách suy giảm — để dựng lại được phép tính, không phải tin một số vô danh. */
    readonly charges: {
      readonly staleMarginBytes: number | null;
      readonly sharedLedgerMarginBytes: number | null;
      readonly unledgeredChargeBytes: number | null;
      readonly distrustChargeBytes: number | null;
    };
  };

  readonly attributable: VramAgentAttributable;
  readonly tick: VramAgentTick;

  /**
   * ★★★ (D) — **BA Ô, MỘT NGUỒN.** Cả ba đọc từ **ô quyết định** (`vramTickCell`), tức đúng ô mà
   * `reserve()` đọc. Bản đầu của Task 1 lấy `verified` ở đây và `unverifiedReasons`/`origin` ở
   * `vramReconciler.readLastReconcileTick()` — hai ô, không bất biến nào ép cùng nhịp. Nay bất biến
   * là **CẤU TRÚC**, và ô `diagnosticAtMs` (thứ bắt người đọc tự đối chiếu) đã biến mất.
   */
  readonly baseline: {
    readonly verified: boolean;
    /**
     * **VÌ SAO** cờ trên tắt. `null` ⇔ **CHƯA CÓ NHỊP NÀO** (`tick.present === false`) — khác hẳn
     * mảng rỗng, thứ nghĩa *"đã có nhịp và nhịp đó không nêu lý do nào"*.
     */
    readonly unverifiedReasons: readonly VramBaselineDistrustReason[] | null;
    readonly origin: BaselineOrigin | null;
  };

  readonly unattributed: {
    /**
     * Phần **`max(sổ, attributable)`** mà SỔ không giải thích được, với
     * `attributable = deviceUsed − NỀN`. `null` ⇔ **KHÔNG ĐO ĐƯỢC** (≠ `0`).
     *
     * ⚠⚠ I-3 (review Task 1) — **ĐÂY LÀ MỘT CẬN DƯỚI CỦA CON SỐ, KHÔNG CHỈ CỦA DANH SÁCH.** Câu cũ
     * viết *"phần THIẾT BỊ đang dùng mà sổ không giải thích được"* — **nói quá**: mọi byte nằm
     * TRONG nền (sidecar của lượt chạy trước, tiến trình bên thứ ba, desktop compositor — đo được
     * 996–2.112 MiB trên chính máy này) đã bị **TRỪ khỏi `attributable`** nên **không bao giờ**
     * xuất hiện ở con số này. ⇒ `bytes: 0` phát ra được trong khi card có nhiều GB không ai giải
     * thích. Xem `excludesBaselineBytes`.
     */
    readonly bytes: number | null;
    /**
     * ★ LUÔN `true`. Con số `bytes` **loại trừ toàn bộ NỀN THIẾT BỊ** — nó trả lời *"ngoài sổ, KỂ
     * TỪ LÚC CHỤP NỀN"*, không phải *"ngoài sổ trên cả tấm card"*.
     */
    readonly excludesBaselineBytes: true;
    /** Nhãn máy-đọc-được, **CÙNG** vị từ với câu từ chối. */
    readonly caveat: VramRefusalCaveat;
    /** ★ LUÔN `true`. Bản liệt kê hộ là **CẬN DƯỚI** — đừng đọc `holders` như một danh sách đầy đủ. */
    readonly holderListIsLowerBound: true;
    readonly wiredSiteCount: number | null;
    readonly knownSiteRowCount: number | null;
  };

  readonly unledgered: {
    /** ★ ƯỚC LƯỢNG byte đã chạy NGOÀI SỔ. `null` ⇔ không hữu hạn. */
    readonly estimateBytes: number | null;
    /** ★ LUÔN `"estimate"` — con số trên **KHÔNG BAO GIỜ** là một số đo. */
    readonly estimateKind: "estimate";
    /** Số lượt ngoài sổ mà **ngay cả byte cũng không ước được**. */
    readonly unknownCount: number | null;
    /** ★ `false` ⇔ `unknownCount > 0` (hoặc không đếm được) ⇒ **ĐỪNG dùng `estimateBytes` để tính**. */
    readonly estimateUsable: boolean;
    /** `vramBeginFailureState().count` — số lượt `beginVramAllocation()` đã hỏng. */
    readonly beginFailureCount: number | null;
    /**
     * ⚠ M-5 — **CHUỖI THÔ, CHƯA LÀM SẠCH.** Nguồn gồm `.env`, id model trong DB và tên tệp
     * `.gguf`. Task 3 (câu chữ i18n) **KHÔNG được giả định** router đã làm sạch: mọi giá trị đi
     * vào `i18n.t()` phải qua **cùng** hàm làm sạch bất động đã có. Cùng cảnh báo cho
     * `defer.hosts[].status.lastRefusalMessage` và mọi `owner` (chứa đường dẫn model tuyệt đối).
     *
     * ★★★ N11 — **NAY CÓ TRẦN, VÀ TRẦN ẤY TỰ KHAI.** Nguồn (`vramWiring.ts:1628`) là
     * `(err as Error)?.message` **không cắt một ký tự nào**, và ô này có **hai** người đọc thô:
     * `VramBrokerPanel.tsx` render thẳng vào DOM, `vramTools.ts` nhồi vào prompt LLM. Làm sạch là
     * việc của **bề mặt câu chữ** (hai bộ diễn giải, `@shared/textSafety`); **trần** thì phải ở
     * **nguồn**, nếu không mỗi người đọc lại tự nghĩ ra một trần.
     */
    readonly lastReason: VramAgentDisplayText | null;
  };

  readonly defer: VramAgentDeferView;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SÁU HỘ `background` — BẢN KHAI, VÀ VÌ SAO NÓ LÀ MỘT BẢN KHAI
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ DÂN SỐ HOÃN. **6 hộ**, đọc từ chính điểm gọi (`git grep "xinVramCoHoan({"` + cơ chế riêng
 * của `kbSyncScheduler`).
 *
 * ⚠ `budgetMs` KHÔNG được viết bằng tay ở đây — nó gọi **đúng hàm ngân sách mà điểm gọi truyền
 * vào `xinVramCoHoan()`**, nên một lượt đổi `.env` hiện ra ngay và không có bản sao thứ hai của
 * cấu hình. `keu = false` ở mọi lời gọi: đây là đường **CHỈ-ĐỌC**, và chốt "kêu một lần" là một
 * tài nguyên tiêu thụ được — một mặt sức khoẻ bị poll sẽ **ăn mất** tiếng kêu trước khi người
 * vận hành kịp thấy (M-6 của Pha 2B Task 6).
 *
 * ⚠ **LỆCH TÀI LIỆU ↔ MÃ, KHAI THẲNG:** docstring đầu `vramDefer.ts` xếp `cron:kb-eval-gate` vào
 * *đường JOB NỀN* (ngân sách 6 giờ), nhưng `kbSyncScheduler.ts` truyền `vramRequestDeferBudgetMs()`
 * (mặc định **0**). Bảng này khai theo **MÃ ĐANG CHẠY**, vì đó là thứ Agent sẽ gặp.
 */
interface HoChung {
  readonly host: string;
  /** ⚠ CÂU CHỮ mô tả khuôn — **KHÔNG** phải một danh tính (xem `VramAgentOwnerPattern`). */
  readonly ownerPattern: string;
  readonly budget: (kb: KbSyncStatus | null) => number;
}

/**
 * ★★★ N12 — HỘ CÓ **HẸN GIỜ RIÊNG** (`matches: null` ⇒ `vramBackgroundHostHasExternalRetry`).
 *
 * ⚠⚠ `ownerStatic` ở đây là `string`, **KHÔNG** `string | null` — và đó là một ràng buộc, không phải
 * một sự tiện tay: hộ này là hộ **DUY NHẤT** mà `retryReach` phát ra `reachable-here`, tức mặt đọc
 * **hứa** rằng có một lệnh chạy được. Một lời hứa như thế mà **không kèm danh tính để gọi** là đúng
 * lớp lỗi *"mặt đọc hứa nhiều hơn mặt lệnh"*. Nay `tsc` không cho khai một hàng như vậy.
 */
interface HoTuHenGio extends HoChung {
  readonly matches: null;
  /** ⚠ PHẢI phân giải NGƯỢC về chính hàng này (`vramBackgroundHostForOwner`) — có lưới. */
  readonly ownerStatic: string;
}

/** Hộ đi qua `vramDefer.xinVramCoHoan()`. `ownerStatic: null` ⇔ `owner` ĐỘNG (chỉ có MẪU). */
interface HoQuaVramDefer extends HoChung {
  readonly matches: (owner: string) => boolean;
  readonly ownerStatic: string | null;
}

type HoBackground = HoTuHenGio | HoQuaVramDefer;

const HO_BACKGROUND: readonly HoBackground[] = [
  {
    // Cơ chế hoãn RIÊNG của Pha 2B Task 6 (có khôi phục sau khởi động lại) — KHÔNG qua `vramDefer`.
    host: "cron:kb-sync",
    ownerPattern: "cron:kb-sync",
    ownerStatic: "cron:kb-sync",
    budget: (kb) => (kb === null ? Number.NaN : kb.deferBudgetMs),
    matches: null,
  },
  {
    host: "cron:kb-eval-gate",
    ownerPattern: "cron:kb-eval-gate",
    ownerStatic: "cron:kb-eval-gate",
    budget: () => vramRequestDeferBudgetMs(false),
    matches: (o) => o === "cron:kb-eval-gate",
  },
  {
    host: "sidecar:local-trainer",
    ownerPattern: "sidecar:local-trainer",
    ownerStatic: "sidecar:local-trainer",
    budget: () => vramJobDeferBudgetMs(false),
    matches: (o) => o === "sidecar:local-trainer",
  },
  {
    host: "sidecar:llm-finetune",
    ownerPattern: "sidecar:llm-finetune",
    ownerStatic: "sidecar:llm-finetune",
    budget: () => vramJobDeferBudgetMs(false),
    matches: (o) => o === "sidecar:llm-finetune",
  },
  {
    // HAI `owner` (backend CUDA + model), MỘT hộ: cùng đường phục vụ yêu cầu, cùng cách suy giảm.
    host: "reranker",
    ownerPattern: "cuda-backend:reranker | reranker:<modelPath>",
    // ⚠ HAI owner, một trong hai là ĐỘNG ⇒ **KHÔNG có một danh tính tĩnh** cho hộ này. `null` ở đây
    //   là câu trả lời THẬT, không phải một ô bỏ trống: tên hộ `"reranker"` **không** là owner nào.
    ownerStatic: null,
    budget: () => vramRequestDeferBudgetMs(false),
    matches: (o) => o === "cuda-backend:reranker" || o.startsWith("reranker:"),
  },
  {
    host: "gguf-embed-ctx",
    ownerPattern: "gguf-embed-ctx:<modelId>",
    ownerStatic: null,
    budget: () => vramRequestDeferBudgetMs(false),
    matches: (o) => o.startsWith("gguf-embed-ctx:"),
  },
];

/**
 * ★★★ (E) — **DÂN SỐ NÀY CÓ MÁY QUÉT, KHÔNG PHẢI MỘT LỜI HỨA.**
 *
 * `vramReadModel.roster.test.ts` đếm `xinVramCoHoan({ owner: … })` trong mã sản xuất **bằng máy**
 * rồi khẳng định: mọi `owner` quét được khớp đúng MỘT hàng ở đây, **và** mọi hàng đều được ít nhất
 * một `owner` chạm tới. Cùng khuôn với `vramAllocationSites.test.ts` — thứ đã canh
 * `WIRED_ALLOCATION_SITE_COUNT` đúng cách đó, và là tiền lệ nói rằng ở repo này một bản khai tay
 * thì **nhận lưới**, không phải được miễn. Một hộ `background` MỚI mà quên khai ở đây ⇒ ca **ĐỎ**.
 */
export const VRAM_BACKGROUND_HOST_IDS: readonly string[] = HO_BACKGROUND.map((h) => h.host);

/**
 * ★★★ N12 — **DANH TÍNH TĨNH ĐÃ KHAI**, phơi ra cho lưới đối chiếu (`vramReadModel.surface.test.ts`
 * hỏi: *"mỗi danh tính có phân giải NGƯỢC về đúng hộ của nó không"*). `null` ⇔ hộ có `owner` ĐỘNG.
 * ⚠ Đây **không** phải một bản sao của bảng: nó là một **phép chiếu** của chính `HO_BACKGROUND`.
 */
export const VRAM_BACKGROUND_STATIC_OWNERS: readonly {
  readonly host: string;
  readonly ownerStatic: string | null;
}[] = HO_BACKGROUND.map((h) => ({ host: h.host, ownerStatic: h.ownerStatic }));

/**
 * Chỉ dùng cho lưới (E) — **cùng vị từ `matches` mà ảnh chụp dùng**, không phải một bản sao thứ
 * hai: một lưới viết lại phép khớp sẽ xanh trong khi ảnh chụp thật khớp sai.
 * `null` ⇒ KHÔNG hộ nào nhận `owner` này.
 */
export function vramBackgroundHostForOwner(owner: string): string | null {
  for (const h of HO_BACKGROUND) {
    if (h.matches !== null && h.matches(owner)) return h.host;
    if (h.matches === null && h.host === owner) return h.host;
  }
  return null;
}

/**
 * ★★★ M-1 (review vòng 1) — **VỊ TỪ "HỘ NÀY CÓ CƠ CHẾ ĐÁNH THỨC TỪ NGOÀI KHÔNG". MỘT BẢN.**
 *
 * ⚠⚠ Trước bản này có **HAI** phát biểu cho cùng một câu hỏi, và chúng **ngược khuôn nhau**:
 * mặt ĐỌC hỏi `h.matches === null` (đọc từ bản khai dân số) còn lệnh `retryDeferred` hỏi
 * `host !== "cron:kb-sync"` (**một chuỗi cứng**). Docstring của chính bản khai nói *"`matches: null`
 * ⇒ hộ này KHÔNG đi qua `vramDefer` (nó có cơ chế hẹn giờ riêng)"* ⇒ chuỗi cứng là **bản sao thứ
 * hai**: thêm một hộ có hẹn giờ riêng (hoặc đổi tên `cron:kb-sync`) là hai mặt trôi khỏi nhau ngay,
 * và mặt đọc sẽ hứa một lệnh mà mặt lệnh từ chối — đúng lỗi mà (D) được dựng ra để đóng.
 */
/**
 * ⚠ Vị từ nhận **ĐÚNG Ô** `matches` (không nhận cả hàng) và khai `matches is null`: nhờ thế `tsc`
 * thu hẹp được ở **CẢ HAI** nhánh của `docSauHo()`. Một `boolean` trần làm mất phép thu hẹp ở nhánh
 * `else` ⇒ người sau bị cám dỗ viết lại `h.matches === null` tại chỗ, tức dựng lại đúng bản sao thứ
 * hai mà M-1 vừa gỡ.
 */
function coCoCheDanhThucNgoai(matches: ((owner: string) => boolean) | null): matches is null {
  return matches === null;
}

/**
 * ★ N12 — **DẠNG THEO HÀNG** của đúng vị từ trên. **KHÔNG** một phép so thứ hai: thân hàm là một
 * lời gọi `coCoCheDanhThucNgoai()`. Cần dạng này vì `tsc` chỉ thu hẹp được **hàng** (⇒ `ownerStatic`
 * là `string`, không phải `string | null`) qua một vị từ nhận **cả hàng**.
 */
function laHoTuHenGio(h: HoBackground): h is HoTuHenGio {
  return coCoCheDanhThucNgoai(h.matches);
}

/** Dạng theo TÊN HỘ của vị từ trên — `vramCommands.vramRetryDeferredCommand()` gọi ĐÚNG hàm này. */
export function vramBackgroundHostHasExternalRetry(host: string): boolean {
  const h = HO_BACKGROUND.find((x) => x.host === host);
  return h !== undefined && coCoCheDanhThucNgoai(h.matches);
}

/** Hạng NGHIÊM TRỌNG — khi một hộ có nhiều `owner` đang hoãn, ô trạng thái lấy cái NẶNG nhất. */
const HANG: Record<VramAgentDeferStatus["kind"], number> = {
  "not-observable-here": 0,
  "no-chain-in-this-process": 1,
  deferring: 2,
  exceeded: 3,
};

function trangThaiTuOVramDefer(s: VramDeferState): VramAgentDeferStatus {
  const chung = {
    owner: s.owner,
    attempts: s.attempts,
    firstRefusedAt: s.firstRefusedAt,
    /**
     * ★★★ N11 + I-3 — CÂU CHỮ ⇒ cửa cắt-và-khai, **CỘNG sự thật của lượt cắt ở tầng dưới**.
     * `vramDefer` cắt ở đúng 400 và **mang cờ theo**; không cộng nó vào thì `truncated` ở đây là
     * một hằng số `false` cho **cả 5 hộ** đi qua `vramDefer` (I-3).
     */
    lastRefusalMessage: cauHienThi(s.lastRefusal.cau, s.lastRefusal),
    // ★ M-7 — ngân sách CHỐT LÚC BỊ TỪ CHỐI, thứ điều khiển hạn chót đang chạy.
    chainBudgetMs: s.budgetMs,
  } as const;
  return s.exceeded
    ? { kind: "exceeded", ...chung }
    : { kind: "deferring", ...chung, nextRetryAt: s.nextRetryAt };
}

/**
 * ★ M-2 — MỘT lượt đọc `getKbSyncSchedulerStatus()` cho CẢ ảnh chụp. Bản trước đọc hai lần (ngân
 * sách ở một chỗ, trạng thái ở chỗ khác) ⇒ hai ảnh chụp ở hai thời điểm, đúng lớp lỗi mà chính
 * task này vừa vá ở `reserve()` (`safetyReserveBytes` gọi hai lần).
 */
type KbSyncStatus = ReturnType<typeof getKbSyncSchedulerStatus>;

/**
 * ★★★ TRẠNG THÁI HOÃN CỦA CẢ SÁU HỘ — **THEO CHỖ ĐỨNG CỦA TIẾN TRÌNH NÀY.** KHÔNG BAO GIỜ NÉM:
 * một mặt đọc ngã vì một ô phụ thì mất luôn những ô chính (kỷ luật `aiLocalKnowledgeService`).
 *
 * ⚠⚠ C-1 — không một nhánh nào ở đây được phát ra một câu trả lời TOÀN CỤC. Ba kết cục, ba nghĩa
 * khác nhau, và chúng **không gộp được** vì KIỂU không cho:
 *   • `not-observable-here` — chứng minh được là hộ KHÔNG chạy ở tiến trình này, **hoặc** ô trạng
 *     thái đọc không được (hai `meaning` khác nhau — M-3);
 *   • `no-chain-in-this-process` — nhìn được, và **ở đây** không có chuỗi nào;
 *   • `deferring`/`exceeded` — có chuỗi thật.
 */
function docSauHo(kb: KbSyncStatus | null): VramAgentDeferHostView[] {
  let oVramDefer: readonly VramDeferState[] = [];
  let oDocDuoc = true;
  try {
    oVramDefer = docTrangThaiHoanVram();
  } catch {
    // ★ M-3 — CHẶN CÓ TÊN: "đọc không được" ≠ "không có chuỗi hoãn". Không hạ về một câu khẳng định.
    oDocDuoc = false;
  }
  return HO_BACKGROUND.map((h) => {
    let budgetMs = Number.NaN;
    try {
      budgetMs = h.budget(kb);
    } catch {
      /* ngân sách không đọc được ⇒ `NaN` ⇒ bị CHẶN CÓ TÊN ở lượt lọc hữu hạn cuối cùng */
    }

    let hostedHere: boolean | null;
    let status: VramAgentDeferStatus;
    /**
     * ★★★ N12 — **LỆNH NÀO VỚI TỚI, VÀ GỌI BẰNG DANH TÍNH NÀO** — dựng ở **CÙNG** nhánh với
     * `hostedHere`/`status`, để lời hứa và đầu vào của lời hứa không thể trôi khỏi nhau.
     */
    let retryReach: VramAgentDeferRetryReach;

    if (laHoTuHenGio(h)) {
      /**
       * `cron:kb-sync` — cơ chế RIÊNG, và là hộ DUY NHẤT ta **chứng minh được** có chủ trì ở đây
       * hay không (`getKbSyncSchedulerStatus().hostedHere` ⇔ `job !== null`). Cron sống ở `worker`
       * (`backgroundJobs.startBackgroundSchedulers`); ở `api` ô này là `false`, và khi đó
       * `defer === null` **TUYỆT ĐỐI KHÔNG** được đọc thành *"hộ này không đang hoãn"*.
       */
      hostedHere = kb === null ? null : kb.hostedHere;
      if (kb === null) {
        status = { kind: "not-observable-here", meaning: "defer-state-unreadable" };
      } else if (kb.defer !== null) {
        const d = kb.defer;
        const chung = {
          // ⚠ N12 — DANH TÍNH đọc từ **bản khai của hàng**, không phải một chuỗi cứng thứ hai:
          //   một lượt đổi tên ở bảng phải đi tới đây, nếu không hai chỗ trôi khỏi nhau.
          owner: h.ownerStatic,
          attempts: d.attempts,
          firstRefusedAt: d.firstRefusedAt,
          // ★ N11 — `kbSyncScheduler` `note.message` KHÔNG có trần ⇒ đây là chỗ trần được áp.
          lastRefusalMessage: cauHienThi(d.lastRefusalMessage),
          chainBudgetMs: d.budgetMs,
        } as const;
        status = d.exceeded
          ? { kind: "exceeded", ...chung }
          : { kind: "deferring", ...chung, nextRetryAt: d.nextRetryAt };
      } else if (kb.hostedHere) {
        status = { kind: "no-chain-in-this-process" };
      } else {
        // ⚠ ĐÂY LÀ DÒNG C-1 SINH RA ĐỂ VIẾT: cron không chạy ở tiến trình này ⇒ ta KHÔNG BIẾT.
        status = { kind: "not-observable-here", meaning: "host-not-running-in-this-process" };
      }
      /**
       * ★★★ (D) + N12 — cùng ba nhánh mà `vramRetryDeferredCommand()` đi, đọc từ **cùng** ô
       * `hostedHere` (⇐ `coChuTriCronODay()`). Không một phép so nào được viết lại ở đây.
       *
       * ⚠ DANH TÍNH kèm theo lời hứa: **owner của chuỗi ĐANG SỐNG** nếu có (đó là chuỗi thật mà
       * lệnh sẽ đánh thức), nếu không thì **danh tính TĨNH đã khai của hàng**. Tuyệt đối **không**
       * phải `host` — tên hộ chỉ tình cờ trùng owner ở 4/6 hàng, và trùng thì càng nguy hiểm vì nó
       * làm phát biểu sai **chạy đúng** ở những hàng người ta thử trước.
       *
       * ⚠⚠ **M-2 (review) — HAI NHÁNH DƯỚI ĐÂY CHỨNG MINH ĐƯỢC LÀ BẰNG NHAU HÔM NAY; ĐỪNG ĐỌC
       * `status.owner` NHƯ MỘT NGUỒN ĐỘC LẬP.** Chuỗi lập luận: phép phân giải cho một hàng
       * `matches === null` **là** `h.host === owner` ⇒ tập chuỗi phân giải ngược về hàng ấy là
       * **một điểm** `{h.host}`; ca *"DANH TÍNH TĨNH phân giải NGƯỢC"* ép `ownerStatic` nằm trong
       * tập ấy ⇒ **`ownerStatic ≡ host`**; và `status.owner` của nhánh `cron:kb-sync` được dựng
       * **từ chính** `h.ownerStatic` ngay dưới đây. ⇒ Ba biểu thức bằng nhau, **bị lưới cưỡng chế**,
       * không phải một trùng hợp. Nhánh `status.owner` là **dự phòng cho hàng TƯƠNG LAI** có
       * `owner` động + hẹn giờ riêng — nói ra để người sau không tưởng nó đang đo một thứ khác.
       */
      const danhTinh =
        status.kind === "deferring" || status.kind === "exceeded" ? status.owner : h.ownerStatic;
      retryReach =
        hostedHere === null
          ? { kind: "unknown", why: "defer-state-unreadable" }
          : hostedHere
            ? { kind: "reachable-here", owner: danhTinh }
            : { kind: "unreachable", why: "host-not-running-in-this-process" };
    } else {
      /**
       * Năm hộ đi qua `vramDefer`: **KHÔNG có cơ chế nào** trả lời *"hộ này có chạy ở tiến trình
       * này không"* (một `owner` chỉ xuất hiện SAU lượt từ chối đầu tiên) ⇒ `hostedHere: null` =
       * **KHÔNG XÁC ĐỊNH ĐƯỢC**, và `status` chỉ nói về chỗ đứng này.
       */
      hostedHere = null;
      status = oDocDuoc
        ? { kind: "no-chain-in-this-process" }
        : { kind: "not-observable-here", meaning: "defer-state-unreadable" };
      for (const s of oVramDefer) {
        if (!h.matches(s.owner)) continue;
        const ung = trangThaiTuOVramDefer(s);
        if (HANG[ung.kind] > HANG[status.kind]) status = ung;
      }
      /**
       * ⚠ **KHÔNG CÓ DANH TÍNH NÀO ĐI KÈM**, và đó là chủ đích: lệnh **không** với tới hộ này từ
       * đâu cả (vòng chờ nằm trong ngăn xếp của chính job). Phát ra một `owner` ở đây là mời người
       * đọc tiêu một lượt gọi chắc chắn bị từ chối.
       */
      retryReach = { kind: "unreachable", why: "no-retry-mechanism-for-this-host" };
    }

    return {
      host: h.host,
      // ★ N12 — MẪU đi trong một vỏ RIÊNG: nó không còn là một `string` để lọt vào chỗ đòi danh tính.
      ownerPattern: { patternText: h.ownerPattern },
      budgetMs,
      /**
       * ⚠⚠ Ô NÀY LÀ THỨ PHÂN BIỆT *"đang hoãn"* VỚI *"KHÔNG CÓ CƠ CHẾ HOÃN"*. Ngân sách `0` nghĩa
       * *"đừng đợi, kêu ngay"*: hộ vẫn để lại vết (`defer_exceeded` + ô trạng thái) nhưng **không
       * một mili giây chờ nào**. Một ngân sách không đọc được (`NaN`) cũng rơi vào đây — chiều
       * CHẶT: không hứa một lượt chờ mà ta không chứng minh được.
       */
      mechanism: Number.isFinite(budgetMs) && budgetMs > 0 ? "waits-and-retries" : "no-wait-degrades-in-place",
      hostedHere,
      status,
      retryReach,
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// LỌC HỮU HẠN — CHẶN, VÀ CHẶN **CÓ TÊN**
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ Lượt quét CUỐI CÙNG trước khi payload rời tiến trình. Thay mọi số KHÔNG HỮU HẠN bằng `null`
 * và **ghi lại đường dẫn + giá trị gốc**.
 *
 * ⚠ VÌ SAO LÀ MỘT LƯỢT QUÉT ĐỆ QUY chứ không phải "lọc tại từng điểm dựng": lọc tại điểm dựng là
 * một kỷ luật, và một kỷ luật thì **quên được** — ô thứ hai mươi mốt thêm vào sáu tháng nữa sẽ
 * không có ai nhắc. Một lượt quét là **bảo đảm cấu trúc**: không ô nào ra ngoài mà không đi qua đây.
 * ⚠ VÌ SAO KHÔNG NUỐT: `-Infinity` là câu trả lời fail-closed HỢP LỆ của `computeHeadroom()`
 * (*"tôi từ chối mọi lượt xin vì cấu hình hỏng"*). Biến nó thành `null` mà không nói gì là biến
 * *"tôi biết và tôi đang từ chối"* thành *"tôi không có số"* — đúng lớp lỗi cả pha này tồn tại để diệt.
 */
function locHuuHan(v: unknown, duong: string, ra: { path: string; was: string }[]): unknown {
  if (typeof v === "number") {
    if (Number.isFinite(v)) return v;
    ra.push({ path: duong, was: String(v) });
    return null;
  }
  if (Array.isArray(v)) return v.map((x, i) => locHuuHan(x, `${duong}[${i}]`, ra));
  if (v !== null && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      o[k] = locHuuHan(x, duong === "" ? k : `${duong}.${k}`, ra);
    }
    return o;
  }
  return v;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// NGƯỜI DỰNG
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ ẢNH CHỤP TRẠNG THÁI VRAM CHO AI AGENT. **KHÔNG đổi một hành vi cấp phát nào** — Pha 4 phơi
 * ra, không tự quyết.
 *
 * ⚠ `async` chỉ để đứng đúng chỗ trong một thủ tục tRPC; **không một `await` nào** ở đây chạm vào
 * đường quyết định. `reserve()` vẫn ĐỒNG BỘ.
 */
/**
 * ★★★ #1 (review) — **BỘ ĐẾM LƯỢT ĐỌC. KHÔNG ĐỌC ĐỒNG HỒ, NÊN KHÔNG TRÙNG ĐƯỢC.**
 *
 * ⚠⚠ Đồng hồ tường **trùng**: 18/20 cặp lượt đọc liên tiếp rơi vào cùng một mili giây trên máy
 * này. Một mốc trùng biến `toEqual(truoc, sau)` thành **XANH** cho hai ảnh chụp ở hai trạng thái
 * sổ **khác hẳn nhau** — đúng cái bẫy mà `VramAgentEffectiveHeadroom` tồn tại để đóng.
 * ⚠ Không reset trong test: bộ đếm **chỉ tăng**, và một lượt reset là một lượt cho phép trùng.
 * Ai cần biết *"bao giờ"* thì đọc `readAtMs` — hai câu hỏi khác nhau, hai ô khác nhau.
 */
let soLuotDoc = 0;

export async function buildVramAgentState(): Promise<VramAgentState> {
  const atMs = Date.now();
  soLuotDoc += 1;

  // ── ĐỌC MỘT LƯỢT, DÙNG CHUNG CHO MỌI VẾ ────────────────────────────────────────────────────
  // ⚠ Hai vế của một phép so phải đến từ **cùng một lượt đọc**; đọc lại giữa chừng là lấy hai vế
  // ở hai thời điểm (lớp lỗi "hai bản cài đặt song song trôi khỏi nhau").
  const tick = readDecisionTick();
  const shared = sharedLedgerFact(atMs);
  const unledgered = vramUnledgeredFact();
  const beginFailure = vramBeginFailureState();
  /**
   * ★ M-2 — **MỘT** lượt đọc `getKbSyncSchedulerStatus()` cho cả ảnh chụp (ngân sách + trạng thái
   * + `hostedHere` đều lấy từ đây). `null` ⇔ lượt đọc NÉM ⇒ `docSauHo()` khai
   * `not-observable-here / defer-state-unreadable`, KHÔNG hạ về một câu khẳng định (M-3).
   */
  let kbSync: KbSyncStatus | null = null;
  try {
    kbSync = getKbSyncSchedulerStatus();
  } catch {
    kbSync = null;
  }

  /**
   * ★★★ CÙNG phép ghép mà `reserve()` chạy — xem `vramBroker.decisionStateFor()`. Đây là chỗ bảo
   * đảm *"con số API khai = con số đang cưỡng chế"* trở thành CẤU TRÚC chứ không phải một ca test.
   */
  const st = broker.decisionStateFor({ tick, unledgered, sharedLedger: shared, nowMs: atMs });

  // ── PHẦN KHÔNG QUY TRÁCH NHIỆM ĐƯỢC — CÙNG vị từ với câu từ chối ────────────────────────────
  const kqn = vramUnattributedFacts({
    blind: st.headroom.blind,
    ledgerTotalBytes: st.ledgerTotalBytes,
    usedBytes: st.headroom.usedBytes,
    unledgered,
  });

  // ── attributable: HỢP KIỂU CÓ NHÃN ─────────────────────────────────────────────────────────
  /**
   * ⚠ `reason` đọc từ **`degradedReasons`** chứ không tự suy lại từ `tickPresent`: `computeHeadroom`
   * đã có đúng một bản cài đặt của phép phân biệt `"no-tick"` ↔ `"probe-blind"`, và viết bản thứ
   * hai ở đây là để hai câu trả lời trôi khỏi nhau (ràng buộc 12).
   */
  /**
   * ⚠ M-1 — **KHÔNG `as number`.** Bất biến `blind === false ⇒ tick !== null ∧ hữu hạn` đúng hôm
   * nay, nhưng một `as number` là một DÂY: nếu bất biến vỡ, `bytes` thành `undefined`, lượt quét
   * hữu hạn (`locHuuHan` chỉ xử `number`) **không thấy**, và payload ra ngoài với `known: true`
   * mà **thiếu hẳn ô `bytes`** — đúng "hứa nhiều hơn dữ liệu". Kiểm bằng giá trị, không bằng ép kiểu.
   */
  const aBytes = tick === null ? null : tick.attributableBytes;
  const attributable: VramAgentAttributable =
    st.headroom.blind || aBytes === null || !Number.isFinite(aBytes)
      ? {
          known: false,
          meaning: "headroom-upper-bound",
          reason: st.headroom.degradedReasons.includes("no-tick")
            ? "no-tick"
            : st.headroom.degradedReasons.includes("probe-blind")
              ? "probe-blind"
              : "invalid-input",
        }
      : { known: true, bytes: aBytes };

  /**
   * ★★★ Task 4 — hộ CỤC BỘ. `reclaim` là **kết quả của chính `preemptStepForOwner(owner)`**, tức
   * hàm mà lệnh `vram.preempt` chạy: không có bản sao thứ hai của vị từ, và hai mặt không thể trôi
   * khỏi nhau. ⚠ Hai giấy phép cùng `owner` ⇒ **một** câu trả lời (đúng như lệnh, thứ cũng nhận
   * `owner` chứ không nhận `leaseId`).
   */
  const hoCucBo = (h: VramLedgerHolderView): VramAgentHolderView => {
    const ke = broker.preemptStepForOwner(h.owner);
    const reclaim: VramAgentHolderReclaim =
      ke.kind === "ready"
        ? { kind: "reclaimable-here", reclaimer: ke.step.reclaimer }
        : { kind: "no-reclaimer", why: ke.reason };
    return {
      owner: h.owner,
      kind: h.kind,
      bytes: h.bytes,
      priority: h.priority,
      measured: h.measured,
      reclaim,
      processKey: h.processKey,
      leaseKey: null,
      ttlMs: h.ttlMs,
      /**
       * ⚠ Tuổi tính bằng **`atMs` của CHÍNH ảnh chụp này**, không phải một `Date.now()` thứ hai —
       * hai vế của một phép so phải đến từ cùng một lượt đọc (bài học C-1 + I-2 của review Task 2).
       * ⚠ CHIỀU CHẶT: TTL/mốc không hữu hạn ⇒ `null` (KHÔNG BIẾT), tuyệt đối không phải `false`.
       */
      ttlExpired:
        h.ttlMs === null || !Number.isFinite(h.acquiredAtMs) ? null : atMs - h.acquiredAtMs > h.ttlMs,
    };
  };

  /**
   * ★★★ Task 4 — hộ của **ANH EM**. `reclaim` đi qua **cùng** `nguoiThiHanhThuHoiTu()` mà
   * `holderFactFromSharedRow()` dùng (một bản cài đặt, hai người gọi) — và kết quả `true` được gán
   * nhãn `declared-by-owner-process`, KHÔNG phải `reclaimable-here`: lệnh của ta **không với tới**.
   * ⚠ Sổ chung không mang `ttlMs` ⇒ hai ô TTL là `null` = **KHÔNG BIẾT**, không phải "không có TTL".
   */
  const hoAnhEm = (r: SharedLeaseRow): VramAgentHolderView => {
    const f = broker.holderFactFromSharedRow(r);
    const nguoi = broker.nguoiThiHanhThuHoiTu(r.reclaimer, r.refCount);
    return {
      owner: f.owner,
      kind: f.kind,
      bytes: f.bytes,
      priority: f.priority,
      measured: f.measured,
      reclaim:
        nguoi === null
          ? { kind: "no-reclaimer", why: "owner-not-in-local-ledger" }
          : { kind: "declared-by-owner-process", reclaimer: nguoi },
      processKey: f.processKey,
      leaseKey: r.leaseKey,
      ttlMs: null,
      ttlExpired: null,
    };
  };

  const foreign: VramAgentForeignLedger =
    shared === null
      ? { known: false, meaning: "never-refreshed-blind-to-siblings" }
      : {
          known: true,
          bytes: shared.foreignBytes,
          holders: shared.foreignHolders.map(hoAnhEm),
          ageMs: shared.ageMs,
          // ⚠ Cùng ngưỡng mà `applyEnforcement()` dùng — không có ngưỡng thứ hai ở mặt đọc.
          stale: !Number.isFinite(shared.ageMs) || shared.ageMs > SHARED_LEDGER_STALE_AFTER_MS,
          unsyncedWrites: shared.unsyncedWrites,
          consecutiveFailures: shared.consecutiveFailures,
          // ★ Pha 6 Task 5 — lời khai của đầu GHI tới được một người đọc. Không có ô này thì `daCat`
          //   chỉ tồn tại trong kiểu, và một lượt cắt vẫn **không ai thấy**.
          truncatedIdentityWrites: shared.truncatedIdentityWrites,
        };

  const tickView: VramAgentTick =
    tick === null
      ? { present: false, meaning: "no-tick-blind" }
      : {
          present: true,
          ageMs: atMs - tick.atMs,
          staleAfterMs: TICK_STALE_AFTER_MS,
          stale: !Number.isFinite(atMs - tick.atMs) || atMs - tick.atMs > TICK_STALE_AFTER_MS,
          consecutiveFailures: tick.consecutiveFailures,
        };

  let sharedRefreshIntervalMs = Number.NaN;
  try {
    sharedRefreshIntervalMs = reconcileIntervalMs();
  } catch {
    /* bị CHẶN CÓ TÊN ở lượt lọc hữu hạn */
  }

  const tho = {
    atMs,
    processKey: sharedLedgerSelfKey(),
    ledger: {
      localBytes: st.localLedgerBytes,
      localHolders: broker.ledgerHolders().map(hoCucBo),
      foreign,
      totalBytes: st.ledgerTotalBytes,
      sharedRefreshIntervalMs,
      sharedStaleAfterMs: SHARED_LEDGER_STALE_AFTER_MS,
    },
    headroom: {
      rawBytes: st.headroom.headroomBytes,
      /**
       * ★★★ Pha 6 Task 2 — con số **KHÔNG RỜI KHỎI MỐC CỦA NÓ.** `readAtMs` lấy **chính** hằng
       * `atMs` ở đầu hàm (một lượt đọc đồng hồ cho cả ảnh chụp — không phải một `Date.now()` thứ
       * hai, đúng kỷ luật "hai vế của một phép so đến từ cùng một lượt đọc").
       */
      effective: {
        bytesAtReadMs: st.enforcement.effectiveHeadroomBytes,
        // ⚠ #1 — DẤU không trùng được. `processKey` tách tiến trình, `soLuotDoc` tách lượt đọc.
        readMark: `${sharedLedgerSelfKey()}#${soLuotDoc}`,
        readAtMs: atMs,
        notAnInvariant: true as const,
        // ⚠ MỘT bản duy nhất — kiểu suy từ chính hai hằng này (chúng từng trôi khỏi nhau).
        variesWith: VRAM_EFFECTIVE_VARIES_WITH,
        beforeAfterEvidence: VRAM_BEFORE_AFTER_EVIDENCE,
      },
      basis: st.headroom.basis,
      blind: st.headroom.blind,
      trusted: st.enforcement.trusted,
      degradedReasons: [...st.enforcement.reasons],
      usedBytes: st.headroom.usedBytes,
      ceilingBytes: st.ceilingBytes,
      safetyReserveBytes: st.safetyReserveBytes,
      charges: {
        staleMarginBytes: st.enforcement.staleMarginBytes,
        sharedLedgerMarginBytes: st.enforcement.sharedLedgerMarginBytes,
        unledgeredChargeBytes: st.enforcement.unledgeredChargeBytes,
        distrustChargeBytes: st.enforcement.distrustChargeBytes,
      },
    },
    attributable,
    tick: tickView,
    /**
     * ★★★ (D) — BA Ô, **MỘT Ô NGUỒN**. Trước bản này `verified` đến từ `vramTickCell` còn
     * `unverifiedReasons`/`origin` đến từ `vramReconciler.readLastReconcileTick()` — hai ô, và
     * `__resetDecisionTickForTests()` **không** xoá ô thứ hai ⇒ chúng lệch nhịp THẬT trong bộ test.
     * Nay cả ba đọc `tick`, tức đúng ô mà `reserve()` đọc: bất biến "cùng nhịp" là CẤU TRÚC.
     * ⚠ `null` ⇔ **CHƯA CÓ NHỊP NÀO** (≠ mảng rỗng = "có nhịp, không lý do nào").
     */
    baseline: {
      verified: st.headroom.baselineVerified,
      unverifiedReasons: tick === null ? null : [...tick.baselineUnverifiedReasons],
      origin: tick === null ? null : tick.baselineOrigin,
    },
    unattributed: {
      bytes: kqn.unattributedBytes,
      /**
       * ★ I-3 — con số trên **LOẠI TRỪ TOÀN BỘ NỀN THIẾT BỊ** (`attributable = deviceUsed − nền`).
       * Byte của sidecar lượt chạy trước, của tiến trình bên thứ ba, của desktop compositor
       * (996–2.112 MiB đo được trên chính máy này) nằm TRONG nền ⇒ **không bao giờ** hiện ở đây.
       * Không có ô này thì `bytes: 0` đọc thành *"cả card đã giải thích hết"*.
       */
      excludesBaselineBytes: true as const,
      caveat: kqn.caveat,
      /**
       * ★★★ KHÔNG BAO GIỜ `false`, VÀ ĐÓ LÀ TOÀN BỘ Ý NGHĨA CỦA NÓ. Sổ mới nối 15/159 dòng liệt
       * kê, và bản liệt kê đó **tự khai là CẬN DƯỚI** — một Agent đọc `holders` rồi kết luận "card
       * trống" là đúng thứ ô này tồn tại để chặn.
       */
      holderListIsLowerBound: true as const,
      wiredSiteCount: kqn.wiredSiteCount,
      knownSiteRowCount: kqn.knownSiteRowCount,
    },
    unledgered: {
      /**
       * ⚠⚠ BỐN Ô NÀY DỰNG **CÙNG MỘT CHỖ, MỘT LẦN** — cố ý. Không có đường nào để ai đó gửi
       * `estimateBytes` ra ngoài mà bỏ quên lời cảnh báo đi kèm nó.
       */
      estimateBytes: kqn.unledgeredEstimateBytes,
      estimateKind: "estimate" as const,
      unknownCount: kqn.unknownCount,
      estimateUsable: kqn.unknownCount !== null && kqn.unknownCount === 0 && kqn.unledgeredEstimateBytes !== null,
      beginFailureCount: beginFailure.count,
      /**
       * ★★★ N11 — **CẮT TẠI NGUỒN.** `vramWiring.lyDoBeginHongCuoi` là `err.message` **thô, không
       * trần**; hai người đọc render nó **thẳng** (DOM của panel · prompt LLM). Trần đặt ở đây —
       * một chỗ — và nó **tự khai** (`truncated`), nên không người đọc nào phải đoán, và không ai
       * đẻ ra một trần thứ hai.
       * ⚠ **Làm sạch thì KHÔNG ở đây**: hai bộ diễn giải (i18next / chat template) là chuyện của
       * bề mặt câu chữ (`vramTools.catSach`). Cắt ≠ làm sạch; gộp hai việc là dựng đường thứ hai.
       */
      lastReason: cauHienThi(beginFailure.lastReason),
    },
    /**
     * ★★★ C-1 — khối hoãn **MANG PHẠM VI CỦA CHÍNH NÓ**. Cả hai nguồn (`vramDefer.oTrangThai`,
     * `kbSyncScheduler.deferStreak`) là ảnh chụp trong bộ nhớ của **tiến trình đang trả lời**,
     * trong khi cron KB sync + hai sidecar job sống ở `worker`. Không có `scope` +
     * `observedFromProcessKey` + `hostedHere`, mọi `status` ở đây là một lời khẳng định toàn cục
     * mà dữ liệu không đỡ nổi — và Task 2 (`retryDeferred`) đọc thẳng khối này.
     */
    defer: {
      scope: "this-process-only" as const,
      observedFromProcessKey: sharedLedgerSelfKey(),
      durableTrace: "vram_events(defer|defer_exceeded)" as const,
      hosts: docSauHo(kbSync),
    },
  };

  const nonFiniteFields: { path: string; was: string }[] = [];
  const sach = locHuuHan(tho, "", nonFiniteFields) as Omit<VramAgentState, "nonFiniteFields">;
  return { ...sach, nonFiniteFields };
}
