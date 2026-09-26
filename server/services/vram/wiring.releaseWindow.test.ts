/**
 * ★★★ C-1 (review TOÀN NHÁNH Pha 2A) — LƯỢT **NHẢ** XEN GIỮA HAI ĐẦU ĐO.
 *
 * LỖ ĐANG CANH, và nó ở đúng CHIỀU NGUY HIỂM (sai mà TỰ KHAI LÀ THÀNH CÔNG):
 * `withMeasureWindow` nối tiếp hoá các lượt **CẤP PHÁT**, KHÔNG nối tiếp hoá các lượt **NHẢ**.
 * `ticket.release()` không lấy khoá, không mở cửa sổ, và bộ đếm `measurable` của khoá chỉ đếm
 * lượt BỎ CUỘC — nó KHÔNG đếm lượt nhả. Nên một lượt nhả rơi vào giữa `before` và `after` làm
 * `actual = after − before` **HỤT** đúng bằng phần vừa rời thiết bị:
 *
 *   • nhả NHIỀU HƠN cấp ⇒ delta ÂM ⇒ nhánh `actual < 0` đã bắt được từ trước (ca 5 dưới đây);
 *   • nhả **ÍT HƠN** cấp ⇒ delta **DƯƠNG-NHƯNG-HỤT** ⇒ trước bản vá **KHÔNG lưới nào bắt**:
 *     `overlappedBy` rỗng · `measurable === true` · `seen === true` · `actual > 0` ⇒
 *     `commit()` + `recordActual()` một con số hụt, khai `measureSource: "process-delta"`,
 *     `measureFailed: false`, và nấc `learned` bị **đóng đinh HỤT tới hết đời tiến trình**.
 *
 * Ở Pha 2B, `learned` hụt ⇒ `headroom` phóng đại ⇒ không bao giờ từ chối ⇒ **OOM**.
 *
 * ĐƯỜNG SINH RA NÓ CÓ THẬT, BA ĐƯỜNG:
 *   1. `ensureCapacity()` chạy **TRƯỚC** `beginVram()` — `aiGgufEngine.ts:844` so với `:851` ⇒
 *      lượt nạp model B `evictLRU()` → `unloadGgufModel(A)` → `dispose()` NGOÀI khoá;
 *   2. `unloadGgufModel()` qua HTTP — `server/routers/aiGgufRouter.ts:73`, bất cứ lúc nào;
 *   3. `while (await evictLRU())` của nhánh OOM-retry — `aiGgufEngine.ts:885`.
 *
 * ⚠ CA 1 LÀ CA ĐỎ CỦA ĐỘT BIẾN: gỡ lời gọi `noteReleaseDuringOpenWindows()` trong `release()`
 * (hoặc gỡ nhánh `release-during-measure-window` trong `commitMeasured()`) thì ca 1 và ca 2 phải
 * ĐỎ. Ca 3 là ĐỐI CHỨNG: cùng fixture, KHÔNG có lượt nhả ⇒ vẫn commit đủ 4 GiB — nên số 0 ở ca 1
 * là âm tính THẬT, không phải dụng cụ đo hỏng.
 *
 * ⚠ QUY ƯỚC MODULE-IDENTITY (giống `wiring.processProbe.test.ts`): mã sản xuất `import()` ĐỘNG
 * `./vramBroker`/`./vramMeasureLock`/`./vramEstimator`, nên MỌI lượt import phải nằm TRONG thân
 * test, SAU cùng một `vi.resetModules()`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const CHILD_PID = 999_001;

type Sample = { self: number | null; child?: number } | null;

/** Hàng đợi mẫu giả: còn >1 phần tử thì SHIFT, còn đúng 1 thì lặp lại mãi. */
const readings = vi.hoisted(() => [] as Sample[]);

/**
 * Móc chạy NGAY TRƯỚC khi một lượt đọc trả kết quả — cách DUY NHẤT dựng được "một lượt nhả xảy ra
 * ĐÚNG GIỮA hai đầu đo của người khác" mà không phải đua với vòng lặp sự kiện.
 */
const beforeRead = vi.hoisted(() => ({ fn: null as null | (() => void | Promise<void>) }));

vi.mock("./vramProcessProbe", () => ({
  readProcessVram: async () => {
    if (beforeRead.fn) { const f = beforeRead.fn; beforeRead.fn = null; await f(); }
    const r = readings.length > 1 ? readings.shift()! : (readings[0] ?? null);
    if (r === null) return null;
    const byPid = new Map<number, number>();
    if (r.self !== null) byPid.set(process.pid, r.self);
    if (r.child !== undefined) byPid.set(CHILD_PID, r.child);
    let totalBytes = 0;
    for (const v of byPid.values()) totalBytes += v;
    return { totalBytes, byPid, byLuid: new Map<string, number>(), sampledAtMs: Date.now() };
  },
  awaitCounterSettle: async () => {},
}));

vi.mock("./vramProbe", () => ({
  readDeviceVram: async () => ({ usedBytes: 0, totalBytes: 32607 * MiB, source: "native" as const }),
  readDeviceVramUncached: async () => ({ usedBytes: 0, totalBytes: 32607 * MiB, source: "native" as const }),
  __clearProbeCache: () => {},
}));

const events = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("./vramEventLog", () => ({
  logVramEvent: (e: Record<string, unknown>) => { events.push(e); },
  flushVramEvents: async () => 0,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
}));

beforeEach(() => {
  vi.resetModules();
  readings.length = 0;
  events.length = 0;
  beforeRead.fn = null;
});

const inProcess = (owner: string, fileMiB: number) =>
  ({ owner, kind: "gguf-model", priority: "interactive", fileBytes: fileMiB * MiB }) as const;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Dựng ĐÚNG kịch bản của reviewer và trả về giấy phép "nạn nhân".
 *
 * `neighbourBytes` được cấp phát + commit TRƯỚC (nên nó có một giấy phép THẬT để nhả), rồi lượt
 * nạp lớn mở cửa sổ, rồi hàng xóm `release()` NGAY TRƯỚC đầu đo SAU của lượt lớn.
 */
async function chayKichBan(opts: { nha: boolean }) {
  const { beginVramAllocation } = await import("./vramWiring");
  const broker = await import("./vramBroker");

  // (1) hàng xóm: 9 GiB → 10 GiB, tức nó chiếm 1 GiB và ĐÃ commit số đó.
  readings.length = 0;
  readings.push({ self: 9 * GiB }, { self: 10 * GiB });
  const hangXom = await beginVramAllocation(inProcess("gguf:hang-xom", 1024));
  await hangXom.commitMeasured();
  expect(broker.snapshot().leases.find((l) => l.request.owner === "gguf:hang-xom")!.actualBytes).toBe(1 * GiB);

  // (2) lượt nạp lớn: before = 10 GiB. Nó cấp 4 GiB THẬT.
  //     Nếu hàng xóm nhả 1 GiB trong cửa sổ ⇒ after = 13 GiB (chứ không phải 14).
  readings.length = 0;
  readings.push({ self: 10 * GiB }, { self: opts.nha ? 13 * GiB : 14 * GiB });
  const lon = await beginVramAllocation(inProcess("gguf:lon", 4096));

  if (opts.nha) {
    // Lượt nhả rơi ĐÚNG vào giữa hai đầu đo — đúng hình dạng `ensureCapacity()` / HTTP unload.
    beforeRead.fn = () => { hangXom.release(); };
  }
  await lon.commitMeasured();

  return { broker, lon };
}

describe("C-1 — lượt NHẢ xen giữa hai đầu đo KHÔNG được commit một delta HỤT", () => {
  it("★★★ 1. cấp 4 GiB + hàng xóm nhả 1 GiB ⇒ measureFailed, KHÔNG commit, KHÔNG recordActual", async () => {
    const { broker } = await chayKichBan({ nha: true });

    const l = broker.snapshot().leases.find((x) => x.request.owner === "gguf:lon");
    expect(l, "giấy phép phải còn trong sổ").toBeDefined();

    // Trước bản vá: `actualBytes === 3 GiB` (thật là 4) và `measureFailed` falsy.
    expect(l!.actualBytes, "delta HỤT 3 GiB KHÔNG được vào sổ như thể là số đo").toBeNull();
    expect(l!.measureFailed).toBe(true);
    expect(l!.measureSource).toBe("none");

    // …và KHÔNG có sự kiện `commit` nào cho nó.
    expect(events.some((e) => e.event === "commit" && e.owner === "gguf:lon")).toBe(false);

    // Nhật ký phải NÓI RA nguyên nhân, và nói ĐÍCH DANH ai đã nhả.
    const ev = events.find((e) => e.event === "measure_failed" && e.owner === "gguf:lon");
    expect(ev, "phải có sự kiện measure_failed — im lặng là đúng lớp lỗi C-1 sinh ra để diệt").toBeDefined();
    const d = ev!.detail as Record<string, unknown>;
    expect(d.reason).toBe("release-during-measure-window");
    expect(d.releasedDuring).toEqual(["gguf:hang-xom"]);
    expect(d.discardedDeltaBytes, "con số HỤT phải được ghi lại để dựng lại được, chứ không commit").toBe(3 * GiB);
    // ⚠ Bằng chứng KHOÁ KHÔNG BIẾT GÌ: `measurable` VẪN true. Đây chính là lý do lỗ này đi lọt —
    // không phải vì lưới hỏng, mà vì lưới của khoá không đo thứ này.
    expect(d.measurable, "khoá nối tiếp KHÔNG hề biết một lượt nhả đã xảy ra").toBe(true);
  });

  it("★★★ 2. nấc `learned` KHÔNG bị đóng đinh bằng con số hụt (hậu quả sống lâu nhất)", async () => {
    await chayKichBan({ nha: true });

    const estimator = await import("./vramEstimator");
    const est = await estimator.estimateBytesFor("gguf:lon", { fileBytes: 4096 * MiB });
    expect(est.source, "recordActual() KHÔNG được chạy ⇒ không có nấc learned nào").toBe("file-size");
    expect(est.bytes).toBe(4096 * MiB);
  });

  it("★★ 3. ĐỐI CHỨNG — cùng fixture, KHÔNG có lượt nhả ⇒ vẫn commit ĐỦ 4 GiB", async () => {
    const { broker } = await chayKichBan({ nha: false });

    const l = broker.snapshot().leases.find((x) => x.request.owner === "gguf:lon");
    expect(l!.actualBytes, "không có nhả ⇒ phép đo vẫn phải chạy bình thường").toBe(4 * GiB);
    expect(l!.measureFailed).toBeFalsy();
    expect(l!.measureSource).toBe("process-delta");

    const estimator = await import("./vramEstimator");
    expect((await estimator.estimateBytesFor("gguf:lon", { fileBytes: 4096 * MiB })).source).toBe("learned");
  });

  it("4. lượt nhả BÌNH THƯỜNG (sau khi đã commit xong) KHÔNG gắn cờ oan cho ai", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const broker = await import("./vramBroker");

    readings.push({ self: 1 * GiB }, { self: 3 * GiB });
    const a = await beginVramAllocation(inProcess("gguf:A", 2048));
    await a.commitMeasured();
    a.release();                       // cửa sổ của A đã đóng từ commitMeasured ⇒ không ai bị đánh dấu

    readings.length = 0;
    readings.push({ self: 1 * GiB }, { self: 2 * GiB });
    const b = await beginVramAllocation(inProcess("gguf:B", 1024));
    await b.commitMeasured();

    const l = broker.snapshot().leases.find((x) => x.request.owner === "gguf:B");
    expect(l!.actualBytes, "nhả xảy ra NGOÀI mọi cửa sổ ⇒ không được ảnh hưởng gì").toBe(1 * GiB);
    expect(l!.measureFailed).toBeFalsy();
  });

  it("5. nhả NHIỀU HƠN cấp (delta ÂM) vẫn bị bắt — nửa lớp lỗi cũ không bị bỏ rơi", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const broker = await import("./vramBroker");

    readings.push({ self: 9 * GiB }, { self: 20 * GiB });
    const hangXom = await beginVramAllocation(inProcess("gguf:to", 11264));
    await hangXom.commitMeasured();

    readings.length = 0;
    readings.push({ self: 20 * GiB }, { self: 13 * GiB });   // nhả 11 GiB, cấp 4 GiB ⇒ delta ÂM
    const lon = await beginVramAllocation(inProcess("gguf:lon", 4096));
    beforeRead.fn = () => { hangXom.release(); };
    await lon.commitMeasured();

    const l = broker.snapshot().leases.find((x) => x.request.owner === "gguf:lon");
    expect(l!.actualBytes).toBeNull();
    expect(l!.measureFailed).toBe(true);
  });

  it("★ 6. PHẠM VI — lượt nhả của hộ NGOÀI tiến trình KHÔNG làm bẩn cửa sổ `self`", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const broker = await import("./vramBroker");

    // Sidecar (descendants) đã có giấy phép và đang giữ 4 GiB ở tiến trình CON.
    readings.push({ self: 1 * GiB, child: 4 * GiB });
    const sidecar = await beginVramAllocation({
      owner: "sidecar:vision", kind: "external-process", priority: "interactive",
      fileBytes: 4096 * MiB, ttlMs: 600_000,
    });

    readings.length = 0;
    readings.push({ self: 1 * GiB, child: 4 * GiB }, { self: 3 * GiB, child: 0 });
    const lon = await beginVramAllocation(inProcess("gguf:lon", 2048));
    beforeRead.fn = () => { sidecar.release(); };     // nhả ở phạm vi `descendants`
    await lon.commitMeasured();

    const l = broker.snapshot().leases.find((x) => x.request.owner === "gguf:lon");
    // Hai tập PID RỜI NHAU ⇒ byte của tiến trình con KHÔNG THỂ nằm trong hiệu số `self`.
    expect(l!.actualBytes, "đánh dấu chéo phạm vi là tự tay làm mù phép đo Pha 2A vừa dựng").toBe(2 * GiB);
    expect(l!.measureFailed).toBeFalsy();
  });

  it("★ 7. nhánh MỚI vẫn CHỐT SỔ bằng dự phòng (hộ `gguf-backend` không có đường release)", async () => {
    const { beginVramAllocation, CUDA_BACKEND_FALLBACK_BYTES } = await import("./vramWiring");
    const broker = await import("./vramBroker");

    readings.push({ self: 1 * GiB }, { self: 2 * GiB });
    const hangXom = await beginVramAllocation(inProcess("gguf:hang-xom", 1024));
    await hangXom.commitMeasured();

    readings.length = 0;
    readings.push({ self: 2 * GiB }, { self: 2 * GiB + 200 * MiB });
    const backend = await beginVramAllocation({
      owner: "cuda-backend", kind: "gguf-backend", priority: "production",
      configDefaultBytes: CUDA_BACKEND_FALLBACK_BYTES, fallbackBytes: CUDA_BACKEND_FALLBACK_BYTES,
    });
    beforeRead.fn = () => { hangXom.release(); };
    await backend.commitMeasured();

    const l = broker.snapshot().leases.find((x) => x.request.owner === "cuda-backend");
    // T5-15: giấy phép backend KHÔNG được đứng `actualBytes: null` vĩnh viễn ⇒ nó sẽ khoá nền.
    expect(l!.actualBytes, "nhánh đo-hỏng thứ BẢY cũng phải gọi chotSoBangDuPhong()").toBe(CUDA_BACKEND_FALLBACK_BYTES);
    expect(l!.measureFailed, "chốt bằng dự phòng KHÔNG được xoá cờ đo-hỏng").toBe(true);
    expect(l!.fallbackReason).toBe("release-during-measure-window");
    expect(l!.measureSource).toBe("none");
  });

  it("★ 8. KHÔNG RÒ cửa sổ và KHÔNG RÒ khoá ở nhánh mới", async () => {
    const { __openMeasureWindowCount } = await import("./vramWiring");
    const { measureWindowDepth } = await import("./vramMeasureLock");
    await chayKichBan({ nha: true });
    await tick();
    expect(__openMeasureWindowCount(), "cửa sổ phải đóng ở nhánh release-during-measure-window").toBe(0);
    expect(measureWindowDepth(), "khoá nối tiếp phải được nhả ở nhánh mới").toBe(0);
  });
});

/**
 * ★★ I-4 / T3-M6 (review TOÀN NHÁNH) — `commitMeasured()` gọi lần HAI.
 *
 * Bất biến "mỗi điểm cấp phát chỉ `await` nó đúng MỘT lần" được `vramWiring.ts` phát biểu như một
 * SỰ THẬT và dùng làm chỗ dựa cho việc gắn `measureFailed` sớm — nhưng trước bản vá này mã KHÔNG
 * cưỡng chế nó. Lời gọi thứ hai chạy lại đầu đo SAU rồi `commit(after₂ − beforeUsed₁)`: một hiệu
 * số tính từ một đầu đo TRƯỚC đã cũ, tức một con số BỊA — rồi `recordActual()` nó.
 */
describe("I-4 — commitMeasured() phải bất biến với lời gọi thứ hai", () => {
  it("★★ 1. lần gọi thứ hai KHÔNG commit lại và KHÔNG ghi đè nấc learned", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const broker = await import("./vramBroker");
    const estimator = await import("./vramEstimator");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // before = 1 GiB, after₁ = 3 GiB ⇒ số ĐÚNG là 2 GiB.
    // Mẫu thứ ba (10 GiB) là thứ lần gọi hai SẼ đọc nếu nó chạy: 10 − 1 = 9 GiB, một số bịa.
    readings.push({ self: 1 * GiB }, { self: 3 * GiB }, { self: 10 * GiB });
    const t = await beginVramAllocation(inProcess("gguf:A", 2048));
    await t.commitMeasured();
    await t.commitMeasured();
    warn.mockRestore();

    const l = broker.snapshot().leases.find((x) => x.request.owner === "gguf:A");
    expect(l!.actualBytes, "lần hai KHÔNG được commit một hiệu số tính từ beforeUsed đã cũ").toBe(2 * GiB);
    expect((await estimator.estimateBytesFor("gguf:A", {})).bytes, "nấc learned phải giữ số ĐÚNG").toBe(2 * GiB);
    expect(events.filter((e) => e.event === "commit" && e.owner === "gguf:A").length).toBe(1);
  });

  it("2. lần gọi thứ hai là no-op CÓ TIẾNG (im lặng chính là thứ đã để lỗ này sống)", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    readings.push({ self: 1 * GiB }, { self: 3 * GiB });
    const t = await beginVramAllocation(inProcess("gguf:A", 2048));
    await t.commitMeasured();
    await t.commitMeasured();

    const line = warn.mock.calls.map((c) => String(c[0])).join("\n");
    warn.mockRestore();
    expect(line).toMatch(/LAN THU HAI|LẦN THỨ HAI/i);
  });
});
