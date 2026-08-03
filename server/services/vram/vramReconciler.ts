import { snapshot, leaseBytes } from "./vramBroker";
import { readDeviceVram } from "./vramProbe";
import { logVramEvent } from "./vramEventLog";

const DRIFT_THRESHOLD_BYTES = Number(process.env.VRAM_DRIFT_THRESHOLD_MB ?? 512) * 1024 * 1024;
const INTERVAL_MS = Number(process.env.VRAM_RECONCILE_INTERVAL_MS ?? 60_000);
/**
 * Pha 1.5 Task 1, review vòng 1 (EXP-1) — BỘ NGẮT MẠCH cho thước dao động.
 *
 * ⚠ VÌ SAO BẮT BUỘC: cơ chế "đổi thước thì huỷ nền và chụp lại" đúng cho MỘT lần đổi thước, nhưng
 * nếu thước DAO ĐỘNG (vd. handle native chập chờn, hoặc hai tiến trình cạnh tranh gắn handle),
 * MỌI nhịp đều rơi vào nhánh resample — không nhịp nào đối chiếu được. Một khoản cấp phát chui
 * tồn tại xuyên suốt sẽ KHÔNG BAO GIỜ bị phát hiện: chuông CÂM VĨNH VIỄN, và tệ hơn báo động giả
 * — không ai biết nó đang câm. Quá `SOURCE_UNSTABLE_THRESHOLD` lần resample LIÊN TIẾP thì NGỪNG
 * resample và báo động về chính sự BẤT ỔN của thước (nội dung khác hẳn "cấp phát chui" — người
 * trực phải đi sửa đầu dò/handle, không phải đi tìm hộ tiêu thụ chui).
 */
const SOURCE_UNSTABLE_THRESHOLD = Number(process.env.VRAM_SOURCE_UNSTABLE_THRESHOLD ?? 3);

export interface VramReconcileResult {
  driftBytes: number | null;
  alarm: boolean;
  ledgerTotalBytes: number;
  deviceUsedBytes: number | null;
  /** Nền thiết bị đã TRỪ khỏi phép so (null = chưa chụp / máy không GPU). */
  baselineUsedBytes: number | null;
  /**
   * Pha 1.5 Task 1 — true KHI VÀ CHỈ KHI lượt gọi này phát hiện đổi thước đo (native ⇄ smi) và
   * đã HUỶ nền cũ để chụp lại. Lượt đó KHÔNG báo động, dù drift trông thế nào — số vừa bị huỷ
   * không đáng tin để so.
   */
  baselineResampled: boolean;
  /**
   * Pha 1.5 Task 1, review vòng 1 (EXP-1) — true KHI VÀ CHỈ KHI bộ ngắt mạch vừa TRIP: thước đã
   * đổi ≥ `SOURCE_UNSTABLE_THRESHOLD` lần liên tiếp, lượt này KHÔNG resample nữa mà báo động về
   * sự bất ổn của thước. `alarm` cũng = true ở lượt này (đây là báo động THẬT, không phải im
   * lặng) nhưng nguyên nhân KHÁC "cấp phát chui" — đọc `sourceUnstable` để phân biệt.
   */
  sourceUnstable: boolean;
  /**
   * Pha 1.5 Task 3 — tổng ƯỚC LƯỢNG của các giấy phép ĐÃ XIN nhưng CHƯA cấp phát xong
   * (`actualBytes === null`), TRỪ những giấy phép ĐÃ ĐO HỎNG (`measureFailed === true` — xem
   * ghi chú dài ở chỗ tính `pendingBytes` trong `reconcileOnce()` để biết vì sao loại chúng ra
   * là BẮT BUỘC, không phải tuỳ chọn). Đây là phần băng dung sai được nới ở PHÍA ÂM của `alarm`.
   */
  pendingBytes: number;
}

let timer: NodeJS.Timeout | null = null;

/**
 * NỀN THIẾT BỊ — VRAM đã bị chiếm bởi thứ KHÔNG PHẢI tiến trình này, đo MỘT LẦN lúc khởi động.
 *
 * ⚠ VÌ SAO BẮT BUỘC (Task 5 review vòng 1, I-1): đo trên máy sạch, app KHÔNG chạy, GPU đã dùng
 * **1.090 MiB** — desktop compositor và tiến trình khác của máy. Không trừ nền thì với sổ rỗng
 * ta có `drift = +1090 > 512` ⇒ báo động "cấp phát KHÔNG XIN PHÉP" + một dòng ghi DB **mỗi 60
 * giây, mãi mãi, trên MỌI máy, ngay từ giây thứ nhất**. Giá trị DUY NHẤT của Pha 1 là báo động
 * này CÓ NGHĨA; một cái chuông kêu liên tục là cái chuông không ai nghe.
 *
 * ⚠ CÔNG THỨC (review vòng 2, NEW-1) — nền KHÔNG phải là "VRAM lúc chụp":
 *
 *     baseline = deviceUsed_lúc_chụp − ledgerTotal_lúc_chụp
 *
 * VÌ SAO KHÔNG DÙNG THẲNG `deviceUsed`: có ÍT NHẤT HAI đường warm model, và đường sớm hơn
 * KHÔNG nằm dưới quyền `startBackgroundSchedulers()`:
 *   `index.ts:4931` → `registerAiLocalKnowledgeRoutes` → `warmUpOllamaModels`
 *   (`aiLocalKnowledgeService.ts:2391`) → `setTimeout(**2000 ms**)` → `warmModel(GGUF_DEFAULT_MODEL)`
 *   = nạp 30B **~17 GB THẬT**, rồi nạp tiếp embedder.
 * Đồng hồ 2 giây đó lên ~273 dòng boot TRƯỚC `startBackgroundSchedulers()` (`:5204`) và NGẮN
 * HƠN đồng hồ 3 giây của `initDeepModelWarmup()`. Ở giữa còn `initializeLicenseSystem()`,
 * `initializeRuntimeSecurity()` (băm file), `initializeSocket()`, `startStreamProcessor()`,
 * `await import("../api/v1/router")`. Boot chậm hơn 2 giây ⇒ 17 GB bị nuốt vào nền; nuốt MỘT
 * PHẦN thì tệ hơn nữa — nền BẤT ĐỊNH giữa các lần boot. `warmUpOllamaModels` cũng KHÔNG có
 * cổng `GGUF_WARM_DEEP_MODEL_ON_BOOT` (chỉ gác `USE_LEGACY_OLLAMA`, mặc định false ⇒ warm CHẠY).
 *
 * ⚠ ĐỪNG SỬA BẰNG CÁCH ĐUA VỚI ĐỒNG HỒ. Chuyển lời gọi lên sớm hơn chỉ đổi cuộc đua này lấy
 * cuộc đua khác, và đường warm THỨ BA sau này lại làm hỏng. Task 5 đã nối `loadGgufModel` vào
 * `reserve()`, nên MỌI thứ do CHÍNH TA cấp phát đều đã nằm trong SỔ tại thời điểm chụp — trừ
 * phần đó ra là xong, ĐÚNG với mọi thứ tự boot.
 *
 * ⚠⚠ CHỈ TRỪ PHẦN **ĐÃ COMMIT** (review vòng 3) — trừ CẢ SỔ là SAI và từng làm nền bị ĐẦU ĐỘC
 * VĨNH VIỄN. Cửa sổ "đã xin, chưa cấp phát xong" CÓ THẬT: `beginVram()` gọi `reserve()` ở
 * `aiGgufEngine.ts:737` (cộng ƯỚC LƯỢNG vào sổ) TRƯỚC `llama.loadModel()` ở `:747`, còn
 * `commitMeasured()` mãi `:802` — với model 30B ~17 GB khoảng đó dài NHIỀU GIÂY (cùng khuôn ở
 * `:927`/`:938` cho context lười). Lượt chụp rơi vào đó thì:
 *     nền = max(0, 941 − 17.000) = 0   ← kẹp, rồi GHIM VĨNH VIỄN
 *     vài giây sau: 17.941 − 0 = 17.941 ⇒ drift = 941 ⇒ BÁO ĐỘNG mỗi 60 giây, MÃI MÃI.
 * Tức là lỗi I-1 sống lại qua cửa sau, chỉ khác là hỏng theo XÁC SUẤT thời điểm boot.
 *
 * Giấy phép ĐÃ commit thì CHẮC CHẮN đã nằm trong `deviceUsed` — chính `commit()` đo từ thiết
 * bị mà ra. Giấy phép CHƯA commit nghĩa là "đã xin nhưng chưa cấp phát xong" ⇒ nó CHƯA nằm
 * trong `deviceUsed` ⇒ trừ nó đi là trừ một thứ CHƯA TỒN TẠI. Chỉ trừ phần đã commit thì cửa
 * sổ đua biến mất về mặt CẤU TRÚC, không phải nhờ may.
 *
 * ⚠ GIỚI HẠN ĐÃ BIẾT, CHẤP NHẬN Ở PHA 1 — PHẢI ĐỌC TRƯỚC KHI TIN CON SỐ NÀY:
 * nếu server khởi động lại **trong khi một tiến trình con vẫn đang sống** (điển hình: sidecar
 * thị giác 7,8 GB của Đợt 0), thì 7,8 GB đó bị **NUỐT VÀO NỀN** và ta sẽ **KHÔNG BAO GIỜ THẤY
 * NÓ** — đúng cái mà module này sinh ra để bắt. Sidecar chạy tiến trình RIÊNG nên nó KHÔNG có
 * trong sổ, phép trừ trên không cứu được ca này. Đây là ca "giấy phép mồ côi" mà spec §6 giao
 * cho **Pha 3 (nhận nuôi)**: Pha 3 phải liệt kê tiến trình đang giữ VRAM rồi NHẬN NUÔI chúng
 * vào sổ thay vì gộp mù vào nền. Pha 1 chấp nhận đánh đổi này một cách TƯỜNG MINH — thà bỏ sót
 * một ca hiếm còn hơn hỏng cái chuông trong mọi ca thường.
 *
 * Sự kiện `baseline` ghi CẢ `deviceUsedRawBytes` LẪN `ledgerTotalBytes`: đọc nhật ký là dựng
 * lại được phép tính. KHÔNG trừ âm thầm — một phép trừ vô hình chỉ là một giả định vô hình khác.
 */
let baselineUsedBytes: number | null = null;
let baselineCaptured = false;
/**
 * Pha 1.5 Task 1 — MỘT THƯỚC DUY NHẤT. Thước (native ⇄ smi) đã dùng để chụp nền hiện tại.
 *
 * ⚠ VÌ SAO BẮT BUỘC: `startVramReconciler()` chụp nền TRƯỚC khi `getLlama()` gắn handle
 * (`aiGgufEngine.ts:359-360`) ⇒ lượt chụp đầu tiên gần như chắc chắn đo bằng `nvidia-smi`, còn
 * mọi phép so SAU ĐÓ (một khi handle đã gắn) dùng `getVramState` NATIVE. Hai thước lệch
 * 165-178 MiB — đủ MỘT MÌNH đẩy lệch qua ngưỡng 512 MiB và làm chuông kêu MÃI MÃI, dù không ai
 * cấp phát chui cả. Đây là LỖI ĐO (so hai thước với nhau), không phải lỗi hệ.
 *
 * SỬA BẰNG CẤU TRÚC, KHÔNG ĐUA THỨ TỰ BOOT: ghi nhớ thước đã dùng để chụp nền; `reconcileOnce()`
 * thấy số đến từ THƯỚC KHÁC thì HUỶ nền cũ và chụp lại — KHÔNG báo động lượt đó. Đường warm thứ
 * ba xuất hiện sau này (đổi thước một lần nữa) vẫn vô hại vì cùng cơ chế này áp dụng lại.
 */
let baselineSource: "native" | "smi" | null = null;
/**
 * Pha 1.5 Task 1, review vòng 1 (EXP-1) — số lượt resample LIÊN TIẾP (chưa xen kẽ một nhịp đối
 * chiếu BÌNH THƯỜNG nào). Đạt `SOURCE_UNSTABLE_THRESHOLD` thì bộ ngắt mạch TRIP ở lượt kế —
 * lượt trip đó KHÔNG resample nên KHÔNG cộng thêm vào bộ đếm này (nó ở nhánh riêng). Bộ đếm chỉ
 * reset về 0 khi có một nhịp đối chiếu BÌNH THƯỜNG (không mismatch) — dao động một đợt rồi ổn
 * định lại không bị coi là "hỏng vĩnh viễn", nhưng một lượt trip đơn lẻ cũng không tự "chữa" nó.
 */
let consecutiveResampleCount = 0;
/**
 * Pha 1.5 Task 1, review vòng 2 (MỚI-1) — thước đọc được ở lượt `reconcileOnce()` TRƯỚC (không
 * phải thước đóng băng của nền!) và số nhịp LIÊN TIẾP đọc CÙNG một giá trị.
 *
 * ⚠ VÌ SAO BẮT BUỘC: bộ ngắt mạch (EXP-1) đóng lại theo `device.source === baselineSource` —
 * so với thước ĐÓNG BĂNG lúc trip. Nếu thước ổn định lại ở một giá trị KHÁC thước đóng băng
 * (vd. hai tiến trình cạnh tranh gắn handle, chốt ở nhánh nào cũng 50/50), điều kiện đó KHÔNG
 * BAO GIỜ đúng nữa ⇒ ngắt mạch KẸT VĨNH VIỄN: mù drift + báo động treo mãi, tệ hơn cả chuông câm
 * mà nó thay thế (review vòng 2, MỚI-1). Ổn định phải được đo bằng CHÍNH NÓ — nhịp này có giống
 * nhịp trước không — không phải so với một giá trị đóng băng từ quá khứ.
 */
let lastObservedSource: "native" | "smi" | null = null;
let sameSourceStreak = 0;
/**
 * Bật khi `startVramReconciler()` đã chạy. Lúc đó "chưa biết nền" phải nghĩa là IM LẶNG, KHÔNG
 * phải nền = 0 (NEW-2). Khi cờ này TẮT — tức có người gọi `reconcileOnce()` trực tiếp (Task 7,
 * test, công cụ chẩn đoán) — ta giữ nguyên ngữ nghĩa "không trừ gì", vì người gọi đó tự biết họ
 * đang so số thô.
 */
let baselineRequired = false;

/**
 * Chụp nền. Thành công MỘT LẦN rồi thôi — nếu không, một lượt `stop()`/`start()` lại sẽ nuốt
 * mọi thứ đã nạp vào nền và làm mù luôn sổ.
 *
 * ⚠ NEW-2 — CHỈ ghim khi ĐỌC ĐƯỢC SỐ THẬT. Bản trước đặt `baselineCaptured = true` TRƯỚC
 * `await`, nên một lượt `nvidia-smi` chạm trần `timeout: 3000` lúc boot, hay NVML đang khởi
 * tạo, hay `execFile` lỗi thoáng qua, đều bị ghim VĨNH VIỄN thành `null` — rồi `null` bị coi là
 * 0 và toàn bộ nền bị báo là "cấp phát KHÔNG XIN PHÉP", mỗi 60 giây, mãi mãi, KHÔNG TỰ LÀNH.
 * Nay hỏng thì để nguyên trạng "chưa biết" và THỬ LẠI ở nhịp đối chiếu sau.
 *
 * KHÔNG BAO GIỜ ném: máy không GPU ⇒ trả `null` mãi, hệ chạy tiếp im lặng.
 *
 * @param priorBaseline Pha 1.5 Task 1, review vòng 1 (EXP-2) — CHỈ truyền khi hàm này được gọi
 *   từ nhánh RESAMPLE của `reconcileOnce()` (đổi thước). Đây là nền VỪA BỊ HUỶ (giá trị + thước
 *   cũ), dùng để tính "drift NẾU KHÔNG huỷ" và ghi vào sự kiện `baseline` — xem lý do bắt buộc ở
 *   khối comment "GIỚI HẠN ĐÃ BIẾT" cạnh nhánh resample trong `reconcileOnce()`.
 */
export async function captureVramBaseline(
  priorBaseline?: { usedBytes: number; source: "native" | "smi" } | null,
): Promise<number | null> {
  if (baselineCaptured) return baselineUsedBytes;

  let device: { usedBytes: number; source: "native" | "smi" } | null = null;
  try {
    device = await readDeviceVram();
  } catch {
    device = null;
  }
  // Chưa đọc được ⇒ KHÔNG ghim, KHÔNG kết luận. Nhịp sau thử lại.
  if (!device) return null;

  const snap = snapshot();
  const ledgerTotal = snap.totalReservedBytes;
  const raw = device.usedBytes;

  // ⚠ CỐ Ý KHÔNG dùng `leaseBytes()` (Task 4 xuất) ở đây, dù nó trông "gọn hơn".
  // `leaseBytes()` trả `actualBytes ?? estimatedBytes` — nó CỐ TÌNH XOÁ NHOÀ ranh giới giữa
  // "đã đo thật" và "mới ước lượng", đúng thứ mà mọi chỗ KHÁC cần. Ở ĐÂY thì ngược lại: ta
  // phải PHÂN BIỆT hai thứ đó, vì chỉ phần ĐÃ COMMIT mới chắc chắn nằm trong `deviceUsed`.
  // ⚠ Người sau: đừng "dọn dẹp" dòng này thành `leaseBytes()` — làm vậy là tái tạo đúng lỗi
  // đã mô tả ở docstring trên (nền bị đầu độc vĩnh viễn khi chụp trúng cửa sổ chưa-commit).
  const committedBytes = snap.leases.reduce((sum, l) => sum + (l.actualBytes ?? 0), 0);

  // Trạng thái MÂU THUẪN: thiết bị đang giữ ÍT HƠN tổng ta đã ĐO ĐƯỢC trên chính nó. Không thể
  // xảy ra nếu số liệu đúng ⇒ lượt chụp này VÔ LÝ. Không ghim, không kết luận, thử lại nhịp sau
  // (cùng nguyên tắc với ca đầu dò `null` ở NEW-2): một phép chụp cho ra kết quả vô lý TUYỆT ĐỐI
  // không được phép trở thành hằng số cho suốt vòng đời tiến trình.
  if (raw < committedBytes) {
    console.warn(
      `[vram] BỎ QUA lượt chụp nền: thiết bị ${Math.round(raw / 1024 / 1024)} MiB < tổng đã commit ` +
        `${Math.round(committedBytes / 1024 / 1024)} MiB — số liệu mâu thuẫn, sẽ thử lại ở nhịp sau.`,
    );
    return null;
  }

  baselineUsedBytes = raw - committedBytes;
  baselineCaptured = true;
  baselineSource = device.source;

  const mib = (b: number) => Math.round(b / 1024 / 1024);
  console.log(
    `[vram] nền thiết bị: ${mib(baselineUsedBytes)} MiB ` +
      `(thiết bị ${mib(raw)} − đã commit ${mib(committedBytes)}, thước "${device.source}") — không phải của ` +
      `tiến trình này, sẽ TRỪ khỏi mọi phép so sổ.`,
  );
  logVramEvent({
    event: "baseline",
    owner: "reconciler",
    leaseKind: "external-process",
    priority: "background",
    deviceUsedBytes: raw,
    ledgerTotalBytes: ledgerTotal,
    detail: {
      deviceUsedRawBytes: raw,
      // Phần THỰC SỰ bị trừ. Khác `ledgerTotalBytes` đúng bằng phần giấy phép chưa commit —
      // chênh lệch giữa hai số này cho biết lúc chụp có bao nhiêu lượt cấp phát đang dở dang.
      committedBytes,
      ledgerTotalBytes: ledgerTotal,
      baselineUsedBytes,
      // Pha 1.5 Task 1 — thước đã dùng để chụp nền này. `reconcileOnce()` so nó với thước của
      // lượt đối chiếu; khác nhau thì huỷ nền và chụp lại thay vì so hai thước với nhau.
      source: device.source,
      // Pha 1.5 Task 1, review vòng 1 (EXP-2) — CHỈ có khi lượt chụp này là RESAMPLE (đổi
      // thước), KHÔNG bịa ra cho lượt chụp đầu tiên (không có nền cũ để so). Đây là dấu vết
      // DUY NHẤT còn lại của một kẻ chui grab ĐÚNG LÚC đổi thước: lượt phát hiện đổi thước cố ý
      // KHÔNG báo động (số vừa huỷ không đáng tin để so trực tiếp — quyết định ĐÃ DUYỆT), nhưng
      // nếu không ghi lại gì thì kẻ chui đó biến mất VĨNH VIỄN không cách nào truy ngược.
      ...(priorBaseline
        ? {
            priorBaselineUsedBytes: priorBaseline.usedBytes,
            priorSource: priorBaseline.source,
            newSource: device.source,
            // "Nếu KHÔNG huỷ nền cũ mà so trực tiếp nền CŨ với số liệu MỚI, drift sẽ là bao
            // nhiêu?" — CHÍNH XÁC phép so hai thước mà Task 1 sinh ra để TRÁNH khi so LIVE, nhưng
            // ở đây chỉ dùng để GHI SỔ, không dùng để báo động.
            driftIfNotResampled: raw - priorBaseline.usedBytes - ledgerTotal,
          }
        : {}),
      note:
        "nền = thiết bị − tổng giấy phép ĐÃ COMMIT. Chỉ trừ phần đã commit vì chỉ phần đó chắc " +
        "chắn đã nằm trong deviceUsed; giấy phép chưa commit là 'đã xin, chưa cấp phát xong' nên " +
        "trừ nó là trừ thứ chưa tồn tại. ⚠ Sidecar chạy tiến trình RIÊNG thì KHÔNG có trong sổ ⇒ " +
        "vẫn bị nuốt vào đây (spec §6 — Pha 3 nhận nuôi).",
    },
  });
  return baselineUsedBytes;
}

/**
 * Đúng một nhịp của bộ đếm giờ: THỬ LẠI lượt chụp nền (no-op khi đã có) rồi đối chiếu.
 * Tách ra để test canh được hành vi thử-lại mà không phải giả lập đồng hồ.
 */
export async function __runReconcileTick(): Promise<VramReconcileResult> {
  await captureVramBaseline();
  return reconcileOnce();
}

/** Chỉ dùng trong test. */
export function __resetVramBaselineForTests(): void {
  baselineUsedBytes = null;
  baselineCaptured = false;
  baselineRequired = false;
  // Pha 1.5 Task 1 — KHÔNG reset thì test sau KẾ THỪA thước của test trước, và một lượt chụp
  // nền mới (thước A) có thể bị hiểu nhầm là "đổi thước" ngay từ lượt đối chiếu đầu tiên.
  baselineSource = null;
  // Pha 1.5 Task 1, review vòng 1 (EXP-1) — cùng lý do: không reset thì test sau KẾ THỪA số lượt
  // resample liên tiếp của test trước, và bộ ngắt mạch có thể trip SAI ngay từ mismatch đầu tiên.
  consecutiveResampleCount = 0;
  // Pha 1.5 Task 1, review vòng 2 (MỚI-1) — cùng lý do: không reset thì test sau KẾ THỪA
  // `sameSourceStreak`/`lastObservedSource`, và lối thoát ngắt mạch có thể kích hoạt SAI (hoặc
  // trễ hơn thật) ngay từ những nhịp đầu của test kế tiếp.
  lastObservedSource = null;
  sameSourceStreak = 0;
}

/**
 * So sổ với thiết bị. Lệch quá ngưỡng ⇒ có sự cố cần điều tra:
 * - Lệch DƯƠNG (thiết bị > sổ): có hộ tiêu thụ cấp phát KHÔNG XIN PHÉP.
 * - Lệch ÂM (sổ > thiết bị): giấy phép TREO (tiến trình chết) hoặc commit() ghi số SAI —
 *   KHÔNG phải cấp phát chui. Xem I-2 (review round 1) — câu cảnh báo phải chẩn đoán đúng
 *   hướng, không được gắn cố định một nguyên nhân cho cả hai dấu.
 *
 * Đây là phần giá trị nhất của Pha 1: sidecar 7,8 GB (Đợt 0), ONNX +339 và
 * cron +1.251 (Đợt 2) — cả ba từng cần một lượt review TOÀN NHÁNH mới lộ ra.
 * Với hàm này chúng lộ trong vài phút.
 */
export async function reconcileOnce(): Promise<VramReconcileResult> {
  const snap = snapshot();
  /**
   * Pha 1.5 Task 3 — CỬA SỔ CHƯA-COMMIT. Tính NGAY ở đầu hàm (không phụ thuộc device) vì
   * MỌI nhánh return bên dưới đều cần trả `pendingBytes` cho người gọi.
   *
   * ⚠⚠ LOẠI `measureFailed === true` — KHÔNG PHẢI tuỳ chọn:
   * `actualBytes === null` gộp CHUNG hai trạng thái trái ngược nhau (xem docstring
   * `VramLease.measureFailed`, types.ts): "đang cấp phát dở, số thật sắp tới" (tự lành trong
   * vài giây — ĐÂY mới là thứ Task 3 nới dung sai cho) và "đã ĐO, delta ÂM, ước lượng đứng
   * MÃI MÃI" (measureFailed=true — KHÔNG tự lành, đây chính là lệch ÂM DAI DẲNG mà nhánh cảnh
   * báo bên dưới sinh ra để BẮT). Gộp cả hai vào `pendingBytes` sẽ nới băng dung sai VĨNH VIỄN
   * theo đúng phần ước lượng đã bị đóng băng của lease đo-hỏng đó — tự tay bịt miệng chuông mà
   * `measure_failed` (vramWiring.ts) đã cố tình để lại dấu vết. `wiring.negativeDelta.test.ts`
   * ca 4 canh chính xác việc này: reranker ước lượng 606 MiB / thật 18 MiB, measureFailed=true
   * ⇒ PHẢI báo động "đo hỏng" — pendingBytes gộp lease đó sẽ tắt tiếng SAI ca đó.
   *
   * ⚠ "Lease không bao giờ commit thì băng dung sai treo bao lâu?" — review vòng 1 (Important-1)
   * chỉ ra CÂU TRẢ LỜI VÒNG ĐẦU thiếu một đường: `commitMeasured()` (vramWiring.ts) có BA
   * nhánh KHÔNG BAO GIỜ ghi `actualBytes`, không phải hai:
   *
   *   1. **Đo hỏng** (`actual < 0`) — `markMeasureFailed()` chạy NGAY LẬP TỨC, TRONG CÙNG lượt
   *      gọi phát hiện delta âm. Lease rơi khỏi `pendingBytes` chậm nhất ở nhịp
   *      `reconcileOnce()` KẾ TIẾP (≤ `INTERVAL_MS`, mặc định 60 giây).
   *   2. **Đầu dò trả `null`** (`beforeUsed === null` lúc tạo ticket, hoặc `after === null` lúc
   *      commit — dễ xảy ra nhất ĐÚNG LÚC GPU đang bận nạp model: `nvidia-smi` timeout 3s hoặc
   *      handle native chập chờn). Review vòng 1 phát hiện bản vá GỐC của Task 3 bỏ sót đường
   *      này — `vramWiring.ts` từng `return` CÂM ở cả hai nhánh, không gọi `markMeasureFailed()`.
   *      Đã vá: giờ cả hai nhánh cũng đánh dấu `measureFailed=true` NGAY LẬP TỨC, cùng tốc độ
   *      tự lành như đường 1 (≤ một nhịp `reconcileOnce()`), KHÔNG còn phải chờ tới `release()`.
   *      Xem `wiring.probeNull.test.ts` (4 test + đột biến) và docstring tại nhánh đó trong
   *      `vramWiring.ts` để biết ĐÁNH ĐỔI đã cân nhắc (báo động có thể giải thích được, đổi lấy
   *      không còn lỗ câm tới lúc unload/evict).
   *   3. **Tiến trình CHẾT HẲN trước khi `commitMeasured()` kịp chạy** (kill -9, mất điện) —
   *      KHÔNG đường nào trong hai đường trên chạm tới, vì không có code nào của TA được thực
   *      thi để đặt bất kỳ cờ nào. Lease đó vẫn `actualBytes: null, measureFailed: false`
   *      VĨNH VIỄN cho tới khi có người khởi động lại tiến trình (xoá sạch ledger trong bộ
   *      nhớ). `gguf-model` KHÔNG có `ttlMs`/reap như `external-process` (types.ts) nên Task 3
   *      KHÔNG tự chữa được ca này — nó thừa hưởng đúng rủi ro "giấy phép treo" đã biết, chỉ
   *      khác hệ quả cụ thể: băng dung sai phía ÂM nới rộng thêm đúng ước lượng của lease treo
   *      đó cho tới khi người vận hành can thiệp thủ công (hoặc một task tương lai thêm TTL
   *      cho kind `gguf-model`).
   *
   * Sau bản vá vòng 1, CHỈ CÒN đường 3 là "treo tới restart" — đường 1 và 2 đều tự lành trong
   * ≤ một nhịp `reconcileOnce()`.
   */
  const pendingBytes = snap.leases
    .filter((l) => l.actualBytes === null && !l.measureFailed)
    .reduce((s, l) => s + l.request.estimatedBytes, 0);
  // ⚠ M-2 (review round 1, SỬA LẠI ở review TOÀN NHÁNH): lấy mẫu KHÔNG NGUYÊN TỬ.
  // `snapshot()` tức thời, còn `readDeviceVram()` thì KHÔNG — nhưng nguyên nhân đã bị ghi
  // SAI ở bản trước, sai cả hướng lẫn HAI BẬC ĐỘ LỚN:
  //
  //   • Bản trước viết "`readDeviceVram()` mất tới ~3 s". SAI: `~3 s` là **trần
  //     `timeout: 3000`** của `execFile`, không phải chi phí thường. Chính `vramProbe.ts:9-17`
  //     — file được trích dẫn — đã RÚT LẠI đúng câu đó: đo được **72-80 ms** (báo cáo §4:
  //     p50 **62,9 ms**), và khi `setLlamaInstanceHandle()` đã nối thì là `getVramState()`
  //     native ~0 ms. Trích dẫn một file để chống lưng cho điều mà chính file đó đã bác bỏ là
  //     cách nhanh nhất biến comment thành mìn.
  //   • CỬA SỔ LỆCH ÂM THẬT không phải ~3 s mà là **THỜI LƯỢNG NẠP MODEL: 11-43 s** (báo cáo
  //     §3.5). `reserve()` cộng `estimatedBytes` vào sổ ở `aiGgufEngine.ts:737`, còn
  //     `commitMeasured()` mãi `:802` — cả `llama.loadModel()` nằm giữa. Bất kỳ nhịp đối chiếu
  //     nào rơi vào khoảng đó đều thấy lệch ÂM tới hàng chục GiB (đo được **−16.335 MiB**).
  //     Nó tự lành ở nhịp kế, nhưng xác suất trúng không nhỏ như con số "3 s" gợi ý.
  //
  // Đây là TÍNH CHẤT THIẾT KẾ CỐ HỮU của phép so sổ-vs-thiết bị, không phải bug của đầu dò —
  // người trực đọc một `drift` âm lớn ngay sau một lượt nạp model nên nghi bóng ma TRƯỚC.
  // ⚠ Lệch âm DAI DẲNG (không tự lành sau một nhịp) thì NGƯỢC LẠI: đó là giấy phép "đo hỏng"
  // (I-2, xem nhánh cảnh báo bên dưới) hoặc giấy phép treo — hai thứ đó phải điều tra thật.
  const device = await readDeviceVram();

  // Đầu dò hỏng hoặc máy không GPU ⇒ IM LẶNG bỏ qua.
  // KHÔNG được biến máy không-GPU thành máy báo động liên tục (spec §11).
  if (!device) {
    return {
      driftBytes: null,
      alarm: false,
      ledgerTotalBytes: snap.totalReservedBytes,
      deviceUsedBytes: null,
      baselineUsedBytes,
      baselineResampled: false,
      sourceUnstable: false,
      pendingBytes,
    };
  }

  // Pha 1.5 Task 1, review vòng 2 (MỚI-1) — cập nhật TRẠNG THÁI ỔN ĐỊNH TỰ THÂN của thước, MỖI
  // NHỊP, TRƯỚC mọi so sánh với `baselineSource`. Đây là dữ liệu duy nhất cho phép bộ ngắt mạch
  // thoát trạng thái "bất ổn" khi thước ổn định lại ở một giá trị KHÁC thước đã đóng băng lúc
  // trip — so với chính nhịp trước, không so với quá khứ đã đóng băng.
  if (device.source === lastObservedSource) {
    sameSourceStreak += 1;
  } else {
    sameSourceStreak = 1;
    lastObservedSource = device.source;
  }

  // Pha 1.5 Task 1 — MỘT THƯỚC DUY NHẤT. Nền được chụp bằng một thước (native ⇄ smi); nếu lượt
  // đối chiếu NÀY đến từ thước KHÁC, so trực tiếp là so hai thước với nhau — hai thước lệch
  // 165-178 MiB (báo cáo Pha 1 §3.4), ĐỦ MỘT MÌNH đẩy lệch qua ngưỡng 512 MiB và làm chuông kêu
  // MÃI MÃI dù không ai cấp phát chui. ĐỪNG cố "chụp nền muộn hơn cho tới khi handle gắn xong"
  // — đó là đua với thứ tự boot (đã tốn ba vòng sửa vì đúng lỗi này ở NEW-1/NEW-2 trên). Sửa
  // bằng cấu trúc: huỷ nền cũ, chụp lại bằng thước MỚI, và KHÔNG báo động ở lượt phát hiện — số
  // vừa bị huỷ không đáng tin để so.
  if (baselineCaptured && baselineSource !== null && device.source !== baselineSource) {
    // Pha 1.5 Task 1, review vòng 1 (EXP-1) — BỘ NGẮT MẠCH. Nếu thước DAO ĐỘNG (đổi liên tục mỗi
    // nhịp), nhánh resample phía dưới sẽ chạy MÃI — mọi nhịp huỷ nền rồi chụp lại, KHÔNG nhịp
    // nào từng đối chiếu được, và một khoản cấp phát chui tồn tại xuyên suốt sẽ KHÔNG BAO GIỜ lộ
    // ra: chuông CÂM VĨNH VIỄN mà không ai biết nó đang câm — tệ hơn một báo động giả. Quá
    // `SOURCE_UNSTABLE_THRESHOLD` lần resample LIÊN TIẾP thì NGỪNG resample, ĐÓNG BĂNG nền hiện
    // tại, và báo động về chính sự BẤT ỔN của thước — nội dung PHẢI khác "cấp phát chui" vì
    // nguyên nhân và hành động sửa hoàn toàn khác nhau (đi sửa đầu dò/handle, không phải đi tìm
    // hộ tiêu thụ).
    if (consecutiveResampleCount >= SOURCE_UNSTABLE_THRESHOLD) {
      // Pha 1.5 Task 1, review vòng 2 (MỚI-1) — LỐI THOÁT KHỎI NGẮT MẠCH.
      //
      // ⚠ VÌ SAO BẮT BUỘC: nhánh TRIP phía dưới đóng băng `baselineSource` và chỉ tự thoát khi
      // `device.source === baselineSource` (điều kiện đó nằm ở đầu khối `if` bao ngoài — xem
      // dòng so sánh mismatch). Nếu thước ổn định lại ở một giá trị KHÁC thước đóng băng (ca B,
      // vd. hai tiến trình cạnh tranh gắn handle rồi CHỐT ở nhánh thua — 50/50 nó khác thước đã
      // đóng băng), điều kiện đó KHÔNG BAO GIỜ đúng nữa ⇒ TRIP VĨNH VIỄN: `sourceUnstable=true,
      // driftBytes=null` mọi nhịp, dù thước đã hết dao động hoàn toàn từ lâu. Đây là hỏng im lặng
      // Y HỆT lớp lỗi mà bộ ngắt mạch sinh ra để diệt (EXP-1) — chỉ khác là ồn ào vô dụng thay vì
      // câm lặng.
      //
      // SỬA: đo ổn định bằng `sameSourceStreak` (thước không đổi qua ĐỦ SỐ NHỊP LIÊN TIẾP, tự so
      // với chính nó — xem khai báo ở đầu file), KHÔNG so với `baselineSource` đã đóng băng. Đạt
      // ngưỡng thì đây là BẰNG CHỨNG THẬT (không phải may mắn trùng một lượt đọc) rằng thước đã
      // định hình — RESAMPLE theo thước MỚI đó (dù khác thước đóng băng) rồi thoát ngắt mạch,
      // đúng cơ chế "một thước duy nhất" gốc của Task 1: không đối chiếu tiếp cho tới khi nền và
      // số liệu CÙNG một thước.
      if (sameSourceStreak >= SOURCE_UNSTABLE_THRESHOLD) {
        console.warn(
          `[vram] THƯỚC ĐÃ ỔN ĐỊNH LẠI ở "${device.source}" (khác thước đóng băng "${baselineSource}") ` +
            `sau ${sameSourceStreak} nhịp liên tiếp cùng giá trị — thoát ngắt mạch, chụp lại nền theo thước mới.`,
        );
        const priorSourceSnapshot = baselineSource;
        const priorUsedBytesSnapshot = baselineUsedBytes;
        baselineCaptured = false;
        baselineUsedBytes = null;
        baselineSource = null;
        await captureVramBaseline(
          priorUsedBytesSnapshot !== null && priorSourceSnapshot !== null
            ? { usedBytes: priorUsedBytesSnapshot, source: priorSourceSnapshot }
            : null,
        );
        consecutiveResampleCount = 0;
        return {
          driftBytes: null,
          alarm: false,
          ledgerTotalBytes: snap.totalReservedBytes,
          deviceUsedBytes: device.usedBytes,
          baselineUsedBytes,
          baselineResampled: true,
          sourceUnstable: false,
          pendingBytes,
        };
      }

      console.warn(
        `[vram] THƯỚC ĐO KHÔNG ỔN ĐỊNH — đã đổi thước ≥ ${SOURCE_UNSTABLE_THRESHOLD} lần liên tiếp ` +
          `(nền đang đóng băng ở thước "${baselineSource}", lượt này đọc được "${device.source}"). ` +
          `DỪNG chụp lại để tránh im lặng vĩnh viễn — số so sánh KHÔNG ĐÁNG TIN cho tới khi thước ổn định. ` +
          `Đây là lỗi ĐO (đầu dò/handle chập chờn), KHÔNG PHẢI cấp phát chui.`,
      );
      logVramEvent({
        event: "source_unstable",
        owner: "reconciler",
        leaseKind: "external-process",
        priority: "background",
        deviceUsedBytes: device.usedBytes,
        ledgerTotalBytes: snap.totalReservedBytes,
        detail: {
          frozenSource: baselineSource,
          attemptedSource: device.source,
          consecutiveResampleCount,
          threshold: SOURCE_UNSTABLE_THRESHOLD,
          note:
            "Thước dao động liên tục ⇒ bộ ngắt mạch dừng resample để tránh chuông câm vĩnh viễn " +
            "(EXP-1). Số so sánh hiện KHÔNG đáng tin — điều tra đầu dò/handle, không phải đi tìm " +
            "hộ tiêu thụ chui.",
        },
      });
      return {
        driftBytes: null,
        alarm: true,
        ledgerTotalBytes: snap.totalReservedBytes,
        deviceUsedBytes: device.usedBytes,
        baselineUsedBytes,
        baselineResampled: false,
        sourceUnstable: true,
        pendingBytes,
      };
    }

    console.warn(
      `[vram] ĐỔI THƯỚC ${baselineSource} → ${device.source} — huỷ nền cũ và chụp lại, ` +
        `không so hai thước với nhau.`,
    );
    // Pha 1.5 Task 1, review vòng 1 (EXP-2) — GIỚI HẠN ĐÃ BIẾT, CHẤP NHẬN Ở PHA 1.5, cùng lớp
    // với ca "sidecar sống khi restart" đã ghi ở `captureVramBaseline()` phía trên: một cấp phát
    // chui xuất hiện ĐÚNG LÚC đổi thước sẽ bị NUỐT VÀO NỀN MỚI và KHÔNG nhịp nào sau bắt được —
    // `alarm: false` ở lượt phát hiện đổi thước là ĐÚNG THIẾT KẾ (số vừa huỷ không đáng tin để so
    // trực tiếp), nhưng hệ quả là kẻ chui đó biến mất vào nền như thể nó luôn ở đó. Cửa sổ rủi ro
    // này NHÂN ĐÔI so với ca sidecar-restart (vốn chỉ một lần lúc boot): nay còn mở lại mỗi lần
    // đổi thước. Pha 1.5 CHẤP NHẬN đánh đổi này một cách TƯỜNG MINH — không có cách nào phân biệt
    // "đổi thước sạch" với "đổi thước đúng lúc có kẻ chui" chỉ từ MỘT lượt đọc — nhưng KHÔNG được
    // để dấu vết biến mất: nền CŨ + "drift nếu không huỷ" được ghi vào sự kiện `baseline` bên
    // dưới, để điều tra SAU vẫn còn dữ liệu để truy ngược (không sống lại được nền đã mất, nhưng
    // ít nhất biết ĐÃ MẤT gì).
    const priorSourceSnapshot = baselineSource;
    const priorUsedBytesSnapshot = baselineUsedBytes;
    baselineCaptured = false;
    baselineUsedBytes = null;
    baselineSource = null;
    await captureVramBaseline(
      priorUsedBytesSnapshot !== null && priorSourceSnapshot !== null
        ? { usedBytes: priorUsedBytesSnapshot, source: priorSourceSnapshot }
        : null,
    );
    consecutiveResampleCount += 1;
    return {
      driftBytes: null,
      alarm: false,
      ledgerTotalBytes: snap.totalReservedBytes,
      deviceUsedBytes: device.usedBytes,
      baselineUsedBytes,
      baselineResampled: true,
      sourceUnstable: false,
      pendingBytes,
    };
  }

  // Pha 1.5 Task 1, review vòng 1 (EXP-1) — nhịp này KHÔNG mismatch (đối chiếu bình thường) ⇒
  // thước đã ỔN ĐỊNH lại. Reset bộ đếm resample-liên-tiếp — một đợt dao động rồi ổn định lại
  // không được coi là "hỏng vĩnh viễn". (Lượt ngắt mạch TRIP ở nhánh trên KHÔNG chạy tới đây vì
  // nó `return` sớm — count chỉ reset khi thước THẬT SỰ ổn định, không phải mỗi khi ngừng resample.)
  consecutiveResampleCount = 0;

  // NEW-2 — reconciler ĐANG CHẠY mà CHƯA BIẾT nền ⇒ IM LẶNG. "Chưa biết" TUYỆT ĐỐI không được
  // hiểu thành "nền = 0": hiểu vậy thì toàn bộ ~1 GB nền của máy bị báo là cấp phát chui, mỗi
  // 60 giây. Thà không báo còn hơn báo sai. Trạng thái này là TẠM — `__runReconcileTick()` thử
  // chụp lại ở mỗi nhịp, nên đầu dò hồi phục là nền tự lành.
  if (baselineRequired && baselineUsedBytes === null) {
    return {
      driftBytes: null,
      alarm: false,
      ledgerTotalBytes: snap.totalReservedBytes,
      deviceUsedBytes: device.usedBytes,
      baselineUsedBytes: null,
      baselineResampled: false,
      sourceUnstable: false,
      pendingBytes,
    };
  }

  // I-1 — TRỪ NỀN. `attributable` = phần VRAM QUY ĐƯỢC cho tiến trình này; chỉ phần đó mới có
  // quyền được đem so với sổ. Người gọi `reconcileOnce()` TRỰC TIẾP mà chưa chụp nền (Task 7,
  // test, công cụ chẩn đoán) ⇒ nền = 0 ⇒ so số THÔ, đúng như họ yêu cầu.
  const baseline = baselineUsedBytes ?? 0;
  const attributable = device.usedBytes - baseline;
  const drift = attributable - snap.totalReservedBytes;
  /**
   * Pha 1.5 Task 3 — BĂNG DUNG SAI CHỈ MỘT PHÍA (ÂM). `snap.totalReservedBytes` đã cộng ƯỚC
   * LƯỢNG của MỌI giấy phép pending ngay từ `reserve()` (`vramBroker.leaseBytes`), nên trong
   * suốt cửa sổ nạp model, `drift` càng ÂM SÂU khi vật lý càng chưa theo kịp sổ — đúng nguồn
   * −16.335 MiB đo được ở Pha 1. `pendingBytes` (tính ở đầu hàm) là phần được PHÉP thiếu hụt
   * chính đáng đó, nên chỉ nới NGƯỠNG PHÍA ÂM (`drift < -(NGƯỠNG + pendingBytes)`).
   *
   * PHÍA DƯƠNG GIỮ NGUYÊN NGƯỠNG CHẶT — đây KHÔNG phải bỏ sót mà là CHỦ Ý: sổ đã "đặt cọc"
   * TOÀN BỘ ước lượng của lease pending rồi, nên vật lý của CHÍNH lease đó không bao giờ vượt
   * quá phần đã đặt cọc (trừ khi ước lượng sai — chuyện khác, Pha 2 xử). Bất kỳ phần dương nào
   * vượt `snap.totalReservedBytes + NGƯỠNG` — bất kể lease pending đã lên VRAM được bao nhiêu
   * phần trăm — CHỈ có thể đến từ một nguồn KHÔNG nằm trong sổ, tức kẻ cấp phát chui. Nới nốt
   * phía dương (đổi thành `drift > NGƯỠNG + pendingBytes`) sẽ cho một kẻ chui xuất hiện ĐÚNG
   * LÚC hệ đang nạp model — tức đúng lúc `pendingBytes` lớn nhất — chỗ ẩn nấp rộng nhất trong
   * toàn hệ, đúng cái mà module này sinh ra để bắt.
   */
  const alarm = drift > DRIFT_THRESHOLD_BYTES || drift < -(DRIFT_THRESHOLD_BYTES + pendingBytes);

  if (alarm) {
    const mib = (b: number) => Math.round(b / 1024 / 1024);
    const holders = () => snap.leases.map((l) => `${l.request.owner}=${mib(leaseBytes(l))}`).join(", ") || "(sổ rỗng)";
    // Luôn nói rõ đã trừ bao nhiêu — người trực phải kiểm chứng được con số, không phải tin.
    const baseNote = baseline > 0 ? ` (đã trừ nền ${mib(baseline)} MiB)` : "";

    if (drift > 0) {
      console.warn(
        `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}, thiết bị ${mib(attributable)}${baseNote}. ` +
          `Có hộ tiêu thụ cấp phát KHÔNG XIN PHÉP (sidecar? tiến trình con? thư viện khác?). ` +
          `Đang giữ: ${holders()}${describeTopologyHint()}`,
      );
    } else {
      // ⚠ I-2 — TÁCH HAI NHÓM. Trước đây cả hai bị gộp vào "chưa commit", và người trực ngồi
      // đợi một lượt commit KHÔNG BAO GIỜ TỚI cho nhóm thứ hai.
      //   • "chưa commit"  = đang cấp phát dở. TỰ LÀNH sau vài giây → chờ một nhịp là đúng.
      //   • "ĐO HỎNG"      = đã đo, delta âm, ước lượng đứng MÃI MÃI. KHÔNG tự lành → phải sửa
      //                      (bỏ nạp lại hộ đó, hoặc đợi Pha 2 dùng Σ actualBytes).
      const pending = snap.leases
        .filter((l) => l.actualBytes === null && !l.measureFailed)
        .map((l) => l.request.owner);
      const failed = snap.leases.filter((l) => l.measureFailed).map((l) => l.request.owner);
      const failedNote = failed.length
        ? `⚠ ĐO HỎNG (ước lượng KHÔNG xác minh được, KHÔNG tự lành): ${failed.join(", ")}. `
        : "";
      console.warn(
        `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}, thiết bị ${mib(attributable)}${baseNote}. ` +
          `Sổ đang giữ NHIỀU HƠN thực tế — giấy phép treo, đo hỏng, hoặc số commit sai, KHÔNG PHẢI cấp phát chui. ` +
          `${failedNote}Ứng viên số một (chưa commit): ${pending.join(", ") || "(không có)"}. Đang giữ: ${holders()}`,
      );
    }
    logVramEvent({
      event: "drift",
      owner: "reconciler",
      leaseKind: "external-process",
      priority: "background",
      deviceUsedBytes: device.usedBytes,
      ledgerTotalBytes: snap.totalReservedBytes,
      driftBytes: drift,
      // Ảnh chụp TOÀN BỘ sổ lúc lệch — đây là dữ liệu Ư7 cần.
      detail: {
        // I-1 — ghi CẢ số thô lẫn nền, để đọc lại nhật ký là dựng lại được phép tính, không
        // phải tin một con số đã bị trừ ở đâu đó.
        deviceUsedRawBytes: device.usedBytes,
        baselineUsedBytes: baseline,
        attributableBytes: attributable,
        // Pha 1.5 Task 3 — phần băng dung sai ÂM đã được nới cho lượt này; đọc nhật ký là biết
        // NGAY ngưỡng thực tế đã áp dụng là bao nhiêu, không phải đoán từ danh sách leases.
        pendingBytes,
        leases: snap.leases.map((l) => ({
          owner: l.request.owner,
          kind: l.request.kind,
          priority: l.request.priority,
          bytes: leaseBytes(l),
          committed: l.actualBytes !== null,
          // I-2 — "chưa commit" và "đo hỏng" trông giống nhau trong ảnh chụp nếu chỉ có cờ
          // `committed`. Ghi riêng để đọc lại nhật ký là phân biệt được tạm thời vs vĩnh viễn.
          measureFailed: l.measureFailed === true,
        })),
      },
    });
  }

  return {
    driftBytes: drift,
    alarm,
    ledgerTotalBytes: snap.totalReservedBytes,
    deviceUsedBytes: device.usedBytes,
    baselineUsedBytes,
    baselineResampled: false,
    sourceUnstable: false,
    pendingBytes,
  };
}

export function startVramReconciler(): void {
  if (timer) return;
  // Từ đây trở đi, "chưa biết nền" nghĩa là IM LẶNG chứ không phải nền = 0 (NEW-2).
  baselineRequired = true;
  // Chụp nền NGAY. Không `await` (hàm này đồng bộ, nằm trên đường boot). Không kịp / đầu dò
  // hỏng cũng không sao: mỗi nhịp `__runReconcileTick()` đều THỬ LẠI, và công thức
  // `nền = thiết bị − sổ` khiến lượt chụp muộn vẫn cho ra ĐÚNG con số (NEW-1).
  void captureVramBaseline();
  timer = setInterval(() => { void __runReconcileTick(); }, INTERVAL_MS);
  timer.unref?.();
}

export function stopVramReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function __hasReconcilerTimer(): boolean { return timer !== null; }

/**
 * Pha 1.5 Task 4 — nhãn cho biết hệ có đang chạy nhiều tiến trình giữ VRAM
 * không (báo cáo Pha 1 §9). Đọc `process.env.ROLE` TRỰC TIẾP (không cache ở
 * module-load) vì test đổi `ROLE` giữa các case bằng `vi.resetModules()` +
 * import lại — cache tĩnh sẽ đọc trúng giá trị của lượt import TRƯỚC.
 *
 * ⚠ CHỈ nối vào nhánh LỆCH DƯƠNG (`drift > 0`, "cấp phát không xin phép") của
 * cảnh báo ở `reconcileOnce()`. KHÔNG nối vào nhánh âm — lệch âm là giấy phép
 * treo/đo hỏng CỦA CHÍNH tiến trình này (xem chú thích I-2 phía trên), gợi ý
 * "tiến trình anh em" ở đó là sai hướng và làm người trực đi tìm nhầm chỗ.
 *
 * ⚠ Vì sao đây là dây an toàn còn thiếu: tiến trình `api` nay GHI sự kiện
 * (Task 4) nhưng KHÔNG BAO GIỜ tự đối chiếu (`startVramReconciler()` chỉ chạy
 * ở vai trò chạy scheduler) — nếu `api` tự cấp phát rồi không nhả, KHÔNG có
 * gì bên trong chính tiến trình `api` phát hiện ra. Chuông chỉ reo được ở
 * tiến trình đối chiếu (worker/all-in-one), và hint này là thứ giúp người
 * trực không đổ oan cho "kẻ lạ" khi thủ phạm là chính `api`.
 */
export function describeTopologyHint(): string {
  const role = process.env.ROLE ?? "";
  if (role !== "api" && role !== "worker") return "";
  return (
    " ⚠ Hệ đang tách vai trò api/worker — mỗi tiến trình có sổ RIÊNG, nên khoản lệch này " +
    "có thể là của tiến trình anh em chứ không phải kẻ lạ. Sổ chung là Pha 3."
  );
}
