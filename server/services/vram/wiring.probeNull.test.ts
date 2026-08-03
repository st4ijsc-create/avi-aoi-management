/**
 * Pha 1.5 Task 3, review vòng 1 (Important-1) — "CỬA THỨ TƯ/NĂM" của `commitMeasured()`.
 *
 * Task 5 (I-2) đã đóng "cửa thứ ba" (delta ÂM ⇒ `markMeasureFailed()`), và bản vá Task 3 gốc
 * đã kiểm tra bằng `wiring.negativeDelta.test.ts` ca 4. Reviewer đọc lại toàn bộ
 * `commitMeasured()` (`vramWiring.ts:175-247`) và tìm ra HAI nhánh return CÂM khác, cũng
 * KHÔNG gọi `markMeasureFailed()`:
 *
 *   1. `beforeUsed === null` — `readDeviceVramUncached()` ngay TRƯỚC lượt cấp phát (lúc tạo
 *      ticket) đã trả `null`/ném. `beforeUsed` bị ĐÓNG BĂNG null từ đó — gọi lại
 *      `commitMeasured()` bao nhiêu lần cũng không cứu được, vì không hề có điểm "trước" để
 *      so. Đây đúng ngữ nghĩa "đã thử đo, không ra số dùng được" — KHÔNG PHẢI "đang chờ".
 *   2. `after === null` — `readDeviceVramUncached()` SAU lượt cấp phát (bên trong
 *      `commitMeasured()`) trả `null`. Đây là ca THẬT và DỄ XẢY RA NHẤT đúng lúc GPU đang bận
 *      nạp model (`nvidia-smi` timeout 3s hoặc handle native chập chờn).
 *
 * ⚠ HẬU QUẢ TRƯỚC BẢN VÁ NÀY: cả hai nhánh return im lặng tuyệt đối — lease đứng
 * `actualBytes: null, measureFailed: false` **CÂM**. Vì `commitMeasured()` không được gọi lại
 * cho CÙNG một ticket (mỗi điểm cấp phát chỉ `await ticket.commitMeasured()` đúng MỘT lần),
 * lease đó ở lại `pendingBytes` (vramReconciler.ts) cho tới khi có `release()` THẬT (model bị
 * unload/evict) — lâu hơn RẤT NHIỀU so với cửa delta<0 (tự lành ngay trong CHÍNH lượt gọi
 * `commitMeasured()` đang chạy).
 *
 * ⚠ ĐÁNH ĐỔI ĐÃ CÂN NHẮC (không né): đánh dấu `measureFailed=true` ở đây có thể khiến MỘT
 * lease THẬT SỰ vẫn đang tải dở (VRAM vật lý còn tăng) bị loại khỏi `pendingBytes` chỉ vì một
 * lượt đọc thiết bị hỏng THOÁNG QUA — băng dung sai phía ÂM co lại đúng lúc đó, có thể sinh
 * MỘT lượt báo động ở nhịp `reconcileOnce()` kế tiếp nếu vật lý chưa kịp lên đủ. Đây là đánh
 * đổi CÓ CHỦ Ý, không phải sơ suất: (a) báo động đó KHÔNG sai lệch — nó đúng sự thật "ước
 * lượng của lease này không xác minh được", và câu cảnh báo I-2 sẵn có đã phân biệt rõ "đo
 * hỏng" với "cấp phát chui"; (b) tự lành ở nhịp kế (VRAM vật lý lên đủ ⇒ hộ tiêu thụ KHÁC hoặc
 * chính lần đối chiếu sau sẽ không còn drift bất thường); (c) đối lập với nó — giữ nguyên hiện
 * trạng — là một LỖ CÂM có thể kéo dài tới lúc unload/evict, tức HÀNG PHÚT/GIỜ trên một model
 * ít khi bị đuổi khỏi cache, đúng lớp lỗi mà toàn bộ I-2 sinh ra để diệt. Giữa "một lượt báo
 * động có thể giải thích được" và "một lỗ câm không biết đang câm", Pha 1.5 chọn vế đầu, nhất
 * quán với tiền lệ I-2.
 *
 * ⚠ CATCH-ALL BÊN NGOÀI (`vramWiring.ts:244`) CỐ Ý KHÔNG ĐƯỢC SỬA THEO CÙNG CÁCH: nó bọc CẢ
 * `broker.commit(lease, actual)` lẫn `estimator.recordActual()`/`logVramEvent()` PHÍA SAU
 * lượt commit thật đã chạy. Nếu commit() đã thành công rồi `recordActual()`/`logVramEvent()`
 * mới ném, gọi `markMeasureFailed()` ở catch-all sẽ gắn cờ SAI cho một lease ĐÃ commit đúng —
 * `actualBytes` vẫn là số thật nhưng `measureFailed=true` khiến câu cảnh báo I-2 gọi nhầm một
 * lease THÀNH CÔNG là "đo hỏng". Rủi ro gắn cờ sai lớn hơn lợi ích (catch-all hiếm khi chạm —
 * `broker.commit`/`recordActual`/`logVramEvent` đều là hàm đồng bộ, không I/O, gần như không
 * bao giờ ném) nên KHÔNG sửa nhánh này.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Reading = { usedBytes: number; totalBytes: number; source: "native" | "smi" } | null;

/** Hàng đợi số đo giả — mỗi phần tử là MỘT lượt `readDeviceVramUncached()`, rỗng ⇒ null. */
const queue = vi.hoisted(() => [] as Reading[]);
/**
 * Số đo dành riêng cho `readDeviceVram()` (đường CÓ ĐỆM mà `vramReconciler` dùng) — TÁCH khỏi
 * `queue` (đường KHÔNG đệm mà `vramWiring.commitMeasured()` dùng). Khai MỘT LẦN trong CÙNG
 * factory `vi.mock` thay vì `vi.doMock` giữa test: bài học từ `vramReconciler.test.ts` (Task 3
 * gốc) — `vi.doMock` gọi LẠI sau khi module tiêu thụ đã `import()` KHÔNG đổi được binding đã
 * chụp (ESM named import resolve MỘT LẦN lúc module tiêu thụ nạp).
 */
const reconcileReading = vi.hoisted(() => ({ value: null as Reading }));
vi.mock("./vramProbe", () => ({
  readDeviceVramUncached: async () => (queue.length ? queue.shift()! : null),
  readDeviceVram: async () => reconcileReading.value,
  __clearProbeCache: () => {},
}));

/**
 * ⚠ Pha 2A Task 3 — HAI NHÁNH MÀ FILE NÀY CANH (`before-probe-null` / `after-probe-null`) NAY
 * THUỘC VỀ ĐẦU DÒ THEO TIẾN TRÌNH: `commitMeasured()` không còn gọi `readDeviceVramUncached()`.
 * Bản giả dưới đây tiêu thụ ĐÚNG hàng đợi `queue` cũ với ĐÚNG ngữ nghĩa cũ (hết phần tử ⇒ `null`),
 * nên cả bốn ca giữ nguyên ý nghĩa — chỉ đổi cái thước. Không chuyển bản giả sang đây thì file này
 * xanh RỖNG: `queue` không còn ai đọc, và `null` mà nó dựng ra không tới được nhánh cần kiểm.
 */
vi.mock("./vramProcessProbe", () => ({
  readProcessVram: async () => {
    const r = queue.length ? queue.shift()! : null;
    if (!r) return null;
    return {
      totalBytes: r.usedBytes,
      byPid: new Map<number, number>([[process.pid, r.usedBytes]]),
      byLuid: new Map<string, number>(),
      sampledAtMs: Date.now(),
    };
  },
  /**
   * ★ Pha 2A Task 6 — BẢN GIẢ CỦA BIÊN LẮNG, cố ý KHÔNG chờ. Bộ test này không đo bộ đếm thật nên
   * chờ 250 ms mỗi lượt `commitMeasured()` chỉ là thời gian chết. Biên lắng THẬT được canh ở
   * `wiring.settle.test.ts` (thứ tự gọi + sàn của hằng số) — nơi duy nhất được phép khẳng định nó.
   * ⚠ PHẢI khai ở MỌI bản giả của module này: `vramWiring` để lời gọi NÉM nếu thiếu (không nuốt).
   */
  awaitCounterSettle: async () => {},
}));

const events = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("./vramEventLog", () => ({
  logVramEvent: (e: Record<string, unknown>) => { events.push(e); },
  flushVramEvents: async () => 0,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
}));

const MiB = 1024 * 1024;

beforeEach(() => {
  vi.resetModules();
  queue.length = 0;
  events.length = 0;
  reconcileReading.value = null;
});

describe("Important-1 — commitMeasured() PHẢI đánh dấu measureFailed khi đầu dò trả null (cả hai đầu đo)", () => {
  it("1. beforeUsed===null (đầu dò hỏng NGAY LÚC tạo ticket) ⇒ measureFailed=true, không câm", async () => {
    // queue RỖNG ⇒ readDeviceVramUncached() TRƯỚC lượt cấp phát trả null.
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const ticket = await beginVramAllocation({
      owner: "gguf:probe-fail-before",
      kind: "gguf-model",
      priority: "interactive",
      fileBytes: 900 * MiB,
    });
    await ticket.commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner === "gguf:probe-fail-before");
    expect(lease).toBeDefined();
    expect(lease!.actualBytes).toBeNull();
    // ★ TRỌNG TÂM: trước bản vá, cờ này ở lại `false` VĨNH VIỄN — lease câm trong `pendingBytes`.
    expect(lease!.measureFailed).toBe(true);

    const ev = events.find((e) => e.event === "measure_failed");
    expect(ev).toBeDefined();
    expect((ev!.detail as Record<string, unknown>).reason).toBe("before-probe-null");
  });

  it("2. after===null (đầu dò hỏng NGAY LÚC commit, ĐÚNG lúc GPU bận nạp model) ⇒ measureFailed=true, không câm", async () => {
    // Một phần tử ⇒ lượt "before" (lúc tạo ticket) đọc được số thật; queue rỗng sau đó ⇒
    // lượt "after" (bên trong commitMeasured()) trả null.
    queue.push({ usedBytes: 4 * 1024 * MiB, totalBytes: 32607 * MiB, source: "native" });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const ticket = await beginVramAllocation({
      owner: "gguf:probe-fail-after",
      kind: "gguf-model",
      priority: "interactive",
      fileBytes: 900 * MiB,
    });
    await ticket.commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner === "gguf:probe-fail-after");
    expect(lease).toBeDefined();
    expect(lease!.actualBytes).toBeNull();
    // ★ TRỌNG TÂM: trước bản vá, cờ này ở lại `false` VĨNH VIỄN dù đã có beforeUsed hợp lệ.
    expect(lease!.measureFailed).toBe(true);

    const ev = events.find((e) => e.event === "measure_failed");
    expect(ev).toBeDefined();
    expect((ev!.detail as Record<string, unknown>).reason).toBe("after-probe-null");
    expect((ev!.detail as Record<string, unknown>).beforeUsedBytes).toBe(4 * 1024 * MiB);
  });

  it("3. ĐỘT BIẾN đối chứng — delta bình thường (cả hai đầu đo hợp lệ) vẫn commit đúng, KHÔNG bị gắn measureFailed oan", async () => {
    queue.push({ usedBytes: 4 * 1024 * MiB, totalBytes: 32607 * MiB, source: "native" });
    queue.push({ usedBytes: 4 * 1024 * MiB + 18 * MiB, totalBytes: 32607 * MiB, source: "native" });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const ticket = await beginVramAllocation({
      owner: "gguf:probe-ok",
      kind: "gguf-model",
      priority: "interactive",
      fileBytes: 900 * MiB,
    });
    await ticket.commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner === "gguf:probe-ok");
    expect(lease!.actualBytes).toBe(18 * MiB);
    expect(lease!.measureFailed).toBeFalsy();
    expect(events.some((e) => e.event === "measure_failed")).toBe(false);
  });

  it("4. reconciler: lease measureFailed do đầu dò null KHÔNG còn nới băng dung sai — tự lành TRONG CHÍNH lượt commitMeasured() đang chạy", async () => {
    // queue rỗng ⇒ before-probe-null ngay từ đầu.
    const { beginVramAllocation } = await import("./vramWiring");
    const ticket = await beginVramAllocation({
      owner: "gguf:probe-fail-before",
      kind: "gguf-model",
      priority: "interactive",
      fileBytes: 17_000 * MiB,
    });
    await ticket.commitMeasured();

    reconcileReading.value = { usedBytes: 0, totalBytes: 32_607 * MiB, source: "native" };
    const { reconcileOnce, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();
    const r = await reconcileOnce();

    // pendingBytes PHẢI = 0 — lease đã measureFailed=true nên KHÔNG còn nới băng dung sai,
    // đúng như thiết kế: "tự lành TRONG CHÍNH lượt commitMeasured()", không phải chờ tới nhịp
    // reconcile kế tiếp.
    expect(r.pendingBytes).toBe(0);
  });
});
