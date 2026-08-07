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
   * ★★★ C-1 (review TOÀN NHÁNH Pha 6) — **PAYLOAD CÓ ĐÚNG HÌNH DẠNG BẢN NÀY BIẾT ĐỌC KHÔNG.**
   *
   * ⚠⚠ Ô này là **BẮT BUỘC** (không `?`, không mặc định) **cố ý**: nó là cách duy nhất khiến `tsc`
   * đi tìm **mọi** người tiêu thụ mặt đọc và bắt từng người trả lời câu hỏi ấy. Một ô tuỳ chọn thì
   * người thứ ba sinh ra sau sẽ **im lặng** bỏ qua nó — đúng lớp lỗi mà C-1 là hậu quả.
   * ⚠ Giá trị phải đến từ `vramStateShapeUsable(data)`, **không** viết `true` cứng — có lưới AST
   *   canh đúng điều đó ở `client/src/lib/vramReadSurface.unit.test.ts`.
   */
  readonly shapeUsable: boolean;
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
  /**
   * ★★★ C-1 — **CÓ DỮ LIỆU ≠ ĐỌC ĐƯỢC DỮ LIỆU.** Trước bản này `hasData` một mình quyết định
   * `"ready"`, và `"ready"` là giấy phép cho phần thân đi **truy cập sâu** (`s.headroom.effective
   * .bytesAtReadMs`). Một máy chủ trả payload **cũ** (`headroom.effectiveBytes`) ⇒
   * `TypeError: Cannot read properties of undefined` ⇒ throw leo lên boundary CẤP TRANG ⇒
   * **toàn bộ `/ai-brain` trắng** cho mọi vai. Đo được trên máy này, và đường tái lập trong sản
   * xuất **không cần** ai quên restart: bất kỳ lượt phát hành nào có **tài sản tĩnh đi trước tiến
   * trình API** (nginx/CDN trước pod · rolling deploy · `vite build` không kèm restart) đều dựng
   * đúng cảnh ấy.
   * ⚠ Rơi về `"unreadable"` — **từ vựng ĐÃ CÓ**, không phạm trù mới: câu đúng ở đây là *"chưa đọc
   *   được"*, và nó là câu **thật**. Cơ chế dựng ra để nói *"tôi không đọc được"* nay nói được
   *   **đúng lúc** nó không đọc được, chứ không chỉ khi tRPC ném lỗi.
   */
  if (q.hasData) return q.shapeUsable ? "ready" : "unreadable";
  return q.isLoading ? "loading" : "unreadable";
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ C-1 — DUNG SAI HÌNH DẠNG CHO `vram.state`
//
// ⚠⚠⚠ VÌ SAO PHẦN NÀY TỒN TẠI: `tsc` BIÊN DỊCH **CẢ HAI ĐẦU CÙNG LÚC**; SẢN XUẤT THÌ KHÔNG.
// Task 2 đổi `headroom.effectiveBytes` → `headroom.effective.{…}` và **cả bốn đột biến của nó đều
// chạy TRONG hệ kiểu** (*"viết một ca so `effectiveBytes` trước/sau ⇒ `tsc` phải ĐỎ"*). Không đột
// biến nào hỏi *"một người tiêu thụ **đã biên dịch TRƯỚC** đọc payload này thì sao"* — mà đó chính
// là **định nghĩa** của một thay đổi phá vỡ.
//
// ⚠⚠ **BẢNG DƯỚI KHÔNG PHẢI MỘT DANH SÁCH TỰ DO.** Nó bị một lưới AST cưỡng chế: *"∀ đường truy
// cập TRUNG GIAN trên trạng thái VRAM ở MỌI người tiêu thụ (`VramBrokerPanel` · `AIBrainDashboard`)
// PHẢI có một mục ở BẮT BUỘC hoặc ở CÓ CANH-RIÊNG"*. Thêm một lượt `s.x.y.z` mới mà quên khai ⇒
// **ĐỎ**, không im lặng thành một `TypeError` trên bản đang phục vụ.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Những đường **TRUNG GIAN** phải là một object/mảng có thật thì phần thân mới truy cập sâu được.
 * ⚠ Đây là các **nút**, không phải lá: `headroom.effective` ở đây che cho `.bytesAtReadMs`,
 * `.readMark`, `.readAtMs`… — một lá thiếu chỉ cho `undefined` (in ra "KHÔNG BIẾT"), còn một **nút**
 * thiếu là một `TypeError`.
 */
export const VRAM_STATE_REQUIRED_PATHS: readonly string[] = [
  "headroom",
  "headroom.effective",
  "headroom.degradedReasons",
  "ledger",
  "ledger.foreign",
  "ledger.localHolders",
  "unledgered",
  "unattributed",
  "baseline",
  "defer",
  "defer.hosts",
];

/**
 * Đường trung gian mà **người tiêu thụ tự canh** — không kiểm ở đây, nhưng **phải khai** cùng lý do.
 * ⚠ Khai ở đây là một **quyết định phải nói ra**, không phải một cửa miễn trừ: lưới AST đòi mỗi
 * đường trung gian có mặt ở **một trong hai** bảng, nên bỏ quên vẫn ĐỎ.
 */
export const VRAM_STATE_GUARDED_PATHS: Readonly<Record<string, string>> = {
  "baseline.unverifiedReasons": "string[] | null — panel so `=== null` TRƯỚC khi `.length`/`.join`",
  "unledgered.lastReason": "VramAgentDisplayText | null — panel so `=== null` trước khi đọc `.text`",
  "ledger.foreign.holders": "chỉ có khi `foreign.known === true` — panel rẽ nhánh trên `known` trước",
};

function laObject(x: unknown): boolean {
  return typeof x === "object" && x !== null;
}

/**
 * ★★★ *"Payload này có đúng hình dạng bản client NÀY biết đọc không?"* — trả **danh sách đường
 * hỏng**, không phải một `boolean` câm: một lượt điều tra cần biết **ô nào** lệch, và đó cũng là
 * thứ ca đột biến khẳng định.
 *
 * ⚠ Vị từ THUẦN, không React/trpc/i18next — cùng khuôn `vramCommandReach.ts`: repo có **0** file
 *   `*.test.tsx`, nên một vị từ nằm trong `.tsx` là một vị từ **không ai kiểm được**.
 */
export function vramStateShapeProblems(data: unknown): string[] {
  if (!laObject(data)) return ["<gốc> — payload không phải một object"];
  const loi: string[] = [];
  for (const duong of VRAM_STATE_REQUIRED_PATHS) {
    let cur: unknown = data;
    for (const doan of duong.split(".")) {
      if (!laObject(cur)) break;
      cur = (cur as Record<string, unknown>)[doan];
    }
    if (!laObject(cur)) loi.push(duong);
  }
  return loi;
}

/** `true` khi payload đọc được bằng bản client này. Đường ngắn cho người tiêu thụ. */
export function vramStateShapeUsable(data: unknown): boolean {
  return data !== undefined && vramStateShapeProblems(data).length === 0;
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
