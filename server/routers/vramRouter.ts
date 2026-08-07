/**
 * ★★★ Pha 4 Task 1 + Task 2 — **ROUTER TRẠNG THÁI VRAM (đọc) + BA LỆNH (ghi).**
 *
 * Bảy pha trước dựng cơ chế; pha này làm nó **dùng được** cho AI Agent. Router **mỏng có chủ ý**:
 * phép ghép của mặt đọc nằm ở `services/vram/vramReadModel.ts`, ngữ nghĩa của lệnh nằm ở
 * `services/vram/vramCommands.ts`; cả hai đọc/gọi **đúng những hàm mà đường quyết định dùng** —
 * không có đường thứ hai (ràng buộc 2).
 *
 * ⚠ **Pha 4 KHÔNG đổi hành vi cấp phát.** `state` không cấp/thu hồi/hoãn gì, và ba lệnh chỉ **gọi**
 * `broker.preemptStepForOwner()` → `NGUOI_THI_HANH` · `lapKeHoachNhanNuoi()` · `armDeferTimer()`.
 * ⚠ `reserve()` vẫn **ĐỒNG BỘ** — không một hàm nào ở đây nằm trên đường quyết định.
 *
 * PHÂN QUYỀN: `state` ở `protectedProcedure` **+ `requirePermission("machine_control","canView")`**
 * — **cùng mức với tool `get_vram_state`** (Pha 5 Task 2 / N8; xem khối ngay trên `vramReadProcedure`).
 * Ba lệnh: xem khối I-1 dưới.
 */
import { z } from "zod";
import { router, protectedProcedure, actuationProcedure, deployProcedure, requirePerCallFreshTotp } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
// ★ Pha 5 Task 3b — tên module quyền của VRAM có MỘT chủ: `shared/permissions.ts` (nơi
// `PERMISSION_MODULES` là nguồn duy nhất). Viết lại chuỗi ở đây là đẻ bản sao thứ hai.
import { VRAM_CONTROL_MODULE } from "@shared/permissions";
import { buildVramAgentState } from "../services/vram/vramReadModel";
/**
 * ★★★ I-2 / M-5 (review TOÀN NHÁNH 2026-08-06) — **BỀ RỘNG Ô DANH TÍNH ĐỌC TỪ MỘT CHỦ DUY NHẤT.**
 *
 * Trước bản này trần `160` là **hai con số chép tay ở hai file** (`vramSharedLedger.cat(…, 160)` và
 * `.max(160)` ở đây), nên **không ca nào** ràng buộc chúng với nhau: đột biến `.max(64)` làm **cổng
 * đầy đủ 100 file / 1692 ca XANH TOÀN BỘ**. `owner` sản xuất là chuỗi ĐỘNG lấy từ **đường dẫn tuyệt
 * đối** (`ocrService.ts:384` `onnx-ocr:${modelPath}`) ⇒ khoảng 65–160 ký tự là vùng mù **có thể
 * chạm tới bằng một lượt đổi thư mục model**. Xem `services/vram/vramColumnLimits.ts`.
 */
import { VRAM_OWNER_MAX, VRAM_LEASE_KEY_MAX } from "../services/vram/vramColumnLimits";
import {
  vramPreemptCommand,
  vramReleaseStaleCommand,
  vramRetryDeferredCommand,
} from "../services/vram/vramCommands";

/**
 * ★★★ Pha 4 Task 2 — **PHÂN QUYỀN CHO LỆNH.** Đọc khuôn có sẵn, KHÔNG phát minh khuôn mới.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ I-1 (review) — **SÀN DANH TÍNH KHÔNG PHẢI SÀN THẨM QUYỀN.** Bản đầu của Task 2 dừng ở
 * `deployProcedure` và biện hộ bằng một tiền lệ **SAI SỰ THẬT** (*"`fleetRouter` dùng actuation
 * không kèm `requirePermission`"*). Sự thật đếm được: `fleetRouter` **19/19** thủ tục actuation đều
 * chain `requirePermission("machine_control", …)`, và `programmingRouter.deployBuild` — chính tiền
 * lệ `deployProcedure` được nêu — **cũng chain**. `_core/trpc.ts` viết thẳng: role-floor
 * *"composes **ON TOP of (never replaces)**"* `requirePermission`.
 * ⇒ `deployProcedure` một mình chỉ trả lời *"anh có phải engineer không"*, KHÔNG trả lời *"engineer
 * NÀY có được điều khiển máy không"* — tức một engineer **không một bit quyền nào** đi thẳng vào
 * được thân thủ tục **giết tiến trình**.
 *
 * | thủ tục | sàn | vì sao |
 * |---|---|---|
 * | `state` | `protectedProcedure` + `requirePermission("machine_control","canView")` | chỉ ĐỌC, nhưng đọc **thông tin hạ tầng** (`processKey`/`owner`/`leaseKey`) ⇒ **bằng mức tool `get_vram_state`** (N8). |
 * | `preempt` · `releaseStale` | `deployProcedure` + `requirePermission(VRAM_CONTROL_MODULE,"canDelete")` | **PHÁ HUỶ**: `preempt` giết được một tiến trình; `releaseStale` xoá một hàng khỏi sổ mà **mọi tiến trình anh em** đọc để tính dư địa. `canDelete` (không phải `canCreate`) vì hành vi là **phá huỷ**. |
 * | `retryDeferred` | `actuationProcedure` + `requirePermission(VRAM_CONTROL_MODULE,"canCreate")` | KHÔNG phá huỷ gì — chỉ **dời hạn** một lượt thử lại đã lên lịch. Nhưng nó tiêu VRAM và chạm đường cron ⇒ vẫn ở sàn actuation. |
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 5 Task 3b — **BIT QUYỀN CỦA BA LỆNH ĐÃ TÁCH RA KHỎI `machine_control`.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 4 dựng ba lệnh trên `machine_control/canDelete|canCreate` vì đó là bit **đã có** đúng nghĩa
 * *"điều khiển máy"*. Đo lại ở Pha 5 cho thấy giá của việc dùng chung:
 *  • `machine_control/canDelete` = sàn của **10 thủ tục ở 8 router**, **8/10** là `protectedProcedure`
 *    **TRẦN** (không role-floor, không 2FA). Nguy hiểm nhất: `programming.deleteProject`
 *    (`programmingRouter.ts:261`) **xoá CASCADE cây mã nguồn có phiên bản**, không chốt an toàn,
 *    không OTP — cộng **5 bề mặt UI** hiện nút xoá ngay khi cấp.
 *  • `machine_control/canCreate` còn **RỘNG HƠN**: ~90 điểm gọi ở 17 router (`fleetRouter` 19 ·
 *    `safetyRouter` 18 …) — tức start/stop máy và fleet actuation.
 * ⇒ Cấp bit dùng chung cho `supervisor` để mở **hai nút VRAM** (hai thủ tục **CHẶT NHẤT** trong tập,
 * có step-up) sẽ mở luôn **chín thủ tục khác**, phần lớn **không** có OTP.
 * ⚠ **M-4 — ĐÃ VÁ Ở PHA 6 TASK 1, VÀ LẦN NÀY SỬA MÃ, KHÔNG CHỈ SỬA LỜI.** Pha 5 chỉ **ghi nhận**
 * rằng `stepUpVerifiedUntil` (`_core/trpc.ts`) là cache **10 phút theo `sessionToken`** dùng chung
 * cho **mọi** `deployProcedure` — nghiệm thu sống sau đó **đo được** `engineer1` gọi `vram.preempt`
 * **không `totpCode`** vẫn QUA. Nay hai lệnh phá huỷ chain thêm `requirePerCallFreshTotp`: **mỗi
 * lượt phải mang OTP của CHÍNH nó**.
 * ★★★ **TASK 1b ĐÃ ĐÓNG NỐT (2026-08-06, chủ dự án chốt):** năm thủ tục `deployProcedure` còn lại
 * (`programming.deployBuild` · `approveDeployment` · `rollbackDeployment` · `deployToFleet` ·
 * `orchestration.deployWorkflow`) **KHÔNG còn** cache phiên — phép siết nay nằm ở **GỐC**
 * `deployProcedure` (`_core/trpc.ts`), nên **cả 7** thủ tục đòi OTP mỗi lượt.
 * ⚠ Lý do hoãn ở bản đầu là **SAI SỰ THẬT** và I-1 của review đã bác: *"`deployToFleet` chạy tuần
 * tự nhiều máy ⇒ siết toàn cục sẽ gãy giữa chừng khi mã hết hạn"* — vòng lặp ấy nằm **TRONG MÁY
 * CHỦ, trong MỘT request tRPC** (`services/programming/fleetRollout.ts` → `programmingService` —
 * lời gọi hàm, **không** qua middleware); client gọi **đúng một lần**, và **5/5** thủ tục kia đều
 * đã bọc `stepUp.guard(...)` + đã gửi `totpCode`. Đừng trích lý do sai ấy để biện hộ cho việc
 * không đóng một lỗ step-up nào khác.
 * **Chủ dự án chốt (2026-08-06): TÁCH BIT RIÊNG** ⇒ `VRAM_CONTROL_MODULE` (`@shared/permissions`).
 *
 * ⚠⚠ Task 3b **THU HẸP, KHÔNG NỚI**: `deployProcedure`/`actuationProcedure` + step-up 2FA giữ
 * **nguyên từng ký tự**; chỉ **vế thẩm quyền** đổi chủ. Sau lượt này một user có
 * `machine_control/canDelete` **KHÔNG** còn với tới `preempt`/`releaseStale`.
 * ⚠ Mặt ĐỌC `state` **cố ý ở lại** `machine_control/canView`: đó là quyết định N8 của chủ dự án
 * (*"siết ROUTER lên bằng TOOL"*) — đổi nó mà không đổi `get_vram_state` sẽ **mở lại đúng khe hở
 * vừa đóng**, và `canView` là bit **chỉ đọc**, bề mặt dùng chung của nó không có thủ tục phá huỷ nào.
 *
 * ⚠⚠ **KHÔNG có `moduleGate(...)` — M-1 BỊ TỪ CHỐI, và lý do là một PHÉP ĐO, không phải khẩu vị.**
 * Đề xuất dựa trên giả định *"`moduleGate` mặc định pass-through ⇒ thêm vào là không rủi ro"*.
 * Giả định đó **SAI trên chính deployment này**: `LICENSE_MODULE_GATE_ENABLED` **mặc định BẬT**
 * (`_core/moduleGate.ts` — no-brick chỉ fail-OPEN khi SKU **chưa từng** được khai), và SKU ở đây
 * **có khai** nhưng **không gồm `MOD_AI`**. Bản thử `.use(moduleGate("MOD_AI"))` làm **cả 24 ca**
 * đỏ với `FEATURE_DISABLED` / *"Module AI & Local Intelligence chưa được cấp phép"* ⇒ ba lệnh sẽ
 * **TẮT HẲN** ở hệ đang chạy.
 * Và đó không chỉ là một lỗi cấu hình: bộ điều phối VRAM là **HẠ TẦNG**, nó chạy kể cả khi SKU AI
 * không được mua (ONNX của đường AOI vẫn ngốn VRAM). Khoá mặt **quản trị** VRAM sau giấy phép AI là
 * lấy mất khả năng thu hồi đúng lúc không quản được — ngược chiều an toàn. Ai muốn gate bề mặt này
 * phải chọn một mã SKU nói đúng *"hạ tầng suy luận"*, và đó là một quyết định về SKU, không phải
 * một dòng `.use()`.
 * ⚠ `totpCode` **BẮT BUỘC** ở input hai lệnh phá huỷ — đúng tiền lệ `programmingRouter.deployBuild`.
 * Middleware đọc nó từ **raw input** (trước zod) và chỉ đòi khi cờ `ACTUATION_STEPUP_2FA` bật, nên
 * zod ở đây **không** là cổng an ninh; nó là cổng **hợp đồng**. ★★★ I-4 (review Task 1b): bản
 * trước để `.optional()` và chính điều đó khiến `tsc` **ban phước** cho một lượt gỡ `totpCode` khỏi
 * điểm gọi client (đột biến R2 ⇒ 108 file/1837 ca XANH, tsc SẠCH). Bắt buộc ⇒ lỗi biên dịch.
 * ⚠ Mọi lượt TỪ CHỐI NGHIỆP VỤ (hộ không thu hồi được, hàng chưa chứng minh là ma, hộ không chủ trì
 * ở đây) trả về **DỮ LIỆU có `reason`**, KHÔNG ném: Agent cần đọc lý do để chọn bước tiếp theo, và
 * một ngoại lệ chỉ còn lại một câu chữ. Ném là dành cho **thiếu quyền** — việc của middleware.
 */
const totp = { totpCode: z.string().max(16) };

/**
 * Sàn của một lệnh **PHÁ HUỶ**: danh tính (role-floor + 2FA + step-up) **VÀ** thẩm quyền.
 * ⚠ Task 3b: vế thẩm quyền là **bit RIÊNG của VRAM**, không còn `machine_control/canDelete`.
 * ⚠ Pha 6 Task 1 (M-4): **`requirePerCallFreshTotp` chain THÊM ở cuối** — mỗi lượt gọi phải mang
 * `totpCode` của **CHÍNH lượt ấy**, không lượt nào qua bằng cache phiên của một lượt khác. Nó
 * **chỉ THU HẸP**: `deployProcedure` (role-floor + 2FA + step-up) giữ nguyên bên dưới.
 * ⚠ Task 1b chain phép siết ấy vào **chính `deployProcedure`**, nên lượt `.use()` ở đây **dư thừa
 * về hành vi** — **cố ý giữ** ở bản Task 1b vì lưới cấu trúc của `vramStepUpFreshness.test.ts` khi
 * đó phân giải chuỗi **trong phạm vi file này**.
 * ★★★ **I-4 (review TOÀN NHÁNH) — HAI ĐÍNH CHÍNH, ĐỪNG TRÍCH LẠI CÂU CŨ:**
 *  1. **Chi phí ghi SAI cả hai con số.** Câu cũ nói *"hai lượt verify, và chỉ trên đường
 *     cache-miss"*. Chuỗi thật là `requireFreshTotp` → `requirePerCallFreshTotp` (GỐC) →
 *     `requirePermission` → `requirePerCallFreshTotp` (**đây**), và `stepUpTotpMiddleware(false)`
 *     **không có** đường thoát sớm ⇒ **cache-miss = 3** lượt verify · **cache-hit = 2** — tức lượt
 *     verify thừa xảy ra ở **MỌI lượt gọi**, đúng NGƯỢC với câu cũ. Mỗi lượt = 1 `SELECT users` +
 *     1 `speakeasy.totp.verify`. Không phải lỗi an ninh (thừa theo chiều CHẶT).
 *  2. **Lý do "gỡ nó là gỡ mất phép canh" KHÔNG CÒN ĐÚNG.** Bản vá C-2 dựng
 *     `quetLenhPhaHuyVram()` (`server/routers/deployProcedureScan.ts`) — lượng từ chạy trên
 *     **`server/**` đệ quy** và chấp nhận phép siết đến **tại chỗ HOẶC qua GỐC `deployProcedure`**.
 *     Nên hôm nay lượt `.use()` này là một quyết định thuần về **chi phí**, và chủ dự án gỡ nó đi
 *     thì **không lưới nào mất răng**.
 * Lưới: `server/routers/vramStepUpFreshness.test.ts` · `server/routers/deployStepUpFreshness.test.ts`.
 */
const vramDestructiveProcedure = deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete")).use(requirePerCallFreshTotp);

/** Sàn của một lệnh **KHÔNG phá huỷ** nhưng vẫn là actuation. Cùng bit riêng, action `canCreate`. */
const vramActuationProcedure = actuationProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate"));

/**
 * ★★★ Pha 5 Task 2 (N8) — **SÀN CỦA MẶT ĐỌC.**
 *
 * Nợ Pha 4 để lại: **hai mặt đọc trả lời KHÁC NHAU cho cùng một câu hỏi.** Tool Agent
 * `get_vram_state` (`services/aiLocalTools/vramTools.ts:340`) đòi
 * `requiredPermission: { module: "machine_control", action: "canView" }`, trong khi `state` ở đây
 * là `protectedProcedure` **trần** — mà `protectedProcedure` (`_core/trpc.ts:171`) chỉ đòi có
 * `ctx.user` ⇒ **mọi user đăng nhập** đọc được. Cùng một `buildVramAgentState()`, hai mức quyền.
 *
 * ⚠ Quyết định của chủ dự án (2026-08-06): **SIẾT ROUTER LÊN BẰNG TOOL**, không hạ tool xuống.
 * Lý do là **nội dung của payload**, không phải khẩu vị: mặt đọc phơi `processKey` (định danh
 * tiến trình của HỆ), `owner` (tên hộ tiêu thụ, gồm tên model đang nạp) và `leaseKey` — tức
 * **thông tin hạ tầng**. Và từ Pha 3 (sổ chung xuyên tiến trình) `owner` có thể do **một tiến
 * trình khác** ghi vào, nên nó không còn là dữ liệu của riêng tiến trình đang trả lời.
 *
 * ⚠ Khuôn: `_core/trpc.ts:456-464` — role-floor *"composes **ON TOP of (never replaces)**"*
 * `requirePermission`. Ở đây **không có role-floor để cộng lên** (`state` chỉ ĐỌC, không phải
 * actuation ⇒ không kéo `require2FA`/`ACTUATION_ROLES` vào một truy vấn), nên phép cộng là
 * `protectedProcedure` (danh tính) **+** `requirePermission` (thẩm quyền) — đúng chữ ký mà
 * `accessControl.ts:169` nêu làm ví dụ chuẩn.
 * ⚠ Vị từ đã có sẵn đúng nghĩa ⇒ **không đẻ vị từ quyền mới**.
 */
const vramReadProcedure = protectedProcedure.use(requirePermission("machine_control", "canView"));

export const vramRouter = router({
  /**
   * Ảnh chụp trạng thái VRAM. **Mỗi trường nói đúng độ chắc chắn của nó** — đọc docstring của
   * `VramAgentState` trước khi hành động theo một con số ở đây. Ba chỗ dễ đọc nhầm nhất:
   *  • `attributable.known === false` là **CHẶN TRÊN** của dư địa, KHÔNG phải trạng thái an toàn;
   *  • `ledger.foreign.known === false` nghĩa **ĐANG MÙ về tiến trình anh em**, KHÔNG phải "không ai giữ";
   *  • `unledgered.estimateBytes` là **ƯỚC LƯỢNG**, và `unknownCount > 0` làm nó **mất tin cậy**.
   */
  state: vramReadProcedure.query(async () => buildVramAgentState()),

  /**
   * ★★★ **THU HỒI MỘT HỘ ĐÍCH DANH.** Đi qua `broker.preemptStepForOwner()` → bảng `NGUOI_THI_HANH`
   * — **không có đường thứ hai**, và không một `process.kill` nào ở tầng này.
   *
   * ⚠⚠ ĐỌC `outcome` TRƯỚC `freedBytes`: `"reclaimed"` chỉ phát ra khi **giấy phép CỦA CHÍNH HỘ ĐÓ
   * đã rời sổ** (`leaseLeftLedger`) — KHÔNG phải khi tổng sổ co lại (C-1: tổng là đại lượng dùng
   * chung, đo bắc qua `await` sẽ nhận byte của hộ khác). Người thi hành khai xong mà giấy phép còn
   * nguyên ⇒ `"failed"` + `reason: "no-bytes-freed"` (Pha 2B C-2: giết hộ 7,8 GB xong lượt xin
   * **vẫn** hỏng). `"refused"` ⇒ **chưa ai bị đụng**.
   */
  preempt: vramDestructiveProcedure
    .input(z.object({ owner: z.string().trim().min(1).max(VRAM_OWNER_MAX), ...totp }))
    .mutation(async ({ input }) => vramPreemptCommand(input.owner)),

  /**
   * ★★★ **DỌN MỘT HÀNG MA TRONG SỔ CHUNG.** Chỉ chạy khi `lapKeHoachNhanNuoi()` — **cùng người lập
   * kế hoạch mà nhịp đối chiếu dùng** — chứng minh được chủ hàng đã CHẾT (vắng khỏi bảng tiến trình,
   * hoặc PID đã được cấp lại). Bảng tiến trình không đọc được ⇒ **không có bằng chứng** ⇒ từ chối.
   * ⚠ `leaseKey` đọc ở `state.ledger.foreign.holders[].leaseKey`.
   */
  releaseStale: vramDestructiveProcedure
    .input(z.object({ leaseKey: z.string().trim().min(1).max(VRAM_LEASE_KEY_MAX), ...totp }))
    .mutation(async ({ input }) => vramReleaseStaleCommand(input.leaseKey)),

  /**
   * ★★★ **ĐẨY MỘT HỘ `background` ĐANG HOÃN THỬ LẠI NGAY.**
   *
   * ⚠⚠ Chỉ `cron:kb-sync` có cơ chế đánh thức từ ngoài, và **chỉ ở tiến trình chủ trì cron**. Với
   * mọi hộ khác lệnh trả `refused` + `reason` + `hostedHere: null` — **nói thẳng rằng nó không
   * làm gì**, thay vì im lặng thành công. Xem `vramCommands.ts`.
   */
  retryDeferred: vramActuationProcedure
    .input(z.object({ owner: z.string().trim().min(1).max(VRAM_OWNER_MAX) }))
    .mutation(({ input }) => vramRetryDeferredCommand(input.owner)),
});
