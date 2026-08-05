/**
 * ★★★ Pha 4 Task 2 — **BA LỆNH CỦA AI AGENT.** Router mỏng; **toàn bộ ngữ nghĩa nằm ở đây**, đúng
 * khuôn mà Task 1 dựng cho mặt đọc (`vramReadModel`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ HAI LUẬT CỦA FILE NÀY, VÀ CẢ HAI ĐỀU ĐÃ CÓ NGƯỜI TRẢ GIÁ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. **KHÔNG DỰNG ĐƯỜNG THỨ HAI.** Mỗi lệnh chỉ **gọi** một cơ chế đã có và **dịch** kết quả:
 *    `preempt` → `vramPreempt.preemptOwner()` (→ `broker.preemptStepForOwner()` → `NGUOI_THI_HANH`);
 *    `releaseStale` → `vramReconciler.releaseStaleSharedRow()` (→ `lapKeHoachNhanNuoi()`);
 *    `retryDeferred` → `kbSyncScheduler.retryKbSyncDeferNow()` (→ `armDeferTimer()`).
 *    Không một `process.kill`, không một `release()`, không một phép so quyền nào viết ở file này.
 * 2. **CÂU CHỮ KHÔNG HỨA NHIỀU HƠN DỮ LIỆU.** Agent đọc kết quả để **quyết định bước tiếp theo**:
 *    `outcome: "reclaimed"` chỉ phát ra khi **GIẤY PHÉP CỦA CHÍNH HỘ ĐÓ đã rời sổ**
 *    (`leaseLeftLedger`); mọi lượt từ chối mang `reason` máy-đọc-được; và mọi kết quả mang
 *    **PHẠM VI QUAN SÁT** của chính nó.
 *    ⚠⚠ **KHÔNG PHẢI `freedBytes > 0`** — đó chính là vị từ mà C-1 (review) vừa gỡ bỏ: `freedBytes`
 *    dựng từ một hiệu số **TỔNG**, mà tổng là đại lượng **dùng chung**, nên nó nhận cả byte của hộ
 *    khác vừa nhả trong cùng cửa sổ `await`.
 *    ⚠ Hệ quả phải đọc đúng: **`"reclaimed"` kèm `freedBytes: 0` là một kết cục HỢP LỆ và tới được
 *    thật** — giấy phép đã rời sổ, nhưng một lượt cấp phát ≥ `step.bytes` chen vào cùng cửa sổ làm
 *    hiệu số tổng không còn dương. Bằng chứng là `leaseLeftLedger`, KHÔNG phải con số byte.
 *
 * ⚠ `scope` + `observedFromProcessKey` (bàn giao cứng của Task 1, C-1): ba lệnh này chạy trong bộ
 * nhớ của **tiến trình đang trả lời**. Sổ cục bộ, ô hoãn, `leaseNhanNuoi` — tất cả đều là sự thật
 * của **chỗ đứng này**. Một kết quả không mang theo chỗ đứng là một lời khẳng định toàn cục mà dữ
 * liệu không đỡ nổi.
 * ⚠ `reserve()` vẫn **ĐỒNG BỘ**: không một hàm nào ở đây được gọi từ đường quyết định.
 */
import type { VramReclaimerId } from "./types";
import { preemptOwner } from "./vramPreempt";
import { releaseStaleSharedRow } from "./vramReconciler";
import { sharedLedgerSelfKey } from "./vramSharedLedger";
import { vramBackgroundHostForOwner } from "./vramReadModel";
import { retryKbSyncDeferNow } from "../kbSyncScheduler";

/**
 * ★★★ PHẠM VI QUAN SÁT — **BẮT BUỘC trên MỌI kết quả lệnh.**
 * `durableTrace` chỉ ra vết BỀN xuyên tiến trình: ai cần sự thật của **cả cụm** thì truy bảng đó,
 * không phải một ô trong bộ nhớ của một tiến trình.
 */
export interface VramCommandScope {
  readonly scope: "this-process-only";
  /** `${role}:${pid}:${bootMs}` của tiến trình đã THI HÀNH lệnh. */
  readonly observedFromProcessKey: string;
  readonly durableTrace: "vram_events(defer|defer_exceeded|preempt)";
}

function chungPhamVi(): VramCommandScope {
  return {
    scope: "this-process-only",
    observedFromProcessKey: sharedLedgerSelfKey(),
    durableTrace: "vram_events(defer|defer_exceeded|preempt)",
  };
}

/** ⚠ Ràng buộc 4 — **không giá trị không hữu hạn nào ra API.** Chiều CHẶT: không hứa byte nào. */
function byteRaApi(n: number): number {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. `preempt(owner)`
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠⚠ **`"reclaimed"` LÀ MỘT LỜI KHẲNG ĐỊNH VỀ HỘ NÀY, KHÔNG VỀ CÁI TỔNG.** Nó chỉ phát ra khi
 * **giấy phép của chính hộ đó đã rời sổ** (`leaseLeftLedger`). Người thi hành khai `true` mà giấy
 * phép còn nguyên ⇒ `"failed"` + `reason: "no-bytes-freed"` — đúng chuỗi C-2 của Pha 2B (giết
 * 7,8 GB, lượt xin **vẫn** hỏng).
 *
 * ⚠⚠ C-1 (review) — vị từ **không được** là *"tổng sổ có co lại không"*: tổng là đại lượng dùng
 * chung, và phép đo bắc qua `await` nên một hộ KHÁC nhả trong cửa sổ đó sẽ làm lệnh khai thành công
 * cho một hộ **còn nguyên**, kèm byte của người khác. Xem `vramPreempt.preemptOwner()`.
 */
export type VramPreemptCommandOutcome = "reclaimed" | "failed" | "refused";

export type VramPreemptCommandReason =
  // — cổng QUYỀN / KHẢ NĂNG (chưa chạm tới người thi hành)
  | "owner-not-in-local-ledger"
  | "production-never-preempted"
  | "busy-in-use"
  | "no-reclaimer-declared"
  // — đã chạm người thi hành
  | "reclaimer-returned-false"
  | "reclaimer-threw"
  | "no-bytes-freed";

export interface VramPreemptCommandResult extends VramCommandScope {
  readonly command: "preempt";
  readonly owner: string;
  readonly outcome: VramPreemptCommandOutcome;
  /** `null` **chỉ khi** `outcome === "reclaimed"`. */
  readonly reason: VramPreemptCommandReason | null;
  /** Câu thô của người thi hành (đã cắt 400 ký tự ở nguồn). ⚠ CHƯA LÀM SẠCH cho i18n — xem Task 3. */
  readonly detail: string | null;
  /** `null` ⇔ lệnh dừng ở cổng quyền/khả năng, chưa có người thi hành nào được chọn. */
  readonly reclaimer: VramReclaimerId | null;
  /**
   * BYTE của **CHÍNH HỘ NÀY** đã rời sổ — **kẹp theo byte của hộ** nên không bao giờ mang byte của
   * một hộ khác vừa nhả trong cùng cửa sổ (C-1). `0` khi giấy phép còn nguyên.
   */
  readonly freedBytes: number;
  /** ★ C-1 — BẰNG CHỨNG, phơi ra để Agent kiểm được lời khai: giấy phép của hộ này đã rời sổ chưa. */
  readonly leaseLeftLedger: boolean;
  readonly reclaimed: readonly string[];
  readonly failed: readonly string[];
  readonly ledgerBytesBefore: number;
  readonly ledgerBytesAfter: number;
}

export async function vramPreemptCommand(owner: string): Promise<VramPreemptCommandResult> {
  const kq = await preemptOwner(owner);
  const chung = {
    command: "preempt" as const,
    owner,
    reclaimer: kq.reclaimer,
    freedBytes: byteRaApi(kq.freedBytes),
    leaseLeftLedger: kq.leaseLeftLedger,
    reclaimed: kq.reclaimed,
    failed: kq.failed,
    ledgerBytesBefore: byteRaApi(kq.ledgerBytesBefore),
    ledgerBytesAfter: byteRaApi(kq.ledgerBytesAfter),
    ...chungPhamVi(),
  };
  if (kq.plan.kind === "refused") {
    return { ...chung, outcome: "refused", reason: kq.plan.reason, detail: null };
  }
  return kq.failure === null
    ? { ...chung, outcome: "reclaimed", reason: null, detail: null }
    : { ...chung, outcome: "failed", reason: kq.failure, detail: kq.message };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. `releaseStale(leaseKey)`
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type VramReleaseStaleCommandReason =
  | "shared-ledger-never-refreshed"
  | "row-not-in-shared-ledger-replica"
  | "own-row-local-ledger-is-authority"
  | "process-not-proven-dead";

export interface VramReleaseStaleCommandResult extends VramCommandScope {
  readonly command: "releaseStale";
  /** Khoá hàng trong `vram_leases` — `${processKey}#${leaseId}`; đọc được ở `state.ledger.foreign.holders[].leaseKey`. */
  readonly leaseKey: string;
  readonly outcome: "released" | "refused";
  readonly reason: VramReleaseStaleCommandReason | null;
  /** Chủ của hàng. `null` ⇔ không tìm thấy hàng nào mang khoá đó. */
  readonly processKey: string | null;
  /**
   * ★ I-2 — byte của **CHÍNH HÀNG VỪA DỌN** (`HangMaCanXoa.bytes`), KHÔNG phải hiệu số
   * `foreignBytes` trước/sau (thứ bắc qua `await readProcTableSafe()` và trộn được hai ảnh chụp).
   * ⚠ `0` khi `rowKind === "shared-baseline"` — xem `rowKind`.
   */
  readonly freedBytes: number;
  /**
   * ★ M-4 — `"shared-baseline"` ⇒ `freedBytes: 0` nghĩa *"thước này không đo cái vừa xoá"* (byte nền
   * chưa bao giờ nằm trong `foreignBytes`), **không** phải *"không có gì xảy ra"*.
   */
  readonly rowKind: "sibling-lease" | "shared-baseline" | null;
  /** BỐI CẢNH, không phải nguồn của phép trừ. */
  readonly foreignBytesBefore: number | null;
  readonly foreignBytesAfter: number | null;
  /**
   * ★ M-2 — **BỀN TỚI ĐÂU.** `"queued-for-shared-ledger"`: bản sao đọc đã sạch NGAY (nên
   * `computeHeadroom()` thấy ngay), nhưng hàng chỉ rời DB ở lượt `syncSharedLedger()` kế tiếp.
   * `null` ⇔ không có gì được xếp hàng.
   */
  readonly durability: "queued-for-shared-ledger" | null;
  /** ★ M-2 — ⚠ bộ đếm **TOÀN TIẾN TRÌNH**, không quy riêng về lệnh này. `≥ 1` ⇒ còn ý định chưa gửi. */
  readonly unsyncedWritesAfter: number | null;
}

export async function vramReleaseStaleCommand(leaseKey: string): Promise<VramReleaseStaleCommandResult> {
  const kq = await releaseStaleSharedRow(leaseKey);
  return {
    command: "releaseStale",
    leaseKey,
    outcome: kq.released ? "released" : "refused",
    reason: kq.refusal,
    processKey: kq.processKey,
    freedBytes: byteRaApi(kq.freedBytes),
    rowKind: kq.rowKind,
    foreignBytesBefore: kq.foreignBytesBefore === null ? null : byteRaApi(kq.foreignBytesBefore),
    foreignBytesAfter: kq.foreignBytesAfter === null ? null : byteRaApi(kq.foreignBytesAfter),
    durability: kq.durability,
    unsyncedWritesAfter: kq.unsyncedWritesAfter === null ? null : byteRaApi(kq.unsyncedWritesAfter),
    ...chungPhamVi(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. `retryDeferred(owner)` — ★★★ BÀN GIAO CỨNG TỪ TASK 1 CHẢY THẲNG VÀO ĐÂY
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠⚠⚠ **LỆNH NÀY KHÔNG ĐƯỢC HÀNH ĐỘNG NHƯ THỂ NÓ BIẾT.**
 *
 * Task 1 vừa xoá phạm trù `"idle"` **khỏi KIỂU** vì cron `kb:sync` + hai sidecar job sống ở tiến
 * trình **`worker`** còn API được phục vụ ở **`api`**: một câu trả lời phát ra từ `api` về trạng
 * thái hoãn của chúng là một lời khẳng định về thứ tiến trình này **không nhìn thấy**. Lệnh thừa
 * hưởng nguyên ràng buộc đó:
 *   • `cron:kb-sync` — hộ **DUY NHẤT** ta chứng minh được có chủ trì ở đây hay không (`hostedHere`),
 *     và là hộ **DUY NHẤT** có cơ chế đánh thức từ ngoài (`armDeferTimer`). Không chủ trì ⇒ **NÓI
 *     THẲNG**, không im lặng thành công, không im lặng không làm gì.
 *   • 5 hộ đi qua `vramDefer.xinVramCoHoan()` — vòng lặp `await ngu(delay)` nằm **trong ngăn xếp
 *     của chính job đang chờ**. **KHÔNG có cơ chế nào** đánh thức nó từ ngoài, và `hostedHere` của
 *     chúng là `null` = **KHÔNG XÁC ĐỊNH ĐƯỢC**. ⇒ `no-retry-mechanism-for-this-host`, và ô
 *     `hostedHere: null` đi kèm để không ai đọc thành *"hộ này không chạy ở đây"*.
 *
 * ⚠ Phép phân giải `owner → host` dùng **đúng vị từ của mặt ĐỌC** (`vramBackgroundHostForOwner`),
 * nên một hộ `background` mới khai ở `HO_BACKGROUND` là có mặt ở **cả hai** mặt cùng lúc — không
 * có bản sao thứ hai của bản khai dân số.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 BA ĐƯỜNG **KHÔNG ĐƯỢC ĐI** ĐỂ "LÀM CHO LỆNH NÀY CÓ ÍCH Ở `api`** (ghi thẳng vào mã vì Task 5
 * sẽ gặp đúng cám dỗ này — cron sống ở `worker`, tRPC phục vụ ở `api`, nên ở `api` lệnh **luôn**
 * trả `host-not-running-in-this-process`).
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. **Gọi thẳng `runKbSyncNow()`** — bỏ qua `ensureDeferArmed()` (lưới cho đường thoát
 *    `already_running`) và có thể chạy **song song** một hẹn giờ đang treo. Đây là đường thứ hai.
 * 2. ⚠⚠ **Ghi một hàng "lệnh đánh thức" vào DB cho `worker` nhặt** — nghe vô hại nhất, và là đường
 *    **tệ nhất**: nó dựng một **người ghi + người đọc MỚI** cho một bất biến **đã có chủ**
 *    (`deferStreak` + `deferTimer`, một người ghi duy nhất là `kbSyncScheduler`). Đúng lớp lỗi
 *    *"hai bản sao vị từ dưới một bất biến"* đã đẻ ba Critical liên tiếp trong chuỗi pha này.
 * 3. **Biến lệnh thành no-op im lặng ở `api`** cho "trông đẹp" — đó chính là *"im lặng thành công"*,
 *    thứ ràng buộc của task này tồn tại để cấm.
 * ⇒ Cách ĐÚNG DUY NHẤT để lệnh có ích: cho **mặt ĐỌC** trả lời trước *"lệnh nào với tới hộ này từ
 * chỗ đứng hiện tại"* (bàn giao Task 4 ở `VramAgentHolderView.reclaimable`), để Agent không bao giờ
 * tốn một lượt gọi vô ích. Cửa đóng **có biển** không phải một lời nói dối.
 */
export type VramRetryDeferredCommandReason =
  | "unknown-background-host"
  | "no-retry-mechanism-for-this-host"
  | "host-not-running-in-this-process"
  | "no-defer-chain-in-this-process"
  | "defer-budget-exceeded";

export interface VramRetryDeferredCommandResult extends VramCommandScope {
  readonly command: "retryDeferred";
  readonly owner: string;
  /** Hộ `background` mà `owner` thuộc về. `null` ⇔ không hộ nào nhận `owner` này. */
  readonly host: string | null;
  /**
   * ★ `true`/`false` = **chứng minh được**; `null` = **KHÔNG XÁC ĐỊNH ĐƯỢC** (không cơ chế nào trả
   * lời câu đó cho hộ này). Đừng đọc `null` thành `false`.
   */
  readonly hostedHere: boolean | null;
  /** `"retry-armed"` = đã **DỜI HẠN** lượt thử lại về ngay — KHÔNG phải "lượt chạy đã xong". */
  readonly outcome: "retry-armed" | "refused";
  readonly reason: VramRetryDeferredCommandReason | null;
  /** Hạn thử lại TRƯỚC lệnh. `null` ⇔ không có chuỗi hoãn nào đang sống ở tiến trình này. */
  readonly previousNextRetryAt: string | null;
  readonly attempts: number | null;
}

export function vramRetryDeferredCommand(owner: string): VramRetryDeferredCommandResult {
  const host = vramBackgroundHostForOwner(owner);
  const chung = { command: "retryDeferred" as const, owner, host, ...chungPhamVi() };

  if (host === null) {
    return {
      ...chung,
      hostedHere: null,
      outcome: "refused",
      reason: "unknown-background-host",
      previousNextRetryAt: null,
      attempts: null,
    };
  }
  if (host !== "cron:kb-sync") {
    return {
      ...chung,
      // ⚠ `null`, KHÔNG `false`: 5 hộ này không có cơ chế nào trả lời "có chạy ở đây không" (Task 1 C-1).
      hostedHere: null,
      outcome: "refused",
      reason: "no-retry-mechanism-for-this-host",
      previousNextRetryAt: null,
      attempts: null,
    };
  }

  const kq = retryKbSyncDeferNow();
  return {
    ...chung,
    hostedHere: kq.hostedHere,
    outcome: kq.armed ? "retry-armed" : "refused",
    reason: kq.refusal,
    previousNextRetryAt: kq.previousNextRetryAt,
    attempts: kq.attempts,
  };
}
