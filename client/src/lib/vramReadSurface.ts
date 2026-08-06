/**
 * ★★★ Pha 5 Task 2 (N8, review vòng 1 — C-1) — **MỘT LƯỢT TỪ CHỐI QUYỀN KHÔNG PHẢI MỘT PHÉP ĐO
 * PHẦN CỨNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: CHÍNH LƯỢT SIẾT QUYỀN ĐÃ ĐÁNH THỨC MỘT ĐƯỜNG MÃ ĐANG NGỦ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 2 siết `vram.state` từ `protectedProcedure` trần lên
 * `requirePermission("machine_control","canView")` — đúng mức của tool `get_vram_state`. Nhưng
 * **trước** lượt siết ấy, nhánh `FORBIDDEN` của mặt đọc này là **BẤT KHẢ ĐẠT**: `machine_control`
 * chưa từng được seed cho **bất kỳ vai nào** (`scripts/seed-all-modules.ts:158-185`), và `admin`
 * qua được **chỉ nhờ short-circuit** (`server/_core/accessControl.ts:135-137`). ⇒ Sau lượt siết,
 * **mọi vai không phải `admin`** — mà trên `/ai-brain` thì đó là `engineer`, vai **duy nhất** khác
 * vào được màn (`client/src/lib/navigation.tsx:1374-1383`) — rơi vào nhánh ấy **mỗi lần**.
 * Một đường mã ngủ vừa thành đường **CHÍNH**.
 *
 * Và hai người đọc lúc đó **không biết trạng thái lỗi tồn tại** — tập truy cập thuộc tính trên
 * object query ở **cả hai** file đúng bằng `["data","isLoading","refetch"]`. Hậu quả đo được:
 *  • `AIBrainDashboard` rơi vào nhánh cuối và in **"CPU / không có VRAM"** — một **khẳng định về
 *    PHẦN CỨNG** dựng từ một lượt **từ chối QUYỀN**. Chính docstring ngay trên lời gọi ấy cấm
 *    `?? 0` vì *"một số 0 bịa ra là một lời khẳng định"*; câu chữ ở nhánh `:` làm đúng điều đó.
 *  • `VramBrokerPanel` cho **khung xương quay mãi mãi** (`isLoading === false`, `data === undefined`
 *    ⇒ `state.isLoading || !s` vẫn đúng), không một câu nào nói vì sao.
 *
 * ⚠⚠ **VÌ SAO MỘT MODULE CHUNG, KHÔNG PHẢI HAI NHÁNH `isError` VIẾT RIÊNG:** hai bản sao của cùng
 * một vị từ dưới cùng một bất biến là lớp lỗi cả nhánh này đang gỡ. Quyết định *"đọc không được thì
 * nói gì"* là **MỘT** quyết định; nó có **MỘT** chỗ ở.
 *
 * ⚠ File này **KHÔNG import React, không import trpc, không import i18next** — cố ý, đúng khuôn
 * `vramCommandReach.ts`: một vị từ THUẦN kiểm được bằng ca test thật (repo có **0 file
 * `*.test.tsx`**, nên một vị từ nằm trong `.tsx` là một vị từ **không ai kiểm được**).
 */

/**
 * Bốn phạm trù của mặt đọc VRAM phía client. **Vét cạn theo KIỂU** — thêm một phạm trù mà quên khai
 * ở bảng dưới là **lỗi `tsc`**, không phải một màn hiện sai âm thầm.
 */
export type VramReadSurfaceKind = "ready" | "loading" | "denied" | "unreadable";

/** Đúng những ô của một `useQuery` mà quyết định này được phép đọc. Không hơn. */
export interface VramReadSurfaceQuery {
  readonly isLoading: boolean;
  readonly isError: boolean;
  /**
   * Mã tRPC của lỗi (`error.data.code`) — `null` khi không có lỗi **hoặc** không đọc được mã.
   * ⚠ `null` ở đây nghĩa **KHÔNG BIẾT**, và nó rơi về `"unreadable"` (chiều CHẶT), **không** rơi về
   * `"denied"`: khai "thiếu quyền" cho một lỗi mạng là bịa ra một chẩn đoán.
   */
  readonly errorCode: string | null;
  /** Đã có payload thật chưa. */
  readonly hasData: boolean;
}

/**
 * ★★★ *"Mặt đọc VRAM đang ở phạm trù nào"* — **MỘT** quyết định, dùng chung cho cả thẻ KPI lẫn panel.
 *
 * ⚠⚠ THỨ TỰ LÀ MỘT PHẦN CỦA LUẬT, không phải khẩu vị:
 *  1. `isError` thắng **TRƯỚC** — đây chính là ô mà cả hai file trước đây không hỏi tới.
 *  2. `hasData` sau đó ⇒ `"ready"`.
 *  3. Còn lại: `isLoading` ⇒ `"loading"`; **không** thì `"unreadable"`.
 *
 * ⚠⚠ Nhánh cuối (`!isLoading && !isError && !hasData`) là chỗ khung xương từng quay mãi mãi. Nó
 * **PHẢI** ra `"unreadable"`, không được ra `"loading"`: *"đang tải"* cho một lượt không còn tải nữa
 * là một lời khẳng định sai — và là một lời khẳng định **không bao giờ tự sửa**.
 *
 * ⚠ **KHÔNG** phạm trù nào ở đây nói bất cứ điều gì về **PHẦN CỨNG.** Câu *"CPU / không có VRAM"*
 * chỉ có thể đến từ **DỮ LIỆU** (nhánh `"ready"`), không bao giờ từ việc thiếu dữ liệu.
 */
export function vramReadSurfaceKind(q: VramReadSurfaceQuery): VramReadSurfaceKind {
  if (q.isError) return q.errorCode === "FORBIDDEN" ? "denied" : "unreadable";
  if (q.hasData) return "ready";
  return q.isLoading ? "loading" : "unreadable";
}

/** Đọc mã tRPC (`error.data.code`) từ một lỗi bất kỳ. Không ném với đầu vào lạ — trả `null`. */
export function vramReadSurfaceErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * ★★★ Câu cho HAI phạm trù không-đọc-được. **Vét cạn theo KIỂU** trên đúng hai phạm trù ấy —
 * `"ready"`/`"loading"` cố ý bị `Exclude` ra vì chúng **không có câu**, chúng có **giao diện**.
 *
 * ⚠ Câu `denied` phải nói **HÀNH ĐỘNG TIẾP THEO** (xin quyền gì, của module nào). Một câu đúng mà
 * vô dụng — *"không đủ quyền"* trống trơn — bắt người trực đi hỏi vòng quanh.
 * ⚠ Dữ liệu KHÔNG BAO GIỜ nằm trong `defaultValue`: cả hai câu dưới là **hằng**, không nội suy.
 */
export const VRAM_READ_SURFACE_NOTICE: Record<
  Exclude<VramReadSurfaceKind, "ready" | "loading">,
  { readonly key: string; readonly fallback: string }
> = {
  denied: {
    key: "vramBroker.readDenied",
    fallback: "Không đủ quyền xem trạng thái VRAM — cần quyền XEM của module Điều khiển máy (machine_control).",
  },
  unreadable: {
    key: "vramBroker.readUnreadable",
    fallback: "Chưa đọc được trạng thái VRAM lúc này.",
  },
};
