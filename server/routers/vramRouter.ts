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
 * PHÂN QUYỀN: `state` ở `protectedProcedure` (chỉ ĐỌC), cùng mức với các mặt trạng thái AI đã có
 * (`aiGgufRouter.status` / `listModels`, vốn cũng trả đường dẫn model). Ba lệnh: xem khối I-1 dưới.
 */
import { z } from "zod";
import { router, protectedProcedure, actuationProcedure, deployProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { buildVramAgentState } from "../services/vram/vramReadModel";
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
 * | `state` | `protectedProcedure` | chỉ ĐỌC (Task 1). |
 * | `preempt` · `releaseStale` | `deployProcedure` + `requirePermission("machine_control","canDelete")` | **PHÁ HUỶ**: `preempt` giết được một tiến trình; `releaseStale` xoá một hàng khỏi sổ mà **mọi tiến trình anh em** đọc để tính dư địa. `canDelete` (không phải `canCreate`) vì hành vi là **phá huỷ**. |
 * | `retryDeferred` | `actuationProcedure` + `requirePermission("machine_control","canCreate")` | KHÔNG phá huỷ gì — chỉ **dời hạn** một lượt thử lại đã lên lịch. Nhưng nó tiêu VRAM và chạm đường cron ⇒ vẫn ở sàn actuation. |
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
 * ⚠ `totpCode` optional ở input hai lệnh phá huỷ — đúng tiền lệ `programmingRouter.deployBuild`:
 * `requireFreshTotp` đọc nó từ **raw input** và chỉ đòi khi cờ `ACTUATION_STEPUP_2FA` bật.
 * ⚠ Mọi lượt TỪ CHỐI NGHIỆP VỤ (hộ không thu hồi được, hàng chưa chứng minh là ma, hộ không chủ trì
 * ở đây) trả về **DỮ LIỆU có `reason`**, KHÔNG ném: Agent cần đọc lý do để chọn bước tiếp theo, và
 * một ngoại lệ chỉ còn lại một câu chữ. Ném là dành cho **thiếu quyền** — việc của middleware.
 */
const totp = { totpCode: z.string().max(16).optional() };

/** Sàn của một lệnh **PHÁ HUỶ**: danh tính (role-floor + 2FA + step-up) **VÀ** thẩm quyền. */
const vramDestructiveProcedure = deployProcedure.use(requirePermission("machine_control", "canDelete"));

/** Sàn của một lệnh **KHÔNG phá huỷ** nhưng vẫn là actuation. */
const vramActuationProcedure = actuationProcedure.use(requirePermission("machine_control", "canCreate"));

export const vramRouter = router({
  /**
   * Ảnh chụp trạng thái VRAM. **Mỗi trường nói đúng độ chắc chắn của nó** — đọc docstring của
   * `VramAgentState` trước khi hành động theo một con số ở đây. Ba chỗ dễ đọc nhầm nhất:
   *  • `attributable.known === false` là **CHẶN TRÊN** của dư địa, KHÔNG phải trạng thái an toàn;
   *  • `ledger.foreign.known === false` nghĩa **ĐANG MÙ về tiến trình anh em**, KHÔNG phải "không ai giữ";
   *  • `unledgered.estimateBytes` là **ƯỚC LƯỢNG**, và `unknownCount > 0` làm nó **mất tin cậy**.
   */
  state: protectedProcedure.query(async () => buildVramAgentState()),

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
    .input(z.object({ owner: z.string().trim().min(1).max(160), ...totp }))
    .mutation(async ({ input }) => vramPreemptCommand(input.owner)),

  /**
   * ★★★ **DỌN MỘT HÀNG MA TRONG SỔ CHUNG.** Chỉ chạy khi `lapKeHoachNhanNuoi()` — **cùng người lập
   * kế hoạch mà nhịp đối chiếu dùng** — chứng minh được chủ hàng đã CHẾT (vắng khỏi bảng tiến trình,
   * hoặc PID đã được cấp lại). Bảng tiến trình không đọc được ⇒ **không có bằng chứng** ⇒ từ chối.
   * ⚠ `leaseKey` đọc ở `state.ledger.foreign.holders[].leaseKey`.
   */
  releaseStale: vramDestructiveProcedure
    .input(z.object({ leaseKey: z.string().trim().min(1).max(200), ...totp }))
    .mutation(async ({ input }) => vramReleaseStaleCommand(input.leaseKey)),

  /**
   * ★★★ **ĐẨY MỘT HỘ `background` ĐANG HOÃN THỬ LẠI NGAY.**
   *
   * ⚠⚠ Chỉ `cron:kb-sync` có cơ chế đánh thức từ ngoài, và **chỉ ở tiến trình chủ trì cron**. Với
   * mọi hộ khác lệnh trả `refused` + `reason` + `hostedHere: null` — **nói thẳng rằng nó không
   * làm gì**, thay vì im lặng thành công. Xem `vramCommands.ts`.
   */
  retryDeferred: vramActuationProcedure
    .input(z.object({ owner: z.string().trim().min(1).max(160) }))
    .mutation(({ input }) => vramRetryDeferredCommand(input.owner)),
});
