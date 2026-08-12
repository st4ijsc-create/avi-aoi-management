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
    // ⚠ I-4 (Pha 2A) thêm `measureSource` vào từng dòng ảnh chụp: từ Pha 2A tổng sổ là một phép
    // cộng TRỘN hai thước, nên chỉ biết "tổng có trộn" là chưa đủ — phải truy được giấy phép NÀO
    // đóng góp phần nào. `null` = giấy phép chưa từng commit (không có thước nào cả).
    // ⚠ T5-15 (Pha 2A Task 4) thêm `fallbackReason`: từ Task 4, `committed: true` KHÔNG còn đủ
    // để kết luận "đã đo được" — `commitFallback()` cũng điền `actualBytes` bằng một ƯỚC LƯỢNG dự
    // phòng. Hai dòng dưới đây đều `null` (không dòng nào là dự phòng), đúng như mọi bản ghi
    // trước Task 4 — nên ẢNH CHỤP CŨ vẫn đọc được y nguyên, chỉ thêm một cột.
    expect(logged[0].detail!.leases).toEqual([
      { owner: "sidecar:vision", kind: "external-process", priority: "background", bytes: 150 * MIB, committed: true, measureFailed: false, measureSource: null, fallbackReason: null },
      { owner: "gguf:qwen30b", kind: "gguf-model", priority: "production", bytes: 500 * MIB, committed: false, measureFailed: false, measureSource: null, fallbackReason: null },
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

  /**
   * ★★★★ Pha 9 nhóm B · **B4 / X-2 — `warn.mock.calls[0]` LÀ MỘT GIẢ ĐỊNH VỀ THỨ TỰ, KHÔNG PHẢI
   * MỘT PHÉP ĐO.**
   *
   * ════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ ĐO ĐƯỢC — VÀ CHÍNH LƯỢT SHUFFLE VỪA ĐƯỢC ĐƯA VÀO CỔNG (B4) LÀ THỨ TÌM RA NÓ
   * ════════════════════════════════════════════════════════════════════════════════════════════
   *   · thứ tự CỐ ĐỊNH (cổng thường): 151 file / 2393 ca **xanh**
   *   · riêng file này:               **45/45 xanh**
   *   · thứ tự TRỘN (`--sequence.shuffle.tests`): ca *"cảnh báo lệch ÂM"* **ĐỎ**
   *         expected '[vram] nền vừa chốt CHƯA XÁC MINH ĐƯỢC…' to contain 'treo'
   *
   * Nguyên nhân: `reconcileOnce()` phát **nhiều** câu `console.warn`, và câu **đầu tiên** không
   * phải lúc nào cũng là câu chẩn đoán lệch. Khi một ca khác chạy trước để lại trạng thái mức
   * module, lượt này còn phát thêm câu *"nền vừa chốt CHƯA XÁC MINH ĐƯỢC"* — một cảnh báo **hoàn
   * toàn hợp lệ, thuộc trục khác** — và nó chiếm mất ô `calls[0]`.
   *
   * ⚠⚠ ĐÂY LÀ LỖI THIẾT BỊ, KHÔNG PHẢI LỖI SẢN PHẨM — và phân biệt được điều đó là cả vấn đề:
   *    câu sản phẩm nhận được **đúng nội dung của nó**; thứ sai là **giả định của ca test** rằng
   *    câu chẩn đoán đứng ở chỉ số 0. Vá bằng cách nới `usedBytes` cho câu kia thôi phát ra sẽ là
   *    *"nắn mã cho vừa lưới"*; vá bằng cách bỏ `not.toContain` sẽ là **làm yếu lưới đi**.
   * ⇒ Vá đúng: hỏi **TOÀN BỘ** các câu cảnh báo của lượt gọi ấy. Phép hỏi mới **CHẶT HƠN** bản cũ
   *   theo cả hai chiều — `toContain` nay đúng khi câu chẩn đoán ở **bất kỳ** vị trí nào, còn
   *   `not.toContain` nay cấm chẩn đoán sai xuất hiện ở **bất kỳ** câu nào, chứ không chỉ câu đầu.
   *
   * ⚠ I-2 (review round 1): câu cảnh báo phải CHẨN ĐOÁN ĐÚNG HƯỚNG. Lệch dương = có hộ tiêu
   *   thụ cấp phát không xin phép; lệch âm = giấy phép treo/số commit sai — KHÔNG phải cấp phát
   *   chui. Một câu cố định gắn sai nguyên nhân sẽ khiến người trực đi tìm sai chỗ.
   */
  const moiCanhBao = (spy: { mock: { calls: unknown[][] } }): string =>
    spy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
  it("cảnh báo lệch DƯƠNG phải nói 'cấp phát KHÔNG XIN PHÉP', KHÔNG nói 'treo'", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce } = await import("./vramReconciler");
    await reconcileOnce();
    const msg = moiCanhBao(warnSpy);
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
    const msg = moiCanhBao(warnSpy);
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
    // ⚠ Task 7 (T5-1): lease vẫn pending lúc chụp ⇒ lượt chụp bị HOÃN, nền = "chưa biết". Người
    // gọi `reconcileOnce()` TRỰC TIẾP (không qua `startVramReconciler()`) thì "chưa biết" = so
    // số THÔ, đúng như hợp đồng I-1 — nên ca này vẫn đo đúng thứ nó sinh ra để đo.
    await captureVramBaseline();
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
    //
    // ⚠⚠ VÁ SAU REVIEW TOÀN NHÁNH (C-1 × T5-1) — Ý ĐỊNH TRÊN NAY BẤT KHẢ ĐẠT TẠI SỰ KIỆN NÀY,
    // và đó là HỆ QUẢ CẤU TRÚC chứ không phải một lỗ hổng bỏ ngỏ. Bản trước lách lá chắn HOÃN của
    // Task 7 bằng `measureFailed: true` để giữ `ledgerTotal ≠ committedBytes`; lối lách đó nay
    // ĐÓNG (lá chắn dùng `actualBytes === null`, BẤT KỂ `measureFailed`). Mà `totalReservedBytes`
    // của broker = `Σ (actualBytes ?? estimatedBytes)` (`totalReserved()` + `leaseBytes()` trong
    // `vramBroker.ts` — ⚠ N-6: mô tả tương đối, KHÔNG ghim số dòng), nên **hễ lượt chụp
    // THÀNH CÔNG thì MỌI lease đã có `actualBytes` ⇒ `ledgerTotal ≡ committedBytes`**: hoán hai
    // biến cho nhau ở sự kiện `baseline` là một ĐỘT BIẾN VÔ NGHĨA, không test nào bắt được vì
    // không có gì để bắt.
    // ⇒ Phép phân biệt hai biến đã CHUYỂN sang sự kiện `baseline_deferred` — nơi DUY NHẤT còn tồn
    // tại lease `actualBytes === null` — và ca "★ (b) lượt HOÃN ở nhánh resample vẫn PHẢI để lại
    // dấu vết EXP-2" (describe Task 7 bên dưới) canh đúng nó: `driftIfNotResampled` ở đó phải bằng
    // `DEVICE_B − BG_B − (BACKEND_B + DEEP_EST_B)`, tức ledgerTotal 17.293 MiB chứ KHÔNG phải
    // committedBytes 422 MiB. Ca này giữ phần còn lại của EXP-2: nền CŨ + dấu vết kẻ chui.
    const acquiredAt = new Date();
    const pendingLease = {
      id: "lease-committed",
      request: { owner: "gguf:committed", kind: "gguf-model", estimatedBytes: 500 * MIB3, priority: "interactive" },
      acquiredAt,
      actualBytes: 500 * MIB3, // ĐÃ commit — bắt buộc, nếu không lá chắn HOÃN (T5-1) chặn lượt chụp
      measureFailed: false,
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
    // nền = raw(1000) − committedBytes(500) = 500 MiB.
    expect(await captureVramBaseline()).toBe(500 * MIB3); // nền cũ, thước "smi"

    src = "native";
    used = 1000 * MIB3 + 8_000 * MIB3; // 8 GB chui grab ĐÚNG lúc đổi thước
    const r = await reconcileOnce();
    expect(r.baselineResampled).toBe(true);
    expect(r.alarm).toBe(false); // đúng thiết kế Task 1 — KHÔNG báo động lượt phát hiện đổi thước

    const baselineEvents = logged.filter((l) => l.event === "baseline");
    expect(baselineEvents).toHaveLength(2); // nhịp 0 (chụp lần đầu) + nhịp resample này
    const resampleEvent = baselineEvents[1];
    expect(resampleEvent.detail!.priorBaselineUsedBytes).toBe(500 * MIB3);
    expect(resampleEvent.detail!.priorSource).toBe("smi");
    // Dấu vết kẻ chui: raw(9000) − priorBaseline(500) − ledgerTotal(500) = 8000 MiB — ĐÚNG bằng
    // khoản 8 GB vừa grab. Không ghi con số này thì kẻ chui biến mất vĩnh viễn vào nền MỚI.
    expect(resampleEvent.detail!.driftIfNotResampled).toBe(8_000 * MIB3);
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
   * SỬA (vòng 3): chỉ trừ phần ĐÃ COMMIT.
   *
   * ⚠⚠ SỬA LẠI (Pha 1.5 Task 7 / T5-1) — LÝ LẼ CỦA VÒNG 3 ĐÃ BỊ SỐ LIỆU BÁC BỎ: đo được
   * `nvidia-smi = 18.115 MiB` KHI giấy phép 30B vẫn `pending` ⇒ *"chưa commit ⇒ chưa nằm trong
   * deviceUsed"* là SAI, và công thức vòng 3 nuốt trọn model vào nền (978 → 17.891 MiB, drift
   * −16.700 MiB, KHÔNG BAO GIỜ tự lành). Trong cửa sổ nạp KHÔNG CÔNG THỨC NÀO đúng — trừ 0 thì
   * thừa nền, trừ cả ước lượng thì thiếu nền. ⇒ HOÃN chụp, thử lại nhịp sau.
   *
   * ⚠ Ý ĐỊNH của hai ca ★★ dưới đây KHÔNG ĐỔI — chúng vẫn canh đúng một điều: **nền phải ra 941,
   * không được là 0 và cũng không được là 17.941**. Chỉ CƠ CHẾ đổi: từ "chụp ngay bằng một phỏng
   * đoán" sang "chờ tới lúc biết chắc rồi mới chụp".
   */
  it("★★ chụp nền TRÚNG cửa sổ chưa-commit ⇒ HOÃN (không kẹp về 0, cũng không nuốt model), rồi ra ĐÚNG 941", async () => {
    // Sổ đã cộng 17 GB ƯỚC LƯỢNG; thiết bị vật lý chưa kịp tăng.
    let done = false;
    vi.doMock("./vramBroker", () => ({
      snapshot: () =>
        done
          ? { totalReservedBytes: DEEP_30B, leases: [committed(DEEP_30B)] }
          : { totalReservedBytes: DEEP_30B, leases: [pending(DEEP_30B)] },
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({
        usedBytes: done ? BACKGROUND + DEEP_30B : BACKGROUND,
        totalBytes: 32_607 * MIB,
        source: "native",
      }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBeNull(); // TUYỆT ĐỐI không kết luận trong cửa sổ nạp
    done = true;
    expect(await captureVramBaseline()).toBe(BACKGROUND); // nhịp sau: 941, KHÔNG phải 0, KHÔNG phải 17.941
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

    const { __runReconcileTick, captureVramBaseline } = await import("./vramReconciler");
    await captureVramBaseline(); // TRÚNG cửa sổ chưa-commit ⇒ HOÃN (Task 7)
    done = true; // model tải xong, commit số thật

    // `__runReconcileTick()` = ĐÚNG thứ bộ đếm giờ gọi mỗi nhịp: thử chụp lại RỒI đối chiếu.
    const r = await __runReconcileTick();
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

/**
 * ★★ Pha 1.5 TASK 7 (T5-1) — NỀN THÔI NUỐT MODEL ĐANG NẠP.
 *
 * Task 5 (chỉ-đo) tìm ra: `nền = raw − Σ actualBytes` cho giấy phép ĐANG NẠP đóng góp **0**
 * trong khi byte của nó **ĐÃ nằm trong `raw`** ⇒ nền nuốt trọn model. Đo được (báo cáo §5.3,
 * `vram_events.id=83`): `priorBaseline 978 → baseline 17.891 MiB`, `drift = −16.700 MiB`,
 * **báo động 100 % mọi nhịp, KHÔNG BAO GIỜ tự lành** (`baselineCaptured = true` đóng băng vĩnh
 * viễn; chỉ khởi động lại tiến trình mới gỡ được).
 *
 * ⚠⚠ HAI ĐƯỜNG GỌI, CẢ HAI ĐỀU DÍNH — vá một đường là KHÔNG ĐẠT:
 *   (a) `startVramReconciler()` — lượt chụp ĐẦU lúc boot, đua với `warmUpOllamaModels()`
 *       (`setTimeout(2000)`, `index.ts:4931` → `:5229`). KHÔNG sinh sự kiện resample nào ⇒
 *       KHÓ CHẨN ĐOÁN HƠN (b).
 *   (b) `reconcileOnce()` — nhánh RESAMPLE. ĐÃ ĐO, tái hiện 2/2.
 *
 * ⚠ TIỀN ĐỀ CŨ BỊ BÁC BỎ (docstring `captureVramBaseline()`): *"giấy phép chưa commit ⇒ CHƯA
 * nằm trong deviceUsed"*. Đo được `nvidia-smi = 18.115 MiB` khi giấy phép 30B vẫn `pending` —
 * *"chưa commit"* chỉ nghĩa **sổ chưa theo kịp**, KHÔNG nghĩa thiết bị còn trống.
 *
 * SỬA: trong cửa sổ nạp, byte thật của lease pending nằm ĐÂU ĐÓ giữa 0 và ước lượng, và KHÔNG
 * CÓ CÁCH NÀO biết từ một lượt đọc. `raw − Σ actualBytes` sai theo hướng THỪA nền (nuốt model),
 * `raw − ledgerTotal` sai theo hướng THIẾU nền (kẹp về 0 — đúng lỗi vòng 3 đã vá). ⇒ Lượt chụp
 * rơi vào cửa sổ đó KHÔNG ĐÁNG TIN theo BẤT KỲ công thức nào ⇒ **HOÃN, thử lại nhịp sau** —
 * cùng khuôn `if (raw < committedBytes)` sẵn có, nằm BÊN TRONG hàm nên phủ CẢ HAI đường theo
 * cấu trúc.
 */
describe("Pha 1.5 Task 7 (T5-1) — nền thôi nuốt model đang nạp, CẢ HAI đường gọi", () => {
  beforeEach(() => vi.resetModules());

  const MIB7 = 1024 * 1024;

  const pendingLease = (owner: string, est: number) => ({
    id: owner,
    request: { owner, kind: "gguf-model", estimatedBytes: est, priority: "interactive" },
    actualBytes: null as number | null,
    measureFailed: false,
    acquiredAt: new Date(),
    lastHeartbeatAt: new Date(),
    released: false,
  });
  const committedLease = (owner: string, actual: number, kind = "gguf-model") => ({
    id: owner,
    request: { owner, kind, estimatedBytes: actual, priority: "interactive" },
    actualBytes: actual as number | null,
    measureFailed: false,
    acquiredAt: new Date(),
    lastHeartbeatAt: new Date(),
    released: false,
  });
  const leaseBytesMock = (l: { actualBytes: number | null; request: { estimatedBytes: number } }) =>
    l.actualBytes ?? l.request.estimatedBytes;

  // ── ĐƯỜNG (a): lượt chụp ĐẦU lúc boot ─────────────────────────────────────────────────────
  const BG_A = 900 * MIB7;
  const DEEP_A = 17_000 * MIB7;

  it("★★ (a) chụp nền LẦN ĐẦU khi model đang nạp ⇒ KHÔNG nuốt 17 GB vào nền", async () => {
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: DEEP_A, leases: [pendingLease("gguf:30B", DEEP_A)] }),
      leaseBytes: leaseBytesMock,
    }));
    // Trọng số ĐÃ lên thiết bị (đo được 18.115 MiB khi lease vẫn pending) nhưng sổ chưa theo kịp.
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: BG_A + DEEP_A, totalBytes: 32_607 * MIB7, source: "smi" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline } = await import("./vramReconciler");
    const base = await captureVramBaseline();

    expect(base).not.toBe(BG_A + DEEP_A); // TUYỆT ĐỐI không được nuốt cả 17,9 GB
    expect(base).toBeNull(); // không đoán bừa: HOÃN, thử lại nhịp sau
  });

  it("★★ (a) qua ĐÚNG startVramReconciler() ⇒ hoãn thì IM LẶNG, rồi TỰ LÀNH ra nền ĐÚNG", async () => {
    let loaded = false;
    vi.doMock("./vramBroker", () => ({
      snapshot: () =>
        loaded
          ? { totalReservedBytes: DEEP_A, leases: [committedLease("gguf:30B", DEEP_A)] }
          : { totalReservedBytes: DEEP_A, leases: [pendingLease("gguf:30B", DEEP_A)] },
      leaseBytes: leaseBytesMock,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: BG_A + DEEP_A, totalBytes: 32_607 * MIB7, source: "smi" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { startVramReconciler, stopVramReconciler, __runReconcileTick, reconcileOnce } =
      await import("./vramReconciler");
    try {
      startVramReconciler(); // ĐÚNG đường (a): `void captureVramBaseline()` ngay lúc boot
      await new Promise((r) => setImmediate(r));

      const during = await reconcileOnce();
      expect(during.baselineUsedBytes).toBeNull(); // KHÔNG ghim 17.900 MiB
      expect(during.alarm).toBe(false); // hoãn ngắn thì im lặng, chưa trip
      expect(during.baselineBlocked).toBe(false);

      loaded = true; // commitMeasured() đã chạy
      const after = await __runReconcileTick();
      expect(after.baselineUsedBytes).toBe(BG_A); // nền ĐÚNG, không phải 17.900
      expect(after.driftBytes).toBe(0);
      expect(after.alarm).toBe(false);
    } finally {
      stopVramReconciler();
    }
  });

  // ── ĐƯỜNG (b): nhánh RESAMPLE — số liệu pháp y THẬT của `vram_events.id=83` ────────────────
  const BG_B = 978 * MIB7; // nền ĐÚNG, đo được lúc boot
  const BACKEND_B = 422 * MIB7; // gguf-backend, ĐÃ commit
  const DEEP_EST_B = 16_871 * MIB7; // ước lượng 30B lúc reserve()
  const DEEP_ACT_B = 16_913 * MIB7; // số THẬT sau commitMeasured()
  const DEVICE_B = 18_313 * MIB7; // 978 + 422 + 16.913 — trọng số ĐÃ lên thiết bị
  const POISONED_B = 17_891 * MIB7; // 18.313 − 422 — nền NHIỄM đã đo được

  it("★★ (b) nhánh RESAMPLE khi model đang nạp ⇒ cũng KHÔNG nuốt (tái hiện vram_events.id=83)", async () => {
    let phase: "boot" | "loading" | "loaded" = "boot";
    vi.doMock("./vramBroker", () => ({
      snapshot: () => {
        if (phase === "boot") return { totalReservedBytes: 0, leases: [] };
        if (phase === "loading") {
          return {
            totalReservedBytes: BACKEND_B + DEEP_EST_B,
            leases: [committedLease("gguf:backend", BACKEND_B, "gguf-backend"), pendingLease("gguf:30B", DEEP_EST_B)],
          };
        }
        return {
          totalReservedBytes: BACKEND_B + DEEP_ACT_B,
          leases: [committedLease("gguf:backend", BACKEND_B, "gguf-backend"), committedLease("gguf:30B", DEEP_ACT_B)],
        };
      },
      leaseBytes: leaseBytesMock,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({
        usedBytes: phase === "boot" ? BG_B : DEVICE_B,
        totalBytes: 32_607 * MIB7,
        // `loadGgufModel → getLlama → setLlamaInstanceHandle` ĐỔI THƯỚC, rồi `llama.loadModel`
        // đẩy 17 GB — HAI sự kiện của CÙNG một chuỗi gọi, không độc lập (báo cáo §5.6).
        source: phase === "boot" ? "smi" : "native",
      }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline, __runReconcileTick, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(BG_B); // nền ĐÚNG lúc boot, thước "smi"

    phase = "loading";
    const r = await reconcileOnce(); // đổi thước ⇒ RESAMPLE
    expect(r.baselineResampled).toBe(true);
    expect(r.baselineUsedBytes).not.toBe(POISONED_B); // ★ nền KHÔNG được thành 17.891 MiB
    expect(r.baselineUsedBytes).toBeNull(); // hoãn, thử lại nhịp sau
    expect(r.alarm).toBe(false);

    phase = "loaded";
    const r2 = await __runReconcileTick();
    expect(r2.baselineUsedBytes).toBe(BG_B); // nền ĐÚNG được chụp lại, không phải 17.891
    expect(r2.driftBytes).toBe(0); // và drift KHÔNG phải −16.700 MiB
    expect(r2.alarm).toBe(false);
  });

  it("★ (b) lượt HOÃN ở nhánh resample vẫn PHẢI để lại dấu vết EXP-2 (nền cũ + drift-nếu-không-huỷ)", async () => {
    // ⚠ Đường KIA của cùng bản vá: nền CŨ đã bị huỷ TRƯỚC khi gọi `captureVramBaseline()`. Nếu
    // lượt hoãn không ghi gì, lưới pháp y mà Task 1 vòng 1 (EXP-2) dựng lên biến mất ĐÚNG trong
    // kịch bản phổ biến nhất (resample xảy ra vì một lượt nạp model — tức LUÔN có lease pending).
    let phase: "boot" | "loading" = "boot";
    vi.doMock("./vramBroker", () => ({
      snapshot: () =>
        phase === "boot"
          ? { totalReservedBytes: 0, leases: [] }
          : {
              totalReservedBytes: BACKEND_B + DEEP_EST_B,
              leases: [committedLease("gguf:backend", BACKEND_B, "gguf-backend"), pendingLease("gguf:30B", DEEP_EST_B)],
            },
      leaseBytes: leaseBytesMock,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({
        usedBytes: phase === "boot" ? BG_B : DEVICE_B,
        totalBytes: 32_607 * MIB7,
        source: phase === "boot" ? "smi" : "native",
      }),
    }));
    const logged: Array<{ event: string; detail?: Record<string, unknown> }> = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: never) => logged.push(e) }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline();
    phase = "loading";
    await reconcileOnce();

    const ev = logged.find((l) => l.event === "baseline_deferred");
    expect(ev).toBeDefined();
    expect(ev!.detail!.priorBaselineUsedBytes).toBe(BG_B);
    expect(ev!.detail!.priorSource).toBe("smi");
    // Cùng công thức EXP-2: raw − nềnCũ − ledgerTotal (KHÔNG phải committedBytes).
    expect(ev!.detail!.driftIfNotResampled).toBe(DEVICE_B - BG_B - (BACKEND_B + DEEP_EST_B));
    // Và phải nói RÕ ai đang chặn — đường (a) không có dòng resample nào để truy ngược.
    expect(ev!.detail!.blockingOwners).toEqual(["gguf:30B"]);
  });

  // ── "NẾU LUÔN CÓ LEASE PENDING THÌ NỀN KHÔNG BAO GIỜ CHỤP ĐƯỢC?" ─────────────────────────
  /**
   * ★★ VÁ SAU REVIEW TOÀN NHÁNH (C-1 × T5-1) — Task 8 MỞ LẠI đúng cửa Task 7 sinh ra để đóng.
   *
   * ⚠⚠ CA NÀY THAY MỘT CA CŨ ĐANG KHOÁ HÀNH VI SAI. Ca cũ khẳng định "lease `measureFailed`
   * KHÔNG được chặn chụp nền" và dùng **reranker 606 MiB** (thật 14-18 MiB, vô hại) — với con
   * số đó thì chụp hay hoãn cũng chỉ lệch vài chục MiB, tức ca đó **KHÔNG PHÂN BIỆT ĐƯỢC** hành
   * vi đúng với hành vi hỏng. Khi Task 8 gắn `measureFailed` cho **cửa sổ đo chồng lấn** thì dân
   * số của cờ đó đổi tận gốc: một model 30B **17 GB** cũng mang cờ này, `actualBytes` đứng `null`
   * VĨNH VIỄN, mà **byte thật của nó ĐANG NẰM TRÊN THIẾT BỊ**. Nó rơi khỏi lá chắn HOÃN **và**
   * đóng góp **0** vào `committedBytes` ⇒ `nền = raw − committedBytes` nuốt trọn nó, `baselineCaptured`
   * bật ⇒ **drift −17 GB, alarm 100 % mọi nhịp, chỉ restart mới gỡ** = ĐÚNG chữ ký T5-1.
   *
   * ⇒ Tiêu chí ĐÚNG của lá chắn HOÃN là *"giữ byte thật mà đóng góp 0 vào `committedBytes`"*
   * = `actualBytes === null`, **BẤT KỂ `measureFailed`**. Lý do gốc loại `measureFailed` (sợ khoá
   * nền vĩnh viễn) nay đã THỪA: chính Task 7 đã dựng `BASELINE_BLOCKED_ALARM_MS` để lo việc đó —
   * ca cuối của khối này canh đúng lối thoát ấy.
   */
  const BG_C = 1_000 * MIB7; // nền THẬT của máy
  const DEEP_C = 17_000 * MIB7; // 30B — cửa sổ đo CHỒNG ⇒ Task 8 gắn measureFailed
  const EMB_C = 300 * MIB7; // lượt nạp thứ hai, commit BÌNH THƯỜNG
  const DEVICE_C = BG_C + DEEP_C + EMB_C; // 18.300 MiB — cả hai đã lên thiết bị
  const POISONED_C = DEVICE_C - EMB_C; // 18.000 MiB — nền NHIỄM nếu bỏ sót lease đo-hỏng

  /** Lease đo-hỏng: `actualBytes` null VĨNH VIỄN nhưng byte thật ĐÃ nằm trên thiết bị. */
  const failedLease = (owner: string, est: number) => ({ ...pendingLease(owner, est), measureFailed: true });

  it("★★ C-1×T5-1: lease ĐO HỎNG 17 GB vẫn GIỮ BYTE THẬT ⇒ TUYỆT ĐỐI không được nuốt vào nền", async () => {
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({
        totalReservedBytes: DEEP_C + EMB_C,
        leases: [failedLease("gguf:30B", DEEP_C), committedLease("gguf:embed", EMB_C)],
      }),
      leaseBytes: leaseBytesMock,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: DEVICE_C, totalBytes: 32_607 * MIB7, source: "native" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline } = await import("./vramReconciler");
    const base = await captureVramBaseline();

    expect(base).not.toBe(POISONED_C); // ★ nền TUYỆT ĐỐI không được thành 18.000 MiB
    expect(base).toBeNull(); // HOÃN — không có công thức nào đúng trong cửa sổ này
  });

  it("★★ C-1×T5-1: nền nhiễm ⇒ drift −17 GB alarm MỌI NHỊP không tự lành; bản đúng phải TỰ LÀNH", async () => {
    // Hai lượt nạp CHỒNG (17.000 + 300 MiB) rồi 30B NHẢ chỗ. Với nền nhiễm 18.000 MiB, mọi nhịp
    // SAU đó thấy `1.300 − 18.000 − 300 = −17.000 MiB` và `baselineCaptured` đã bật ⇒ KHÔNG BAO
    // GIỜ chụp lại. Đây đúng chữ ký T5-1 mà Task 7 đã vá, sống lại qua cửa `measureFailed`.
    let deepAlive = true;
    vi.doMock("./vramBroker", () => ({
      snapshot: () =>
        deepAlive
          ? {
              totalReservedBytes: DEEP_C + EMB_C,
              leases: [failedLease("gguf:30B", DEEP_C), committedLease("gguf:embed", EMB_C)],
            }
          : { totalReservedBytes: EMB_C, leases: [committedLease("gguf:embed", EMB_C)] },
      leaseBytes: leaseBytesMock,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({
        usedBytes: deepAlive ? DEVICE_C : BG_C + EMB_C,
        totalBytes: 32_607 * MIB7,
        source: "native",
      }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { startVramReconciler, stopVramReconciler, __runReconcileTick } = await import("./vramReconciler");
    try {
      startVramReconciler();
      await new Promise((r) => setImmediate(r));

      const during = await __runReconcileTick();
      expect(during.baselineUsedBytes).toBeNull(); // KHÔNG ghim 18.000 MiB

      deepAlive = false; // 30B nhả chỗ — byte của nó rời thiết bị
      const healed = await __runReconcileTick();
      expect(healed.baselineUsedBytes).toBe(BG_C); // nền ĐÚNG 1.000, không phải 18.000
      expect(healed.driftBytes).toBe(0); // và KHÔNG phải −17.000 MiB
      expect(healed.alarm).toBe(false);
    } finally {
      stopVramReconciler();
      warnSpy.mockRestore();
    }
  });

  it("ĐỐI CHỨNG (đột biến): KHÔNG lease nào `actualBytes === null` ⇒ chụp nền NGAY, không hoãn bừa", async () => {
    // Ca tuần tự của reviewer: cả hai lượt nạp commit bình thường ⇒ lá chắn KHÔNG được chạm.
    // Thiếu ca này thì một bản vá "hoãn tất" cũng xanh — lưới sẽ không chứng minh được gì.
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({
        totalReservedBytes: DEEP_C + EMB_C,
        leases: [committedLease("gguf:30B", DEEP_C), committedLease("gguf:embed", EMB_C)],
      }),
      leaseBytes: leaseBytesMock,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: DEVICE_C, totalBytes: 32_607 * MIB7, source: "native" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

    const { captureVramBaseline } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(BG_C); // 1.000 MiB — ĐÚNG, chồng lấn mới là nguyên nhân
  });

  it("★★ lease ĐO HỎNG chặn nền thì KHÔNG được im lặng: phải KÊU đúng tên, rồi TỰ LÀNH khi nó nhả", async () => {
    // ⚠ ĐÂY LÀ CHỖ TRẢ LỜI nỗi lo của ca cũ ("chặn theo measureFailed là khoá nền VĨNH VIỄN").
    // Nỗi lo đó ĐÚNG về hiện tượng nhưng nay đã có người canh: `BASELINE_BLOCKED_ALARM_MS`
    // (Task 7) biến "im lặng vĩnh viễn" thành "báo động có tên thủ phạm", và lượt chụp thành
    // công đầu tiên xoá đồng hồ. Đổi lấy: KHÔNG BAO GIỜ ghim một con số nền đã nhiễm 17 GB.
    const prev = process.env.VRAM_BASELINE_BLOCKED_ALARM_MS;
    process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = "0"; // trip ngay ở lượt hoãn đầu
    try {
      let deepAlive = true;
      vi.doMock("./vramBroker", () => ({
        snapshot: () =>
          deepAlive
            ? { totalReservedBytes: DEEP_C, leases: [failedLease("gguf:30B", DEEP_C)] }
            : { totalReservedBytes: 0, leases: [] },
        leaseBytes: leaseBytesMock,
      }));
      vi.doMock("./vramProbe", () => ({
        readDeviceVram: async () => ({
          usedBytes: deepAlive ? BG_C + DEEP_C : BG_C,
          totalBytes: 32_607 * MIB7,
          source: "native",
        }),
      }));
      const logged: Array<{ event: string; detail?: Record<string, unknown> }> = [];
      vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: never) => logged.push(e) }));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { startVramReconciler, stopVramReconciler, __runReconcileTick } = await import("./vramReconciler");
      try {
        startVramReconciler();
        await new Promise((r) => setImmediate(r));

        const blocked = await __runReconcileTick();
        expect(blocked.baselineBlocked).toBe(true);
        expect(blocked.alarm).toBe(true); // ★ KHÔNG được im lặng
        expect(blocked.baselineUsedBytes).toBeNull();
        expect(logged.map((l) => l.event)).toContain("baseline_blocked");
        const msg = warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
        expect(msg).toContain("gguf:30B"); // nói RÕ ai đang chặn
        expect(msg).not.toContain("KHÔNG XIN PHÉP"); // KHÔNG đổ oan "cấp phát chui"

        // "Bao lâu tự lành?" — ĐÚNG MỘT NHỊP sau khi lease đo-hỏng nhả chỗ.
        deepAlive = false;
        const healed = await __runReconcileTick();
        expect(healed.baselineUsedBytes).toBe(BG_C);
        expect(healed.baselineBlocked).toBe(false);
        expect(healed.alarm).toBe(false);
      } finally {
        stopVramReconciler();
        warnSpy.mockRestore();
      }
    } finally {
      if (prev === undefined) delete process.env.VRAM_BASELINE_BLOCKED_ALARM_MS;
      else process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = prev;
    }
  });

  it("★★ ĐÁNH ĐỔI ĐO ĐƯỢC: cron 03:00 trên server đã CHỤP ĐƯỢC NỀN ⇒ KHÔNG kêu — chuông không oan mỗi đêm", async () => {
    // ⚠ ĐÂY LÀ CÂU TRẢ LỜI CHO "đưa `measureFailed` trở lại lá chắn HOÃN có làm nền không bao giờ
    // chụp được khi cron chạy 30 phút không?" — và câu trả lời là MỘT TÍNH CHẤT CẤU TRÚC, không
    // phải may mắn: `captureVramBaseline()` thoát NGAY ở dòng đầu khi `baselineCaptured` đã bật
    // (trước cả lượt đọc đầu dò), nên lá chắn HOÃN **không có cách nào chạy** trên một tiến trình
    // đã có nền. Cron `0 3 * * *` giữ `actualBytes === null` suốt 30 phút MỖI ĐÊM vẫn KHÔNG chạm
    // được vào nó. Cửa sổ mà lá chắn thật sự tác dụng chỉ là: **từ boot tới lượt chụp thành công
    // đầu tiên**, cộng nhánh RESAMPLE (đổi thước — thực tế 1 lần/đời tiến trình, và ngắt mạch chặn
    // ở 3 lần liên tiếp). Không có ca này thì con số đánh đổi ở báo cáo §11 chỉ là suy đoán.
    const prev = process.env.VRAM_BASELINE_BLOCKED_ALARM_MS;
    process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = "0"; // kêu SỚM NHẤT có thể — nếu có gì để kêu
    try {
      let cronRunning = false;
      const cron = {
        id: "cron:kb-sync",
        request: { owner: "cron:kb-sync", kind: "external-process", estimatedBytes: 1_251 * MIB7, priority: "background" },
        actualBytes: null as number | null,
        measureFailed: false,
        acquiredAt: new Date(),
        lastHeartbeatAt: new Date(),
        released: false,
      };
      vi.doMock("./vramBroker", () => ({
        snapshot: () =>
          cronRunning ? { totalReservedBytes: 1_251 * MIB7, leases: [cron] } : { totalReservedBytes: 0, leases: [] },
        leaseBytes: leaseBytesMock,
      }));
      vi.doMock("./vramProbe", () => ({
        readDeviceVram: async () => ({
          usedBytes: cronRunning ? 2_000 * MIB7 : 1_000 * MIB7,
          totalBytes: 32_607 * MIB7,
          source: "native",
        }),
      }));
      const logged: Array<{ event: string }> = [];
      vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: never) => logged.push(e) }));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { startVramReconciler, stopVramReconciler, __runReconcileTick } = await import("./vramReconciler");
      try {
        startVramReconciler(); // boot lúc sổ RỖNG ⇒ nền chụp được ngay, đúng đường sản xuất
        await new Promise((r) => setImmediate(r));
        const boot = await __runReconcileTick();
        expect(boot.baselineUsedBytes).toBe(1_000 * MIB7);

        cronRunning = true; // 03:00 — cron sống 30 phút, `actualBytes` null suốt
        const nightly = await __runReconcileTick();
        expect(nightly.baselineBlocked).toBe(false); // ★ KHÔNG kêu "không chụp được nền"
        expect(nightly.baselineUsedBytes).toBe(1_000 * MIB7); // nền cũ giữ nguyên, không bị huỷ
        expect(logged.some((l) => l.event === "baseline_blocked")).toBe(false);
        expect(logged.some((l) => l.event === "baseline_deferred")).toBe(false);
      } finally {
        stopVramReconciler();
        warnSpy.mockRestore();
      }
    } finally {
      if (prev === undefined) delete process.env.VRAM_BASELINE_BLOCKED_ALARM_MS;
      else process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = prev;
    }
  });

  it("★★ hoãn KÉO DÀI ⇒ PHẢI trip báo động 'không chụp được nền', KHÔNG được im lặng vĩnh viễn", async () => {
    // Hộ `external-process` CỐ Ý không bao giờ commit (`cron:kb-sync` 30 phút, `cron:kb-eval-gate`
    // 10 phút, `sidecar:local-trainer` 2 GIỜ — đo ở mã, xem báo cáo Task 7). Nếu một trong số đó
    // đang sống lúc cần chụp nền, lượt hoãn kéo dài cả giờ. `baselineRequired && baseline ===
    // null` trả `alarm:false` ⇒ IM LẶNG mà KHÔNG AI BIẾT là đang im lặng — đúng EXP-1.
    const prev = process.env.VRAM_BASELINE_BLOCKED_ALARM_MS;
    process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = "0"; // trip ngay ở lượt hoãn đầu
    try {
      let running = true;
      const cron = {
        id: "cron:kb-sync",
        request: { owner: "cron:kb-sync", kind: "external-process", estimatedBytes: 1_251 * MIB7, priority: "background" },
        actualBytes: null as number | null,
        measureFailed: false,
        acquiredAt: new Date(),
        lastHeartbeatAt: new Date(),
        released: false,
      };
      vi.doMock("./vramBroker", () => ({
        snapshot: () =>
          running ? { totalReservedBytes: 1_251 * MIB7, leases: [cron] } : { totalReservedBytes: 0, leases: [] },
        leaseBytes: leaseBytesMock,
      }));
      vi.doMock("./vramProbe", () => ({
        readDeviceVram: async () => ({
          usedBytes: running ? 2_251 * MIB7 : 1_000 * MIB7,
          totalBytes: 32_607 * MIB7,
          source: "native",
        }),
      }));
      const logged: Array<{ event: string; detail?: Record<string, unknown> }> = [];
      vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: never) => logged.push(e) }));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { startVramReconciler, stopVramReconciler, __runReconcileTick } = await import("./vramReconciler");
      try {
        startVramReconciler();
        await new Promise((r) => setImmediate(r));

        const blocked = await __runReconcileTick();
        expect(blocked.baselineUsedBytes).toBeNull();
        expect(blocked.baselineBlocked).toBe(true);
        expect(blocked.alarm).toBe(true); // ★ KHÔNG được im lặng
        expect(blocked.driftBytes).toBeNull(); // và KHÔNG được bịa một drift từ nền chưa biết
        expect(logged.map((l) => l.event)).toContain("baseline_blocked");
        const msg = warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
        expect(msg).toContain("cron:kb-sync"); // nói RÕ ai đang chặn
        expect(msg).not.toContain("KHÔNG XIN PHÉP"); // KHÔNG được đổ oan "cấp phát chui"

        expect(logged.find((l) => l.event === "baseline_blocked")!.detail!.reason).toBe("loading-lease");

        // ⚠ "Nhánh mới kích hoạt SAI thì bao lâu tự lành?" — NGAY nhịp sau khi hộ kia nhả chỗ.
        running = false;
        const healed = await __runReconcileTick();
        expect(healed.baselineUsedBytes).toBe(1_000 * MIB7);
        expect(healed.baselineBlocked).toBe(false);
        expect(healed.alarm).toBe(false);
        expect(healed.driftBytes).toBe(0);
      } finally {
        stopVramReconciler();
        warnSpy.mockRestore();
      }
    } finally {
      if (prev === undefined) delete process.env.VRAM_BASELINE_BLOCKED_ALARM_MS;
      else process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = prev;
    }
  });

  it("★★ lá chắn CŨ 'thiết bị < đã commit' cũng phải lên ĐỒNG HỒ CHẶN — nếu không, Task 7 đổi nền-nhiễm lấy IM LẶNG vĩnh viễn", async () => {
    // ⚠ ĐÂY LÀ PHÁT HIỆN CỦA LƯỢT NGHIỆM THU LIVE, không phải suy đoán. Trên máy thật, sau khi
    // lá chắn HOÃN chặn lượt chụp ĐẦU, MỌI lượt chụp sau bị lá chắn CŨ chặn tiếp:
    //     [vram] BỎ QUA lượt chụp nền: thiết bị 8445 MiB < tổng đã commit 9797 MiB
    // lặp ở MỌI nhịp suốt cả lượt chạy. Lỗi cộng-trùng của sổ commit là CÓ TRƯỚC, nhưng trước
    // Task 7 nó bị CHE (lượt chụp đầu luôn "thành công" với số đã nhiễm ⇒ `baselineCaptured`
    // bật ⇒ lá chắn cũ không bao giờ chạy). Nếu nhánh này không lên đồng hồ, bản vá Task 7 đổi
    // "nền nhiễm vĩnh viễn" lấy "im lặng vĩnh viễn" — đúng lớp lỗi EXP-1, chỉ đổi mặt.
    const prev = process.env.VRAM_BASELINE_BLOCKED_ALARM_MS;
    process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = "0";
    try {
      // Sổ commit 9.797 MiB nhưng thiết bị chỉ có 8.445 — KHÔNG có lease nào đang nạp, nên lá
      // chắn HOÃN của Task 7 KHÔNG chạm; chỉ lá chắn cũ chặn.
      const over = committedLease("gguf:double-counted", 9_797 * MIB7);
      vi.doMock("./vramBroker", () => ({
        snapshot: () => ({ totalReservedBytes: 9_797 * MIB7, leases: [over] }),
        leaseBytes: leaseBytesMock,
      }));
      vi.doMock("./vramProbe", () => ({
        readDeviceVram: async () => ({ usedBytes: 8_445 * MIB7, totalBytes: 32_607 * MIB7, source: "native" }),
      }));
      const logged: Array<{ event: string; detail?: Record<string, unknown> }> = [];
      vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: never) => logged.push(e) }));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { startVramReconciler, stopVramReconciler, __runReconcileTick } = await import("./vramReconciler");
      try {
        startVramReconciler();
        await new Promise((r) => setImmediate(r));

        const blocked = await __runReconcileTick();
        expect(blocked.baselineUsedBytes).toBeNull();
        expect(blocked.baselineBlocked).toBe(true); // ★ KHÔNG được im lặng
        expect(blocked.alarm).toBe(true);
        const ev = logged.find((l) => l.event === "baseline_blocked");
        expect(ev!.detail!.reason).toBe("device-below-committed"); // chẩn đoán ĐÚNG chỗ cần sửa
        const msg = warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
        expect(msg).toContain("cộng trùng"); // chỉ vào commitMeasured(), không phải "giấy phép treo"
        expect(msg).not.toContain("KHÔNG XIN PHÉP");
      } finally {
        stopVramReconciler();
        warnSpy.mockRestore();
      }
    } finally {
      if (prev === undefined) delete process.env.VRAM_BASELINE_BLOCKED_ALARM_MS;
      else process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = prev;
    }
  });
});

/**
 * ★★ I-4 (review vòng 1, Pha 2A) — TRỘN THƯỚC Ở MỨC TỔNG HỢP phải ĐO ĐƯỢC.
 *
 * `drift` so `Σ leaseBytes` — một phép cộng TRỘN (bộ đếm theo tiến trình + thiết bị + ước lượng)
 * — với số TUYỆT ĐỐI của `nvidia-smi`, dưới ngưỡng 512 MiB cùng bậc độ lớn với khoản lệch
 * +505…+511 MiB giữa hai thước. Hàm này KHÔNG sửa gì (Pha 2A không đổi hành vi, không đổi ngưỡng,
 * không đổi công thức) — nó chỉ trả lời được câu "bao nhiêu phần của sổ đến từ thước nào".
 *
 * ⚠ Bản giả `./vramBroker` ở đây PHẢI khai `leaseBytes` với ĐÚNG công thức thật: hàm đang kiểm
 * dựng TRÊN nó (cố ý — không nhân bản công thức, xem docstring của nó).
 */
describe("I-4 — tách tổng sổ theo THƯỚC", () => {
  beforeEach(() => vi.resetModules());

  const brokerMock = () =>
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
      leaseBytes: (l: { actualBytes: number | null; request: { estimatedBytes: number } }) =>
        l.actualBytes ?? l.request.estimatedBytes,
    }));

  const leaseOf = (owner: string, est: number, actual: number | null, src?: string) =>
    ({
      id: owner,
      request: { owner, kind: "gguf-model", estimatedBytes: est, priority: "interactive" },
      actualBytes: actual,
      measureSource: src,
      measureFailed: false,
      released: false,
      acquiredAt: new Date(),
      lastHeartbeatAt: new Date(),
    }) as never;

  it("ba nhóm PHÂN HOẠCH tổng sổ — không chồng lấn, không sót", async () => {
    brokerMock();
    const { splitLedgerByMeasureSource } = await import("./vramReconciler");

    const s = splitLedgerByMeasureSource([
      leaseOf("gguf:A", 100 * MIB, 111 * MIB, "process-delta"),
      leaseOf("gguf:B", 200 * MIB, 222 * MIB, "device-delta"),
      leaseOf("gguf:C", 300 * MIB, 333 * MIB, undefined), // bản ghi CŨ không khai nguồn
      leaseOf("gguf:D", 400 * MIB, null, "none"), // đo hỏng ⇒ vẫn là ƯỚC LƯỢNG
    ]);

    expect(s.processDeltaBytes).toBe(111 * MIB);
    expect(s.deviceDeltaBytes).toBe((222 + 333) * MIB);
    expect(s.estimatedBytes).toBe(400 * MIB);
    // ★ TRỌNG TÂM: phân hoạch — tổng ba nhóm bằng đúng tổng sổ mà `drift` đang dùng.
    expect(s.totalBytes).toBe((111 + 222 + 333 + 400) * MIB);
  });

  it("giấy phép chưa commit nằm ở nhóm ƯỚC LƯỢNG, không thuộc thước nào", async () => {
    brokerMock();
    const { splitLedgerByMeasureSource } = await import("./vramReconciler");
    const s = splitLedgerByMeasureSource([leaseOf("gguf:pending", 900 * MIB, null, undefined)]);
    expect(s.processDeltaBytes).toBe(0);
    expect(s.deviceDeltaBytes).toBe(0);
    expect(s.estimatedBytes).toBe(900 * MIB);
  });
});
