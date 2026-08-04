/**
 * ★★★ Pha 2B Task 7 (§8) — **`preempt()`: NGƯỜI THI HÀNH THU HỒI.**
 *
 * Đây là chỗ `aiGgufEngine.evictLRU()` được **hấp thụ** vào. Ba khác biệt so với `evictLRU()`, và
 * cả ba đều là lý do tồn tại của task này:
 *
 * | | `evictLRU()` (đã XOÁ) | `preempt()` |
 * |---|---|---|
 * | dân số | chỉ `loadedModels` của MỘT file | **mọi hộ trong SỔ có người thi hành đã khai** |
 * | thứ tự | LRU thuần | **§5.2**: `production` không bao giờ · mức THẤP trước · nhàn rỗi trước · cũ trước |
 * | dừng khi | hết model nhàn rỗi | **đủ byte VÀ đủ khe** (`preemptPlan()`), không dọn thừa |
 *
 * ⚠⚠ **HÀM NÀY KHÔNG CỨU ĐƯỢC `kb:sync`, VÀ ĐIỀU ĐÓ ĐƯỢC GHI VÀO MÃ CÓ CHỦ Ý** (sự thật cứng của
 * Task 6, §7.3): `cron:kb-sync` chạy mức `background` = **THẤP NHẤT** (`PRIORITY_RANK`), còn
 * `coTheNhuong()` chỉ cho nhường **mức THẤP HƠN mức đang xin** hoặc **nhàn rỗi**. Không có mức nào
 * thấp hơn `background`, và mọi hộ khác đang bận thì không nhàn rỗi ⇒ kế hoạch **RỖNG**. Đường DUY
 * NHẤT để một lượt `kb:sync` được cấp là **một hộ khác TỰ NHẢ**. Đừng đảo ngược câu này.
 *
 * ⚠ KHÔNG BAO GIỜ NÉM. Một lượt thu hồi hỏng phải trở thành **một lời từ chối trung thực** ở tầng
 * trên, không phải một ngoại lệ lạ mặt trên đường nạp model.
 */
import { preemptPlan, snapshot, type VramPreemptStep } from "./vramBroker";
import { logVramEvent } from "./vramEventLog";
import type { VramPriority, VramReclaimerId } from "./types";

/** Kết quả thi hành. ⚠ Mọi số ở đây HỮU HẠN (xem `soHuuHan`). */
export interface VramPreemptResult {
  /** Byte mà SỔ đã thật sự nhả (đo bằng chênh lệch tổng sổ, KHÔNG cộng theo lời khai của kế hoạch). */
  readonly freedBytes: number;
  /** Số hộ đã thu hồi xong. */
  readonly reclaimed: readonly string[];
  /** Hộ mà người thi hành ném / không nhả được sổ. */
  readonly failed: readonly string[];
  /** Kế hoạch rỗng ⇔ không hộ nào vừa CÓ QUYỀN nhường vừa CÓ NGƯỜI dọn. */
  readonly planned: number;
}

/**
 * ★★★ BẢNG NGƯỜI THI HÀNH — `Record<VramReclaimerId, …>`.
 *
 * ⚠ Kiểu này là hàng rào: thêm một giá trị vào `VramReclaimerId` (types.ts) mà quên cài đặt ở đây
 * là **lỗi `tsc`**, không phải một lời hứa suông chạy được tới sản xuất. Đây là lần thứ ba trong
 * pha này lời giải đúng là *"làm cho sai lầm không biểu diễn được"*.
 *
 * ⚠ `await import()` chứ không phải import tĩnh: `aiGgufEngine` và `llamaVisionSidecar` đều nhập
 * (gián tiếp) `vramWiring` → `vramBroker`; chiều ngược lại ở mức module là một **vòng nhập**.
 *
 * ⚠ Mỗi người thi hành trả `true` chỉ khi nó đã **thật sự dispose/giết**, KHÔNG phải khi nó "đã gọi
 * lệnh". Lượt nhả SỔ vẫn do chính điểm gọi cũ làm (`unloadGgufModel` trả ticket, `stopSidecar` để
 * `proc.on("exit")` trả ticket) — `preempt()` **không tự tay `release()` giấy phép của người khác**:
 * nhả sổ khi thiết bị chưa nhả là nói dối đúng chiều OOM (`vramBroker.coTheNhuong`).
 */
const NGUOI_THI_HANH: Record<VramReclaimerId, (step: VramPreemptStep) => Promise<boolean>> = {
  /**
   * `gguf:<modelId>` → `unloadGgufModel(modelId)` — dispose THẬT (context + model), rồi trả giấy
   * phép. Đúng việc mà `evictLRU()` làm, chỉ khác chỗ chọn ai.
   */
  "gguf-idle-model": async (step) => {
    const modelId = step.owner.startsWith("gguf:") ? step.owner.slice("gguf:".length) : null;
    if (!modelId) return false;
    const { unloadGgufModel } = await import("../aiGgufEngine");
    return await unloadGgufModel(modelId);
  },
  /**
   * ★ MỞ RỘNG CỦA TASK 7 — hộ tiêu thụ **LỚN NHẤT hệ** (7,8 GB đo được ở Đợt 0), và nó CÓ một
   * đường thu hồi ĐÃ CHỨNG MINH: chính module đó tự gọi `stopSidecar()` khi hết hạn nhàn rỗi, và
   * giấy phép của nó khai `releaseProof: "process-exit"` — **lớp bằng chứng nhả mạnh nhất trong
   * repo** (OS thu hồi VRAM khi tiến trình chết), mạnh hơn hẳn `"unverified"` của ONNX.
   *
   * ⚠ Chỉ tới được đây khi `refCount === 0` (vị từ `nguoiThiHanhThuHoi`), tức KHÔNG có request thị
   * giác nào đang bay. Đây là toàn bộ khác biệt giữa "thu hồi" và "giết ngang một lượt suy luận".
   */
  "vision-sidecar": async () => {
    const { stopSidecar } = await import("../llamaVisionSidecar");
    await stopSidecar();
    return true;
  },
};

function soHuuHan(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Thi hành kế hoạch thu hồi cho MỘT lượt xin đang bị từ chối.
 *
 * @param priority mức của lượt ĐANG XIN (quyết định ai có quyền nhường — §5.2).
 * @param deficitBytes thiếu bao nhiêu BYTE.
 * @param slotsNeeded thiếu bao nhiêu KHE `gguf-model` (Đ4 — thước RIÊNG, không cộng vào byte).
 */
export async function preempt(
  priority: VramPriority,
  deficitBytes: number,
  slotsNeeded = 0,
): Promise<VramPreemptResult> {
  const plan = preemptPlan(priority, deficitBytes, slotsNeeded);
  if (plan.length === 0) {
    return { freedBytes: 0, reclaimed: [], failed: [], planned: 0 };
  }

  const truoc = snapshot().totalReservedBytes;
  const reclaimed: string[] = [];
  const failed: string[] = [];

  for (const step of plan) {
    try {
      const xong = await NGUOI_THI_HANH[step.reclaimer](step);
      if (xong) reclaimed.push(step.owner);
      else failed.push(step.owner);
    } catch (err) {
      failed.push(step.owner);
      // KHÔNG ném: lượt xin phải kết thúc bằng một lời TỪ CHỐI TRUNG THỰC, không phải một ngoại lệ
      // lạ mặt. Nhưng cũng KHÔNG im: một người thi hành hỏng là lý do câu từ chối kế tiếp sẽ nói
      // "nhường được N MiB" mà mãi không nhường được.
      logVramEvent({
        event: "preempt",
        owner: step.owner,
        leaseKind: step.kind,
        priority,
        detail: {
          reason: "reclaimer-threw",
          reclaimer: step.reclaimer,
          message: String((err as { message?: unknown })?.message ?? err),
        },
      });
    }
  }

  const sau = snapshot().totalReservedBytes;
  /**
   * ⚠ ĐO BẰNG SỔ, KHÔNG CỘNG THEO KẾ HOẠCH. Kế hoạch nói *"hộ này đang giữ N byte"*; chỉ cuốn sổ
   * mới nói *"N byte đó đã ra khỏi sổ chưa"*. Cộng theo kế hoạch là tự khai đã giành lại chỗ trong
   * khi giấy phép có thể còn treo — đúng lớp lỗi "sổ khai trống, card vẫn giữ 17 GB".
   * ⚠ `max(0, …)`: sổ có thể PHÌNH giữa chừng (một lượt cấp phát khác chen vào). Một số ÂM ở đây
   * đi thẳng vào ống dẫn sự kiện và vào phép so dư địa — thà khai 0 còn hơn khai một khoản âm.
   */
  const freedBytes = Math.max(0, soHuuHan(truoc) - soHuuHan(sau));

  logVramEvent({
    event: "preempt",
    owner: plan[0]!.owner,
    leaseKind: plan[0]!.kind,
    priority,
    detail: {
      planned: plan.length,
      reclaimed: [...reclaimed],
      failed: [...failed],
      freedBytes,
      deficitBytes: soHuuHan(deficitBytes),
      slotsNeeded,
      reclaimers: plan.map((s) => s.reclaimer),
    },
  });

  return { freedBytes, reclaimed, failed, planned: plan.length };
}
