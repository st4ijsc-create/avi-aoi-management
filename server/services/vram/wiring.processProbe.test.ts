/**
 * ★★★ Pha 2A Task 3 — `actualBytes` đo bằng BỘ ĐẾM THEO TIẾN TRÌNH (cổng T5-11).
 *
 * ĐIỀU KIỆN CỔNG mà file này canh: **hai lượt nạp CHỒNG NHAU ở HAI TIẾN TRÌNH phải cho HAI con số
 * riêng, mỗi con số khớp model của mình.** Với thước cũ (`used` TOÀN THIẾT BỊ) điều đó BẤT KHẢ:
 * thiết bị chỉ có MỘT tổng, nên `vramWiring` phải khai `measureFailed` cho cả hai (đó chính là
 * `wiring.doubleCount.test.ts`). Với bộ đếm `\GPU Process Memory` mỗi PID có số riêng, nên phép
 * quy trách nhiệm trở thành ĐO ĐƯỢC — miễn là hai cửa sổ nằm ở hai PHẠM VI ĐO khác nhau.
 *
 * ⚠ HAI PHẠM VI, VÀ RANH GIỚI LÀ RANH GIỚI VẬT LÝ CỦA BỘ ĐẾM (xem `VramMeasureScope` trong
 * `vramWiring.ts`):
 *   • `self`        = `byPid[process.pid]`            → mọi hộ TRONG tiến trình;
 *   • `descendants` = `totalBytes − byPid[process.pid]` → hộ `external-process` (cộng theo CÂY, Đ2).
 * Hai tập PID RỜI NHAU ⇒ hai cửa sổ khác phạm vi chồng nhau vẫn cho hai số đúng.
 *
 * ⚠⚠ VÌ SAO PHẢI CÓ FIXTURE 17.000 MiB (ràng buộc toàn cục 7): số cỡ 600 MiB không phân biệt được
 * "model lớn" với "backend + context + nhiễu nền", và một lần đã khoá đúng một hành vi hỏng lại
 * thành "đúng". Ca ★★ dưới đây dùng 17.000 MiB cho model lớn và 7.825 MiB cho sidecar — hai con
 * số ĐO ĐƯỢC trên máy này, không phải số đẹp.
 *
 * ⚠ QUY ƯỚC MODULE-IDENTITY (giống `wiring.doubleCount.test.ts`): mã sản xuất `import()` ĐỘNG
 * `./vramBroker`/`./vramMeasureLock`, nên MỌI lượt import (cả sản xuất lẫn sổ cái) phải nằm TRONG
 * thân test, SAU cùng một `vi.resetModules()` — không thì test soi vào MỘT SỔ KHÁC và xanh/đỏ đều
 * sai lý do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MiB = 1024 * 1024;
/** PID giả của tiến trình CON (sidecar/cron/trainer) — mọi thứ không phải `process.pid`. */
const CHILD_PID = 999_001;
const CHILD_PID_2 = 999_002;

/**
 * Một lượt đọc bộ đếm: `self` = byte của CHÍNH tiến trình này, `child`/`child2` = byte của tiến
 * trình con. `null` ⇒ đầu dò trả null; `"THROW"` ⇒ đầu dò NÉM (nhánh thoát thứ năm).
 *
 * ⚠ I-1 — `self: null` nghĩa là **mẫu HỢP LỆ nhưng KHÔNG CÓ khoá của tiến trình này** trong
 * `byPid`. Đó là thứ hoàn toàn khác `self: 0` (có khoá, giá trị 0 = thật sự không chiếm byte nào),
 * và `parseProcessCounters` CỐ Ý trả mẫu hợp lệ trong ca đó. Bản giả phải dựng được cả hai, nếu
 * không ca I-1 không tồn tại.
 */
type Sample = { self: number | null; child?: number; child2?: number } | null | "THROW";

/**
 * Hàng đợi mẫu giả. Ngữ nghĩa CỐ Ý giống `wiring.doubleCount.test.ts`: còn >1 phần tử thì SHIFT,
 * còn đúng 1 thì lặp lại mãi — nhờ vậy một fixture ngắn phục vụ được cả những lượt đọc phát sinh.
 */
const readings = vi.hoisted(() => [] as Array<{ self: number | null; child?: number; child2?: number } | null | "THROW">);

/** Bao nhiêu lượt `readProcessVram()` đã chạy — dùng để chứng minh đường đo KHÔNG chạm vramProbe. */
const probeCalls = vi.hoisted(() => ({ process: 0, device: 0 }));

/**
 * Móc chạy NGAY TRƯỚC khi một lượt đọc trả kết quả. Ca 8 cần dựng một thứ tự mà lời gọi thường
 * không cho phép (người giữ khoá đóng cửa sổ ĐÚNG giữa lúc người bỏ cuộc đang đọc đầu đo "trước"),
 * và đó là cách DUY NHẤT tách được phán quyết của KHOÁ khỏi phán quyết của SỔ CỬA SỔ.
 */
const beforeRead = vi.hoisted(() => ({ fn: null as null | (() => void) }));

vi.mock("./vramProcessProbe", () => ({
  readProcessVram: async (roots: readonly number[]) => {
    probeCalls.process++;
    if (beforeRead.fn) { const f = beforeRead.fn; beforeRead.fn = null; f(); }
    // Đường đo LUÔN lấy gốc là chính tiến trình này (Đ2 — cộng theo cây từ gốc đó).
    expect(roots).toEqual([process.pid]);
    const r: Sample = readings.length > 1 ? readings.shift()! : (readings[0] ?? null);
    if (r === "THROW") throw new Error("đầu dò theo tiến trình NÉM");
    if (r === null) return null;
    const byPid = new Map<number, number>();
    if (r.self !== null) byPid.set(process.pid, r.self);
    if (r.child !== undefined) byPid.set(CHILD_PID, r.child);
    if (r.child2 !== undefined) byPid.set(CHILD_PID_2, r.child2);
    let totalBytes = 0;
    for (const v of byPid.values()) totalBytes += v;
    return { totalBytes, byPid, byLuid: new Map<string, number>(), sampledAtMs: Date.now() };
  },
  /**
   * ★ Pha 2A Task 6 — BẢN GIẢ CỦA BIÊN LẮNG, cố ý KHÔNG chờ. Bộ test này không đo bộ đếm thật nên
   * chờ 250 ms mỗi lượt `commitMeasured()` chỉ là thời gian chết. Biên lắng THẬT được canh ở
   * `wiring.settle.test.ts` (thứ tự gọi + sàn của hằng số) — nơi duy nhất được phép khẳng định nó.
   * ⚠ PHẢI khai ở MỌI bản giả của module này: `vramWiring` để lời gọi NÉM nếu thiếu (không nuốt).
   */
  awaitCounterSettle: async () => {},
}));

/**
 * Đầu dò TOÀN THIẾT BỊ — giữ nguyên cho reconciler/nền. Bộ đếm `probeCalls.device` là lưới canh
 * Đ4: đường đo `actualBytes` KHÔNG được chạm vào đây một lần nào.
 */
vi.mock("./vramProbe", () => ({
  readDeviceVram: async () => { probeCalls.device++; return { usedBytes: 0, totalBytes: 32607 * MiB, source: "native" as const }; },
  readDeviceVramUncached: async () => { probeCalls.device++; return { usedBytes: 0, totalBytes: 32607 * MiB, source: "native" as const }; },
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

beforeEach(() => {
  vi.resetModules();
  readings.length = 0;
  events.length = 0;
  probeCalls.process = 0;
  probeCalls.device = 0;
  beforeRead.fn = null;
  process.env = { ...ORIGINAL_ENV };
});

/**
 * Nhường một vòng lặp sự kiện. `closeWindow()` GIẢI lời hứa đang giữ khoá một cách ĐỒNG BỘ, nhưng
 * `withMeasureWindow` chỉ chạy `finally { nhaKhoa() }` ở microtask kế — nên `measureWindowDepth()`
 * đọc ngay lập tức sau `release()` vẫn thấy 1. Đó KHÔNG phải rò: người xếp hàng được trao khoá
 * ngay sau đó. Ca kiểm rò phải nhường một vòng rồi mới đọc, nếu không nó đỏ vì lý do SAI.
 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const inProcess = (owner: string, fileMiB: number) =>
  ({ owner, kind: "gguf-model", priority: "interactive", fileBytes: fileMiB * MiB }) as const;
const external = (owner: string, fileMiB: number) =>
  ({ owner, kind: "external-process", priority: "interactive", fileBytes: fileMiB * MiB }) as const;

describe("Pha 2A — actualBytes đến từ bộ đếm THEO TIẾN TRÌNH", () => {
  /**
   * ★★ CA QUAN TRỌNG NHẤT CỦA CẢ PHA — hai lượt nạp CHỒNG NHAU ở hai tiến trình.
   *
   * Kịch bản: model 17.000 MiB nạp TRONG tiến trình này, sidecar thị giác 7.825 MiB spawn ở tiến
   * trình CON, cửa sổ hai bên LỒNG nhau (`begin A → begin B → commit B → commit A`).
   *
   * Trước Pha 2A: hai đầu đo đều là `used` toàn thiết bị ⇒ mỗi bên tự thấy delta 24.825 MiB, và
   * `openMeasureWindow` (đánh dấu chồng lấn KHÔNG phân biệt phạm vi) khai `measureFailed` cho CẢ
   * HAI ⇒ **không con số nào**. Đây là ca đỏ-trước-xanh-sau của Task 3.
   */
  it("★★ 1. hai lượt nạp CHỒNG NHAU ở HAI tiến trình ⇒ HAI actualBytes riêng, mỗi số khớp model của mình", async () => {
    readings.push({ self: 1_000 * MiB, child: 0 });                    // A.before (self=1.000)
    readings.push({ self: 1_000 * MiB, child: 0 });                    // B.before (con=0, chưa spawn)
    readings.push({ self: 18_000 * MiB, child: 7_825 * MiB });         // B.after  (con đã nạp xong)
    readings.push({ self: 18_000 * MiB, child: 7_825 * MiB });         // A.after  (self +17.000)

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const tA = await beginVramAllocation(inProcess("gguf:big-17000", 17_000));
    const tB = await beginVramAllocation(external("sidecar:vision", 7_825));
    await tB.commitMeasured();
    await tA.commitMeasured();

    const leases = snapshot().leases;
    const a = leases.find((l) => l.request.owner === "gguf:big-17000");
    const b = leases.find((l) => l.request.owner === "sidecar:vision");

    // HAI con số RIÊNG, mỗi con số của model MÌNH — không phải 24.825 MiB cộng trùng, cũng không
    // phải `null` vì bị gắn cờ chồng lấn.
    expect(a!.actualBytes, "model trong tiến trình").toBe(17_000 * MiB);
    expect(b!.actualBytes, "sidecar ở tiến trình con").toBe(7_825 * MiB);
    expect(a!.measureFailed).toBeFalsy();
    expect(b!.measureFailed).toBeFalsy();
    // Tổng sổ = ĐÚNG lượng thiết bị tăng thêm, không nhân đôi.
    expect(leases.reduce((s, l) => s + (l.actualBytes ?? 0), 0)).toBe(24_825 * MiB);
  });

  it("2. THƯỚC được ghi vào giấy phép VÀ vào sự kiện — Đ4 kiểm được bằng dữ liệu", async () => {
    readings.push({ self: 1_000 * MiB });
    readings.push({ self: 3_000 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    await (await beginVramAllocation(inProcess("gguf:A", 2_000))).commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner === "gguf:A");
    expect(lease!.actualBytes).toBe(2_000 * MiB);
    expect(lease!.measureSource).toBe("process-delta");

    const ev = events.find((e) => e.event === "commit" && e.owner === "gguf:A");
    expect(ev).toBeDefined();
    const d = ev!.detail as Record<string, unknown>;
    expect(d.measureSource).toBe("process-delta");
    expect(d.measureScope).toBe("self");
    // ⚠ Đ4 — sự kiện commit KHÔNG được mang số của thước KIA: `deviceUsedBytes` lệch +505…+511 MiB
    // so với bộ đếm, để nó nằm cạnh `actualBytes` là mời người sau trừ hai số không so được.
    expect(ev!.deviceUsedBytes).toBeUndefined();
  });

  /**
   * ⚠⚠ Đ4 (ràng buộc toàn cục 2) — LƯỚI CẤU TRÚC, không phải lời hứa trong chú thích: nếu đường
   * đo `actualBytes` chạm vào `vramProbe` dù chỉ MỘT lượt, con số của hai thước lệch nhau
   * +505…+511 MiB đã ở cùng một chỗ và chỉ còn chờ ai đó trừ chúng cho nhau.
   */
  it("3. Đ4 — đường đo actualBytes KHÔNG chạm đầu dò TOÀN THIẾT BỊ một lượt nào", async () => {
    readings.push({ self: 1_000 * MiB });
    readings.push({ self: 3_000 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const t = await beginVramAllocation(inProcess("gguf:A", 2_000));
    await t.commitMeasured();

    expect(probeCalls.process, "hai đầu đo đều đi qua bộ đếm theo tiến trình").toBe(2);
    expect(probeCalls.device, "KHÔNG lượt nào chạm nvidia-smi/getVramState").toBe(0);
  });

  it("4. đầu dò theo tiến trình trả NULL ⇒ measureFailed, KHÔNG commit, KHÔNG recordActual", async () => {
    readings.push(null); // cả before lẫn after đều null

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { estimateBytesFor } = await import("./vramEstimator");

    await (await beginVramAllocation(inProcess("gguf:null-probe", 2_000))).commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner === "gguf:null-probe");
    expect(lease!.actualBytes).toBeNull();
    expect(lease!.measureFailed).toBe(true);
    expect(lease!.measureSource).toBe("none");

    const ev = events.find((e) => e.event === "measure_failed");
    expect((ev!.detail as Record<string, unknown>).reason).toBe("before-probe-null");
    expect((ev!.detail as Record<string, unknown>).measureSource).toBe("none");

    // Nấc "learned" KHÔNG được nhiễm: ước lượng phải vẫn là file-size.
    const est = await estimateBytesFor("gguf:null-probe", { fileBytes: 2_000 * MiB });
    expect(est.source).toBe("file-size");
  });

  it("5. đầu dò trả null Ở ĐẦU ĐO SAU ⇒ cũng measureFailed (không câm tới lúc release)", async () => {
    readings.push({ self: 1_000 * MiB });
    readings.push(null);

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    await (await beginVramAllocation(inProcess("gguf:null-after", 2_000))).commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner === "gguf:null-after");
    expect(lease!.actualBytes).toBeNull();
    expect(lease!.measureFailed).toBe(true);
    expect((events.find((e) => e.event === "measure_failed")!.detail as Record<string, unknown>).reason)
      .toBe("after-probe-null");
  });

  /**
   * ★ NỐI TIẾP HOÁ (điều kiện Đ1) — hai lượt nạp trong CÙNG tiến trình KHÔNG tách được bằng bộ
   * đếm (một PID = một số), nên khoá của Task 2 phải làm chúng thành TUẦN TỰ. Kết quả: cả hai
   * đều có số THẬT của riêng mình — thứ mà trước Pha 2A là bất khả.
   *
   * ⚠ `beginVramAllocation()` của B CHỜ tới khi A đóng cửa sổ, nên KHÔNG được `await` nó trước
   * `tA.commitMeasured()` — đó không phải mẹo test mà chính là hình dạng của việc nối tiếp hoá.
   */
  it("★ 6. hai lượt nạp trong CÙNG tiến trình bị NỐI TIẾP ⇒ cả hai vẫn có số THẬT riêng", async () => {
    readings.push({ self: 1_000 * MiB });   // A.before
    readings.push({ self: 3_000 * MiB });   // A.after  (+2.000)
    readings.push({ self: 3_000 * MiB });   // B.before
    readings.push({ self: 4_500 * MiB });   // B.after  (+1.500)

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { measureWindowDepth } = await import("./vramMeasureLock");

    const tA = await beginVramAllocation(inProcess("gguf:A", 2_000));
    const pB = beginVramAllocation(inProcess("gguf:B", 1_500)); // XẾP HÀNG, chưa vào được
    await new Promise((r) => setTimeout(r, 0));
    expect(measureWindowDepth(), "A đang giữ cửa sổ").toBe(1);

    await tA.commitMeasured();
    const tB = await pB;                     // A nhả ⇒ B vào
    await tB.commitMeasured();

    const leases = snapshot().leases;
    expect(leases.find((l) => l.request.owner === "gguf:A")!.actualBytes).toBe(2_000 * MiB);
    expect(leases.find((l) => l.request.owner === "gguf:B")!.actualBytes).toBe(1_500 * MiB);
    expect(events.some((e) => e.event === "measure_failed")).toBe(false);
    expect(measureWindowDepth(), "khoá phải được nhả hết").toBe(0);
  });

  /**
   * ★★★ CA ĐỐI CHỨNG BẮT BUỘC (phán xử của Task 2 giao lại cho Task 3) — **LƯỚI CŨ VẪN NỔ**.
   *
   * Khi nối tiếp hoá chạy đúng, sổ `openMeasureWindows` LUÔN RỖNG cho phạm vi `self`. Một lưới
   * không bao giờ nổ thì KHÔNG PHÂN BIỆT ĐƯỢC với một lưới đã hỏng — nên phải có một ca cố ý bỏ
   * qua nối tiếp hoá và đòi lưới cũ nổ. `VRAM_MEASURE_WAIT_MS=0` là đúng thế giới đó: người thứ
   * hai không chờ, chạy NGOÀI khoá, hai cửa sổ thật sự chồng nhau.
   */
  it("★★★ 7. ĐỐI CHỨNG — bỏ qua nối tiếp hoá (ngân sách chờ 0) thì LƯỚI CŨ VẪN NỔ", async () => {
    process.env.VRAM_MEASURE_WAIT_MS = "0";
    readings.push({ self: 1_000 * MiB });   // A.before
    readings.push({ self: 1_000 * MiB });   // B.before
    readings.push({ self: 5_000 * MiB });   // A.after
    readings.push({ self: 5_000 * MiB });   // B.after

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const tA = await beginVramAllocation(inProcess("gguf:A", 2_000));
    const tB = await beginVramAllocation(inProcess("gguf:B", 2_000)); // KHÔNG chờ — chạy ngoài khoá
    await tA.commitMeasured();
    await tB.commitMeasured();

    for (const owner of ["gguf:A", "gguf:B"]) {
      const l = snapshot().leases.find((x) => x.request.owner === owner);
      expect(l!.actualBytes, owner).toBeNull();
      expect(l!.measureFailed, owner).toBe(true);
    }
    // Lưới CŨ (sổ cửa sổ chồng lấn) phải là thứ nổ, và phải nêu ĐÍCH DANH — không phải im lặng.
    const evA = events.find((e) => e.event === "measure_failed" && e.owner === "gguf:A");
    expect((evA!.detail as Record<string, unknown>).reason).toBe("overlapping-measure-window");
    expect((evA!.detail as Record<string, unknown>).overlappedBy).toEqual(["gguf:B"]);
  });

  /**
   * ★★ HAI LƯỚI, HAI PHÁN QUYẾT ĐỘC LẬP — ca này cô lập phán quyết của KHOÁ.
   *
   * Ca 7 ở trên cho cả hai lưới cùng nổ, và sổ cửa sổ (cụ thể hơn) thắng. Nhưng nhánh
   * `measure-window-not-exclusive` KHÔNG được phép chỉ là "bản sao mờ" của nhánh chồng lấn: nó
   * phải tự đứng được, nếu không thì gỡ nó ra chẳng ca nào đỏ và nó là mã chết.
   *
   * Thứ tự dựng ra ở đây: B hết ngân sách chờ (⇒ chạy NGOÀI khoá, `measurable=false` vĩnh viễn cho
   * cửa sổ đó), rồi người đang giữ khoá ĐÓNG cửa sổ đúng trong lúc B đọc đầu đo "trước" — nên khi
   * B mở cửa sổ của mình, sổ `openMeasureWindows` KHÔNG thấy ai. Chỉ còn phán quyết của khoá lên
   * tiếng. Không có nhánh này thì B commit một con số nó KHÔNG chứng minh được là của mình.
   */
  it("★★ 8. hết ngân sách chờ ⇒ measureFailed với lý do RIÊNG, cả khi sổ cửa sổ không thấy gì", async () => {
    readings.push({ self: 1_000 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { estimateBytesFor } = await import("./vramEstimator");

    // A giữ khoá và giữ cửa sổ (ngân sách mặc định).
    const tA = await beginVramAllocation(inProcess("gguf:holder", 1_000));

    process.env.VRAM_MEASURE_WAIT_MS = "0"; // B không chờ — bỏ cuộc ngay, chạy ngoài khoá
    readings.length = 0;
    readings.push({ self: 2_000 * MiB });   // B.before
    readings.push({ self: 2_500 * MiB });   // B.after
    // ĐÓNG cửa sổ của A ngay giữa lượt đọc đầu đo "trước" của B ⇒ hai cửa sổ KHÔNG chồng nhau
    // trong sổ, nhưng B vẫn đã chạy ngoài khoá.
    beforeRead.fn = () => { tA.release(); };

    const tB = await beginVramAllocation(inProcess("gguf:victim", 500));
    await tB.commitMeasured();

    const lease = snapshot().leases.find((l) => l.request.owner === "gguf:victim");
    expect(lease!.actualBytes).toBeNull();
    expect(lease!.measureFailed).toBe(true);
    const ev = events.find((e) => e.event === "measure_failed" && e.owner === "gguf:victim");
    expect((ev!.detail as Record<string, unknown>).reason).toBe("measure-window-not-exclusive");
    expect((ev!.detail as Record<string, unknown>).discardedDeltaBytes).toBe(500 * MiB);

    // Nấc "learned" KHÔNG được nhiễm bởi một con số không cô lập được.
    const est = await estimateBytesFor("gguf:victim", { fileBytes: 500 * MiB });
    expect(est.source).toBe("file-size");
  });

  /**
   * Phạm vi `descendants` KHÔNG có khoá nối tiếp (xem `VramMeasureScope`) — có chủ ý, vì ba điểm
   * gọi ngoài tiến trình CỐ Ý không bao giờ commit và sẽ giữ khoá suốt cả job. Đổi lại nó vẫn
   * phải có LƯỚI PHÁT HIỆN: hai cửa sổ ngoài tiến trình chồng nhau thì cả hai mất số.
   */
  it("9. hai hộ NGOÀI tiến trình chồng nhau ⇒ CẢ HAI measureFailed (cùng phạm vi, không có khoá)", async () => {
    readings.push({ self: 1_000 * MiB, child: 0, child2: 0 });                        // X.before
    readings.push({ self: 1_000 * MiB, child: 0, child2: 0 });                        // Y.before
    readings.push({ self: 1_000 * MiB, child: 7_825 * MiB, child2: 1_200 * MiB });    // X.after
    readings.push({ self: 1_000 * MiB, child: 7_825 * MiB, child2: 1_200 * MiB });    // Y.after

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    const tX = await beginVramAllocation(external("sidecar:vision", 7_825));
    const tY = await beginVramAllocation(external("cron:kb-sync", 1_200));
    await tX.commitMeasured();
    await tY.commitMeasured();

    for (const owner of ["sidecar:vision", "cron:kb-sync"]) {
      const l = snapshot().leases.find((x) => x.request.owner === owner);
      expect(l!.actualBytes, owner).toBeNull();
      expect(l!.measureFailed, owner).toBe(true);
    }
    const ev = events.find((e) => e.event === "measure_failed" && e.owner === "sidecar:vision");
    expect((ev!.detail as Record<string, unknown>).reason).toBe("overlapping-measure-window");
    expect((ev!.detail as Record<string, unknown>).measureScope).toBe("descendants");
  });

  /**
   * ⚠ HỘ NGOÀI TIẾN TRÌNH KHÔNG ĐƯỢC GIỮ KHOÁ NỐI TIẾP. Nếu nó giữ, một job huấn luyện
   * (`localSidecarTrainer`, hàng chục phút, CỐ Ý không bao giờ `commitMeasured()`) sẽ chặn MỌI
   * lượt nạp model của cả tiến trình cho tới khi hết ngân sách 180 s — đổi hành vi cấp phát, thứ
   * Pha 2A tự cấm mình làm. Ca này canh trực tiếp: cửa sổ ngoài tiến trình đang MỞ mà lượt nạp
   * trong tiến trình vẫn vào ngay và vẫn đo được.
   */
  it("★ 10. cửa sổ NGOÀI tiến trình đang mở KHÔNG chặn lượt nạp trong tiến trình", async () => {
    readings.push({ self: 1_000 * MiB, child: 0 });      // trainer.before
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { measureWindowDepth } = await import("./vramMeasureLock");

    // Job huấn luyện: mở cửa sổ rồi KHÔNG BAO GIỜ commit (đúng khuôn ba điểm gọi thật).
    const trainer = await beginVramAllocation({
      owner: "sidecar:local-trainer", kind: "external-process", priority: "background",
      fileBytes: 4_000 * MiB, ttlMs: 3_600_000,
    });
    expect(measureWindowDepth(), "hộ ngoài tiến trình KHÔNG được giữ khoá").toBe(0);

    readings.length = 0;
    readings.push({ self: 1_000 * MiB, child: 4_000 * MiB });   // A.before
    readings.push({ self: 3_000 * MiB, child: 4_000 * MiB });   // A.after
    const tA = await beginVramAllocation(inProcess("gguf:A", 2_000));
    await tA.commitMeasured();

    const a = snapshot().leases.find((l) => l.request.owner === "gguf:A");
    // +2.000 của CHÍNH tiến trình này — 4.000 MiB của tiến trình con KHÔNG bị nuốt vào.
    expect(a!.actualBytes).toBe(2_000 * MiB);
    expect(a!.measureFailed).toBeFalsy();
    trainer.release();
  });

  /**
   * ⚠⚠ CA "NHÁNH MỚI KÍCH HOẠT SAI THÌ BAO LÂU TỰ LÀNH" — áp cho KHOÁ, không chỉ cho cửa sổ.
   * Một khoá rò làm CẢ TIẾN TRÌNH chờ 180 s ở mỗi lượt nạp, tới lúc khởi động lại. Ca này đi qua
   * CẢ NĂM nhánh thoát và đòi cả hai thứ (`sổ cửa sổ` và `khoá`) về 0 sau mỗi nhánh.
   */
  it("★★ 11. KHÔNG RÒ CỬA SỔ **VÀ KHÔNG RÒ KHOÁ** ở cả năm nhánh thoát", async () => {
    const { beginVramAllocation, __openMeasureWindowCount } = await import("./vramWiring");
    const { measureWindowDepth } = await import("./vramMeasureLock");
    const check = async (nhan: string) => {
      await tick();
      expect(__openMeasureWindowCount(), `cửa sổ — ${nhan}`).toBe(0);
      expect(measureWindowDepth(), `khoá — ${nhan}`).toBe(0);
    };

    readings.length = 0; readings.push({ self: 1_000 * MiB }, { self: 2_000 * MiB });
    await (await beginVramAllocation(inProcess("a:commit", 1))).commitMeasured();
    await check("sau commit");

    readings.length = 0; readings.push({ self: 2_000 * MiB });
    (await beginVramAllocation(inProcess("b:release", 1))).release();
    await check("sau release (không commit)");

    readings.length = 0; readings.push(null);
    await (await beginVramAllocation(inProcess("c:before-null", 1))).commitMeasured();
    await check("đầu dò TRƯỚC trả null");

    readings.length = 0; readings.push({ self: 2_000 * MiB }, null);
    await (await beginVramAllocation(inProcess("d:after-null", 1))).commitMeasured();
    await check("đầu dò SAU trả null");

    readings.length = 0; readings.push({ self: 2_000 * MiB }, "THROW");
    await (await beginVramAllocation(inProcess("e:throw", 1))).commitMeasured();
    await check("đầu dò SAU NÉM (catch ngoài cùng)");
  });

  /**
   * ĐỘT BIẾN đối chứng cho ca 11: sau khi một cửa sổ đã đóng đúng cách, lượt nạp KẾ TIẾP phải
   * vào được NGAY (không phải chờ hết ngân sách) và phải đo được. Nếu khoá rò ở bất kỳ nhánh nào
   * bên trên, ca này đỏ vì hết giờ chứ không vì sai số.
   */
  it("12. sau năm nhánh thoát, lượt nạp kế tiếp vẫn vào NGAY và vẫn đo được", async () => {
    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");

    readings.length = 0; readings.push({ self: 1_000 * MiB }, "THROW");
    await (await beginVramAllocation(inProcess("x:throw", 1))).commitMeasured();

    readings.length = 0; readings.push({ self: 1_000 * MiB }, { self: 1_700 * MiB });
    const t = await beginVramAllocation(inProcess("gguf:sau-do", 700));
    await t.commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "gguf:sau-do");
    expect(l!.actualBytes).toBe(700 * MiB);
    expect(l!.measureSource).toBe("process-delta");
  });

  it("13. delta ÂM trên bộ đếm vẫn là 'đo hỏng' (không commit số âm)", async () => {
    readings.push({ self: 20_000 * MiB });
    readings.push({ self: 4_000 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    await (await beginVramAllocation(inProcess("gguf:am", 606))).commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "gguf:am");
    expect(l!.actualBytes).toBeNull();
    expect(l!.measureFailed).toBe(true);
    expect((events.find((e) => e.event === "measure_failed")!.detail as Record<string, unknown>).measuredDeltaBytes)
      .toBe(-16_000 * MiB);
  });

  it("14. delta BẰNG 0 vẫn là số liệu THẬT và vẫn được commit (hộ chạy CPU, bộ đếm CÓ thấy ta)", async () => {
    readings.push({ self: 4_000 * MiB });
    readings.push({ self: 4_000 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    await (await beginVramAllocation(inProcess("reranker:cpu", 606))).commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "reranker:cpu");
    expect(l!.actualBytes).toBe(0);
    expect(l!.measureSource).toBe("process-delta");
    expect(l!.measureFailed).toBeFalsy();
  });

  /**
   * ★★★ I-1 (review vòng 1) — MẪU HỢP LỆ NHƯNG KHÔNG CÓ KHOÁ CỦA TA ≠ 0 BYTE.
   *
   * `parseProcessCounters` CỐ Ý trả mẫu hợp lệ khi không PID nào khớp, nên `byPid.get(self) ?? 0`
   * biến "bộ đếm không thấy ta" thành "ta chiếm 0 byte". Hậu quả dây chuyền: `commit(0)` kèm
   * `measureSource: "process-delta"` (KHAI LÀ ĐO ĐƯỢC) rồi `recordActual(owner, 0)` đóng đinh nấc
   * `learned = 0` tới hết đời tiến trình. Ở Pha 2B: ước lượng 0 = dư địa VÔ HẠN = không bao giờ
   * từ chối = OOM. Ca này canh đúng chỗ đó.
   */
  it("★★★ 15. I-1: mẫu HỢP LỆ nhưng KHÔNG có khoá self ⇒ measureFailed, KHÔNG commit, KHÔNG recordActual", async () => {
    // Mẫu hợp lệ (đầu dò KHÔNG trả null), chỉ là không PID nào của cây ta có mặt.
    readings.push({ self: null });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    const { estimateBytesFor } = await import("./vramEstimator");

    await (await beginVramAllocation(inProcess("gguf:khong-thay", 900))).commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "gguf:khong-thay");
    // KHÔNG được là 0: đó là con số suy ra từ một khoá VẮNG MẶT, không phải số đo.
    expect(l!.actualBytes).toBeNull();
    expect(l!.measureFailed).toBe(true);
    expect(l!.measureSource).toBe("none");

    const ev = events.find((e) => e.event === "measure_failed" && e.owner === "gguf:khong-thay");
    expect((ev!.detail as Record<string, unknown>).reason).toBe("measure-target-absent");

    // ★ TRỌNG TÂM: nấc "learned" KHÔNG được nhiễm 0 — đây là thứ sống tới hết đời tiến trình.
    const est = await estimateBytesFor("gguf:khong-thay", { fileBytes: 900 * MiB });
    expect(est.source).toBe("file-size");
    expect(est.bytes).toBe(900 * MiB);
  });

  /**
   * ★★ I-4 (review vòng 1) — SỰ KIỆN LỆCH PHẢI MANG PHẦN TÁCH THEO NGUỒN.
   *
   * Từ Pha 2A, `ledgerTotalBytes` là một phép cộng TRỘN (chênh lệch từ bộ đếm + ước lượng + bản
   * ghi cũ từ thiết bị) và `drift` đem nó so với số TUYỆT ĐỐI của `nvidia-smi`, dưới ngưỡng 512
   * MiB — cùng bậc độ lớn với khoản lệch +505…+511 MiB giữa hai thước. Ca này canh: đọc nhật ký
   * là biết ĐƯỢC bao nhiêu byte đến từ thước nào (KHÔNG đổi ngưỡng, KHÔNG đổi công thức).
   */
  it("★★ 17. I-4: sự kiện `drift` mang phần tách theo THƯỚC, và ba nhóm cộng lại bằng tổng sổ", async () => {
    readings.push({ self: 1_000 * MiB });
    readings.push({ self: 3_000 * MiB });

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    await (await beginVramAllocation(inProcess("gguf:A", 2_000))).commitMeasured();
    // Một giấy phép thứ hai CHƯA commit ⇒ phần "ước lượng" khác 0, để phép phân hoạch có việc.
    await beginVramAllocation(inProcess("gguf:B", 500));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();
    await reconcileOnce();
    warn.mockRestore();

    const ev = events.find((e) => e.event === "drift");
    expect(ev, "phải có sự kiện drift để mà đọc").toBeDefined();
    const split = (ev!.detail as Record<string, unknown>).measureSourceSplit as Record<string, number>;
    expect(split.processDeltaBytes).toBe(2_000 * MiB);
    expect(split.deviceDeltaBytes).toBe(0);
    expect(split.estimatedBytes).toBe(500 * MiB);
    // ★ TRỌNG TÂM: phân hoạch — không byte nào bị đếm hai lần hay rơi ra ngoài.
    expect(split.totalBytes).toBe(snapshot().totalReservedBytes);
    expect(split.totalBytes).toBe(ev!.ledgerTotalBytes);
  });

  /**
   * ĐỐI CHỨNG cho ca 15 — chặn theo đầu đo TRƯỚC sẽ giết lượt cấp phát ĐẦU TIÊN của cả tiến
   * trình: trước `getLlama()` tiến trình chưa có byte VRAM nào nên bộ đếm KHÔNG có khoá của nó.
   * Nếu `gguf-backend` luôn `measureFailed` thì T5-15 (giấy phép backend chặn nền vĩnh viễn) sống
   * lại nguyên vẹn. Vì vậy "trước không thấy, sau thấy" PHẢI commit số thật.
   */
  it("★ 16. 'trước KHÔNG thấy, sau THẤY' vẫn commit số THẬT (lượt cấp phát đầu tiên của tiến trình)", async () => {
    readings.push({ self: null });         // trước getLlama(): chưa có thể hiện bộ đếm nào
    readings.push({ self: 430 * MiB });    // sau: backend CUDA đã hình thành

    const { beginVramAllocation } = await import("./vramWiring");
    const { snapshot } = await import("./vramBroker");
    await (await beginVramAllocation({ owner: "cuda-backend", kind: "gguf-backend", priority: "production" })).commitMeasured();

    const l = snapshot().leases.find((x) => x.request.owner === "cuda-backend");
    expect(l!.actualBytes).toBe(430 * MiB);
    expect(l!.measureFailed).toBeFalsy();
    expect(l!.measureSource).toBe("process-delta");
  });
});
