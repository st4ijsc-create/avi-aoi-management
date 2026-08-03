/**
 * Pha 1.5 Task 8 (C-1) — SỔ COMMIT CỘNG TRÙNG khi hai CỬA SỔ ĐO chồng nhau.
 *
 * `vramWiring.ts:168` chụp `beforeUsed` và `:241` tính `after.usedBytes - beforeUsed` — **cả hai
 * đầu đo đọc `used` TOÀN THIẾT BỊ**, không phải phần của riêng giấy phép này. Nên MỌI lượt cấp
 * phát rơi vào khoảng `before→after` của một giấy phép đều bị quy TRỌN VẸN cho giấy phép đó. Hai
 * cửa sổ chồng nhau ⇒ CÙNG MỘT KHỐI BYTE được ghi vào sổ HAI LẦN.
 *
 * ⚠ ĐẾN ĐƯỢC THẬT, KHÔNG PHẢI GIẢ ĐỊNH: `GGUF_MAX_CONCURRENCY=4` (.env), 6 nơi gọi
 * `generateEmbedding(s)` do HTTP điều khiển, và `aiGgufEngine.ts:2756-2762` đã ĐO chính ca này
 * ("4 lượt tuần tự 654 MiB; đồng thời 2.430 MiB"). Nhật ký LIVE có hai lease `gguf-model` pending
 * cùng lúc; `wiring.backend.test.ts:198` chạy đúng `Promise.all([loadGgufModel(A), loadGgufModel(B)])`.
 *
 * ⚠⚠ VÌ SAO CHẶN PHA 2: Pha 2 từ chối/thu hồi trên `headroom = trần − reserve − Σ leaseBytes`, mà
 * `leaseBytes()` trả `actualBytes` sau commit ⇒ **từ chối nạp và ĐUỔI MODEL ĐANG CHẠY trên byte ma**.
 *
 * ⚠ QUY ƯỚC MODULE-IDENTITY (giống `wiring.negativeDelta.test.ts`): mã sản xuất `import()` ĐỘNG
 * `./vramBroker`, nên MỌI lượt import (cả sản xuất lẫn sổ cái) phải nằm TRONG thân test, SAU cùng
 * một `vi.resetModules()` — không thì test soi vào MỘT SỔ KHÁC và xanh/đỏ đều sai lý do.
 *
 * ⚠⚠ NGƯỜI SAU MUỐN "DỌN BỚT CA": ĐỪNG. Ca ★★ 1 ĐỨNG MỘT MÌNH **KHÔNG ĐỦ** — nó chỉ khẳng định
 * `Σ actualBytes ≤ 4.000 MiB`, nên một đột biến "đánh dấu MỘT CHIỀU" (chỉ gắn `measureFailed` cho
 * cửa sổ MỚI, bỏ qua cửa sổ CŨ trong `openMeasureWindow()`) vẫn làm nó XANH: một bên giữ `null`,
 * tổng vẫn ≤ 4.000. Bốn ca chống lưng cho nó, mỗi ca một hướng KHÁC nhau:
 *   • ca 2 — CẢ HAI phía phải bị gắn cờ (chính là ca giết đột biến một chiều);
 *   • ca 3 — dấu vết phải nêu ĐÍCH DANH `overlappedBy` (không thì không điều tra được);
 *   • ca 7 — bộ ước lượng KHÔNG được HỌC con số chồng lấn (nấc "learned" đóng đinh vĩnh viễn);
 *   • ca 9 — không RÒ cửa sổ ở CẢ NĂM nhánh thoát (một cửa sổ rò làm mọi phép đo sau bị gắn cờ
 *     sai tới lúc khởi động lại).
 * Và ca 4 (tuần tự) là ĐỐI CHỨNG chứng minh lưới không phải "gắn cờ tất".
 *
 * ⚠⚠ LỖ HỔNG ĐÃ TỪNG CÓ THẬT Ở ĐÂY (review TOÀN NHÁNH, C-1 × T5-1): chín ca của file này chỉ soi
 * lại **MỘT** trong ba hộ tiêu thụ của `isLoadingLease()` (ca 8 — `pendingBytes`), KHÔNG ca nào
 * chạm `captureVramBaseline()`. Task 8 đổi tận gốc DÂN SỐ của `measureFailed` (nay có cả model
 * 17 GB) và vì thế MỞ LẠI đúng cửa T5-1 mà Task 7 sinh ra để đóng — chín ca xanh không thấy gì.
 * Thêm một nhánh vào `vramWiring` mà đổi dân số một cờ dùng chung: phải đi soi **MỌI** hộ tiêu thụ
 * của cờ đó, không phải chỉ hộ gần nhất.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Hàng đợi số đo giả — mỗi phần tử là MỘT đầu đo. Phần tử `"THROW"` làm đầu dò NÉM (ca 9 cần
 * nhánh `catch` ngoài cùng của `commitMeasured()`).
 *
 * ⚠⚠ Pha 2A Task 3 — HAI ĐIỀU ĐÃ ĐỔI Ở FILE NÀY, đọc trước khi sửa một dòng nào:
 *
 *   1. **Cái thước.** Đường đo `actualBytes` nay đọc BỘ ĐẾM THEO TIẾN TRÌNH
 *      (`vramProcessProbe`), không còn `used` toàn thiết bị. Hàng đợi này vì thế nuôi
 *      `readProcessVram()`; `usedBytes` được quy cho `process.pid` (và `childBytes` cho một tiến
 *      trình CON, dùng ở ca 6). `readDeviceVram()` — đường CÓ ĐỆM của `vramReconciler` — giữ
 *      nguyên thước cũ, vì Đ4 cấm trộn hai thước chứ không cấm dùng cả hai.
 *   2. **`VRAM_MEASURE_WAIT_MS = 0` (xem `beforeEach`).** File này kiểm LƯỚI PHÁT HIỆN chồng lấn,
 *      tức đúng thế giới khi NỐI TIẾP HOÁ BỊ BỎ QUA. Với ngân sách chờ mặc định (180 s) hai cửa
 *      sổ CÙNG PHẠM VI không bao giờ chồng nhau được nữa — mọi ca ở đây sẽ hết giờ chứ không phải
 *      xanh. Ngân sách 0 tái lập chính xác thế giới cũ (người thứ hai không chờ, chạy NGOÀI khoá),
 *      và vì vậy file này chính là **ĐỐI CHỨNG chứng minh lưới cũ VẪN NỔ** — thứ mà "sổ cửa sổ
 *      luôn rỗng" một mình không phân biệt được với "sổ cửa sổ đã hỏng". Nối tiếp hoá với ngân
 *      sách mặc định được kiểm ở `wiring.processProbe.test.ts` ca 6.
 */
type Reading = { usedBytes: number; totalBytes: number; childBytes?: number } | null | "THROW";
const readings = vi.hoisted(() => [] as Array<{ usedBytes: number; totalBytes: number; childBytes?: number } | null | "THROW">);
/** PID giả của tiến trình CON — mọi thứ không phải `process.pid` (phạm vi `descendants`). */
const CHILD_PID = 999_001;
vi.mock("./vramProbe", () => ({
  readDeviceVram: async () => readings[0] ?? null,
  readDeviceVramUncached: async () => readings[0] ?? null,
  __clearProbeCache: () => {},
}));
vi.mock("./vramProcessProbe", () => ({
  readProcessVram: async () => {
    const r: Reading = readings.length > 1 ? readings.shift()! : (readings[0] ?? null);
    if (r === "THROW") throw new Error("đầu dò NÉM");
    if (!r) return null;
    const byPid = new Map<number, number>([[process.pid, r.usedBytes]]);
    if (r.childBytes !== undefined) byPid.set(CHILD_PID, r.childBytes);
    return {
      totalBytes: r.usedBytes + (r.childBytes ?? 0),
      byPid,
      byLuid: new Map<string, number>(),
      sampledAtMs: Date.now(),
    };
  },
}));

/** Nhật ký giả — một cửa sổ chồng lấn phải để lại DẤU VẾT, không được im lặng. */
const events = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("./vramEventLog", () => ({
  logVramEvent: (e: Record<string, unknown>) => { events.push(e); },
  flushVramEvents: async () => 0,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
}));

const MiB = 1024 * 1024;
const TOTAL = 32607 * MiB;
const dev = (usedMiB: number) => ({ usedBytes: usedMiB * MiB, totalBytes: TOTAL });

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  readings.length = 0;
  events.length = 0;
  process.env = { ...ORIGINAL_ENV };
  // ⚠ Xem điểm 2 của khối chú thích đầu file: 0 = KHÔNG chờ khoá ⇒ tái lập đúng thế giới "nối
  // tiếp hoá bị bỏ qua" mà chín ca dưới đây sinh ra để canh. Bỏ dòng này là mọi ca hết giờ.
  process.env.VRAM_MEASURE_WAIT_MS = "0";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("C-1 — hai cửa sổ đo CHỒNG NHAU: sổ thôi cộng trùng", () => {
  /**
   * Kịch bản tái hiện (broker + wiring THẬT, chỉ đầu dò là giả):
   *   thiết bị 1.000 → A xin (đọc 1.000) → B xin (đọc 1.000) → cả hai nạp xong, thiết bị 5.000
   *   → A commit (đọc 5.000) → B commit (đọc 5.000)
   * Delta THẬT của cả cặp = 4.000 MiB. Mỗi bên tự thấy `after − before` = 4.000 ⇒ sổ 8.000.
   */
  const overlap = () => {
    readings.push(dev(1000)); // A.before
    readings.push(dev(1000)); // B.before
    readings.push(dev(5000)); // A.after
    readings.push(dev(5000)); // B.after
  };

  it("★★ 1. tổng sổ KHÔNG được vượt delta thiết bị THẬT (bản lỗi ghi 8.000 cho 4.000 MiB)", async () => {
    overlap();
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const tA = await beginVramAllocation({ owner: "gguf:A", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    const tB = await beginVramAllocation({ owner: "gguf:B", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    await tA.commitMeasured();
    await tB.commitMeasured();

    const total = snapshot().leases.reduce((s, l) => s + (l.actualBytes ?? 0), 0);
    expect(total).toBeLessThanOrEqual(4000 * MiB);
  });

  it("2. CẢ HAI giấy phép bị đánh dấu 'đo hỏng' — không giấy phép nào được giữ một số bịa", async () => {
    overlap();
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const tA = await beginVramAllocation({ owner: "gguf:A", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    const tB = await beginVramAllocation({ owner: "gguf:B", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    await tA.commitMeasured();
    await tB.commitMeasured();

    for (const owner of ["gguf:A", "gguf:B"]) {
      const lease = snapshot().leases.find((l) => l.request.owner === owner);
      expect(lease, owner).toBeDefined();
      // KHÔNG BỊA SỐ: không chia tỉ lệ, không ước lượng bù — `actualBytes` đứng nguyên `null`.
      expect(lease!.actualBytes, owner).toBeNull();
      // … nhưng sổ phải NÓI RA rằng con số nó đang giữ là ước lượng KHÔNG xác minh được.
      expect(lease!.measureFailed, owner).toBe(true);
    }
  });

  it("3. DẤU VẾT: sự kiện measure_failed nêu ĐÍCH DANH cửa sổ đã chồng lên", async () => {
    overlap();
    const { beginVramAllocation } = await import("./vramWiring");

    const tA = await beginVramAllocation({ owner: "gguf:A", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    const tB = await beginVramAllocation({ owner: "gguf:B", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    await tA.commitMeasured();
    await tB.commitMeasured();

    const evA = events.find((e) => e.event === "measure_failed" && e.owner === "gguf:A");
    expect(evA).toBeDefined();
    const d = evA!.detail as Record<string, unknown>;
    expect(d.reason).toBe("overlapping-measure-window");
    // Người trực đọc nhật ký phải biết CHỒNG VỚI AI — không thì không điều tra được.
    expect(d.overlappedBy).toEqual(["gguf:B"]);
    // Và phải thấy con số SAI mà bản lỗi đã ghi, để đo được bán kính thiệt hại.
    expect(d.discardedDeltaBytes).toBe(4000 * MiB);
  });

  it("4. ĐỘT BIẾN — hai cửa sổ TUẦN TỰ (không chồng) vẫn commit số THẬT, KHÔNG bị gắn cờ", async () => {
    // A: 1.000 → 3.000 (2.000 MiB) ; B: 3.000 → 5.000 (2.000 MiB). Không lúc nào chồng nhau.
    readings.push(dev(1000)); // A.before
    readings.push(dev(3000)); // A.after
    readings.push(dev(3000)); // B.before
    readings.push(dev(5000)); // B.after

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const tA = await beginVramAllocation({ owner: "gguf:A", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    await tA.commitMeasured();
    const tB = await beginVramAllocation({ owner: "gguf:B", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    await tB.commitMeasured();

    const leases = snapshot().leases;
    expect(leases.find((l) => l.request.owner === "gguf:A")!.actualBytes).toBe(2000 * MiB);
    expect(leases.find((l) => l.request.owner === "gguf:B")!.actualBytes).toBe(2000 * MiB);
    expect(events.some((e) => e.event === "measure_failed")).toBe(false);
    // Tổng sổ = ĐÚNG delta thiết bị. Đây là ca chứng minh lưới không phải "gắn cờ tất".
    expect(leases.reduce((s, l) => s + (l.actualBytes ?? 0), 0)).toBe(4000 * MiB);
  });

  it("5. release() ĐÓNG cửa sổ — giấy phép đã TRẢ CHỖ không được đầu độc lượt đo SAU (đường tự lành)", async () => {
    readings.push(dev(1000)); // X.before
    readings.push(dev(1000)); // A.before   (X đã release TRƯỚC lượt này)
    readings.push(dev(3000)); // A.after
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    // X: mở cửa sổ rồi TRẢ CHỖ mà KHÔNG BAO GIỜ commit — đúng khuôn kbSyncScheduler/
    // localSidecarTrainer/aiLlmFinetuneSidecar (ba nơi CỐ Ý không gọi `commitMeasured()`).
    const tX = await beginVramAllocation({ owner: "sidecar:X", kind: "external-process", priority: "background", fileBytes: 100 * MiB });
    tX.release();

    const tA = await beginVramAllocation({ owner: "gguf:A", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    await tA.commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner === "gguf:A");
    expect(lease!.actualBytes).toBe(2000 * MiB);
    expect(lease!.measureFailed).toBeFalsy();
  });

  /**
   * ★★★ CA NÀY ĐÃ ĐỔI CÂU TRẢ LỜI Ở PHA 2A — và đây chính là điều Pha 2A tồn tại để làm.
   *
   * BẢN CŨ khẳng định: "lease NGOÀI TIẾN TRÌNH chưa trả chỗ VẪN làm hỏng phép đo trong tiến
   * trình" — đúng với thước cũ (`used` toàn thiết bị chỉ có MỘT tổng, không tách được 8.000 MiB
   * của tiến trình con ra khỏi delta của mình), nên `vramWiring` phải khai `measureFailed`.
   *
   * BẢN NÀY khẳng định điều NGƯỢC LẠI, vì cái thước đã đổi: bộ đếm `\GPU Process Memory` trả số
   * RIÊNG cho từng PID, và `vramWiring` đo hộ trong tiến trình bằng `byPid[process.pid]` (KHÔNG
   * gồm con) còn hộ ngoài tiến trình bằng `tổng cây − byPid[process.pid]` (CHỈ con). Hai tập PID
   * rời nhau ⇒ byte của sidecar KHÔNG THỂ xuất hiện trong hiệu số của model, nên gắn cờ cho nhau
   * nay là tự tay làm mù đúng phép đo vừa dựng ra.
   *
   * ⚠ ĐIỀU **KHÔNG** ĐỔI, và ca 6b ngay dưới canh nó: hai hộ NGOÀI tiến trình chồng nhau thì VẪN
   * hỏng cả hai — chúng dùng CHUNG một phạm vi và phạm vi đó KHÔNG có khoá nối tiếp.
   */
  it("6. ★ ĐỔI Ở PHA 2A: lease NGOÀI TIẾN TRÌNH chưa trả chỗ KHÔNG còn làm hỏng phép đo trong tiến trình", async () => {
    readings.push({ ...dev(1000), childBytes: 0 });        // X.before (sidecar vừa spawn)
    readings.push({ ...dev(1000), childBytes: 0 });        // A.before
    readings.push({ ...dev(3000), childBytes: 8000 * MiB }); // A.after — con nạp 8.000, ta nạp 2.000
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    await beginVramAllocation({ owner: "sidecar:vision", kind: "external-process", priority: "interactive", fileBytes: 7825 * MiB });
    const tA = await beginVramAllocation({ owner: "gguf:A", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    await tA.commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner === "gguf:A");
    // KHÔNG nuốt 8.000 MiB của sidecar (biến thể "tệ hơn": con thoát, thiết bị tụt, sổ KHÔNG tụt,
    // và `recordActual()` đóng đinh con số đó vào nấc "learned")… nhưng nay cũng KHÔNG mất số:
    // đúng 2.000 MiB của CHÍNH tiến trình này.
    expect(lease!.actualBytes).toBe(2000 * MiB);
    expect(lease!.measureFailed).toBeFalsy();
    expect(events.some((e) => e.event === "measure_failed" && e.owner === "gguf:A")).toBe(false);
  });

  it("6b. …nhưng HAI hộ NGOÀI tiến trình chồng nhau thì VẪN hỏng cả hai (cùng phạm vi, không có khoá)", async () => {
    readings.push({ ...dev(1000), childBytes: 0 });         // X.before
    readings.push({ ...dev(1000), childBytes: 0 });         // Y.before
    readings.push({ ...dev(1000), childBytes: 9000 * MiB }); // X.after
    readings.push({ ...dev(1000), childBytes: 9000 * MiB }); // Y.after
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const tX = await beginVramAllocation({ owner: "sidecar:vision", kind: "external-process", priority: "interactive", fileBytes: 7825 * MiB });
    const tY = await beginVramAllocation({ owner: "cron:kb-sync", kind: "external-process", priority: "background", fileBytes: 1200 * MiB });
    await tX.commitMeasured();
    await tY.commitMeasured();

    for (const owner of ["sidecar:vision", "cron:kb-sync"]) {
      const l = snapshot().leases.find((x) => x.request.owner === owner);
      expect(l!.actualBytes, owner).toBeNull();
      expect(l!.measureFailed, owner).toBe(true);
    }
    const ev = events.find((e) => e.event === "measure_failed" && e.owner === "sidecar:vision");
    expect((ev!.detail as Record<string, unknown>).overlappedBy).toEqual(["cron:kb-sync"]);
  });

  it("7. bộ ước lượng KHÔNG được học con số chồng lấn (nấc 'learned' đóng đinh vĩnh viễn)", async () => {
    overlap();
    const { beginVramAllocation } = await import("./vramWiring");
    const { estimateBytesFor } = await import("./vramEstimator");

    const tA = await beginVramAllocation({ owner: "gguf:A", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    const tB = await beginVramAllocation({ owner: "gguf:B", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    await tA.commitMeasured();
    await tB.commitMeasured();

    // Bản lỗi gọi `recordActual("gguf:A", 4000 MiB)` ⇒ mọi lượt SAU dùng nấc "learned" 4.000 MiB
    // cho một model 2.000 MiB, và số đó sống tới hết đời tiến trình.
    const est = await estimateBytesFor("gguf:A", { fileBytes: 2000 * MiB });
    expect(est.source).toBe("file-size");
    expect(est.bytes).toBe(2000 * MiB);
  });

  it("8. cùng ĐƯỜNG TỰ LÀNH Task 3: lease chồng-lấn rơi khỏi pendingBytes (không nới băng dung sai vĩnh viễn)", async () => {
    overlap();
    const { beginVramAllocation } = await import("./vramWiring");
    const tA = await beginVramAllocation({ owner: "gguf:A", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    const tB = await beginVramAllocation({ owner: "gguf:B", kind: "gguf-model", priority: "interactive", fileBytes: 2000 * MiB });
    await tA.commitMeasured();
    await tB.commitMeasured();

    readings.length = 0;
    readings.push(dev(5000));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();
    const res = await reconcileOnce();
    warn.mockRestore();

    // `isLoadingLease()` = `actualBytes === null && !measureFailed` ⇒ hai lease đo-hỏng KHÔNG
    // còn được tính là "đang nạp": không nới băng dung sai âm, và KHÔNG khoá lá chắn HOÃN chụp
    // nền của Task 7 (nếu còn tính, nền bị khoá tới lúc khởi động lại tiến trình).
    expect(res.pendingBytes).toBe(0);
  });

  /**
   * ⚠⚠ CA QUAN TRỌNG NHẤT VỀ "NHÁNH MỚI KÍCH HOẠT SAI THÌ BAO LÂU TỰ LÀNH".
   * Một cửa sổ RÒ (mở mà không ai đóng) làm MỌI phép đo sau đó của tiến trình bị gắn cờ sai và
   * KHÔNG tự lành cho tới khi khởi động lại. Ca này đi qua CẢ NĂM nhánh thoát của giấy phép.
   */
  it("9. KHÔNG RÒ CỬA SỔ — commit · release · đầu dò trước null · đầu dò sau null · đầu dò NÉM", async () => {
    const { beginVramAllocation, __openMeasureWindowCount } = await import("./vramWiring");
    const opts = (owner: string) =>
      ({ owner, kind: "gguf-model", priority: "interactive", fileBytes: MiB }) as const;

    readings.length = 0; readings.push(dev(1000), dev(2000));
    await (await beginVramAllocation(opts("a:commit"))).commitMeasured();
    expect(__openMeasureWindowCount(), "sau commit").toBe(0);

    readings.length = 0; readings.push(dev(2000));
    (await beginVramAllocation(opts("b:release"))).release();
    expect(__openMeasureWindowCount(), "sau release (không commit)").toBe(0);

    readings.length = 0; readings.push(null);
    await (await beginVramAllocation(opts("c:before-null"))).commitMeasured();
    expect(__openMeasureWindowCount(), "đầu dò TRƯỚC trả null").toBe(0);

    readings.length = 0; readings.push(dev(2000), null);
    await (await beginVramAllocation(opts("d:after-null"))).commitMeasured();
    expect(__openMeasureWindowCount(), "đầu dò SAU trả null").toBe(0);

    readings.length = 0; readings.push(dev(2000), "THROW");
    await (await beginVramAllocation(opts("e:throw"))).commitMeasured();
    expect(__openMeasureWindowCount(), "đầu dò SAU NÉM (catch ngoài cùng)").toBe(0);
  });
});
