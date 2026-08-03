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
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
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
      readDeviceVram: async () => ({ usedBytes: 20_100 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
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
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
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
      readDeviceVram: async () => ({ usedBytes: 11_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
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
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
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
      readDeviceVram: async () => ({ usedBytes: 11_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
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
 * Pha 1.5 Task 3 — CỬA SỔ CHƯA-COMMIT THÔI SINH BÁO ĐỘNG.
 *
 * `reserve()` cộng ƯỚC LƯỢNG vào sổ TRƯỚC KHI VRAM vật lý tăng; `commitMeasured()` mãi sau khi
 * nạp xong. Với model 30B khoảng đó 11-43 giây ⇒ `drift = attributable − totalReservedBytes`
 * âm sâu suốt cửa sổ đó (sổ đã "đặt cọc" cả ước lượng, thiết bị chưa kịp theo). Đây là nguồn
 * lệch −16.335 MiB đo được ở Pha 1 (p95 của phân bố).
 *
 * ⚠ BĂNG DUNG SAI CHỈ MỘT PHÍA: giấy phép chưa commit = "đã xin, CHƯA cấp phát xong" ⇒ VRAM vật
 * lý CHƯA có ⇒ chỉ nới dung sai phía ÂM (`drift < -(NGƯỠNG + pendingBytes)`). Phía DƯƠNG giữ
 * NGUYÊN ngưỡng chặt — đây là lý do kẻ cấp phát chui vẫn bị bắt: bất kể lease đang pending còn
 * lại BAO NHIÊU thực sự đã lên VRAM, phần đóng góp của một kẻ chui LUÔN LUÔN cộng dồn vào phía
 * dương; một khi `attributable` vượt `totalReservedBytes + NGƯỠNG`, không có cách hợp pháp nào
 * giải thích được — vì sổ đã "đặt cọc" TOÀN BỘ ước lượng của lease rồi (không có phần trăm nào
 * của legitimate load có thể vượt quá 100% ước lượng của chính nó).
 *
 * ⚠⚠ pendingBytes CỐ Ý LOẠI leases `measureFailed === true`. Đường "đo hỏng" (`vramWiring.ts`
 * — delta ÂM giữa `beforeUsed`/`after`) đánh dấu `measureFailed=true` NGAY LẬP TỨC, KHÔNG BAO
 * GIỜ commit `actualBytes`. Nếu pendingBytes GỘP cả lease đó, băng dung sai bị nới VĨNH VIỄN
 * theo đúng phần ước lượng bị đóng băng — che mất chính lệch ÂM DAI DẲNG mà `measureFailed` sinh
 * ra để BÁO (xem `wiring.negativeDelta.test.ts` ca 4: reranker 606 MiB ước lượng, 18 MiB thật,
 * PHẢI báo động "đo hỏng" — nếu pendingBytes gộp cả lease đó, ca 4 tắt tiếng SAI).
 */
describe("Pha 1.5 Task 3 — lease chưa commit nới dung sai CHỈ phía ÂM", () => {
  beforeEach(() => vi.resetModules());

  const MIB6 = 1024 * 1024;
  const lease = (owner: string, est: number, actual: number | null) => ({
    id: owner,
    request: { owner, kind: "gguf-model", estimatedBytes: est, priority: "interactive" },
    actualBytes: actual,
    acquiredAt: new Date(),
    lastHeartbeatAt: new Date(),
    released: false,
  });

  it("★ đang nạp 30B (chưa commit) ⇒ lệch ÂM KHÔNG báo động", async () => {
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 17_000 * MIB6, leases: [lease("gguf:30B", 17_000 * MIB6, null)] }),
      leaseBytes: (l: { actualBytes: number | null; request: { estimatedBytes: number } }) =>
        l.actualBytes ?? l.request.estimatedBytes,
    }));
    // Thiết bị đứng yên ở nền (1.000 MiB) suốt cả lượt chụp nền lẫn lượt đối chiếu — mô phỏng
    // "chưa có gì lên VRAM cả", tức đúng ĐẦU cửa sổ đua reserve()→commit().
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 1_000 * MIB6, totalBytes: 32_607 * MIB6, source: "smi" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline();
    const r = await reconcileOnce();
    expect(r.alarm).toBe(false);
    expect(r.pendingBytes).toBe(17_000 * MIB6);
  });

  it("★ băng dung sai CHỈ nới phía ÂM — kẻ cấp phát chui vẫn bị bắt khi đang nạp", async () => {
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 17_000 * MIB6, leases: [lease("gguf:30B", 17_000 * MIB6, null)] }),
      leaseBytes: (l: { actualBytes: number | null; request: { estimatedBytes: number } }) =>
        l.actualBytes ?? l.request.estimatedBytes,
    }));
    // ⚠ MỘT mock, biến `used` đóng trong closure — `vi.doMock` gọi LẠI sau khi module đã
    // `import()` KHÔNG đổi được binding mà `vramReconciler.ts` đã chụp lúc load (ESM: import
    // named được resolve MỘT LẦN khi module tiêu thụ được nạp). Đây là "sửa mock" mà brief yêu
    // cầu, không phải sửa mã sản xuất.
    let used = 1_000 * MIB6;
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: used, totalBytes: 32_607 * MIB6, source: "smi" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline(); // nền = 1.000 (lease vẫn pending lúc chụp ⇒ không trừ gì thêm)
    // 30B đã nạp XONG về mặt vật lý (17.000, đúng ước lượng) NHƯNG chưa kịp commit(), CỘNG THÊM
    // một kẻ cấp phát chui 8.000 MiB — đúng lúc `pendingBytes` đang lớn nhất.
    used = 1_000 * MIB6 + 17_000 * MIB6 + 8_000 * MIB6;
    const r = await reconcileOnce();
    expect(r.alarm).toBe(true);
    expect(r.pendingBytes).toBe(17_000 * MIB6);
  });
});

/**
 * Pha 1.5 Task 1 — MỘT THƯỚC DUY NHẤT.
 *
 * `startVramReconciler()` chụp nền ở `backgroundJobs.ts` TRƯỚC khi `getLlama()` gắn handle
 * (`aiGgufEngine.ts:359-360`) ⇒ nền đo bằng `nvidia-smi`, còn mọi phép so SAU ĐÓ (một khi
 * handle đã gắn) dùng `getVramState` NATIVE. Hai thước lệch 165-178 MiB (báo cáo Pha 1 §3.4)
 * — ĐỦ MỘT MÌNH đẩy lệch qua ngưỡng 512 MiB và làm chuông kêu MÃI MÃI, dù không ai cấp phát
 * chui cả. Đây là LỖI ĐO, không phải lỗi hệ.
 *
 * SỬA BẰNG CẤU TRÚC: đầu dò khai rõ nó đo bằng thước nào (`source`), reconciler GHI NHỚ thước
 * đã dùng để chụp nền; thấy số đến từ THƯỚC KHÁC thì HUỶ nền cũ, chụp lại, KHÔNG báo động lượt
 * đó (so hai thước với nhau là tạo ra lệch GIẢ không bao giờ tự hết).
 */
describe("Pha 1.5 Task 1 — đổi thước thì huỷ nền và chụp lại, không so hai thước với nhau", () => {
  beforeEach(() => vi.resetModules());

  it("★ ĐỔI THƯỚC ⇒ nền bị HUỶ và chụp lại, KHÔNG so hai thước với nhau", async () => {
    let src: "native" | "smi" = "smi";
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
      leaseBytes: (l: { actualBytes: number | null }) => l.actualBytes ?? 0,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 1000 * MIB, totalBytes: 32607 * MIB, source: src }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(1000 * MIB); // nền theo thước "smi"

    src = "native"; // handle vừa được gắn
    const r = await reconcileOnce();
    expect(r.baselineResampled).toBe(true); // nền phải được chụp LẠI
    expect(r.alarm).toBe(false); // và KHÔNG được báo động
  });
});

/**
 * Pha 1.5 Task 1 — REVIEW VÒNG 1 (EXP-1 + EXP-2).
 *
 * Reviewer tự dựng hai thực nghiệm lộ ra rằng cơ chế "đổi thước thì huỷ nền và chụp lại" của
 * vòng trước, tuy đúng cho ca ĐƠN LẺ, có hai lỗ khi ĐỔI THƯỚC LẶP LẠI:
 *
 *   EXP-1 — thước DAO ĐỘNG (xen kẽ mỗi nhịp) ⇒ MỌI nhịp đều rơi vào nhánh resample, KHÔNG nhịp
 *   nào đối chiếu được. Một khoản cấp phát chui tồn tại xuyên suốt sẽ KHÔNG BAO GIỜ bị phát
 *   hiện — chuông CÂM VĨNH VIỄN, và không ai biết nó đang câm.
 *
 *   EXP-2 — kẻ chui grab ĐÚNG LÚC đổi thước thì bị NUỐT VÀO NỀN MỚI (đúng thiết kế: lượt đó
 *   không báo động) nhưng KHÔNG để lại dấu vết nào ⇒ không cách nào truy ngược sau này.
 */
describe("Pha 1.5 Task 1 review vòng 1 — EXP-1: thước dao động phải có bộ ngắt mạch", () => {
  beforeEach(() => vi.resetModules());

  const MIB2 = 1024 * 1024;

  it("★ THƯỚC DAO ĐỘNG LIÊN TỤC (EXP-1) ⇒ sau 3 lần resample liên tiếp phải NGỪNG và báo động THƯỚC BẤT ỔN — không được câm mãi", async () => {
    // Nền sạch chụp ban đầu bằng thước "smi" (1000 MiB, KHÔNG có kẻ chui). Ngay sau đó một
    // khoản 8 GB chui xuất hiện và TỒN TẠI XUYÊN SUỐT, trong khi đầu dò XEN KẼ thước mỗi nhịp —
    // mỗi nhịp lại là một lượt đổi thước ⇒ nếu không ngắt mạch, MỌI nhịp đều resample, KHÔNG
    // nhịp nào đối chiếu được, và 8 GB kia không bao giờ bị phát hiện (thực nghiệm EXP-1).
    let tick = 0;
    const ROGUE = 8_000 * MIB2;
    const CLEAN = 1000 * MIB2;
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
      leaseBytes: (l: { actualBytes: number | null }) => l.actualBytes ?? 0,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({
        usedBytes: CLEAN + (tick === 0 ? 0 : ROGUE),
        totalBytes: 32_607 * MIB2,
        source: tick === 0 ? "smi" : tick % 2 === 1 ? "native" : "smi",
      }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(CLEAN); // nhịp 0 — nền sạch, thước "smi"

    const results: Array<{ resampled: boolean; alarm: boolean; unstable: boolean }> = [];
    for (let i = 1; i <= 10; i++) {
      tick = i;
      const r = await reconcileOnce();
      results.push({ resampled: r.baselineResampled, alarm: r.alarm, unstable: r.sourceUnstable });
    }

    // Ba nhịp resample liên tiếp (i=1,2,3) rồi NGỪNG ở nhịp thứ tư — đây là bộ ngắt mạch. Nhịp
    // thứ năm trùng lại thước đã đóng băng nên đối chiếu bình thường (không resample), rồi chu
    // kỳ lặp lại.
    expect(results.map((r) => r.resampled)).toEqual([
      true, true, true, false, false, true, true, true, false, false,
    ]);
    // Đúng hai nhịp báo "THƯỚC BẤT ỔN" (i=4 và i=9) — nội dung PHẢI khác "cấp phát chui".
    expect(results.map((r) => r.unstable)).toEqual([
      false, false, false, true, false, false, false, false, true, false,
    ]);
    // ★ QUAN TRỌNG NHẤT (đây là điều EXP-1 đòi): KHÔNG được câm suốt 10 nhịp.
    expect(results.some((r) => r.alarm)).toBe(true);
  });

  it("bộ đếm ngắt mạch RESET về 0 khi có một nhịp đối chiếu bình thường (không phải cứ dao động một lần là hỏng vĩnh viễn)", async () => {
    // Đổi thước đúng 2 lần liên tiếp (dưới ngưỡng 3) rồi ỔN ĐỊNH lại — KHÔNG được trip breaker.
    let src: "native" | "smi" = "smi";
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
      leaseBytes: (l: { actualBytes: number | null }) => l.actualBytes ?? 0,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 1000 * MIB2, totalBytes: 32_607 * MIB2, source: src }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline(); // thước "smi"

    src = "native";
    const r1 = await reconcileOnce();
    expect(r1.baselineResampled).toBe(true);
    expect(r1.sourceUnstable).toBe(false);

    src = "smi";
    const r2 = await reconcileOnce();
    expect(r2.baselineResampled).toBe(true);
    expect(r2.sourceUnstable).toBe(false);

    // Nhịp thứ ba TRÙNG thước hiện tại ("smi") ⇒ đối chiếu bình thường, KHÔNG resample, và bộ
    // đếm phải reset — hai lần đổi thước liên tiếp trước đó KHÔNG được cộng dồn qua nhịp ổn định.
    const r3 = await reconcileOnce();
    expect(r3.baselineResampled).toBe(false);
    expect(r3.sourceUnstable).toBe(false);
  });
});

/**
 * Pha 1.5 Task 1 review vòng 1 — EXP-2: kẻ chui grab đúng lúc đổi thước phải để lại DẤU VẾT.
 *
 * `alarm: false` ở lượt phát hiện đổi thước là ĐÚNG THIẾT KẾ (đã duyệt) — số vừa bị huỷ không
 * đáng tin để so trực tiếp. Nhưng nếu sự kiện `baseline` không ghi lại GÌ về nền cũ, một kẻ chui
 * grab đúng lúc đó biến mất VĨNH VIỄN không cách nào truy ngược. Sửa: TRƯỚC khi huỷ nền, tính
 * "drift nếu KHÔNG huỷ" (so nền CŨ với số liệu MỚI) và ghi vào `detail` của sự kiện `baseline`.
 */
describe("Pha 1.5 Task 1 review vòng 1 — EXP-2: sự kiện baseline phải ghi drift-nếu-không-huỷ", () => {
  beforeEach(() => vi.resetModules());

  const MIB3 = 1024 * 1024;

  it("★ KẺ CHUI grab ĐÚNG LÚC đổi thước ⇒ sự kiện `baseline` PHẢI ghi nền CŨ + drift-nếu-không-huỷ, không được vứt bỏ dấu vết", async () => {
    let src: "native" | "smi" = "smi";
    let used = 1000 * MIB3;
    // ⚠ Review vòng 2, MỚI-2 — PHẢI có một giấy phép CHƯA COMMIT (`actualBytes: null`) để
    // `ledgerTotal` (= `totalReservedBytes`, tổng CẢ SỔ) và `committedBytes` (chỉ tổng phần ĐÃ
    // COMMIT, tính trong `captureVramBaseline()`) là HAI SỐ KHÁC NHAU. Bản trước dùng
    // `leases: []` ⇒ cả hai đều bằng 0 ⇒ đổi `ledgerTotal` thành `committedBytes` trong công thức
    // `driftIfNotResampled` KHÔNG làm test đỏ — lưới không canh được biến nào đang dùng, đúng
    // lớp lỗi brief đã cảnh báo ("Pha 1 mất ba vòng sửa vì đúng chỗ này").
    const acquiredAt = new Date();
    const pendingLease = {
      id: "lease-pending",
      request: { owner: "gguf:pending", kind: "gguf-model", estimatedBytes: 500 * MIB3, priority: "interactive" },
      acquiredAt,
      actualBytes: null, // CHƯA commit ⇒ KHÔNG cộng vào committedBytes, NHƯNG vẫn nằm trong ledgerTotal
      lastHeartbeatAt: acquiredAt,
      released: false,
    };
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 500 * MIB3, leases: [pendingLease] }),
      leaseBytes: (l: { actualBytes: number | null; request: { estimatedBytes: number } }) =>
        l.actualBytes ?? l.request.estimatedBytes,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: used, totalBytes: 32_607 * MIB3, source: src }),
    }));
    const logged: Array<{ event: string; detail?: Record<string, unknown> }> = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: never) => logged.push(e) }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    // committedBytes = 0 (lease chưa commit) ⇒ nền vẫn = raw − 0 = 1000 MiB, KHÔNG bị ảnh hưởng
    // bởi ledgerTotal = 500 MiB — hai số này chỉ được PHÂN BIỆT ở driftIfNotResampled bên dưới.
    expect(await captureVramBaseline()).toBe(1000 * MIB3); // nền cũ, thước "smi"

    src = "native";
    used = 1000 * MIB3 + 8_000 * MIB3; // 8 GB chui grab ĐÚNG lúc đổi thước
    const r = await reconcileOnce();
    expect(r.baselineResampled).toBe(true);
    expect(r.alarm).toBe(false); // đúng thiết kế Task 1 — KHÔNG báo động lượt phát hiện đổi thước

    const baselineEvents = logged.filter((l) => l.event === "baseline");
    expect(baselineEvents).toHaveLength(2); // nhịp 0 (chụp lần đầu) + nhịp resample này
    const resampleEvent = baselineEvents[1];
    expect(resampleEvent.detail!.priorBaselineUsedBytes).toBe(1000 * MIB3);
    expect(resampleEvent.detail!.priorSource).toBe("smi");
    // Dấu vết kẻ chui, dùng ĐÚNG ledgerTotal (500 MiB), KHÔNG phải committedBytes (0 MiB):
    // raw(9000) − priorBaseline(1000) − ledgerTotal(500) = 7500 MiB. Nếu công thức lỡ dùng
    // committedBytes thay vì ledgerTotal, kết quả sẽ SAI thành 8000 MiB — test này bắt được.
    expect(resampleEvent.detail!.driftIfNotResampled).toBe(7_500 * MIB3);
  });

  it("lượt chụp nền ĐẦU TIÊN (không có nền cũ) KHÔNG được có driftIfNotResampled — không bịa dữ liệu", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 1000 * MIB3, totalBytes: 32_607 * MIB3, source: "smi" }),
    }));
    const logged: Array<{ event: string; detail?: Record<string, unknown> }> = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: never) => logged.push(e) }));

    const { captureVramBaseline } = await import("./vramReconciler");
    await captureVramBaseline();

    const ev = logged.find((l) => l.event === "baseline")!;
    expect(ev.detail!.priorBaselineUsedBytes).toBeUndefined();
    expect(ev.detail!.driftIfNotResampled).toBeUndefined();
  });
});

/**
 * Pha 1.5 Task 1 review vòng 2 — MỚI-1: ngắt mạch KẸT VĨNH VIỄN nếu điều kiện đóng lại so với
 * THƯỚC ĐÓNG BĂNG lúc trip, thay vì so "nhịp này với nhịp trước".
 *
 * Reviewer dựng hai ca:
 *   Ca A — trip ở "native", ổn định lại ở ĐÚNG "native" ⇒ đóng lại được (code vòng 1 đã đúng).
 *   Ca B — trip ở "native", ổn định lại ở "smi" (KHÁC thước đóng băng) ⇒ MỌI nhịp sau đó vẫn
 *   `sourceUnstable=true, driftBytes=null` — breaker KHÔNG BAO GIỜ đóng lại dù thước đã hết dao
 *   động hoàn toàn. Đây đúng kịch bản "hai tiến trình cạnh tranh gắn handle" mà chính comment
 *   của round 1 nêu làm lý do cần ngắt mạch — có thể chốt ở thước nào cũng được, 50/50.
 *
 * Vòng 1 đã đổi "chuông câm vĩnh viễn" (EXP-1) lấy "mù drift vĩnh viễn + báo động treo mãi" —
 * cả hai đều là hỏng im lặng, cái sau còn ồn ào theo cách vô dụng.
 *
 * SỬA: điều kiện thoát ngắt mạch không còn là `device.source === baselineSource` (so với thước
 * ĐÓNG BĂNG) mà là "thước không đổi qua N nhịp liên tiếp" (so nhịp này với nhịp TRƯỚC, tự thân).
 * Khi đã ổn định — kể cả ở thước KHÁC thước đóng băng — phải CHỤP LẠI nền theo thước mới rồi mới
 * đối chiếu tiếp; nếu không nền đóng băng vẫn là một thước khác với số hiện tại, đúng lỗi Task 1
 * sinh ra để diệt.
 */
describe("Pha 1.5 Task 1 review vòng 2 — MỚI-1: ngắt mạch phải tự lành dù ổn định ở THƯỚC KHÁC thước đóng băng", () => {
  beforeEach(() => vi.resetModules());

  const MIB5 = 1024 * 1024;

  // Chuỗi ép TRIP dùng CHUNG cho cả hai ca — chốt "native" đúng như tên gọi reviewer đặt:
  // chụp nền ban đầu ở "smi", rồi bốn nhịp mismatch native→smi→native→(mismatch thứ 4, TRIP).
  // Ba resample đầu (count 1,2,3) lần lượt đặt baselineSource = native, smi, native — nhịp thứ
  // tư đọc "smi" (mismatch vs "native", count đã =3) ⇒ TRIP, ĐÓNG BĂNG ở "native" đúng như tên ca.
  async function tripFrozenAtNative(reconcileOnce: () => Promise<{ sourceUnstable: boolean }>, setSrc: (s: "native" | "smi") => void) {
    setSrc("native");
    await reconcileOnce(); // resample 1 → baselineSource="native"
    setSrc("smi");
    await reconcileOnce(); // resample 2 → baselineSource="smi"
    setSrc("native");
    await reconcileOnce(); // resample 3 → baselineSource="native"
    setSrc("smi");
    return reconcileOnce(); // mismatch thứ 4 ⇒ TRIP, đóng băng ở "native"
  }

  it("★ Ca B — trip ở \"native\", ổn định lại ở \"smi\" (khác thước đóng băng) ⇒ PHẢI tự lành, không mù drift vĩnh viễn", async () => {
    let src: "native" | "smi" = "smi";
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
      leaseBytes: (l: { actualBytes: number | null }) => l.actualBytes ?? 0,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 1000 * MIB5, totalBytes: 32_607 * MIB5, source: src }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline(); // nền ban đầu, thước "smi"

    const trip = await tripFrozenAtNative(reconcileOnce, (s) => { src = s; });
    expect(trip.sourceUnstable).toBe(true); // đóng băng ở "native"

    // Bây giờ thước ổn định lại — nhưng ở "smi", KHÁC thước đã đóng băng ("native"). Nhịp TRIP
    // ở trên vừa đọc "smi" nên streak đã =1 trước khi vòng lặp dưới bắt đầu.
    src = "smi";
    const results: Array<{ unstable: boolean; resampled: boolean; alarm: boolean; drift: number | null }> = [];
    for (let i = 0; i < 5; i++) {
      const r = await reconcileOnce();
      results.push({ unstable: r.sourceUnstable, resampled: r.baselineResampled, alarm: r.alarm, drift: r.driftBytes });
    }

    // SOURCE_UNSTABLE_THRESHOLD=3 (mặc định): nhịp TRIP đã đọc "smi" (streak=1); cần đúng 2 nhịp
    // "smi" liên tiếp NỮA để streak=3 ⇒ tự lành ở nhịp thứ hai của vòng lặp, resample theo "smi",
    // rồi từ nhịp thứ ba trở đi đối chiếu THẬT.
    expect(results.map((r) => r.unstable)).toEqual([true, false, false, false, false]);
    expect(results.map((r) => r.resampled)).toEqual([false, true, false, false, false]);
    expect(results.map((r) => r.alarm)).toEqual([true, false, false, false, false]);
    // ★ QUAN TRỌNG NHẤT (điều Ca B đòi): phải có nhịp đối chiếu THẬT (driftBytes khác null) —
    // không được mù drift vĩnh viễn.
    expect(results.map((r) => r.drift)).toEqual([null, null, 0, 0, 0]);
  });

  it("Ca A — trip ở \"native\", ổn định lại ở ĐÚNG \"native\" (thước đóng băng) ⇒ đóng lại NGAY lập tức, không cần chờ streak", async () => {
    let src: "native" | "smi" = "smi";
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
      leaseBytes: (l: { actualBytes: number | null }) => l.actualBytes ?? 0,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 1000 * MIB5, totalBytes: 32_607 * MIB5, source: src }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline(); // thước "smi"

    const trip = await tripFrozenAtNative(reconcileOnce, (s) => { src = s; });
    expect(trip.sourceUnstable).toBe(true); // đóng băng ở "native"

    // Ổn định lại ở ĐÚNG "native" — TRÙNG thước đóng băng ⇒ không hề mismatch, đóng lại NGAY ở
    // nhịp đầu tiên (KHÔNG cần đợi streak — nền cũ vẫn đúng cho thước này, không có gì để resample).
    src = "native";
    const r1 = await reconcileOnce();
    expect(r1.sourceUnstable).toBe(false);
    expect(r1.baselineResampled).toBe(false); // không cần resample — nền đóng băng đã đúng thước
    expect(r1.driftBytes).toBe(0); // đối chiếu THẬT ngay, không phải null
    expect(r1.alarm).toBe(false);
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
      readDeviceVram: async () => ({ usedBytes: BACKGROUND, totalBytes: 32_607 * MIB, source: "native" }),
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
      readDeviceVram: async () => ({ usedBytes: used, totalBytes: 32_607 * MIB, source: "native" }),
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
      readDeviceVram: async () => ({ usedBytes: BACKGROUND, totalBytes: 32_607 * MIB, source: "native" }),
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
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: used, totalBytes: 32_607 * MIB, source: "native" }),
    }));
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
      readDeviceVram: async () => ({ usedBytes: BACKGROUND, totalBytes: 32_607 * MIB, source: "native" }),
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
      readDeviceVram: async () => ({ usedBytes: BACKGROUND + DEEP_30B, totalBytes: 32_607 * MIB, source: "native" }),
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
      readDeviceVram: async () => ({ usedBytes: BACKGROUND + DEEP_30B, totalBytes: 32_607 * MIB, source: "native" }),
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
      readDeviceVram: async () => ({ usedBytes: BACKGROUND, totalBytes: 32_607 * MIB, source: "native" }),
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
        source: "native",
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
        source: "native",
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
      readDeviceVram: async () => (probeOk ? { usedBytes: BACKGROUND, totalBytes: 32_607 * MIB, source: "native" } : null),
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
      readDeviceVram: async () => (probeOk ? { usedBytes: BACKGROUND, totalBytes: 32_607 * MIB, source: "native" } : null),
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
      readDeviceVram: async () => (probeOk ? { usedBytes: BACKGROUND, totalBytes: 32_607 * MIB, source: "native" } : null),
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
