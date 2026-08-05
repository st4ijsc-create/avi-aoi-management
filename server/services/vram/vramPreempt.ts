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
import { preemptPlan, preemptStepForOwner, snapshot, type VramPreemptStep } from "./vramBroker";
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
 * ⚠⚠ C-2 (review TOÀN NHÁNH) — HỢP ĐỒNG NÀY TỪNG BỊ PHÁ BỞI CHÍNH FILE NÀY: `"vision-sidecar"`
 * `return true` vô điều kiện trong khi `stopSidecar()` mới chỉ gửi `SIGTERM`. Nay cả hai người thi
 * hành đều **chuyển nguyên** câu trả lời của lượt dọn thật lên, và có ca chạy ngữ nghĩa THẬT
 * (`wiring.outofprocess.test.ts` C-2a/C-2b — không giả `stopSidecar`).
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
    /**
     * ★★★ C-2 (review TOÀN NHÁNH) — `return true` VÔ ĐIỀU KIỆN Ở ĐÂY LÀ MỘT LỜI NÓI DỐI ĐÚNG
     * CHIỀU OOM, và nó phá hợp đồng ghi cách đây 25 dòng.
     *
     * `stopSidecar()` bản trước gửi `SIGTERM`, hẹn `SIGKILL` sau 5.000 ms rồi **return ngay**;
     * giấy phép chỉ rời sổ ở `proc.on("exit")`. Chuỗi thật: `reclaimed = ["sidecar:vision"]` với
     * `freedBytes = 0` ⇒ `vramWiring` xin lại NGAY ⇒ sổ vẫn còn 7,8 GB ⇒ **TỪ CHỐI LẦN HAI**. Tức
     * giết hộ tiêu thụ lớn nhất hệ (khởi động lại tới 120 s) mà lượt xin **vẫn hỏng**.
     *
     * Nay `stopSidecar()` trả `boolean` = *"đã quan sát được tiến trình CHẾT"* (nhánh `exit`/`error`
     * — cũng chính là nơi `release()` chạy) và ta chuyển nguyên câu trả lời đó lên. Hết hạn chờ ⇒
     * `false` ⇒ hộ này vào `failed`, `reclaimed` rỗng, **không xin lại**: một lời từ chối trung
     * thực thay vì một lượt xin lại chắc chắn hỏng.
     * ⚠ Ca test chạy NGỮ NGHĨA THẬT (không giả `stopSidecar`): `wiring.outofprocess.test.ts`.
     */
    const { stopSidecar } = await import("../llamaVisionSidecar");
    return await stopSidecar();
  },
  /**
   * ★★★ Pha 3 Task 5 (A) — **HỘ NGOÀI TIẾN TRÌNH.** Đây là dòng làm câu mở đầu của file này thôi
   * đúng một nửa: từ đây `preempt()` **với tới được** một tiến trình mà ta KHÔNG sinh ra.
   *
   * Dân số: đúng những giấy phép do `vramReconciler.chayLuotNhanNuoi()` **dựng lại** cho một
   * sidecar mồ côi (Task 4, §6). Chúng mang dấu `#nhan-nuoi-pid=N` trong `owner`, và
   * `pidTuOwnerNhanNuoi()` là **bản dịch DUY NHẤT** của dấu đó — nên không có đường nào để một hộ
   * khác (sidecar CỦA TA, hàng của anh em còn sống, model GGUF) lọt vào đây.
   *
   * ⚠⚠ VÌ SAO KHÔNG TỰ GIẾT Ở ĐÂY MÀ GỌI SANG `vramReconciler`: `leaseNhanNuoi` (bảng
   * pid → giấy phép) có **MỘT người ghi**, và người đó là reconciler. Một lượt `process.kill()` +
   * `release()` viết tay ở file này là **người ghi thứ hai** cho cùng một bất biến — đúng thứ
   * ràng buộc 12 cấm, và hậu quả cụ thể là một nhịp đối chiếu chen vào giữa sẽ thấy một mục trỏ
   * tới giấy phép đã nhả.
   * ⚠ `thuHoiHoNhanNuoi()` chỉ trả `true` khi **`nvidia-smi` xác nhận PID không còn giữ GPU** —
   * hợp đồng ghi ở đầu bảng này (*"`true` chỉ khi đã THẬT SỰ giết"*) được giữ bằng **bằng chứng
   * THIẾT BỊ**, không bằng lời khai của lệnh `kill`.
   */
  "orphan-pid": async (step) => {
    const { pidTuOwnerNhanNuoi } = await import("./vramAdoption");
    const pid = pidTuOwnerNhanNuoi(step.owner);
    // `owner` không mang dấu nhận nuôi ⇒ giấy phép này KHÔNG phải hộ mồ côi ⇒ không ai thu hồi
    // được nó ở đây. Trả `false` (một lời khai thất bại trung thực), TUYỆT ĐỐI không đoán một PID.
    if (pid === null) return false;
    const { thuHoiHoNhanNuoi } = await import("./vramReconciler");
    return await thuHoiHoNhanNuoi(pid);
  },
};

function soHuuHan(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * ⚠ Cột chuỗi + `detail` `jsonb` — một câu dài vô hạn là một lô sự kiện mất. Cắt tại NGUỒN.
 *
 * ★★★ Pha 4 Task 4 (bàn giao M-5 nửa sau, review Task 3) — **"ĐÃ CẮT HAY CHƯA" ĐƯỢC ĐO ĐÚNG Ở ĐÂY,
 * MỘT LẦN.** Câu ghép của Task 3 phải nói ra rằng câu đã bị cắt, nhưng nó **KHÔNG được** tự đoán
 * bằng `detail.length === 400` ở client: đó là **bản sao thứ hai của MỘT vị từ** (một bất biến, hai
 * người viết, hai câu trả lời trôi khỏi nhau) — đúng lớp lỗi đã đẻ ba Critical liên tiếp trong chuỗi
 * pha này. Và bản sao ấy còn **SAI**: một câu **đúng 400 ký tự** không hề bị cắt, nhưng phép so ở
 * client sẽ khai là đã cắt.
 */
const CAU_TOI_DA = 400;

function catCau(err: unknown): { readonly cau: string; readonly daCat: boolean } {
  const tho = String((err as { message?: unknown } | null)?.message ?? err ?? "");
  return { cau: tho.slice(0, CAU_TOI_DA), daCat: tho.length > CAU_TOI_DA };
}

/** Vì sao MỘT bước thi hành không thành. `null` ⇔ nó thành. */
export type VramReclaimFailure = "reclaimer-returned-false" | "reclaimer-threw";

/**
 * ★★★ Pha 4 Task 2 — **MỘT BƯỚC THI HÀNH. MỘT BẢN CÀI ĐẶT, HAI NGƯỜI GỌI.**
 *
 * Trước bản này khối `try { NGUOI_THI_HANH[…] } catch { … }` nằm **trong** vòng lặp của `preempt()`.
 * Lệnh `preempt(owner)` của Agent cần **đúng khối đó** (cùng bảng người thi hành, cùng cách nuốt
 * ngoại lệ, cùng dòng nhật ký) — chép nó ra là dựng **đường phá huỷ thứ hai**, thứ ràng buộc 3 cấm
 * và là lớp lỗi đã đẻ ba Critical trong chuỗi pha này.
 *
 * ⚠ KHÔNG BAO GIỜ NÉM: một người thi hành hỏng phải thành **một lời từ chối trung thực** ở tầng
 * trên, không phải một ngoại lệ lạ mặt trên đường nạp model (hoặc trên một mutation tRPC).
 */
async function thiHanhMotBuoc(
  step: VramPreemptStep,
  priority: VramPriority,
): Promise<{
  readonly xong: boolean;
  readonly failure: VramReclaimFailure | null;
  readonly message: string | null;
  /** ★ M-5 — đo Ở ĐÚNG CHỖ CẮT. `false` khi `message === null` (không có câu thì không có gì bị cắt). */
  readonly messageTruncated: boolean;
}> {
  try {
    const xong = await NGUOI_THI_HANH[step.reclaimer](step);
    return xong
      ? { xong: true, failure: null, message: null, messageTruncated: false }
      : { xong: false, failure: "reclaimer-returned-false", message: null, messageTruncated: false };
  } catch (err) {
    // KHÔNG ném, nhưng cũng KHÔNG im: một người thi hành hỏng là lý do câu từ chối kế tiếp sẽ nói
    // "nhường được N MiB" mà mãi không nhường được.
    const { cau: message, daCat } = catCau(err);
    logVramEvent({
      event: "preempt",
      owner: step.owner,
      leaseKind: step.kind,
      priority,
      // ★ M-5 — nhật ký BỀN cũng mang cờ: ai đọc `vram_events` về sau biết câu này đã bị cắt.
      detail: { reason: "reclaimer-threw", reclaimer: step.reclaimer, message, messageTruncated: daCat },
    });
    return { xong: false, failure: "reclaimer-threw", message, messageTruncated: daCat };
  }
}

/**
 * ★★★ Pha 4 Task 2 — **THU HỒI MỘT HỘ ĐÍCH DANH, THEO LỆNH NGƯỜI VẬN HÀNH / AI AGENT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ HÀM NÀY GIẾT ĐƯỢC TIẾN TRÌNH — VÀ NÓ KHÔNG TỰ GIẾT MỘT DÒNG NÀO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba mắt xích, cả ba đã có sẵn và **không cái nào được viết lại ở đây**:
 *   1. `preemptStepForOwner()` — quyền (`quyenNhuong`) + khả năng (`nguoiThiHanhThuHoi`);
 *   2. `NGUOI_THI_HANH` — bảng người thi hành DUY NHẤT (`thiHanhMotBuoc`);
 *   3. `snapshot().totalReservedBytes` TRƯỚC/SAU — **bằng chứng byte đã rời SỔ**.
 *
 * ⚠⚠ `xong === true` **KHÔNG ĐỦ ĐỂ KHAI THÀNH CÔNG.** Pha 2B đã trả giá đúng ở đây: `stopSidecar()`
 * khai `true` vô điều kiện trong khi tiến trình mới nhận `SIGTERM` ⇒ `reclaimed` với
 * `freedBytes = 0` ⇒ lượt xin lại **hỏng lần hai**, sau khi đã giết hộ 7,8 GB.
 * ⇒ Vị từ thành công là **`step.leaseId` đã RỜI SỔ chưa** (xem khối C-1 ở thân hàm), KHÔNG phải
 * *"tổng sổ có co lại không"* — tổng là đại lượng dùng chung, và đo nó bắc qua một `await` là mời
 * người khác vào kết quả của mình.
 */
export type VramPreemptOwnerFailure = VramReclaimFailure | "no-bytes-freed";

export interface VramPreemptOwnerResult {
  readonly owner: string;
  /** `null` ⇔ chưa tới được lượt thi hành (bị từ chối ở cổng quyền/khả năng). */
  readonly reclaimer: VramReclaimerId | null;
  readonly plan: ReturnType<typeof preemptStepForOwner>;
  /**
   * Byte của **CHÍNH HỘ NÀY** đã rời sổ — `0` khi giấy phép còn nguyên. **Kẹp theo `step.bytes`**,
   * nên nó KHÔNG BAO GIỜ mang byte của một hộ khác vừa nhả trong cùng cửa sổ (C-1).
   */
  readonly freedBytes: number;
  /** ★ C-1 — bằng chứng, phơi ra: giấy phép của hộ này có còn trong `snapshot().leases` không. */
  readonly leaseLeftLedger: boolean;
  readonly reclaimed: readonly string[];
  readonly failed: readonly string[];
  /** `null` ⇔ thu hồi THÀNH CÔNG (và byte đã nhả). */
  readonly failure: VramPreemptOwnerFailure | null;
  readonly message: string | null;
  /**
   * ★★★ M-5 (bàn giao Task 3 → Task 4) — **NGUỒN DUY NHẤT của sự thật "câu trên đã bị cắt hay
   * chưa"**, đo tại `catCau()`. Người ghép câu (`client/src/lib/errorCodes.ts`) chỉ được ĐỌC ô này;
   * đo lại độ dài ở đó là dựng bản sao thứ hai của một vị từ.
   */
  readonly messageTruncated: boolean;
  readonly ledgerBytesBefore: number;
  readonly ledgerBytesAfter: number;
}

export async function preemptOwner(owner: string): Promise<VramPreemptOwnerResult> {
  const plan = preemptStepForOwner(owner);
  const truoc = soHuuHan(snapshot().totalReservedBytes);
  if (plan.kind === "refused") {
    return {
      owner,
      reclaimer: null,
      plan,
      freedBytes: 0,
      // Chưa ai bị đụng ⇒ giấy phép (nếu có) vẫn nguyên trong sổ.
      leaseLeftLedger: false,
      reclaimed: [],
      failed: [],
      failure: null,
      message: null,
      messageTruncated: false,
      ledgerBytesBefore: truoc,
      ledgerBytesAfter: truoc,
    };
  }

  const step = plan.step;
  /**
   * ⚠ Mức ghi vào nhật ký là mức của **HỘ BỊ THU HỒI**, không phải một mức người xin bịa ra: lệnh
   * này không đến từ một lượt xin nào (xem `preemptStepForOwner`, khối "MỨC NGƯỜI XIN").
   */
  const kq = await thiHanhMotBuoc(step, "background");
  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ C-1 (review Task 2) — **BẰNG CHỨNG CỦA CHÍNH HỘ ĐÓ, KHÔNG PHẢI HIỆU SỐ TỔNG.**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Bản trước quyết `reclaimed` bằng *"TỔNG SỔ có co lại không"*, và đo tổng đó **bắc qua `await`
   * ngay trên**. Tổng là một đại lượng **DÙNG CHUNG**: bất kỳ hộ nào khác nhả trong cửa sổ ấy
   * (idleTimer của `llamaVisionSidecar`, TTL của `aiGgufEngine`, hoặc **hai lệnh `preempt` Agent
   * bắn song song**) đều làm lệnh khai **thành công cho một hộ CÒN NGUYÊN**, và gán byte của người
   * khác cho mình. Reviewer đã chạy được đúng chuỗi đó: `outcome: "reclaimed"` +
   * `freedBytes = 17.000 MiB` trong khi giấy phép nạn nhân **vẫn nằm trong `snapshot().leases`**.
   *
   * ⇒ Vị từ đúng nằm sẵn trong cấu trúc — **`step.leaseId`**. Đây đúng bài học Pha 3
   * (*"một nhịp không được vứt đi bằng chứng của chính nó"*), và đúng bài học Pha 4 Task 2 đã áp ở
   * `donHangMa()`: hỏi **hộ này**, đừng hỏi cái tổng.
   *
   * ⚠ MỘT lượt `snapshot()` cho cả hai vế: đọc `totalReservedBytes` rồi đọc `leases` ở một lời gọi
   * thứ hai là lấy hai vế ở HAI thời điểm — đúng lớp lỗi đang vá, chỉ nhỏ hơn.
   * ⚠ `Math.min(step.bytes, truoc − sau)` — chiều **CHẶT**: nếu tổng co nhiều hơn vì hộ khác cũng
   * nhả, ta **không** nhận phần đó; nếu một lượt cấp phát chen vào làm tổng co ít hơn, ta báo con số
   * NHỎ hơn. Không bao giờ hứa byte của người khác.
   */
  const sauAnh = snapshot();
  const sau = soHuuHan(sauAnh.totalReservedBytes);
  const roiSo = !sauAnh.leases.some((l) => l.id === step.leaseId);
  const freedBytes = roiSo ? Math.max(0, Math.min(soHuuHan(step.bytes), truoc - sau)) : 0;
  const failure: VramPreemptOwnerFailure | null =
    kq.failure !== null ? kq.failure : roiSo ? null : "no-bytes-freed";

  logVramEvent({
    event: "preempt",
    owner: step.owner,
    leaseKind: step.kind,
    priority: "background",
    detail: {
      reason: "operator-command",
      reclaimer: step.reclaimer,
      reclaimerReportedDone: kq.xong,
      /** ★ C-1 — bằng chứng THẬT: giấy phép của **hộ này** có còn trong sổ không. */
      leaseLeftLedger: roiSo,
      freedBytes,
      failure,
      ...(kq.message === null ? {} : { message: kq.message }),
    },
  });

  return {
    owner,
    reclaimer: step.reclaimer,
    plan,
    freedBytes,
    leaseLeftLedger: roiSo,
    // ⚠⚠ Ô này chỉ được mang tên hộ khi GIẤY PHÉP CỦA CHÍNH HỘ ĐÓ đã rời sổ. Khai `reclaimed` cho
    // một khối byte còn treo là nói dối đúng chiều OOM — và người đọc kế tiếp là một AI Agent sắp
    // quyết định có nạp model hay không.
    reclaimed: failure === null ? [step.owner] : [],
    failed: failure === null ? [] : [step.owner],
    failure,
    message: kq.message,
    messageTruncated: kq.messageTruncated,
    ledgerBytesBefore: truoc,
    ledgerBytesAfter: sau,
  };
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
    const kq = await thiHanhMotBuoc(step, priority);
    if (kq.xong) reclaimed.push(step.owner);
    else failed.push(step.owner);
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
