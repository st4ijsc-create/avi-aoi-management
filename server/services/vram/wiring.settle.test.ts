/**
 * ★★★ PHA 2A TASK 6 — BIÊN LẮNG CỦA BỘ ĐẾM PHẢI LÀ **CỦA TA**, KHÔNG PHẢI TÁC DỤNG PHỤ CỦA PDH.
 *
 * **Vì sao file này tồn tại.** Cửa sổ đo `before → after` chỉ đúng khi bộ đếm đã phản ánh ĐỦ lượt
 * cấp phát tại thời điểm đầu đo SAU. Cho tới Task 6, điều đó đúng **nhờ một thứ không ai thiết
 * kế**: `-SampleInterval` mặc định của `Get-Counter` chèn ~1,2 s vào MỖI lượt đọc (đo được: PDH
 * lấy mẫu ở t₀ + 1.299/1.304/1.352 ms). Không ghi ở đâu, **không ca test nào canh**.
 *
 * ⚠⚠ CÁI BẪY MÀ FILE NÀY THÁO: mục tồn đọng "bỏ `Get-CimInstance` để 3,1 s → ~1 s" được ước trên
 * số SAI (thực tế chỉ rút ~13 %). Người cầm mục đó sẽ nhìn sang **1,2 giây còn lại** và hạ
 * `-SampleInterval` **trong một dòng**. Trước file này, lượt đó đi qua với **224/224 xanh**.
 *
 * Hậu quả nếu biên lắng biến mất: bộ đếm trễ ⇒ cửa sổ đo **BỊ DỊCH** (không co) ⇒ trễ hoàn toàn ⇒
 * hai đầu đo GIỐNG HỆT nhau ⇒ `actual === 0` với `seen === true` ⇒ **`commit(0)` +
 * `recordActual(0)`** ⇒ nấc `learned = 0` sống tới hết đời tiến trình ⇒ ở Pha 2B là dư địa VÔ HẠN
 * ⇒ broker không bao giờ từ chối ⇒ OOM. Ca 7 dưới đây **diễn lại nguyên vẹn** chuỗi đó.
 *
 * ─── SỐ ĐO CHỐNG LƯNG (Task 6, 2026-08-04 — RTX 5090, driver hiện hành) ──────────────────────
 * Thước: PDH P/Invoke **giữ handle ấm** (`pdh.dll` — CHÍNH thư viện `Get-Counter` dùng), chi phí
 * trung vị **0,018 ms/mẫu**, nhịp lấy mẫu thực **~0,04–0,1 ms**. Mốc "cấp phát xong" = lúc
 * `llama.loadModel()` trả về, tức ĐÚNG điểm `commitMeasured()` được gọi trong sản xuất.
 *
 *   • 8/8 lượt (0,6B · 4B · 30B): bộ đếm đã đạt **100,0000 %** giá trị cuối **TRƯỚC** khi lượt cấp
 *     phát trả về — nó ĐI TRƯỚC 480…7.140 ms, chưa lượt nào đi sau. ⇒ **yêu cầu đo được = 0 ms.**
 *   • Độ trễ của bộ đếm với một sự kiện có thời điểm biết TỪ BÊN NGOÀI (giết tiến trình đang giữ
 *     17,5 GB): bắt đầu tụt sau **7,1–9,5 ms**, về 0 sau **≤121 ms**. ⇒ **quan sát lớn nhất về độ
 *     trễ của chính bộ đếm: 121 ms.**
 *
 * Chi tiết + số thô từng lượt: `.superpowers/sdd/2026-08-03-vram-pha2a-do-dung-va-liet-ke/task-6-report.md`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ★ SÀN CỦA HẰNG SỐ — hạ `VRAM_MEASURE_SETTLE_MS` xuống dưới đây là làm CA 1 ĐỎ.
 *
 * 250 ms = **≥ 2×** quan sát lớn nhất về độ trễ của chính bộ đếm (121 ms, chiều nhả 17,5 GB), và
 * lớn hơn vô điều kiện yêu cầu đo được ở chiều cấp phát (0 ms).
 *
 * ⚠⚠ ĐỌC TRƯỚC KHI SỬA SỐ NÀY: nó KHÔNG phải tham số hiệu năng. Hạ nó thì **phải đo lại** theo
 * đúng giao thức ở đầu file (nạp model thật + lấy mẫu liên tiếp chu kỳ ngắn bằng PDH handle ấm),
 * rồi sửa **cả** hằng số **lẫn** sàn này **lẫn** khối số đo ở `vramProcessProbe.ts` trong CÙNG một
 * lượt vá. Sửa mình hằng số mà để sàn ở lại là đúng cái mà file này sinh ra để chặn.
 */
const SAN_DO_DUOC_MS = 250;

/** Quan sát lớn nhất về độ trễ của CHÍNH bộ đếm (chiều nhả, 17,5 GB về 0). Xem §1 báo cáo Task 6. */
const DO_TRE_BO_DEM_QUAN_SAT_LON_NHAT_MS = 121;

/**
 * Nhật ký THỨ TỰ các lời gọi trong đường đo. Đây là lưới THẬT của file này: một hằng số đúng mà
 * không được `await` đúng chỗ thì vô dụng, và "đúng chỗ" ở đây có nghĩa rất hẹp — SAU đầu đo
 * TRƯỚC, TRƯỚC đầu đo SAU, và BÊN TRONG cửa sổ đo.
 */
const order = vi.hoisted(() => [] as string[]);
/** Số đo cho từng lượt đọc đầu dò. `null` ⇒ đầu dò trả null. */
const readings = vi.hoisted(() => [] as Array<number | null>);
/** Khi đặt, `awaitCounterSettle` giả sẽ TREO cho tới khi ca test tự giải — dùng cho ca 5. */
const settleGate = vi.hoisted(() => ({ promise: null as null | Promise<void>, release: null as null | (() => void) }));

vi.mock("./vramProcessProbe", () => ({
  readProcessVram: async () => {
    order.push(`probe#${order.filter((o) => o.startsWith("probe")).length + 1}`);
    const r = readings.length > 1 ? readings.shift()! : (readings[0] ?? null);
    if (r === null) return null;
    return {
      totalBytes: r,
      byPid: new Map<number, number>([[process.pid, r]]),
      byLuid: new Map<string, number>(),
      sampledAtMs: Date.now(),
    };
  },
  awaitCounterSettle: async () => {
    order.push("settle");
    if (settleGate.promise) await settleGate.promise;
  },
}));

vi.mock("./vramProbe", () => ({
  readDeviceVram: async () => null,
  readDeviceVramUncached: async () => null,
  __clearProbeCache: () => {},
}));

const events = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("./vramEventLog", () => ({
  logVramEvent: (e: Record<string, unknown>) => { events.push(e); },
  flushVramEvents: async () => 0,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
}));

const MiB = 1024 * 1024;
const OWNER = "gguf-model:/models/qwen-0.6b.gguf";

beforeEach(() => {
  vi.resetModules();
  order.length = 0;
  readings.length = 0;
  events.length = 0;
  settleGate.promise = null;
  settleGate.release = null;
});

async function napXong(before: number | null, after: number | null): Promise<void> {
  readings.push(before, after);
  const { beginVramAllocation } = await import("./vramWiring");
  const ticket = await beginVramAllocation({
    owner: OWNER, kind: "gguf-model", priority: "background", fileBytes: 1200 * MiB,
  });
  await ticket.commitMeasured();
}

describe("Task 6 — hằng số biên lắng: CÓ TÊN, CÓ SỐ ĐO CHỐNG LƯNG", () => {
  it("1. VRAM_MEASURE_SETTLE_MS KHÔNG được hạ xuống dưới sàn đo được", async () => {
    const probe = await vi.importActual<typeof import("./vramProcessProbe")>("./vramProcessProbe");
    expect(probe.VRAM_MEASURE_SETTLE_MS).toBeGreaterThanOrEqual(SAN_DO_DUOC_MS);
    // …và sàn phải giữ được ý nghĩa của nó: ≥ 2× độ trễ lớn nhất từng quan sát của CHÍNH bộ đếm.
    // Nếu một ngày ai đó hạ `SAN_DO_DUOC_MS` mà quên đo lại, dòng này đỏ trước.
    expect(SAN_DO_DUOC_MS).toBeGreaterThanOrEqual(2 * DO_TRE_BO_DEM_QUAN_SAT_LON_NHAT_MS);
  });

  it("2. hằng số là TỔNG của phần ĐO ĐƯỢC và phần PHÁN ĐOÁN — không phải một con số rơi từ trời", async () => {
    const probe = await vi.importActual<typeof import("./vramProcessProbe")>("./vramProcessProbe");
    // Tách hai phần là điều KIỆN để người sau biết phần nào có thước chống lưng: phần đo được
    // (yêu cầu thật của bộ đếm) và phần biên an toàn chủ động cho các đường cấp phát CHƯA ĐO.
    expect(probe.VRAM_MEASURE_SETTLE_MS).toBe(
      probe.VRAM_COUNTER_SETTLE_MEASURED_MS + probe.VRAM_MEASURE_SETTLE_SAFETY_MS,
    );
    expect(probe.VRAM_COUNTER_SETTLE_MEASURED_MS).toBeGreaterThanOrEqual(0);
  });

  it("3. awaitCounterSettle() THẬT chờ đủ (không phải một Promise.resolve đội lốt)", async () => {
    const probe = await vi.importActual<typeof import("./vramProcessProbe")>("./vramProcessProbe");
    const t0 = Date.now();
    await probe.awaitCounterSettle();
    // Đồng hồ hệ điều hành có hạt ~15,6 ms; trừ hao một hạt để ca không bất định.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(probe.VRAM_MEASURE_SETTLE_MS - 16);
  });

  it("3b. tham số 0 / âm / NaN ⇒ trả về NGAY, không treo đường cấp phát", async () => {
    const probe = await vi.importActual<typeof import("./vramProcessProbe")>("./vramProcessProbe");
    const t0 = Date.now();
    await Promise.all([probe.awaitCounterSettle(0), probe.awaitCounterSettle(-1), probe.awaitCounterSettle(NaN)]);
    expect(Date.now() - t0).toBeLessThan(50);
  });
});

describe("Task 6 — biên lắng phải ĐƯỢC ÁP, đúng chỗ (đây là lưới cho cái bẫy)", () => {
  it("4. commitMeasured(): thứ tự BẮT BUỘC là đầu đo TRƯỚC → biên lắng → đầu đo SAU", async () => {
    await napXong(452_595_712, 452_595_712 + 1_193_291_776);
    // ⚠ ĐỘT BIẾN mà ca này bắt: xoá dòng `await awaitMeasureSettle()` trong `vramWiring.ts`
    // (⇒ ["probe#1","probe#2"]), hoặc chuyển nó lên TRƯỚC đầu đo "trước" (⇒ ["settle","probe#1",…]),
    // hoặc xuống SAU đầu đo "sau" (⇒ [...,"probe#2","settle"]). Cả ba đều làm dòng này đỏ.
    expect(order).toEqual(["probe#1", "settle", "probe#2"]);
  });

  it("5. biên lắng được AWAIT thật: đầu đo SAU KHÔNG chạy trước khi nó xong", async () => {
    let release!: () => void;
    settleGate.promise = new Promise<void>((r) => { release = r; });
    readings.push(452_595_712, 452_595_712 + 1_193_291_776);

    const { beginVramAllocation } = await import("./vramWiring");
    const ticket = await beginVramAllocation({
      owner: OWNER, kind: "gguf-model", priority: "background", fileBytes: 1200 * MiB,
    });
    const dangCommit = ticket.commitMeasured();

    // Cho vòng lặp sự kiện quay đủ để đầu đo SAU chạy được NẾU nó không bị chặn.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
    // ⚠ ĐỘT BIẾN mà ca này bắt (ca 4 KHÔNG bắt được): đổi `await awaitMeasureSettle()` thành
    // `void awaitMeasureSettle()` — thứ tự gọi vẫn ĐÚNG, nhưng chờ không còn tác dụng gì.
    expect(order, "đầu đo SAU đã chạy TRONG LÚC biên lắng chưa xong").toEqual(["probe#1", "settle"]);

    release();
    await dangCommit;
    expect(order).toEqual(["probe#1", "settle", "probe#2"]);
  });

  it("6. biên lắng nằm BÊN TRONG cửa sổ đo — không ai chen vào cấp phát được trong lúc chờ", async () => {
    let release!: () => void;
    settleGate.promise = new Promise<void>((r) => { release = r; });
    readings.push(452_595_712, 452_595_712 + 1_193_291_776);

    const { beginVramAllocation, __openMeasureWindowCount } = await import("./vramWiring");
    const ticket = await beginVramAllocation({
      owner: OWNER, kind: "gguf-model", priority: "background", fileBytes: 1200 * MiB,
    });
    const dangCommit = ticket.commitMeasured();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // ⚠ ĐỘT BIẾN mà ca này bắt: chuyển `closeWindow()` lên TRƯỚC biên lắng "cho nhả khoá sớm".
    // Chờ NGOÀI cửa sổ mở đúng bằng ngần ấy thời gian cho một lượt cấp phát khác chen vào giữa
    // hai đầu đo — tức tự tay tái tạo lớp lỗi cộng-trùng mà khoá nối tiếp sinh ra để diệt.
    expect(__openMeasureWindowCount(), "cửa sổ đo đã đóng TRONG LÚC còn đang chờ lắng").toBe(1);

    release();
    await dangCommit;
    expect(__openMeasureWindowCount()).toBe(0);
  });

  it("6b. đầu đo TRƯỚC trả null ⇒ KHÔNG trả tiền biên lắng (nhánh không có gì để chờ)", async () => {
    await napXong(null, null);
    // Nhánh `before-probe-null` thoát trước đầu đo SAU; chờ ở đó là 250 ms thuần lãng phí trên
    // MỌI lượt cấp phát của một máy không có bộ đếm.
    expect(order).toEqual(["probe#1"]);
    expect(events.some((e) => e.event === "measure_failed")).toBe(true);
  });
});

describe("Task 6 — HẬU QUẢ nếu biên lắng biến mất (vì sao ba ca trên đáng giá)", () => {
  /**
   * ★★★ CA ĐẶC TẢ **HIỆN TRẠNG**, KHÔNG PHẢI CA ĐẶC TẢ **HÀNH VI MONG MUỐN**.
   *
   * Nó DIỄN LẠI thế giới mà bộ đếm trễ hoàn toàn tạo ra, để cái giá của việc gỡ biên lắng nằm
   * trong bộ test chứ không nằm trong một đoạn văn. Bộ đếm trễ hoàn toàn ⇒ đầu đo SAU trả **y
   * hệt** đầu đo TRƯỚC, và khoá của ta VẪN CÓ (`seen` đo SỰ TỒN TẠI của khoá, KHÔNG đo ĐỘ TƯƠI)
   * ⇒ không nhánh nào trong SÁU nhánh đo-hỏng nổ: không âm, không chồng lấn, không mất độc
   * chiếm, không mù. Hệ **commit 0 và khai là đo được**.
   *
   * ⚠⚠ **NGƯỜI VÁ I-5 SẼ THẤY CA NÀY ĐỎ. ĐỌC ĐOẠN NÀY TRƯỚC KHI ĐỘNG VÀO BẤT CỨ THỨ GÌ.**
   *
   *   > **Ca này CHẾT vào đúng ngày I-5 được vá. Lúc đó hãy XOÁ nó — TUYỆT ĐỐI không sửa mã sản
   *   > xuất cho vừa nó, và cũng không "sửa kỳ vọng" để nó xanh trở lại.**
   *
   * Vì sao phải nói thẳng ra: một ca khẳng định `commit(0)` + `learned = 0` là **hành vi nguy
   * hiểm mà ta đang chịu đựng**, không phải hành vi ta muốn giữ. Khi có hàng rào độ tươi thật,
   * lượt "hai đầu đo giống hệt vì bộ đếm cũ" PHẢI thành một nhánh đo-hỏng — tức ca này PHẢI đỏ.
   * Một ca đặc tả hiện trạng mà không tự khai là đặc tả hiện trạng chính là cái bẫy cùng họ với
   * cái Task 6 vừa tháo: người sau đọc ca đỏ, tưởng mình vừa làm hỏng thứ gì, rồi lùi bản vá.
   *
   * Kiểm tra nhanh trước khi xoá: `readScopeBytes()` (`vramWiring.ts`) đã có đường từ chối một
   * MẪU/GIÁ TRỊ quá cũ chưa? Nếu rồi ⇒ xoá ca này. Nếu chưa ⇒ ca đỏ là dấu hiệu bản vá chưa
   * xong, không phải dấu hiệu ca sai.
   */
  it("7. bộ đếm trễ hoàn toàn ⇒ commit(0) + nấc learned = 0 — KHÔNG lưới nào bắt được", async () => {
    const { __resetEstimatorForTests, estimateBytesFor } = await import("./vramEstimator");
    __resetEstimatorForTests();

    // Hai đầu đo GIỐNG HỆT nhau, khoá của ta CÓ ở cả hai lượt.
    await napXong(452_595_712, 452_595_712);

    const { snapshot } = await import("./vramBroker");
    const lease = snapshot().leases.find((l) => l.request.owner === OWNER);
    expect(lease).toBeDefined();
    // Sổ khai là ĐO ĐƯỢC — không cờ đo hỏng, nguồn là `process-delta`.
    expect(lease!.actualBytes).toBe(0);
    expect(lease!.measureFailed).toBeFalsy();
    expect(events.some((e) => e.event === "measure_failed")).toBe(false);
    const commitEv = events.find((e) => e.event === "commit");
    expect((commitEv!.detail as Record<string, unknown>).measureSource).toBe("process-delta");

    // …và nấc `learned` bị đóng đinh ở 0 cho MỌI lượt sau, tới hết đời tiến trình. Ở Pha 2B, một
    // ước lượng 0 nghĩa là dư địa VÔ HẠN ⇒ broker không bao giờ từ chối ⇒ OOM.
    const est = await estimateBytesFor(OWNER, { fileBytes: 1200 * MiB });
    expect(est).toEqual({ bytes: 0, source: "learned" });
  });
});
