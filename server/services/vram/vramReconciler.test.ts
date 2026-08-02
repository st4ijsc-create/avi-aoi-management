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
    expect(logged[0].detail!.leases).toEqual([
      { owner: "sidecar:vision", kind: "external-process", priority: "background", bytes: 150 * MIB, committed: true },
      { owner: "gguf:qwen30b", kind: "gguf-model", priority: "production", bytes: 500 * MIB, committed: false },
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
});
