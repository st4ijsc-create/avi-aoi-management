import { describe, it, expect, beforeEach, vi } from "vitest";

const MIB = 1024 * 1024;

describe("vramReconciler — bắt kẻ cấp phát không xin phép", () => {
  beforeEach(() => vi.resetModules());

  it("★ TEST QUAN TRỌNG NHẤT PHA 1: có kẻ cấp phát ngoài sổ ⇒ PHẢI báo động", async () => {
    // Sổ nói 20 GB. Thiết bị nói 28 GB. Lệch 8 GB = sidecar không xin phép.
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }),
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB }),
    }));
    const logged: Array<{ event: string; driftBytes?: number }> = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: { event: string; driftBytes?: number }) => logged.push(e) }));

    const { reconcileOnce } = await import("./vramReconciler");
    const r = await reconcileOnce();

    expect(r.driftBytes).toBe(8_000 * MIB);
    expect(r.alarm).toBe(true);
    expect(logged.map((l) => l.event)).toContain("drift");
  });

  it("lệch NHỎ hơn ngưỡng thì KHÔNG báo động (biên nhiễu ±25 MiB, nền trôi ~103 MiB/ngày)", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 20_100 * MIB, totalBytes: 32_607 * MIB }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { reconcileOnce } = await import("./vramReconciler");
    const r = await reconcileOnce();
    expect(r.driftBytes).toBe(100 * MIB);
    expect(r.alarm).toBe(false);
  });

  it("đầu dò trả null (máy không GPU) ⇒ IM LẶNG bỏ qua, KHÔNG báo động giả", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({ readDeviceVram: async () => null }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { reconcileOnce } = await import("./vramReconciler");
    const r = await reconcileOnce();
    expect(r.alarm).toBe(false);
    expect(r.driftBytes).toBeNull();
  });

  it("bộ đếm giờ TẮT ĐƯỢC", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({ readDeviceVram: async () => null }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { startVramReconciler, stopVramReconciler, __hasReconcilerTimer } = await import("./vramReconciler");
    startVramReconciler();
    expect(__hasReconcilerTimer()).toBe(true);
    stopVramReconciler();
    expect(__hasReconcilerTimer()).toBe(false);
  });

  // ⚠ C-1 (review round 1): sự kiện "drift" PHẢI mang ẢNH CHỤP TOÀN BỘ SỔ — đây là dữ liệu
  // Task 7 cần để trả lời "lúc đó ai đang giữ gì". Trước bản sửa này, xoá cả khối `detail`
  // trong vramReconciler.ts KHÔNG làm test nào đỏ — lỗ hổng thật.
  it("sự kiện drift PHẢI mang ẢNH CHỤP TOÀN BỘ SỔ — detail.leases khớp từng giấy phép đang giữ", async () => {
    const acquiredAt = new Date();
    const leases = [
      {
        id: "lease-1",
        request: { owner: "sidecar:vision", kind: "external-process", estimatedBytes: 100 * MIB, priority: "background" },
        acquiredAt,
        actualBytes: 150 * MIB, // đã commit — số THẬT
        lastHeartbeatAt: acquiredAt,
        released: false,
      },
      {
        id: "lease-2",
        request: { owner: "gguf:qwen30b", kind: "gguf-model", estimatedBytes: 500 * MIB, priority: "production" },
        acquiredAt,
        actualBytes: null, // chưa commit — vẫn dùng ước lượng
        lastHeartbeatAt: acquiredAt,
        released: false,
      },
    ];
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases }),
      leaseBytes: (l: (typeof leases)[number]) => l.actualBytes ?? l.request.estimatedBytes,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB }),
    }));
    const logged: Array<{ event: string; detail?: Record<string, unknown> }> = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: { event: string; detail?: Record<string, unknown> }) => logged.push(e) }));

    const { reconcileOnce } = await import("./vramReconciler");
    await reconcileOnce();

    // Task 5 I-1 thêm ba trường truy vết vào `detail` (deviceUsedRawBytes/baselineUsedBytes/
    // attributableBytes) để đọc nhật ký là dựng lại được phép tính. Ý ĐỊNH của test này không
    // đổi — nó canh ẢNH CHỤP SỔ — nên khẳng định thẳng vào `detail.leases`.
    // ⚠ Review TOÀN NHÁNH (I-2) thêm `measureFailed` vào từng dòng ảnh chụp: chỉ cờ `committed`
    // thì "chưa cấp phát xong" (tạm thời) và "đã đo hỏng" (vĩnh viễn) trông giống hệt nhau khi
    // đọc lại nhật ký — mà hai thứ đó đòi hai hành động khác nhau của người trực.
    expect(logged[0].detail!.leases).toEqual([
      { owner: "sidecar:vision", kind: "external-process", priority: "background", bytes: 150 * MIB, committed: true, measureFailed: false },
      { owner: "gguf:qwen30b", kind: "gguf-model", priority: "production", bytes: 500 * MIB, committed: false, measureFailed: false },
    ]);
    // Và phép trừ nền phải TRUY ĐƯỢC, không được vô hình.
    expect(logged[0].detail!.deviceUsedRawBytes).toBe(28_000 * MIB);
    expect(logged[0].detail!.baselineUsedBytes).toBe(0); // chưa chụp nền ⇒ không trừ gì
  });

  // ⚠ I-1 (review round 1): lệch ÂM (sổ giữ NHIỀU HƠN thiết bị) cũng là chuyện THẬT — giấy
  // phép treo vì tiến trình chết, hoặc commit() ghi số quá lớn. Trước bản sửa này, đổi
  // `Math.abs(drift) > NGƯỠNG` thành `drift > NGƯỠNG` KHÔNG làm test nào đỏ.
  it("lệch ÂM (sổ giữ NHIỀU HƠN thiết bị) cũng PHẢI báo động", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 11_000 * MIB, totalBytes: 32_607 * MIB }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { reconcileOnce } = await import("./vramReconciler");
    const r = await reconcileOnce();
    expect(r.driftBytes).toBe(-9_000 * MIB);
    expect(r.alarm).toBe(true);
  });

  // ⚠ I-2 (review round 1): câu cảnh báo phải CHẨN ĐOÁN ĐÚNG HƯỚNG. Lệch dương = có hộ tiêu
  // thụ cấp phát không xin phép; lệch âm = giấy phép treo/số commit sai — KHÔNG phải cấp phát
  // chui. Một câu cố định gắn sai nguyên nhân sẽ khiến người trực đi tìm sai chỗ.
  it("cảnh báo lệch DƯƠNG phải nói 'cấp phát KHÔNG XIN PHÉP', KHÔNG nói 'treo'", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce } = await import("./vramReconciler");
    await reconcileOnce();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("KHÔNG XIN PHÉP");
    expect(msg).not.toContain("treo");
    warnSpy.mockRestore();
  });

  it("cảnh báo lệch ÂM phải nói 'giấy phép treo/số commit sai', KHÔNG đổ oan 'cấp phát chui'", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 11_000 * MIB, totalBytes: 32_607 * MIB }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce } = await import("./vramReconciler");
    await reconcileOnce();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("treo");
    expect(msg).not.toContain("KHÔNG XIN PHÉP");
    warnSpy.mockRestore();
  });

  // ⚠ I-3 (review round 1): guard `if (timer) return;` chỉ đúng nhờ đọc bằng mắt — trước bản
  // sửa này, xoá guard đó KHÔNG làm test nào đỏ. Theo khuôn `safety.s3.test.ts` (spy
  // global.setInterval, assert gọi ĐÚNG MỘT lần dù start() gọi hai lần).
  it("startVramReconciler() gọi HAI LẦN KHÔNG được tạo hai timer", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({ readDeviceVram: async () => null }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const setSpy = vi.spyOn(global, "setInterval");
    const { startVramReconciler, stopVramReconciler } = await import("./vramReconciler");
    startVramReconciler();
    startVramReconciler();
    expect(setSpy).toHaveBeenCalledTimes(1);
    stopVramReconciler();
    setSpy.mockRestore();
  });
});

/**
 * Task 5 review vòng 1, I-1 — NỀN THIẾT BỊ.
 *
 * Reviewer đo lúc app KHÔNG chạy (netstat sạch): GPU đã dùng **1.090 MiB** — desktop
 * compositor + tiến trình khác của máy. Sổ = 0 ⇒ `drift = +1090 > 512` ⇒ báo động
 * "Có hộ tiêu thụ cấp phát KHÔNG XIN PHÉP" + một dòng ghi DB **mỗi 60 giây, mãi mãi**,
 * trên MỌI máy, ngay từ giây thứ nhất.
 *
 * Giá trị DUY NHẤT của Pha 1 là báo động này CÓ NGHĨA. Một cái chuông kêu liên tục là
 * cái chuông không ai nghe.
 */
describe("I-1 — nền thiết bị phải được TRỪ, nếu không chuông kêu từ giây 0", () => {
  beforeEach(() => vi.resetModules());

  const BACKGROUND = 1_090 * MIB; // số reviewer đo được trên máy sạch

  it("★ sổ RỖNG + máy CHỈ CÓ NỀN ⇒ TUYỆT ĐỐI KHÔNG báo động", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: BACKGROUND, totalBytes: 32_607 * MIB }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline();
    const r = await reconcileOnce();

    expect(r.baselineUsedBytes).toBe(BACKGROUND);
    expect(r.driftBytes).toBe(0);
    expect(r.alarm).toBe(false);
  });

  it("trừ nền rồi VẪN phải bắt được kẻ cấp phát chui (không được làm cùn con dao)", async () => {
    // ⚠ Sidecar phải xuất hiện SAU khi chụp nền. Bản đầu của test này để nó có sẵn từ lúc chụp
    // ⇒ 8 GB bị nuốt vào nền và drift = 0 — chính là kịch bản giới hạn đã ghi ở docstring
    // `captureVramBaseline()` (restart khi sidecar còn sống, spec §6 → Pha 3).
    let used = BACKGROUND;
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: used, totalBytes: 32_607 * MIB }),
    }));
    const logged: Array<{ event: string }> = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: { event: string }) => logged.push(e) }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline();
    used = BACKGROUND + 8_000 * MIB; // sidecar 8 GB cấp phát KHÔNG XIN PHÉP, sau khi đã có nền
    const r = await reconcileOnce();

    expect(r.driftBytes).toBe(8_000 * MIB);
    expect(r.alarm).toBe(true);
    expect(logged.map((l) => l.event)).toContain("drift");
  });

  it("chụp nền PHẢI ghi một sự kiện `baseline` kèm giá trị — KHÔNG được trừ âm thầm", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: BACKGROUND, totalBytes: 32_607 * MIB }),
    }));
    const logged: Array<{ event: string; deviceUsedBytes?: number }> = [];
    vi.doMock("./vramEventLog", () => ({
      logVramEvent: (e: { event: string; deviceUsedBytes?: number }) => logged.push(e),
    }));

    const { captureVramBaseline } = await import("./vramReconciler");
    await captureVramBaseline();

    const ev = logged.find((l) => l.event === "baseline");
    expect(ev).toBeDefined();
    expect(ev!.deviceUsedBytes).toBe(BACKGROUND);
  });

  it("chụp nền HAI LẦN chỉ lấy lần ĐẦU — restart reconciler không được nuốt thêm cấp phát vào nền", async () => {
    let used = BACKGROUND;
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({ readDeviceVram: async () => ({ usedBytes: used, totalBytes: 32_607 * MIB }) }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline();
    used = BACKGROUND + 8_000 * MIB; // một model 8 GB đã nạp sau đó
    await captureVramBaseline(); // lần hai — PHẢI là no-op

    const r = await reconcileOnce();
    expect(r.baselineUsedBytes).toBe(BACKGROUND);
    expect(r.alarm).toBe(true); // 8 GB kia vẫn phải lộ ra
  });

  it("máy không GPU (đầu dò null) — chụp nền KHÔNG được ném, và vẫn IM LẶNG", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({ readDeviceVram: async () => null }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await expect(captureVramBaseline()).resolves.toBeNull();
    const r = await reconcileOnce();
    expect(r.alarm).toBe(false);
    expect(r.driftBytes).toBeNull();
  });

  it("__resetVramBaselineForTests() thật sự dọn nền (NEW-3 — hàm này phải CÓ NGƯỜI DÙNG)", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: BACKGROUND, totalBytes: 32_607 * MIB }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const rec = await import("./vramReconciler");
    expect(await rec.captureVramBaseline()).toBe(BACKGROUND);
    rec.__resetVramBaselineForTests();
    expect((await rec.reconcileOnce()).baselineUsedBytes).toBeNull();
    // dọn xong thì chụp lại được — không bị ghim vĩnh viễn
    expect(await rec.captureVramBaseline()).toBe(BACKGROUND);
  });
});

/**
 * Task 5 review vòng 2, NEW-1 — NỀN KHÔNG ĐƯỢC NUỐT CẤP PHÁT CỦA CHÍNH TA.
 *
 * Có ĐƯỜNG WARM THỨ HAI mà vòng trước không thấy:
 *   index.ts:4931 → registerAiLocalKnowledgeRoutes → warmUpOllamaModels
 *   (aiLocalKnowledgeService.ts:2391) → setTimeout(**2000 ms**) → warmModel(GGUF_DEFAULT_MODEL)
 *   = nạp 30B ~17 GB THẬT.
 * Đồng hồ 2 giây đó được lên ~273 dòng boot TRƯỚC `startBackgroundSchedulers()` (:5204) và
 * NGẮN HƠN đồng hồ 3 giây của `initDeepModelWarmup`. Giữa hai điểm còn có
 * `initializeLicenseSystem()`, `initializeRuntimeSecurity()` (băm file), `initializeSocket()`,
 * `startStreamProcessor()`, `await import("../api/v1/router")`. Boot chậm > 2 s là 17 GB trọng
 * số bị nuốt vào nền — và tệ hơn, nuốt MỘT PHẦN ⇒ nền BẤT ĐỊNH giữa các lần boot.
 * `warmUpOllamaModels` cũng KHÔNG có cổng `GGUF_WARM_DEEP_MODEL_ON_BOOT` (chỉ gác
 * `USE_LEGACY_OLLAMA`, mặc định false ⇒ warm CHẠY), nên tắt cờ kia không cứu được.
 *
 * SỬA BẰNG CẤU TRÚC, KHÔNG ĐUA VỚI ĐỒNG HỒ: Task 5 đã nối `loadGgufModel` vào `reserve()`, nên
 * mọi thứ do CHÍNH TA cấp phát ĐÃ nằm trong sổ tại thời điểm chụp nền. Vậy
 *     baseline = deviceUsed_lúc_chụp − ledgerTotal_lúc_chụp
 * ⇒ cấp phát của ta TỰ TRỪ khỏi nền, BẤT KỂ thứ tự boot, và đường warm thứ ba sau này cũng vô hại.
 */
describe("NEW-1 — nền = thiết bị − phần ĐÃ COMMIT, nên boot chậm bao nhiêu cũng không nuốt cấp phát của ta", () => {
  beforeEach(() => vi.resetModules());

  const BACKGROUND = 941 * MIB; // nền thật đo trên máy này
  const DEEP_30B = 17_000 * MIB;

  /** Giấy phép ĐÃ commit — chắc chắn đã nằm trong `deviceUsed`. */
  const committed = (bytes: number) => ({
    id: "lease-c",
    request: { owner: "gguf:30B", kind: "gguf-model", estimatedBytes: bytes, priority: "interactive" },
    acquiredAt: new Date(),
    actualBytes: bytes,
    lastHeartbeatAt: new Date(),
    released: false,
  });
  /** Giấy phép ĐÃ XIN nhưng CHƯA cấp phát xong (`actualBytes === null`). */
  const pending = (estimate: number) => ({
    id: "lease-p",
    request: { owner: "gguf:30B", kind: "gguf-model", estimatedBytes: estimate, priority: "interactive" },
    acquiredAt: new Date(),
    actualBytes: null,
    lastHeartbeatAt: new Date(),
    released: false,
  });

  it("★ đường warm thứ hai đã nạp XONG 30B TRƯỚC lúc chụp nền ⇒ nền vẫn chỉ là 941 MiB", async () => {
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: DEEP_30B, leases: [committed(DEEP_30B)] }),
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: BACKGROUND + DEEP_30B, totalBytes: 32_607 * MIB }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    const base = await captureVramBaseline();

    // KHÔNG được là 17.941 MiB — 30B là của TA, đã commit nên đã nằm trong deviceUsed.
    expect(base).toBe(BACKGROUND);

    const r = await reconcileOnce();
    expect(r.driftBytes).toBe(0);
    expect(r.alarm).toBe(false);
  });

  it("sự kiện `baseline` phải ghi CẢ deviceUsedRaw LẪN phần đã trừ để dựng lại phép tính", async () => {
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: DEEP_30B, leases: [committed(DEEP_30B)] }),
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: BACKGROUND + DEEP_30B, totalBytes: 32_607 * MIB }),
    }));
    const logged: Array<{ event: string; detail?: Record<string, unknown> }> = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: never) => logged.push(e) }));

    const { captureVramBaseline } = await import("./vramReconciler");
    await captureVramBaseline();

    const ev = logged.find((l) => l.event === "baseline")!;
    expect(ev).toBeDefined();
    expect(ev.detail!.deviceUsedRawBytes).toBe(BACKGROUND + DEEP_30B);
    expect(ev.detail!.committedBytes).toBe(DEEP_30B);
    expect(ev.detail!.ledgerTotalBytes).toBe(DEEP_30B);
    expect(ev.detail!.baselineUsedBytes).toBe(BACKGROUND);
  });

  /**
   * ★★ VÒNG 3 — CỬA SỔ "ĐÃ XIN, CHƯA CẤP PHÁT XONG".
   *
   * Cửa sổ CÓ THẬT: `beginVram()` ở `aiGgufEngine.ts:737` gọi `reserve()` (cộng ƯỚC LƯỢNG vào
   * sổ) TRƯỚC `llama.loadModel()` ở `:747`; `commitMeasured()` mãi `:802`. Với model 30B
   * ~17 GB khoảng đó dài NHIỀU GIÂY. Cùng khuôn ở `:927`/`:938` cho context lười.
   *
   * Công thức "trừ CẢ SỔ" của vòng 2 làm nền bị ĐẦU ĐỘC VĨNH VIỄN nếu lượt chụp rơi vào đây:
   *   nền = max(0, 941 − 17.000) = 0  ← kẹp, rồi GHIM
   *   vài giây sau: 17.941 − 0 = 17.941 ⇒ drift = 941 ⇒ ALARM mỗi 60 s, MÃI MÃI.
   * Tức là lỗi I-1 sống lại qua cửa sau — chỉ khác: hỏng theo XÁC SUẤT thời điểm boot.
   *
   * SỬA: chỉ trừ phần ĐÃ COMMIT. Giấy phép chưa commit nghĩa là "đã xin nhưng CHƯA cấp phát
   * xong" ⇒ nó CHƯA nằm trong `deviceUsed` ⇒ trừ nó là trừ một thứ chưa tồn tại.
   */
  it("★★ chụp nền TRÚNG cửa sổ chưa-commit ⇒ nền vẫn là 941, KHÔNG bị kẹp về 0", async () => {
    // Sổ đã cộng 17 GB ƯỚC LƯỢNG; thiết bị vật lý chưa kịp tăng.
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: DEEP_30B, leases: [pending(DEEP_30B)] }),
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: BACKGROUND, totalBytes: 32_607 * MIB }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(BACKGROUND);
  });

  it("★★ …và vài giây sau khi model tải xong thì KHÔNG báo động", async () => {
    // Ảnh chụp thay đổi theo thời gian: lúc chụp nền còn pending, lúc đối chiếu đã commit.
    let done = false;
    vi.doMock("./vramBroker", () => ({
      snapshot: () =>
        done
          ? { totalReservedBytes: DEEP_30B, leases: [committed(DEEP_30B)] }
          : { totalReservedBytes: DEEP_30B, leases: [pending(DEEP_30B)] },
      // Chỉ được dùng ở đường CẢNH BÁO. Có mặt để nếu test này đỏ thì đỏ vì SỐ SAI,
      // không phải vì mock thiếu hàm.
      leaseBytes: (l: { actualBytes: number | null; request: { estimatedBytes: number } }) =>
        l.actualBytes ?? l.request.estimatedBytes,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({
        usedBytes: done ? BACKGROUND + DEEP_30B : BACKGROUND,
        totalBytes: 32_607 * MIB,
      }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline(); // TRÚNG cửa sổ chưa-commit
    done = true; // model tải xong, commit số thật

    const r = await reconcileOnce();
    expect(r.baselineUsedBytes).toBe(BACKGROUND);
    expect(r.driftBytes).toBe(0);
    expect(r.alarm).toBe(false);
  });

  it("★★ trạng thái MÂU THUẪN (thiết bị < tổng ĐÃ COMMIT) ⇒ KHÔNG ghim, nhịp sau chụp lại được", async () => {
    // Một phép chụp cho ra kết quả VÔ LÝ thì không được phép thành hằng số vĩnh viễn.
    let broken = true;
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: DEEP_30B, leases: [committed(DEEP_30B)] }),
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({
        usedBytes: broken ? 1_000 * MIB : BACKGROUND + DEEP_30B,
        totalBytes: 32_607 * MIB,
      }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBeNull(); // vô lý ⇒ từ chối kết luận

    broken = false;
    expect(await captureVramBaseline()).toBe(BACKGROUND); // nhịp sau: chụp được
  });
});

/**
 * Task 5 review vòng 2, NEW-2 — ĐẦU DÒ HỎNG THOÁNG QUA KHÔNG ĐƯỢC THÀNH BÁO ĐỘNG GIẢ VĨNH VIỄN.
 *
 * Bản trước đặt `baselineCaptured = true` TRƯỚC `await`, nên MỌI kết quả — kể cả `null` do
 * `nvidia-smi` chạm trần `timeout: 3000` lúc boot, NVML đang khởi tạo, hay `execFile` lỗi
 * thoáng qua — là VĨNH VIỄN. Rồi `baseline = baselineUsedBytes ?? 0` coi "chưa biết" = 0 ⇒
 * toàn bộ nền bị báo là "cấp phát KHÔNG XIN PHÉP", mỗi 60 giây, mãi mãi, KHÔNG TỰ LÀNH.
 */
describe("NEW-2 — đầu dò hồi phục thì nền TỰ LÀNH; chưa biết nền thì IM LẶNG (không coi là 0)", () => {
  beforeEach(() => vi.resetModules());

  const BACKGROUND = 1_090 * MIB;

  it("★ đầu dò hỏng lúc boot rồi HỒI PHỤC ⇒ lượt chụp sau thành công (KHÔNG bị ghim null)", async () => {
    let probeOk = false;
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => (probeOk ? { usedBytes: BACKGROUND, totalBytes: 32_607 * MIB } : null),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");

    // Lượt 1: đầu dò hỏng ⇒ null, và TUYỆT ĐỐI không được ghim.
    expect(await captureVramBaseline()).toBeNull();

    // Đầu dò hồi phục.
    probeOk = true;
    expect(await captureVramBaseline()).toBe(BACKGROUND);

    const r = await reconcileOnce();
    expect(r.baselineUsedBytes).toBe(BACKGROUND);
    expect(r.driftBytes).toBe(0);
    expect(r.alarm).toBe(false);
  });

  it("★ reconciler ĐANG CHẠY mà CHƯA BIẾT nền ⇒ IM LẶNG, KHÔNG coi nền = 0 rồi hét", async () => {
    let probeOk = false;
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => (probeOk ? { usedBytes: BACKGROUND, totalBytes: 32_607 * MIB } : null),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { startVramReconciler, stopVramReconciler, reconcileOnce } = await import("./vramReconciler");
    startVramReconciler(); // chụp nền lần đầu — sẽ THẤT BẠI (đầu dò hỏng)
    await new Promise((r) => setImmediate(r)); // để lượt chụp bất đồng bộ chạy xong

    // Đầu dò hồi phục NHƯNG nền vẫn chưa chụp lại được ⇒ tuyệt đối không được hét
    // "cấp phát KHÔNG XIN PHÉP" cho 1.090 MiB nền.
    probeOk = true;
    const r = await reconcileOnce();
    expect(r.baselineUsedBytes).toBeNull();
    expect(r.alarm).toBe(false);
    expect(r.driftBytes).toBeNull();

    stopVramReconciler();
  });

  it("bộ đếm giờ THỬ LẠI lượt chụp nền ở mỗi nhịp — hỏng lúc boot không phải bản án chung thân", async () => {
    let probeOk = false;
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => (probeOk ? { usedBytes: BACKGROUND, totalBytes: 32_607 * MIB } : null),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { startVramReconciler, stopVramReconciler, __runReconcileTick, reconcileOnce } =
      await import("./vramReconciler");
    startVramReconciler();
    await new Promise((r) => setImmediate(r));

    probeOk = true;
    await __runReconcileTick(); // đúng thứ bộ đếm giờ gọi mỗi nhịp

    const r = await reconcileOnce();
    expect(r.baselineUsedBytes).toBe(BACKGROUND);
    expect(r.alarm).toBe(false);

    stopVramReconciler();
  });
});
