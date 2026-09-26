/**
 * ★★★ Pha 4 Task 4 (review vòng 1, I-1) — **NÚT CHỈ ĐƯỢC HIỆN KHI LỆNH THẬT SỰ VỚI TỚI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: MỘT DẤU `||` ĐÃ VÔ HIỆU HOÁ TÍN HIỆU VỪA DỰNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu của `VramBrokerPanel` viết:
 *
 *     canRetry = retryReach.kind === "reachable-here" || status.kind === "deferring" || "exceeded"
 *
 * ⇒ nút *"Thử lại ngay"* hiện cho **5/6 hộ** mà lệnh `vram.retryDeferred` **LUÔN** từ chối
 * (`no-retry-mechanism-for-this-host`). Đó **đúng** lỗi mà bàn giao (D) của review Task 2 được dựng
 * ra để đóng — *"mặt đọc hứa nhiều hơn mặt lệnh"* — chỉ khác là nó bò lên tầng UI, nơi
 * `retryReach` (thứ vừa được dựng để trả lời chính xác câu ấy) bị một dấu `||` ghi đè.
 *
 * ⇒ Vị từ nay **CHỈ** đọc `retryReach.kind`, và nó là một **bảng VÉT CẠN theo KIỂU**: thêm một
 * phạm trù `retryReach` mà quên khai ở đây là **lỗi `tsc`**, không phải một nút hiện sai âm thầm.
 *
 * ⚠ File này **KHÔNG import React, không import trpc** — cố ý: nó là một vị từ THUẦN, kiểm được
 * bằng ca test thật (repo có **0 file `*.test.tsx`**, nên một vị từ nằm trong `.tsx` là một vị từ
 * **không ai kiểm được**).
 */

/** Ba phạm trù của `VramAgentDeferHostView.retryReach` (mặt đọc — `server/services/vram/vramReadModel.ts`). */
export type VramDeferRetryReachKind = "reachable-here" | "unreachable" | "unknown";

/**
 * ★★★ BẢNG VÉT CẠN. Mỗi phạm trù **phải** khai, và chỉ **một** phạm trù cho phép bấm.
 *
 * ⚠ `"unknown"` (ô trạng thái cron đọc không được) ⇒ **KHÔNG** cho bấm: chiều CHẶT. Ta không biết
 * lệnh có với tới không, và một nút bấm được là một lời hứa.
 */
const CHO_BAM: Record<VramDeferRetryReachKind, boolean> = {
  "reachable-here": true,
  unreachable: false,
  unknown: false,
};

/**
 * *"Nút `vram.retryDeferred` có được hiện cho hộ này không"* — **CHỈ** theo `retryReach.kind` mà
 * máy chủ tính bằng cùng vị từ với lệnh (`coCoCheDanhThucNgoai` + `coChuTriCronODay`).
 *
 * ⚠⚠ TUYỆT ĐỐI KHÔNG `||` thêm một điều kiện *"đang hoãn"*: một hộ ĐANG HOÃN THẬT mà không có cơ
 * chế đánh thức từ ngoài thì lệnh **vẫn** từ chối — chuỗi chờ nằm trong ngăn xếp của chính job đó.
 * "Đang hoãn" trả lời *"nó có chờ không"*; `retryReach` trả lời *"ta có gọi nó dậy được không"*.
 * Hai câu hỏi khác nhau; trộn chúng bằng `||` là quay lại đúng lỗi (D).
 */
export function vramRetryButtonEnabled(retryReachKind: VramDeferRetryReachKind): boolean {
  return CHO_BAM[retryReachKind];
}

/**
 * ★★★ N-5 (re-review vòng 2) — **TÍNH CHẤT CẦN CANH LÀ CÁI NÚT, KHÔNG PHẢI MỘT BIẾN.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lưới vòng trước neo vào **khai báo** `canRetry` và đòi khởi tạo của nó PHẢI LÀ lời gọi
 * `vramRetryButtonEnabled(...)`. Người review **giữ nguyên khai báo** rồi đặt `||` ở **ĐIỂM DÙNG**:
 *     {canRetry || h.status.kind === "deferring" ? <Button …/> : null}
 * ⇒ lỗi I-1 **khôi phục nguyên vẹn**, lưới **XANH 34/34**. Bất biến đúng, **neo sai một nấc**.
 *
 * ⇒ Nay chỉ có **MỘT** ô quyết định nút bấm được hay không, và nó là **`disabled` của chính nút**.
 * Hàm này gom cả ba lý do khoá nút vào một lời gọi, để `disabled` **LÀ** một lời gọi chứ không phải
 * một biểu thức ghép — mọi `||`/`?:`/biến trung gian thêm vào đó đều làm nó **thôi LÀ** lời gọi ấy.
 *
 * ⚠ Nút được **LUÔN RENDER** (không bọc điều kiện): một nút biến mất là chiều an-toàn (nó không hứa
 * gì), còn thứ nguy hiểm là một nút **bấm được** cho một lệnh chắc chắn bị từ chối. Giữ nút hiện +
 * khoá lại còn nói được cho người vận hành *"có việc này, nhưng không làm từ đây được"*.
 */
export function vramRetryButtonDisabled(
  retryReachKind: VramDeferRetryReachKind,
  commandReach: VramCommandReach,
  isPending: boolean,
): boolean {
  return !commandReach.actuation || isPending || !vramRetryButtonEnabled(retryReachKind);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ Pha 5 Task 3 (N9) — **VAI NÀO VỚI TỚI LỆNH VRAM.**
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠⚠ VÌ SAO PHẦN NÀY TỒN TẠI: MỘT BIỂU THỨC Ở **MÀN CHA** KHOÁ CHẾT CẢ BA NÚT
// ══════════════════════════════════════════════════════════════════════════════════════════════
// `pages/AIBrainDashboard.tsx:114` viết `isOpsRole = role === "admin" || role === "engineer"` rồi
// đổ **thẳng** vào `canCommand` của panel này (`:311`) ⇒ nuôi **cả ba** nút lệnh. Hệ quả kép:
//  • `supervisor` — vai **CÓ** trong `ACTUATION_ROLES` (`server/_core/trpc.ts:495`) và là vai được
//    chủ dự án chọn cho mặt lệnh VRAM — **KHÔNG BAO GIỜ** nhận `true`, dù vị từ nút có đúng đến đâu.
//  • `isOpsRole` **không phải** một câu về VRAM: nó là cổng của **Agent Ops**
//    (`aiAgent.listAgentSessionsForOps` — sàn `admin|engineer`). Một ô trả lời hai câu hỏi khác nhau
//    là đúng lớp lỗi "hai bản sao của một vị từ", chỉ khác chiều: **một bản sao dùng cho hai bất biến**.
//
// ⚠⚠ **BA NÚT ĐỨNG TRÊN HAI SÀN QUYỀN KHÁC NHAU** (`server/routers/vramRouter.ts`) — nên MỘT
// boolean cho cả ba là một lời nói dối theo **cả hai chiều**:
//   | nút | thủ tục | bit (**sau Task 3b**) |
//   |---|---|---|
//   | Thu hồi (`preempt`) · Dọn lease (`releaseStale`) | `deployProcedure` | `vram_control/canDelete` |
//   | Thử lại ngay (`retryDeferred`) | `actuationProcedure` | `vram_control/canCreate` |
// Gộp hai sàn vào một ô thì hoặc một vai chỉ có `canCreate` thấy hai nút **chắc chắn 403** (hứa
// NHIỀU hơn), hoặc mất nút *"Thử lại ngay"* mà máy chủ **cho phép** chạy (hứa ÍT hơn).
// ⇒ **HAI** grant, mỗi nút khớp **đúng** sàn của nó.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ Pha 5 Task 3b — **BIT ĐÃ TÁCH RA KHỎI `machine_control`, VÀ FILE NÀY PHẢI ĐỌC BIT MỚI.**
// ════════════════════════════════════════════════════════════════════════════════════════════════
// `machine_control/canDelete` là sàn dùng chung của **10 thủ tục ở 8 router**, **8/10 KHÔNG có 2FA**
// — gồm `programming.deleteProject` (**xoá CASCADE cây mã nguồn có phiên bản**, không chốt an toàn,
// không OTP) — nên cấp nó cho `supervisor` để mở hai nút VRAM sẽ mở luôn **chín** thủ tục khác.
// Chủ dự án chốt: **TÁCH BIT RIÊNG** ⇒ `VRAM_CONTROL_MODULE`.
// ⚠ Bảng vai dưới đây là **gương của máy chủ**, nên khi máy chủ đổi cổng thì gương phải đổi theo —
// `VRAM_LENH_GATE` khai **đúng cặp (module, action)** mà `vramRouter` đang đứng trên, và một ca
// **đối chiếu NGUỒN ĐỘC LẬP** (đọc thẳng `server/routers/vramRouter.ts` bằng AST) ở
// `vramCommandReach.role.unit.test.ts` bắt mọi lượt lệch: trả router về `machine_control` ⇒ **ĐỎ**.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { VRAM_CONTROL_MODULE } from "@shared/permissions";

/**
 * ★★★ **CỔNG QUYỀN THẬT của từng nút** — khai ở ĐÂY để câu *"nút này đứng trên bit nào"* có **một**
 * chỗ trả lời, và để lưới đối chiếu được với máy chủ bằng máy chứ không bằng mắt người.
 *
 * ⚠ Đây **KHÔNG** phải nơi cưỡng chế (máy chủ cưỡng chế, độc lập). Nó là **bản khai** để lưới so.
 */
export const VRAM_LENH_GATE = {
  /** `preempt` · `releaseStale` — PHÁ HUỶ. */
  destructive: { module: VRAM_CONTROL_MODULE, action: "canDelete" },
  /** `retryDeferred` — không phá huỷ. */
  actuation: { module: VRAM_CONTROL_MODULE, action: "canCreate" },
} as const;

/**
 * Mọi vai của hệ. **Vét cạn theo KIỂU**: thêm một vai mà quên khai ở bảng dưới là **lỗi `tsc`**.
 *
 * ⚠ Nguồn sự thật là `server/db/auth.ts` (`UserRole`) — client không import được module máy chủ, nên
 * bản sao này bị canh bằng một ca **đối chiếu NGUỒN ĐỘC LẬP** (đọc chính file ấy) ở
 * `vramCommandReach.role.unit.test.ts`: thêm một vai ở máy chủ mà quên ở đây ⇒ **ca ĐỎ**.
 */
export type VramCommandRole =
  | "admin"
  | "supervisor"
  | "quality_inspector"
  | "operator"
  | "maintenance"
  | "engineer"
  | "viewer"
  | "user";

/**
 * ★★★ HAI BẢNG VÉT CẠN — mỗi bảng là **một** câu hỏi, và nó là câu hỏi mà **máy chủ** hỏi.
 *
 * ⚠ Đây **KHÔNG** phải bản sao thứ hai của RBAC: máy chủ vẫn cưỡng chế độc lập (role-floor + 2FA +
 * step-up + `requirePermission`). Bảng này chỉ trả lời *"có nên hiện một nút bấm được không"* — và
 * nó phải **hẹp hơn hoặc bằng** máy chủ, không bao giờ rộng hơn.
 */
const CHO_RA_LENH: Record<VramCommandRole, { readonly destructive: boolean; readonly actuation: boolean }> = {
  // Vai DUY NHẤT short-circuit `checkPermission` (`server/_core/accessControl.ts:136`) ⇒ qua mọi
  // module, kể cả `vram_control`, không cần một hàng quyền nào.
  admin: { destructive: true, actuation: true },
  // ★ N9 — QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN: `supervisor` phải **dùng được thật**. Có trong `ACTUATION_ROLES`;
  //   `vram_control/canDelete` + `canCreate` là hàng quyền chủ dự án duyệt ở lượt DỮ LIỆU riêng
  //   (xem báo cáo Task 3b — per-USER, **không** đổi khuôn vai).
  supervisor: { destructive: true, actuation: true },
  // ★ `engineer`: `vram_control/canCreate` CÓ (⇒ "Thử lại ngay" bật), `canDelete` KHÔNG (⇒ hai nút
  //   phá huỷ tắt). Nghiệm thu sống lượt C3: engineer **có OTP tươi** vẫn 403 trên `preempt`.
  engineer: { destructive: false, actuation: true },
  // Bốn vai dưới KHÔNG có trong `ACTUATION_ROLES` ⇒ mọi lệnh 403 ở role-floor, trước cả RBAC.
  quality_inspector: { destructive: false, actuation: false },
  operator: { destructive: false, actuation: false },
  maintenance: { destructive: false, actuation: false },
  viewer: { destructive: false, actuation: false },
  user: { destructive: false, actuation: false },
};

declare const NHAN_GRANT: unique symbol;

/**
 * ★★★ **ĐỔI KIỂU ĐỂ PHÁT BIỂU SAI KHÔNG VIẾT RA ĐƯỢC.**
 *
 * Một boolean trần thì `canCommand={true}` / `vramRetryButtonDisabled(k, true, p)` biên dịch sạch và
 * mở cả ba nút cho **mọi** vai — lưới AST vẫn XANH vì `disabled` **vẫn LÀ** một lời gọi. Nhãn dưới
 * đây (`unique symbol` **không export**) làm việc ấy **không viết ra được**: giá trị duy nhất có
 * kiểu này đến từ `vramCommandReach(...)`.
 */
type VramGrant = boolean & { readonly [NHAN_GRANT]: "vram-command-reach" };

/** Tầm với của MỘT vai trên mặt lệnh VRAM. Hai ô = hai sàn quyền của máy chủ, không gộp. */
export interface VramCommandReach {
  /** `preempt` · `releaseStale` — `deployProcedure` + `vram_control/canDelete`. **PHÁ HUỶ**. */
  readonly destructive: VramGrant;
  /** `retryDeferred` — `actuationProcedure` + `vram_control/canCreate`. Không phá huỷ. */
  readonly actuation: VramGrant;
}

/**
 * Vị từ *"người dùng HIỆN TẠI có bit này không"* — **đúng chữ ký** `usePermissions().hasPermission`
 * (`client/src/_core/hooks/usePermissions.ts:52`), để panel truyền thẳng hàm đã có, **không** đẻ
 * người đọc thứ hai cho một bất biến đã có chủ.
 */
export type CoBitQuyen = (
  moduleName: string,
  action: "canView" | "canCreate" | "canEdit" | "canDelete" | "canExport",
) => boolean;

/**
 * ★★★ *"NGƯỜI này với tới mặt lệnh VRAM đến đâu"* — **MỘT** quyết định, **MỘT** chỗ ở.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ I-2 (review Task 3b) — **VAI KHÔNG PHẢI THẨM QUYỀN, VÀ SAU 3B SAI LỆCH ẤY LÀ VĨNH VIỄN**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản Task 3 quyết định **chỉ theo VAI**. Khi bit còn là `machine_control` thì sai lệch ấy còn nhỏ
 * — module đó **có** trong `DEFAULT_ROLE_PERMISSIONS` nên một `supervisor` áp khuôn là có bit thật.
 * Task 3b đổi sang `vram_control`, một module **CỐ Ý không bao giờ vào khuôn vai** (per-USER, chủ
 * dự án duyệt từng người) ⇒ `vramCommandReach("supervisor").destructive === true` sẽ **SAI VĨNH
 * VIỄN** cho mọi supervisor chưa được cấp tay, kể cả một supervisor **vừa tạo**. Đó đúng lớp lỗi
 * *"mặt đọc hứa nhiều hơn mặt lệnh"* mà cả Pha 5 đang đóng, do chính bản vá đóng nó tạo ra.
 *
 * ⇒ Nay quyết định là **PHÉP HỘI của ĐÚNG HAI cổng mà máy chủ có**, không hơn không kém:
 *   1. **sàn VAI** (`roleProcedure(...ACTUATION_ROLES)` — `server/_core/trpc.ts:495`) → bảng
 *      `CHO_RA_LENH` trên;
 *   2. **bit PER-USER** (`requirePermission(VRAM_CONTROL_MODULE, …)`) → `coBitQuyen`, đọc **đúng
 *      cặp `(module, action)`** khai ở `VRAM_LENH_GATE`.
 * `usePermissions.hasPermission` tự short-circuit cho `admin` (`:53`), như `checkPermission` máy chủ
 * (`accessControl.ts:136`).
 * ⚠⚠ **M-3 (review TOÀN NHÁNH 2026-08-06) — CÂU "HAI PHÍA TRẢ LỜI CÙNG MỘT CÂU" CHỈ ĐÚNG KHI
 * `RBAC_SCOPED_ADMIN` TẮT.** Khi cờ ấy bật, máy chủ **TỪ CHỐI** một admin có hàng `vram_control`
 * với `canDelete:false` (`accessControl.ts:163`), còn client trả `true` **vô điều kiện**
 * (`usePermissions.ts:53`) ⇒ gương thành **RỘNG HƠN** máy chủ, vi phạm chính luật file này tự đặt ở
 * `:151` (*"phải hẹp hơn hoặc bằng máy chủ, không bao giờ rộng hơn"*).
 * Cờ **không có trong `.env`** hôm nay (mặc định OFF) ⇒ **chưa sống**. Ai bật nó phải sửa
 * `usePermissions.hasPermission` **trước** — đó là một bất biến của **TOÀN hệ**, không riêng VRAM,
 * nên nó **không** được vá lén ở đây.
 *
 * ⚠⚠ **CHIỀU CHẶT ở MỌI đầu vào lạ.** `role` có thể `undefined` (chưa nạp), là một chuỗi hệ chưa
 * biết, hoặc một khoá `Object.prototype` (`"toString"`, `"__proto__"`). `coBitQuyen` có thể thiếu
 * (gọi từ JS), không phải hàm, ném, hoặc trả một thứ không phải `true`. **Không biết ⇒ KHÔNG** —
 * một nút bấm được là một lời hứa.
 * ⚠ Trong lúc `getMyPermissions` còn đang nạp, `hasPermission` trả `false` ⇒ nút **tắt rồi bật**
 * khi dữ liệu về. Đó là chiều an toàn: không bao giờ có cửa sổ "bấm được mà chắc chắn 403".
 */
export function vramCommandReach(role: unknown, coBitQuyen: CoBitQuyen): VramCommandReach {
  const sanVai =
    typeof role === "string" && Object.prototype.hasOwnProperty.call(CHO_RA_LENH, role)
      ? CHO_RA_LENH[role as VramCommandRole]
      : { destructive: false, actuation: false };

  const coBit = (cong: { module: string; action: CoBitQuyenAction }): boolean => {
    if (typeof coBitQuyen !== "function") return false;
    try {
      return coBitQuyen(cong.module, cong.action) === true;
    } catch {
      return false; // một người đọc quyền ném ra lỗi KHÔNG được đọc thành "có quyền"
    }
  };

  return {
    destructive: (sanVai.destructive && coBit(VRAM_LENH_GATE.destructive)) as VramGrant,
    actuation: (sanVai.actuation && coBit(VRAM_LENH_GATE.actuation)) as VramGrant,
  };
}

type CoBitQuyenAction = Parameters<CoBitQuyen>[1];

/**
 * ★★★ N9 — **MỘT Ô DUY NHẤT quyết định hai nút PHÁ HUỶ, và nó là một LỜI GỌI.**
 *
 * Cùng kỷ luật N-5 đã trả giá cho nút *"Thử lại ngay"*: `disabled` phải **LÀ** lời gọi này, không
 * phải một biểu thức ghép — mọi `||`/`?:`/`??`/biến trung gian thêm vào đều làm nó **thôi LÀ** lời
 * gọi ấy ⇒ lưới ĐỎ. Và tham số đầu là `VramCommandReach`, nên **không** truyền tay một `true` vào
 * được (⇒ `tsc` ĐỎ).
 */
export function vramDestructiveButtonDisabled(commandReach: VramCommandReach, isPending: boolean): boolean {
  return !commandReach.destructive || isPending;
}
