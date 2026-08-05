/**
 * ★★★ PHA 4 TASK 1 — **MẶT ĐỌC CỦA AI AGENT.** Phơi trạng thái VRAM ra, **KHÔNG HỨA QUÁ**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ RÀNG BUỘC LỚN NHẤT CỦA CẢ FILE: **MỖI TRƯỜNG PHẢI NÓI ĐÚNG ĐỘ CHẮC CHẮN CỦA NÓ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Agent đọc API này để **QUYẾT ĐỊNH**. Một trường nói quá không dừng ở *"tài liệu sai"* — nó
 * thành **một hành động sai**. Lớp lỗi "hứa nhiều hơn dữ liệu" đã bị bắt **CHÍN lần** trong
 * chuỗi pha này. Ba chỗ dễ nói quá nhất, cả ba đều có SỐ, và cả ba được xử bằng **KIỂU**:
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
import type { BaselineOrigin, VramBaselineDistrustReason, VramPriority } from "./types";
import type { HeadroomBasis } from "./vramHeadroom";
import type { VramDegradationReason, VramRefusalCaveat } from "./vramRefusal";
import { vramUnattributedFacts } from "./vramRefusal";
import * as broker from "./vramBroker";
import { readDecisionTick } from "./vramTickCell";
import { sharedLedgerFact, sharedLedgerSelfKey } from "./vramSharedLedger";
import { reconcileIntervalMs, SHARED_LEDGER_STALE_AFTER_MS, TICK_STALE_AFTER_MS } from "./vramEnforcement";
import { vramUnledgeredFact, vramBeginFailureState } from "./vramWiring";
import { docTrangThaiHoanVram, vramJobDeferBudgetMs, vramRequestDeferBudgetMs } from "./vramDefer";
import type { VramDeferState } from "./vramDefer";
import { getKbSyncSchedulerStatus } from "../kbSyncScheduler";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// KIỂU CỦA ẢNH CHỤP
// ══════════════════════════════════════════════════════════════════════════════════════════════

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
  /** `true` ⇔ **CÓ người thi hành** thu hồi được hộ này. `false` ⇒ đừng hứa lấy lại byte của nó. */
  readonly reclaimable: boolean;
  /** `null` = hộ của **CHÍNH tiến trình này**; khác `null` = `${role}:${pid}:${bootMs}` của anh em. */
  readonly processKey: string | null;
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
      readonly owner: string;
      readonly attempts: number | null;
      readonly firstRefusedAt: string | null;
      readonly nextRetryAt: string | null;
      readonly lastRefusalMessage: string | null;
      /** ★ M-7 — ngân sách **CHỐT LÚC BỊ TỪ CHỐI**, thứ điều khiển hạn chót đang chạy. */
      readonly chainBudgetMs: number | null;
    }
  | {
      readonly kind: "exceeded";
      readonly owner: string;
      readonly attempts: number | null;
      readonly firstRefusedAt: string | null;
      readonly lastRefusalMessage: string | null;
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
export interface VramAgentDeferHostView {
  readonly host: string;
  /** Khuôn `owner` mà hộ này sinh ra (một số hộ có `owner` ĐỘNG: đường dẫn model / id model). */
  readonly ownerPattern: string;
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
}

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
    /** `computeHeadroom()` thô. `null` ⇔ không hữu hạn (xem `nonFiniteFields` + `degradedReasons`). */
    readonly rawBytes: number | null;
    /** Sau chính sách suy giảm — **con số THẬT SỰ được so với một lượt xin**. */
    readonly effectiveBytes: number | null;
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
     */
    readonly lastReason: string | null;
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
const HO_BACKGROUND: readonly {
  readonly host: string;
  readonly ownerPattern: string;
  readonly budget: (kb: KbSyncStatus | null) => number;
  /** `null` ⇒ hộ này KHÔNG đi qua `vramDefer` (nó có cơ chế hẹn giờ riêng — xem `cron:kb-sync`). */
  readonly matches: ((owner: string) => boolean) | null;
}[] = [
  {
    // Cơ chế hoãn RIÊNG của Pha 2B Task 6 (có khôi phục sau khởi động lại) — KHÔNG qua `vramDefer`.
    host: "cron:kb-sync",
    ownerPattern: "cron:kb-sync",
    budget: (kb) => (kb === null ? Number.NaN : kb.deferBudgetMs),
    matches: null,
  },
  {
    host: "cron:kb-eval-gate",
    ownerPattern: "cron:kb-eval-gate",
    budget: () => vramRequestDeferBudgetMs(false),
    matches: (o) => o === "cron:kb-eval-gate",
  },
  {
    host: "sidecar:local-trainer",
    ownerPattern: "sidecar:local-trainer",
    budget: () => vramJobDeferBudgetMs(false),
    matches: (o) => o === "sidecar:local-trainer",
  },
  {
    host: "sidecar:llm-finetune",
    ownerPattern: "sidecar:llm-finetune",
    budget: () => vramJobDeferBudgetMs(false),
    matches: (o) => o === "sidecar:llm-finetune",
  },
  {
    // HAI `owner` (backend CUDA + model), MỘT hộ: cùng đường phục vụ yêu cầu, cùng cách suy giảm.
    host: "reranker",
    ownerPattern: "cuda-backend:reranker | reranker:<modelPath>",
    budget: () => vramRequestDeferBudgetMs(false),
    matches: (o) => o === "cuda-backend:reranker" || o.startsWith("reranker:"),
  },
  {
    host: "gguf-embed-ctx",
    ownerPattern: "gguf-embed-ctx:<modelId>",
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
    lastRefusalMessage: s.lastRefusalMessage,
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

    if (h.matches === null) {
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
          owner: "cron:kb-sync",
          attempts: d.attempts,
          firstRefusedAt: d.firstRefusedAt,
          lastRefusalMessage: d.lastRefusalMessage,
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
    } else {
      /**
       * Năm hộ đi qua `vramDefer`: **KHÔNG có cơ chế nào** trả lời *"hộ này có chạy ở tiến trình
       * này không"* (một `owner` chỉ xuất hiện SAU lượt từ chối đầu tiên) ⇒ `hostedHere: null` =
       * **KHÔNG XÁC ĐỊNH ĐƯỢC**, và `status` chỉ nói về chỗ đứng này.
       */
      hostedHere = null;
      const khop = h.matches;
      status = oDocDuoc
        ? { kind: "no-chain-in-this-process" }
        : { kind: "not-observable-here", meaning: "defer-state-unreadable" };
      for (const s of oVramDefer) {
        if (!khop(s.owner)) continue;
        const ung = trangThaiTuOVramDefer(s);
        if (HANG[ung.kind] > HANG[status.kind]) status = ung;
      }
    }

    return {
      host: h.host,
      ownerPattern: h.ownerPattern,
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
export async function buildVramAgentState(): Promise<VramAgentState> {
  const atMs = Date.now();

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

  const ho = (
    h: {
      owner: string;
      kind: string;
      bytes: number;
      priority: VramPriority;
      measured: boolean;
      reclaimable: boolean;
      processKey: string | null;
    },
    /** ★ Task 2 — `null` cho hộ CỤC BỘ (xem `VramAgentHolderView.leaseKey`). */
    leaseKey: string | null,
  ): VramAgentHolderView => ({
    owner: h.owner,
    kind: h.kind,
    bytes: h.bytes,
    priority: h.priority,
    measured: h.measured,
    reclaimable: h.reclaimable,
    processKey: h.processKey,
    leaseKey,
  });

  const foreign: VramAgentForeignLedger =
    shared === null
      ? { known: false, meaning: "never-refreshed-blind-to-siblings" }
      : {
          known: true,
          bytes: shared.foreignBytes,
          holders: shared.foreignHolders.map((r) => ho(broker.holderFactFromSharedRow(r), r.leaseKey)),
          ageMs: shared.ageMs,
          // ⚠ Cùng ngưỡng mà `applyEnforcement()` dùng — không có ngưỡng thứ hai ở mặt đọc.
          stale: !Number.isFinite(shared.ageMs) || shared.ageMs > SHARED_LEDGER_STALE_AFTER_MS,
          unsyncedWrites: shared.unsyncedWrites,
          consecutiveFailures: shared.consecutiveFailures,
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
      localHolders: broker.ledgerHolders().map((h) => ho(h, null)),
      foreign,
      totalBytes: st.ledgerTotalBytes,
      sharedRefreshIntervalMs,
      sharedStaleAfterMs: SHARED_LEDGER_STALE_AFTER_MS,
    },
    headroom: {
      rawBytes: st.headroom.headroomBytes,
      effectiveBytes: st.enforcement.effectiveHeadroomBytes,
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
      lastReason: beginFailure.lastReason,
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
