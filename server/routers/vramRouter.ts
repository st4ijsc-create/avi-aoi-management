/**
 * ★★★ Pha 4 Task 1 — **ROUTER ĐỌC TRẠNG THÁI VRAM.** Phơi ra, **KHÔNG tự quyết**.
 *
 * Bảy pha trước dựng cơ chế; pha này làm nó **dùng được** cho AI Agent. Router **mỏng có chủ ý**:
 * toàn bộ phép ghép nằm ở `services/vram/vramReadModel.ts`, và ảnh chụp ở đó đọc **đúng những hàm
 * mà đường quyết định đọc** — không có đường thứ hai (ràng buộc 2).
 *
 * ⚠ **Pha 4 KHÔNG đổi hành vi cấp phát.** Không một thủ tục nào ở đây cấp/thu hồi/hoãn gì; lệnh
 * là việc của Task 2 và chúng đi qua `broker.preempt()` / cơ chế hoãn ĐÃ CÓ.
 * ⚠ `reserve()` vẫn **ĐỒNG BỘ** — mặt đọc này không thêm một `await` nào vào đường quyết định.
 *
 * PHÂN QUYỀN: `protectedProcedure` (chỉ ĐỌC), cùng mức với các mặt trạng thái AI đã có
 * (`aiGgufRouter.status` / `listModels`, vốn cũng trả đường dẫn model). Lệnh **phá huỷ** của Task 2
 * đi ở mức actuation (role-floor + 2FA), không phải ở đây.
 */
import { z } from "zod";
import { router, protectedProcedure, actuationProcedure, deployProcedure } from "../_core/trpc";
import { buildVramAgentState } from "../services/vram/vramReadModel";
import {
  vramPreemptCommand,
  vramReleaseStaleCommand,
  vramRetryDeferredCommand,
} from "../services/vram/vramCommands";

/**
 * ★★★ Pha 4 Task 2 — **PHÂN QUYỀN CHO LỆNH.** Đọc khuôn có sẵn, KHÔNG phát minh khuôn mới.
 *
 * | thủ tục | sàn | vì sao |
 * |---|---|---|
 * | `state` | `protectedProcedure` | chỉ ĐỌC (Task 1). |
 * | `preempt` · `releaseStale` | `deployProcedure` | **PHÁ HUỶ**: `preempt` giết được một tiến trình; `releaseStale` xoá một hàng khỏi sổ mà **mọi tiến trình anh em** đọc để tính dư địa. `deployProcedure` = `actuationProcedure` + step-up 2FA = **mức cao nhất repo dùng cho actuation** (`_core/trpc.ts`). |
 * | `retryDeferred` | `actuationProcedure` | KHÔNG phá huỷ gì — nó chỉ **dời hạn** một lượt thử lại đã được lên lịch. Nhưng nó tiêu VRAM và chạm đường cron ⇒ vẫn ở sàn actuation (admin/supervisor/engineer + 2FA), không phải `protectedProcedure`. |
 *
 * ⚠ `totpCode` optional ở input hai lệnh phá huỷ — đúng tiền lệ `programmingRouter.deployBuild`:
 * `requireFreshTotp` đọc nó từ **raw input** và chỉ đòi khi cờ `ACTUATION_STEPUP_2FA` bật.
 * ⚠ Mọi lượt TỪ CHỐI NGHIỆP VỤ (hộ không thu hồi được, hàng chưa chứng minh là ma, hộ không chủ trì
 * ở đây) trả về **DỮ LIỆU có `reason`**, KHÔNG ném: Agent cần đọc lý do để chọn bước tiếp theo, và
 * một ngoại lệ chỉ còn lại một câu chữ. Ném là dành cho **thiếu quyền** — việc của middleware.
 */
const totp = { totpCode: z.string().max(16).optional() };

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
   * ⚠⚠ ĐỌC `outcome` TRƯỚC `freedBytes`: `"reclaimed"` chỉ phát ra khi **byte đã rời SỔ**. Người
   * thi hành khai xong mà sổ không đổi ⇒ `"failed"` + `reason: "no-bytes-freed"` (Pha 2B C-2: giết
   * hộ 7,8 GB xong lượt xin **vẫn** hỏng). `"refused"` ⇒ **chưa ai bị đụng**.
   */
  preempt: deployProcedure
    .input(z.object({ owner: z.string().trim().min(1).max(160), ...totp }))
    .mutation(async ({ input }) => vramPreemptCommand(input.owner)),

  /**
   * ★★★ **DỌN MỘT HÀNG MA TRONG SỔ CHUNG.** Chỉ chạy khi `lapKeHoachNhanNuoi()` — **cùng người lập
   * kế hoạch mà nhịp đối chiếu dùng** — chứng minh được chủ hàng đã CHẾT (vắng khỏi bảng tiến trình,
   * hoặc PID đã được cấp lại). Bảng tiến trình không đọc được ⇒ **không có bằng chứng** ⇒ từ chối.
   * ⚠ `leaseKey` đọc ở `state.ledger.foreign.holders[].leaseKey`.
   */
  releaseStale: deployProcedure
    .input(z.object({ leaseKey: z.string().trim().min(1).max(200), ...totp }))
    .mutation(async ({ input }) => vramReleaseStaleCommand(input.leaseKey)),

  /**
   * ★★★ **ĐẨY MỘT HỘ `background` ĐANG HOÃN THỬ LẠI NGAY.**
   *
   * ⚠⚠ Chỉ `cron:kb-sync` có cơ chế đánh thức từ ngoài, và **chỉ ở tiến trình chủ trì cron**. Với
   * mọi hộ khác lệnh trả `refused` + `reason` + `hostedHere: null` — **nói thẳng rằng nó không
   * làm gì**, thay vì im lặng thành công. Xem `vramCommands.ts`.
   */
  retryDeferred: actuationProcedure
    .input(z.object({ owner: z.string().trim().min(1).max(160) }))
    .mutation(({ input }) => vramRetryDeferredCommand(input.owner)),
});
