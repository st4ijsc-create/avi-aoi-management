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
import { router, protectedProcedure } from "../_core/trpc";
import { buildVramAgentState } from "../services/vram/vramReadModel";

export const vramRouter = router({
  /**
   * Ảnh chụp trạng thái VRAM. **Mỗi trường nói đúng độ chắc chắn của nó** — đọc docstring của
   * `VramAgentState` trước khi hành động theo một con số ở đây. Ba chỗ dễ đọc nhầm nhất:
   *  • `attributable.known === false` là **CHẶN TRÊN** của dư địa, KHÔNG phải trạng thái an toàn;
   *  • `ledger.foreign.known === false` nghĩa **ĐANG MÙ về tiến trình anh em**, KHÔNG phải "không ai giữ";
   *  • `unledgered.estimateBytes` là **ƯỚC LƯỢNG**, và `unknownCount > 0` làm nó **mất tin cậy**.
   */
  state: protectedProcedure.query(async () => buildVramAgentState()),
});
