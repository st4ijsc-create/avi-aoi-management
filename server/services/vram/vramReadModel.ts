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
 *   • `vramWiring.vramBeginFailureState()` · `vramReconciler.reconcileIntervalMs()`.
 *
 * ⚠ **KHÔNG đụng tính ĐỒNG BỘ của `reserve()`.** File này `async` (nó đứng sau một lượt gọi tRPC),
 * nhưng nó **không** thêm một `await` nào vào đường quyết định: mọi hàm nó gọi đều đồng bộ và
 * `vramBroker.ts` vẫn **0 khớp `await`/`async` trong mã**.
 *
 * ⚠ **ĐƠN VỊ: BYTE.** MiB chỉ ở câu chữ (Đ4 — không trộn hai thước). Mọi ô thời gian là **ms**.
 */
import type { VramPriority } from "./types";
import type { HeadroomBasis } from "./vramHeadroom";
import type { VramDegradationReason, VramRefusalCaveat } from "./vramRefusal";
import { vramUnattributedFacts } from "./vramRefusal";
import * as broker from "./vramBroker";
import { readDecisionTick } from "./vramTickCell";
import { sharedLedgerFact, sharedLedgerSelfKey } from "./vramSharedLedger";
import { SHARED_LEDGER_STALE_AFTER_MS, TICK_STALE_AFTER_MS } from "./vramEnforcement";
import { vramUnledgeredFact, vramBeginFailureState } from "./vramWiring";
import type { BaselineOrigin, VramBaselineDistrustReason } from "./vramReconciler";
import { readLastReconcileTick, reconcileIntervalMs } from "./vramReconciler";
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

/** Trạng thái hoãn ĐANG SỐNG của một hộ. */
export type VramAgentDeferStatus =
  | { readonly kind: "idle" }
  | {
      readonly kind: "deferring";
      readonly owner: string;
      readonly attempts: number | null;
      readonly firstRefusedAt: string;
      readonly nextRetryAt: string | null;
      readonly lastRefusalMessage: string;
    }
  | {
      readonly kind: "exceeded";
      readonly owner: string;
      readonly attempts: number | null;
      readonly firstRefusedAt: string;
      readonly lastRefusalMessage: string;
    };

/**
 * ★★★ MỘT HỘ `background`, VÀ **HAI Ô KHÔNG ĐƯỢC GỘP**.
 *
 * ⚠⚠ `mechanism` trả lời *"hộ này CÓ ĐỢI không"*; `status` trả lời *"nó CÓ ĐANG hoãn không"*.
 * **3/6 hộ có ngân sách 0** — chúng **KHÔNG chờ một mili giây nào**, chúng **suy giảm tại chỗ**
 * (`aiReranker.rerank()` trả về thứ tự cosine gốc; `getEmbeddingContext` ném một câu đã nói đúng
 * nguyên nhân). Với những hộ đó, `status.kind === "idle"` **KHÔNG** nghĩa *"nó đã xin được VRAM"*
 * — nó nghĩa *"không có chuỗi hoãn nào, vì hộ này không bao giờ hoãn"*. Gộp hai ô lại là **nói
 * dối bằng cách im lặng**.
 */
export interface VramAgentDeferHostView {
  readonly host: string;
  /** Khuôn `owner` mà hộ này sinh ra (một số hộ có `owner` ĐỘNG: đường dẫn model / id model). */
  readonly ownerPattern: string;
  /** Đáy hoãn (ms) đọc từ **đúng hàm ngân sách của điểm gọi**. `0` = "đừng đợi, kêu ngay". */
  readonly budgetMs: number | null;
  readonly mechanism: "waits-and-retries" | "no-wait-degrades-in-place";
  readonly status: VramAgentDeferStatus;
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

  readonly baseline: {
    /** Nguyên văn cờ của **ô quyết định** (`vramTickCell`) — thứ `reserve()` đọc. */
    readonly verified: boolean;
    /**
     * **VÌ SAO** cờ trên tắt. `null` ⇔ **CHƯA CÓ bản ghi chẩn đoán nào** (≠ mảng rỗng, thứ nghĩa
     * "đã có bản ghi và không có lý do nào").
     */
    readonly unverifiedReasons: readonly VramBaselineDistrustReason[] | null;
    readonly origin: BaselineOrigin | null;
    /** Mốc của bản ghi chẩn đoán. So với `tick` để biết hai ô có cùng một nhịp không. */
    readonly diagnosticAtMs: number | null;
  };

  readonly unattributed: {
    /** Phần thiết bị đang dùng mà SỔ KHÔNG giải thích được. `null` ⇔ **KHÔNG ĐO ĐƯỢC** (≠ `0`). */
    readonly bytes: number | null;
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
    readonly lastReason: string | null;
  };

  readonly defer: readonly VramAgentDeferHostView[];
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
  readonly budget: () => number;
  /** `null` ⇒ hộ này KHÔNG đi qua `vramDefer` (nó có cơ chế hẹn giờ riêng — xem `kbSync`). */
  readonly matches: ((owner: string) => boolean) | null;
}[] = [
  {
    // Cơ chế hoãn RIÊNG của Pha 2B Task 6 (có khôi phục sau khởi động lại) — KHÔNG qua `vramDefer`.
    host: "cron:kb-sync",
    ownerPattern: "cron:kb-sync",
    budget: () => getKbSyncSchedulerStatus().deferBudgetMs,
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

/** Hạng NGHIÊM TRỌNG — khi một hộ có nhiều `owner` đang hoãn, ô trạng thái lấy cái NẶNG nhất. */
const HANG: Record<VramAgentDeferStatus["kind"], number> = { idle: 0, deferring: 1, exceeded: 2 };

function trangThaiTuOVramDefer(s: VramDeferState): VramAgentDeferStatus {
  return s.exceeded
    ? {
        kind: "exceeded",
        owner: s.owner,
        attempts: s.attempts,
        firstRefusedAt: s.firstRefusedAt,
        lastRefusalMessage: s.lastRefusalMessage,
      }
    : {
        kind: "deferring",
        owner: s.owner,
        attempts: s.attempts,
        firstRefusedAt: s.firstRefusedAt,
        nextRetryAt: s.nextRetryAt,
        lastRefusalMessage: s.lastRefusalMessage,
      };
}

/**
 * Trạng thái hoãn của cả sáu hộ. **KHÔNG BAO GIỜ NÉM** — một mặt đọc ngã vì một ô phụ thì mất luôn
 * những ô chính (cùng kỷ luật `aiLocalKnowledgeService.readVramDefer`).
 */
function docSauHo(): VramAgentDeferHostView[] {
  let oVramDefer: readonly VramDeferState[] = [];
  try {
    oVramDefer = docTrangThaiHoanVram();
  } catch {
    oVramDefer = [];
  }
  return HO_BACKGROUND.map((h) => {
    let budgetMs = Number.NaN;
    try {
      budgetMs = h.budget();
    } catch {
      /* ngân sách không đọc được ⇒ `NaN` ⇒ bị CHẶN CÓ TÊN ở lượt lọc hữu hạn cuối cùng */
    }
    let status: VramAgentDeferStatus = { kind: "idle" };
    if (h.matches === null) {
      // `cron:kb-sync` — cơ chế RIÊNG, đọc thẳng ô công khai của nó.
      try {
        const d = getKbSyncSchedulerStatus().defer;
        if (d !== null) {
          status = d.exceeded
            ? {
                kind: "exceeded",
                owner: "cron:kb-sync",
                attempts: d.attempts,
                firstRefusedAt: d.firstRefusedAt ?? "",
                lastRefusalMessage: d.lastRefusalMessage ?? "",
              }
            : {
                kind: "deferring",
                owner: "cron:kb-sync",
                attempts: d.attempts,
                firstRefusedAt: d.firstRefusedAt ?? "",
                nextRetryAt: d.nextRetryAt,
                lastRefusalMessage: d.lastRefusalMessage ?? "",
              };
        }
      } catch {
        /* giữ `idle` — và `mechanism` bên dưới vẫn nói đúng bản chất của hộ */
      }
    } else {
      const khop = h.matches;
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
  const attributable: VramAgentAttributable = st.headroom.blind
    ? {
        known: false,
        meaning: "headroom-upper-bound",
        reason: st.headroom.degradedReasons.includes("no-tick")
          ? "no-tick"
          : st.headroom.degradedReasons.includes("probe-blind")
            ? "probe-blind"
            : "invalid-input",
      }
    : // KHÔNG `blind` ⇒ `computeHeadroom` đã chứng minh con số này HỮU HẠN (`usable()`), nên
      // `bytes: number` ở nhánh này là một lời khai đúng, không phải một lời hứa.
      { known: true, bytes: tick?.attributableBytes as number };

  const ho = (h: {
    owner: string;
    kind: string;
    bytes: number;
    priority: VramPriority;
    measured: boolean;
    reclaimable: boolean;
    processKey: string | null;
  }): VramAgentHolderView => ({
    owner: h.owner,
    kind: h.kind,
    bytes: h.bytes,
    priority: h.priority,
    measured: h.measured,
    reclaimable: h.reclaimable,
    processKey: h.processKey,
  });

  const foreign: VramAgentForeignLedger =
    shared === null
      ? { known: false, meaning: "never-refreshed-blind-to-siblings" }
      : {
          known: true,
          bytes: shared.foreignBytes,
          holders: shared.foreignHolders.map((r) => ho(broker.holderFactFromSharedRow(r))),
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

  /**
   * ⚠ BẢN GHI CHẨN ĐOÁN, **Ô KHÁC với ô quyết định**. `verified` lấy từ ô QUYẾT ĐỊNH (thứ
   * `reserve()` đọc), còn `unverifiedReasons`/`origin` chỉ có ở bản ghi chẩn đoán —
   * `diagnosticAtMs` để người đọc tự thấy hai ô có cùng một nhịp hay không, thay vì ta hứa hộ.
   */
  let chanDoan: { reasons: readonly VramBaselineDistrustReason[]; origin: BaselineOrigin; atMs: number } | null = null;
  try {
    const rec = readLastReconcileTick();
    if (rec !== null) {
      chanDoan = {
        reasons: rec.result.baselineUnverifiedReasons,
        origin: rec.result.baselineOrigin,
        atMs: rec.atMs,
      };
    }
  } catch {
    /* bản ghi chẩn đoán không đọc được ⇒ `null` = CHƯA CÓ, chứ không phải "không có lý do nào" */
  }

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
      localHolders: broker.ledgerHolders().map(ho),
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
    baseline: {
      verified: st.headroom.baselineVerified,
      unverifiedReasons: chanDoan === null ? null : [...chanDoan.reasons],
      origin: chanDoan === null ? null : chanDoan.origin,
      diagnosticAtMs: chanDoan === null ? null : chanDoan.atMs,
    },
    unattributed: {
      bytes: kqn.unattributedBytes,
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
    defer: docSauHo(),
  };

  const nonFiniteFields: { path: string; was: string }[] = [];
  const sach = locHuuHan(tho, "", nonFiniteFields) as Omit<VramAgentState, "nonFiniteFields">;
  return { ...sach, nonFiniteFields };
}
