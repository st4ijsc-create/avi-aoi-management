/**
 * I-2 (review TOÀN NHÁNH) — "cửa thứ ba": `vramWiring.ts:148` `if (actual < 0) return;`
 *
 * Đường sinh delta ÂM CÓ THẬT và dài NHIỀU GIÂY: `aiGgufEngine.ts:771` chạy
 * `while (await evictLRU())` — đuổi tới 17 GB — NGAY GIỮA `beforeUsed` (`:737`) và
 * `commitMeasured()` (`:802`). Đuổi 17 GB rồi nạp 4 GB ⇒ `after − before` ÂM.
 *
 * ⚠ HẬU QUẢ NẶNG NHẤT KHÔNG PHẢI ĐẦU ĐỘC NỀN (nền chụp MỘT lần lúc boot, sổ còn rỗng — xác
 * suất thấp). Nó là: giấy phép giữ ước lượng theo KÍCH THƯỚC FILE **VĨNH VIỄN**. Với
 * `reranker:` file **606 MiB** trong khi thật **14-18 MiB** ⇒ sổ thừa ~590 MiB ⇒ lệch ÂM vượt
 * ngưỡng 512, **mỗi 60 giây, mãi mãi** — đúng nhánh Task 5 đã phải đổi `> 0` thành `>= 0` để
 * tránh, nay sống lại qua cửa `< 0`.
 *
 * ⚠ VÌ SAO KHÔNG CHỌN "THỬ LẠI `commitMeasured()` Ở NHỊP ĐỐI CHIẾU" (phương án A của brief):
 * `beforeUsed` được chụp TRƯỚC lượt cấp phát. Thử lại ở nhịp sau chỉ tính được
 * `after(t₂) − beforeUsed(t₀)`, mà giữa t₀ và t₂ đã có mọi lượt cấp phát/nhả của mọi hộ khác ⇒
 * số thu được KHÔNG phải VRAM của giấy phép này, và nó sẽ được `commit()` như thể là số THẬT.
 * Thử lại làm phép đo SAI HƠN, không đúng hơn. Vì vậy chọn phương án B: **đánh dấu "đo hỏng"**
 * — sổ nói thẳng rằng con số nó đang giữ là ước lượng KHÔNG xác minh được, thay vì giả vờ nó
 * chỉ "đang chờ commit".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Hàng đợi số đo giả. `readDeviceVram()` (ĐƯỜNG CÓ ĐỆM, của `vramReconciler`) đọc phần tử ĐẦU;
 * đường đo của `vramWiring` SHIFT dần qua hàng đợi.
 *
 * ⚠ Pha 2A Task 3 — đường đo `actualBytes` đã chuyển sang BỘ ĐẾM THEO TIẾN TRÌNH, nên hàng đợi
 * này nay nuôi `readProcessVram()` chứ không còn `readDeviceVramUncached()`. Ngữ nghĩa từng phần
 * tử KHÔNG đổi (một lượt đọc = một đầu đo), nên mọi con số của file này giữ nguyên ý nghĩa: bản
 * giả quy TOÀN BỘ `usedBytes` cho `process.pid`, tức "cả thiết bị là của tiến trình này" — đúng
 * thế giới mà các ca ở đây mô tả (một tiến trình, không có con).
 */
const readings = vi.hoisted(() => [] as Array<{ usedBytes: number; totalBytes: number } | null>);
vi.mock("./vramProbe", () => ({
  readDeviceVram: async () => readings[0] ?? null,
  readDeviceVramUncached: async () => (readings.length > 1 ? readings.shift()! : (readings[0] ?? null)),
  __clearProbeCache: () => {},
}));
vi.mock("./vramProcessProbe", () => ({
  readProcessVram: async () => {
    const r = readings.length > 1 ? readings.shift()! : (readings[0] ?? null);
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

/** Nhật ký giả — I-2 đòi nhánh delta âm phải để lại DẤU VẾT, không được im lặng. */
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
  readings.length = 0;
  events.length = 0;
});

describe("I-2 — delta ÂM: sổ phải NÓI RA rằng nó đang giữ một con số không xác minh được", () => {
  it("1. delta ÂM ⇒ giấy phép bị ĐÁNH DẤU 'đo hỏng' (không giả vờ 'đang chờ commit')", async () => {
    // 20 GiB → 4 GiB: mô phỏng ĐÚNG đường OOM-retry (evictLRU đuổi 17 GB rồi nạp lại 4 GB).
    readings.push({ usedBytes: 20 * 1024 * MiB, totalBytes: 32607 * MiB });
    readings.push({ usedBytes: 4 * 1024 * MiB, totalBytes: 32607 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const ticket = await beginVramAllocation({
      owner: "reranker:/models/reranker.gguf",
      kind: "gguf-model",
      priority: "background",
      fileBytes: 606 * MiB,
    });
    await ticket.commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner.startsWith("reranker:"));
    expect(lease).toBeDefined();
    // Số THẬT vẫn KHÔNG được ghi (một delta âm là số liệu hỏng, ghi vào còn tệ hơn) …
    expect(lease!.actualBytes).toBeNull();
    // … NHƯNG sổ phải phân biệt được "chưa cấp phát xong" với "đo hỏng, ước lượng đứng mãi".
    expect(lease!.measureFailed).toBe(true);
  });

  it("2. delta ÂM ⇒ để lại DẤU VẾT trong nhật ký (bản cũ im lặng tuyệt đối)", async () => {
    readings.push({ usedBytes: 20 * 1024 * MiB, totalBytes: 32607 * MiB });
    readings.push({ usedBytes: 4 * 1024 * MiB, totalBytes: 32607 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const ticket = await beginVramAllocation({
      owner: "reranker:/models/reranker.gguf",
      kind: "gguf-model",
      priority: "background",
      fileBytes: 606 * MiB,
    });
    await ticket.commitMeasured();

    const ev = events.find((e) => e.event === "measure_failed");
    expect(ev).toBeDefined();
    expect(ev!.owner).toBe("reranker:/models/reranker.gguf");
    // Phải ghi CẢ hai đầu phép đo để đọc nhật ký là dựng lại được vì sao nó âm.
    expect((ev!.detail as Record<string, unknown>).measuredDeltaBytes).toBe(-16 * 1024 * MiB);
    expect(ev!.estimatedBytes).toBe(606 * MiB);
  });

  it("3. ĐỘT BIẾN — delta DƯƠNG vẫn commit bình thường, KHÔNG bị đánh dấu đo hỏng", async () => {
    readings.push({ usedBytes: 4 * 1024 * MiB, totalBytes: 32607 * MiB });
    readings.push({ usedBytes: 4 * 1024 * MiB + 18 * MiB, totalBytes: 32607 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const ticket = await beginVramAllocation({
      owner: "reranker:/models/reranker.gguf",
      kind: "gguf-model",
      priority: "background",
      fileBytes: 606 * MiB,
    });
    await ticket.commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner.startsWith("reranker:"));
    expect(lease!.actualBytes).toBe(18 * MiB);
    expect(lease!.measureFailed).toBeFalsy();
    expect(events.some((e) => e.event === "measure_failed")).toBe(false);
  });

  it("4. reconciler CHẨN ĐOÁN ĐÚNG: giấy phép đo-hỏng KHÔNG bị gọi là 'ứng viên số một (chưa commit)'", async () => {
    readings.push({ usedBytes: 20 * 1024 * MiB, totalBytes: 32607 * MiB });
    readings.push({ usedBytes: 4 * 1024 * MiB, totalBytes: 32607 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const ticket = await beginVramAllocation({
      owner: "reranker:/models/reranker.gguf",
      kind: "gguf-model",
      priority: "background",
      fileBytes: 606 * MiB,
    });
    await ticket.commitMeasured();

    // Thiết bị giữ ÍT hơn sổ (sổ = 606 MiB ước lượng, thiết bị 18 MiB) ⇒ lệch ÂM vượt ngưỡng.
    readings.length = 0;
    readings.push({ usedBytes: 18 * MiB, totalBytes: 32607 * MiB });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();
    const res = await reconcileOnce();
    const line = warn.mock.calls.map((c) => String(c[0])).join("\n");
    warn.mockRestore();

    expect(res.alarm).toBe(true);
    expect(res.driftBytes!).toBeLessThan(0);
    // Câu cảnh báo phải chỉ ĐÚNG nguyên nhân: KHÔNG phải "đang cấp phát dở" mà là "đã đo hỏng,
    // ước lượng đứng mãi" — người trực đọc sai nguyên nhân là đi sai hướng điều tra.
    expect(line).toMatch(/đo hỏng/i);
    expect(line).not.toMatch(/Ứng viên số một \(chưa commit\): reranker:/);
  });
});
