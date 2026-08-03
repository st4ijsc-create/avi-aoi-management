/**
 * ★★★ Pha 2A Task 4 (T5-15) — GIẤY PHÉP BACKEND ĐO HỎNG KHÔNG ĐƯỢC KẸT VĨNH VIỄN.
 *
 * CHUỖI NHÂN QUẢ ĐANG VÁ (mỗi mắt xích đều đúng thiết kế, hợp lại thành "BẮT BUỘC khởi động lại"):
 *   1. `gguf-backend` KHÔNG có đường `release()` ở nhánh THÀNH CÔNG — đúng, backend CUDA sống suốt
 *      đời tiến trình (`aiGgufEngine`: chỉ nhánh `initLlama()` NÉM mới trả giấy phép).
 *   2. Giấy phép đó bị `measureFailed` ⇒ `actualBytes` **vĩnh viễn `null`**.
 *   3. `holdsUncommittedBytes()` = `actualBytes === null`, **CỐ Ý bỏ qua `measureFailed`**
 *      (`vramReconciler.ts`) ⇒ vị từ **vĩnh viễn đúng**.
 *   4. Nó là vị từ của LÁ CHẮN HOÃN chụp nền ⇒ `captureVramBaseline()` **vĩnh viễn bị chặn**.
 *   5. Quá `BASELINE_BLOCKED_ALARM_MS` ⇒ báo động, và **không bao giờ tự lành**.
 *
 * ⚠ CỬA MỚI DO TASK 3 MỞ (N-2): nhánh `measure-target-absent` (bộ đếm CÓ MÀ MÙ) nay cũng dẫn tới
 * `gguf-backend` `measureFailed`. Đánh đổi đó ĐÚNG (ồn + an toàn thay cho im lặng + OOM) nhưng nó
 * làm ca này **thường gặp** chứ không còn hiếm — nên file này canh CẢ SÁU nhánh thoát đo-hỏng.
 *
 * CÁCH VÁ: chốt sổ bằng **ƯỚC LƯỢNG DỰ PHÒNG** khi phép đo hỏng nhưng khối byte **chắc chắn đang
 * tồn tại**. Backend CUDA là ca lý tưởng: đo được **452.595.712 byte (431,6 MiB) GIỐNG HỆT ở 5/5
 * tiến trình** trên HAI thước độc lập (`nvidia-smi` ở Pha 1: +431/+430/+431; bộ đếm PDH ở T5-11).
 *
 * ⚠⚠ VÌ SAO DỰ PHÒNG PHẢI **OPT-IN THEO ĐIỂM GỌI**, KHÔNG PHẢI THEO `kind` (ca 5 và ca 6 canh):
 *   • `cuda-backend:reranker` chạy `getLlama({gpu:false})` khi `RAG_RERANKER_GPU=false` (**mặc
 *     định của `.env` hôm nay**) ⇒ backend đó chiếm **0 byte**. Dự phòng 431,6 MiB theo `kind` sẽ
 *     bơm một khoản MA 431,6 MiB vào sổ ở đúng cấu hình mặc định.
 *   • Ngược lại, một model `gguf-model` **17.000 MiB** đo hỏng thì KHÔNG có số nào chắc chắn để
 *     chốt — dự phòng cho nó là nuốt 17 GB vào nền, tức TÁI SINH T5-1 mà Task 7 vừa vá.
 *   ⇒ Chỉ điểm gọi mới biết "khối byte có chắc chắn tồn tại không, và bằng bao nhiêu".
 *
 * ⚠ RÀNG BUỘC TOÀN CỤC 7 — FIXTURE PHẢI ĐỦ LỚN ĐỂ PHÂN BIỆT: ca về nhầm lẫn kích thước dùng
 * **17.000 MiB**, không dùng số cỡ 600 MiB (một ca dùng reranker 606 MiB đã từng khoá một hành vi
 * hỏng lại thành "đúng").
 *
 * ⚠ QUY ƯỚC MODULE-IDENTITY (như `wiring.processProbe.test.ts`): mã sản xuất `import()` ĐỘNG
 * `./vramBroker`/`./vramEstimator`, nên MỌI lượt import phải nằm TRONG thân test, SAU cùng một
 * `vi.resetModules()` — không thì test soi vào MỘT SỔ KHÁC và xanh/đỏ đều sai lý do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MiB = 1024 * 1024;

/** Đúng con số đo được ở T5-11 (`readProcessVram` trên tiến trình con: 452.595.712 byte). */
const FALLBACK_BYTES = 452_595_712;

/**
 * Một lượt đọc bộ đếm THEO TIẾN TRÌNH. `self: null` = mẫu HỢP LỆ nhưng KHÔNG có khoá của tiến
 * trình này (bộ đếm CÓ MÀ MÙ — I-1/N-2), khác hẳn `self: 0` (có khoá, thật sự 0 byte).
 * `null` = đầu dò trả null; `"THROW"` = đầu dò NÉM.
 */
type Sample = { self: number | null } | null | "THROW";

/** Hàng đợi mẫu: còn >1 phần tử thì SHIFT, còn đúng 1 thì lặp mãi (như wiring.processProbe.test). */
const readings = vi.hoisted(() => [] as Sample[]);

/**
 * Móc chạy NGAY TRƯỚC khi một lượt đọc trả kết quả (cùng quy ước `wiring.processProbe.test.ts`).
 * Ca 9b cần một thứ tự mà lời gọi thường không cho phép: người đang giữ khoá ĐÓNG cửa sổ đúng
 * giữa lúc kẻ bỏ cuộc đọc đầu đo "trước" — đó là cách DUY NHẤT tách phán quyết của KHOÁ khỏi
 * phán quyết của SỔ CỬA SỔ, tức cách duy nhất chạm tới nhánh `measure-window-not-exclusive`.
 */
const beforeRead = vi.hoisted(() => ({ fn: null as null | (() => void) }));

vi.mock("./vramProcessProbe", () => ({
  readProcessVram: async () => {
    if (beforeRead.fn) { const f = beforeRead.fn; beforeRead.fn = null; f(); }
    const r: Sample = readings.length > 1 ? readings.shift()! : (readings[0] ?? null);
    if (r === "THROW") throw new Error("đầu dò theo tiến trình NÉM");
    if (r === null) return null;
    const byPid = new Map<number, number>();
    if (r.self !== null) byPid.set(process.pid, r.self);
    let totalBytes = 0;
    for (const v of byPid.values()) totalBytes += v;
    return { totalBytes, byPid, byLuid: new Map<string, number>(), sampledAtMs: Date.now() };
  },
}));

/** Thước TOÀN THIẾT BỊ — của reconciler/nền. Đ4: hai thước, không trộn. */
const device = vi.hoisted(() => ({ usedBytes: 3_000 * 1024 * 1024 }));
vi.mock("./vramProbe", () => ({
  readDeviceVram: async () => ({ usedBytes: device.usedBytes, totalBytes: 32_607 * 1024 * 1024, source: "native" as const }),
  readDeviceVramUncached: async () => ({ usedBytes: device.usedBytes, totalBytes: 32_607 * 1024 * 1024, source: "native" as const }),
  __clearProbeCache: () => {},
}));

const events = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("./vramEventLog", () => ({
  logVramEvent: (e: Record<string, unknown>) => { events.push(e); },
  flushVramEvents: async () => 0,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
}));

const ORIGINAL_ENV = { ...process.env };
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  vi.resetModules();
  readings.length = 0;
  events.length = 0;
  beforeRead.fn = null;
  device.usedBytes = 3_000 * MiB;
  process.env = { ...ORIGINAL_ENV };
  // Câu cảnh báo là MỘT PHẦN của bản vá (log phải nói rõ "ước lượng"), nhưng in ra mỗi ca thì
  // che mất kết quả thật — bắt lại để kiểm nội dung thay vì để nó chảy ra stdout.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy?.mockRestore();
  process.env = { ...ORIGINAL_ENV };
});

const warnText = () => (warnSpy?.mock.calls ?? []).map((c) => String(c[0])).join("\n");

/** Điểm cấp phát backend CUDA TRÊN GPU — khối byte CHẮC CHẮN tồn tại ⇒ có dự phòng. */
const backendOnGpu = (owner = "cuda-backend") =>
  ({ owner, kind: "gguf-backend", priority: "production", fallbackBytes: FALLBACK_BYTES }) as const;

describe("T5-15 — giấy phép backend đo hỏng KHÔNG còn chặn nền vĩnh viễn", () => {
  /**
   * ★★★ CA TRỌNG TÂM (bước 1 của brief) — dựng lease `gguf-backend` bị `measureFailed`, chạy
   * `captureVramBaseline()` và khẳng định nó BỊ CHẶN; rồi `commitFallback()` và khẳng định nó
   * CHỤP ĐƯỢC. Ca này đi thẳng vào broker/reconciler, không qua wiring — nó canh CƠ CHẾ.
   */
  it("★★★ 1. lease backend measureFailed CHẶN nền; commitFallback() gỡ chặn NGAY ở lượt chụp kế", async () => {
    const { reserve, markMeasureFailed, commitFallback, snapshot } = await import("./vramBroker");
    const { captureVramBaseline, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();

    const { lease } = reserve({ owner: "cuda-backend", kind: "gguf-backend", estimatedBytes: 0, priority: "production" });
    markMeasureFailed(lease!);

    // TRƯỚC bản vá — và đây là toàn bộ T5-15: nền KHÔNG BAO GIỜ chụp được.
    expect(await captureVramBaseline()).toBeNull();
    expect(warnText()).toContain("HOÃN lượt chụp nền");

    // Sau khi chốt sổ bằng ƯỚC LƯỢNG DỰ PHÒNG: byte của backend đã có mặt trong `committedBytes`
    // ⇒ phép trừ `raw − committedBytes` không còn nuốt nó vào nền.
    expect(commitFallback(lease!.id, FALLBACK_BYTES, "measure-target-absent")).toBe(true);
    expect(await captureVramBaseline()).toBe(3_000 * MiB - FALLBACK_BYTES);
    expect(snapshot().leases[0].actualBytes).toBe(FALLBACK_BYTES);
  });

  /**
   * ★★ Nửa còn lại của bước 1: BÁO ĐỘNG "không chụp được nền" phải TẮT, không chỉ là nền có số.
   * `VRAM_BASELINE_BLOCKED_ALARM_MS=0` để không phải giả lập đồng hồ 5 phút.
   */
  it("★★ 2. báo động baseline_blocked đang KÊU vì backend ⇒ commitFallback() làm nó TẮT và tự lành", async () => {
    process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = "0";
    const { reserve, markMeasureFailed, commitFallback } = await import("./vramBroker");
    const rec = await import("./vramReconciler");
    rec.__resetVramBaselineForTests();

    const { lease } = reserve({ owner: "cuda-backend", kind: "gguf-backend", estimatedBytes: 0, priority: "production" });
    markMeasureFailed(lease!);

    // `baselineRequired` chỉ bật qua startVramReconciler(); dừng timer ngay, tự lái từng nhịp.
    rec.startVramReconciler();
    rec.stopVramReconciler();

    const blocked = await rec.__runReconcileTick();
    expect(blocked.baselineBlocked).toBe(true);
    expect(blocked.alarm).toBe(true);
    const evBlocked = events.find((e) => e.event === "baseline_blocked");
    expect((evBlocked!.detail as Record<string, unknown>).blockingOwners).toEqual(["cuda-backend"]);

    commitFallback(lease!.id, FALLBACK_BYTES, "measure-target-absent");

    const healed = await rec.__runReconcileTick();
    expect(healed.baselineBlocked).toBe(false);
    expect(healed.alarm, "nền đã chụp được và sổ khớp thiết bị ⇒ KHÔNG báo động").toBe(false);
    expect(healed.baselineUsedBytes).toBe(3_000 * MiB - FALLBACK_BYTES);
  });

  /**
   * ★★ ĐƯỜNG THẬT (không phải chỉ cơ chế): đi qua `beginVramAllocation()` với đầu dò hỏng.
   * Nhánh này là `before-probe-null` — đầu dò chết NGAY lúc tạo ticket.
   */
  it("★★ 3. beginVramAllocation(gguf-backend) + đầu dò hỏng ⇒ tự chốt sổ bằng dự phòng, nền chụp được", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { captureVramBaseline, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();

    await (await beginVramAllocation(backendOnGpu())).commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "cuda-backend")!;
    expect(l.actualBytes).toBe(FALLBACK_BYTES);
    // ⚠ Cờ đo-hỏng PHẢI Ở LẠI: phép đo THẬT SỰ đã hỏng. Xoá nó là khai một con số ước lượng
    // thành "đã đo được" — đúng chiều lỗi nguy hiểm mà I-1/Task 3 đã dựng lưới để chặn.
    expect(l.measureFailed).toBe(true);
    expect(l.measureSource, "không thước nào đẻ ra con số này").toBe("none");
    // Dấu "đây là dự phòng" + LÝ DO nằm ở ô RIÊNG…
    expect(l.fallbackReason).toBe("before-probe-null");
    // …và XUẤT XỨ ƯỚC LƯỢNG GỐC phải còn NGUYÊN (M-3, review vòng 1): bản đầu ghi đè
    // `"fallback-after-measure-failure"` lên đây, vừa xoá thứ Task 7 đọc để truy "chỗ nào còn
    // dựa hằng số", vừa mutate object mà người gọi `reserve()` đang giữ tham chiếu.
    expect(l.request.estimateSource).toBe("unknown");

    expect(await captureVramBaseline()).toBe(3_000 * MiB - FALLBACK_BYTES);
  });

  /**
   * ★ Sự kiện RIÊNG + câu log nói rõ "ước lượng" (yêu cầu tường minh của brief). Một con số ước
   * lượng nằm ở ô `actualBytes` mà nhật ký không nói gì thì người đọc sau sẽ tin nó là số đo.
   */
  it("★ 4. ghi sự kiện RIÊNG `commit_fallback`, và câu log nói rõ đây là ƯỚC LƯỢNG chứ không phải số đo", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    await (await beginVramAllocation(backendOnGpu())).commitMeasured();

    expect(events.some((e) => e.event === "measure_failed"), "vẫn phải để lại dấu ĐO HỎNG").toBe(true);
    const ev = events.find((e) => e.event === "commit_fallback");
    expect(ev, "phải có sự kiện RIÊNG, không gộp vào `commit`").toBeDefined();
    expect(ev!.actualBytes).toBe(FALLBACK_BYTES);
    expect(ev!.estimateSource).toBe("fallback-after-measure-failure");
    const d = ev!.detail as Record<string, unknown>;
    expect(d.reason).toBe("before-probe-null");
    expect(d.measured).toBe(false);
    expect(String(d.note)).toContain("ƯỚC LƯỢNG");
    // KHÔNG được có sự kiện `commit` — đó là ô dành cho số ĐO ĐƯỢC.
    expect(events.some((e) => e.event === "commit")).toBe(false);
    expect(warnText()).toContain("ƯỚC LƯỢNG DỰ PHÒNG");
  });

  /**
   * ★★★ CA CHỐNG ĐẦU ĐỘC NẤC `learned` — ĐÍCH CỦA ĐỘT BIẾN BẮT BUỘC (bước 5 của brief).
   *
   * `recordActual()` đóng đinh con số vào nấc `learned` **tới hết đời tiến trình** (vramEstimator).
   * Một ước lượng dự phòng chui được vào đó sẽ tự khai là "đã đo thật lượt trước" cho MỌI lượt
   * `reserve()` sau — đúng lý do C-1 (Pha 1.5) đã phải TÁCH `commit()` khỏi `recordActual()`.
   * ⚠ Đây là ca phải ĐỎ khi cho `commitFallback` gọi luôn `estimator.recordActual()`.
   */
  it("★★★ 5. dự phòng KHÔNG được đầu độc nấc `learned` — lượt reserve sau vẫn là 'unknown', không phải 'learned'", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const { estimateBytesFor } = await import("./vramEstimator");
    await (await beginVramAllocation(backendOnGpu())).commitMeasured();

    const est = await estimateBytesFor("cuda-backend", {});
    expect(est.source, "ước lượng dự phòng KHÔNG phải số đo ⇒ không được lên nấc learned").toBe("unknown");
    expect(est.bytes).not.toBe(FALLBACK_BYTES);
  });

  /**
   * ★★ RÀNG BUỘC TOÀN CỤC 7 — FIXTURE 17.000 MiB. Một model 17 GB đo hỏng KHÔNG có số nào chắc
   * chắn để chốt sổ; nếu bản vá này nới cho nó thì nền nuốt trọn 17 GB và T5-1 sống lại nguyên vẹn
   * (drift −17 GB, alarm mọi nhịp, chỉ restart mới gỡ). Dự phòng phải là OPT-IN, không theo `kind`.
   */
  it("★★ 6. model 17.000 MiB đo hỏng mà KHÔNG khai dự phòng ⇒ KHÔNG tự chốt sổ, nền vẫn (đúng) bị chặn", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { captureVramBaseline, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();

    await (await beginVramAllocation({
      owner: "gguf:Qwen3-30B", kind: "gguf-model", priority: "interactive", fileBytes: 17_000 * MiB,
    })).commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "gguf:Qwen3-30B")!;
    expect(l.actualBytes, "KHÔNG có dự phòng cho một khối byte không biết chắc kích thước").toBeNull();
    expect(l.measureFailed).toBe(true);
    expect(await captureVramBaseline()).toBeNull();
    expect(events.some((e) => e.event === "commit_fallback")).toBe(false);
  });

  /**
   * ★ Backend CHẠY CPU (`RAG_RERANKER_GPU=false` — mặc định `.env` hôm nay) chiếm ĐÚNG 0 byte.
   * `0` là một số CHẮC CHẮN, và nó cũng gỡ chặn nền — `actualBytes = 0` khác hẳn `null`.
   * (`??` chứ không `||` trong `leaseBytes()` là thứ làm điều này chạy đúng.)
   */
  it("★ 7. dự phòng = 0 (backend chạy CPU) vẫn gỡ chặn nền và KHÔNG bơm byte MA vào sổ", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { captureVramBaseline, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();

    await (await beginVramAllocation({
      owner: "cuda-backend:reranker", kind: "gguf-backend", priority: "background", fallbackBytes: 0,
    })).commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "cuda-backend:reranker")!;
    expect(l.actualBytes).toBe(0);
    expect(snapshot().totalReservedBytes).toBe(0);
    expect(await captureVramBaseline()).toBe(3_000 * MiB);
  });

  /**
   * ★★ SÁU NHÁNH THOÁT ĐO-HỎNG, KHÔNG PHẢI MỘT. Bản vá gốc của brief chỉ nêu hai (`measurable ===
   * false` và đầu dò `null`); Task 3 vừa mở nhánh THỨ SÁU (`measure-target-absent`). Bỏ sót một
   * nhánh = T5-15 sống lại qua đúng cửa đó, và không ca nào đỏ. Ca này đi qua BỐN nhánh dựng được
   * bằng đầu dò (hai nhánh còn lại — `overlapping-measure-window` ở ca 9,
   * `measure-window-not-exclusive` ở ca 9b).
   */
  it.each([
    ["before-probe-null", [null] as Sample[]],
    ["after-probe-null", [{ self: 1_000 * MiB }, null] as Sample[]],
    ["measure-target-absent", [{ self: null }, { self: null }] as Sample[]],
    ["delta ÂM", [{ self: 1_000 * MiB }, { self: 500 * MiB }] as Sample[]],
  ])("★★ 8. nhánh đo-hỏng '%s' cũng phải chốt sổ bằng dự phòng (không nhánh nào bị bỏ sót)", async (_label, samples) => {
    readings.push(...samples);
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    await (await beginVramAllocation(backendOnGpu())).commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "cuda-backend")!;
    expect(l.actualBytes).toBe(FALLBACK_BYTES);
    expect(l.measureFailed).toBe(true);
  });

  /** ★★ Nhánh thứ năm/sáu: hai cửa sổ CÙNG PHẠM VI chồng nhau ⇒ `overlapping-measure-window`. */
  it("★★ 9. cửa sổ đo CHỒNG LẤN (overlappedBy) cũng chốt sổ bằng dự phòng", async () => {
    // Khoá nối tiếp KHÔNG chờ ⇒ lượt thứ hai chạy xen, hai cửa sổ `self` chồng nhau.
    process.env.VRAM_MEASURE_WAIT_MS = "0";
    readings.push({ self: 1_000 * MiB });
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { __resetMeasureLockForTests } = await import("./vramMeasureLock");
    __resetMeasureLockForTests();

    const backend = await beginVramAllocation(backendOnGpu());
    const other = await beginVramAllocation({
      owner: "gguf:Qwen3-30B", kind: "gguf-model", priority: "interactive", fileBytes: 17_000 * MiB,
    });
    await backend.commitMeasured();
    await other.commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "cuda-backend")!;
    expect(l.measureFailed).toBe(true);
    expect(l.actualBytes).toBe(FALLBACK_BYTES);
    // …còn model 17 GB thì KHÔNG có dự phòng ⇒ vẫn giữ ước lượng, vẫn (đúng) chặn nền.
    expect(snapshot().leases.find((x) => x.request.owner === "gguf:Qwen3-30B")!.actualBytes).toBeNull();
    // Ca này đi qua nhánh `overlapping-measure-window`; nhánh THỨ SÁU ở ca 9b ngay dưới.
    const ev = events.find((e) => e.event === "measure_failed" && e.owner === "cuda-backend");
    expect((ev!.detail as Record<string, unknown>).reason).toBe("overlapping-measure-window");
  });

  /**
   * ★★★ I-1 (review vòng 1) — NHÁNH THỨ SÁU PHẢI TỰ ĐỨNG ĐƯỢC.
   *
   * Trước ca này, xoá dòng `chotSoBangDuPhong("measure-window-not-exclusive")` ở `vramWiring.ts`
   * thì **cả 209 ca vẫn xanh** — tức nhánh đó không được bảo vệ bởi bất cứ thứ gì (vi phạm ràng
   * buộc toàn cục 5), và báo cáo lẫn docstring đều đang nói sai khi ghi "ca canh: 9". Ca 9 chỉ đi
   * qua `overlapping-measure-window`, vì hai cửa sổ chồng nhau thì nhánh CỤ THỂ HƠN thắng trước.
   *
   * Cách cô lập phán quyết của KHOÁ (sao đúng khuôn `wiring.processProbe.test.ts` ca 8): A giữ
   * khoá + cửa sổ; backend hết ngân sách chờ (`VRAM_MEASURE_WAIT_MS=0`) nên chạy NGOÀI khoá
   * (`measurable=false` vĩnh viễn cho cửa sổ đó); rồi A ĐÓNG cửa sổ đúng giữa lượt đọc đầu đo
   * "trước" của backend ⇒ khi backend mở cửa sổ, sổ `openMeasureWindows` KHÔNG thấy ai. Chỉ còn
   * phán quyết của khoá lên tiếng — và nó phải dẫn tới dự phòng, nếu không T5-15 sống lại qua
   * đúng cửa này (backend không có đường release nào để tự lành).
   */
  it("★★★ 9b. cửa sổ đo KHÔNG ĐỘC QUYỀN (hết ngân sách chờ) — nhánh THỨ SÁU cũng chốt sổ bằng dự phòng", async () => {
    readings.push({ self: 1_000 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { captureVramBaseline, __resetVramBaselineForTests } = await import("./vramReconciler");
    const { __resetMeasureLockForTests } = await import("./vramMeasureLock");
    __resetMeasureLockForTests();
    __resetVramBaselineForTests();

    // A giữ khoá VÀ cửa sổ (ngân sách mặc định) — 17.000 MiB để không lẫn với bất cứ số nào khác.
    const tA = await beginVramAllocation({
      owner: "gguf:holder", kind: "gguf-model", priority: "interactive", fileBytes: 17_000 * MiB,
    });

    process.env.VRAM_MEASURE_WAIT_MS = "0"; // backend KHÔNG chờ ⇒ bỏ cuộc, chạy ngoài khoá
    readings.length = 0;
    readings.push({ self: 2_000 * MiB });   // backend.before
    readings.push({ self: 2_431 * MiB });   // backend.after — delta DƯƠNG, hợp lệ về mọi mặt khác
    // ĐÓNG cửa sổ của A ngay giữa lượt đọc đầu đo "trước" ⇒ hai cửa sổ KHÔNG chồng nhau trong sổ.
    beforeRead.fn = () => { tA.release(); };

    const backend = await beginVramAllocation(backendOnGpu());
    await backend.commitMeasured();

    const ev = events.find((e) => e.event === "measure_failed" && e.owner === "cuda-backend");
    // ★ Phải là nhánh THỨ SÁU, không phải nhánh chồng lấn — nếu lẫn, ca này chỉ là bản sao ca 9.
    expect((ev!.detail as Record<string, unknown>).reason).toBe("measure-window-not-exclusive");

    const l = snapshot().leases.find((x) => x.request.owner === "cuda-backend")!;
    expect(l.actualBytes, "★ TRỌNG TÂM I-1: nhánh này cũng phải chốt sổ").toBe(FALLBACK_BYTES);
    expect(l.measureFailed).toBe(true);
    expect(l.fallbackReason).toBe("measure-window-not-exclusive");
    // …và vì thế nó rời khỏi `holdsUncommittedBytes()` ⇒ nền chụp được (đây mới là điều T5-15 cần).
    expect(await captureVramBaseline()).toBe(3_000 * MiB - FALLBACK_BYTES);
  });

  /**
   * ★★ VỊ TỪ `isLoadingLease()` (= `actualBytes === null && !measureFailed`) — HAI hộ tiêu thụ:
   * `pendingBytes` và danh sách "ứng viên số một" trong câu cảnh báo lệch ÂM. Lease backend đã
   * measureFailed nên nó vốn ĐÃ nằm ngoài cả hai; bản vá KHÔNG được kéo nó vào (nới băng dung sai
   * theo một khoản đã chốt sổ là nới HAI LẦN cho cùng một khối byte).
   */
  it("★★ 10. pendingBytes KHÔNG đổi vì dự phòng — chỉ lease ĐANG NẠP THẬT mới nới băng dung sai", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const { reserve } = await import("./vramBroker");
    const rec = await import("./vramReconciler");
    rec.__resetVramBaselineForTests();

    await (await beginVramAllocation(backendOnGpu())).commitMeasured();
    // Một lease ĐANG NẠP THẬT (chưa commit, chưa hỏng) — 17.000 MiB để phân biệt được.
    reserve({ owner: "gguf:dang-nap", kind: "gguf-model", estimatedBytes: 17_000 * MiB, priority: "interactive" });

    const r = await rec.reconcileOnce();
    expect(r.pendingBytes, "đúng bằng lease đang nạp thật, KHÔNG cộng thêm khoản dự phòng").toBe(17_000 * MiB);
  });

  /**
   * ★★ VỊ TỪ `holdsUncommittedBytes()` — hộ tiêu thụ THỨ HAI (`blockingOwners` của báo động), phải
   * luôn cùng MỘT TẬP với lá chắn HOÃN. Lệch tập = người trực đi tìm đúng cái tên KHÔNG có trong đó.
   */
  it("★★ 11. blockingOwners sau dự phòng chỉ còn lease THẬT SỰ đang chặn — backend rơi khỏi danh sách", async () => {
    process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = "0";
    const { beginVramAllocation } = await import("./vramWiring");
    const { reserve } = await import("./vramBroker");
    const rec = await import("./vramReconciler");
    rec.__resetVramBaselineForTests();

    await (await beginVramAllocation(backendOnGpu())).commitMeasured();
    reserve({ owner: "gguf:dang-nap", kind: "gguf-model", estimatedBytes: 17_000 * MiB, priority: "interactive" });

    rec.startVramReconciler();
    rec.stopVramReconciler();
    const r = await rec.__runReconcileTick();

    expect(r.baselineBlocked).toBe(true);
    const ev = events.filter((e) => e.event === "baseline_blocked").pop()!;
    expect((ev.detail as Record<string, unknown>).blockingOwners).toEqual(["gguf:dang-nap"]);
  });

  /**
   * ★★ I-4 — `splitLedgerByMeasureSource()` là PHÂN HOẠCH theo THƯỚC. Một con số dự phòng KHÔNG
   * đến từ thước nào ⇒ phải nằm ở nhóm "ước lượng". Rơi vào `deviceDeltaBytes` là khai một ước
   * lượng thành "đo bằng nvidia-smi" — đúng kiểu trộn thước mà Đ4 sinh ra để chặn.
   */
  it("★★ 12. dự phòng nằm ở nhóm ƯỚC LƯỢNG của phép tách theo thước, KHÔNG phải deviceDelta", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { splitLedgerByMeasureSource } = await import("./vramReconciler");
    await (await beginVramAllocation(backendOnGpu())).commitMeasured();

    const split = splitLedgerByMeasureSource(snapshot().leases);
    expect(split.estimatedBytes).toBe(FALLBACK_BYTES);
    expect(split.deviceDeltaBytes).toBe(0);
    expect(split.processDeltaBytes).toBe(0);
    expect(split.totalBytes).toBe(snapshot().totalReservedBytes);
  });

  /**
   * ★★ HÀNG RÀO CỦA `commitFallback()`: nó chỉ được chạy SAU một phép đo ĐÃ HỎNG. Không có hàng
   * rào này thì nó là cửa sau để ghi một con số bịa vào ô `actualBytes` của một lease đang đo tốt.
   */
  it("★★ 13. commitFallback TỪ CHỐI khi lease chưa hỏng, hoặc khi đã có số ĐO THẬT", async () => {
    const { reserve, commit, markMeasureFailed, commitFallback, snapshot } = await import("./vramBroker");

    // (a) đang nạp bình thường (chưa hỏng) — số thật vẫn đang trên đường tới.
    const a = reserve({ owner: "A", kind: "gguf-backend", estimatedBytes: 0, priority: "production" }).lease!;
    expect(commitFallback(a.id, FALLBACK_BYTES, "test")).toBe(false);
    expect(snapshot().leases.find((l) => l.request.owner === "A")!.actualBytes).toBeNull();

    // (b) đã có số ĐO THẬT — ước lượng KHÔNG được đè lên số đo.
    const b = reserve({ owner: "B", kind: "gguf-backend", estimatedBytes: 0, priority: "production" }).lease!;
    commit(b, 123 * MiB, "process-delta");
    expect(commitFallback(b.id, FALLBACK_BYTES, "test")).toBe(false);
    expect(snapshot().leases.find((l) => l.request.owner === "B")!.actualBytes).toBe(123 * MiB);

    // (c) hỏng thật ⇒ chạy, và chỉ chạy MỘT lần (lượt hai không còn gì để chốt).
    const c = reserve({ owner: "C", kind: "gguf-backend", estimatedBytes: 0, priority: "production" }).lease!;
    markMeasureFailed(c);
    expect(commitFallback(c.id, FALLBACK_BYTES, "test")).toBe(true);
    expect(commitFallback(c.id, 9_999, "test")).toBe(false);
    expect(snapshot().leases.find((l) => l.request.owner === "C")!.actualBytes).toBe(FALLBACK_BYTES);
  });

  /** ĐỐI CHỨNG — phép đo THÀNH CÔNG trên đúng lease backend đó vẫn commit số THẬT, không đụng dự phòng. */
  it("14. ĐỐI CHỨNG: đo được thì commit số THẬT (dự phòng không chen vào đường đang chạy tốt)", async () => {
    readings.push({ self: null });            // trước getLlama(): tiến trình chưa có khoá bộ đếm
    readings.push({ self: 430 * MiB });       // sau: backend đã hình thành
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    await (await beginVramAllocation(backendOnGpu())).commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "cuda-backend")!;
    expect(l.actualBytes).toBe(430 * MiB);
    expect(l.measureFailed).toBeFalsy();
    expect(l.measureSource).toBe("process-delta");
    expect(events.some((e) => e.event === "commit_fallback")).toBe(false);
  });

  /**
   * ★★ I-2 (review vòng 1) — SỰ KIỆN `release` KHÔNG ĐƯỢC TỰ MÂU THUẪN.
   *
   * Nó ghi `actualBytes` lấy TỪ GIẤY PHÉP (có thể là số dự phòng) nhưng trước bản vá lại đặt cạnh
   * `estimateSource: est.source` — biến cục bộ chốt từ lượt `reserve()`, mù với mọi thứ xảy ra sau
   * đó. Dòng trong DB nói hai chuyện, và `detail` không có trường nào phân biệt ⇒ người đọc nhật
   * ký (và Pha 2B) không biết đó là số ĐO hay số ƯỚC LƯỢNG. Ca này khoá cả ba trường.
   */
  it("★★ 15. sự kiện `release` nói rõ actualBytes là ƯỚC LƯỢNG (measured=false + lý do), không tự mâu thuẫn", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const ticket = await beginVramAllocation(backendOnGpu());
    await ticket.commitMeasured();   // đầu dò rỗng ⇒ before-probe-null ⇒ chốt bằng dự phòng
    ticket.release();

    const ev = events.find((e) => e.event === "release")!;
    expect(ev.actualBytes).toBe(FALLBACK_BYTES);
    const d = ev.detail as Record<string, unknown>;
    expect(d.measured, "số này KHÔNG phải số đo — dòng nhật ký phải tự nói ra").toBe(false);
    expect(d.fallbackReason).toBe("before-probe-null");
    // Đọc TỪ GIẤY PHÉP, và giấy phép vẫn giữ xuất xứ ước lượng GỐC (M-3).
    expect(ev.estimateSource).toBe("unknown");
  });

  /** ĐỐI CHỨNG cho ca 15 — lượt nhả BÌNH THƯỜNG (đo được) phải khai `measured: true`. */
  it("16. ĐỐI CHỨNG: release của một lượt ĐO ĐƯỢC khai measured=true, fallbackReason=null", async () => {
    readings.push({ self: 1_000 * MiB });
    readings.push({ self: 1_430 * MiB });
    const { beginVramAllocation } = await import("./vramWiring");
    const ticket = await beginVramAllocation(backendOnGpu());
    await ticket.commitMeasured();
    ticket.release();

    const ev = events.find((e) => e.event === "release")!;
    expect(ev.actualBytes).toBe(430 * MiB);
    const d = ev.detail as Record<string, unknown>;
    expect(d.measured).toBe(true);
    expect(d.fallbackReason).toBeNull();
  });
});
