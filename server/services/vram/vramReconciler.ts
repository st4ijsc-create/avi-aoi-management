import { snapshot, leaseBytes } from "./vramBroker";
import { readDeviceVram } from "./vramProbe";
import { logVramEvent } from "./vramEventLog";

const DRIFT_THRESHOLD_BYTES = Number(process.env.VRAM_DRIFT_THRESHOLD_MB ?? 512) * 1024 * 1024;
const INTERVAL_MS = Number(process.env.VRAM_RECONCILE_INTERVAL_MS ?? 60_000);

export interface VramReconcileResult {
  driftBytes: number | null;
  alarm: boolean;
  ledgerTotalBytes: number;
  deviceUsedBytes: number | null;
  /** Nền thiết bị đã TRỪ khỏi phép so (null = chưa chụp / máy không GPU). */
  baselineUsedBytes: number | null;
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
 * sổ ra là xong, ĐÚNG với mọi thứ tự boot.
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
 */
export async function captureVramBaseline(): Promise<number | null> {
  if (baselineCaptured) return baselineUsedBytes;

  let device: { usedBytes: number } | null = null;
  try {
    device = await readDeviceVram();
  } catch {
    device = null;
  }
  // Chưa đọc được ⇒ KHÔNG ghim, KHÔNG kết luận. Nhịp sau thử lại.
  if (!device) return null;

  // NEW-1 — trừ phần của CHÍNH TA đã nằm trong sổ. `Math.max(0, …)` vì phép lấy mẫu không
  // nguyên tử: `reserve()` cộng ước lượng vào sổ TRƯỚC khi VRAM vật lý kịp tăng, nên sổ có thể
  // tạm lớn hơn thiết bị. Nền âm sẽ thổi phồng `attributable` vĩnh viễn — thà kẹp về 0.
  const ledgerTotal = snapshot().totalReservedBytes;
  const raw = device.usedBytes;
  baselineUsedBytes = Math.max(0, raw - ledgerTotal);
  baselineCaptured = true;

  const mib = (b: number) => Math.round(b / 1024 / 1024);
  console.log(
    `[vram] nền thiết bị: ${mib(baselineUsedBytes)} MiB ` +
      `(thiết bị ${mib(raw)} − sổ ${mib(ledgerTotal)}) — không phải của tiến trình này, sẽ TRỪ khỏi mọi phép so sổ.`,
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
      ledgerTotalBytes: ledgerTotal,
      baselineUsedBytes,
      note:
        "nền = thiết bị − sổ. Trừ sổ ra để cấp phát của CHÍNH TA (đường warm chạy trước lúc chụp) " +
        "không bị nuốt vào nền, bất kể thứ tự boot. ⚠ Sidecar chạy tiến trình RIÊNG thì KHÔNG có " +
        "trong sổ ⇒ vẫn bị nuốt vào đây (spec §6 — Pha 3 nhận nuôi).",
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
  // ⚠ M-2 (review round 1): lấy mẫu KHÔNG NGUYÊN TỬ. `snapshot()` tức thời, còn
  // `readDeviceVram()` mất tới ~3 s (vramProbe.ts). `reserve()` đồng bộ cộng
  // `estimatedBytes` vào sổ TRƯỚC KHI VRAM vật lý kịp tăng ⇒ một lượt reconcile rơi
  // đúng giữa cửa sổ nạp model lớn có thể thấy lệch ÂM THOÁNG QUA (tự lành ở lượt kế
  // 60 s sau). Đây là TÍNH CHẤT THIẾT KẾ CỐ HỮU, không phải bug — Task 7 và người trực
  // đọc một `drift` âm gần thời điểm nạp model lớn nên nghi bóng ma trước, không phải
  // sự cố thật.
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
    };
  }

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
    };
  }

  // I-1 — TRỪ NỀN. `attributable` = phần VRAM QUY ĐƯỢC cho tiến trình này; chỉ phần đó mới có
  // quyền được đem so với sổ. Người gọi `reconcileOnce()` TRỰC TIẾP mà chưa chụp nền (Task 7,
  // test, công cụ chẩn đoán) ⇒ nền = 0 ⇒ so số THÔ, đúng như họ yêu cầu.
  const baseline = baselineUsedBytes ?? 0;
  const attributable = device.usedBytes - baseline;
  const drift = attributable - snap.totalReservedBytes;
  const alarm = Math.abs(drift) > DRIFT_THRESHOLD_BYTES;

  if (alarm) {
    const mib = (b: number) => Math.round(b / 1024 / 1024);
    const holders = () => snap.leases.map((l) => `${l.request.owner}=${mib(leaseBytes(l))}`).join(", ") || "(sổ rỗng)";
    // Luôn nói rõ đã trừ bao nhiêu — người trực phải kiểm chứng được con số, không phải tin.
    const baseNote = baseline > 0 ? ` (đã trừ nền ${mib(baseline)} MiB)` : "";

    if (drift > 0) {
      console.warn(
        `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}, thiết bị ${mib(attributable)}${baseNote}. ` +
          `Có hộ tiêu thụ cấp phát KHÔNG XIN PHÉP (sidecar? tiến trình con? thư viện khác?). ` +
          `Đang giữ: ${holders()}`,
      );
    } else {
      const pending = snap.leases.filter((l) => l.actualBytes === null).map((l) => l.request.owner);
      console.warn(
        `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}, thiết bị ${mib(attributable)}${baseNote}. ` +
          `Sổ đang giữ NHIỀU HƠN thực tế — giấy phép treo hoặc số commit sai, KHÔNG PHẢI cấp phát chui. ` +
          `Ứng viên số một (chưa commit): ${pending.join(", ") || "(không có)"}. Đang giữ: ${holders()}`,
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
        leases: snap.leases.map((l) => ({
          owner: l.request.owner,
          kind: l.request.kind,
          priority: l.request.priority,
          bytes: leaseBytes(l),
          committed: l.actualBytes !== null,
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
